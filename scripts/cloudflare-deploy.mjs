import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { git } from "./ci/changes.mjs";
import { prepareSource } from "./ci/source.mjs";
import { cloudflare, inspect, readJSON } from "./ci/targets.mjs";
import { assertApiCompatibility, smoke } from "./ci/verify-release.mjs";

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
    prepare = prepareSource,
    compatible = assertApiCompatibility,
    health = smoke,
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
  const source = prepare(revision);
  try {
    // Install workspace links inside the snapshot, never against the mutable
    // caller checkout. The prior frozen install populated pnpm's offline store.
    const localEnv = {
      PATH: env.PATH,
      HOME: env.HOME,
      TMPDIR: env.TMPDIR,
      CI: "true",
      LEFTHOOK: "0",
    };
    const local = (command) => {
      const result = spawn("pnpm", command, {
        cwd: source.directory,
        env: localEnv,
        stdio: "ignore",
      });
      if (result.error || result.status !== 0)
        throw new Error(
          "Isolated release install/build failed; no deployment invoked"
        );
    };
    local(["install", "--offline", "--frozen-lockfile", "--ignore-scripts"]);
    if (worker === "web") {
      rmSync(join(source.directory, "apps/web/dist"), {
        recursive: true,
        force: true,
      });
      local(["build:web"]);
    }
    const account = env.CLOUDFLARE_ACCOUNT_ID;
    const target = await verify(worker, {
      account,
      api: cloudflare(account, env.CLOUDFLARE_API_TOKEN),
      url: env[`${worker.toUpperCase()}_URL`],
      config: readJSON(
        `apps/${worker}/wrangler.jsonc`,
        pathToFileURL(`${source.directory}/`)
      ),
    });
    if (worker === "bot") {
      const api = await verify("api", {
        account,
        api: cloudflare(account, env.CLOUDFLARE_API_TOKEN),
        url: env.API_URL,
        config: readJSON(
          "apps/api/wrangler.jsonc",
          pathToFileURL(`${source.directory}/`)
        ),
      });
      compatible(api, revision);
      await health(api);
    }
    checkRevision(revision);
    const result = spawn("pnpm", args, {
      cwd: join(source.directory, "apps", worker),
      // Do not leak bindings, Wrangler responses, or local dotenv credentials.
      stdio: "ignore",
      env: {
        ...localEnv,
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
  } finally {
    source.cleanup();
  }
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
