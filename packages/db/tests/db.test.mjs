import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  outletSchema,
  productSchema,
  salesForceSchema,
  stockReportSchema,
  visitSchema,
} from "@sales-visit/contracts";
import { createDb, stockReports, visits } from "@sales-visit/db";
import * as schema from "@sales-visit/db/schema";

function database(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory)
    .filter((entry) => entry.endsWith(".sql"))
    .toSorted()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  db.exec(`
    INSERT INTO sales_force (id, name) VALUES ('sf-1', 'Field Staff');
    INSERT INTO outlets (id, name) VALUES ('outlet-1', 'Outlet'), ('outlet-2', 'Other');
    INSERT INTO products (id, name) VALUES ('product-1', 'Voucher');
  `);
  return db;
}

function insertVisit(db, overrides = {}) {
  const query = createDb({})
    .insert(visits)
    .values({
      id: "visit-1",
      outletId: "outlet-1",
      salesForceId: "sf-1",
      visitedAt: new Date("2026-11-02T02:00:00Z"),
      submissionChannel: "web",
      ...overrides,
    })
    .toSQL();
  db.prepare(query.sql).run(...query.params);
}

function insertReport(db, overrides = {}) {
  const query = createDb({})
    .insert(stockReports)
    .values({
      id: "report-1",
      outletId: "outlet-1",
      reporterSalesForceId: "sf-1",
      reportedAt: new Date("2026-11-02T02:00:00Z"),
      submissionChannel: "telegram",
      ...overrides,
    })
    .toSQL();
  db.prepare(query.sql).run(...query.params);
}

const toIso = (milliseconds) => new Date(milliseconds).toISOString();

test("exports include tables, relations, and a lazy D1 factory", () => {
  const binding = new Proxy(
    {},
    {
      get() {
        throw new Error("Unexpected binding access");
      },
    }
  );
  const db = createDb(binding);
  assert.equal(db.$client, binding);
  for (const name of [
    "salesForce",
    "users",
    "telegramIdentities",
    "outlets",
    "products",
    "visits",
    "stockReports",
    "stockReportItems",
  ]) {
    assert.ok(schema[name]);
    assert.ok(schema[`${name}Relations`]);
    assert.ok(db.query[name]);
  }
  // Resolving these nested queries exercises both sides of every relation.
  for (const [name, withRelations] of Object.entries({
    salesForce: { visits: true, stockReports: true, users: true },
    users: { salesForce: true, telegramIdentity: true },
    telegramIdentities: { user: true },
    outlets: { visits: true, stockReports: true },
    products: { stockReportItems: true },
    visits: { outlet: true, salesForce: true, stockReports: true },
    stockReports: {
      outlet: true,
      reporterSalesForce: true,
      visit: true,
      items: true,
    },
    stockReportItems: { stockReport: true, product: true },
  })) {
    assert.match(
      db.query[name].findMany({ with: withRelations }).toSQL().sql,
      /select/i
    );
  }
});

test("generated migrations support separate visits, standalone reports, and history", (t) => {
  const db = database(t);
  insertVisit(db);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM stock_reports").get().n,
    0
  );
  insertReport(db);
  insertReport(db, {
    id: "report-2",
    visitId: "visit-1",
    submissionChannel: "web",
  });
  insertReport(db, { id: "report-3", visitId: "visit-1" });
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM stock_reports").get().n,
    3
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("SQL enforces references, same-outlet linking, channels, and history protection", (t) => {
  const db = database(t);
  insertVisit(db);
  for (const overrides of [
    { outletId: "missing" },
    { reporterSalesForceId: "missing" },
    { visitId: "missing" },
    { visitId: "visit-1", outletId: "outlet-2" },
    { submissionChannel: "other" },
    { id: " " },
  ]) {
    assert.throws(() => insertReport(db, overrides));
  }
  assert.throws(() =>
    insertVisit(db, { id: "visit-2", salesForceId: "missing" })
  );
  assert.throws(() =>
    insertVisit(db, { id: "visit-2", submissionChannel: "other" })
  );
  insertReport(db, { visitId: "visit-1" });
  for (const table of ["visits", "outlets", "sales_force"]) {
    assert.throws(() => db.exec(`DELETE FROM ${table}`));
  }
});

test("item keys, quantities, and master-data constraints are enforced", (t) => {
  const db = database(t);
  insertReport(db);
  const insert = db.prepare("INSERT INTO stock_report_items VALUES (?, ?, ?)");
  for (const quantity of [
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "invalid",
    null,
  ]) {
    assert.throws(() => insert.run("report-1", "product-1", quantity));
  }
  assert.throws(() => insert.run("missing", "product-1", 1));
  assert.throws(() => insert.run("report-1", "missing", 1));
  insert.run("report-1", "product-1", 0);
  assert.throws(() => insert.run("report-1", "product-1", 2));
  assert.throws(() => db.exec("DELETE FROM stock_reports"));
  assert.throws(() => db.exec("DELETE FROM products"));
  for (const table of ["sales_force", "outlets", "products"]) {
    assert.throws(() =>
      db.exec(`INSERT INTO ${table} (id, name) VALUES (' ', 'Name')`)
    );
    assert.throws(() =>
      db.exec(`INSERT INTO ${table} (id, name) VALUES ('new', ' ')`)
    );
    // Names are not business identifiers and may repeat.
    db.exec(
      `INSERT INTO ${table} (id, name) SELECT 'new', name FROM ${table} LIMIT 1`
    );
  }
});

test("persisted records map to existing contracts without changing the contracts", (t) => {
  const db = database(t);
  insertVisit(db);
  insertReport(db);
  db.exec("INSERT INTO stock_report_items VALUES ('report-1', 'product-1', 0)");
  for (const [table, contract] of [
    ["sales_force", salesForceSchema],
    ["outlets", outletSchema],
    ["products", productSchema],
  ]) {
    assert.ok(contract.parse(db.prepare(`SELECT * FROM ${table}`).get()));
  }
  const visit = db.prepare("SELECT * FROM visits").get();
  assert.ok(
    visitSchema.parse({
      id: visit.id,
      outletId: visit.outlet_id,
      salesForceId: visit.sales_force_id,
      visitedAt: toIso(visit.visited_at),
      submissionChannel: visit.submission_channel,
      notes: visit.notes ?? undefined,
      followUp: visit.follow_up ?? undefined,
    })
  );
  const report = db.prepare("SELECT * FROM stock_reports").get();
  assert.ok(Number.isInteger(report.created_at));
  assert.ok(
    stockReportSchema.parse({
      id: report.id,
      outletId: report.outlet_id,
      reporterSalesForceId: report.reporter_sales_force_id,
      visitId: report.visit_id ?? undefined,
      reportedAt: toIso(report.reported_at),
      submissionChannel: report.submission_channel,
      items: db
        .prepare(
          "SELECT product_id AS productId, quantity FROM stock_report_items WHERE stock_report_id = ?"
        )
        .all(report.id),
    })
  );
});
