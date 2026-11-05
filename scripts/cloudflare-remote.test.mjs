import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateRemoteTarget } from "./cloudflare-remote.mjs";

const config = JSON.parse(
  readFileSync(new URL("../apps/api/wrangler.jsonc", import.meta.url), "utf8")
);
// Synthetic test UUID only; never written to deployment configuration.
const valid = () => ({
  ...config,
  d1_databases: [
    {
      ...config.d1_databases[0],
      database_id: "12345678-1234-4234-8234-123456789abc",
    },
  ],
});

test("only the exact API/DB target and a non-placeholder UUID are accepted", () => {
  assert.doesNotThrow(() => validateRemoteTarget(valid()));
  for (const value of [
    undefined,
    "",
    "local",
    "00000000-0000-0000-0000-000000000000",
  ]) {
    const target = valid();
    target.d1_databases[0].database_id = value;
    assert.throws(() => validateRemoteTarget(target), /blocked/);
  }
  for (const mutate of [
    (target) => (target.name = "other-worker"),
    (target) => (target.main = "src/index.ts"),
    (target) => (target.d1_databases[0].database_name = "other-db"),
    (target) => (target.d1_databases[0].binding = "OTHER"),
    (target) => target.d1_databases.push(target.d1_databases[0]),
    (target) => (target.d1_databases = []),
  ]) {
    const target = valid();
    mutate(target);
    assert.throws(() => validateRemoteTarget(target), /blocked/);
  }
});

test("unprovisioned checkout blocks remote commands before starting Wrangler", () => {
  if (
    config.d1_databases[0].database_id !==
    "00000000-0000-0000-0000-000000000000"
  )
    return;
  for (const action of ["deploy-api", "migrate-remote", "verify-remote"]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/cloudflare-remote.mjs", action],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Remote operation blocked/);
    assert.equal(result.stdout, "");
  }
});
