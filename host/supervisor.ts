// J2.11 (SUP-03, SUP-04, SUP-11, SUP-13, SUP-16, GAT-08, GAT-09) — runEntry: one entry's tick, end
// to end.
//
// Ruling 2 in full: runEntry(e, deps, isDraining) takes everything impure through `deps`, with NO
// default on any field, so TypeScript refuses a call that would write into the real checkout. The
// real values (the real gate, the real spawn, the real paths) are assembled in main()'s argv block
// (J2.13), which no test reaches.
//
// THE PRE-FLIGHT ORDER (the row content, stated as a sequence — GAT-09's whole content is why step
// 4 comes before step 5):
//   1. draining?                       -> return, nothing held
//   2. clearsRefreshWindow && inWindow -> log debug refresh-window, return   (SUP-10, SUP-11)
//   3. shouldShed(program)             -> log info quota-shed,     return    (SUP-16)
//   4. acquireSelf(program)            -> null? log warn lock-held mode=self, return  (GAT-06)
//   5. gate !== "none" -> acquire(mode, resources, gateWait)                 (GAT-08)
//                         null? log warn lock-held, releaseSelf, return
//   6. draining? -> log info drain-skipped, return                          (J2.13's stop())
//   7. await spawnSlot(spawnStaggerMs)   <- HOLDS THE GATE. See below.       (HRN-18)
//   8. draining? -> log info drain-skipped, return
//   9. spawn(...)       finally { hold?.release(); releaseSelf(); }
//
// Steps 2 and 3 are BEFORE the self-lock and the gate because a skipped tick should cost nothing
// and hold nothing. Step 4 is BEFORE step 5 because a pass that blocks at the gate holds its
// self-lock while it waits, so the ticks it waits through are the ticks it forces to skip — which
// is why the wait is DERIVED (gateWait(e.cron), GAT-08) and capped, never hand-picked (GAT-09).
//
// STEP 7's PLACEMENT — after the gate, immediately before spawn — was challenged as a regression
// against the reference and it is not one; the check is on the record. Staggering BEFORE the gate
// does not work: the stagger exists to space the moment two children each take an OS lock on
// `~/.gitconfig`, and if two entries stagger apart and then both block at the gate, they are
// released by the same drain() and spawn in the same instant — the stagger has been spent and the
// race is still there. The stagger only removes the race if it is the LAST thing before spawn,
// which means it holds whatever gate the entry already took (host/supervisor.test.ts group 7
// asserts this directly, not just the ordering).
//
// SUP-11, stated as behaviour: the window check happens ONCE, at fire time; nothing re-checks
// during the run. A flagged entry firing at 22:47 legitimately runs INTO the window — correct for
// a job measured in seconds, wrong for a long pass, which is why a long pass keeps real day-split
// legs instead of reaching for the flag.
import { existsSync, readFileSync, mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { parentEnv, envNum, errText, type EnvSpec } from "../kernel/config.ts";
import { ROOT, projectPath } from "../kernel/paths.ts";
import { spawnSlot } from "../kernel/runtime/pool.ts";
import { logger, type Fields } from "../kernel/runtime/log/emit.ts";
import { stderrTail } from "../kernel/runtime/log/cause.ts";
import { createGate, type Gate, type Mode } from "../kernel/runtime/gate.ts";
import { programOf, validate, supervisedEntries, bootstrapEntries, JOB_ENTRYPOINT, type ScheduleEntry, type Program } from "./schedule.ts";
import { byStage } from "../kernel/stages.ts";
import { RESOURCE_NAMES, REFRESH_WINDOW, inRefreshWindow, type RefreshWindow } from "./config.ts";
import { gateWait, newTimer as realNewTimer } from "./cron.ts";

// §2.27's three supervisor knobs. Each is read here (envNum) so `main()`'s argv block (J2.13) can
// pass the resolved value into `deps` without resolving anything itself — the same pattern
// host/cron.ts's GATE_WAIT_CAP_S already uses.
export const SUPERVISOR_MAX_RUN_MIN_ENV: EnvSpec = {
  key: "SUPERVISOR_MAX_RUN_MIN",
  default: "180",
  why: "the runtime bound for one entry's child (SUP-13) — already in §2.27; 1.5x the longest legitimate pass",
};
export const SUPERVISOR_MAX_RUN_MIN: number = envNum(SUPERVISOR_MAX_RUN_MIN_ENV);

export const SUPERVISOR_KILL_GRACE_MS_ENV: EnvSpec = {
  key: "SUPERVISOR_KILL_GRACE_MS",
  default: "10000",
  why: "SIGTERM -> this -> SIGKILL; the window to flush a stack trace, not to finish",
};
export const SUPERVISOR_KILL_GRACE_MS: number = envNum(SUPERVISOR_KILL_GRACE_MS_ENV);

export const SUPERVISOR_SPAWN_STAGGER_MS_ENV: EnvSpec = {
  key: "SUPERVISOR_SPAWN_STAGGER_MS",
  default: "2000",
  why: "the cross-entry half of HRN-18's ~/.gitconfig start-up race",
};
export const SUPERVISOR_SPAWN_STAGGER_MS: number = envNum(SUPERVISOR_SPAWN_STAGGER_MS_ENV);

/** The write target for a child's combined stdout+stderr. A real sink is a `WriteStream` opened
 *  `{ flags: "a" }`; a test sink is an in-memory recorder. Only `write` is used. */
export interface Sink {
  write(chunk: string | Buffer): void;
}

/** Narrow on purpose: wide enough that `node:child_process`'s real `spawn` satisfies it, narrow
 *  enough that a fake `EventEmitter` with `PassThrough` stdout/stderr and a recording `kill` does
 *  too. */
export interface SpawnedChild {
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit" | "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export interface SpawnOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdio: readonly ["ignore", "pipe", "pipe"];
}

export type SpawnFn = (cmd: string, args: readonly string[], opts: SpawnOptions) => SpawnedChild;

/**
 * Everything impure `runEntry` needs, as a required `deps` argument — ruling 2. `jobRunner` is how
 * `job:` entries become a command without this file knowing what a job is: at N3 (ruling 3,
 * plan/N3-uac.md) it spawns `host/run.ts <job>` — the ONE argv block a scheduled job reaches — and
 * NEVER the job file directly, which the first N3 draft got wrong and which is why the spawned
 * command is driven end to end rather than merely assumed (J3.14 AC4). The real one is assembled
 * in `main()`'s argv block (J2.13).
 *
 * `shouldShed` (SUP-16, QTA-08/09) and boot-time lease reap (SUP-15) are the two N4 seams. Both
 * are honest here: SUP-16 is a PLACEMENT row — before the gate — and the placement is checked now;
 * the predicate itself is N4's, so the argv block passes `() => ({ skip: false })` until N4
 * replaces it.
 */
export interface SupervisorDeps {
  /** SUP-03: the child's cwd. Never the package directory. */
  readonly root: string;
  readonly gate: Gate;
  readonly programs: Readonly<Record<string, Program>>;
  readonly refreshWindow: RefreshWindow | null;
  readonly spawn: SpawnFn;
  /** One stream per DISTINCT path — cached here, not by the caller (host/supervisor.test.ts group
   *  10; AC5 is the mutation that keys it wrong). */
  readonly openSink: (path: string) => Sink;
  readonly dotenvPath: string;
  readonly now: () => Date;
  readonly shouldShed: (program: string, at: Date) => { skip: boolean; class?: string };
  readonly maxRunMin: (e: ScheduleEntry) => number;
  readonly killGraceMs: number;
  readonly spawnStaggerMs: number;
  readonly jobRunner: (job: string) => readonly [string, readonly string[]];
}

const sinkCache = new Map<string, Sink>();

/** Every child currently in flight, across every entry — J2.13's `stop()` reads this to know who
 *  to signal on a drain, and `snapshot()` reads its size. Module-level because `stop()` and
 *  `spawnChild()` need to agree on the same set without threading it through every call. */
const liveChildren = new Set<SpawnedChild>();

function sinkFor(path: string, openSink: (path: string) => Sink): Sink {
  const cached = sinkCache.get(path);
  if (cached) return cached;
  const sink = openSink(path);
  sinkCache.set(path, sink);
  return sink;
}

/** A plain `KEY=VALUE` reader, deliberately NOT a shell: the moment it needs `export`, `$VAR`
 *  expansion or command substitution to be read correctly, the thing reading it has to be bash
 *  again. Blank lines and `#` comments are skipped; a line with no `=` is skipped. */
function readDotenv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/** SUP-04's three layers, in precedence order: inherited < `.env` < the entry's own `env:`. A
 *  program's `dotenv: false` removes the middle layer entirely — a key set ONLY in `.env` is then
 *  ABSENT from the child's environment, not merely overridden. */
function childEnv(e: ScheduleEntry, program: Program, dotenvPath: string): NodeJS.ProcessEnv {
  return {
    ...parentEnv(),
    ...(program.dotenv ? readDotenv(dotenvPath) : {}),
    ...(e.env ?? {}),
  } as NodeJS.ProcessEnv;
}

/**
 * Spawns `e`'s child, wires its stdio into `e.log`'s sink, and resolves once the child is fully
 * accounted for — normal exit, a spawn error, or SUP-13's runtime bound. Resolves on the SIGKILL,
 * never on a `close`/`exit` that might not come: `close` also waits on the stdio pipes, and a
 * pass's own grandchildren keep those open after it dies, so waiting would leave the gate held by
 * exactly the child this kills to release it. Exactly one terminal line, `job-ok` or `job-failed`,
 * ever reaches the log for one call.
 */
function spawnChild(e: ScheduleEntry, program: Program, deps: SupervisorDeps): Promise<void> {
  return new Promise((resolve) => {
    const log = logger(programOf(e));
    const [cmd, args]: readonly [string, readonly string[]] =
      e.job !== undefined ? deps.jobRunner(e.job) : [join(deps.root, e.script as string), []];

    const child = deps.spawn(cmd, args, {
      cwd: deps.root,
      env: childEnv(e, program, deps.dotenvPath),
      stdio: ["ignore", "pipe", "pipe"],
    });
    liveChildren.add(child);

    const sink = sinkFor(e.log, deps.openSink);
    const tail = stderrTail();

    child.stdout?.on("data", (chunk: Buffer | string) => sink.write(chunk));
    child.stderr?.on("data", (chunk: Buffer | string) => {
      sink.write(chunk);
      tail.push(chunk);
    });

    let logged = false;
    const logTerminal = (level: "info" | "error", event: string, fields: Fields): void => {
      if (logged) return;
      logged = true;
      log[level](event, fields);
    };

    let resolved = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const resolveOnce = (): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);
      clearTimeout(graceTimer);
      liveChildren.delete(child);
      resolve();
    };

    const onDone = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (code === 0 && !signal) {
        logTerminal("info", "job-ok", {});
      } else {
        logTerminal("error", "job-failed", { exit: code ?? -1, signal: signal ?? undefined, log: e.log, msg: tail.cause() });
      }
      resolveOnce();
    };
    // "close", not "exit": "exit" can fire before the stdio pipes have finished draining, and a
    // trailing stderr line written right before the child dies would be lost from the log. That
    // race does not apply to the SUP-13 kill path below — there, "close" might never come at all
    // (a pass's own grandchildren keep the pipes open after it dies), which is exactly why that
    // path settles on the SIGKILL and never waits on either event.
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => onDone(code, signal));

    child.on("error", (err: Error) => {
      logTerminal("error", "job-failed", { msg: `spawn failed: ${err.message}`, log: e.log });
      resolveOnce();
    });

    // SUP-13, the runtime bound. The field is minutes and its type is number — a fractional
    // minute is used in tests rather than adding a milliseconds seam production would never use.
    const limitMin = deps.maxRunMin(e);
    killTimer = setTimeout(() => {
      logTerminal("error", "job-failed", {
        exit: -1,
        signal: "SIGTERM",
        limitMin,
        log: e.log,
        msg: tail.cause(),
      });
      child.kill("SIGTERM");
      graceTimer = setTimeout(() => {
        child.kill("SIGKILL");
        resolveOnce();
      }, deps.killGraceMs);
    }, limitMin * 60_000);
  });
}

