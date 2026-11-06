import {
  createScheduleSchema,
  ownScheduleFilterSchema,
  scheduleFilterSchema,
  scheduleDetailSchema,
  visitScheduleSchema,
  type BotActor,
  type PlanningPage,
  type PlanningResult,
  type ScheduleDetail,
  type VisitSchedule,
} from "@sales-visit/contracts";

import { planningBatch } from "./planning-access.ts";

const fields =
  "id, sales_force_id AS salesForceId, outlet_id AS outletId, weekday, created_at AS createdAt, updated_at AS updatedAt";

export class ScheduleOperations {
  constructor(private db: D1Database) {}

  own(
    actor: BotActor,
    input: unknown = {}
  ): Promise<PlanningResult<PlanningPage<ScheduleDetail>>> {
    return this.query(actor, input, true);
  }

  list(
    actor: BotActor,
    input: unknown = {}
  ): Promise<PlanningResult<PlanningPage<ScheduleDetail>>> {
    return this.query(actor, input, false);
  }

  private async query(
    actor: BotActor,
    input: unknown,
    own: boolean
  ): Promise<PlanningResult<PlanningPage<ScheduleDetail>>> {
    // Own filters cannot contain any selected SF/Telegram/User identity.
    const parsed = (
      own ? ownScheduleFilterSchema : scheduleFilterSchema
    ).safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const filter = parsed.data;
    const salesForceId =
      "salesForceId" in filter && typeof filter.salesForceId === "string"
        ? filter.salesForceId
        : null;
    const scope = own
      ? "s.sales_force_id = (SELECT salesForceId FROM actor)"
      : "(? IS NULL OR s.sales_force_id = ?)";
    const result = await planningBatch(
      this.db,
      actor,
      own ? "own" : "monitoring",
      (guard) => [
        {
          sql: `SELECT s.id, s.sales_force_id AS salesForceId, s.outlet_id AS outletId,
        s.weekday, s.created_at AS createdAt, s.updated_at AS updatedAt,
        o.name AS outletName, sf.name AS salesForceName
        FROM visit_schedules s JOIN outlets o ON o.id = s.outlet_id
        JOIN sales_force sf ON sf.id = s.sales_force_id
        WHERE ${guard} AND ${scope} AND (? IS NULL OR s.weekday = ?) AND s.id > ?
        ORDER BY s.id LIMIT 51`,
          values: [
            ...(own ? [] : [salesForceId, salesForceId]),
            filter.weekday ?? null,
            filter.weekday ?? null,
            filter.after ?? "",
          ],
        },
      ]
    );
    if (!result.ok) return result;
    const rows = result.data[0]!.results.map((row) =>
      scheduleDetailSchema.parse(row)
    );
    const items = rows.slice(0, 50);
    return {
      ok: true,
      data: { items, next: rows.length > 50 ? items.at(-1)!.id : null },
    };
  }

  // Controlled Admin provisioning for synthetic assignments; no public route.
  async create(
    actor: BotActor,
    input: unknown
  ): Promise<PlanningResult<VisitSchedule>> {
    const parsed = createScheduleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const { salesForceId, outletId, weekday } = parsed.data;
    const references =
      "EXISTS (SELECT 1 FROM sales_force WHERE id = ?) AND EXISTS (SELECT 1 FROM outlets WHERE id = ?)";
    const result = await planningBatch(this.db, actor, "admin", (guard) => [
      {
        sql: `INSERT INTO visit_schedules (id, sales_force_id, outlet_id, weekday)
          SELECT ?, ?, ?, ? WHERE ${guard} AND ${references}
          ON CONFLICT (sales_force_id, outlet_id, weekday) DO NOTHING RETURNING ${fields}`,
        values: [
          crypto.randomUUID(),
          salesForceId,
          outletId,
          weekday,
          salesForceId,
          outletId,
        ],
      },
      {
        sql: `SELECT 1 AS found WHERE ${guard} AND ${references}`,
        values: [salesForceId, outletId],
      },
    ]);
    if (!result.ok) return result;
    const row = visitScheduleSchema
      .optional()
      .parse(result.data[0]!.results[0]);
    if (row) return { ok: true, data: row };
    return {
      ok: false,
      code: result.data[1]!.results.length
        ? "duplicate"
        : "reference_not_found",
    };
  }
}
