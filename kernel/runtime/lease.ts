// J4.3 (LSE-01, LSE-02, LSE-04, LSE-05, LSE-06, INS-04) — the mutex. `scope` + `key`, one SQLite
// statement per acquire, `done` terminal at any horizon, an owner string a reaper can check later
// without guessing.
//
// NO `LSE-` ROW SAYS WHAT A LEASE IS FOR AT v0 (roadmap.md Gaps item 3) — every named consumer is
// v1 (pipeline watchers), M9 (LSE-12's serial group) or N5 (`ops-lease-reap`). `withLease` (J4.4)
// is what gives this store a real writer: `<job>@<UTC hour>` in `runNamed`. The v0 unit of
// exclusion is ONE JOB'S ONE FIRING — the gate (per-process, kernel/runtime/gate.ts) and the lease
// (per-host, per-instance) divide exactly at that line.
//
// `renew` and `heldCount` are NOT here (ruling 3, plan/N4-uac.md). `renew` exists in the reference
// so a long task can hold a small TTL; ours derives the TTL from SUP-13's own bound instead
// (host/run.ts's hourly key), so it has no caller. `heldCount` fed `maxConcurrent`, which is cut —
// one key per job per hour, and `acquireSelf` already caps per program in-process. LSE-12 (M9)
// names `heldCount` explicitly and brings it back with the serial group that needs it.
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { openDb, type Db } from "./db.ts";
import { dbPath } from "../paths.ts";
import { INSTANCE } from "../instance.ts";
import { pidNamespace } from "./proc.ts";

export const NS = "lease";

export type LeaseStatus = "held" | "done" | "failed";

export interface Lease {
  readonly scope: string;
  readonly key: string;
  readonly owner: string;
  readonly claimedAt: string;
  readonly expiresAt: string;
  readonly attempts: number;
}

export interface LeaseRow extends Lease {
  readonly status: LeaseStatus;
  readonly note: string | null;
  readonly updatedAt: string;
  readonly maxAttempts: number;
}

export type RefusedReason = "held" | "done" | "exhausted";

export type AcquireResult =
  | { readonly ok: true; readonly lease: Lease }
  | { readonly ok: false; readonly reason: RefusedReason; readonly current: LeaseRow | null };

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;

const isoAt = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Opens `lease.db` and applies the one migration step. `steps` stays append-only from here
 *  (DBS-02) — the reference's second step (`ALTER TABLE ... ADD COLUMN max_attempts`) is a
 *  historical fact of ITS database, not of ours; ours declares the column in step 1. */
export function leaseDb(): Db {
  const db = openDb(dbPath("lease"));
  db.migrate(NS, [
    `CREATE TABLE lease_claim (
       scope TEXT NOT NULL,
       key TEXT NOT NULL,
       owner TEXT NOT NULL,
       status TEXT NOT NULL,
       claimed_at TEXT NOT NULL,
       expires_at TEXT NOT NULL,
       attempts INTEGER NOT NULL,
       max_attempts INTEGER NOT NULL,
       note TEXT,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (scope, key)
     )`,
  ]);
  return db;
}

interface RawRow {
  readonly scope: string;
  readonly key: string;
  readonly owner: string;
  readonly status: string;
  readonly claimed_at: string;
  readonly expires_at: string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly note: string | null;
  readonly updated_at: string;
}

const mapRow = (r: RawRow): LeaseRow => ({
  scope: r.scope,
  key: r.key,
  owner: r.owner,
  status: r.status as LeaseStatus,
  claimedAt: r.claimed_at,
  expiresAt: r.expires_at,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  note: r.note,
  updatedAt: r.updated_at,
});

/** The row at `scope`/`key`, or `null` when no claim has ever been made there. */
export function read(scope: string, key: string): LeaseRow | null {
  const row = leaseDb()
    .handle()
    .prepare(`SELECT * FROM lease_claim WHERE scope = ? AND key = ?`)
    .get(scope, key) as RawRow | undefined;
  return row ? mapRow(row) : null;
}

/** Every claim in `scope`, or every claim in the store when `scope` is omitted. */
export function list(scope?: string): LeaseRow[] {
  const handle = leaseDb().handle();
  const rows =
    scope !== undefined
      ? (handle.prepare(`SELECT * FROM lease_claim WHERE scope = ? ORDER BY key`).all(scope) as unknown as RawRow[])
      : (handle.prepare(`SELECT * FROM lease_claim ORDER BY scope, key`).all() as unknown as RawRow[]);
  return rows.map(mapRow);
}