/** One entry's tick, end to end. See the module header for the pre-flight order and why each step
 *  sits where it does. `isDraining` is separate from `deps`: it is a live signal main() (J2.13)
 *  flips mid-run, not a value assembled once per call. */
export async function runEntry(
  e: ScheduleEntry,
  deps: SupervisorDeps,
  isDraining: () => boolean = () => false,
): Promise<void> {
  const program = programOf(e);
  const log = logger(program);

  // 1. draining?
  if (isDraining()) return;

  const row = deps.programs[program];
  if (!row) {
    // validate() (J2.9) refuses this before boot; defensive only.
    log.error("job-failed", { msg: `no PROGRAMS row for ${program}` });
    return;
  }

  // 2. clearsRefreshWindow && inWindow (SUP-10, SUP-11)
  if (e.clearsRefreshWindow && inRefreshWindow(deps.now(), deps.refreshWindow)) {
    log.debug("refresh-window", {});
    return;
  }

  // 3. shouldShed(program) (SUP-16)
  const shed = deps.shouldShed(program, deps.now());
  if (shed.skip) {
    log.info("quota-shed", { class: shed.class });
    return;
  }

  // 4. acquireSelf(program) (GAT-06)
  const releaseSelf = deps.gate.acquireSelf(program);
  if (!releaseSelf) {
    log.warn("lock-held", { lock: program, mode: "self" });
    return;
  }

  // 5. gate !== "none" -> acquire(mode, resources, gateWait) (GAT-08)
  let hold: Awaited<ReturnType<Gate["acquire"]>> = null;
  if (row.gate !== "none") {
    const mode: Mode = row.gate;
    const waitMs = e.gateWait ? gateWait(e.cron) * 1000 : 0;
    hold = await deps.gate.acquire(mode, row.resources ?? [], waitMs);
    if (!hold) {
      const fields: Fields = { lock: program };
      if (e.gateWait) fields.waited = Math.round(waitMs / 1000);
      log.warn("lock-held", fields);
      releaseSelf();
      return;
    }
  }

  try {
    // 6. draining? (J2.13's stop())
    if (isDraining()) {
      log.info("drain-skipped", {});
      return;
    }

    // 7. await spawnSlot(spawnStaggerMs) — HOLDS THE GATE (HRN-18)
    await spawnSlot(deps.spawnStaggerMs);

    // 8. draining?
    if (isDraining()) {
      log.info("drain-skipped", {});
      return;
    }

    // 9. spawn
    await spawnChild(e, row, deps);
  } finally {
    hold?.release();
    releaseSelf();
  }
}

