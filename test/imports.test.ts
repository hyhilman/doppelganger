// TST-05 — every relative module specifier in every .ts file resolves to a file that exists.
//
// WHY THIS IS NOT `tsc --noEmit` A SECOND TIME. Settled by experiment on 2026-09-01, not by
// argument, because a gate that only re-checks what `pretest` already checked is decoration.
// Most dangling specifiers DO fail typecheck first, with TS2307, before this file ever runs —
// measured, all three: a bound `import ... from "./gone.ts"`, an `export ... from "./gone.ts"`,
// and a dynamic `import("./gone.ts")` behind a runtime flag. One shape is not:
//
//     import "./gone.ts";        // side-effect import — no import clause
//
// `tsc --noEmit -p tsconfig.json` exits 0 on that line. Node does not: the process dies at load
// with ERR_MODULE_NOT_FOUND. Measured by appending exactly that line to host/window.ts —
// typecheck exit 0, THIS test red, and `import("./host/window.ts")` throwing. That one shape is
// the whole reason this gate exists, and it is the RED mutation to re-run if you doubt it.
//
// It is not a hypothetical shape here. KRN-01 registries register at import time, so a file
// pulled in only for its side effect is the expected spelling in this repo — and it is exactly
// the spelling typecheck does not see.
//
// TOOL CHOICE, paid for here rather than assumed: this file imports the `typescript` package
// and calls `ts.preProcessFile(src, true, true)`, which parses the source and lists every
// `import`/`export ... from`/`require`/dynamic `import()` specifier without a full type-check.
// Three claims about that choice, each verified against this repo's own source on 2026-09-01
// rather than taken on faith:
//   1. `typescript` is a devDependency (package.json `devDependencies`), not a `dependency` —
//      confirmed by reading package.json directly.
//   2. It is already on the run path: `pretest` is `npm run typecheck`, which is `tsc --noEmit
//      -p tsconfig.json` — the same package, already paid for on every `npm test`.
//   3. It is invisible to the two existing dependency gates, both read to confirm this, not
//      assumed: `test/deps.test.ts` test 1 only walks the `IMPORTERS` register (`croner`,
//      `@ai-hero/sandcastle`) and never looks at `typescript`; its test 2 reads
//      `pkg.dependencies`, never `pkg.devDependencies`, so a `typescript` import would not even
//      be seen by the check that enforces "every bare specifier is a declared dependency" — and
//      this file lives under `test/`, which that test's file list does not walk at all.
//      `test/toolchain.test.ts`'s `DENYLIST` (linters, bundlers, test-framework shims) does not
//      contain the string `"typescript"` anywhere, confirmed by reading the list.
//
// THE REJECTED ALTERNATIVE, measured rather than described: a regex over raw source text (the
// same shape as `test/deps.test.ts`'s SPECIFIER_RE) cannot tell a real specifier from a
// specifier-shaped SUBSTRING — of a string literal, or of a COMMENT. Swapped into this file's
// walk and run over the whole tree on 2026-09-01, counting every file but this one, it reports 36
// false positives across 13 files:
//   - 11 files spawn a child process (a `node -e` argument, or execFileSync of process.execPath
//     with a template-literal `code` string) whose code contains a dynamic import of a real,
//     existing module — a scrubbed-env or fresh-module-cache probe, not an import of the file
//     doing the spawning — accounting for 33 of the 36 hits, 14 of them in test/knobs.test.ts alone;
//   - host/jobs/nightly-sandcastle.test.ts writes a deliberately BROKEN fixture — a source string
//     whose own import names a module that does not exist — to prove a broken import surfaces as
//     a load failure at run time: 1 hit, and the one P4 names by file;
//   - test/model.test.ts and test/writes.test.ts each carry a doc-comment describing this regex's
//     own from-clause shape, which the regex then matches against ITS OWN DESCRIPTION of itself:
//     2 hits neither P4 nor a plugin author would think to allowlist for.
// A 36-line allowlist is not a gate; it is thirty-six places drift can hide, most of them not
// even importer-related. preProcessFile reports zero of them, because none of them is a
// specifier the parser sees as an import.
//
// Counting this file too makes the point twice over. The header above quotes a specifier while
// explaining itself, so the regex climbs to 41 across 14 files and blames the very comment that
// argues against it. preProcessFile's own count does not move at all: it reads code, not prose.
//
// RISKS, noted rather than hidden.
//   - `preProcessFile` reports `import type` specifiers too — correct today (a type-only import of
//     a deleted file is still rot), but if this repo ever turns off `verbatimModuleSyntax` in a way
//     that changes how type-only imports are spelled, the set this walk sees could shift.
//   - This walk compares the specifier to disk LITERALLY. It would therefore call `"./x.js"` — the
//     standard TS spelling for a `.js` specifier that resolves to `x.ts` — dangling. Zero such
//     specifiers exist today (checked): `allowImportingTsExtensions` is on and the house style is
//     a real `.ts` extension. The day one is written, teach this walk the `.js` -> `.ts` mapping;
//     do not weaken the check.
//
// The walk itself copies the narrow skip the five existing repo-wide walkers already use
// (`test/deps.test.ts`, `test/toolchain.test.ts`, `test/no-raw-sqlite.test.ts`, among others):
// `node_modules` and `.git` at the repo root, and — separately — `.doppelganger/worktrees`
// specifically (R2), never `.doppelganger` wholesale, so a stray file elsewhere under
// `.doppelganger/` (a state DB, say) is still walked and still checked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (dir === ROOT && (entry === "node_modules" || entry === ".git")) continue;
    // R2 — a pass worktree under .doppelganger/worktrees/ is a second full
    // checkout (its own node_modules, package.json, *.ts files) and is not this repo's source.
    if (dir === join(ROOT, ".doppelganger") && entry === "worktrees") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
}

test("every relative module specifier in every .ts file resolves to a file that exists (TST-05)", () => {
  const files: string[] = [];
  walk(ROOT, files);

  let relativeSpecifierCount = 0;
  const offenders: string[] = [];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const info = ts.preProcessFile(src, true, true);
    for (const imported of info.importedFiles) {
      if (!imported.fileName.startsWith(".")) continue;
      relativeSpecifierCount++;
      const resolved = resolve(dirname(file), imported.fileName);
      if (!existsSync(resolved)) {
        offenders.push(
          `${file.slice(ROOT.length + 1)} imports ${JSON.stringify(imported.fileName)} -> ${resolved} (does not exist)`,
        );
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} dangling relative specifier(s), out of ${relativeSpecifierCount} relative ` +
      `specifiers across ${files.length} .ts files:\n  ${offenders.join("\n  ")}`,
  );
});
