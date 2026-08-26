// J0.12 (D15) — gate the reference corpus path and the provenance of its counts.
//
// The claim is split into what can be true NOW and what is a DATED OBSERVATION:
//   - the corpus path resolves, and roadmap.md names no old macOS path — live, gated always.
//   - the four counts J0.11 refreshed — a dated observation, gated on PROVENANCE (same date
//     stamp in all four places, §3.0's percentage consistent with its own denominator), not on
//     a tolerance band. A ±2% band was tried and dropped: every real staleness this repo has
//     produced drifts 0.4%-0.84%, which passes a ±2% gate — the band could not catch the
//     failure it was written for. See plan/N0-uac.md J0.12 for the full reasoning.
//   - an exact re-measure against the live corpus is opt-in (CORPUS_RECHECK=1), never run in CI.
//
// Follow-up fix (F4): the four counts are written as ROUNDED APPROXIMATIONS ("about 250 TS
// files"), not exact integers. An exact count of a live external repo that other people commit
// to is false again within hours — pinning a fresh exact number just resets a clock that runs
// out again tomorrow. The provenance checks above still hold the two files to the SAME stated
// approximation; the opt-in re-measure below checks the live corpus still ROUNDS to that
// approximation, not that it equals a frozen integer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

function readRoadmap(): string {
  return readFileSync(join(ROOT, "roadmap.md"), "utf8");
}

function readClaude(): string {
  return readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
}

