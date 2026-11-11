import {
  webOperationDeadline,
  webOperationIdSchema,
} from "@sales-visit/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { webAdminGuard } from "./identity.ts";
import { hashToken, sessionAccount, type WebEnv } from "./web-auth.ts";

// Keep in sync with schema FKs; FK constraints remain the final authority.
export const masterReferences = [
  ["users", "sales_force_id", "account"],
  ["sales_force_supervisors", "sales_force_id", "assignment"],
  ["supervisor_assignment_audit", "sales_force_id", "assignment_history"],
  ["visit_schedules", "sales_force_id", "schedule"],
  ["visits", "sales_force_id", "visit"],
  ["stock_reports", "reporter_sales_force_id", "stock_report"],
  ["telegram_visit_drafts", "sales_force_id", "telegram_draft"],
] as const;
const referenceProjection = masterReferences
  .map(
    ([table, column, reason]) =>
      `EXISTS (SELECT 1 FROM ${table} WHERE ${column} = sf.id) AS ${reason}`
  )
  .join(", ");
const clean = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  value.trim() === value &&
  !/[\p{Cc}\p{Cf}]/u.test(value);
const denied = async (request: Request, db: D1Database) =>
  (await sessionAccount(request, db)) ? (403 as const) : (401 as const);
// Dedicated protocol: never use the access_audit account-operation receipt.
const range = (id: string) => [id + ":", id + ";"];
const windowMs = 30000;
const writeGuard = `${webAdminGuard} AND unixepoch('subsec') * 1000 < ?
  AND ? <= unixepoch('subsec') * 1000 + ${windowMs}
  AND NOT EXISTS (SELECT 1 FROM sales_force_master_audit WHERE id > ? AND id < ?)`;

