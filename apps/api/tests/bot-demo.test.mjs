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

test("private keyboards group dynamic accounts; callbacks verify sender/chat and acknowledge invalid choices", async () => {
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
  const api = {
    demoAccounts: async (actor) => {
      calls.push(["accounts", actor]);
      return {
        ok: true,
        items: ["admin", "supervisor", "sales_force"].map((role, i) => ({
          ...account,
          role,
          name: `Account ${role}`,
          token: String(i).repeat(32),
        })),
      };
    },
    demoSelect: async (actor, token) => {
      assert.equal(deliveries.at(-1).method, "answerCallbackQuery");
      calls.push(["select", actor, token]);
      if (unavailable) throw new Error("Synthetic unavailable RPC");
      return token === "2".repeat(32)
        ? { ok: true, data: { account, expiresAt: Date.now() + 3600000 } }
        : { ok: false, code: "expired" };
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
  const message = (text, chat = { id: 900, type: "private" }) =>
    bot.handleUpdate({
      update_id: ++id,
      message: {
        message_id: id,
        date: 1,
        from: { id: 900, is_bot: false, first_name: "Sender" },
        chat,
        text,
        entities: [{ type: "bot_command", offset: 0, length: text.length }],
      },
    });
  const callback = (
    data,
    chat = { id: 900, type: "private" },
    from = { id: 900, is_bot: false, first_name: "Sender" }
  ) =>
    bot.handleUpdate({
      update_id: ++id,
      callback_query: {
        id: String(id),
        chat_instance: "test",
        from,
        data,
        message: { message_id: 7, date: 1, chat, text: "Sales Force" },
      },
    });
  await message("/demo");
  const keyboards = deliveries.filter(
    (d) => d.payload.reply_markup?.inline_keyboard
  );
  assert.deepEqual(
    keyboards.map((d) => d.payload.text),
    ["Admin", "Supervisor", "Sales Force"]
  );
  assert.equal(
    keyboards[2].payload.reply_markup.inline_keyboard[0][0].callback_data,
    "demo:" + "2".repeat(32)
  );
  await callback("demo:" + "2".repeat(32));
  assert.equal(calls.at(-1)[1].telegramUserId, "900");
  assert.ok(deliveries.some((d) => d.method === "answerCallbackQuery"));
  assert.ok(deliveries.some((d) => d.payload.text?.includes("Dynamic Name")));
  await callback("demo:malformed");
  assert.ok(deliveries.at(-1).payload.text.includes("kedaluwarsa"));
  const before = calls.length;
  await callback("demo:" + "2".repeat(32), { id: -100, type: "group" });
  await callback("demo:" + "2".repeat(32), { id: 901, type: "private" });
  await callback(
    "demo:" + "2".repeat(32),
    { id: 900, type: "private" },
    { id: 900, is_bot: true, first_name: "Bot" }
  );
  await bot.handleUpdate({
    update_id: ++id,
    callback_query: {
      id: String(id),
      chat_instance: "test",
      from: { id: 900, is_bot: false, first_name: "Sender" },
      data: "demo:123",
      inline_message_id: "inline",
    },
  });
  assert.equal(calls.length, before);
  await message("/demo_status");
  assert.equal(calls.at(-1)[0], "status");
  await message("/demo_logout");
  assert.equal(calls.at(-1)[0], "logout");
  assert.ok(deliveries.at(-1).payload.text.includes("normal"));
  unavailable = true;
  const start = deliveries.length;
  await callback("demo:" + "2".repeat(32));
  assert.equal(
    deliveries.slice(start).filter((d) => d.method === "answerCallbackQuery")
      .length,
    1
  );
  assert.match(deliveries.at(-1).payload.text, /Demo tidak tersedia/);
});
