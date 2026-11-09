import { createDb, sql, visits, stockReports } from "@sales-visit/db";
import type { Context } from "hono";

import { operationalScope } from "./read-scope.ts";
import { toVisit } from "./records.ts";
import type { WebEnv } from "./web-auth.ts";

const day = 86400000;
// Jakarta has no DST. Include today and the previous 13 calendar days.
export function reportingWindow(now = Date.now()) {
  const today = Math.floor((now + 7 * 3600000) / day) * day - 7 * 3600000;
  return { start: today - 13 * day, end: today + day };
}

export async function dashboardOverview(c: Context<WebEnv>) {
  if (c.get("account").role === "sales_force")
    return c.json({ error: "Forbidden" }, 403);
  if (Object.keys(c.req.query()).length)
    return c.json({ error: "Invalid request" }, 400);
  const db = createDb(c.env.DB);
  const user = c.get("account").id;
  const { start, end } = reportingWindow();
  const visitWhere = sql`${operationalScope(user, visits.salesForceId)} and ${visits.visitedAt} >= ${start} and ${visits.visitedAt} < ${end}`;
  const reportWhere = sql`${operationalScope(user, stockReports.reporterSalesForceId)} and ${stockReports.reportedAt} >= ${start} and ${stockReports.reportedAt} < ${end}`;
  const [totals, reports, daily, channels, recent] = await db.batch([
    db
      .select({
        visits: sql<number>`count(*)`,
        outlets: sql<number>`count(distinct ${visits.outletId})`,
        salesForce: sql<number>`count(distinct ${visits.salesForceId})`,
      })
      .from(visits)
      .where(visitWhere),
    db
      .select({ count: sql<number>`count(*)` })
      .from(stockReports)
      .where(reportWhere),
    db
      .select({
        date: sql<string>`date(${visits.visitedAt} / 1000, 'unixepoch', '+7 hours')`,
        count: sql<number>`count(*)`,
      })
      .from(visits)
      .where(visitWhere)
      .groupBy(sql`date(${visits.visitedAt} / 1000, 'unixepoch', '+7 hours')`),
    db
      .select({
        channel: visits.submissionChannel,
        count: sql<number>`count(*)`,
      })
      .from(visits)
      .where(visitWhere)
      .groupBy(visits.submissionChannel),
    db.query.visits.findMany({
      where: visitWhere,
      limit: 5,
      orderBy: (t, { desc, asc }) => [desc(t.visitedAt), asc(t.id)],
      with: {
        outlet: { columns: { id: true, name: true } },
        salesForce: { columns: { id: true, name: true } },
      },
    }),
  ]);
  return c.json({
    period: {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      timeZone: "Asia/Jakarta",
    },
    metrics: { ...totals[0]!, stockReports: reports[0]!.count },
    dailyVisits: Array.from({ length: 14 }, (_, i) => {
      const date = new Date(start + i * day + 7 * 3600000)
        .toISOString()
        .slice(0, 10);
      return {
        date,
        count: daily.find((entry) => entry.date === date)?.count ?? 0,
      };
    }),
    channels: (["web", "telegram"] as const).map((channel) => ({
      channel,
      count: channels.find((entry) => entry.channel === channel)?.count ?? 0,
    })),
    recentVisits: recent.map((row) => ({
      ...toVisit(row),
      outlet: row.outlet,
      member: row.salesForce,
    })),
  });
}
