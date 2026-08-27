// pins the command shape CLAUDE.md fixes: typecheck always runs as
// pretest, and every test file is actually in the suite (not just present on disk).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { matchesGlob, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

function readPkg(): any {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
}

// Walk the repo (skipping .git and node_modules) collecting every *.test.ts path,
// POSIX-relative to the repo root.
function findTestFiles(): string[] {
  const out: string[] = [];
  function walk(absDir: string, relDir: string) {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (relDir === "" && (entry.name === ".git" || entry.name === "node_modules")) continue;
        // R2 — a pass worktree under .doppelganger/worktrees/ is a second full
        // checkout (its own node_modules, package.json, *.test.ts) and is not this repo's source.
        if (relDir === ".doppelganger" && entry.name === "worktrees") continue;
        walk(join(absDir, entry.name), relDir === "" ? entry.name : `${relDir}/${entry.name}`);
      } else if (entry.name.endsWith(".test.ts")) {
        out.push(relDir === "" ? entry.name : `${relDir}/${entry.name}`);
      }
    }
  }
  walk(ROOT, "");
  return out;
}

// scripts.test is a shell command carrying double-quoted globs. Pull them out without
// a shell parser — this repo's own commands are simple enough that this is exact.
function extractGlobs(command: string): string[] {
  return [...command.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("1. scripts.pretest exists and its command runs typecheck", () => {
  const pkg = readPkg();
  assert.ok(typeof pkg.scripts.pretest === "string", "scripts.pretest must exist (TST-21)");
  assert.match(pkg.scripts.pretest, /typecheck/, "scripts.pretest must run typecheck (TST-21)");
});

test("2. scripts.typecheck contains tsc and --noEmit", () => {
  const pkg = readPkg();
  assert.match(pkg.scripts.typecheck, /\btsc\b/, "scripts.typecheck must contain tsc");
  assert.match(pkg.scripts.typecheck, /--noEmit\b/, "scripts.typecheck must contain --noEmit");
});

test("3. scripts.test starts with node --test", () => {
  const pkg = readPkg();
  assert.ok(pkg.scripts.test.startsWith("node --test"), "scripts.test must start with \"node --test\"");
});

test("4. every *.test.ts file is matched by at least one glob in scripts.test", () => {
  const pkg = readPkg();
  const globs = extractGlobs(pkg.scripts.test);
  const files = findTestFiles();
  for (const file of files) {
    const matched = globs.some((glob) => matchesGlob(file, glob));
    assert.ok(matched, `${file} is not matched by any glob in scripts.test: [${globs.join(", ")}]`);
  }
});

test("5. scripts.test names no test framework binary and no runner shim", () => {
  const pkg = readPkg();
  const denylist = ["jest", "vitest", "mocha", "ava", "tape", "tsx", "ts-node"];
  for (const name of denylist) {
    assert.ok(
      !pkg.scripts.test.includes(name),
      `scripts.test must not name ${name} (TST-22: no test framework binary, no runner shim)`,
    );
  }
});
