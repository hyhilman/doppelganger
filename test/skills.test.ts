// the gate that runs both directions over
// the REAL registry and the REAL filesystem: the build gate SKL-04 promises (drift FAILS the
// build; it is never silently re-rendered), SKL-06 both ways, the output-vocabulary and
// DB-namespace drift gates, and the SKL-07 authorization-token ban read in both copies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, projectPath } from "../kernel/paths.ts";
import { skillOf } from "../kernel/ports/job.ts";
import { STAGES } from "../kernel/stages.ts";
import { check, render, ownerOf, type SkillsTree } from "../cli/skills.ts";
import { JOBS } from "../host/jobs/index.ts";
import { OUTCOMES, DB_NAMESPACES } from "../host/jobs/nightly-sandcastle.ts";
import { extractBlock } from "../kernel/runtime/payload.ts";

/** JOB-T03's authorization token (N5) — SKL-07 bans it from ever appearing in a skill's OUTPUT
 *  vocabulary (the report block), in either copy. Exported so test/skills-example.test.ts's own
 *  worked-example gate shares this list rather than keeping a second one. */
export const AUTH_TOKENS = ["agent"] as const;

const TREE: SkillsTree = { renderedRoot: projectPath(".claude/skills"), sourceRoot: projectPath("plugins") };

test("1. TST-23 live — check(JOBS, the real tree) returns []", () => {
  const findings = check(JOBS, TREE);
  assert.deepEqual(findings, [], `skills check found drift on the real tree:\n${findings.map((f) => JSON.stringify(f)).join("\n")}`);
});

test("2. SKL-06 direction one — every job's skill resolves to a real source directory holding a SKILL.md", () => {
  // An exec: job (job.skill === undefined) names no skill by construction (D10) — it is
  // exempt from every check in this file, the same exemption cli/skills.ts's own check() applies
  // (J4.12, ops-cron-check is the first such job).
  for (const job of JOBS) {
    if (job.skill === undefined) continue;
    const sourceFile = join(TREE.sourceRoot, job.plugin, "skills", skillOf(job), "SKILL.md");
    assert.ok(statSync(sourceFile, { throwIfNoEntry: false })?.isFile(), `${job.name}: expected a source skill file at ${sourceFile}`);
  }
});

