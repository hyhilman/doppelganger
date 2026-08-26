// J2.8 (TST-25, narrow) / J3.3 — every root dependency is confined to its one declared importer,
// and the workspace's bare package specifiers are all declared dependencies. Generalised from
// croner-only (J2.8) to an importer REGISTER (J3.3), the same shape test/writes.test.ts already
// uses, so a second dependency does not mean a second hardcoded assertion. The general
// per-workspace form of TST-25 arrives at N5; this is the narrow form the phase that creates a
// dependency ships.

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

/** A bare specifier's OWN package: `spec` itself when it names the package directly, or the part
 *  before the first `/` when it names a subpath export (`@ai-hero/sandcastle/sandboxes/no-sandbox`
 *  belongs to `@ai-hero/sandcastle`, same install, same lockfile entry, same importer register
 *  row). Scoped (`@scope/name/sub...`) and unscoped (`name/sub...`) packages both work: a scoped
 *  package name is always its first two `/`-separated segments. */
function packageOf(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
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

/** Every root dependency's one declared importer, plus why it is the only one — the same shape
 *  test/writes.test.ts's REGISTER uses. A new root dependency signs a row here in the SAME commit
 *  that adds it (J2.8's own precedent, generalised at J3.3). */
const IMPORTERS: Record<string, { readonly importer: string; readonly why: string }> = {
  croner: { importer: "host/cron.ts", why: "the only cron seam (SUP-07, J2.8)" },
  "@ai-hero/sandcastle": {
    importer: "host/runner.ts",
    why: "the only agent-runner seam; M11 (D3) replaces this file, every job file unchanged (D2)",
  },
};

test("1. every declared root dependency is imported by exactly its one registered importer, across all four spellings and any subpath export", () => {
  const files = allTsFiles(["kernel", "host", "cli", "plugins", "test"]);
  for (const [dep, row] of Object.entries(IMPORTERS)) {
    const importers = files
      .filter((f) => specifiersIn(readFileSync(f, "utf8")).some((s) => packageOf(s) === dep))
      .map((f) => f.slice(ROOT.length + 1))
      .sort();
    assert.deepEqual(
      importers,
      [row.importer],
      `${dep} importers drifted.\n  found: ${importers.join(", ")}\n  expected: ${row.importer}`,
    );
  }
});

test("2. every bare package specifier under kernel/, host/, cli/, plugins/ (non-test) is a declared root dependency named in IMPORTERS", () => {
  const files = allTsFiles(["kernel", "host", "cli", "plugins"]).filter((f) => !f.endsWith(".test.ts"));
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const declared = new Set(Object.keys(pkg.dependencies ?? {}));
  assert.deepEqual(
    declared,
    new Set(Object.keys(IMPORTERS)),
    "package.json dependencies and this file's IMPORTERS register must name the same set",
  );

  const bareByFile = new Map<string, string[]>();
  for (const f of files) {
    const specs = specifiersIn(readFileSync(f, "utf8")).filter(isBareSpecifier);
    if (specs.length > 0) bareByFile.set(f.slice(ROOT.length + 1), specs);
  }

  const foundPackages = new Set<string>();
  for (const specs of bareByFile.values()) for (const s of specs) foundPackages.add(packageOf(s));
  assert.deepEqual(
    [...foundPackages].sort(),
    Object.keys(IMPORTERS).sort(),
    `bare specifiers' packages under kernel/, host/, cli/, plugins/ drifted.\n  found: ${[...foundPackages].sort().join(", ")}\n  expected: ${Object.keys(IMPORTERS).sort().join(", ")}`,
  );

  for (const [file, specs] of bareByFile) {
    for (const spec of specs) {
      assert.ok(declared.has(packageOf(spec)), `${file} imports ${JSON.stringify(spec)}, not in package.json dependencies`);
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

test("4. node_modules/croner has no non-empty dependencies of its own, and sandcastle's shape is what N3 measured", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "node_modules/croner/package.json"), "utf8"));
  const deps = pkg.dependencies ?? {};
  assert.deepEqual(
    Object.keys(deps),
    [],
    `croner gained a dependency (${JSON.stringify(deps)}) — decide, then update the pin`,
  );

  const sc = JSON.parse(readFileSync(join(ROOT, "node_modules/@ai-hero/sandcastle/package.json"), "utf8"));
  assert.deepEqual(
    Object.keys(sc.dependencies ?? {}),
    ["@clack/prompts"],
    `@ai-hero/sandcastle's own dependency set drifted: ${JSON.stringify(sc.dependencies)}`,
  );
  for (const peer of ["@daytona/sdk", "@vercel/sandbox"]) {
    assert.equal(
      sc.peerDependenciesMeta?.[peer]?.optional,
      true,
      `@ai-hero/sandcastle's peer ${peer} must be optional (npm install/ci/ls --all must exit 0 with neither installed)`,
    );
  }

  const repoPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const repoFloor: string = repoPkg.engines.node;
  const clackCore = JSON.parse(readFileSync(join(ROOT, "node_modules/@clack/core/package.json"), "utf8"));
  const clackFloorRaw: string = clackCore.engines.node; // ">= 20.12.0"
  const clackFloor = clackFloorRaw.replace(/^>=\s*/, "");
  assert.ok(
    repoFloor.startsWith(">="),
    `this repo's engines.node must be a >= floor to compare against sandcastle's transitive floor, got ${repoFloor}`,
  );
  const repoFloorNum = repoFloor.replace(/^>=\s*/, "").split(".").map(Number);
  const clackFloorNum = clackFloor.split(".").map(Number);
  const below = (a: number[], b: number[]): boolean => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      if (x !== y) return x <= y;
    }
    return true;
  };
  assert.ok(
    below(clackFloorNum, repoFloorNum),
    `sandcastle's transitive Node floor (${clackFloorRaw}, via @clack/core) must be at or below this repo's own floor (${repoFloor}) — otherwise the new dependency raises this repo's Node floor, an N0 decision reopened`,
  );
});

test("5. package.json's dependency versions are exact and match what package-lock.json resolved, for every declared dependency", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  for (const dep of Object.keys(IMPORTERS)) {
    const declared: string = pkg.dependencies[dep];
    assert.ok(declared, `package.json must declare a ${dep} dependency`);
    assert.doesNotMatch(declared, /[\^~*<>]/, `${dep} version ${JSON.stringify(declared)} must have no range character`);
    const resolved: string = lock.packages[`node_modules/${dep}`].version;
    assert.equal(declared, resolved, `package.json ${dep} (${declared}) must equal package-lock.json's resolved version (${resolved})`);
  }
});
