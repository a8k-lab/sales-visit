import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import { IdentityOperations } from "../src/identity.ts";
import { createApp } from "../src/index.ts";
import { hashToken } from "../src/web-auth.ts";

async function setup(t) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-11-02",
      script: 'export default {fetch(){return new Response("fixture")}}',
      d1Databases: { DB: "admin-users-test" },
    })
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  const dir = new URL("../../../packages/db/migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .toSorted()) {
    const sql = readFileSync(new URL(file, dir), "utf8").replace(
      /^\s*--.*$/gm,
      ""
    );
    await db.batch(
      sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s))
    );
  }
  await db
    .prepare(
      "INSERT INTO sales_force(id,name) VALUES ('sf','Synthetic SF'),('free','Synthetic Free')"
    )
    .run();
  const tokens = {};
  let n = 100;
  const user = async (id, status = "pending", role = null, sf = null) => {
    const telegram = String(++n);
    await db
      .prepare(
        "INSERT INTO users(id,status,role,sales_force_id) VALUES (?,?,?,?)"
      )
      .bind(id, status, role, sf)
      .run();
    await db
      .prepare(
        "INSERT INTO telegram_identities(user_id,telegram_user_id,first_name,username) VALUES (?,?,?,?)"
      )
      .bind(id, telegram, `Synthetic ${id}`, id)
      .run();
    tokens[id] = n.toString(16).padStart(64, "0");
    await db
      .prepare(
        "INSERT INTO web_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)"
      )
      .bind(await hashToken(tokens[id]), id, Date.now(), Date.now() + 3600000)
      .run();
    return { telegramUserId: telegram };
  };
  const admin = await user("admin", "active", "admin");
  await user("supervisor", "active", "supervisor");
  await user("sales", "active", "sales_force", "sf");
  await user("disabled", "disabled", "admin");
  await user("pending");
  const app = createApp();
  const request = (path = "", id = "admin", init = {}, database = db) =>
    app.request(
      "/admin/users" + path,
      {
        ...init,
        headers: {
          ...(tokens[id] ? { Authorization: `Bearer ${tokens[id]}` } : {}),
          ...init.headers,
        },
      },
      { DB: database }
    );
  const mutate = (action, input, id = "admin", database = db) =>
    request(
      "/" + action,
      id,
      { method: "POST", body: JSON.stringify(input) },
      database
    );
  const count = async () =>
    (await db.prepare("SELECT count(*) AS n FROM access_audit").first()).n;
  const state = (id) =>
    db
      .prepare(
        "SELECT status,role,sales_force_id AS salesForceId FROM users WHERE id = ?"
      )
      .bind(id)
      .first();
  return { db, app, user, admin, request, mutate, count, state, tokens };
}