test("3. SKL-06 direction two — every source skill directory under plugins/*/skills/ is named by a registered job", () => {
  const registeredNames = new Set(JOBS.map((j) => skillOf(j)));
  const pluginDirs = readdirSync(TREE.sourceRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const plugin of pluginDirs) {
    const skillsDir = join(TREE.sourceRoot, plugin.name, "skills");
    let entries: string[] = [];
    try {
      entries = readdirSync(skillsDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      assert.ok(registeredNames.has(name), `${skillsDir}/${name} is an orphan skill — a prompt nothing runs (SKL-06)`);
    }
  }
});

test("4. SKL-02 — no two jobs share a skill name, and no plugin contributes a skill named after itself", () => {
  const names = JOBS.map((j) => skillOf(j));
  assert.equal(new Set(names).size, names.length, "two jobs share a skill name");
  for (const job of JOBS) {
    assert.notEqual(skillOf(job), job.plugin, `${job.name}: a skill must never be named after its own plugin (one /<plugin> with a mode argument is refused)`);
  }
});

test("5. the rendered set equals the source set equals the registry set", () => {
  // An exec: job contributes no skill at all — excluded from the registry SET here, the same
  // exemption test 2's own header comment explains.
  const registrySet = new Set(JOBS.filter((j) => j.skill !== undefined).map((j) => skillOf(j)));
  const renderedSet = new Set(readdirSync(TREE.renderedRoot).filter((name) => ownerOf(join(TREE.renderedRoot, name)) === "ours"));
  const sourceSet = new Set<string>();
  for (const plugin of readdirSync(TREE.sourceRoot, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const skillsDir = join(TREE.sourceRoot, plugin.name, "skills");
    try {
      for (const name of readdirSync(skillsDir)) sourceSet.add(name);
    } catch {
      continue;
    }
  }
  assert.deepEqual(renderedSet, registrySet, "rendered set must equal the registry set");
  assert.deepEqual(sourceSet, registrySet, "source set must equal the registry set");
});

test("6. SKL-09 — the file a human invokes at /<name> and the file the unattended pass uses are the same bytes", () => {
  for (const job of JOBS) {
    if (job.skill === undefined) continue; // an exec: job has no skill file to compare (SKL-06)
    const name = skillOf(job);
    const sourceFile = join(TREE.sourceRoot, job.plugin, "skills", name, "SKILL.md");
    const renderedFile = join(TREE.renderedRoot, name, "SKILL.md");
    const srcDirPosix = `${TREE.sourceRoot.slice(ROOT.length + 1)}/${job.plugin}/skills/${name}`;
    const expected = render(readFileSync(sourceFile, "utf8"), srcDirPosix);
    const actual = readFileSync(renderedFile, "utf8");
    assert.equal(actual, expected, `${name}: the human's /${name} and the pass's own invocation must be the SAME rendered bytes`);
  }
});

test("7. SKL-07 the output vocabulary — the markdown and the code cannot drift apart", () => {
  for (const job of JOBS) {
    if (job.name !== "nightly-sandcastle") continue; // OUTCOMES is this job's own vocabulary
    const sourceFile = join(TREE.sourceRoot, job.plugin, "skills", skillOf(job), "SKILL.md");
    const source = readFileSync(sourceFile, "utf8");
    const outcomeMatch = /outcome=<([^>]+)>/.exec(source);
    assert.ok(outcomeMatch, `${sourceFile}: expected an outcome=<...> vocabulary line`);
    const values = outcomeMatch![1]!.split("|");
    assert.deepEqual(values, [...OUTCOMES], `${sourceFile}'s outcome= vocabulary and OUTCOMES have drifted apart: markdown=[${values.join(",")}] code=[${OUTCOMES.join(",")}]`);
  }
});

test("8. SKL-07 the authorization-token ban — the report block only, scanned in BOTH copies", () => {
  for (const job of JOBS) {
    if (job.skill === undefined) continue; // an exec: job has no skill file to scan (SKL-06)
    const name = skillOf(job);
    const sourceFile = join(TREE.sourceRoot, job.plugin, "skills", name, "SKILL.md");
    const renderedFile = join(TREE.renderedRoot, name, "SKILL.md");
    for (const file of [sourceFile, renderedFile]) {
      const text = readFileSync(file, "utf8");
      const block = extractBlock(text, "SANDCASTLE");
      if (block === null) continue; // not every skill need carry a SANDCASTLE-shaped report
      for (const token of AUTH_TOKENS) {
        assert.ok(!block.includes(token), `${file}: the report block must never name the authorization token "${token}" (SKL-07)`);
      }
    }
  }
});

test("9. no skill reads the environment or names a path into its own files (SKL-08, HRN-16)", () => {
  for (const job of JOBS) {
    if (job.skill === undefined) continue; // an exec: job has no skill file to scan (SKL-06)
    const name = skillOf(job);
    const sourceFile = join(TREE.sourceRoot, job.plugin, "skills", name, "SKILL.md");
    const source = readFileSync(sourceFile, "utf8");
    assert.ok(!source.includes(`plugins/${job.plugin}/skills/`), `${sourceFile}: a skill must never name a path into its own directory (SKL-08)`);
    assert.ok(!source.includes("process.env"), `${sourceFile}: a skill's only inputs are promptArgs (HRN-16)`);
    assert.ok(!source.includes("$ENV"), `${sourceFile}: a skill's only inputs are promptArgs (HRN-16)`);
  }
});

test("10. every skill directory name carries a known SUP-20 stage prefix", () => {
  for (const job of JOBS) {
    if (job.skill === undefined) continue; // an exec: job has no skill directory (SKL-06)
    const name = skillOf(job);
    assert.ok(STAGES.some((s) => name === s || name.startsWith(`${s}-`)), `${name} does not start with a known SUP-20 stage prefix`);
  }
});

test("11. DB_NAMESPACES is derived from the code — every real dbPath( call site is a subset", () => {
  const dirs = ["kernel", "host", "cli", "plugins"];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) files.push(full);
    }
  };
  for (const d of dirs) {
    const abs = join(ROOT, d);
    try {
      walk(abs);
    } catch {
      continue;
    }
  }

  // Comments are stripped first — a doc-comment EXAMPLE call (kernel/paths.ts's own
  // `dbPath("lease")`) is prose, not a real call site, and must never widen the required set.
  const stripComments = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");

  const found = new Set<string>();
  for (const f of files) {
    const code = stripComments(readFileSync(f, "utf8"));
    // N3 F3: resolve import aliases first — `import { dbPath as dp }` + `dp("x")` walked past a
    // name-anchored regex (the same hole N1 fixed three times; J3.10's model masker already ports
    // this). Every local name bound to dbPath is scanned, not just the literal spelling.
    // What this cannot see (stated per the standing rule): a call through a namespace import
    // (`p.dbPath("x")` is caught below), a re-export chain, or a runtime-computed name — none of
    // which exists in this repo, and the first two would be caught by the namespace arm.
    const aliases = new Set<string>(["dbPath"]);
    for (const im of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*paths(?:\.ts)?["']/g)) {
      for (const part of im[1]!.split(",")) {
        const [orig, alias] = part.split(/\s+as\s+/).map((x) => x.trim());
        if (orig === "dbPath") aliases.add(alias ?? orig);
      }
    }
    for (const ns of code.matchAll(/import\s*\*\s*as\s*(\w+)\s*from\s*["'][^"']*paths(?:\.ts)?["']/g)) {
      aliases.add(`${ns[1]!}.dbPath`);
    }
    for (const name of aliases) {
      const callRe = new RegExp(String.raw`(?<![.\w])${name.replace(".", "\\.")}\(\s*(["'\x60])([^"'\x60]+)\1\s*\)`, "g");
      let m: RegExpExecArray | null;
      while ((m = callRe.exec(code)) != null) found.add(m[2]!);
    }
  }

  const missing = [...found].filter((name) => !(DB_NAMESPACES as readonly string[]).includes(name));
  assert.deepEqual(missing, [], `dbPath( name(s) not covered by DB_NAMESPACES: ${missing.join(", ")}`);
});
