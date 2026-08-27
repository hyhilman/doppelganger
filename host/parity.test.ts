// croner-vs-POSIX parity over a fixed 14-day window, with a strict
// independent oracle.
//
// THE ORACLE, NAMED EXACTLY. A hand-written POSIX matcher, living in THIS FILE, importing nothing
// from host/cron.ts for its OWN logic — only `firings`, `parseFive` and `CRON_ANCHOR` cross the
// boundary, and those are the PRODUCTION side being checked, not the oracle. Not a second library:
// that would move the question one hop and add a dependency to answer a question about a
// dependency. Three properties make it an oracle rather than a second copy of our own bug:
//   1. it is a DIFFERENT SHAPE — a matcher over a walked window, not an iterator;
//   2. it is STRICT — throws on anything it cannot expand (test 3), so a silently partial
//      expansion cannot pass as "the expression is just sparse" (test 1/AC5 is what this buys);
//   3. it is pinned by literal data (test 2), so if croner and the oracle ever agree on something
//      wrong, the pinned table still disagrees.
//
// NO ASSERTION IN THIS FILE SAYS CRONER IS WRONG — that claim is about a package outside this repo
// and would rot the day croner fixes it. Measured 2026-08-26, croner 10.0.1 / Node 22.23.1:
// nextRun() vs the oracle over 2024-2032 x dow 0-6 x dom {1,2,15,29,30,31} (42 expressions) misses
// 20 (expression, date) pairs across 14 distinct dates, every one in March — the first days of
// March specifically, not a 28-day-February artifact (2024-03-01 and 2028-03-01 are both after a
// 29-day LEAP February). match() itself agrees with the oracle 30,660/30,660 over the same
// expressions — the fault is in nextRun's day-advance, not in croner's pattern semantics, which is
// why validate() (J2.9, via parseFive) refuses the dom+dow-both-restricted class outright rather
// than working around the iterator. Re-measure with CRON_PARITY_RECHECK=1 (test 7) — it prints,
// never asserts, so a croner fix shows up as a shorter list, not a red suite.

import { test } from "node:test";
import assert from "node:assert/strict";
import { firings, parseFive, cronMatch, newTimer, CRON_ANCHOR } from "./cron.ts";
import { SCHEDULE, type ScheduleEntry } from "./schedule.ts";

const START = CRON_ANCHOR;
const END = START + 14 * 86_400_000;

// ---------------------------------------------------------------------------------------------
// The oracle
// ---------------------------------------------------------------------------------------------

interface OracleField {
  readonly values: ReadonlySet<number>;
  readonly restricted: boolean; // field text !== "*"
}

/** Expands one comma-separated field into the set of values it names, over [min, max]. THROWS on
 *  anything it cannot expand (property 2 above) — a name, a step with no range, an out-of-range
 *  value, anything not `*` | `N` | `N-M`, optionally `/S`. */
function expandField(text: string, min: number, max: number): OracleField {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`oracle: cannot expand ${JSON.stringify(part)} in field ${JSON.stringify(text)}`);
    const [, startTok, endTok, stepTok] = m;
    const isStar = startTok === "*";
    if (!isStar && endTok === undefined && stepTok !== undefined) {
      throw new Error(`oracle: ${JSON.stringify(part)} — a step needs a range (N-max/S or */S)`);
    }
    let start: number;
    let end: number;
    if (isStar) {
      start = min;
      end = max;
    } else {
      start = Number(startTok);
      end = endTok !== undefined ? Number(endTok) : start;
      if (start > end || start < min || end > max) {
        throw new Error(`oracle: ${JSON.stringify(part)} out of range [${min},${max}]`);
      }
    }
    const step = stepTok !== undefined ? Number(stepTok) : 1;
    const cardinality = max - min + 1;
    if (!Number.isInteger(step) || step < 1 || step > cardinality) {
      throw new Error(`oracle: bad step in ${JSON.stringify(part)}`);
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return { values, restricted: text !== "*" };
}

interface OracleExpr {
  readonly minute: OracleField;
  readonly hour: OracleField;
  readonly dom: OracleField;
  readonly month: OracleField;
  readonly dow: OracleField;
}

/** Parses a full 5-field POSIX expression. `dow` accepts 0-7, and 7 maps to 0 AFTER expansion —
 *  `0-7` expands to all seven days first, THEN 7 folds onto 0, rather than the range collapsing to
 *  `0-0` before it is walked. */
function parseOracle(expr: string): OracleExpr {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`oracle: expected 5 fields, got ${fields.length}: ${JSON.stringify(expr)}`);
  }
  const minute = expandField(fields[0]!, 0, 59);
  const hour = expandField(fields[1]!, 0, 23);
  const dom = expandField(fields[2]!, 1, 31);
  const month = expandField(fields[3]!, 1, 12);
  const dowRaw = expandField(fields[4]!, 0, 7);
  const dow: OracleField = {
    values: new Set([...dowRaw.values].map((v) => (v === 7 ? 0 : v))),
    restricted: dowRaw.restricted,
  };
  return { minute, hour, dom, month, dow };
}

