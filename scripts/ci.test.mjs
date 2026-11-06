import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { changedPaths, impact, workers } from "./ci/changes.mjs";
import {
  command,
  executePlan,
  policy,
  release,
  selectAutomatic,
  smoke,
  validateScripts,
} from "./ci/release.mjs";
import {
  cloudflare,
  inspect,
  loadTarget,
  names,
  requiredMigrations,
  validateBindings,
  validateConfig,
  validateMigrations,
} from "./ci/targets.mjs";
import {
  assertCurrentRevision,
  deploy,
  wranglerArgs,
} from "./cloudflare-deploy.mjs";

const account = "a".repeat(32);
const revision = "b".repeat(40);
const older = "c".repeat(40);
const token = "synthetic-offline-token";
const configs = Object.fromEntries(workers.map((w) => [w, loadTarget(w)]));
const bindings = (worker) =>
  worker === "api"
    ? [{ name: "DB", type: "d1", id: configs.api.d1_databases[0].database_id }]
    : worker === "bot"
      ? [
          {
            name: "IDENTITY",
            type: "service",
            service: names.api,
            entrypoint: "BotIdentity",
          },
          ...configs.bot.secrets.required.map((name) => ({
            name,
            type: "secret_text",
          })),
        ]
      : [];
const history = () => [
  { success: true, results: requiredMigrations().map((name) => ({ name })) },
];
const url = (w) => `https://${names[w]}.verified-subdomain.workers.dev`;
const oldVersion = "11111111-1111-4111-8111-111111111111";
const newVersion = "22222222-2222-4222-8222-222222222222";
const oldDeployment = "33333333-3333-4333-8333-333333333333";
const newDeployment = "44444444-4444-4444-8444-444444444444";
// Separate documented schemas: scripts/versions supplies resources, while
// workers/versions supplies annotations. Neither is a combined response.
// https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/
// https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/
function fixture(
  worker = "api",
  replace = {},
  {
    versionId = oldVersion,
    deploymentId = oldDeployment,
    annotations = { "workers/tag": older },
  } = {}
) {
  const prefix = `/workers/scripts/${names[worker]}`;
  const data = {
    "": { id: account },
    "/workers/scripts": workers.map((w) => ({
      id: names[w],
      tag: `immutable-${w}`,
    })),
    [`${prefix}/deployments`]: {
      deployments: [
        {
          id: deploymentId,
          created_on: "2026-11-06T00:00:00Z",
          source: "api",
          strategy: "percentage",
          versions: [{ version_id: versionId, percentage: 100 }],
        },
      ],
    },
    [`${prefix}/versions/${versionId}`]: {
      id: versionId,
      resources: {
        bindings: bindings(worker),
        script: { named_handlers: [{ name: "BotIdentity" }] },
      },
    },
    [`/workers/workers/${names[worker]}/versions/${versionId}`]: {
      id: versionId,
      created_on: "2026-11-06T00:00:00Z",
      number: 1,
      urls: [],
      annotations,
    },
    "/workers/subdomain": { subdomain: "verified-subdomain" },
    [`${prefix}/subdomain`]: { enabled: true },
    [`/d1/database/${configs.api.d1_databases[0].database_id}`]: {
      uuid: configs.api.d1_databases[0].database_id,
      name: "sales-visit",
    },
    [`/d1/database/${configs.api.d1_databases[0].database_id}/query`]:
      history(),
    ...replace,
  };
  const requests = [];
  const api = cloudflare(account, token, async (request, options) => {
    const path = request.replace(
      `https://api.cloudflare.com/client/v4/accounts/${account}`,
      ""
    );
    requests.push({ path, options });
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.ok(Object.hasOwn(data, path), `Unexpected inspection: ${path}`);
    return Response.json({ success: true, result: data[path] });
  });
  return { api, requests };
}

for (const [path, ci, cd, db, helpers] of [
  ["apps/web/src/main.tsx", ["web"], ["web"]],
  ["apps/api/src/operations.ts", ["api", "bot"], ["api"]],
  ["apps/bot/src/commands.ts", ["api", "bot"], ["bot"]],
  ["packages/contracts/src/visit.ts", workers, workers],
  [
    "packages/db/migrations/0004_misty_red_skull.sql",
    ["api", "bot"],
    ["api"],
    true,
  ],
  ["pnpm-lock.yaml", workers, workers, true, true],
  ["package.json", workers, workers, true, true],
  ["tsconfig.base.json", workers, workers, true, true],
  [".github/workflows/deploy.yml", workers, [], false, true],
  ["scripts/cloudflare-deploy.mjs", workers, [], false, true],
  ["README.md", [], []],
  ["docs/deployment.md", [], []],
])
  test(`impact: ${path}`, () => {
    assert.deepEqual(impact([path]), {
      ci,
      cd,
      db: Boolean(db),
      helpers: Boolean(helpers),
    });
  });

