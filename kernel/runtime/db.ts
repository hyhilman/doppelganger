// J1.5 (DBS-01, DBS-02, DBS-03, DBS-05, DBS-08) — one SQLite file per integration. `openDb(path)`
// binds one file and hands back the handle plus transaction/migration helpers, so each integration
// keeps its own database with no shared-file contention.
//
// Table names stay namespaced anyway (`<ns>_message`, `<ns>_meta`) — self-documenting, and it keeps
// the option of merging several files into one later without a rename.
//
// Each namespace owns its `<ns>_meta.schema_version` and an ordered migration list, so adding a
// column later is an appended step rather than a hand-run ALTER.
//
// J1.6 adds the busy-context proxy (DBS-04, DBS-06) on top of this file. `handle()` here returns the
// BARE driver handle — J1.6 changes that to the instrumented one, and nothing else in this file
// moves.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { envNum, type EnvSpec } from "../config.ts";

const IDENT = /^[a-z][a-z0-9_]*$/;

/** `ns` is interpolated into DDL, so it must be an identifier and nothing else (DBS-03). */
function assertNs(ns: string): void {
  if (!IDENT.test(ns)) throw new Error(`bad namespace: ${ns}`);
}

/** How long a statement waits on a held write lock before giving up. Deliberately unchanged while
 *  the cause is unknown — raising it is the fix you reach for AFTER the log names the writer. This
 *  is db.ts's only knob. */
export const BUSY_TIMEOUT_ENV: EnvSpec = {
  key: "SQLITE_BUSY_TIMEOUT_MS",
  default: "5000",
  why: "how long a statement waits on a held write lock; deliberately unchanged while the cause is unknown (DBS-04)",
};
export const BUSY_TIMEOUT_MS: number = envNum(BUSY_TIMEOUT_ENV);

/**
 * The object names (tables and indexes) a namespace's own SQLite objects live under, excluding
 * SQLite's own internal `sqlite_*` bookkeeping (autoindexes created for a non-INTEGER PRIMARY KEY,
 * for instance — nobody named those, so they cannot be held to a namespace prefix).
 */
function objectNames(handle: DatabaseSync): string[] {
  const rows = handle
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')")
    .all() as { name: string }[];
  return rows.map((r) => r.name).filter((n) => !n.startsWith("sqlite_"));
}

export interface Db {
  readonly path: string;
  /** Raw handle, for queries the helpers do not cover. */
  handle(): DatabaseSync;
  /** Run `fn` in a transaction, rolling back on any throw. */
  tx<T>(fn: (db: DatabaseSync) => T): T;
  /**
   * Apply a namespace's migrations. `steps` is append-only and ordered: index i is schema version
   * i+1. Already-applied steps are skipped, so this is safe on every process start. Never edit or
   * reorder an applied step — databases in the wild have recorded it as done.
   */
  migrate(ns: string, steps: string[]): void;
  metaGet(ns: string, key: string): string | null;
  metaSet(ns: string, key: string, value: string): void;
  close(): void;
}

const cache = new Map<string, Db>();

export function openDb(path: string): Db {
  const cached = cache.get(path);
  if (cached) return cached;

  mkdirSync(dirname(path), { recursive: true });
  const bare = new DatabaseSync(path);
  // WAL lets a reader proceed while a writer holds the lock; busy_timeout rides out the rare
  // write-write overlap instead of throwing SQLITE_BUSY at whichever job loses the race.
  bare.exec("PRAGMA journal_mode = WAL");
  bare.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  const raw = bare;

  const db: Db = {
    path,
    handle: () => raw,
    tx(fn) {
      // IMMEDIATE, because several bodies here SELECT before they write: a DEFERRED transaction
      // takes only a read snapshot, and under WAL an intervening commit then refuses the upgrade
      // outright — SQLITE_BUSY that busy_timeout never waits out. Every caller is write-intent, so
      // taking the write lock at BEGIN costs a wait the timeout does cover.
      raw.exec("BEGIN IMMEDIATE");
      try {
        const out = fn(raw);
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    migrate(ns, steps) {
      assertNs(ns);
      raw.exec(`CREATE TABLE IF NOT EXISTS ${ns}_meta (key TEXT PRIMARY KEY, value TEXT)`);
      const row = raw
        .prepare(`SELECT value FROM ${ns}_meta WHERE key = 'schema_version'`)
        .get() as { value: string } | undefined;
      const applied = Number(row?.value ?? 0);
      for (let i = applied; i < steps.length; i++) {
        db.tx((d) => {
          // DBS-02's enforcer: a step may create only objects prefixed `<ns>_`. The check runs
          // INSIDE the step's own transaction, so a violation rolls the step back and does not
          // record the version — the fix is a retry, not a hand patch.
          const before = new Set(objectNames(d));
          d.exec(steps[i] as string);
          for (const name of objectNames(d)) {
            if (!before.has(name) && !name.startsWith(`${ns}_`)) {
              throw new Error(
                `migrate(${ns}): step ${i + 1} created "${name}" without the ${ns}_ prefix (DBS-02)`,
              );
            }
          }
          d.prepare(
            `INSERT INTO ${ns}_meta (key, value) VALUES ('schema_version', ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          ).run(String(i + 1));
        });
      }
    },
    metaGet(ns, key) {
      assertNs(ns);
      const row = raw.prepare(`SELECT value FROM ${ns}_meta WHERE key = ?`).get(key) as
        | { value: string }
        | undefined;
      return row?.value ?? null;
    },
    metaSet(ns, key, value) {
      assertNs(ns);
      raw
        .prepare(
          `INSERT INTO ${ns}_meta (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(key, value);
    },
    close() {
      raw.close();
      cache.delete(path);
    },
  };
  cache.set(path, db);
  return db;
}

/** Close every open database — call once at the end of a job (DBS-08). */
export function closeAll(): void {
  for (const db of [...cache.values()]) db.close();
}
