// J0.10 (SKL-01, SKL-03, SKL-04, SKL-06, SKL-07, SKL-08, SUP-20) — gate the worked example.
//
// The nightly-sandcastle skill already landed (plugins/nightly/skills/nightly-sandcastle/
// and its rendered .claude/skills/ copy). N0 did not build the `skills render|sync|check`
// CLI — that is N3 (SKL-04, TST-23, cli/skills.ts, J3.7), which is why `render` is imported
// from there now rather than defined here a second time: a second copy of a render function
// is drift with two authors (J3.7's own module header).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { render } from "../cli/skills.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const JOB_NAME = "nightly-sandcastle";
const SOURCE_DIR = `plugins/nightly/skills/${JOB_NAME}`;
const SOURCE_FILE = `${SOURCE_DIR}/SKILL.md`;
const RENDERED_DIR = `.claude/skills/${JOB_NAME}`;
const RENDERED_FILE = `${RENDERED_DIR}/SKILL.md`;

// A key: value frontmatter reader, not a YAML parser. A skill whose frontmatter needs more
// than this is a skill to simplify.
function readFrontmatterKey(sourceText: string, key: string): string | undefined {
  const lines = sourceText.split("\n");
  let inFrontmatter = false;
  for (const line of lines) {
    if (line === "---") {
      if (inFrontmatter) break;
      inFrontmatter = true;
      continue;
    }
    if (!inFrontmatter) continue;
    const match = /^(\w+):\s*(.*)$/.exec(line);
    if (match && match[1] === key) return match[2];
  }
  return undefined;
}

test("1. plugins/nightly/skills/nightly-sandcastle/SKILL.md exists and is a regular file (SKL-03)", () => {
  const st = lstatSync(join(ROOT, SOURCE_FILE));
  assert.ok(st.isFile(), `${SOURCE_FILE} must be a regular file (SKL-03)`);
  assert.equal(st.isSymbolicLink(), false, `${SOURCE_FILE} must not be a symlink`);
});

test("2. frontmatter name equals the directory name (SKL-01)", () => {
  const source = readFileSync(join(ROOT, SOURCE_FILE), "utf8");
  const name = readFrontmatterKey(source, "name");
  assert.equal(name, JOB_NAME, "SKILL.md's frontmatter name must equal the directory name (SKL-01)");
});

test("3. the directory name starts with a known SUP-20 stage prefix", () => {
  const prefixes = [
    "source-",
    "triage-",
    "backlog-",
    "watch-",
    "todo-",
    "corpus-",
    "nightly-",
    "retro-",
    "ops-",
  ];
  assert.ok(
    prefixes.some((p) => JOB_NAME.startsWith(p)),
    `${JOB_NAME} does not start with a known SUP-20 stage prefix`,
  );
});

// First 1-indexed line where two strings diverge, or -1 if they are equal. Used only to
// shape this test's failure message like J0.9's drift message ("first difference at line
// N") — the full "skills check" CLI, with its own message and exit code, is N3's job.
function firstDifferingLine(a: string, b: string): number {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) return i + 1;
  }
  return -1;
}

test("4. render(source) equals the rendered file byte for byte", () => {
  const source = readFileSync(join(ROOT, SOURCE_FILE), "utf8");
  const rendered = readFileSync(join(ROOT, RENDERED_FILE), "utf8");
  const expected = render(source, SOURCE_DIR);
  const line = firstDifferingLine(expected, rendered);
  assert.equal(
    expected,
    rendered,
    `skills: drift in ${RENDERED_FILE} — the rendered copy does not match render(source); first difference at line ${line} (SKL-04)`,
  );
});

test("5. the rendered directory contains exactly one entry, SKILL.md", () => {
  const entries = readdirSync(join(ROOT, RENDERED_DIR));
  assert.deepEqual(entries, ["SKILL.md"], `${RENDERED_DIR} must contain exactly SKILL.md`);
});

