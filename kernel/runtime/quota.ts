// J4.8 (QTA-01, QTA-05, QTA-06, QTA-07) — the account breaker. A walled account parks itself once
// and recovers by itself: the window expires, and the next real run IS the probe.
//
// `scope` is one ACCOUNT, not one job (QTA-01). Standalone, every job spawns the same CLI against
// the same account, so they share `QUOTA_SCOPE` and whichever job discovers the limit parks the
// rest. In a fleet each worker holds its own token, so a worker gets its own scope
// (`workerScope(container)`) and one exhausted subscription darkens ONLY that container.
// `workerScope` ships with NO CALLER at N4 — QTA-01's own text names it, and it is three
// characters of string concatenation whose absence would make QTA-02/03/04 (M9) a redesign rather
// than a wiring job.
//
// QTA-05 — nothing re-probes. There is no prober and there must not be: the window expires, and
// the next real run is the probe. A still-limited probe simply re-parks. `clearPause` exists for a
// successful probe or a hand-lift after an upgrade; nothing calls it on a schedule.
//
// Every knob here is read PER CALL — a deliberate difference from every other knob in this repo
// (its own header reason): standalone, a park idles EVERYTHING; on a fleet it idles one
// subscription of N, and the right number differs by deployment, so a change should land on the
// next tick, not need a restart.
import { openDb, type Db } from "./db.ts";
import { dbPath } from "../paths.ts";
import { envStr, envNum, envDynamic, type EnvSpec } from "../config.ts";
import { nowIso } from "../time.ts";

export const NS = "quota";

export const QUOTA_SCOPE_ENV: EnvSpec = {
  key: "QUOTA_SCOPE",
  default: "claude",
  why: "the host/factory account scope every standalone job shares (QTA-01) — one switch, so whichever job discovers the limit parks the rest",
};
export const QUOTA_SCOPE: string = envStr(QUOTA_SCOPE_ENV);

/** One worker container's account. Prefixed so a container literally named `claude` cannot
 *  collide with the host scope. NO CALLER at N4 — see the module header. */
export const workerScope = (container: string): string => `worker:${container}`;

export type LimitClass = "session" | "daily" | "usage" | "weekly" | "monthly" | "spend" | "unknown";

const isoAt = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function quotaDb(): Db {
  const db = openDb(dbPath("quota"));
  db.migrate(NS, []); // no tables of its own; the quota_meta key/value store is enough
  return db;
}

// ---------------------------------------------------------------------------------------------
// The classifier. ONE vocabulary, and both patterns are BUILT from it — not written twice and
// compared. A period word added to one and not the other classifies as `unknown` a wall it has
// just matched, which is a live risk with two hand-duplicated literals (the reference's own
// shape); construction removes the drift instead of merely detecting it.
// ---------------------------------------------------------------------------------------------

const PERIODS = ["weekly", "monthly", "daily", "usage", "session"] as const;
const ALT = PERIODS.join("|");

/** Deliberately narrow: pausing on an unrelated error would mute a real failure. `spend limit` is
 *  its own alternative because the period word is not adjacent to `limit` in that family — "your
 *  org's monthly spend limit" — so the first alternative misses it (measured: this machine's own
 *  quota store carries exactly that wording, ruling 1). */
const LIMIT_RE = new RegExp(`\\b(?:${ALT})\\s+limit\\b|\\bspend\\s+limit\\b|\\blimit\\s+reached\\b`, "i");

/** `LIMIT_RE`'s period alternation, captured. The same words in the same order, constructed from
 *  the SAME list — so a wording added to one and not the other is not a thing that can happen. */
const PERIOD_RE = new RegExp(`\\b(${ALT})\\s+limit\\b`, "i");

export const isLimitError = (message: string): boolean => LIMIT_RE.test(message);

/**
 * Which limit a wall names. `spend` is tested FIRST and wins over the period word standing next
 * to it: an admin raising a cap is a different remedy from a plan reset, and the two share a
 * window anyway. A message naming no period classifies `unknown` rather than guessing — the class
 * only ever LENGTHENS a window, so a wrong guess is a needlessly dark account.
 */
export function limitClass(message: string): LimitClass {
  if (/\bspend\s+limit\b/i.test(message)) return "spend";
  const m = PERIOD_RE.exec(message);
  return m ? (m[1]!.toLowerCase() as LimitClass) : "unknown";
}

// ---------------------------------------------------------------------------------------------
// QTA-06 — the window, sized by class. QTA-07 — the dark gap.
// ---------------------------------------------------------------------------------------------

export const QUOTA_PAUSE_MS_ENV: EnvSpec = {
  key: "QUOTA_PAUSE_MS",
  default: "1800000", // 30 minutes
  why: "the base re-probe window; every class scales it by a multiple (QTA-06), read per call",
};

/** The knob FAMILY row (KRN-06's workaround, the `<NAME>_DB`/`LOCK_STARVE_N_<JOB>` precedent) —
 *  seven real keys (`QUOTA_PAUSE_MS_SESSION` … `_SPEND`), none of them a single readable name. */
