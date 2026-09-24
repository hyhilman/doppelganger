// The backlog: the pipeline's state store, and the one table every stage agrees on.
//
//   entry point ──▶ backlog_item ──▶ switch ──▶ backlog_item ──▶ watcher
//   (transcribe)     route IS NULL   (label)     route SET       (handle, settle)
//
// SOURCE-AGNOSTIC (PIP-02). Nothing here knows what a channel, a ticket or a thread is; an adapter
// maps those in. ROUTE-AGNOSTIC too: a route is an opaque string label. The route SET is not decided
// here (KRN-10 is open), so anything that needs a route's mode (PIP-09) takes a `ModeOf` lookup
// from the caller instead of reading a union or a registry.
//
// Two rules worth knowing before editing: `setRoute`'s `WHERE route IS NULL` is the compare-and-swap
// that stops double handling (PIP-05), and `unhandledSince` is the ONLY query that filters status
// negatively (PIP-15), so a new status must be ruled on there by hand.
import { openDb, type Db } from "./db.ts";
import { dbPath } from "../paths.ts";
import { nowIso } from "../time.ts";

export const NS = "backlog";

/**
 * PIP-03. `new` = no route yet · `routed` = the switch labelled it · `processing` = a human has it
 * in front of them (a claim, not progress) · `handled` = it LEFT the backlog (PIP-04: not "work
 * happened"; `handled_ref` says which) · `failed` = retryable, the step cap ends the retries ·
 * `dead` = the DLQ, a step ran out of attempts. Dead is terminal for the pipeline, not for a human.
 */
export type ItemStatus = "new" | "routed" | "processing" | "handled" | "failed" | "dead";

/** Statuses a row can still move out of on its own. Every selector that offers a row to a stage
 *  filters on this, which keeps `dead` out of every queue by construction. */
export const LIVE_STATUSES = "'new', 'routed', 'processing', 'failed'";

/** Of a row that HAS a route, the statuses that still owe work. `failed` sits with `routed`
 *  because it is retryable. */
export const UNSETTLED = "'routed', 'failed'";

/**
 * PIP-09's three modes. The vocabulary of MODES is closed; the set of ROUTES is not decided here.
 * `terminal`: nothing is owed, the row settles at route time · `watched`: a watcher drains it ·
 * `manual`: a human is owed an action.
 */
export type RouteMode = "terminal" | "watched" | "manual";

/** The caller's route → mode lookup. `undefined` means "no mode known", and every query here treats
 *  that as owed to a human: being seen in the wrong list beats not being seen. */
export type ModeOf = (route: string) => RouteMode | undefined;

/** One thing that wants attention, normalised across sources. */
export interface BacklogItem {
  /** `<source>:<externalId>`, built by `itemId` — it IS the dedup key. */
  readonly id: string;
  readonly source: string;
  readonly externalId: string;
  /** Channel, project, repo — whatever groups items in the source. */
  readonly container: string | null;
  readonly author: string | null;
  readonly text: string;
  readonly parentAuthor: string | null;
  readonly parentText: string | null;
  /** PIP-14: the conversation this item is PART OF, `<source>:<native grouping id>`. The adapter
   *  builds it; everything here treats it as opaque. Four nudges in one thread are one ask. */
  readonly convKey: string;
  /** Link back to the source. */
  readonly link: string;
  readonly occurredAt: string;
  /** The adapter's source row, verbatim. */
  readonly raw: string;
}

/** A stored item, with what the switch and the watchers wrote onto it. */
export interface BacklogRow extends BacklogItem {
  readonly route: string | null;
  readonly confidence: string | null;
  readonly why: string | null;
  readonly status: ItemStatus;
  readonly handledRef: string | null;
  /** Bumped by every `settle`, success too. NOT a retry count — `backlog_step` is (DLQ-07). */
  readonly attempts: number;
  readonly updatedAt: string | null;
}

export const itemId = (source: string, externalId: string): string => `${source}:${externalId}`;

