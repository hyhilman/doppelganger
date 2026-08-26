// J3.7 (SKL-03, SKL-04, SKL-05, SKL-10, TST-23) — render, ownership, the six findings, layer 0.
// Every test builds a mkdtempSync tree; test 1 reads the real one, read-only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job } from "../kernel/ports/job.ts";
import { render, ownerOf, check, assertSafeTree, type SkillsTree } from "./skills.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const SOURCE_TEMPLATE = [
  "---",
  "name: nightly-probe",
  "description: A probe skill.",
  "---",
  "",
  "# nightly-probe",
  "",
  "Body text.",
  "",
].join("\n");

function job(overrides: Partial<Job> = {}): Job {
  return {
    name: "nightly-probe",
    description: "d",
    plugin: "nightly",
    permissionMode: "bypassPermissions",
    local: true,
    ...overrides,
  };
}

function makeTree(): { tree: SkillsTree; root: string } {
  const root = mkdtempSync(join(tmpdir(), "skills-tree-"));
  const sourceRoot = join(root, "plugins");
  const renderedRoot = join(root, ".claude", "skills");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(renderedRoot, { recursive: true });
  return { tree: { renderedRoot, sourceRoot }, root };
}

function writeSource(tree: SkillsTree, plugin: string, name: string, text: string = SOURCE_TEMPLATE): string {
  const dir = join(tree.sourceRoot, plugin, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), text);
  return dir;
}

function renderInto(tree: SkillsTree, sourceDir: string, name: string, srcDirPosix: string): string {
  const dir = join(tree.renderedRoot, name);
  mkdirSync(dir, { recursive: true });
  const rendered = render(readFileSync(join(sourceDir, "SKILL.md"), "utf8"), srcDirPosix);
  writeFileSync(join(dir, "SKILL.md"), rendered);
  return dir;
}

test("1. render reproduces the real nightly-sandcastle file on disk, byte for byte", () => {
  const sourceFile = join(ROOT, "plugins/nightly/skills/nightly-sandcastle/SKILL.md");
  const renderedFile = join(ROOT, ".claude/skills/nightly-sandcastle/SKILL.md");
  const source = readFileSync(sourceFile, "utf8");
  const rendered = readFileSync(renderedFile, "utf8");
  assert.equal(render(source, "plugins/nightly/skills/nightly-sandcastle"), rendered);
});

test("2. render refuses a source with no frontmatter, and one with an unclosed frontmatter", () => {
  assert.throws(() => render("no frontmatter here", "x"), /frontmatter delimiter/);
  assert.throws(() => render("---\nname: x\n", "x"), /closing/);
});

test("3. render is deterministic", () => {
  const a = render(SOURCE_TEMPLATE, "plugins/nightly/skills/nightly-probe");
  const b = render(SOURCE_TEMPLATE, "plugins/nightly/skills/nightly-probe");
  assert.equal(a, b);
});

test("4. ownerOf — rendered is ours; marker deleted is foreign; marker moved is foreign; a README with no SKILL.md is foreign; missing is absent", () => {
  const { tree } = makeTree();
  const sourceDir = writeSource(tree, "nightly", "nightly-probe");
  const renderedDir = renderInto(tree, sourceDir, "nightly-probe", "plugins/nightly/skills/nightly-probe");
  assert.equal(ownerOf(renderedDir), "ours");

  const noMarkerDir = join(tree.renderedRoot, "no-marker");
  mkdirSync(noMarkerDir, { recursive: true });
  writeFileSync(join(noMarkerDir, "SKILL.md"), SOURCE_TEMPLATE);
  assert.equal(ownerOf(noMarkerDir), "foreign");

  const movedDir = join(tree.renderedRoot, "moved-marker");
  mkdirSync(movedDir, { recursive: true });
  const rendered = render(SOURCE_TEMPLATE, "plugins/nightly/skills/nightly-probe");
  const lines = rendered.split("\n");
  // Move the marker three lines down: pull it out, then re-insert it later.
  const markerLine = lines.splice(4, 1)[0]!;
  lines.splice(7, 0, markerLine);
  writeFileSync(join(movedDir, "SKILL.md"), lines.join("\n"));
  assert.equal(ownerOf(movedDir), "foreign");

  const readmeDir = join(tree.renderedRoot, "readme-only");
  mkdirSync(readmeDir, { recursive: true });
  writeFileSync(join(readmeDir, "README.md"), "hi");
  assert.equal(ownerOf(readmeDir), "foreign");

  assert.equal(ownerOf(join(tree.renderedRoot, "does-not-exist")), "absent");
});

test("5. a hand-edited rendered file is still ours", () => {
  const { tree } = makeTree();
  const sourceDir = writeSource(tree, "nightly", "nightly-probe");
  const renderedDir = renderInto(tree, sourceDir, "nightly-probe", "plugins/nightly/skills/nightly-probe");
  const text = readFileSync(join(renderedDir, "SKILL.md"), "utf8");
  writeFileSync(join(renderedDir, "SKILL.md"), `${text}\nHAND EDITED\n`);
  assert.equal(ownerOf(renderedDir), "ours");
});

test("6. missing — a registered job whose rendered directory is absent", () => {
  const { tree } = makeTree();
  writeSource(tree, "nightly", "nightly-probe");
  const findings = check([job()], tree);
  assert.deepEqual(findings, [{ kind: "missing", job: "nightly-probe", want: join(tree.renderedRoot, "nightly-probe") }]);
});

