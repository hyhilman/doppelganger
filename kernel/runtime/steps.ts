// Per-step attempt counting, and the DLQ it feeds.
//
//   takeStep(id, "watch:assignment")  ──▶ ok, attempts 1 … 3  ──▶ the watcher runs
//                                     ──▶ NOT ok, attempts 4 > cap 3  ──▶ status 'dead'
//
// A stage that can re-read a row can loop on it. So every step has a cap, and every cap ends in the
// DLQ. The count is per STEP, not per row: `backlog_item.attempts` bumps on every settle, success
// too, and spans three stages, so it cannot say which step is stuck (DLQ-07).
//
// A CAP IS NOT A DELETE. A dead row is reported (DLQ-10) and a human can tick it or revive it
// (DLQ-11, DLQ-12). Nothing revives on a schedule (DLQ-13): a queue that re-feeds itself is the loop
// again. Route-agnostic like the store: a step key's qualifier is an opaque string, and the lease
// keys `revive` clears are handed in, not looked up in a watcher registry.
import { envNum, type EnvSpec } from "../config.ts";
import { nowIso } from "../time.ts";
import { clear as clearLease } from "./lease.ts";
import { COLS, LIVE_STATUSES, backlogDb, dlqRef, get, query, updateOne, type BacklogRow } from "./backlog.ts";

export const STEP_CAP_ROUTE_ENV: EnvSpec = {
  key: "STEP_CAP_ROUTE",
  default: "5",
  why: "how many times the switch may try to classify one row before it is dead-lettered (DLQ-02)",
};
export const STEP_CAP_WATCH_ENV: EnvSpec = {
  key: "STEP_CAP_WATCH",
  default: "3",
  why: "how many times a watcher may take one row, per route and stage, before it is dead-lettered (DLQ-02)",
};
export const STEP_CAP_BRIEF_ENV: EnvSpec = {
  key: "STEP_CAP_BRIEF",
  default: "7",
  why: "how many mornings a brief may offer one row before it is dead-lettered (DLQ-02)",
};
export const STEP_CAP_DEFAULT_ENV: EnvSpec = {
  key: "STEP_CAP_DEFAULT",
  default: "10",
  why: "the cap for a step kind nobody registered — finite, because an uncapped step is a silent loop (DLQ-02)",
};

/** One step kind: how many times a row may enter it, and what one attempt is, in DLQ words. */
export interface StepKind {
  readonly kind: string;
  readonly cap: () => number;
  readonly what: string;
}

/**
 * DLQ-02, as data. Caps are per KIND, read on every call; the qualifier after the first colon keeps
 * counters apart but never changes the cap.
 */
export const STEP_KINDS: readonly StepKind[] = [
  { kind: "route", cap: () => envNum(STEP_CAP_ROUTE_ENV), what: "the switch tried to classify it" },
  { kind: "watch", cap: () => envNum(STEP_CAP_WATCH_ENV), what: "its watcher tried to drain it" },
  { kind: "brief", cap: () => envNum(STEP_CAP_BRIEF_ENV), what: "a brief offered it" },
  // One row per (PR, finding), and each try costs an agent run, so it is lower than `watch`. Its
  // knob arrives with the watch-pr-fix job that owns it.
  { kind: "pr-fix", cap: () => 2, what: "watch-pr-fix tried to validate it" },
];

/** `watch:assignment:plan` → `watch`: the kind is everything left of the first colon. */
export const stepKind = (step: string): string => step.split(":")[0]!;

const kindOf = (step: string): StepKind | undefined => STEP_KINDS.find((k) => k.kind === stepKind(step));

export const stepCap = (step: string): number => kindOf(step)?.cap() ?? envNum(STEP_CAP_DEFAULT_ENV);

export const stepWhat = (step: string): string => kindOf(step)?.what ?? "a step took it";

/** DLQ-05: the key a watcher counts under, qualified by route and, for a multi-stage job, by stage,
 *  so a moved row or a second stage never inherits another counter's exhaustion. */
export const watchStep = (route: string, stage?: string): string =>
  stage ? `watch:${route}:${stage}` : `watch:${route}`;

export const ROUTE_STEP = "route";
export const BRIEF_STEP = "brief";

/** The outcome of taking a row into a step. `ok: false` means the row was JUST dead-lettered. */
export interface StepTake {
  readonly ok: boolean;
  readonly step: string;
  readonly attempts: number;
  readonly cap: number;
  /** false on a dry run: nothing was written (DLQ-09). */
  readonly counted: boolean;
}

function currentCount(id: string, step: string): number {
  const r = backlogDb().handle().prepare("SELECT attempts FROM backlog_step WHERE id = ? AND step = ?").get(id, step) as
    | { attempts: number }
    | undefined;
  return Number(r?.attempts ?? 0);
}

/**
 * Take a row into a step: bump that step's counter, and dead-letter the row if it has now run out.
 *
 * Called when the step TAKES the row, not on failure: a handler that returns early records no
 * failure, and a row the model skips never runs at all, but both are entries. The dead-letter is
 * done in here (DLQ-06), because a flag every call site must remember is a loop when one forgets.
 *
 * `dryRun` counts nothing (DLQ-09): it reports the count as it stands and writes no row.
 */