// APPEND-ONLY. Index i is schema version i+1; never edit or reorder an applied step. A new column
// is one appended `ALTER TABLE backlog_item ADD COLUMN …`, and the columns test then asks whether
// anything reads it.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE backlog_item (
    id            TEXT PRIMARY KEY,
    source        TEXT NOT NULL,
    external_id   TEXT NOT NULL,
    container     TEXT,
    author        TEXT,
    text          TEXT NOT NULL,
    parent_author TEXT,
    parent_text   TEXT,
    conv_key      TEXT NOT NULL,
    link          TEXT NOT NULL,
    occurred_at   TEXT NOT NULL,
    raw           TEXT NOT NULL,
    fetched_at    TEXT NOT NULL,
    route         TEXT,
    confidence    TEXT,
    why           TEXT,
    status        TEXT NOT NULL DEFAULT 'new',
    handled_ref   TEXT,
    attempts      INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT
  );
  CREATE INDEX backlog_item_untriaged ON backlog_item(route, occurred_at);
  CREATE INDEX backlog_item_claim     ON backlog_item(route, status, occurred_at);
  CREATE INDEX backlog_item_source    ON backlog_item(source, occurred_at);
  CREATE INDEX backlog_item_conv      ON backlog_item(conv_key, occurred_at);
  `,
  // DLQ-01: one counter per (item, step). A side table, not a column per step: the step set is
  // open (every watcher names its own `watch:<route>[:<stage>]`). No foreign key: items are never
  // deleted, and a dangling counter is inert.
  `
  CREATE TABLE backlog_step (
    id       TEXT NOT NULL,
    step     TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    first_at TEXT NOT NULL,
    last_at  TEXT NOT NULL,
    note     TEXT,
    PRIMARY KEY (id, step)
  );
  CREATE INDEX backlog_step_item ON backlog_step(id, last_at);
  `,
];

/** Opens `backlog.db` (DBS-01, `BACKLOG_DB` redirects it) and applies the migrations. */
export function backlogDb(): Db {
  const db = openDb(dbPath("backlog"));
  db.migrate(NS, MIGRATIONS);
  return db;
}

/** One guarded UPDATE: did the compare-and-swap hit its row? */
export const updateOne = (sql: string, ...params: Array<string | number | null>): boolean =>
  backlogDb().tx((db) => Number(db.prepare(sql).run(...params).changes)) === 1;

const nul = (v: string | number | null | undefined): string | null => (v == null ? null : String(v));

export const toRow = (r: Record<string, string | number | null>): BacklogRow => ({
  id: String(r.id),
  source: String(r.source),
  externalId: String(r.external_id),
  container: nul(r.container),
  author: nul(r.author),
  text: String(r.text),
  parentAuthor: nul(r.parent_author),
  parentText: nul(r.parent_text),
  convKey: String(r.conv_key),
  link: String(r.link),
  occurredAt: String(r.occurred_at),
  raw: String(r.raw),
  route: nul(r.route),
  confidence: nul(r.confidence),
  why: nul(r.why),
  status: String(r.status) as ItemStatus,
  handledRef: nul(r.handled_ref),
  attempts: Number(r.attempts ?? 0),
  updatedAt: nul(r.updated_at),
});

/** The column list every selector here projects. PIP-16's test holds it to the table and to `toRow`. */
export const COLS = `id, source, external_id, container, author, text, parent_author, parent_text, conv_key,
              link, occurred_at, raw, route, confidence, why, status, handled_ref, attempts, updated_at`;

export const query = (sql: string, ...params: Array<string | number>): BacklogRow[] =>
  (backlogDb().handle().prepare(sql).all(...params) as Array<Record<string, string | number | null>>).map(toRow);

/** `?, ?, ?` for an `IN (…)` list of `n` bound params. */
const holes = (n: number): string => Array.from({ length: n }, () => "?").join(", ");

// ---------------------------------------------------------------------------------------------
// PIP-04: the receipt. `handled` means the row left the backlog; the ref says why. One builder per
// shape, and `refKind` reads a ref back, so "did a watcher do work?" is a question the data answers.
// ---------------------------------------------------------------------------------------------

export type RefKind = "link" | "terminal" | "skip" | "eod" | "picked" | "read" | "dlq";

/** A terminal route's receipt: nothing was ever owed here. */
export const terminalRef = (route: string): string => `terminal:${route}`;
/** Left on purpose, without work. */
export const skipRef = (reason: string): string => `skip:${reason}`;
/** The end-of-day resolver found it resolved. */
export const EOD_REF = "resolved:eod";
/** A human picked it from a brief; `issue` is the brief's issue. */
export const pickedRef = (issue: string): string => `picked:${issue}`;
/** A `read` route's receipt: which day's brief showed it. */
export const readRef = (day: string): string => `read:${day}`;
/** A dead-lettered row's receipt: the step that gave up, and the count it gave up at. */
export const dlqRef = (step: string, attempts: number): string => `dlq:${step}@${attempts}`;

/**
 * Which PIP-04 shape `ref` is, or `undefined` for one it does not name. A `https://` ref is the work
 * itself (a real one may carry several links). The real store also holds other shapes (`lane:`,
 * `moot:`, `discard:`), so this READS a ref and `settle` never refuses one.
 */
