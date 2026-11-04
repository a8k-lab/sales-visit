import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createStockReportSchema,
  createVisitSchema,
  idempotencyKeySchema,
} from "@sales-visit/contracts";

const report = {
  outletId: "outlet-1",
  reportedAt: "2026-11-04T09:00:00+07:00",
  items: [{ productId: "product-1", quantity: 0 }],
};

test("write contracts exclude server-owned fields and normalize timestamps", () => {
  assert.equal(
    createStockReportSchema.parse(report).reportedAt,
    "2026-11-04T02:00:00.000Z"
  );
  const visit = { outletId: report.outletId, visitedAt: report.reportedAt };
  assert.ok(createVisitSchema.safeParse(visit).success);
  assert.ok(
    createVisitSchema.safeParse({
      ...visit,
      stockReport: { reportedAt: report.reportedAt, items: report.items },
    }).success
  );
  for (const field of [
    "id",
    "salesForceId",
    "submissionChannel",
    "createdAt",
  ]) {
    assert.equal(
      createVisitSchema.safeParse({ ...visit, [field]: "client" }).success,
      false
    );
  }
  for (const field of [
    "id",
    "reporterSalesForceId",
    "submissionChannel",
    "createdAt",
  ]) {
    assert.equal(
      createStockReportSchema.safeParse({ ...report, [field]: "client" })
        .success,
      false
    );
  }
});

test("write items require unique Products and safe nonnegative integers", () => {
  for (const quantity of [
    -1,
    0.1,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.equal(
      createStockReportSchema.safeParse({
        ...report,
        items: [{ productId: "product-1", quantity }],
      }).success,
      false
    );
  }
  for (const quantity of [0, Number.MAX_SAFE_INTEGER]) {
    assert.ok(
      createStockReportSchema.safeParse({
        ...report,
        items: [{ productId: "product-1", quantity }],
      }).success
    );
  }
  for (const items of [
    [],
    [report.items[0], { ...report.items[0], productId: " product-1 " }],
    [{ ...report.items[0], extra: true }],
  ]) {
    assert.equal(
      createStockReportSchema.safeParse({ ...report, items }).success,
      false
    );
  }
  const items = Array.from({ length: 100 }, (_, i) => ({
    productId: `p-${i}`,
    quantity: 0,
  }));
  assert.ok(createStockReportSchema.safeParse({ ...report, items }).success);
  assert.equal(
    createStockReportSchema.safeParse({
      ...report,
      items: [...items, { productId: "overflow", quantity: 0 }],
    }).success,
    false
  );
});

test("retry keys must be UUIDs", () => {
  assert.ok(idempotencyKeySchema.safeParse(crypto.randomUUID()).success);
  for (const key of [undefined, "", "arbitrary", " key "]) {
    assert.equal(idempotencyKeySchema.safeParse(key).success, false);
  }
});
