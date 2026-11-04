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

import app from "../src/index.ts";

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

test("read API against isolated local D1", async (t) => {
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
      assert.equal((await request(path, method)).status, 404);
    }
  }
});
