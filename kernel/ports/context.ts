// PRT-05 — what a job's `exec(ctx)` receives. A file under `plugins/` may import only
// `kernel/ports/*` and `kernel/plugin.ts` (TST-03), so every runtime capability a plugin job needs
// comes in through this one object instead of an import. The host builds the one real context
// (`host/run.ts`'s `buildContext`); a test builds a fake one.
//
// This file names runtime TYPES only. It holds no value, so a plugin that imports it gets a shape,
// never a path into `kernel/runtime/`.
import type { EnvSpec } from "../config.ts";
import type { Db } from "../runtime/db.ts";
import type { Reaped } from "../runtime/lease.ts";
import type { Logger } from "../runtime/log/emit.ts";
import type { TailResult } from "../runtime/log/tail.ts";
import type { RunJobDeps } from "../runtime/runjob.ts";
import type { ShedDecision } from "../runtime/shed.ts";
import type { Worktree } from "../runtime/worktree.ts";
import type { Job } from "./job.ts";
import type { Runner, RunResult } from "./runner.ts";

export type { Db, Logger, Reaped, RunJobDeps, ShedDecision, TailResult, Worktree };

/** Runs `cmd` in `dir` and never throws: `ok` is the exit status, `out` is stdout then stderr. */
export type RunIn = (dir: string, cmd: string, args: readonly string[], env?: Record<string, string>) => {
  ok: boolean;
  out: string;
};

export interface JobContext {
  /** INS-06: this checkout's name. A write shared with another checkout carries it. */
  readonly instance: string;
  /** The checkout the job runs against. */
  readonly root: string;
  readonly now: () => Date;
  /** One logger, named for the job. `raw` writes a line as-is. */
  readonly log: Logger;
  /** Reads a plugin's own `EnvSpec` rows (KRN-06). The same readers `kernel/config.ts` has. */
  readonly env: {
    readonly str: (spec: EnvSpec) => string;
    readonly num: (spec: EnvSpec) => number;
    readonly optional: (spec: EnvSpec) => string | undefined;
  };
  /** A project-relative path (INS-02). */
  readonly path: (...segs: string[]) => string;
  /** Opens the named store on first call, never before — a killed pass opens no database. */
  readonly db: (name: string) => Db;
  /** `git -C dir ...args`; throws on a non-zero exit. */
  readonly git: (dir: string, ...args: string[]) => string;
  readonly runIn: RunIn;
  /** The one `Runner` (D2/D3). A job hands it to `runJob`, never calls it past `runJob`. */
  readonly runner: Runner;
  /** QTA-08: the shed decision the host made for this run. A job hands it on, never recomputes it. */
  readonly shed: ShedDecision;
  /** Every registered job (SKL-05: the list is what exists). */
  readonly jobs: readonly Job[];
  /** Where one agent run's log goes. */
  readonly runLogPath: (name: string) => string;
  /** A throwaway directory for dry-run stores. Never the live one. */
  readonly scratchRoot: string;
  /** Runs a skill job through the runner (HRN-11 model check included). */
  readonly runJob: (job: Job, deps: RunJobDeps) => Promise<RunResult>;
  /** The model a request really runs on once `shed` is applied. */
  readonly shedModel: (model: string, shed: ShedDecision) => string;
  /** HRN-12: pass worktrees. `root` is the parent directory every one lives under. */
  readonly worktree: {
    readonly root: string;
    readonly prep: (repo: string, spec: { readonly branch: string; readonly base: string }, path: string) => Worktree;
    readonly teardown: (repo: string, path: string) => void;
    readonly reap: (repo: string, under: string, keep: string) => string[];
    readonly promptLines: (wt: Worktree) => string[];
  };
  /** HRN-10: the sentinel block a run reports in, and its `key=value` fields. */
  readonly payload: {
    readonly extractBlock: (stdout: string, tag: string) => string | null;
    readonly extractFields: (block: string) => Record<string, string>;
  };
  /** LSE-07: deletes the leases whose owner process is dead. The reaper applies every guard. */
  readonly reapDeadLeases: () => readonly Reaped[];
  /** Reads both log roots forward from their cursors. `advance: false` moves no cursor and
   *  rotates nothing (SAF-01). */
  readonly tailLogs: (opts: { readonly advance: boolean }) => TailResult;
  /** The log reader's own key/value store, in log.db's `logtail` namespace. */
  readonly logMeta: {
    readonly get: (key: string) => string | null;
    readonly set: (key: string, value: string) => void;
  };
  /** Sends a report over ntfy. Never throws: a failed send is `ok: false`. */
  readonly notify: (body: string) => Promise<{ readonly ok: boolean; readonly detail: string }>;
  /** Writes text to stdout. */
  readonly print: (text: string) => void;
}
