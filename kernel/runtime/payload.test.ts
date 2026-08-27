// extractBlock / extractFields.

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBlock, extractFields } from "./payload.ts";

test("1. two blocks — the second wins", () => {
  const stdout = "<<<SANDCASTLE\nfirst\nSANDCASTLE>>>\nsome agent chatter\n<<<SANDCASTLE\nsecond\nSANDCASTLE>>>";
  assert.equal(extractBlock(stdout, "SANDCASTLE"), "second");
});

test("2. an unclosed block returns null", () => {
  assert.equal(extractBlock("<<<SANDCASTLE\nno close here", "SANDCASTLE"), null);
});

test("3. no block returns null, distinct from an empty block", () => {
  assert.equal(extractBlock("nothing here at all", "SANDCASTLE"), null);
  assert.equal(extractBlock("<<<SANDCASTLE\nSANDCASTLE>>>", "SANDCASTLE"), "");
});

test("4. \\r\\n is normalised; no \\r survives", () => {
  const stdout = "<<<SANDCASTLE\r\ngoal=x\r\nsummary=y\r\nSANDCASTLE>>>";
  const block = extractBlock(stdout, "SANDCASTLE");
  assert.ok(block !== null);
  assert.ok(!block!.includes("\r"), `expected no \\r in: ${JSON.stringify(block)}`);
  assert.equal(block, "goal=x\nsummary=y");
});

test("5. a tag that is a prefix of another does not cross-match (<<<SAND inside <<<SANDCASTLE)", () => {
  const stdout = "<<<SANDCASTLE\ngoal=x\nSANDCASTLE>>>";
  assert.equal(extractBlock(stdout, "SAND"), null);
});

test("6. extractFields over a real six-line block yields six keys; verified keeps its = and / and spaces", () => {
  const block = [
    "goal=docs-vs-code",
    "outcome=changed",
    "files=a.ts,b.ts",
    "ids=KRN-01,PIP-04",
    "summary=one line: what changed and why it is better",
    "verified=npm test -- x=1 / 375 pass",
  ].join("\n");
  const fields = extractFields(block);
  assert.equal(Object.keys(fields).length, 6);
  assert.equal(fields.verified, "npm test -- x=1 / 375 pass");
});

test("7. a line with no = is skipped; =value (empty key) is skipped; the others survive", () => {
  const block = ["goal=x", "not a field line", "=orphan-value", "outcome=none"].join("\n");
  const fields = extractFields(block);
  assert.deepEqual(fields, { goal: "x", outcome: "none" });
});

test("8. a block indented two spaces inside a fenced sample still parses", () => {
  // A model ending its report inside a list emits the same line two columns over — anchoring the
  // opening delimiter at column 0 would read that as NO PAYLOAD, the one verdict every caller
  // treats as "the work did not happen" (the reference's own hard-won lesson).
  const stdout = "1. did the thing\n  <<<SANDCASTLE\n  goal=x\n  outcome=none\n  SANDCASTLE>>>";
  const block = extractBlock(stdout, "SANDCASTLE");
  assert.ok(block !== null, "expected the indented block to parse");
  const fields = extractFields(block!);
  assert.equal(fields.goal, "x");
  assert.equal(fields.outcome, "none");
});

// 9. Complexity — an upper bound with the direction, measurement and headroom stated in this
// comment (the exceptions-table shape J1.6 assertion 8 already uses): a 1 MB stdout with the block
// at the end parses in < 500 ms. Direction: UPPER. Measured on this machine: ~1.4 ms across five runs
// (recorded in the commit body). Headroom: over two orders of magnitude — this guards "the regex went
// quadratic", not "the machine was busy".
test("9. complexity — a 1 MB stdout with the block at the end parses well under 500 ms", () => {
  const filler = "x".repeat(1024 * 1024);
  const stdout = `${filler}\n<<<SANDCASTLE\ngoal=x\noutcome=none\nSANDCASTLE>>>`;
  const start = Date.now();
  const block = extractBlock(stdout, "SANDCASTLE");
  const elapsed = Date.now() - start;
  assert.ok(block !== null);
  assert.ok(elapsed < 500, `expected < 500ms, took ${elapsed}ms`);
});
