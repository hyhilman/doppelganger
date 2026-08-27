// The refresh-window allowlist: which schedule entries may legally fire inside `REFRESH_WINDOW`,
// a checked claim rather than a reading of six hour fields.
//
// Lives in its own file rather than host/config.ts or host/schedule.ts: config.ts would need
// `ScheduleEntry`/`Program` from schedule.ts, but schedule.ts already imports config.ts for
// `RefreshWindow` — a cycle. schedule.ts itself shouldn't grow a window-specific concern that
// isn't about scheduling shape.
//
// The minute-for-minute walk (host/window.test.ts tests 1-3) checks `inRefreshWindow` against an
// independently written predicate over all 10,080 minutes of a week. `entriesInWindow` is real,
// tested machinery, but `REFRESH_WINDOW` itself is still `null` — no phase yet needs a real
// maintenance window, and inventing one for a single job would be inventing the subject. So the
// live call `entriesInWindow(SCHEDULE, REFRESH_WINDOW, PROGRAMS)` still returns `[]` — a checked
// claim ("nothing needs excusing"), not a placeholder; host/window.test.ts separately drives this
// function over the real `SCHEDULE`/`PROGRAMS` with a fixture window, which is not vacuous.
// REMINDER: when a phase needs a real, non-null `REFRESH_WINDOW`, wire the live call for real in
// place of this note.
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
 * fire time — never a second reading of the window's fields, which is the drift this row exists to
 * catch (two spellings of the same window disagreeing, silently, forever).
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
