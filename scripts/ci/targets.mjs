import { readFileSync, readdirSync } from "node:fs";

import ts from "typescript";

import { validateRemoteTarget } from "../cloudflare-remote.mjs";

export const names = {
  web: "sales-visit",
  api: "sales-visit-api",
  bot: "sales-visit-bot",
};
export const root = new URL("../../", import.meta.url);
export function readJSON(path) {
  const { config, error } = ts.parseConfigFileTextToJson(
    path,
    readFileSync(new URL(path, root), "utf8")
  );
  if (error) throw new Error(`Invalid JSON/JSONC: ${path}`);
  return config;
}
export function loadTarget(worker) {
  if (!Object.hasOwn(names, worker))
    throw new Error("Unknown deployment target");
  return readJSON(`apps/${worker}/wrangler.jsonc`);
}
export function validateConfig(worker, config, account, overrides = []) {
  if (!Object.hasOwn(names, worker))
    throw new Error("Unknown deployment target");
  if (!/^[a-f0-9]{32}$/.test(account ?? ""))
    throw new Error("Missing or invalid account ID");
  if (
    overrides.length ||
    config.env ||
    (config.account_id && config.account_id !== account)
  )
    throw new Error("Unapproved environment/account/argument override");
  if (config.name !== names[worker]) throw new Error("Unexpected Worker name");
  // This release path has no alternate routes, environments or resource provisioning.
  for (const key of [
    "route",
    "routes",
    "build",
    "legacy_env",
    "kv_namespaces",
    "r2_buckets",
    "queues",
    "durable_objects",
    "dispatch_namespaces",
  ])
    if (config[key] !== undefined)
      throw new Error(`Unapproved Wrangler setting: ${key}`);
  if (worker === "api") {
    validateRemoteTarget(config); // Preserve the original remote-operation safeguard.
    if (
      config.d1_databases[0].migrations_dir !== "../../packages/db/migrations"
    )
      throw new Error("Unexpected migrations directory");
    if (config.services?.length)
      throw new Error("Unexpected API Service Binding");
  } else if (config.d1_databases?.length)
    throw new Error("Only API may bind D1");
  if (worker === "bot") {
    if (config.main !== "src/index.ts")
      throw new Error("Unexpected Bot entrypoint");
    validateBotBindings(
      (config.services ?? []).map((b) => ({
        ...b,
        name: b.binding,
        type: "service",
      }))
    );
    const required = config.secrets?.required;
    if (
      !Array.isArray(required) ||
      required.length !== 2 ||
      !["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"].every((n) =>
        required.includes(n)
      )
    )
      throw new Error("Missing required Telegram secret declarations");
  }
  if (
    worker === "web" &&
    (config.main ||
      config.assets?.directory !== "./dist" ||
      config.assets?.not_found_handling !== "single-page-application")
  )
    throw new Error("Unexpected static assets configuration");
}
export function validateBotBindings(bindings) {
  const services = bindings.filter((b) => b.type === "service");
  if (
    services.length !== 1 ||
    services[0].name !== "IDENTITY" ||
    services[0].service !== names.api ||
    services[0].entrypoint !== "BotIdentity" ||
    services[0].environment
  )
    throw new Error("Missing or wrong Bot Service Binding");
}
export function validateBindings(worker, config, bindings) {
  if (!Array.isArray(bindings))
    throw new Error("Unavailable deployed bindings");
  const databases = bindings.filter((b) => b.type === "d1");
  if (worker === "api") {
    if (
      databases.length !== 1 ||
      databases[0].name !== "DB" ||
      databases[0].id !== config.d1_databases[0].database_id
    )
      throw new Error("Missing or wrong D1 binding");
  } else if (databases.length) throw new Error("Only API may bind D1");
  if (worker === "bot") {
    validateBotBindings(bindings);
    for (const name of config.secrets.required)
      if (!bindings.some((b) => b.name === name && b.type === "secret_text"))
        throw new Error("Missing deployed Telegram secret name");
  }
}
export function requiredMigrations() {
  return readdirSync(new URL("packages/db/migrations/", root))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}
export function validateMigrations(result, required = requiredMigrations()) {
  const query = result?.[0];
  if (
    result?.length !== 1 ||
    query?.success !== true ||
    !Array.isArray(query.results)
  )
    throw new Error("Migration verification unavailable");
  const applied = query.results.map((row) => row.name);
  if (
    new Set(applied).size !== applied.length ||
    required.some((name) => !applied.includes(name)) ||
    applied.some((name) => !required.includes(name))
  )
    throw new Error(
      "Pending or unexpected remote migration; manual review required"
    );
}
export function cloudflare(account, token, fetcher = fetch) {
  if (!/^[a-f0-9]{32}$/.test(account ?? "") || !token)
    throw new Error("Cloudflare credentials missing/invalid");
  return async (path, body) => {
    let response;
    let payload;
    try {
      response = await fetcher(
        `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
        {
          method: body ? "POST" : "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        }
      );
      payload = await response.json();
    } catch {
      throw new Error("Cloudflare inspection unavailable");
    }
    if (!response.ok || payload.success !== true || payload.result == null)
      throw new Error(
        `Cloudflare inspection refused (HTTP ${response.status})`
      );
    return payload.result; // Never log raw responses, bindings or authentication errors.
  };
}
export async function inspect(
  worker,
  { account, api, url, config = loadTarget(worker) }
) {
  validateConfig(worker, config, account);
  const identity = await api("");
  if (identity.id !== account) throw new Error("Wrong Cloudflare account");
  const prefix = `/workers/scripts/${names[worker]}`;
  const scripts = await api("/workers/scripts");
  if (!Array.isArray(scripts)) throw new Error("Unavailable Worker list");
  const matches = scripts.filter((s) => s.id === names[worker]);
  const script = matches[0];
  if (matches.length !== 1 || !script.tag)
    throw new Error("Missing or unexpected existing Worker");
  const deployment = (await api(`${prefix}/deployments`)).deployments?.[0];
  const versions = deployment?.versions;
  if (
    !deployment?.id ||
    versions?.length !== 1 ||
    versions[0].percentage !== 100
  )
    throw new Error(
      "Unavailable or split deployment; operator review required"
    );
  const version = await api(`${prefix}/versions/${versions[0].version_id}`);
  if (version.id !== versions[0].version_id)
    throw new Error("Wrong deployed version");
  validateBindings(worker, config, version.resources?.bindings);
  const subdomain = (await api("/workers/subdomain")).subdomain;
  const enabled = (await api(`${prefix}/subdomain`)).enabled;
  if (
    !/^[a-z0-9-]+$/.test(subdomain ?? "") ||
    enabled !== true ||
    url !== `https://${names[worker]}.${subdomain}.workers.dev`
  )
    throw new Error(
      "Missing or unverified Worker URL (use the exact HTTPS origin)"
    );
  if (worker === "api") {
    const db = config.d1_databases[0];
    const remote = await api(`/d1/database/${db.database_id}`);
    if (remote.uuid !== db.database_id || remote.name !== db.database_name)
      throw new Error("Wrong D1 database");
    validateMigrations(
      await api(`/d1/database/${db.database_id}/query`, {
        sql: "SELECT name FROM d1_migrations ORDER BY id",
      })
    );
  }
  return {
    worker,
    config,
    tag: script.tag,
    deployment: deployment.id,
    version: version.id,
    revision: version.annotations?.["workers/tag"],
    url,
  };
}