// Parse the corpus path out of roadmap.md's own first backtick-quoted absolute path, so the
// document is the source of the claim, not a literal duplicated here.
function parseCorpusPathFromRoadmap(roadmap: string): string {
  const match = /`(\/[^`]+xenith\/?)`/.exec(roadmap);
  if (!match) throw new Error("could not find the corpus path in roadmap.md");
  return match[1];
}

// The path actually used to look for the corpus on disk. CORPUS_OVERRIDE is test-only, read
// only by this file — deliberately NOT an EnvSpec row (KRN-06 governs knobs the engine reads at
// runtime; a test fixture switch is not one). This is separate from the parser above so that
// overriding the LOOKUP path never hides a break in the PARSING logic.
function corpusPath(roadmap: string): string {
  if (process.env.CORPUS_OVERRIDE) return process.env.CORPUS_OVERRIDE;
  return parseCorpusPathFromRoadmap(roadmap);
}

function corpusPresent(path: string): boolean {
  return existsSync(join(path, "engine")) && existsSync(join(path, "compose-data/docker-compose.yml"));
}

// The four dated observations J0.11 refreshed, now written as approximations ("about 250").
// Matched by structure (the surrounding words and the number's unit), not by literal value, so a
// future refresh does not need to touch this file. Every gap between tokens is `\s+`/`\s*`, not a
// literal single space — markdown line-wraps a sentence wherever it likes, and the claim being
// gated is the words and the numbers, not which column they wrap at. The "about " is optional in
// the regex only so the same parser reads both an old-style exact figure and the new approximate
// one — it does not make "about " optional in the DOCUMENT, which the tests below still require.
function extractObservations(roadmap: string, claude: string) {
  const engineSrc =
    /`engine\/src\/\*\*`\s*\(\s*(?:about\s+)?(\d+)\s+files,\s*(?:about\s+)?(\d+)\s+non-test\s*—\s*approximate,\s*measured\s+(\d{4}-\d{2}-\d{2})\)/.exec(
      roadmap,
    );
  const engineAll =
    /`engine\/\*\*`\s+is\s+(?:about\s+)?(\d+)\s+TS\s+files\s*\/\s*(?:about\s+)?([\d,]+)\s+lines\s+outside\s+`node_modules`\s*\(measured\s+(\d{4}-\d{2}-\d{2})/.exec(
      roadmap,
    );
  const loopSurface =
    /\*\*(\d+)\s+files,\s*([\d,]+)\s+lines\s*—\s*(\d+)%\s+of\s+the\s+engine's\s+(?:about\s+)?([\d,]+)\*\*\s*\(measured\s+(\d{4}-\d{2}-\d{2})/.exec(
      roadmap,
    );
  const claudeMirror =
    /verified\s+(\d{4}-\d{2}-\d{2}):\s*(?:about\s+)?(\d+)\s+TS\s+files\s*\/\s*(?:about\s+)?([\d,]+)\s+lines\s+outside/.exec(
      claude,
    );
  return { engineSrc, engineAll, loopSurface, claudeMirror };
}

test("1. roadmap.md names no old macOS corpus path", () => {
  // Scoped to roadmap.md only. CLAUDE.md names /Users/hyhilman/Projects/xenith/ on purpose — it
  // is the sentence recording that the OLD path was wrong. roadmap.md is the spec of record and
  // has no reason to name it; do not widen this to a repo-wide grep.
  const roadmap = readRoadmap();
  assert.ok(!roadmap.includes("/Users/hyhilman/"), "roadmap.md must not name the old macOS corpus path");
});

test("2. the corpus path resolves out of roadmap.md's own text", () => {
  // Always parses roadmap.md directly — CORPUS_OVERRIDE (used by assertions 3 and 6 to point
  // the LOOKUP elsewhere) must never mask a break in this parsing logic.
  const path = parseCorpusPathFromRoadmap(readRoadmap());
  assert.match(path, /^\//, "the corpus path must be absolute");
  assert.match(path, /xenith\/?$/, "the corpus path must name the xenith checkout");
});

test("3. corpus present -> engine/ and compose-data/docker-compose.yml exist; absent -> skip", (t) => {
  const path = corpusPath(readRoadmap());
  if (!corpusPresent(path)) {
    t.skip("reference corpus absent");
    return;
  }
  assert.ok(statSync(join(path, "engine")).isDirectory(), "<corpus>/engine/ must be a directory (D15, §3.0)");
  assert.ok(
    statSync(join(path, "compose-data/docker-compose.yml")).isFile(),
    "<corpus>/compose-data/docker-compose.yml must be a file (D15, §3.0)",
  );
});

test("5. provenance: the four counts share one date stamp, and §3.0's percentage matches its denominator", () => {
  const { engineSrc, engineAll, loopSurface, claudeMirror } = extractObservations(readRoadmap(), readClaude());
  assert.ok(engineSrc, "roadmap.md must carry a dated engine/src/** count");
  assert.ok(engineAll, "roadmap.md must carry a dated engine/** count");
  assert.ok(loopSurface, "roadmap.md §3.0 must carry a dated loop-surface percentage");
  assert.ok(claudeMirror, "CLAUDE.md must carry a dated mirror of the engine/** count");

  const dated: [string, string][] = [
    ["roadmap.md engine/src/** count", engineSrc![3]],
    ["roadmap.md engine/** count", engineAll![3]],
    ["roadmap.md §3.0 loop-surface percentage", loopSurface![5]],
    ["CLAUDE.md engine/** mirror", claudeMirror![1]],
  ];
  const uniqueDates = new Set(dated.map(([, date]) => date));
  assert.equal(
    uniqueDates.size,
    1,
    `all four counts (across roadmap.md and CLAUDE.md) must share one date stamp, got: ` +
      dated.map(([name, date]) => `${name}=${date}`).join(", "),
  );

  // Tying the DATES together (above) does not tie the NUMBERS together. Two files can carry the
  // same date stamp and still state different values for the one measurement they both claim to
  // report — that gap is what let roadmap.md and CLAUDE.md disagree on the line count while this
  // test stayed green. Compare the file count and the line count across the two files directly.
  const roadmapFileCount = Number(engineAll![1]);
  const roadmapLineCount = Number(engineAll![2].replace(/,/g, ""));
  const claudeFileCount = Number(claudeMirror![2]);
  const claudeLineCount = Number(claudeMirror![3].replace(/,/g, ""));
  assert.equal(
    roadmapFileCount,
    claudeFileCount,
    `roadmap.md's engine/** file count (${roadmapFileCount}) must equal CLAUDE.md's mirror (${claudeFileCount})`,
  );
  assert.equal(
    roadmapLineCount,
    claudeLineCount,
    `roadmap.md's engine/** line count (${roadmapLineCount}) must equal CLAUDE.md's mirror (${claudeLineCount})`,
  );

  // The numerator comes from the SAME regex match as the denominator (loopSurface[2]), never a
  // literal copied into this file — a literal here would be a second place to update every time
  // §3.0's "19 files, 4,517 lines" changes, and the two copies could disagree exactly like the
  // provenance bug above.
  //
  // Read this check for what it is, not more: rounding to a whole percent tolerates a WIDE band
  // on the denominator before it can fire. At the figures on 2026-08-25 (numerator 4,517,
  // denominator 56,922, stated 8%), the denominator can drift from about -6.6% to about +5.8%
  // before the rounded percentage moves off 8%. That is not a tight gate — it is a gate against
  // the numerator and the percentage disagreeing with EACH OTHER, not a precise cross-check of
  // the engine's total size.
  const numeratorLines = Number(loopSurface![2].replace(/,/g, ""));
  const totalLines = Number(loopSurface![4].replace(/,/g, ""));
  const statedPercent = Number(loopSurface![3]);
  const computedPercent = Math.round((numeratorLines / totalLines) * 100);
  assert.equal(
    computedPercent,
    statedPercent,
    `§3.0's stated ${statedPercent}% must equal round(${numeratorLines} / ${totalLines} * 100) = ${computedPercent}%`,
  );
});

