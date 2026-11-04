import { createDb } from "@sales-visit/db";
import { Hono } from "hono";

import { toStockReport, toVisit } from "./records.ts";

const app = new Hono<{ Bindings: CloudflareBindings }>();

// Liveness only: database readiness is exercised by the read endpoints.
app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/sales-force", async (c) => {
  const rows = await createDb(c.env.DB).query.salesForce.findMany({
    columns: { id: true, name: true },
    orderBy: (table, { asc }) => [asc(table.id)],
  });
  return c.json(rows);
});

app.get("/outlets", async (c) => {
  const rows = await createDb(c.env.DB).query.outlets.findMany({
    columns: { id: true, name: true },
    orderBy: (table, { asc }) => [asc(table.id)],
  });
  return c.json(rows);
});

app.get("/products", async (c) => {
  const rows = await createDb(c.env.DB).query.products.findMany({
    columns: { id: true, name: true },
    orderBy: (table, { asc }) => [asc(table.id)],
  });
  return c.json(rows);
});

app.get("/visits", async (c) => {
  const rows = await createDb(c.env.DB).query.visits.findMany({
    orderBy: (table, { desc, asc }) => [desc(table.visitedAt), asc(table.id)],
  });
  return c.json(rows.map(toVisit));
});

app.get("/visits/:id", async (c) => {
  const id = c.req.param("id");
  const row = await createDb(c.env.DB).query.visits.findFirst({
    where: (table, { eq }) => eq(table.id, id),
    with: {
      stockReports: {
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
    orderBy: (table, { desc, asc }) => [desc(table.reportedAt), asc(table.id)],
    with: { items: { orderBy: (table, { asc }) => [asc(table.productId)] } },
  });
  return c.json(rows.map(toStockReport));
});

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((_error, c) => c.json({ error: "Service unavailable" }, 503));

export default app;