// ---------------------------------------------------------------------------------------------
// J2.13 (SUP-06, SUP-14, SUP-15, SUP-18) — main(): boot, timers, heartbeat, drain, the loud
// refusal. The boot sequence, in order: validate (throws → bootOrDie prints every line and sets
// process.exitCode) → reapOnBoot (non-fatal; SUP-15's whole content is "before the timers", so a
// sweep never races the ticks it exists to unblock) → one newTimer per SUPERVISED entry (SUP-03)
// → beat() once, then every 60s, unref'd (SUP-14) → the `supervisor-up` line → SIGTERM/SIGINT ->
// stop(), and an unhandledRejection handler that logs and does not exit.
// ---------------------------------------------------------------------------------------------

export const SUPERVISOR_DRAIN_MS_ENV: EnvSpec = {
  key: "SUPERVISOR_DRAIN_MS",
  default: "30000",
  why: "how long a child gets to exit on shutdown before it is killed; a process manager's own stop timeout must exceed it",
};
export const SUPERVISOR_DRAIN_MS: number = envNum(SUPERVISOR_DRAIN_MS_ENV);

export interface BootDeps extends SupervisorDeps {
  readonly newTimer: (e: ScheduleEntry, fn: () => void) => { stop(): void };
  readonly heartbeatPath: string;
  readonly statusPath: string;
  readonly bootLog: string;
  readonly drainMs: number;
  /** LSE-09 lands here at N4. Absent at N2 — the ordering (before the timers) is asserted with a
   *  fake, which is exactly what LSE-09 needs to be able to rely on later. */
  readonly reapOnBoot?: () => Iterable<Record<string, string | number>>;
  /**
   * Production is `process.exit`; a test supplies a recorder instead. NOT part of the interface
   * sketch in plan/N2-uac.md J2.13 — added here because the plan's own "Risks" section requires
   * it verbatim ("stop() taking its exit function through deps... is also the seam a test
   * needs"), which the sketch omitted. Required, not defaulted, like every other impure field
   * (ruling 2).
   */
  readonly exit: (code: number) => void;
}

