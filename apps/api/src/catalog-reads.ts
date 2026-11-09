import { createDb, sql, salesForce, outlets, products } from "@sales-visit/db";
import type { Context } from "hono";

import { operationalScope } from "./read-scope.ts";
import type { WebEnv } from "./web-auth.ts";

export async function catalogPage(
  c: Context<WebEnv>,
  kind: "salesForce" | "outlets" | "products"
) {
  const table = { salesForce, outlets, products }[kind];
  const db = createDb(c.env.DB);
  const q = c.req.query("q");
  const scope =
    kind === "salesForce"
      ? operationalScope(c.get("account").id, salesForce.id)
      : sql`1 = 1`;
  const where = q
    ? sql`${scope} and instr(lower(${table.name} || ' ' || ${table.id}), lower(${q.trim()})) > 0`
    : scope;
  const [items, totals] = await db.batch([
    db
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(where)
      .orderBy(table.id)
      .limit(Number(c.req.query("limit") ?? 100))
      .offset(Number(c.req.query("offset") ?? 0)),
    db
      .select({ total: sql<number>`count(*)` })
      .from(table)
      .where(where),
  ]);
  return c.json({ items, total: totals[0]!.total });
}

export async function outletDetail(c: Context<WebEnv>) {
  const outlet = await createDb(c.env.DB).query.outlets.findFirst({
    columns: { id: true, name: true, businessId: true, noRs: true },
    where: (t, { eq }) => eq(t.id, c.req.param("id")!),
  });
  if (!outlet) return c.json({ error: "Outlet not found" }, 404);
  return c.json(outlet);
}
