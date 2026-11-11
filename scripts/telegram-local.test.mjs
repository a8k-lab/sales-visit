import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { main, run, tunnelUrl } from "./telegram-local.mjs";

const token = "123:synthetic_token";
const secret = "a".repeat(64);
const oldUrl = "https://old-tunnel.trycloudflare.com/";
const newUrl = "https://new-tunnel.trycloudflare.com/";

function fixture(options = {}) {
  const state = { owned: [], current: "", calls: [], saves: [], ...options };
  const dependencies = {
    readVars: () => ({
      TELEGRAM_BOT_TOKEN: token,
      TELEGRAM_WEBHOOK_SECRET: secret,
      TELEGRAM_LOCAL_TEST_BOT_USERNAME: "separate_test_bot",
      ...state.vars,
    }),
    readState: (id) => {
      assert.equal(id, 123);
      return state.owned;
    },
    writeState: (id, urls) => {
      assert.equal(id, 123);
      if (state.failSave) throw new Error(token);
      state.owned = urls;
      state.saves.push(structuredClone(urls));
    },
    fetcher: async (url, request) => {
      assert.ok(url.startsWith(`https://api.telegram.org/bot${token}/`));
      assert.equal(request.method, "POST");
      assert.equal(request.redirect, "error");
      assert.ok(request.signal instanceof AbortSignal);
      const method = url.split("/").at(-1);
      const payload = JSON.parse(request.body);
      state.calls.push({ method, payload });
      if (state.fail === method) throw new Error(`private ${token} ${secret}`);
      let result;
      if (method === "getMe")
        result = state.bot ?? {
          id: 123,
          is_bot: true,
          username: "separate_test_bot",
        };
      if (method === "getWebhookInfo")
        result = state.info ?? {
          url: state.current,
          has_custom_certificate: false,
          allowed_updates: ["message"],
        };
      if (method === "getUpdates") result = state.updates ?? [];
      if (method === "setWebhook") {
        assert.ok(
          state.owned.includes(payload.url),
          "ownership saved before mutation"
        );
        state.current = payload.url;
        result = state.mutationResult ?? true;
      }
      if (method === "deleteWebhook") {
        state.current = "";
        result = state.mutationResult ?? true;
      }
      return {
        ok: state.httpOk ?? true,
        json: async () => ({ ok: state.apiOk ?? true, result }),
      };
    },
  };
  state.run = (args) => run(args, dependencies);
  state.main = (args, output) =>
    main(args, {
      ...dependencies,
      log: (message) => output.push(message),
      error: (message) => output.push(message),
    });
  return state;
}
const mutations = (state) =>
  state.calls.filter((call) =>
    ["setWebhook", "deleteWebhook"].includes(call.method)
  );

test("only canonical HTTPS Quick Tunnel roots are accepted", () => {
  assert.equal(tunnelUrl(newUrl.slice(0, -1)), newUrl);
  assert.equal(tunnelUrl(newUrl), newUrl);
  for (const url of [
    undefined,
    "",
    "http://localhost:8788",
    "http://x.trycloudflare.com",
    "https://x.workers.dev",
    "https://trycloudflare.com",
    "https://x.trycloudflare.com.evil.test",
    "https://user@x.trycloudflare.com",
    "https://x.trycloudflare.com:443",
    "https://x.trycloudflare.com/path",
    "https://x.trycloudflare.com/../",
    "https://x.trycloudflare.com?token=private",
    "https://x.trycloudflare.com/#hash",
    "https://X.trycloudflare.com",
    " https://x.trycloudflare.com",
    "https://-x.trycloudflare.com",
  ])
    assert.throws(() => tunnelUrl(url), /tunnel root/);
});

test("bad arguments and markers fail before reading credentials or calling Telegram", async () => {
  for (const args of [
    [],
    ["unknown"],
    ["webhook:set"],
    ["webhook:delete", "extra"],
    ["user-id"],
    ["user-id", "short"],
    ["user-id", "with spaces"],
    ["user-id", "x".repeat(129)],
    ["webhook:set", newUrl, "token"],
    ["webhook:set", "https://example.com"],
  ]) {
    await assert.rejects(
      run(args, {
        readVars: () => assert.fail("must not read credentials"),
        fetcher: () => assert.fail("must not call Telegram"),
      })
    );
  }
});

