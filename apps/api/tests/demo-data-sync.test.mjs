import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import { createApp } from "../src/index.ts";
import { hashToken } from "../src/web-auth.ts";

const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/bot-service.ts", import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
const { botService } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);

async function setup(t) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-11-02",
      script: 'export default {fetch(){return new Response("fixture")}}',
      d1Databases: { DB: "shared-demo" },
    })
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  const apply = (sql) =>
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
  const env = { DB: db, APP_ENV: "local", DEMO_AUTH_ENABLED: "true" };
  const app = createApp();
  const api = botService(env);
  const actor = { telegramUserId: "900" };
  const request = (path, token, init = {}) =>
    app.request(
      path,
      {
        ...init,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      },
      env
    );
  const login = async (id) => {
    const response = await request("/auth/demo/login", null, {
      method: "POST",
      body: JSON.stringify({ userId: id }),
    });
    assert.equal(response.status, 200);
    const web = await response.json();
    const bot = await api.demoLogin(actor, id);
    assert.equal(bot.ok, true);
    assert.equal(bot.data.account.id, web.account.id);
    return web.token;
  };
  const schedules = async (token, own, filter = {}) => {
    let after,
      all = [];
    do {
      const input = { ...filter, ...(after ? { after } : {}) };
      const bot = await api[own ? "ownSchedule" : "listSchedules"](
        actor,
        input
      );
      assert.equal(bot.ok, true);
      const query = new URLSearchParams(
        Object.entries(input).map(([k, v]) => [
          k === "weekday" ? "weekday" : k,
          String(v),
        ])
      );
      const response = await request(`/schedules?${query}`, token);
      assert.equal(response.status, 200);
      const web = await response.json();
      assert.deepEqual(web, bot.data); // Same query, projection, scopes and cursors.
      all.push(...web.items);
      after = web.next;
    } while (after);
    return all;
  };
  const outlets = async (token) => {
    let after,
      all = [];
    do {
      const bot = await api.listOutlets(actor, after ? { after } : {});
      assert.equal(bot.ok, true);
      all.push(...bot.data.items);
      after = bot.data.next;
    } while (after);
    const response = await request("/outlets", token);
    assert.equal(response.status, 200);
    assert.deepEqual(
      await response.json(),
      all.map(({ id, name }) => ({ id, name }))
    );
    return all;
  };
  return { db, api, actor, env, seed, login, request, schedules, outlets };
}

test("Web and Telegram share accounts, seeded schedules, outlet records and live role/team scopes", async (t) => {
  const f = await setup(t);
  const accounts = await (await f.request("/auth/demo/accounts")).json();
  assert.deepEqual((await f.api.demoAccounts(f.actor)).items, accounts.items);
  assert.equal((await f.request("/schedules")).status, 401);
  for (const [id, own, expected] of [
    ["demo-admin-01", false, 98],
    ["demo-supervisor-01", false, 28],
    ["demo-supervisor-02", false, 35],
    ["demo-supervisor-04", false, 0],
    ["demo-sf-01", true, 7],
    ["demo-sf-14", true, 7],
  ]) {
    const token = await f.login(id);
    const rows = await f.schedules(token, own);
    assert.equal(rows.length, expected, id);
    for (const weekday of [1, 7])
      assert.equal(
        (await f.schedules(token, own, { weekday })).length,
        expected / 7
      );
    if (!own) {
      const outlets = await f.outlets(token);
      assert.equal(outlets.length, 35);
      const first = outlets[0];
      const detail = await (
        await f.request(`/outlets/${first.id}`, token)
      ).json();
      assert.deepEqual(detail, {
        id: first.id,
        name: first.name,
        businessId: first.businessId,
        noRs: first.noRs,
      });
      const page = await (
        await f.request("/outlets?view=page&limit=10&offset=10", token)
      ).json();
      assert.deepEqual(
        page.items,
        outlets
          .slice(10, 20)
          .map((outlet) => ({ id: outlet.id, name: outlet.name }))
      );
      assert.equal(page.total, 35);
    } else {
      assert.ok(rows.every((row) => row.salesForceId === id));
      // /jadwal already includes the permitted Outlet details for this SF.
      for (const row of rows) {
        const outlet = await (
          await f.request(`/outlets/${row.outletId}`, token)
        ).json();
        assert.equal(row.outletName, outlet.name);
        assert.equal(row.outletBusinessId, outlet.businessId);
        assert.equal(row.outletNoRs, outlet.noRs);
      }
      assert.equal((await f.api.listSchedules(f.actor)).code, "forbidden");
      assert.equal(
        (await f.request("/schedules?salesForceId=demo-sf-02", token)).status,
        403
      );
      assert.equal(
        (await f.api.ownSchedule(f.actor, { salesForceId: "demo-sf-02" })).code,
        "invalid"
      );
    }
    for (const method of [
      "createOutlet",
      "updateOutlet",
      "deleteOutlet",
      "createSchedule",
      "visitWizard",
      "approve",
      "disable",
    ])
      assert.equal((await f.api[method](f.actor, {})).code, "forbidden");
    assert.equal(
      (await f.request("/schedules", token, { method: "POST", body: "{}" }))
        .status,
      404
    );
  }
  const supervisor = await f.login("demo-supervisor-01");
  assert.equal(
    (await f.schedules(supervisor, false, { salesForceId: "demo-sf-05" }))
      .length,
    0
  );
  await f.db
    .prepare(
      "UPDATE sales_force_supervisors SET supervisor_user_id='demo-supervisor-04' WHERE sales_force_id='demo-sf-01'"
    )
    .run();
  assert.equal((await f.schedules(supervisor, false)).length, 21);
  for (const query of [
    "weekday=0",
    "weekday=1.0",
    "weekday=1&weekday=2",
    "after=",
    "owner=demo-admin-01",
    "telegramUserId=123",
  ])
    assert.equal(
      (await f.request(`/schedules?${query}`, supervisor)).status,
      400,
      query
    );
});