/**
 * `done` is terminal at any horizon (LSE-02) — `status <> 'done'` in the WHERE is the whole rule.
 * Deletion (`clear`) is the only way back; the reason is deliberate: XEN-8365 was a plan drafted
 * once, whose lease going `done` a second time (on a re-run the operator genuinely wanted) would
 * have silently discarded a real retry.
 *
 * LSE-05: `attempts >= maxAttempts` refuses ONLY when the row has also expired — an unexpired
 * over-attempt row is still somebody's live claim and reads `"held"`, never `"exhausted"`.
 */
function refusalReason(row: LeaseRow, nowIsoStr: string): RefusedReason {
  if (row.status === "done") return "done";
  const expired = row.expiresAt <= nowIsoStr;
  if (expired && row.attempts >= row.maxAttempts) return "exhausted";
  return "held";
}

/**
 * ONE statement — the whole test-and-set. A read-then-write leaves a window where two ticks both
 * see the key free, which is the exact bug this primitive exists to prevent.
 */
export function acquire(scope: string, key: string, opts?: { readonly ttlMs?: number; readonly maxAttempts?: number }): AcquireResult {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const db = leaseDb();
  const owner = newOwner();
  const claimedAt = isoAt(Date.now());
  const expiresAt = isoAt(Date.now() + ttlMs);

  const result = db
    .handle()
    .prepare(
      `INSERT INTO lease_claim (scope, key, owner, status, claimed_at, expires_at, attempts, max_attempts, note, updated_at)
       VALUES (?, ?, ?, 'held', ?, ?, 1, ?, NULL, ?)
       ON CONFLICT(scope, key) DO UPDATE SET
         owner = excluded.owner,
         status = 'held',
         claimed_at = excluded.claimed_at,
         expires_at = excluded.expires_at,
         attempts = lease_claim.attempts + 1,
         max_attempts = excluded.max_attempts,
         note = NULL,
         updated_at = excluded.updated_at
       WHERE lease_claim.status <> 'done'
         AND lease_claim.expires_at <= excluded.claimed_at
         AND lease_claim.attempts < lease_claim.max_attempts`,
    )
    .run(scope, key, owner, claimedAt, expiresAt, maxAttempts, claimedAt);

  if (result.changes === 1) {
    const row = read(scope, key)!;
    return {
      ok: true,
      lease: { scope, key, owner: row.owner, claimedAt: row.claimedAt, expiresAt: row.expiresAt, attempts: row.attempts },
    };
  }

  const current = read(scope, key);
  return { ok: false, reason: refusalReason(current!, claimedAt), current };
}

/**
 * Settles a `held` claim `done` or `failed` — the owner guard is load-bearing: a worker whose
 * lease was stolen (its TTL lapsed and a later `acquire` took it) must not be able to mark the key
 * done underneath its successor. `failed` self-expires (`expires_at` moves to now, so the key is
 * immediately retryable and still bounded by `maxAttempts`); `done` leaves `expires_at` untouched
 * because LSE-02 makes it irrelevant.
 */
export function release(lease: Lease, outcome: "done" | "failed" = "done"): boolean {
  const now = isoAt(Date.now());
  const changes = leaseDb()
    .handle()
    .prepare(
      `UPDATE lease_claim
         SET status = ?,
             expires_at = CASE WHEN ? = 'failed' THEN ? ELSE expires_at END,
             note = NULL,
             updated_at = ?
       WHERE scope = ? AND key = ? AND owner = ? AND status = 'held'`,
    )
    .run(outcome, outcome, now, now, lease.scope, lease.key, lease.owner).changes;
  return changes === 1;
}

// ---------------------------------------------------------------------------------------------
// J4.4 (LSE-03, LSE-04, LSE-09 subject) — withLease: acquire -> run -> release, four members and
// every one has a caller. See the header for what is CUT and why: no `settle`, no `maxConcurrent`,
// no `heldCount`, no `renew`, no heartbeat interval, no `AbortSignal`, no `lost`, and above all no
// `beatMs` — a test seam added to a production signature purely so a test could watch a path no
// caller takes.
// ---------------------------------------------------------------------------------------------

