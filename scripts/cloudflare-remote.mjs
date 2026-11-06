import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Keep the API config JSON-compatible so validation needs no JSONC dependency.
export function validateRemoteTarget(config) {
  const [db, ...extra] = config.d1_databases ?? [];
  if (
    config.name !== "sales-visit-api" ||
    config.main !== "src/worker.ts" ||
    extra.length ||
    db?.binding !== "DB" ||
    db.database_name !== "sales-visit" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(db.database_id) ||
    db.database_id === "00000000-0000-0000-0000-000000000000"
  ) {
    throw new Error(
      "Remote operation blocked: set the actual sales-visit D1 UUID in apps/api/wrangler.jsonc after verifying your Cloudflare account. See docs/deployment.md."
    );
  }
}

const commands = {
  "deploy-api": ["deploy", "--minify"],
  "migrate-remote": ["d1", "migrations", "apply", "DB", "--remote"],
  "verify-remote": [
    "d1",
    "execute",
    "DB",
    "--remote",
    "--file",
    "../../scripts/verify-d1.sql",
  ],
};

export function run(action) {
  const args = commands[action];
  if (!args) throw new Error("Unknown remote operation");
  const cwd = fileURLToPath(new URL("../apps/api/", import.meta.url));
  let config;
  try {
    config = JSON.parse(readFileSync(`${cwd}/wrangler.jsonc`, "utf8"));
  } catch {
    throw new Error(
      "Cannot read API configuration: keep wrangler.jsonc valid JSON."
    );
  }
  validateRemoteTarget(config);
  // Deployment adds existing-resource/account checks; migration actions stay
  // separate operator-only commands and retain the original target validation.
  const result =
    action === "deploy-api"
      ? spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL("./cloudflare-deploy.mjs", import.meta.url)),
            "api",
          ],
          { stdio: "inherit" }
        )
      : spawnSync("pnpm", ["exec", "wrangler", ...args], {
          cwd,
          stdio: "inherit",
        });
  if (result.error) throw new Error("Could not start Wrangler");
  return result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error("Remote operation arguments/overrides are not allowed");
    process.exitCode = run(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
