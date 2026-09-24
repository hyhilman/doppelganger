// TST-25 — no phantom dependencies, checked per workspace.
//
// npm hoists every workspace's dependencies into one root node_modules. So a workspace can import a
// package it never declared, and the import works here. It fails for a consumer who installs that
// workspace alone. TST-05 checks relative specifiers only, so it cannot see this.
//
// Two rules:
//   a. Every bare package specifier resolves to a dependency declared by the package.json that owns
//      the file. A workspace owns the files under its own directory. The root package.json owns only
//      what no workspace owns (host/, test/) — it never counts for a workspace. Shipped code may use
//      dependencies, peerDependencies and optionalDependencies. A test or fixture file may also use
//      devDependencies, because it never ships.
//   b. No file names another workspace's dist/ or src/ by path, relative or through the package name.
//      A workspace is reached only through its published entry points (ADO-03).
//
// For an IN-TREE plugin, the relative import into kernel/ports is not a package specifier, so rule a
// does not see it. That door is TST-03's job (test/imports.test.ts), not this file's.
//
// Specifiers come from ts.preProcessFile, as in test/imports.test.ts: it reads code, never comments
// or string text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join, matchesGlob, posix } from "node:path";
import ts from "typescript";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** One package.json, reduced to what the two rules read. `dir` is "" for the root. */
interface Pkg {
  readonly dir: string;
  readonly name: string;
  readonly shipped: ReadonlySet<string>;
  readonly dev: ReadonlySet<string>;
}

function readPkg(dir: string): Pkg {
  const pkg = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"));
  const keys = (field: string): string[] => Object.keys(pkg[field] ?? {});
  return {
    dir,
    name: pkg.name,
    shipped: new Set([...keys("dependencies"), ...keys("peerDependencies"), ...keys("optionalDependencies")]),
    dev: new Set(keys("devDependencies")),
  };
}

/** Every file in the checkout, repo-relative. Skips .git, every node_modules, and the worktrees
 *  other checkouts keep under .doppelganger/ and .claude/. Never follows a symlink. */
function walk(rel = "", out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || path === ".git") continue;
      if (path === ".doppelganger/worktrees" || path === ".claude/worktrees") continue;
      walk(path, out);
    } else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** A bare specifier's own package: `@scope/name` or `name`, without any subpath. */
function packageOf(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function isBare(spec: string): boolean {
  return !spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("#") && !isBuiltin(spec);
}

/** Test code never ships, so it may use devDependencies. */
function isTestFile(path: string): boolean {
  return /\.(test|fixture|probe)\.ts$/.test(path) || /(^|\/)fixtures\//.test(path);
}

/** The package.json that owns `path`: the deepest workspace holding it, else the root. */
function ownerOf(path: string, root: Pkg, workspaces: readonly Pkg[]): Pkg {
  const holding = workspaces.filter((w) => path.startsWith(`${w.dir}/`));
  return holding.sort((a, b) => b.dir.length - a.dir.length)[0] ?? root;
}

/** Rule a. Null when `spec` is not a package specifier, or is declared where it must be. */
function phantom(path: string, spec: string, owner: Pkg): string | null {
  if (!isBare(spec)) return null;
  const name = packageOf(spec);
  if (name === owner.name) return null; // a package may name itself
  if (owner.shipped.has(name)) return null;
  if (isTestFile(path) && owner.dev.has(name)) return null;
  const where = owner.dir === "" ? "package.json" : `${owner.dir}/package.json`;
  const fields = isTestFile(path) ? "dependencies or devDependencies" : "dependencies or peerDependencies";
  return `rule a: ${path} imports ${JSON.stringify(spec)}, but ${where} declares no ${name} in its ${fields}`;
}

/** Rule b. Null unless `spec` names another workspace's dist/ or src/. */
function intoDistOrSrc(path: string, spec: string, owner: Pkg, workspaces: readonly Pkg[]): string | null {
  for (const w of workspaces) {
    if (w === owner) continue;
    let inside: string | null = null;
    if (spec.startsWith(".")) {
      const target = posix.normalize(posix.join(posix.dirname(path), spec));
      if (target.startsWith(`${w.dir}/`)) inside = target.slice(w.dir.length + 1);
    } else if (isBare(spec) && packageOf(spec) === w.name) {
      inside = spec.slice(w.name.length + 1);
    }
    const top = inside?.split("/")[0];
    if (top === "dist" || top === "src") {
      return `rule b: ${path} imports ${JSON.stringify(spec)}, which reaches into ${w.name}'s ${top}/ by path — use its published entry point`;
    }
  }
  return null;
}

const ROOT_PKG = readPkg("");
const FILES = walk();
const WORKSPACE_GLOBS: readonly string[] = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).workspaces;
const WORKSPACES: readonly Pkg[] = FILES.filter((f) => f.endsWith("/package.json"))
  .map((f) => posix.dirname(f))
  .filter((dir) => WORKSPACE_GLOBS.some((g) => matchesGlob(dir, g)))
  .map(readPkg);

