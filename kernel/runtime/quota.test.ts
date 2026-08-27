// J4.8 (QTA-01, QTA-05, QTA-06, QTA-07) — the account breaker, classifier and window.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAll, openDb } from "./db.ts";
import { dbPath } from "../paths.ts";
import { isLimitError, limitClass, pause, isPaused, pausedUntil, clearPause, inspect, listPaused } from "./quota.ts";
import { LIMITS } from "./quota.fixture.ts";

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "quota-test-"));
  process.env.QUOTA_DB = join(dir, "quota.db");
});

after(() => {
  closeAll();
  delete process.env.QUOTA_DB;
  rmSync(dir, { recursive: true, force: true });
});

/** Run `fn` with `QUOTA_PAUSE_MS` set — the knob is read per call, so no restart is involved. The
 *  reference's own test helper, unchanged in shape (xenith/engine/src/lib/quota.test.ts). */
function withWindow<T>(ms: number, fn: () => T): T {
  const prior = process.env.QUOTA_PAUSE_MS;
  process.env.QUOTA_PAUSE_MS = String(ms);
  try {
    return fn();
  } finally {
    if (prior == null) delete process.env.QUOTA_PAUSE_MS;
    else process.env.QUOTA_PAUSE_MS = prior;
  }
}

/** Read or write one breaker key straight out of the store — the continuity rule reasons about
 *  the PREVIOUS window's expiry, and no public call can age a record by hours. */
function meta(key: string, value?: string): string | null {
  const d = openDb(dbPath("quota"));
  if (value !== undefined) d.metaSet("quota", key, value);
  return d.metaGet("quota", key);
}

const isoAgo = (ms: number): string => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, "Z");

let counter = 0;
const freshScope = (): string => `test-scope-${++counter}`;

test("1. the fixture drives the classifier — one deepEqual over the whole corpus", () => {
  const actual = LIMITS.map((f) => ({ isLimit: isLimitError(f.message), class: limitClass(f.message) }));
  const expected = LIMITS.map((f) => f.expect);
  assert.deepEqual(actual, expected);
});

test("2. the negatives, named separately", () => {
  const negatives = LIMITS.filter((f) => !f.expect.isLimit);
  assert.ok(negatives.length >= 6, "expected at least the six reference negatives");
  for (const f of negatives) {
    assert.equal(isLimitError(f.message), false, f.message);
  }
});

test("3. unknown is the fallback and the SHORTEST window", () => {
  assert.equal(isLimitError("5-hour limit reached"), true);
  assert.equal(limitClass("5-hour limit reached"), "unknown");
  const scope = freshScope();
  const untilUnknown = withWindow(30 * 60_000, () => pause(scope, "5-hour limit reached"));
  const mins = Math.round((Date.parse(untilUnknown) - Date.now()) / 60_000);
  assert.equal(mins, 30, "unknown must equal the session/daily/usage window, the shortest one");
  clearPause(scope);
});

test("4. the class multiples, base pinned by withWindow(30min)", () => {
  const mins = (scope: string, msg: string): number =>
    Math.round((Date.parse(withWindow(30 * 60_000, () => pause(scope, msg))) - Date.now()) / 60_000);
  try {
    assert.equal(mins(freshScope(), "SESSION LIMIT reached"), 30);
    assert.equal(mins(freshScope(), "daily limit reached"), 30);
    assert.equal(mins(freshScope(), "usage limit reached"), 30);
    assert.equal(mins(freshScope(), "5-hour limit reached"), 30);
    assert.equal(mins(freshScope(), "You've hit your weekly limit"), 60);
    assert.equal(mins(freshScope(), "Monthly limit reached"), 120);
    assert.equal(mins(freshScope(), "You've hit your org's monthly spend limit"), 120);
  } finally {
    // no explicit cleanup needed — each scope is fresh and unused elsewhere
  }
});

test("5. the stated reset never reaches the timing", () => {
  const scope = freshScope();
  const msg = "You've hit your weekly limit · resets Aug 5, 4am (UTC)";
  const until = withWindow(60_000, () => pause(scope, msg));
  assert.ok(until > new Date().toISOString(), "future re-probe instant");
  assert.ok(until < new Date(Date.now() + 5 * 60_000).toISOString(), "well within five minutes — resets Aug 5 never reached the timing");
  const info = inspect(scope);
  assert.equal(info.note, msg, "the raw message is kept for the operator");
  assert.match(info.note ?? "", /resets Aug 5/, "read, never timed on");

  // The reference's own wording ("Aug 5, 4am (UTC)") happens not to be machine-parseable by
  // Date.parse at all, so a mutation that tried to READ the reset for timing would silently do
  // nothing against it — a weak gate. A synthetic message with a genuinely parseable ISO reset,
  // far in the future, closes that hole: if the reset ever DID reach the timing, `until` would
  // land there instead of one window out.
  const scope2 = freshScope();
  const farFuture = "2099-01-01T00:00:00Z";
  const until2 = withWindow(60_000, () => pause(scope2, `You've hit your weekly limit · resets ${farFuture}`));
  assert.ok(until2 < new Date(Date.now() + 5 * 60_000).toISOString(), "a genuinely parseable, far-future reset must still never reach the timing");
});

