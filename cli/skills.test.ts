// J3.7 (SKL-03, SKL-04, SKL-05, SKL-10, TST-23) — render, ownership, the six findings, layer 0.
// Every test builds a mkdtempSync tree; test 1 reads the real one, read-only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job } from "../kernel/ports/job.ts";
import { render, ownerOf, check, assertSafeTree, run, type SkillsTree } from "./skills.ts";

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
    // J4.12: check()/render() now skip a job with no `skill` at all (an `exec:` job is exempt by
    // construction, SKL-06) — every fixture here is exercising the SKILL-dispatch checking logic,
    // so it must declare one. SKL-01: the skill name IS the job name unless overridden — mirrored
    // here too, so a fixture overriding only `name` still resolves skillOf() to that same name.
    skill: overrides.skill ?? overrides.name ?? "nightly-probe",
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

// ---------------------------------------------------------------------------------------------
// J3.9 (SKL-04, SKL-10, SAF-01, TST-23) — render/sync/check through run(argv, deps).
// ---------------------------------------------------------------------------------------------

function deps(tree: SkillsTree, root: string, jobs: readonly Job[] = [job()], dryRun = false) {
  return { jobs, tree, root, dryRun };
}

test("15. render writes nothing", () => {
  const { tree, root } = makeTree();
  const sourceDir = writeSource(tree, "nightly", "nightly-probe");
  renderInto(tree, sourceDir, "nightly-probe", "plugins/nightly/skills/nightly-probe");
  const before = readdirSync(tree.renderedRoot);
  run(["render"], deps(tree, root));
  assert.deepEqual(readdirSync(tree.renderedRoot), before);
});

test("16. sync on an empty rendered root writes the file, bytes equal render(source)", () => {
  const { tree, root } = makeTree();
  const sourceDir = writeSource(tree, "nightly", "nightly-probe");
  const result = run(["sync"], deps(tree, root));
  assert.equal(result.code, 0);
  assert.match(result.out, /wrote nightly-probe/);
  const written = readFileSync(join(tree.renderedRoot, "nightly-probe", "SKILL.md"), "utf8");
  const expected = render(readFileSync(join(sourceDir, "SKILL.md"), "utf8"), "plugins/nightly/skills/nightly-probe");
  assert.equal(written, expected);
});

test("17. sync on drift rewrites and reports rewrote", () => {
  const { tree, root } = makeTree();
  const sourceDir = writeSource(tree, "nightly", "nightly-probe");
  const renderedDir = renderInto(tree, sourceDir, "nightly-probe", "plugins/nightly/skills/nightly-probe");
  writeFileSync(join(renderedDir, "SKILL.md"), `${readFileSync(join(renderedDir, "SKILL.md"), "utf8")}\nEXTRA\n`);
  const result = run(["sync"], deps(tree, root));
  assert.equal(result.code, 0);
  assert.match(result.out, /rewrote nightly-probe/);
  const written = readFileSync(join(renderedDir, "SKILL.md"), "utf8");
  assert.equal(written, render(readFileSync(join(sourceDir, "SKILL.md"), "utf8"), "plugins/nightly/skills/nightly-probe"));
});

test("18. sync prunes an orphan and reports pruned; the directory is gone", () => {
  const { tree, root } = makeTree();
  const orphanSrc = writeSource(tree, "nightly", "orphan-one");
  renderInto(tree, orphanSrc, "orphan-one", "plugins/nightly/skills/orphan-one");
  const result = run(["sync"], deps(tree, root, []));
  assert.equal(result.code, 0);
  assert.match(result.out, /pruned orphan-one/);
  assert.equal(existsSync(join(tree.renderedRoot, "orphan-one")), false);
});

