import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import { createApp } from "../src/index.ts";
import { hashToken } from "../src/web-auth.ts";

const pastDeadline = async (id) => {
  const deadline = Number(id.split(":")[1]);
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, deadline - Date.now() + 30))
  );
};

async function setup(t) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-11-02",
      script: 'export default {fetch(){return new Response("fixture")}}',
      d1Databases: { DB: "operation-test" },
    })
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  const dir = new URL("../../../packages/db/migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .toSorted()) {
    await db.batch(
      readFileSync(new URL(file, dir), "utf8")
        .replace(/^\s*--.*$/gm, "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s))
    );
  }
  for (const [id, role] of [
    ["admin", "admin"],
    ["target", "supervisor"],
  ]) {
    await db
      .prepare("INSERT INTO users(id,status,role) VALUES (?,'active',?)")
      .bind(id, role)
      .run();
    await db
      .prepare(
        "INSERT INTO telegram_identities(user_id,telegram_user_id) VALUES (?,?)"
      )
      .bind(id, id === "admin" ? "1" : "2")
      .run();
    await db
      .prepare(
        "INSERT INTO web_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)"
      )
      .bind(
        await hashToken((id === "admin" ? "a" : "b").repeat(64)),
        id,
        Date.now(),
        Date.now() + 3600000
      )
      .run();
  }
  const app = createApp();
  const request = (path, init = {}, database = db, token = "a".repeat(64)) =>
    app.request(
      "/admin/users" + path,
      {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
      },
      { DB: database }
    );
  const ticket = async (duration = 20000) => {
    const { now } = await db
      .prepare("SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now")
      .first();
    return `web:${now + duration}:${crypto.randomUUID()}`;
  };
  const post = (
    operationId,
    action = "disable",
    database = db,
    role = "supervisor"
  ) =>
    request(
      "/" + action,
      {
        method: "POST",
        body: JSON.stringify({
          operationId,
          userId: "target",
          ...(["role", "approve"].includes(action) ? { role } : {}),
        }),
      },
      database
    );
  const outcome = async (operationId) => {
    const response = await request("/operations/" + operationId);
    assert.equal(response.status, 200);
    return response.json();
  };
  const status = async () =>
    (await db.prepare("SELECT status FROM users WHERE id = 'target'").first())
      .status;
  const count = async () =>
    (await db.prepare("SELECT count(*) AS n FROM access_audit").first()).n;
  const pauseBatch = () => {
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
  return {
    db,
    request,
    ticket,
    post,
    outcome,
    status,
    count,
    pauseBatch,
  };
}

test("Admin operation lookup fences late writes without new persistence", async (t) => {
  const { db, request, ticket, post, outcome, status, count, pauseBatch } =
    await setup(t);
  await t.test(
    "server issues bounded database-clock IDs; strict Admin-only lookup",
    async () => {
      const response = await request("/operations/new");
      assert.equal(response.status, 200);
      const { operationId } = await response.json();
      assert.match(operationId, /^web:[0-9]{13}:/);
      assert.deepEqual(await outcome(operationId), { status: "pending" });
      for (const path of ["/operations/new", "/operations/" + operationId]) {
        assert.equal((await request(path, {}, db, "b".repeat(64))).status, 403);
        assert.equal((await request(path, {}, db, "c".repeat(64))).status, 401);
      }
      assert.equal((await request("/operations/invalid")).status, 400);
      assert.equal(
        (
          await request("/disable", {
            method: "POST",
            body: JSON.stringify({ userId: "target" }),
          })
        ).status,
        400
      );
    }
  );
  await t.test(
    "one account GET before a delayed batch cannot establish completion",
    async () => {
      const operationId = await ticket();
      const paused = pauseBatch();
      const response = post(operationId, "disable", paused.db);
      await paused.entered;
      try {
        assert.equal(
          (await (await request("/target")).json()).status,
          "active"
        );
        assert.deepEqual(await outcome(operationId), { status: "pending" });
      } finally {
        paused.release();
      }
      assert.equal((await response).status, 200);
      assert.deepEqual(await outcome(operationId), { status: "committed" });
      assert.equal(await status(), "disabled");
      assert.equal((await post(await ticket(), "enable")).status, 200);
    }
  );
  await t.test(
    "post-cutoff primary lookup is terminal; a queued POST cannot commit later",
    async () => {
      const operationId = await ticket(2000);
      const before = await count();
      const paused = pauseBatch();
      const response = post(operationId, "disable", paused.db);
      await paused.entered;
      try {
        assert.deepEqual(await outcome(operationId), { status: "pending" });
        await pastDeadline(operationId);
        assert.deepEqual(await outcome(operationId), {
          status: "not_committed",
        });
      } finally {
        paused.release();
      }
      assert.equal((await response).status, 409);
      assert.equal(await status(), "active");
      assert.equal(await count(), before);
      assert.deepEqual(await outcome(operationId), { status: "not_committed" });
    }
  );
  await t.test(
    "dropped response after commit is found; replay cannot reapply an old audit",
    async () => {
      const operationId = await ticket();
      const before = await count();
      const lostResponseDB = {
        prepare: db.prepare.bind(db),
        batch: async (statements) => {
          await db.batch(statements);
          throw new Error("lost after commit");
        },
      };
      assert.equal(
        (await post(operationId, "disable", lostResponseDB)).status,
        503
      );
      assert.deepEqual(await outcome(operationId), { status: "committed" });
      assert.equal(await status(), "disabled");
      assert.equal(await count(), before + 1);
      assert.equal((await post(await ticket(), "enable")).status, 200);
      assert.equal((await post(operationId)).status, 409);
      assert.equal(await status(), "active");
      assert.equal(await count(), before + 2);
    }
  );
  await t.test(
    "no-op and rejection without audit terminate at cutoff, not at expected account state",
    async () => {
      for (const action of ["enable", "approve"]) {
        const operationId = await ticket(2000);
        const before = await count();
        assert.equal(
          (await post(operationId, action)).status,
          action === "enable" ? 200 : 409
        );
        assert.equal(await count(), before);
        assert.deepEqual(await outcome(operationId), { status: "pending" });
        await pastDeadline(operationId);
        assert.deepEqual(await outcome(operationId), {
          status: "not_committed",
        });
        assert.equal(await status(), "active");
      }
    }
  );
  await t.test(
    "cutoff applies to approval/rejection and all management audit writes",
    async () => {
      await db
        .prepare(
          "UPDATE users SET status='pending',role=NULL WHERE id='target'"
        )
        .run();
      const before = await count();
      const expired = await ticket(-1000);
      for (const action of ["approve", "reject"])
        assert.equal((await post(expired, action)).status, 409);
      assert.equal(await status(), "pending");
      assert.equal(await count(), before);
      await db
        .prepare(
          "UPDATE users SET status='active',role='supervisor' WHERE id='target'"
        )
        .run();
      for (const action of ["role", "disable"])
        assert.equal((await post(expired, action, db, "admin")).status, 409);
      assert.equal(
        (await db.prepare("SELECT role FROM users WHERE id = 'target'").first())
          .role,
        "supervisor"
      );
      assert.equal(await status(), "active");
      assert.equal(await count(), before);
      await db
        .prepare("UPDATE users SET status='disabled' WHERE id='target'")
        .run();
      await post(expired, "enable");
      assert.equal(await status(), "disabled");
      assert.equal(await count(), before);
      assert.deepEqual(await outcome(expired), { status: "not_committed" });
      // A client cannot extend the executable window arbitrarily.
      await post(await ticket(3600000), "enable");
      assert.equal(await status(), "disabled");
      assert.equal(await count(), before);
    }
  );
  await t.test(
    "transaction failure produces no committed receipt or partial account change",
    async () => {
      await db
        .prepare("UPDATE users SET status='active' WHERE id='target'")
        .run();
      const operationId = await ticket(-1000);
      const before = await count();
      const failDB = {
        prepare: db.prepare.bind(db),
        batch: (statements) =>
          db.batch([
            ...statements,
            db.prepare("SELECT * FROM nonexistent_table"),
          ]),
      };
      assert.equal((await post(operationId, "disable", failDB)).status, 503);
      assert.deepEqual(await outcome(operationId), { status: "not_committed" });
      assert.equal(await status(), "active");
      assert.equal(await count(), before);
      const live = await ticket();
      assert.equal((await post(live, "disable", failDB)).status, 503);
      assert.deepEqual(await outcome(live), { status: "pending" });
      assert.equal(await status(), "active");
      assert.equal(await count(), before);
    }
  );
});
