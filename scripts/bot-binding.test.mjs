import assert from "node:assert/strict";
import test from "node:test";

import {
  loadTarget,
  validateBindings,
  validateBotBindings,
  validateConfig,
} from "./ci/targets.mjs";

const config = loadTarget("bot");
// Documented API shapes, not captured live bindings or credentials:
// https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/#bindings
// https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/
const productionBindings = () => [
  {
    type: "service",
    name: "IDENTITY",
    service: "sales-visit-api",
    entrypoint: "BotIdentity",
    environment: "production",
  },
  ...config.secrets.required.map((name) => ({ name, type: "secret_text" })),
];
const parseDiagnostic = (line) => JSON.parse(line.slice(line.indexOf("{")));

for (const environment of [undefined, "production"])
  test(`active Bot version accepts ${environment ?? "omitted"} default environment`, (t) => {
    const messages = [];
    t.mock.method(console, "info", (line) => messages.push(line));
    const bindings = productionBindings();
    if (environment === undefined) delete bindings[0].environment;
    assert.doesNotThrow(() => validateBindings("bot", config, bindings));
    assert.equal(messages.length, 1);
    assert.deepEqual(parseDiagnostic(messages[0]), {
      serviceCount: 1,
      expectedBindingPresent: true,
      targetMatch: true,
      entrypointMatch: true,
      unexpectedEnvironment: false,
      environment: environment ?? "omitted",
    });
    assert.ok(
      messages[0].startsWith("[bot-binding-guard] source=active-version ")
    );
  });

for (const [label, mutate, expected] of [
  [
    "no service",
    (b) => b.splice(0, 1),
    {
      serviceCount: 0,
      expectedBindingPresent: false,
      targetMatch: false,
      entrypointMatch: false,
    },
  ],
  [
    "extra service",
    (b) => b.push({ ...b[0], name: "unrelated-sensitive" }),
    {
      serviceCount: 2,
      expectedBindingPresent: true,
      targetMatch: true,
      entrypointMatch: true,
    },
  ],
  [
    "duplicate IDENTITY",
    (b) => b.push({ ...b[0] }),
    {
      serviceCount: 2,
      expectedBindingPresent: true,
      targetMatch: true,
      entrypointMatch: true,
    },
  ],
  [
    "wrong name",
    (b) => (b[0].name = "unrelated-sensitive"),
    {
      serviceCount: 1,
      expectedBindingPresent: false,
      targetMatch: false,
      entrypointMatch: false,
    },
  ],
  [
    "wrong target",
    (b) => (b[0].service = "unrelated-sensitive"),
    {
      serviceCount: 1,
      expectedBindingPresent: true,
      targetMatch: false,
      entrypointMatch: true,
    },
  ],
  [
    "wrong entrypoint",
    (b) => (b[0].entrypoint = "unrelated-sensitive"),
    {
      serviceCount: 1,
      expectedBindingPresent: true,
      targetMatch: true,
      entrypointMatch: false,
    },
  ],
])
  test(`genuine ${label} mismatch remains fail-closed with precise sanitized conditions`, (t) => {
    t.mock.method(console, "info", () =>
      assert.fail("failure diagnostic is carried only in the error")
    );
    const bindings = productionBindings();
    mutate(bindings);
    assert.throws(
      () => validateBindings("bot", config, bindings),
      (error) => {
        assert.match(error.message, /Missing or wrong Bot Service Binding/);
        assert.deepEqual(parseDiagnostic(error.message), {
          ...expected,
          unexpectedEnvironment: false,
          environment: expected.expectedBindingPresent
            ? "production"
            : "omitted",
        });
        assert.ok(!error.message.includes("unrelated-sensitive"));
        return true;
      }
    );
  });

for (const environment of [
  "staging",
  "prod",
  "production-v2",
  "production\n",
  "",
  null,
  false,
  1,
  { arbitrary: "unrelated-sensitive" },
])
  test(`unapproved active environment ${JSON.stringify(environment)} is never normalized or logged`, () => {
    const bindings = productionBindings();
    bindings[0].environment = environment;
    assert.throws(
      () => validateBindings("bot", config, bindings),
      (error) => {
        assert.deepEqual(parseDiagnostic(error.message), {
          serviceCount: 1,
          expectedBindingPresent: true,
          targetMatch: true,
          entrypointMatch: true,
          unexpectedEnvironment: true,
          environment: "unexpected",
        });
        assert.ok(!error.message.includes("unrelated-sensitive"));
        return true;
      }
    );
  });

test("API production metadata does not permit an explicit local config environment", () => {
  const target = structuredClone(config);
  target.services[0].environment = "production";
  assert.throws(
    () => validateConfig("bot", target, "a".repeat(32)),
    (error) => {
      assert.ok(error.message.includes("source=config"));
      assert.equal(parseDiagnostic(error.message).unexpectedEnvironment, true);
      return true;
    }
  );
  assert.throws(
    () => validateBotBindings(productionBindings(), "unknown-source"),
    /Unknown/
  );
});

test("diagnostics do not read secret values or serialize arbitrary binding fields", (t) => {
  const messages = [];
  t.mock.method(console, "info", (line) => messages.push(line));
  const bindings = productionBindings();
  for (const binding of bindings)
    Object.defineProperty(binding, "text", {
      get: () => assert.fail("secret value read"),
    });
  bindings.push({
    name: "arbitrary-sensitive",
    type: "plain_text",
    text: "token-sensitive",
  });
  assert.doesNotThrow(() => validateBindings("bot", config, bindings));
  assert.equal(messages.length, 1);
  assert.doesNotMatch(
    messages[0],
    /arbitrary-sensitive|token-sensitive|TELEGRAM|sales-visit-api|BotIdentity/
  );
});

test("production environment acceptance does not relax required secret names", (t) => {
  t.mock.method(console, "info", () => {});
  assert.throws(
    () => validateBindings("bot", config, productionBindings().slice(0, 1)),
    /Missing deployed Telegram secret name/
  );
});
