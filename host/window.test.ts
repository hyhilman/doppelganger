// J2.17 (SUP-12, TST-15) — the refresh-window allowlist and a minute-for-minute walk of its
// predicate.
//
// AC1: the first draft of this file had 8 tests; the live-allowlist one —
// `entriesInWindow(SCHEDULE, REFRESH_WINDOW, PROGRAMS)` deep-equals `[]`, over an empty schedule
// and REFRESH_WINDOW === null — is deleted. `[] === []` cannot fail; an assertion that cannot fail
// reads in review as coverage of the live schedule when it is coverage of nothing. host/window.ts's
// own header names the reminder for N3, which is where that call belongs once it has a subject.
//
// Test 1's `localOpeningMinutes`/`localInWindow` are written a DIFFERENT way than
// `inRefreshWindow`'s own modular-interval test: a Set of every open minute, built up front, and
// membership-tested — never another interval comparison. Writing the same algorithm twice would
// make this walk a copy, not a check; AC2 (closing the interval) is what proves the difference.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inRefreshWindow, type RefreshWindow } from "./config.ts";
import { entriesInWindow } from "./window.ts";
import type { ScheduleEntry, Program } from "./schedule.ts";

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

// Sunday, UTC — minute-of-week 0 is dow 0 with no offset (plan/N2-uac.md J2.17 DO item 1).
const BASE = Date.UTC(2026, 1, 22);

function localParseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Built up front, not as an interval test — see the module header. */
function localOpeningMinutes(w: RefreshWindow): Set<number> {
  const open = new Set<number>();
  for (const dow of w.opensDow) {
    const start = dow * MINUTES_PER_DAY + localParseHHMM(w.opensAt);
    for (let i = 0; i < w.lengthMin; i++) {
      open.add((start + i) % MINUTES_PER_WEEK);
    }
  }
  return open;
}

function localInWindow(at: Date, open: Set<number>): boolean {
  const minute = at.getUTCDay() * MINUTES_PER_DAY + at.getUTCHours() * 60 + at.getUTCMinutes();
  return open.has(minute);
}

/** Walks all 10,080 minutes of one week from `base`, comparing production against the local
 *  predicate. Returns every disagreeing minute's description, so a failure can print the first
 *  five rather than only "not equal". */
function walk(w: RefreshWindow, base: number): string[] {
  const open = localOpeningMinutes(w);
  const disagreements: string[] = [];
  for (let t = 0; t < MINUTES_PER_WEEK; t++) {
    const at = new Date(base + t * 60_000);
    const production = inRefreshWindow(at, w);
    const local = localInWindow(at, open);
    if (production !== local) {
      disagreements.push(`t=${t} (${at.toISOString()}): production=${production} local=${local}`);
    }
  }
  return disagreements;
}

test("1. inRefreshWindow matches an independently built predicate, minute for minute over a week", () => {
  const w: RefreshWindow = { opensDow: [2], opensAt: "22:00", lengthMin: 90, why: "fixture: opens Tuesday 22:00 UTC" };
  const disagreements = walk(w, BASE);
  assert.deepEqual(disagreements.slice(0, 5), [], `${disagreements.length} disagreeing minute(s), first 5 shown`);
});

test("2. the walk holds across a window crossing Sunday midnight, and a two-day (multi-opening) window", () => {
  // Opens Saturday 23:30, runs 90 minutes — crosses the week boundary (minute-of-week 10079 -> 0).
  const crossing: RefreshWindow = { opensDow: [6], opensAt: "23:30", lengthMin: 90, why: "fixture: crosses the week boundary" };
  const crossingDisagreements = walk(crossing, BASE);
  assert.deepEqual(crossingDisagreements.slice(0, 5), [], `${crossingDisagreements.length} disagreeing minute(s), first 5 shown`);

  // Two openings per week — the multi-opening (opensDow.length > 1) case.
  const twoDay: RefreshWindow = { opensDow: [5, 6], opensAt: "20:00", lengthMin: 120, why: "fixture: Friday and Saturday" };
  const twoDayDisagreements = walk(twoDay, BASE);
  assert.deepEqual(twoDayDisagreements.slice(0, 5), [], `${twoDayDisagreements.length} disagreeing minute(s), first 5 shown`);
});