export function refKind(ref: string): RefKind | undefined {
  if (/^https:\/\//.test(ref)) return "link";
  if (/^terminal:\S+$/.test(ref)) return "terminal";
  if (/^skip:.+$/.test(ref)) return "skip";
  if (ref === EOD_REF) return "eod";
  if (/^picked:\S+$/.test(ref)) return "picked";
  if (/^read:\d{4}-\d{2}-\d{2}$/.test(ref)) return "read";
  if (/^dlq:\S+@\d+$/.test(ref)) return "dlq";
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// The lifecycle: insert → route → claim → settle.
// ---------------------------------------------------------------------------------------------

/**
 * Append what an entry point fetched. `INSERT OR IGNORE` on the id is the dedup, so re-emitting a
 * seen item costs nothing. Never an upsert: a re-fetch must not reset a route or a settled status.
 */
export function insertItems(items: readonly BacklogItem[]): number {
  if (items.length === 0) return 0;
  const now = nowIso();
  return backlogDb().tx((db) => {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO backlog_item
         (id, source, external_id, container, author, text, parent_author, parent_text, conv_key,
          link, occurred_at, raw, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let n = 0;
    for (const it of items) {
      n += Number(
        stmt.run(
          it.id, it.source, it.externalId, it.container, it.author, it.text, it.parentAuthor,
          it.parentText, it.convKey, it.link, it.occurredAt, it.raw, now,
        ).changes,
      );
    }
    return n;
  });
}

/** The switch's queue: no route yet, oldest first. `LIVE_STATUSES`, not `<> 'dead'`: a row that
 *  died in the `route` step and was then ticked `handled` must never come back here. */
export function untriaged(limit = 50): BacklogRow[] {
  return query(
    `SELECT ${COLS} FROM backlog_item
       WHERE route IS NULL AND status IN (${LIVE_STATUSES}) ORDER BY occurred_at LIMIT ?`,
    limit,
  );
}

/**
 * Label a row (PIP-05). Route and status move in ONE statement, and `WHERE route IS NULL` is the
 * compare-and-swap: a second labelling changes nothing. A terminal route settles in that same
 * statement (PIP-06), with `attempts` left at 0 because no watcher tried anything — a second
 * `settle()` call would reopen the gap a crash can land in.
 */
export function setRoute(
  id: string,
  v: { readonly route: string; readonly confidence: string; readonly why: string },
  modeOf: ModeOf,
): boolean {
  const terminal = modeOf(v.route) === "terminal";
  return updateOne(
    `UPDATE backlog_item SET route = ?, confidence = ?, why = ?, status = ?, handled_ref = ?,
                             updated_at = ?
       WHERE id = ? AND route IS NULL`,
    v.route, v.confidence, v.why,
    terminal ? "handled" : "routed",
    terminal ? terminalRef(v.route) : null,
    nowIso(), id,
  );
}

/** One route's queue, not yet settled. `failed` is in: it is retryable. */
export function byRoute(route: string, limit = 20): BacklogRow[] {
  return query(
    `SELECT ${COLS} FROM backlog_item
       WHERE route = ? AND status IN (${UNSETTLED}) ORDER BY occurred_at LIMIT ?`,
    route, limit,
  );
}

/** Move rows into `processing`. `WHERE status = 'routed'` is the CAS: a second claim moves 0 rows.
 *  `updated_at` is left alone — it is the routed-at time. */
export function claim(ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  return backlogDb().tx((db) => {
    const stmt = db.prepare("UPDATE backlog_item SET status = 'processing' WHERE id = ? AND status = 'routed'");
    let n = 0;
    for (const id of ids) n += Number(stmt.run(id).changes);
    return n;
  });
}

export function get(id: string): BacklogRow | null {
  return query(`SELECT ${COLS} FROM backlog_item WHERE id = ?`, id)[0] ?? null;
}

/**
 * Settle a row. `handledRef` is the receipt (PIP-04), so "handled" stays auditable.
 *
 * DLQ-11: a `dead` row may be settled `handled` (a human ticked it) but never `failed`, which would
 * put it back in `byRoute` and restart the loop the DLQ ended. `revive` is the only way back.
 */
export function settle(
  id: string,
  status: Extract<ItemStatus, "handled" | "failed">,
  handledRef?: string | null,
): boolean {
  return updateOne(
    `UPDATE backlog_item
        SET status = ?, handled_ref = COALESCE(?, handled_ref),
            attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND (status <> 'dead' OR ? = 'handled')`,
    status, handledRef ?? null, nowIso(), id, status,
  );
}

/** The distinct routes among rows matching `where`, for turning a lookup into an SQL list. */
function routesWhere(where: string, ...params: Array<string | number>): string[] {
  return (
    backlogDb().handle().prepare(`SELECT DISTINCT route FROM backlog_item WHERE route IS NOT NULL AND ${where}`)
      .all(...params) as Array<{ route: string }>
  ).map((r) => r.route);
}

/**
 * Rows newer than `sinceIso` that nothing else answers for — the weekly digest's query (PIP-15).
 * `handledElsewhere(route)` names the routes a watcher or a brief already owns.
 *
 * THE ONLY QUERY THAT FILTERS STATUS NEGATIVELY. Every other selector names the statuses it wants,
 * so a new status is excluded from them for free and leaks in HERE by default. `statuses.test`
 * fails until a new status is ruled on.
 */
export function unhandledSince(sinceIso: string, handledElsewhere: (route: string) => boolean): BacklogRow[] {
  const skip = routesWhere("occurred_at > ?", sinceIso).filter(handledElsewhere);
  return query(
    `SELECT ${COLS} FROM backlog_item
       WHERE occurred_at > ?
         AND status NOT IN ('handled', 'processing', 'dead')
         AND (route IS NULL OR route NOT IN (${holes(skip.length)}))
       ORDER BY container, occurred_at`,
    sinceIso, ...skip,
  );
}

/**
 * What a human owes an action on NOW — the worklist's query. Different from `unhandledSince` on
 * purpose (PIP-17): that one reports a PERIOD and includes untriaged rows; this one reports now,
 * only routed rows, and skips watched AND terminal routes. A route with no known mode shows up here
 * rather than disappearing.
 */
export function owed(modeOf: ModeOf, limit = 200): BacklogRow[] {
  const skip = routesWhere(`status IN (${UNSETTLED})`).filter((r) => {
    const mode = modeOf(r);
    return mode === "watched" || mode === "terminal";
  });
  return query(
    `SELECT ${COLS} FROM backlog_item
       WHERE status IN (${UNSETTLED})
         AND route IS NOT NULL AND route NOT IN (${holes(skip.length)})
       ORDER BY occurred_at LIMIT ?`,
    ...skip, limit,
  );
}

/** One conversation's rows, oldest first (PIP-14). */
export interface Conversation {
  readonly convKey: string;
  readonly route: string | null;
  readonly items: readonly BacklogRow[];
  readonly occurredAt: string;
  readonly link: string;
}

/** Collapse rows to conversations. Age, route and link come from the OLDEST row: a thread nudged
 *  four times has waited since the first ask. */
export function toConversations(rows: readonly BacklogRow[]): Conversation[] {
  const by = new Map<string, BacklogRow[]>();
  for (const r of rows) by.set(r.convKey, [...(by.get(r.convKey) ?? []), r]);
  return [...by.values()]
    .map((items) => {
      const sorted = [...items].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
      const first = sorted[0]!;
      return { convKey: first.convKey, route: first.route, items: sorted, occurredAt: first.occurredAt, link: first.link };
    })
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
