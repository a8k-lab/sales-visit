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
const demoCommands = ["demo", "demo_login", "demo_status", "demo_logout"];
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
  assert.match(text, /^Sales Visit Bot —/);
  assert.match(
    text,
    /Notasi: arg_name = wajib satu; \[arg_name\] = opsional satu; arg_name\.\.\. = wajib beberapa; \[arg_name\.\.\.\] = opsional beberapa/
  );
  const actual = [...text.matchAll(/^\/(\w+)(?: [^\n]*?)? — .+$/gm)].map(
    (match) => match[1]
  );
  assert.deepEqual(actual.toSorted(), expected.toSorted());
  assert.doesNotMatch(
    text,
    /TELEGRAM_ID|KURSOR|IMPORTANT NOTES|--hari|\[options\]|APP_ENV|DEMO_AUTH_ENABLED/
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

test("CLI usage matches actual parsers, conditionally required arguments, defaults and allowed values", () => {
  const admin = helpSections(account("admin"), { ok: true, data: null }).join(
    "\n\n"
  );
  for (const usage of [
    "/outlets [kursor]",
    "/outlet outlet_id",
    "/outletinternal internal_id",
    "/jadwalsales [hari=hari] [sf=sales_force_id] [after=kursor]",
    "/pending [kursor]",
    "/users [kursor]",
    "/approve telegram_id role [sales_force_id]",
    "/setrole telegram_id role [sales_force_id]",
    "/reject telegram_id",
    "/disable telegram_id",
    "/enable telegram_id",
    "/tambahoutlet outlet_id no_rs nama_outlet...",
    "/editoutlet outlet_id no_rs nama_outlet...",
    "/hapusoutlet outlet_id KONFIRMASI",
    "/editoutletinternal internal_id no_rs nama_outlet...",
    "/hapusoutletinternal internal_id KONFIRMASI",
    "/tambahjadwal sales_force_id internal_id hari",
    "/demo_login account_id",
  ])
    assert.ok(admin.includes(usage + " —"), usage);
  assert.match(admin, /admin, supervisor, sales \(alias: sales_force\)/);
  assert.match(
    admin,
    /sales_force_id wajib untuk sales\/sales_force; dilarang untuk role lain/
  );
  assert.match(admin, /default: semua hari\/SF, halaman pertama/);
  assert.match(admin, /\/jadwalsales telegram_id \[hari\] \[after=kursor\]/);
  assert.match(admin, /KONFIRMASI adalah teks wajib persis/);
  const sf = helpSections(account("sales_force")).join("\n\n");
  assert.match(sf, /\/jadwal \[hari\] \[after=kursor\] —/);
  assert.match(sf, /default: hari ini \(WIB\), halaman pertama/);
  assert.match(sf, /senin, selasa, rabu, kamis, jumat, sabtu, minggu, semua/);
  assert.match(sf, /after= harus didahului hari/);
  assert.match(sf, /24 jam/);
  assert.match(sf, /Detail: kirim perintah/);
  const readonly = helpSections(null, {
    ok: true,
    data: { account: { role: "admin" } },
  }).join("\n\n");
  assert.doesNotMatch(readonly, /\/jadwalsales telegram_id/);
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
