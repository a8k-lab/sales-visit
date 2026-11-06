import {
  visitDraftPayloadSchema,
  visitWizardInputSchema,
  type BotActor,
  type VisitDraftPayload,
  type VisitDraftStep,
  type VisitDraftView,
  type VisitWizardResult,
} from "@sales-visit/contracts";
import { createDb } from "@sales-visit/db";

import { createVisit, OperationError, submissionId } from "../operations.ts";
import { planningBatch } from "../planning-access.ts";
import { parseJakartaVisitTime } from "./time.ts";

const TTL = 24 * 3600000;
const active = new Set(["outlet", "time", "notes", "followUp", "review"]);
type Row = {
  userId: string;
  currentSf: string;
  key: string | null;
  salesForceId: string;
  step: VisitDraftStep;
  payload: string;
  revision: number;
  lastMessage: number;
  expiresAt: number;
  visitId: string | null;
};
function readPayload(value: string): VisitDraftPayload {
  try {
    return visitDraftPayloadSchema.parse(JSON.parse(value));
  } catch {
    throw new Error("Invalid stored draft");
  }
}
const view = (row: Row): VisitDraftView | null =>
  row.key
    ? {
        step: row.step,
        payload: readPayload(row.payload),
        expiresAt: row.expiresAt,
        visitId: row.visitId,
      }
    : null;
const success = (
  row: Row,
  notice?:
    | "stale"
    | "invalid_input"
    | "outlet_missing"
    | "link_changed"
    | "busy"
): VisitWizardResult => ({ ok: true, data: { draft: view(row), notice } });

export class VisitWizard {
  constructor(private readonly db: D1Database) {}

  private async read(actor: BotActor): Promise<Row | undefined> {
    const result = await planningBatch(this.db, actor, "own", (guard) => [
      {
        sql: `SELECT u.id AS userId, u.sales_force_id AS currentSf,
        d.submission_key AS key, d.sales_force_id AS salesForceId, d.step,
        d.payload, d.revision, d.last_message AS lastMessage,
        d.expires_at AS expiresAt, d.visit_id AS visitId
        FROM users u JOIN telegram_identities t ON t.user_id = u.id
        LEFT JOIN telegram_visit_drafts d ON d.user_id = u.id
        WHERE t.telegram_user_id = ? AND ${guard}`,
        values: [actor.telegramUserId],
      },
    ]);
    if (!result.ok) {
      if (result.code === "unavailable") throw new Error("storage");
      return undefined;
    }
    return result.data[0]?.results[0] as Row | undefined;
  }

  // Optimistic revision + per-owner private-chat message watermark. A failed CAS
  // never retries the input against a different step. Telegram duplicates can
  // repeat the current prompt, but cannot advance it again.
  private async change(
    actor: BotActor,
    row: Row,
    messageId: number,
    set: string,
    values: (string | number | null)[],
    pin = true
  ) {
    const result = await planningBatch(this.db, actor, "own", (guard) => [
      {
        sql: `UPDATE telegram_visit_drafts SET ${set}, revision = revision + 1,
        last_message = ? WHERE user_id = ? AND submission_key = ?
        AND revision = ? AND last_message < ? AND ${guard}
        ${pin ? "AND sales_force_id = (SELECT salesForceId FROM actor)" : ""}`,
        values: [
          ...values,
          messageId,
          row.userId,
          row.key,
          row.revision,
          messageId,
        ],
      },
    ]);
    if (!result.ok) {
      if (result.code === "unavailable") throw new Error("storage");
      return false;
    }
    return result.data[0]?.meta.changes === 1;
  }

  async handle(actor: BotActor, input: unknown): Promise<VisitWizardResult> {
    const parsed = visitWizardInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid" };
    try {
      return await this.transition(actor, parsed.data);
    } catch {
      return { ok: false, code: "unavailable" };
    }
  }