test("19. sync refuses a collision: exit 1, nothing written, nothing pruned — byte-identical afterwards including a would-be-pruned orphan", () => {
  const { tree, root } = makeTree();
  writeSource(tree, "nightly", "nightly-probe");
  const collisionDir = join(tree.renderedRoot, "nightly-probe");
  mkdirSync(collisionDir, { recursive: true });
  writeFileSync(join(collisionDir, "SKILL.md"), "foreign content");
  const orphanSrc = writeSource(tree, "nightly", "orphan-one");
  renderInto(tree, orphanSrc, "orphan-one", "plugins/nightly/skills/orphan-one");
  const before = readdirSync(tree.renderedRoot).sort();
  const beforeCollision = readFileSync(join(collisionDir, "SKILL.md"), "utf8");
  const result = run(["sync"], deps(tree, root));
  assert.equal(result.code, 1);
  assert.match(result.err, /collision/);
  assert.deepEqual(readdirSync(tree.renderedRoot).sort(), before);
  assert.equal(readFileSync(join(collisionDir, "SKILL.md"), "utf8"), beforeCollision);
  assert.ok(existsSync(join(tree.renderedRoot, "orphan-one")), "the orphan must survive — refuse-first");
});

test("20. sync refuses a stray, and the stray file survives", () => {
  const { tree, root } = makeTree();
  const sourceDir = writeSource(tree, "nightly", "nightly-probe");
  const renderedDir = renderInto(tree, sourceDir, "nightly-probe", "plugins/nightly/skills/nightly-probe");
  writeFileSync(join(renderedDir, "NOTES.md"), "extra");
  const result = run(["sync"], deps(tree, root));
  assert.equal(result.code, 1);
  assert.match(result.err, /stray/);
  assert.ok(existsSync(join(renderedDir, "NOTES.md")));
});

test("21. sync is idempotent — twice; the second prints already in sync and writes nothing", () => {
  const { tree, root } = makeTree();
  writeSource(tree, "nightly", "nightly-probe");
  run(["sync"], deps(tree, root));
  const before = readFileSync(join(tree.renderedRoot, "nightly-probe", "SKILL.md"), "utf8");
  const second = run(["sync"], deps(tree, root));
  assert.equal(second.code, 0);
  assert.match(second.out, /already in sync/);
  assert.equal(readFileSync(join(tree.renderedRoot, "nightly-probe", "SKILL.md"), "utf8"), before);
});

test("22. deps.dryRun: true prints the same plan and writes nothing", () => {
  const { tree, root } = makeTree();
  writeSource(tree, "nightly", "nightly-probe");
  const wet = run(["sync"], deps(tree, root)).out;
  const { tree: tree2, root: root2 } = makeTree();
  writeSource(tree2, "nightly", "nightly-probe");
  const dry = run(["sync"], deps(tree2, root2, [job()], true));
  assert.equal(dry.code, 0);
  assert.equal(dry.out, wet);
  assert.equal(existsSync(join(tree2.renderedRoot, "nightly-probe")), false);
});

test("23. check on a clean tree exits 0; on each of the six findings exits 1 and names it", () => {
  const { tree, root } = makeTree();
  const sourceDir = writeSource(tree, "nightly", "nightly-probe");
  renderInto(tree, sourceDir, "nightly-probe", "plugins/nightly/skills/nightly-probe");
  assert.equal(run(["check"], deps(tree, root)).code, 0);

  // missing
  {
    const { tree: t, root: r } = makeTree();
    writeSource(t, "nightly", "nightly-probe");
    const result = run(["check"], deps(t, r));
    assert.equal(result.code, 1);
    assert.match(result.err, /missing/);
  }
  // drift
  {
    const { tree: t, root: r } = makeTree();
    const s = writeSource(t, "nightly", "nightly-probe");
    const rd = renderInto(t, s, "nightly-probe", "plugins/nightly/skills/nightly-probe");
    writeFileSync(join(rd, "SKILL.md"), `${readFileSync(join(rd, "SKILL.md"), "utf8")}\nX\n`);
    const result = run(["check"], deps(t, r));
    assert.equal(result.code, 1);
    assert.match(result.err, /drift/);
  }
  // orphan
  {
    const { tree: t, root: r } = makeTree();
    const s = writeSource(t, "nightly", "orphan-one");
    renderInto(t, s, "orphan-one", "plugins/nightly/skills/orphan-one");
    const result = run(["check"], deps(t, r, []));
    assert.equal(result.code, 1);
    assert.match(result.err, /orphan/);
  }
  // collision
  {
    const { tree: t, root: r } = makeTree();
    writeSource(t, "nightly", "nightly-probe");
    mkdirSync(join(t.renderedRoot, "nightly-probe"), { recursive: true });
    writeFileSync(join(t.renderedRoot, "nightly-probe", "SKILL.md"), "foreign");
    const result = run(["check"], deps(t, r));
    assert.equal(result.code, 1);
    assert.match(result.err, /collision/);
  }
  // stray
  {
    const { tree: t, root: r } = makeTree();
    const s = writeSource(t, "nightly", "nightly-probe");
    const rd = renderInto(t, s, "nightly-probe", "plugins/nightly/skills/nightly-probe");
    writeFileSync(join(rd, "NOTES.md"), "x");
    const result = run(["check"], deps(t, r));
    assert.equal(result.code, 1);
    assert.match(result.err, /stray/);
  }
  // source-missing
  {
    const { tree: t, root: r } = makeTree();
    const result = run(["check"], deps(t, r));
    assert.equal(result.code, 1);
    assert.match(result.err, /source-missing/);
  }
});

