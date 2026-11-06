import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const actor = (id) => ({ telegramUserId: String(id) });
async function setup(t) {
  const bundle = await build({
    entryPoints: [new URL("../src/worker.ts", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["cloudflare:workers"],
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "probe",
          modules: true,
          compatibilityDate: "2026-11-02",
          script: `export default { async fetch(req, env) { const { method, args } = await req.json(); return Response.json(await env.API[method](...args)); } }`,
          serviceBindings: { API: { name: "api", entrypoint: "BotIdentity" } },
        },
        {
          name: "api",
          modules: true,
          compatibilityDate: "2026-11-02",
          script: bundle.outputFiles[0].text,
          d1Databases: { DB: "planning-test" },
        },
      ],
    })
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB", "api");
  const dir = new URL("../../../packages/db/migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .toSorted()) {
    const sql = readFileSync(new URL(file, dir), "utf8").replace(
      /^\s*--.*$/gm,
      ""
    );
    await db.batch(
      sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s))
    );
  }
  await db
    .prepare(
      "INSERT INTO sales_force (id, name) VALUES ('sf-a', 'Synthetic A'), ('sf-b', 'Synthetic B')"
    )
    .run();
  for (const [id, status, role, sf] of [
    [1, "active", "admin", null],
    [2, "active", "supervisor", null],
    [3, "active", "sales_force", "sf-a"],
    [4, "active", "sales_force", "sf-b"],
    [5, "pending", null, null],
    [6, "rejected", null, null],
    [7, "disabled", "admin", null],
    [8, "active", "sales_force", null],
    [9, "disabled", "sales_force", "sf-a"],
  ]) {
    await db.batch([
      db
        .prepare(
          "INSERT INTO users (id, status, role, sales_force_id) VALUES (?, ?, ?, ?)"
        )
        .bind(`u-${id}`, status, role, sf),
      db
        .prepare(
          "INSERT INTO telegram_identities (user_id, telegram_user_id) VALUES (?, ?)"
        )
        .bind(`u-${id}`, String(id)),
    ]);
  }
  const probe = await mf.getWorker("probe");
  const rpc = async (method, by, input) => {
    const response = await probe.fetch("https://test/", {
      method: "POST",
      body: JSON.stringify({
        method,
        args: [typeof by === "object" ? by : actor(by), input],
      }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  return { db, rpc, api: await mf.getWorker("api") };
}

test("authorized Outlet CRUD over named RPC with migrated local D1", async (t) => {
  const { db, rpc, api } = await setup(t);
  const create = await rpc("createOutlet", 1, { name: "  Toko sintetis  " });
  assert.equal(create.ok, true);
  const id = create.data.id;
  assert.equal(create.data.name, "Toko sintetis");
  assert.equal(typeof create.data.updatedAt, "number");
  assert.notEqual(id, "1");
  assert.equal(
    (await rpc("createOutlet", 1, { name: "Toko sintetis" })).ok,
    true
  ); // names are labels, not unique keys
  for (const by of [3, 4, 5, 6, 7, 8, 9, 999]) {
    assert.equal((await rpc("listOutlets", by, {})).code, "forbidden");
    assert.equal((await rpc("getOutlet", by, { id })).code, "forbidden");
  }
  const before = await db.prepare("SELECT * FROM outlets ORDER BY id").all();
  for (const by of [2, 3, 4, 5, 6, 7, 8, 9, 999]) {
    for (const [method, input] of [
      ["createOutlet", { name: "Denied" }],
      ["updateOutlet", { id, name: "Denied" }],
      ["deleteOutlet", { id }],
    ])
      assert.equal((await rpc(method, by, input)).code, "forbidden");
  }
  assert.deepEqual(
    (await db.prepare("SELECT * FROM outlets ORDER BY id").all()).results,
    before.results
  );
  assert.equal((await rpc("getOutlet", 2, { id })).data.id, id);
  assert.equal(
    (await rpc("getOutlet", 2, { id: "missing" })).code,
    "not_found"
  );
  assert.equal(
    (await rpc("getOutlet", 3, { id: "missing" })).code,
    "forbidden"
  );
  assert.equal(
    (await rpc("updateOutlet", 1, { id, name: "Renamed" })).data.name,
    "Renamed"
  );
  for (const [method, input] of [
    ["createOutlet", { name: " " }],
    ["createOutlet", { name: "Valid", role: "admin" }],
    ["updateOutlet", { id }],
    ["deleteOutlet", { id: "" }],
    ["listOutlets", { after: "" }],
    ["getOutlet", null],
  ])
    assert.equal((await rpc(method, 1, input)).code, "invalid");
  assert.equal(
    (
      await rpc(
        "createOutlet",
        { telegramUserId: "1", role: "admin" },
        { name: "Spoof" }
      )
    ).code,
    "invalid"
  );
  for (const method of ["updateOutlet", "deleteOutlet"])
    assert.equal(
      (
        await rpc(method, 1, {
          id: "missing",
          ...(method === "updateOutlet" ? { name: "Name" } : {}),
        })
      ).code,
      "not_found"
    );
  await db
    .prepare(
      "INSERT INTO visits (id, outlet_id, sales_force_id, visited_at, submission_channel) VALUES ('v', ?, 'sf-a', 1, 'web')"
    )
    .bind(id)
    .run();
  assert.equal((await rpc("deleteOutlet", 1, { id })).code, "referenced");
  const standalone = (
    await rpc("createOutlet", 1, { name: "Standalone report" })
  ).data.id;
  await db
    .prepare(
      "INSERT INTO stock_reports (id, outlet_id, reporter_sales_force_id, reported_at, submission_channel) VALUES ('r', ?, 'sf-a', 1, 'web')"
    )
    .bind(standalone)
    .run();
  assert.equal(
    (await rpc("deleteOutlet", 1, { id: standalone })).code,
    "referenced"
  );
  const free = (await rpc("createOutlet", 1, { name: "Free" })).data.id;
  assert.equal((await rpc("deleteOutlet", 1, { id: free })).data.id, free);
  assert.equal((await rpc("getOutlet", 1, { id: free })).code, "not_found");

  await db.batch(
    Array.from({ length: 108 }, (_, i) =>
      db
        .prepare("INSERT INTO outlets (id, name) VALUES (?, 'Page fixture')")
        .bind(`page-${String(i).padStart(3, "0")}`)
    )
  );
  const ids = [];
  let after;
  do {
    const page = (await rpc("listOutlets", 2, after ? { after } : {})).data;
    assert.ok(page.items.length <= 50);
    ids.push(...page.items.map((o) => o.id));
    after = page.next;
  } while (after);
  assert.equal(
    ids.length,
    (await db.prepare("SELECT count(*) AS n FROM outlets").first()).n
  );
  assert.deepEqual(ids, [...new Set(ids)].toSorted());

  // SQL errors must be sanitized and rolled back at the new RPC boundary.
  await db
    .prepare(
      "CREATE TRIGGER fail_outlet BEFORE INSERT ON outlets BEGIN SELECT RAISE(ABORT, 'sensitive synthetic SQL detail'); END"
    )
    .run();
  assert.deepEqual(await rpc("createOutlet", 1, { name: "Failure" }), {
    ok: false,
    code: "unavailable",
  });
  await db.prepare("DROP TRIGGER fail_outlet").run();
  await db
    .prepare("UPDATE users SET status = 'disabled' WHERE id = 'u-1'")
    .run();
  assert.equal(
    (await rpc("createOutlet", 1, { name: "Revoked" })).code,
    "forbidden"
  );
  assert.equal((await rpc("getOutlet", 1, { id })).code, "forbidden");

  for (const path of [
    "/createOutlet",
    "/updateOutlet",
    "/deleteOutlet",
    "/listOutlets",
    "/getOutlet",
    "/schedules",
    "/ownSchedule",
    "/listSchedules",
    "/createSchedule",
    "/internal/outlets",
  ]) {
    for (const method of ["GET", "POST"])
      assert.equal(
        (
          await api.fetch(`https://api${path}`, {
            method,
            headers: { "X-Telegram-User-ID": "1", "X-Role": "admin" },
          })
        ).status,
        404
      );
  }
  const publicOutlets = await (await api.fetch("https://api/outlets")).json();
  assert.ok(
    publicOutlets.every((o) => Object.keys(o).toSorted().join() === "id,name")
  );
  for (const path of ["/visits", "/stock-reports"])
    assert.equal(
      (
        await api.fetch(`https://api${path}`, {
          method: "POST",
          headers: { "X-Telegram-User-ID": "1" },
          body: "{}",
        })
      ).status,
      401
    );
  assert.deepEqual(
    (await db.prepare("PRAGMA foreign_key_check").all()).results,
    []
  );
});
