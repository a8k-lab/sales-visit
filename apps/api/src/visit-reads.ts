import { createDb, sql, visits } from "@sales-visit/db";
import type { Context } from "hono";

import { operationalScope } from "./read-scope.ts";
import { toStockReport, toVisit } from "./records.ts";
import type { WebEnv } from "./web-auth.ts";

export function validReadQuery(c: Context<WebEnv>) {
  if (c.req.url.length > 16384) return false;
  const query = c.req.query();
  const path = c.req.path;
  const paging = ["view", "limit", "offset"];
  const allowed =
    path === "/visits"
      ? [...paging, "salesForceId", "outletId", "channel", "stock", "date", "q"]
      : path === "/stock-reports"
        ? [...paging, "salesForceId", "reporterSalesForceId", "outletId"]
        : ["/sales-force", "/outlets", "/products"].includes(path)
          ? [...paging, ...(query.view === "page" ? ["q"] : [])]
          : path.startsWith("/visits/")
            ? ["include"]
            : [];
  if (query.include !== undefined && query.include !== "references")
    return false;
  if (Object.keys(query).some((key) => !allowed.includes(key))) return false;
  if (Object.keys(query).some((key) => (c.req.queries(key)?.length ?? 0) > 1))
    return false;
  for (const key of ["salesForceId", "reporterSalesForceId", "outletId", "q"]) {
    const value = query[key];
    if (
      value !== undefined &&
      (!value.length ||
        (key === "q" &&
          (!value.trim() ||
            value.length > 200 ||
            [...value].some((char) => char.charCodeAt(0) < 32))))
    )
      return false;
  }
  if (query.view !== undefined && query.view !== "page") return false;
  if (
    query.channel !== undefined &&
    !["web", "telegram"].includes(query.channel)
  )
    return false;
  if (query.stock !== undefined && !["with", "without"].includes(query.stock))
    return false;
  if (query.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) return false;
    const timestamp = Date.parse(`${query.date}T00:00:00Z`);
    if (
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== query.date
    )
      return false;
  }
  return true;
}

export async function listVisits(c: Context<WebEnv>) {
  const db = createDb(c.env.DB);
  const user = c.get("account").id;
  const q = c.req.query();
  // Raw subquery identifiers prevent Drizzle's relational alias remapper from
  // rewriting reporter columns as Visit columns. Never interpolate user SQL.
  const reportScope = sql`report_scope.visit_id = ${visits.id} and ${operationalScope(user, sql`report_scope.reporter_sales_force_id`)}`;
  const hasReports = sql`exists (select 1 from stock_reports report_scope where ${reportScope})`;
  const conditions = [operationalScope(user, visits.salesForceId)];
  if (q.salesForceId)
    conditions.push(sql`${visits.salesForceId} = ${q.salesForceId}`);
  if (q.outletId) conditions.push(sql`${visits.outletId} = ${q.outletId}`);
  if (q.channel)
    conditions.push(sql`${visits.submissionChannel} = ${q.channel}`);
  if (q.stock)
    conditions.push(q.stock === "with" ? hasReports : sql`not ${hasReports}`);
  if (q.date) {
    const start = Date.parse(`${q.date}T00:00:00+07:00`);
    conditions.push(
      sql`${visits.visitedAt} >= ${start} and ${visits.visitedAt} < ${start + 86400000}`
    );
  }
  // instr treats %, _ and backslashes as literal text, not LIKE patterns.
  if (q.q)
    conditions.push(
      sql`instr(lower(${visits.id} || ' ' || coalesce(${visits.notes}, '') || ' ' || coalesce((select name from outlets where id = ${visits.outletId}), '') || ' ' || coalesce((select name from sales_force where id = ${visits.salesForceId}), '')), lower(${q.q.trim()})) > 0`
    );
  const where = sql.join(conditions, sql` and `);
  const rowsQuery = db.query.visits.findMany({
    where,
    limit: Number(q.limit ?? 100),
    offset: Number(q.offset ?? 0),
    orderBy: (t, { desc, asc }) => [desc(t.visitedAt), asc(t.id)],
    with: {
      outlet: { columns: { id: true, name: true } },
      salesForce: { columns: { id: true, name: true } },
    },
    extras: {
      stockReportCount:
        sql<number>`(select count(*) from stock_reports report_scope where ${reportScope})`.as(
          "stock_report_count"
        ),
    },
  });
  if (q.view !== "page") return c.json((await rowsQuery).map(toVisit));
  const [rows, totals] = await db.batch([
    rowsQuery,
    db
      .select({ total: sql<number>`count(*)` })
      .from(visits)
      .where(where),
  ]);
  return c.json({
    items: rows.map((row) => ({
      ...toVisit(row),
      outlet: row.outlet,
      member: row.salesForce,
      stockReportCount: row.stockReportCount,
    })),
    total: totals[0]!.total,
  });
}

export async function visitDetail(c: Context<WebEnv>) {
  const row = await createDb(c.env.DB).query.visits.findFirst({
    where: (t, { eq, and }) =>
      and(
        eq(t.id, c.req.param("id")!),
        operationalScope(c.get("account").id, t.salesForceId)
      ),
    with: {
      outlet: { columns: { id: true, name: true } },
      salesForce: { columns: { id: true, name: true } },
      stockReports: {
        limit: 100,
        where: (t) =>
          operationalScope(c.get("account").id, t.reporterSalesForceId),
        orderBy: (t, { desc, asc }) => [desc(t.reportedAt), asc(t.id)],
        with: {
          items: {
            orderBy: (t, { asc }) => [asc(t.productId)],
            with: { product: { columns: { id: true, name: true } } },
          },
          reporterSalesForce: { columns: { id: true, name: true } },
        },
      },
    },
  });
  if (!row) return c.json({ error: "Visit not found" }, 404);
  if (c.req.query("include") !== "references")
    return c.json({
      ...toVisit(row),
      stockReports: row.stockReports.map(toStockReport),
    });
  return c.json({
    ...toVisit(row),
    outlet: row.outlet,
    member: row.salesForce,
    stockReports: row.stockReports.map((report) => ({
      ...toStockReport(report),
      reporter: report.reporterSalesForce,
      items: report.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        product: item.product,
      })),
    })),
  });
}
