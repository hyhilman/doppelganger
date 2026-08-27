// J2.6 (SUP-10, §5 Q1) — the gate's named resources and the refresh window.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createGate } from "../kernel/runtime/gate.ts";
import { ROOT, projectPath } from "../kernel/paths.ts";
import { RESOURCES, RESOURCE_NAMES, REFRESH_WINDOW, inRefreshWindow, type RefreshWindow } from "./config.ts";

// Re-stated, not imported: kernel/runtime/gate.ts's NAME_RE is not exported (it is the file's own
// internal guard). This is the same rule, owned there — createGate throws on a name failing it.
const NAME_RE = /^[a-z][a-z0-9_-]*$/;

test("1. RESOURCES is non-empty, names are unique, and each matches the gate's own name rule", () => {
  assert.ok(RESOURCES.length > 0, "RESOURCES must not be empty");
  const seen = new Set<string>();
  for (const r of RESOURCES) {
    assert.match(r.name, NAME_RE, `resource name ${JSON.stringify(r.name)} must match ${NAME_RE}`);
    assert.ok(!seen.has(r.name), `duplicate resource name ${JSON.stringify(r.name)}`);
    seen.add(r.name);
  }
  assert.deepEqual(RESOURCE_NAMES, RESOURCES.map((r) => r.name));
});

test("2. every resource's why is one non-empty line", () => {
  for (const r of RESOURCES) {
    assert.ok(r.why.length > 0, `${r.name}: why must not be empty`);
    assert.ok(!r.why.includes("\n"), `${r.name}: why must be one line`);
  }
});

test("3. INS-05 half one: every resource lives inside the checkout", () => {
  for (const r of RESOURCES) {
    assert.doesNotThrow(
      () => projectPath(r.path),
      `${r.name}: path ${JSON.stringify(r.path)} must resolve inside ROOT (INS-05)`,
    );
    assert.ok(projectPath(r.path).startsWith(ROOT), `${r.name}: resolved path must start with ROOT`);
  }
});

test("4. INS-05 half two: two gates over the same resource names coordinate nothing", async () => {
  const gateA = createGate(RESOURCE_NAMES);
  const gateB = createGate(RESOURCE_NAMES);
  const holdA = await gateA.acquire("excl", ["repo"], 0);
  const holdB = await gateB.acquire("excl", ["repo"], 0);
  assert.ok(
    holdB,
    "two supervisors hold two gates with NO mutual exclusion between them, and the silence is the " +
      "hazard. This test exists so the non-goal is declined rather than discovered.",
  );
  holdA!.release();
  holdB!.release();
});

test("5. inRefreshWindow(any, null) is false across a spread of the week — the N2 state", () => {
  assert.equal(REFRESH_WINDOW, null, "N2 ships no live window — validate() (J2.9) relies on this");
  const base = Date.UTC(2026, 0, 4); // a Sunday, 2026-01-04 00:00 UTC
  for (let i = 0; i < 200; i++) {
    const at = new Date(base + i * 50 * 60_000); // step by 50 minutes, spanning ~7 days
    assert.equal(inRefreshWindow(at, null), false, `${at.toISOString()} must read false while the window is null`);
    // The default parameter (no second argument) resolves to REFRESH_WINDOW, which is null too.
    assert.equal(inRefreshWindow(at), false, `${at.toISOString()} must read false through the default parameter`);
  }
});

// The reference's own Fri/Sat 22:50 + 91 min window — used here because it is the one window
// anyone has ever run.
const FIXTURE: RefreshWindow = {
  opensDow: [5, 6], // Friday, Saturday
  opensAt: "22:50",
  lengthMin: 91,
  why: "fixture: the reference's corpus-refresh window",
};

function fridayAt(hh: number, mm: number): Date {
  // 2026-01-02 is a Friday, UTC.
  return new Date(Date.UTC(2026, 0, 2, hh, mm));
}

function saturdayAt(hh: number, mm: number): Date {
  return new Date(Date.UTC(2026, 0, 3, hh, mm));
}

test("6. the fixture window's boundary minutes: half-open [open, open + lengthMin)", () => {
  assert.equal(inRefreshWindow(fridayAt(22, 49), FIXTURE), false, "22:49 Fri must be out");
  assert.equal(inRefreshWindow(fridayAt(22, 50), FIXTURE), true, "22:50 Fri must be in");
  assert.equal(inRefreshWindow(saturdayAt(0, 20), FIXTURE), true, "00:20 Sat must be in");
  assert.equal(inRefreshWindow(saturdayAt(0, 21), FIXTURE), false, "00:21 Sat must be out");
  const wednesday = new Date(Date.UTC(2025, 11, 31, 23, 0)); // 2025-12-31 is a Wednesday, UTC
  assert.equal(inRefreshWindow(wednesday, FIXTURE), false, "Wednesday 23:00 must be out");
});

test("7. a window crossing Sunday midnight needs no second clause", () => {
  const wrap: RefreshWindow = {
    opensDow: [6], // Saturday
    opensAt: "23:30",
    lengthMin: 90,
    why: "fixture: crosses the week boundary",
  };
  const sundayMidnight = new Date(Date.UTC(2026, 0, 4, 0, 0)); // 2026-01-04 is a Sunday, UTC
  const sundayOneAm = new Date(Date.UTC(2026, 0, 4, 1, 0));
  assert.equal(inRefreshWindow(sundayMidnight, wrap), true, "Sun 00:00 must be in — Saturday's window is still open");
  assert.equal(inRefreshWindow(sundayOneAm, wrap), false, "Sun 01:00 must be out — 90 minutes have passed");
});