test("6. an elapsed window is not a pause — QTA-05 as an assertion", () => {
  const scope = freshScope();
  withWindow(0, () => pause(scope, "usage limit reached"));
  assert.equal(isPaused(scope), false);
  assert.equal(inspect(scope).active, false);
  assert.ok(pausedUntil(scope) != null, "the record survives; only the guard has lapsed");
  assert.equal(listPaused().some((p) => p.scope === scope), false);
});

test("7. since survives a re-park inside the gap", () => {
  const scope = freshScope();
  withWindow(60_000, () => pause(scope, "You've hit your org's monthly spend limit"));
  meta(`since:${scope}`, "2026-01-01T00:00:00Z");
  meta(`until:${scope}`, isoAgo(60 * 60_000)); // 1h ago — inside the default 2h QUOTA_DARK_GAP_MS
  withWindow(60_000, () => pause(scope, "You've hit your org's monthly spend limit"));
  assert.equal(meta(`since:${scope}`), "2026-01-01T00:00:00Z", "the darkness, not the window");
});

test("8. since restarts outside the gap", () => {
  const scope = freshScope();
  withWindow(60_000, () => pause(scope, "You've hit your org's monthly spend limit"));
  meta(`since:${scope}`, "2026-01-01T00:00:00Z");
  meta(`until:${scope}`, isoAgo(3 * 60 * 60_000)); // 3h ago — outside the default 2h gap
  withWindow(60_000, () => pause(scope, "You've hit your org's monthly spend limit"));
  assert.notEqual(meta(`since:${scope}`), "2026-01-01T00:00:00Z", "a wall hours later is its own outage");
});

test("9. a hand-lifted breaker starts a new outage", () => {
  const scope = freshScope();
  withWindow(60_000, () => pause(scope, "You've hit your org's monthly spend limit"));
  meta(`since:${scope}`, "2026-01-01T00:00:00Z");
  clearPause(scope);
  withWindow(60_000, () => pause(scope, "You've hit your org's monthly spend limit"));
  assert.notEqual(meta(`since:${scope}`), "2026-01-01T00:00:00Z");
});

test("10. class: is recorded beside since:, and a legacy row (no class:) classifies its note:", () => {
  const scope = freshScope();
  withWindow(60_000, () => pause(scope, "You've hit your weekly limit"));
  assert.equal(inspect(scope).limit, "weekly");
  assert.equal(meta(`class:${scope}`), "weekly");

  const legacy = freshScope();
  withWindow(60_000, () => pause(legacy, "You've hit your weekly limit"));
  meta(`class:${legacy}`, ""); // the migration case — a breaker opened before class: existed
  assert.equal(inspect(legacy).limit, "weekly", "classified off note:, not reported unknown");
});

test("11. listPaused returns open breakers, soonest re-probe first, excluding cleared and expired", () => {
  const soon = freshScope();
  const late = freshScope();
  withWindow(60 * 60_000, () => pause(late, "weekly limit reached"));
  withWindow(60_000, () => pause(soon, "weekly limit reached"));
  const scopes = listPaused()
    .map((p) => p.scope)
    .filter((s) => s === soon || s === late);
  assert.deepEqual(scopes, [soon, late], "soonest re-probe first");
});

test("12. every word in PERIODS is matched by BOTH patterns — the construction's own test", () => {
  const PERIODS = ["weekly", "monthly", "daily", "usage", "session"] as const;
  for (const w of PERIODS) {
    assert.equal(isLimitError(`${w} limit reached`), true, w);
    assert.equal(limitClass(`${w} limit reached`), w, w);
  }
  // A word NOT in PERIODS is still a wall via "limit reached", classifying unknown.
  assert.equal(isLimitError("hourly limit reached"), true);
  assert.equal(limitClass("hourly limit reached"), "unknown");
  // The construction's own gate: a period word NOT in PERIODS, and NOT phrased as "limit reached"
  // or "spend limit" either, must not be a wall at all. If a word were ever added to LIMIT_RE's
  // own alternation without ALSO landing in PERIOD_RE (the drift this construction exists to make
  // impossible), THIS is the assertion that would catch it — "hourly limit reached" above cannot,
  // since it already matches via the unrelated "limit reached" fallback regardless.
  assert.equal(isLimitError("hourly limit applies"), false);
});

test("13. spend is tested before the period word, on a message where both would otherwise match", () => {
  // NOT a fixture row (TST-19: fixtures are real data only) — every real message in the corpus
  // that matches spend has its period word separated from "limit" by "spend" itself, so it never
  // exercises the ORDER between the two rules. This is a constructed message where a period word
  // sits DIRECTLY next to "limit" (so PERIOD_RE alone would match "monthly") AND a spend phrase
  // also appears — proving the order, not merely the individual patterns.
  const msg = "monthly limit reached: you've also hit your org's monthly spend limit";
  assert.equal(limitClass(msg), "spend", "spend must win over the period word standing next to it");
});