test("3. a window longer than a day still agrees minute for minute", () => {
  const long: RefreshWindow = { opensDow: [3], opensAt: "10:00", lengthMin: 2000, why: "fixture: spans more than one day" };
  const disagreements = walk(long, BASE);
  assert.deepEqual(disagreements.slice(0, 5), [], `${disagreements.length} disagreeing minute(s), first 5 shown`);
});

function entry(over: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    name: "watch-window-fixture",
    cron: "* * * * *",
    log: "/tmp/dg-window-unused.log",
    job: "probe",
    why: "fixture entry for host/window.test.ts",
    ...over,
  };
}

function program(over: Partial<Program> = {}): Program {
  return { self: true, gate: "excl", dotenv: false, ...over };
}

// Opens Monday 03:00 UTC for 60 minutes -> closes 04:00.
const WINDOW: RefreshWindow = { opensDow: [1], opensAt: "03:00", lengthMin: 60, why: "fixture window for entriesInWindow" };

test("4. entriesInWindow over a fixture: one fires only inside, one only outside, one both", () => {
  const insideOnly = entry({ name: "watch-inside", job: "inside", cron: "30 3 * * 1" }); // Mon 03:30
  const outsideOnly = entry({ name: "watch-outside", job: "outside", cron: "0 12 * * 1" }); // Mon 12:00
  const both = entry({ name: "watch-both", job: "both", cron: "*/20 * * * *" }); // every 20 min, all week
  const programs: Record<string, Program> = { inside: program(), outside: program(), both: program() };

  const result = entriesInWindow([insideOnly, outsideOnly, both], WINDOW, programs);
  assert.deepEqual(
    result.map((r) => r.name).sort(),
    ["watch-both", "watch-inside"].sort(),
  );
});

test("5. entriesInWindow skips a clearsRefreshWindow entry, but not its unflagged neighbor", () => {
  const flagged = entry({ name: "watch-flagged", job: "flagged", cron: "30 3 * * 1", clearsRefreshWindow: true });
  const unflagged = entry({ name: "watch-unflagged", job: "unflagged", cron: "45 3 * * 1" });
  const programs: Record<string, Program> = { flagged: program(), unflagged: program() };

  const result = entriesInWindow([flagged, unflagged], WINDOW, programs);
  assert.deepEqual(result.map((r) => r.name), ["watch-unflagged"]);
});

test("6. entriesInWindow is tied to the same inRefreshWindow the supervisor calls, at the boundary", () => {
  const before = entry({ name: "watch-before", job: "before", cron: "59 2 * * 1" }); // Mon 02:59 — one minute before opening
  const after = entry({ name: "watch-after", job: "after", cron: "1 3 * * 1" }); // Mon 03:01 — one minute after opening
  const programs: Record<string, Program> = { before: program(), after: program() };

  const result = entriesInWindow([before, after], WINDOW, programs);
  assert.deepEqual(result.map((r) => r.name), ["watch-after"]);
});

test("7. entriesInWindow reports each entry's program's gate mode alongside its name", () => {
  const exclEntry = entry({ name: "watch-excl", job: "excl-job", cron: "30 3 * * 1" });
  const noneEntry = entry({ name: "watch-none", job: "none-job", cron: "31 3 * * 1" });
  const programs: Record<string, Program> = {
    "excl-job": program({ gate: "excl" }),
    "none-job": program({ gate: "none", self: false, whyNoGate: "fixture: no state to protect" }),
  };

  const result = entriesInWindow([exclEntry, noneEntry], WINDOW, programs);
  const byName = new Map(result.map((r) => [r.name, r.gate]));
  assert.equal(byName.get("watch-excl"), "excl");
  assert.equal(byName.get("watch-none"), "none");
});
