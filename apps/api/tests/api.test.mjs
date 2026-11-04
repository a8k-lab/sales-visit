import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  outletSchema,
  productSchema,
  salesForceSchema,
  stockReportSchema,
  visitSchema,
} from "@sales-visit/contracts";
import { getPlatformProxy } from "wrangler";

import app, { createApp } from "../src/index.ts";

const seed = readFileSync(
  new URL("../seeds/local.sql", import.meta.url),
  "utf8"
);

async function executeSql(db, sql) {
  // These checked-in SQL files have no semicolons inside string literals.
  const statements = sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await db.batch(statements.map((statement) => db.prepare(statement)));
}

async function verifyWrites(t, env, json) {
  const identity = { salesForceId: "sf-01", submissionChannel: "web" };
  const authenticated = createApp(async (request, bindings) => {
    assert.ok(request instanceof Request);
    assert.equal(request.method, "POST");
    assert.equal(bindings, env);
    return identity;
  });
  const visit = {
    outletId: "out-01",
    visitedAt: "2026-11-04T09:00:00+07:00",
    notes: "Met owner",
    followUp: "Call back",
  };
  const report = {
    outletId: "out-01",
    reportedAt: "2026-11-04T02:05:00Z",
    items: [
      { productId: "prd-02", quantity: 0 },
      { productId: "prd-01", quantity: Number.MAX_SAFE_INTEGER },
    ],
  };
  const post = (path, body, key = crypto.randomUUID(), api = authenticated) =>
    api.request(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      },
      env
    );
  const counts = async () => {
    const result = await env.DB.prepare(`SELECT
      (SELECT count(*) FROM visits) AS visits,
      (SELECT count(*) FROM stock_reports) AS reports,
      (SELECT count(*) FROM stock_report_items) AS items`).first();
    return result;
  };

  await t.test("default runtime rejects identity spoofing", async () => {
    for (const path of ["/visits", "/stock-reports"]) {
      const response = await post(
        path,
        { ...visit, salesForceId: "sf-01" },
        undefined,
        app
      );
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "Unauthorized" });
      const spoof = await app.request(
        path,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer sf-01",
            "X-Sales-Force-Id": "sf-01",
          },
        },
        env
      );
      assert.equal(spoof.status, 401);
    }
    const unknown = createApp(async () => ({
      ...identity,
      salesForceId: "missing",
    }));
    assert.equal(
      (await post("/visits", visit, undefined, unknown)).status,
      401
    );
    assert.equal(
      (await post("/stock-reports", report, undefined, unknown)).status,
      401
    );
  });

  await t.test(
    "Visit without stock and independent and linked reports",
    async () => {
      const response = await post("/visits", visit);
      assert.equal(response.status, 201);
      const saved = await response.json();
      visitSchema.parse(saved);
      assert.equal(saved.salesForceId, identity.salesForceId);
      assert.equal(saved.visitedAt, "2026-11-04T02:00:00.000Z");
      assert.deepEqual(saved.stockReports, []);
      assert.deepEqual(await json(`/visits/${saved.id}`), saved);
      for (const visitId of [undefined, saved.id, saved.id]) {
        const created = await post("/stock-reports", { ...report, visitId });
        assert.equal(created.status, 201);
        const body = await created.json();
        stockReportSchema.parse(body);
        assert.equal(body.visitId, visitId);
        assert.equal(body.items[1].quantity, 0);
      }
      assert.equal((await json(`/visits/${saved.id}`)).stockReports.length, 2);
    }
  );

  await t.test(
    "POST, GET, and retries share SQLite BINARY item order",
    async () => {
      // UTF-16 puts U+10000 before U+E000; UTF-8 (SQLite BINARY) does the reverse.
      const productIds = ["unicode-\uE000", "unicode-\u{10000}"];
      for (const id of productIds) {
        await env.DB.prepare("INSERT INTO products (id, name) VALUES (?, ?)")
          .bind(id, "Unicode ordering fixture")
          .run();
      }
      const items = productIds
        .toReversed()
        .map((productId) => ({ productId, quantity: 0 }));
      for (const path of ["/stock-reports", "/visits"]) {
        const payload =
          path === "/stock-reports"
            ? { ...report, items }
            : {
                ...visit,
                stockReport: { reportedAt: report.reportedAt, items },
              };
        const key = crypto.randomUUID();
        const response = await post(path, payload, key);
        assert.equal(response.status, 201);
        const saved = await response.json();
        const savedReport =
          path === "/stock-reports" ? saved : saved.stockReports[0];
        assert.deepEqual(
          savedReport.items.map((item) => item.productId),
          productIds
        );
        const reports = await json("/stock-reports");
        assert.deepEqual(
          reports.find((row) => row.id === savedReport.id),
          savedReport
        );
        if (path === "/visits")
          assert.deepEqual(await json(`/visits/${saved.id}`), saved);
        // Reversed input order remains a matching retry with identical output.
        const retryPayload =
          path === "/stock-reports"
            ? { ...report, items: items.toReversed() }
            : {
                ...visit,
                stockReport: {
                  reportedAt: report.reportedAt,
                  items: items.toReversed(),
                },
              };
        const retry = await post(path, retryPayload, key);
        assert.equal(retry.status, 200);
        assert.deepEqual(await retry.json(), saved);
      }
    }
  );

  await t.test("atomic Visit with stock, retries and conflicts", async () => {
    const key = crypto.randomUUID();
    const payload = {
      ...visit,
      stockReport: { reportedAt: report.reportedAt, items: report.items },
    };
    const before = await counts();
    const response = await post("/visits", payload, key);
    assert.equal(response.status, 201);
    const saved = await response.json();
    assert.equal(saved.stockReports.length, 1);
    assert.deepEqual(await json(`/visits/${saved.id}`), saved);
    assert.equal(
      (await post("/stock-reports", { ...report, visitId: saved.id })).status,
      201
    );
    const replay = await post(
      "/visits",
      {
        ...payload,
        visitedAt: saved.visitedAt,
        stockReport: {
          ...payload.stockReport,
          items: report.items.toReversed(),
        },
      },
      key
    );
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), saved);
    for (const changed of [
      { ...payload, notes: "changed" },
      visit,
      { ...payload, outletId: "missing" },
      {
        ...payload,
        stockReport: {
          ...payload.stockReport,
          items: [{ productId: "prd-01", quantity: 7 }],
        },
      },
    ])
      assert.equal((await post("/visits", changed, key)).status, 409);
    const after = await counts();
    assert.deepEqual(after, {
      visits: before.visits + 1,
      reports: before.reports + 2,
      items: before.items + 4,
    });
    const bareKey = crypto.randomUUID();
    assert.equal((await post("/visits", visit, bareKey)).status, 201);
    assert.equal((await post("/visits", payload, bareKey)).status, 409);
  });

  await t.test("report retry, concurrency, and identity scoping", async () => {
    const key = crypto.randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => post("/stock-reports", report, key))
    );
    assert.deepEqual(
      responses.map((r) => r.status).toSorted(),
      [200, 200, 200, 201]
    );
    const bodies = await Promise.all(responses.map((r) => r.json()));
    for (const body of bodies) assert.deepEqual(body, bodies[0]);
    assert.equal(
      (await post("/stock-reports", { ...report, visitId: "VST-0012" }, key))
        .status,
      409
    );
    assert.equal(
      (
        await post(
          "/stock-reports",
          { ...report, items: [{ productId: "prd-01", quantity: 3 }] },
          key
        )
      ).status,
      409
    );
    const other = createApp(async () => ({
      salesForceId: "sf-02",
      submissionChannel: "telegram",
    }));
    const response = await post("/stock-reports", report, key, other);
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.notEqual(body.id, bodies[0].id);
    assert.equal(body.reporterSalesForceId, "sf-02");
    assert.equal(body.submissionChannel, "telegram");
    // Endpoint namespaces are independent even with the same key.
    assert.equal((await post("/visits", visit, key)).status, 201);
    const visitKey = crypto.randomUUID();
    const visits = await Promise.all(
      Array.from({ length: 3 }, () => post("/visits", visit, visitKey))
    );
    assert.deepEqual(visits.map((r) => r.status).toSorted(), [200, 200, 201]);
    const conflictKey = crypto.randomUUID();
    const conflicts = await Promise.all([
      post("/visits", visit, conflictKey),
      post("/visits", { ...visit, notes: "Different submission" }, conflictKey),
    ]);
    assert.deepEqual(conflicts.map((r) => r.status).toSorted(), [201, 409]);
  });

  await t.test(
    "invalid payloads and missing references never save rows",
    async () => {
      const before = await counts();
      for (const [path, body, status] of [
        ["/visits", {}, 400],
        ["/visits", { ...visit, outletId: " " }, 400],
        ["/visits", { ...visit, visitedAt: "2026-11-04" }, 400],
        ["/visits", { ...visit, visitedAt: "2026-02-30T00:00:00Z" }, 400],
        ["/visits", { ...visit, notes: 12 }, 400],
        ["/visits", { ...visit, followUp: null }, 400],
        ["/visits", { ...visit, salesForceId: "sf-02" }, 400],
        ["/visits", { ...visit, id: "client" }, 400],
        ["/visits", { ...visit, submissionChannel: "telegram" }, 400],
        ["/visits", { ...visit, outletId: "missing" }, 404],
        [
          "/visits",
          {
            ...visit,
            stockReport: {
              reportedAt: report.reportedAt,
              items: [{ productId: "missing", quantity: 0 }],
            },
          },
          404,
        ],
        ["/stock-reports", { ...report, outletId: "missing" }, 404],
        ["/stock-reports", { ...report, visitId: "missing" }, 404],
        ["/stock-reports", { ...report, visitId: "VST-0011" }, 400],
        ["/stock-reports", { ...report, reporterSalesForceId: "sf-02" }, 400],
        ["/stock-reports", { ...report, reportedAt: "bad" }, 400],
        ["/stock-reports", { ...report, items: [] }, 400],
        [
          "/stock-reports",
          { ...report, items: [{ productId: "missing", quantity: 0 }] },
          404,
        ],
        [
          "/stock-reports",
          {
            ...report,
            items: [
              report.items[0],
              { ...report.items[0], productId: " prd-02 " },
            ],
          },
          400,
        ],
        ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1", null].map((quantity) => [
          "/stock-reports",
          { ...report, items: [{ productId: "prd-01", quantity }] },
          400,
        ]),
      ]) {
        const response = await post(path, body);
        assert.equal(response.status, status, JSON.stringify(body));
        assert.equal(typeof (await response.json()).error, "string");
      }
      assert.equal((await post("/visits", visit, "bad-key")).status, 400);
      assert.equal(
        (
          await authenticated.request(
            "/visits",
            { method: "POST", body: "{" },
            env
          )
        ).status,
        400
      );
      assert.equal(
        (
          await authenticated.request(
            "/visits",
            { method: "POST", body: JSON.stringify(visit) },
            env
          )
        ).status,
        400
      );
      assert.deepEqual(await counts(), before);
    }
  );

  await t.test("D1 rolls back all rows on late item failure", async () => {
    // Inject a real database failure AFTER parent and first item insertion.
    await env.DB.prepare(`CREATE TRIGGER fail_item BEFORE INSERT ON stock_report_items
      WHEN NEW.product_id = 'prd-02' BEGIN SELECT RAISE(ABORT, 'test failure'); END`).run();
    const before = await counts();
    const key = crypto.randomUUID();
    const payload = {
      ...visit,
      stockReport: { reportedAt: report.reportedAt, items: report.items },
    };
    for (const [path, body] of [
      ["/visits", payload],
      ["/stock-reports", report],
    ]) {
      const response = await post(path, body, key);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: "Internal server error",
      });
      assert.deepEqual(await counts(), before);
    }
    await env.DB.prepare("DROP TRIGGER fail_item").run();
    // Failed writes do not consume the retry identity.
    assert.equal((await post("/visits", payload, key)).status, 201);
    assert.equal((await post("/stock-reports", report, key)).status, 201);
  });
}

