// J1.5/J1.6 (DBS-01, DBS-02, DBS-03, DBS-04, DBS-05, DBS-06, DBS-08) — openDb: the store, plus the
// busy-context proxy that reports SQLITE_BUSY with the file, the statement and the wait.
//
// One mkdtempSync directory for this file, one fresh path per test (db-${n++}.db) — the discipline
// J1.17 turns into a gate. Never reuse a path across tests: openDb caches by path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb, closeAll, withBusyContext } from "./db.ts";

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

// ---------------------------------------------------------------------------------------------
// J1.6 (DBS-04, DBS-06) — the busy-context proxy.
// ---------------------------------------------------------------------------------------------
//
// A real second `DatabaseSync` holding BEGIN IMMEDIATE is the hog: it takes the WAL write lock and
// holds it for the whole call under test, released in a `finally` AFTER the assertion — no race, no
// timing dependency. `seedBusyDb` sets a small busy_timeout (100ms) on the victim connection so
// these tests resolve fast; assertions 19 and 20 below override it deliberately.

function seedBusyDb(path: string, busyTimeoutMs = 100): ReturnType<typeof openDb> {
  const db = openDb(path);
  db.handle().exec("CREATE TABLE t_busy (id INTEGER PRIMARY KEY, v TEXT)");
  db.handle().exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  return db;
}

function withHog<T>(path: string, action: () => T): T {
  const hog = new DatabaseSync(path);
  hog.exec("BEGIN IMMEDIATE");
  hog.prepare("INSERT INTO t_busy (v) VALUES ('hog')").run();
  try {
    return action();
  } finally {
    hog.exec("ROLLBACK");
    hog.close();
  }
}

function busyMessage(e: unknown, path: string, sqlFragment: string): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes(path) && msg.includes(sqlFragment) && /waited=\d+ms/.test(msg);
}

test("12. a contended prepared run() names the file and the statement", () => {
  const p = nextPath();
  const db = seedBusyDb(p);
  withHog(p, () => {
    assert.throws(
      () => db.handle().prepare("INSERT INTO t_busy (v) VALUES ('x')").run(),
      (e: unknown) => busyMessage(e, p, "INSERT INTO t_busy"),
    );
  });
});

test("13. a contended get() reports the same way", () => {
  const p = nextPath();
  const db = seedBusyDb(p);
  withHog(p, () => {
    assert.throws(
      () => db.handle().prepare("INSERT INTO t_busy (v) VALUES ('y') RETURNING id").get(),
      (e: unknown) => busyMessage(e, p, "INSERT INTO t_busy"),
    );
  });
});

test("14. a contended all() reports the same way", () => {
  const p = nextPath();
  const db = seedBusyDb(p);
  withHog(p, () => {
    assert.throws(
      () => db.handle().prepare("INSERT INTO t_busy (v) VALUES ('z') RETURNING id").all(),
      (e: unknown) => busyMessage(e, p, "INSERT INTO t_busy"),
    );
  });
});

test("15. a contended iterate() reports from the loop, not from iterate() itself", () => {
  const p = nextPath();
  const db = seedBusyDb(p);
  withHog(p, () => {
    const stmt = db.handle().prepare("INSERT INTO t_busy (v) VALUES ('i') RETURNING id");
    // Must not throw here — measured, iterate() returns the iterator without throwing.
    const it = stmt.iterate();
    assert.throws(() => {
      for (const _row of it) {
        // never reached — the refusal lands on the first next()
      }
    }, (e: unknown) => busyMessage(e, p, "INSERT INTO t_busy"));
  });
});

test("15b. a plain SELECT through iterate() completes with no error under the same hog", () => {
  const p = nextPath();
  const db = seedBusyDb(p);
  db.handle().prepare("INSERT INTO t_busy (v) VALUES ('seed')").run();
  withHog(p, () => {
    const rows = [...db.handle().prepare("SELECT * FROM t_busy").iterate()];
    assert.ok(rows.length >= 1, "a WAL reader is never blocked by a writer");
  });
});

test("16. a contended exec() reports", () => {
  const p = nextPath();
  const db = seedBusyDb(p);
  withHog(p, () => {
    assert.throws(
      () => db.handle().exec("INSERT INTO t_busy (v) VALUES ('e')"),
      (e: unknown) => busyMessage(e, p, "INSERT INTO t_busy"),
    );
  });
});

test("17. a contended tx() reports and names BEGIN IMMEDIATE — the body never runs", () => {
  const p = nextPath();
  const db = seedBusyDb(p);
  let ran = false;
  withHog(p, () => {
    assert.throws(
      () =>
        db.tx(() => {
          ran = true;
        }),
      (e: unknown) => busyMessage(e, p, "BEGIN IMMEDIATE"),
    );
  });
  assert.equal(ran, false);
});

test("18. waited= is >= 180ms with busy_timeout = 200 — the full-wait shape", () => {
  const p = nextPath();
  const db = seedBusyDb(p, 200);
  withHog(p, () => {
    assert.throws(
      () => db.handle().exec("INSERT INTO t_busy (v) VALUES ('slow')"),
      (e: unknown) => {
        const m = /waited=(\d+)ms/.exec(e instanceof Error ? e.message : String(e));
        return m != null && Number(m[1]) >= 180;
      },
    );
  });
});