test("credentials and webhook secrets are validated locally", async () => {
  for (const vars of [
    { TELEGRAM_BOT_TOKEN: "" },
    { TELEGRAM_BOT_TOKEN: "123:bad/path" },
    { TELEGRAM_LOCAL_TEST_BOT_USERNAME: "" },
    { TELEGRAM_LOCAL_TEST_BOT_USERNAME: "@separate_test_bot" },
    { TELEGRAM_WEBHOOK_SECRET: "" },
    { TELEGRAM_WEBHOOK_SECRET: "x".repeat(257) },
    { TELEGRAM_WEBHOOK_SECRET: "bad secret" },
  ]) {
    const state = fixture({ vars });
    await assert.rejects(state.run(["webhook:set", newUrl]));
    assert.deepEqual(state.calls, []);
  }
  for (const value of ["a", "_-".repeat(128)]) {
    const state = fixture({ vars: { TELEGRAM_WEBHOOK_SECRET: value } });
    await state.run(["webhook:set", newUrl]);
    assert.equal(mutations(state)[0].payload.secret_token, value);
  }
});

test("a mismatched bot is refused before checking or changing its webhook", async () => {
  for (const bot of [
    { id: 123, is_bot: true, username: "production_bot" },
    { id: 123, is_bot: false, username: "separate_test_bot" },
    { id: -1, is_bot: true, username: "separate_test_bot" },
  ]) {
    const state = fixture({ bot });
    await assert.rejects(
      state.run(["webhook:set", newUrl]),
      /configured test bot/
    );
    assert.deepEqual(
      state.calls.map((call) => call.method),
      ["getMe"]
    );
  }
});

