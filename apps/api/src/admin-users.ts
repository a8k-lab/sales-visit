import {
  webUserRoleSchema,
  webOperationIdSchema,
  webOperationDeadline,
  type WebOperationOutcome,
  webUserTargetSchema,
  type ManagedAccount,
} from "@sales-visit/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { operationRange, operationWindowMs } from "./admin-operation.ts";
import { accountQuery, IdentityOperations, webAdminGuard } from "./identity.ts";
import { hashToken, sessionAccount, type WebEnv } from "./web-auth.ts";

// A failed in-transaction guard may mean logout, expiry, disabling, or demotion
// since middleware. Reclassify without disclosing target records.
const denied = async (request: Request, db: D1Database) =>
  (await sessionAccount(request, db)) ? (403 as const) : (401 as const);

export function adminUserRoutes() {
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

  // A primary read after the cutoff fences out a delayed POST: either its
  // serialized batch already committed an audit, or its write guard must fail.
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
      operationId: `web:${row.now + operationWindowMs}:${crypto.randomUUID()}`,
    });
  });
  app.get("/operations/:operationId", async (c) => {
    const parsed = webOperationIdSchema.safeParse(c.req.param("operationId"));
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    const hash = await hashToken(c.req.header("Authorization")!.slice(7));
    // One primary statement observes both the audit and database clock. Never
    // infer non-commit from a possibly stale replica or a pre-request timestamp.
    const outcome = await c.env.DB.withSession("first-primary")
      .prepare(`SELECT CASE
      WHEN EXISTS (SELECT 1 FROM access_audit WHERE id > ? AND id < ?) THEN 'committed'
      WHEN unixepoch('subsec') * 1000 >= ? THEN 'not_committed'
      ELSE 'pending' END AS status WHERE ${webAdminGuard}`)
      .bind(
        ...operationRange(parsed.data),
        webOperationDeadline(parsed.data),
        hash
      )
      .first<WebOperationOutcome>();
    if (!outcome)
      return c.json(
        { error: "Access denied" },
        await denied(c.req.raw, c.env.DB)
      );
    return c.json(outcome);
  });

  app.get("/sales-force-options", async (c) => {
    const after = c.req.query("after") ?? "";
    if (after.length > 256) return c.json({ error: "Invalid request" }, 400);
    const hash = await hashToken(c.req.header("Authorization")!.slice(7));
    const [permission, rows] = await c.env.DB.batch([
      c.env.DB.prepare(`SELECT 1 WHERE ${webAdminGuard}`).bind(hash),
      c.env.DB.prepare(`SELECT sf.id, sf.name FROM sales_force sf
        WHERE sf.id > ? AND NOT EXISTS (SELECT 1 FROM users u WHERE u.sales_force_id = sf.id)
        AND ${webAdminGuard} ORDER BY sf.id LIMIT 51`).bind(after, hash),
    ]);
    if (!permission!.results.length)
      return c.json(
        { error: "Access denied" },
        await denied(c.req.raw, c.env.DB)
      );
    const items = rows!.results.slice(0, 50) as { id: string; name: string }[];
    return c.json({
      items,
      next: rows!.results.length > 50 ? items.at(-1)!.id : null,
    });
  });

  app.get("/", async (c) => {
    const after = c.req.query("after") ?? "";
    const status = c.req.query("status") ?? "";
    const limit = c.req.query("limit") ?? "50";
    if (
      after.length > 256 ||
      !["", "pending", "active", "rejected", "disabled"].includes(status) ||
      !/^\d{1,3}$/.test(limit) ||
      Number(limit) < 1 ||
      Number(limit) > 100
    )
      return c.json({ error: "Invalid request" }, 400);
    const hash = await hashToken(c.req.header("Authorization")!.slice(7));
    const [permission, rows] = await c.env.DB.batch([
      c.env.DB.prepare(`SELECT 1 WHERE ${webAdminGuard}`).bind(hash),
      c.env.DB.prepare(`SELECT accounts.*, sf.name AS salesForceName FROM (${accountQuery}) accounts
        LEFT JOIN sales_force sf ON sf.id = accounts.salesForceId
        WHERE accounts.id > ? AND (? = '' OR accounts.status = ?) AND ${webAdminGuard}
        ORDER BY accounts.id LIMIT ?`).bind(
        after,
        status,
        status,
        hash,
        Number(limit) + 1
      ),
    ]);
    if (!permission!.results.length)
      return c.json(
        { error: "Access denied" },
        await denied(c.req.raw, c.env.DB)
      );
    // SAFETY: Projection is Account plus the optional business record name; D1 cannot infer SQL aliases.
    const items = rows!.results.slice(
      0,
      Number(limit)
    ) as unknown as ManagedAccount[];
    return c.json({
      items,
      next: rows!.results.length > Number(limit) ? items.at(-1)!.id : null,
    });
  });

  // Current account state is informational, not proof of a mutation's outcome.
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!id || id.length > 256)
      return c.json({ error: "Invalid request" }, 400);
    const hash = await hashToken(c.req.header("Authorization")!.slice(7));
    const [permission, rows] = await c.env.DB.batch([
      c.env.DB.prepare(`SELECT 1 WHERE ${webAdminGuard}`).bind(hash),
      c.env.DB.prepare(
        `${accountQuery} WHERE u.id = ? AND ${webAdminGuard}`
      ).bind(id, hash),
    ]);
    if (!permission!.results.length)
      return c.json(
        { error: "Access denied" },
        await denied(c.req.raw, c.env.DB)
      );
    if (!rows!.results.length) return c.json({ error: "User not found" }, 404);
    return c.json(rows!.results[0]);
  });

  for (const action of [
    "approve",
    "reject",
    "role",
    "disable",
    "enable",
  ] as const) {
    app.post("/" + action, async (c) => {
      let input: unknown;
      try {
        input = await c.req.json();
      } catch {
        return c.json({ error: "Invalid request" }, 400);
      }
      const isRole = action === "approve" || action === "role";
      const parsed = (
        isRole ? webUserRoleSchema : webUserTargetSchema
      ).safeParse(input);
      if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
      const data = parsed.data;
      const roleInput = isRole ? webUserRoleSchema.parse(input) : null;
      const hash = await hashToken(c.req.header("Authorization")!.slice(7));
      const result = await new IdentityOperations(c.env.DB).webMutation(
        hash,
        data.userId,
        action === "role" ? "setrole" : action,
        roleInput?.role ?? null,
        roleInput?.salesForceId ?? null,
        data.operationId
      );
      if (result.ok) return c.json(result.data);
      if (result.code === "forbidden")
        return c.json(
          { error: "Access denied" },
          await denied(c.req.raw, c.env.DB)
        );
      return c.json(
        { error: result.code },
        result.code === "not_found"
          ? 404
          : result.code === "invalid"
            ? 400
            : 409
      );
    });
  }
  return app;
}
