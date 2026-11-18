import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import { createApp } from "../src/index.ts";
import { outletReferences } from "../src/outlet-management.ts";
import { OutletOperations } from "../src/outlets.ts";
import { hashToken } from "../src/web-auth.ts";

async function setup(t) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-11-02",
      script: 'export default {fetch(){return new Response("fixture")}}',
      d1Databases: { DB: "outlet-management-test" },
    })
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  const run = (sql, ...args) =>
    db
      .prepare(sql)
      .bind(...args)
      .run();
  const dir = new URL("../../../packages/db/migrations/", import.meta.url);
  const migrate = (file) =>
    db.batch(
      readFileSync(new URL(file, dir), "utf8")
        .replace(/^\s*--.*$/gm, "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s))
    );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .toSorted();
  for (const file of files.filter((f) => !f.startsWith("0010_")))
    await migrate(file);
  await run("INSERT INTO sales_force(id,name) VALUES ('sf','Sales Force')");
  await run("INSERT INTO outlets(id,name) VALUES ('legacy','Legacy')");
  await run(
    "INSERT INTO visits(id,outlet_id,sales_force_id,visited_at,submission_channel) VALUES ('historical','legacy','sf',1,'telegram')"
  );
  const before = (await db.prepare("SELECT * FROM visits").all()).results;
  for (const file of files.filter((f) => f.startsWith("0010_")))
    await migrate(file);
  assert.deepEqual(
    (await db.prepare("SELECT * FROM visits").all()).results,
    before
  );
  assert.deepEqual(
    (await db.prepare("PRAGMA foreign_key_check").all()).results,
    []
  );
  const tokens = {};
  for (const [n, id, status, role, sf] of [
    [1, "admin", "active", "admin", null],
    [2, "supervisor", "active", "supervisor", null],
    [3, "sales", "active", "sales_force", "sf"],
    [4, "disabled", "disabled", "admin", null],
    [5, "pending", "pending", null, null],
    [6, "rejected", "rejected", null, null],
    [7, "revoked", "active", "admin", null],
    [8, "expired", "active", "admin", null],
    [9, "admin2", "active", "admin", null],
  ]) {
    await run(
      "INSERT INTO users(id,status,role,sales_force_id) VALUES (?,?,?,?)",
      id,
      status,
      role,
      sf
    );
    await run(
      "INSERT INTO telegram_identities(user_id,telegram_user_id) VALUES (?,?)",
      id,
      String(n)
    );
    tokens[id] = String(n).repeat(64);
    await run(
      "INSERT INTO web_sessions(token_hash,user_id,created_at,expires_at,revoked_at) VALUES (?,?,?,?,?)",
      await hashToken(tokens[id]),
      id,
      Date.now() - 10000,
      id === "expired" ? Date.now() - 1 : Date.now() + 3600000,
      id === "revoked" ? Date.now() : null
    );
  }
  const app = createApp();
  const request = (path, init = {}, database = db, actor = "admin") =>
    app.request(
      path,
      {
        ...init,
        headers: {
          ...(tokens[actor]
            ? { Authorization: `Bearer ${tokens[actor]}` }
            : {}),
          ...init.headers,
        },
      },
      { DB: database }
    );
  const ticket = async (duration = 20000) => {
    const { now } = await db
      .prepare("SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now")
      .first();
    return `web:${now + duration}:${crypto.randomUUID()}`;
  };
  const post = async (action, input, database = db, actor = "admin") =>
    request(
      "/admin/outlets/" + action,
      {
        method: "POST",
        body: JSON.stringify({ operationId: await ticket(), ...input }),
      },
      database,
      actor
    );
  const row = (id) =>
    db.prepare("SELECT * FROM outlets WHERE id = ?").bind(id).first();
  const byBusiness = (id) =>
    db.prepare("SELECT * FROM outlets WHERE business_id = ?").bind(id).first();
  const count = async () =>
    (await db.prepare("SELECT count(*) AS n FROM outlet_master_audit").first())
      .n;
  const detail = async (id) =>
    (
      await request("/admin/outlets/detail?" + new URLSearchParams({ id }))
    ).json();
  const outcome = async (id) =>
    (await (await request("/admin/outlets/operations/" + id)).json()).status;
  const pause = () => {
    let enter, release;
    const entered = new Promise((resolve) => {
      enter = resolve;
    });
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    return {
      entered,
      release,
      db: {
        prepare: db.prepare.bind(db),
        withSession: db.withSession.bind(db),
        batch: async (statements) => {
          enter();
          await waiting;
          return db.batch(statements);
        },
      },
    };
  };
  return {
    db,
    run,
    request,
    ticket,
    post,
    row,
    byBusiness,
    count,
    detail,
    outcome,
    pause,
  };
}

