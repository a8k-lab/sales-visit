import { sql } from "@sales-visit/db";

import { demoEligibility } from "./demo-auth.ts";

// Trusted SQL identifiers only; callers never interpolate request input here.
// This is record provenance, not an ID-prefix heuristic or another demo dataset.
export const demoOutletPredicate = (alias = "outlets") =>
  `${alias}.demo_only = 1`;
export const demoSchedulePredicate = `s.demo_only = 1 AND ${demoOutletPredicate("o")} AND sf.demo_only = 1`;

export async function isDemoAccount(db: D1Database, userId: string) {
  return !!(await db
    .prepare(`SELECT 1 FROM users u WHERE u.id = ? AND ${demoEligibility}`)
    .bind(userId)
    .first());
}

// Web authentication already verified this live account. Linked Telegram users
// keep their existing catalog access; eligible unlinked demo accounts see only
// the same explicitly marked records used by the bot.
export function webDemoCatalogScope(userId: string, demoPredicate: string) {
  return sql`(exists (select 1 from telegram_identities where user_id = ${userId})
    or (${sql.raw(demoPredicate)}))`;
}
