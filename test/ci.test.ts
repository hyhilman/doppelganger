// J0.13 (TST-21, TST-22) — CI runs npm test and nothing else. The reference has no CI at all
// (no .github/workflows/ in /home/hyhilman/projects/xenith/), so this is written from
// CLAUDE.md's rule, not copied from the corpus. A line scan, not a YAML parser (TST-22).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const WORKFLOW_PATH = ".github/workflows/test.yml";

function readWorkflow(): string {
  return readFileSync(join(ROOT, WORKFLOW_PATH), "utf8");
}

function runSteps(workflow: string): string[] {
  return workflow
    .split("\n")
    .filter((line) => /^\s*-?\s*run:/.test(line))
    .map((line) => line.replace(/^\s*-?\s*run:\s*/, "").trim());
}

test("1. exactly two run: steps, npm ci and npm test", () => {
  const steps = runSteps(readWorkflow());
  assert.deepEqual(steps, ["npm ci", "npm test"], `expected exactly [npm ci, npm test], got: ${steps.join(", ")}`);
});

test("2. Node comes from .nvmrc via node-version-file, no literal Node version", () => {
  const workflow = readWorkflow();
  assert.match(workflow, /node-version-file:\s*\.nvmrc/, "the workflow must set node-version-file: .nvmrc");
  assert.ok(!/node-version:/.test(workflow), "the workflow must not set a literal node-version");
});

test("3. the workflow names no linter, no bundler and no build script", () => {
  const workflow = readWorkflow();
  const denylist = ["eslint", "prettier", "biome", "rollup", "webpack", "vite", "npm run build", "npm run lint"];
  for (const name of denylist) {
    assert.ok(!workflow.includes(name), `the workflow must not name "${name}" (TST-22)`);
  }
});
