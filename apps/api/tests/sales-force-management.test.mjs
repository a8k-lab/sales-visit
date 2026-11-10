import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import { createApp } from "../src/index.ts";
import { masterReferences } from "../src/sales-force-management.ts";
import { hashToken } from "../src/web-auth.ts";

async function setup(t) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-11-02",
      script: 'export default {fetch(){return new Response("fixture")}}',
      d1Databases: { DB: "sf-master-test" },
    })
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
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
  for (const file of files.filter((f) => !f.startsWith("0009_")))
    await migrate(file);
  const run = (sql, ...args) =>
    db
      .prepare(sql)
      .bind(...args)
      .run();
  const tokens = {};
  for (const [n, id, status, role] of [
    [1, "admin", "active", "admin"],
    [2, "supervisor", "active", "supervisor"],
    [3, "disabled", "disabled", "admin"],
    [4, "pending", "pending", null],
    [5, "admin2", "active", "admin"],
  ]) {
    await run(
      "INSERT INTO users(id,status,role) VALUES (?,?,?)",
      id,
      status,
      role
    );
    await run(
      "INSERT INTO telegram_identities(user_id,telegram_user_id) VALUES (?,?)",
      id,
      String(n)
    );
    tokens[id] = String(n).repeat(64);
    await run(
      "INSERT INTO web_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)",
      await hashToken(tokens[id]),
      id,
      Date.now(),
      Date.now() + 3600000
    );
  }
  await run("INSERT INTO sales_force(id,name) VALUES ('legacy','Legacy')");
  await run("INSERT INTO outlets(id,name) VALUES ('outlet','Outlet')");
  await run(
    "INSERT INTO visits(id,outlet_id,sales_force_id,visited_at,submission_channel) VALUES ('old-visit','outlet','legacy',1,'telegram')"
  );
  // Apply additive migration to populated pre-A2 schema, not just an empty DB.
  const before = await db.prepare("SELECT * FROM visits").all();
  for (const file of files.filter((f) => f.startsWith("0009_")))
    await migrate(file);
  assert.deepEqual(
    (await db.prepare("SELECT * FROM visits").all()).results,
    before.results
  );
  assert.deepEqual(
    (await db.prepare("PRAGMA foreign_key_check").all()).results,
    []
  );
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
      "/admin/sales-force/" + action,
      {
        method: "POST",
        body: JSON.stringify({ operationId: await ticket(), ...input }),
      },
      database,
      actor
    );
  const list = async (query = "") =>
    await (await request("/admin/sales-force" + query)).json();
  const count = async () =>
    (
      await db
        .prepare("SELECT count(*) AS n FROM sales_force_master_audit")
        .first()
    ).n;
  const row = (id) =>
    db.prepare("SELECT * FROM sales_force WHERE id = ?").bind(id).first();
  const outcome = async (id) =>
    (await (await request("/admin/sales-force/operations/" + id)).json())
      .status;
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
        batch: async (statements) => {
          enter();
          await waiting;
          return db.batch(statements);
        },
      },
    };
  };
  return { db, run, request, ticket, post, list, count, row, outcome, pause };
}

