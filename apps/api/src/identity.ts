import {
  approvalSchema,
  botActorSchema,
  rejectionSchema,
  telegramIdSchema,
  type Account,
  type BotActor,
  type IdentityResult,
} from "@sales-visit/contracts";

const accountQuery = `SELECT u.id, t.telegram_user_id AS telegramUserId, u.status, u.role,
  u.sales_force_id AS salesForceId, t.username, t.first_name AS firstName,
  t.last_name AS lastName, u.created_at AS createdAt
  FROM users u JOIN telegram_identities t ON t.user_id = u.id`;
const adminGuard = `EXISTS (SELECT 1 FROM users a JOIN telegram_identities ai ON ai.user_id = a.id
  WHERE ai.telegram_user_id = ? AND a.status = 'active' AND a.role = 'admin')`;
const state = `json_object('status', u.status, 'role', u.role, 'salesForceId', u.sales_force_id)`;

// D1 batches are serialized transactions. No lifecycle decision relies on a stale
// preflight read: the audit INSERT checks actor, target and claim in the transaction.
// The following UPDATE is gated by this invocation's unique audit ID.
export class IdentityOperations {
  constructor(private db: D1Database) {}

  private account(telegramId: string) {
    return this.db
      .prepare(accountQuery + " WHERE t.telegram_user_id = ?")
      .bind(telegramId)
      .first<Account>();
  }

  async me(actor: BotActor): Promise<IdentityResult<Account | null>> {
    const parsed = botActorSchema.safeParse(actor);
    if (!parsed.success) return { ok: false, code: "invalid" };
    return { ok: true, data: await this.account(parsed.data.telegramUserId) };
  }

  async register(actor: BotActor): Promise<IdentityResult<Account>> {
    const parsed = botActorSchema.safeParse(actor);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const input = parsed.data;
    const id = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(`INSERT INTO users (id)
        SELECT ? WHERE NOT EXISTS (SELECT 1 FROM telegram_identities WHERE telegram_user_id = ?)`)
        .bind(id, input.telegramUserId),
      this.db
        .prepare(`INSERT INTO telegram_identities (user_id, telegram_user_id, username, first_name, last_name)
        SELECT id, ?, ?, ?, ? FROM users WHERE id = ?`)
        .bind(
          input.telegramUserId,
          input.username ?? null,
          input.firstName ?? null,
          input.lastName ?? null,
          id
        ),
      this.db
        .prepare(
          "INSERT INTO access_audit (id, actor_user_id, target_user_id, action, before_state, after_state) SELECT ?, u.id, u.id, 'register', 'null', json_set(" +
            state +
            ", '$.telegramUserId', ?) FROM users u WHERE u.id = ?"
        )
        .bind(eventId, input.telegramUserId, id),
    ]);
    // Existing snapshots deliberately stay unchanged; profile changes never relink.
    return { ok: true, data: (await this.account(input.telegramUserId))! };
  }

  async pending(
    actor: BotActor,
    after = ""
  ): Promise<IdentityResult<{ accounts: Account[]; next: string | null }>> {
    if (
      !botActorSchema.safeParse(actor).success ||
      typeof after !== "string" ||
      after.length > 256
    )
      return { ok: false, code: "invalid" };
    // Authorization and list share one D1 batch snapshot, including empty lists.
    const [permission, rows] = await this.db.batch([
      this.db
        .prepare("SELECT 1 AS allowed WHERE " + adminGuard)
        .bind(actor.telegramUserId),
      this.db
        .prepare(
          accountQuery +
            " WHERE u.status = 'pending' AND u.id > ? AND " +
            adminGuard +
            " ORDER BY u.id LIMIT 11"
        )
        .bind(after, actor.telegramUserId),
    ]);
    if (!permission || !rows) throw new Error("Incomplete D1 batch");
    if (!permission.results.length) return { ok: false, code: "forbidden" };
    // SAFETY: accountQuery selects precisely the Account aliases; D1 cannot infer SQL result shapes.
    const accounts = rows.results.slice(0, 10) as unknown as Account[];
    return {
      ok: true,
      data: {
        accounts,
        next: rows.results.length > 10 ? accounts.at(-1)!.id : null,
      },
    };
  }

  approve(actor: BotActor, input: unknown): Promise<IdentityResult<Account>> {
    const parsed = approvalSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve({ ok: false, code: "invalid" });
    return this.decide(
      actor,
      parsed.data.telegramUserId,
      "approve",
      parsed.data.role,
      parsed.data.salesForceId ?? null
    );
  }

  reject(actor: BotActor, input: unknown): Promise<IdentityResult<Account>> {
    const parsed = rejectionSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve({ ok: false, code: "invalid" });
    return this.decide(actor, parsed.data.telegramUserId, "reject", null, null);
  }

  private async decide(
    actor: BotActor,
    target: string,
    action: "approve" | "reject",
    role: Account["role"],
    salesForceId: string | null
  ): Promise<IdentityResult<Account>> {
    if (
      !botActorSchema.safeParse(actor).success ||
      !telegramIdSchema.safeParse(target).success
    )
      return { ok: false, code: "invalid" };
    const eventId = crypto.randomUUID(); // also the correlation ID; never a raw update
    const status = action === "approve" ? "active" : "rejected";
    const [audit] = await this.db.batch([
      this.db
        .prepare(`INSERT INTO access_audit (id, actor_user_id, target_user_id, action, before_state, after_state)
        SELECT ?, (SELECT user_id FROM telegram_identities WHERE telegram_user_id = ?), u.id, ?,
          json_object('status', u.status, 'role', u.role, 'salesForceId', u.sales_force_id),
          json_object('status', ?, 'role', ?, 'salesForceId', ?)
        FROM users u JOIN telegram_identities t ON t.user_id = u.id
        WHERE t.telegram_user_id = ? AND u.status = 'pending'
          AND u.role IS NULL AND u.sales_force_id IS NULL
          AND EXISTS (SELECT 1 FROM users a JOIN telegram_identities ai ON ai.user_id = a.id
            WHERE ai.telegram_user_id = ? AND a.status = 'active' AND a.role = 'admin')
          AND (? IS NULL OR (EXISTS (SELECT 1 FROM sales_force WHERE id = ?)
            AND NOT EXISTS (SELECT 1 FROM users WHERE sales_force_id = ?)))`)
        .bind(
          eventId,
          actor.telegramUserId,
          action,
          status,
          role,
          salesForceId,
          target,
          actor.telegramUserId,
          salesForceId,
          salesForceId,
          salesForceId
        ),
      this.db
        .prepare(`UPDATE users SET status = ?, role = ?, sales_force_id = ?, updated_at = unixepoch() * 1000
        WHERE id = (SELECT target_user_id FROM access_audit WHERE id = ?) AND status = 'pending'`)
        .bind(status, role, salesForceId, eventId),
    ]);
    if (!audit) throw new Error("Incomplete D1 batch");
    if (audit.meta.changes)
      return { ok: true, data: (await this.account(target))! };
    // Safe explanations only after rechecking permission. No target disclosure to non-Admins.
    const permitted = await this.db
      .prepare("SELECT 1 AS allowed WHERE " + adminGuard)
      .bind(actor.telegramUserId)
      .first();
    if (!permitted) return { ok: false, code: "forbidden" };
    const account = await this.account(target);
    if (!account) return { ok: false, code: "not_found" };
    if (account.status !== "pending" || account.role || account.salesForceId)
      return { ok: false, code: "not_pending" };
    return { ok: false, code: "sales_force_unavailable" };
  }
}
