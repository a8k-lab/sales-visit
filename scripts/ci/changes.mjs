import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const workers = ["web", "api", "bot"];

// CI includes RPC consumers; CD only includes potentially changed artifacts.
export function impact(paths) {
  const ci = new Set();
  const cd = new Set();
  let db = false;
  let helpers = false;
  const add = (targets, deploy = true) => {
    for (const target of targets) {
      ci.add(target);
      if (deploy) cd.add(target);
    }
  };
  for (const path of paths) {
    if (/\.md$|^docs\//.test(path)) continue;
    if (path.startsWith("apps/web/")) add(["web"]);
    else if (path.startsWith("apps/api/")) {
      add(["api"]);
      add(["bot"], false);
    } else if (path.startsWith("apps/bot/")) {
      add(["bot"]);
      add(["api"], false); // Integration tests live in apps/api.
    } else if (path.startsWith("packages/contracts/")) add(workers);
    else if (path.startsWith("packages/db/")) {
      add(["api"]);
      add(["bot"], false);
      db = true;
    } else if (/^(scripts\/|\.github\/)/.test(path)) {
      add(workers, false);
      helpers = true;
    } else if (
      /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*|\.ox.*|lefthook\.yaml|\.npmrc|\.node-version)$/.test(
        path
      )
    ) {
      add(workers);
      db = true;
      helpers = true;
    }
  }
  return {
    ci: workers.filter((w) => ci.has(w)),
    cd: workers.filter((w) => cd.has(w)),
    db,
    helpers,
  };
}

export function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function changedPaths(base, head, pr = false, run = git) {
  if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha)))
    throw new Error("Missing or invalid comparison revision");
  // An initial branch push has no trustworthy base: include the whole tree.
  if (/^0{40}$/.test(base))
    return run(["ls-tree", "-r", "--name-only", "-z", head])
      .split("\0")
      .filter(Boolean);
  return run([
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    `${base}${pr ? "..." : ".."}${head}`,
  ])
    .split("\0")
    .filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let event;
  try {
    event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  } catch {
    throw new Error("Cannot read GitHub event JSON");
  }
  const pr = event.pull_request;
  const result = impact(
    changedPaths(
      pr?.base.sha ?? event.before,
      pr?.head.sha ?? process.env.GITHUB_SHA,
      Boolean(pr)
    )
  );
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    for (const w of workers)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `${w}=${result.ci.includes(w)}\n`
      );
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `db=${result.db}\nhelpers=${result.helpers}\n`
    );
  }
}
