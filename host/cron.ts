// The croner seam. This is the ONLY file that imports `croner` (test/deps.test.ts asserts it);
// everything else reads a cron expression through `parseFive`, `tickSeconds` or `gateWait`, never
// through the library directly.
//
// `host/cron.ts` reads cron EXPRESSIONS; `cli/crontab.ts` writes the user's CRONTAB. They share
// four letters and nothing else.
//
// `gateWait(cron)` derives "one of the entry's own ticks" from croner's OWN enumeration rather
// than a hand-written parser, because the supervisor fires croner's timer, not a parser this repo
// wrote. `gateWait(expr) <= tickSeconds(expr)` always (GAT-09) — waiting LONGER than your own
// interval is strictly worse than skipping: you hold your self-lock through the ticks you were
// trying to avoid skipping.
//
// A LIVE `Cron` HOLDS THE EVENT LOOP OPEN. Any test that builds one with `newTimer` must call
// `.stop()` in a `finally` — without it, a `node --test` file hangs.
import { Cron } from "croner";
import { envNum, type EnvSpec } from "../kernel/config.ts";
import type { ScheduleEntry } from "./schedule.ts";

/**
 * Sunday 22 February 2026, 00:00 UTC. Fixed, never `Date.now()` — a moving anchor would make
 * `gateWait` differ run to run and `crontab check` report drift that is not there. Three reasons
 * for THIS date: it is a Sunday, so all seven weekdays appear in the first seven days · February
 * 2026 has 28 days, so a 14-day window crosses a month end on day seven, exactly where croner and
 * POSIX disagree · and it never changes.
 */
export const CRON_ANCHOR = Date.UTC(2026, 1, 22);

export const GATE_WAIT_CAP_S_ENV: EnvSpec = {
  key: "GATE_WAIT_CAP_S",
  default: "1800",
  why: "longest a gate writer may block — a job whose own tick is rarer than this waits the cap, not its interval (GAT-08)",
};
export const GATE_WAIT_CAP_S: number = envNum(GATE_WAIT_CAP_S_ENV);

// ---------------------------------------------------------------------------------------------
// parseFive — the intersection grammar: only what croner AND POSIX crontab both accept. Reports
// every problem, never just the first.
// ---------------------------------------------------------------------------------------------

interface FieldSpec {
  readonly name: string;
  readonly min: number;
  readonly max: number;
}

// minute, hour, dom, month, dow — in this order, always.
const FIELDS: readonly FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dom", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "dow", min: 0, max: 7 }, // 7 ≡ 0 (Sunday)
];

const PART_RE = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/;

/** Parses one comma-separated part of one field. Pushes every problem it finds onto `problems`
 *  and returns whether the part was clean. */
function parsePart(part: string, field: FieldSpec, problems: string[]): boolean {
  const m = PART_RE.exec(part);
  if (!m) {
    problems.push(`${field.name}: ${JSON.stringify(part)} is not a recognised value`);
    return false;
  }
  const [, startTok, endTok, stepTok] = m as unknown as [string, string, string | undefined, string | undefined];
  const isStar = startTok === "*";
  let ok = true;

  if (!isStar && endTok === undefined && stepTok !== undefined) {
    problems.push(
      `${field.name}: ${JSON.stringify(part)} — a step needs a range; spell it as N-max/S or */S`,
    );
    return false;
  }

  const normalize = (n: number): number => (field.name === "dow" && n === 7 ? 0 : n);
  const checkBound = (raw: string, n: number, label: string): void => {
    if (n < field.min || n > field.max) {
      problems.push(`${field.name}: ${label} ${JSON.stringify(raw)} is out of range [${field.min},${field.max}]`);
      ok = false;
    }
  };

  let start = field.min;
  let end = field.max;
  if (!isStar) {
    const n = normalize(Number(startTok));
    checkBound(startTok, n, "value");
    start = n;
    end = n;
    if (endTok !== undefined) {
      const e = normalize(Number(endTok));
      checkBound(endTok, e, "range end");
      end = e;
      if (start > end) {
        problems.push(`${field.name}: range ${part} has start > end`);
        ok = false;
      }
    }
  }

  if (stepTok !== undefined) {
    const s = Number(stepTok);
    // Bounded by the field's CARDINALITY (max - min + 1), not by field.max: measured, croner
    // accepts "0-59/60 * * * *" (minute cardinality 60) as a once-an-hour firing and rejects
    // "0-59/61" as "steps cannot be greater than maximum value of part (60)" — the bound is the
    // count of values the field can take, not the largest single value in it.
    const cardinality = field.max - field.min + 1;
    if (s < 1 || s > cardinality) {
      problems.push(`${field.name}: step ${JSON.stringify(stepTok)} must be between 1 and ${cardinality}`);
      ok = false;
    }
  }

  return ok;
}