test("Sales Force master management with migrated disposable D1", async (t) => {
  const { db, run, request, ticket, post, list, count, row, outcome, pause } =
    await setup(t);
  await t.test(
    "Admin authorization, sanitized errors, strict bounded validation",
    async () => {
      for (const actor of ["none", "pending", "disabled", "supervisor"]) {
        const status = actor === "supervisor" ? 403 : 401;
        for (const path of [
          "",
          "/operations/new",
          "/operations/" + (await ticket()),
        ])
          assert.equal(
            (await request("/admin/sales-force" + path, {}, db, actor)).status,
            status
          );
        for (const action of ["create", "rename", "delete"])
          assert.equal(
            (
              await post(
                action,
                { id: "legacy", name: "X", expectedName: "Legacy" },
                db,
                actor
              )
            ).status,
            status
          );
      }
      for (const id of [
        "",
        " ",
        " x",
        "x ",
        "x\n",
        "x\u007f",
        "x\u0085",
        "x\u200b",
        "x".repeat(129),
      ])
        assert.equal((await post("create", { id, name: "Name" })).status, 400);
      for (const name of ["", " ", " x", "x\t", "x".repeat(201)])
        assert.equal(
          (await post("create", { id: "invalid", name })).status,
          400
        );
      for (const extra of [
        { actorUserId: "admin" },
        { role: "admin" },
        { permission: true },
      ])
        assert.equal(
          (await post("create", { id: "invalid", name: "Name", ...extra }))
            .status,
          400
        );
      assert.equal(
        (
          await request("/admin/sales-force/create", {
            method: "POST",
            body: "{",
          })
        ).status,
        400
      );
      assert.equal(
        (await post("create", { id: "invalid", name: "x".repeat(17000) }))
          .status,
        400
      );
      for (const query of [
        "?limit=0",
        "?limit=101",
        "?limit=no",
        "?q=" + "x".repeat(201),
      ])
        assert.equal((await request("/admin/sales-force" + query)).status, 400);
      const broken = {
        prepare: db.prepare.bind(db),
        batch: async () => {
          throw new Error("private SQL detail");
        },
      };
      const response = await post(
        "create",
        { id: "broken", name: "Name" },
        broken
      );
      assert.equal(response.status, 503);
      assert.doesNotMatch(await response.text(), /private|SQL/);
    }
  );
  await t.test(
    "create preserves IDs, bounded search pagination, account approval and assignments",
    async () => {
      assert.equal(
        (await post("create", { id: "sf-Timika-6-Brian", name: "Brian" }))
          .status,
        201
      );
      assert.equal(
        (await post("create", { id: "sf-Timika-6-Brian", name: "Other" }))
          .status,
        409
      );
      assert.equal((await row("sf-Timika-6-Brian")).name, "Brian");
      assert.equal((await list("?q=BRIAN")).items[0].id, "sf-Timika-6-Brian");
      assert.equal((await list("?q=Timika")).items.length, 1);
      assert.equal((await list("?q=%25")).items.length, 0); // literal, not LIKE wildcard
      const page = await list("?limit=1");
      assert.equal(page.items.length, 1);
      assert.ok(page.next);
      assert.ok(
        (await list("?limit=1&after=" + encodeURIComponent(page.next))).items[0]
          .id > page.next
      );
      const options = await (
        await request("/admin/users/sales-force-options")
      ).json();
      assert.ok(options.items.some((x) => x.id === "sf-Timika-6-Brian"));
      const approve = await request("/admin/users/approve", {
        method: "POST",
        body: JSON.stringify({
          operationId: await ticket(),
          userId: "pending",
          role: "sales_force",
          salesForceId: "sf-Timika-6-Brian",
        }),
      });
      assert.equal(approve.status, 200);
      assert.ok(
        !(
          await (await request("/admin/users/sales-force-options")).json()
        ).items.some((x) => x.id === "sf-Timika-6-Brian")
      );
      assert.ok(
        (await (await request("/supervisor-assignments")).json()).items.some(
          (x) => x.salesForceId === "sf-Timika-6-Brian"
        )
      );
      assert.equal(
        (
          await request("/supervisor-assignments", {
            method: "PUT",
            body: JSON.stringify({
              salesForceId: "sf-Timika-6-Brian",
              supervisorUserId: "supervisor",
            }),
          })
        ).status,
        200
      );
      const operational = await (
        await request("/sales-force", {}, db, "supervisor")
      ).json();
      assert.ok(operational.some((x) => x.id === "sf-Timika-6-Brian"));
      assert.equal(
        (await request("/admin/sales-force", {}, db, "pending")).status,
        403
      );
      assert.equal(
        (await request("/sales-force", {}, db, "pending")).status,
        403
      );
    }
  );
  await t.test(
    "rename CAS, no-op audit, historical resolution and unknown records",
    async () => {
      const n = await count();
      assert.equal(
        (
          await post("rename", {
            id: "legacy",
            expectedName: "Legacy",
            name: "Renamed",
          })
        ).status,
        200
      );
      assert.equal(await count(), n + 1);
      const unchanged = await post("rename", {
        id: "legacy",
        expectedName: "Renamed",
        name: "Renamed",
      });
      assert.deepEqual(await unchanged.json(), { ok: true, changed: false });
      assert.equal(await count(), n + 1);
      assert.equal(
        (
          await post("rename", {
            id: "legacy",
            expectedName: "Legacy",
            name: "Stale",
          })
        ).status,
        409
      );
      assert.equal((await row("legacy")).name, "Renamed");
      assert.equal(
        (
          await db
            .prepare(
              "SELECT sf.name FROM visits v JOIN sales_force sf ON sf.id=v.sales_force_id WHERE v.id='old-visit'"
            )
            .first()
        ).name,
        "Renamed"
      );
      for (const action of ["rename", "delete"])
        assert.equal(
          (
            await post(action, {
              id: "absent",
              ...(action === "rename" ? { expectedName: "X", name: "Y" } : {}),
            })
          ).status,
          404
        );
    }
  );
  await t.test(
    "safe deletion retains audit; exact unusual legacy IDs remain manageable",
    async () => {
      const legacy = " ../Odd/ID?\n\t ";
      await run(
        "INSERT INTO sales_force(id,name) VALUES (?,?)",
        legacy,
        " Old name "
      );
      assert.equal(
        (
          await post("rename", {
            id: legacy,
            expectedName: " Old name ",
            name: "Modern name",
          })
        ).status,
        200
      );
      assert.ok((await list("?q=Odd")).items.some((x) => x.id === legacy));
      assert.equal((await post("delete", { id: legacy })).status, 200);
      assert.equal(await row(legacy), null);
      const events = (
        await db
          .prepare(
            "SELECT action,previous_name,new_name,actor_user_id FROM sales_force_master_audit WHERE sales_force_id=? ORDER BY rowid"
          )
          .bind(legacy)
          .all()
      ).results;
      assert.deepEqual(events, [
        {
          action: "rename",
          previous_name: " Old name ",
          new_name: "Modern name",
          actor_user_id: "admin",
        },
        {
          action: "delete",
          previous_name: "Modern name",
          new_name: null,
          actor_user_id: "admin",
        },
      ]);
      assert.equal(
        (await post("create", { id: "unused", name: "Unused" })).status,
        201
      );
      assert.equal((await post("delete", { id: "unused" })).status, 200);
      assert.equal(await row("unused"), null);
    }
  );
  await t.test(
    "every schema FK is represented and independently blocks delete with rollback",
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
      )) {
        // Names from sqlite_master, not request input.
        for (const fk of (
          await db.prepare(`PRAGMA foreign_key_list('${name}')`).all()
        ).results)
          if (fk.table === "sales_force") {
            actual.push([name, fk.from]);
            assert.equal(fk.on_delete, "RESTRICT");
          }
      }
      assert.deepEqual(
        actual.toSorted(),
        masterReferences.map(([table, col]) => [table, col]).toSorted()
      );
      const fixtures = {
        users: (id) =>
          run(
            "INSERT INTO users(id,status,role,sales_force_id) VALUES ('claimed','disabled','sales_force',?)",
            id
          ),
        sales_force_supervisors: (id) =>
          run(
            "INSERT INTO sales_force_supervisors(sales_force_id,supervisor_user_id) VALUES (?,'supervisor')",
            id
          ),
        supervisor_assignment_audit: (id) =>
          run(
            "INSERT INTO supervisor_assignment_audit(id,actor_user_id,sales_force_id,new_supervisor_user_id,action) VALUES ('history','admin',?,'supervisor','assign')",
            id
          ),
        visit_schedules: (id) =>
          run(
            "INSERT INTO visit_schedules(id,sales_force_id,outlet_id,weekday) VALUES ('plan',?,'outlet',1)",
            id
          ),
        visits: (id) =>
          run(
            "INSERT INTO visits(id,sales_force_id,outlet_id,visited_at,submission_channel) VALUES ('activity',?,'outlet',1,'telegram')",
            id
          ),
        stock_reports: (id) =>
          run(
            "INSERT INTO stock_reports(id,reporter_sales_force_id,outlet_id,reported_at,submission_channel) VALUES ('stock',?,'outlet',1,'telegram')",
            id
          ),
        telegram_visit_drafts: (id) =>
          run(
            "INSERT INTO telegram_visit_drafts(user_id,submission_key,sales_force_id,step,last_message,expires_at) VALUES ('admin','draft',?,'cancelled',1,0)",
            id
          ),
      };
      for (const [table, , reason] of masterReferences) {
        const id = "ref-" + table;
        await post("create", { id, name: id });
        await fixtures[table](id);
        assert.ok(
          (await list("?q=" + id)).items[0].references.includes(reason)
        );
        const n = await count();
        const response = await post("delete", { id });
        assert.equal(response.status, 409, await response.clone().text());
        assert.deepEqual(await response.json(), { error: "referenced_record" });
        assert.ok(await row(id));
        assert.equal(await count(), n);
        // Direct SQL must fail too; frontend/preflight isn't the protection.
        await assert.rejects(
          run("DELETE FROM sales_force WHERE id=?", id),
          /FOREIGN KEY/
        );
        assert.equal(
          (await post("create", { id, name: "Replacement" })).status,
          409
        );
      }
      assert.deepEqual(
        (await db.prepare("PRAGMA foreign_key_check").all()).results,
        []
      );
    }
  );
  await t.test(
    "concurrent creates, CAS renames, deletes, and mixed rename/delete serialize",
    async () => {
      const n = await count();
      let responses = await Promise.all([
        post("create", { id: "race", name: "Start" }),
        post("create", { id: "race", name: "Start" }, db, "admin2"),
      ]);
      assert.deepEqual(responses.map((x) => x.status).toSorted(), [201, 409]);
      assert.equal(await count(), n + 1);
      responses = await Promise.all([
        post("rename", { id: "race", expectedName: "Start", name: "A" }),
        post(
          "rename",
          { id: "race", expectedName: "Start", name: "B" },
          db,
          "admin2"
        ),
      ]);
      assert.deepEqual(responses.map((x) => x.status).toSorted(), [200, 409]);
      assert.equal(await count(), n + 2);
      responses = await Promise.all([
        post("delete", { id: "race" }),
        post("delete", { id: "race" }, db, "admin2"),
      ]);
      assert.deepEqual(responses.map((x) => x.status).toSorted(), [200, 404]);
      assert.equal(await count(), n + 3);
      await post("create", { id: "mixed", name: "Start" });
      responses = await Promise.all([
        post("rename", { id: "mixed", expectedName: "Start", name: "End" }),
        post("delete", { id: "mixed" }, db, "admin2"),
      ]);
      assert.equal(responses[1].status, 200);
      assert.ok([200, 404].includes(responses[0].status));
      assert.equal(await row("mixed"), null);
    }
  );
  await t.test(
    "concurrent new references and deletion never orphan business data",
    async () => {
      await post("create", { id: "reference-race", name: "Reference race" });
      const [deletion, reference] = await Promise.allSettled([
        post("delete", { id: "reference-race" }),
        run(
          "INSERT INTO visit_schedules(id,sales_force_id,outlet_id,weekday) VALUES ('race-plan','reference-race','outlet',2)"
        ),
      ]);
      assert.equal(deletion.status, "fulfilled");
      if (reference.status === "fulfilled") {
        assert.equal(deletion.value.status, 409);
        assert.ok(await row("reference-race"));
      } else {
        assert.match(String(reference.reason), /FOREIGN KEY/);
        assert.equal(deletion.value.status, 200);
        assert.equal(await row("reference-race"), null);
      }
      assert.deepEqual(
        (await db.prepare("PRAGMA foreign_key_check").all()).results,
        []
      );
    }
  );
  await t.test(
    "one master operation cannot concurrently record multiple changes",
    async () => {
      const operationId = await ticket();
      const n = await count();
      const responses = await Promise.all([
        post("create", { id: "same-op-a", name: "A", operationId }),
        post(
          "create",
          { id: "same-op-b", name: "B", operationId },
          db,
          "admin2"
        ),
      ]);
      assert.deepEqual(
        responses.map((response) => response.status).toSorted(),
        [201, 409]
      );
      assert.equal(await count(), n + 1);
      assert.equal(await outcome(operationId), "committed");
    }
  );
  await t.test(
    "audit failure, mutation failure, and post-write failure all roll back",
    async () => {
      await post("create", { id: "atomic", name: "Original" });
      const n = await count();
      for (const action of ["create", "rename", "delete"]) {
        for (const index of [2, 3, 4]) {
          const broken = {
            prepare: db.prepare.bind(db),
            batch: (statements) => {
              const copy = [...statements];
              copy.splice(
                index,
                0,
                db.prepare(
                  "INSERT INTO sales_force(id,name) VALUES ('legacy','duplicate')"
                )
              );
              return db.batch(copy);
            },
          };
          assert.equal(
            (
              await post(
                action,
                {
                  id: action === "create" ? "atomic-new" : "atomic",
                  ...(action !== "delete" ? { name: "Changed" } : {}),
                  ...(action === "rename" ? { expectedName: "Original" } : {}),
                },
                broken
              )
            ).status,
            503
          );
          assert.equal((await row("atomic")).name, "Original");
          assert.equal(await row("atomic-new"), null);
          assert.equal(await count(), n);
        }
      }
    }
  );
  await t.test(
    "live session recheck inside privileged batches rejects revocation, disable, demotion, expiry",
    async () => {
      for (const sql of [
        "UPDATE web_sessions SET revoked_at=1 WHERE user_id='admin'",
        "UPDATE users SET status='disabled' WHERE id='admin'",
        "UPDATE users SET role='supervisor' WHERE id='admin'",
        "UPDATE web_sessions SET created_at=0,expires_at=1 WHERE user_id='admin'",
      ]) {
        const p = pause();
        const response = post("create", { id: "stale", name: "Stale" }, p.db);
        await p.entered;
        await run(sql);
        p.release();
        assert.equal(
          (await response).status,
          sql.includes("role=") ? 403 : 401
        );
        assert.equal(await row("stale"), null);
        await run(
          "UPDATE users SET status='active',role='admin' WHERE id='admin'"
        );
        await run(
          "UPDATE web_sessions SET revoked_at=NULL,expires_at=? WHERE user_id='admin'",
          Date.now() + 3600000
        );
      }
    }
  );
  await t.test(
    "dedicated primary receipt handles late commit, cutoff, lost response, replay, no-op and rejection",
    async () => {
      const allocated = await (
        await request("/admin/sales-force/operations/new")
      ).json();
      assert.equal(await outcome(allocated.operationId), "pending");
      assert.equal(
        (await request("/admin/sales-force/operations/bad")).status,
        400
      );
      // A1 receipt must not mistake an A2 operation for an account operation.
      const op = await ticket();
      const p = pause();
      const waiting = post(
        "create",
        { id: "delayed", name: "Delayed", operationId: op },
        p.db
      );
      await p.entered;
      assert.equal(await row("delayed"), null);
      assert.equal(await outcome(op), "pending");
      p.release();
      assert.equal((await waiting).status, 201);
      assert.equal(await outcome(op), "committed");
      assert.equal(
        (await (await request("/admin/users/operations/" + op)).json()).status,
        "pending"
      );
      const n = await count();
      assert.equal(
        (
          await post("create", {
            id: "replayed",
            name: "Replay",
            operationId: op,
          })
        ).status,
        409
      );
      assert.equal(await row("replayed"), null);
      assert.equal(await count(), n);
      for (const action of ["create", "rename", "delete"]) {
        const late = await ticket(80);
        const held = pause();
        const response = post(
          action,
          {
            id: action === "create" ? "too-late" : "delayed",
            ...(action !== "delete" ? { name: "Changed" } : {}),
            ...(action === "rename" ? { expectedName: "Delayed" } : {}),
            operationId: late,
          },
          held.db
        );
        await held.entered;
        await new Promise((resolve) => setTimeout(resolve, 110));
        assert.equal(await outcome(late), "not_committed");
        held.release();
        assert.equal((await response).status, 409);
        assert.equal((await row("delayed")).name, "Delayed");
        assert.equal(await row("too-late"), null);
      }
      const committed = await ticket();
      const lost = {
        prepare: db.prepare.bind(db),
        batch: async (statements) => {
          await db.batch(statements);
          throw new Error("lost response");
        },
      };
      assert.equal(
        (
          await post(
            "rename",
            {
              id: "delayed",
              expectedName: "Delayed",
              name: "Committed",
              operationId: committed,
            },
            lost
          )
        ).status,
        503
      );
      assert.equal(await outcome(committed), "committed");
      for (const action of ["noop", "reject"]) {
        const short = await ticket(80);
        const response =
          action === "noop"
            ? await post("rename", {
                id: "delayed",
                expectedName: "Committed",
                name: "Committed",
                operationId: short,
              })
            : await post("create", {
                id: "delayed",
                name: "Duplicate",
                operationId: short,
              });
        assert.equal(response.status, action === "noop" ? 200 : 409);
        await new Promise((resolve) => setTimeout(resolve, 110));
        assert.equal(await outcome(short), "not_committed");
      }
    }
  );
});