export interface Supervisor {
  readonly stop: (sig: string) => Promise<void>;
  readonly draining: () => boolean;
}

export function snapshot(deps: BootDeps): Record<string, unknown> {
  return {
    pid: process.pid,
    at: Math.floor(deps.now().getTime() / 1000),
    gate: deps.gate.state(),
    children: liveChildren.size,
  };
}

/** Never throws: a supervisor that dies because it could not write its own liveness stamp turns a
 *  full disk into a dead fleet, which is strictly worse than the watchdog firing. */
export function beat(deps: BootDeps): void {
  const log = logger("supervisor");
  try {
    mkdirSync(dirname(deps.heartbeatPath), { recursive: true });
    writeFileSync(deps.heartbeatPath, `${Math.floor(deps.now().getTime() / 1000)}\n`);
    mkdirSync(dirname(deps.statusPath), { recursive: true });
    writeFileSync(deps.statusPath, JSON.stringify(snapshot(deps)));
  } catch (e) {
    log.warn("heartbeat-failed", { msg: errText(e) });
  }
}

/** One process, one tick owner. See the module header above for the boot order. */
export async function main(schedule: readonly ScheduleEntry[], deps: BootDeps): Promise<Supervisor> {
  const log = logger("supervisor");

  // 1. validate (SUP-05, SUP-06) — throws before a single timer registers.
  validate(schedule, {
    programs: deps.programs,
    resourceNames: deps.gate.resources,
    refreshWindow: deps.refreshWindow,
    logRoots: [join(deps.root, ".doppelganger/logs"), join(deps.root, "logs")],
    jobsDir: join(deps.root, "host/jobs"),
    root: deps.root,
  });

  // 2. reapOnBoot (SUP-15) — before the timers; non-fatal.
  if (deps.reapOnBoot) {
    try {
      for (const row of deps.reapOnBoot()) {
        log.info("lease-reaped", row as Fields);
      }
    } catch (e) {
      log.warn("lease-reap-failed", { msg: errText(e) });
    }
  }

  let draining = false;
  const isDraining = (): boolean => draining;

  // 3. one newTimer per supervised entry (SUP-03).
  const supervised = supervisedEntries(schedule);
  const timers = supervised.map((e) =>
    deps.newTimer(e, () => {
      // 11. a tick that throws is caught — no other timer is affected.
      runEntry(e, deps, isDraining).catch((err: unknown) => {
        log.error("tick-crashed", { msg: errText(err), job: programOf(e) });
      });
    }),
  );

  // 4. beat() once, then every 60s, unref'd (SUP-14).
  beat(deps);
  const beatTimer = setInterval(() => beat(deps), 60_000);
  beatTimer.unref?.();

  // 5. supervisor-up.
  const unsupervised = bootstrapEntries(schedule).length;
  log.info("supervisor-up", {
    entries: supervised.length,
    unsupervised,
    heartbeat: deps.heartbeatPath,
    pid: process.pid,
  });

  // 6. SIGTERM/SIGINT -> stop(); unhandledRejection logs and does not exit.
  const stop = async (sig: string): Promise<void> => {
    if (draining) return; // idempotent — a second signal must not double-drain
    draining = true;
    process.off("SIGTERM", onTerm);
    process.off("SIGINT", onInt);
    process.off("unhandledRejection", onUnhandled);
    clearInterval(beatTimer);
    for (const t of timers) t.stop();

    const children = [...liveChildren];
    log.info("supervisor-draining", { signal: sig, children: children.length });
    for (const c of children) c.kill("SIGTERM");

    // DEVIATION from plan/N2-uac.md's "both timers unref'd", recorded here: this Promise IS
    // stop()'s own await — it is not background work, it is the mechanism stop() uses to know
    // when to proceed. Unref'ing a timer stop() is itself waiting on lets Node consider the event
    // loop drained (and, in a process with nothing else running — every test in this file that
    // exercises drain — end the run) before the timer ever gets a chance to fire, which measured
    // as exactly this: "Promise resolution is still pending but the event loop has already
    // resolved". The REAL point behind "unref'd" — this must never hold a shutdown open beyond
    // what draining needs — is met anyway: the drain waits at most `drainMs` (children that never
    // exit are SIGKILLed and the poll then finds an empty set within one more 200ms tick), and
    // stop() calls `deps.exit()` explicitly the moment it is done either way.
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        for (const c of liveChildren) c.kill("SIGKILL");
      }, deps.drainMs);

      const pollTimer = setInterval(() => {
        if (liveChildren.size === 0) {
          clearInterval(pollTimer);
          clearTimeout(killTimer);
          resolve();
        }
      }, 200);
    });

    deps.exit(0);
  };
  const onTerm = (): void => {
    void stop("SIGTERM");
  };
  const onInt = (): void => {
    void stop("SIGINT");
  };
  const onUnhandled = (reason: unknown): void => {
    log.error("unhandled-rejection", { msg: errText(reason) });
  };
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  process.on("unhandledRejection", onUnhandled);

  return { stop, draining: isDraining };
}

