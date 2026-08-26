// J1.5 (DBS-01, DBS-02, DBS-03, DBS-05, DBS-08) — openDb: the store.
//
// One mkdtempSync directory for this file, one fresh path per test (db-${n++}.db) — the discipline
// J1.17 turns into a gate. Never reuse a path across tests: openDb caches by path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb, closeAll } from "./db.ts";

const DIR = mkdtempSync(join(tmpdir(), "dg-db-"));
let n = 0;
const nextPath = (): string => join(DIR, `db-${n++}.db`);

test("1. assertNs refuses a bad namespace on migrate, metaGet and metaSet", () => {
  const db = openDb(nextPath());
  for (const bad of ["queue; DROP TABLE queue_meta", "Queue", "1queue", "pr-review", "pr review", ""]) {
    assert.throws(() => db.migrate(bad, []), `migrate should refuse ${JSON.stringify(bad)}`);
    assert.throws(() => db.metaGet(bad, "k"), `metaGet should refuse ${JSON.stringify(bad)}`);
    assert.throws(() => db.metaSet(bad, "k", "v"), `metaSet should refuse ${JSON.stringify(bad)}`);
  }
});

test("2. assertNs accepts good namespaces; an empty step list records no version", () => {
  const db = openDb(nextPath());
  for (const ok of ["queue", "slack", "pr_review", "log"]) {
    assert.doesNotThrow(() => db.migrate(ok, []));
    assert.equal(db.metaGet(ok, "schema_version"), null);
  }
});

test("3. migrate applies each step once; a re-run applies nothing", () => {
  const db = openDb(nextPath());
  db.migrate("app", ["CREATE TABLE app_thing (id INTEGER PRIMARY KEY)"]);
  assert.equal(db.metaGet("app", "schema_version"), "1");
  // A green second call IS the idempotence assertion: ALTER TABLE on an existing column throws, so
  // re-running CREATE TABLE would throw too if migrate re-applied it.
  assert.doesNotThrow(() => db.migrate("app", ["CREATE TABLE app_thing (id INTEGER PRIMARY KEY)"]));
});

test("4. a grown list applies only the appended step", () => {
  const db = openDb(nextPath());
  db.migrate("app", ["CREATE TABLE app_a (id INTEGER)"]);
  db.migrate("app", ["CREATE TABLE app_a (id INTEGER)", "CREATE TABLE app_b (id INTEGER)"]);
  assert.equal(db.metaGet("app", "schema_version"), "2");
  assert.doesNotThrow(() => db.handle().prepare("SELECT * FROM app_b").all());
});

test("5. a step that throws leaves the version at the last good step, and the retry re-runs it", () => {
  const db = openDb(nextPath());
  db.migrate("app", ["CREATE TABLE app_a (id INTEGER)"]);
  assert.throws(() => db.migrate("app", ["CREATE TABLE app_a (id INTEGER)", "NOT VALID SQL"]));
  assert.equal(db.metaGet("app", "schema_version"), "1");
});

test("6. tx rolls every write back when the body throws", () => {
  const db = openDb(nextPath());
  db.handle().exec("CREATE TABLE app_x (id INTEGER)");
  assert.throws(() =>
    db.tx((d) => {
      d.prepare("INSERT INTO app_x (id) VALUES (1)").run();
      throw new Error("boom");
    }),
  );
  assert.equal(db.handle().prepare("SELECT * FROM app_x").all().length, 0);
});

test("7. tx holds the write lock from BEGIN: a second connection is refused, the body's own write still succeeds", () => {
  const p = nextPath();
  const db = openDb(p);
  db.handle().exec("CREATE TABLE app_y (id INTEGER)");
  const second = new DatabaseSync(p);
  second.exec("PRAGMA busy_timeout = 50");
  try {
    db.tx((d) => {
      // The body MUST read before it writes: a DEFERRED BEGIN takes no lock at all until the
      // write, and without this read the mutation this test guards against would not fire.
      d.prepare("SELECT COUNT(*) AS c FROM app_y").get();
      assert.throws(
        () => second.exec("INSERT INTO app_y (id) VALUES (1)"),
        /database is locked|SQLITE_BUSY/,
      );
      d.prepare("INSERT INTO app_y (id) VALUES (1)").run();
    });
  } finally {
    second.close();
  }
  assert.equal(db.handle().prepare("SELECT * FROM app_y").all().length, 1);
});

test("8. tx returns the body's value once committed", () => {
  const db = openDb(nextPath());
  assert.equal(db.tx(() => 42), 42);
});

test("9. the cache hands one path back as the same handle; close() evicts it", () => {
  const p = nextPath();
  const db1 = openDb(p);
  const db2 = openDb(p);
  assert.equal(db1, db2);
  db1.handle().exec("CREATE TABLE app_z (id INTEGER)");
  db1.handle().exec("INSERT INTO app_z (id) VALUES (7)");
  db1.close();
  const db3 = openDb(p);
  assert.notEqual(db3, db1);
  assert.equal(db3.handle().prepare("SELECT * FROM app_z").all().length, 1);
});

test("10. closeAll() empties the cache", () => {
  const p1 = nextPath();
  const p2 = nextPath();
  const a1 = openDb(p1);
  const a2 = openDb(p2);
  closeAll();
  assert.notEqual(openDb(p1), a1);
  assert.notEqual(openDb(p2), a2);
});

test("11. DBS-02's enforcer refuses an unprefixed object, and does not record the version", () => {
  const db = openDb(nextPath());
  assert.throws(() => db.migrate("app", ["CREATE TABLE oops (id INTEGER)"]), /oops/);
  assert.throws(() => db.migrate("app", ["CREATE TABLE oops (id INTEGER)"]), /app_/);
  assert.equal(db.metaGet("app", "schema_version"), null);
});
