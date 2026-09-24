// TST-04 — which directories carry a barrel, and which are imported by path.
//
// A barrel is a file made only of re-exports (`export … from "…"`). Three rules:
//   1. Every barrel is an index.ts in a directory on BARRELS below, and every BARRELS row has one.
//      An index.ts that holds real code (host/jobs/index.ts, the job registry) is not a barrel and
//      needs no row.
//   2. Every relative import names a file, never a directory. Node's ESM loader refuses a directory
//      import, so there is no hidden index.ts lookup to lean on.
//   3. No file imports a barrel. Every directory, barrel or not, is imported by the path of the one
//      file the importer needs.
//
// Rule 3 is the rule this tree follows, not the first one tried. "A directory with a barrel is
// imported only through its barrel" does not hold: code outside kernel/runtime/log/ imports that
// directory's files by path, and nothing imports the log barrel. The reason is real. A barrel loads
// every file it names, and the log barrel loads node:sqlite through tail.ts, so a file that only
// logs would pay for a database it never opens.
//
// Specifiers come from ts.preProcessFile, as in test/imports.test.ts: it reads code, never comments
// or string text. So a child process that loads a barrel from a string (kernel/runtime/log/
// warning.test.ts) is not an import here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** Every directory allowed to carry an index.ts barrel, and why it has one. */
const BARRELS: Readonly<Record<string, string>> = {
  "kernel/runtime/log": "the one surface a package consumer will take as `log` (ADO-03)",
};

/** Every .ts file in the checkout, repo-relative. Skips .git, every node_modules, and the worktrees
 *  other checkouts keep under .doppelganger/ and .claude/. Never follows a symlink. */
function walk(rel = "", out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || path === ".git") continue;
      if (path === ".doppelganger/worktrees" || path === ".claude/worktrees") continue;
      walk(path, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** True when `src` holds at least one statement and every statement is `export … from "…"`. */
function isBarrel(src: string): boolean {
  const file = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest);
  return (
    file.statements.length > 0 &&
    file.statements.every((s) => ts.isExportDeclaration(s) && s.moduleSpecifier !== undefined)
  );
}

const FILES = walk();
const BARREL_FILES = FILES.filter((f) => !f.endsWith(".test.ts") && isBarrel(readFileSync(join(ROOT, f), "utf8")));

/** Every relative (file, specifier, resolved target) triple in the tree. */
function relativeImports(): { readonly path: string; readonly spec: string; readonly target: string }[] {
  return FILES.flatMap((path) =>
    ts.preProcessFile(readFileSync(join(ROOT, path), "utf8"), true, true)
      .importedFiles.map((i) => i.fileName)
      .filter((spec) => spec.startsWith("."))
      .map((spec) => ({ path, spec, target: posix.normalize(posix.join(posix.dirname(path), spec)) })),
  );
}

test("isBarrel tells a barrel from a module (TST-04)", () => {
  assert.equal(isBarrel(`export * from "./a.ts";\nexport { b } from "./b.ts";\n`), true);
  assert.equal(isBarrel(`// a comment only counts as nothing\nexport type { C } from "./c.ts";\n`), true);
  assert.equal(isBarrel(`export * from "./a.ts";\nexport const x = 1;\n`), false, "a barrel holds no code");
  assert.equal(isBarrel(`import { a } from "./a.ts";\nexport { a };\n`), false, "a re-export without `from` is code");
  assert.equal(isBarrel(``), false, "an empty file is not a barrel");
});

test("rule 1: every barrel is an index.ts in a BARRELS directory, and every BARRELS directory has one (TST-04)", () => {
  const found = BARREL_FILES.map((f) => (posix.basename(f) === "index.ts" ? posix.dirname(f) : f)).sort();
  assert.deepEqual(
    found,
    Object.keys(BARRELS).sort(),
    `the barrels on disk and BARRELS disagree.\n  on disk: ${found.join(", ")}\n  BARRELS: ${Object.keys(BARRELS).sort().join(", ")}\n` +
      "a barrel must be an index.ts, and its directory needs a BARRELS row with a reason",
  );
});

test("rule 2: every relative import names a file, never a directory (TST-04)", () => {
  const imports = relativeImports();
  assert.ok(imports.length > 0, "found no relative import at all — the walk or the parser broke");
  const offenders = imports
    .filter(({ target }) => {
      try {
        return statSync(join(ROOT, target)).isDirectory();
      } catch {
        return false; // a missing target is TST-05's finding, not this rule's
      }
    })
    .map(({ path, spec }) => `${path} imports the directory ${JSON.stringify(spec)}`);
  assert.deepEqual(offenders, [], `name the file, not the directory:\n  ${offenders.join("\n  ")}`);
});

test("rule 3: no file imports a barrel — every directory is imported by file path (TST-04)", () => {
  const barrels = new Set(BARREL_FILES);
  const offenders = relativeImports()
    .filter(({ target }) => barrels.has(target))
    .map(({ path, spec }) => `${path} imports the barrel ${JSON.stringify(spec)}`);
  assert.deepEqual(offenders, [], `import the file you need, not the barrel:\n  ${offenders.join("\n  ")}`);
});
