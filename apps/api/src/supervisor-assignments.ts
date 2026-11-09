import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { hashToken, sessionAccount, type WebEnv } from "./web-auth.ts";

const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 256 &&
  value.trim().length > 0 &&
  ![...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
  );

// A live Web session and active Admin are rechecked inside each D1 batch.
const adminGuard = `EXISTS (SELECT 1 FROM web_sessions session JOIN users actor ON actor.id = session.user_id
  WHERE session.token_hash = ? AND session.revoked_at IS NULL AND session.expires_at > ?
    AND actor.status = 'active' AND actor.role = 'admin')`;
const assignmentFields = `sf.id AS salesForceId, sf.name AS salesForceName,
  assignment.supervisor_user_id AS supervisorUserId,
  coalesce(identity.first_name, supervisor.id) AS supervisorName,
  supervisor.status AS supervisorStatus, supervisor.role AS supervisorRole`;
const assignmentFrom = `FROM sales_force sf
  LEFT JOIN sales_force_supervisors assignment ON assignment.sales_force_id = sf.id
  LEFT JOIN users supervisor ON supervisor.id = assignment.supervisor_user_id
  LEFT JOIN telegram_identities identity ON identity.user_id = supervisor.id`;

export function supervisorAssignmentRoutes() {
  const app = new Hono<WebEnv>();
  for (const path of [
    "/supervisors",
    "/supervisor-assignments",
    "/sales-force/:id/supervisor",
  ]) {
    app.use(path, async (c, next) => {
      const account = await sessionAccount(c.req.raw, c.env.DB);
      if (!account) return c.json({ error: "Unauthorized" }, 401);
      if (account.role !== "admin") return c.json({ error: "Forbidden" }, 403);
      c.set("account", account);
      await next();
    });
    app.use(
      path,
      bodyLimit({
        maxSize: 2048,
        onError: (c) => c.json({ error: "Invalid request" }, 400),
      })
    );
  }

  app.get("/supervisors", async (c) => {
    const after = c.req.query("after") ?? "";
    if (after && !validId(after))
      return c.json({ error: "Invalid request" }, 400);
    const hash = await hashToken(c.req.header("Authorization")!.slice(7));
    const now = Date.now();
    const [permission, rows] = await c.env.DB.batch([
      c.env.DB.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(hash, now),
      c.env.DB.prepare(`SELECT u.id, coalesce(t.first_name, u.id) AS name FROM users u
        LEFT JOIN telegram_identities t ON t.user_id = u.id
        WHERE u.status = 'active' AND u.role = 'supervisor' AND u.id > ? AND ${adminGuard}
        ORDER BY u.id LIMIT 101`).bind(after, hash, now),
    ]);
    if (!permission!.results.length) return c.json({ error: "Forbidden" }, 403);
    // SQL projection above contains exactly these fields.
    const items = rows!.results.slice(0, 100) as { id: string; name: string }[];
    return c.json({
      items,
      next: rows!.results.length > 100 ? items.at(-1)!.id : null,
    });
  });

  app.get("/supervisor-assignments", async (c) => {
    const after = c.req.query("after") ?? "";
    const limit = c.req.query("limit") ?? "50";
    if (
      (after && !validId(after)) ||
      !/^\d{1,3}$/.test(limit) ||
      Number(limit) < 1 ||
      Number(limit) > 100
    )
      return c.json({ error: "Invalid request" }, 400);
    const hash = await hashToken(c.req.header("Authorization")!.slice(7));
    const now = Date.now();
    const [permission, rows] = await c.env.DB.batch([
      c.env.DB.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(hash, now),
      c.env.DB.prepare(`SELECT ${assignmentFields} ${assignmentFrom}
        WHERE sf.id > ? AND ${adminGuard} ORDER BY sf.id LIMIT ?`).bind(
        after,
        hash,
        now,
        Number(limit) + 1
      ),
    ]);
    if (!permission!.results.length) return c.json({ error: "Forbidden" }, 403);
    // SQL aliases in assignmentFields define this response shape.
    const items = rows!.results.slice(0, Number(limit)) as {
      salesForceId: string;
      salesForceName: string;
      supervisorUserId: string | null;
      supervisorName: string | null;
      supervisorStatus: string | null;
      supervisorRole: string | null;
    }[];
    return c.json({
      items,
      next:
        rows!.results.length > Number(limit)
          ? items.at(-1)!.salesForceId
          : null,
    });
  });

  app.put("/sales-force/:id/supervisor", async (c) => {
    const id = c.req.param("id");
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request" }, 400);
    }
    if (
      !validId(id) ||
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !("supervisorUserId" in input) ||
      (input.supervisorUserId !== null && !validId(input.supervisorUserId))
    )
      return c.json({ error: "Invalid request" }, 400);
    const target = input.supervisorUserId as string | null;
    const eventId = crypto.randomUUID();
    const hash = await hashToken(c.req.header("Authorization")!.slice(7));
    const now = Date.now();
    const db = c.env.DB;
    // Serialized last-committed-writer policy: each event records the actual
    // predecessor in this transaction, not a stale UI/preflight value.
    const [permission, found, eligible, , , , rows] = await db.batch([
      db.prepare(`SELECT 1 WHERE ${adminGuard}`).bind(hash, now),
      db
        .prepare(`SELECT 1 FROM sales_force WHERE id = ? AND ${adminGuard}`)
        .bind(id, hash, now),
      db
        .prepare(
          `SELECT 1 WHERE (? IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active' AND role = 'supervisor')) AND ${adminGuard}`
        )
        .bind(target, target, hash, now),
      db
        .prepare(`INSERT INTO supervisor_assignment_audit (id, actor_user_id, sales_force_id, previous_supervisor_user_id, new_supervisor_user_id, action)
        SELECT ?, ?, sf.id, a.supervisor_user_id, ?,
          CASE WHEN ? IS NULL THEN 'unassign' WHEN a.supervisor_user_id IS NULL THEN 'assign' ELSE 'reassign' END
        FROM sales_force sf LEFT JOIN sales_force_supervisors a ON a.sales_force_id = sf.id
        WHERE sf.id = ? AND ${adminGuard}
          AND (? IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active' AND role = 'supervisor'))
          AND a.supervisor_user_id IS NOT ?`)
        .bind(
          eventId,
          c.get("account").id,
          target,
          target,
          id,
          hash,
          now,
          target,
          target,
          target
        ),
      db
        .prepare(`DELETE FROM sales_force_supervisors WHERE sales_force_id = ?
        AND EXISTS (SELECT 1 FROM supervisor_assignment_audit WHERE id = ? AND new_supervisor_user_id IS NULL)`)
        .bind(id, eventId),
      db
        .prepare(`INSERT INTO sales_force_supervisors (sales_force_id, supervisor_user_id)
        SELECT sales_force_id, new_supervisor_user_id FROM supervisor_assignment_audit WHERE id = ? AND new_supervisor_user_id IS NOT NULL
        ON CONFLICT(sales_force_id) DO UPDATE SET supervisor_user_id = excluded.supervisor_user_id, updated_at = unixepoch() * 1000`)
        .bind(eventId),
      db
        .prepare(
          `SELECT ${assignmentFields} ${assignmentFrom} WHERE sf.id = ? AND ${adminGuard}`
        )
        .bind(id, hash, now),
    ]);
    if (!permission!.results.length) return c.json({ error: "Forbidden" }, 403);
    if (!found!.results.length)
      return c.json({ error: "Sales Force not found" }, 404);
    if (!eligible!.results.length)
      return c.json({ error: "Supervisor unavailable" }, 400);
    return c.json(rows!.results[0]);
  });
  return app;
}