test("7. drift — the bytes differ from render(source), with the 1-indexed first differing line", () => {
  const { tree } = makeTree();
  const sourceDir = writeSource(tree, "nightly", "nightly-probe");
  const renderedDir = renderInto(tree, sourceDir, "nightly-probe", "plugins/nightly/skills/nightly-probe");
  writeFileSync(join(renderedDir, "SKILL.md"), `${readFileSync(join(renderedDir, "SKILL.md"), "utf8")}\nEXTRA\n`);
  const findings = check([job()], tree);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, "drift");
});

test("8. orphan — an ours entry whose name is not a registered job", () => {
  const { tree } = makeTree();
  const sourceDir = writeSource(tree, "nightly", "ghost-job");
  renderInto(tree, sourceDir, "ghost-job", "plugins/nightly/skills/ghost-job");
  const findings = check([], tree);
  assert.deepEqual(findings, [{ kind: "orphan", name: "ghost-job", path: join(tree.renderedRoot, "ghost-job") }]);
});

test("9. collision (and no drift) — a foreign entry occupying a registered job's name", () => {
  const { tree } = makeTree();
  writeSource(tree, "nightly", "nightly-probe");
  const dir = join(tree.renderedRoot, "nightly-probe");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "not ours at all");
  const findings = check([job()], tree);
  assert.deepEqual(findings, [{ kind: "collision", job: "nightly-probe", path: dir }]);
  assert.ok(!findings.some((f) => f.kind === "drift"));
});

test("10. stray — an ours directory holding anything but SKILL.md, listing the extra file", () => {
  const { tree } = makeTree();
  const sourceDir = writeSource(tree, "nightly", "nightly-probe");
  const renderedDir = renderInto(tree, sourceDir, "nightly-probe", "plugins/nightly/skills/nightly-probe");
  writeFileSync(join(renderedDir, "NOTES.md"), "extra");
  const findings = check([job()], tree);
  assert.deepEqual(findings, [{ kind: "stray", name: "nightly-probe", path: renderedDir, extra: ["NOTES.md"] }]);
});

test("11. source-missing (and no drift) — a registered job whose source SKILL.md is gone", () => {
  const { tree } = makeTree();
  const findings = check([job()], tree);
  assert.deepEqual(findings, [{ kind: "source-missing", job: "nightly-probe", want: join(tree.sourceRoot, "nightly", "skills", "nightly-probe", "SKILL.md") }]);
});

test("12. a clean tree returns [], and so does zero jobs over an empty tree — by decision, not accident", () => {
  const { tree } = makeTree();
  const sourceDir = writeSource(tree, "nightly", "nightly-probe");
  renderInto(tree, sourceDir, "nightly-probe", "plugins/nightly/skills/nightly-probe");
  assert.deepEqual(check([job()], tree), []);

  const { tree: emptyTree } = makeTree();
  assert.deepEqual(check([], emptyTree), []);
});

test("13. determinism — one tree with one of each finding, check twice, deepEqual", () => {
  const { tree } = makeTree();
  // missing
  writeSource(tree, "nightly", "missing-one");
  // drift
  const driftSrc = writeSource(tree, "nightly", "drift-one");
  const driftDir = renderInto(tree, driftSrc, "drift-one", "plugins/nightly/skills/drift-one");
  writeFileSync(join(driftDir, "SKILL.md"), `${readFileSync(join(driftDir, "SKILL.md"), "utf8")}\nX\n`);
  // orphan
  const orphanSrc = writeSource(tree, "nightly", "orphan-one");
  renderInto(tree, orphanSrc, "orphan-one", "plugins/nightly/skills/orphan-one");
  // collision
  writeSource(tree, "nightly", "collision-one");
  mkdirSync(join(tree.renderedRoot, "collision-one"), { recursive: true });
  writeFileSync(join(tree.renderedRoot, "collision-one", "SKILL.md"), "foreign");
  // stray
  const straySrc = writeSource(tree, "nightly", "stray-one");
  const strayDir = renderInto(tree, straySrc, "stray-one", "plugins/nightly/skills/stray-one");
  writeFileSync(join(strayDir, "NOTES.md"), "x");
  // source-missing
  const jobs: Job[] = [
    job({ name: "missing-one" }),
    job({ name: "drift-one" }),
    job({ name: "collision-one" }),
    job({ name: "stray-one" }),
    job({ name: "source-missing-one" }),
  ];
  const a = check(jobs, tree);
  const b = check(jobs, tree);
  assert.deepEqual(a, b);
  assert.ok(a.some((f) => f.kind === "missing"));
  assert.ok(a.some((f) => f.kind === "drift"));
  assert.ok(a.some((f) => f.kind === "orphan"));
  assert.ok(a.some((f) => f.kind === "collision"));
  assert.ok(a.some((f) => f.kind === "stray"));
  assert.ok(a.some((f) => f.kind === "source-missing"));
});

test("14. layer 0 refuses four ways — relative renderedRoot, outside root, equal to root, wrong basename", () => {
  const { tree, root } = makeTree();
  assert.throws(() => assertSafeTree({ ...tree, renderedRoot: ".claude/skills" }, root), /absolute/);
  assert.throws(() => assertSafeTree({ ...tree, renderedRoot: "/tmp/somewhere-else/skills" }, root), /inside root/);
  assert.throws(() => assertSafeTree({ ...tree, renderedRoot: root }, root), /must not equal root/);
  assert.throws(() => assertSafeTree({ ...tree, renderedRoot: join(root, "host") }, root), /basename/);
  assert.doesNotThrow(() => assertSafeTree(tree, root));
  rmSync(root, { recursive: true, force: true });
});