/** Every (file, specifier) pair in the repo's .ts files. */
function specifiers(): { readonly path: string; readonly spec: string }[] {
  return FILES.filter((f) => f.endsWith(".ts")).flatMap((path) =>
    ts.preProcessFile(readFileSync(join(ROOT, path), "utf8"), true, true).importedFiles.map((i) => ({
      path,
      spec: i.fileName,
    })),
  );
}

test("the two rules, on synthetic packages (TST-25)", () => {
  const pkg = (dir: string, name: string, shipped: string[], dev: string[] = []): Pkg => ({
    dir,
    name,
    shipped: new Set(shipped),
    dev: new Set(dev),
  });
  const root = pkg("", "root", ["croner"], ["typescript"]);
  const kernel = pkg("kernel", "@d/kernel", []);
  const plugin = pkg("plugins/a", "@d/plugin-a", ["@d/kernel"], ["typescript"]);
  const all = [kernel, plugin];

  // rule a
  assert.equal(ownerOf("kernel/x.ts", root, all), kernel);
  assert.equal(ownerOf("host/x.ts", root, all), root);
  assert.match(phantom("kernel/x.ts", "croner", kernel) ?? "", /rule a/, "the root's croner must not count for kernel/");
  assert.equal(phantom("host/cron.ts", "croner", root), null);
  assert.equal(phantom("plugins/a/x.ts", "@d/kernel/ports", plugin), null, "a declared package, through a subpath");
  assert.match(phantom("plugins/a/x.ts", "typescript", plugin) ?? "", /rule a/, "shipped code may not use a devDependency");
  assert.equal(phantom("plugins/a/x.test.ts", "typescript", plugin), null, "a test may use a devDependency");
  assert.equal(phantom("kernel/x.ts", "@d/kernel/log", kernel), null, "a package may name itself");
  assert.equal(phantom("kernel/x.ts", "node:fs", kernel), null);
  assert.equal(phantom("kernel/x.ts", "fs", kernel), null);
  assert.equal(phantom("kernel/x.ts", "./y.ts", kernel), null);

  // rule b
  assert.match(intoDistOrSrc("plugins/a/x.ts", "../../kernel/dist/ports.js", plugin, all) ?? "", /rule b/);
  assert.match(intoDistOrSrc("plugins/a/x.ts", "../../kernel/src/ports.ts", plugin, all) ?? "", /rule b/);
  assert.match(intoDistOrSrc("plugins/a/x.ts", "@d/kernel/dist/ports.js", plugin, all) ?? "", /rule b/);
  assert.match(intoDistOrSrc("host/x.ts", "../plugins/a/src/y.ts", root, all) ?? "", /rule b/);
  assert.equal(intoDistOrSrc("plugins/a/x.ts", "../../kernel/ports/job.ts", plugin, all), null, "TST-03's door, not this rule's");
  assert.equal(intoDistOrSrc("plugins/a/x.ts", "./src/y.ts", plugin, all), null, "a workspace's own src/ is its own");
  assert.equal(intoDistOrSrc("plugins/a/x.ts", "@d/kernel/ports", plugin, all), null);
});

test("no phantom dependency and no dist/ or src/ door, over the real tree (TST-25)", () => {
  assert.ok(WORKSPACES.length > 0, "found no workspace — the workspaces globs matched no package.json");
  const pairs = specifiers();
  assert.ok(
    pairs.some((p) => isBare(p.spec)),
    "the scan found no bare package specifier at all — the walk or the parser broke",
  );

  const offenders: string[] = [];
  for (const { path, spec } of pairs) {
    const owner = ownerOf(path, ROOT_PKG, WORKSPACES);
    const a = phantom(path, spec, owner);
    const b = intoDistOrSrc(path, spec, owner, WORKSPACES);
    if (a) offenders.push(a);
    if (b) offenders.push(b);
  }
  assert.deepEqual(offenders, [], `${offenders.length} phantom import(s):\n  ${offenders.join("\n  ")}`);
});
