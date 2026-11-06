import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { assertCurrentRevision } from "../cloudflare-deploy.mjs";
import { changedPaths, git, impact, workers } from "./changes.mjs";
import { cloudflare, inspect, names, readJSON } from "./targets.mjs";

export function policy(event, enabled, target, dryRun) {
  if (event === "push")
    return { allowed: enabled === "true", manual: false, dryRun: false };
  if (
    event !== "workflow_dispatch" ||
    ![...workers, "all"].includes(target) ||
    !["true", "false"].includes(dryRun)
  )
    throw new Error("Unknown deployment event/target/dry-run option");
  return {
    allowed: true,
    manual: true,
    dryRun: dryRun === "true",
    targets: target === "all" ? workers : [target],
  };
}
export function selectAutomatic(
  states,
  revision,
  {
    diff = changedPaths,
    ancestor = (base, head) => git(["merge-base", "--is-ancestor", base, head]),
  } = {}
) {
  return workers.filter((worker) => {
    const base = states[worker].revision;
    if (!/^[a-f0-9]{40}$/.test(base ?? ""))
      throw new Error(
        `Unverified ${worker} revision: manually baseline all Workers before enabling automatic CD`
      );
    try {
      ancestor(base, revision);
    } catch {
      throw new Error("Deployed revision is not an ancestor of current main");
    }
    return impact(diff(base, revision)).cd.includes(worker);
  });
}
export async function smoke(
  target,
  fetcher = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetcher(
        `${target.url}${target.worker === "web" ? "/" : "/health"}`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: { "Cache-Control": "no-cache" },
        }
      );
      if (!response.ok) throw new Error("Unhealthy");
      if (target.worker === "web") {
        if (
          !response.headers.get("content-type")?.includes("text/html") ||
          !(await response.text()).includes('<div id="root">')
        )
          throw new Error("Wrong Web response");
      } else {
        const body = await response.json();
        if (
          body.status !== "ok" ||
          (target.worker === "bot" && body.service !== names.bot)
        )
          throw new Error("Wrong health response");
      }
      return;
    } catch {
      /* Only sanitized failure is emitted after bounded propagation retries. */
    }
    if (attempt < 5) await wait(5000);
  }
  throw new Error(`Health verification failed: ${target.worker}`);
}
export function validateScripts() {
  const root = readJSON("package.json").scripts;
  for (const worker of workers) {
    if (
      root[`deploy:${worker}`] !==
      `pnpm --filter @sales-visit/${worker} run deploy`
    )
      throw new Error("Unexpected root deployment script");
    const expected =
      worker === "api"
        ? "node ../../scripts/cloudflare-remote.mjs deploy-api"
        : `node ../../scripts/cloudflare-deploy.mjs ${worker}`;
    if (readJSON(`apps/${worker}/package.json`).scripts.deploy !== expected)
      throw new Error("Unexpected workspace deployment script/override");
  }
  if (root["build:web"] !== "pnpm --filter @sales-visit/web build")
    throw new Error("Unexpected Web build script");
}
export function command(args, env = process.env, spawn = spawnSync) {
  const result = spawn("pnpm", args, { env, stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw new Error(`Release command failed: ${args[0]}`);
}
// All guards run before the first write. Reverify immediately around every deploy.
export async function executePlan(
  targets,
  {
    dryRun,
    states,
    revision,
    verify,
    health = smoke,
    check = assertCurrentRevision,
    run = command,
    report = console.log,
    env = process.env,
  }
) {
  for (const worker of ["web", "api", "bot"].filter((w) =>
    targets.includes(w)
  )) {
    check(revision);
    const before = await verify(worker);
    if (
      before.tag !== states[worker].tag ||
      before.version !== states[worker].version
    )
      throw new Error("Worker changed since preflight");
    if (dryRun) {
      report(`Validation only: ${worker}; no deployment invoked`);
      continue;
    }
    run([`deploy:${worker}`], { ...env, RELEASE_REVISION: revision });
    const after = await verify(worker);
    if (
      after.tag !== before.tag ||
      after.version === before.version ||
      after.deployment === before.deployment ||
      after.revision !== revision
    )
      throw new Error(
        "Deployed resource/version/revision does not match expected update"
      );
    await health(after);
    report(
      `${names[worker]}: deployment=${after.deployment} version=${after.version} revision=${revision}`
    );
  }
}
export async function release({
  env = process.env,
  verify,
  run = command,
  check = assertCurrentRevision,
  report = console.log,
  health = smoke,
  select = selectAutomatic,
} = {}) {
  const decision = policy(
    env.GITHUB_EVENT_NAME,
    env.ENABLE_AUTO_DEPLOY,
    env.DEPLOY_TARGET,
    env.DRY_RUN
  );
  if (!decision.allowed) {
    report(
      "Automatic deployment disabled; no Cloudflare inspection or mutation."
    );
    return;
  }
  if (env.GITHUB_REF !== "refs/heads/main")
    throw new Error("Only main can release");
  const revision = env.GITHUB_SHA;
  check(revision);
  validateScripts();
  const api = cloudflare(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN);
  verify ??= (worker) =>
    inspect(worker, {
      account: env.CLOUDFLARE_ACCOUNT_ID,
      api,
      url: env[`${worker.toUpperCase()}_URL`],
    });
  // A Bot-only release also verifies the existing API, migration state and health,
  // but never redeploys API solely because Bot changed.
  const prerequisites = new Set(decision.manual ? decision.targets : workers);
  if (prerequisites.has("bot")) prerequisites.add("api");
  const states = {};
  for (const worker of prerequisites) states[worker] = await verify(worker);
  const targets = decision.manual ? decision.targets : select(states, revision);
  report(`Affected Workers: ${targets.join(", ") || "none"}`);
  // A revision tag records an upload, not a successful smoke check. Recheck
  // every unchanged active Worker, including an earlier partial/failed release,
  // before a no-op run can succeed or another target can be deployed.
  if (!decision.manual) {
    for (const worker of workers.filter((w) => !targets.includes(w)))
      await health(states[worker]);
  }
  if (!targets.length) return;
  if (targets.includes("bot") && !targets.includes("api"))
    await health(states.api);
  // Validation subprocesses receive no Cloudflare credentials.
  const local = { ...env };
  delete local.CLOUDFLARE_API_TOKEN;
  delete local.CLOUDFLARE_ACCOUNT_ID;
  run(["check"], local);
  run(["test:deployment"], local);
  for (const worker of targets)
    run(["--filter", `@sales-visit/${worker}`, "typecheck"], local);
  if (targets.some((w) => w === "api" || w === "bot")) {
    run(
      [
        "--filter",
        "@sales-visit/contracts",
        "--filter",
        "@sales-visit/db",
        "--filter",
        "@sales-visit/api",
        "test",
      ],
      local
    );
    run(["--filter", "@sales-visit/db", "db:check"], local);
  }
  if (targets.includes("web")) run(["build:web"], local);
  await executePlan(targets, {
    dryRun: decision.dryRun,
    states,
    revision,
    verify,
    health,
    check,
    run,
    report,
    env,
  });
}
function reportSummary(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await release({ report: reportSummary });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
