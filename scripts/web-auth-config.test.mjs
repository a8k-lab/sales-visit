import assert from "node:assert/strict";
import test from "node:test";

import { loadTarget, validateConfig } from "./ci/targets.mjs";
import { deploy } from "./cloudflare-deploy.mjs";
const account = "a".repeat(32);
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
