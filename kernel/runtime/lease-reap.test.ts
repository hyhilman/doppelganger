// reapDead's guard table. Every assertion here is about a SKIP, except
// test 1 — which is the one row every other test proves does NOT apply.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAll, type Db } from "./db.ts";
import { INSTANCE } from "../instance.ts";
import { pidNamespace, realReaders, type ProcReaders } from "./proc.ts";
import { leaseDb, read, reapDead, clear, REAP_GRACE_MS, type LeaseStatus } from "./lease.ts";

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "lease-reap-test-"));
  process.env.LEASE_DB = join(dir, "lease.db");
});

after(() => {
  closeAll();
  delete process.env.LEASE_DB;
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function fresh(): { scope: string; key: string } {
  counter++;
  return { scope: `reap-scope-${counter}`, key: `k${counter}` };
}

interface SeedOpts {
  readonly owner: string;
  readonly status?: LeaseStatus;
  readonly claimedAt?: string;
  readonly expiresAt?: string;
  readonly attempts?: number;
  readonly maxAttempts?: number;
}

/** Writes a row directly, bypassing acquire()'s own owner generation — the guard-table tests need
 *  full control over the owner string, the status, and both timestamps, which acquire()'s public
 *  surface deliberately does not expose (LSE-06's owner is always fresh in production). */
function seed(scope: string, key: string, opts: SeedOpts): void {
  const db: Db = leaseDb();
  const claimedAt = opts.claimedAt ?? new Date().toISOString();
  const expiresAt = opts.expiresAt ?? new Date(Date.now() + 3_600_000).toISOString();
  db.handle()
    .prepare(
      `INSERT INTO lease_claim (scope, key, owner, status, claimed_at, expires_at, attempts, max_attempts, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(scope, key) DO UPDATE SET
         owner = excluded.owner, status = excluded.status, claimed_at = excluded.claimed_at,
         expires_at = excluded.expires_at, attempts = excluded.attempts, max_attempts = excluded.max_attempts,
         updated_at = excluded.updated_at`,
    )
    .run(scope, key, opts.owner, opts.status ?? "held", claimedAt, expiresAt, opts.attempts ?? 1, opts.maxAttempts ?? 3, claimedAt);
}

/** A real pid that ran and exited — a genuinely dead owner, not a number chosen to look dead. */
function deadPid(): number {
  const r = spawnSync("/bin/sh", ["-c", "echo $$"], { encoding: "utf8" });
  return Number(r.stdout.trim());
}

const NS = pidNamespace()!;
const HOST = hostname();
const OLD_ENOUGH = new Date(Date.now() - REAP_GRACE_MS - 5_000).toISOString();
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

const owner = (instance: string, host: string, pidns: string, pid: number): string => `${instance}:${host}:${pidns}:${pid}:aaaaaaaa`;

test("1. reaps a live-but-orphaned claim and reports the TTL it cut short", () => {
  const { scope, key } = fresh();
  const pid = deadPid();
  seed(scope, key, { owner: owner(INSTANCE, HOST, NS, pid), claimedAt: OLD_ENOUGH, expiresAt: FUTURE });

  const reaped = reapDead();
  const row = reaped.find((r) => r.scope === scope && r.key === key);
  assert.ok(row, "expected the row to be reaped");
  assert.ok(row!.ttlLeftMin > 0, `expected ttlLeftMin > 0, got ${row!.ttlLeftMin}`);
  assert.equal(row!.pid, pid);
  assert.equal(read(scope, key), null, "the row must be GONE, not merely marked");
});

test("2. leaves a claim whose owner is still running", () => {
  const { scope, key } = fresh();
  // claimedAt is close to REAL now, not backdated — this process's actual OS start predates the
  // whole test run by only a fraction of a second, so backdating the claim past that (the way
  // every OTHER test's OLD_ENOUGH does) would make it look like a claim from BEFORE this process
  // existed, which correctly reads as "dead" (a recycled pid) and would prove nothing about this
  // guard. Guard 7's own age requirement is satisfied by pushing the SWEEP's `now` forward
  // instead, which is what opts.now exists for.
  const recentClaim = new Date().toISOString();
  seed(scope, key, { owner: owner(INSTANCE, HOST, NS, process.pid), claimedAt: recentClaim, expiresAt: FUTURE });

  const reaped = reapDead({ now: Date.now() + REAP_GRACE_MS + 5_000 });
  assert.equal(reaped.find((r) => r.scope === scope), undefined);
  assert.equal(read(scope, key)?.status, "held");
});

test("3. leaves a dead pid in ANOTHER pid namespace", () => {
  const { scope, key } = fresh();
  const pid = deadPid();
  const otherNs = String(Number(NS) + 1);
  seed(scope, key, { owner: owner(INSTANCE, HOST, otherNs, pid), claimedAt: OLD_ENOUGH, expiresAt: FUTURE });

  const reaped = reapDead();
  assert.equal(reaped.find((r) => r.scope === scope), undefined);
  assert.equal(read(scope, key)?.status, "held");
});

test("4. leaves a dead pid belonging to another host", () => {
  const { scope, key } = fresh();
  const pid = deadPid();
  seed(scope, key, { owner: owner(INSTANCE, "some-other-host", NS, pid), claimedAt: OLD_ENOUGH, expiresAt: FUTURE });

  const reaped = reapDead();
  assert.equal(reaped.find((r) => r.scope === scope), undefined);
  assert.equal(read(scope, key)?.status, "held");
});

test("5. leaves a dead pid belonging to another INSTANCE — guard 4, the row the reference cannot test", () => {
  const { scope, key } = fresh();
  const pid = deadPid();
  seed(scope, key, { owner: owner("some-other-instance", HOST, NS, pid), claimedAt: OLD_ENOUGH, expiresAt: FUTURE });

  const reaped = reapDead();
  assert.equal(reaped.find((r) => r.scope === scope), undefined);
  assert.equal(read(scope, key)?.status, "held");
});

test("6. LSE-08 — leaves a four-field (reference-shaped) owner to age out on its TTL", () => {
  const { scope, key } = fresh();
  seed(scope, key, { owner: `${HOST}:${NS}:1234:aaaaaaaa`, claimedAt: OLD_ENOUGH, expiresAt: FUTURE });

  const reaped = reapDead();
  assert.equal(reaped.find((r) => r.scope === scope), undefined);
  assert.equal(read(scope, key)?.status, "held");
});

test("7. leaves a claim younger than REAP_GRACE_MS", () => {
  const { scope, key } = fresh();
  const pid = deadPid();
  seed(scope, key, { owner: owner(INSTANCE, HOST, NS, pid), claimedAt: new Date().toISOString(), expiresAt: FUTURE });

  const reaped = reapDead();
  assert.equal(reaped.find((r) => r.scope === scope), undefined);
  assert.equal(read(scope, key)?.status, "held");
});

test("8. leaves an ALREADY-EXPIRED claim, so attempts keeps braking a crash loop", () => {
  const { scope, key } = fresh();
  const pid = deadPid();
  const pastExpiry = new Date(Date.now() - 1_000).toISOString();
  seed(scope, key, { owner: owner(INSTANCE, HOST, NS, pid), claimedAt: OLD_ENOUGH, expiresAt: pastExpiry, attempts: 1 });

  const reaped = reapDead();
  assert.equal(reaped.find((r) => r.scope === scope), undefined);
  const row = read(scope, key);
  assert.equal(row?.status, "held");
  assert.equal(row?.attempts, 1, "attempts must be untouched, not reset by a reap");
});

test("9. leaves terminal claims alone — done stays done, failed is not in the reaped set", () => {
  const done = fresh();
  const failed = fresh();
  const pid = deadPid();
  seed(done.scope, done.key, { owner: owner(INSTANCE, HOST, NS, pid), claimedAt: OLD_ENOUGH, expiresAt: FUTURE, status: "done" });
  seed(failed.scope, failed.key, { owner: owner(INSTANCE, HOST, NS, pid), claimedAt: OLD_ENOUGH, expiresAt: FUTURE, status: "failed" });

  const reaped = reapDead();
  assert.equal(reaped.find((r) => r.scope === done.scope || r.scope === failed.scope), undefined);
  assert.equal(read(done.scope, done.key)?.status, "done");
  assert.equal(read(failed.scope, failed.key)?.status, "failed");
});

test("10. returns [] when the namespace is unknowable", () => {
  const { scope, key } = fresh();
  const pid = deadPid();
  seed(scope, key, { owner: owner(INSTANCE, HOST, NS, pid), claimedAt: OLD_ENOUGH, expiresAt: FUTURE });

  const throwingReaders: ProcReaders = {
    ...realReaders,
    readNsLink: () => {
      throw new Error("no /proc here");
    },
  };
  const reaped = reapDead({ readers: throwingReaders });
  assert.deepEqual(reaped, []);
  assert.equal(read(scope, key)?.status, "held", "the table must be unchanged by count");
});

test('11. "unknown" liveness is not "dead" — a dead pid with readProcStat throwing EACCES survives', () => {
  const { scope, key } = fresh();
  const pid = deadPid();
  seed(scope, key, { owner: owner(INSTANCE, HOST, NS, pid), claimedAt: OLD_ENOUGH, expiresAt: FUTURE });

  const eaccesReaders: ProcReaders = {
    ...realReaders,
    readProcStat: () => {
      const e = new Error("EACCES") as NodeJS.ErrnoException;
      e.code = "EACCES";
      throw e;
    },
  };
  const reaped = reapDead({ readers: eaccesReaders });
  assert.equal(reaped.find((r) => r.scope === scope), undefined);
  assert.equal(read(scope, key)?.status, "held");
});

test("11b. a restricted /proc reaps nothing at all — a live claim cannot be force-deleted", () => {
  const { scope, key } = fresh();
  const pid = deadPid(); // genuinely dead — the real /proc raises ENOENT for it
  seed(scope, key, { owner: owner(INSTANCE, HOST, NS, pid), claimedAt: OLD_ENOUGH, expiresAt: FUTURE });

  const hidepidReaders: ProcReaders = {
    ...realReaders,
    readMountInfo: () => "25 29 0:23 / /proc rw,nosuid,nodev,noexec,relatime,hidepid=2 shared:12 - proc proc rw\n",
  };
  const reaped = reapDead({ readers: hidepidReaders });
  assert.deepEqual(
    reaped.filter((r) => r.scope === scope),
    [],
  );
  assert.equal(read(scope, key)?.status, "held");
});

test("12. the whole guard table as ONE grid — twelve rows, one sweep, exactly one reaped key", () => {
  const scope = `reap-grid-${++counter}`;
  const FAKE_NS = "555";
  const DEAD_PID = 9001;
  const ALIVE_PID = 9002;

  const fakeStat = (pid: number, ticks: string): string => `${pid} (x) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 20 0 1 0 0 ${ticks}`;
  const readers: ProcReaders = {
    readNsLink: () => `pid:[${FAKE_NS}]`,
    readBootStat: () => "btime 1000\n",
    readMountInfo: () => "25 29 0:23 / /proc rw,nosuid,nodev,noexec,relatime shared:12 - proc proc rw\n",
    readProcStat: (pid: number) => {
      if (pid === ALIVE_PID) return fakeStat(pid, "0"); // btime+0 -> always "alive" against any 2026 claim
      const e = new Error("ENOENT") as NodeJS.ErrnoException;
      e.code = "ENOENT";
      throw e;
    },
  };
  const own = (instance: string, host: string, pidns: string, pid: number): string => `${instance}:${host}:${pidns}:${pid}:bbbbbbbb`;

  const rows: Record<string, SeedOpts> = {
    reaped: { owner: own(INSTANCE, HOST, FAKE_NS, DEAD_PID), claimedAt: OLD_ENOUGH, expiresAt: FUTURE },
    alive_owner: { owner: own(INSTANCE, HOST, FAKE_NS, ALIVE_PID), claimedAt: OLD_ENOUGH, expiresAt: FUTURE },
    wrong_pidns: { owner: own(INSTANCE, HOST, "556", DEAD_PID), claimedAt: OLD_ENOUGH, expiresAt: FUTURE },
    wrong_host: { owner: own(INSTANCE, "other-host", FAKE_NS, DEAD_PID), claimedAt: OLD_ENOUGH, expiresAt: FUTURE },
    wrong_instance: { owner: own("other-instance", HOST, FAKE_NS, DEAD_PID), claimedAt: OLD_ENOUGH, expiresAt: FUTURE },
    bad_owner_shape: { owner: `${HOST}:${FAKE_NS}:${DEAD_PID}:bbbbbbbb`, claimedAt: OLD_ENOUGH, expiresAt: FUTURE },
    too_young: { owner: own(INSTANCE, HOST, FAKE_NS, DEAD_PID), claimedAt: new Date().toISOString(), expiresAt: FUTURE },
    expired: { owner: own(INSTANCE, HOST, FAKE_NS, DEAD_PID), claimedAt: OLD_ENOUGH, expiresAt: new Date(Date.now() - 1_000).toISOString() },
    status_done: { owner: own(INSTANCE, HOST, FAKE_NS, DEAD_PID), claimedAt: OLD_ENOUGH, expiresAt: FUTURE, status: "done" },
    status_failed: { owner: own(INSTANCE, HOST, FAKE_NS, DEAD_PID), claimedAt: OLD_ENOUGH, expiresAt: FUTURE, status: "failed" },
    unparseable_expires: { owner: own(INSTANCE, HOST, FAKE_NS, DEAD_PID), claimedAt: OLD_ENOUGH, expiresAt: "garbage" },
    unparseable_claimed: { owner: own(INSTANCE, HOST, FAKE_NS, DEAD_PID), claimedAt: "garbage", expiresAt: FUTURE },
  };

  const keys: Record<string, string> = {};
  for (const name of Object.keys(rows)) {
    keys[name] = `grid-${name}`;
    seed(scope, keys[name]!, rows[name]!);
  }

  const reaped = reapDead({ readers });
  const reapedKeysInScope = reaped.filter((r) => r.scope === scope).map((r) => r.key);
  assert.deepEqual(reapedKeysInScope, [keys.reaped]);

  // Every OTHER row survives.
  for (const name of Object.keys(rows)) {
    if (name === "reaped") continue;
    assert.ok(read(scope, keys[name]!), `expected ${name} to survive the sweep`);
  }
  assert.equal(read(scope, keys.reaped!), null);
});

// ---------------------------------------------------------------------------------------------
// Guard 0 and guard 9 have no caller-visible row in the grid above — guard 0 is a SWEEP-wide
// short-circuit (computed once, before the per-row loop even starts), not a per-row condition,
// and guard 9 needs a genuine race to exercise at all. Each gets its own test, same seam.
// ---------------------------------------------------------------------------------------------

test("13. guard 0 — pidNamespace() === null stops the sweep BEFORE the lease store is ever opened", () => {
  // Guard 5 (id.pidns !== ns) would ALSO skip every row once ns is null, since a real owner's
  // pidns is always a non-empty digit string and can never equal the literal value null — so the
  // REAPED SET alone cannot distinguish "guard 0 returned early" from "guard 0 was removed and
  // guard 5 caught every row anyway". The one channel that can: guard 0 returns before `list()`
  // ever runs, so the lease store is never opened. Point LEASE_DB at a path whose PARENT is a
  // plain file, not a directory — openDb's mkdirSync then throws ENOTDIR the instant anything
  // tries to open it. Guard 0 present: no throw, because the store is never touched. Guard 0
  // removed: reapDead proceeds to list() and the open throws.
  const blockDir = mkdtempSync(join(tmpdir(), "lease-reap-guard0-"));
  writeFileSync(join(blockDir, "blocker"), "x");
  const prevLeaseDb = process.env.LEASE_DB;
  process.env.LEASE_DB = join(blockDir, "blocker", "lease.db");
  const nsUnknownReaders: ProcReaders = {
    ...realReaders,
    readNsLink: () => {
      throw new Error("no /proc here");
    },
  };
  try {
    let result: unknown[] | undefined;
    assert.doesNotThrow(() => {
      result = reapDead({ readers: nsUnknownReaders });
    }, "guard 0 must return before the lease store — an unopenable path here — is ever touched");
    assert.deepEqual(result, []);
  } finally {
    if (prevLeaseDb === undefined) delete process.env.LEASE_DB;
    else process.env.LEASE_DB = prevLeaseDb;
    rmSync(blockDir, { recursive: true, force: true });
  }
});

test("14. guard 9 — a row deleted by another process between the liveness check and this sweep's own clear() is never reported as reaped", () => {
  const { scope, key } = fresh();
  const pid = deadPid();
  seed(scope, key, { owner: owner(INSTANCE, HOST, NS, pid), claimedAt: OLD_ENOUGH, expiresAt: FUTURE });

  // Simulate the race guard 9 exists for: something else clears this exact row WHILE this sweep
  // is still deciding to reap it — right inside the one reader call ownerLiveness makes for a
  // genuinely-dead pid, i.e. strictly BEFORE reapDead reaches its own clear() call below.
  const racingReaders: ProcReaders = {
    ...realReaders,
    readProcStat: (p: number) => {
      clear(scope, key, { force: true }); // the racer wins first
      return realReaders.readProcStat(p); // still resolves genuinely dead (ENOENT) -> passes guard 8
    },
  };
  const reaped = reapDead({ readers: racingReaders });
  assert.equal(
    reaped.find((r) => r.scope === scope),
    undefined,
    "a row already gone before this sweep's own clear() must not be reported as reaped",
  );
  assert.equal(read(scope, key), null, "the row is gone either way — the racer's delete stands");
});
