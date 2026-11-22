import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import { readUpdate } from "../../bot/src/webhook.ts";

const sender = { id: 900, is_bot: false, first_name: "Sender" };
const callback = (data = "demo:old-token") => ({
  id: "callback-1",
  from: sender,
  chat_instance: "instance",
  data,
  message: {
    message_id: 7,
    date: 1,
    chat: { id: 900, type: "private" },
    from: { id: 123, is_bot: true, first_name: "Bot" },
    text: "Old keyboard",
  },
});
const parse = (update) =>
  readUpdate(
    new Request("https://bot", { method: "POST", body: JSON.stringify(update) })
  );

test("webhook retains secure text and unrelated callback support", async () => {
  const message = {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: 900, type: "private" },
      from: sender,
      text: "/demo",
    },
  };
  assert.equal(typeof (await parse(message)), "string");
  const update = { update_id: 2, callback_query: callback() };
  assert.equal(typeof (await parse(update)), "string");
  assert.equal(
    typeof (await parse({
      ...update,
      callback_query: {
        ...callback(),
        message: { message_id: 7, date: 0, chat: { id: 900, type: "private" } },
      },
    })),
    "string"
  );
  assert.equal(
    typeof (await parse({
      update_id: 2,
      callback_query: {
        ...callback(),
        message: undefined,
        inline_message_id: "inline",
      },
    })),
    "string"
  );
  for (const query of [
    { ...callback(), id: "" },
    { ...callback(), chat_instance: undefined },
    { ...callback(), from: { ...sender, id: 0 } },
    { ...callback(), from: { ...sender, id: Number.MAX_SAFE_INTEGER + 1 } },
    { ...callback(), from: { ...sender, is_bot: true } },
    { ...callback(), message: undefined },
    { ...callback(), inline_message_id: "ambiguous" },
    {
      ...callback(),
      message: { ...callback().message, chat: { id: 0, type: "private" } },
    },
    { ...callback(), data: "x".repeat(65) },
    { ...callback(), data: "😀".repeat(17) },
  ]) {
    const response = await parse({ update_id: 2, callback_query: query });
    assert.ok(response instanceof Response);
    assert.equal(await response.text(), "Ignored");
  }
  assert.ok(
    (await parse({ ...message, callback_query: callback() })) instanceof
      Response
  );
  assert.ok(
    (await parse({ update_id: 3, edited_message: message.message })) instanceof
      Response
  );
  assert.equal(
    (
      await readUpdate(
        new Request("https://bot", { method: "POST", body: "{" })
      )
    ).status,
    400
  );
  assert.equal(
    (
      await readUpdate(
        new Request("https://bot", {
          method: "POST",
          body: "x".repeat(128 * 1024 + 1),
        })
      )
    ).status,
    413
  );
});

async function bundle(path) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["cloudflare:workers"],
  });
  return result.outputFiles[0].text;
}

