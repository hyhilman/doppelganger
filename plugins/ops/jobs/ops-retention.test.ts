// ops-retention (JOB-O06) against real SQLite files. Every case is about a row the sweep must
// leave alone, or about a dry run that must delete nothing and still count right.
//
// This file opens `node:sqlite` itself: a plugin test cannot reach kernel/runtime/db.ts (TST-03),
// and the sweep's SQL is only proven against a real store. The two tables below copy the DDL of
// kernel/runtime/lease.ts and kernel/runtime/log/tail.ts.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnvSpec } from "../../../kernel/plugin.ts";
import { sweep, type Fields, type RetentionDeps, type SqlHandle } from "./ops-retention.ts";

const DIR = mkdtempSync(join(tmpdir(), "ops-retention-"));
const opened: DatabaseSync[] = [];
after(() => {
  for (const d of opened) d.close();
  rmSync(DIR, { recursive: true, force: true });
});

const LEASE_DDL = `CREATE TABLE lease_claim (
  scope TEXT NOT NULL, key TEXT NOT NULL, owner TEXT NOT NULL, status TEXT NOT NULL,
  claimed_at TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL,
  max_attempts INTEGER NOT NULL, note TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (scope, key))`;
const CURSOR_DDL = `CREATE TABLE logtail_cursor (
  path TEXT PRIMARY KEY, inode TEXT NOT NULL, offset INTEGER NOT NULL, updated_at TEXT NOT NULL)`;

