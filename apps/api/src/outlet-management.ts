import {
  outletDetailSchema,
  planningIdSchema,
  webCreateOutletSchema,
  webUpdateOutletSchema,
  webDeleteOutletSchema,
  webOperationDeadline,
  webOperationIdSchema,
} from "@sales-visit/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { webAdminGuard } from "./identity.ts";
import { reportableOutletTimestamps, unreferencedOutlet } from "./outlets.ts";
import { hashToken, sessionAccount, type WebEnv } from "./web-auth.ts";

export const outletReferences = [
  ["visits", "outlet_id", "visit"],
  ["stock_reports", "outlet_id", "stock_report"],
  ["visit_schedules", "outlet_id", "schedule"],
] as const;
const projection = outletReferences
  .map(
    ([table, column, reason]) =>
      `EXISTS (SELECT 1 FROM ${table} WHERE ${column} = outlets.id) AS ${reason}`
  )
  .join(", ");
const fields =
  "id, name, business_id AS businessId, no_rs AS noRs, created_at AS createdAt, updated_at AS updatedAt";
const state =
  "json_object('businessId', business_id, 'name', name, 'noRs', no_rs)";
// Dedicated Outlet receipts: never resolve against account or Sales Force audit.
const range = (id: string) => [id + ":", id + ";"];
const windowMs = 30000;
const writeGuard = `${webAdminGuard} AND unixepoch('subsec') * 1000 < ?
  AND ? <= unixepoch('subsec') * 1000 + ${windowMs}
  AND NOT EXISTS (SELECT 1 FROM outlet_master_audit WHERE id > ? AND id < ?)`;
const denied = async (request: Request, db: D1Database) =>
  (await sessionAccount(request, db)) ? (403 as const) : (401 as const);