test("real and mixed-provenance records stay hidden in BOTH demo channels; normal authentication is unchanged", async (t) => {
  const f = await setup(t);
  const real = { telegramUserId: "901" };
  await f.api.register(real);
  await f.db.batch([
    f.db.prepare(
      "UPDATE users SET role='admin',status='active' WHERE id=(SELECT user_id FROM telegram_identities WHERE telegram_user_id='901')"
    ),
    f.db.prepare(
      "INSERT INTO outlets(id,name,business_id) VALUES ('real-out','Private Outlet','PRIVATE')"
    ),
    f.db.prepare(
      "INSERT INTO sales_force(id,name) VALUES ('real-sf','Private SF')"
    ),
    f.db.prepare(
      "INSERT INTO visit_schedules(id,sales_force_id,outlet_id,weekday) VALUES ('real-plan','demo-sf-01','real-out',1)"
    ),
    f.db.prepare(
      "INSERT INTO visit_schedules(id,sales_force_id,outlet_id,weekday,demo_only) VALUES ('mixed-plan','real-sf','demo-out-01',1,1)"
    ),
  ]);
  const token = await f.login("demo-admin-01");
  assert.equal((await f.outlets(token)).length, 35);
  assert.equal((await f.schedules(token, false)).length, 98);
  assert.equal((await f.request("/outlets/real-out", token)).status, 404);
  assert.equal(
    (await f.api.getOutlet(f.actor, { businessId: "PRIVATE" })).code,
    "not_found"
  );
  for (const path of [
    "/sales-force",
    "/sales-force?view=page",
    "/outlets?view=page",
  ])
    assert.ok(
      !JSON.stringify(await (await f.request(path, token)).json()).includes(
        "Private"
      )
    );
  assert.equal(
    (await f.api.updateOutlet(f.actor, { id: "real-out", name: "Tampered" }))
      .code,
    "forbidden"
  );
  assert.equal(
    (await f.api.deleteOutlet(f.actor, { id: "real-out" })).code,
    "forbidden"
  );
  assert.equal(
    (await f.db.prepare("SELECT name FROM outlets WHERE id='real-out'").first())
      .name,
    "Private Outlet"
  );
  assert.equal(
    (await f.request("/visits", token, { method: "POST", body: "{}" })).status,
    401
  );
  const identity = await f.api.me(real);
  const realToken = "a".repeat(64);
  await f.db
    .prepare(
      "INSERT INTO web_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)"
    )
    .bind(
      await hashToken(realToken),
      identity.data.id,
      Date.now(),
      Date.now() + 3600000
    )
    .run();
  const normal = await (await f.request("/outlets", realToken)).json();
  assert.ok(normal.some((o) => o.id === "real-out"));
  assert.ok(
    (await f.api.listOutlets(real)).data.items.some((o) => o.id === "real-out")
  );
  assert.equal((await f.request("/outlets/real-out", realToken)).status, 200);
  const expired = Date.now() - 1;
  await f.db
    .prepare(
      "UPDATE telegram_demo_sessions SET created_at=?,expires_at=? WHERE telegram_user_id='900'"
    )
    .bind(expired - 3600000, expired)
    .run();
  assert.equal((await f.api.demoStatus(f.actor)).data, null);
  assert.equal((await f.api.ownSchedule(f.actor)).code, "forbidden");
  assert.equal(
    (
      await f.db
        .prepare("SELECT count(*) AS n FROM telegram_identities")
        .first()
    ).n,
    1
  );
});