test("19. waited= is < 50ms for a refused-outright upgrade, busy_timeout left at its default", () => {
  const p = nextPath();
  const db = seedBusyDb(p); // default busy_timeout (5000ms) — unchanged, and still near-zero
  const h = db.handle();
  h.exec("BEGIN"); // DEFERRED — takes no lock yet
  h.prepare("SELECT COUNT(*) AS c FROM t_busy").get(); // a read snapshot

  const other = new DatabaseSync(p);
  other.exec("INSERT INTO t_busy (v) VALUES ('intervening')"); // an intervening commit
  other.close();

  let waited = -1;
  assert.throws(
    () => h.exec("INSERT INTO t_busy (v) VALUES ('upgrade')"), // refused outright, not waited-out
    (e: unknown) => {
      const m = /waited=(\d+)ms/.exec(e instanceof Error ? e.message : String(e));
      waited = m ? Number(m[1]) : -1;
      return m != null && Number(m[1]) < 50;
    },
  );
  h.exec("ROLLBACK");
  assert.ok(waited >= 0 && waited < 50, `expected a near-zero refusal, got waited=${waited}ms`);
});

test("20. withBusyContext calls its function exactly once — no retry (DBS-04)", () => {
  let calls = 0;
  assert.throws(() =>
    withBusyContext("/p", "SQL", () => {
      calls++;
      throw new Error("database is locked");
    }),
  );
  assert.equal(calls, 1, "DBS-04: the wrapper must not retry — the wait is the discriminator");
});

test("21. PRAGMA busy_timeout reads back unchanged after a busy throw (does NOT raise the timeout)", () => {
  const p = nextPath();
  const db = seedBusyDb(p, 100);
  withHog(p, () => {
    assert.throws(() => db.handle().exec("INSERT INTO t_busy (v) VALUES ('x')"));
  });
  const row = db.handle().prepare("PRAGMA busy_timeout").get() as { timeout: number };
  assert.equal(row.timeout, 100);
});

test("22. sql= is one line and at most 160 characters, given a 400-character multi-line statement", () => {
  const longSql = `SELECT 1\n${"x".repeat(400)}\ny`;
  assert.throws(
    () =>
      withBusyContext("/p", longSql, () => {
        throw new Error("database is locked");
      }),
    (e: unknown) => {
      const m = /sql=(".*")$/.exec(e instanceof Error ? e.message : String(e));
      if (!m) return false;
      const sql = JSON.parse(m[1]) as string;
      return !sql.includes("\n") && sql.length <= 160;
    },
  );
});

test("23. the driver's error is kept as cause", () => {
  const original = new Error("database is locked");
  assert.throws(
    () =>
      withBusyContext("/p", "SQL", () => {
        throw original;
      }),
    (e: unknown) => (e as Error).cause === original,
  );
});

test("24. the uncontended path is untouched, and null-prototype rows are preserved", () => {
  const db = openDb(nextPath());
  db.handle().exec("CREATE TABLE app_u (id INTEGER PRIMARY KEY, v TEXT)");
  db.handle().prepare("INSERT INTO app_u (v) VALUES (?)").run("hi");
  const rows = db.handle().prepare("SELECT * FROM app_u").all() as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.v, "hi");
  assert.equal(Object.getPrototypeOf(rows[0]), null);
});

// Measured on Node 22.23.1. If a Node upgrade adds a member to StatementSync or DatabaseSync, one
// of the next two assertions goes red FIRST, and a human decides whether the new member executes
// SQL and needs wrapping — this can only happen in a commit that also bumps .nvmrc.
const STATEMENT_SYNC_MEMBERS = [
  "all",
  "columns",
  "constructor",
  "get",
  "iterate",
  "run",
  "setAllowBareNamedParameters",
  "setAllowUnknownNamedParameters",
  "setReadBigInts",
  "setReturnArrays",
].sort();

const DATABASE_SYNC_MEMBERS = [
  "aggregate",
  "applyChangeset",
  "close",
  "constructor",
  "createSession",
  "enableLoadExtension",
  "exec",
  "function",
  "loadExtension",
  "location",
  "open",
  "prepare",
].sort();

test("25. StatementSync's member list equals the pinned literal list", () => {
  const db = openDb(nextPath());
  db.handle().exec("CREATE TABLE app_stmt (id INTEGER)");
  const stmt = db.handle().prepare("SELECT * FROM app_stmt");
  // Object.getPrototypeOf on our Proxy forwards to the real target, so this reads the ACTUAL
  // StatementSync prototype, not a proxy trap's idea of one.
  const names = Object.getOwnPropertyNames(Object.getPrototypeOf(stmt)).sort();
  assert.deepEqual(names, STATEMENT_SYNC_MEMBERS);
});

test("26. DatabaseSync's member list equals the pinned literal list, and applyChangeset is unused", () => {
  const db = openDb(nextPath());
  const names = Object.getOwnPropertyNames(Object.getPrototypeOf(db.handle())).sort();
  assert.deepEqual(names, DATABASE_SYNC_MEMBERS);

  // Scoped to non-test files under kernel/: this very file's pinned literal above contains the
  // word "applyChangeset", so an unscoped search would fail on its own text.
  const kernelRoot = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
        if (readFileSync(full, "utf8").includes("applyChangeset")) offenders.push(full);
      }
    }
  };
  walk(kernelRoot);
  assert.deepEqual(offenders, []);
});
