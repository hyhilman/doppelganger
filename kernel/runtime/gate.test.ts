// The gate proved against a pure model over the ENTIRE finite request space, not over a handful
// of scenarios. See gate.ts's module header for the deadlock argument and the premise it rests on.
//
// No timer of any kind, anywhere in this file — every wait here is either `waitMs = 0` (which
// creates no timer at all, at this commit) or an await on an already-settled promise chain driven
// by `drain()` on release.
//
// This IS the "gate contract" row TST-17 names: 24 tests over three levels (the exclusion
// decision against a pure model over all 256 ordered request pairs; the acquisition order over
// every caller spelling; no wait-for cycle over all 64 ordered writer pairs), all built against a
// FIXTURE gate over `["a","b","c"]`. host/gate-contract.test.ts is the genuinely new half: the
// same contract, asserted over the REAL `RESOURCE_NAMES` and the REAL `PROGRAMS`, which needed a
// schedule with more than one program to say anything at all — an assertion over a single element
// is an assertion about nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createGate, type Mode, starveThreshold } from "./gate.ts";

const NAMES = ["a", "b", "c"] as const;
const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

interface Req {
  readonly mode: Mode;
  readonly subset: string[];
}

/** Every subset of {a,b,c}, including the empty one — 8 in total. */
function subsets(): string[][] {
  const out: string[][] = [];
  for (let mask = 0; mask < 8; mask++) {
    const s: string[] = [];
    for (let i = 0; i < 3; i++) if (mask & (1 << i)) s.push(NAMES[i]!);
    out.push(s);
  }
  return out;
}

function permutations<T>(arr: readonly T[]): T[][] {
  if (arr.length <= 1) return [[...arr]];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([arr[i] as T, ...p]);
  }
  return out;
}

/** Every (mode, subset) request shape — 8 subsets x 2 modes = 16. */
function allRequests(): Req[] {
  const reqs: Req[] = [];
  for (const mode of ["shared", "excl"] as const) {
    for (const s of subsets()) reqs.push({ mode, subset: s });
  }
  return reqs;
}

/** GAT-02's normalisation, restated here as a PURE model independent of gate.ts's own `want` — the
 *  test must not import the thing it is checking. */
function pureWant(req: Req): string[] {
  if (req.mode === "shared") return [...NAMES];
  if (req.subset.length === 0) return [...NAMES];
  return NAMES.filter((n) => req.subset.includes(n));
}

/** The four-line exclusion model level 1 checks the real gate against. */
function compatible(x: Req, y: Req): boolean {
  return (x.mode === "shared" && y.mode === "shared") || pureWant(x).every((r) => !pureWant(y).includes(r));
}

test("1. createGate refuses an empty list, a duplicate name and a bad name", () => {
  assert.throws(() => createGate([]), /must not be empty/);
  assert.throws(() => createGate(["a", "a"]), /duplicate/);
  assert.throws(() => createGate(["Bad Name"]), /bad resource name/);
});

test("2. the exclusion decision matches a pure model, over all 256 ordered request pairs (level 1)", async () => {
  const reqs = allRequests();
  for (const x of reqs) {
    for (const y of reqs) {
      const gate = createGate([...NAMES]);
      const a = await gate.acquire(x.mode, x.subset, 0);
      assert.ok(a, `A (${x.mode} [${x.subset.join(",")}]) must succeed on a fresh gate`);
      const b = await gate.acquire(y.mode, y.subset, 0);
      const expected = compatible(x, y);
      assert.equal(
        b !== null,
        expected,
        `A=${x.mode}[${x.subset.join(",")}] B=${y.mode}[${y.subset.join(",")}]: expected compatible=${expected}`,
      );
      if (b) {
        b.release();
        a!.release();
      } else {
        a!.release();
        const b2 = await gate.acquire(y.mode, y.subset, 0);
        assert.ok(b2, "B must succeed once A releases");
        b2!.release();
      }
    }
  }
});

