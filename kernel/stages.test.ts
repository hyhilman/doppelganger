// the stage-prefix vocabulary, held to both documents that name it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { STAGES, MISC, stageOf, byStage, matchOrder } from "./stages.ts";

const ROOT = new URL(".", import.meta.url).pathname.replace(/\/$/, "");

test("1. stageOf maps this repo's real prefixes to their stages", () => {
  assert.equal(stageOf("source-slack"), "source");
  assert.equal(stageOf("triage-switch"), "triage");
  assert.equal(stageOf("backlog-health"), "backlog");
  assert.equal(stageOf("watch-jira"), "watch");
  assert.equal(stageOf("todo-exec"), "todo");
  assert.equal(stageOf("corpus-lint"), "corpus");
  assert.equal(stageOf("nightly-sandcastle"), "nightly");
  assert.equal(stageOf("retro-grade"), "retro");
  assert.equal(stageOf("ops-hello"), "ops");
});

test("2. a bare stage name is its own stage", () => {
  assert.equal(stageOf("ops"), "ops");
});

test("3. a name that merely STARTS WITH a stage's letters is misc", () => {
  assert.equal(stageOf("todoist-sync"), MISC);
});

test("4. an unrelated name is misc, and misc is never silently dropped", () => {
  assert.equal(stageOf("deploy"), MISC);
});

test("5. longest-first, in the only form that can fire on real data", () => {
  // (a) No stage in STAGES is a prefix of another — the property that makes the ordering
  // currently unobservable on real names, and which goes red the day a sibling is added.
  for (const a of STAGES) {
    for (const b of STAGES) {
      if (a === b) continue;
      assert.ok(!b.startsWith(a), `"${a}" is a prefix of "${b}"`);
    }
  }
  // (b) stageOf matches in descending length order.
  assert.deepEqual([...matchOrder()], [...STAGES].sort((x, y) => y.length - x.length));
});

test("6. byStage groups in STAGES order, drops empty groups, misc last when non-empty", () => {
  const items = ["ops-a", "source-b", "misc-thing", "source-c"];
  const grouped = byStage(items, (x) => x);
  assert.deepEqual(
    grouped.map(([s]) => s),
    ["source", "ops", MISC],
  );
  assert.deepEqual(
    grouped.find(([s]) => s === "source")![1],
    ["source-b", "source-c"],
  );
});

test("7. the doc gate: roadmap.md SUP-20 and CLAUDE.md's Stage prefixes bullet match STAGES in order", (t) => {
  const roadmapPath = `${ROOT}/../roadmap.md`;
  if (!existsSync(roadmapPath)) {
    t.skip("roadmap.md not present (untracked scaffolding, see .gitignore)");
    return;
  }
  const roadmap = readFileSync(roadmapPath, "utf8");
  const claudeMd = readFileSync(`${ROOT}/../CLAUDE.md`, "utf8");

  const extractPrefixes = (text: string, startMarker: string, endMarker: string): string[] => {
    const start = text.indexOf(startMarker);
    assert.ok(start >= 0, `marker not found: ${startMarker}`);
    const end = text.indexOf(endMarker, start);
    assert.ok(end > start, `end marker not found after start: ${endMarker}`);
    const slice = text.slice(start, end);
    const tokens: string[] = [];
    // Tolerates a markdown line wrap in the middle of the backticked run — \s+ between tokens.
    const re = /`([a-z]+)-`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(slice)) != null) tokens.push(m[1]!);
    return tokens;
  };

  const roadmapPrefixes = extractPrefixes(roadmap, "**SUP-20**", "**SUP-21**");
  const claudePrefixes = extractPrefixes(claudeMd, "**Stage prefixes**", "**Both halves of the skill gate**");

  assert.deepEqual(roadmapPrefixes, [...STAGES]);
  assert.deepEqual(claudePrefixes, [...STAGES]);
});