test("6. neither the rendered dir nor the rendered file is a symlink (§5 Q0)", () => {
  assert.equal(
    lstatSync(join(ROOT, RENDERED_DIR)).isSymbolicLink(),
    false,
    `${RENDERED_DIR} must not be a symlink (§5 Q0: render, never symlink)`,
  );
  assert.equal(
    lstatSync(join(ROOT, RENDERED_FILE)).isSymbolicLink(),
    false,
    `${RENDERED_FILE} must not be a symlink (§5 Q0: render, never symlink)`,
  );
});

test("7. the marker's first line names the source directory", () => {
  const rendered = readFileSync(join(ROOT, RENDERED_FILE), "utf8");
  const lines = rendered.split("\n");
  const markerLine = lines[4]; // line 5, 0-indexed
  const match = /^<!-- managed:doppelganger-skills v=1 src=(\S+) -->$/.exec(markerLine ?? "");
  assert.ok(match, `line 5 must match the managed marker regexp, got: ${markerLine}`);
  assert.equal(match![1], SOURCE_DIR, "the marker's src must resolve to the source directory");
});

test("8. the source names no path into its own directory and reads no env (SKL-08, HRN-16)", () => {
  const source = readFileSync(join(ROOT, SOURCE_FILE), "utf8");
  assert.ok(!source.includes("plugins/nightly/skills/"), "a skill must never name a path into its own directory (SKL-08)");
  assert.ok(!source.includes("process.env"), "a skill's only inputs are promptArgs (HRN-16)");
  assert.ok(!source.includes("$ENV"), "a skill's only inputs are promptArgs (HRN-16)");
});

test("9. SKL-06 both ways, N0 stand-in: .claude/skills/ and plugins/*/skills/ name the same set", () => {
  // No job registry exists yet (that is N1+). This is the N0 stand-in for TST-24 — a hand-held
  // set comparison, replaced by the registry walk at N3/N5.
  const rendered = new Set(readdirSync(join(ROOT, ".claude/skills")));
  const pluginDirs = readdirSync(join(ROOT, "plugins"), { withFileTypes: true }).filter((d) => d.isDirectory());
  const sourced = new Set<string>();
  for (const plugin of pluginDirs) {
    const skillsPath = join(ROOT, "plugins", plugin.name, "skills");
    let entries: string[] = [];
    try {
      entries = readdirSync(skillsPath);
    } catch {
      continue;
    }
    for (const entry of entries) sourced.add(entry);
  }
  assert.deepEqual(rendered, new Set([JOB_NAME]), ".claude/skills/ must name exactly { nightly-sandcastle }");
  assert.deepEqual(sourced, new Set([JOB_NAME]), "plugins/*/skills/ must name exactly { nightly-sandcastle }");
  assert.deepEqual(rendered, sourced, "an orphan skill is a prompt nothing runs (SKL-06)");
});

test("10. the SKL-07 output vocabulary is pinned and no agent authorization token appears", () => {
  // This is an OUTPUT VOCABULARY, not an authorization token — see roadmap §2.30 SKL-07.
  // It changes what the caller LEARNS, never what the run is PERMITTED to do. Pinning it here
  // is what makes parseVerdict at N3 reproduce the markdown instead of drifting from it.
  // TST-24's ban is on tokens like JOB-T03's `agent`, which this file must never name.
  const source = readFileSync(join(ROOT, SOURCE_FILE), "utf8");
  assert.ok(source.includes("<<<SANDCASTLE"), "the SANDCASTLE report block must be present");
  assert.ok(source.includes("SANDCASTLE>>>"), "the SANDCASTLE report block must be closed");
  const outcomeMatch = /outcome=<([^>]+)>/.exec(source);
  assert.ok(outcomeMatch, "the source must state the outcome= vocabulary");
  const values = outcomeMatch![1].split("|");
  assert.deepEqual(values, ["changed", "none", "too-large", "suite-failed"], "the outcome= vocabulary must match exactly");
  assert.ok(!source.includes("agent"), "the skill must never name the agent authorization token (SKL-07, TST-24)");
});
