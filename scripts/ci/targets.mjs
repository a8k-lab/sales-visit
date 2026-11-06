import { readFileSync, readdirSync } from "node:fs";

import { parse } from "jsonc-parser";

import { validateRemoteTarget } from "../cloudflare-remote.mjs";

export const names = {
  web: "sales-visit",
  api: "sales-visit-api",
  bot: "sales-visit-bot",
};
// Account-local rate namespaces are declared, not provisioned remote resources.
// Changes require explicit review of both this policy and Wrangler configuration.
export const authRateLimits = [
  {
    name: "AUTH_IP_LIMITER",
    namespace_id: "15001",
    simple: { limit: 20, period: 60 },
  },
  {
    name: "AUTH_GLOBAL_LIMITER",
    namespace_id: "15002",
    simple: { limit: 300, period: 60 },
  },
];
const sameRateLimit = (binding, expected) =>
  binding?.name === expected.name &&
  binding.namespace_id === expected.namespace_id &&
  binding.simple?.limit === expected.simple.limit &&
  binding.simple?.period === expected.simple.period;
export const root = new URL("../../", import.meta.url);
export function readJSON(path, base = root) {
  const errors = [];
  const config = parse(readFileSync(new URL(path, base), "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (errors.length || !config || typeof config !== "object")
    throw new Error(`Invalid JSON/JSONC: ${path}`);
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
    (config.account_id !== undefined && config.account_id !== account)
  )
    throw new Error("Unapproved environment/account/argument override");
  if (config.name !== names[worker]) throw new Error("Unexpected Worker name");
  if (config.workers_dev !== undefined && config.workers_dev !== true)
    throw new Error("workers_dev must be enabled for verified health URLs");
  // This release path has no alternate routes, environments or resource provisioning.
  const allowed = new Set([
    "$schema",
    "name",
    "main",
    "account_id",
    "compatibility_date",
    "compatibility_flags",
    "workers_dev",
    "observability",
    ...(worker === "api" ? ["d1_databases", "vars", "ratelimits"] : []),
    ...(worker === "bot" ? ["services", "secrets"] : []),
    ...(worker === "web" ? ["assets"] : []),
  ]);
  for (const key of Object.keys(config))
    if (!allowed.has(key))
      throw new Error(`Unapproved Wrangler setting: ${key}`);
  if (worker === "api") {
    const rates = config.ratelimits;
    if (
      !Array.isArray(rates) ||
      rates.length !== authRateLimits.length ||
      !authRateLimits.every(
        (expected) =>
          rates.filter(
            (rate) =>
              sameRateLimit(rate, expected) &&
              Object.keys(rate).every((key) =>
                ["name", "namespace_id", "simple"].includes(key)
              ) &&
              Object.keys(rate.simple).length === 2
          ).length === 1
      )
    )
      throw new Error("Unapproved auth rate limit configuration");
    const vars = config.vars;
    if (
      !vars ||
      Object.keys(vars).length !== 2 ||
      typeof vars.TELEGRAM_CLIENT_ID !== "string" ||
      (vars.TELEGRAM_CLIENT_ID !== "" &&
        (!/^[1-9][0-9]*$/.test(vars.TELEGRAM_CLIENT_ID) ||
          !Number.isSafeInteger(Number(vars.TELEGRAM_CLIENT_ID)))) ||
      typeof vars.WEB_ORIGINS !== "string"
    )
      throw new Error("Invalid Web auth configuration");
    for (const origin of vars.WEB_ORIGINS.split(",").filter(Boolean)) {
      const url = URL.parse(origin);
      if (
        !url ||
        url.origin !== origin ||
        !(
          url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(url.hostname))
        )
      )
        throw new Error("Invalid Web origin");
    }
    validateRemoteTarget(config); // Preserve the original remote-operation safeguard.
    if (
      config.d1_databases[0].migrations_dir !== "../../packages/db/migrations"
    )
      throw new Error("Unexpected migrations directory");
    const keys = ["binding", "database_name", "database_id", "migrations_dir"];
    if (Object.keys(config.d1_databases[0]).some((key) => !keys.includes(key)))
      throw new Error("Unapproved D1 setting");
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
export function validateBotBindings(bindings, source = "config") {
  if (source !== "config" && source !== "active-version")
    throw new Error("Unknown Bot binding validation source");
  const services = bindings.filter((b) => b.type === "service");
  const identity = services.find((b) => b.name === "IDENTITY");
  // Cloudflare's API may serialize the default Service environment explicitly.
  // This is NOT permission to select a Wrangler --env or config environment.
  const environment =
    identity?.environment === undefined
      ? "omitted"
      : identity.environment === "production"
        ? "production"
        : "unexpected";
  const checks = {
    serviceCount: services.length,
    expectedBindingPresent: Boolean(identity),
    targetMatch: identity?.service === names.api,
    entrypointMatch: identity?.entrypoint === "BotIdentity",
    unexpectedEnvironment:
      environment !== "omitted" &&
      !(source === "active-version" && environment === "production"),
    environment,
  };
  // Only fixed keys, booleans, a count and a closed enum may reach logs. Never
  // interpolate binding values, names from the response, secrets or raw errors.
  const diagnostic = `[bot-binding-guard] source=${source} ${JSON.stringify(checks)}`;
  if (
    checks.serviceCount !== 1 ||
    !checks.expectedBindingPresent ||
    !checks.targetMatch ||
    !checks.entrypointMatch ||
    checks.unexpectedEnvironment
  )
    throw new Error(`Missing or wrong Bot Service Binding; ${diagnostic}`);
  if (source === "active-version") console.info(diagnostic);
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
  const rates = bindings.filter(
    (binding) =>
      binding.type === "ratelimit" ||
      authRateLimits.some((expected) => expected.name === binding.name)
  );
  if (worker !== "api" && rates.length)
    throw new Error("Only API may bind auth rate limiters");
  if (worker === "api") {
    if (rates.length === 0) {
      // Bootstrap only: existing pre-auth or explicitly disabled API. A partial,
      // misnamed or mismatched limiter is never an acceptable baseline.
      const clients = bindings.filter(
        (binding) => binding.name === "TELEGRAM_CLIENT_ID"
      );
      if (
        clients.length > 1 ||
        clients.some(
          (binding) => binding.type !== "plain_text" || binding.text !== ""
        )
      )
        throw new Error("Active Web login has no verified abuse protection");
      return false;
    }
    if (
      rates.length !== authRateLimits.length ||
      !authRateLimits.every(
        (expected) =>
          rates.filter(
            (rate) => rate.type === "ratelimit" && sameRateLimit(rate, expected)
          ).length === 1
      )
    )
      throw new Error("Missing or wrong auth rate limit binding");
    return true;
  }
  if (worker === "bot") {
    validateBotBindings(bindings, "active-version");
    for (const name of config.secrets.required)
      if (!bindings.some((b) => b.name === name && b.type === "secret_text"))
        throw new Error("Missing deployed Telegram secret name");
  }
}
export function requiredMigrations() {
  return readdirSync(new URL("packages/db/migrations/", root))
    .filter((f) => f.endsWith(".sql"))
    .toSorted();
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
  // Script-version metadata supplies bindings/handlers, not annotations.
  // The Workers API accepts the verified Worker name; request the exact active
  // version UUID, never "latest" (which may be an undeployed upload).
  const annotatedVersion = await api(
    `/workers/workers/${names[worker]}/versions/${version.id}`
  );
  if (annotatedVersion.id !== version.id)
    throw new Error(
      "Revision annotation does not belong to the active version"
    );
  const authRateLimitsReady = validateBindings(
    worker,
    config,
    version.resources?.bindings
  );
  if (
    worker === "api" &&
    !version.resources?.script?.named_handlers?.some(
      (h) => h.name === "BotIdentity"
    )
  )
    throw new Error("Existing API BotIdentity entrypoint cannot be verified");
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
    revision: annotatedVersion.annotations?.["workers/tag"],
    ...(worker === "api" ? { authRateLimitsReady } : {}),
    url,
  };
}
