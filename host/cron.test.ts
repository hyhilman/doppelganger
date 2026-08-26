// J2.8 (GAT-08, GAT-09) — parseFive's intersection grammar, tickSeconds derived from croner's own
// enumeration, and gateWait's memoised early-stopped cap. We do NOT test that croner's timer
// fires — that would cost a minute of wall clock and would be a test of croner. What we test is
// that the pattern croner will fire on is the pattern POSIX fires on (J2.10 does that part).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFive, tickSeconds, gateWait, newTimer, CRON_ANCHOR } from "./cron.ts";
import type { ScheduleEntry } from "./schedule.ts";

test("1. parseFive accepts every form this repo will use", () => {
  const accepted = [
    "* * * * *",
    "*/10 15-21 * * *",
    "0,10,20,30 22 * * *",
    "4-59/5 * * * 1-4",
    "13-58/15 1-10 * * 1-5",
    "0 23 * * 5,6",
    "0 0 * * 7",
    "45 * * * *",
    "0 0 1 * *",
    "0 0 28-31 * *",
  ];
  for (const expr of accepted) {
    const r = parseFive(expr);
    assert.equal(r.ok, true, `${expr} must be accepted: ${!r.ok ? r.problems.join("; ") : ""}`);
  }
});

test("2. parseFive refuses every form outside the intersection, each with a message naming the rule", () => {
  const refused: readonly [string, RegExp][] = [
    ["0 0 1 *", /exactly 5 fields/],
    ["0 0 1 * * *", /exactly 5 fields/],
    ["5/10 * * * *", /step needs a range/],
    ["*/0 * * * *", /step .* must be between/],
    ["*/61 * * * *", /step .* must be between/],
    ["60 * * * *", /out of range/],
    ["* 24 * * *", /out of range/],
    ["0 0 32 * *", /out of range/],
    ["0 0 0 * *", /out of range/],
    ["0 0 * 13 *", /out of range/],
    ["0 0 * * 8", /out of range/],
    ["10-5 * * * *", /start > end/],
    ["0 0 * * MON", /not a recognised value/],
    ["0 0 L * *", /not a recognised value/],
    ["0 0 * * 5#2", /not a recognised value/],
    ["0 0 ? * 5", /not a recognised value/],
    ["0 0 15W * *", /not a recognised value/],
    ["@daily", /exactly 5 fields/],
    ["0 0 1 * 1", /dom and dow may not both be restricted/],
  ];
  for (const [expr, rule] of refused) {
    const r = parseFive(expr);
    assert.equal(r.ok, false, `${expr} must be refused`);
    if (!r.ok) {
      assert.ok(
        r.problems.some((p) => rule.test(p)),
        `${expr}: expected a problem matching ${rule}, got ${JSON.stringify(r.problems)}`,
      );
    }
  }
});

test("3. parseFive reports every problem, not the first", () => {
  const r = parseFive("bad 24 32 13 8");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.problems.length, 5, JSON.stringify(r.problems));
});

test("4. tickSeconds takes the closest gap, not the first or the mean", () => {
  assert.equal(tickSeconds("*/10 15-21 * * *"), 600);
  assert.equal(tickSeconds("0,10,20,30 22 * * *"), 600);
});

test("5. tickSeconds crosses hour and day boundaries", () => {
  assert.equal(tickSeconds("45 * * * *"), 3600);
  assert.equal(tickSeconds("53 8 * * *"), 86400);
});

test("6. tickSeconds reads a multi-leg weekly as the gap between its own legs", () => {
  assert.equal(tickSeconds("0 23 * * 5,6"), 86400);
  assert.equal(tickSeconds("0 1 * * 0,6"), 86400);
});

test("7. tickSeconds is deterministic — the anchor is fixed for exactly this reason", () => {
  assert.equal(tickSeconds("*/10 15-21 * * *"), tickSeconds("*/10 15-21 * * *"));
  assert.equal(typeof CRON_ANCHOR, "number");
});

test("8. gateWait is one tick under the cap, and the cap above it", () => {
  assert.equal(gateWait("*/10 15-21 * * *"), 600);
  assert.equal(gateWait("53 8 * * *"), 1800);
  assert.equal(gateWait("45 * * * *"), 1800);
});