export function salesForceManagementRoutes() {
  const app = new Hono<WebEnv>();
  app.use("*", async (c, next) => {
    const account = await sessionAccount(c.req.raw, c.env.DB);
    if (!account) return c.json({ error: "Unauthorized" }, 401);
    if (account.role !== "admin") return c.json({ error: "Forbidden" }, 403);
    c.set("account", account);
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
      WHEN EXISTS (SELECT 1 FROM sales_force_master_audit WHERE id > ? AND id < ?) THEN 'committed'
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
  app.get("/", async (c) => {
    const after = c.req.query("after") ?? "";
    const q = c.req.query("q") ?? "";
    const limit = c.req.query("limit") ?? "25";
    if (
      c.req.url.length > 16384 ||
      q.length > 200 ||
      !/^\d{1,3}$/.test(limit) ||
      +limit < 1 ||
      +limit > 100
    )
      return c.json({ error: "Invalid request" }, 400);
    const hash = await hashToken(c.req.header("Authorization")!.slice(7));
    const [permission, rows] = await c.env.DB.batch<
      Record<string, string | number | null>
    >([
      c.env.DB.prepare(`SELECT 1 WHERE ${webAdminGuard}`).bind(hash),
      c.env.DB.prepare(`SELECT sf.id, sf.name, sf.created_at AS createdAt, ${referenceProjection},
        (SELECT group_concat(status, ', ') FROM users WHERE sales_force_id = sf.id) AS accountStatus,
        (SELECT supervisor_user_id FROM sales_force_supervisors WHERE sales_force_id = sf.id) AS supervisorUserId
        FROM sales_force sf WHERE (? = '' OR sf.id > ?) AND
        (? = '' OR instr(lower(sf.id), lower(?)) > 0 OR instr(lower(sf.name), lower(?)) > 0)
        AND ${webAdminGuard} ORDER BY sf.id LIMIT ?`).bind(
        after,
        after,
        q,
        q,
        q,
        hash,
        +limit + 1
      ),
    ]);
    if (!permission!.results.length)
      return c.json(
        { error: "Access denied" },
        await denied(c.req.raw, c.env.DB)
      );
    const items = rows!.results.slice(0, +limit).map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      accountStatus: row.accountStatus,
      supervisorUserId: row.supervisorUserId,
      references: masterReferences
        .filter(([, , reason]) => row[reason])
        .map(([, , reason]) => reason),
    }));
    return c.json({
      items,
      next: rows!.results.length > +limit ? items.at(-1)!.id : null,
    });
  });
  for (const action of ["create", "rename", "delete"] as const) {
    app.post("/" + action, async (c) => {
      let input: Record<string, unknown>;
      try {
        input = await c.req.json();
      } catch {
        return c.json({ error: "Invalid request" }, 400);
      }
      const keys = [
        "id",
        "operationId",
        ...(action !== "delete" ? ["name"] : []),
        ...(action === "rename" ? ["expectedName"] : []),
      ];
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).length !== keys.length ||
        Object.keys(input).some((k) => !keys.includes(k)) ||
        typeof input.id !== "string" ||
        !input.id.length ||
        !webOperationIdSchema.safeParse(input.operationId).success ||
        (action === "create" && !clean(input.id, 128)) ||
        (action !== "delete" && !clean(input.name, 200)) ||
        (action === "rename" && typeof input.expectedName !== "string")
      )
        return c.json({ error: "Invalid identifier or name" }, 400);
      // Only CREATE applies modern ID rules. Legacy target IDs and names stay exact.
      const id = input.id,
        name = action === "delete" ? null : (input.name as string);
      const operationId = input.operationId as string;
      const eventId = operationId + ":" + crypto.randomUUID();
      const hash = await hashToken(c.req.header("Authorization")!.slice(7));
      const db = c.env.DB;
      const guardBindings = [
        hash,
        webOperationDeadline(operationId),
        webOperationDeadline(operationId),
        ...range(operationId),
      ];
      const audit =
        action === "create"
          ? db
              .prepare(`INSERT INTO sales_force_master_audit(id,actor_user_id,sales_force_id,action,previous_name,new_name)
          SELECT ?, (SELECT user_id FROM web_sessions WHERE token_hash = ?), ?, 'create', NULL, ?
          WHERE ${writeGuard} AND NOT EXISTS (SELECT 1 FROM sales_force WHERE id = ?)`)
              .bind(eventId, hash, id, name, ...guardBindings, id)
          : db
              .prepare(`INSERT INTO sales_force_master_audit(id,actor_user_id,sales_force_id,action,previous_name,new_name)
          SELECT ?, (SELECT user_id FROM web_sessions WHERE token_hash = ?), id, ?, name, ? FROM sales_force
          WHERE id = ? AND ${writeGuard} ${action === "rename" ? "AND name = ? AND name <> ?" : ""}`)
              .bind(
                eventId,
                hash,
                action,
                name,
                id,
                ...guardBindings,
                ...(action === "rename" ? [input.expectedName, name] : [])
              );
      const mutation =
        action === "create"
          ? db
              .prepare(
                `INSERT INTO sales_force(id,name) SELECT sales_force_id,new_name FROM sales_force_master_audit WHERE id = ?`
              )
              .bind(eventId)
          : action === "rename"
            ? db
                .prepare(
                  `UPDATE sales_force SET name = ? WHERE id = ? AND EXISTS (SELECT 1 FROM sales_force_master_audit WHERE id = ?)`
                )
                .bind(name, id, eventId)
            : db
                .prepare(
                  `DELETE FROM sales_force WHERE id = ? AND EXISTS (SELECT 1 FROM sales_force_master_audit WHERE id = ?)`
                )
                .bind(id, eventId);
      try {
        const [permission, found, , changed] = await db.batch<{ name: string }>(
          [
            db.prepare(`SELECT 1 WHERE ${webAdminGuard}`).bind(hash),
            db
              .prepare(
                `SELECT name FROM sales_force WHERE id = ? AND ${webAdminGuard}`
              )
              .bind(id, hash),
            audit,
            mutation,
          ]
        );
        if (!permission!.results.length)
          return c.json(
            { error: "Access denied" },
            await denied(c.req.raw, db)
          );
        if (action === "create" && found!.results.length)
          return c.json({ error: "duplicate_id" }, 409);
        if (action !== "create" && !found!.results.length)
          return c.json({ error: "not_found" }, 404);
        if (!changed!.meta.changes) {
          if (
            action === "rename" &&
            found!.results[0]?.name === name &&
            input.expectedName === name
          )
            return c.json({ ok: true, changed: false });
          return c.json({ error: "conflict" }, 409);
        }
        return c.json(
          { ok: true, changed: true },
          action === "create" ? 201 : 200
        );
      } catch (error) {
        // D1 batches roll back the audit when a restrictive FK rejects DELETE.
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
