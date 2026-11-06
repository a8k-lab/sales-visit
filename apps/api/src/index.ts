import { createDb } from "@sales-visit/db";
import { Hono, type Context } from "hono";

const page = (c: Context<WebEnv>) => ({
  limit: Number(c.req.query("limit") ?? 100),
  offset: Number(c.req.query("offset") ?? 0),
});
import type { JWTVerifyGetKey } from "jose";

import {
  createVisit,
  createStockReport,
  OperationError,
  type TrustedIdentity,
} from "./operations.ts";
import { toStockReport, toVisit } from "./records.ts";
import { authRoutes, sessionAccount, type WebEnv } from "./web-auth.ts";

// No header, secret, environment switch, or development bypass supplies identity.
// Tests explicitly inject a resolver in-process; the deployed default denies writes.
export function createApp(
  resolveIdentity: (
    request: Request,
    env: ApiBindings
  ) => Promise<TrustedIdentity | undefined> = async () => undefined,
  telegramKeys?: JWTVerifyGetKey
) {
  const app = new Hono<WebEnv>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const origin = c.req.header("Origin");
    const allowed = (c.env.WEB_ORIGINS ?? "").split(",").filter(Boolean);
    if (origin) {
      c.header("Vary", "Origin");
      if (!allowed.includes(origin))
        return c.json({ error: "Origin denied" }, 403);
      c.header("Access-Control-Allow-Origin", origin);
      if (c.req.method === "OPTIONS") {
        const method = c.req.header("Access-Control-Request-Method");
        const headers = (c.req.header("Access-Control-Request-Headers") ?? "")
          .toLowerCase()
          .split(",")
          .map((h) => h.trim())
          .filter(Boolean);
        if (
          !method ||
          !["GET", "POST"].includes(method) ||
          headers.some((h) => !["authorization", "content-type"].includes(h))
        )
          return c.json({ error: "Invalid preflight" }, 403);
        c.header("Access-Control-Allow-Methods", "GET, POST");
        c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
        return c.body(null, 204);
      }
    }
    await next();
  });
  app.route("/auth", authRoutes(telegramKeys));

  for (const [path, operation] of [
    ["/visits", createVisit],
    ["/stock-reports", createStockReport],
  ] as const) {
    app.post(path, async (c) => {
      try {
        const identity = await resolveIdentity(c.req.raw, c.env);
        if (!identity) return c.json({ error: "Unauthorized" }, 401);
        let input: unknown;
        try {
          input = await c.req.json();
        } catch {
          return c.json({ error: "Invalid request" }, 400);
        }
        const result = await operation(
          createDb(c.env.DB),
          identity,
          c.req.header("Idempotency-Key"),
          input
        );
        return c.json(result.data, result.replayed ? 200 : 201);
      } catch (error) {
        if (error instanceof OperationError)
          return c.json({ error: error.message }, error.status);
        return c.json({ error: "Internal server error" }, 500);
      }
    });
  }

  // Liveness only: database readiness is exercised by the read endpoints.
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.use("*", async (c, next) => {
    if (
      !["GET", "HEAD"].includes(c.req.method) ||
      !/^\/(sales-force|outlets|products|visits|stock-reports)(\/|$)/.test(
        c.req.path
      )
    )
      return next();
    const account = await sessionAccount(c.req.raw, c.env.DB);
    if (!account) return c.json({ error: "Unauthorized" }, 401);
    c.set("account", account);
    if (
      account.role === "sales_force" &&
      (c.req.path === "/sales-force" ||
        ["salesForceId", "reporterSalesForceId"].some((key) =>
          c.req.queries(key)?.some((value) => value !== account.salesForceId)
        ))
    )
      return c.json({ error: "Forbidden" }, 403);
    for (const [key, max] of [
      ["limit", 100],
      ["offset", 100000],
    ] as const) {
      const value = c.req.query(key);
      if (
        value !== undefined &&
        (!/^\d{1,6}$/.test(value) ||
          Number(value) > max ||
          (key === "limit" && Number(value) < 1))
      )
        return c.json({ error: "Invalid request" }, 400);
    }
    await next();
  });
  app.get("/sales-force", async (c) => {
    const rows = await createDb(c.env.DB).query.salesForce.findMany({
      ...page(c),
      columns: { id: true, name: true },
      orderBy: (table, { asc }) => [asc(table.id)],
    });
    return c.json(rows);
  });

  app.get("/outlets", async (c) => {
    const rows = await createDb(c.env.DB).query.outlets.findMany({
      ...page(c),
      columns: { id: true, name: true },
      orderBy: (table, { asc }) => [asc(table.id)],
    });
    return c.json(rows);
  });

  app.get("/products", async (c) => {
    const rows = await createDb(c.env.DB).query.products.findMany({
      ...page(c),
      columns: { id: true, name: true },
      orderBy: (table, { asc }) => [asc(table.id)],
    });
    return c.json(rows);
  });

  app.get("/visits", async (c) => {
    const rows = await createDb(c.env.DB).query.visits.findMany({
      ...page(c),
      where: (table, { eq }) =>
        c.get("account").role === "sales_force"
          ? eq(table.salesForceId, c.get("account").salesForceId!)
          : undefined,
      orderBy: (table, { desc, asc }) => [desc(table.visitedAt), asc(table.id)],
    });
    return c.json(rows.map(toVisit));
  });

  app.get("/visits/:id", async (c) => {
    const id = c.req.param("id");
    const row = await createDb(c.env.DB).query.visits.findFirst({
      where: (table, { eq, and }) =>
        and(
          eq(table.id, id),
          c.get("account").role === "sales_force"
            ? eq(table.salesForceId, c.get("account").salesForceId!)
            : undefined
        ),
      with: {
        stockReports: {
          limit: 100,
          where: (table, { eq }) =>
            c.get("account").role === "sales_force"
              ? eq(table.reporterSalesForceId, c.get("account").salesForceId!)
              : undefined,
          orderBy: (table, { desc, asc }) => [
            desc(table.reportedAt),
            asc(table.id),
          ],
          with: {
            items: { orderBy: (table, { asc }) => [asc(table.productId)] },
          },
        },
      },
    });
    if (!row) return c.json({ error: "Visit not found" }, 404);
    return c.json({
      ...toVisit(row),
      stockReports: row.stockReports.map(toStockReport),
    });
  });

  app.get("/stock-reports", async (c) => {
    const rows = await createDb(c.env.DB).query.stockReports.findMany({
      ...page(c),
      where: (table, { eq }) =>
        c.get("account").role === "sales_force"
          ? eq(table.reporterSalesForceId, c.get("account").salesForceId!)
          : undefined,
      orderBy: (table, { desc, asc }) => [
        desc(table.reportedAt),
        asc(table.id),
      ],
      with: { items: { orderBy: (table, { asc }) => [asc(table.productId)] } },
    });
    return c.json(rows.map(toStockReport));
  });

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((_error, c) => c.json({ error: "Service unavailable" }, 503));

  return app;
}

export default createApp();
