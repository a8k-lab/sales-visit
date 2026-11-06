import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

test("0006 adds nullable business metadata after populated 0005 without rewriting any reference", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys = ON");
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .toSorted();
  for (const file of files.filter((f) => f < "0006_"))
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  db.exec(`INSERT INTO outlets (id, name, created_at, updated_at) VALUES ('o', 'Legacy', -1, NULL);
    INSERT INTO sales_force (id, name) VALUES ('sf', 'Synthetic');
    INSERT INTO users (id, role, status, sales_force_id) VALUES ('u', 'sales_force', 'active', 'sf');
    INSERT INTO visits (id, outlet_id, sales_force_id, visited_at, submission_channel) VALUES ('v', 'o', 'sf', 1, 'web');
    INSERT INTO stock_reports (id, outlet_id, reporter_sales_force_id, visit_id, reported_at, submission_channel) VALUES ('r', 'o', 'sf', 'v', 2, 'web');
    INSERT INTO visit_schedules (id, sales_force_id, outlet_id, weekday) VALUES ('s', 'sf', 'o', 1);
    INSERT INTO telegram_visit_drafts (user_id, submission_key, sales_force_id, step, payload, last_message, expires_at) VALUES ('u', 'k', 'sf', 'review', '{"outletId":"o"}', 1, 1);`);
  const tables = [
    "visits",
    "stock_reports",
    "visit_schedules",
    "telegram_visit_drafts",
  ];
  const snapshot = () =>
    tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
  const before = snapshot();
  db.exec(readFileSync(new URL("0006_windy_black_crow.sql", dir), "utf8"));
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(
    { ...db.prepare("SELECT * FROM outlets").get() },
    {
      id: "o",
      name: "Legacy",
      created_at: -1,
      updated_at: null,
      business_id: null,
      no_rs: null,
    }
  );
  db.exec("INSERT INTO outlets (id, name) VALUES ('legacy2', 'Legacy 2')");
  const insert = db.prepare(
    "INSERT INTO outlets (id, business_id, no_rs, name) VALUES (?, ?, ?, 'Synthetic')"
  );
  insert.run("b1", "000a", "0003");
  insert.run("b2", "000A", "0003"); // binary/case-sensitive business ID, repeated No. RS
  assert.throws(() => insert.run("b3", "000a", "0004"), /UNIQUE/);
  assert.equal(
    db.prepare("SELECT no_rs FROM outlets WHERE business_id = '000a'").get()
      .no_rs,
    "0003"
  );
  assert.throws(
    () => db.exec("DELETE FROM outlets WHERE id = 'o'"),
    /FOREIGN KEY/
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
});