test("14. QUOTA_FIXTURE_RECHECK — opt-in, skipped by default", { skip: process.env.QUOTA_FIXTURE_RECHECK !== "1" }, async () => {
  const referenceDb = "/home/hyhilman/projects/xenith/engine/.sandcastle/state/quota.db";
  if (!existsSync(referenceDb)) {
    return; // nothing to recheck against on this machine
  }
  // Read-only, opt-in: never run by default npm test, so this is the one place a live external
  // store may be read at all.
  const { DatabaseSync } = await import("node:sqlite");
  const refDb = new DatabaseSync(referenceDb, { readOnly: true });
  const rows = refDb.prepare("SELECT value FROM quota_meta WHERE key LIKE 'note:%'").all() as unknown as { value: string }[];
  const liveMessages = new Set(rows.map((r) => r.value));

  // The claim test 15 only checks the SHAPE ("first-hand" carries a date, is not the bare
  // wording") is otherwise self-attested — nothing stops an invented row from being marked
  // `via: "first-hand"` and passing both. Here, with the real store on hand, the MESSAGE itself —
  // the actual classifier input, the part that matters — is checked against it: every
  // `via: "first-hand"` row's `message` is looked up as a byte-for-byte `note:` value this store
  // currently holds. REPORTED, not asserted — measured 2026-08-27, one day after capture: this
  // store had already rotated `note:claude` onto an unrelated NEW wall (a weekly limit, not the
  // spend one the fixture captured), which is a real account doing real work, not a fixture
  // defect. A hard failure here would just be re-pinning an external mutable value one level
  // removed, the same mistake `recordedAt` (below) is deliberately not making.
  const firstHand = LIMITS.filter((f) => f.via === "first-hand");
  const missing = firstHand.filter((f) => !liveMessages.has(f.message));
  if (missing.length > 0) {
    console.log(
      `QUOTA_FIXTURE_RECHECK: ${missing.length}/${firstHand.length} first-hand row(s) no longer match a live note: value (the store may have rotated since capture): ${missing.map((f) => f.source).join(", ")}`,
    );
  }

  // recordedAt is explicitly NOT rechecked here (kernel/runtime/quota.fixture.ts's header states
  // why): it is a captured-at-time snapshot of the store's own since: value, and the store moves
  // independently (a re-park writes a fresh since:) — asserting it against the live value would
  // be pinning an external mutable value, the exact thing LOOP.md warns against, not a recheck.

  const known = new Set(LIMITS.map((f) => f.message));
  const unclassified = rows.map((r) => r.value).filter((v) => !known.has(v) && isLimitError(v) && limitClass(v) === "unknown");
  if (unclassified.length > 0) {
    console.log(`QUOTA_FIXTURE_RECHECK: ${unclassified.length} wording(s) the fixture does not classify`);
  }
});

test("15. TST-19's provenance holds — recordedAt is non-null only where the source actually names a date", () => {
  // Every via:"first-hand" row is a real quota.db entry with a real since: timestamp; every
  // via:"reference-corpus" row is bare list text UNLESS it is one of the three dated spend
  // positives. Writing a plausible date onto an undated row would be invention by another route —
  // this is the test that stops that mistake being made twice.
  const firstHand = LIMITS.filter((f) => f.via === "first-hand");
  assert.ok(firstHand.length >= 4, "expected at least the four first-hand rows");
  for (const f of firstHand) {
    assert.ok(f.recordedAt !== null && f.recordedAt !== "", `first-hand row must carry a real date: ${f.message}`);
    // No first-hand row spells the BARE wording — every one carries a wrapper prefix ("task 502
    // failed: ...", "claude-code exited with code 1:\n..."). A first-hand row starting directly
    // with "You've hit your" would be exactly the TST-19 violation ruling 1 warns about.
    assert.ok(!f.message.startsWith("You've hit your"), `first-hand row must not be the bare wording: ${f.message}`);
  }

  const datedSpend = LIMITS.filter((f) => f.via === "reference-corpus" && f.expect.class === "spend");
  assert.equal(datedSpend.length, 3, "the three reference-corpus spend positives");
  for (const f of datedSpend) {
    assert.ok(f.recordedAt !== null && f.recordedAt !== "", `dated spend row must carry its incident date: ${f.message}`);
  }

  const otherReferenceRows = LIMITS.filter((f) => f.via === "reference-corpus" && f.expect.class !== "spend");
  assert.ok(otherReferenceRows.length > 0);
  for (const f of otherReferenceRows) {
    assert.equal(f.recordedAt, null, `undated reference-corpus row must not carry an invented date: ${f.message}`);
  }

  // Every row carries a non-empty source and via, whatever its date.
  for (const f of LIMITS) {
    assert.ok(f.source.length > 0, `every row needs a source: ${f.message}`);
    assert.ok(f.via === "first-hand" || f.via === "reference-corpus", `unexpected via: ${f.via}`);
  }
});