export type WithLeaseResult<T> =
  | { readonly ran: true; readonly result: T }
  | { readonly ran: false; readonly reason: RefusedReason };

/**
 * LSE-03, stated here as a TRAP, not as a feature: `withLease` settles `done` on ANY non-throwing
 * return, early returns included. Measured in the reference 2026-07-31: XEN-8365's plan was
 * drafted, the post failed, `handle` returned early, the lease went `done` with the row still
 * `routed`, and nothing would ever have retried it — 47 hours. This is documented, not silently
 * "fixed": a handler that returns normally has told the caller it finished, and a primitive that
 * second-guesses that would settle nothing for the handlers that genuinely did.
 *
 * A throw releases `failed` (which self-expires, leaving the key retryable and bounded by
 * `maxAttempts`) and RE-THROWS the original error unchanged.
 */
export async function withLease<T>(
  scope: string,
  key: string,
  fn: () => Promise<T>,
  opts?: { readonly ttlMs?: number; readonly maxAttempts?: number },
): Promise<WithLeaseResult<T>> {
  const got = acquire(scope, key, opts);
  if (!got.ok) {
    return { ran: false, reason: got.reason };
  }
  try {
    const result = await fn();
    release(got.lease, "done");
    return { ran: true, result };
  } catch (e) {
    release(got.lease, "failed");
    throw e;
  }
}

/**
 * Deletes the row at `scope`/`key`. Refuses a `held` claim unless `force` — deleting one lets a
 * second runner start beside the first, the exact race `acquire` exists to prevent. `force` is for
 * an owner known dead (a reaper's own `reapDead`, or an operator's `lease-clear --force`). Returns
 * the number of rows actually removed (0 or 1) — idempotent by construction.
 */
export function clear(scope: string, key: string, opts?: { readonly force?: boolean }): number {
  const force = opts?.force ?? false;
  const sql = force
    ? `DELETE FROM lease_claim WHERE scope = ? AND key = ?`
    : `DELETE FROM lease_claim WHERE scope = ? AND key = ? AND status <> 'held'`;
  return leaseDb().handle().prepare(sql).run(scope, key).changes as number;
}

// ---------------------------------------------------------------------------------------------
// INS-04 — the owner: five fields, not four. `<instance>:<host>:<pidns>:<pid>:<uuid8>`.
// ---------------------------------------------------------------------------------------------

/** `kernel/instance.ts`'s own `NAME_RE`, restated rather than imported (the same call
 *  `cli/crontab.ts`'s `INSTANCE_NAME` makes) — that one guards `INSTANCE` at RESOLUTION time, this
 *  one is a text-matching detail of an OWNER STRING, and the two must not become the same import
 *  just because they happen to agree today. */
const INSTANCE_NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;

export interface OwnerId {
  readonly instance: string;
  readonly host: string;
  readonly pidns: string;
  readonly pid: number;
}

/**
 * The instance leads (INS-04): without it, `lease-clear` shows a `held` claim with no way to tell
 * which checkout owns it, while LSE-07's guards correctly refuse to touch it — a stuck key no
 * operator can safely attribute. `pidNamespace() ?? "?"` is deliberate: on a `/proc` that will not
 * say, the owner string legitimately carries a value `parseOwner` cannot place, which is what
 * keeps such a claim unreapable (LSE-08) rather than guessed at.
 */
export const newOwner = (): string =>
  `${INSTANCE}:${hostname()}:${pidNamespace() ?? "?"}:${process.pid}:${randomUUID().slice(0, 8)}`;

/**
 * Returns `null` for anything not in the exact five-field shape — including the reference's own
 * four-field owner (LSE-08). A hostname that somehow contained a `:` yields six parts -> `null` ->
 * not reapable, which fails toward not reaping.
 */
export function parseOwner(owner: string): OwnerId | null {
  const parts = owner.split(":");
  if (parts.length !== 5) return null;
  const [instance, host, pidns, pidStr, uuid] = parts as [string, string, string, string, string];
  if (!INSTANCE_NAME_RE.test(instance)) return null;
  if (host === "") return null;
  if (!/^\d+$/.test(pidns)) return null;
  if (!/^\d+$/.test(pidStr)) return null;
  if (uuid === "") return null;
  return { instance, host, pidns, pid: Number(pidStr) };
}