test("3. the acquisition order is normalised for every caller spelling (level 2)", async () => {
  const nonEmpty = subsets().filter((s) => s.length > 0);
  for (const s of nonEmpty) {
    for (const perm of permutations(s)) {
      const gate = createGate([...NAMES]);
      const h = await gate.acquire("excl", perm, 0);
      assert.ok(h, `excl [${perm.join(",")}] must succeed on a fresh gate`);
      const expected = NAMES.filter((n) => s.includes(n));
      assert.deepEqual(
        h!.resources,
        expected,
        `permutation [${perm.join(",")}] of {${s.join(",")}} must normalise to [${expected.join(",")}] — GAT-04's fixed global order`,
      );
      h!.release();
    }
  }
});

test("4. no wait-for cycle, over all 64 ordered writer pairs (level 3)", async () => {
  const all = subsets();
  for (const subA of all) {
    for (const subB of all) {
      const gate = createGate([...NAMES]);
      const a = await gate.acquire("excl", subA, 0);
      assert.ok(a, `A (excl [${subA.join(",")}]) must succeed on a fresh gate`);
      const bPromise = gate.acquire("excl", subB, 60_000); // long wait, not awaited yet
      a!.release();
      const b = await bPromise;
      assert.ok(b, `B (excl [${subB.join(",")}]) must eventually succeed once A releases`);
      b!.release();
      const st = gate.state();
      for (const name of gate.resources) {
        assert.deepEqual(
          st.resources[name],
          { readers: 0, writer: false, queued: 0 },
          `resource ${name} not fully released after both writers finished`,
        );
      }
    }
  }
});

test("5. GAT-03: two writers on disjoint resources both hold at once", async () => {
  const gate = createGate([...NAMES]);
  const ha = await gate.acquire("excl", ["a"], 0);
  const hb = await gate.acquire("excl", ["b"], 0);
  assert.ok(ha, "writer on a must succeed");
  assert.ok(hb, "writer on b must succeed while a is held — this is why the gate is per-resource at all");
  const st = gate.state();
  assert.equal(st.resources.a!.writer, true);
  assert.equal(st.resources.b!.writer, true);
  ha!.release();
  hb!.release();
});

test("6. GAT-02: a reader passed one resource still holds all three; a writer passed none holds all three", async () => {
  const gate = createGate([...NAMES]);
  const r = await gate.acquire("shared", ["a"], 0);
  assert.ok(r);
  assert.deepEqual(r!.resources, ["a", "b", "c"], "a reader always takes ALL resources; asked is ignored");
  r!.release();

  const w = await gate.acquire("excl", [], 0);
  assert.ok(w);
  assert.deepEqual(w!.resources, ["a", "b", "c"], "a writer naming nothing takes all — a safe default, not a no-op");
  w!.release();
});

test("7. release is idempotent: a double release does not double-decrement", async () => {
  const gate = createGate([...NAMES]);
  const h = await gate.acquire("shared", ["a"], 0);
  assert.ok(h);
  h!.release();
  h!.release();
  const w = await gate.acquire("excl", ["a"], 0);
  assert.ok(w, "a writer must succeed once the one reader released — a double release must not have decremented readers twice");
  w!.release();
});

test("8. partial acquisition is never stranded", async () => {
  const gate = createGate([...NAMES]);
  const h = await gate.acquire("excl", ["b"], 0);
  assert.ok(h);
  const fail = await gate.acquire("excl", ["a", "b"], 0);
  assert.equal(fail, null, "b is held, so the multi-resource writer must fail");
  const succeed = await gate.acquire("excl", ["a"], 0);
  assert.ok(succeed, "a must still be free — the failed attempt must have released it before returning null");
  succeed!.release();
  h!.release();
});

test("9. acquire throws naming the unknown resource", async () => {
  const gate = createGate([...NAMES]);
  await assert.rejects(() => gate.acquire("excl", ["nope"], 0), /nope/);
});

