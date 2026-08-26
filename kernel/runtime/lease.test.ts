// J4.3 (LSE-01, LSE-02, LSE-04, LSE-05, LSE-06, INS-04) — the mutex, the owner, the attempts brake.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAll } from "./db.ts";
import { INSTANCE } from "../instance.ts";
import { acquire, release, clear, read, list, parseOwner, type Lease } from "./lease.ts";

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "lease-test-"));
  process.env.LEASE_DB = join(dir, "lease.db");
});

after(() => {
  closeAll();
  delete process.env.LEASE_DB;
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
/** A fresh scope/key pair per test, so tests never collide inside the one shared temp store. */
function fresh(): { scope: string; key: string } {
  counter++;
  return { scope: `test-scope-${counter}`, key: `k${counter}` };
}

test("1. acquire on a free key succeeds; a second acquire while live is refused held", () => {
  const { scope, key } = fresh();
  const first = acquire(scope, key);
  assert.equal(first.ok, true);

  const second = acquire(scope, key);
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.reason, "held");
    assert.equal(second.current?.status, "held");
  }
});

test("2. the window is the only thing that makes a claim stealable", async () => {
  const { scope, key } = fresh();
  const first = acquire(scope, key, { ttlMs: 1 });
  assert.equal(first.ok, true);
  await new Promise((r) => setTimeout(r, 20));
  const second = acquire(scope, key, { ttlMs: 1 });
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.lease.attempts, 2);
});

test("3. LSE-02 — done is terminal at any horizon", () => {
  const { scope, key } = fresh();
  // The FIRST acquire's own ttlMs is what the stored row's expires_at carries forward through
  // release("done") — done leaves it untouched. Using a far-past ttlMs here means the row is
  // ALREADY expired by the time reacquire runs, so an expiry check alone could never explain a
  // refusal: only the terminal status can. Without this, a merely-future expires_at would mask a
  // missing status check (a WHERE clause that dropped `status <> 'done'` would still be blocked by
  // the expiry alone, and this test would pass for the wrong reason).
  const got = acquire(scope, key, { ttlMs: -10_000_000 });
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(release(got.lease, "done"), true);

  const reacquire = acquire(scope, key);
  assert.equal(reacquire.ok, false);
  if (!reacquire.ok) assert.equal(reacquire.reason, "done");
});

test("4. LSE-05 — the attempts brake, distinct from held", async () => {
  const { scope, key } = fresh();
  const first = acquire(scope, key, { ttlMs: 1, maxAttempts: 2 });
  assert.equal(first.ok, true);
  await new Promise((r) => setTimeout(r, 20));
  const second = acquire(scope, key, { ttlMs: 1, maxAttempts: 2 });
  assert.equal(second.ok, true);
  await new Promise((r) => setTimeout(r, 20));
  const third = acquire(scope, key, { ttlMs: 1, maxAttempts: 2 });
  assert.equal(third.ok, false);
  if (!third.ok) {
    assert.equal(third.reason, "exhausted");
    assert.equal(third.current?.maxAttempts, 2);
  }
});

test("5. an unexpired over-attempt row reads held, not exhausted", () => {
  const { scope, key } = fresh();
  const first = acquire(scope, key, { ttlMs: 60_000, maxAttempts: 1 });
  assert.equal(first.ok, true);
  const second = acquire(scope, key, { ttlMs: 60_000, maxAttempts: 1 });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, "held");
});

test("6. release's owner guard is load-bearing", () => {
  const { scope, key } = fresh();
  const got = acquire(scope, key);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  const forged: Lease = { ...got.lease, owner: "someone-else" };
  assert.equal(release(forged, "done"), false);
  assert.equal(read(scope, key)?.status, "held");
});

test("7. failed self-expires; done does not", () => {
  const { scope, key } = fresh();
  const gotFailed = acquire(scope, key, { ttlMs: 60_000 });
  assert.equal(gotFailed.ok, true);
  if (!gotFailed.ok) return;
  release(gotFailed.lease, "failed");
  const reacquired = acquire(scope, key, { ttlMs: 60_000 });
  assert.equal(reacquired.ok, true, "a failed claim must self-expire and be immediately retryable");

  const { scope: scope2, key: key2 } = fresh();
  // Far-past ttlMs on the ORIGINAL acquire, same reason as test 3: done leaves expires_at
  // untouched, so this row is already expired by the time reacquire runs — isolating the status
  // check as the only thing that can be blocking it ("whatever the expiry").
  const gotDone = acquire(scope2, key2, { ttlMs: -10_000_000 });
  assert.equal(gotDone.ok, true);
  if (!gotDone.ok) return;
  release(gotDone.lease, "done");
  const reacquireDone = acquire(scope2, key2);
  assert.equal(reacquireDone.ok, false);
  if (!reacquireDone.ok) assert.equal(reacquireDone.reason, "done");
});

