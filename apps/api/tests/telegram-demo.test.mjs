import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

// Match the Worker bundling boundary, including existing TypeScript parameter properties.
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
      d1Databases: { DB: "telegram-demo" },
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
  await apply(
    readFileSync(new URL("../seeds/demo.sql", import.meta.url), "utf8")
  );
  const env = { DB: db, APP_ENV: "local", DEMO_AUTH_ENABLED: "true" };
  const api = botService(env);
  const actor = { telegramUserId: "900" };
  const login = async (id, sender = actor) => {
    const choices = await api.demoAccounts(sender);
    assert.equal(choices.ok, true);
    const choice = choices.items.find((item) => item.id === id);
    assert.ok(choice);
    const result = await api.demoSelect(sender, choice.token);
    assert.equal(result.ok, true);
    return result.data;
  };
  const count = async (table) =>
    (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;
  return { api, db, env, actor, login, count };
}

test("demo sessions persist, take precedence, switch accounts, expire and logout without relinking identities", async (t) => {
  const f = await setup(t);
  await f.api.register(f.actor);
  await f.db
    .prepare(
      "UPDATE users SET status='active', role='admin' WHERE id=(SELECT user_id FROM telegram_identities WHERE telegram_user_id='900')"
    )
    .run();
  const real = (await f.api.me(f.actor)).data;
  const before = await f.db.prepare("SELECT * FROM telegram_identities").all();
  const session = await f.login("demo-sf-01");
  assert.ok(session.expiresAt > Date.now() + 3590000);
  assert.equal((await botService(f.env).me(f.actor)).data.id, "demo-sf-01");
  assert.equal((await f.api.listSchedules(f.actor)).code, "forbidden");
  assert.equal((await f.api.ownSchedule(f.actor)).data.items.length, 7);
  await f.login("demo-admin-01");
  assert.equal((await f.api.ownSchedule(f.actor)).code, "forbidden");
  assert.equal((await f.api.listSchedules(f.actor)).ok, true);
  assert.equal(await f.count("telegram_demo_sessions"), 1);
  await f.api.demoLogout(f.actor);
  assert.equal((await f.api.me(f.actor)).data.id, real.id);
  assert.equal((await f.api.demoStatus(f.actor)).data, null);
  await f.login("demo-supervisor-01");
  const expiredAt = Date.now() - 1;
  await f.db
    .prepare(
      "UPDATE telegram_demo_sessions SET created_at=?, expires_at=? WHERE telegram_user_id='900'"
    )
    .bind(expiredAt - 3600000, expiredAt)
    .run();
  assert.equal((await f.api.me(f.actor)).data.id, real.id);
  assert.equal((await f.api.demoStatus(f.actor)).data, null);
  assert.deepEqual(
    (await f.db.prepare("SELECT * FROM telegram_identities").all()).results,
    before.results
  );
});

