import {
  approvalSchema,
  botActorSchema,
  rejectionSchema,
  roleChangeSchema,
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

  pending(actor: BotActor, after = "") {
    return this.listAccounts(actor, after, true);
  }

  users(actor: BotActor, after = "") {
    return this.listAccounts(actor, after, false);
  }

  private async listAccounts(
    actor: BotActor,
    after: string,
    pendingOnly: boolean
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
            (pendingOnly ? " WHERE u.status = 'pending' AND " : " WHERE ") +
            "u.id > ? AND " +
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

  setRole(actor: BotActor, input: unknown): Promise<IdentityResult<Account>> {
    const parsed = roleChangeSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve({ ok: false, code: "invalid" });
    return this.manage(
      actor,
      parsed.data.telegramUserId,
      "setrole",
      parsed.data.role,
      parsed.data.salesForceId ?? null
    );
  }

  disable(actor: BotActor, input: unknown): Promise<IdentityResult<Account>> {
    const parsed = rejectionSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve({ ok: false, code: "invalid" });
    return this.manage(actor, parsed.data.telegramUserId, "disable");
  }

  enable(actor: BotActor, input: unknown): Promise<IdentityResult<Account>> {
    const parsed = rejectionSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve({ ok: false, code: "invalid" });
    return this.manage(actor, parsed.data.telegramUserId, "enable");
  }

  private async manage(
    actor: BotActor,
    target: string,
    action: "setrole" | "disable" | "enable",
    role: Account["role"] = null,
    salesForceId: string | null = null
  ): Promise<IdentityResult<Account>> {
    if (!botActorSchema.safeParse(actor).success)
      return { ok: false, code: "invalid" };
    // All predicates execute in the serialized batch. Links survive non-SF roles
    // and disabling; changing an existing link requires a separate reviewed policy.
    const expectedStatus = action === "enable" ? "disabled" : "active";
    const reducesAdmin =
      action === "disable" || (action === "setrole" && role !== "admin");
    const eventId = crypto.randomUUID();
    const [permission, audit, , rows, admins] = await this.db.batch([
      this.db
        .prepare("SELECT 1 WHERE " + adminGuard)
        .bind(actor.telegramUserId),
      this.db
        .prepare(`WITH desired AS (SELECT ? AS action, ? AS role, ? AS sf),
        candidates AS (
          SELECT u.id, u.status, u.role, u.sales_force_id, d.action,
            CASE WHEN d.action = 'disable' THEN 'disabled' ELSE 'active' END AS next_status,
            CASE WHEN d.action = 'setrole' THEN d.role ELSE u.role END AS next_role,
            CASE WHEN d.action = 'setrole' AND d.role = 'sales_force' THEN d.sf ELSE u.sales_force_id END AS next_sf
          FROM users u JOIN telegram_identities t ON t.user_id = u.id CROSS JOIN desired d
          WHERE t.telegram_user_id = ?
            AND EXISTS (SELECT 1 FROM users a JOIN telegram_identities ai ON ai.user_id = a.id
              WHERE ai.telegram_user_id = ? AND a.status = 'active' AND a.role = 'admin')
            AND u.status = ?
            AND (? = 0 OR u.role <> 'admin')
            AND (? = 0 OR u.role <> 'admin' OR
              (SELECT count(*) FROM users WHERE status = 'active' AND role = 'admin') > 1)
            AND (d.sf IS NULL OR (EXISTS (SELECT 1 FROM sales_force WHERE id = d.sf)
              AND (u.sales_force_id IS NULL OR u.sales_force_id = d.sf)
              AND NOT EXISTS (SELECT 1 FROM users other WHERE other.sales_force_id = d.sf AND other.id <> u.id)))
        )
        INSERT INTO access_audit (id, actor_user_id, target_user_id, action, before_state, after_state)
        SELECT ?, (SELECT user_id FROM telegram_identities WHERE telegram_user_id = ?), id, action,
          json_object('status', status, 'role', role, 'salesForceId', sales_force_id),
          json_object('status', next_status, 'role', next_role, 'salesForceId', next_sf)
        FROM candidates WHERE status IS NOT next_status OR role IS NOT next_role OR sales_force_id IS NOT next_sf`)
        .bind(
          action,
          role,
          salesForceId,
          target,
          actor.telegramUserId,
          expectedStatus,
          reducesAdmin ? 1 : 0,
          reducesAdmin ? 1 : 0,
          eventId,
          actor.telegramUserId
        ),
      this.db
        .prepare(`UPDATE users SET
        status = json_extract((SELECT after_state FROM access_audit WHERE id = ?), '$.status'),
        role = json_extract((SELECT after_state FROM access_audit WHERE id = ?), '$.role'),
        sales_force_id = json_extract((SELECT after_state FROM access_audit WHERE id = ?), '$.salesForceId'),
        updated_at = unixepoch() * 1000
        WHERE id = (SELECT target_user_id FROM access_audit WHERE id = ?)`)
        .bind(eventId, eventId, eventId, eventId),
      this.db
        .prepare(
          accountQuery + " WHERE t.telegram_user_id = ? AND " + adminGuard
        )
        .bind(target, actor.telegramUserId),
      this.db.prepare(
        "SELECT count(*) AS n FROM users WHERE status = 'active' AND role = 'admin'"
      ),
    ]);
    if (!permission || !audit || !rows) throw new Error("Incomplete D1 batch");
    if (!permission.results.length) return { ok: false, code: "forbidden" };
    // SAFETY: accountQuery selects exactly Account's aliases; D1 does not infer SQL shapes.
    const account = rows.results[0] as unknown as Account | undefined;
    if (!account) return { ok: false, code: "not_found" };
    if (audit.meta.changes) return { ok: true, data: account };
    // Idempotent repeats do not append a second audit event.
    const desiredStatus = action === "disable" ? "disabled" : "active";
    if (
      account.status === desiredStatus &&
      (action !== "setrole" ||
        (account.role === role &&
          (role !== "sales_force" || account.salesForceId === salesForceId)))
    )
      return { ok: true, data: account };
    if (
      account.status === "active" &&
      account.role === "admin" &&
      reducesAdmin
    ) {
      // Blanket Admin protection is stronger than the last-Admin invariant.
      return {
        ok: false,
        code:
          (admins?.results[0] as { n: number } | undefined)?.n === 1
            ? "last_admin"
            : "protected_admin",
      };
    }
    if (account.status !== expectedStatus)
      return { ok: false, code: "invalid_transition" };
    if (
      salesForceId &&
      account.salesForceId &&
      account.salesForceId !== salesForceId
    )
      return { ok: false, code: "association_locked" };
    return { ok: false, code: "sales_force_unavailable" };
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
