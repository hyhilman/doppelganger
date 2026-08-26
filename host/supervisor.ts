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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parentEnv, envNum, type EnvSpec } from "../kernel/config.ts";
import { spawnSlot } from "../kernel/runtime/pool.ts";
import { logger, type Fields } from "../kernel/runtime/log/emit.ts";
import { stderrTail } from "../kernel/runtime/log/cause.ts";
import type { Gate, Mode } from "../kernel/runtime/gate.ts";
import { programOf, type ScheduleEntry, type Program } from "./schedule.ts";
import { inRefreshWindow, type RefreshWindow } from "./config.ts";
import { gateWait } from "./cron.ts";

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
 * `job:` entries become a command without this file knowing what a job is: at N3 it becomes
 * `(job) => [process.execPath, [\`${root}/host/jobs/${job}.ts\`]]`. At N2 the real one is
 * assembled in `main()`'s argv block (J2.13) and nothing calls it, because `SCHEDULE` is empty.
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
