// J2.7 (SUP-01, SUP-02, SUP-04, SUP-09, GAT-07, PRT-06) — the schedule as DATA: the two shapes,
// the two empty registries, and the one derivation (programOf) that keys everything else.
//
// SUP-01: the supervisor (host/supervisor.ts, J2.11/J2.13) imports THIS file and registers one
// croner timer per entry — an entry IS the schedule, read live, with no compiled copy to drift.
// The crontab (cli/crontab.ts, J2.15) holds only the entries carrying `supervised: false` — never
// a rendering of the whole schedule. cli/crontab.test.ts asserts that.
//
// SUP-09: `supervised: false` marks an entry the supervisor must NOT own. The bar is deliberately
// high — the only candidate anywhere in the roadmap is `watchdog` (JOB-O10, N4), because a
// liveness probe scheduled by the process it probes reports nothing in the case that matters.
//
// ScheduleEntry is PRT-06 verbatim. PRT-06 is an N5 row (kernel/ports/schedule.ts) and N2 has to
// build the thing now, so the interface lives here and moves to the port at N5 UNCHANGED — the
// same call N1 made for EnvSpec (KRN-06): ship the shape the port will carry, in the module that
// needs it, and re-home it later without rewriting it.
import type { Mode } from "../kernel/runtime/gate.ts";

export interface ScheduleEntry {
  readonly name: string;
  /** A 5-field cron expression, in the intersection J2.9's `validate()` accepts. */
  readonly cron: string;
  /** Where this entry's child stdout/stderr is appended (SUP-03, SUP-18). */
  readonly log: string;
  /** Extra env var NAMES this entry needs passed through — the only way past a program's
   *  `dotenv: false` (SUP-04). Never the values themselves; those come from the real environment. */
  readonly env?: readonly string[];
  /** Block for one of THIS entry's own ticks (GAT-08), derived by `gateWait(cron)` — never a
   *  hand-picked number. */
  readonly gateWait?: boolean;
  /** Drop this firing before the self-lock and before the gate, while a refresh window is open
   *  (SUP-10). Refused by `validate()` while `host/config.ts`'s `REFRESH_WINDOW` is null. */
  readonly clearsRefreshWindow?: boolean;
  /** SUP-13: the flag bounds where a pass may START, never how long it runs. */
  readonly maxRunMin?: number;
  /** Exactly one of `job`/`script` — the type does not enforce it because `validate()` must be
   *  able to REPORT "both set" and "neither set" as distinct, checked faults (SUP-05). */
  readonly job?: string;
  readonly script?: string;
  /** `false` for exactly one entry in the whole schedule (SUP-09); everything else is supervised
   *  by omission. */
  readonly supervised?: boolean;
  /** One line, required. Every entry states why it exists. */
  readonly why: string;
}

/** SUP-02, plus `whyNoGate` — an addition to the reference's field list, flagged in Gaps. GAT-07
 *  says a `gate: "none"` exemption states why; the reference states that in a code comment, which
 *  nothing can check. A required field makes the row refusable by `validate()` (J2.9) and turns a
 *  comment into a checked claim. */
export interface Program {
  /** The old `lock_self` — per PROGRAM, not per entry (GAT-06). */
  readonly self: boolean;
  readonly gate: Mode | "none";
  /** Writers only; omitted means all (GAT-02). */
  readonly resources?: readonly string[];
  /** SUP-04: load-bearing, no default. A knob reachable only from an entry's `env:` list is the
   *  mechanism that keeps a shared `.env` out of the programs that must not see it — a defaulted
   *  field would hand it to them silently. */
  readonly dotenv: boolean;
  /** Required when `gate === "none"` (GAT-07). */
  readonly whyNoGate?: string;
}

/** Keyed on PROGRAM name, never on entry name (GAT-06's self-exclusion key). Empty at N2 — no job
 *  and no program exists to register until N3. */
export const PROGRAMS: Readonly<Record<string, Program>> = {};

/** Empty at N2 by decision, not by accident — see host/schedule.test.ts test 1's own title. */
export const SCHEDULE: readonly ScheduleEntry[] = [];

/** The program an entry belongs to: `job`, else `script`, else the entry's own `name`. This is
 *  GAT-06's self-exclusion key and PROGRAMS' lookup key. */
export const programOf = (e: ScheduleEntry): string => e.job ?? e.script ?? e.name;

/** Entries the supervisor itself times (every entry except `supervised: false`). Takes the
 *  schedule as an argument, defaulting to the real one, so every test drives it with a fixture. */
export const supervisedEntries = (s: readonly ScheduleEntry[] = SCHEDULE): readonly ScheduleEntry[] =>
  s.filter((e) => e.supervised !== false);

/** The complement: entries the crontab bootstrap block times directly (SUP-08). */
export const bootstrapEntries = (s: readonly ScheduleEntry[] = SCHEDULE): readonly ScheduleEntry[] =>
  s.filter((e) => e.supervised === false);