export type ParseResult = { readonly ok: true } | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Exactly five whitespace-separated fields, each a comma list of `*` | `N` | `N-M`, optionally
 * `/S`. `dom` and `dow` may not both be restricted (POSIX's OR-the-two-day-fields semantics is
 * outside what croner's `nextRun` actually fires on). Finally, `new Cron(expr, { paused: true })`
 * must not throw, as a backstop for anything the rules above did not anticipate.
 */
export function parseFive(expr: string): ParseResult {
  const problems: string[] = [];
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return { ok: false, problems: [`expected exactly 5 fields, got ${fields.length}: ${JSON.stringify(expr)}`] };
  }

  const fieldOk: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    const field = FIELDS[i]!;
    let ok = true;
    for (const part of fields[i]!.split(",")) {
      if (!parsePart(part, field, problems)) ok = false;
    }
    fieldOk.push(ok);
  }

  if (fieldOk[2] && fieldOk[4]) {
    const domText = fields[2]!;
    const dowText = fields[4]!;
    if (domText !== "*" && dowText !== "*") {
      problems.push(`dom and dow may not both be restricted: dom=${JSON.stringify(domText)} dow=${JSON.stringify(dowText)}`);
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  try {
    new Cron(expr, { paused: true });
  } catch (e) {
    return {
      ok: false,
      problems: [`croner rejected ${JSON.stringify(expr)}: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// firings / tickSeconds / gateWait — derived from croner's own nextRun, so no cron parser ships.
// ---------------------------------------------------------------------------------------------

/**
 * Every firing of `expr` in `[fromMs, toMs]`, ascending. When `stopAtS` is given, stops as soon as
 * a consecutive gap `<= stopAtS` is seen — the early stop GAT-08's `gateWait` needs to stay usable
 * (see the module header and host/cron.test.ts test 10 for the measured cost of not having it).
 */
export function firings(expr: string, fromMs: number, toMs: number, stopAtS?: number): number[] {
  const c = new Cron(expr, { paused: true, timezone: "UTC" });
  const out: number[] = [];
  let cursor: Date = new Date(fromMs - 60_000);
  let prevMs: number | null = null;
  for (;;) {
    const next = c.nextRun(cursor);
    if (next === null) break;
    const t = next.getTime();
    if (t > toMs) break;
    out.push(t);
    if (stopAtS !== undefined && prevMs !== null && (t - prevMs) / 1000 <= stopAtS) break;
    prevMs = t;
    cursor = next;
  }
  return out;
}

/**
 * The smallest consecutive gap between firings of `expr`, in seconds, over `days` days from
 * `CRON_ANCHOR`. `0` when fewer than two firings turn up in the window — the caller reads `0` as
 * "rarer than the window" and takes the cap. `days` defaults to 21: a weekly expression needs more
 * than 14 days to show two firings, so `gateWait` (which needs the true tick) uses 21; the parity
 * walk uses 14 because SUP-07 says so — one anchor, two lengths, each with its own reason.
 */
export function tickSeconds(expr: string, days = 21, stopAtS?: number): number {
  const fromMs = CRON_ANCHOR;
  const toMs = CRON_ANCHOR + days * 86_400_000;
  const times = firings(expr, fromMs, toMs, stopAtS);
  let min = Infinity;
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i]! - times[i - 1]!) / 1000;
    if (gap < min) min = gap;
  }
  return Number.isFinite(min) ? min : 0;
}

const gateWaitCache = new Map<string, number>();

/**
 * `min(tickSeconds(expr), GATE_WAIT_CAP_S)`, memoised — the same entry asks the same question
 * every tick (GAT-08). Uses the early stop, so this stays cheap even for a dense expression.
 */
export function gateWait(expr: string): number {
  const cached = gateWaitCache.get(expr);
  if (cached !== undefined) return cached;
  const tick = tickSeconds(expr, 21, GATE_WAIT_CAP_S);
  const result = tick > 0 ? Math.min(tick, GATE_WAIT_CAP_S) : GATE_WAIT_CAP_S;
  gateWaitCache.set(expr, result);
  return result;
}

// ---------------------------------------------------------------------------------------------
// newTimer — the slice of croner's Cron this repo depends on.
// ---------------------------------------------------------------------------------------------

/** The slice of croner's `Cron` this repo depends on — narrow on purpose, so a caller (and a
 *  test) reasons about exactly this, not croner's whole surface. */
export interface Timer {
  readonly name: string | undefined;
  nextRun(from?: Date): Date | null;
  stop(): void;
}

/**
 * `protect: false` on purpose: overlap protection is a per-PROGRAM property and `PROGRAMS[].self`
 * (GAT-06) already states it — two mechanisms for one question is how they drift apart.
 * `catch: true` so a thrown job function does not crash the supervisor process.
 */
export function newTimer(e: ScheduleEntry, fn: () => void): Timer {
  return new Cron(e.cron, { timezone: "UTC", name: e.name, protect: false, catch: true }, fn);
}

/**
 * `true` if `date` matches `expr`, straight from croner's own `Cron.match` — independent of
 * `nextRun`'s iterator. The opt-in re-measure (`CRON_PARITY_RECHECK=1`) is the one caller: it
 * needs a croner answer that does NOT go through the same iterator `nextRun`/`firings` do, or a
 * `nextRun` bug and a `match` check would just be testing the same code path twice. host/cron.ts
 * stays the ONLY file importing croner (test/deps.test.ts).
 */
export function cronMatch(expr: string, date: Date): boolean {
  return new Cron(expr, { paused: true, timezone: "UTC" }).match(date);
}