export function outletManagementRoutes() {
  const app = new Hono<WebEnv>();
  app.use("*", async (c, next) => {
    const account = await sessionAccount(c.req.raw, c.env.DB);
    if (!account) return c.json({ error: "Unauthorized" }, 401);
    if (account.role !== "admin") return c.json({ error: "Forbidden" }, 403);
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 16384,
      onError: (c) => c.json({ error: "Invalid request" }, 400),
    })
  );
  app.get("/operations/new", async (c) => {
    const hash = await hashToken(c.req.header("Authorization")!.slice(7));
    const row = await c.env.DB.withSession("first-primary")
      .prepare(
        `SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now WHERE ${webAdminGuard}`
      )
      .bind(hash)
      .first<{ now: number }>();
    if (!row)
      return c.json(
        { error: "Access denied" },
        await denied(c.req.raw, c.env.DB)
      );
    return c.json({
      operationId: `web:${row.now + windowMs}:${crypto.randomUUID()}`,
    });
  });
  app.get("/operations/:operationId", async (c) => {
    const parsed = webOperationIdSchema.safeParse(c.req.param("operationId"));
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    const hash = await hashToken(c.req.header("Authorization")!.slice(7));
    const row = await c.env.DB.withSession("first-primary")
      .prepare(`SELECT CASE
      WHEN EXISTS (SELECT 1 FROM outlet_master_audit WHERE id > ? AND id < ?) THEN 'committed'
      WHEN unixepoch('subsec') * 1000 >= ? THEN 'not_committed' ELSE 'pending' END AS status
      WHERE ${webAdminGuard}`)
      .bind(...range(parsed.data), webOperationDeadline(parsed.data), hash)
      .first();
    if (!row)
      return c.json(
        { error: "Access denied" },
        await denied(c.req.raw, c.env.DB)
      );
    return c.json(row);
  });
  app.get("/detail", async (c) => {
    const parsed = planningIdSchema.safeParse(c.req.query("id"));
    if (!parsed.success || c.req.url.length > 16384)
      return c.json({ error: "Invalid request" }, 400);
    const hash = await hashToken(c.req.header("Authorization")!.slice(7));
    const [permission, rows] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(`SELECT 1 WHERE ${webAdminGuard}`).bind(hash),
      c.env.DB.prepare(
        `SELECT ${fields}, ${projection} FROM outlets WHERE id = ? AND ${webAdminGuard}`
      ).bind(parsed.data, hash),
    ]);
    if (!permission!.results.length)
      return c.json(
        { error: "Access denied" },
        await denied(c.req.raw, c.env.DB)
      );
    const row = rows!.results[0];
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({
      ...outletDetailSchema.parse(row),
      references: outletReferences
        .filter(([, , reason]) => row[reason])
        .map(([, , reason]) => reason),
    });
  });
  for (const action of ["create", "update", "delete"] as const) {
    app.post("/" + action, async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: "Invalid request" }, 400);
      }
      const schema = {
        create: webCreateOutletSchema,
        update: webUpdateOutletSchema,
        delete: webDeleteOutletSchema,
      }[action];
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return c.json({ error: "Invalid Outlet" }, 400);
      const input = parsed.data;
      const id = "id" in input ? input.id : crypto.randomUUID();
      const name = "name" in input ? input.name : null;
      const noRs = "noRs" in input ? (input.noRs ?? null) : null;
      const businessId = "businessId" in input ? input.businessId : null;
      const expected =
        "expectedName" in input && "expectedNoRs" in input
          ? [input.expectedName, input.expectedNoRs]
          : [];
      const eventId = input.operationId + ":" + crypto.randomUUID();
      const hash = await hashToken(c.req.header("Authorization")!.slice(7));
      const db = c.env.DB;
      const bindings = [
        hash,
        webOperationDeadline(input.operationId),
        webOperationDeadline(input.operationId),
        ...range(input.operationId),
      ];
      const after = JSON.stringify({ businessId, name, noRs });
      const audit =
        action === "create"
          ? db
              .prepare(`INSERT INTO outlet_master_audit(id,actor_user_id,outlet_id,action,"before","after")
            SELECT ?, (SELECT user_id FROM web_sessions WHERE token_hash = ?), ?, 'create', NULL, ?
            WHERE ${writeGuard} AND NOT EXISTS (SELECT 1 FROM outlets WHERE business_id = ?)`)
              .bind(eventId, hash, id, after, ...bindings, businessId)
          : db
              .prepare(`INSERT INTO outlet_master_audit(id,actor_user_id,outlet_id,action,"before","after")
            SELECT ?, (SELECT user_id FROM web_sessions WHERE token_hash = ?), id, ?, ${state},
            ${action === "update" ? "json_object('businessId', business_id, 'name', ?, 'noRs', COALESCE(?, no_rs))" : "NULL"}
            FROM outlets WHERE id = ? AND ${writeGuard} AND ${reportableOutletTimestamps}
            ${action === "update" ? "AND name = ? AND no_rs IS ? AND (name <> ? OR no_rs IS NOT COALESCE(?, no_rs))" : `AND ${unreferencedOutlet}`}`)
              .bind(
                eventId,
                hash,
                action,
                ...(action === "update" ? [name, noRs] : []),
                id,
                ...bindings,
                ...(action === "update" ? [...expected, name, noRs] : [])
              );
      const mutation =
        action === "create"
          ? db
              .prepare(
                `INSERT INTO outlets(id,business_id,name,no_rs,updated_at) SELECT outlet_id,json_extract("after", '$.businessId'),json_extract("after", '$.name'),json_extract("after", '$.noRs'),unixepoch() * 1000 FROM outlet_master_audit WHERE id = ?`
              )
              .bind(eventId)
          : action === "update"
            ? db
                .prepare(
                  `UPDATE outlets SET name = ?, no_rs = COALESCE(?, no_rs), updated_at = unixepoch() * 1000 WHERE id = ? AND EXISTS (SELECT 1 FROM outlet_master_audit WHERE id = ?)`
                )
                .bind(name, noRs, id, eventId)
            : db
                .prepare(
                  `DELETE FROM outlets WHERE id = ? AND EXISTS (SELECT 1 FROM outlet_master_audit WHERE id = ?)`
                )
                .bind(id, eventId);
      try {
        const [permission, found, , changed] = await db.batch<
          Record<string, unknown>
        >([
          db.prepare(`SELECT 1 WHERE ${webAdminGuard}`).bind(hash),
          db
            .prepare(
              `SELECT name, no_rs AS noRs, (${reportableOutletTimestamps}) AS reportable, (${unreferencedOutlet}) AS unreferenced FROM outlets WHERE ${action === "create" ? "business_id" : "id"} = ? AND ${webAdminGuard}`
            )
            .bind(action === "create" ? businessId : id, hash),
          audit,
          mutation,
        ]);
        if (!permission!.results.length)
          return c.json(
            { error: "Access denied" },
            await denied(c.req.raw, db)
          );
        const row = found!.results[0];
        if (action === "create" && row)
          return c.json({ error: "duplicate_business_id" }, 409);
        if (action !== "create" && !row)
          return c.json({ error: "not_found" }, 404);
        if (row && action !== "create" && !row.reportable)
          return c.json({ error: "Service unavailable" }, 503);
        if (action === "delete" && row && !row.unreferenced)
          return c.json({ error: "referenced_record" }, 409);
        if (!changed!.meta.changes) {
          if (
            action === "update" &&
            row?.name === name &&
            row.noRs === (noRs ?? row.noRs) &&
            row.name === expected[0] &&
            row.noRs === expected[1]
          )
            return c.json({ ok: true, changed: false });
          return c.json({ error: "conflict" }, 409);
        }
        return c.json(
          { ok: true, changed: true },
          action === "create" ? 201 : 200
        );
      } catch (error) {
        if (
          action === "delete" &&
          /FOREIGN KEY constraint failed/i.test(String(error))
        )
          return c.json({ error: "referenced_record" }, 409);
        throw error;
      }
    });
  }
  return app;
}