test("8. clear refuses a held claim, deletes it with force, and reports the row count", () => {
  const { scope, key } = fresh();
  const got = acquire(scope, key);
  assert.equal(got.ok, true);

  assert.equal(clear(scope, key), 0);
  assert.equal(read(scope, key)?.status, "held");

  assert.equal(clear(scope, key, { force: true }), 1);
  assert.equal(read(scope, key), null);
});

test("9. a second scope's claim on the same key does not collide", () => {
  const { scope: scopeA, key } = fresh();
  const scopeB = `${scopeA}-b`;
  const a = acquire(scopeA, key);
  const b = acquire(scopeB, key);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);

  assert.deepEqual(
    list(scopeA).map((r) => r.key),
    [key],
  );
});

test("10. LSE-04 — versioned keys and constant keys do not collide", () => {
  const { scope } = fresh();
  const versioned1 = acquire(scope, "repo#7@abc1234");
  const constant = acquire(scope, "serial:checklist");
  assert.equal(versioned1.ok, true);
  assert.equal(constant.ok, true);

  // The version moving is a NEW key — held-terminal rules on the old key never apply to it. The
  // opposite release rule (a constant key needing LSE-12's force-release, M9) is the same primitive
  // used a different way, not tested here.
  const versioned2 = acquire(scope, "repo#7@def5678");
  assert.equal(versioned2.ok, true);
});

test("11. INS-04's format, five fields, parseOwner round-trips newOwner()", () => {
  const { scope, key } = fresh();
  const got = acquire(scope, key);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  const parsed = parseOwner(got.lease.owner);
  assert.ok(parsed, `expected ${got.lease.owner} to parse`);
  assert.match(parsed!.pidns, /^\d+$/);
  // Field 1 equals the imported INSTANCE — asserted on the SHAPE, never a literal (INSTANCE is
  // read once at import, so a test cannot move it after the fact; see this file's own risk note).
  assert.equal(parsed!.instance, INSTANCE);
  assert.equal(parsed!.pid, process.pid);
});

test("12. parseOwner refuses everything not in the exact five-field shape", () => {
  const cases: Record<string, string | null> = {
    "host:pidns:1234:aaaaaaaa": null, // the reference's own four-field owner
    // Every one of the four parts individually looks valid for the position it would land in —
    // this is the row that catches a length check WEAKENED to `< 4` rather than `!== 5`: with
    // only the content checks left standing, this owner would parse successfully (wrongly).
    "abc:host1:99:1234": null,
    "inst:host:notanumber:1234:aaaaaaaa": null,
    "inst:host:1:notanumber:aaaaaaaa": null,
    ":host:1:1234:aaaaaaaa": null, // empty instance
    "Inst:host:1:1234:aaaaaaaa": null, // capital letter
    "": null,
    "a:b:c:d:e:f": null, // six fields
  };
  const actual: Record<string, unknown> = {};
  for (const owner of Object.keys(cases)) actual[owner] = parseOwner(owner);
  assert.deepEqual(actual, cases);
});

test("13. the migration is idempotent", () => {
  // leaseDb() is called indirectly by every store function above; calling read() twice in a row
  // must not throw and must not create a second schema_version row.
  const { scope, key } = fresh();
  read(scope, key);
  read(scope, key);
});

test("14. DBS-02's prefix enforcer is live — every object starts lease_", () => {
  // Exercised structurally: leaseDb()'s own migration step would throw (via db.ts's enforcer) if
  // it ever created an object outside the lease_ prefix, and every test above already calls it
  // without throwing. This test names the property explicitly rather than relying on that being
  // read between the lines.
  const { scope, key } = fresh();
  assert.doesNotThrow(() => acquire(scope, key));
});

test("15. the single-statement claim is real — exactly one statement execution before acquire's own changes check", () => {
  // Counts every statement-EXECUTING call (run/get/all/iterate — db.ts's own EXECUTES set), not
  // only .run(: a read-then-write split would add a .get( for the read while still calling .run(
  // exactly once for the write, so counting .run( alone could never go red on that mutation. The
  // first draft of this scan also considered a `SELECT … FOR` text pattern; that is decoration —
  // SQLite has no `SELECT … FOR UPDATE`, so it can never fire. Only the call-count form ships.
  const src = readFileSync(new URL("./lease.ts", import.meta.url), "utf8");
  const start = src.indexOf("export function acquire(");
  assert.ok(start !== -1, "expected to find acquire's declaration");
  const checkMarker = "if (result.changes === 1)";
  const checkIdx = src.indexOf(checkMarker, start);
  assert.ok(checkIdx !== -1, "expected to find the changes===1 check after acquire's declaration");
  const body = src.slice(start, checkIdx);
  const execCalls = (body.match(/\.(run|get|all|iterate)\(/g) ?? []).length;
  assert.equal(
    execCalls,
    1,
    `expected exactly one statement execution in acquire's body before its changes===1 check, found ${execCalls} — a read-then-write split reopens the race this primitive exists to close`,
  );
});