test("24. sync never touches a foreign directory that is not a registered job's name", () => {
  const { tree, root } = makeTree();
  writeSource(tree, "nightly", "nightly-probe");
  const foreignDir = join(tree.renderedRoot, "some-other-tool");
  mkdirSync(foreignDir, { recursive: true });
  writeFileSync(join(foreignDir, "SKILL.md"), "not ours, no marker");
  const before = readFileSync(join(foreignDir, "SKILL.md"), "utf8");
  run(["sync"], deps(tree, root));
  assert.equal(readFileSync(join(foreignDir, "SKILL.md"), "utf8"), before);
});

test("25. every verb refuses an unsafe tree, reached through run(argv, deps)", () => {
  const { tree, root } = makeTree();
  const unsafe = { ...tree, renderedRoot: join(root, "not-skills") };
  for (const verb of ["render", "sync", "check"]) {
    const result = run([verb], deps(unsafe, root));
    assert.equal(result.code, 1);
    assert.match(result.err, /basename/);
  }
});

test("F4. ownerOf — a symlinked skill directory is FOREIGN even when the target carries our marker (SKL-10)", () => {
  const { tree } = makeTree();
  // A real rendered dir OUTSIDE the rendered root, carrying a genuine marker...
  const sourceDir = writeSource(tree, "nightly", "nightly-probe");
  const outside = renderInto(tree, sourceDir, "nightly-probe", "plugins/nightly/skills/nightly-probe");
  // ...reached from inside the rendered root through a symlink. ownerOf used to follow the link,
  // see the marker, call it "ours" — and sync then wrote THROUGH the link, outside the checkout.
  const linked = join(tree.renderedRoot, "linked-skill");
  symlinkSync(outside, linked, "dir");
  assert.equal(ownerOf(linked), "foreign");
  // A regular dir whose SKILL.md is itself a symlink is foreign too.
  const fileLink = join(tree.renderedRoot, "file-link");
  mkdirSync(fileLink, { recursive: true });
  symlinkSync(join(outside, "SKILL.md"), join(fileLink, "SKILL.md"), "file");
  assert.equal(ownerOf(fileLink), "foreign");
});

test("22. check counts SKILLS, not registered jobs — an exec-only job is not a skill (SKL-06)", () => {
  const { tree, root } = makeTree();
  writeSource(tree, "nightly", "nightly-probe");
  run(["sync"], deps(tree, root));
  // One skill-carrying job plus one exec-only job. `check()` itself only ever inspects jobs
  // carrying a `skill`, so the summary must say ONE — counting `deps.jobs.length` said two the
  // moment `ops-cron-check` (exec-only) joined the registry, reporting a skill that has no file.
  const execOnly = { ...job({ name: "ops-probe" }), skill: undefined } as unknown as Job;
  const result = run(["check"], deps(tree, root, [job(), execOnly]));
  assert.equal(result.code, 0);
  assert.match(result.out, /in sync — 1 skill\(s\)/);
});
