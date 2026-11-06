import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { root } from "./targets.mjs";

// Refuse dirty manual source, then freeze tracked inputs. In particular, ignored
// dist, dotenv files, node_modules and concurrent working-tree edits cannot enter
// the snapshot or supply workspace packages through links to the original tree.
export function prepareSource(
  revision,
  { cwd = fileURLToPath(root), run = execFileSync } = {}
) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? ""))
    throw new Error("Invalid source revision");
  if (
    run("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd,
      encoding: "utf8",
    }).trim()
  )
    throw new Error(
      "Dirty source: commit or remove tracked/untracked changes before release"
    );
  if (
    run("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim() !==
    revision
  )
    throw new Error("Source revision changed before snapshot");
  const directory = mkdtempSync(join(tmpdir(), "sales-visit-release-"));
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  try {
    const archive = run("git", ["archive", "--format=tar", revision], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    run("tar", ["-xf", "-", "-C", directory], {
      input: archive,
      stdio: ["pipe", "ignore", "pipe"],
    });
    return { directory, cleanup };
  } catch {
    cleanup();
    throw new Error("Could not prepare isolated release source");
  }
}
