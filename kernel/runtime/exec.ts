// J1.15 (HRN-19) — gh/git wrappers with a wall-clock timeout, so no call can stall forever.
//
// The failure this exists for: an unbounded stalled `gh` blocks the calling job's entire event
// loop, so its lease heartbeats stop, the pass never exits, and the supervisor never releases the
// gate it took around it.
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { envNum, type EnvSpec } from "../config.ts";

export const EXEC_TIMEOUT_MS_ENV: EnvSpec = {
  key: "EXEC_TIMEOUT_MS",
  default: "180000",
  why: "wall-clock bound on ONE gh/git call; an unbounded stalled gh blocks the event loop so lease heartbeats stop (HRN-19)",
};
export const EXEC_TIMEOUT_MS: number = envNum(EXEC_TIMEOUT_MS_ENV);

/** The base options every call carries: buffered utf8 output, a 16 MiB cap, and SIGKILL rather than
 *  the SIGTERM default — `spawnSync` signals once and never escalates, so a child that ignores
 *  SIGTERM would hang the caller exactly as a missing timeout would. Exported as a test seam: a
 *  bare `{ timeout: 250 }` does not satisfy `ExecFileSyncOptionsWithStringEncoding`, which requires
 *  `encoding`, so a caller overriding just the timeout must spread this. */
export const BASE: ExecFileSyncOptionsWithStringEncoding = {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
  timeout: EXEC_TIMEOUT_MS,
  killSignal: "SIGKILL",
};

/** `ETIMEDOUT` lands on the thrown error and on the nested `spawnSync` one; read both, so which of
 *  them Node populates is not a fact this file depends on. */
function timedOut(e: unknown): boolean {
  const err = e as { code?: string; error?: { code?: string } };
  return err.code === "ETIMEDOUT" || err.error?.code === "ETIMEDOUT";
}

const MAX_CMD = 200;

/**
 * The single `execFileSync` call site, so a timeout can say that it was one. Node throws
 * `spawnSync gh ETIMEDOUT`, which names neither the subcommand nor the deadline and matches
 * nothing in `log/cause.ts`, so the reported fault would be the tail of whatever the child last
 * printed.
 *
 * Every other failure passes through UNTOUCHED — `status`, `stdout` and `stderr` included, since
 * callers branch on them.
 *
 * Exported as a test seam: a timeout is otherwise reachable only through a genuinely hung call.
 */
export function run(
  file: string,
  args: readonly string[],
  opts: ExecFileSyncOptionsWithStringEncoding = BASE,
): string {
  try {
    return execFileSync(file, args, opts);
  } catch (e) {
    if (!timedOut(e)) throw e;
    const cmd = [file, ...args].join(" ");
    throw new Error(
      `${file} timed out after ${(opts.timeout ?? EXEC_TIMEOUT_MS) / 1000}s: ` +
        (cmd.length > MAX_CMD ? `${cmd.slice(0, MAX_CMD - 1)}…` : cmd),
      { cause: e },
    );
  }
}

export const gh = (...args: string[]): string => run("gh", args);

/** `gh` with stdin, for `--body-file -` — keeps large bodies out of argv. */
export const ghIn = (input: string, ...args: string[]): string =>
  run("gh", args, { ...BASE, stdio: ["pipe", "pipe", "pipe"], input });

/** `git` run in `dir` (`-C dir`), same buffered/utf8 contract as `gh`. */
export const git = (dir: string, ...args: string[]): string => run("git", ["-C", dir, ...args]);
