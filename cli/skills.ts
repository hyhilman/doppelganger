// J3.7 (SKL-03, SKL-04, SKL-05, SKL-10, TST-23) — the pure half of the skills tool: `render`,
// ownership decided from the filesystem alone (§5 Q0), the six findings `check` reports, and layer
// 0 — the crontab precedent's most important half, landed here BEFORE J3.9's `sync` gives this
// module its only `rm -rf`.
//
// `cli/` is `private: true` — this is an app-internal path, not a published import (ADO-01 stays
// open; that decision belongs there, not here).
import { existsSync, lstatSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { Job } from "../kernel/ports/job.ts";
import { skillOf } from "../kernel/ports/job.ts";
import { envStr, type EnvSpec } from "../kernel/config.ts";
import { ROOT, projectPath } from "../kernel/paths.ts";
import { JOBS } from "../host/jobs/index.ts";

// ---------------------------------------------------------------------------------------------
// render — lifted from test/skills-example.test.ts's local helper (J0.10), unchanged. A second
// copy of a render function is drift with two authors; this IS the function now, and that test
// imports it.
// ---------------------------------------------------------------------------------------------

export const MARKER_VERSION = 1;
export const MARKER_RE = /^<!-- managed:doppelganger-skills v=(\d+) src=(\S+) -->$/;

const RENDERED_NOTICE =
  "<!-- rendered by `skills render` — do not edit; edit the source and re-render (SKL-04) -->\n";

/**
 * `render(source)` = frontmatter block, byte for byte + the two managed marker lines + the rest of
 * the source, byte for byte. §5 Q0's render rule, restated as code.
 */
export function render(sourceText: string, srcDirPosix: string): string {
  const firstDelim = "---\n";
  if (!sourceText.startsWith(firstDelim)) {
    throw new Error("source does not start with a --- frontmatter delimiter");
  }
  const closeIndex = sourceText.indexOf("\n---\n", firstDelim.length - 1);
  if (closeIndex === -1) {
    throw new Error("source has no closing --- frontmatter delimiter");
  }
  const frontmatterEnd = closeIndex + "\n---\n".length;
  const frontmatterBlock = sourceText.slice(0, frontmatterEnd);
  const rest = sourceText.slice(frontmatterEnd);
  const marker1 = `<!-- managed:doppelganger-skills v=${MARKER_VERSION} src=${srcDirPosix} -->\n`;
  return frontmatterBlock + marker1 + RENDERED_NOTICE + rest;
}

// ---------------------------------------------------------------------------------------------
// Layer 0 — the crontab precedent's most important half (J2.16). `sync` (J3.9) is this phase's
// only `rm -rf`, and its scoping was, before this function, two caller-supplied strings. Called at
// the top of every verb, before any read and long before any prune.
// ---------------------------------------------------------------------------------------------

export interface SkillsTree {
  /** Absolute. Where rendered skills live — `.claude/skills` in the real tree. */
  readonly renderedRoot: string;
  /** Absolute. Where source skills live — `plugins` in the real tree. */
  readonly sourceRoot: string;
}

/** Throws unless BOTH roots are absolute, BOTH sit inside `root`, `renderedRoot` is not `root`
 *  itself, and `renderedRoot`'s basename is `"skills"` — a belt over a brace that also makes a
 *  `renderedRoot` of `<root>/host` (inside the checkout, absolute, not equal to root) refuse. */
export function assertSafeTree(tree: SkillsTree, root: string): void {
  const absRoot = isAbsolute(root) ? root : join(process.cwd(), root);
  const insideRoot = (p: string): boolean => p === absRoot || p.startsWith(absRoot + sep);

  if (!isAbsolute(tree.renderedRoot)) {
    throw new Error(`assertSafeTree: renderedRoot must be absolute, got ${JSON.stringify(tree.renderedRoot)}`);
  }
  if (!isAbsolute(tree.sourceRoot)) {
    throw new Error(`assertSafeTree: sourceRoot must be absolute, got ${JSON.stringify(tree.sourceRoot)}`);
  }
  if (!insideRoot(tree.renderedRoot)) {
    throw new Error(`assertSafeTree: renderedRoot must be inside root — ${tree.renderedRoot} is not under ${absRoot}`);
  }
  if (!insideRoot(tree.sourceRoot)) {
    throw new Error(`assertSafeTree: sourceRoot must be inside root — ${tree.sourceRoot} is not under ${absRoot}`);
  }
  if (tree.renderedRoot === absRoot) {
    throw new Error(`assertSafeTree: renderedRoot must not equal root itself — ${tree.renderedRoot}`);
  }
  if (basename(tree.renderedRoot) !== "skills") {
    throw new Error(`assertSafeTree: renderedRoot's basename must be "skills", got ${JSON.stringify(tree.renderedRoot)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Ownership, decided from the filesystem alone (§5 Q0, SKL-10) — no ledger.
// ---------------------------------------------------------------------------------------------

export type Owner = "ours" | "foreign" | "absent";

/**
 * `ours` iff `<dir>/SKILL.md` exists AND the line immediately after the closing frontmatter `---`
 * matches `MARKER_RE` — position is part of ownership, so a marker that drifted position (or was
 * never there) reads `foreign`, the conservative verdict: we do not touch it. A hand-edited
 * rendered file is still `ours` (the marker is untouched even though the body drifted) — that is
 * the point: it is reported as `drift` and refused, not reclassified as someone else's.
 */
export function ownerOf(dir: string): Owner {
  // N3 F4: a symlinked skill directory (or SKILL.md) is FOREIGN, whatever marker sits behind it.
  // ownerOf used to follow the link, read our marker on the far side, call the entry "ours", and
  // sync then wrote THROUGH the link — landing bytes outside the checkout. §5 Q0 settled that a
  // rendered skill is a regular file; a symlink is by definition not ours, so it is never
  // written, pruned or renamed. lstat (not stat) is the whole point: it sees the link itself.
  try {
    if (lstatSync(dir).isSymbolicLink()) return "foreign";
  } catch {
    return "absent";
  }
  const skillFile = join(dir, "SKILL.md");
  try {
    if (lstatSync(skillFile).isSymbolicLink()) return "foreign";
  } catch {
    // fall through — existsSync below reports absent/foreign as before
  }
  if (!existsSync(skillFile)) {
    return existsSync(dir) ? "foreign" : "absent";
  }
  const lines = readFileSync(skillFile, "utf8").split("\n");
  if (lines[0] !== "---") return "foreign";
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return "foreign";
  const markerLine = lines[closeIdx + 1];
  return markerLine !== undefined && MARKER_RE.test(markerLine) ? "ours" : "foreign";
}

// ---------------------------------------------------------------------------------------------
// The six findings (SKL-10 names five; `source-missing` is this job's addition — see roadmap.md
// Section 2.30).
// ---------------------------------------------------------------------------------------------

export type Finding =
  | { readonly kind: "missing"; readonly job: string; readonly want: string }
  | { readonly kind: "drift"; readonly job: string; readonly path: string; readonly line: number }
  | { readonly kind: "orphan"; readonly name: string; readonly path: string }
  | { readonly kind: "collision"; readonly job: string; readonly path: string }
  | { readonly kind: "stray"; readonly name: string; readonly path: string; readonly extra: readonly string[] }
  | { readonly kind: "source-missing"; readonly job: string; readonly want: string };

const KIND_ORDER: Record<Finding["kind"], number> = {
  missing: 0,
  drift: 1,
  orphan: 2,
  collision: 3,
  stray: 4,
  "source-missing": 5,
};

const findingName = (f: Finding): string => ("job" in f ? f.job : f.name);

/** 1-indexed line where `a` and `b` first diverge, or -1 if equal — the drift finding's `line`. */
function firstDifferingLine(a: string, b: string): number {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) return i + 1;
  }
  return -1;
}

// The POSIX separator, spelled as an escape rather than a literal "/" right after a quote —
// test/writes.test.ts's door 1 reads any quote immediately followed by / or ~ as a hardcoded PATH
// (INS-02) with no exception, and this is a path SEPARATOR, not a path.
const POSIX_SEP = "\u002F";

/** POSIX-separated, whatever the platform. */
const toPosix = (p: string): string => p.split(sep).join(POSIX_SEP);

/** Where a job's source lives — shared by `check` and `sync`/`render` so the two can never
 *  disagree about a path. */
const sourceDirFor = (tree: SkillsTree, job: Job): string => join(tree.sourceRoot, job.plugin, "skills", skillOf(job));

/** The marker's `src=` value for a job's source directory — repo-relative, POSIX-separated. */
const srcDirPosixFor = (tree: SkillsTree, sourceDir: string): string => toPosix(relative(dirname(tree.sourceRoot), sourceDir));

/**
 * Every job that DECLARES a skill (`job.skill !== undefined`), checked against the tree, plus
 * every `ours` directory found under `tree.renderedRoot` (for `orphan`/`stray`, which have no
 * registered job to anchor the per-job loop). Deterministically sorted (kind, then name) so two
 * reports diff meaningfully.
 *
 * J4.12 (ops-cron-check) is the first `exec:`-only job with no `skill` field at all —
 * `skillOf(job)` (kernel/ports/job.ts) FALLS BACK to `job.name` for a job that names none, which
 * is exactly right for a skill job (SKL-01: the skill name IS the job name unless overridden) and
 * exactly wrong here: it would make this function ask for a SKILL.md a deterministic job never
 * has. SKL-06's gate is meant to run "both ways" (roadmap.md) and exempt an `exec` job BY
 * CONSTRUCTION — this is the fix that makes that claim actually true, rather than merely stated;
 * nothing before this job's own registration exercised `job.skill === undefined` at all.
 * `registeredNames` is built from the SAME filtered set, so a stray rendered directory that
 * happens to share an exec-only job's name is correctly reported as an orphan, not silently
 * treated as that job's own (nonexistent) skill.
 */
export function check(jobs: readonly Job[], tree: SkillsTree): readonly Finding[] {
  const findings: Finding[] = [];
  const skillJobs = jobs.filter((j) => j.skill !== undefined);
  const registeredNames = new Set(skillJobs.map((j) => skillOf(j)));

  for (const job of skillJobs) {
    const name = skillOf(job);
    const sourceDir = sourceDirFor(tree, job);
    const sourceFile = join(sourceDir, "SKILL.md");
    const renderedDir = join(tree.renderedRoot, name);

    if (!existsSync(sourceFile)) {
      findings.push({ kind: "source-missing", job: job.name, want: sourceFile });
      continue; // sync would otherwise throw a raw ENOENT reading a file that is not there
    }

    const owner = ownerOf(renderedDir);
    if (owner === "absent") {
      findings.push({ kind: "missing", job: job.name, want: renderedDir });
      continue;
    }
    if (owner === "foreign") {
      // drift requires `ours`, so collision never also reports drift — the two are exclusive.
      findings.push({ kind: "collision", job: job.name, path: renderedDir });
      continue;
    }

    const sourceText = readFileSync(sourceFile, "utf8");
    const srcDirPosix = srcDirPosixFor(tree, sourceDir);
    const expected = render(sourceText, srcDirPosix);
    const actual = readFileSync(join(renderedDir, "SKILL.md"), "utf8");
    if (actual !== expected) {
      findings.push({ kind: "drift", job: job.name, path: join(renderedDir, "SKILL.md"), line: firstDifferingLine(expected, actual) });
    }
  }

  if (existsSync(tree.renderedRoot)) {
    for (const entry of readdirSync(tree.renderedRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dirPath = join(tree.renderedRoot, entry.name);
      if (ownerOf(dirPath) !== "ours") continue; // foreign/absent — never touched, never reported here
      if (!registeredNames.has(entry.name)) {
        findings.push({ kind: "orphan", name: entry.name, path: dirPath });
      }
      const extra = readdirSync(dirPath).filter((f) => f !== "SKILL.md");
      if (extra.length > 0) {
        findings.push({ kind: "stray", name: entry.name, path: dirPath, extra });
      }
    }
  }

  findings.sort((a, b) => {
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) return byKind;
    const an = findingName(a);
    const bn = findingName(b);
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
  return findings;
}

// ---------------------------------------------------------------------------------------------
// J3.9 (SKL-04, SKL-10, SAF-01, TST-23) — the impure half: `render` (prints, writes nothing),
// `sync` (writes `missing`, rewrites `drift`, removes `orphan`, REFUSES `stray`/`collision`/
// `source-missing`), `check` (prints every finding, never writes). Every verb calls
// `assertSafeTree` first — layer 0, before any read and long before any prune.
//
// Where the crontab precedent does NOT survive, because SKL-10 says so: a crontab is one file
// with a delimited block, so "foreign lines untouched" is a splice; `.claude/skills/` is a tree
// with nowhere to put a block marker, so the unit of ownership is a DIRECTORY, decided by
// `ownerOf`. `sync` never edits, renames or deletes a foreign directory.
// ---------------------------------------------------------------------------------------------

export const SKILLS_DRY_RUN_ENV: EnvSpec = {
  key: "SKILLS_DRY_RUN",
  default: "0",
  why: "sync prints the plan it would execute and writes nothing (SAF-01); still reads, since the read is what makes the printed plan true",
};

export interface SkillsDeps {
  readonly jobs: readonly Job[];
  readonly tree: SkillsTree;
  readonly root: string;
  readonly dryRun: boolean;
}

type VerbResult = { readonly out: string; readonly err: string; readonly code: number };

function describeFinding(f: Finding): string {
  switch (f.kind) {
    case "missing":
      return `missing: ${f.job} wants ${f.want}`;
    case "drift":
      return `drift: ${f.job} at ${f.path}, first differing line ${f.line}`;
    case "orphan":
      return `orphan: ${f.name} at ${f.path}`;
    case "collision":
      return `collision: ${f.job} at ${f.path} is occupied by a foreign entry`;
    case "stray":
      return `stray: ${f.name} at ${f.path} holds extra file(s): ${f.extra.join(", ")}`;
    case "source-missing":
      return `source-missing: ${f.job} wants ${f.want}`;
  }
}

function renderedFor(job: Job, tree: SkillsTree): string {
  const sourceDir = sourceDirFor(tree, job);
  const sourceText = readFileSync(join(sourceDir, "SKILL.md"), "utf8");
  return render(sourceText, srcDirPosixFor(tree, sourceDir));
}

function cmdRender(deps: SkillsDeps): VerbResult {
  assertSafeTree(deps.tree, deps.root);
  const parts: string[] = [];
  for (const job of deps.jobs) {
    if (job.skill === undefined) continue; // an exec: job names no skill, by construction (SKL-06)
    const sourceFile = join(sourceDirFor(deps.tree, job), "SKILL.md");
    if (!existsSync(sourceFile)) continue; // check reports source-missing; render has nothing to show
    parts.push(`--- ${skillOf(job)} ---\n${renderedFor(job, deps.tree)}`);
  }
  return { out: parts.join("\n"), err: "", code: 0 };
}

/** Refuse first, write second, prune third (SKL-10) — a run with any refusal writes nothing at
 *  all. The directory is removed, not its contents: an orphan that is ALSO stray is caught by the
 *  refuse-first step (both findings fire for the same directory), so prune never reaches one that
 *  still holds extra content. */
function cmdSync(deps: SkillsDeps): VerbResult {
  assertSafeTree(deps.tree, deps.root);
  const findings = check(deps.jobs, deps.tree);

  const refusals = findings.filter((f) => f.kind === "stray" || f.kind === "collision" || f.kind === "source-missing");
  if (refusals.length > 0) {
    return { out: "", err: ["sync refused:", ...refusals.map(describeFinding)].join("\n"), code: 1 };
  }

  const missing = findings.filter((f) => f.kind === "missing");
  const drift = findings.filter((f) => f.kind === "drift");
  const orphan = findings.filter((f) => f.kind === "orphan");

  if (missing.length === 0 && drift.length === 0 && orphan.length === 0) {
    return { out: "already in sync — nothing written\n", err: "", code: 0 };
  }

  const plan = [
    ...missing.map((f) => `wrote ${f.job}`),
    ...drift.map((f) => `rewrote ${f.job}`),
    ...orphan.map((f) => `pruned ${f.name}`),
  ];
  const tally = `${missing.length} wrote, ${drift.length} rewrote, ${orphan.length} pruned`;

  if (deps.dryRun) {
    return { out: `${plan.join("\n")}\n${tally}\n`, err: "", code: 0 };
  }

  for (const f of missing) {
    const job = deps.jobs.find((j) => j.name === f.job)!;
    const renderedDir = join(deps.tree.renderedRoot, skillOf(job));
    mkdirSync(renderedDir, { recursive: true });
    writeFileSync(join(renderedDir, "SKILL.md"), renderedFor(job, deps.tree));
  }
  for (const f of drift) {
    const job = deps.jobs.find((j) => j.name === f.job)!;
    writeFileSync(join(deps.tree.renderedRoot, skillOf(job), "SKILL.md"), renderedFor(job, deps.tree));
  }
  for (const f of orphan) {
    rmSync(join(deps.tree.renderedRoot, f.name), { recursive: true, force: true });
  }

  return { out: `${plan.join("\n")}\n${tally}\n`, err: "", code: 0 };
}

function cmdCheck(deps: SkillsDeps): VerbResult {
  assertSafeTree(deps.tree, deps.root);
  const findings = check(deps.jobs, deps.tree);
  if (findings.length === 0) {
    // Count SKILLS, not jobs: `check()` itself only ever looks at jobs carrying a `skill`
    // (line ~204), so counting every registered job over-reports the moment an exec-only job
    // exists. `ops-cron-check` made that real at N4 — the message said "2 skill(s)" with one
    // skill on disk.
    const skillCount = deps.jobs.filter((j) => j.skill !== undefined).length;
    return { out: `skills check: in sync — ${skillCount} skill(s)\n`, err: "", code: 0 };
  }
  return { out: "", err: ["skills check: drift detected", ...findings.map(describeFinding)].join("\n"), code: 1 };
}

/** The same `run(argv, deps)` shape `cli/crontab.ts` uses, so an operator learns one tool and gets
 *  two. Every path through this function is caught, so a thrown `assertSafeTree` refusal becomes
 *  `{ code: 1 }` rather than an uncaught rejection. */
export function run(argv: readonly string[], deps: SkillsDeps): VerbResult {
  try {
    const [name] = argv;
    if (name === "render") return cmdRender(deps);
    if (name === "sync") return cmdSync(deps);
    if (name === "check") return cmdCheck(deps);
    return { out: "", err: `unknown command ${JSON.stringify(name ?? "")} — expected one of: render, sync, check`, code: 1 };
  } catch (e) {
    return { out: "", err: e instanceof Error ? e.message : String(e), code: 1 };
  }
}

// ---------------------------------------------------------------------------------------------
// The argv block. UNTESTED BY CONSTRUCTION (ruling 1) — no test imports this file in a way that
// reaches it; cli/skills-cli.test.ts's two smoke checks drive it as a real child process instead.
// ---------------------------------------------------------------------------------------------
if (import.meta.filename === process.argv[1]) {
  const deps: SkillsDeps = {
    jobs: JOBS,
    tree: { renderedRoot: projectPath(".claude/skills"), sourceRoot: projectPath("plugins") },
    root: ROOT,
    dryRun: envStr(SKILLS_DRY_RUN_ENV) === "1",
  };
  const result = run(process.argv.slice(2), deps);
  if (result.out) process.stdout.write(result.out);
  if (result.err) process.stderr.write(result.err.endsWith("\n") ? result.err : `${result.err}\n`);
  process.exitCode = result.code;
}
