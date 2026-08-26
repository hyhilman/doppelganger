// J3.8 (JOB-C15, SKL-02, SKL-05, SKL-07, TST-19, HRN-10) — the verdict, the blocked paths, the
// goals, the import smoke.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractBlock } from "../../kernel/runtime/payload.ts";
import {
  parseVerdict,
  blockedBy,
  BLOCKED,
  GOALS,
  nextGoal,
  importSmoke,
  head,
  tail,
} from "./nightly-sandcastle.ts";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const SOURCE_FILE = join(ROOT, "plugins/nightly/skills/nightly-sandcastle/SKILL.md");

/** The report template, read from the source SKILL.md AT TEST TIME with placeholders filled —
 *  never retyped — so this test fails if the skill's own shape changes. */
function fixtureStdout(): string {
  const source = readFileSync(SOURCE_FILE, "utf8");
  const block = extractBlock(source, "SANDCASTLE");
  assert.ok(block !== null, "expected a SANDCASTLE block in the source SKILL.md");
  const fill: Record<string, string> = {
    goal: "docs-vs-code",
    outcome: "changed",
    files: "a.ts,b.ts",
    ids: "KRN-01",
    summary: "removed a redundant helper and its now-unused test",
    verified: "npm test / 437 pass",
  };
  const filled = block!
    .split("\n")
    .map((line) => {
      const m = /^([a-z]+)=<.*>$/.exec(line);
      if (!m) return line;
      const key = m[1]!;
      return key in fill ? `${key}=${fill[key]}` : line;
    })
    .join("\n");
  return `some agent narration first\n\n<<<SANDCASTLE\n${filled}\nSANDCASTLE>>>`;
}

test("1. parseVerdict accepts the block the skill documents", () => {
  const verdict = parseVerdict(fixtureStdout());
  assert.ok(verdict !== null);
  assert.equal(verdict!.outcome, "changed");
  assert.equal(verdict!.goal, "docs-vs-code");
  assert.deepEqual(verdict!.files, ["a.ts", "b.ts"]);
});

test("2. two blocks — the second wins", () => {
  const stdout = "<<<SANDCASTLE\ngoal=g1\noutcome=none\nfiles=-\nids=-\nsummary=s1\nverified=v1\nSANDCASTLE>>>\nchatter\n<<<SANDCASTLE\ngoal=g2\noutcome=changed\nfiles=-\nids=-\nsummary=s2\nverified=v2\nSANDCASTLE>>>";
  const verdict = parseVerdict(stdout);
  assert.equal(verdict!.goal, "g2");
});

test("3. outcome=shipped is not in OUTCOMES — null", () => {
  const stdout = "<<<SANDCASTLE\ngoal=g\noutcome=shipped\nfiles=-\nids=-\nsummary=s\nverified=v\nSANDCASTLE>>>";
  assert.equal(parseVerdict(stdout), null);
});

test("4. missing outcome/goal/summary — null, three cases", () => {
  const missingOutcome = "<<<SANDCASTLE\ngoal=g\nfiles=-\nids=-\nsummary=s\nverified=v\nSANDCASTLE>>>";
  const missingGoal = "<<<SANDCASTLE\noutcome=none\nfiles=-\nids=-\nsummary=s\nverified=v\nSANDCASTLE>>>";
  const missingSummary = "<<<SANDCASTLE\ngoal=g\noutcome=none\nfiles=-\nids=-\nverified=v\nSANDCASTLE>>>";
  assert.equal(parseVerdict(missingOutcome), null);
  assert.equal(parseVerdict(missingGoal), null);
  assert.equal(parseVerdict(missingSummary), null);
});

test("5. files=- yields []; files=a.ts,b.ts yields two trimmed entries", () => {
  const dash = "<<<SANDCASTLE\ngoal=g\noutcome=none\nfiles=-\nids=-\nsummary=s\nverified=v\nSANDCASTLE>>>";
  const two = "<<<SANDCASTLE\ngoal=g\noutcome=none\nfiles=a.ts, b.ts\nids=-\nsummary=s\nverified=v\nSANDCASTLE>>>";
  assert.deepEqual(parseVerdict(dash)!.files, []);
  assert.deepEqual(parseVerdict(two)!.files, ["a.ts", "b.ts"]);
});

test("6. a verified= value containing = and / survives intact", () => {
  const stdout = "<<<SANDCASTLE\ngoal=g\noutcome=none\nfiles=-\nids=-\nsummary=s\nverified=npm test -- x=1 / 437 pass\nSANDCASTLE>>>";
  assert.equal(parseVerdict(stdout)!.verified, "npm test -- x=1 / 437 pass");
});

