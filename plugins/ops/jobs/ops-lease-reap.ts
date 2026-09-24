// Delete leases whose owning process is dead, every minute (JOB-O03).
//
// WHY. A killed worker leaves its claim `held` until the TTL runs out, and the TTL is sized for the
// worst-case run. So every kill wedges a key that nobody is working on, and `maxAttempts` counts the
// crash as an attempt. The supervisor already runs the same sweep once at boot (SUP-15); that
// covers a restart at the moment it happens. This job covers what a restart cannot see: an
// OOM-killed child, a `kill -9`, a run that dies while the supervisor stays up.
//
// The guards (LSE-07) live in the reaper itself, never here. This file only calls it and writes
// what it did. No LLM, no network, no gate: SQLite and `/proc` only, which is what makes a
// one-minute cadence cheap.
import type { JobContext } from "../../../kernel/ports/context.ts";
import { defineJob } from "../../../kernel/ports/job.ts";

/** Log fields, the same shape the kernel logger takes. */
export type Fields = Record<string, string | number | boolean | null | undefined>;

export interface LeaseReapDeps {
  readonly log: {
    info(event: string, fields?: Fields): void;
    error(event: string, fields?: Fields): void;
  };
  /** The reaper. It applies every guard and deletes only the rows that pass them all. */
  readonly reapDead: () => readonly {
    readonly scope: string;
    readonly key: string;
    readonly pid: number;
    readonly claimedAt: string;
    readonly ttlLeftMin: number;
  }[];
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * One `info reaped` line per claim, then `info swept reaped=N` on EVERY run, zero included. A
 * sweep that says nothing when it finds nothing looks the same in the log as a sweep that never
 * ran, and doing nothing quietly is this job's own failure mode.
 *
 * `info`, not `warn`: an owner dying is usually a planned restart, and a warn 1440 times a day is a
 * level nobody reads. `ttlLeftMin` is what shows a real fault: the wedge this run cut short.
 *
 * A failure writes `error job-failed` and throws, so the run exits non-zero.
 */
export function reapLeases(deps: LeaseReapDeps): number {
  let reaped;
  try {
    reaped = deps.reapDead();
  } catch (e) {
    deps.log.error("job-failed", { msg: errText(e) });
    throw e;
  }
  for (const r of reaped) {
    deps.log.info("reaped", { scope: r.scope, key: r.key, pid: r.pid, claimed: r.claimedAt, ttlLeftMin: r.ttlLeftMin });
  }
  deps.log.info("swept", { reaped: reaped.length });
  return reaped.length;
}

/** Every minute, so its run lease is keyed on the minute: an hourly key would refuse 59 ticks. */
export default defineJob({
  name: "ops-lease-reap",
  description: "Delete leases whose owning process is dead, every minute (JOB-O03).",
  plugin: "ops",
  permissionMode: "auto",
  leaseWindow: "minute",
  exec: async (ctx: JobContext): Promise<void> => {
    reapLeases({ log: ctx.log, reapDead: ctx.reapDeadLeases });
  },
});
