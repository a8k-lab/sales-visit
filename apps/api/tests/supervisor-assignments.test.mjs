import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import { createApp } from "../src/index.ts";
import { hashToken } from "../src/web-auth.ts";

const tokens = Object.fromEntries(
  [
    "admin",
    "admin2",
    "sup-a",
    "sup-b",
    "sup-empty",
    "sf-user",
    "disabled",
    "pending",
  ].map((id, i) => [id, (i + 1).toString(16).repeat(64)])
);
const telegram = {
  admin: "1001",
  "sup-a": "1002",
  "sup-b": "1003",
  "sup-empty": "1004",
  "sf-user": "1005",
  disabled: "1006",
  pending: "1007",
  admin2: "1008",
};
const actor = (id) => ({ telegramUserId: telegram[id] });

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
          d1Databases: { DB: "assignment-test" },
        },
      ],
    })
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB", "api");
  const dir = new URL("../../../packages/db/migrations/", import.meta.url);
  const migrate = async (file) => {
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
  };
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .toSorted();
  for (const file of files.filter((f) => !f.startsWith("0008_")))
    await migrate(file);
  await db
    .prepare(
      "INSERT INTO outlets (id,name) VALUES ('outlet','Synthetic Outlet')"
    )
    .run();
  await db
    .prepare(
      "INSERT INTO products (id,name) VALUES ('product','Synthetic Product')"
    )
    .run();
  for (const sf of ["a", "a2", "b", "unassigned"]) {
    await db
      .prepare("INSERT INTO sales_force (id,name) VALUES (?,?)")
      .bind(sf, `Synthetic ${sf}`)
      .run();
    await db
      .prepare(
        "INSERT INTO visits (id,outlet_id,sales_force_id,visited_at,submission_channel) VALUES (?, 'outlet', ?, 1, 'telegram')"
      )
      .bind(`visit-${sf}`, sf)
      .run();
    await db
      .prepare(
        "INSERT INTO visit_schedules (id,outlet_id,sales_force_id,weekday) VALUES (?, 'outlet', ?, 1)"
      )
      .bind(`schedule-${sf}`, sf)
      .run();
    // All reporters share a Visit owned by A: nested scope must use reporter.
    await db
      .prepare(
        "INSERT INTO stock_reports (id,outlet_id,reporter_sales_force_id,visit_id,reported_at,submission_channel) VALUES (?, 'outlet', ?, 'visit-a', 1, 'web')"
      )
      .bind(`report-${sf}`, sf)
      .run();
    await db
      .prepare("INSERT INTO stock_report_items VALUES (?, 'product', 3)")
      .bind(`report-${sf}`)
      .run();
  }
  for (const id of Object.keys(tokens)) {
    const role = id.startsWith("admin")
      ? "admin"
      : id === "sf-user"
        ? "sales_force"
        : id === "pending"
          ? null
          : "supervisor";
    const status =
      id === "disabled" ? "disabled" : id === "pending" ? "pending" : "active";
    await db
      .prepare(
        "INSERT INTO users (id,status,role,sales_force_id) VALUES (?,?,?,?)"
      )
      .bind(id, status, role, id === "sf-user" ? "a" : null)
      .run();
    await db
      .prepare(
        "INSERT INTO telegram_identities (user_id,telegram_user_id,first_name) VALUES (?,?,?)"
      )
      .bind(id, telegram[id], `Synthetic ${id}`)
      .run();
    await db
      .prepare(
        "INSERT INTO web_sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)"
      )
      .bind(await hashToken(tokens[id]), id, Date.now(), Date.now() + 3600000)
      .run();
  }
  await db
    .prepare(
      "INSERT INTO access_audit (id,actor_user_id,target_user_id,action,before_state,after_state) VALUES ('legacy-audit','admin','admin','register','null','{}')"
    )
    .run();
  await db
    .prepare(`INSERT INTO telegram_visit_drafts
    (user_id, submission_key, sales_force_id, step, payload, revision, last_message, expires_at)
    VALUES ('sf-user', 'preservation-draft', 'a', 'review', '{"outletId":"outlet"}', 3, 7, 12345)`)
    .run();
  await db
    .prepare(`INSERT INTO web_login_challenges (id, nonce, created_at, expires_at, consumed_at)
    VALUES ('preservation-challenge', 'preservation-nonce', 1, 3, 2)`)
    .run();
  const tables = [
    "users",
    "telegram_identities",
    "web_sessions",
    "web_login_challenges",
    "telegram_visit_drafts",
    "access_audit",
    "sales_force",
    "visits",
    "stock_reports",
    "stock_report_items",
    "visit_schedules",
    "outlets",
    "products",
  ];
  const snapshots = async () =>
    Promise.all(
      tables.map(
        async (table) =>
          (await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results
      )
    );
  const before = await snapshots();
  for (const file of files.filter((f) => f.startsWith("0008_")))
    await migrate(file);
  assert.deepEqual(
    await snapshots(),
    before,
    "0008 preserves populated pre-migration data byte-for-byte"
  );
  assert.deepEqual(
    (await db.prepare("PRAGMA foreign_key_check").all()).results,
    []
  );
  const app = createApp();
  const request = (path, id = "admin", init = {}, database = db) =>
    app.request(
      path,
      {
        ...init,
        headers: {
          ...(id ? { Authorization: `Bearer ${tokens[id]}` } : {}),
          ...init.headers,
        },
      },
      { DB: database, WEB_ORIGINS: "https://dashboard.test" }
    );
  const get = async (path, id = "admin") => {
    const response = await request(path, id);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const assign = (sf, supervisorUserId, id = "admin", database = db) =>
    request(
      "/supervisor-assignments",
      id,
      {
        method: "PUT",
        body: JSON.stringify({ salesForceId: sf, supervisorUserId }),
      },
      database
    );
  const rpc = async (method, ...args) =>
    (
      await mf.dispatchFetch("https://probe", {
        method: "POST",
        body: JSON.stringify({ method, args }),
      })
    ).json();
  return { db, request, get, assign, rpc };
}
const ids = (rows) => rows.map((row) => row.id);

test("operational overview aggregates all records in a zero-filled WIB window with current reporter scope", async (t) => {
  const { db, get, request, assign } = await setup(t);
  const initial = await get("/dashboard/overview");
  assert.deepEqual(initial.metrics, {
    visits: 0,
    outlets: 0,
    salesForce: 0,
    stockReports: 0,
  });
  assert.equal(initial.dailyVisits.length, 14);
  assert.ok(initial.dailyVisits.every((d) => d.count === 0));
  const start = Date.parse(initial.period.start);
  const end = Date.parse(initial.period.end);
  assert.equal(new Date(start).getUTCHours(), 17);
  await assign("a", "sup-a");
  await assign("b", "sup-b");
  await db.batch(
    Array.from({ length: 125 }, (_, i) =>
      db
        .prepare(
          "INSERT INTO visits (id,outlet_id,sales_force_id,visited_at,submission_channel) VALUES (?, 'outlet', ?, ?, 'telegram')"
        )
        .bind(`live-${String(i).padStart(3, "0")}`, i < 120 ? "a" : "b", start)
    )
  );
  // Exact start inclusive; end exclusive; a later WIB day and a pre-window record.
  for (const [id, timestamp] of [
    ["later", start + 86400000],
    ["before", start - 1],
    ["after", end],
  ])
    await db
      .prepare(
        "INSERT INTO visits (id,outlet_id,sales_force_id,visited_at,submission_channel) VALUES (?, 'outlet', 'a', ?, 'web')"
      )
      .bind(id, timestamp)
      .run();
  for (const [id, reporter, visit] of [
    ["independent", "a", null],
    ["linked", "a", "live-124"],
    ["other-reporter", "b", "live-000"],
  ])
    await db
      .prepare(
        "INSERT INTO stock_reports (id,outlet_id,reporter_sales_force_id,visit_id,reported_at,submission_channel) VALUES (?, 'outlet', ?, ?, ?, 'telegram')"
      )
      .bind(id, reporter, visit, start)
      .run();
  const first = await get(
    "/visits?view=page&limit=100&channel=telegram",
    "sup-a"
  );
  assert.equal(first.total, 121);
  assert.equal(first.items.length, 100);
  assert.equal(
    first.items[0].stockReportCount,
    0,
    "other-team reporter is not counted"
  );
  const second = await get(
    "/visits?view=page&limit=100&offset=100&channel=telegram",
    "sup-a"
  );
  assert.equal(second.total, 121);
  assert.equal(second.items.length, 21);
  assert.equal(
    new Set([...first.items, ...second.items].map((v) => v.id)).size,
    121
  );
  assert.equal(
    (await get("/visits?view=page&salesForceId=b", "sup-a")).total,
    0
  );
  assert.equal(
    (await get("/visits?view=page&q=Synthetic%20b", "sup-a")).total,
    0
  );
  assert.equal(
    (await get("/visits?view=page&stock=with&channel=telegram", "sup-a")).total,
    1
  );
  assert.equal(
    (await get("/visits?view=page&stock=with&channel=telegram")).total,
    3
  );
  assert.equal(
    (await get("/visits?view=page&date=" + initial.dailyVisits[0].date)).total,
    125
  );
  assert.equal((await get("/visits?view=page&outletId=missing")).total, 0);
  assert.equal((await get("/visits?view=page&q=%25")).total, 0);
  assert.deepEqual((await get("/sales-force?view=page", "sup-a")).items, [
    { id: "a", name: "Synthetic a" },
  ]);
  assert.equal((await get("/sales-force?view=page", "sup-empty")).total, 0);
  assert.equal((await get("/outlets?view=page&q=Synthetic")).total, 1);
  assert.equal((await get("/products?view=page&q=missing")).total, 0);
  assert.equal((await get("/outlets/outlet")).businessId, null);
  assert.equal(
    (await get("/stock-reports?view=page&outletId=outlet", "sup-a")).total,
    3
  );
  assert.equal(
    (await get("/stock-reports?view=page&outletId=missing", "sup-a")).total,
    0
  );
  assert.equal((await request("/visits/live-124", "sup-a")).status, 404);
  assert.equal((await request("/visits/missing", "sup-a")).status, 404);
  assert.equal((await get("/visits/live-000", "sup-a")).stockReports.length, 0);
  const expanded = await get("/visits/live-000?include=references", "sup-a");
  assert.equal(expanded.member.name, "Synthetic a");
  assert.equal(expanded.stockReports.length, 0);
  const expandedAdmin = await get("/visits/live-000?include=references");
  assert.equal(expandedAdmin.stockReports[0].reporter.id, "b");
  assert.equal(
    (await request("/visits/live-124?include=references", "sup-a")).status,
    404
  );
  for (const query of [
    "date=2026-02-30",
    "date=bad",
    "channel=bot",
    "stock=yes",
    "view=all",
    "q=",
    "q=a&q=b",
    "limit=101",
    "offset=100001",
    "outletId=",
  ])
    assert.equal((await request("/visits?" + query)).status, 400, query);
  assert.equal(
    (await request("/sales-force?view=page", "sf-user")).status,
    403
  );
  const admin = await get("/dashboard/overview");
  assert.deepEqual(admin.metrics, {
    visits: 126,
    outlets: 1,
    salesForce: 2,
    stockReports: 3,
  });
  assert.deepEqual(
    admin.dailyVisits.map((d) => d.count),
    [125, 1, ...Array(12).fill(0)]
  );
  assert.deepEqual(admin.channels, [
    { channel: "web", count: 1 },
    { channel: "telegram", count: 125 },
  ]);
  assert.equal(admin.recentVisits.length, 5);
  assert.equal(admin.recentVisits[0].id, "later");
  assert.equal(admin.recentVisits[1].id, "live-000");
  assert.equal(admin.recentVisits[0].outlet.name, "Synthetic Outlet");
  assert.deepEqual((await get("/dashboard/overview", "sup-a")).metrics, {
    visits: 121,
    outlets: 1,
    salesForce: 1,
    stockReports: 2,
  });
  assert.equal((await get("/dashboard/overview", "sup-b")).metrics.visits, 5);
  assert.equal(
    (await get("/dashboard/overview", "sup-empty")).metrics.visits,
    0
  );
  await assign("a", "sup-b");
  assert.equal(
    (await get("/dashboard/overview", "sup-a")).metrics.stockReports,
    0
  );
  assert.equal((await get("/dashboard/overview", "sup-b")).metrics.visits, 126);
  await assign("a", null);
  assert.equal((await get("/dashboard/overview", "sup-b")).metrics.visits, 5);
  assert.equal((await request("/dashboard/overview", null)).status, 401);
  assert.equal((await request("/dashboard/overview", "sf-user")).status, 403);
  assert.equal((await request("/dashboard/overview?period=bad")).status, 400);
  assert.equal(
    (await request("/dashboard/overview")).headers.get("cache-control"),
    "no-store"
  );
});

test("empty operational data and independent Stock Report timestamp boundaries", async (t) => {
  const { db, get, request, assign } = await setup(t);
  for (const table of ["stock_report_items", "stock_reports", "visits"])
    await db.prepare(`DELETE FROM ${table}`).run();
  const empty = await get("/dashboard/overview");
  assert.deepEqual(empty.metrics, {
    visits: 0,
    outlets: 0,
    salesForce: 0,
    stockReports: 0,
  });
  assert.deepEqual(empty.recentVisits, []);
  assert.equal(empty.dailyVisits.length, 14);
  assert.deepEqual(await get("/visits?view=page"), { items: [], total: 0 });
  assert.deepEqual(await get("/stock-reports?view=page"), {
    items: [],
    total: 0,
  });
  const start = Date.parse(empty.period.start);
  const end = Date.parse(empty.period.end);
  for (const [id, timestamp] of [
    ["before", start - 1],
    ["first", start],
    ["last", end - 1],
    ["after", end],
  ]) {
    await db
      .prepare(
        "INSERT INTO stock_reports (id,outlet_id,reporter_sales_force_id,reported_at,submission_channel) VALUES (?, 'outlet', 'a', ?, 'telegram')"
      )
      .bind(id, timestamp)
      .run();
  }
  await assign("a", "sup-a");
  assert.equal((await get("/dashboard/overview")).metrics.stockReports, 2);
  assert.equal(
    (await get("/dashboard/overview", "sup-a")).metrics.stockReports,
    2
  );
  assert.equal(
    (await get("/dashboard/overview", "sup-b")).metrics.stockReports,
    0
  );
  assert.equal((await get("/dashboard/overview")).metrics.visits, 0);
  await assign("a", "sup-b");
  assert.equal((await get("/stock-reports?view=page", "sup-a")).total, 0);
  assert.equal((await get("/stock-reports?view=page", "sup-b")).total, 4);
  await assign("a", null);
  assert.equal((await get("/stock-reports?view=page", "sup-b")).total, 0);
  for (const path of [
    "/stock-reports?channel=web",
    "/outlets?view=page&unknown=1",
    "/visits?unexpected=1",
    "/visits/id?include=all",
  ])
    assert.equal((await request(path)).status, 400);
});

test("assignment API, current Web scope, nested reporter isolation and Bot RPC", async (t) => {
  const { db, request, get, assign, rpc } = await setup(t);
  const audit = async () =>
    (
      await db
        .prepare("SELECT * FROM supervisor_assignment_audit ORDER BY rowid")
        .all()
    ).results;
  await t.test(
    "authentication, role checks, validation and sanitized failures",
    async () => {
      for (const path of [
        "/supervisors",
        "/supervisor-assignments",
        "/sales-force",
        "/visits",
        "/visits/visit-a",
        "/stock-reports",
      ]) {
        assert.equal((await request(path, null)).status, 401);
        assert.equal((await request(path, "disabled")).status, 401);
        assert.equal((await request(path, "pending")).status, 401);
      }
      for (const id of ["sup-a", "sup-b", "sf-user"]) {
        assert.equal((await request("/supervisors", id)).status, 403);
        assert.equal(
          (await request("/supervisor-assignments", id)).status,
          403
        );
        assert.equal((await assign("a", "sup-a", id)).status, 403);
      }
      assert.equal((await assign("a", "sup-a", null)).status, 401);
      for (const target of [
        "unknown",
        "disabled",
        "pending",
        "admin",
        "sf-user",
        "",
        "x\u0000",
        1,
        {},
        [],
      ])
        assert.equal((await assign("a", target)).status, 400);
      assert.equal((await assign("unknown", "sup-a")).status, 404);
      for (const body of [
        "{",
        "{}",
        "null",
        JSON.stringify({ supervisorUserId: "sup-a" }),
        JSON.stringify({ salesForceId: "a" }),
        JSON.stringify({ salesForceId: null, supervisorUserId: "sup-a" }),
        JSON.stringify({ salesForceId: 1, supervisorUserId: "sup-a" }),
        JSON.stringify({ salesForceId: "", supervisorUserId: "sup-a" }),
        JSON.stringify({
          salesForceId: "a",
          supervisorUserId: "sup-a",
          role: "admin",
          actor: "admin",
        }),
      ]) {
        assert.equal(
          (
            await request("/supervisor-assignments", "admin", {
              method: "PUT",
              body,
            })
          ).status,
          400
        );
      }
      assert.equal(
        (
          await request("/supervisor-assignments", "admin", {
            method: "PUT",
            body: "x".repeat(16385),
          })
        ).status,
        400
      );
      assert.deepEqual(await audit(), []);
      assert.deepEqual(
        (await get("/supervisors")).items.map((row) => row.id),
        ["sup-a", "sup-b", "sup-empty"]
      );
      for (const query of [
        "limit=0",
        "limit=101",
        "limit=-1",
        "limit=NaN",
        "after=%00",
      ])
        assert.equal(
          (await request(`/supervisor-assignments?${query}`)).status,
          400
        );
      const page = await get("/supervisor-assignments?limit=2");
      assert.deepEqual(
        page.items.map((row) => row.salesForceId),
        ["a", "a2"]
      );
      assert.equal(page.next, "a2");
      assert.deepEqual(
        (
          await get(`/supervisor-assignments?limit=2&after=${page.next}`)
        ).items.map((row) => row.salesForceId),
        ["b", "unassigned"]
      );
      const preflight = await request("/supervisor-assignments", null, {
        method: "OPTIONS",
        headers: {
          Origin: "https://dashboard.test",
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "Authorization, Content-Type",
        },
      });
      assert.equal(preflight.status, 204);
    }
  );
  await t.test(
    "unassigned Supervisors see empty collections, not global data",
    async () => {
      for (const path of ["/sales-force", "/visits", "/stock-reports"])
        assert.deepEqual(await get(path, "sup-empty"), []);
      assert.equal((await request("/visits/visit-a", "sup-empty")).status, 404);
      assert.deepEqual((await rpc("listSchedules", actor("sup-empty"))).data, {
        items: [],
        next: null,
      });
    }
  );
  await t.test(
    "assignment, no-ops, scoping before pagination/filter and detail lookup",
    async () => {
      for (const [sf, sup] of [
        ["a", "sup-a"],
        ["a2", "sup-a"],
        ["b", "sup-b"],
      ])
        assert.equal((await assign(sf, sup)).status, 200);
      assert.equal((await assign("a", "sup-a")).status, 200);
      assert.equal((await assign("unassigned", null)).status, 200);
      assert.equal((await audit()).length, 3);
      for (const [who, expected] of [
        ["admin", ["a", "a2", "b", "unassigned"]],
        ["sup-a", ["a", "a2"]],
        ["sup-b", ["b"]],
        ["sf-user", ["a"]],
      ]) {
        if (who === "sf-user")
          assert.equal((await request("/sales-force", who)).status, 403);
        else assert.deepEqual(ids(await get("/sales-force", who)), expected);
        assert.deepEqual(
          ids(await get("/visits", who)).toSorted(),
          expected.map((sf) => `visit-${sf}`).toSorted()
        );
        assert.deepEqual(
          ids(await get("/stock-reports", who)).toSorted(),
          expected.map((sf) => `report-${sf}`).toSorted()
        );
        assert.equal((await get("/outlets", who)).length, 1);
        assert.equal((await get("/products", who)).length, 1);
      }
      assert.deepEqual(ids(await get("/visits?limit=1&offset=1", "sup-a")), [
        "visit-a2",
      ]);
      assert.deepEqual(
        ids(await get("/stock-reports?limit=1&offset=1", "sup-a")),
        ["report-a2"]
      );
      assert.deepEqual(
        ids(await get("/sales-force?limit=1&offset=1", "sup-a")),
        ["a2"]
      );
      assert.deepEqual(await get("/visits?salesForceId=b", "sup-a"), []);
      assert.deepEqual(
        await get("/stock-reports?reporterSalesForceId=b", "sup-a"),
        []
      );
      assert.deepEqual(await get("/stock-reports?salesForceId=b", "sup-a"), []);
      assert.equal(
        (await request("/visits?salesForceId=b", "sf-user")).status,
        403
      );
      for (const path of ["/visits/visit-b", "/visits/no-such-visit"]) {
        const response = await request(path, "sup-a");
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: "Visit not found" });
      }
      assert.deepEqual(
        ids((await get("/visits/visit-a", "sup-a")).stockReports),
        ["report-a", "report-a2"]
      );
      assert.deepEqual(
        ids((await get("/visits/visit-a", "sf-user")).stockReports),
        ["report-a"]
      );
      assert.equal(
        (await get("/visits/visit-a", "admin")).stockReports.length,
        4
      );
      assert.deepEqual(
        (await rpc("listSchedules", actor("sup-a"))).data.items.map(
          (s) => s.salesForceId
        ),
        ["a", "a2"]
      );
      assert.deepEqual(
        (await rpc("listSchedules", actor("sup-a"), { salesForceId: "b" })).data
          .items,
        []
      );
      assert.deepEqual(
        await rpc("listSchedules", actor("sup-b"), {
          telegramUserId: telegram["sf-user"],
        }),
        { ok: false, code: "association_unavailable" }
      );
      assert.equal(
        (await rpc("listSchedules", actor("admin"))).data.items.length,
        4
      );
      assert.deepEqual(
        (await rpc("ownSchedule", actor("sf-user"))).data.items.map(
          (s) => s.salesForceId
        ),
        ["a"]
      );
      for (const invalid of [
        { telegramUserId: "0" },
        { telegramUserId: "unknown" },
        { username: "admin" },
        { telegramUserId: telegram["sf-user"], role: "admin" },
      ])
        assert.equal((await rpc("listSchedules", invalid)).ok, false);
    }
  );
  await t.test(
    "Supervisor Telegram target lookup cannot distinguish other teams from unknown identities",
    async () => {
      for (const supervisor of ["sup-b", "sup-empty"]) {
        for (const filter of [{}, { weekday: 2 }, { after: "schedule-a" }]) {
          const outOfTeam = await rpc("listSchedules", actor(supervisor), {
            ...filter,
            telegramUserId: telegram["sf-user"],
          });
          const unknown = await rpc("listSchedules", actor(supervisor), {
            ...filter,
            telegramUserId: "9999",
          });
          assert.deepEqual(outOfTeam, unknown);
          assert.deepEqual(outOfTeam, {
            ok: false,
            code: "association_unavailable",
          });
        }
      }
      for (const who of ["admin", "sup-a"]) {
        const available = await rpc("listSchedules", actor(who), {
          telegramUserId: telegram["sf-user"],
        });
        assert.equal(available.ok, true);
        assert.deepEqual(
          available.data.items.map((s) => s.salesForceId),
          ["a"]
        );
        assert.deepEqual(
          await rpc("listSchedules", actor(who), { telegramUserId: "9999" }),
          { ok: false, code: "association_unavailable" }
        );
        assert.deepEqual(
          (
            await rpc("listSchedules", actor(who), {
              telegramUserId: telegram["sf-user"],
              weekday: 2,
            })
          ).data,
          { items: [], next: null }
        );
      }
    }
  );
  await t.test(
    "reassignment and unassignment immediately change old sessions and historical visibility",
    async () => {
      assert.equal((await assign("a", "sup-b")).status, 200);
      assert.equal((await request("/visits/visit-a", "sup-a")).status, 404);
      assert.deepEqual(
        ids((await get("/visits/visit-a", "sup-b")).stockReports),
        ["report-a", "report-b"]
      );
      assert.deepEqual(
        (await rpc("listSchedules", actor("sup-a"))).data.items.map(
          (s) => s.salesForceId
        ),
        ["a2"]
      );
      assert.equal((await assign("a", null)).status, 200);
      assert.equal((await request("/visits/visit-a", "sup-b")).status, 404);
      assert.equal((await request("/visits/visit-a", "sf-user")).status, 200);
      const events = await audit();
      assert.deepEqual(
        events
          .slice(-2)
          .map((e) => [
            e.actor_user_id,
            e.sales_force_id,
            e.previous_supervisor_user_id,
            e.new_supervisor_user_id,
            e.action,
          ]),
        [
          ["admin", "a", "sup-a", "sup-b", "reassign"],
          ["admin", "a", "sup-b", null, "unassign"],
        ]
      );
      assert.ok(
        events.every(
          (event) => Number.isInteger(event.created_at) && event.created_at > 0
        )
      );
    }
  );
  await t.test(
    "disabled and changed-role Supervisors retain no Supervisor privileges",
    async () => {
      assert.equal(
        (
          await rpc("disable", actor("admin"), {
            telegramUserId: telegram["sup-a"],
          })
        ).ok,
        true
      );
      assert.equal((await request("/visits", "sup-a")).status, 401);
      assert.equal((await rpc("listSchedules", actor("sup-a"))).ok, false);
      assert.equal((await assign("a", "sup-a")).status, 400);
      assert.ok(
        (
          await db
            .prepare(
              "SELECT 1 FROM sales_force_supervisors WHERE supervisor_user_id = 'sup-a'"
            )
            .all()
        ).results.length,
        "rows may survive disabling; they confer no access"
      );
      assert.equal(
        (
          await rpc("enable", actor("admin"), {
            telegramUserId: telegram["sup-a"],
          })
        ).ok,
        true
      );
      assert.equal(
        (
          await rpc("setRole", actor("admin"), {
            telegramUserId: telegram["sup-a"],
            role: "admin",
          })
        ).ok,
        true
      );
      assert.equal(
        (await get("/visits", "sup-a")).length,
        4,
        "Admin visibility comes from current role, not assignments"
      );
      assert.equal((await assign("a", "sup-a")).status, 400);
      // Independent synthetic Supervisor can change to SF through existing lifecycle operations.
      assert.equal(
        (
          await rpc("setRole", actor("admin"), {
            telegramUserId: telegram["sup-b"],
            role: "sales_force",
            salesForceId: "b",
          })
        ).ok,
        true
      );
      assert.deepEqual(ids(await get("/visits", "sup-b")), ["visit-b"]);
      assert.equal((await rpc("listSchedules", actor("sup-b"))).ok, false);
      assert.equal((await assign("a", "sup-b")).status, 400);
    }
  );
});