test("Web Outlet management in migrated disposable D1", async (t) => {
  const {
    db,
    run,
    request,
    ticket,
    post,
    row,
    byBusiness,
    count,
    detail,
    outcome,
    pause,
  } = await setup(t);
  const create = (businessId, extra = {}) =>
    post("create", { businessId, noRs: "RS-1", name: "Outlet Baru", ...extra });
  const update = (id, expectedName, expectedNoRs, extra = {}) =>
    post("update", {
      id,
      name: "Diubah",
      expectedName,
      expectedNoRs,
      ...extra,
    });

  await t.test(
    "permissions on all reads/writes, no credential or actor bypass",
    async () => {
      for (const actor of [
        "none",
        "pending",
        "rejected",
        "disabled",
        "revoked",
        "expired",
        "sales",
        "supervisor",
      ]) {
        const status = ["sales", "supervisor"].includes(actor) ? 403 : 401;
        for (const path of [
          "/detail?id=legacy",
          "/operations/new",
          "/operations/" + (await ticket()),
        ])
          assert.equal(
            (await request("/admin/outlets" + path, {}, db, actor)).status,
            status
          );
        for (const action of ["create", "update", "delete"])
          assert.equal(
            (await post(action, { id: "legacy" }, db, actor)).status,
            status
          );
      }
      assert.equal(
        (
          await request("/admin/outlets/detail?id=legacy", {
            headers: { Authorization: "Bearer invalid", "X-Role": "admin" },
          })
        ).status,
        401
      );
      assert.equal(
        (await create("forged", { actor: { role: "admin" } })).status,
        400
      );
      assert.equal(await count(), 0);
    }
  );
  await t.test(
    "strict validation and transport bounds reuse Outlet rules",
    async () => {
      for (const input of [
        null,
        [],
        {},
        { businessId: "X", name: "N" },
        { businessId: "X", noRs: "R" },
        { businessId: "", noRs: "R", name: "N" },
        { businessId: "  ", noRs: "R", name: "N" },
        { businessId: "x\u0080", noRs: "R", name: "N" },
        { businessId: "x\u200b", noRs: "R", name: "N" },
        { businessId: "x".repeat(257), noRs: "R", name: "N" },
        { businessId: "X", noRs: "", name: "N" },
        { businessId: "X", noRs: "R", name: "\tN" },
        { businessId: "X", noRs: "R", name: "  " },
        { businessId: "X", noRs: "R", name: "N", id: "chosen" },
      ]) {
        const response = await request("/admin/outlets/create", {
          method: "POST",
          body: JSON.stringify(
            input && !Array.isArray(input)
              ? { operationId: await ticket(), ...input }
              : input
          ),
        });
        assert.equal(response.status, 400);
      }
      assert.equal(
        (await request("/admin/outlets/create", { method: "POST", body: "{" }))
          .status,
        400
      );
      assert.equal(
        (
          await request("/admin/outlets/create", {
            method: "POST",
            body: "x".repeat(16385),
          })
        ).status,
        400
      );
      assert.equal(
        (
          await post("update", {
            id: "legacy",
            name: "N",
            expectedName: "Legacy",
            expectedNoRs: null,
            businessId: "changed",
          })
        ).status,
        400
      );
      assert.equal(
        (await post("delete", { id: "legacy", role: "admin" })).status,
        400
      );
      assert.equal(
        (await post("delete", { id: "legacy", operationId: "invalid" })).status,
        400
      );
      assert.equal(await count(), 0);
    }
  );
  await t.test(
    "server IDs, case-sensitive uniqueness, exact business metadata, audit actor",
    async () => {
      assert.equal(
        (
          await create("Code", {
            name: "  Nama Indonesia  ",
            noRs: " RS / 01 ",
          })
        ).status,
        201
      );
      const record = await byBusiness("Code");
      assert.match(record.id, /^[0-9a-f-]{36}$/);
      assert.equal(record.name, "Nama Indonesia");
      assert.equal(record.no_rs, " RS / 01 ");
      assert.equal(typeof record.updated_at, "number");
      assert.equal((await create("Code")).status, 409);
      assert.equal((await create("code")).status, 201);
      const event = await db
        .prepare("SELECT * FROM outlet_master_audit WHERE outlet_id = ?")
        .bind(record.id)
        .first();
      assert.equal(event.actor_user_id, "admin");
      assert.equal(event.action, "create");
      assert.equal(event.before, null);
      assert.deepEqual(JSON.parse(event.after), {
        businessId: "Code",
        name: "Nama Indonesia",
        noRs: " RS / 01 ",
      });
      assert.equal(
        (await request("/admin/outlets/detail?id=" + record.id)).headers.get(
          "Cache-Control"
        ),
        "no-store"
      );
    }
  );
  await t.test(
    "update CAS, no-op, immutable ID, legacy null preservation and report resolution",
    async () => {
      const legacy = await row("legacy");
      assert.equal((await update("legacy", "Legacy", null)).status, 200);
      const changed = await row("legacy");
      assert.equal(changed.business_id, null);
      assert.equal(changed.no_rs, null);
      assert.equal(changed.created_at, legacy.created_at);
      assert.equal((await update("legacy", "Legacy", null)).status, 409);
      const beforeCount = await count();
      assert.equal((await update("legacy", "Diubah", null)).status, 200);
      assert.equal(await count(), beforeCount);
      assert.equal(
        (await update("legacy", "Diubah", null, { noRs: "R-NEW" })).status,
        200
      );
      assert.equal(
        (await update("legacy", "Diubah", null, { name: "Stale" })).status,
        409
      );
      assert.equal((await update("missing", "N", null)).status, 404);
      assert.equal((await post("delete", { id: "missing" })).status, 404);
      assert.equal((await detail("legacy")).businessId, null);
      assert.deepEqual((await detail("legacy")).references, ["visit"]);
      assert.equal(
        (await (await request("/outlets/legacy")).json()).name,
        "Diubah"
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM visits WHERE outlet_id = 'legacy'"
            )
            .first()
        ).n,
        1
      );
    }
  );
  await t.test(
    "all Outlet FKs are protected independently; never cascade operational history",
    async () => {
      const tables = (
        await db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
      ).results;
      const actual = [];
      for (const { name } of tables.filter(
        (table) =>
          !table.name.startsWith("sqlite_") && !table.name.startsWith("_cf_")
      ))
        for (const fk of (
          await db.prepare(`PRAGMA foreign_key_list('${name}')`).all()
        ).results)
          if (fk.table === "outlets") actual.push([name, fk.from]);
      assert.deepEqual(
        actual.toSorted(),
        outletReferences.map(([table, column]) => [table, column]).toSorted()
      );
      for (const reason of ["visit", "stock_report", "schedule"]) {
        await run("INSERT INTO outlets(id,name) VALUES (?,?)", reason, reason);
        if (reason === "visit")
          await run(
            "INSERT INTO visits(id,outlet_id,sales_force_id,visited_at,submission_channel) VALUES ('v','visit','sf',1,'web')"
          );
        if (reason === "stock_report")
          await run(
            "INSERT INTO stock_reports(id,outlet_id,reporter_sales_force_id,reported_at,submission_channel) VALUES ('s','stock_report','sf',1,'telegram')"
          );
        if (reason === "schedule")
          await run(
            "INSERT INTO visit_schedules(id,outlet_id,sales_force_id,weekday) VALUES ('plan','schedule','sf',7)"
          );
        const n = await count();
        assert.deepEqual((await detail(reason)).references, [reason]);
        const response = await post("delete", { id: reason });
        assert.equal(response.status, 409);
        assert.equal((await response.json()).error, "referenced_record");
        assert.ok(await row(reason));
        assert.equal(await count(), n);
        await assert.rejects(
          run("DELETE FROM outlets WHERE id = ?", reason),
          /FOREIGN KEY/
        );
      }
      assert.deepEqual(
        (await db.prepare("PRAGMA foreign_key_check").all()).results,
        []
      );
    }
  );
  await t.test(
    "safe deletion retains audit and preserves unrelated records",
    async () => {
      assert.equal((await create("unused")).status, 201);
      const record = await byBusiness("unused");
      assert.equal((await post("delete", { id: record.id })).status, 200);
      assert.equal(await row(record.id), null);
      const events = (
        await db
          .prepare(
            "SELECT action FROM outlet_master_audit WHERE outlet_id = ? ORDER BY action"
          )
          .bind(record.id)
          .all()
      ).results;
      assert.deepEqual(events, [{ action: "create" }, { action: "delete" }]);
      assert.equal(
        (await db.prepare("SELECT count(*) AS n FROM visits").first()).n,
        2
      );
    }
  );
  await t.test(
    "unsafe timestamps fail without repair; safe negative legacy timestamps work",
    async () => {
      await run(
        "INSERT INTO outlets(id,name,created_at) VALUES ('bad-time','Bad',9007199254740992)"
      );
      for (const response of [
        await update("bad-time", "Bad", null),
        await post("delete", { id: "bad-time" }),
        await request("/admin/outlets/detail?id=bad-time"),
      ])
        assert.equal(response.status, 503);
      await run(
        "UPDATE outlets SET created_at = -1, updated_at = -2 WHERE id = 'bad-time'"
      );
      assert.equal((await update("bad-time", "Bad", null)).status, 200);
      assert.equal((await row("bad-time")).created_at, -1);
    }
  );
  await t.test(
    "atomic rollback when audit or mutation fails, sanitized failure",
    async () => {
      const n = await count();
      await run(
        "CREATE TRIGGER fail_outlet BEFORE INSERT ON outlets WHEN NEW.business_id = 'rollback' BEGIN SELECT RAISE(ABORT,'private database error'); END"
      );
      const result = await create("rollback");
      assert.equal(result.status, 503);
      assert.deepEqual(await result.json(), { error: "Service unavailable" });
      assert.equal(await count(), n);
      assert.equal(await byBusiness("rollback"), null);
      await run("DROP TRIGGER fail_outlet");
      await run(
        "CREATE TRIGGER fail_audit BEFORE INSERT ON outlet_master_audit BEGIN SELECT RAISE(ABORT,'audit failure'); END"
      );
      assert.equal(
        (
          await update("legacy", "Diubah", "R-NEW", {
            name: "Must not persist",
          })
        ).status,
        503
      );
      assert.equal((await row("legacy")).name, "Diubah");
      await run("DROP TRIGGER fail_audit");
    }
  );
  await t.test(
    "concurrent creates/updates/deletes and references serialize",
    async () => {
      assert.deepEqual(
        (await Promise.all([create("race"), create("race")]))
          .map((r) => r.status)
          .toSorted(),
        [201, 409]
      );
      const record = await byBusiness("race");
      assert.deepEqual(
        (
          await Promise.all([
            update(record.id, record.name, record.no_rs, { name: "A" }),
            update(record.id, record.name, record.no_rs, { name: "B" }),
          ])
        )
          .map((r) => r.status)
          .toSorted(),
        [200, 409]
      );
      const p = pause();
      const pending = post("delete", { id: record.id }, p.db);
      await p.entered;
      await run(
        "INSERT INTO visit_schedules(id,outlet_id,sales_force_id,weekday) VALUES ('racing-plan',?,'sf',1)",
        record.id
      );
      p.release();
      assert.equal((await pending).status, 409);
      await create("delete-race");
      const unused = await byBusiness("delete-race");
      assert.deepEqual(
        (
          await Promise.all([
            post("delete", { id: unused.id }),
            post("delete", { id: unused.id }),
          ])
        )
          .map((r) => r.status)
          .toSorted(),
        [200, 404]
      );
    }
  );
  await t.test(
    "live write-time authorization survives demotion, disable, revocation, expiry",
    async () => {
      for (const [sql, reset, expected] of [
        [
          "UPDATE users SET role='supervisor' WHERE id='admin'",
          "UPDATE users SET role='admin' WHERE id='admin'",
          403,
        ],
        [
          "UPDATE users SET status='disabled' WHERE id='admin'",
          "UPDATE users SET status='active' WHERE id='admin'",
          401,
        ],
        [
          "UPDATE web_sessions SET revoked_at=1 WHERE user_id='admin'",
          "UPDATE web_sessions SET revoked_at=NULL WHERE user_id='admin'",
          401,
        ],
        [
          "UPDATE web_sessions SET created_at=0,expires_at=1 WHERE user_id='admin'",
          `UPDATE web_sessions SET expires_at=${Date.now() + 3600000} WHERE user_id='admin'`,
          401,
        ],
      ]) {
        const p = pause();
        const pending = post(
          "create",
          { businessId: "denied-race", noRs: "R", name: "Denied" },
          p.db
        );
        await p.entered;
        await run(sql);
        p.release();
        assert.equal((await pending).status, expected);
        await run(reset);
        assert.equal(await byBusiness("denied-race"), null);
      }
    }
  );
  await t.test(
    "operation receipt isolation, replay/cutoff fencing and lost responses",
    async () => {
      const ticketResponse = await request("/admin/outlets/operations/new");
      assert.equal(ticketResponse.status, 200);
      const { operationId } = await ticketResponse.json();
      assert.equal(await outcome(operationId), "pending");
      assert.equal((await create("receipt", { operationId })).status, 201);
      assert.equal(await outcome(operationId), "committed");
      assert.equal((await create("replayed", { operationId })).status, 409);
      assert.equal(await byBusiness("replayed"), null);
      for (const scope of ["users", "sales-force"])
        assert.equal(
          (
            await (
              await request(`/admin/${scope}/operations/${operationId}`)
            ).json()
          ).status,
          "pending"
        );
      const expired = await ticket(-1);
      assert.equal(await outcome(expired), "not_committed");
      assert.equal(
        (await create("late", { operationId: expired })).status,
        409
      );
      const future = await ticket(60000);
      assert.equal(
        (await create("future", { operationId: future })).status,
        409
      );
      const p = pause();
      const short = await ticket(2000);
      const pending = post(
        "create",
        { businessId: "paused-late", noRs: "R", name: "N", operationId: short },
        p.db
      );
      await p.entered;
      assert.equal(await outcome(short), "pending");
      await new Promise((resolve) => setTimeout(resolve, 2100));
      assert.equal(await outcome(short), "not_committed");
      p.release();
      assert.equal((await pending).status, 409);
      assert.equal(await byBusiness("paused-late"), null);
      const lost = await ticket();
      const dropped = {
        prepare: db.prepare.bind(db),
        batch: async (statements) => {
          await db.batch(statements);
          throw new Error("lost response");
        },
      };
      assert.equal(
        (
          await post(
            "create",
            { businessId: "lost", noRs: "R", name: "N", operationId: lost },
            dropped
          )
        ).status,
        503
      );
      assert.equal(await outcome(lost), "committed");
      assert.ok(await byBusiness("lost"));
      const n = await count();
      const reused = await ticket();
      assert.deepEqual(
        (
          await Promise.all([
            create("handle-race-1", { operationId: reused }),
            create("handle-race-2", { operationId: reused }),
          ])
        )
          .map((r) => r.status)
          .toSorted(),
        [201, 409]
      );
      assert.equal(await count(), n + 1);
    }
  );
  await t.test(
    "existing Bot operations and role-scoped operational reads remain compatible",
    async () => {
      const bot = new OutletOperations(db);
      const actor = { telegramUserId: "1" };
      const created = await bot.create(actor, {
        businessId: "Bot-Code",
        name: "Bot Outlet",
        noRs: "BOT-RS",
      });
      assert.equal(created.ok, true);
      assert.equal((await detail(created.data.id)).businessId, "Bot-Code");
      assert.equal(
        (
          await update(created.data.id, "Bot Outlet", "BOT-RS", {
            name: "Web Name",
          })
        ).status,
        200
      );
      assert.equal(
        (await bot.get(actor, { businessId: "Bot-Code" })).data.name,
        "Web Name"
      );
      assert.equal(
        (
          await bot.update(actor, {
            businessId: "Bot-Code",
            name: "Bot Name",
            noRs: "BOT-RS-2",
          })
        ).ok,
        true
      );
      assert.equal((await detail(created.data.id)).name, "Bot Name");
      assert.equal((await bot.delete(actor, { id: created.data.id })).ok, true);
      for (const who of ["supervisor", "sales"]) {
        assert.equal(
          (await request("/outlets?view=page", {}, db, who)).status,
          200
        );
        assert.equal(
          (await request("/outlets/legacy", {}, db, who)).status,
          200
        );
        const data = await (
          await request("/visits?view=page&outletId=legacy", {}, db, who)
        ).json();
        assert.equal(data.total, who === "sales" ? 1 : 0);
      }
      const oldCatalog = await (await request("/outlets")).json();
      assert.deepEqual(Object.keys(oldCatalog[0]).toSorted(), ["id", "name"]);
      assert.deepEqual(
        (await db.prepare("PRAGMA foreign_key_check").all()).results,
        []
      );
    }
  );
});
