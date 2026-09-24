// Every `backlog_item` column is projected by `COLS` or left out on purpose (PIP-16, TST-13).
//
// SQLite does not object to a SELECT that omits a column, and `toRow` reads a missing one the same
// way it reads a NULL. So a column added by a migration and forgotten in `COLS` just comes back
// null on every row, forever, and nothing fails. The three lists are held to each other:
//
//   the table (PRAGMA)  ⊇  COLS  ≡  what `toRow` actually reads
//
// `toRow`'s half is OBSERVED on a recording proxy, not scraped from the source. One real row is
// also driven through insert → route → settle and read back.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAll } from "./db.ts";
import { COLS, toRow, backlogDb, insertItems, setRoute, settle, get } from "./backlog.ts";
import { THREAD, REAL_REFS } from "./backlog.fixture.ts";

const dirs: string[] = [];
function freshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "backlog-columns-"));
  dirs.push(dir);
  process.env.BACKLOG_DB = join(dir, "backlog.db");
}
after(() => {
  closeAll();
  delete process.env.BACKLOG_DB;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Columns the table has and no selector reads. Pinned by hand: saying a column is write-only is
 *  the decision this test forces. `fetched_at` says when a row landed; nothing branches on it. */
const UNPROJECTED = ["fetched_at"];

const projected = COLS.split(",").map((c) => c.trim());

function tableColumns(): string[] {
  return (backlogDb().handle().prepare("PRAGMA table_info(backlog_item)").all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
}

function columnsToRowReads(): string[] {
  const seen = new Set<string>();
  const spy = new Proxy({} as Record<string, string | number | null>, {
    get(_t, prop) {
      if (typeof prop === "string") seen.add(prop);
      return null;
    },
  });
  toRow(spy);
  return [...seen];
}

test("1. the table is read at all — an empty PRAGMA would pass every comparison below", () => {
  freshDb();
  assert.ok(tableColumns().length > 0);
});

test("2. COLS names each column once, and only columns the table has", () => {
  freshDb();
  assert.equal(new Set(projected).size, projected.length);
  const cols = new Set(tableColumns());
  assert.deepEqual(projected.filter((c) => !cols.has(c)), []);
});

test("3. the table leaves out exactly the write-only columns — a new one is a decision (PIP-16)", () => {
  freshDb();
  const want = new Set(projected);
  assert.deepEqual(tableColumns().filter((c) => !want.has(c)), UNPROJECTED);
});

test("4. toRow reads exactly what COLS projects", () => {
  assert.deepEqual(columnsToRowReads().sort(), [...projected].sort());
});

test("5. one real row survives the trip: every field given, every field the pipeline wrote", () => {
  freshDb();
  const item = THREAD[1]!; // a reply: parent fields set, and its conv key is NOT its own id
  insertItems([item]);
  assert.equal(setRoute(item.id, { route: "question", confidence: "high", why: "asked a thing" }, () => "manual"), true);
  assert.equal(settle(item.id, "handled", REAL_REFS.link), true);
  const row = get(item.id)!;
  assert.match(row.updatedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(row, {
    ...item,
    route: "question",
    confidence: "high",
    why: "asked a thing",
    status: "handled",
    handledRef: REAL_REFS.link,
    attempts: 1,
    updatedAt: row.updatedAt,
  });
});
