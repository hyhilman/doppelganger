// Prune the durable state nothing else deletes, once a day (JOB-O06).
//
// This is the only job that deletes durable state, and it runs unattended. So every rule below is
// about a row it must leave alone.
//
// WHY. Log files are bounded by rotation; SQLite is not. `lease_claim` loses a row only by hand
// (`lease-clear`) or through the reaper, which touches live claims only. So every key ever minted
// stays a row forever. Not urgent on any day, unbounded over a year.
//
// TERMINAL LEASES ONLY, AND NEVER RECENT ONES. A `done` lease is the dedup record: `acquire`
// refuses it forever. Deleting one makes its key free again, which is safe only because the keys
// are versioned (`<job>@<UTC hour>` or `<UTC minute>`), so an old key is never asked for again. The horizon is
// long anyway, because being wrong means running the same work twice. A `held` row is somebody's
// lock at any age and is never touched.
//
// DEAD CURSORS. A log cursor is keyed on a path, and a renamed job leaves its old cursor behind
// for good. A cursor is dropped only when its file is gone; its age is never the test. Dropping a
// live one would open a silent gap in what the log report reads.
//
// THE WAL. Deleting rows frees pages inside the file and gives nothing back to the disk, and a WAL
// starved by constant readers keeps growing on its own. `wal_checkpoint(TRUNCATE)` is what gives
// it back. Not VACUUM: VACUUM rewrites the whole file under an exclusive lock, which a job sharing
// these files with live runs must never hold.
//
// No queue horizon (`RETENTION_QUEUE_DAYS`) yet: the queue store is v1 (QUE), so there is nothing
// for it to prune.
//
// No LLM, no network: SQLite and the filesystem.
import { statSync } from "node:fs";
import type { EnvSpec } from "../../../kernel/plugin.ts";
import type { JobContext } from "../../../kernel/ports/context.ts";
import { defineJob } from "../../../kernel/ports/job.ts";

export const RETENTION_LEASE_DAYS_ENV: EnvSpec = {
  key: "RETENTION_LEASE_DAYS",
  default: "60",
  why: "done/failed leases older than this are deleted; long, since deleting a done lease frees its key again (JOB-O06)",
};
export const RETENTION_DRY_RUN_ENV: EnvSpec = {
  key: "RETENTION_DRY_RUN",
  default: "0",
  why: "1 = count every row the sweep would delete; delete nothing and skip the WAL checkpoint (SAF-01)",
};

export const RETENTION_ENV: readonly EnvSpec[] = [RETENTION_LEASE_DAYS_ENV, RETENTION_DRY_RUN_ENV];

/** Log fields, the same shape the kernel logger takes. */
export type Fields = Record<string, string | number | boolean | null | undefined>;

type SqlParam = string | number | null;

/** The part of a SQLite handle this job uses. A `node:sqlite` handle fits it as is. */
export interface SqlHandle {
  prepare(sql: string): {
    all(...params: SqlParam[]): unknown[];
    get(...params: SqlParam[]): unknown;
    run(...params: SqlParam[]): { readonly changes: number | bigint };
  };
  exec(sql: string): void;
}

export interface RetentionDeps {
  readonly log: {
    info(event: string, fields?: Fields): void;
    error(event: string, fields?: Fields): void;
  };
  /** Reads this job's own `EnvSpec` rows. */
  readonly env: {
    str(spec: EnvSpec): string;
    num(spec: EnvSpec): number;
  };
  readonly now: () => Date;
  /** Opens a named store: `"lease"` holds `lease_claim`, `"log"` holds `logtail_cursor`. */
  readonly db: (name: string) => SqlHandle;
}

export interface Swept {
  readonly leaseRows: number;
  readonly leaseDays: number;
  readonly deadCursors: number;
  readonly dryRun: boolean;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The same second-precision shape the lease store writes, so the two sort as intended. */
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A fresh host has no tables yet. That is not a fault: there is simply nothing to prune. */
const hasTable = (db: SqlHandle, table: string): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;

// `updated_at`, not `claimed_at`: it is when the row last moved. A lease settled today is young
// here however long ago it was first claimed.
const TERMINAL = "status IN ('done','failed') AND updated_at < ?";

/** Terminal leases past the cutoff. A dry run counts with the same WHERE the delete uses, so it
 *  reports the number the real sweep would act on. */
function pruneLeases(db: SqlHandle, cutoff: string, dryRun: boolean): number {
  if (!hasTable(db, "lease_claim")) return 0;
  if (dryRun) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM lease_claim WHERE ${TERMINAL}`).get(cutoff) as { n: number };
    return row.n;
  }
  return Number(db.prepare(`DELETE FROM lease_claim WHERE ${TERMINAL}`).run(cutoff).changes);
}

/** Gone means `ENOENT` and nothing else. Any other stat failure (a permission error, say) keeps
 *  the cursor: an unsure answer fails toward keeping. */
function isGone(path: string): boolean {
  try {
    statSync(path);
    return false;
  } catch (e) {
    return (e as { code?: unknown }).code === "ENOENT";
  }
}

function pruneCursors(db: SqlHandle, dryRun: boolean): number {
  if (!hasTable(db, "logtail_cursor")) return 0;
  const rows = db.prepare("SELECT path FROM logtail_cursor").all() as { path: string }[];
  const gone = rows.map((r) => r.path).filter(isGone);
  if (dryRun) return gone.length;
  const del = db.prepare("DELETE FROM logtail_cursor WHERE path = ?");
  let n = 0;
  for (const p of gone) n += Number(del.run(p).changes);
  return n;
}

/**
 * The whole sweep: terminal leases, then dead cursors, then a WAL checkpoint on each store it
 * opened. Ends with ONE `info swept` line carrying every count, on a dry run too.
 *
 * A dry run counts every row, deletes nothing, and skips the checkpoint (a checkpoint is a write,
 * however harmless).
 *
 * A failure writes `error job-failed` and throws, so the run exits non-zero.
 */
export function sweep(deps: RetentionDeps): Swept {
  try {
    const dryRun = deps.env.str(RETENTION_DRY_RUN_ENV) === "1";
    const leaseDays = deps.env.num(RETENTION_LEASE_DAYS_ENV);
    if (dryRun) deps.log.info("dry-run", { msg: "counting only, nothing is deleted" });

    const cutoff = iso(deps.now().getTime() - leaseDays * 86_400_000);

    const lease = deps.db("lease");
    const leaseRows = pruneLeases(lease, cutoff, dryRun);

    const log = deps.db("log");
    const deadCursors = pruneCursors(log, dryRun);

    if (!dryRun) {
      lease.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      log.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    }

    const out: Swept = { leaseRows, leaseDays, deadCursors, dryRun };
    deps.log.info("swept", { leaseRows, leaseDays, deadCursors, dryRun: dryRun ? 1 : 0 });
    return out;
  } catch (e) {
    deps.log.error("job-failed", { msg: errText(e) });
    throw e;
  }
}

export default defineJob({
  name: "ops-retention",
  description: "Prune terminal leases and dead log cursors, then checkpoint the WAL, once a day (JOB-O06).",
  plugin: "ops",
  permissionMode: "auto",
  exec: async (ctx: JobContext): Promise<void> => {
    sweep({ log: ctx.log, env: ctx.env, now: ctx.now, db: (name) => ctx.db(name).handle() });
  },
});
