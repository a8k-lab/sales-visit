import assert from "node:assert/strict";
import test from "node:test";

import { workers } from "./ci/changes.mjs";
import { executePlan, release } from "./ci/release.mjs";

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
    if (state.worker === "api") throw new Error("API unhealthy");
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