test("multi-commit push and PR merge-base comparisons include all changed paths", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "sales-visit-diff-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  run(["init", "-q"]);
  const commit = (file) => {
    writeFileSync(join(cwd, file), file);
    run(["add", file]);
    run([
      "-c",
      "user.name=Offline test",
      "-c",
      "user.email=offline@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      file,
    ]);
    return run(["rev-parse", "HEAD"]);
  };
  const base = commit("initial");
  commit("web");
  const head = commit("api");
  assert.deepEqual(changedPaths(base, head, false, run).toSorted(), [
    "api",
    "web",
  ]);
  assert.deepEqual(changedPaths(base, head, true, run).toSorted(), [
    "api",
    "web",
  ]);
  assert.deepEqual(changedPaths("0".repeat(40), head, false, run).toSorted(), [
    "api",
    "initial",
    "web",
  ]);
  assert.throws(() => changedPaths(undefined, head), /revision/);
});

test("real reviewed JSONC configs and deployment scripts pass local validation", () => {
  for (const w of workers) validateConfig(w, configs[w], account);
  validateScripts();
});
for (const [label, worker, mutate, expected] of [
  ["unexpected name", "api", (c) => (c.name = "unrelated"), /name/],
  ["environment", "bot", (c) => (c.env = { production: {} }), /override/],
  ["wrong account", "web", (c) => (c.account_id = "d".repeat(32)), /account/],
  ["missing DB", "api", (c) => (c.d1_databases = []), /blocked/],
  ["wrong DB", "api", (c) => (c.d1_databases[0].binding = "OTHER"), /blocked/],
  [
    "wrong service",
    "bot",
    (c) => (c.services[0].service = "other-api"),
    /Service Binding/,
  ],
  [
    "wrong entrypoint",
    "bot",
    (c) => (c.services[0].entrypoint = "Other"),
    /Service Binding/,
  ],
  ["missing service", "bot", (c) => (c.services = []), /Service Binding/],
  ["missing secrets", "bot", (c) => (c.secrets.required = []), /secret/],
  ["wrong assets", "web", (c) => (c.assets.directory = "../dist"), /assets/],
  [
    "unapproved provisioning",
    "web",
    (c) => (c.kv_namespaces = [{}]),
    /Unapproved/,
  ],
])
  test(`config refuses ${label}`, () => {
    const config = structuredClone(configs[worker]);
    mutate(config);
    assert.throws(() => validateConfig(worker, config, account), expected);
  });
test("missing account, unknown targets and name/env CLI overrides fail closed", () => {
  for (const id of [undefined, "", "123", "g".repeat(32)])
    assert.throws(() => validateConfig("web", configs.web, id), /account/);
  assert.throws(() => loadTarget("other"), /Unknown/);
  for (const args of [
    ["--env", "production"],
    ["--name", "other"],
  ])
    assert.throws(
      () => validateConfig("web", configs.web, account, args),
      /override/
    );
});
for (const worker of workers)
  test(`read-only inspection verifies existing ${worker}, account, bindings and migration state`, async () => {
    const { api, requests } = fixture(worker);
    const result = await inspect(worker, { account, api, url: url(worker) });
    assert.equal(result.tag, `immutable-${worker}`);
    assert.equal(result.revision, older);
    for (const { options } of requests) {
      if (options.method === "POST")
        assert.deepEqual(JSON.parse(options.body), {
          sql: "SELECT name FROM d1_migrations ORDER BY id",
        });
      else assert.equal(options.method, "GET");
    }
  });
