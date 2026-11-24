import {
  botActorSchema,
  planningIdSchema,
  type BotActor,
  type BotDemoResult,
  type DemoAccount,
  type Account,
} from "@sales-visit/contracts";

import { demoEnabled, demoEligibility, demoAccountQuery } from "./demo-auth.ts";

type DemoEnv = { DB: D1Database; APP_ENV?: string; DEMO_AUTH_ENABLED?: string };
export const demoActorCte = `WITH actor AS (
  SELECT u.id AS userId, u.role, u.sales_force_id AS salesForceId FROM users u
  JOIN telegram_demo_sessions session ON session.user_id = u.id
  WHERE session.telegram_user_id = ? AND session.expires_at > unixepoch('subsec') * 1000
    AND ${demoEligibility}
)`;

export class TelegramDemo {
  private env: DemoEnv;
  constructor(env: DemoEnv) {
    this.env = env;
  }
  private valid(actor: BotActor) {
    return demoEnabled(this.env) && botActorSchema.safeParse(actor).success;
  }
  // A live credential takes precedence even when its account becomes ineligible:
  // fail closed, never silently execute a command as the real Admin underneath.
  async active(actor: BotActor) {
    if (!this.valid(actor)) return false;
    return !!(await this.env.DB.prepare(`SELECT 1 FROM telegram_demo_sessions
      WHERE telegram_user_id = ? AND expires_at > ?`)
      .bind(actor.telegramUserId, Date.now())
      .first());
  }
  async accounts(actor: BotActor) {
    if (!this.valid(actor)) return { ok: false } as const;
    const rows =
      await this.env.DB.prepare(`${demoAccountQuery} WHERE ${demoEligibility}
      ORDER BY u.role, u.display_name, u.id`).all<DemoAccount>();
    return { ok: true, items: rows.results } as const;
  }
  async login(actor: BotActor, accountId: unknown): Promise<BotDemoResult> {
    if (!this.valid(actor)) return { ok: false, code: "disabled" };
    const parsed = planningIdSchema.safeParse(accountId);
    if (!parsed.success) return { ok: false, code: "invalid" };
    const now = Date.now();
    // No target Telegram ID, role or owner is accepted from command input.
    // Eligibility is checked IN the atomic upsert, including account switches.
    // A failed lookup leaves any current session unchanged and discloses nothing
    // about real, disabled, missing or otherwise ineligible accounts.
    const issued = await this.env.DB.prepare(`INSERT INTO telegram_demo_sessions
      (telegram_user_id, user_id, created_at, expires_at)
      SELECT ?, u.id, ?, ? FROM users u WHERE u.id = ? AND ${demoEligibility}
      ON CONFLICT (telegram_user_id) DO UPDATE SET user_id = excluded.user_id,
        created_at = excluded.created_at, expires_at = excluded.expires_at RETURNING user_id`)
      .bind(actor.telegramUserId, now, now + 3600000, parsed.data)
      .first();
    if (!issued) return { ok: false, code: "unavailable" };
    return this.status(actor);
  }
  async status(actor: BotActor): Promise<BotDemoResult> {
    if (!this.valid(actor)) return { ok: false, code: "disabled" };
    const row = await this.env.DB.prepare(
      `SELECT account.*, session.expires_at AS expiresAt
      FROM (${demoAccountQuery} WHERE ${demoEligibility}) account
      JOIN telegram_demo_sessions session ON session.user_id = account.id
      WHERE session.telegram_user_id = ? AND session.expires_at > ?`
    )
      .bind(actor.telegramUserId, Date.now())
      .first<DemoAccount & { expiresAt: number }>();
    if (!row)
      return (await this.active(actor))
        ? { ok: false, code: "expired" }
        : { ok: true, data: null };
    const { expiresAt, ...account } = row;
    return { ok: true, data: { account, expiresAt } };
  }
  async logout(actor: BotActor): Promise<BotDemoResult> {
    if (!this.valid(actor)) return { ok: false, code: "disabled" };
    await this.env.DB.prepare(
      "DELETE FROM telegram_demo_sessions WHERE telegram_user_id = ?"
    )
      .bind(actor.telegramUserId)
      .run();
    return { ok: true, data: null };
  }
  async me(actor: BotActor) {
    // No synthetic telegram_identities row: this projection displays the sender
    // separately from the selected internal demo account.
    const row = await this.env.DB.prepare(`${demoActorCte}
      SELECT u.id, ? AS telegramUserId, u.status, u.role, u.sales_force_id AS salesForceId,
        NULL AS username, trim(u.display_name) AS firstName, NULL AS lastName,
        u.created_at AS createdAt FROM users u JOIN actor ON actor.userId = u.id`)
      .bind(actor.telegramUserId, actor.telegramUserId)
      .first<Account>();
    return { ok: true, data: row } as const;
  }
}
