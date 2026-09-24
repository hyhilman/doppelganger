// The backlog store's lifecycle: six states, the route CAS, terminal settle, receipts, and the
// two "what is owed" queries. Every test opens its own database under its own temp directory.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAll } from "./db.ts";
import {
  insertItems, setRoute, get, claim, settle, byRoute, untriaged, owed, unhandledSince,
  toConversations, refKind, terminalRef, skipRef, EOD_REF, pickedRef, readRef, dlqRef,
  type ModeOf, type RouteMode,
} from "./backlog.ts";
import { THREAD, JIRA, REAL_REFS, OTHER_REAL_REFS } from "./backlog.fixture.ts";

const dirs: string[] = [];
/** A new database for this test alone. `dbPath` reads `BACKLOG_DB` on every call. */
function freshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "backlog-test-"));
  dirs.push(dir);
  process.env.BACKLOG_DB = join(dir, "backlog.db");
}
after(() => {
  closeAll();
  delete process.env.BACKLOG_DB;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A caller's mode table. The store never holds one; it is handed in. */
const modes = (table: Record<string, RouteMode>): ModeOf => (route) => table[route];
const MODES = modes({ fyi: "terminal", "pr-review": "watched", question: "manual" });
const V = (route: string) => ({ route, confidence: "high", why: "test" });

const [ASK, REPLY1, REPLY2] = THREAD as [typeof THREAD[0], typeof THREAD[0], typeof THREAD[0]];

test("1. an inserted item starts `new` with no route, and a re-insert changes nothing (PIP-03)", () => {
  freshDb();
  assert.equal(insertItems([ASK]), 1);
  assert.equal(get(ASK.id)?.status, "new");
  assert.equal(get(ASK.id)?.route, null);
  setRoute(ASK.id, V("question"), MODES);
  assert.equal(insertItems([ASK]), 0, "INSERT OR IGNORE: a re-fetch never resets a route");
  assert.equal(get(ASK.id)?.route, "question");
});

test("2. setRoute writes route and status in one statement, and WHERE route IS NULL is the CAS (PIP-05)", () => {
  freshDb();
  insertItems([ASK]);
  assert.deepEqual(untriaged().map((r) => r.id), [ASK.id]);
  assert.equal(setRoute(ASK.id, V("question"), MODES), true);
  const row = get(ASK.id)!;
  assert.equal(row.route, "question");
  assert.equal(row.status, "routed");
  assert.deepEqual(untriaged(), [], "a routed row has left the switch's queue");
  assert.equal(setRoute(ASK.id, V("pr-review"), MODES), false, "a second label loses the CAS");
  assert.equal(get(ASK.id)?.route, "question");
});

test("3. a terminal route settles inside the same UPDATE, attempts left at 0 (PIP-06)", () => {
  freshDb();
  insertItems([REPLY1]);
  assert.equal(setRoute(REPLY1.id, V("fyi"), MODES), true);
  const row = get(REPLY1.id)!;
  assert.equal(row.status, "handled");
  assert.equal(row.handledRef, terminalRef("fyi"));
  assert.equal(row.attempts, 0, "no watcher tried anything");
  assert.deepEqual(byRoute("fyi"), [], "nothing is owed on a terminal route");
});

test("4. the mode is the caller's lookup: the same route is terminal or not by what is handed in", () => {
  freshDb();
  insertItems([REPLY1]);
  setRoute(REPLY1.id, V("fyi"), modes({ fyi: "manual" }));
  assert.equal(get(REPLY1.id)?.status, "routed");
});

test("5. claim moves routed rows to processing once, and settle leaves the backlog (PIP-03, PIP-04)", () => {
  freshDb();
  insertItems([ASK]);
  setRoute(ASK.id, V("question"), MODES);
  assert.equal(claim([ASK.id]), 1);
  assert.equal(claim([ASK.id]), 0, "WHERE status = 'routed' is the CAS");
  assert.equal(get(ASK.id)?.status, "processing");
  assert.equal(settle(ASK.id, "handled", REAL_REFS.link), true);
  const row = get(ASK.id)!;
  assert.equal(row.status, "handled");
  assert.equal(row.handledRef, REAL_REFS.link);
  assert.equal(row.attempts, 1);
});

test("6. every PIP-04 receipt shape reads back as its kind, from real refs and from the builders (PIP-04)", () => {
  for (const [kind, ref] of Object.entries(REAL_REFS)) assert.equal(refKind(ref), kind, ref);
  assert.equal(refKind(terminalRef("fyi")), "terminal");
  assert.equal(refKind(skipRef("no-pr-link")), "skip");
  assert.equal(refKind(EOD_REF), "eod");
  assert.equal(refKind(pickedRef(REAL_REFS.link)), "picked");
  assert.equal(refKind(readRef("2026-09-24")), "read");
  assert.equal(refKind(dlqRef("watch:todo-agent", 3)), "dlq");
  // a real multi-link receipt is still the work itself
  assert.equal(refKind(`${REAL_REFS.link} https://github.com/hyhilman/xenith-factory/issues/144`), "link");
  // the real store holds shapes PIP-04 does not name; they are read as unknown, never refused
  for (const ref of OTHER_REAL_REFS) assert.equal(refKind(ref), undefined, ref);
});

test("7. a thread is one conversation, dated and routed by its OLDEST row (PIP-14)", () => {
  freshDb();
  insertItems([...THREAD, ...JIRA]);
  setRoute(ASK.id, V("question"), MODES);
  setRoute(REPLY1.id, V("fyi"), modes({ fyi: "manual" }));
  setRoute(REPLY2.id, V("fyi"), modes({ fyi: "manual" }));
  const rows = [REPLY2, REPLY1, ASK, ...JIRA].map((i) => get(i.id)!);
  const convs = toConversations(rows);
  assert.equal(convs.length, 3, "one Slack thread + two Jira tickets");
  const thread = convs.find((c) => c.convKey === ASK.convKey)!;
  assert.equal(thread.items.length, 3);
  assert.equal(thread.occurredAt, ASK.occurredAt);
  assert.equal(thread.route, "question", "the ask's route, not the latest reply's");
  assert.equal(thread.link, ASK.link);
  assert.deepEqual(convs.map((c) => c.convKey), [ASK.convKey, JIRA[0]!.convKey, JIRA[1]!.convKey]);
});

test("8. owed and unhandledSince skip different sets, on purpose (PIP-17)", () => {
  freshDb();
  const [a, b, c] = THREAD as [typeof ASK, typeof ASK, typeof ASK];
  const [d, e] = JIRA as [typeof ASK, typeof ASK];
  insertItems([a, b, c, d, e]);
  // a: untriaged · b: routed on a manual route · c: routed on a watched route
  // d: routed while `fyi` was manual, then `fyi` became terminal · e: claimed (processing)
  setRoute(b.id, V("question"), MODES);
  setRoute(c.id, V("pr-review"), MODES);
  setRoute(d.id, V("fyi"), modes({ fyi: "manual" }));
  setRoute(e.id, V("question"), MODES);
  claim([e.id]);

  const owedIds = new Set(owed(MODES).map((r) => r.id));
  const digestIds = new Set(unhandledSince("2026-01-01T00:00:00Z", (r) => MODES(r) === "watched").map((r) => r.id));

  assert.deepEqual([...owedIds].sort(), [b.id], "owed: routed, manual, now — nothing untriaged, watched, terminal or claimed");
  assert.deepEqual([...digestIds].sort(), [a.id, b.id, d.id].sort(), "the digest: untriaged and stranded rows too");
  // a route with no known mode is owed, not dropped
  assert.ok(owed(modes({})).some((r) => r.id === c.id));
});
