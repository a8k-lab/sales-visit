import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { readJSON, cloudflare } from "./ci/targets.mjs";

const root = new URL("../", import.meta.url);
export function validateStaging(api, web, production, env) {
  const uuid = env.STAGING_D1_ID;
  const webOrigin = URL.parse(env.STAGING_WEB_ORIGIN ?? "");
  const apiOrigin = URL.parse(env.STAGING_API_ORIGIN ?? "");
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(uuid ?? "") ||
    uuid === "00000000-0000-0000-0000-000000000000" ||
    production.d1_databases.some(
      (db) => db.database_id.toLowerCase() === uuid.toLowerCase()
    ) ||
    !webOrigin ||
    !apiOrigin ||
    webOrigin.origin !== env.STAGING_WEB_ORIGIN ||
    apiOrigin.origin !== env.STAGING_API_ORIGIN ||
    webOrigin.origin === apiOrigin.origin ||
    [webOrigin, apiOrigin].some(
      (url) =>
        url.protocol !== "https:" ||
        url.port ||
        !/^[a-z0-9.-]+$/i.test(url.hostname) ||
        url.hostname.endsWith(".invalid") ||
        url.hostname.endsWith(".workers.dev") ||
        production.vars.WEB_ORIGINS.split(",").includes(url.origin)
    )
  )
    throw new Error(
      "Dedicated staging D1 and custom HTTPS origins must be explicitly approved"
    );
  for (const [config, name, origin] of [
    [api, "sales-visit-api-staging", apiOrigin],
    [web, "sales-visit-web-staging", webOrigin],
  ]) {
    const allowed = new Set([
      "$schema",
      "name",
      "account_id",
      "compatibility_date",
      "workers_dev",
      "preview_urls",
      "routes",
      ...(config === api
        ? ["main", "vars", "d1_databases", "observability"]
        : ["assets"]),
    ]);
    if (
      Object.keys(config).some((key) => !allowed.has(key)) ||
      (config.account_id !== undefined &&
        config.account_id !== env.CLOUDFLARE_ACCOUNT_ID)
    )
      throw new Error("Unapproved staging configuration/account override");
    if (
      config.name !== name ||
      config.env ||
      config.workers_dev !== false ||
      config.preview_urls !== false ||
      config.routes?.length !== 1 ||
      config.routes[0].pattern !== origin.hostname ||
      config.routes[0].custom_domain !== true
    )
      throw new Error(
        "Staging Worker/routes must be isolated with direct and preview URLs disabled"
      );
  }
  const [db, ...extra] = api.d1_databases ?? [];
  if (
    extra.length ||
    db?.binding !== "DB" ||
    db.database_name !== "sales-visit-staging" ||
    db.database_id !== uuid ||
    db.migrations_dir !== "../../packages/db/migrations" ||
    api.main !== "src/worker.ts" ||
    api.vars?.APP_ENV !== "staging" ||
    api.vars.DEMO_AUTH_ENABLED !== "true" ||
    api.vars.WEB_ORIGINS !== webOrigin.origin ||
    api.vars.TELEGRAM_CLIENT_ID !== "" ||
    Object.keys(api.vars).length !== 4 ||
    Object.keys(db).length !== 4 ||
    web.d1_databases ||
    web.assets?.directory !== "./dist" ||
    web.assets.not_found_handling !== "single-page-application"
  )
    throw new Error("Invalid staging bindings/environment");
}
export async function run(action, env = process.env, spawn = spawnSync) {
  if (!["seed-local", "check-staging", "seed-staging"].includes(action))
    throw new Error(
      "Use an explicit local or staging action; production is forbidden"
    );
  for (const key of [
    "WRANGLER_ENV",
    "WRANGLER_CONFIG",
    "WRANGLER_CI_OVERRIDE_NAME",
    "CF_ACCOUNT_ID",
    "CF_API_KEY",
    "CLOUDFLARE_API_KEY",
  ])
    if (env[key]) throw new Error("Environment overrides are forbidden");
  const staging = action !== "seed-local";
  if (staging) {
    validateStaging(
      readJSON("apps/api/wrangler.staging.jsonc"),
      readJSON("apps/web/wrangler.staging.jsonc"),
      readJSON("apps/api/wrangler.jsonc"),
      env
    );
    if (action === "check-staging") return 0;
    if (
      env.STAGING_SEED_CONFIRM !== "sales-visit-staging" ||
      env.STAGING_ACCESS_CONFIRMED !== "true"
    )
      throw new Error(
        "Confirm staging seed and Access protection before remote writes"
      );
    const api = cloudflare(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN);
    const db = await api(`/d1/database/${env.STAGING_D1_ID}`);
    if (db.uuid !== env.STAGING_D1_ID || db.name !== "sales-visit-staging")
      throw new Error("Remote staging D1 mismatch");
  }
  const result = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      staging ? "--remote" : "--local",
      "--config",
      staging ? "wrangler.staging.jsonc" : "wrangler.jsonc",
      "--env-file",
      "/dev/null",
      "--file",
      "seeds/demo.sql",
    ],
    {
      cwd: fileURLToPath(new URL("apps/api/", root)),
      stdio: "inherit",
      env: {
        PATH: env.PATH,
        HOME: env.HOME,
        PNPM_HOME: env.PNPM_HOME,
        CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
        WRANGLER_SEND_METRICS: "false",
      },
    }
  );
  if (result.error || result.status !== 0)
    throw new Error("Demo seed failed; no reset or overwrite attempted");
  return 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error("Arguments/overrides are forbidden");
    process.exitCode = await run(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