test("legacy Sales Force IDs round-trip through JSON mutation and exact stored cursors", async (t) => {
  const { db, request, get, assign } = await setup(t);
  const legacyIds = [
    ".",
    "..",
    "SF/../name?x=1#fragment%2F\\backslash",
    " SF 日本 + ",
    "x".repeat(4096),
    "SF\ncontrol\tmember\r",
    "\t",
    "SF\u0000tail",
  ];
  for (const id of legacyIds) {
    await db
      .prepare(
        "INSERT INTO sales_force (id,name) VALUES (?, 'Legacy synthetic')"
      )
      .bind(id)
      .run();
    const visitId = `legacy-${legacyIds.indexOf(id)}`;
    await db
      .prepare(
        "INSERT INTO visits (id,outlet_id,sales_force_id,visited_at,submission_channel) VALUES (?, 'outlet', ?, 1, 'telegram')"
      )
      .bind(visitId, id)
      .run();
    const filter = new URLSearchParams({ view: "page", salesForceId: id });
    assert.deepEqual(
      (await get(`/visits?${filter}`)).items.map((v) => v.id),
      [visitId]
    );
    assert.equal((await get(`/visits?${filter}`, "sup-empty")).total, 0);
    for (const target of ["sup-a", "sup-a", "sup-b", null, null]) {
      const response = await assign(id, target);
      assert.equal(response.status, 200, await response.clone().text());
      const row = await response.json();
      assert.equal(row.salesForceId, id);
      assert.equal(row.supervisorUserId, target);
    }
    const events = (
      await db
        .prepare(
          "SELECT * FROM supervisor_assignment_audit WHERE sales_force_id = ? ORDER BY rowid"
        )
        .bind(id)
        .all()
    ).results;
    assert.deepEqual(
      events.map((event) => [
        event.actor_user_id,
        event.sales_force_id,
        event.previous_supervisor_user_id,
        event.new_supervisor_user_id,
        event.action,
      ]),
      [
        ["admin", id, null, "sup-a", "assign"],
        ["admin", id, "sup-a", "sup-b", "reassign"],
        ["admin", id, "sup-b", null, "unassign"],
      ]
    );
  }
  const collected = [];
  let after = "";
  do {
    const page = await get(
      `/supervisor-assignments?limit=1&after=${encodeURIComponent(after)}`
    );
    collected.push(...page.items.map((row) => row.salesForceId));
    after = page.next;
  } while (after !== null);
  const expected = (
    await db.prepare("SELECT id FROM sales_force ORDER BY id").all()
  ).results.map((row) => row.id);
  assert.deepEqual(
    collected,
    expected,
    "every emitted cursor resumes at the exact stored ID"
  );
  for (const id of ["unknown\nlegacy", "y".repeat(4096)]) {
    assert.equal((await assign(id, "sup-a")).status, 404);
    assert.equal(
      (await request(`/supervisor-assignments?after=${encodeURIComponent(id)}`))
        .status,
      400
    );
  }
  assert.equal(
    (await request(`/supervisor-assignments?after=${"x".repeat(16385)}`))
      .status,
    400
  );
  assert.equal((await assign("x".repeat(16385), "sup-a")).status, 400);
  assert.equal((await assign(".", "sup-a", null)).status, 401);
  assert.equal((await assign("..", "sup-a", "sup-b")).status, 403);
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM supervisor_assignment_audit")
        .first()
    ).n,
    legacyIds.length * 3
  );
  assert.deepEqual(
    (await db.prepare("PRAGMA foreign_key_check").all()).results,
    []
  );
});

