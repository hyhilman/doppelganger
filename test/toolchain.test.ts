// J0.8 (TST-22) — no linter, no bundler, no build step on the RUN path.
//
// TST-22 and ADO-15 talk about two different scripts, and this file tells them apart
// by name rather than by intent:
//   - forbidden everywhere: a linter or a bundler, as a dependency or as a config file.
//   - forbidden on the RUN path: the scripts that run the loop, the suite or the type
//     check may not compile anything.
//   - permitted on the PUBLISH path only, and absent at N0: scripts.build and
//     tsconfig.build.json arrive with ADO-15 at N5.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// typescript and @types/node are the only two dependencies this repo carries (J0.2).
// Everything else in this list is a linter, a bundler, a test framework or a runner
// shim, and none of them may appear as a dependency anywhere in the repo.
const DENYLIST = [
  "eslint",
  "@eslint/",
  "prettier",
  "biome",
  "@biomejs/",
  "oxlint",
  "xo",
  "standard",
  "tslint",
  "rollup",
  "webpack",
  "esbuild",
  "vite",
  "parcel",
  "tsup",
  "swc",
  "@swc/",
  "babel",
  "@babel/",
  "browserify",
  "tsx",
  "ts-node",
  "jest",
  "vitest",
  "mocha",
  "ava",
  "tape",
  "nodemon",
  "semver",
];

const CONFIG_FILE_PATTERNS = [
  /^\.eslintrc/,
  /^eslint\.config\./,
  /^\.prettierrc/,
  /^prettier\.config\./,
  /^biome\.json/,
  /^rollup\.config\./,
  /^webpack\.config\./,
  /^vite\.config\./,
  /^\.babelrc/,
  /^babel\.config\./,
  /^jest\.config\./,
  /^vitest\.config\./,
  /^\.markdownlint/,
];

// Walk the repo (skipping .git and node_modules), collecting every directory's
// POSIX-relative path from the repo root and its entry names.
function walkDirs(): { relPath: string; entries: string[] }[] {
  const out: { relPath: string; entries: string[] }[] = [];
  function walk(absDir: string, relDir: string) {
    const entries = readdirSync(absDir, { withFileTypes: true });
    out.push({ relPath: relDir, entries: entries.map((e) => e.name) });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (relDir === "" && (entry.name === ".git" || entry.name === "node_modules")) continue;
      const nextRel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      walk(join(absDir, entry.name), nextRel);
    }
  }
  walk(ROOT, "");
  return out;
}

function allPackageJsonPaths(): string[] {
  return walkDirs()
    .filter((d) => !d.relPath.startsWith("node_modules") && d.entries.includes("package.json"))
    .map((d) => (d.relPath === "" ? "package.json" : `${d.relPath}/package.json`));
}

test("1. no dependency anywhere is a linter, a bundler, a test framework or a runner shim", () => {
  for (const pkgPath of allPackageJsonPaths()) {
    const pkg = JSON.parse(readFileSync(join(ROOT, pkgPath), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(deps)) {
      const denied = DENYLIST.some((bad) => name === bad || name.startsWith(bad));
      assert.ok(!denied, `${pkgPath} depends on "${name}", which TST-22 forbids`);
    }
  }
});

test("2. no linter/bundler config file exists at any level", () => {
  for (const dir of walkDirs()) {
    if (dir.relPath.startsWith("node_modules")) continue;
    for (const entry of dir.entries) {
      const hit = CONFIG_FILE_PATTERNS.find((pattern) => pattern.test(entry));
      if (hit) {
        const path = dir.relPath === "" ? entry : `${dir.relPath}/${entry}`;
        assert.fail(`${path} is a linter/bundler config file, which TST-22 forbids`);
      }
    }
  }
});

test("3. the RUN path (test, pretest, typecheck, posttest, prepare) never compiles anything", () => {
  for (const pkgPath of allPackageJsonPaths()) {
    const pkg = JSON.parse(readFileSync(join(ROOT, pkgPath), "utf8"));
    const scripts = pkg.scripts ?? {};
    // "test, pretest, typecheck" was the scanned list, but a compile hidden in posttest (runs
    // right after test, on the same path) or prepare (runs on every npm install, including a
    // fresh CI checkout) would pass unseen. Both are on the run path exactly like the other three.
    for (const key of ["test", "pretest", "typecheck", "posttest", "prepare"]) {
      const command: string | undefined = scripts[key];
      if (!command) continue;
      for (const forbidden of ["npm run build", "tsc -p tsconfig.build", "dist/"]) {
        assert.ok(
          !command.includes(forbidden),
          `${pkgPath} scripts.${key} contains "${forbidden}" — the run path must not compile (TST-22)`,
        );
      }
    }
  }
});

// ADO-15 lands at N5. On that day this assertion flips to:
//   scripts.build === "tsc -p tsconfig.build.json --workspaces"
//   AND scripts.pretest still does NOT reference build (TST-22, §5 Q5 measured at N0).
test("4. the publish path (scripts.build, tsconfig.build.json) does not exist yet at N0", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.ok(!("build" in (pkg.scripts ?? {})), "root scripts.build must not exist yet (ADO-15 lands at N5)");
  for (const dir of walkDirs()) {
    if (dir.relPath.startsWith("node_modules")) continue;
    assert.ok(
      !dir.entries.includes("tsconfig.build.json"),
      `${dir.relPath || "."} must not have tsconfig.build.json yet (ADO-15 lands at N5)`,
    );
  }
});

// "host/ is not a workspace" (ADO-14) is asserted once, in test/layout.test.ts assertion 6.
// A second copy here would be a second place to update. Do not add one.
