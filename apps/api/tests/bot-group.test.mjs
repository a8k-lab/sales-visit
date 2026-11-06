import assert from "node:assert/strict";
import { test } from "node:test";

import { build } from "esbuild";

// Bundle the real middleware and grammY together; only RPC and Telegram delivery
// are faked so calls (including unauthorized reads) can be counted explicitly.
const bundle = await build({
  stdin: {
    contents: `export { Bot } from 'grammy'; export { installCommands } from './commands.ts';`,
    resolveDir: new URL("../../bot/src/", import.meta.url).pathname,
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

const command = (text) => [
  { type: "bot_command", offset: 0, length: text.split(" ")[0].length },
];

test("group middleware ignores ordinary text and allows only private commands to reach RPC", async () => {
  const calls = [];
  const replies = [];
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
    assert.equal(method, "sendMessage");
    replies.push(payload.text);
    return {
      ok: true,
      result: {
        message_id: 1,
        date: 1,
        chat: { id: payload.chat_id, type: "private" },
        text: payload.text,
      },
    };
  });
  const api = new Proxy(
    {},
    {
      get:
        (_target, method) =>
        async (...args) => {
          calls.push({ method, args });
          if (method === "createOutlet")
            return {
              ok: true,
              data: {
                id: "out-test",
                name: args[1].name,
                businessId: args[1].businessId,
                noRs: args[1].noRs,
                createdAt: 1,
                updatedAt: 1,
              },
            };
          return { ok: true, data: { items: [], next: null } };
        },
    }
  );
  installCommands(bot, api);
  let updateId = 0;
  async function message(text, entities, type = "group") {
    replies.length = 0;
    await bot.handleUpdate({
      update_id: ++updateId,
      message: {
        message_id: updateId,
        date: 1,
        from: { id: 900, is_bot: false, first_name: "Synthetic" },
        chat: { id: type === "private" ? 900 : -100, type },
        text,
        ...(entities === undefined ? {} : { entities }),
      },
    });
  }
  for (const [text, entities] of [
    ["Percakapan biasa", undefined],
    ["/tambahoutlet Not a verified command", undefined],
    ["/jadwal", []],
    ["/outlets", [{ type: "bold", offset: 0, length: 8 }]],
    ["Coba /outlets", [{ type: "bot_command", offset: 5, length: 8 }]],
  ]) {
    await message(text, entities);
    assert.deepEqual(replies, []);
    assert.deepEqual(calls, []);
  }
  for (const type of ["group", "supergroup"]) {
    for (const text of [
      "/outlets",
      "/tambahoutlet Group",
      "/tambahjadwal sf-01 out-01 senin",
      "/jadwal",
      "/help",
      "/users",
      "/setrole 100 admin",
      "/disable 100",
      "/enable 100",
    ]) {
      await message(text, command(text), type);
      assert.deepEqual(replies, [
        "Gunakan chat pribadi dengan bot untuk registrasi dan administrasi.",
      ]);
      assert.deepEqual(calls, []);
    }
  }
  await message(
    "/tambahoutlet 001 002 Private",
    command("/tambahoutlet 001 002 Private"),
    "private"
  );
  assert.match(replies.join("\n"), /berhasil dibuat/);
  assert.equal(calls.at(-1).method, "createOutlet");
  assert.equal(calls.at(-1).args[0].telegramUserId, "900");
  await message("/jadwal semua", command("/jadwal semua"), "private");
  assert.match(replies.join("\n"), /Tidak ada jadwal/);
  assert.equal(calls.at(-1).method, "ownSchedule");
  assert.equal(calls.length, 2);
});