export const QUOTA_PAUSE_MS_FAMILY_ENV: EnvSpec = {
  key: "QUOTA_PAUSE_MS_<CLASS>",
  why: "pin one class's window in ms directly, when its cadence should not move with the others (QTA-06)",
};

export const QUOTA_DARK_GAP_MS_ENV: EnvSpec = {
  key: "QUOTA_DARK_GAP_MS",
  default: "7200000", // 2 hours
  why: "how long after a window expires a fresh park still belongs to the SAME outage (QTA-07) — the floor is the class's own window",
};

/**
 * The re-probe cadence per class, as a multiple of `QUOTA_PAUSE_MS`. A session/daily/5-hour wall
 * really can lift within the hour and keeps the base window; a weekly one cannot (2×); a monthly
 * or org-spend one is days out, so 4× is still hours, not month-end. `unknown` stays at 1× — only
 * a POSITIVELY identified long period may probe less often, or one unrecognised wording darkens
 * an account for hours over nothing.
 */
const CLASS_MULTIPLES: Record<LimitClass, number> = {
  session: 1,
  daily: 1,
  usage: 1,
  unknown: 1,
  weekly: 2,
  monthly: 4,
  spend: 4,
};

function pauseMsFor(cls: LimitClass): number {
  const familyKey = `QUOTA_PAUSE_MS_${cls.toUpperCase()}`;
  const raw = envDynamic(familyKey);
  if (raw === undefined) return envNum(QUOTA_PAUSE_MS_ENV) * CLASS_MULTIPLES[cls];
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${familyKey}: not a non-negative number: ${JSON.stringify(raw)} — ${QUOTA_PAUSE_MS_FAMILY_ENV.why}`);
  }
  return n;
}

function darkGapMsFor(cls: LimitClass): number {
  return Math.max(pauseMsFor(cls), envNum(QUOTA_DARK_GAP_MS_ENV));
}

// ---------------------------------------------------------------------------------------------
// The store — until:/since:/class:/note: per scope. A cleared pause holds "", which sorts below
// any ISO instant, so it drops out of listPaused with the expired ones.
// ---------------------------------------------------------------------------------------------

export const pausedUntil = (scope: string): string | null => quotaDb().metaGet(NS, `until:${scope}`) || null;

export function isPaused(scope: string): boolean {
  const until = pausedUntil(scope);
  return until != null && until > nowIso();
}

/**
 * Opens `scope`'s breaker for one window, sized by the class of limit `message` names. Returns
 * the ISO instant it re-probes at.
 *
 * `since:` is the start of the CONTINUOUS outage, not of this window (QTA-07): re-parking IS the
 * shape of a long outage, and stamping `since` on every park would make every outage read as one
 * window old. `class:` is recorded beside it so a watcher never re-parses the message. A breaker
 * lifted by hand starts a new outage, which is what lifting one means.
 */
export function pause(scope: string, message: string = ""): string {
  const d = quotaDb();
  const cls = limitClass(message);
  // Read BEFORE the overwrite: the previous window's expiry is what says whether this park
  // continues an outage or opens one.
  const prev = d.metaGet(NS, `until:${scope}`) ?? "";
  const now = Date.now();
  const continuous = prev !== "" && now - Date.parse(prev) <= darkGapMsFor(cls);
  const until = isoAt(now + pauseMsFor(cls));
  d.metaSet(NS, `until:${scope}`, until);
  d.metaSet(NS, `class:${scope}`, cls);
  if (!continuous) d.metaSet(NS, `since:${scope}`, nowIso());
  if (message) d.metaSet(NS, `note:${scope}`, message.slice(0, 500));
  return until;
}

/** Lifts the pause early — for a successful probe, or a hand-lift after an upgrade. */
export function clearPause(scope: string): void {
  quotaDb().metaSet(NS, `until:${scope}`, "");
}

export interface PauseInfo {
  readonly scope: string;
  readonly until: string | null;
  /** Start of the CONTINUOUS outage — survives a re-park, so this is the darkness, not the
   *  current window. */
  readonly since: string | null;
  readonly limit: LimitClass;
  readonly note: string | null;
  readonly active: boolean;
}

export function inspect(scope: string): PauseInfo {
  const d = quotaDb();
  const until = d.metaGet(NS, `until:${scope}`) || null;
  const note = d.metaGet(NS, `note:${scope}`) || null;
  return {
    scope,
    until,
    since: d.metaGet(NS, `since:${scope}`) || null,
    // A breaker opened before the class was recorded still carries the message it opened on, so
    // classify that rather than reporting `unknown` for a wall that is right there to read.
    limit: (d.metaGet(NS, `class:${scope}`) as LimitClass | null) || limitClass(note ?? ""),
    note,
    active: until != null && until > nowIso(),
  };
}

/** Every breaker open right now, soonest re-probe first. A cleared pause holds `""`, which sorts
 *  below any ISO instant and drops out with the expired ones. */
export function listPaused(): PauseInfo[] {
  const now = nowIso();
  const rows = quotaDb()
    .handle()
    .prepare(`SELECT key FROM ${NS}_meta WHERE key LIKE 'until:%' AND value > ? ORDER BY value`)
    .all(now) as unknown as { key: string }[];
  return rows.map((r) => inspect(r.key.slice("until:".length)));
}
