// J2.8 (TST-25, narrow) — croner's import is confined to one file, and the workspace's one bare
// package specifier is a declared dependency. The general per-workspace form of TST-25 arrives at
// N5; this is the narrow form the phase that creates the first dependency ships.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (dir === ROOT && (entry === "node_modules" || entry === ".git")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
}

/**
 * One shared regex for every clause in this file, covering four import spellings: `from "X"`,
 * `require("X")`, a dynamic `import("X")` (static or awaited), and the bare side-effect form
 * `import "X";` with no `from` clause at all — the spelling this repo's own gates have missed
 * three times before (LOOP.md's standing rule). What it cannot see: a specifier built by string
 * concatenation, or one held in a variable and passed to a dynamic `import()` — accepted, and
 * written down here rather than discovered later.
 */
const SPECIFIER_RE =
  /\bfrom\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g;

function specifiersIn(src: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  SPECIFIER_RE.lastIndex = 0;
  while ((m = SPECIFIER_RE.exec(src)) != null) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (spec) out.push(spec);
  }
  return out;
}

function isBareSpecifier(spec: string): boolean {
  return !spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("node:");
}

function allTsFiles(dirs: readonly string[]): string[] {
  const out: string[] = [];
  for (const d of dirs) {
    const abs = join(ROOT, d);
    try {
      walk(abs, out);
    } catch {
      // directory does not exist yet — tolerated, same as the repo-wide registers (J2.3)
    }
  }
  return out;
}

test("1. croner is imported by exactly host/cron.ts, across all four spellings", () => {
  const files = allTsFiles(["kernel", "host", "cli", "plugins", "test"]);
  const importers = files
    .filter((f) => specifiersIn(readFileSync(f, "utf8")).includes("croner"))
    .map((f) => f.slice(ROOT.length + 1))
    .sort();
  assert.deepEqual(
    importers,
    ["host/cron.ts"],
    `croner importers drifted.\n  found: ${importers.join(", ")}\n  expected: host/cron.ts`,
  );
});

test("2. every bare package specifier under kernel/, host/, cli/ (non-test) is a declared root dependency", () => {
  const files = allTsFiles(["kernel", "host", "cli"]).filter((f) => !f.endsWith(".test.ts"));
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const declared = new Set(Object.keys(pkg.dependencies ?? {}));

  const bareByFile = new Map<string, string[]>();
  for (const f of files) {
    const specs = specifiersIn(readFileSync(f, "utf8")).filter(isBareSpecifier);
    if (specs.length > 0) bareByFile.set(f.slice(ROOT.length + 1), specs);
  }

  const foundSpecs = new Set<string>();
  for (const specs of bareByFile.values()) for (const s of specs) foundSpecs.add(s);
  assert.deepEqual(
    [...foundSpecs].sort(),
    ["croner"],
    `bare specifiers under kernel/, host/, cli/ drifted.\n  found: ${[...foundSpecs].sort().join(", ")}\n  expected: croner`,
  );

  for (const [file, specs] of bareByFile) {
    for (const spec of specs) {
      assert.ok(declared.has(spec), `${file} imports ${JSON.stringify(spec)}, not in package.json dependencies`);
    }
  }
});

test("3. kernel/ names no bare package specifier at all — the published package stays dependency-free", () => {
  const files = allTsFiles(["kernel"]).filter((f) => !f.endsWith(".test.ts"));
  const offenders: string[] = [];
  for (const f of files) {
    const specs = specifiersIn(readFileSync(f, "utf8")).filter(isBareSpecifier);
    if (specs.length > 0) offenders.push(`${f.slice(ROOT.length + 1)}: ${specs.join(", ")}`);
  }
  assert.deepEqual(offenders, [], `kernel/ names a bare specifier: ${offenders.join("; ")}`);
});

test("4. node_modules/croner has no non-empty dependencies of its own", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "node_modules/croner/package.json"), "utf8"));
  const deps = pkg.dependencies ?? {};
  assert.deepEqual(
    Object.keys(deps),
    [],
    `croner gained a dependency (${JSON.stringify(deps)}) — decide, then update the pin`,
  );
});

test("5. package.json's croner version is exact, and matches what package-lock.json resolved", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const declared: string = pkg.dependencies.croner;
  assert.ok(declared, "package.json must declare a croner dependency");
  assert.doesNotMatch(declared, /[\^~*<>]/, `croner version ${JSON.stringify(declared)} must have no range character`);
  const resolved: string = lock.packages["node_modules/croner"].version;
  assert.equal(declared, resolved, `package.json croner (${declared}) must equal package-lock.json's resolved version (${resolved})`);
});
