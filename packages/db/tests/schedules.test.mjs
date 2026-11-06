import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { createDb } from "@sales-visit/db";

test("additive schedule migration preserves existing history and restricts assignments", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys = ON");
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && f <= "0003_\uffff")
    .toSorted();
  for (const file of files.slice(0, -1))
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  db.exec(`INSERT INTO outlets (id, name) VALUES ('o', 'Legacy');
    INSERT INTO sales_force (id, name) VALUES ('s', 'Synthetic'), ('s2', 'Other');
    INSERT INTO visits (id, outlet_id, sales_force_id, visited_at, submission_channel) VALUES ('v', 'o', 's', 1, 'web');
    INSERT INTO stock_reports (id, outlet_id, reporter_sales_force_id, visit_id, reported_at, submission_channel) VALUES ('r', 'o', 's', 'v', 1, 'web');`);
  const before = ["outlets", "visits", "stock_reports"].map((table) =>
    db.prepare(`SELECT * FROM ${table}`).all()
  );
  db.exec(readFileSync(new URL(files.at(-1), dir), "utf8"));
  assert.equal(
    db.prepare("SELECT updated_at FROM outlets").get().updated_at,
    null
  );
  assert.equal(
    db.prepare("SELECT id, name, created_at FROM outlets").get().name,
    before[0][0].name
  );
  for (const [i, table] of ["visits", "stock_reports"].entries())
    assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), before[i + 1]);
  const insert = db.prepare(
    "INSERT INTO visit_schedules (id, sales_force_id, outlet_id, weekday) VALUES (?, ?, ?, ?)"
  );
  insert.run("a", "s", "o", 1);
  insert.run("b", "s2", "o", 1);
  insert.run("c", "s", "o", 7);
  for (const args of [
    ["d", "s", "o", 1],
    ["d", "missing", "o", 2],
    ["d", "s", "missing", 2],
    ["d", "s", "o", 0],
    ["d", "s", "o", 8],
    ["d", "s", "o", 1.5],
    [" ", "s", "o", 2],
  ])
    assert.throws(() => insert.run(...args));
  assert.throws(() => db.exec("DELETE FROM outlets WHERE id = 'o'"));
  assert.throws(() => db.exec("DELETE FROM sales_force WHERE id = 's2'"));
  assert.throws(() => db.exec("UPDATE outlets SET id = 'new' WHERE id = 'o'"));
  assert.equal(db.prepare("SELECT count(*) AS n FROM visits").get().n, 1);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.match(
    createDb({})
      .query.visitSchedules.findMany({
        with: { outlet: true, salesForce: true },
      })
      .toSQL().sql,
    /select/i
  );
});
