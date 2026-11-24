import assert from "node:assert/strict";
import { test } from "node:test";

import { readJSON } from "./ci/targets.mjs";
import { run, validateStaging } from "./demo-environment.mjs";

const production = readJSON("apps/api/wrangler.jsonc");
const env = {
  STAGING_D1_ID: "12345678-1234-4234-8234-123456789abc",
  STAGING_WEB_ORIGIN: "https://staging.example.com",
  STAGING_API_ORIGIN: "https://api.staging.example.com",
};
function configs() {
  const api = readJSON("apps/api/wrangler.staging.jsonc");
  const web = readJSON("apps/web/wrangler.staging.jsonc");
  api.d1_databases[0].database_id = env.STAGING_D1_ID;
  api.vars.WEB_ORIGINS = env.STAGING_WEB_ORIGIN;
  api.routes[0].pattern = "api.staging.example.com";
  web.routes[0].pattern = "staging.example.com";
  return { api, web };
}
test("staging templates fail closed until distinct D1 and exact custom origins are approved", () => {
  assert.throws(() =>
    validateStaging(
      readJSON("apps/api/wrangler.staging.jsonc"),
      readJSON("apps/web/wrangler.staging.jsonc"),
      production,
      env
    )
  );
  const { api, web } = configs();
  assert.doesNotThrow(() => validateStaging(api, web, production, env));
  for (const change of [
    (a) => {
      a.name = production.name;
    },
    (a) => {
      a.d1_databases[0].database_id = production.d1_databases[0].database_id;
    },
    (a) => {
      a.d1_databases[0].database_name = "sales-visit";
    },
    (a) => {
      a.vars.APP_ENV = "production";
    },
    (a) => {
      a.vars.WEB_ORIGINS = "*";
    },
    (a) => {
      a.workers_dev = true;
    },
    (a) => {
      a.preview_urls = true;
    },
    (a) => {
      a.routes.push({
        pattern: "unprotected.example.com",
        custom_domain: true,
      });
    },
    (a) => {
      a.env = { production: {} };
    },
    (_, w) => {
      w.name = "sales-visit";
    },
    (_, w) => {
      w.workers_dev = true;
    },
    (_, w) => {
      w.preview_urls = true;
    },
  ]) {
    const { api: changedApi, web: changedWeb } = configs();
    change(changedApi, changedWeb);
    assert.throws(() =>
      validateStaging(changedApi, changedWeb, production, env)
    );
  }
  for (const overrides of [
    { STAGING_D1_ID: production.d1_databases[0].database_id },
    { STAGING_D1_ID: production.d1_databases[0].database_id.toUpperCase() },
    { STAGING_D1_ID: "00000000-0000-0000-0000-000000000000" },
    { STAGING_WEB_ORIGIN: "https://staging.example.com/path" },
    { STAGING_API_ORIGIN: "https://api.account.workers.dev" },
    { STAGING_WEB_ORIGIN: "https://user:secret@staging.example.com" },
    { STAGING_WEB_ORIGIN: "https://staging.example.invalid" },
  ])
    assert.throws(() =>
      validateStaging(api, web, production, { ...env, ...overrides })
    );
});
test("demo seeding has explicit local target, no reset, no production mode or argument overrides", async () => {
  let calls = 0;
  const spawn = (command, args, options) => {
    calls++;
    assert.equal(command, "pnpm");
    assert.ok(args.includes("--local"));
    assert.ok(!args.includes("--remote"));
    assert.deepEqual(args.slice(-2), ["--file", "seeds/demo.sql"]);
    assert.ok(options.cwd.endsWith("/apps/api/"));
    return { status: 0 };
  };
  assert.equal(await run("seed-local", {}, spawn), 0);
  assert.equal(calls, 1);
  for (const action of ["production", "seed-production", "", "seed", "deploy"])
    await assert.rejects(
      run(action, {}, () => assert.fail("must not invoke Wrangler"))
    );
  for (const key of [
    "WRANGLER_ENV",
    "WRANGLER_CONFIG",
    "WRANGLER_CI_OVERRIDE_NAME",
    "CF_ACCOUNT_ID",
    "CF_API_KEY",
    "CLOUDFLARE_API_KEY",
  ])
    await assert.rejects(
      run("seed-local", { [key]: "override" }, () =>
        assert.fail("must not invoke Wrangler")
      )
    );
  await assert.rejects(
    run("seed-staging", {}, () =>
      assert.fail("unconfigured staging must not write")
    )
  );
});