test("default application rejects writes without accessing D1", async () => {
  const accesses = [];
  const DB = new Proxy(
    {},
    {
      get(_target, property) {
        accesses.push(property);
        throw new Error("Unexpected D1 access");
      },
    }
  );
  for (const path of ["/visits", "/stock-reports"]) {
    for (const body of [JSON.stringify({ salesForceId: "sf-01" }), "{"]) {
      const response = await app.request(
        path,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer sf-01",
          },
          body,
        },
        { DB }
      );
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "Unauthorized" });
    }
  }
  assert.deepEqual(accesses, []);
});

test("read and write API against isolated local D1", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "sales-visit-api-"));
  const proxy = await getPlatformProxy({
    configPath: new URL("../wrangler.jsonc", import.meta.url).pathname,
    persist: { path: directory },
  });
  t.after(async () => {
    await proxy.dispose();
    rmSync(directory, { recursive: true, force: true });
  });
  const request = (path, method = "GET") =>
    app.request(path, { method }, proxy.env);
  const json = async (path) => {
    const response = await request(path);
    assert.equal(response.status, 200);
    return response.json();
  };

  assert.deepEqual(await json("/health"), { status: "ok" });
  // Missing tables must not expose SQL, binding names, or internal exceptions.
  const unavailableWrite = await createApp(async () => ({
    salesForceId: "sf-01",
    submissionChannel: "web",
  })).request(
    "/visits",
    {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        outletId: "out-01",
        visitedAt: "2026-11-04T00:00:00Z",
      }),
    },
    proxy.env
  );
  assert.equal(unavailableWrite.status, 500);
  assert.deepEqual(await unavailableWrite.json(), {
    error: "Internal server error",
  });
  const unavailable = await request("/visits");
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "Service unavailable" });

  const migrations = new URL(
    "../../../packages/db/migrations/",
    import.meta.url
  );
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .toSorted()) {
    await executeSql(
      proxy.env.DB,
      readFileSync(new URL(file, migrations), "utf8")
    );
  }
  for (const path of [
    "sales-force",
    "outlets",
    "products",
    "visits",
    "stock-reports",
  ]) {
    assert.deepEqual(await json(`/${path}`), []);
  }
  await executeSql(proxy.env.DB, seed);
  const firstSeed = await json("/stock-reports");
  await executeSql(proxy.env.DB, seed);
  assert.deepEqual(await json("/stock-reports"), firstSeed);

  for (const [path, schema, count] of [
    ["sales-force", salesForceSchema, 3],
    ["outlets", outletSchema, 5],
    ["products", productSchema, 4],
    ["visits", visitSchema, 3],
    ["stock-reports", stockReportSchema, 4],
  ]) {
    const rows = await json(`/${path}`);
    assert.equal(rows.length, count);
    for (const row of rows) {
      assert.deepEqual(schema.parse(row), row);
      assert.equal("createdAt" in row, false);
    }
  }
  const visit = await json("/visits/VST-0012");
  assert.equal(visit.visitedAt, "2026-11-03T07:20:00.000Z");
  assert.deepEqual(
    visit.stockReports.map((r) => r.id),
    ["SR-0009", "SR-0010"]
  );
  for (const report of visit.stockReports) {
    stockReportSchema.parse(report);
    assert.equal(report.visitId, visit.id);
    assert.equal(report.outletId, visit.outletId);
  }
  assert.deepEqual((await json("/visits/VST-0010")).stockReports, []);
  assert.equal("followUp" in (await json("/visits/VST-0011")), false);
  const independent = firstSeed.find((row) => row.id === "SR-0001");
  assert.equal("visitId" in independent, false);
  assert.equal(
    firstSeed.find((row) => row.id === "SR-0008").items[1].quantity,
    0
  );
  for (const path of [
    "/visits/unknown",
    "/visits/%27%20OR%201%3D1--",
    "/unknown",
  ]) {
    assert.equal((await request(path)).status, 404);
  }
  // Former prefixed paths must not remain aliases or redirects.
  for (const path of [
    "sales-force",
    "outlets",
    "products",
    "visits",
    "visits/VST-0012",
    "stock-reports",
  ]) {
    const response = await request(`/api/v1/${path}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Not found" });
    assert.equal(response.headers.has("location"), false);
  }
  await verifyWrites(t, proxy.env, json);

  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    for (const path of [
      "/health",
      "/sales-force",
      "/outlets",
      "/products",
      "/visits",
      "/visits/VST-0012",
      "/stock-reports",
    ]) {
      assert.equal(
        (await request(path, method)).status,
        method === "POST" && ["/visits", "/stock-reports"].includes(path)
          ? 401
          : 404
      );
    }
  }
});