/** SUP-06's loud refusal: catches validate()'s throw (via main()), writes every problem line to
 *  stderr through the log emitter, and sets `process.exitCode = 1`. The other two halves of
 *  SUP-06 — a restart loop and a watchdog report within 15 minutes — are DECLINED: the restart
 *  policy is SUP-19 (moved to M9 with the fleet) and the watchdog is JOB-O10 (N4). N2 ships the
 *  exit code and the message; this comment names which phase owns the rest. */
/** The REAL argv pair a scheduled `job:` entry spawns (SUP-03, N3 F1). Exported and top-level so a
 *  test can pin it — the argv block in main() below is untestable by construction, and the first
 *  N3 review proved that an inline literal there can regress to `host/jobs/<job>.ts` (the silent
 *  no-op) with the whole suite green. `JOB_ENTRYPOINT` is the same constant `commandOf` renders,
 *  so the crontab line and the spawned command cannot name two different targets. */
export const realJobRunner = (job: string): readonly [string, readonly string[]] =>
  [process.execPath, [projectPath(JOB_ENTRYPOINT), job]];

export async function bootOrDie(schedule: readonly ScheduleEntry[], deps: BootDeps): Promise<Supervisor> {
  try {
    return await main(schedule, deps);
  } catch (e) {
    const log = logger("supervisor");
    const problems = errText(e)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "));
    for (const line of problems) {
      log.error("boot-failed", { msg: line.replace(/^-\s*/, "") });
    }
    process.exitCode = 1;
    return { stop: async () => {}, draining: () => true };
  }
}