  private async transition(
    actor: BotActor,
    input: ReturnType<typeof visitWizardInputSchema.parse>
  ): Promise<VisitWizardResult> {
    let row = await this.read(actor);
    if (!row) return { ok: false, code: "forbidden" };
    const userId = row.userId;
    const { action, messageId } = input;
    const now = Date.now();
    const expired = row.key && active.has(row.step) && row.expiresAt <= now;

    if (
      action === "start" &&
      (!row.key ||
        ["cancelled", "expired", "submitted"].includes(row.step) ||
        expired)
    ) {
      if (row.key && messageId <= row.lastMessage) return success(row, "stale");
      const key = crypto.randomUUID();
      if (row.key) {
        await this.change(
          actor,
          row,
          messageId,
          "submission_key = ?, sales_force_id = ?, step = 'outlet', payload = '{}', expires_at = ?, visit_id = NULL",
          [key, row.currentSf, now + TTL],
          false
        );
      } else {
        const result = await planningBatch(this.db, actor, "own", (guard) => [
          {
            sql: `INSERT INTO telegram_visit_drafts
            (user_id, submission_key, sales_force_id, step, payload, revision, last_message, expires_at)
            SELECT ?, ?, salesForceId, 'outlet', '{}', 0, ?, ? FROM actor
            WHERE ${guard} ON CONFLICT(user_id) DO NOTHING`,
            values: [userId, key, messageId, now + TTL],
          },
        ]);
        if (!result.ok)
          return {
            ok: false,
            code: result.code === "forbidden" ? "forbidden" : "unavailable",
          };
      }
      const latest = await this.read(actor);
      return latest ? success(latest) : { ok: false, code: "forbidden" };
    }
    if (!row.key) return success(row);

    // Confirmations are recoverable even with the original message ID after a
    // crash between Visit commit and receipt finalization. Never thaw payloads.
    if (action === "confirm" && ["submitting", "submitted"].includes(row.step))
      return this.submit(actor, row);
    if (messageId <= row.lastMessage) return success(row, "stale");
    if (row.step === "submitting") {
      if (action !== "cancel") return success(row, "busy");
      const id = await submissionId(
        { salesForceId: row.salesForceId, submissionChannel: "telegram" },
        row.key,
        "visit"
      );
      // Cancellation and the guarded Visit INSERT serialize in D1. If the
      // Visit won, cancellation cannot erase its recoverable receipt.
      const frozen = row;
      const result = await planningBatch(this.db, actor, "own", (guard) => [
        {
          sql: `UPDATE telegram_visit_drafts SET step = 'cancelled', payload = '{}',
          revision = revision + 1, last_message = ?
          WHERE user_id = ? AND submission_key = ? AND revision = ?
          AND last_message < ? AND ${guard}
          AND NOT EXISTS (SELECT 1 FROM visits WHERE id = ?)`,
          values: [
            messageId,
            frozen.userId,
            frozen.key,
            frozen.revision,
            messageId,
            id,
          ],
        },
      ]);
      if (!result.ok)
        return {
          ok: false,
          code: result.code === "forbidden" ? "forbidden" : "unavailable",
        };
      const latest = await this.read(actor);
      if (!latest) return { ok: false, code: "forbidden" };
      return latest.step === "submitting"
        ? this.submit(actor, latest)
        : success(latest);
    }
    if (action === "cancel" && active.has(row.step)) {
      await this.change(
        actor,
        row,
        messageId,
        "step = 'cancelled', payload = '{}'",
        [],
        false
      );
    } else if (expired) {
      await this.change(
        actor,
        row,
        messageId,
        "step = 'expired', payload = '{}'",
        [],
        false
      );
    } else if (row.salesForceId !== row.currentSf) {
      return success(row, "link_changed");
    } else if (action === "confirm" && row.step === "review") {
      const changed = await this.change(
        actor,
        row,
        messageId,
        "step = 'submitting'",
        []
      );
      const latest = await this.read(actor);
      if (!latest) return { ok: false, code: "forbidden" };
      if (
        latest.key === row.key &&
        ["submitting", "submitted"].includes(latest.step)
      )
        return this.submit(actor, latest);
      return success(latest, changed ? undefined : "stale");
    } else if (action === "answer" && active.has(row.step)) {
      const payload = readPayload(row.payload);
      const value = input.value ?? "";
      const expected = row.step === "time" ? "time" : row.step;
      if (input.field !== expected || !value.trim())
        return success(row, "invalid_input");
      let next: VisitDraftStep;
      if (row.step === "outlet") {
        // Narrow SF-only lookup for Visit entry, not Outlet management/listing.
        const id = visitDraftPayloadSchema.shape.outletId.safeParse(value);
        if (!id.success) return success(row, "invalid_input");
        const result = await planningBatch(this.db, actor, "own", (guard) => [
          {
            sql: `SELECT id, name FROM outlets WHERE id = ? AND ${guard}`,
            values: [id.data!],
          },
        ]);
        if (!result.ok)
          return {
            ok: false,
            code: result.code === "forbidden" ? "forbidden" : "unavailable",
          };
        const outlet = result.data[0]?.results[0] as
          | { id: string; name: string }
          | undefined;
        if (!outlet) return success(row, "outlet_missing");
        payload.outletId = outlet.id as string;
        // Bounded snapshot for preview; the key is exact and never truncated.
        payload.outletName = [...String(outlet.name)].slice(0, 256).join("");
        next = "time";
      } else if (row.step === "time") {
        const time = parseJakartaVisitTime(value, now);
        if (!time) return success(row, "invalid_input");
        payload.visitedAt = time;
        next = "notes";
      } else if (row.step === "notes" || row.step === "followUp") {
        if (value.length > 1000) return success(row, "invalid_input");
        payload[row.step] =
          value.toLowerCase() === "lewati" ? undefined : value;
        next = row.step === "notes" ? "followUp" : "review";
      } else return success(row, "invalid_input");
      const changed = await this.change(
        actor,
        row,
        messageId,
        "step = ?, payload = ?",
        [next, JSON.stringify(visitDraftPayloadSchema.parse(payload))]
      );
      const latest = await this.read(actor);
      return latest
        ? success(latest, changed ? undefined : "stale")
        : { ok: false, code: "forbidden" };
    } else
      return success(row, action === "start" ? undefined : "invalid_input");
    row = await this.read(actor);
    return row ? success(row) : { ok: false, code: "forbidden" };
  }