test("D1 serialization, transaction-time authorization, rollback and Bot pagination", async (t) => {
  const { db, request, get, assign, rpc } = await setup(t);
  await t.test(
    "conflicting Admin writes are serialized with an intact actual-predecessor audit chain",
    async () => {
      const responses = await Promise.all([
        assign("a", "sup-a"),
        assign("a", "sup-b", "admin2"),
      ]);
      assert.deepEqual(
        responses.map((r) => r.status),
        [200, 200]
      );
      const rows = (
        await db
          .prepare("SELECT * FROM supervisor_assignment_audit ORDER BY rowid")
          .all()
      ).results;
      assert.equal(rows.length, 2);
      assert.equal(rows[0].previous_supervisor_user_id, null);
      assert.equal(
        rows[1].previous_supervisor_user_id,
        rows[0].new_supervisor_user_id
      );
      assert.notEqual(
        rows[1].new_supervisor_user_id,
        rows[0].new_supervisor_user_id
      );
      const current = await db
        .prepare(
          "SELECT supervisor_user_id FROM sales_force_supervisors WHERE sales_force_id = 'a'"
        )
        .first();
      assert.equal(current.supervisor_user_id, rows[1].new_supervisor_user_id);
      const repeats = await Promise.all([
        assign("a", current.supervisor_user_id),
        assign("a", current.supervisor_user_id, "admin2"),
      ]);
      assert.deepEqual(
        repeats.map((r) => r.status),
        [200, 200]
      );
      assert.equal(
        (
          await db
            .prepare("SELECT count(*) AS n FROM supervisor_assignment_audit")
            .first()
        ).n,
        2
      );
    }
  );
  await t.test(
    "actor and target checked in mutation batch, not only preflight",
    async () => {
      const intercept = (sql) => ({
        prepare: db.prepare.bind(db),
        batch: async (statements) => {
          await db.prepare(sql).run();
          return db.batch(statements);
        },
      });
      assert.equal(
        (
          await assign(
            "b",
            "sup-a",
            "admin2",
            intercept(
              "UPDATE users SET status = 'disabled' WHERE id = 'admin2'"
            )
          )
        ).status,
        403
      );
      assert.equal(
        (
          await assign(
            "b",
            "sup-a",
            "admin",
            intercept("UPDATE users SET status = 'disabled' WHERE id = 'sup-a'")
          )
        ).status,
        400
      );
      await db
        .prepare(
          "UPDATE users SET status = 'active' WHERE id IN ('admin2','sup-a')"
        )
        .run();
      assert.equal(
        (
          await assign(
            "b",
            "sup-a",
            "admin2",
            intercept(
              `UPDATE web_sessions SET revoked_at = 1 WHERE user_id = 'admin2'`
            )
          )
        ).status,
        403
      );
      assert.equal(
        (
          await db
            .prepare("SELECT count(*) AS n FROM supervisor_assignment_audit")
            .first()
        ).n,
        2
      );
    }
  );
  await t.test(
    "audit and assignment both roll back on batch failure; response contains no SQL",
    async () => {
      const broken = {
        prepare: db.prepare.bind(db),
        batch: (statements) =>
          db.batch([
            ...statements,
            db.prepare("INSERT INTO nonexistent_table VALUES (1)"),
          ]),
      };
      const response = await assign("b", "sup-a", "admin", broken);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "Service unavailable" });
      assert.equal(
        await db
          .prepare(
            "SELECT 1 FROM sales_force_supervisors WHERE sales_force_id = 'b'"
          )
          .first(),
        null
      );
      assert.equal(
        (
          await db
            .prepare("SELECT count(*) AS n FROM supervisor_assignment_audit")
            .first()
        ).n,
        2
      );
    }
  );
  await t.test(
    "bounded Supervisor options and exact legacy assignment IDs",
    async () => {
      await db.batch(
        Array.from({ length: 102 }, (_, i) =>
          db
            .prepare(
              "INSERT INTO users (id,status,role) VALUES (?, 'active', 'supervisor')"
            )
            .bind(`page-${String(i).padStart(3, "0")}`)
        )
      );
      const first = await get("/supervisors?after=page-");
      assert.equal(first.items.length, 100);
      assert.equal(first.next, "page-099");
      const second = await get(`/supervisors?after=${first.next}`);
      assert.deepEqual(
        second.items.map((s) => s.id),
        ["page-100", "page-101", "sup-a", "sup-b", "sup-empty"]
      );
      assert.equal(second.next, null);
      assert.equal((await request("/supervisors?after=%00")).status, 400);
      const legacyId = " SF 日本 + ";
      await db
        .prepare(
          "INSERT INTO sales_force (id,name) VALUES (?, 'Legacy synthetic')"
        )
        .bind(legacyId)
        .run();
      assert.equal((await assign(legacyId, "sup-a")).status, 200);
      const row = await db
        .prepare(
          "SELECT sales_force_id FROM sales_force_supervisors WHERE sales_force_id = ?"
        )
        .bind(legacyId)
        .first();
      assert.equal(row.sales_force_id, legacyId);
      assert.equal((await assign("a", "x".repeat(257))).status, 400);
    }
  );
  await t.test(
    "nested reporter scope precedes the 100-report detail bound",
    async () => {
      await assign("a", "sup-a");
      const statements = [];
      for (let i = 0; i < 210; i++)
        statements.push(
          db
            .prepare(
              "INSERT INTO stock_reports (id,outlet_id,reporter_sales_force_id,visit_id,reported_at,submission_channel) VALUES (?, 'outlet', ?, 'visit-a', ?, 'web')"
            )
            .bind(
              `nested-${String(i).padStart(3, "0")}`,
              i % 2 ? "a" : "b",
              i + 2
            )
        );
      await db.batch(statements);
      const detail = await get("/visits/visit-a", "sup-a");
      assert.equal(detail.stockReports.length, 100);
      assert.ok(
        detail.stockReports.every((r) => r.reporterSalesForceId === "a")
      );
      assert.equal((await get("/stock-reports?offset=100", "sup-a")).length, 6);
    }
  );
  await t.test(
    "Bot scope applies before keyset pagination, including selected SF and Telegram filters",
    async () => {
      await assign("a", "sup-a");
      await assign("b", "sup-b");
      const statements = [];
      for (let i = 0; i < 110; i++)
        statements.push(
          db.prepare(
            "INSERT INTO visit_schedules (id,sales_force_id,outlet_id,weekday) VALUES (?, ?, ?, 2)"
          )
        );
      // Unique outlet per plan; interleave another team's IDs in the same cursor range.
      for (let i = 0; i < 110; i++) {
        const id = String(i).padStart(3, "0");
        await db
          .prepare(
            "INSERT INTO outlets (id,name) VALUES (?, 'Synthetic pagination')"
          )
          .bind(`o-${id}`)
          .run();
        await statements[i].bind(`p-${id}`, i % 2 ? "a" : "b", `o-${id}`).run();
      }
      const first = await rpc("listSchedules", actor("sup-a"), { weekday: 2 });
      assert.equal(first.data.items.length, 50);
      assert.ok(first.data.items.every((s) => s.salesForceId === "a"));
      assert.ok(first.data.next);
      const second = await rpc("listSchedules", actor("sup-a"), {
        weekday: 2,
        after: first.data.next,
        telegramUserId: telegram["sf-user"],
      });
      assert.equal(second.data.items.length, 5);
      assert.equal(second.data.next, null);
      assert.equal(
        new Set([...first.data.items, ...second.data.items].map((s) => s.id))
          .size,
        55
      );
      assert.deepEqual(
        (
          await rpc("listSchedules", actor("sup-a"), {
            after: first.data.next,
            salesForceId: "b",
          })
        ).data.items,
        []
      );
      assert.deepEqual(
        (
          await rpc("listSchedules", actor("sup-empty"), {
            weekday: 2,
            after: first.data.next,
          })
        ).data.items,
        []
      );
      assert.deepEqual(await get("/visits?limit=1&offset=1", "sup-a"), []);
      assert.equal((await request("/visits?limit=101", "sup-a")).status, 400);
      assert.deepEqual(
        (await db.prepare("PRAGMA foreign_key_check").all()).results,
        []
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO sales_force_supervisors (sales_force_id,supervisor_user_id) VALUES ('a','sup-a')"
          )
          .run()
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO sales_force_supervisors (sales_force_id,supervisor_user_id) VALUES ('unknown','sup-a')"
          )
          .run()
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO sales_force_supervisors (sales_force_id,supervisor_user_id) VALUES ('unassigned','unknown')"
          )
          .run()
      );
    }
  );
});
