import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { helpSections } from "../../bot/src/registration/help.ts";

const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL("../../bot/src/commands.ts", import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
const { installCommands } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const handlers = new Set();
installCommands(
  {
    use() {},
    on() {},
    command(name) {
      handlers.add(name);
    },
  },
  {}
);
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
  assert.ok(text.length > 0 && text.length < 2400);
  assert.match(text, /^👤 Umum\n/);
  const matches = [...text.matchAll(/^\/(\w+)(?: account_id)? — .+$/gm)];
  assert.deepEqual(matches.map((m) => m[1]).toSorted(), expected.toSorted());
  for (const match of matches) assert.ok(handlers.has(match[1]), match[1]);
  assert.doesNotMatch(
    text,
    /Notasi|default:|Alternatif:|Format:|Contoh:|APP_ENV|DEMO_AUTH_ENABLED|hari=|after=|\.\.\.|\[|TELEGRAM_ID|KURSOR/
  );
  return text;
}

test("minimal help lists only real handlers authorized for each role/status", () => {
  check(null, undefined, [...general, "register"]);
  for (const status of ["pending", "disabled", "rejected"]) {
    check(account(null, status), undefined, general);
    check(account("admin", status), undefined, general);
  }
  const admin = check(account("admin"), undefined, [
    ...general,
    ...monitoring,
    ...users,
    ...outlets,
  ]);
  for (const heading of ["📅 Monitoring", "👥 Pengguna", "🏪 Outlet & Jadwal"])
    assert.ok(admin.includes(heading));
  check(account("supervisor"), undefined, [...general, ...monitoring]);
  assert.match(
    check(account("sales_force"), undefined, [...general, "jadwal", ...visits]),
    /📋 Kunjungan/
  );
});

test("demo availability and selected role control minimalist help; all demo writes stay hidden", () => {
  const enabled = { ok: true, data: null };
  check(null, enabled, [...general, "register", ...demoCommands]);
  for (const status of ["pending", "disabled", "rejected"])
    check(account("admin", status), enabled, [...general, ...demoCommands]);
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
    assert.match(check(account("admin"), selected, expected), /🧪 Demo Mode/);
    check(null, selected, expected);
  }
  check(account("admin"), { ok: false, code: "expired" }, [
    ...general,
    ...demoCommands,
  ]);
  check(account("sales_force"), { ok: false, code: "disabled" }, [
    ...general,
    "jadwal",
    ...visits,
  ]);
});
