import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { git } from "./ci/changes.mjs";
import { cloudflare, inspect, root } from "./ci/targets.mjs";

export function assertCurrentRevision(revision, run = git) {
  if (
    !/^[a-f0-9]{40}$/.test(revision ?? "") ||
    run(["rev-parse", "HEAD"]) !== revision ||
    run(["ls-remote", "origin", "refs/heads/main"]).split(/\s/)[0] !== revision
  )
    throw new Error("Stale workflow revision: only current main may deploy");
}
export function wranglerArgs(worker, revision) {
  if (
    !["web", "api", "bot"].includes(worker) ||
    !/^[a-f0-9]{40}$/.test(revision ?? "")
  )
    throw new Error("Invalid deploy command");
  return [
    "exec",
    "wrangler",
    "deploy",
    ...(worker === "api" ? ["--minify"] : []),
    "--config",
    "wrangler.jsonc",
    "--env-file",
    "/dev/null",
    "--tag",
    revision,
  ];
}
export async function deploy(
  worker,
  {
    env = process.env,
    spawn = spawnSync,
    checkRevision = assertCurrentRevision,
    verify = inspect,
  } = {}
) {
  for (const key of [
    "WRANGLER_ENV",
    "CF_ACCOUNT_ID",
    "CF_API_KEY",
    "CLOUDFLARE_API_KEY",
    "WRANGLER_CONFIG",
    "WRANGLER_CI_OVERRIDE_NAME",
  ])
    if (env[key]) throw new Error("Unapproved Wrangler environment override");
  const revision = env.RELEASE_REVISION;
  const args = wranglerArgs(worker, revision);
  checkRevision(revision);
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const target = await verify(worker, {
    account,
    api: cloudflare(account, env.CLOUDFLARE_API_TOKEN),
    url: env[`${worker.toUpperCase()}_URL`],
  });
  checkRevision(revision);
  const result = spawn("pnpm", args, {
    cwd: fileURLToPath(new URL(`apps/${worker}/`, root)),
    // Do not leak bindings, Wrangler responses, or local dotenv credentials.
    stdio: "ignore",
    env: {
      PATH: env.PATH,
      HOME: env.HOME,
      TMPDIR: env.TMPDIR,
      CI: "true",
      CLOUDFLARE_ACCOUNT_ID: account,
      CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
      WRANGLER_CI_MATCH_TAG: target.tag,
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG: "error",
      WRANGLER_LOG_PATH: "/dev/null",
    },
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Deployment failed: ${worker}; inspect privately before retrying`
    );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error("Deployment arguments/overrides are not allowed");
    await deploy(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