const NOW = Date.parse("2026-09-24T03:17:00Z");
const daysAgo = (d: number): string => new Date(NOW - d * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** One test's two stores, one file each, under this file's own temp directory. */
function stores(name: string, opts: { tables?: boolean } = {}) {
  const open = (store: string): DatabaseSync => {
    const d = new DatabaseSync(join(DIR, `${name}-${store}.db`));
    d.exec("PRAGMA journal_mode = WAL");
    opened.push(d);
    return d;
  };
  const lease = open("lease");
  const log = open("log");
  if (opts.tables ?? true) {
    lease.exec(LEASE_DDL);
    log.exec(CURSOR_DDL);
  }
  return { lease, log };
}

function seedLease(db: DatabaseSync, key: string, status: "held" | "done" | "failed", ageDays: number): void {
  const at = daysAgo(ageDays);
  db.prepare(
    `INSERT INTO lease_claim VALUES ('job', ?, 'default:box:4026531836:41277:9f2c1a0b', ?, ?, ?, 1, 3, NULL, ?)`,
  ).run(key, status, at, at, at);
}

function seedCursor(db: DatabaseSync, path: string, ageDays: number): void {
  db.prepare("INSERT INTO logtail_cursor VALUES (?, '5243014', 1187, ?)").run(path, daysAgo(ageDays));
}

const keys = (db: DatabaseSync): string[] =>
  (db.prepare("SELECT key FROM lease_claim ORDER BY key").all() as { key: string }[]).map((r) => r.key);
const paths = (db: DatabaseSync): string[] =>
  (db.prepare("SELECT path FROM logtail_cursor ORDER BY path").all() as { path: string }[]).map((r) => r.path);

interface Rec {
  readonly level: string;
  readonly event: string;
  readonly fields: Fields;
}

function deps(s: { lease: DatabaseSync; log: DatabaseSync }, env: Record<string, string> = {}) {
  const logs: Rec[] = [];
  const execs: string[] = [];
  const at = (level: string) => (event: string, fields: Fields = {}) => {
    logs.push({ level, event, fields });
  };
  const envOf = (spec: EnvSpec): string => env[spec.key] ?? spec.default!;
  const spy = (name: string, d: DatabaseSync): SqlHandle => ({
    prepare: (sql) => d.prepare(sql),
    exec: (sql) => {
      execs.push(`${name}: ${sql}`);
      d.exec(sql);
    },
  });
  const byName: Record<string, SqlHandle> = { lease: spy("lease", s.lease), log: spy("log", s.log) };
  const d: RetentionDeps = {
    log: { info: at("info"), error: at("error") },
    env: { str: envOf, num: (spec) => Number(envOf(spec)) },
    now: () => new Date(NOW),
    db: (name) => {
      const h = byName[name];
      assert.ok(h, `unknown store ${name}`);
      return h;
    },
  };
  return { deps: d, logs, execs };
}

/** Ages straddle the 60-day default. 400 days is for rows that must survive at ANY age, so their
 *  survival cannot be read as youth. */
function seedAll(s: { lease: DatabaseSync; log: DatabaseSync }, name: string): { live: string; dead: string; blocked: string } {
  seedLease(s.lease, "nightly-sandcastle@2025-08-20T16", "held", 400);
  seedLease(s.lease, "nightly-sandcastle@2026-09-23T16", "done", 1);
  seedLease(s.lease, "nightly-sandcastle@2026-08-25T17", "done", 30);
  seedLease(s.lease, "nightly-sandcastle@2026-06-26T16", "done", 90);
  seedLease(s.lease, "ops-cron-check@2026-06-26T06", "failed", 90);
  const live = join(DIR, `${name}-nightly-sandcastle.log`);
  writeFileSync(live, "");
  // A path under a plain FILE: stat fails with ENOTDIR, not ENOENT, so the sweep is unsure.
  const blocked = join(live, "x.log");
  const dead = join(DIR, `${name}-slack-fetch.log`);
  seedCursor(s.log, live, 400);
  seedCursor(s.log, dead, 1);
  seedCursor(s.log, blocked, 400);
  return { live, dead, blocked };
}

test("the real sweep: terminal leases past 60 days go, held and recent stay; only a cursor whose file is gone goes", () => {
  const s = stores("real");
  const { live, blocked } = seedAll(s, "real");
  const { deps: d, logs, execs } = deps(s);

  const out = sweep(d);

  assert.deepEqual(keys(s.lease), [
    "nightly-sandcastle@2025-08-20T16", // held, 400 days: somebody's lock at any age
    "nightly-sandcastle@2026-08-25T17", // done, 30 days: inside the horizon
    "nightly-sandcastle@2026-09-23T16", // done, 1 day
  ]);
  assert.deepEqual(paths(s.log), [live, blocked].sort(), "a live cursor stays however old; an unsure one stays too");
  assert.deepEqual(out, { leaseRows: 2, leaseDays: 60, deadCursors: 1, dryRun: false });
  assert.deepEqual(logs, [{ level: "info", event: "swept", fields: { leaseRows: 2, leaseDays: 60, deadCursors: 1, dryRun: 0 } }]);
  assert.deepEqual(execs, ["lease: PRAGMA wal_checkpoint(TRUNCATE)", "log: PRAGMA wal_checkpoint(TRUNCATE)"]);
});

test("the horizon is RETENTION_LEASE_DAYS", () => {
  const s = stores("horizon");
  seedAll(s, "horizon");
  const { deps: d } = deps(s, { RETENTION_LEASE_DAYS: "20" });
  assert.equal(sweep(d).leaseRows, 3);
  assert.deepEqual(keys(s.lease), ["nightly-sandcastle@2025-08-20T16", "nightly-sandcastle@2026-09-23T16"]);
});

test("dry run: the same counts as the real sweep, nothing deleted, no checkpoint", () => {
  const s = stores("dry");
  seedAll(s, "dry");
  const before = { leases: keys(s.lease), cursors: paths(s.log) };
  const { deps: d, logs, execs } = deps(s, { RETENTION_DRY_RUN: "1" });

  const out = sweep(d);

  assert.deepEqual(out, { leaseRows: 2, leaseDays: 60, deadCursors: 1, dryRun: true }, "a dry run that counts 0 describes nothing");
  assert.deepEqual({ leases: keys(s.lease), cursors: paths(s.log) }, before);
  assert.deepEqual(execs, [], "a checkpoint is a write");
  assert.deepEqual(logs, [
    { level: "info", event: "dry-run", fields: { msg: "counting only, nothing is deleted" } },
    { level: "info", event: "swept", fields: { leaseRows: 2, leaseDays: 60, deadCursors: 1, dryRun: 1 } },
  ]);
});

test("a fresh host with no tables: zero counts, no crash", () => {
  const s = stores("fresh", { tables: false });
  const { deps: d, logs } = deps(s);
  assert.deepEqual(sweep(d), { leaseRows: 0, leaseDays: 60, deadCursors: 0, dryRun: false });
  assert.equal(logs.at(-1)!.event, "swept");
});

test("a store that will not open: error job-failed, the run fails, no swept line", () => {
  const s = stores("broken");
  const { deps: base, logs } = deps(s);
  const d: RetentionDeps = {
    ...base,
    db: () => {
      throw new Error("database is locked: /x/lease.db waited=5002ms");
    },
  };
  assert.throws(() => sweep(d), /database is locked/);
  assert.deepEqual(logs, [{ level: "error", event: "job-failed", fields: { msg: "database is locked: /x/lease.db waited=5002ms" } }]);
});