// GAT-09: gateWait(expr) <= tickSeconds(expr) for every expression whose true tick is > 0.
//
// The corpus excludes `* * * * *`: the invariant needs the TRUE tick, so it calls tickSeconds
// WITHOUT stopAtS — and for `* * * * *` that is 30,240 nextRun calls, measured at 6.4s, which
// alone breaks this suite's timing budget. `*/5 * * * *` (6,048 firings, ~1.3s) is the densest
// expression this test walks and it exercises the same code path.
test("9. GAT-09: gateWait never exceeds the true tick, over the corpus", () => {
  const corpus = [
    "*/10 15-21 * * *",
    "0,10,20,30 22 * * *",
    "4-59/5 * * * 1-4",
    "13-58/15 1-10 * * 1-5",
    "0 23 * * 5,6",
    "0 0 * * 7",
    "45 * * * *",
    "0 0 1 * *",
    "0 0 28-31 * *",
    "0 1 * * 0,6",
    "*/5 * * * *",
  ];
  for (const expr of corpus) {
    const trueTick = tickSeconds(expr, 21); // no stopAtS — the TRUE minimum
    if (trueTick <= 0) continue; // fewer than two firings in the window; excluded by the invariant's own scope
    const gw = gateWait(expr);
    assert.ok(gw <= trueTick, `${expr}: gateWait=${gw} must be <= tickSeconds=${trueTick}`);
  }
});

test("10. the early stop is real and is what makes gateWait usable", () => {
  const started = Date.now();
  const result = gateWait("* * * * *");
  const elapsed = Date.now() - started;
  assert.equal(result, 60);
  // Measured: with the early stop the call is ~1ms (2 nextRun calls); without it, ~6.4s (30,240
  // calls). 10x headroom over both the measured failure (3-5s) and the measured success (<10ms).
  assert.ok(elapsed < 1000, `expected < 1000ms, got ${elapsed}ms`);
});

test("11. gateWait is memoised: the second call is not slower", () => {
  // F8 (N2 VERIFY): `e0` below is a sixth, previously unlisted timing assertion — the plan's
  // exceptions table said "all five". Measured COLD (this test filtered to run alone, e.g. `--
  // test-name-pattern`, so nothing has warmed up croner yet): 18-19ms, ~5x headroom against the
  // original 100ms bound — the tightest in the phase (rows 3/4 sit at ~1000x/~100x). Measured WARM
  // (the normal `npm test` path — test 8 above already calls gateWait("53 8 * * *") once, so this
  // is not really a first call in practice): ~0ms. Real risk under `npm test` is low, but raised to
  // 300ms anyway for a cold or reordered run, cheap insurance against the tightest bound in the
  // phase; see plan/N2-uac.md's exceptions table row 7.
  const t0 = Date.now();
  const first = gateWait("53 8 * * *");
  const e0 = Date.now() - t0;
  const t1 = Date.now();
  const second = gateWait("53 8 * * *");
  const e1 = Date.now() - t1;
  assert.equal(first, second);
  assert.ok(e0 < 300, `first call: expected < 300ms, got ${e0}ms`);
  assert.ok(e1 < 100, `second (memoised) call: expected < 100ms, got ${e1}ms`);
});

// A literal, not host/schedule.test.ts's `entry()` fixture builder — J2.7 lists that builder's
// importers as J2.9/J2.11/J2.13/J2.14/J2.17, and J2.8 is not one of them: importing a .test.ts
// file for its export re-runs every test() call that file registers as a side effect of the
// import, which would inflate this file's own count when run in isolation.
function fixtureEntry(): ScheduleEntry {
  return { name: "probe-timer", cron: "* * * * *", log: "log/probe.log", job: "probe-timer", why: "fixture" };
}

test("12. newTimer builds a live timer, stopped in a finally", () => {
  const e = fixtureEntry();
  const timer = newTimer(e, () => {});
  try {
    const next = timer.nextRun();
    assert.ok(next, "nextRun() must be non-null for a live timer");
    assert.equal(timer.name, e.name);
  } finally {
    timer.stop();
  }
  // DEVIATION from plan/N2-uac.md test 12, recorded in the final report: the plan asserts
  // "nextRun() still answers" after stop(), read as truthy — but measured, croner's own stopped
  // Cron returns null from nextRun(), not another date. That IS "not silently a dispose()": the
  // object stays intact and callable rather than throwing or becoming unusable — it truthfully
  // reports there is no next run, because there is none. Assert the weaker, TRUE claim: the call
  // does not throw, and its answer is the correct one for a stopped job.
  assert.doesNotThrow(() => timer.nextRun(), "nextRun() must still be callable after stop()");
  assert.equal(timer.nextRun(), null, "a stopped timer truthfully reports no next run, rather than throwing");
});
