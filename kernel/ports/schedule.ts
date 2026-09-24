// PRT-06: the ScheduleEntry shape, re-homed here from host/schedule.ts, interface only.
// `validate()`, `PROGRAMS`, `SCHEDULE` and the rest of the validation logic stay in
// host/schedule.ts, which re-exports this type.
//
// The re-export there is two statements, not one: host/schedule.ts uses `ScheduleEntry` in its
// own signatures, and `export ... from` re-exports a name without binding it locally — one line
// fails typecheck with TS2304.

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
  /** Drop this firing before the self-lock and before the gate, while a refresh window is open.
   *  Refused by `validate()` while `host/config.ts`'s `REFRESH_WINDOW` is null. */
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