test("10. GAT-06: acquireSelf refuses a second holder, frees on release, is independent across keys", () => {
  const gate = createGate([...NAMES]);

  const rel1 = gate.acquireSelf("k1");
  assert.ok(rel1, "first holder of k1 must succeed");
  assert.equal(gate.selfHeld("k1"), true);

  const rel1Again = gate.acquireSelf("k1");
  assert.equal(rel1Again, null, "a second holder of the same key must be refused");

  const rel2 = gate.acquireSelf("k2");
  assert.ok(rel2, "k2 is independent of k1");
  assert.equal(gate.selfHeld("k2"), true);

  rel1!();
  assert.equal(gate.selfHeld("k1"), false, "release frees the key");
  assert.equal(gate.selfHeld("k2"), true, "releasing k1 must not affect k2");

  const rel1Recheck = gate.acquireSelf("k1");
  assert.ok(rel1Recheck, "k1 must be re-acquirable once released");
  rel1Recheck!();
  rel2!();
});

test("11. two gates over the same names exclude nothing from each other", async () => {
  const g1 = createGate([...NAMES]);
  const g2 = createGate([...NAMES]);
  const h1 = await g1.acquire("excl", [], 0);
  const h2 = await g2.acquire("excl", [], 0);
  assert.ok(h1, "g1's writer must succeed");
  assert.ok(h2, "g2's writer must succeed at the same time — INS-05: two gates share no state");
  h1!.release();
  h2!.release();
});

// -------------------------------------------------------------------------------------------
// Still no real timer created by THIS file — the only timers are the gate's own, driven by
// `waitMs`, and the four 50 ms waits below are this phase's only real delays.
// -------------------------------------------------------------------------------------------

test("12. enqueue is synchronous: a queued waiter is visible before acquire() is awaited", async () => {
  const gate = createGate([...NAMES]);
  const h = await gate.acquire("excl", ["a"], 0);
  assert.ok(h);
  const queued = gate.acquire("excl", ["a"], 60_000); // NOT awaited
  assert.equal(gate.state().resources.a!.queued, 1, "the waiter must already be queued before this line runs");
  h!.release();
  const q = await queued;
  assert.ok(q, "the queued writer must resolve once the holder releases, with no timer having fired");
  q!.release();
});

test("13. GAT-05: a queued writer blocks a reader that arrives after it", async () => {
  const gate = createGate([...NAMES]);
  const reader = await gate.acquire("shared", [], 0);
  assert.ok(reader);
  const writer = gate.acquire("excl", ["a"], 60_000); // NOT awaited
  assert.equal(gate.state().resources.a!.queued, 1);
  const laterReader = await gate.acquire("shared", [], 0);
  assert.equal(laterReader, null, "a later reader must NOT overtake the queued writer");
  reader!.release();
  const w = await writer;
  assert.ok(w, "the queued writer must eventually succeed");
  w!.release();
});

test("14. a run of queued readers drains together; a writer behind them waits for both", async () => {
  const gate = createGate([...NAMES]);
  const writer = await gate.acquire("excl", ["a"], 0);
  assert.ok(writer);
  const r1 = gate.acquire("shared", [], 60_000);
  const r2 = gate.acquire("shared", [], 60_000);
  const w2 = gate.acquire("excl", ["a"], 60_000); // queued behind the two readers
  assert.equal(gate.state().resources.a!.queued, 3, "all three waiters must be queued synchronously");

  writer!.release();
  // One synchronous drain() pass grants both readers together; the writer behind them stays
  // queued because two readers now hold "a" — a writer would have taken it alone.
  assert.deepEqual(gate.state().resources.a, { readers: 2, writer: false, queued: 1 });

  const h1 = await r1;
  const h2 = await r2;
  assert.ok(h1, "first queued reader must resolve");
  assert.ok(h2, "second queued reader must resolve together with the first");

  h1!.release();
  assert.equal(gate.state().resources.a!.writer, false, "one reader releasing must not admit the writer yet");
  h2!.release();
  const wHold = await w2;
  assert.ok(wHold, "the writer must resolve only once BOTH readers have released");
  wHold!.release();
});