test("7. blockedBy covers the four things the markdown names (Off limits:)", () => {
  const source = readFileSync(SOURCE_FILE, "utf8");
  const bulletMatch = /\*\*Off limits:\*\*\s*([^\n]+)/.exec(source);
  assert.ok(bulletMatch, "expected an 'Off limits:' bullet in the source SKILL.md");
  const bullet = bulletMatch![1]!;
  const mapping: Record<string, string> = {
    "the schedule file": "host/schedule.ts",
    "the supervisor": "host/supervisor.ts",
    "package.json": "package.json",
    "this skill's own files": "host/jobs/nightly-sandcastle.ts",
  };
  for (const [phrase, path] of Object.entries(mapping)) {
    assert.ok(bullet.includes(phrase), `Off limits: bullet no longer names "${phrase}": ${bullet}`);
    assert.ok(blockedBy(path) !== null, `blockedBy(${JSON.stringify(path)}) must be non-null for "${phrase}"`);
  }
});

test("8. blockedBy returns null for a path a pass legitimately edits", () => {
  assert.equal(blockedBy("CLAUDE.md"), null);
  assert.equal(blockedBy("kernel/stages.ts"), null);
});

test("9. every BLOCKED row has a non-empty why, and no two share one", () => {
  for (const row of BLOCKED) {
    assert.ok(row.why.trim().length > 0);
  }
  const whys = BLOCKED.map((r) => r.why);
  assert.equal(new Set(whys).size, whys.length, "two BLOCKED rows share a why");
});

test("10. nextGoal cycles all three and wraps; only forces one and does not advance; an unknown key throws", () => {
  let state = { index: 0, recent: [] as string[] };
  const seen: string[] = [];
  for (let i = 0; i < GOALS.length + 1; i++) {
    const { goal, nextIndex } = nextGoal(state);
    seen.push(goal.key);
    assert.ok(nextIndex >= 0 && nextIndex < GOALS.length);
    state = { index: nextIndex, recent: [] };
  }
  assert.equal(seen[0], seen[GOALS.length], "expected the rotation to wrap after GOALS.length steps");

  const forced = nextGoal({ index: 0, recent: [] }, "test-gaps");
  assert.equal(forced.goal.key, "test-gaps");
  assert.equal(forced.nextIndex, 0, "forcing a goal must not advance the rotation past it");

  assert.throws(() => nextGoal({ index: 0, recent: [] }, "nope"), /unknown goal key/);
});

test("11. importSmoke accepts a module that loads", () => {
  const dir = mkdtempSync(join(tmpdir(), "import-smoke-"));
  const file = join(dir, "good.ts");
  writeFileSync(file, "export const x = 1;\n");
  assert.equal(importSmoke(file), "");
  assert.equal(importSmoke(join(ROOT, "kernel/stages.ts")), "");
});

test("12. importSmoke rejects a syntax error, a missing relative import, and a throw at load", () => {
  const dir = mkdtempSync(join(tmpdir(), "import-smoke-"));

  const syntaxFile = join(dir, "syntax.ts");
  writeFileSync(syntaxFile, "export const x = ;\n");
  const syntaxOut = importSmoke(syntaxFile);
  assert.notEqual(syntaxOut, "");
  assert.match(head(syntaxOut), /SyntaxError/);

  const missingImportFile = join(dir, "missing-import.ts");
  writeFileSync(missingImportFile, "import { nope } from './does-not-exist.ts';\nexport const y = nope;\n");
  const missingOut = importSmoke(missingImportFile);
  assert.notEqual(missingOut, "");
  assert.match(head(missingOut), /Cannot find module/);

  const throwFile = join(dir, "throw.ts");
  writeFileSync(throwFile, "throw new Error('boom at load');\n");
  const throwOut = importSmoke(throwFile);
  assert.notEqual(throwOut, "");
  assert.match(head(throwOut), /boom at load/);
});

test("13. importSmoke JSON-encodes its path — a path containing \" and \\ keeps its quoting", () => {
  // A path is source code here, not a string — if JSON.stringify's escaping were broken, an
  // unescaped " or \ would break OUT of the generated `-e` code's string literal, and the failure
  // would be a SyntaxError in code we built, not a module-resolution error about the path we asked
  // for. It must be the latter.
  const weirdPath = '/tmp/does-not-exist-"quoted\\-dir/good.ts';
  const out = importSmoke(weirdPath);
  assert.notEqual(out, "");
  assert.doesNotMatch(out, /SyntaxError/, `a broken quote/backslash escape produced a SyntaxError in the generated code:\n${out}`);
  assert.match(head(out), /Cannot find module|ERR_MODULE_NOT_FOUND/);
});

test("14. head leads with the error class, drops at-frames and the Node.js banner, stays under 400 chars; tail takes the last meaningful lines", () => {
  const raw = [
    "SyntaxError: Unexpected token",
    "    at wrapSafe (node:internal/modules/cjs/loader:1234:20)",
    "    at Module._compile (node:internal/modules/cjs/loader:1200:10)",
    "",
    "Node.js v22.23.1",
  ].join("\n");
  const h = head(raw);
  assert.ok(h.startsWith("SyntaxError"));
  assert.ok(!h.includes(" at "));
  assert.ok(!h.includes("Node.js v"));
  assert.ok(h.length < 400);

  const suiteOut = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") + "\n# pass 30\n# fail 0";
  const t = tail(suiteOut, 3);
  assert.equal(t, "line 29\n# pass 30\n# fail 0");
});
