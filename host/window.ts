// J2.17 (SUP-12, TST-15) — the refresh-window allowlist: which schedule entries may legally fire
// inside `REFRESH_WINDOW`, a checked claim rather than a reading of six hour fields.
//
// NOT in plan/N2-uac.md J2.17's stated "Files touched" (host/window.test.ts only) — this file is
// the production machinery that test imports. Same class of omission as J2.10's `cronMatch` and
// J2.12's kernel/config.ts touch: the plan describes `entriesInWindow` as if it already had a
// home, and it did not. `host/config.ts` cannot hold it (it would need `ScheduleEntry`/`Program`
// from `host/schedule.ts`, which already imports `host/config.ts` for `RefreshWindow` — a cycle),
// and `host/schedule.ts` shouldn't grow a window-specific concern that is not about scheduling
// shape. A new file matching the test's own name is the smallest honest fix.
//
// SUP-12 has two halves, in different states. The minute-for-minute walk (host/window.test.ts
// tests 1-3) is fully real: `inRefreshWindow` (host/config.ts, J2.6) exists today and is checked
// against an INDEPENDENTLY written predicate over all 10,080 minutes of a week. `entriesInWindow`
// itself is real, tested machinery (tests 4, 5, 7 use real fixtures) — and its one LIVE invocation
// was vacuous at N2, because `SCHEDULE` was empty: `entriesInWindow(SCHEDULE, REFRESH_WINDOW,
// PROGRAMS)` was always `[]`. That was not a placeholder — an empty list was a checked claim that
// nothing is excused, where a whole-week form could only ever pass or fail outright.
//
// UPDATE (J3.15): the first real entry, `nightly-sandcastle`, landed in `SCHEDULE` — the half of
// this reminder that was pending. `REFRESH_WINDOW` itself is STILL `null`: no roadmap phase yet
// declares one, and inventing a window for a single job would be inventing the subject (the same
// discipline N2 used to delete three vacuous assertions). `entriesInWindow(SCHEDULE,
// REFRESH_WINDOW, PROGRAMS)` therefore still returns `[]`, correctly — but host/window.test.ts now
// also drives `entriesInWindow` over the REAL `SCHEDULE`/`PROGRAMS` with a FIXTURE window covering
// 16:00-22:00 UTC, which is not vacuous: it asserts the one entry that exists, and two mutations
// (move its cron outside the window; change its program's gate) turn that assertion red. REMINDER:
// the day a phase needs a REAL, non-null `REFRESH_WINDOW` (a maintenance window a second scheduled
// entry must avoid), wire the live `entriesInWindow(SCHEDULE, REFRESH_WINDOW, PROGRAMS)` call for
// real, in place of this reminder — no phase on the roadmap claims that job yet.
import { firings, CRON_ANCHOR } from "./cron.ts";
import { inRefreshWindow, type RefreshWindow } from "./config.ts";
import { programOf, type ScheduleEntry, type Program } from "./schedule.ts";
import type { Mode } from "../kernel/runtime/gate.ts";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One entry's row in the allowlist report: its name, and its PROGRAM's gate mode. A name with no
 * reason is how an allowlist becomes a list of things somebody once approved (roadmap.md's own
 * words) — reporting the gate mode alongside the name is what lets a human reviewing the list see
 * that a `gate: "none"` program holds no slot to cost, rather than only that it appears.
 */
export interface WindowEntry {
  readonly name: string;
  readonly gate: Mode | "none";
}

/**
 * Every entry in `schedule` whose cron fires at least once inside `window`, checked over one full
 * week from `cron.ts`'s own `CRON_ANCHOR` through the SAME `inRefreshWindow` `runEntry` calls at
 * fire time (SUP-10/SUP-11) — never a second reading of the window's fields, which is the drift
 * this row exists to catch (two spellings of the same window disagreeing, silently, forever).
 *
 * `clearsRefreshWindow` entries are skipped: the supervisor drops those BEFORE the gate (`runEntry`
 * step 2, host/supervisor.ts), so their expression legitimately fires inside the window and they
 * need no exemption here — reporting them would make the allowlist ask for permission a flagged
 * entry already has by construction.
 *
 * `window === null` (N2's real value) reports nothing: there is no window to fire inside of.
 */
export function entriesInWindow(
  schedule: readonly ScheduleEntry[],
  window: RefreshWindow | null,
  programs: Readonly<Record<string, Program>>,
): readonly WindowEntry[] {
  if (window === null) return [];
  const out: WindowEntry[] = [];
  for (const e of schedule) {
    if (e.clearsRefreshWindow) continue;
    const times = firings(e.cron, CRON_ANCHOR, CRON_ANCHOR + WEEK_MS);
    const firesInside = times.some((t) => inRefreshWindow(new Date(t), window));
    if (!firesInside) continue;
    const program = programs[programOf(e)];
    out.push({ name: e.name, gate: program?.gate ?? "none" });
  }
  return out;
}
