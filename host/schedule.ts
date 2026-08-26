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
import { existsSync, statSync, readFileSync } from "node:fs";
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
  /**
   * Entry-declared overrides, applied LAST (`inherited < .env < env:`, SUP-04) — the only knob
   * reachable regardless of a program's `dotenv: false`. CORRECTION (J2.11): J2.7 originally typed
   * this as a NAME list to pass through from the parent; childEnv's real formula spreads it as
   * key-value pairs (`{ ...parentEnv(), ...dotenvVars, ...e.env }`), which is what SUP-04's own
   * three-layer precedence needs — an entry's own literal values, not a request to inherit named
   * ones. Fixed here rather than in a new commit that would touch nothing else.
   */
  readonly env?: Readonly<Record<string, string>>;
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
 *  and no program exists to register until N3, which is when the first row (below) lands. */
export const PROGRAMS: Readonly<Record<string, Program>> = {
  "nightly-sandcastle": { self: true, gate: "excl", resources: ["repo"], dotenv: true },
  // J4.12 (JOB-O09) — the first gate: "none" row this repo has (validate rule 17's first live
  // subject): the check reads `crontab -l` and renders, racing nothing the gate protects, and it
  // is most useful precisely when a writer is holding the gate and jobs are backing up behind it.
  "ops-cron-check": {
    self: true,
    gate: "none",
    dotenv: true,
    whyNoGate:
      "reads `crontab -l` and renders; it races nothing the gate protects, and it is most useful precisely when a writer is holding the gate and jobs are backing up behind it — queueing it would blind the check in the case it exists for",
  },
  // J4.14 (JOB-O10) — keyed on the SCRIPT PATH, not the entry name: programOf(e) is
  // e.job ?? e.script ?? e.name, and this is the first script: entry this repo has, so
  // "host/watchdog.sh" (e.script, below, verbatim — project-relative, the same string
  // scriptCommandOf resolves against ROOT) IS this program's name. Deviation from the plan's own
  // text, recorded here: the plan's prose calls this key "watchdog.sh" (and so does
  // host/classes.ts's WATCH list and host/classes.test.ts), but its own schedule-entry sketch sets
  // script: "host/watchdog.sh" — the two sketches disagree, and only the FULL path validates,
  // since scriptCommandOf needs the real project-relative path to find the file at all. Fixed by
  // using the full path everywhere a PROGRAMS-key-shaped value is needed; "watchdog.sh" survives
  // only as the readable short name in prose.
  //
  // It must run precisely when everything else is wedged, including behind a writer holding the
  // gate exclusively — gating it would let the failure it exists to catch silence it. It takes its
  // own flock instead (inlined in the script itself); the gate is in-memory inside the supervisor
  // and this process is deliberately outside it.
  "host/watchdog.sh": {
    self: true,
    gate: "none",
    dotenv: false,
    whyNoGate:
      "must run precisely when everything else is wedged, including behind a writer holding the gate exclusively; gating it would let the failure it exists to catch silence it. It takes its own flock instead — the gate is in-memory inside the supervisor and this process is deliberately outside it",
  },
};

/**
 * Empty at N2 by decision, not by accident — see host/schedule.test.ts test 1's own N2 title.
 * J3.15 (SUP-01, SUP-02, SUP-03, SUP-12, GAT-07, TST-09) lands the first entry, the moment N3
 * exists for: `nightly-sandcastle`, six firings a night inside the croner ∩ POSIX intersection
 * N2 measured (`dow` unrestricted, so the dom+dow divergence class cannot apply).
 *
 * `resources: ["repo"]` only, `skills` deliberately dropped — the pass reads `.claude/skills/`
 * for its whole duration, but its only writer is `skills sync`, an operator CLI that takes no
 * gate at all (J3.9). Holding `skills` `excl` for a whole pass would exclude future scheduled
 * entries from a resource nothing here contends, buying nothing and costing JOB-C16's (N5)
 * concurrency. The read is unprotected, and that is INS-05's problem (a resource whose writer is
 * outside the supervisor is not a gate problem), not GAT's — flagged in Gaps.
 *
 * `maxRunMin: 90` is DERIVED, not chosen: `RUN_TIMEOUT_IMPL_MS` (40 min) + `GATE_TIMEOUT_MS`
 * (5 min) × 2 (the ff-miss path re-runs the gate) = 50 min, plus worktree prep and reporting,
 * against SUP-13's SIGKILL bound — host/schedule.test.ts's budget assertion pins the relation so
 * the two numbers can never drift apart silently (N2 F1's exact shape).
 *
 * No entry here sets `supervised: false` — `crontab render` still emits a managed block with zero
 * command lines, and nothing starts the supervisor itself yet. That is SUP-09/JOB-O10, N4.
 */
