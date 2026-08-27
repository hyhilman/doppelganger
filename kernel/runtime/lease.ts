// The mutex: `scope` + `key`, one SQLite statement per acquire, `done` terminal at any horizon,
// an owner string a reaper can check later without guessing.
//
// NOTHING IN THE SPEC SAYS WHAT A LEASE IS FOR AT v0 — every named consumer is
// v1 (pipeline watchers), M9 (LSE-12's serial group) or N5 (`ops-lease-reap`). `withLease` is what
// gives this store a real writer: `<job>@<UTC hour>` in `runNamed`. The v0 unit of exclusion is
// ONE JOB'S ONE FIRING — the gate (per-process, kernel/runtime/gate.ts) and the lease (per-host,
// per-instance) divide exactly at that line.
//
// `renew` and `heldCount` are NOT here. `renew` exists in the reference so a long task can hold a
// small TTL; ours derives the TTL from SUP-13's own bound instead (host/run.ts's hourly key), so
// it has no caller. `heldCount` fed `maxConcurrent`, which is cut — one key per job per hour, and
// `acquireSelf` already caps per program in-process. LSE-12 (M9) names `heldCount` explicitly and
// brings it back with the serial group that needs it.
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { openDb, type Db } from "./db.ts";
import { dbPath } from "../paths.ts";
import { INSTANCE } from "../instance.ts";
import { pidNamespace, ownerLiveness, type ProcReaders } from "./proc.ts";

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
 * the reference's second step (`ALTER TABLE ... ADD COLUMN max_attempts`) is a
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
 * `done` is terminal at any horizon — `status <> 'done'` in the WHERE is the whole rule.
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
// withLease is CUT down on purpose: no `settle`, no `maxConcurrent`, no `heldCount`, no `renew`,
// no heartbeat interval, no `AbortSignal`, no `lost`, and above all no `beatMs` — a test seam
// added to a production signature purely so a test could watch a path no caller takes.
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
 * The instance leads: without it, `lease-clear` shows a `held` claim with no way to tell
 * which checkout owns it, while LSE-07's guards correctly refuse to touch it — a stuck key no
 * operator can safely attribute. `pidNamespace() ?? "?"` is deliberate: on a `/proc` that will not
 * say, the owner string legitimately carries a value `parseOwner` cannot place, which is what
 * keeps such a claim unreapable rather than guessed at.
 */
export const newOwner = (): string =>
  `${INSTANCE}:${hostname()}:${pidNamespace() ?? "?"}:${process.pid}:${randomUUID().slice(0, 8)}`;

/**
 * Returns `null` for anything not in the exact five-field shape — including the reference's own
 * four-field owner. A hostname that somehow contained a `:` yields six parts -> `null` ->
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

// ---------------------------------------------------------------------------------------------
// reapDead deletes live claims whose owning process is gone, so the key is reusable NOW rather
// than at expiry. Every guard is a SKIP, and the order is cheapest-and-most-decisive first. Only a
// row that survives every guard is reaped — and it is reaped with `force` BECAUSE it is `held`:
// the guards above are what earn the `force`, and this is not the same operation as a hand-typed
// `lease-clear --force`.
// ---------------------------------------------------------------------------------------------

export interface Reaped {
  readonly scope: string;
  readonly key: string;
  readonly owner: string;
  readonly pid: number;
  readonly claimedAt: string;
  readonly ttlLeftMin: number;
}

/** A claim is written before its worker has done anything observable; a sweep landing in that
 *  window would read a still-forking process as dead. */
export const REAP_GRACE_MS = 30_000;

/**
 * The guard table, in order:
 *   0. pidNamespace() === null           -> liveness is unknowable here (no /proc, hardened, non-
 *      Linux). Reaping nothing is the correct no-op.
 *   1. row.status !== "held"             -> "done" is terminal by design (the dedup itself); "failed"
 *      self-expires. Neither blocks anyone.
 *   2. expiresAt unparseable or already expired -> an EXPIRED claim is already stealable by
 *      `acquire`, so deleting it buys no latency and LOSES the crash-loop brake (`attempts` would
 *      reset). A claim expired AND out of attempts is the `exhausted` poison pill, held for a
 *      person to look at.
 *   3. parseOwner(row.owner) === null    -> LSE-08: we were never told enough to judge it. Not
 *      reapable, never guessed — it ages out on the TTL exactly as it always did.
 *   4. id.instance !== INSTANCE          -> another checkout on this host owns it. Two
 *      instances never coordinate.
 *   5. id.pidns !== ns                   -> the load-bearing one: a pid only means something inside
 *      the /proc that issued it.
 *   6. id.host !== hostname()            -> not ours to judge.
 *   7. now - claimedAt < REAP_GRACE_MS   -> a claim written moments ago; give the worker time to
 *      exist.
 *   8. ownerLiveness(...) !== "dead"     -> J4.2's whole content: "unknown" is not "dead", and
 *      `ENOENT` is positive evidence ONLY on an unrestricted `/proc` (procIsRestricted downgrades
 *      the whole arm inside ownerLiveness itself).
 *   9. clear(scope, key, { force: true }) === 0 -> somebody else got there first.
 */
export function reapDead(opts?: { readonly now?: number; readonly readers?: ProcReaders }): Reaped[] {
  const ns = pidNamespace(opts?.readers); // guard 0
  if (ns === null) return [];

  const now = opts?.now ?? Date.now();
  const reaped: Reaped[] = [];

  for (const row of list()) {
    if (row.status !== "held") continue; // guard 1

    const expiresAtMs = Date.parse(row.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) continue; // guard 2

    const id = parseOwner(row.owner);
    if (id === null) continue; // guard 3
    if (id.instance !== INSTANCE) continue; // guard 4
    if (id.pidns !== ns) continue; // guard 5
    if (id.host !== hostname()) continue; // guard 6

    const claimedAtMs = Date.parse(row.claimedAt);
    if (!Number.isFinite(claimedAtMs) || now - claimedAtMs < REAP_GRACE_MS) continue; // guard 7

    if (ownerLiveness(id.pid, claimedAtMs, opts?.readers) !== "dead") continue; // guard 8

    const deleted = clear(row.scope, row.key, { force: true });
    if (deleted === 0) continue; // guard 9

    reaped.push({
      scope: row.scope,
      key: row.key,
      owner: row.owner,
      pid: id.pid,
      claimedAt: row.claimedAt,
      ttlLeftMin: Math.round((expiresAtMs - now) / 60_000),
    });
  }
  return reaped;
}