test("picker tokens bind owner, expire, are single-use, reject replay and recheck Web demo eligibility", async (t) => {
  const f = await setup(t);
  let choices = await f.api.demoAccounts(f.actor);
  assert.equal(choices.items.length, 20);
  const token = choices.items.find((i) => i.id === "demo-admin-01").token;
  assert.equal(
    (await f.api.demoSelect({ telegramUserId: "901" }, token)).code,
    "expired"
  );
  assert.equal((await f.api.demoStatus(f.actor)).data, null);
  for (const malformed of [
    null,
    {},
    "",
    "demo-admin-01",
    token + "x",
    token + "\n",
    token.toUpperCase(),
  ])
    assert.equal((await f.api.demoSelect(f.actor, malformed)).code, "invalid");
  const results = await Promise.all([
    f.api.demoSelect(f.actor, token),
    f.api.demoSelect(f.actor, token),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal((await f.api.demoSelect(f.actor, token)).code, "expired");
  choices = await f.api.demoAccounts(f.actor);
  await f.api.demoLogout(f.actor);
  assert.equal(
    (await f.api.demoSelect(f.actor, choices.items[0].token)).code,
    "expired"
  );
  choices = await f.api.demoAccounts(f.actor);
  await f.api.demoAccounts(f.actor);
  assert.equal(
    (await f.api.demoSelect(f.actor, choices.items[0].token)).code,
    "expired"
  );
  choices = await f.api.demoAccounts(f.actor);
  await f.db.prepare("UPDATE telegram_demo_choices SET expires_at=0").run();
  assert.equal(
    (await f.api.demoSelect(f.actor, choices.items[0].token)).code,
    "expired"
  );
  choices = await f.api.demoAccounts(f.actor);
  await f.db
    .prepare(
      "INSERT INTO telegram_identities(user_id,telegram_user_id) VALUES ('demo-admin-01','123')"
    )
    .run();
  assert.equal(
    (
      await f.api.demoSelect(
        f.actor,
        choices.items.find((i) => i.id === "demo-admin-01").token
      )
    ).code,
    "expired"
  );
  await f.login("demo-sf-01");
  await f.db
    .prepare("UPDATE users SET role='supervisor' WHERE id='demo-sf-01'")
    .run();
  assert.equal((await f.api.me(f.actor)).data.role, "supervisor");
  assert.equal((await f.api.ownSchedule(f.actor)).code, "forbidden");
  await f.db
    .prepare("UPDATE users SET status='disabled' WHERE id='demo-sf-01'")
    .run();
  assert.equal((await f.api.me(f.actor)).data, null);
  assert.equal((await f.api.demoStatus(f.actor)).code, "expired");
  assert.equal((await f.api.ownSchedule(f.actor)).code, "forbidden");
  assert.equal((await f.api.register(f.actor)).code, "forbidden");
  assert.equal(await f.count("telegram_identities"), 1);
});

test("read-only isolation rejects all mutations and real targets; role/team scopes still apply", async (t) => {
  const f = await setup(t);
  await f.db.batch([
    f.db.prepare(
      "INSERT INTO outlets(id,name,business_id) VALUES ('real-out','Private outlet','PRIVATE')"
    ),
    f.db.prepare(
      "INSERT INTO sales_force(id,name) VALUES ('real-sf','Private SF')"
    ),
    f.db.prepare(
      "INSERT INTO visit_schedules(id,sales_force_id,outlet_id,weekday) VALUES ('real-plan','demo-sf-01','real-out',1)"
    ),
    // Even marked plans cannot expose an unmarked real SF or Outlet.
    f.db.prepare(
      "INSERT INTO visit_schedules(id,sales_force_id,outlet_id,weekday,demo_only) VALUES ('mixed-plan','real-sf','demo-out-01',1,1)"
    ),
  ]);
  await f.login("demo-admin-01");
  assert.equal((await f.api.listOutlets(f.actor)).data.items.length, 35);
  assert.equal(
    (await f.api.getOutlet(f.actor, { id: "real-out" })).code,
    "not_found"
  );
  assert.equal(
    (await f.api.getOutlet(f.actor, { businessId: "PRIVATE" })).code,
    "not_found"
  );
  const plans = (await f.api.listSchedules(f.actor)).data.items;
  assert.ok(plans.length);
  assert.ok(
    plans.every(
      (p) =>
        p.outletId !== "real-out" &&
        p.salesForceId !== "real-sf" &&
        p.telegramUserId === null
    )
  );
  for (const method of [
    "register",
    "users",
    "pending",
    "approve",
    "reject",
    "setRole",
    "disable",
    "enable",
    "createOutlet",
    "updateOutlet",
    "deleteOutlet",
    "createSchedule",
    "visitWizard",
  ])
    assert.equal((await f.api[method](f.actor, {})).code, "forbidden", method);
  assert.equal(await f.count("telegram_identities"), 0);
  assert.equal(await f.count("telegram_visit_drafts"), 0);
  assert.equal(await f.count("access_audit"), 0);
  assert.ok(
    await f.db.prepare("SELECT 1 FROM outlets WHERE id='real-out'").first()
  );
  await f.login("demo-supervisor-01");
  const team = (await f.api.listSchedules(f.actor)).data.items;
  assert.equal(team.length, 28);
  assert.ok(team.every((p) => p.salesForceId <= "demo-sf-04"));
  assert.equal(
    (await f.api.listSchedules(f.actor, { salesForceId: "demo-sf-05" })).data
      .items.length,
    0
  );
  assert.equal(
    (await f.api.listSchedules(f.actor, { telegramUserId: "123" })).code,
    "association_unavailable"
  );
  await f.login("demo-sf-01");
  assert.equal((await f.api.listOutlets(f.actor)).code, "forbidden");
  assert.equal((await f.api.listSchedules(f.actor)).code, "forbidden");
  assert.equal((await f.api.ownSchedule(f.actor)).data.items.length, 7);
});

test("gate defaults off and always rejects production; existing credentials cannot bypass it", async (t) => {
  const f = await setup(t);
  await f.login("demo-admin-01");
  for (const config of [
    { APP_ENV: "production" },
    { APP_ENV: undefined },
    { APP_ENV: "preview" },
    { DEMO_AUTH_ENABLED: undefined },
    { DEMO_AUTH_ENABLED: "TRUE" },
    { DEMO_AUTH_ENABLED: "false" },
  ]) {
    const api = botService({ ...f.env, ...config });
    assert.equal((await api.demoAccounts(f.actor)).ok, false);
    assert.equal(
      (await api.demoSelect(f.actor, "a".repeat(32))).code,
      "disabled"
    );
    assert.equal((await api.demoStatus(f.actor)).code, "disabled");
    assert.equal((await api.demoLogout(f.actor)).code, "disabled");
    assert.equal((await api.me(f.actor)).data, null);
  }
  assert.equal(
    (await botService({ ...f.env, APP_ENV: "staging" }).demoStatus(f.actor)).ok,
    true
  );
  assert.equal(
    (await f.api.demoAccounts({ telegramUserId: "900", role: "admin" })).ok,
    false
  );
});