/** POSIX's rule: when BOTH dom and dow are restricted, the two are ORed; otherwise (either or
 *  both `*`) they are ANDed, which for an unrestricted `*` field is a no-op since it matches
 *  everything. */
function oracleMatches(date: Date, p: OracleExpr): boolean {
  if (!p.minute.values.has(date.getUTCMinutes())) return false;
  if (!p.hour.values.has(date.getUTCHours())) return false;
  if (!p.month.values.has(date.getUTCMonth() + 1)) return false;
  const domHit = p.dom.values.has(date.getUTCDate());
  const dowHit = p.dow.values.has(date.getUTCDay());
  if (p.dom.restricted && p.dow.restricted) return domHit || dowHit;
  return domHit && dowHit;
}

/** Every minute in `[startMs, endMs)` that `expr` matches, as ISO strings. THROWS if `expr`
 *  cannot be expanded — never silently returns an empty set for a token it does not understand. */
function oracleFirings(expr: string, startMs: number, endMs: number): string[] {
  const p = parseOracle(expr);
  const out: string[] = [];
  for (let t = startMs; t < endMs; t += 60_000) {
    if (oracleMatches(new Date(t), p)) out.push(new Date(t).toISOString());
  }
  return out;
}

/** croner's own enumeration over the SAME half-open window, for comparison. `endMs - 1` because
 *  `firings()`'s own `toMs` bound is inclusive and the oracle's walk is exclusive at `endMs`. */
function cronerFirings(expr: string, startMs: number, endMs: number): string[] {
  return firings(expr, startMs, endMs - 1).map((t) => new Date(t).toISOString());
}

// ---------------------------------------------------------------------------------------------
// The corpus — one entry per grammar production plus the shapes a real schedule uses, PLUS every
// expression in the live SCHEDULE (empty today, non-empty from N3 — see test 1).
// ---------------------------------------------------------------------------------------------

const FORMS: readonly string[] = [
  "* * * * *", // every minute — the ops-lease-reap shape (N4)
  "*/5 * * * *", // bare step
  "*/10 15-21 * * *", // step inside an hour range, ~17h across the day boundary
  "1-51/10 15-21 * * *", // range with a step and a non-zero origin
  "0,10,20,30 22 * * *", // comma list
  "3,18,33,48 * * * *", // comma list, no hour restriction
  "4-59/5 * * * 1-4", // range+step with a dow range
  "2-57/5 * * * 1-4", // the same, offset — the pair that must not collide
  "13-58/15 1-10 * * 1-5", // range+step in both minute and hour
  "10-50/13 * * * *", // a step that does not divide the range
  "0-59/60 * * * *", // a step equal to the field width
  "*/13 2-20/3 * * *", // steps in two fields
  "45 * * * *", // hourly
  "53 8 * * *", // daily
  "0 23 * * 5,6", // two weekly legs
  "0 1 * * 0,6", // weekend, with 0 meaning Sunday
  "0 0 * * 7", // 7 as Sunday — the case the reference's oracle silently drops
  "30 23 * * 6", // a single weekday
  "0 22 * * 1-5", // weekdays
  "0 0 1 * *", // day-of-month only, crossing the month end
  "0 0 28-31 * *", // a dom range that overruns February
  "0 0 * 3 *", // a month restriction
];

test("1. parity over the corpus: croner and the oracle agree, minute for minute", () => {
  const corpus = [...FORMS, ...SCHEDULE.map((e) => e.cron)];
  for (const expr of corpus) {
    const oracle = oracleFirings(expr, START, END);
    const croner = cronerFirings(expr, START, END);
    assert.ok(oracle.length > 0, `${expr}: a form that fires zero times in 14 days proves nothing`);
    assert.deepEqual(
      croner,
      oracle,
      `${expr}: croner and the oracle disagree (first oracle minute ${oracle[0]}, first croner minute ${croner[0]})`,
    );
  }
});

test("2. the oracle is pinned by literal data, independent of croner", () => {
  const pinned: readonly [string, number, number, readonly number[]][] = [
    ["*/5", 0, 59, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]],
    ["1-51/10", 0, 59, [1, 11, 21, 31, 41, 51]],
    ["0,10,20,30", 0, 59, [0, 10, 20, 30]],
    ["3,18,33,48", 0, 59, [3, 18, 33, 48]],
    ["4-59/5", 0, 59, [4, 9, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59]],
    ["2-57/5", 0, 59, [2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57]],
    ["13-58/15", 0, 59, [13, 28, 43, 58]],
    ["10-50/13", 0, 59, [10, 23, 36, 49]],
    ["0-59/60", 0, 59, [0]],
    ["*/13", 0, 59, [0, 13, 26, 39, 52]],
    ["*/10", 0, 59, [0, 10, 20, 30, 40, 50]],
  ];
  for (const [text, min, max, expected] of pinned) {
    const field = expandField(text, min, max);
    assert.deepEqual(
      [...field.values].sort((a, b) => a - b),
      [...expected],
      `${text}: expected ${JSON.stringify(expected)}`,
    );
  }
});

