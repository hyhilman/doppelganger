// PRT-06: the ScheduleEntry shape, re-homed here from host/schedule.ts UNCHANGED — interface
// only. This is the J1.2 precedent: ship the shape in the module that needs it (host/schedule.ts,
// at N2, before this port existed), then re-home it later without rewriting it.
//
// What moved and what did not, so a reader who sees "PRT-06" in the commit does not assume the
// whole row is done: the SHAPE moved. The VALIDATION did not — `validate()`, `PROGRAMS`,
// `Program`, `SCHEDULE`, `commandOf`, `scriptCommandOf`, `supervisedEntries`, `bootstrapEntries`
// and `JOB_ENTRYPOINT` all stay in host/schedule.ts, which re-exports this type so none of its
// five non-test consumers (host/supervisor.ts, host/cron.ts, host/window.ts, cli/crontab.ts,
// host/jobs/ops-cron-check.ts) are edited, and neither are the nine test files that import it.
// `validate()`'s own re-home to kernel/ is not this job.
//
// The re-export in host/schedule.ts is two statements, not one, and it has to be: that file uses
// `ScheduleEntry` in eight of its own signatures, and `export ... from` re-exports a name without
// binding it locally. Collapsing the pair to one line fails typecheck with TS2304 eight times.

export interface ScheduleEntry {
  readonly name: string;
  /** A 5-field cron expression, in the intersection `validate()` accepts. */
  readonly cron: string;
  /** Where this entry's child stdout/stderr is appended. */
  readonly log: string;
  /**
   * Entry-declared overrides, applied LAST (`inherited < .env < env:`) — the only knob
   * reachable regardless of a program's `dotenv: false`. Key-value pairs, not a name list to pass
   * through from the parent: childEnv's formula spreads it as `{ ...parentEnv(), ...dotenvVars,
   * ...e.env }`, which is what SUP-04's own three-layer precedence needs — an entry's own literal
   * values, not a request to inherit named ones.
   */
  readonly env?: Readonly<Record<string, string>>;
  /** Block for one of THIS entry's own ticks, derived by `gateWait(cron)` — never a
   *  hand-picked number. */
  readonly gateWait?: boolean;
  /** Drop this firing before the self-lock and before the gate, while a refresh window is open
   *. Refused by `validate()` while `host/config.ts`'s `REFRESH_WINDOW` is null. */
  readonly clearsRefreshWindow?: boolean;
  /** SUP-13: the flag bounds where a pass may START, never how long it runs. */
  readonly maxRunMin?: number;
  /** Exactly one of `job`/`script` — the type does not enforce it because `validate()` must be
   *  able to REPORT "both set" and "neither set" as distinct, checked faults. */
  readonly job?: string;
  readonly script?: string;
  /** `false` for exactly one entry in the whole schedule; everything else is supervised
   *  by omission. */
  readonly supervised?: boolean;
  /** One line, required. Every entry states why it exists. */
  readonly why: string;
}
