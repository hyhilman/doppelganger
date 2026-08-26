// J2.4 (GAT-01, GAT-02, GAT-03, GAT-04, GAT-06) — the gate proved against a pure model over the
// ENTIRE finite request space, not over a handful of scenarios. See gate.ts's module header for the
// deadlock argument and the premise it rests on.
//
// No timer of any kind, anywhere in this file (AC6) — every wait here is either `waitMs = 0`
// (which creates no timer at all, at this commit) or an await on an already-settled promise chain
// driven by `drain()` on release.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createGate, type Mode } from "./gate.ts";

const NAMES = ["a", "b", "c"] as const;

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
