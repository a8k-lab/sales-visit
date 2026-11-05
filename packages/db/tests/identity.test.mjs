import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { createDb, users } from "@sales-visit/db";

const migrations = new URL("../migrations/", import.meta.url);
const apply = (db, name) =>
  db.exec(readFileSync(new URL(name, migrations), "utf8"));

function database(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function migrated(t) {
  const db = database(t);
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()) {
    apply(db, file);
  }
  return db;
}

const user = (db, id, status = "pending", role = null, sf = null) =>
  db
    .prepare(
      "INSERT INTO users (id, status, role, sales_force_id) VALUES (?, ?, ?, ?)"
    )
    .run(id, status, role, sf);
const telegram = (db, id, telegramId) =>
  db
    .prepare(
      "INSERT INTO telegram_identities (user_id, telegram_user_id) VALUES (?, ?)"
    )
    .run(id, telegramId);

test("User defaults generate independent internal IDs and pending, unassigned accounts", (t) => {
  const db = migrated(t);
  const query = createDb({}).insert(users).values({}).toSQL();
  db.prepare(query.sql).run(...query.params);
  db.exec("INSERT INTO users DEFAULT VALUES");
  const rows = db.prepare("SELECT * FROM users").all();
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
  for (const row of rows) {
    assert.match(row.id, /^[a-f0-9]{32}$/);
    assert.equal(row.status, "pending");
    assert.equal(row.role, null);
    assert.equal(row.sales_force_id, null);
    assert.ok(Number.isInteger(row.created_at));
    assert.ok(Number.isInteger(row.updated_at));
  }
  assert.throws(() => user(db, " "));
  assert.throws(() => user(db, null));
  assert.throws(() => user(db, rows[0].id));
});

test("SQL validates every role/status combination independently of TypeScript", (t) => {
  const db = migrated(t);
  let n = 0;
  for (const status of [
    "pending",
    "active",
    "rejected",
    "disabled",
    "unknown",
    null,
  ]) {
    for (const role of [
      null,
      "admin",
      "supervisor",
      "sales_force",
      "sales",
      "",
    ]) {
      const insert = () => user(db, `user-${n++}`, status, role);
      const validStatus = [
        "pending",
        "active",
        "rejected",
        "disabled",
      ].includes(status);
      const validRole =
        role === null || ["admin", "supervisor", "sales_force"].includes(role);
      const needsRole = status === "active" || status === "disabled";
      if (validStatus && validRole && (!needsRole || role !== null)) insert();
      else assert.throws(insert);
    }
  }
  for (const table of ["users", "telegram_identities"]) {
    user(db, `timestamps-${table}`);
    if (table === "telegram_identities")
      telegram(db, `timestamps-${table}`, "123456");
    for (const column of ["created_at", "updated_at"]) {
      for (const value of [null, "bad", 1.5]) {
        assert.throws(() =>
          db.prepare(`UPDATE ${table} SET ${column} = ?`).run(value)
        );
      }
    }
  }
});

test("schema permits lifecycle transitions and retains role on disable/reactivation", (t) => {
  const db = migrated(t);
  user(db, "approved");
  const update = db.prepare(
    "UPDATE users SET status = ?, role = ?, updated_at = ? WHERE id = 'approved'"
  );
  assert.throws(() => update.run("active", null, 1));
  update.run("active", "sales_force", 2);
  db.exec(
    "UPDATE users SET status = 'disabled', updated_at = 3 WHERE id = 'approved'"
  );
  assert.equal(
    db.prepare("SELECT role FROM users WHERE id = 'approved'").get().role,
    "sales_force"
  );
  assert.throws(() => update.run("disabled", null, 4));
  db.exec(
    "UPDATE users SET status = 'active', updated_at = 5 WHERE id = 'approved'"
  );
  assert.equal(
    db.prepare("SELECT role FROM users WHERE id = 'approved'").get().role,
    "sales_force"
  );
  user(db, "rejected");
  db.exec("UPDATE users SET status = 'rejected' WHERE id = 'rejected'");
  db.exec("UPDATE users SET status = 'pending' WHERE id = 'rejected'");
  assert.equal(
    db.prepare("SELECT role FROM users WHERE id = 'rejected'").get().role,
    null
  );
});

test("Sales Force association is optional, non-unique, and restricts broken references", (t) => {
  const db = migrated(t);
  db.exec("INSERT INTO sales_force (id, name) VALUES ('sf-1', 'Staff')");
  user(db, "admin", "active", "admin");
  user(db, "one", "active", "sales_force", "sf-1");
  user(db, "two", "pending", null, "sf-1");
  assert.throws(() => user(db, "missing", "pending", null, "missing"));
  assert.throws(() => db.exec("DELETE FROM sales_force WHERE id = 'sf-1'"));
  assert.throws(() =>
    db.exec("UPDATE sales_force SET id = 'changed' WHERE id = 'sf-1'")
  );
  assert.throws(() =>
    db.exec("UPDATE users SET sales_force_id = 'missing' WHERE id = 'one'")
  );
  assert.equal(db.prepare("SELECT count(*) AS n FROM sales_force").get().n, 1);
});

