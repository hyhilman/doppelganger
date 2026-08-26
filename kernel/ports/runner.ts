// J3.2 (HRN-01, HRN-13, PRT-08) — what a run RETURNS, and the ONE `Runner` seam M11 (D3) swaps
// with an own library, "every job file unchanged" as the acceptance criterion.
//
// RunResult is OURS, six fields, all required — not sandcastle's eleven, two of them functions that
// exist only when a provider supports session capture. `completionSignal` is `string | null`, never
// `undefined`: an absent optional and a signal that did not fire must read identically at a call
// site, and the difference is a warning, not a type.
//
// RunRequest carries a FULLY-SUBSTITUTED `prompt` (no `promptArgs`) and a REQUIRED `cwd` — the
// caller owns the worktree (ruling 4, kernel/runtime/runjob.ts, J3.6).
import { envNum, type EnvSpec } from "../config.ts";
import type { Effort, Job, PermissionMode } from "./job.ts";

export const RUN_TIMEOUT_MS_ENV: EnvSpec = {
  key: "RUN_TIMEOUT_MS",
  default: "1500000",
  why: "wall-clock bound on ONE agent run, aborted rather than the supervisor's child (SUP-13 is that bound); unread at N3, since the only job is taskClass: impl",
};
export const RUN_TIMEOUT_MS: number = envNum(RUN_TIMEOUT_MS_ENV);

export const RUN_TIMEOUT_IMPL_MS_ENV: EnvSpec = {
  key: "RUN_TIMEOUT_IMPL_MS",
  default: "2400000",
  why: "the ceiling for a taskClass: impl run — a build-and-verify pass, not a read (HRN-13)",
};
export const RUN_TIMEOUT_IMPL_MS: number = envNum(RUN_TIMEOUT_IMPL_MS_ENV);

export interface RunRequest {
  readonly name: string;
  /** FULLY substituted; no `{{KEY}}` survives (kernel/runtime/runjob.ts's `substitute`). */
  readonly prompt: string;
  /** The CALLER owns it (ruling 4) — this file never prepares or removes a worktree. */
  readonly cwd: string;
  readonly model: string;
  readonly effort: Effort;
  readonly permissionMode: PermissionMode;
  readonly maxIterations: number;
  readonly completionSignal: string;
  readonly logPath: string;
  readonly deadlineMs: number;
  readonly env: Readonly<Record<string, string>>;
}

export interface RunResult {
  readonly stdout: string;
  /** `null`, never `undefined` — see the module header. */
  readonly completionSignal: string | null;
  readonly iterations: number;
  readonly commits: readonly string[];
  readonly branch: string;
  readonly logPath: string | null;
}

/** The M11 seam (D2/D3): `host/runner.ts`'s `sandcastleRunner` is the only implementation today. */
export type Runner = (req: RunRequest) => Promise<RunResult>;

/**
 * HRN-13's one N3 consumer: the run's abort deadline. `taskClass: "impl"` (a build-and-verify pass)
 * gets the larger ceiling; everything else (nothing, at N3) gets the smaller one that RUN_TIMEOUT_MS's
 * own `why` already says is unread.
 */
export function runTimeoutMs(job: Pick<Job, "taskClass">): number {
  return job.taskClass === "impl" ? RUN_TIMEOUT_IMPL_MS : RUN_TIMEOUT_MS;
}