test("successful deploy subprocess is verified using the active version's documented annotations", async () => {
  const before = fixture();
  const after = fixture(
    "api",
    {},
    {
      versionId: newVersion,
      deploymentId: newDeployment,
      annotations: { "workers/tag": revision },
    }
  );
  let current = before;
  const verify = () =>
    inspect("api", { account, api: current.api, url: url("api") });
  const state = await verify();
  const calls = [];
  await executePlan(["api"], {
    states: { api: state },
    revision,
    check: () => {},
    verify,
    run: (args, env) =>
      command(args, env, (binary, argv) => {
        assert.equal(binary, "pnpm");
        assert.deepEqual(argv, ["deploy:api"]);
        assert.equal(env.RELEASE_REVISION, revision);
        calls.push("deploy");
        current = after;
        return { status: 0 };
      }),
    health: async (target) => {
      assert.equal(target.version, newVersion);
      assert.equal(target.deployment, newDeployment);
      assert.equal(target.revision, revision);
      calls.push("health");
    },
    report: () => {},
    env: {},
  });
  assert.deepEqual(calls, ["deploy", "health"]);
  const paths = after.requests.map((r) => r.path);
  assert.ok(
    paths.includes(`/workers/scripts/${names.api}/versions/${newVersion}`)
  );
  assert.ok(
    paths.includes(`/workers/workers/${names.api}/versions/${newVersion}`)
  );
  assert.ok(
    paths.every(
      (path) => !path.includes("latest") && !path.includes(oldVersion)
    )
  );
});
for (const [label, metadata, expected] of [
  ["missing annotations", { id: newVersion }, /does not match/],
  ["missing tag", { id: newVersion, annotations: {} }, /does not match/],
  [
    "incorrect revision",
    { id: newVersion, annotations: { "workers/tag": older } },
    /does not match/,
  ],
  [
    "malformed revision",
    { id: newVersion, annotations: { "workers/tag": "invalid" } },
    /does not match/,
  ],
  [
    "different version",
    { id: oldVersion, annotations: { "workers/tag": revision } },
    /active version/,
  ],
])
  test(`post-deploy verification fails safely with ${label}`, async () => {
    const before = fixture();
    const after = fixture(
      "api",
      {
        [`/workers/workers/${names.api}/versions/${newVersion}`]: {
          created_on: "2026-11-06T00:00:00Z",
          number: 2,
          urls: [],
          ...metadata,
        },
      },
      { versionId: newVersion, deploymentId: newDeployment }
    );
    let current = before;
    const verify = () =>
      inspect("api", { account, api: current.api, url: url("api") });
    const state = await verify();
    const calls = [];
    await assert.rejects(
      executePlan(["api", "bot"], {
        states: { api: state },
        revision,
        check: () => {},
        verify,
        run: (args) =>
          command(args, {}, () => {
            assert.deepEqual(args, ["deploy:api"]);
            calls.push("deploy:api");
            current = after;
            return { status: 0 };
          }),
        health: () =>
          assert.fail(
            "unverified deployment must not pass health or release Bot"
          ),
        report: () => {},
        env: {},
      }),
      expected
    );
    assert.deepEqual(calls, ["deploy:api"]);
  });
test("script-version identity and bindings remain independently verified", async () => {
  for (const [value, expected] of [
    [
      { id: newVersion, resources: { bindings: bindings("api") } },
      /Wrong deployed version/,
    ],
    [{ id: oldVersion, resources: { bindings: [] } }, /D1 binding/],
  ]) {
    await assert.rejects(
      inspect("api", {
        account,
        url: url("api"),
        api: fixture("api", {
          [`/workers/scripts/${names.api}/versions/${oldVersion}`]: value,
        }).api,
      }),
      expected
    );
  }
});
for (const [label, replace, expected] of [
  [
    "wrong authenticated account",
    { "": { id: "d".repeat(32) } },
    /Wrong Cloudflare account/,
  ],
  ["missing Worker", { "/workers/scripts": [] }, /existing Worker/],
  [
    "unrelated Worker",
    { "/workers/scripts": [{ id: "other", tag: "id" }] },
    /existing Worker/,
  ],
  [
    "unavailable migration verification",
    { [`/d1/database/${configs.api.d1_databases[0].database_id}/query`]: [] },
    /unavailable/,
  ],
  [
    "pending migration",
    {
      [`/d1/database/${configs.api.d1_databases[0].database_id}/query`]: [
        { success: true, results: [] },
      ],
    },
    /Pending/,
  ],
  [
    "wrong database",
    {
      [`/d1/database/${configs.api.d1_databases[0].database_id}`]: {
        uuid: "other",
        name: "sales-visit",
      },
    },
    /Wrong D1/,
  ],
])
  test(`inspection refuses ${label}`, async () => {
    await assert.rejects(
      inspect("api", {
        account,
        api: fixture("api", replace).api,
        url: url("api"),
      }),
      expected
    );
  });
