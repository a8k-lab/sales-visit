import assert from "node:assert/strict";
import { test } from "node:test";

import { helpSections } from "../../bot/src/registration/help.ts";

const general = ["start", "help", "me"];
const monitoring = ["jadwalsales", "outlets", "outlet", "outletinternal"];
const users = [
  "pending",
  "users",
  "approve",
  "reject",
  "setrole",
  "disable",
  "enable",
];
const outlets = [
  "tambahoutlet",
  "editoutlet",
  "hapusoutlet",
  "editoutletinternal",
  "hapusoutletinternal",
  "tambahjadwal",
];
const visits = ["salesvisit", "konfirmasi", "batal"];
const demoCommands = ["demo", "demo_status", "demo_logout"];
const account = (role, status = "active") => ({
  id: "u",
  telegramUserId: "900",
  role,
  status,
  salesForceId: role === "sales_force" ? "sf" : null,
  username: null,
  firstName: "Test",
  lastName: null,
  createdAt: 1,
});
function check(profile, demo, expected) {
  const text = helpSections(profile, demo).join("\n\n");
  assert.ok(text.length > 0 && text.length < 4096);
  assert.match(text, /^Umum\n/);
  const actual = [...text.matchAll(/^\/(\w+) — .+$/gm)].map(
    (match) => match[1]
  );
  assert.deepEqual(actual.toSorted(), expected.toSorted());
  assert.doesNotMatch(
    text,
    /Contoh:|Format:|TELEGRAM_ID|KURSOR|IMPORTANT NOTES/
  );
  return text;
}

test("compact help advertises only commands authorized for each normal role/status", () => {
  check(null, undefined, [...general, "register"]);
  for (const status of ["pending", "disabled", "rejected"]) {
    check(account(null, status), undefined, general);
    check(account("admin", status), undefined, general);
  }
  check(account("admin"), undefined, [
    ...general,
    ...monitoring,
    ...users,
    ...outlets,
  ]);
  check(account("supervisor"), undefined, [...general, ...monitoring]);
  check(account("sales_force"), undefined, [...general, "jadwal", ...visits]);
});

test("demo availability and effective selected role control help; all demo writes stay hidden", () => {
  const enabled = { ok: true, data: null };
  check(null, enabled, [...general, "register", ...demoCommands]);
  check(account("admin"), enabled, [
    ...general,
    ...monitoring,
    ...users,
    ...outlets,
    ...demoCommands,
  ]);
  for (const role of ["admin", "supervisor", "sales_force"]) {
    const selected = {
      ok: true,
      data: {
        account: { id: "selected", name: "Demo", role, salesForceId: "sf" },
        expiresAt: Date.now() + 3600000,
      },
    };
    const expected = [
      ...general,
      ...demoCommands,
      ...(role === "sales_force" ? ["jadwal"] : monitoring),
    ];
    // The selected demo role wins even if normal authentication was an Admin.
    assert.match(check(account("admin"), selected, expected), /Hanya baca/);
    check(null, selected, expected);
  }
  // An ineligible unexpired demo credential must not reveal underlying Admin commands.
  check(account("admin"), { ok: false, code: "expired" }, [
    ...general,
    ...demoCommands,
  ]);
  // Gate off / expiration / logout restores ordinary help without demo-only restrictions.
  check(account("sales_force"), { ok: false, code: "disabled" }, [
    ...general,
    "jadwal",
    ...visits,
  ]);
});
