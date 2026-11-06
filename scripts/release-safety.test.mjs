import assert from "node:assert/strict";
import test from "node:test";

import { workers } from "./ci/changes.mjs";
import { assertApiCompatibility, executePlan, release } from "./ci/release.mjs";

const revision = "a".repeat(40);
const env = {
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: revision,
  ENABLE_AUTO_DEPLOY: "true",
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  CLOUDFLARE_API_TOKEN: "offline-only",
};
const states = () =>
  Object.fromEntries(
    workers.map((worker) => [
      worker,
      {
        worker,
        tag: worker,
        version: "uploaded",
        deployment: "uploaded",
        revision,
      },
    ])
  );

test("same-revision rerun rechecks health after an upload committed but smoke failed", async () => {
  const active = states();
  const before = { ...active.api, version: "previous", deployment: "previous" };
  let uploaded = false;
  const unhealthy = async (state) => {
    if (state.worker === before.worker) throw new Error("API unhealthy");
  };
  await assert.rejects(
    executePlan(["api"], {
      states: { api: before },
      revision,
      check: () => {},
      verify: async () => (uploaded ? active.api : before),
      run: () => {
        uploaded = true;
      },
      health: unhealthy,
      report: () => {},
    }),
    /API unhealthy/
  );
  const checks = [];
  const options = {
    env,
    check: () => {},
    verify: async (w) => active[w],
    select: () => [],
    run: () => assert.fail("unchanged artifacts must not be deployed"),
    report: () => {},
    health: async (state) => {
      checks.push(state.worker);
      await unhealthy(state);
    },
  };
  await assert.rejects(release(options), /API unhealthy/);
  assert.ok(checks.includes("api"));
  checks.length = 0;
  await release({
    ...options,
    health: async (state) => checks.push(state.worker),
  });
  assert.deepEqual(checks, workers);
});

test("API compatibility is proven from verified source, not liveness or Telegram credentials", () => {
  const api = { ...states().api, revision: "c".repeat(40) };
  const compared = [];
  const options = {
    ancestor: () => {},
    diff: (base, head) => {
      compared.push([base, head]);
      return ["apps/bot/src/commands.ts", "docs/ci-cd.md"];
    },
  };
  assert.doesNotThrow(() => assertApiCompatibility(api, revision, options));
  assert.deepEqual(compared, [[api.revision, revision]]);
  for (const path of [
    "apps/api/src/worker.ts",
    "packages/contracts/src/visit-wizard.ts",
    "packages/db/src/schema.ts",
    "pnpm-lock.yaml",
  ]) {
    assert.throws(
      () =>
        assertApiCompatibility(api, revision, {
          ...options,
          diff: () => [path],
        }),
      /release current API first/
    );
  }
  for (const missing of [undefined, "", "unknown"])
    assert.throws(
      () =>
        assertApiCompatibility(
          { ...api, revision: missing },
          revision,
          options
        ),
      /unverified/
    );
  assert.throws(
    () =>
      assertApiCompatibility(api, revision, {
        ...options,
        ancestor: () => {
          throw new Error("history unavailable");
        },
      }),
    /unverified/
  );
});

test("Bot-only release refuses a live API predating the visitWizard contract", async () => {
  await assert.rejects(
    release({
      env: {
        ...env,
        GITHUB_EVENT_NAME: "workflow_dispatch",
        DEPLOY_TARGET: "bot",
        DRY_RUN: "false",
      },
      check: () => {},
      report: () => {},
      verify: async (w) => ({ ...states()[w], revision: "c".repeat(40) }),
      compatible: (api, head) =>
        assertApiCompatibility(api, head, {
          ancestor: () => {},
          diff: () => ["apps/api/src/worker.ts"],
        }),
      health: async () => {}, // Liveness does not establish visitWizard support.
      run: () =>
        assert.fail("incompatible API must block Bot upload and all commands"),
    }),
    /release current API first/
  );
});

test("Bot upload rechecks that the compatible API version has not changed", async () => {
  const active = states();
  await assert.rejects(
    executePlan(["bot"], {
      states: active,
      revision,
      check: () => {},
      report: () => {},
      verify: async (w) =>
        w === "api"
          ? { ...active.api, version: "external change" }
          : active.bot,
      health: () => assert.fail("changed API must block Bot"),
      run: () => assert.fail("changed API must block Bot"),
    }),
    /API changed/
  );
});

test("a partially failed unchanged Worker blocks a subsequent different target", async () => {
  await assert.rejects(
    release({
      env,
      check: () => {},
      verify: async (w) => states()[w],
      select: () => ["bot"],
      run: () => assert.fail("no writes before unchanged Worker smoke passes"),
      report: () => {},
      health: async (state) => {
        if (state.worker === "web") throw new Error("Web unhealthy");
      },
    }),
    /Web unhealthy/
  );
});