test("API errors, bad JSON and transport failures never expose raw responses", async () => {
  for (const fetcher of [
    async () =>
      Response.json(
        { success: false, errors: [{ message: token }] },
        { status: 403 }
      ),
    async () => new Response(token),
    async () => {
      throw new Error(token);
    },
  ]) {
    await assert.rejects(
      cloudflare(account, token, fetcher)(""),
      (error) =>
        /Cloudflare inspection/.test(error.message) &&
        !error.message.includes(token)
    );
  }
});
test("deployed binding mismatches, secret absence, split versions and URLs fail closed", async () => {
  for (const worker of ["api", "bot"]) {
    assert.throws(
      () => validateBindings(worker, configs[worker], []),
      /binding/i
    );
    const wrong = bindings(worker);
    if (worker === "api") wrong[0].id = "other";
    else wrong[0].entrypoint = "Other";
    assert.throws(
      () => validateBindings(worker, configs[worker], wrong),
      /binding/i
    );
  }
  assert.throws(
    () => validateBindings("bot", configs.bot, bindings("bot").slice(0, 1)),
    /secret/
  );
  for (const bad of [
    undefined,
    "https://other.example",
    `${url("api")}/`,
    `http://${names.api}.verified-subdomain.workers.dev`,
  ])
    await assert.rejects(
      inspect("api", { account, api: fixture().api, url: bad }),
      /URL/
    );
  await assert.rejects(
    inspect("api", {
      account,
      api: fixture("api", {
        "/workers/scripts/sales-visit-api/deployments": {
          deployments: [
            { id: "split", versions: [{ percentage: 50 }, { percentage: 50 }] },
          ],
        },
      }).api,
      url: url("api"),
    }),
    /split/
  );
});
test("migration history rejects duplicates, failed queries, extras and 0004 pending", () => {
  validateMigrations(history());
  for (const value of [
    undefined,
    [],
    [{ success: false, results: [] }],
    [{ success: true }],
  ])
    assert.throws(() => validateMigrations(value), /unavailable/);
  const pending = history();
  pending[0].results.pop();
  assert.throws(() => validateMigrations(pending), /Pending/);
  const duplicate = history();
  duplicate[0].results.push(duplicate[0].results[0]);
  assert.throws(() => validateMigrations(duplicate), /Pending/);
  const extra = history();
  extra[0].results.push({ name: "unknown.sql" });
  assert.throws(() => validateMigrations(extra), /unexpected/);
});
test("automatic CD is OFF unless exactly true; disabled release performs no I/O", async () => {
  for (const enabled of [undefined, "", "false", "TRUE", "1"]) {
    assert.equal(policy("push", enabled).allowed, false);
    await release({
      env: { GITHUB_EVENT_NAME: "push", ENABLE_AUTO_DEPLOY: enabled },
      verify: () => assert.fail("network"),
      run: () => assert.fail("subprocess"),
      check: () => assert.fail("git"),
      report: () => {},
    });
  }
  assert.equal(policy("push", "true").allowed, true);
  assert.deepEqual(
    policy("workflow_dispatch", "false", "all", "true").targets,
    workers
  );
  for (const target of [undefined, "other", ""])
    assert.throws(
      () => policy("workflow_dispatch", "true", target, "false"),
      /Unknown/
    );
});
test("automatic planning uses each deployed revision, recovering missed queued pushes", () => {
  const states = Object.fromEntries(
    workers.map((w) => [w, { revision: older }])
  );
  const calls = [];
  const deps = {
    ancestor: () => {},
    diff: (base, head) => {
      calls.push([base, head]);
      return ["apps/web/src/main.tsx", "apps/api/src/worker.ts"];
    },
  };
  assert.deepEqual(selectAutomatic(states, revision, deps), ["web", "api"]);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(([base, head]) => base === older && head === revision));
  assert.deepEqual(
    selectAutomatic(states, revision, {
      ...deps,
      diff: () => ["docs/deployment.md", ".github/workflows/deploy.yml"],
    }),
    []
  );
  assert.throws(
    () => selectAutomatic({ ...states, web: {} }, revision, deps),
    /baseline/
  );
  assert.throws(
    () =>
      selectAutomatic(states, revision, {
        ...deps,
        ancestor: () => {
          throw new Error("diverged");
        },
      }),
    /ancestor/
  );
});
const states = () =>
  Object.fromEntries(
    workers.map((w) => [
      w,
      {
        worker: w,
        tag: `immutable-${w}`,
        version: "old",
        deployment: "old",
        revision: older,
        url: url(w),
      },
    ])
  );