// Round a live measurement to the same bucket the stated approximation is written at, so
// "still true" means "still rounds the same way", not "still equals a frozen integer".
function roundToNearest(value: number, bucket: number): number {
  return Math.round(value / bucket) * bucket;
}

// Opt-in re-measure against the live corpus. Test-only, also not an EnvSpec row (same reasoning
// as CORPUS_OVERRIDE above). A human runs this when the approximation itself looks wrong; a
// nightly-polish job at N5 is the natural long-term owner. On failure: re-measure, update all
// four places, move the date (J0.11's shape) — do not just widen the tolerance to make it pass.
test("6. CORPUS_RECHECK=1 -> the live corpus still rounds to the stated approximation (opt-in, not in CI)", (t) => {
  const path = corpusPath(readRoadmap());
  if (process.env.CORPUS_RECHECK !== "1" || !corpusPresent(path)) {
    t.skip("opt-in: set CORPUS_RECHECK=1 with the corpus present to run this");
    return;
  }
  const { engineSrc, engineAll, loopSurface, claudeMirror } = extractObservations(readRoadmap(), readClaude());
  assert.ok(engineSrc && engineAll && loopSurface && claudeMirror, "all four dated observations must parse");

  const engineDir = join(path, "engine");
  const fileCount = Number(
    execSync(`find "${engineDir}" -name '*.ts' -not -path '*/node_modules/*' | wc -l`).toString().trim(),
  );
  const lineCount = Number(
    execSync(`find "${engineDir}" -name '*.ts' -not -path '*/node_modules/*' -print0 | xargs -0 cat | wc -l`)
      .toString()
      .trim(),
  );
  const srcDir = join(engineDir, "src");
  const srcFileCount = Number(
    execSync(`find "${srcDir}" -name '*.ts' -not -path '*/node_modules/*' | wc -l`).toString().trim(),
  );
  const srcNonTestCount = Number(
    execSync(`find "${srcDir}" -name '*.ts' -not -name '*.test.ts' -not -path '*/node_modules/*' | wc -l`)
      .toString()
      .trim(),
  );

  // Three of the four figures are written as a round number a reader would read as "about X"
  // (250, 240, 57,000). Round the live measurement to the SAME bucket the prose implies — nearest
  // 10 for a file count in the hundreds, nearest 1,000 for a line count in the tens of thousands —
  // and compare. This tolerates the kind of drift a normal month of commits produces (a handful of
  // files, a few hundred lines) without tolerating a real jump (a rewrite, a big vendor drop).
  const statedSrcFiles = Number(engineSrc![1]);
  const statedAllFiles = Number(engineAll![1]);
  const statedAllLines = Number(engineAll![2].replace(/,/g, ""));
  const statedClaudeFiles = Number(claudeMirror![2]);
  const statedClaudeLines = Number(claudeMirror![3].replace(/,/g, ""));

  const roundedMsg = (label: string, live: number, bucket: number, stated: number) =>
    `${label}: live=${live} rounds to ${roundToNearest(live, bucket)}, no longer "about ${stated}" — ` +
    `re-measure and update roadmap.md:9, :12, :1216 and CLAUDE.md:15, and move the date stamp`;

  assert.equal(
    roundToNearest(srcFileCount, 10),
    statedSrcFiles,
    roundedMsg("engine/src/** files", srcFileCount, 10, statedSrcFiles),
  );
  assert.equal(
    roundToNearest(fileCount, 10),
    statedAllFiles,
    roundedMsg("engine/** files", fileCount, 10, statedAllFiles),
  );
  assert.equal(
    roundToNearest(lineCount, 1000),
    statedAllLines,
    roundedMsg("engine/** lines", lineCount, 1000, statedAllLines),
  );
  assert.equal(
    roundToNearest(fileCount, 10),
    statedClaudeFiles,
    roundedMsg("CLAUDE.md mirror files", fileCount, 10, statedClaudeFiles),
  );
  assert.equal(
    roundToNearest(lineCount, 1000),
    statedClaudeLines,
    roundedMsg("CLAUDE.md mirror lines", lineCount, 1000, statedClaudeLines),
  );

  // The non-test source count (134) is small and, unlike the other three, is not itself written
  // at a round bucket — rounding it to the nearest 10 would read "about 130", which is not what
  // the prose says. Give it a flat tolerance instead: +/-10 covers a normal month of test-file
  // churn without pretending 134 is a round number it is not.
  const NON_TEST_TOLERANCE = 10;
  const statedNonTest = Number(engineSrc![2]);
  assert.ok(
    Math.abs(srcNonTestCount - statedNonTest) <= NON_TEST_TOLERANCE,
    `engine/src/** non-test files: live=${srcNonTestCount} is more than ±${NON_TEST_TOLERANCE} from ` +
      `"about ${statedNonTest}" — re-measure and update roadmap.md:9, and move the date stamp`,
  );
});
