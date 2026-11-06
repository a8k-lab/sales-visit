import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOutletSchema,
  planningIdSchema,
  updateOutletSchema,
  outletKeySchema,
  outletListSchema,
  weekdaySchema,
  indonesianWeekdaySchema,
  createScheduleSchema,
  ownScheduleFilterSchema,
  scheduleFilterSchema,
  outletDetailSchema,
  visitScheduleSchema,
} from "@sales-visit/contracts";

test("outlet operation inputs are strict, bounded and separate from stored models", () => {
  assert.deepEqual(createOutletSchema.parse({ name: "  Toko sintetis  " }), {
    name: "Toko sintetis",
  });
  assert.ok(
    updateOutletSchema.safeParse({ id: "opaque-key", name: "Toko" }).success
  );
  for (const name of ["", "  ", "x".repeat(257), "a\u0000b", 1])
    assert.equal(createOutletSchema.safeParse({ name }).success, false);
  for (const id of ["", " ", "x".repeat(257), "a\nb", 1])
    assert.equal(outletKeySchema.safeParse({ id }).success, false);
  for (const extra of [
    { role: "admin" },
    { id: "chosen" },
    { noRs: "001" },
    { businessId: "001" },
  ])
    assert.equal(
      createOutletSchema.safeParse({ name: "Toko", ...extra }).success,
      false
    );
  assert.equal(outletListSchema.safeParse({ limit: 10000 }).success, false);
  assert.ok(
    outletDetailSchema.safeParse({
      id: "o",
      name: "Legacy",
      createdAt: 1,
      updatedAt: null,
    }).success
  );
});

test("planning IDs preserve exact whitespace in inputs, reads and cursors", () => {
  const id = " opaque-key ";
  assert.equal(planningIdSchema.parse(id), id);
  assert.equal(outletKeySchema.parse({ id }).id, id);
  assert.equal(updateOutletSchema.parse({ id, name: "Name" }).id, id);
  assert.equal(outletListSchema.parse({ after: id }).after, id);
  assert.equal(ownScheduleFilterSchema.parse({ after: id }).after, id);
  assert.deepEqual(
    scheduleFilterSchema.parse({ after: id, salesForceId: id }),
    { after: id, salesForceId: id }
  );
  assert.deepEqual(
    createScheduleSchema.parse({ salesForceId: id, outletId: id, weekday: 1 }),
    { salesForceId: id, outletId: id, weekday: 1 }
  );
  assert.equal(
    outletDetailSchema.parse({
      id,
      name: "Legacy",
      createdAt: 0,
      updatedAt: null,
    }).id,
    id
  );
  const schedule = {
    id,
    salesForceId: " sf ",
    outletId: " outlet ",
    weekday: 1,
    createdAt: 0,
    updatedAt: 0,
  };
  assert.deepEqual(visitScheduleSchema.parse(schedule), schedule);
  for (const invalid of [
    "",
    " ",
    "\t",
    "x".repeat(257),
    "a\u0000b",
    "a\nb",
    "a\u007fb",
  ]) {
    assert.equal(planningIdSchema.safeParse(invalid).success, false);
    assert.equal(outletKeySchema.safeParse({ id: invalid }).success, false);
    assert.equal(outletListSchema.safeParse({ after: invalid }).success, false);
    assert.equal(
      createScheduleSchema.safeParse({
        salesForceId: invalid,
        outletId: id,
        weekday: 1,
      }).success,
      false
    );
    assert.equal(
      createScheduleSchema.safeParse({
        salesForceId: id,
        outletId: invalid,
        weekday: 1,
      }).success,
      false
    );
  }
});

test("planning read timestamps accept signed safe integers without transformation", () => {
  for (const timestamp of [
    -Number.MAX_SAFE_INTEGER,
    -86400000,
    -1,
    0,
    1,
    Number.MAX_SAFE_INTEGER,
  ]) {
    const outlet = {
      id: "o",
      name: "Legacy",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    assert.deepEqual(outletDetailSchema.parse(outlet), outlet);
    const schedule = {
      id: "s",
      salesForceId: "sf",
      outletId: "o",
      weekday: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    assert.deepEqual(visitScheduleSchema.parse(schedule), schedule);
  }
  for (const timestamp of [
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    -Number.MAX_SAFE_INTEGER - 1,
    "-1",
  ]) {
    assert.equal(
      outletDetailSchema.safeParse({
        id: "o",
        name: "Legacy",
        createdAt: timestamp,
        updatedAt: null,
      }).success,
      false
    );
  }
});

test("ISO weekdays and Indonesian boundary conversion agree for all seven days", () => {
  for (const [i, day] of [
    "senin",
    "selasa",
    "rabu",
    "kamis",
    "jumat",
    "sabtu",
    "minggu",
  ].entries())
    assert.equal(
      indonesianWeekdaySchema.parse(` ${day.toUpperCase()} `),
      i + 1
    );
  for (const weekday of [0, 8, 1.5, "1", "senin", null])
    assert.equal(weekdaySchema.safeParse(weekday).success, false);
  assert.equal(indonesianWeekdaySchema.safeParse("monday").success, false);
});

test("schedule create, read and own/monitor filters have distinct authority", () => {
  assert.ok(
    createScheduleSchema.safeParse({
      salesForceId: "s",
      outletId: "o",
      weekday: 1,
    }).success
  );
  assert.equal(
    createScheduleSchema.safeParse({
      salesForceId: " ",
      outletId: "o",
      weekday: 1,
    }).success,
    false
  );
  assert.equal(
    createScheduleSchema.safeParse({
      salesForceId: "s",
      outletId: "o",
      weekday: 1,
      id: "override",
    }).success,
    false
  );
  assert.ok(
    scheduleFilterSchema.safeParse({
      salesForceId: "s",
      weekday: 7,
      after: "cursor",
    }).success
  );
  for (const filter of [
    { salesForceId: "other" },
    { telegramUserId: "123" },
    { role: "admin" },
    { weekday: 0 },
    { after: "" },
  ])
    assert.equal(ownScheduleFilterSchema.safeParse(filter).success, false);
  assert.ok(
    visitScheduleSchema.safeParse({
      id: "a",
      salesForceId: "s",
      outletId: "o",
      weekday: 1,
      createdAt: 1,
      updatedAt: 1,
    }).success
  );
});