// ---------------------------------------------------------------------------------------------
// J2.14 (SUP-17) — list(): the resolved schedule, printed. Pure — returns a string, prints
// nothing — so a test can pin the exact text without capturing console.log; only the argv block
// below ever calls console.log with the result.
// ---------------------------------------------------------------------------------------------

export interface ListOpts {
  readonly programs: Readonly<Record<string, Program>>;
  readonly resourceNames: readonly string[];
}

interface ListRow {
  readonly by: string;
  readonly entry: string;
  readonly cron: string;
  readonly program: string;
  readonly gate: string;
  readonly resources: string;
  readonly wait: string;
  readonly dotenv: string;
}

const LIST_COLUMNS: readonly (keyof ListRow)[] = [
  "by",
  "entry",
  "cron",
  "program",
  "gate",
  "resources",
  "wait",
  "dotenv",
];
const LIST_HEADERS: ListRow = {
  by: "by",
  entry: "entry",
  cron: "cron",
  program: "program",
  gate: "gate",
  resources: "resources",
  wait: "wait",
  dotenv: "dotenv",
};

/** One row's columns, resolved from a schedule entry and the program it names. An entry whose
 *  program has no PROGRAMS row prints "??" for gate/resources/dotenv rather than throwing —
 *  `list` is a read tool, not a second `validate()` (SUP-05 already owns that refusal). */
