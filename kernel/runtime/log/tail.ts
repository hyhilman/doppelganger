// J1.12 (LOG-08) — incremental reader over both log roots, plus the rotation that keeps them bounded.
//
// WHY THE CURSOR IS (inode, offset) AND NOT offset ALONE. A byte offset is correct exactly until the
// first rotation, after which it either resumes mid-line in a truncated file or skips a whole new
// one — and both failures are silent, which is the property this whole module exists to remove.
// Inode catches replacement; `size < offset` catches truncation in place.
//
// WHY ROTATION LIVES HERE AND NOT IN A WRAPPER. Cron holds the log open with `>>` for the life of a
// job, so renaming the file leaves that job writing to the rename until it exits. O_APPEND writes
// always land at the current end, so truncating IN PLACE after copying the content out is the one
// form that is safe against a writer we do not control. Copy-then-truncate, never rename.
//
// The three orderings below are the whole module, each kept as a comment because each is a silent
// failure when reversed: READ FIRST, TRUNCATE SECOND, CURSOR LAST — a trailing partial line is NOT
// consumed, so a line still being written is read once, whole, next tick.
import {
  closeSync,
  openSync,
  readSync,
  statSync,
  truncateSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { openDb, type Db } from "../db.ts";
import { envNum, type EnvSpec } from "../../config.ts";
import { projectPath, dbPath } from "../../paths.ts";
import { parseLine, type LogLine } from "./parse.ts";
import { nowIso } from "../../time.ts";

export const NS = "logtail";

/** Both roots, project-relative (INS-02). A reader that knows one silently covers half the jobs —
 *  and the half it drops is whichever set someone added most recently. */
export const LOG_ROOTS: readonly string[] = [
  projectPath(".doppelganger/logs"),
  projectPath("logs"),
];

export const LOG_MAX_BYTES_ENV: EnvSpec = {
  key: "LOG_MAX_BYTES",
  default: String(8 * 1024 * 1024),
  why: "rotate a log above this; ~4x normal traffic, so it fires on a runaway job (LOG-08)",
};
export const LOG_MAX_READ_BYTES_ENV: EnvSpec = {
  key: "LOG_MAX_READ_BYTES",
  default: String(4 * 1024 * 1024),
  why: "cap on what one tick reads from one file, so a runaway cannot pull itself into memory before rotation bounds it (LOG-08)",
};
export const MAX_BYTES: number = envNum(LOG_MAX_BYTES_ENV);
export const MAX_READ: number = envNum(LOG_MAX_READ_BYTES_ENV);

export const logDb = (): Db => {
  const db = openDb(dbPath("log"));
  db.migrate(NS, [
    `CREATE TABLE logtail_cursor (
       path      TEXT PRIMARY KEY,
       inode     TEXT NOT NULL,
       offset    INTEGER NOT NULL,
       updated_at TEXT NOT NULL
     )`,
  ]);
  return db;
};

export interface TailResult {
  lines: LogLine[];
  /** Files whose cursor was reset because they were rotated or replaced under us. */
  reset: string[];
  /** Files this tick rotated. */
  rotated: string[];
  /** Bytes skipped because a single file exceeded MAX_READ this tick. */
  skipped: number;
}

/** Every `*.log` path under `roots`, sorted. A root that does not exist yet is skipped, not a
 *  fault — the first job to run creates it. */
export const logFiles = (roots: readonly string[] = LOG_ROOTS): string[] => {
  const out: string[] = [];
  for (const root of roots) {
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const n of names) if (n.endsWith(".log")) out.push(join(root, n));
  }
  return out.sort();
};

/** Read `[from, to)` as UTF-8. A partial trailing line is left for the caller. */
function readRange(path: string, from: number, to: number): string {
  const fd = openSync(path, "r");
  try {
    const len = to - from;
    const buf = Buffer.allocUnsafe(len);
    let got = 0;
    while (got < len) {
      const n = readSync(fd, buf, got, len - got, from + got);
      if (n <= 0) break;
      got += n;
    }
    return buf.subarray(0, got).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

type Cursor = { inode: string; offset: number } | undefined;

interface FileStep {
  inode: string;
  offset: number;
  lines: LogLine[];
  reset: boolean;
  rotated: boolean;
  skipped: number;
}

/**
 * Read one file forward from `prev`, then rotate it if it grew past the cap.
 *
 * Takes the previous cursor and returns the next one rather than touching the table, so the
 * ordering the whole module rests on — read first, truncate second, cursor last — is stated once
 * here instead of interleaved with the sweep's bookkeeping.
 */
function step(path: string, st: Stats, prev: Cursor): FileStep {
  const inode = String(st.ino);
  // Replaced under us (new inode) or truncated in place (size < offset) -> re-read from zero. A
  // first sight starts at the file's END, or the very first tick replays history as "new faults".
  const reset = prev != null && (prev.inode !== inode || st.size < prev.offset);
  let from = reset ? 0 : (prev?.offset ?? st.size);

  let to = st.size;
  let skipped = 0;
  if (to - from > MAX_READ) {
    skipped = to - from - MAX_READ;
    from = to - MAX_READ;
  }

  const lines: LogLine[] = [];
  if (to > from) {
    const chunk = readRange(path, from, to);
    const cut = chunk.lastIndexOf("\n");
    if (cut < 0) {
      to = from; // no complete line yet — hold the cursor
    } else {
      for (const raw of chunk.slice(0, cut).split("\n")) {
        const parsed = parseLine(raw);
        if (parsed != null) lines.push(parsed);
      }
      to = from + Buffer.byteLength(chunk.slice(0, cut + 1), "utf8");
    }
  }

  // Rotate AFTER reading, so nothing in the rotated tail is lost to this tick.
  let rotated = false;
  if (st.size > MAX_BYTES) {
    try {
      writeFileSync(`${path}.1`, readFileSync(path));
      truncateSync(path, 0);
      to = 0;
      rotated = true;
    } catch {
      // A rotation we could not do is not worth failing the report over — the cap is a hygiene
      // measure, and the next tick retries.
    }
  }

  return { inode, offset: to, lines, reset, rotated, skipped };
}

/** Read every log file forward from its cursor, then rotate whatever grew past the cap.
 *
 * `roots` defaults to `LOG_ROOTS`; a test passes a `mkdtempSync` root instead so the suite never
 * touches the real checkout's `.doppelganger/logs/` (TST-20's discipline). The database itself is
 * redirected the ordinary way, through `LOG_DB` (DBS-07). */
export function tail(roots: readonly string[] = LOG_ROOTS): TailResult {
  const db = logDb();
  const h = db.handle();
  const get = h.prepare("SELECT inode, offset FROM logtail_cursor WHERE path = ?");
  const put = h.prepare(
    `INSERT INTO logtail_cursor (path, inode, offset, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET inode = excluded.inode, offset = excluded.offset,
                                       updated_at = excluded.updated_at`,
  );

  const out: TailResult = { lines: [], reset: [], rotated: [], skipped: 0 };
  for (const path of logFiles(roots)) {
    let st: Stats;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    const s = step(path, st, get.get(path) as Cursor);
    for (const l of s.lines) out.lines.push(l);
    if (s.reset) out.reset.push(path);
    if (s.rotated) out.rotated.push(path);
    out.skipped += s.skipped;
    put.run(path, s.inode, s.offset, nowIso());
  }
  return out;
}
