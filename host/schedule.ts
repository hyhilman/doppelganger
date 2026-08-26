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
import { existsSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import type { Mode } from "../kernel/runtime/gate.ts";
import { projectPath, ROOT } from "../kernel/paths.ts";
import { stageOf, MISC, STAGES } from "../kernel/stages.ts";
import { LOG_ROOTS } from "../kernel/runtime/log/tail.ts";
import { RESOURCE_NAMES, REFRESH_WINDOW, type RefreshWindow } from "./config.ts";
import { parseFive } from "./cron.ts";

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

/**
 * The one-line shell command a `supervised: false` entry renders into the crontab bootstrap block
 * (SUP-08, `cli/crontab.ts`, J2.15) — exported so validate()'s rule 23 and the crontab renderer
 * never spell it twice. Deterministic and pure: no path is resolved here beyond the already-
 * computed `ROOT` constant.
 */
export function commandOf(e: ScheduleEntry): string {
  const target = e.job !== undefined ? `host/jobs/${e.job}.ts` : (e.script ?? "");
  return `cd ${ROOT} && node ${target} >> ${e.log} 2>&1`;
}

/** A `%` not preceded by `\` — cron reads an unescaped `%` as a newline, and everything after it
 *  becomes the command's stdin (rule 23). */
const UNESCAPED_PERCENT = /(?<!\\)%/;

export interface ValidateOpts {
  readonly programs?: Readonly<Record<string, Program>>;
  readonly resourceNames?: readonly string[];
  readonly refreshWindow?: RefreshWindow | null;
  readonly logRoots?: readonly string[];
  readonly jobsDir?: string;
  readonly root?: string;
}

/**
 * SUP-05: the boot gate. Collects every fault over every entry (SUPERVISED OR NOT — the
 * bootstrap-only ones need checking too, since crontab check calls this) and throws ONCE, each
 * line naming its entry. `opts` defaults to the real values, computed HERE rather than at module
 * scope (J2.3 door 6), so a caller writes `validate()` and a test writes
 * `validate([e], { logRoots: [tmp] })`.
 *
 * `validate([])` does not throw (host/validate.test.ts test 1) — an empty schedule is valid BY
 * DECISION, not by the absence of a subject to check.
 */
export function validate(entries: readonly ScheduleEntry[] = SCHEDULE, opts: ValidateOpts = {}): void {
  const {
    programs = PROGRAMS,
    resourceNames = RESOURCE_NAMES,
    refreshWindow = REFRESH_WINDOW,
    logRoots = LOG_ROOTS,
    jobsDir = projectPath("host/jobs"),
    root = ROOT,
  } = opts;

  const errs: string[] = [];
  const err = (name: string, msg: string): void => {
    errs.push(`entry "${name}": ${msg}`);
  };

  const seenNames = new Set<string>();
  let sawBootstrap = false;

  for (const e of entries) {
    // 1. duplicate name
    if (seenNames.has(e.name)) err(e.name, "duplicate name");
    seenNames.add(e.name);

    // 2. stage prefix (SUP-20)
    if (stageOf(e.name) === MISC) {
      err(e.name, `name carries no known stage prefix (SUP-20): one of ${STAGES.join(", ")}`);
    }

    // 3/4. cron shape and grammar
    const cronFields = e.cron.trim().split(/\s+/);
    if (cronFields.length !== 5) {
      err(e.name, `cron must be exactly 5 whitespace-separated fields, got ${cronFields.length}: ${JSON.stringify(e.cron)}`);
    } else {
      const pr = parseFive(e.cron);
      if (!pr.ok) for (const p of pr.problems) err(e.name, `cron: ${p}`);
    }

    // 5/6. log absolute, and under a known root
    if (!isAbsolute(e.log)) {
      err(e.name, `log must be an absolute path: ${JSON.stringify(e.log)}`);
    } else if (!logRoots.some((r) => e.log === r || e.log.startsWith(r + sep))) {
      err(e.name, `log ${JSON.stringify(e.log)} is not under a known log root (SUP-18): [${logRoots.join(", ")}]`);
    }

    // 7. why non-empty
    if (e.why.trim().length === 0) err(e.name, "why must be non-empty");

    // 8/9. exactly one of job/script
    if (e.job !== undefined && e.script !== undefined) err(e.name, "both job and script are set");
    if (e.job === undefined && e.script === undefined) err(e.name, "neither job nor script is set");

    // 10. job file exists
    if (e.job !== undefined) {
      const p = join(jobsDir, `${e.job}.ts`);
      if (!existsSync(p)) err(e.name, `job file does not exist: ${p}`);
    }

    // 11/12. script exists, and is project-relative
    if (e.script !== undefined) {
      if (isAbsolute(e.script)) {
        err(e.name, `script must be project-relative, not absolute (INS-02): ${JSON.stringify(e.script)}`);
      } else {
        const p = join(root, e.script);
        if (!existsSync(p)) err(e.name, `script does not exist: ${p}`);
      }
    }

    // 13. maxRunMin > 0
    if (e.maxRunMin !== undefined && !(e.maxRunMin > 0)) {
      err(e.name, `maxRunMin must be > 0, got ${e.maxRunMin}`);
    }

    // 14-20: the program row
    const program = programs[programOf(e)];
    if (!program) {
      err(e.name, `no PROGRAMS row for program ${JSON.stringify(programOf(e))}`);
    } else {
      if (program.resources) {
        for (const r of program.resources) {
          if (!resourceNames.includes(r)) {
            err(e.name, `program ${JSON.stringify(programOf(e))} names unknown resource ${JSON.stringify(r)}`);
          }
        }
      }
      if (program.gate === "shared" && program.resources !== undefined) {
        err(e.name, `program ${JSON.stringify(programOf(e))}: gate "shared" must not set resources — a reader takes all`);
      }
      if (program.gate === "none" && (!program.whyNoGate || program.whyNoGate.trim().length === 0)) {
        err(e.name, `program ${JSON.stringify(programOf(e))}: gate "none" requires a non-empty whyNoGate (GAT-07)`);
      }
      if (typeof program.dotenv !== "boolean") {
        err(e.name, `program ${JSON.stringify(programOf(e))}: dotenv must be a boolean`);
      }
      if (e.gateWait && program.gate === "none") {
        err(e.name, `gateWait is set but program ${JSON.stringify(programOf(e))} has gate "none" — nothing to wait for`);
      }
      if (e.clearsRefreshWindow && program.gate === "none") {
        err(e.name, `clearsRefreshWindow is set but program ${JSON.stringify(programOf(e))} has gate "none" — it blocks nothing`);
      }
    }

    // 21. clearsRefreshWindow needs a real window
    if (e.clearsRefreshWindow && refreshWindow === null) {
      err(e.name, "clearsRefreshWindow is set but host/config.ts's REFRESH_WINDOW is null — there is nothing to clear");
    }

    // 22. at most one supervised: false (SUP-09 says exactly one; an empty schedule has zero)
    if (e.supervised === false) {
      if (sawBootstrap) {
        err(e.name, "more than one entry sets supervised: false (SUP-09) — at most one is allowed");
      }
      sawBootstrap = true;

      // 23. unescaped % in the rendered bootstrap command
      const cmd = commandOf(e);
      if (UNESCAPED_PERCENT.test(cmd)) {
        err(e.name, `rendered bootstrap command contains an unescaped % (SUP-08): ${JSON.stringify(cmd)}`);
      }
    }
  }

  if (errs.length > 0) {
    throw new Error(`host/schedule.ts is invalid:\n  - ${errs.join("\n  - ")}`);
  }
}
