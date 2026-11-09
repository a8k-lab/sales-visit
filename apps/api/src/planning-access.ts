import {
  botActorSchema,
  type BotActor,
  type PlanningResult,
} from "@sales-visit/contracts";

const actorCte = `WITH actor AS (
  SELECT u.id AS userId, u.role, sf.id AS salesForceId FROM users u
  JOIN telegram_identities t ON t.user_id = u.id
  LEFT JOIN sales_force sf ON sf.id = u.sales_force_id
  WHERE t.telegram_user_id = ? AND u.status = 'active'
)`;
const policies = {
  admin: "EXISTS (SELECT 1 FROM actor WHERE role = 'admin')",
  monitoring:
    "EXISTS (SELECT 1 FROM actor WHERE role IN ('admin', 'supervisor'))",
  own: "EXISTS (SELECT 1 FROM actor WHERE role = 'sales_force' AND salesForceId IS NOT NULL)",
} as const;
export type PlanningPolicy = keyof typeof policies;
export type PlanningStatement = {
  sql: string;
  values?: (string | number | null)[];
};

// Permission, guarded query/write, and diagnostics share one serialized D1
// transaction. Every statement re-resolves current D1 identity; no cached role.
// The guard is also in the mutation itself, not just a preflight read.
export async function planningBatch(
  db: D1Database,
  actor: BotActor,
  policy: PlanningPolicy,
  statements: (guard: string) => PlanningStatement[]
): Promise<PlanningResult<D1Result[]>> {
  const parsed = botActorSchema.safeParse(actor);
  if (!parsed.success) return { ok: false, code: "invalid" };
  const guard = policies[policy];
  try {
    const queries = [
      { sql: `SELECT 1 AS allowed WHERE ${guard}` },
      ...statements(guard),
    ];
    const [permission, ...results] = await db.batch(
      queries.map(({ sql, values = [] }) =>
        db
          .prepare(`${actorCte} ${sql}`)
          .bind(parsed.data.telegramUserId, ...values)
      )
    );
    if (!permission?.results.length) return { ok: false, code: "forbidden" };
    return { ok: true, data: results };
  } catch {
    // Never transport SQL errors, bindings or identity profiles over RPC.
    return { ok: false, code: "unavailable" };
  }
}