export const SCHEDULE: readonly ScheduleEntry[] = [
  {
    name: "nightly-sandcastle",
    cron: "38 16-21 * * *",
    job: "nightly-sandcastle",
    log: projectPath(".doppelganger/logs/nightly-sandcastle.log"),
    maxRunMin: 90,
    why: "hourly overnight (23:38–04:38 WIB): one small, verified improvement to this repo, gated on the full suite, an import smoke of every changed file and a dry run of every changed job (JOB-C15). :38 leaves the :08s free for nightly-polish (JOB-C16, N5) so the pair fires every 30 minutes without sharing a minute — both take the gate exclusively, non-blocking, so a shared minute would mean one silently skipping every night.",
  },
  {
    name: "ops-cron-check",
    cron: "15 22 * * *",
    job: "ops-cron-check",
    log: projectPath(".doppelganger/logs/ops-cron-check.log"),
    why: "Crontab drift, once a day at 22:15 UTC (05:15 WIB) — after the nightly window closes and clear of :00/:30, so a report is waiting before the workday. Diffs the installed managed block against a fresh render of host/schedule.ts: one info line every run, an error line only on drift. Declared here deliberately, so the checker is covered by the config it verifies. Needs CRONTAB_CMD set in .env (required, no default — N2 F1) or it fails loudly.",
  },
  {
    name: "ops-watchdog",
    cron: "3,18,33,48 * * * *",
    script: "host/watchdog.sh",
    supervised: false,
    log: projectPath(".doppelganger/logs/ops-watchdog.log"),
    why: "Runtime liveness every 15 min, round the clock — the ONE job that does not run through the toolchain it watches, and THE ONLY ENTRY ON THE REAL CRONTAB (SUP-09). bash plus system binaries: no node except a deliberate two-line type-strip probe, no npm, nothing under node_modules, no model call, no network. A liveness probe scheduled by the process it probes reports nothing in the one case that matters. Four probes: node_modules is a real directory, node runs and strips types, the supervisor's 60s heartbeat (SUP-14) is younger than WATCHDOG_SUPERVISOR_STALE_M, and JOB-O11's heartbeat stamp is absent. It reports to its own log, to .doppelganger/watchdog.breach (presence is the alarm) and by exiting non-zero so cron's MAILTO carries it — there is no Slack path before v1 and this entry does not pretend otherwise.",
  },
];

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
/**
 * Ruling 3 (plan/N3-uac.md, J3.14): the ONE argv block a scheduled job reaches is host/run.ts —
 * never the job file directly. The first N3 draft rendered `host/jobs/<job>.ts` here, which has
 * no argv block of its own and would have exited 0 having done nothing, every night, silently.
 * ONE constant serves both consumers (`commandOf` here, `realJobRunner` in host/supervisor.ts),
 * so the two spellings cannot drift apart — N3 F1's fix, after a review regressed the supervisor
 * copy and the suite stayed green.
 */
export const JOB_ENTRYPOINT = "host/run.ts";

/**
 * R3 (SUP-03) — N3 F1's exact fix shape, one row over. `commandOf`'s script branch rendered
 * `node <script>` unconditionally while `spawnChild` (host/supervisor.ts) execs the script file
 * DIRECTLY — `[join(root, script), []]`, relying on the script's own shebang. `node` cannot run a
 * bash script, and nothing caught the disagreement because SCHEDULE has never held a `script:`
 * entry (N4's watchdog, JOB-O10, is the first). ONE function now serves both consumers, so the two
 * spellings cannot drift apart.
 *
 * J4.11 (a FIX to SUP-03/05/08, no new feature id — N4 is the phase that first writes a `script:`
 * entry, so this is where ruling 5's second half had to land) finishes it: a `.sh` carries its own
 * shebang, so no interpreter is named — a bare `bash` would be a PATH lookup in cron's stripped
 * environment (N2 F1's hazard) and `/bin/bash` a door-1 literal that moves between distributions.
 * A `.ts` has no shebang and must name one explicitly. `validate()`'s rules 12a/12b (below) are
 * what make the first arm safe: nothing here checks the exec bit or a shebang — a script rendered
 * with no interpreter and no permission to run itself would fail silently at spawn time, at 3am,
 * with SUP-05's whole point being that this is a BOOT-time refusal instead.
 */
export function scriptCommandOf(root: string, script: string): readonly [cmd: string, args: readonly string[]] {
  const abs = join(root, script);
  return script.endsWith(".sh") ? [abs, []] : [process.execPath, [abs]];
}

export function commandOf(e: ScheduleEntry): string {
  if (e.job !== undefined) {
    return `cd ${ROOT} && node ${JOB_ENTRYPOINT} ${e.job} >> ${e.log} 2>&1`;
  }
  const [cmd, args] = scriptCommandOf(ROOT, e.script ?? "");
  return `cd ${ROOT} && ${[cmd, ...args].join(" ")} >> ${e.log} 2>&1`;
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
        else {
          // 12a. the extension dispatch — scriptCommandOf only knows two shapes (SUP-03 fix).
          if (!e.script.endsWith(".ts") && !e.script.endsWith(".sh")) {
            err(e.name, `script must end in .ts or .sh, got ${JSON.stringify(e.script)}`);
          } else if (e.script.endsWith(".sh")) {
            // 12b. a .sh carries its own shebang and is exec'd DIRECTLY (no interpreter named), so
            // both must hold at boot — a stray `chmod -x` or a missing `#!` would otherwise fail
            // silently at spawn time (SUP-05). A .ts is handed to node explicitly and needs
            // neither.
            const mode = statSync(p).mode;
            if ((mode & 0o111) === 0) {
              err(e.name, `script ${p} is not executable — a chmod -x silently disables it (SUP-05)`);
            }
            if (!readFileSync(p, "utf8").startsWith("#!")) {
              err(e.name, `script ${p} does not start with #! — it is rendered with no interpreter (SUP-05)`);
            }
          }
        }
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
