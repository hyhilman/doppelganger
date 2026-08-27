// fixtures/throw.txt was captured with: node -e 'throw new TypeError(...)'
// fixtures/missing-module.txt: node kernel/does-not-exist.ts > … 2>&1 — Cannot find module.
// fixtures/killed.txt: a background child prints a partial line, then is `kill -9`'d ~0.3s later.
//
// cause.ts, over fixtures captured from THIS machine's real Node, never invented.
// Committing the bytes rather than regenerating at test time is deliberate: regenerating would
// silently pin the running Node's own banner text, which changes with .nvmrc. Re-capture belongs
// in the same commit as a .nvmrc bump.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { causeOf, stderrTail } from "./cause.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

function fixtureLines(name: string): string[] {
  return readFileSync(FIXTURES + name, "utf8").split("\n");
}

test("1. throw.txt distils to the TypeError header, not the Node.js version banner", () => {
  const cause = causeOf(fixtureLines("throw.txt"));
  assert.equal(cause, "TypeError: bad thing");
});

test("2. missing-module.txt distils to the Cannot find module message", () => {
  const cause = causeOf(fixtureLines("missing-module.txt"));
  assert.match(cause!, /Cannot find module/);
  assert.doesNotMatch(cause!, /code:/);
  assert.doesNotMatch(cause!, /^\s*throw\b/);

  // HEADER must be tried BEFORE SIGNAL. missing-module.txt alone does not discriminate the two
  // (its one SIGNAL match and its one HEADER match are the same line) — this fixture does: a real
  // exception header, followed by a later line that also matches the weaker SIGNAL shape.
  const withCompetingSignal = causeOf(["TypeError: the real cause", "later: permission denied doing X"]);
  assert.equal(withCompetingSignal, "TypeError: the real cause");
});

test("3. killed.txt distils to the unterminated partial line", () => {
  const cause = causeOf(fixtureLines("killed.txt"));
  assert.equal(cause, "partial line with no newline at the end");
});

test("4. every NOISE shape returns undefined on its own", () => {
  for (const noisy of [
    "",
    "ts=2026-01-01T00:00:00Z level=info job=j src=ts event=e",
    "  ^",
    "    at f (x:1:1)",
    "Node.js v22.23.1",
    "(node:12345) ExperimentalWarning: SQLite is an experimental feature",
    "(Use `node --trace-warnings ...` to show where the warning was created)",
  ]) {
    assert.equal(causeOf([noisy]), undefined, `expected undefined for ${JSON.stringify(noisy)}`);
  }
});

test("5. causeOf([]) is undefined, not an empty string", () => {
  assert.equal(causeOf([]), undefined);
});

test("6. a cause over 300 characters is clipped and ends with an ellipsis", () => {
  const long = "Error: " + "x".repeat(400);
  const cause = causeOf([long]);
  assert.equal(cause!.length, 300);
  assert.ok(cause!.endsWith("…"));
});

test("7. stderrTail(3) keeps the last three lines and drops earlier ones", () => {
  const tail = stderrTail(3);
  tail.push("Error: one\ntwo\nthree\nfour\nfive\n");
  // "Error: one" is five lines back; a ring of 3 must have dropped it, so the header match never
  // fires and causeOf falls back to the last line.
  assert.notEqual(tail.cause(), "Error: one");
  assert.equal(tail.cause(), "five");
});

test("8. stderrTail carries a partial line across chunk boundaries", () => {
  const tail = stderrTail();
  tail.push("Error: abc");
  tail.push("def\n");
  assert.equal(tail.cause(), "Error: abcdef");
});

test("9. stderrTail().cause() on a stream ending mid-line includes the partial", () => {
  const tail = stderrTail();
  tail.push("Error: boom\nsome frame\nunterminated tail");
  assert.equal(tail.cause(), "Error: boom");
});
