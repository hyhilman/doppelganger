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
// J1.6 (DBS-04, DBS-06) wraps `handle()`'s statements and the handle's `exec`/`prepare` in a proxy
// that reports SQLITE_BUSY with the file, the one-line SQL and the wait — see "SQLITE_BUSY context"
// below.
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

// ---------------------------------------------------------------------------------------------
// SQLITE_BUSY context (DBS-04, DBS-06)
// ---------------------------------------------------------------------------------------------
//
// `Error: database is locked` and nothing else is what a held write lock used to reach the log as —
// no file, no statement, no wait. This does not retry and does not raise the timeout. Both would
// make the symptom rarer while removing the only evidence of the cause, and the cause is the thing
// worth having: a long write on any of these files is a fault whatever the timeout is set to.

/** SQLITE_BUSY, in whichever shape `node:sqlite` reports it. */
export const isBusy = (e: unknown): boolean =>
  /database is locked|SQLITE_BUSY/i.test(e instanceof Error ? e.message : String(e));

/** SQL as one line, capped — enough to identify the statement, short enough for a `msg=` field. */
function oneLine(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().slice(0, 160);
}

/**
 * Run `fn`, and on SQLITE_BUSY rethrow it naming the file, the statement and the wait.
 *
 * The wait is the discriminator the bare message lacks: ~`BUSY_TIMEOUT_MS` means the timeout
 * genuinely expired against a long writer, while a much smaller number means the lock was refused
 * outright (a DEFERRED read whose upgrade an intervening commit refused) and no timeout would ever
 * have helped. Those need opposite fixes and read identically without this.
 *
 * Exported as a test seam — a busy refusal is otherwise reachable only through real contention.
 */
export function withBusyContext<T>(path: string, sql: string, fn: () => T): T {
  const startedAt = Date.now();
  try {
    return fn();
  } catch (e) {
    if (!isBusy(e)) throw e;
    throw new Error(
      `database is locked: ${path} waited=${Date.now() - startedAt}ms sql=${JSON.stringify(oneLine(sql))}`,
      { cause: e },
    );
  }
}

/**
 * Statement methods that actually run SQL, and so are the ones a held write lock can refuse.
 *
 * `iterate` is here, but naming it is not what closes the blind spot: measured, `iterate()` returns
 * the iterator WITHOUT throwing, and the refusal lands on the first `next()`. `instrument` below
 * wraps the returned iterator's `next()` for exactly that reason — adding "iterate" to this set is
 * necessary but not sufficient on its own.
 */
const EXECUTES: ReadonlySet<string | symbol> = new Set(["run", "get", "all", "iterate"]);

/** A member neither proxy is wrapping. Methods are bound because these are native handles — an
 *  unbound one called through the proxy loses its receiver. */
const passThrough = (value: unknown, target: object): unknown =>
  typeof value === "function" ? value.bind(target) : value;

/** A prepared statement's `run`/`get`/`all` wrap the call itself, since that is where they execute.
 *  `iterate` wraps the call (a refusal at build time is still possible) AND the returned iterator's
 *  `next()`, keeping `[Symbol.iterator]` on the proxy so a `for...of` goes through it, not around
 *  it. */
function wrapStatement(
  stmt: ReturnType<DatabaseSync["prepare"]>,
  path: string,
  sql: string,
): ReturnType<DatabaseSync["prepare"]> {
  return new Proxy(stmt, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (!EXECUTES.has(prop) || typeof value !== "function") return passThrough(value, target);

      if (prop === "iterate") {
        return (...args: unknown[]) => {
          const it = withBusyContext(path, sql, () =>
            (value as (...a: unknown[]) => Iterator<unknown>).apply(target, args),
          );
          const itProxy: Iterator<unknown> & Iterable<unknown> = new Proxy(
            it as Iterator<unknown> & Iterable<unknown>,
            {
              get(itTarget, itProp, itReceiver) {
                if (itProp === "next") {
                  return () => withBusyContext(path, sql, () => itTarget.next());
                }
                if (itProp === Symbol.iterator) {
                  return () => itProxy;
                }
                return passThrough(Reflect.get(itTarget, itProp, itReceiver), itTarget);
              },
            },
          );
          return itProxy;
        };
      }

      return (...args: unknown[]) =>
        withBusyContext(path, sql, () => (value as (...a: unknown[]) => unknown).apply(target, args));
    },
  });
}

/**
 * A handle whose `exec` and `prepare` carry the busy context, and every statement it prepares does
 * too — nothing else changed. `DatabaseSync` has one more member that writes (session changeset
 * application); nothing in this file calls it, so its name is banned outright from this directory's
 * non-test files (test/no-raw-sqlite.test.ts, J1.6 AC6) rather than wrapped — a wrapper with no
 * caller gets its edge cases wrong in private.
 */
function instrument(raw: DatabaseSync, path: string): DatabaseSync {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === "exec") {
        return (sql: string) => withBusyContext(path, sql, () => target.exec(sql));
      }
      if (prop === "prepare") {
        return (sql: string) =>
          wrapStatement(withBusyContext(path, sql, () => target.prepare(sql)), path, sql);
      }
      return passThrough(Reflect.get(target, prop, receiver), target);
    },
  });
}

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
  // The pragmas run on the BARE handle, before `instrument`: they are the setup that makes
  // contention survivable, so wrapping them in the reporter that exists to describe contention
  // would be circular.
  const bare = new DatabaseSync(path);
  // WAL lets a reader proceed while a writer holds the lock; busy_timeout rides out the rare
  // write-write overlap instead of throwing SQLITE_BUSY at whichever job loses the race.
  bare.exec("PRAGMA journal_mode = WAL");
  bare.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  const raw = instrument(bare, path);

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
