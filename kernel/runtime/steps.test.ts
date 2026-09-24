// Per-step caps and the DLQ: counters per (item, step), caps per kind, the row dead-lettered by
// the take itself, the two ways out, and nothing that revives on a schedule.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAll } from "./db.ts";
import { acquire, read as readLease } from "./lease.ts";
import { insertItems, get, setRoute, settle, dlqRef } from "./backlog.ts";
import {
  STEP_KINDS, stepCap, takeStep, takeWithin, watchStep, stepsFor, deadLetters, revive, ROUTE_STEP,
} from "./steps.ts";
import { THREAD, JIRA } from "./backlog.fixture.ts";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

const dirs: string[] = [];
/** A new backlog and lease database for this test alone. */
function freshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "steps-test-"));
  dirs.push(dir);
  process.env.BACKLOG_DB = join(dir, "backlog.db");
  process.env.LEASE_DB = join(dir, "lease.db");
}
after(() => {
  closeAll();
  delete process.env.BACKLOG_DB;
  delete process.env.LEASE_DB;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
// The caps are read per call; a knob left in this process's env would move every number below.
for (const k of ["STEP_CAP_ROUTE", "STEP_CAP_WATCH", "STEP_CAP_BRIEF", "STEP_CAP_DEFAULT"]) delete process.env[k];

const ITEM = THREAD[0]!;
const MANUAL = (): "manual" => "manual";

/** Insert the item and give it a route, so it is live and on a queue. */
function routed(item = ITEM, route = "assignment"): string {
  insertItems([item]);
  setRoute(item.id, { route, confidence: "high", why: "test" }, MANUAL);
  return item.id;
}

test("1. one backlog_step row per (item, step), keyed <kind> or <kind>:<qualifier> (DLQ-01)", () => {
  freshDb();
  const id = routed();
  takeStep(id, watchStep("assignment"));
  takeStep(id, watchStep("assignment"), { note: "second try" });
  takeStep(id, ROUTE_STEP);
  assert.deepEqual(
    stepsFor(id).map((s) => [s.step, s.attempts, s.note]),
    [["watch:assignment", 2, "second try"], ["route", 1, null]],
  );
});

test("2. the caps are the spec's: every kind DLQ-02 names, at its number, and unregistered at its default (DLQ-02)", (t) => {
  const roadmap = join(ROOT, "roadmap.md");
  if (!existsSync(roadmap)) return t.skip("roadmap.md not present (untracked scaffolding, see .gitignore)");
  const text = readFileSync(roadmap, "utf8");
  const row = text.slice(text.indexOf("**DLQ-02**"), text.indexOf("**DLQ-03**"));
  const named = [...row.matchAll(/`([a-z-]+)(?::[^`]*)?`\s+(\d+)/g)].map((m) => [m[1]!, Number(m[2])] as const);
  assert.ok(named.length > 0, "the DLQ-02 row parsed to nothing — re-read this test");
  assert.deepEqual(STEP_KINDS.map((k) => k.kind).sort(), named.map(([k]) => k).sort(), "the kinds are the spec's kinds");
  for (const [kind, cap] of named) assert.equal(stepCap(`${kind}:anything`), cap, `${kind}'s cap`);
  const unregistered = /unregistered (\d+)/.exec(row);
  assert.ok(unregistered);
  assert.equal(stepCap("not-a-kind:x"), Number(unregistered[1]));
});

test("3. a cap is per kind and read per call, so its knob moves it", () => {
  process.env.STEP_CAP_WATCH = "1";
  try {
    assert.equal(stepCap(watchStep("a")), 1);
    assert.equal(stepCap(watchStep("b", "plan")), 1);
  } finally {
    delete process.env.STEP_CAP_WATCH;
  }
});

test("4. takeStep dead-letters the row itself, one past the cap, and a later take keeps the receipt (DLQ-06)", () => {
  freshDb();
  const id = routed();
  const step = watchStep("assignment");
  const cap = stepCap(step);
  for (let i = 1; i <= cap; i++) assert.equal(takeStep(id, step).ok, true, `take ${i} of ${cap}`);
  assert.equal(get(id)?.status, "routed");
  const last = takeStep(id, step);
  assert.deepEqual([last.ok, last.attempts], [false, cap + 1]);
  assert.equal(get(id)?.status, "dead");
  assert.equal(get(id)?.handledRef, dlqRef(step, cap + 1));
  takeStep(id, ROUTE_STEP);
  assert.equal(get(id)?.handledRef, dlqRef(step, cap + 1), "the receipt names the step that really killed it");
  assert.deepEqual(deadLetters().map((r) => r.id), [id]);
});

test("5. qualified keys never share a fate: per route, and per stage (DLQ-05)", () => {
  freshDb();
  const id = routed();
  const a = watchStep("assignment", "plan");
  for (let i = 0; i < stepCap(a); i++) takeStep(id, a);
  // the plan stage is at its cap; the implement stage and another route start from zero
  assert.equal(takeStep(id, watchStep("assignment", "implement")).attempts, 1);
  assert.equal(takeStep(id, watchStep("human-action")).attempts, 1);
  assert.equal(get(id)?.status, "routed");
});

test("6. takes never touch backlog_item.attempts; settle does (DLQ-07)", () => {
  freshDb();
  const id = routed();
  takeStep(id, watchStep("assignment"));
  takeStep(id, watchStep("assignment"));
  assert.equal(get(id)?.attempts, 0);
  settle(id, "failed");
  assert.equal(get(id)?.attempts, 1);
  assert.equal(stepsFor(id)[0]?.attempts, 2);
});

test("7. a dry run counts nothing, however many times it takes (DLQ-09)", () => {
  freshDb();
  const id = routed();
  const step = watchStep("assignment");
  for (let i = 0; i < stepCap(step) + 2; i++) {
    const take = takeStep(id, step, { dryRun: true });
    assert.deepEqual([take.ok, take.counted, take.attempts], [true, false, 0]);
  }
  const within = takeWithin([id], () => step, 1, { dryRun: true });
  assert.equal(within.taken[0]?.take.counted, false);
  assert.deepEqual(stepsFor(id), []);
  assert.equal(get(id)?.status, "routed");
});

test("8. a row the per-run cap refused is never charged, so it never dies of rows it never ran (DLQ-04)", () => {
  freshDb();
  const rows = [...THREAD, ...JIRA];
  const ids = rows.map((r) => routed(r));
  const step = (id: string): string => watchStep(get(id)!.route!);
  // Many runs, each allowed 2 rows, always offered the same queue: only the first 2 are ever charged.
  for (let run = 0; run < stepCap("watch") + 3; run++) {
    const { taken, refused } = takeWithin(ids, step, 2);
    assert.deepEqual(taken.map((t) => t.id), ids.slice(0, 2));
    assert.deepEqual(refused, ids.slice(2));
  }
  for (const id of ids.slice(2)) {
    assert.deepEqual(stepsFor(id), [], `${id} was refused, never charged`);
    assert.equal(get(id)?.status, "routed");
  }
  for (const id of ids.slice(0, 2)) assert.equal(get(id)?.status, "dead");
});

test("9. two ways out of the DLQ: dead → handled is allowed, dead → failed is refused (DLQ-11)", () => {
  freshDb();
  const [a, b] = [routed(JIRA[0]), routed(JIRA[1])];
  for (const id of [a, b]) for (let i = 0; i <= stepCap("watch"); i++) takeStep(id, watchStep("assignment"));
  assert.equal(settle(a, "failed"), false, "failed would put it back on the queue the DLQ took it off");
  assert.equal(get(a)?.status, "dead");
  assert.equal(settle(b, "handled", "skip:ticked in the brief"), true);
  assert.equal(get(b)?.status, "handled");
});

test("10. revive clears the handed-in leases, resets the counters and requeues (DLQ-12)", () => {
  freshDb();
  const id = routed();
  const unrouted = JIRA[0]!;
  insertItems([unrouted]);
  for (let i = 0; i <= stepCap("watch"); i++) takeStep(id, watchStep("assignment"));
  for (let i = 0; i <= stepCap(ROUTE_STEP); i++) takeStep(unrouted.id, ROUTE_STEP);
  assert.equal(acquire("watch-assignment", id).ok, true, "a worker held the row when it died");

  const r = revive(id, (row) => [{ scope: `watch-${row.route}`, key: row.id }]);
  assert.deepEqual(r, { ok: true, leases: [`watch-assignment/${id}`] });
  assert.equal(readLease("watch-assignment", id), null);
  assert.deepEqual(stepsFor(id), []);
  const row = get(id)!;
  assert.deepEqual([row.status, row.handledRef, row.route], ["routed", null, "assignment"]);
  // a row that died before it had a route goes back to the switch
  assert.equal(revive(unrouted.id).ok, true);
  assert.equal(get(unrouted.id)?.status, "new");
  // only a dead row can be revived
  assert.deepEqual(revive(id), { ok: false, leases: [], reason: "status is `routed`" });
});

test("11. nothing revives on a schedule: no host/ or plugins/ file calls revive (DLQ-13)", () => {
  // host/ and plugins/ hold every job and schedule entry. The operator surface (DLQ-14) is a cli/.
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) files.push(full);
    }
  };
  for (const d of ["host", "plugins"]) walk(join(ROOT, d));
  assert.ok(files.length > 0, "found no host/ or plugins/ files — re-read this test");
  const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const offenders = files.filter((f) => /\brevive\b/.test(code(readFileSync(f, "utf8"))));
  assert.deepEqual(offenders, []);
});
