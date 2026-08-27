// the log barrel, and what the node:sqlite experimental warning
// does to the STDERR contract.
//
// On the pinned Node, importing node:sqlite — even without using it — prints two lines on stderr.
// It does not break LOG-06: LOG-07 exists for exactly this (parseLine skips both lines, and
// causeOf's NOISE already names them). It is not silenced. Its one real consequence is a rule:
// emit.ts must never load node:sqlite, so a logging-only process pays nothing — that is what makes
// J1.9's LOG-10 children compare clean bytes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseLine } from "./parse.ts";
import { causeOf } from "./cause.ts";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const KERNEL = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

// The barrel is what actually loads node:sqlite in this repo (through tail.ts -> db.ts) — captured
// live via the same import test 5 uses, not a synthetic direct require, so the lines are exactly
// what a real process using this code sees. Nothing about them is hardcoded; only the pid changes.
function capturedWarningLines(): string[] {
  const r = spawnSync(
    process.execPath,
    ["-e", "import('./kernel/runtime/log/index.ts').then(()=>{})"],
    { cwd: ROOT, encoding: "utf8" },
  );
  return r.stderr.split("\n").filter(Boolean);
}

test("1. the warning exists and is captured live", () => {
  const lines = capturedWarningLines();
  assert.ok(lines.length >= 1);
});

test("2. every captured warning line returns null from parseLine", () => {
  for (const l of capturedWarningLines()) {
    assert.equal(parseLine(l), null, `expected null for ${JSON.stringify(l)}`);
  }
});

test("3. causeOf(capturedLines) is undefined", () => {
  assert.equal(causeOf(capturedWarningLines()), undefined);
});

test("4. the cheap import stays cheap: emit.ts writes zero bytes to stderr", () => {
  const r = spawnSync(
    process.execPath,
    ["-e", "import('./kernel/runtime/log/emit.ts').then(()=>{})"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(r.stderr, "");
});

test("5. the expensive import is expensive, and that is fine", () => {
  const r = spawnSync(
    process.execPath,
    ["-e", "import('./kernel/runtime/log/index.ts').then(()=>{})"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.match(r.stderr, /ExperimentalWarning/);
});

test("6. every module the barrel names exists and is reachable", () => {
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      "import('./kernel/runtime/log/index.ts').then(m => console.log(Object.keys(m).sort().join(',')))",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  const names = new Set(r.stdout.trim().split(","));
  for (const expected of [
    "renderLine",
    "logger",
    "parseLine",
    "isFault",
    "routeOf",
    "summarise",
    "causeOf",
    "stderrTail",
    "tail",
    "logFiles",
  ]) {
    assert.ok(names.has(expected), `barrel is missing ${expected}`);
  }
});

test("7. LOG-01: the set of non-test files under kernel/ containing 'ts=' is exactly four", () => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (
        (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".fixture.ts")) ||
        entry.endsWith(".sh")
      ) {
        files.push(full);
      }
    }
  };
  walk(KERNEL);
  const withTsEquals = files
    .filter((f) => readFileSync(f, "utf8").includes("ts="))
    .map((f) => f.slice(KERNEL.length + 1))
    .sort();
  assert.deepEqual(withTsEquals, [
    "runtime/log/cause.ts", // reader — NOISE's /^ts=/, skipping lines the reporter already has
    "runtime/log/emit.ts", // writer — the TypeScript half
    "runtime/log/log.sh", // writer — the bash half (line="ts=$(date -u …)")
    "runtime/log/parse.ts", // reader — raw.startsWith("ts=")
  ]);
});