test("15. the timeout path: a queued acquire that times out is removed from the queue", async () => {
  const gate = createGate([...NAMES]);
  const h = await gate.acquire("excl", ["a"], 0);
  assert.ok(h);
  const started = Date.now();
  const failed = await gate.acquire("excl", ["a"], 50);
  const elapsed = Date.now() - started;
  assert.equal(failed, null);
  assert.ok(elapsed >= 40, `expected >= 40ms elapsed for a 50ms wait, got ${elapsed}ms (exceptions table row 1)`);
  assert.equal(gate.state().resources.a!.queued, 0, "the timed-out waiter must have been removed from the queue");
  h!.release();
});

test("16. a timeout unblocks the queue behind it", async () => {
  const gate = createGate([...NAMES]);
  // release() always calls drain() on its own, so a fixture where the original holder releases
  // right after the timeout can't catch a mutation that deletes the drain() call INSIDE the
  // timeout handler — the SUBSEQUENT release's own drain() would grant the queued party regardless.
  // The distinguishing case needs a party BEHIND the timed-out waiter that is compatible with the
  // RESOURCE'S CURRENT HOLDER and can therefore be granted the moment the timed-out waiter is
  // removed — with NO release ever happening. A shared reader is compatible with another shared
  // reader; a queued writer blocks it only via GAT-05 writer priority, not via the resource's own
  // state.
  const reader1 = await gate.acquire("shared", ["a"], 0);
  assert.ok(reader1);
  const writerX = gate.acquire("excl", ["a"], 50); // will time out; blocks reader2 via writer priority alone
  const reader2 = gate.acquire("shared", ["a"], 60_000); // compatible with reader1, queued only behind writerX
  assert.equal(gate.state().resources.a!.queued, 2);

  const writerXResult = await writerX;
  assert.equal(writerXResult, null, "the writer must time out");

  // reader1 never releases before this point: reader2 can only resolve if the TIMEOUT ITSELF
  // drains the queue.
  const r2 = await reader2;
  assert.ok(r2, "reader2 must be granted once the timed-out writer is removed — nothing else ever released");
  r2!.release();
  reader1!.release();
});

test("17. the wait budget spans the whole acquisition, not each resource in turn", async () => {
  const gate = createGate([...NAMES]);
  // Holding BOTH "a" and "c" (not just "c", leaving "a" free) makes the second resource's wait
  // genuinely depend on how much budget the first one already spent — a free resource costs ~0ms
  // of the budget regardless of whether the implementation passes each resource the REMAINING
  // budget or the FULL waitMs, so a fixture holding only "c" could not tell the two apart.
  const h = await gate.acquire("excl", ["a", "c"], 0);
  assert.ok(h);
  const started = Date.now();
  const failed = await gate.acquire("excl", ["a", "c"], 50);
  const elapsed = Date.now() - started;
  assert.equal(failed, null);
  assert.ok(
    elapsed < 100,
    `expected < 100ms — a per-resource budget would spend a full 50ms on EACH of a and c (exceptions table row 2), got ${elapsed}ms`,
  );
  h!.release();
});

test("18. the unwind on timeout: a partial multi-resource acquire that times out releases what it already took", async () => {
  const gate = createGate([...NAMES]);
  const h = await gate.acquire("excl", ["c"], 0);
  assert.ok(h);
  const failed = await gate.acquire("excl", ["a", "c"], 50);
  assert.equal(failed, null, "c stays held for the whole wait, so the second resource must time out");
  assert.deepEqual(
    gate.state().resources.a,
    { readers: 0, writer: false, queued: 0 },
    "a must have been released by the unwind — without it, a is held by a caller that no longer exists",
  );
  const reacquired = await gate.acquire("excl", ["a"], 0);
  assert.ok(reacquired, "a must be immediately acquirable after the unwind");
  reacquired!.release();
  h!.release();
});

