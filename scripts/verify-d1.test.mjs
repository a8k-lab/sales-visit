import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

test("D1 verification reports assignment counts, DDL, indexes and FKs without writes or identity values", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const migrations = new URL("../packages/db/migrations/", import.meta.url);
    db.exec(
      "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)"
    );
    for (const file of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .toSorted()) {
      db.exec(readFileSync(new URL(file, migrations), "utf8"));
      db.prepare(
        "INSERT INTO d1_migrations (name, applied_at) VALUES (?, 'synthetic')"
      ).run(file);
    }
    db.exec(`
      INSERT INTO sales_force (id, name) VALUES ('private-sf', 'Private staff name');
      INSERT INTO users (id, status, role) VALUES ('private-admin', 'active', 'admin'), ('private-supervisor', 'active', 'supervisor');
      INSERT INTO sales_force_supervisors (sales_force_id, supervisor_user_id) VALUES ('private-sf', 'private-supervisor');
      INSERT INTO supervisor_assignment_audit (id, actor_user_id, sales_force_id, new_supervisor_user_id, action)
        VALUES ('private-event', 'private-admin', 'private-sf', 'private-supervisor', 'assign');
      PRAGMA query_only = ON;
    `);
    // Execute the actual operator file with writes prohibited by SQLite.
    const sql = readFileSync(
      new URL("./verify-d1.sql", import.meta.url),
      "utf8"
    );
    const results = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => db.prepare(statement).all());
    const rows = results.flat();
    for (const resource of [
      "sales_force_supervisors",
      "supervisor_assignment_audit",
    ]) {
      assert.equal(rows.find((row) => row.resource === resource).records, 1);
      assert.ok(
        rows.some(
          (row) => row.name === resource && row.sql?.startsWith("CREATE TABLE")
        )
      );
    }
    for (const name of [
      "sales_force_supervisors_user_idx",
      "supervisor_assignment_audit_sf_idx",
    ]) {
      assert.ok(
        rows.some(
          (row) => row.name === name && row.sql?.startsWith("CREATE INDEX")
        )
      );
      assert.ok(rows.some((row) => row.name === name && row.origin === "c"));
    }
    assert.equal(rows.filter((row) => row.origin === "pk").length, 2);
    const fks = rows.filter((row) => "on_delete" in row);
    assert.equal(fks.length, 6);
    assert.ok(
      fks.every(
        (fk) => fk.on_delete === "RESTRICT" && fk.on_update === "RESTRICT"
      )
    );
    assert.deepEqual(fks.map((fk) => fk.from).toSorted(), [
      "actor_user_id",
      "new_supervisor_user_id",
      "previous_supervisor_user_id",
      "sales_force_id",
      "sales_force_id",
      "supervisor_user_id",
    ]);
    assert.deepEqual(results[2], [], "foreign_key_check must be empty");
    assert.doesNotMatch(
      JSON.stringify(results),
      /private-(sf|admin|supervisor|event)|Private staff name/
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM supervisor_assignment_audit").get()
        .n,
      1
    );
  } finally {
    db.close();
  }
});
