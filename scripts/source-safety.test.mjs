import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { prepareSource } from "./ci/source.mjs";
import { loadTarget } from "./ci/targets.mjs";
import { deploy } from "./cloudflare-deploy.mjs";

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), "sales-visit-source-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git(["init", "-q"]);
  writeFileSync(join(cwd, "source.txt"), "committed");
  writeFileSync(join(cwd, ".gitignore"), "dist/\n.env\n");
  git(["add", "."]);
  git([
    "-c",
    "user.name=Offline test",
    "-c",
    "user.email=offline@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  ]);
  return { cwd, git, revision: git(["rev-parse", "HEAD"]) };
}
test("release source rejects unstaged, staged and untracked manual changes", (t) => {
  const { cwd, git, revision } = repository(t);
  writeFileSync(join(cwd, "source.txt"), "dirty");
  assert.throws(() => prepareSource(revision, { cwd }), /Dirty source/);
  git(["add", "source.txt"]);
  assert.throws(() => prepareSource(revision, { cwd }), /Dirty source/);
  git(["restore", "--staged", "source.txt"]);
  git(["restore", "source.txt"]);
  writeFileSync(join(cwd, "untracked.txt"), "untracked");
  assert.throws(() => prepareSource(revision, { cwd }), /Dirty source/);
});
test("isolated snapshot excludes ignored dist/dotenv and freezes source against later edits", (t) => {
  const { cwd, revision } = repository(t);
  mkdirSync(join(cwd, "dist"));
  writeFileSync(join(cwd, "dist/index.html"), "stale assets");
  writeFileSync(join(cwd, ".env"), "VITE_SYNTHETIC=unreviewed");
  const source = prepareSource(revision, { cwd });
  t.after(source.cleanup);
  writeFileSync(join(cwd, "source.txt"), "changed after snapshot");
  assert.equal(
    readFileSync(join(source.directory, "source.txt"), "utf8"),
    "committed"
  );
  assert.equal(existsSync(join(source.directory, "dist")), false);
  assert.equal(existsSync(join(source.directory, ".env")), false);
  source.cleanup();
  assert.equal(existsSync(source.directory), false);
});

function snapshot(t) {
  const directory = mkdtempSync(join(tmpdir(), "sales-visit-web-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "apps/web/dist"), { recursive: true });
  writeFileSync(join(directory, "apps/web/dist/index.html"), "stale");
  writeFileSync(
    join(directory, "apps/web/wrangler.jsonc"),
    JSON.stringify(loadTarget("web"))
  );
  return directory;
}
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  RELEASE_REVISION: "a".repeat(40),
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  CLOUDFLARE_API_TOKEN: "offline-only",
  VITE_UNREVIEWED: "do not inherit",
  WEB_URL: "https://synthetic.invalid",
};
test("manual Web deployment rebuilds isolated assets before applying the revision tag", async (t) => {
  const directory = snapshot(t);
  const commands = [];
  let cleaned = false;
  await deploy("web", {
    env,
    checkRevision: () => {},
    prepare: () => ({
      directory,
      cleanup: () => {
        cleaned = true;
      },
    }),
    verify: async (_, options) => {
      assert.equal(options.config.assets.directory, "./dist");
      return { tag: "immutable" };
    },
    spawn: (_, args, options) => {
      commands.push(args);
      if (!args.includes("deploy")) {
        assert.equal(options.env.CLOUDFLARE_API_TOKEN, undefined);
        assert.equal(options.env.VITE_UNREVIEWED, undefined);
      }
      if (args[0] === "build:web") {
        assert.equal(
          existsSync(join(directory, "apps/web/dist/index.html")),
          false
        );
        mkdirSync(join(directory, "apps/web/dist"));
        writeFileSync(
          join(directory, "apps/web/dist/index.html"),
          "fresh from verified source"
        );
      }
      if (args.includes("deploy")) {
        assert.equal(options.cwd, join(directory, "apps/web"));
        assert.equal(
          readFileSync(join(options.cwd, "dist/index.html"), "utf8"),
          "fresh from verified source"
        );
      }
      return { status: 0 };
    },
  });
  assert.deepEqual(commands.slice(0, 2), [
    ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
    ["build:web"],
  ]);
  assert.ok(commands[2].includes("--tag"));
  assert.equal(cleaned, true);
});
for (const failure of ["install", "build:web"])
  test(`failed isolated ${failure} blocks Wrangler and cleans snapshot`, async (t) => {
    const directory = snapshot(t);
    let cleaned = false;
    await assert.rejects(
      deploy("web", {
        env,
        checkRevision: () => {},
        prepare: () => ({
          directory,
          cleanup: () => {
            cleaned = true;
          },
        }),
        verify: () =>
          assert.fail("no Cloudflare inspection after failed build"),
        spawn: (_, args) => {
          assert.ok(!args.includes("deploy"));
          return { status: args[0] === failure ? 1 : 0 };
        },
      }),
      /install\/build failed/
    );
    assert.equal(cleaned, true);
  });