test("authenticated text login reaches real D1; help follows demo role and old callbacks cannot activate sessions", async (t) => {
  const deliveries = [];
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "api",
          modules: true,
          script: await bundle("../src/worker.ts"),
          compatibilityDate: "2026-11-02",
          d1Databases: { DB: "text-demo" },
          bindings: { APP_ENV: "local", DEMO_AUTH_ENABLED: "true" },
        },
        {
          name: "bot",
          modules: true,
          script: await bundle("../../bot/src/index.ts"),
          compatibilityDate: "2026-11-02",
          bindings: {
            TELEGRAM_BOT_TOKEN: "123:synthetic",
            TELEGRAM_WEBHOOK_SECRET: "synthetic-secret",
          },
          serviceBindings: {
            IDENTITY: { name: "api", entrypoint: "BotIdentity" },
          },
          outboundService: async (request) => {
            const method = new URL(request.url).pathname.split("/").at(-1);
            const payload = await request.json();
            deliveries.push({ method, payload });
            if (method === "getMe")
              return Response.json({
                ok: true,
                result: {
                  id: 123,
                  is_bot: true,
                  first_name: "Test",
                  username: "test_bot",
                },
              });
            return Response.json({
              ok: true,
              result:
                method === "answerCallbackQuery"
                  ? true
                  : {
                      message_id: 7,
                      date: 1,
                      chat: { id: payload.chat_id, type: "private" },
                      text: payload.text,
                    },
            });
          },
        },
      ],
    })
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB", "api");
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
  const bot = await mf.getWorker("bot");
  let id = 0;
  const post = (update, secret = "synthetic-secret") =>
    bot.fetch("https://bot/", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify({ update_id: ++id, ...update }),
    });
  const message = (text) => ({
    message: {
      message_id: ++id,
      date: 1,
      from: sender,
      chat: { id: 900, type: "private" },
      text,
      entities: [
        { type: "bot_command", offset: 0, length: text.split(" ")[0].length },
      ],
    },
  });
  const command = (text) => post(message(text));
  const lastText = () =>
    deliveries.filter((d) => d.method === "sendMessage").at(-1).payload.text;
  const session = () =>
    db
      .prepare(
        "SELECT * FROM telegram_demo_sessions WHERE telegram_user_id='900'"
      )
      .first();
  await command("/register");
  await db
    .prepare(
      "UPDATE users SET role='admin', status='active' WHERE id=(SELECT user_id FROM telegram_identities WHERE telegram_user_id='900')"
    )
    .run();
  const identities = (
    await db.prepare("SELECT * FROM telegram_identities").all()
  ).results;
  await command("/demo");
  assert.match(
    lastText(),
    /Admin:\n[\s\S]*demo-admin-01 — Budi Santoso[\s\S]*Supervisor:[\s\S]*Sales Force:/
  );
  assert.ok(deliveries.every((d) => !d.payload.reply_markup));
  assert.equal(await session(), null);
  const before = deliveries.length;
  assert.equal(
    (await post(message("/demo_login demo-admin-01"), "wrong")).status,
    401
  );
  assert.equal(deliveries.length, before);
  assert.equal((await command("/demo_login demo-admin-01")).status, 200);
  assert.equal((await session()).user_id, "demo-admin-01");
  assert.match(
    lastText(),
    /Demo Mode aktif[\s\S]*Budi Santoso[\s\S]*Role: Admin[\s\S]*Sesi: 60 menit/
  );
  const start = deliveries.length;
  await command("/help");
  assert.equal(
    deliveries.slice(start).filter((d) => d.method === "sendMessage").length,
    1
  );
  assert.ok(lastText().length < 4096);
  assert.match(lastText(), /Monitoring/);
  assert.doesNotMatch(
    lastText(),
    /\/users|\/approve|\/tambahoutlet|\/salesvisit|\/register/
  );
  await command("/demo_login missing");
  assert.match(lastText(), /tidak tersedia/);
  assert.equal((await session()).user_id, "demo-admin-01");
  await command("/demo_login demo-sf-01");
  assert.match(lastText(), /Rizky Pratama[\s\S]*Sales Force/);
  await command("/help");
  assert.match(lastText(), /\/jadwal \[hari\] \[after=kursor\]/);
  assert.doesNotMatch(
    lastText(),
    /\/jadwalsales|\/salesvisit|\/konfirmasi|\/batal/
  );
  await command("/demo_status");
  assert.match(lastText(), /Sisa sesi: 60 menit/);
  for (const query of [
    callback(),
    callback("unknown:button"),
    {
      ...callback(),
      message: { ...callback().message, chat: { id: -100, type: "group" } },
    },
    {
      ...callback(),
      message: { ...callback().message, chat: { id: 901, type: "private" } },
    },
    { ...callback(), message: undefined, inline_message_id: "inline" },
  ]) {
    const callbackStart = deliveries.length;
    assert.equal(
      (await post({ callback_query: { ...query, id: String(++id) } })).status,
      200
    );
    assert.equal(
      deliveries
        .slice(callbackStart)
        .filter((d) => d.method === "answerCallbackQuery").length,
      1
    );
    assert.equal((await session()).user_id, "demo-sf-01");
  }
  await command("/demo_logout");
  assert.equal(await session(), null);
  await command("/help");
  assert.match(lastText(), /\/approve telegram_id role/);
  await command("/demo_login demo-sf-01");
  const expired = Date.now() - 1;
  await db
    .prepare("UPDATE telegram_demo_sessions SET created_at=?, expires_at=?")
    .bind(expired - 3600000, expired)
    .run();
  await command("/demo_status");
  assert.match(lastText(), /tidak aktif/);
  await command("/help");
  assert.match(lastText(), /\/approve telegram_id role/);
  assert.deepEqual(
    (await db.prepare("SELECT * FROM telegram_identities").all()).results,
    identities
  );
});