function listRow(e: ScheduleEntry, opts: ListOpts): ListRow {
  const by = e.supervised === false ? "cron" : "sup";
  const prog = programOf(e);
  const wait = e.gateWait ? `${gateWait(e.cron)}s` : "-";
  const p = opts.programs[prog];
  if (!p) {
    return { by, entry: e.name, cron: e.cron, program: prog, gate: "??", resources: "??", wait, dotenv: "??" };
  }
  const gate = p.gate === "none" ? "none" : `${p.gate}${p.self ? "+self" : ""}`;
  // Resources: "all" for a reader (gate: "shared") even when the program names some (GAT-02
  // only restricts what a WRITER may narrow); "all" for a writer that names none, same rule;
  // otherwise the writer's own list, reordered into the GATE's global order (not the program's
  // own declared order) so two programs sharing resources read the same way in the listing.
  const resources =
    p.gate === "none"
      ? "-"
      : p.gate === "shared"
        ? "all"
        : !p.resources || p.resources.length === 0
          ? "all"
          : opts.resourceNames.filter((n) => p.resources!.includes(n)).join("+");
  const dotenv = p.dotenv ? "env" : "-";
  return { by, entry: e.name, cron: e.cron, program: prog, gate, resources, wait, dotenv };
}

/**
 * SUP-17: the resolved schedule, printed — entry -> program -> gate -> resources -> wait, so a
 * change can be eyeballed before it is installed. Grouped by stage prefix with `byStage`
 * (kernel/stages.ts); the schedule's own order is preserved WITHIN a group, never re-sorted.
 * Column widths are the max of each column's own header and cell text, computed from the data —
 * never a fixed number. Ends with a tally line counting `supervisedEntries` and
 * `bootstrapEntries`, never `schedule.length` — the whole point is the split SUP-09 draws.
 */
export function list(schedule: readonly ScheduleEntry[], opts: ListOpts): string {
  const widths = LIST_COLUMNS.map((c) =>
    Math.max(LIST_HEADERS[c].length, ...schedule.map((e) => listRow(e, opts)[c].length)),
  );
  const render = (r: ListRow): string =>
    LIST_COLUMNS.map((c, i) => r[c].padEnd(widths[i]!))
      .join("  ")
      .trimEnd();

  const lines: string[] = [render(LIST_HEADERS), widths.map((w) => "-".repeat(w)).join("  ")];

  for (const [stage, entries] of byStage(schedule, (e) => e.name)) {
    lines.push(`-- ${stage} --`);
    for (const e of entries) lines.push(render(listRow(e, opts)));
  }

  lines.push(`${supervisedEntries(schedule).length} supervised, ${bootstrapEntries(schedule).length} on the real crontab`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// The argv block. UNTESTED BY CONSTRUCTION (plan/N2-uac.md ruling 1) — no test imports this file
// in a way that reaches it. It assembles the real deps and dispatches --list / --gate / boot.
// `supervisor --list` is SUP-17 (J2.14); until that job lands, only boot runs.
// ---------------------------------------------------------------------------------------------
if (import.meta.filename === process.argv[1]) {
  const { SCHEDULE, PROGRAMS } = await import("./schedule.ts");

  // SUP-17: --list is a read tool, not a boot — it must never reach validate(), a timer, or a
  // heartbeat write. Dispatched before `deps` (and everything `deps` would touch) is assembled.
  if (process.argv.includes("--list")) {
    console.log(list(SCHEDULE, { programs: PROGRAMS, resourceNames: RESOURCE_NAMES }));
    process.exit(0);
  }

  const deps: BootDeps = {
    root: ROOT,
    gate: createGate(RESOURCE_NAMES),
    programs: PROGRAMS,
    refreshWindow: REFRESH_WINDOW,
    spawn: (await import("node:child_process")).spawn as unknown as SpawnFn,
    openSink: (path: string) => createWriteStream(path, { flags: "a" }),
    dotenvPath: projectPath(".env"),
    now: () => new Date(),
    shouldShed: () => ({ skip: false }),
    maxRunMin: () => SUPERVISOR_MAX_RUN_MIN,
    killGraceMs: SUPERVISOR_KILL_GRACE_MS,
    spawnStaggerMs: SUPERVISOR_SPAWN_STAGGER_MS,
    jobRunner: realJobRunner,
    newTimer: realNewTimer,
    heartbeatPath: projectPath(".doppelganger/supervisor.heartbeat"),
    statusPath: projectPath(".doppelganger/supervisor.status.json"),
    bootLog: projectPath(".doppelganger/logs/supervisor.log"),
    drainMs: SUPERVISOR_DRAIN_MS,
    exit: (code: number) => process.exit(code),
  };
  await bootOrDie(SCHEDULE, deps);
}