  private async submit(actor: BotActor, row: Row): Promise<VisitWizardResult> {
    if (row.salesForceId !== row.currentSf) return success(row, "link_changed");
    const payload = readPayload(row.payload);
    try {
      const result = await createVisit(
        createDb(this.db),
        {
          salesForceId: row.currentSf,
          submissionChannel: "telegram",
        },
        row.key,
        {
          outletId: payload.outletId,
          visitedAt: payload.visitedAt,
          notes: payload.notes,
          followUp: payload.followUp,
        },
        {
          telegramUserId: actor.telegramUserId,
          userId: row.userId,
          draftKey: row.key!,
        }
      );
      // Separate recoverable finalization. A failed write leaves submitting and
      // the immutable UUID/payload; the next confirmation replays createVisit.
      const final = await planningBatch(this.db, actor, "own", (guard) => [
        {
          sql: `UPDATE telegram_visit_drafts SET step = 'submitted', visit_id = ?, revision = revision + 1
          WHERE user_id = ? AND submission_key = ? AND step = 'submitting'
          AND sales_force_id = (SELECT salesForceId FROM actor) AND ${guard}`,
          values: [result.data.id, row.userId, row.key],
        },
      ]);
      if (!final.ok)
        return {
          ok: false,
          code: final.code === "forbidden" ? "forbidden" : "unavailable",
        };
      return success({ ...row, step: "submitted", visitId: result.data.id });
    } catch (error) {
      if (error instanceof OperationError) {
        if (error.status === 401) return { ok: false, code: "forbidden" };
        if (error.status === 404) return success(row, "outlet_missing");
      }
      throw error;
    }
  }
}
