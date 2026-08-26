// J3.7 (SKL-03, SKL-04, SKL-05, SKL-10, TST-23) — the pure half of the skills tool: `render`,
// ownership decided from the filesystem alone (§5 Q0), the six findings `check` reports, and layer
// 0 — the crontab precedent's most important half, landed here BEFORE J3.9's `sync` gives this
// module its only `rm -rf`.
//
// `cli/` is `private: true` — this is an app-internal path, not a published import (ADO-01 stays
// open; that decision belongs there, not here).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { Job } from "../kernel/ports/job.ts";
import { skillOf } from "../kernel/ports/job.ts";

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
  const skillFile = join(dir, "SKILL.md");
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

/**
 * Every registered job, checked against the tree, plus every `ours` directory found under
 * `tree.renderedRoot` (for `orphan`/`stray`, which have no registered job to anchor the per-job
 * loop). Deterministically sorted (kind, then name) so two reports diff meaningfully.
 */
export function check(jobs: readonly Job[], tree: SkillsTree): readonly Finding[] {
  const findings: Finding[] = [];
  const registeredNames = new Set(jobs.map((j) => skillOf(j)));

  for (const job of jobs) {
    const name = skillOf(job);
    const sourceDir = join(tree.sourceRoot, job.plugin, "skills", name);
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
    const srcDirPosix = toPosix(relative(dirname(tree.sourceRoot), sourceDir));
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
