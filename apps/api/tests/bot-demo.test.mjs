import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents:
      "export { Bot } from 'grammy'; export { installCommands } from './commands.ts';",
    resolveDir: fileURLToPath(new URL("../../bot/src/", import.meta.url)),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
const { Bot, installCommands } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);

test("demo uses grouped text IDs and explicit login; malformed commands, old callbacks and groups cannot select", async () => {
  const calls = [],
    deliveries = [];
  const bot = new Bot("123:synthetic", {
    botInfo: {
      id: 123,
      is_bot: true,
      first_name: "Test",
      username: "test_bot",
      can_join_groups: true,
      can_read_all_group_messages: true,
      supports_inline_queries: false,
    },
  });
  bot.api.config.use(async (_prev, method, payload) => {
    deliveries.push({ method, payload });
    return {
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
    };
  });
  const account = {
    id: "dynamic",
    name: "Dynamic Name",
    role: "sales_force",
    salesForceId: "sf",
  };
  let unavailable = false;
  let items = ["admin", "supervisor", "sales_force"].map((role, i) => ({
    ...account,
    role,
    id: `dynamic-${i}`,
    name: `Account ${role}`,
  }));
  const api = {
    demoAccounts: async (actor) => {
      calls.push(["accounts", actor]);
      return { ok: true, items };
    },
    demoLogin: async (actor, id) => {
      calls.push(["login", actor, id]);
      if (unavailable) throw new Error("Synthetic unavailable RPC");
      return id === "dynamic-2"
        ? { ok: true, data: { account, expiresAt: Date.now() + 3600000 } }
        : { ok: false, code: "unavailable" };
    },
    demoStatus: async (actor) => {
      calls.push(["status", actor]);
      return { ok: true, data: { account, expiresAt: Date.now() + 3600000 } };
    },
    demoLogout: async (actor) => {
      calls.push(["logout", actor]);
      return { ok: true, data: null };
    },
  };
  installCommands(bot, api);
  let id = 0;
  const message = (text, type = "private") =>
    bot.handleUpdate({
      update_id: ++id,
      message: {
        message_id: id,
        date: 1,
        from: { id: 900, is_bot: false, first_name: "Sender" },
        chat: { id: type === "private" ? 900 : -100, type },
        text,
        entities: [
          { type: "bot_command", offset: 0, length: text.split(" ")[0].length },
        ],
      },
    });
  const last = () => deliveries.at(-1).payload.text;
  await message("/demo");
  assert.equal(deliveries.length, 1);
  assert.match(
    last(),
    /Admin:\n.*dynamic-0[\s\S]*Supervisor:\n.*dynamic-1[\s\S]*Sales Force:\n.*dynamic-2/
  );
  assert.match(
    last(),
    /\/demo_login account_id[\s\S]*60 menit[\s\S]*hanya baca/
  );
  assert.ok(deliveries.every((d) => !d.payload.reply_markup));
  const before = calls.length;
  for (const text of [
    "/demo_login",
    "/demo_login a b",
    "/demo_login ~invalid=",
    "/demo_login a\nowner=901",
  ])
    await message(text);
  await message("/demo_login dynamic-2", "group");
  assert.equal(calls.length, before);
  await bot.handleUpdate({
    update_id: ++id,
    callback_query: {
      id: String(id),
      chat_instance: "test",
      from: { id: 900, is_bot: false, first_name: "Sender" },
      data: "demo:old-token",
      message: {
        message_id: 7,
        date: 1,
        chat: { id: 900, type: "private" },
        text: "Old picker",
      },
    },
  });
  assert.equal(calls.length, before);
  assert.equal(deliveries.at(-1).method, "answerCallbackQuery");
  await message("/demo_login dynamic-2");
  assert.equal(calls.at(-1)[0], "login");
  assert.equal(calls.at(-1)[1].telegramUserId, "900");
  assert.equal(calls.at(-1)[2], "dynamic-2");
  assert.match(
    last(),
    /Demo Mode aktif[\s\S]*Dynamic Name[\s\S]*Role: Sales Force[\s\S]*Sesi: 60 menit/
  );
  await message("/demo_login missing");
  assert.match(last(), /tidak tersedia/);
  await message("/demo_status");
  assert.equal(calls.at(-1)[0], "status");
  await message("/demo_logout");
  assert.equal(calls.at(-1)[0], "logout");
  assert.match(last(), /normal/);
  unavailable = true;
  await message("/demo_login dynamic-2");
  assert.match(last(), /Periksa \/demo_status/);
  items = Array.from({ length: 60 }, (_, i) => ({
    ...account,
    id: `account-${i}`,
    name: "N".repeat(256),
  }));
  const start = deliveries.length;
  await message("/demo");
  assert.ok(deliveries.slice(start).length > 1);
  assert.ok(
    deliveries.slice(start).every((d) => d.payload.text.length <= 4096)
  );
  assert.match(
    deliveries
      .slice(start)
      .map((d) => d.payload.text)
      .join("\n"),
    /account-59/
  );
});