test("setting a fresh webhook preserves the secret and records ownership", async () => {
  const state = fixture();
  assert.equal(
    await state.run(["webhook:set", newUrl]),
    "Test webhook registered."
  );
  assert.deepEqual(
    state.calls.map((call) => call.method),
    ["getMe", "getWebhookInfo", "setWebhook"]
  );
  assert.deepEqual(mutations(state)[0].payload, {
    url: newUrl,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  assert.deepEqual(state.owned, [newUrl]);
  assert.ok(!JSON.stringify(state.saves).includes(secret));
  assert.ok(!JSON.stringify(state.saves).includes(token));
});

test("only owned local webhooks can be refreshed or moved to a new tunnel", async () => {
  const state = fixture({ owned: [oldUrl], current: oldUrl });
  await state.run(["webhook:set", newUrl]);
  assert.deepEqual(state.saves, [[oldUrl, newUrl], [newUrl]]);
  await state.run(["webhook:set", newUrl]);
  assert.equal(mutations(state).length, 2);
});

test("unowned or unexpected configurations are never replaced or deleted", async () => {
  for (const command of [["webhook:set", newUrl], ["webhook:delete"]]) {
    for (const options of [
      { current: newUrl }, // Even the requested URL must have local ownership evidence.
      { current: oldUrl },
      { current: "https://production.example.com/" },
      {
        owned: [oldUrl],
        info: {
          url: oldUrl,
          has_custom_certificate: true,
          allowed_updates: ["message"],
        },
      },
      {
        owned: [oldUrl],
        info: {
          url: oldUrl,
          has_custom_certificate: false,
          allowed_updates: ["callback_query"],
        },
      },
      { info: {} },
      { owned: "malformed" },
      { owned: ["https://production.example.com/"] },
    ]) {
      const state = fixture(options);
      await assert.rejects(state.run(command));
      assert.deepEqual(mutations(state), []);
      assert.deepEqual(state.saves, []);
    }
  }
});

test("delete only removes an owned webhook; an unset webhook is a no-op", async () => {
  const state = fixture({
    owned: [oldUrl],
    current: oldUrl,
    vars: { TELEGRAM_WEBHOOK_SECRET: "" },
  });
  await state.run(["webhook:delete"]);
  assert.deepEqual(mutations(state), [
    { method: "deleteWebhook", payload: { drop_pending_updates: true } },
  ]);
  assert.deepEqual(state.owned, []);
  assert.equal(
    await state.run(["webhook:delete"]),
    "Test webhook is already unset."
  );
  assert.equal(mutations(state).length, 1);
});

test("failure to record ownership prevents mutation; uncertain requests retain retry state", async () => {
  const blocked = fixture({ failSave: true });
  await assert.rejects(blocked.run(["webhook:set", newUrl]));
  assert.deepEqual(mutations(blocked), []);
  const uncertain = fixture({
    owned: [oldUrl],
    current: oldUrl,
    fail: "setWebhook",
  });
  await assert.rejects(
    uncertain.run(["webhook:set", newUrl]),
    /Details suppressed/
  );
  assert.deepEqual(uncertain.owned, [oldUrl, newUrl]);
  uncertain.fail = undefined;
  await uncertain.run(["webhook:set", newUrl]);
  assert.deepEqual(uncertain.owned, [newUrl]);
});

const ownMessage = {
  chat: { type: "private", id: 456 },
  text: "local-admin-marker",
  from: { id: 456, is_bot: false },
};

test("user-id takes one snapshot and returns only the matching human sender ID", async () => {
  const state = fixture({
    updates: [{ message: ownMessage }],
    vars: { TELEGRAM_WEBHOOK_SECRET: "" },
  });
  assert.equal(
    await state.run(["user-id", ownMessage.text]),
    "Telegram User ID: 456 (keep private)."
  );
  assert.deepEqual(
    state.calls.map((call) => call.method),
    ["getMe", "getWebhookInfo", "getUpdates"]
  );
  assert.deepEqual(state.calls.at(-1).payload, {
    allowed_updates: ["message"],
    timeout: 0,
  });
  assert.deepEqual(state.saves, []);
});

test("user-id refuses active webhooks, ambiguity, forwards and non-human/private messages", async () => {
  const active = fixture({ current: newUrl });
  await assert.rejects(
    active.run(["user-id", ownMessage.text]),
    /unset webhook/
  );
  assert.ok(!active.calls.some((call) => call.method === "getUpdates"));
  for (const updates of [
    [],
    [{ message: ownMessage }, { message: ownMessage }],
    [{ message: { ...ownMessage, text: "another-marker" } }],
    [{ message: { ...ownMessage, forward_origin: { type: "hidden_user" } } }],
    [{ message: { ...ownMessage, chat: { type: "group", id: 456 } } }],
    [{ message: { ...ownMessage, from: { id: 456, is_bot: true } } }],
    [{ message: { ...ownMessage, from: { id: 789, is_bot: false } } }],
    [
      {
        message: {
          ...ownMessage,
          from: { id: 0, is_bot: false },
          chat: { type: "private", id: 0 },
        },
      },
    ],
    [null],
    { unexpected: "response" },
  ]) {
    const state = fixture({ updates });
    await assert.rejects(state.run(["user-id", ownMessage.text]));
    assert.deepEqual(mutations(state), []);
  }
});

test("failures are concise and never expose secrets or raw responses", async () => {
  for (const options of [
    { fail: "getMe" },
    { fail: "getWebhookInfo" },
    { fail: "setWebhook" },
    { httpOk: false },
    { apiOk: false },
    { failSave: true },
    { mutationResult: false },
  ]) {
    const output = [];
    const state = fixture(options);
    assert.equal(await state.main(["webhook:set", newUrl], output), 1);
    assert.equal(output.length, 1);
    assert.ok(!output[0].includes(token));
    assert.ok(!output[0].includes(secret));
  }
});

test("CLI help works without credentials or network", () => {
  const result = spawnSync(
    process.execPath,
    [new URL("./telegram-local.mjs", import.meta.url).pathname, "--help"],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /webhook:set/);
  assert.match(result.stdout, /webhook:delete/);
  assert.match(result.stdout, /user-id/);
  assert.equal(result.stderr, "");
});
