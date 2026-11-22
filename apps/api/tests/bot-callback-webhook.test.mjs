import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import { readUpdate } from "../../bot/src/webhook.ts";

const sender = { id: 900, is_bot: false, first_name: "Sender" };
const callback = (data = "demo:" + "a".repeat(32)) => ({
  id: "callback-1",
  from: sender,
  chat_instance: "instance",
  data,
  message: {
    message_id: 7,
    date: 1,
    chat: { id: 900, type: "private" },
    from: { id: 123, is_bot: true, first_name: "Bot" },
    text: "Admin",
  },
});
const parse = (update) =>
  readUpdate(
    new Request("https://bot", { method: "POST", body: JSON.stringify(update) })
  );

test("webhook validates both text and callbacks, not the keyboard message's bot as actor", async () => {
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
  const inline = {
    ...callback(),
    message: undefined,
    inline_message_id: "inline",
  };
  assert.equal(
    typeof (await parse({ update_id: 2, callback_query: inline })),
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

test("authenticated webhook delivers demo callbacks through grammY and real D1; help follows demo role", async (t) => {
  const deliveries = [];
  let failEdit = false,
    failAck = false;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "api",
          modules: true,
          script: await bundle("../src/worker.ts"),
          compatibilityDate: "2026-11-02",
          d1Databases: { DB: "callback-demo" },
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
            if (
              (method === "editMessageReplyMarkup" && failEdit) ||
              (method === "answerCallbackQuery" && failAck)
            )
              return Response.json(
                {
                  ok: false,
                  error_code: 400,
                  description: "stale message/query",
                },
                { status: 400 }
              );
            return Response.json({
              ok: true,
              result:
                method === "answerCallbackQuery"
                  ? true
                  : {
                      message_id: 7,
                      date: 1,
                      chat: { id: payload.chat_id, type: "private" },
                      text: payload.text ?? "Admin",
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
  const command = (text) =>
    post({
      message: {
        message_id: ++id,
        date: 1,
        from: sender,
        chat: { id: 900, type: "private" },
        text,
        entities: [{ type: "bot_command", offset: 0, length: text.length }],
      },
    });
  const click = (query) =>
    post({ callback_query: { ...query, id: String(++id) } });
  const lastText = () =>
    deliveries.filter((d) => d.method === "sendMessage").at(-1).payload.text;
  const session = () =>
    db
      .prepare(
        "SELECT * FROM telegram_demo_sessions WHERE telegram_user_id='900'"
      )
      .first();
  const picker = async (role, name) => {
    assert.equal((await command("/demo")).status, 200);
    const buttons = deliveries
      .filter((d) => d.method === "sendMessage" && d.payload.text === role)
      .at(-1)
      .payload.reply_markup.inline_keyboard.flat();
    return (name ? buttons.find((button) => button.text === name) : buttons[0])
      .callback_data;
  };
  const token = await picker("Admin");
  const before = deliveries.length;
  assert.equal(
    (await post({ callback_query: callback(token) }, "wrong")).status,
    401
  );
  assert.equal(deliveries.length, before);
  assert.equal(await session(), null);
  assert.equal(
    (
      await click({
        ...callback(token),
        from: { ...sender, id: 901 },
        message: { ...callback().message, chat: { id: 901, type: "private" } },
      })
    ).status,
    200
  );
  assert.match(lastText(), /kedaluwarsa/);
  assert.equal(await session(), null);
  // Failed keyboard cleanup must not mask the successful session or confirmation.
  failEdit = true;
  let start = deliveries.length;
  assert.equal((await click(callback(token))).status, 200);
  assert.equal((await session()).user_id, "demo-admin-01");
  assert.match(
    lastText(),
    /Demo Mode aktif.*1 jam[\s\S]*Budi Santoso[\s\S]*Role: admin[\s\S]*Sisa sesi: 60 menit/
  );
  assert.equal(
    deliveries.slice(start).filter((d) => d.method === "answerCallbackQuery")
      .length,
    1
  );
  await click(callback(token));
  assert.match(lastText(), /kedaluwarsa/);
  assert.equal((await session()).user_id, "demo-admin-01");
  await click(callback("demo:invalid"));
  assert.match(lastText(), /tidak valid/);
  start = deliveries.length;
  await command("/help");
  const messages = deliveries
    .slice(start)
    .filter((d) => d.method === "sendMessage");
  assert.equal(messages.length, 1);
  assert.match(lastText(), /Monitoring/);
  assert.doesNotMatch(
    lastText(),
    /\/users|\/approve|\/tambahoutlet|\/salesvisit|\/register/
  );
  const sfToken = await picker("Sales Force", "Rizky Pratama");
  await command("/help"); // Help must not invalidate an outstanding picker.
  failAck = true;
  assert.equal((await click(callback(sfToken))).status, 200);
  assert.match(lastText(), /Rizky Pratama[\s\S]*sales_force/);
  assert.equal((await session()).user_id, "demo-sf-01");
  failAck = false;
  await command("/help");
  assert.match(lastText(), /\/jadwal —/);
  assert.doesNotMatch(
    lastText(),
    /\/jadwalsales|\/salesvisit|\/konfirmasi|\/batal/
  );
  const expired = await picker("Supervisor");
  await db.prepare("UPDATE telegram_demo_choices SET expires_at=0").run();
  await click(callback(expired));
  assert.match(lastText(), /kedaluwarsa/);
  assert.equal((await session()).user_id, "demo-sf-01");
  for (const query of [
    {
      ...callback(),
      message: { ...callback().message, chat: { id: -100, type: "group" } },
    },
    {
      ...callback(),
      message: { ...callback().message, chat: { id: 901, type: "private" } },
    },
    { ...callback(), message: undefined, inline_message_id: "inline" },
    callback("unknown:button"),
  ]) {
    start = deliveries.length;
    assert.equal((await click(query)).status, 200);
    assert.equal(
      deliveries.slice(start).filter((d) => d.method === "answerCallbackQuery")
        .length,
      1
    );
    assert.equal((await session()).user_id, "demo-sf-01");
  }
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM telegram_identities").first())
      .n,
    0
  );
});