test("Web Admin account lifecycle on disposable migrated D1", async (t) => {
  const f = await setup(t);
  const { db, user, request, mutate, count, state, admin, app, tokens } = f;
  await t.test(
    "permissions, invalid credentials and no unauthorized identity disclosure",
    async () => {
      for (const id of ["none", "pending", "disabled"]) {
        for (const path of ["", "/pending", "/sales-force-options"])
          assert.equal((await request(path, id)).status, 401);
        assert.equal(
          (await mutate("approve", { userId: "pending", role: "admin" }, id))
            .status,
          401
        );
      }
      for (const id of ["supervisor", "sales"]) {
        for (const path of ["", "/pending", "/sales-force-options"]) {
          const response = await request(path, id);
          assert.equal(response.status, 403);
          assert.doesNotMatch(
            await response.text(),
            /Synthetic|telegramUserId/
          );
        }
        for (const action of ["approve", "reject", "role", "disable", "enable"])
          assert.equal(
            (await mutate(action, { userId: "pending", role: "admin" }, id))
              .status,
            403
          );
      }
      for (const mode of ["expired", "revoked"]) {
        await user(mode, "active", "admin");
        await db
          .prepare(
            mode === "expired"
              ? "UPDATE web_sessions SET created_at = 0, expires_at = 1 WHERE user_id = ?"
              : "UPDATE web_sessions SET revoked_at = 1 WHERE user_id = ?"
          )
          .bind(mode)
          .run();
        assert.equal((await request("", mode)).status, 401);
        assert.equal(
          (await mutate("reject", { userId: "pending" }, mode)).status,
          401
        );
      }
      assert.equal(
        (
          await request("", "admin", {
            headers: { Authorization: "Bearer invalid" },
          })
        ).status,
        401
      );
    }
  );
  await t.test(
    "approve all three roles, eligible options and Supervisor assignment acceptance",
    async () => {
      assert.deepEqual(
        (await (await request("/sales-force-options")).json()).items,
        [{ id: "free", name: "Synthetic Free" }]
      );
      for (const role of ["admin", "supervisor", "sales_force"]) {
        const id = "approve-" + role;
        await user(id);
        const response = await mutate("approve", {
          userId: id,
          role,
          ...(role === "sales_force" ? { salesForceId: "free" } : {}),
        });
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal((await response.json()).status, "active");
        assert.equal((await state(id)).role, role);
      }
      const supervisors = await app.request(
        "/supervisors",
        { headers: { Authorization: `Bearer ${tokens.admin}` } },
        { DB: db }
      );
      assert.ok(
        (await supervisors.json()).items.some(
          (u) => u.id === "approve-supervisor"
        )
      );
      assert.deepEqual(
        (await (await request("/sales-force-options")).json()).items,
        []
      );
      const audit = await db
        .prepare(
          "SELECT * FROM access_audit WHERE target_user_id = 'approve-supervisor'"
        )
        .first();
      assert.equal(audit.actor_user_id, "admin");
      assert.equal(audit.action, "approve");
      assert.deepEqual(JSON.parse(audit.before_state), {
        status: "pending",
        role: null,
        salesForceId: null,
      });
      assert.deepEqual(JSON.parse(audit.after_state), {
        status: "active",
        role: "supervisor",
        salesForceId: null,
      });
    }
  );
  await t.test(
    "strict inputs, missing/claimed/nonexistent SF, reject finality and transitions",
    async () => {
      for (const body of [
        { userId: "pending", role: "sales_force" },
        { userId: "pending", role: "sales" },
        { userId: "pending", role: "admin", actorId: "admin" },
        { telegramUserId: "105", role: "admin" },
        { userId: "pending", role: "supervisor", salesForceId: "sf" },
      ])
        assert.equal((await mutate("approve", body)).status, 400);
      for (const salesForceId of ["missing", "sf", "free"])
        assert.equal(
          (
            await mutate("approve", {
              userId: "pending",
              role: "sales_force",
              salesForceId,
            })
          ).status,
          409
        );
      assert.equal((await mutate("reject", { userId: "pending" })).status, 200);
      const before = await count();
      for (const action of ["reject", "enable", "disable", "role", "approve"])
        assert.equal(
          (
            await mutate(action, {
              userId: "pending",
              ...(["role", "approve"].includes(action)
                ? { role: "supervisor" }
                : {}),
            })
          ).status,
          409
        );
      assert.equal(await count(), before);
      assert.equal(
        (await mutate("disable", { userId: "unknown" })).status,
        404
      );
      assert.equal(
        (await request("/approve", "admin", { method: "POST", body: "{" }))
          .status,
        400
      );
      assert.equal(
        (
          await request("/approve", "admin", {
            method: "POST",
            body: "x".repeat(17000),
          })
        ).status,
        400
      );
    }
  );
  await t.test(
    "role changes, immutable associations, status idempotency and immediate access loss",
    async () => {
      await db
        .prepare(
          "INSERT INTO sales_force_supervisors(sales_force_id,supervisor_user_id) VALUES ('sf','supervisor')"
        )
        .run();
      assert.equal(
        (await mutate("role", { userId: "supervisor", role: "admin" })).status,
        200
      );
      assert.equal(
        (await mutate("role", { userId: "sales", role: "supervisor" })).status,
        200
      );
      assert.equal((await state("sales")).salesForceId, "sf");
      await db
        .prepare(
          "INSERT INTO sales_force(id,name) VALUES ('other','Synthetic Other')"
        )
        .run();
      assert.equal(
        (
          await mutate("role", {
            userId: "sales",
            role: "sales_force",
            salesForceId: "other",
          })
        ).status,
        409
      );
      assert.equal(
        (
          await mutate("role", {
            userId: "sales",
            role: "sales_force",
            salesForceId: "sf",
          })
        ).status,
        200
      );
      let before = await count();
      assert.equal(
        (
          await mutate("role", {
            userId: "sales",
            role: "sales_force",
            salesForceId: "sf",
          })
        ).status,
        200
      );
      assert.equal(await count(), before);
      assert.equal((await mutate("disable", { userId: "sales" })).status, 200);
      assert.equal(
        (
          await app.request(
            "/auth/me",
            { headers: { Authorization: `Bearer ${tokens.sales}` } },
            { DB: db }
          )
        ).status,
        401
      );
      before = await count();
      assert.equal((await mutate("disable", { userId: "sales" })).status, 200);
      assert.equal(await count(), before);
      assert.equal((await mutate("enable", { userId: "sales" })).status, 200);
      before = await count();
      assert.equal((await mutate("enable", { userId: "sales" })).status, 200);
      assert.equal(await count(), before);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT supervisor_user_id AS id FROM sales_force_supervisors WHERE sales_force_id = 'sf'"
            )
            .first()
        ).id,
        "supervisor"
      );
    }
  );
  await t.test("active Admin protection, including last Admin", async () => {
    for (const action of ["disable", "role"]) {
      const response = await mutate(action, {
        userId: "admin",
        ...(action === "role" ? { role: "supervisor" } : {}),
      });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error, "protected_admin");
    }
    await db
      .prepare(
        "UPDATE users SET status = 'disabled' WHERE role = 'admin' AND id <> 'admin'"
      )
      .run();
    const response = await mutate("disable", { userId: "admin" });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "last_admin");
  });
  await t.test(
    "stale middleware authorization is rejected inside the transaction",
    async () => {
      for (const change of [
        "UPDATE web_sessions SET revoked_at = 1 WHERE user_id = 'admin'",
        "UPDATE web_sessions SET created_at = 0, expires_at = 1 WHERE user_id = 'admin'",
        "UPDATE users SET status = 'disabled' WHERE id = 'admin'",
        "UPDATE users SET role = 'supervisor' WHERE id = 'admin'",
      ]) {
        const id = crypto.randomUUID();
        await user(id);
        const before = await count();
        const racingDB = {
          prepare: db.prepare.bind(db),
          batch: async (statements) => {
            await db.prepare(change).run();
            return db.batch(statements);
          },
        };
        const response = await mutate(
          "approve",
          { userId: id, role: "supervisor" },
          "admin",
          racingDB
        );
        assert.equal(
          response.status,
          change.includes("role = 'supervisor'") ? 403 : 401
        );
        assert.equal((await state(id)).status, "pending");
        assert.equal(await count(), before);
        await db
          .prepare(
            "UPDATE users SET status = 'active',role = 'admin' WHERE id = 'admin'"
          )
          .run();
        await db
          .prepare(
            "UPDATE web_sessions SET revoked_at = NULL, expires_at = ? WHERE user_id = 'admin'"
          )
          .bind(Date.now() + 3600000)
          .run();
      }
    }
  );
  await t.test(
    "concurrent claims/decisions and management are serialized with no duplicate audit",
    async () => {
      await user("race-a");
      await user("race-b");
      const before = await count();
      const responses = await Promise.all(
        ["race-a", "race-b"].map((userId) =>
          mutate("approve", {
            userId,
            role: "sales_force",
            salesForceId: "other",
          })
        )
      );
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      assert.equal(await count(), before + 1);
      await user("race-decision");
      const decisions = await Promise.all([
        mutate("approve", { userId: "race-decision", role: "supervisor" }),
        mutate("reject", { userId: "race-decision" }),
      ]);
      assert.deepEqual(decisions.map((r) => r.status).sort(), [200, 409]);
      const pre = await count();
      await Promise.all([
        mutate("disable", { userId: "sales" }),
        mutate("disable", { userId: "sales" }),
      ]);
      assert.equal(await count(), pre + 1);
    }
  );
  await t.test(
    "failed later statement rolls back audit and data; D1 errors are sanitized",
    async () => {
      await user("rollback");
      await db
        .prepare(
          "CREATE TRIGGER fail_account BEFORE UPDATE ON users WHEN NEW.id = 'rollback' BEGIN SELECT RAISE(ABORT, 'secret SQL detail'); END"
        )
        .run();
      const before = await count();
      const response = await mutate("approve", {
        userId: "rollback",
        role: "supervisor",
      });
      assert.equal(response.status, 503);
      assert.doesNotMatch(await response.text(), /secret|SQL|token/);
      assert.equal((await state("rollback")).status, "pending");
      assert.equal(await count(), before);
      await db.prepare("DROP TRIGGER fail_account").run();
      await db
        .prepare(
          "CREATE TRIGGER fail_audit BEFORE INSERT ON access_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END"
        )
        .run();
      assert.equal(
        (await mutate("approve", { userId: "rollback", role: "supervisor" }))
          .status,
        503
      );
      assert.equal((await state("rollback")).status, "pending");
      assert.equal(await count(), before);
      await db.prepare("DROP TRIGGER fail_audit").run();
    }
  );
  await t.test("bounded keyset pagination and exact filters", async () => {
    const ids = [];
    let next = "";
    do {
      const response = await request(
        "?limit=3&after=" + encodeURIComponent(next)
      );
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.ok(page.items.length <= 3);
      ids.push(...page.items.map((u) => u.id));
      next = page.next;
    } while (next);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(
      ids.length,
      (await db.prepare("SELECT count(*) AS n FROM users").first()).n
    );
    const filtered = await (await request("?status=pending&limit=100")).json();
    assert.ok(filtered.items.every((u) => u.status === "pending"));
    for (const query of [
      "?limit=0",
      "?limit=101",
      "?status=ACTIVE",
      "?limit=1 OR 1=1",
    ])
      assert.equal((await request(query)).status, 400);
    assert.equal(
      (await request("?after=" + encodeURIComponent("' OR 1=1 --"))).status,
      200
    );
  });
  await t.test(
    "Bot and Web share lifecycle state, invariants and audit records",
    async () => {
      const bot = new IdentityOperations(db);
      const target = await user("cross-channel");
      assert.equal(
        (await bot.approve(admin, { ...target, role: "supervisor" })).ok,
        true
      );
      assert.equal(
        (await mutate("disable", { userId: "cross-channel" })).status,
        200
      );
      assert.equal((await bot.enable(admin, target)).ok, true);
      assert.equal(
        (await bot.setRole(admin, { ...target, role: "admin" })).ok,
        true
      );
      assert.equal(
        (await mutate("disable", { userId: "cross-channel" })).status,
        409
      );
      const events = (
        await db
          .prepare(
            "SELECT action,actor_user_id FROM access_audit WHERE target_user_id = 'cross-channel' ORDER BY rowid"
          )
          .all()
      ).results;
      assert.deepEqual(
        events.map((e) => e.action),
        ["approve", "disable", "enable", "setrole"]
      );
      assert.ok(events.every((e) => e.actor_user_id === "admin"));
    }
  );
});