test("Telegram identity is canonical positive decimal text, unique in both directions", (t) => {
  const db = migrated(t);
  user(db, "one");
  user(db, "two");
  for (const invalid of [
    null,
    "",
    "0",
    "01",
    "-1",
    "+1",
    " 123",
    "123 ",
    "1.0",
    "1e3",
    "１２３",
    "123\n",
    "123\0",
    "123\0x",
    "1x",
  ]) {
    assert.throws(() => telegram(db, "one", invalid));
  }
  // Larger than JS's safe integer range: never round-trip through Number.
  telegram(db, "one", "9007199254740993");
  assert.equal(
    db.prepare("SELECT telegram_user_id FROM telegram_identities").get()
      .telegram_user_id,
    "9007199254740993"
  );
  assert.throws(() => telegram(db, "one", "456"));
  assert.throws(() => telegram(db, "two", "9007199254740993"));
  assert.throws(() => telegram(db, "missing", "456"));
  telegram(db, "two", "456");
  db.exec(
    "UPDATE telegram_identities SET username = 'same', first_name = 'Same', last_name = 'Name'"
  );
  assert.throws(() =>
    db.exec(
      "UPDATE telegram_identities SET telegram_user_id = '456' WHERE user_id = 'one'"
    )
  );
  assert.throws(() =>
    db.exec(
      "UPDATE telegram_identities SET user_id = 'missing' WHERE user_id = 'one'"
    )
  );
  assert.throws(() => db.exec("DELETE FROM users WHERE id = 'one'"));
  assert.throws(() =>
    db.exec("UPDATE users SET id = 'changed' WHERE id = 'one'")
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sales_force").get().n, 0);
});

function bootstrap(db, id = "bootstrap-user", telegramId = "123456789") {
  const documentation = readFileSync(
    new URL("../IDENTITY.md", import.meta.url),
    "utf8"
  );
  const template = documentation.match(/```sql\n([\s\S]*?)```/)[1];
  // Fixed synthetic test inputs only; operators must validate private inputs.
  db.exec(
    template
      .replaceAll("<internal-user-id>", id)
      .replaceAll("<telegram-bot-user-id>", telegramId)
  );
}

test("documented bootstrap is idempotent, linked, and cannot create a second first Admin", (t) => {
  const db = migrated(t);
  bootstrap(db);
  const before = db.prepare("SELECT * FROM users").all();
  bootstrap(db);
  assert.deepEqual(db.prepare("SELECT * FROM users").all(), before);
  assert.equal(before[0].status, "active");
  assert.equal(before[0].role, "admin");
  assert.equal(before[0].sales_force_id, null);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM telegram_identities").get().n,
    1
  );
  bootstrap(db, "second", "987654321");
  assert.equal(db.prepare("SELECT count(*) AS n FROM users").get().n, 1);
});

test("bootstrap retries partial pending state and fails closed on identity conflicts", (t) => {
  const db = migrated(t);
  user(db, "bootstrap-user");
  bootstrap(db);
  assert.equal(db.prepare("SELECT status FROM users").get().status, "active");
  db.exec("UPDATE users SET status = 'disabled'");
  bootstrap(db);
  assert.equal(db.prepare("SELECT status FROM users").get().status, "disabled");
  user(db, "other");
  assert.throws(() => bootstrap(db, "other"));
  assert.equal(
    db.prepare("SELECT status FROM users WHERE id = 'other'").get().status,
    "pending"
  );
  user(db, "mismatch");
  telegram(db, "mismatch", "987654321");
  bootstrap(db, "mismatch", "111222333");
  assert.equal(
    db.prepare("SELECT status FROM users WHERE id = 'mismatch'").get().status,
    "pending"
  );
  user(db, "rejected", "rejected");
  bootstrap(db, "rejected", "222333444");
  assert.equal(
    db.prepare("SELECT status FROM users WHERE id = 'rejected'").get().status,
    "rejected"
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM users WHERE status = 'active'").get()
      .n,
    0
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("additive upgrade preserves all previous business rows and relationships", (t) => {
  const db = database(t);
  apply(db, "0000_initial.sql");
  db.exec(`
    INSERT INTO sales_force (id, name) VALUES ('sf', 'Staff');
    INSERT INTO outlets (id, name) VALUES ('outlet', 'Outlet');
    INSERT INTO products (id, name) VALUES ('product', 'Product');
    INSERT INTO visits (id, outlet_id, sales_force_id, visited_at, submission_channel)
      VALUES ('visit', 'outlet', 'sf', 1000, 'web');
    INSERT INTO stock_reports (id, outlet_id, reporter_sales_force_id, visit_id, reported_at, submission_channel)
      VALUES ('report', 'outlet', 'sf', 'visit', 2000, 'telegram');
    INSERT INTO stock_report_items VALUES ('report', 'product', 7);
  `);
  const tables = [
    "sales_force",
    "outlets",
    "products",
    "visits",
    "stock_reports",
    "stock_report_items",
  ];
  const before = tables.map((table) =>
    db.prepare(`SELECT * FROM ${table}`).all()
  );
  apply(db, "0001_identity_foundation.sql");
  assert.deepEqual(
    tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all()),
    before
  );
  user(db, "linked", "active", "sales_force", "sf");
  telegram(db, "linked", "123");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});
