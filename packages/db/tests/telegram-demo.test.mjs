import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

test("0012 isolates demo data; 0013 removes only obsolete choices and preserves sessions, identities and operational records", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys = ON");
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .toSorted();
  for (const file of files.filter((f) => f < "0012"))
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  db.exec(`INSERT INTO outlets(id,name) VALUES ('o','Real Outlet');
    INSERT INTO sales_force(id,name) VALUES ('sf','Real SF');
    INSERT INTO users(id,status,role,sales_force_id) VALUES ('u','active','sales_force','sf');
    INSERT INTO telegram_identities(user_id,telegram_user_id) VALUES ('u','123');
    INSERT INTO visits(id,outlet_id,sales_force_id,visited_at,submission_channel) VALUES ('v','o','sf',1,'telegram');
    INSERT INTO visit_schedules(id,outlet_id,sales_force_id,weekday) VALUES ('s','o','sf',1);`);
  const before = Object.fromEntries(
    [
      "outlets",
      "sales_force",
      "visit_schedules",
      "users",
      "telegram_identities",
      "visits",
    ].map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])
  );
  db.exec(readFileSync(new URL("0012_telegram_demo.sql", dir), "utf8"));
  for (const [table, rows] of Object.entries(before)) {
    const after = db.prepare(`SELECT * FROM ${table}`).all();
    assert.deepEqual(
      after.map(({ demo_only: _demoOnly, ...row }) => row),
      rows.map((row) => ({ ...row }))
    );
    if (["outlets", "sales_force", "visit_schedules"].includes(table)) {
      assert.equal(after[0].demo_only, 0);
      assert.throws(() => db.exec(`UPDATE ${table} SET demo_only=2`));
    }
  }
  const session = db.prepare(
    "INSERT INTO telegram_demo_sessions(telegram_user_id,user_id,created_at,expires_at) VALUES (?,?,?,?)"
  );
  session.run("900", "u", 1000, 3601000);
  assert.throws(() => session.run("901", "missing", 1000, 3601000));
  assert.throws(() => session.run("901", "u", 1000, 3601001));
  assert.throws(() => session.run("900", "u", 1000, 3601000));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.deepEqual(
    db.prepare("SELECT * FROM telegram_identities").all(),
    before.telegram_identities
  );
  db.exec(
    "INSERT INTO telegram_demo_choices(token,telegram_user_id,user_id,expires_at) VALUES ('old','900','u',123)"
  );
  const tables = ["telegram_demo_sessions", ...Object.keys(before)];
  const snapshots = tables.map((table) =>
    db.prepare(`SELECT * FROM ${table}`).all()
  );
  db.exec(readFileSync(new URL("0013_remove_demo_choices.sql", dir), "utf8"));
  assert.throws(() => db.prepare("SELECT * FROM telegram_demo_choices"));
  for (const [i, table] of tables.entries())
    assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), snapshots[i]);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});
