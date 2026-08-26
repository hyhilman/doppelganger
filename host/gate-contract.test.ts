// J4.15 (TST-17, GAT-03, GAT-06, GAT-07) — the gate contract, over the REAL PROGRAMS and the REAL
// RESOURCE_NAMES, not a fixture.
//
// kernel/runtime/gate.test.ts already proves the contract over the entire finite request space
// against a FIXTURE gate over `["a","b","c"]` — 24 tests, three levels, nothing re-shipped here
// (its own header now names this file as the live half). What N2/N3 never had was a schedule with
// more than one PROGRAM: an assertion over one element is an assertion about nothing, which is
// exactly what the reference's own single-entry SCHEDULE gave it. Three programs (J4.9/J4.12/J4.14)
// is what makes it real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGate, type Mode, type GateHold } from "../kernel/runtime/gate.ts";
import { RESOURCES, RESOURCE_NAMES } from "./config.ts";
import { PROGRAMS, type Program } from "./schedule.ts";

test("1. every program's resources names a real gate resource", () => {
  for (const [name, p] of Object.entries(PROGRAMS)) {
    for (const r of p.resources ?? []) {
      assert.ok(RESOURCE_NAMES.includes(r), `program ${JSON.stringify(name)} names unknown resource ${JSON.stringify(r)}`);
    }
  }
});

/** What a program actually claims on the resource gate — `null` for `gate: "none"` (it never
 *  calls `acquire` at all). `"shared"` always claims every resource (GAT-02, `asked` ignored);
 *  `"excl"` with no `resources` also claims every resource (a writer naming nothing is a safe
 *  default, not a no-op — the same rule `gate.ts`'s own `acquire` doc states). */
function claim(p: Program): { readonly mode: Mode; readonly resources: readonly string[] } | null {
  if (p.gate === "none") return null;
  if (p.gate === "shared") return { mode: "shared", resources: RESOURCE_NAMES };
  return { mode: "excl", resources: p.resources ?? RESOURCE_NAMES };
}

/** Computed independently of the real gate: two claims are concurrent unless they share a
 *  resource AND at least one side is `excl` on it — the reader/writer rule stated as data, never
 *  another copy of gate.ts's own acquisition logic. */
function independentlyConcurrent(a: Program, b: Program): boolean {
  const ca = claim(a);
  const cb = claim(b);
  if (ca === null || cb === null) return true; // a gate: "none" side claims nothing at all
  const overlap = ca.resources.filter((r) => cb.resources.includes(r));
  if (overlap.length === 0) return true;
  return ca.mode === "shared" && cb.mode === "shared";
}

/** The REAL gate, two real `acquire` calls, `state()` read between them — never `acquireSelf`
 *  (that is GAT-06's own subject, test 4): this is the RESOURCE gate's contract in isolation. */
async function reallyConcurrent(nameA: string, nameB: string): Promise<boolean> {
  const gate = createGate(RESOURCE_NAMES);
  const pA = PROGRAMS[nameA]!;
  const pB = PROGRAMS[nameB]!;

  const holdA: GateHold | null = pA.gate === "none" ? null : await gate.acquire(pA.gate, pA.resources ?? [], 0);
  assert.ok(pA.gate === "none" || holdA, `${nameA}: its own first acquire must always succeed against a fresh gate`);

  gate.state(); // read between the two acquires — a live snapshot with A's claim (if any) already held

  const holdB: GateHold | null = pB.gate === "none" ? null : await gate.acquire(pB.gate, pB.resources ?? [], 0);
  const ok = pB.gate === "none" || holdB !== null;

  holdA?.release();
  holdB?.release();
  return ok;
}

test("2. GAT-03 live: the concurrency the split buys is the concurrency the schedule needs, over every ordered pair of real programs", async () => {
  const names = Object.keys(PROGRAMS);
  assert.ok(names.length >= 2, "precondition: at least two real programs — an assertion over one is an assertion about nothing");
  const disagreements: string[] = [];
  for (const a of names) {
    for (const b of names) {
      const real = await reallyConcurrent(a, b);
      const independent = independentlyConcurrent(PROGRAMS[a]!, PROGRAMS[b]!);
      if (real !== independent) {
        disagreements.push(`(${a}, ${b}): real=${real} independent=${independent}`);
      }
    }
  }
  assert.deepEqual(disagreements, []);
});

test("3. GAT-07 live: every gate:\"none\" program has a non-empty whyNoGate, and there are exactly two", () => {
  const noneProgs = Object.entries(PROGRAMS).filter(([, p]) => p.gate === "none");
  for (const [name, p] of noneProgs) {
    assert.ok(p.whyNoGate && p.whyNoGate.trim().length > 0, `${name}: gate: "none" requires a non-empty whyNoGate (GAT-07)`);
  }
  assert.equal(noneProgs.length, 2, `expected exactly 2 gate:"none" programs, found ${noneProgs.length}: ${noneProgs.map(([n]) => n).join(", ")}`);
});

test("4. GAT-06 live: acquireSelf is keyed on the PROGRAM, not the entry", () => {
  const gate = createGate(RESOURCE_NAMES);
  const programName = "nightly-sandcastle";
  assert.ok(PROGRAMS[programName]?.self, "fixture precondition: this real PROGRAMS row must set self: true");
  // Two DIFFERENT schedule entries could, in principle, both name this same program (SCHEDULE has
  // none today — plan/N4-uac.md's own note) — acquireSelf must refuse the second regardless.
  const releaseEntryA = gate.acquireSelf(programName);
  assert.ok(releaseEntryA, "the first entry of this program must acquire self cleanly");
  const releaseEntryB = gate.acquireSelf(programName);
  assert.equal(releaseEntryB, null, "a second entry naming the SAME program must be refused");
  releaseEntryA!();
  const releaseAfterRelease = gate.acquireSelf(programName);
  assert.ok(releaseAfterRelease, "releasing the first frees the program for a later entry");
  releaseAfterRelease!();
});

test("5. the gate a real boot builds is the gate this contract ran against", () => {
  const gate = createGate(RESOURCE_NAMES);
  assert.deepEqual(gate.resources, RESOURCES.map((r) => r.name));
});