export function takeStep(id: string, step: string, opts?: { readonly note?: string; readonly dryRun?: boolean }): StepTake {
  const cap = stepCap(step);
  if (opts?.dryRun === true) {
    return { ok: true, step, attempts: currentCount(id, step), cap, counted: false };
  }
  const now = nowIso();
  const attempts = backlogDb().tx((db) => {
    db.prepare(
      `INSERT INTO backlog_step (id, step, attempts, first_at, last_at, note)
         VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(id, step) DO UPDATE SET
         attempts = backlog_step.attempts + 1,
         last_at  = excluded.last_at,
         note     = COALESCE(excluded.note, backlog_step.note)`,
    ).run(id, step, now, now, opts?.note ?? null);
    const r = db.prepare("SELECT attempts FROM backlog_step WHERE id = ? AND step = ?").get(id, step) as
      | { attempts: number }
      | undefined;
    return Number(r?.attempts ?? 1);
  });
  if (attempts <= cap) return { ok: true, step, attempts, cap, counted: true };
  deadLetter(id, step, attempts);
  return { ok: false, step, attempts, cap, counted: true };
}

/**
 * DLQ-04: take at most `runCap` of `ids` into `step`, and charge NOTHING to the rest. A row a
 * per-run cap refused was never tried, and charging it would dead-letter rows that never ran.
 */
export function takeWithin(
  ids: readonly string[],
  step: (id: string) => string,
  runCap: number,
  opts?: { readonly dryRun?: boolean },
): { readonly taken: ReadonlyArray<{ readonly id: string; readonly take: StepTake }>; readonly refused: readonly string[] } {
  const chosen = ids.slice(0, runCap);
  return {
    taken: chosen.map((id) => ({ id, take: takeStep(id, step(id), { dryRun: opts?.dryRun }) })),
    refused: ids.slice(runCap),
  };
}

/** Move a row to the DLQ. Guarded on the row still being live, so a second call cannot overwrite
 *  the receipt that names the step that really killed it. The row's lease is left alone: it says
 *  why the watcher gave up, and `revive` is what clears it. */
export function deadLetter(id: string, step: string, attempts: number): boolean {
  return updateOne(
    `UPDATE backlog_item SET status = 'dead', handled_ref = ?, updated_at = ?
       WHERE id = ? AND status IN (${LIVE_STATUSES})`,
    dlqRef(step, attempts), nowIso(), id,
  );
}

/** The DLQ, most recently dead-lettered first. */
export function deadLetters(limit = 200): BacklogRow[] {
  return query(`SELECT ${COLS} FROM backlog_item WHERE status = 'dead' ORDER BY updated_at DESC LIMIT ?`, limit);
}

export interface StepCount {
  readonly step: string;
  readonly attempts: number;
  readonly lastAt: string;
  readonly note: string | null;
}

/** Every step one row has been through, busiest first — the DLQ line's detail. */
export function stepsFor(id: string): StepCount[] {
  return (
    backlogDb().handle().prepare(
      "SELECT step, attempts, last_at, note FROM backlog_step WHERE id = ? ORDER BY attempts DESC, step",
    ).all(id) as Array<{ step: string; attempts: number; last_at: string; note: string | null }>
  ).map((r) => ({ step: r.step, attempts: Number(r.attempts), lastAt: r.last_at, note: r.note }));
}

/** One lease claim to clear on revive. */
export interface LeaseKey {
  readonly scope: string;
  readonly key: string;
}

export type Revival =
  | { readonly ok: true; readonly leases: readonly string[] }
  | { readonly ok: false; readonly leases: readonly string[]; readonly reason: string };

/**
 * DLQ-12: the only way back into a retry queue. Clear the leases, reset the counters, then return
 * the row to `routed` (or `new` if it never got a route) with its receipt cleared.
 *
 * `leasesOf` is the caller's: which lease keys hold this row. The store keeps no watcher registry.
 *
 * ORDER MATTERS. Leases and counters first, the status last: a crash part way leaves the row dead
 * with a clean slate, never live with an exhausted lease no tick can claim.
 */
export function revive(id: string, leasesOf: (row: BacklogRow) => readonly LeaseKey[] = () => []): Revival {
  const row = get(id);
  if (row == null) return { ok: false, leases: [], reason: "no such item" };
  if (row.status !== "dead") return { ok: false, leases: [], reason: `status is \`${row.status}\`` };
  const cleared: string[] = [];
  for (const l of leasesOf(row)) {
    // `force`: nothing runs against a dead row, so a `held` claim is a dead worker's.
    if (clearLease(l.scope, l.key, { force: true }) > 0) cleared.push(`${l.scope}/${l.key}`);
  }
  backlogDb().tx((db) => db.prepare("DELETE FROM backlog_step WHERE id = ?").run(id));
  const ok = updateOne(
    `UPDATE backlog_item
        SET status = CASE WHEN route IS NULL THEN 'new' ELSE 'routed' END,
            handled_ref = NULL, updated_at = ?
      WHERE id = ? AND status = 'dead'`,
    nowIso(), id,
  );
  return ok ? { ok: true, leases: cleared } : { ok: false, leases: cleared, reason: "lost a race" };
}
