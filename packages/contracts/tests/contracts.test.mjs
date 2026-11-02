import assert from "node:assert/strict";
import { test } from "node:test";

import {
  outletSchema,
  productSchema,
  salesForceSchema,
  stockReportItemSchema,
  stockReportSchema,
  visitSchema,
} from "@sales-visit/contracts";

const visit = {
  id: "visit-1",
  outletId: "outlet-1",
  salesForceId: "sf-1",
  visitedAt: "2026-11-02T09:00:00+07:00",
  submissionChannel: "web",
};

const stockReport = {
  id: "report-1",
  outletId: "outlet-1",
  reporterSalesForceId: "sf-1",
  reportedAt: "2026-11-02T02:00:00Z",
  submissionChannel: "telegram",
  items: [{ productId: "product-1", quantity: 0 }],
};

test("master data requires an opaque ID and a nonblank name", () => {
  for (const schema of [salesForceSchema, outletSchema, productSchema]) {
    assert.deepEqual(schema.parse({ id: " record-1 ", name: " Example " }), {
      id: "record-1",
      name: "Example",
    });
    assert.equal(schema.safeParse({ id: " ", name: "Example" }).success, false);
    assert.equal(
      schema.safeParse({ id: "record-1", name: " " }).success,
      false
    );
  }
});

test("both channels use the same Visit and Stock Report contracts", () => {
  for (const submissionChannel of ["web", "telegram"]) {
    assert.equal(
      visitSchema.safeParse({ ...visit, submissionChannel }).success,
      true
    );
    assert.equal(
      stockReportSchema.safeParse({ ...stockReport, submissionChannel })
        .success,
      true
    );
  }
  assert.equal(
    visitSchema.safeParse({ ...visit, submissionChannel: "other" }).success,
    false
  );
});

test("Visit outcomes do not require stock; Stock Reports may stand alone", () => {
  assert.deepEqual(visitSchema.parse(visit), visit);
  assert.deepEqual(stockReportSchema.parse(stockReport), stockReport);
  for (const visitId of ["visit-1", "visit-2"]) {
    assert.equal(
      stockReportSchema.safeParse({ ...stockReport, visitId }).success,
      true
    );
  }
  assert.equal(
    visitSchema.safeParse({
      ...visit,
      notes: "Met owner",
      followUp: "Call back",
    }).success,
    true
  );
});

test("reports require timestamp offsets and Sales Force attribution", () => {
  assert.equal(
    visitSchema.safeParse({ ...visit, visitedAt: "2026-11-02T09:00:00" })
      .success,
    false
  );
  assert.equal(
    stockReportSchema.safeParse({ ...stockReport, reportedAt: "not a date" })
      .success,
    false
  );
  assert.equal(
    stockReportSchema.safeParse({
      ...stockReport,
      reporterSalesForceId: undefined,
    }).success,
    false
  );
});

test("Stock Reports require items with nonnegative whole quantities", () => {
  assert.equal(
    stockReportSchema.safeParse({ ...stockReport, items: [] }).success,
    false
  );
  for (const quantity of [-1, 1.5, "2", Infinity, NaN]) {
    assert.equal(
      stockReportItemSchema.safeParse({ productId: "product-1", quantity })
        .success,
      false
    );
  }
  assert.equal(
    stockReportItemSchema.safeParse({ productId: "product-1", quantity: 10 })
      .success,
    true
  );
});