test("3. the oracle is strict: it throws rather than silently expanding to nothing", () => {
  // The reference bug this closes: a hand-written expander that returns [] for a token it cannot
  // parse reads as "the expression is sparse", not as "the oracle could not understand it".
  for (const expr of ["0 0 * * MON", "0 0 L * *", "5/10 * * * *", "0 0 * * 8", "10-5 * * * *"]) {
    assert.throws(
      () => oracleFirings(expr, START, START + 60_000),
      `${expr} must throw, never silently return an empty set`,
    );
  }
});

test("4. 7 is Sunday on both sides", () => {
  assert.deepEqual(cronerFirings("0 0 * * 7", START, END), cronerFirings("0 0 * * 0", START, END));
  assert.deepEqual(oracleFirings("0 0 * * 7", START, END), oracleFirings("0 0 * * 0", START, END));
  assert.deepEqual(oracleFirings("0 0 * * 0-7", START, END), oracleFirings("0 0 * * *", START, END));
});

test("5. the corpus is inside the grammar — every form in FORMS is accepted by parseFive", () => {
  for (const expr of FORMS) {
    const r = parseFive(expr);
    assert.equal(r.ok, true, `${expr}: FORMS must only contain expressions parseFive accepts`);
  }
});

test("6. the refused class is refused — parseFive reports a problem for every divergent or out-of-grammar form", () => {
  const refused = [
    "0 0 1 * 1", // measured nextRun divergence, inside this file's own window (2026-03-01)
    "0 0 1 * 2", // measured nextRun divergence, inside this file's own window
    "0 0 L * *",
    "0 0 * * 5#2",
    "@daily",
    "0 0 0 * * *",
    "0 0 * * MON",
  ];
  for (const expr of refused) {
    const r = parseFive(expr);
    assert.equal(r.ok, false, `${expr}: parseFive must refuse it — this is our grammar's rule, not a claim about croner`);
  }
});

test("7. opt-in re-measure: nextRun vs the oracle, and match() vs the oracle (CRON_PARITY_RECHECK=1)", (t) => {
  if (process.env.CRON_PARITY_RECHECK !== "1") {
    t.skip("set CRON_PARITY_RECHECK=1 to re-measure the croner nextRun/match split");
    return;
  }

  // dow 0-6 x dom {1,2,15,29,30,31}, BOTH restricted in the same expression (6 x 7 = 42) — this
  // is exactly the class validate() refuses (parseFive's dom+dow rule), and exactly where POSIX's
  // OR semantics and croner's nextRun iterator can disagree.
  const doms = [1, 2, 15, 29, 30, 31];
  const dows = [0, 1, 2, 3, 4, 5, 6];
  const exprs = doms.flatMap((d) => dows.map((w) => `0 0 ${d} * ${w}`));

  // Sweep 1: nextRun vs the oracle, 2024-2032, day by day at midnight. Per candidate date (never
  // a running cursor across days — a weekly dow-only expression would need many hops to reach
  // from a stale cursor, which is a search-depth artifact of the HARNESS, not a croner fact):
  // does nextRun(), asked from exactly one minute before this date, land exactly ON this date?
  const sweepStart = Date.UTC(2024, 0, 1);
  const sweepEnd = Date.UTC(2032, 0, 1);
  const missed: { expr: string; date: string }[] = [];
  for (const expr of exprs) {
    const p = parseOracle(expr);
    const timer = newTimer({ name: "probe", cron: expr, log: "x", why: "x", job: "probe" } as ScheduleEntry, () => {});
    try {
      for (let day = sweepStart; day < sweepEnd; day += 86_400_000) {
        const date = new Date(day);
        if (!oracleMatches(date, p)) continue;
        const next = timer.nextRun(new Date(date.getTime() - 60_000));
        if (next === null || next.getTime() !== date.getTime()) {
          missed.push({ expr, date: date.toISOString() });
        }
      }
    } finally {
      timer.stop();
    }
  }
  console.error(`[CRON_PARITY_RECHECK] nextRun vs oracle, 2024-2032: ${missed.length} missed pairs`);
  console.error(`[CRON_PARITY_RECHECK] distinct dates: ${new Set(missed.map((m) => m.date)).size}`);
  for (const m of missed) console.error(`[CRON_PARITY_RECHECK] missed: ${m.expr} @ ${m.date}`);

  // Sweep 2: match() vs the oracle, day by day, 2025-2028.
  const matchStart = Date.UTC(2025, 0, 1);
  const matchEnd = Date.UTC(2028, 0, 1);
  let agree = 0;
  let total = 0;
  for (const expr of exprs) {
    const p = parseOracle(expr);
    for (let day = matchStart; day < matchEnd; day += 86_400_000) {
      total++;
      const date = new Date(day);
      if (cronMatch(expr, date) === oracleMatches(date, p)) agree++;
    }
  }
  console.error(`[CRON_PARITY_RECHECK] match() vs oracle, 2025-2028: ${agree}/${total} agree`);
});