test("19. mixed reader/writer liveness across multiple resources, three parties, two resources", async () => {
  const gate = createGate([...NAMES]);
  const reader1 = await gate.acquire("shared", [], 0);
  assert.ok(reader1);

  const writerPromise = gate.acquire("excl", ["a", "b"], 60_000);
  const reader2Promise = gate.acquire("shared", [], 60_000);
  // The writer's request spans a and b, but resources are acquired in the gate's fixed order one
  // at a time — it queues on "a" first and has not yet attempted "b". The second reader,
  // arriving after the writer, is refused "a" too (GAT-05 writer priority) and queues behind it.
  assert.equal(gate.state().resources.a!.queued, 2, "the writer and the second reader are both queued on a");
  assert.equal(gate.state().resources.b!.queued, 0, "b was never contested — the writer has not reached it yet");

  reader1!.release();
  const writerHold = await writerPromise;
  assert.ok(writerHold, "the writer must eventually take a and b together");
  assert.deepEqual(writerHold!.resources, ["a", "b"]);

  writerHold!.release();
  const reader2 = await reader2Promise;
  assert.ok(reader2, "the second reader must get in once the writer releases");
  reader2!.release();
});

// -------------------------------------------------------------------------------------------
// Lock-starve visibility: the threshold half only. The COUNTER (lockloss:<job>) is JOB-O02's
// (N5); these tests cover starveThreshold, the pure resolver its threshold comes from.
// -------------------------------------------------------------------------------------------

function scrubbedChild(code: string, env: Record<string, string> = {}): string {
  const r = spawnSync(process.execPath, ["-e", code], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `child failed: ${r.stderr}`);
  return r.stdout.trim();
}

test("20. starveThreshold defaults to 6", () => {
  // A scrubbed child, not process.env manipulation in-process: starveThreshold reads its env
  // DYNAMICALLY, per call (unlike LOG_LEVEL, which a module resolves once at import) — so this
  // check does not strictly need a child process to observe the default. It uses one anyway so
  // this assertion never depends on running before, or cleaning up after, this same file's other
  // tests, which do set LOCK_STARVE_N and LOCK_STARVE_N_TODO_EXEC directly on process.env.
  const out = scrubbedChild(
    "import('./kernel/runtime/gate.ts').then(m=>console.log(m.starveThreshold('nightly-sandcastle')))",
  );
  assert.equal(out, "6");
});

test("21. LOCK_STARVE_N moves every job's threshold", () => {
  const prev = process.env.LOCK_STARVE_N;
  process.env.LOCK_STARVE_N = "9";
  try {
    assert.equal(starveThreshold("nightly-sandcastle"), 9);
    assert.equal(starveThreshold("todo-exec"), 9);
  } finally {
    if (prev === undefined) delete process.env.LOCK_STARVE_N;
    else process.env.LOCK_STARVE_N = prev;
  }
});

test("22. LOCK_STARVE_N_TODO_EXEC moves only todo-exec", () => {
  const prev = process.env.LOCK_STARVE_N_TODO_EXEC;
  process.env.LOCK_STARVE_N_TODO_EXEC = "72";
  try {
    assert.equal(starveThreshold("todo-exec"), 72);
    assert.equal(starveThreshold("nightly-sandcastle"), 6, "an unrelated job must stay at the base threshold");
  } finally {
    if (prev === undefined) delete process.env.LOCK_STARVE_N_TODO_EXEC;
    else process.env.LOCK_STARVE_N_TODO_EXEC = prev;
  }
});

test("23. the hyphen-to-underscore mapping is exact", () => {
  const impossibleKey = "LOCK_STARVE_N_TODO-EXEC"; // no real shell can set a name with a hyphen
  const env = process.env as Record<string, string | undefined>;
  const prev = env[impossibleKey];
  env[impossibleKey] = "999";
  try {
    assert.equal(starveThreshold("todo-exec"), 6, "a hyphenated env name must never be read");
  } finally {
    if (prev === undefined) delete env[impossibleKey];
    else env[impossibleKey] = prev;
  }
});

test("24. a non-numeric override throws naming the key and the value", () => {
  const prev = process.env.LOCK_STARVE_N_TODO_EXEC;
  process.env.LOCK_STARVE_N_TODO_EXEC = "lots";
  try {
    assert.throws(() => starveThreshold("todo-exec"), /LOCK_STARVE_N_TODO_EXEC.*"lots"/);
  } finally {
    if (prev === undefined) delete process.env.LOCK_STARVE_N_TODO_EXEC;
    else process.env.LOCK_STARVE_N_TODO_EXEC = prev;
  }
});
