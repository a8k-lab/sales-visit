import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import { IdentityOperations } from "../src/identity.ts";
import { createApp } from "../src/index.ts";
import { hashToken } from "../src/web-auth.ts";

const operation = () => `web:${Date.now() + 20000}:${crypto.randomUUID()}`;

async function setup(t) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-11-02",
      script: 'export default {fetch(){return new Response("fixture")}}',
      d1Databases: { DB: "demo-test" },
    })
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  const apply = async (sql) =>
    db.batch(
      sql
        .replace(/^\s*--.*$/gm, "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s))
    );
  const dir = new URL("../../../packages/db/migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .toSorted())
    await apply(readFileSync(new URL(file, dir), "utf8"));
  const seed = () =>
    apply(readFileSync(new URL("../seeds/demo.sql", import.meta.url), "utf8"));
  await seed();
  const app = createApp();
  const env = {
    DB: db,
    APP_ENV: "local",
    DEMO_AUTH_ENABLED: "true",
    WEB_ORIGINS: "http://localhost:5173",
  };
  const request = (path, init = {}, overrides = {}) =>
    app.request(path, init, { ...env, ...overrides });
  const post = (path, data, token, overrides) =>
    request(
      path,
      {
        method: "POST",
        body: JSON.stringify(data),
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
      overrides
    );
  const login = async (id = "demo-admin-01", overrides) => {
    const response = await post(
      "/auth/demo/login",
      { userId: id },
      null,
      overrides
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  const authed = (path, token, overrides) =>
    request(path, { headers: { Authorization: `Bearer ${token}` } }, overrides);
  const count = async (table) =>
    (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;
  return { db, seed, request, post, login, authed, operation, count };
}

test("demo is explicitly local/staging only, independent of Telegram configuration", async (t) => {
  const f = await setup(t);
  for (const APP_ENV of ["local", "staging"]) {
    assert.equal(
      (await f.request("/auth/demo/accounts", {}, { APP_ENV })).status,
      200
    );
    assert.equal(
      (await f.login("demo-admin-01", { APP_ENV })).account.name,
      "Budi Santoso"
    );
  }
  for (const config of [
    { APP_ENV: "production" },
    { APP_ENV: "" },
    { APP_ENV: undefined },
    { APP_ENV: "preview" },
    { DEMO_AUTH_ENABLED: undefined },
    { DEMO_AUTH_ENABLED: "false" },
    { DEMO_AUTH_ENABLED: "TRUE" },
  ]) {
    assert.equal(
      (await f.request("/auth/demo/accounts", {}, config)).status,
      404
    );
    assert.equal(
      (
        await f.post(
          "/auth/demo/login",
          { userId: "demo-admin-01" },
          null,
          config
        )
      ).status,
      404
    );
  }
  assert.equal((await f.request("/auth/config")).status, 503);
  const items = (await (await f.request("/auth/demo/accounts")).json()).items;
  assert.equal(items.length, 20);
  assert.deepEqual(
    Object.fromEntries(
      ["admin", "supervisor", "sales_force"].map((role) => [
        role,
        items.filter((i) => i.role === role).length,
      ])
    ),
    { admin: 2, supervisor: 4, sales_force: 14 }
  );
});

test("disabled, malformed, unassociated, and Telegram-linked users cannot demo login", async (t) => {
  const f = await setup(t);
  await f.db
    .prepare("UPDATE users SET status='disabled' WHERE id='demo-sf-01'")
    .run();
  await f.db
    .prepare("UPDATE users SET display_name='  ' WHERE id='demo-sf-02'")
    .run();
  await f.db
    .prepare("UPDATE users SET sales_force_id=NULL WHERE id='demo-sf-03'")
    .run();
  await f.db
    .prepare(
      "INSERT INTO telegram_identities(user_id,telegram_user_id,first_name) VALUES ('demo-sf-04','123456','Profil Telegram')"
    )
    .run();
  await f.db
    .prepare(
      "INSERT INTO users(id, display_name) VALUES ('pending','Menunggu')"
    )
    .run();
  for (const userId of [
    "demo-sf-01",
    "demo-sf-02",
    "demo-sf-03",
    "demo-sf-04",
    "pending",
    "missing",
  ])
    assert.equal((await f.post("/auth/demo/login", { userId })).status, 401);
  const items = (await (await f.request("/auth/demo/accounts")).json()).items;
  assert.equal(items.length, 16);
  for (const input of [
    {},
    null,
    [],
    { userId: 4 },
    { userId: "" },
    { userId: "demo-admin-01", role: "admin" },
  ])
    assert.equal((await f.post("/auth/demo/login", input)).status, 400);
  // Telegram's live session profile and Bot contract still use the linked identity.
  const session = await f.login();
  await f.db
    .prepare("UPDATE web_sessions SET user_id='demo-sf-04' WHERE token_hash=?")
    .bind(await hashToken(session.token))
    .run();
  assert.equal(
    (await (await f.authed("/auth/me", session.token)).json()).account.name,
    "Profil Telegram"
  );
  const bot = await new IdentityOperations(f.db).me({
    telegramUserId: "123456",
  });
  assert.equal(bot.data.telegramUserId, "123456");
  assert.equal(bot.data.firstName, "Profil Telegram");
});

test("opaque D1 sessions enforce live roles, disabling, expiry and logout", async (t) => {
  const f = await setup(t);
  const { token, expiresAt } = await f.login("demo-supervisor-01");
  assert.match(token, /^[a-f0-9]{64}$/);
  const row = await f.db
    .prepare("SELECT * FROM web_sessions WHERE token_hash=?")
    .bind(await hashToken(token))
    .first();
  assert.notEqual(row.token_hash, token);
  assert.equal(row.expires_at, expiresAt);
  assert.equal((await f.authed("/admin/users", token)).status, 403);
  await f.db
    .prepare("UPDATE users SET role='admin' WHERE id='demo-supervisor-01'")
    .run();
  assert.equal((await f.authed("/admin/users", token)).status, 200);
  await f.db
    .prepare("UPDATE users SET status='disabled' WHERE id='demo-supervisor-01'")
    .run();
  assert.equal((await f.authed("/auth/me", token)).status, 401);
  assert.equal((await f.post("/auth/logout", {}, token)).status, 200);
  await f.db
    .prepare("UPDATE users SET status='active' WHERE id='demo-supervisor-01'")
    .run();
  assert.equal((await f.authed("/auth/me", token)).status, 401);
  const second = await f.login();
  await f.db
    .prepare("UPDATE web_sessions SET expires_at=? WHERE token_hash=?")
    .bind(Date.now() - 1, await hashToken(second.token))
    .run();
  assert.equal((await f.authed("/auth/me", second.token)).status, 401);
});

test("Admin demo creation is audited, guarded, atomic and association-exclusive", async (t) => {
  const f = await setup(t);
  const admin = await f.login();
  const supervisor = await f.login("demo-supervisor-01");
  const input = {
    displayName: "  Wulan Safitri  ",
    role: "supervisor",
    operationId: f.operation(),
  };
  assert.equal((await f.post("/admin/users/demo", input)).status, 401);
  assert.equal(
    (await f.post("/admin/users/demo", input, supervisor.token)).status,
    403
  );
  assert.equal(
    (
      await f.post("/admin/users/demo", input, admin.token, {
        APP_ENV: "production",
      })
    ).status,
    404
  );
  const response = await f.post("/admin/users/demo", input, admin.token);
  assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.equal((await f.login(id)).account.name, "Wulan Safitri");
  assert.equal(await f.count("telegram_identities"), 0);
  const audit = await f.db
    .prepare("SELECT * FROM access_audit WHERE target_user_id=?")
    .bind(id)
    .first();
  assert.equal(audit.actor_user_id, "demo-admin-01");
  assert.equal(audit.action, "register");
  assert.equal(JSON.parse(audit.after_state).displayName, "Wulan Safitri");
  assert.equal(
    (await f.post("/admin/users/demo", input, admin.token)).status,
    409
  );
  assert.equal(await f.count("users"), 21);
  const page = await (await f.authed("/admin/users", admin.token)).json();
  assert.equal(page.items.find((item) => item.id === id).telegramUserId, null);
  assert.equal(
    page.items.find((item) => item.id === id).displayName,
    "Wulan Safitri"
  );
  for (const data of [
    { displayName: "", role: "admin" },
    { displayName: "A", role: "sales_force" },
    { displayName: "A", role: "admin", salesForceId: "x" },
    { displayName: "A", role: "other" },
  ])
    assert.equal(
      (
        await f.post(
          "/admin/users/demo",
          { ...data, operationId: f.operation() },
          admin.token
        )
      ).status,
      400
    );
  for (const sf of ["missing", "demo-sf-01"])
    assert.equal(
      (
        await f.post(
          "/admin/users/demo",
          {
            displayName: "A",
            role: "sales_force",
            salesForceId: sf,
            operationId: f.operation(),
          },
          admin.token
        )
      ).status,
      409
    );
  await f.db
    .prepare("INSERT INTO sales_force(id,name) VALUES ('free','Belum Diklaim')")
    .run();
  const create = () =>
    f.post(
      "/admin/users/demo",
      {
        displayName: "Andi",
        role: "sales_force",
        salesForceId: "free",
        operationId: f.operation(),
      },
      admin.token
    );
  assert.deepEqual(
    (await Promise.all([create(), create()])).map((r) => r.status).toSorted(),
    [201, 409]
  );
  const before = await f.count("users");
  // A failed audit must roll back the account INSERT as well.
  const auditsBefore = await f.count("access_audit");
  await f.db
    .prepare(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON access_audit BEGIN SELECT RAISE(ABORT, 'private audit failure'); END"
    )
    .run();
  assert.equal(
    (
      await f.post(
        "/admin/users/demo",
        { ...input, operationId: f.operation() },
        admin.token
      )
    ).status,
    503
  );
  assert.equal(await f.count("users"), before);
  assert.equal(await f.count("access_audit"), auditsBefore);
  await f.db.prepare("DROP TRIGGER fail_audit").run();
  assert.equal(
    (
      await f.post(
        "/admin/users/demo",
        {
          ...input,
          operationId: `web:${Date.now() - 1000}:${crypto.randomUUID()}`,
        },
        admin.token
      )
    ).status,
    409
  );
});

test("creation rechecks live Admin authority in the transaction", async (t) => {
  const f = await setup(t);
  const admin = await f.login();
  const before = await f.count("users");
  for (const [change, expected] of [
    ["role='supervisor'", 403],
    ["status='disabled'", 401],
  ]) {
    await f.db
      .prepare(
        "UPDATE users SET status='active', role='admin' WHERE id='demo-admin-01'"
      )
      .run();
    const database = {
      prepare: f.db.prepare.bind(f.db),
      batch: async (statements) =>
        (
          await f.db.batch([
            f.db.prepare(`UPDATE users SET ${change} WHERE id='demo-admin-01'`),
            ...statements,
          ])
        ).slice(1),
    };
    const response = await f.post(
      "/admin/users/demo",
      {
        displayName: "Tidak Boleh Dibuat",
        role: "supervisor",
        operationId: f.operation(),
      },
      admin.token,
      { DB: database }
    );
    assert.equal(response.status, expected);
    assert.equal(await f.count("users"), before);
    assert.equal(await f.count("access_audit"), 0);
  }
});

test("demo lifecycle mutations preserve Admin protection and Sales Force ownership", async (t) => {
  const f = await setup(t);
  const admin = await f.login();
  const sf = await f.login("demo-sf-01");
  const mutate = (action, userId, rest = {}) =>
    f.post(
      `/admin/users/${action}`,
      { userId, operationId: f.operation(), ...rest },
      admin.token
    );
  assert.equal(
    (await mutate("role", "demo-sf-01", { role: "supervisor" })).status,
    200
  );
  assert.equal(
    (await (await f.authed("/auth/me", sf.token)).json()).account.role,
    "supervisor"
  );
  assert.equal((await mutate("disable", "demo-sf-01")).status, 200);
  assert.equal((await f.authed("/auth/me", sf.token)).status, 401);
  assert.equal((await mutate("enable", "demo-sf-01")).status, 200);
  assert.equal(
    (
      await mutate("role", "demo-sf-01", {
        role: "sales_force",
        salesForceId: "demo-sf-02",
      })
    ).status,
    409
  );
  assert.equal(
    (
      await mutate("role", "demo-sf-01", {
        role: "sales_force",
        salesForceId: "demo-sf-01",
      })
    ).status,
    200
  );
  assert.equal((await mutate("disable", "demo-admin-01")).status, 409);
  assert.equal(
    (await mutate("role", "demo-admin-02", { role: "supervisor" })).status,
    409
  );
});

test("deterministic seeds preserve existing data and real role-based monitoring scopes", async (t) => {
  const f = await setup(t);
  const counts = {};
  for (const table of [
    "users",
    "sales_force",
    "outlets",
    "products",
    "visits",
    "stock_reports",
    "stock_report_items",
    "visit_schedules",
    "sales_force_supervisors",
  ])
    counts[table] = await f.count(table);
  assert.equal(counts.visits, 156);
  assert.equal(counts.stock_reports, 78);
  assert.equal(counts.visit_schedules, 98);
  await f.db
    .prepare(
      "UPDATE users SET display_name='Nama Dipertahankan' WHERE id='demo-admin-01'"
    )
    .run();
  await f.seed();
  await f.seed();
  for (const [table, n] of Object.entries(counts))
    assert.equal(await f.count(table), n);
  assert.equal((await f.login()).account.name, "Nama Dipertahankan");
  assert.equal(await f.count("telegram_identities"), 0);
  const assignments = await f.db
    .prepare(
      "SELECT supervisor_user_id AS id,count(*) AS n FROM sales_force_supervisors GROUP BY supervisor_user_id ORDER BY id"
    )
    .all();
  assert.deepEqual(
    assignments.results.map((r) => r.n),
    [4, 5, 5]
  );
  for (const [userId, total] of [
    ["demo-supervisor-01", 20],
    ["demo-supervisor-02", 70],
    ["demo-supervisor-03", 66],
    ["demo-supervisor-04", 0],
    ["demo-sf-01", 2],
    ["demo-sf-13", 0],
  ]) {
    const { token } = await f.login(userId);
    const response = await f.authed("/visits?view=page&limit=100", token);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.total, total, userId);
  }
  const admin = await f.login();
  const botUsers = await new IdentityOperations(f.db).users({
    telegramUserId: "123",
  });
  assert.equal(botUsers.code, "forbidden");
  const supervisors = await (
    await f.authed("/supervisors", admin.token)
  ).json();
  assert.equal(supervisors.items[0].name, "Agus Setiawan");
});

test("credentialed Access requests use exact origins and bounded preflights", async (t) => {
  const f = await setup(t);
  const response = await f.request("/auth/demo/accounts", {
    headers: { Origin: "http://localhost:5173" },
  });
  assert.equal(
    response.headers.get("Access-Control-Allow-Credentials"),
    "true"
  );
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:5173"
  );
  assert.equal(
    (
      await f.request("/auth/demo/accounts", {
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403
  );
  assert.equal(
    (
      await f.request("/auth/demo/login", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,content-type",
        },
      })
    ).status,
    204
  );
});
