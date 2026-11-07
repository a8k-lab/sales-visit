import assert from "node:assert/strict";
import test from "node:test";

import { executePlan } from "./ci/release.mjs";
import { loadTarget, validateBindings, validateConfig } from "./ci/targets.mjs";
import { deploy } from "./cloudflare-deploy.mjs";
const account = "a".repeat(32);
test("only the two reviewed native rate limit declarations are permitted", () => {
  const config = loadTarget("api");
  for (const mutate of [
    (c) => {
      delete c.ratelimits;
    },
    (c) => {
      c.ratelimits.pop();
    },
    (c) => {
      c.ratelimits.push(c.ratelimits[0]);
    },
    (c) => {
      c.ratelimits[0].name = "OTHER";
    },
    (c) => {
      c.ratelimits[0].namespace_id = "999";
    },
    (c) => {
      c.ratelimits[0].simple.limit = 100000;
    },
    (c) => {
      c.ratelimits[0].simple.period = 10;
    },
    (c) => {
      c.ratelimits[0].extra = "unapproved";
    },
    (c) => {
      c.ratelimits[0].simple.extra = true;
    },
  ]) {
    const candidate = structuredClone(config);
    mutate(candidate);
    assert.throws(
      () => validateConfig("api", candidate, account),
      /rate limit/
    );
  }
  for (const worker of ["web", "bot"])
    assert.throws(
      () =>
        validateConfig(
          worker,
          { ...loadTarget(worker), ratelimits: config.ratelimits },
          account
        ),
      /Unapproved Wrangler/
    );
});
test("active rate bindings verify exact type/name/namespace/threshold and disabled-only bootstrap", () => {
  const config = loadTarget("api");
  const db = { name: "DB", type: "d1", id: config.d1_databases[0].database_id };
  const rates = config.ratelimits.map((rate) => ({
    ...structuredClone(rate),
    type: "ratelimit",
  }));
  assert.equal(validateBindings("api", config, [db, ...rates]), true);
  assert.equal(validateBindings("api", config, [db]), false);
  assert.equal(
    validateBindings("api", config, [
      db,
      { name: "TELEGRAM_CLIENT_ID", type: "plain_text", text: "" },
    ]),
    false
  );
  for (const client of [
    { type: "plain_text", text: "123" },
    { type: "secret_text" },
  ])
    assert.throws(
      () =>
        validateBindings("api", config, [
          db,
          { name: "TELEGRAM_CLIENT_ID", ...client },
        ]),
      /abuse protection/
    );
  for (const mutate of [
    (r) => r.pop(),
    (r) => r.push(structuredClone(r[0])),
    (r) => {
      r[0].name = "OTHER";
    },
    (r) => {
      r[0].type = "plain_text";
    },
    (r) => {
      r[0].namespace_id = "999";
    },
    (r) => {
      r[0].simple.limit++;
    },
    (r) => {
      r[0].simple.period = 10;
    },
    (r) => {
      delete r[0].simple;
    },
  ]) {
    const candidate = structuredClone(rates);
    mutate(candidate);
    assert.throws(
      () => validateBindings("api", config, [db, ...candidate]),
      /rate limit binding/
    );
  }
  assert.throws(
    () => validateBindings("web", loadTarget("web"), rates),
    /Only API/
  );
});
test("release refuses missing limiter attestation after API upload before health or Bot deploy", async () => {
  for (const ready of [false, undefined]) {
    let uploaded = false;
    const before = {
      tag: "immutable",
      version: "old",
      deployment: "old",
      revision: "a".repeat(40),
    };
    await assert.rejects(
      executePlan(["api", "bot"], {
        states: { api: before },
        revision: "b".repeat(40),
        check: () => {},
        verify: async () =>
          uploaded
            ? {
                ...before,
                version: "new",
                deployment: "new",
                revision: "b".repeat(40),
                authRateLimitsReady: ready,
              }
            : before,
        run: (args) => {
          assert.deepEqual(args, ["deploy:api"]);
          uploaded = true;
        },
        health: () => assert.fail("must fail before health/Bot"),
        report: () => {},
      }),
      /rate limit bindings were not verified/
    );
  }
});
test("strict API config permits only reviewed nonsecret Web auth settings", () => {
  const config = loadTarget("api");
  assert.doesNotThrow(() => validateConfig("api", config, account));
  const validate = (vars) =>
    validateConfig("api", { ...config, vars }, account);
  assert.doesNotThrow(() =>
    validate({
      TELEGRAM_CLIENT_ID: "12345",
      WEB_ORIGINS: "https://web.example,http://localhost:5173",
    })
  );
  for (const vars of [
    {},
    { TELEGRAM_CLIENT_ID: "123", WEB_ORIGINS: "*" },
    { TELEGRAM_CLIENT_ID: "123", WEB_ORIGINS: "https://web.example/path" },
    { TELEGRAM_CLIENT_ID: "123", WEB_ORIGINS: "http://web.example" },
    { TELEGRAM_CLIENT_ID: "unsafe", WEB_ORIGINS: "" },
    { TELEGRAM_CLIENT_ID: "9007199254740992", WEB_ORIGINS: "" },
    {
      TELEGRAM_CLIENT_ID: "123",
      WEB_ORIGINS: "",
      TELEGRAM_BOT_TOKEN: "not-allowed",
    },
  ])
    assert.throws(() => validate(vars));
  assert.throws(() =>
    validateConfig("web", { ...loadTarget("web"), vars: {} }, account)
  );
});
test("isolated Web build refuses missing or credential-bearing API URL before deploy", async () => {
  for (const API_URL of [
    undefined,
    "http://api.example",
    "https://user:secret@api.example",
    "https://api.example?token=secret",
    "https://api.example/path",
  ]) {
    let cleaned = false;
    await assert.rejects(
      deploy("web", {
        env: { RELEASE_REVISION: "b".repeat(40), API_URL },
        checkRevision: () => {},
        prepare: () => ({
          directory: "/tmp/nonexistent-web-auth-test",
          cleanup: () => {
            cleaned = true;
          },
        }),
        spawn: (_, args) => {
          assert.equal(args[0], "install");
          return { status: 0 };
        },
        verify: () => assert.fail("must not inspect or deploy"),
      }),
      /approved HTTPS API origin/
    );
    assert.equal(cleaned, true);
  }
});