test("shared reseed repairs pre-0012 provenance without duplicates or overwriting legacy edits/real collisions", async (t) => {
  const f = await setup(t);
  // Equivalent to legacy synthetic rows receiving migration 0012's DEFAULT 0.
  await f.db.batch([
    f.db.prepare("UPDATE outlets SET demo_only=0"),
    f.db.prepare("UPDATE sales_force SET demo_only=0"),
    f.db.prepare("UPDATE visit_schedules SET demo_only=0"),
  ]);
  const token = await f.login("demo-sf-01");
  assert.equal((await f.schedules(token, true)).length, 0);
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM visit_schedules").first()).n,
    98
  ); // Not missing seed data.
  await f.seed();
  await f.seed();
  assert.equal((await f.schedules(token, true)).length, 7);
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM visit_schedules").first()).n,
    98
  );
  await f.db.batch([
    f.db.prepare(
      "UPDATE outlets SET demo_only=0, name='Real business collision' WHERE id='demo-out-01'"
    ),
    f.db.prepare(
      "UPDATE sales_force SET demo_only=0, name='Real staff collision' WHERE id='demo-sf-02'"
    ),
    f.db.prepare(
      "UPDATE visit_schedules SET demo_only=0, id='custom-plan' WHERE id='demo-schedule-demo-sf-01-1'"
    ),
    f.db.prepare(
      "UPDATE visit_schedules SET demo_only=0, weekday=2 WHERE id='demo-schedule-demo-sf-02-1'"
    ),
    f.db.prepare(
      "INSERT INTO telegram_identities(user_id,telegram_user_id) VALUES ('demo-sf-03','333')"
    ),
    f.db.prepare("UPDATE sales_force SET demo_only=0 WHERE id='demo-sf-03'"),
  ]);
  const tables = [
    "outlets",
    "sales_force",
    "visit_schedules",
    "users",
    "telegram_identities",
    "visits",
    "stock_reports",
    "stock_report_items",
  ];
  const before = await Promise.all(
    tables.map((table) =>
      f.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()
    )
  );
  await f.seed();
  await f.seed();
  for (const [i, table] of tables.entries()) {
    const after = await f.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
    assert.deepEqual(
      after.results.map(({ demo_only: _flag, ...row }) => row),
      before[i].results.map(({ demo_only: _flag, ...row }) => row),
      table
    );
  }
  for (const [table, id] of [
    ["outlets", "demo-out-01"],
    ["sales_force", "demo-sf-02"],
    ["sales_force", "demo-sf-03"],
    ["visit_schedules", "custom-plan"],
    ["visit_schedules", "demo-schedule-demo-sf-02-1"],
  ])
    assert.equal(
      (
        await f.db
          .prepare(`SELECT demo_only FROM ${table} WHERE id=?`)
          .bind(id)
          .first()
      ).demo_only,
      0
    );
  assert.equal((await f.schedules(token, true)).length, 6); // Edited custom plan stays unclassified, not duplicated.
  await f.db
    .prepare("DELETE FROM visit_schedules WHERE sales_force_id='demo-sf-13'")
    .run();
  const emptyToken = await f.login("demo-sf-13");
  assert.equal((await f.schedules(emptyToken, true)).length, 0);
  await f.seed();
  await f.seed();
  assert.equal((await f.schedules(emptyToken, true)).length, 7);
  assert.deepEqual(
    (await f.db.prepare("PRAGMA foreign_key_check").all()).results,
    []
  );
});
