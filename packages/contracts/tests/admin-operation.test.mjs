import assert from "node:assert/strict";
import { test } from "node:test";

import {
  webOperationIdSchema,
  webOperationDeadline,
  webUserTargetSchema,
  webUserRoleSchema,
} from "@sales-visit/contracts";

test("Web operation identifier fixes one deadline and one UUID; malformed IDs fail closed", () => {
  const operationId = `web:1794220000000:${crypto.randomUUID()}`;
  assert.equal(webOperationIdSchema.parse(operationId), operationId);
  assert.equal(webOperationDeadline(operationId), 1794220000000);
  for (const invalid of [
    "",
    crypto.randomUUID(),
    operationId + "\n",
    operationId + ":later",
    operationId.replace("1794220000000", "1"),
    operationId.replace("web:", "bot:"),
    null,
  ])
    assert.equal(webOperationIdSchema.safeParse(invalid).success, false);
});
test("Web lifecycle requests require an operation ID without accepting identity or deadline overrides", () => {
  const operationId = `web:1794220000000:${crypto.randomUUID()}`;
  const target = { operationId, userId: "internal-user-id" };
  assert.deepEqual(webUserTargetSchema.parse(target), target);
  assert.equal(
    webUserTargetSchema.safeParse({ userId: target.userId }).success,
    false
  );
  for (const extra of [
    { actorId: "admin" },
    { telegramUserId: "123" },
    { expiresAt: 9999999999999 },
  ])
    assert.equal(
      webUserTargetSchema.safeParse({ ...target, ...extra }).success,
      false
    );
  for (const role of ["admin", "supervisor", "sales_force"]) {
    assert.equal(
      webUserRoleSchema.safeParse({
        ...target,
        role,
        ...(role === "sales_force" ? { salesForceId: "sf" } : {}),
      }).success,
      true
    );
  }
  assert.equal(
    webUserRoleSchema.safeParse({ ...target, role: "sales_force" }).success,
    false
  );
});
