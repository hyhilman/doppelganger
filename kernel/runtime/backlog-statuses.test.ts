// Every `ItemStatus` is ruled on by the one query that filters status NEGATIVELY (PIP-15, TST-13).
//
// `unhandledSince` says `status NOT IN (…)`. Every other selector names the statuses it WANTS, so a
// new status is left out of them for free and leaks into the digest by default. Nothing fails at
// runtime when that happens — the digest just gets longer. So the union is read out of the source
// and both halves are checked: the text (the only place a status nobody has written yet can be
// seen) and real rows put through the real query.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAll } from "./db.ts";
import { insertItems, get, setRoute, claim, settle, unhandledSince, untriaged, updateOne, dlqRef } from "./backlog.ts";
import { THREAD } from "./backlog.fixture.ts";

const dirs: string[] = [];
function freshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "backlog-statuses-"));
  dirs.push(dir);
  process.env.BACKLOG_DB = join(dir, "backlog.db");
}
after(() => {
  closeAll();
  delete process.env.BACKLOG_DB;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The statuses `unhandledSince` still reports. Pinned by hand: deciding where a new status belongs
 *  is the work this test exists to force. */
const REPORTED = ["new", "routed", "failed"];

/** The files whose SQL may filter a status negatively. */
const SOURCES = ["backlog.ts"];

const src = (f: string): string => readFileSync(join(import.meta.dirname, f), "utf8");
const quoted = (s: string): string[] => [...s.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!);

function itemStatuses(): string[] {
  const m = /export type ItemStatus =([^;]*);/.exec(src("backlog.ts"));
  return m ? [...m[1]!.matchAll(/"([a-z-]+)"/g)].map((x) => x[1]!) : [];
}

function negativelyFiltered(): Array<{ file: string; status: string }> {
  const out: Array<{ file: string; status: string }> = [];
  for (const file of SOURCES) {
    const s = src(file);
    for (const m of s.matchAll(/status\s*(?:<>|!=)\s*'([a-z-]+)'/g)) out.push({ file, status: m[1]! });
    for (const m of s.matchAll(/status NOT IN \(([^)]*)\)/g)) {
      for (const status of quoted(m[1]!)) out.push({ file, status });
    }
  }
  return out;
}

test("1. the union reads as the six PIP-03 states — a parse that finds nothing would pass every check", () => {
  assert.deepEqual(itemStatuses(), ["new", "routed", "processing", "handled", "failed", "dead"]);
});

test("2. no negative filter names a status the union does not have", () => {
  const known = new Set(itemStatuses());
  assert.deepEqual(negativelyFiltered().filter((f) => !known.has(f.status)), []);
});

test("3. every status is either excluded by unhandledSince or reported on purpose (PIP-15)", () => {
  const m = /status NOT IN \(([^)]*)\)/.exec(src("backlog.ts"));
  assert.ok(m, "unhandledSince no longer filters status negatively — re-read this file");
  const excluded = new Set(quoted(m[1]!));
  assert.deepEqual(itemStatuses().filter((s) => !excluded.has(s)), REPORTED);
});

/** One row parked in `status`, through the real transitions. `question` is manual in this test's
 *  lookup, so it neither settles at route time nor is skipped as watched. */
function seed(n: number, status: string): string {
  const item = { ...THREAD[0]!, id: `slack:C0C1DUU1YTV:st-${n}`, externalId: `C0C1DUU1YTV:st-${n}` };
  insertItems([item]);
  if (status !== "new") {
    setRoute(item.id, { route: "question", confidence: "high", why: "test" }, () => "manual");
    if (status === "processing") claim([item.id]);
    else if (status === "handled" || status === "failed") settle(item.id, status, "skip:test");
    else if (status === "dead") {
      updateOne("UPDATE backlog_item SET status = 'dead', handled_ref = ? WHERE id = ?", dlqRef("watch:question", 4), item.id);
    }
  }
  assert.equal(get(item.id)?.status, status, `seeding a ${status} row`);
  return item.id;
}

test("4. and the real query agrees with the pin, on one real row per status", () => {
  freshDb();
  const ids = new Map(itemStatuses().map((s, i) => [seed(i, s), s]));
  const reported = unhandledSince("2026-01-01T00:00:00Z", () => false)
    .map((r) => ids.get(r.id))
    .filter((s): s is string => s !== undefined);
  assert.deepEqual(reported.sort(), [...REPORTED].sort());
});

test("5. untriaged offers only live rows with no route, even a handled one left with route NULL", () => {
  freshDb();
  const ids: string[] = [];
  for (const [n, status] of (["new", "handled", "failed", "dead"] as const).entries()) {
    const item = { ...THREAD[0]!, id: `slack:C0C1DUU1YTV:un-${n}`, externalId: `C0C1DUU1YTV:un-${n}` };
    insertItems([item]);
    if (status === "handled" || status === "failed") settle(item.id, status, "skip:test");
    if (status === "dead") updateOne("UPDATE backlog_item SET status = 'dead' WHERE id = ?", item.id);
    ids.push(item.id);
  }
  assert.deepEqual(untriaged().map((r) => r.id).sort(), [ids[0], ids[2]].sort());
});
