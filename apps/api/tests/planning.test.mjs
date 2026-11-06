import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const actor = (id) => ({ telegramUserId: String(id) });
async function setup(t, legacy = false) {
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
    if (legacy && file.startsWith("0003_")) {
      await db.batch([
        db.prepare(
          "INSERT INTO outlets (id, name) VALUES ('legacy-o', 'Legacy synthetic')"
        ),
        db.prepare(
          "INSERT INTO sales_force (id, name) VALUES ('legacy-s', 'Legacy SF')"
        ),
        db.prepare(
          "INSERT INTO products (id, name) VALUES ('legacy-p', 'Legacy product')"
        ),
        db.prepare(
          "INSERT INTO visits (id, outlet_id, sales_force_id, visited_at, submission_channel) VALUES ('legacy-v', 'legacy-o', 'legacy-s', 1, 'web')"
        ),
        db.prepare(
          "INSERT INTO stock_reports (id, outlet_id, reporter_sales_force_id, visit_id, reported_at, submission_channel) VALUES ('legacy-r', 'legacy-o', 'legacy-s', 'legacy-v', 2, 'telegram')"
        ),
        db.prepare(
          "INSERT INTO stock_report_items VALUES ('legacy-r', 'legacy-p', 7)"
        ),
      ]);
    }
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
  const rpc = async (method, by, ...inputs) => {
    const response = await probe.fetch("https://test/", {
      method: "POST",
      body: JSON.stringify({
        method,
        args: [typeof by === "object" ? by : actor(by), ...inputs],
      }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  return { db, rpc, api: await mf.getWorker("api") };
}

test("Outlet mutations reject unreportable 64-bit timestamps atomically", async (t) => {
  const { db, rpc } = await setup(t);
  // Bind decimal text and cast inside SQLite: JS numbers would lose precision.
  const unsafe = [
    "9007199254740992",
    "9007199254740993",
    "9223372036854775807",
    "-9007199254740992",
    "-9007199254740993",
    "-9223372036854775808",
  ];
  const snapshot = (id) =>
    db
      .prepare(
        "SELECT id, name, CAST(created_at AS TEXT) AS createdAt, CAST(updated_at AS TEXT) AS updatedAt FROM outlets WHERE id = ?"
      )
      .bind(id)
      .first();
  for (const field of ["created_at", "updated_at"]) {
    for (const value of unsafe) {
      for (const method of ["updateOutlet", "deleteOutlet"]) {
        await t.test(`${method}: ${field}=${value}`, async () => {
          const id = `${method}-${field}-${value}`;
          await db
            .prepare(
              "INSERT INTO outlets (id, name, created_at, updated_at) VALUES (?, 'Unchanged', CAST(? AS INTEGER), CAST(? AS INTEGER))"
            )
            .bind(
              id,
              field === "created_at" ? value : "-1",
              field === "updated_at" ? value : "0"
            )
            .run();
          const before = await snapshot(id);
          assert.equal(
            before[field === "created_at" ? "createdAt" : "updatedAt"],
            value
          );
          const input =
            method === "updateOutlet"
              ? { id, name: "Must not commit" }
              : { id };
          for (const by of [2, 3, 5, 7, 999])
            assert.deepEqual(await rpc(method, by, input), {
              ok: false,
              code: "forbidden",
            });
          assert.deepEqual(await rpc(method, 1, input), {
            ok: false,
            code: "unavailable",
          });
          // Compare exact SQL text, not rounded D1/JS numeric conversions.
          assert.deepEqual(await snapshot(id), before);
        });
      }
    }
  }
  // The guard must not exclude either safe boundary or nullable updated_at.
  for (const value of ["-9007199254740991", "9007199254740991"]) {
    const id = `safe-${value}`;
    await db
      .prepare(
        "INSERT INTO outlets (id, name, created_at) VALUES (?, 'Safe boundary', CAST(? AS INTEGER))"
      )
      .bind(id, value)
      .run();
    const updated = await rpc("updateOutlet", 1, { id, name: "Allowed" });
    assert.equal(updated.ok, true);
    assert.equal(updated.data.createdAt, Number(value));
    const deleted = await rpc("deleteOutlet", 1, { id });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.data.createdAt, Number(value));
    assert.equal(await snapshot(id), null);
  }
});

test("optional planning filters default through one-argument Worker RPC calls", async (t) => {
  const { rpc } = await setup(t);
  const calls = [
    ["listOutlets", 1],
    ["listSchedules", 2],
    ["ownSchedule", 3],
  ];
  for (const [method, by] of calls) {
    assert.deepEqual(await rpc(method, by), {
      ok: true,
      data: { items: [], next: null },
    });
    assert.deepEqual(await rpc(method, by, null), {
      ok: false,
      code: "invalid",
    });
  }
  const id = (await rpc("createOutlet", 1, { name: "Default filters" })).data
    .id;
  for (const [salesForceId, weekday] of [
    ["sf-a", 1],
    ["sf-a", 7],
    ["sf-b", 2],
  ]) {
    assert.equal(
      (await rpc("createSchedule", 1, { salesForceId, outletId: id, weekday }))
        .ok,
      true
    );
  }
  for (const [i, [method, by]] of calls.entries()) {
    // No second array element is serialized: only actor reaches Worker RPC.
    const result = await rpc(method, by);
    assert.equal(result.ok, true);
    assert.equal(result.data.items.length, [1, 3, 2][i]);
    assert.equal(result.data.next, null);
    assert.deepEqual(result, await rpc(method, by, {}));
  }
  assert.deepEqual(
    (await rpc("ownSchedule", 3)).data.items
      .map((s) => s.weekday)
      .toSorted((a, b) => a - b),
    [1, 7]
  );
  assert.equal((await rpc("listSchedules", 3)).code, "forbidden");
  assert.equal((await rpc("listOutlets", 3)).code, "forbidden");
  assert.equal((await rpc("ownSchedule", 5)).code, "forbidden");
});

test("planning RPC rejects C1 inputs without mutations and retains Unicode names", async (t) => {
  const { db, rpc } = await setup(t);
  const name = "Toko Café 日本 🏪";
  const created = await rpc("createOutlet", 1, { name });
  assert.equal(created.ok, true);
  assert.equal(created.data.name, name);
  const id = created.data.id;
  const before = (await db.prepare("SELECT * FROM outlets").all()).results;
  for (const code of [0x80, 0x85, 0x9f]) {
    const invalid = `a${String.fromCharCode(code)}b`;
    for (const [method, by, input] of [
      ["createOutlet", 1, { name: invalid }],
      ["updateOutlet", 1, { id, name: invalid }],
      ["getOutlet", 1, { id: invalid }],
      ["deleteOutlet", 1, { id: invalid }],
      ["listOutlets", 1, { after: invalid }],
      ["listSchedules", 1, { salesForceId: invalid }],
      ["ownSchedule", 3, { after: invalid }],
      [
        "createSchedule",
        1,
        { salesForceId: invalid, outletId: id, weekday: 1 },
      ],
      [
        "createSchedule",
        1,
        { salesForceId: "sf-a", outletId: invalid, weekday: 1 },
      ],
    ])
      assert.deepEqual(await rpc(method, by, input), {
        ok: false,
        code: "invalid",
      });
  }
  assert.deepEqual(
    (await db.prepare("SELECT * FROM outlets").all()).results,
    before
  );
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM visit_schedules").first()).n,
    0
  );
  assert.equal((await rpc("getOutlet", 1, { id })).data.name, name);
});

test("planning RPC uses exact legacy IDs for Outlet mutations and Schedule references", async (t) => {
  const { db, rpc } = await setup(t);
  const id = " outlet-exact ";
  const sf = " sf-exact ";
  await db.batch([
    db
      .prepare(
        "INSERT INTO outlets (id, name) VALUES (?, 'Spaced'), ('outlet-exact', 'Unspaced')"
      )
      .bind(id),
    db
      .prepare(
        "INSERT INTO sales_force (id, name) VALUES (?, 'Spaced SF'), ('sf-exact', 'Unspaced SF')"
      )
      .bind(sf),
  ]);
  assert.equal((await rpc("getOutlet", 1, { id })).data.id, id);
  assert.equal((await rpc("getOutlet", 1, { id })).data.name, "Spaced");
  assert.equal(
    (await rpc("updateOutlet", 1, { id, name: "Changed" })).data.id,
    id
  );
  assert.equal(
    (await db.prepare("SELECT name FROM outlets WHERE id = ?").bind(id).first())
      .name,
    "Changed"
  );
  assert.equal(
    (await rpc("getOutlet", 1, { id: id.trim() })).data.name,
    "Unspaced"
  );
  assert.equal((await rpc("deleteOutlet", 1, { id })).data.id, id);
  assert.equal(
    await db.prepare("SELECT id FROM outlets WHERE id = ?").bind(id).first(),
    null
  );
  assert.equal(
    (await rpc("getOutlet", 1, { id: id.trim() })).data.name,
    "Unspaced"
  );
  await db
    .prepare("INSERT INTO outlets (id, name) VALUES (?, 'Spaced again')")
    .bind(id)
    .run();
  const created = await rpc("createSchedule", 1, {
    salesForceId: sf,
    outletId: id,
    weekday: 1,
  });
  assert.equal(created.ok, true);
  assert.equal(created.data.salesForceId, sf);
  assert.equal(created.data.outletId, id);
  assert.deepEqual(
    await db
      .prepare(
        "SELECT sales_force_id AS salesForceId, outlet_id AS outletId FROM visit_schedules WHERE id = ?"
      )
      .bind(created.data.id)
      .first(),
    { salesForceId: sf, outletId: id }
  );
  assert.equal(
    (await rpc("listSchedules", 1, { salesForceId: sf })).data.items[0]
      .outletId,
    id
  );
  assert.deepEqual(
    (await rpc("listSchedules", 1, { salesForceId: sf.trim() })).data.items,
    []
  );
  await db
    .prepare("UPDATE users SET sales_force_id = ? WHERE id = 'u-3'")
    .bind(sf)
    .run();
  assert.equal(
    (await rpc("ownSchedule", 3, {})).data.items[0].salesForceId,
    sf
  );
  assert.equal((await rpc("deleteOutlet", 1, { id })).code, "referenced");
  assert.deepEqual(
    (await db.prepare("PRAGMA foreign_key_check").all()).results,
    []
  );
});

test("planning pages return and consume exact whitespace-bearing IDs and cursors", async (t) => {
  const { db, rpc } = await setup(t);
  const outletIds = Array.from(
    { length: 52 },
    (_, i) => ` outlet-${String(i).padStart(3, "0")} `
  );
  const scheduleIds = Array.from(
    { length: 52 },
    (_, i) => ` schedule-${String(i).padStart(3, "0")} `
  );
  await db.batch(
    outletIds.map((id) =>
      db.prepare("INSERT INTO outlets (id, name) VALUES (?, 'Page')").bind(id)
    )
  );
  await db.batch(
    scheduleIds.map((id, i) =>
      db
        .prepare(
          "INSERT INTO visit_schedules (id, sales_force_id, outlet_id, weekday) VALUES (?, 'sf-a', ?, 1)"
        )
        .bind(id, outletIds[i])
    )
  );
  for (const [method, by, expectedIds] of [
    ["listOutlets", 1, outletIds],
    ["listSchedules", 2, scheduleIds],
    ["ownSchedule", 3, scheduleIds],
  ]) {
    const first = await rpc(method, by, {});
    assert.equal(first.ok, true);
    assert.deepEqual(
      first.data.items.map((row) => row.id),
      expectedIds.slice(0, 50)
    );
    assert.equal(first.data.next, expectedIds[49]);
    const second = await rpc(method, by, { after: first.data.next });
    assert.deepEqual(
      second.data.items.map((row) => row.id),
      expectedIds.slice(50)
    );
    assert.equal(second.data.next, null);
    if (method !== "listOutlets")
      assert.deepEqual(
        [...first.data.items, ...second.data.items].map((row) => row.outletId),
        outletIds
      );
  }
});

test("Outlet RPC preserves signed legacy timestamps across reads and mutations", async (t) => {
  const { db, rpc } = await setup(t);
  const createdAt = -86400000;
  const updatedAt = -1;
  await db
    .prepare(
      "INSERT INTO outlets (id, name, created_at, updated_at) VALUES ('negative-time', 'Legacy', ?, ?)"
    )
    .bind(createdAt, updatedAt)
    .run();
  const expected = {
    id: "negative-time",
    name: "Legacy",
    createdAt,
    updatedAt,
  };
  await t.test("list", async () => {
    assert.deepEqual(await rpc("listOutlets", 1, {}), {
      ok: true,
      data: { items: [expected], next: null },
    });
  });
  await t.test("retrieve", async () => {
    assert.deepEqual(await rpc("getOutlet", 1, { id: expected.id }), {
      ok: true,
      data: expected,
    });
  });
  await t.test(
    "update returns committed row without changing creation time",
    async () => {
      const result = await rpc("updateOutlet", 1, {
        id: expected.id,
        name: "Renamed",
      });
      assert.equal(result.ok, true);
      assert.equal(result.data.createdAt, createdAt);
      assert.equal(result.data.name, "Renamed");
      assert.ok(Number.isSafeInteger(result.data.updatedAt));
      assert.deepEqual(
        await db
          .prepare(
            "SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM outlets WHERE id = ?"
          )
          .bind(expected.id)
          .first(),
        result.data
      );
    }
  );
  await t.test(
    "delete returns original signed timestamps and removes only the row",
    async () => {
      await db
        .prepare(
          "INSERT INTO outlets (id, name, created_at, updated_at) VALUES ('negative-delete', 'Legacy', ?, ?)"
        )
        .bind(createdAt, updatedAt)
        .run();
      assert.deepEqual(
        await rpc("deleteOutlet", 1, { id: "negative-delete" }),
        { ok: true, data: { ...expected, id: "negative-delete" } }
      );
      assert.equal(
        await db
          .prepare("SELECT id FROM outlets WHERE id = 'negative-delete'")
          .first(),
        null
      );
      assert.equal(
        (
          await db
            .prepare("SELECT created_at FROM outlets WHERE id = ?")
            .bind(expected.id)
            .first()
        ).created_at,
        createdAt
      );
    }
  );
});

test("documented optional synthetic schedule seed is repeatable without report writes", async (t) => {
  const { db, rpc } = await setup(t);
  const apply = async (file) => {
    const sql = readFileSync(new URL(file, import.meta.url), "utf8").replace(
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
  };
  await apply("../seeds/local.sql");
  const before = await db
    .prepare(
      "SELECT (SELECT count(*) FROM visits) AS visits, (SELECT count(*) FROM stock_reports) AS reports, (SELECT count(*) FROM users) AS users"
    )
    .first();
  await apply("../seeds/schedules-local.sql");
  await apply("../seeds/schedules-local.sql");
  assert.equal((await rpc("listSchedules", 1, {})).data.items.length, 4);
  assert.deepEqual(
    await db
      .prepare(
        "SELECT (SELECT count(*) FROM visits) AS visits, (SELECT count(*) FROM stock_reports) AS reports, (SELECT count(*) FROM users) AS users"
      )
      .first(),
    before
  );
  assert.deepEqual(
    (await db.prepare("PRAGMA foreign_key_check").all()).results,
    []
  );
});

test("schedule migration upgrades populated D1 without resetting reporting history", async (t) => {
  const { db, rpc } = await setup(t, true);
  const outlet = await rpc("getOutlet", 1, { id: "legacy-o" });
  assert.equal(outlet.data.name, "Legacy synthetic");
  assert.equal(outlet.data.updatedAt, null);
  assert.equal(
    (
      await db
        .prepare("SELECT visited_at FROM visits WHERE id = 'legacy-v'")
        .first()
    ).visited_at,
    1
  );
  assert.equal(
    (
      await db
        .prepare("SELECT visit_id FROM stock_reports WHERE id = 'legacy-r'")
        .first()
    ).visit_id,
    "legacy-v"
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT quantity FROM stock_report_items WHERE stock_report_id = 'legacy-r'"
        )
        .first()
    ).quantity,
    7
  );
  assert.equal(
    (
      await rpc("createSchedule", 1, {
        salesForceId: "legacy-s",
        outletId: "legacy-o",
        weekday: 7,
      })
    ).ok,
    true
  );
  assert.equal(
    (await rpc("deleteOutlet", 1, { id: "legacy-o" })).code,
    "referenced"
  );
  assert.deepEqual(
    (await db.prepare("PRAGMA foreign_key_check").all()).results,
    []
  );
});

test("role-aware recurring schedule provisioning and queries over Worker RPC", async (t) => {
  const { db, rpc, api } = await setup(t);
  const o1 = (await rpc("createOutlet", 1, { name: "Outlet A" })).data.id;
  const o2 = (await rpc("createOutlet", 1, { name: "Outlet B" })).data.id;
  const assignment = { salesForceId: "sf-a", outletId: o1, weekday: 1 };
  const created = await rpc("createSchedule", 1, assignment);
  assert.equal(created.ok, true);
  assert.equal(created.data.weekday, 1);
  assert.equal(typeof created.data.createdAt, "number");
  assert.equal(typeof created.data.updatedAt, "number");
  assert.equal((await rpc("createSchedule", 1, assignment)).code, "duplicate");
  assert.equal(
    (await rpc("createSchedule", 1, { ...assignment, salesForceId: "missing" }))
      .code,
    "reference_not_found"
  );
  assert.equal(
    (await rpc("createSchedule", 1, { ...assignment, outletId: "missing" }))
      .code,
    "reference_not_found"
  );
  await rpc("createSchedule", 1, { ...assignment, outletId: o2 });
  await rpc("createSchedule", 1, { ...assignment, weekday: 7 });
  await rpc("createSchedule", 1, { ...assignment, salesForceId: "sf-b" });
  const races = await Promise.all(
    Array.from({ length: 5 }, () =>
      rpc("createSchedule", 1, { ...assignment, weekday: 2 })
    )
  );
  assert.equal(races.filter((r) => r.ok).length, 1);
  assert.equal(races.filter((r) => r.code === "duplicate").length, 4);
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM visits").first()).n,
    0
  );
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM stock_reports").first()).n,
    0
  );
  assert.equal((await rpc("deleteOutlet", 1, { id: o1 })).code, "referenced");
  assert.equal((await rpc("deleteOutlet", 1, { id: o2 })).code, "referenced");

  const before = (
    await db.prepare("SELECT * FROM visit_schedules ORDER BY id").all()
  ).results;
  for (const by of [2, 3, 4, 5, 6, 7, 8, 9, 999])
    assert.equal(
      (await rpc("createSchedule", by, { ...assignment, weekday: 3 })).code,
      "forbidden"
    );
  for (const by of [5, 6, 7, 8, 9, 999])
    assert.equal((await rpc("ownSchedule", by, {})).code, "forbidden");
  for (const by of [3, 4, 5, 6, 7, 8, 9, 999]) {
    assert.equal((await rpc("listSchedules", by, {})).code, "forbidden");
    assert.equal(
      (await rpc("listSchedules", by, { salesForceId: "sf-b" })).code,
      "forbidden"
    );
  }
  for (const by of [1, 2]) {
    assert.equal((await rpc("ownSchedule", by, {})).code, "forbidden");
    assert.equal((await rpc("listSchedules", by, {})).data.items.length, 5);
    assert.equal(
      (await rpc("listSchedules", by, { weekday: 1 })).data.items.length,
      3
    );
    assert.equal(
      (await rpc("listSchedules", by, { salesForceId: "sf-b", weekday: 1 }))
        .data.items.length,
      1
    );
    assert.equal(
      (await rpc("listSchedules", by, { salesForceId: "missing" })).data.items
        .length,
      0
    );
  }
  assert.deepEqual(
    (await db.prepare("SELECT * FROM visit_schedules ORDER BY id").all())
      .results,
    before
  );
  assert.equal((await rpc("ownSchedule", 3, {})).data.items.length, 4);
  assert.equal(
    (await rpc("ownSchedule", 3, { weekday: 1 })).data.items.length,
    2
  );
  assert.equal((await rpc("ownSchedule", 4, {})).data.items.length, 1);
  assert.equal(
    (await rpc("ownSchedule", 4, { weekday: 7 })).data.items.length,
    0
  );
  for (const input of [
    { salesForceId: "sf-b" },
    { telegramUserId: "4" },
    { userId: "u-4" },
    { weekday: 0 },
    { weekday: "senin" },
    { after: "" },
    null,
  ])
    assert.equal((await rpc("ownSchedule", 3, input)).code, "invalid");
  for (const input of [
    { ...assignment, weekday: 8 },
    { ...assignment, weekday: 1.5 },
    { ...assignment, outletId: "" },
    { ...assignment, id: "chosen" },
    null,
  ])
    assert.equal((await rpc("createSchedule", 1, input)).code, "invalid");
  assert.equal(
    (
      await rpc(
        "listSchedules",
        { telegramUserId: "1", salesForceId: "sf-b" },
        {}
      )
    ).code,
    "invalid"
  );
  assert.equal(
    (await rpc("ownSchedule", { telegramUserId: "03" }, {})).code,
    "invalid"
  );
  assert.equal(
    (await rpc("ownSchedule", 3, {})).data.items[0].salesForceName,
    "Synthetic A"
  );
  assert.deepEqual(
    Object.keys((await rpc("ownSchedule", 3, {})).data.items[0]).toSorted(),
    [
      "id",
      "salesForceId",
      "outletId",
      "weekday",
      "createdAt",
      "updatedAt",
      "outletName",
      "salesForceName",
    ].toSorted()
  );

  assert.deepEqual(
    (await db.prepare("SELECT * FROM visit_schedules ORDER BY id").all())
      .results,
    before
  );
  await db
    .prepare(
      "CREATE TRIGGER fail_schedule AFTER INSERT ON visit_schedules BEGIN SELECT RAISE(ABORT, 'sensitive synthetic SQL detail'); END"
    )
    .run();
  assert.deepEqual(
    await rpc("createSchedule", 1, { ...assignment, weekday: 3 }),
    { ok: false, code: "unavailable" }
  );
  assert.deepEqual(
    (await db.prepare("SELECT * FROM visit_schedules ORDER BY id").all())
      .results,
    before
  );
  await db.prepare("DROP TRIGGER fail_schedule").run();

  // Permission and SF association are resolved again, including subsequent pages.
  const pendingOwn = await rpc("ownSchedule", 3, {});
  await db
    .prepare("UPDATE users SET sales_force_id = 'sf-b' WHERE id = 'u-3'")
    .run();
  assert.ok(
    (await rpc("ownSchedule", 3, {})).data.items.every(
      (s) => s.salesForceId === "sf-b"
    )
  );
  await db
    .prepare("UPDATE users SET sales_force_id = NULL WHERE id = 'u-3'")
    .run();
  assert.equal((await rpc("ownSchedule", 3, {})).code, "forbidden");
  await db
    .prepare("UPDATE users SET status = 'disabled' WHERE id = 'u-4'")
    .run();
  assert.equal(
    (await rpc("ownSchedule", 4, { after: pendingOwn.data.items[0].id })).code,
    "forbidden"
  );
  await db
    .prepare("UPDATE users SET role = 'supervisor' WHERE id = 'u-1'")
    .run();
  assert.equal(
    (await rpc("createSchedule", 1, { ...assignment, weekday: 3 })).code,
    "forbidden"
  );
  assert.equal((await rpc("listSchedules", 1, {})).ok, true);
  await db
    .prepare("UPDATE users SET status = 'disabled' WHERE id = 'u-1'")
    .run();
  assert.equal((await rpc("listSchedules", 1, {})).code, "forbidden");

  // A forged/out-of-scope cursor never changes own-query scope.
  await db
    .prepare("UPDATE users SET sales_force_id = 'sf-a' WHERE id = 'u-3'")
    .run();
  for (let i = 0; i < 105; i++) {
    await db.batch([
      db
        .prepare("INSERT INTO outlets (id, name) VALUES (?, 'Synthetic page')")
        .bind(`o-page-${i}`),
      db
        .prepare(
          "INSERT INTO visit_schedules (id, sales_force_id, outlet_id, weekday) VALUES (?, 'sf-a', ?, 1)"
        )
        .bind(`schedule-${String(i).padStart(3, "0")}`, `o-page-${i}`),
    ]);
  }
  for (const [method, by, expected] of [
    ["ownSchedule", 3, 109],
    ["listSchedules", 2, 110],
  ]) {
    const ids = [];
    let after;
    do {
      const page = (await rpc(method, by, after ? { after } : {})).data;
      assert.ok(page.items.length <= 50);
      if (method === "ownSchedule")
        assert.ok(page.items.every((s) => s.salesForceId === "sf-a"));
      ids.push(...page.items.map((s) => s.id));
      after = page.next;
    } while (after);
    assert.equal(ids.length, expected);
    assert.deepEqual(ids, [...new Set(ids)].toSorted());
  }
  const publicOutlets = await (await api.fetch("https://api/outlets")).json();
  assert.ok(
    publicOutlets.every((o) => Object.keys(o).toSorted().join() === "id,name")
  );
  assert.deepEqual(
    (await db.prepare("PRAGMA foreign_key_check").all()).results,
    []
  );
});

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