function execution({ failApi = false, dryRun = false } = {}) {
  const before = states();
  const calls = [];
  const deployed = new Set();
  const deps = {
    dryRun,
    states: before,
    revision,
    env: {},
    check: () => {},
    report: () => {},
    verify: async (w) =>
      deployed.has(w)
        ? { ...before[w], version: "new", deployment: "new", revision }
        : before[w],
    run: ([cmd]) => {
      calls.push(cmd);
      if (cmd === "deploy:api" && failApi) throw new Error("API failed");
      deployed.add(cmd.split(":")[1]);
    },
    health: async (target) => calls.push(`health:${target.worker}`),
  };
  return { calls, deps };
}
test("API deploy and verified health precede Bot; unchanged Workers are never deployed", async () => {
  const { calls, deps } = execution();
  await executePlan(["api", "bot"], deps);
  assert.deepEqual(calls, [
    "deploy:api",
    "health:api",
    "deploy:bot",
    "health:bot",
  ]);
  const bot = execution();
  await executePlan(["bot"], bot.deps);
  assert.deepEqual(bot.calls, ["deploy:bot", "health:bot"]);
});
test("API deployment or health failure blocks dependent Bot", async () => {
  const failed = execution({ failApi: true });
  await assert.rejects(executePlan(["api", "bot"], failed.deps), /API failed/);
  assert.deepEqual(failed.calls, ["deploy:api"]);
  const unhealthy = execution();
  unhealthy.deps.health = async () => {
    throw new Error("health failed");
  };
  await assert.rejects(
    executePlan(["api", "bot"], unhealthy.deps),
    /health failed/
  );
  assert.deepEqual(unhealthy.calls, ["deploy:api"]);
});
test("dry-run never invokes deploy; target/version/revision changes fail closed", async () => {
  const dry = execution({ dryRun: true });
  await executePlan(workers, dry.deps);
  assert.deepEqual(dry.calls, []);
  const changed = execution();
  changed.deps.verify = async () => ({
    ...changed.deps.states.api,
    tag: "replacement",
  });
  await assert.rejects(
    executePlan(["api", "bot"], changed.deps),
    /changed since preflight/
  );
  assert.deepEqual(changed.calls, []);
  const notUpdated = execution();
  notUpdated.deps.verify = async () => notUpdated.deps.states.api;
  await assert.rejects(
    executePlan(["api", "bot"], notUpdated.deps),
    /does not match/
  );
  assert.deepEqual(notUpdated.calls, ["deploy:api"]);
});
test("stale main revision rejects before mutation, including before Bot", async () => {
  assertCurrentRevision(revision, ([cmd]) =>
    cmd === "ls-remote" ? `${revision}\trefs/heads/main` : revision
  );
  assert.throws(
    () =>
      assertCurrentRevision(revision, ([cmd]) =>
        cmd === "ls-remote" ? `${older}\trefs/heads/main` : revision
      ),
    /Stale/
  );
  const stale = execution();
  let count = 0;
  stale.deps.check = () => {
    if (++count > 1) throw new Error("Stale");
  };
  await assert.rejects(executePlan(["api", "bot"], stale.deps), /Stale/);
  assert.deepEqual(stale.calls, ["deploy:api", "health:api"]);
});
test("guarded Wrangler subprocess pins cwd/config/account/immutable target; suppresses output", async () => {
  const calls = [];
  await deploy("api", {
    env: {
      PATH: "/synthetic",
      HOME: "/synthetic-home",
      CLOUDFLARE_ACCOUNT_ID: account,
      CLOUDFLARE_API_TOKEN: token,
      RELEASE_REVISION: revision,
      API_URL: url("api"),
      UNTRUSTED: "unused",
    },
    checkRevision: () => {},
    verify: async () => ({ tag: "immutable-api" }),
    spawn: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  });
  const [binary, args, opts] = calls[0];
  assert.equal(binary, "pnpm");
  assert.deepEqual(args, wranglerArgs("api", revision));
  assert.ok(opts.cwd.endsWith("/apps/api/"));
  assert.equal(opts.env.CLOUDFLARE_ACCOUNT_ID, account);
  assert.equal(opts.env.WRANGLER_CI_MATCH_TAG, "immutable-api");
  assert.equal(opts.env.UNTRUSTED, undefined);
  assert.equal(opts.stdio, "ignore");
  assert.equal(args.includes("--env"), false);
  assert.equal(args.includes("--name"), false);
});
test("subprocess failures and additional CLI arguments fail closed", async () => {
  assert.throws(
    () => command(["deploy:api"], {}, () => ({ status: 1 })),
    /failed/
  );
  for (const [file, args] of [
    ["scripts/cloudflare-deploy.mjs", ["bot", "--env", "other"]],
    ["scripts/cloudflare-remote.mjs", ["deploy-api", "--name", "other"]],
  ]) {
    const result = spawnSync(process.execPath, [file, ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /overrides are not allowed/);
    assert.equal(result.stdout, "");
  }
  await assert.rejects(
    deploy("bot", {
      env: { WRANGLER_ENV: "other" },
      spawn: () => assert.fail("spawn"),
    }),
    /override/
  );
});
test("HTTP smoke tests retry safely, require correct identity and never follow redirects", async () => {
  await smoke({ worker: "api", url: url("api") }, async (_, opts) => {
    assert.equal(opts.redirect, "error");
    return Response.json({ status: "ok" });
  });
  await smoke({ worker: "bot", url: url("bot") }, async () =>
    Response.json({ status: "ok", service: names.bot })
  );
  await smoke(
    { worker: "web", url: url("web") },
    async () =>
      new Response('<div id="root"></div>', {
        headers: { "content-type": "text/html" },
      })
  );
  let attempts = 0;
  await assert.rejects(
    smoke(
      { worker: "bot", url: url("bot") },
      async () => {
        attempts++;
        return Response.json({ status: "ok", service: "wrong" });
      },
      async () => {}
    ),
    /Health verification failed/
  );
  assert.equal(attempts, 6);
});

const manualEnv = (target = "all", dry = "false") => ({
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: revision,
  DEPLOY_TARGET: target,
  DRY_RUN: dry,
  CLOUDFLARE_ACCOUNT_ID: account,
  CLOUDFLARE_API_TOKEN: token,
});
test("full release preflights every selected Worker before any deployment", async () => {
  const before = states();
  const events = [];
  const updated = new Set();
  await release({
    env: manualEnv(),
    check: () => {},
    report: () => {},
    verify: async (w) => {
      events.push(`verify:${w}`);
      return updated.has(w)
        ? { ...before[w], version: "new", deployment: "new", revision }
        : before[w];
    },
    run: (args, env) => {
      if (args[0].startsWith("deploy:")) {
        events.push(args[0]);
        updated.add(args[0].split(":")[1]);
        assert.equal(env.RELEASE_REVISION, revision);
      } else {
        assert.equal(env.CLOUDFLARE_API_TOKEN, undefined);
        assert.equal(env.CLOUDFLARE_ACCOUNT_ID, undefined);
      }
    },
    health: async (target) => events.push(`health:${target.worker}`),
  });
  assert.deepEqual(events.slice(0, 3), [
    "verify:web",
    "verify:api",
    "verify:bot",
  ]);
  assert.ok(events.indexOf("health:api") < events.indexOf("deploy:bot"));
});
test("failure of any preflight blocks all writes, including independent Web", async () => {
  await assert.rejects(
    release({
      env: manualEnv(),
      check: () => {},
      report: () => {},
      verify: async (w) => {
        if (w === "bot") throw new Error("Missing Bot");
        return states()[w];
      },
      run: () => assert.fail("no commands before all guards pass"),
    }),
    /Missing Bot/
  );
});
test("full manual dry-run validates and builds Web without any deploy subprocess", async () => {
  const commands = [];
  await release({
    env: manualEnv("web", "true"),
    check: () => {},
    report: () => {},
    verify: async (w) => states()[w],
    run: (args, env) => {
      commands.push(args[0]);
      assert.equal(env.CLOUDFLARE_API_TOKEN, undefined);
    },
    health: () => assert.fail("dry-run has no post-deploy smoke"),
  });
  assert.ok(commands.includes("build:web"));
  assert.ok(commands.every((c) => !c.startsWith("deploy:")));
});
test("Bot-only release verifies and health-checks API without redeploying it", async () => {
  const events = [];
  let updated = false;
  await release({
    env: manualEnv("bot"),
    check: () => {},
    report: () => {},
    verify: async (w) => {
      events.push(`verify:${w}`);
      const state = states()[w];
      return w === "bot" && updated
        ? { ...state, version: "new", deployment: "new", revision }
        : state;
    },
    run: ([cmd]) => {
      events.push(cmd);
      if (cmd === "deploy:bot") updated = true;
    },
    health: async (target) => events.push(`health:${target.worker}`),
  });
  assert.ok(events.includes("verify:api"));
  assert.ok(events.indexOf("health:api") < events.indexOf("deploy:bot"));
  assert.ok(!events.includes("deploy:api"));
});
