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
import { dirname, join, resolve, posix } from "node:path";
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

// ---------------------------------------------------------------------------------------------
// TST-03 — assertNoDeepImports: the layering law (D1) as a rule, not a convention.
//
// FOUR RULES. `deepImportViolation` is PURE — no filesystem read, no dynamic import — so it is
// table-tested exhaustively against synthetic repo-relative paths with no dependency on this
// tree's actual contents. It returns a MESSAGE naming the rule broken and both sides (the
// importer and what it resolves to), never a bare boolean: a rule that fires with the wrong
// explanation is a rule someone will delete.
//
//   1. a file under kernel/      may name only kernel/                  (D1 — no plugin, no app, ever)
//   2. a file under plugins/<a>/ may not name plugins/<b>/               (a plugin never touches another's internals)
//   3. a file under plugins/     may name kernel/ports/* or kernel/plugin.ts, and nothing else under kernel/
//   4. a file under plugins/     may not name host/ or cli/
//
// RULE 1 IS WIDER THAN THE ONE SENTENCE CLAUDE.md SPELLS OUT, on purpose. That sentence is
// "kernel/ — the framework — imports no plugin, EVER". Rule 1 also refuses `kernel/ -> host/` and
// `kernel/ -> cli/`, because the same D1 diagram puts `host/` BELOW the framework ("host/ … — the
// app") and the app is the thing that imports the framework. A framework that names its app is the
// dependency pointing the wrong way, whether or not the app happens to be a plugin.
//
// WHY `tsc` CANNOT STAND IN FOR RULE 1, measured on 2026-09-01 rather than assumed. `kernel/runtime/
// proc.ts` was given a real `import { RESOURCE_NAMES } from "../../host/config.ts";` and a real
// consuming expression (`export const … = RESOURCE_NAMES.length;`, so `noUnusedLocals` could not
// kill it). `npm run typecheck` — `tsc --noEmit -p tsconfig.json` — exited **0**. The import is
// legal TypeScript: `host/` is inside the same `tsconfig`, the symbol exists, the types line up.
// Only the run below went red. So this rule is the ONLY thing between this repo and a broken
// layering law; nothing else in `pretest` or the suite has an opinion about import DIRECTION.
//
// RULE 3'S ALLOWLIST IS A DECISION, and it lives here rather than in a comment somewhere else.
//
// FIRST, WHY `kernel/plugin.ts` IS ON IT AT ALL, since CLAUDE.md says a plugin "never imports past
// `kernel/ports/`" and `plugin.ts` sits one level above `ports/`. That sentence caps how far into
// the framework's INSIDES a plugin may reach. `kernel/plugin.ts` is not an inside: it holds the
// `Plugin` manifest and `definePlugin` (KRN-04/05), the very shape a plugin exists to fill in. A
// plugin that may not name it cannot declare itself, so the allowlist would forbid the only file
// every plugin must import. `ports/` plus the manifest IS the seam; everything else under
// `kernel/` is the implementation behind it.
//
// SECOND, WHY `kernel/config.ts` IS NOT ON IT. A
// manifest's `env` member is `EnvSpec[]` (KRN-04); the `EnvSpec` type itself is defined in
// `kernel/config.ts` — one file PAST `kernel/ports/`. Widening the allowlist to `kernel/config.ts`
// so a plugin could reach that type directly was considered and rejected: `config.ts` also holds
// `parentEnv()` and is the one file in this repo that names `process.env` directly — handing a
// plugin that file hands it more than a type. The chosen fix instead: `kernel/plugin.ts`
// RE-EXPORTS the `EnvSpec` type, so the allowlist stays `kernel/ports/*` + `kernel/plugin.ts` and
// never has to grow to `config.ts`. The allowlist below named the file BEFORE it existed, because
// the decision belongs with the rule that enforces it. `kernel/plugin.ts` exists as of J8 and
// carries that re-export, and it is a TYPE-ONLY one (`export type { EnvSpec }`): the file's
// runtime exports are `definePlugin`, `killSwitch` and `isKilled` and nothing else, so a plugin
// naming it still cannot reach `parentEnv()` or any other reader of `process.env`.
//
// THE TRAP THAT WOULD SINK A TEXT-BASED GATE, measured here rather than taken on faith from the
// plan: `grep -rlE "host/|plugins/" kernel --include="*.ts"` hits exactly 14 files, ALL of them
// comments and prose (module-header explanations of the layering law itself, mostly) — measured
// on 2026-09-01, this count is a fact about this tree today and could move as the tree does:
//   kernel/config.ts                     kernel/runtime/payload.ts
//   kernel/ports/job.test.ts             kernel/runtime/quota.ts
//   kernel/ports/job.ts                  kernel/runtime/runjob.test.ts
//   kernel/ports/runner.ts               kernel/runtime/runjob.ts
//   kernel/runtime/delivery.ts           kernel/runtime/shed.ts
//   kernel/runtime/gate.test.ts          kernel/runtime/worktree.test.ts
//   kernel/runtime/lease.ts              kernel/runtime/worktree.ts
// A grep-based gate goes red on every one of these on day one. That is exactly why this rule runs
// over `ts.preProcessFile`'s SPECIFIERS — the same tool TST-05 already uses above in this file —
// and never over raw file text: a specifier is a thing the parser recognises as an import: a
// comment or a doc-string mentioning `host/` is not, and preProcessFile never sees it as one.
//
// WHICH RULES HAVE A SUBJECT TONIGHT, stated rather than implied by a passing count: `plugins/`
// holds exactly `plugins/nightly/package.json` and `plugins/nightly/skills/nightly-sandcastle/SKILL.md`
// (confirmed by listing the directory for this commit, not taken from the plan) — no `.ts` file
// exists anywhere under `plugins/` yet. Rules 2, 3 and 4 therefore have NO subject in the
// repo-wide run below: they ship table-tested, in the exhaustive synthetic table above, and
// UN-EXERCISED on real code. Rule 1 does have a subject — every file under `kernel/` exists
// today, so the repo-wide run is a real gate for rule 1 and a shipped-but-idle gate for 2-4. An
// untrue claim of coverage is worse than a stated gap.
//
// A TABLE IS ONLY AS GOOD AS ITS ROWS, so this function was attacked directly on 2026-09-01 with
// 32 hand-built inputs — trailing slashes, bare directory names, `..` climbs out of a plugin and
// back into it, redundant `./` and `../` segments, sibling directories whose names merely start
// with `kernel`/`plugins`/`host`, and paths that climb above the repo root. Three real wrong
// answers came out, all fixed below, all now rows in the table:
//   - A DIRECTORY SPECIFIER GOT TWO DIFFERENT VERDICTS depending on a trailing slash.
//     `../../kernel/ports/` was allowed (it matched the `kernel/ports/` prefix); `../../kernel/ports`
//     — the same place — was REFUSED by rule 3, which then accused a plugin of reaching past
//     `ports/` while it was naming `ports/` itself. The mirror image bit rule 2 and rule 4 the
//     other way: `plugins/a/x.ts` importing `../b` (another plugin's directory, no slash) and
//     `../../cli` were both ALLOWED — real violations waved through. And `..` from
//     `kernel/runtime/` resolved to the bare string `kernel`, which rule 1 reported as
//     "resolves to kernel — outside kernel/". The fix is one line: strip the trailing slash after
//     normalising, then compare with `under()`, which tests the directory ITSELF or anything
//     below it. `under()` also keeps a sibling named `kernelx/` or `pluginsx/` out — a plain
//     `startsWith("kernel")` would have swallowed it.
//   - RULES 3 AND 4 SKIPPED A FILE SITTING DIRECTLY AT `plugins/x.ts`. Both rules are written "a
//     file under `plugins/`", but both used to hang off the `plugins/<name>/` match that rule 2
//     needs, so a stray `plugins/x.ts` could import `host/config.ts` or `kernel/runtime/db.ts`
//     freely. That file should not exist — a plugin owns a directory — but "should not exist" is
//     not a gate. Rules 3 and 4 now apply to anything under `plugins/`; rule 2 still needs an
//     owning plugin, because with no owner there is no "other" plugin to compare against.
// One case is left OPEN ON PURPOSE: a specifier that climbs ABOVE the repo root (`plugins/a/x.ts`
// importing `../../../outside.ts`, which normalises to `../outside.ts`) is allowed by all four
// rules, because none of them has a clause about the world outside this checkout. It is not a hole:
// TST-05 above resolves that same specifier against disk and goes red when it names nothing. From
// `kernel/` it is refused anyway — rule 1 allows only `kernel/`, so anything above the root is out.

export function deepImportViolation(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // bare (npm) specifiers are not this rule's subject

  // Normalise, then drop the trailing slash: `kernel/ports` and `kernel/ports/` name one place and
  // must get one verdict.
  const target = posix.normalize(posix.join(posix.dirname(fromFile), spec)).replace(/\/+$/, "");

  // "under dir" is the directory itself or anything below it — never a sibling that merely starts
  // with the same letters (`kernelx/`, `pluginsx/`, `hostx/`).
  const under = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);

  if (under(fromFile, "kernel")) {
    if (!under(target, "kernel")) {
      return (
        `rule 1 (a file under kernel/ may name only kernel/, D1): ${fromFile} imports ` +
        `${JSON.stringify(spec)}, which resolves to ${target} — outside kernel/`
      );
    }
    return null;
  }

  // Outside kernel/ and plugins/, none of the four rules has a subject: they constrain the
  // FRAMEWORK and the PLUGINS, never the app that hosts them.
  if (!under(fromFile, "plugins")) return null;

  // Rule 2 alone needs an OWNING plugin to compare against, so it has a subject only for a file
  // that lives inside a plugin directory. Rules 3 and 4 read "a file under plugins/" and apply to
  // a stray plugins/x.ts too.
  const ownPlugin = fromFile.match(/^plugins\/([^/]+)\//);
  const otherPlugin = target.match(/^plugins\/([^/]+)(?:\/|$)/);
  if (ownPlugin && otherPlugin && otherPlugin[1] !== ownPlugin[1]) {
    return (
      `rule 2 (a file under plugins/${ownPlugin[1]}/ may not name plugins/${otherPlugin[1]}/): ` +
      `${fromFile} imports ${JSON.stringify(spec)}, which resolves to ${target}`
    );
  }

  if (under(target, "kernel")) {
    const allowed = under(target, "kernel/ports") || target === "kernel/plugin.ts";
    if (!allowed) {
      return (
        `rule 3 (a file under plugins/ may name only kernel/ports/* or kernel/plugin.ts): ` +
        `${fromFile} imports ${JSON.stringify(spec)}, which resolves to ${target}`
      );
    }
    return null;
  }

  if (under(target, "host") || under(target, "cli")) {
    return (
      `rule 4 (a file under plugins/ may not name host/ or cli/): ${fromFile} imports ` +
      `${JSON.stringify(spec)}, which resolves to ${target}`
    );
  }

  return null;
}

test("deepImportViolation table: all four rules, both polarities (TST-03)", () => {
  const rows: ReadonlyArray<{
    readonly desc: string;
    readonly from: string;
    readonly spec: string;
    readonly rule: 1 | 2 | 3 | 4 | null;
  }> = [
    // Rule 1 — kernel/ may name only kernel/
    {
      desc: "kernel -> host, violates rule 1 (this is AC3's own real-tree mutation, mirrored here)",
      from: "kernel/runtime/proc.ts",
      spec: "../../host/config.ts",
      rule: 1,
    },
    {
      desc: "kernel -> plugins, violates rule 1",
      from: "kernel/paths.ts",
      spec: "../plugins/nightly/skills/nightly-sandcastle.ts",
      rule: 1,
    },
    {
      desc: "kernel -> a kernel sibling, permitted",
      from: "kernel/runtime/proc.ts",
      spec: "./gate.ts",
      rule: null,
    },
    {
      desc: "kernel -> kernel/ports, permitted (rule 1 does not special-case ports — it allows all of kernel/)",
      from: "kernel/runtime/proc.ts",
      spec: "../ports/job.ts",
      rule: null,
    },

    // Rule 2 — a plugin may not name another plugin's internals
    {
      desc: "plugin -> a different plugin, violates rule 2",
      from: "plugins/nightly/a.ts",
      spec: "../ops/b.ts",
      rule: 2,
    },
    {
      desc: "plugin -> its own sibling, permitted",
      from: "plugins/nightly/a.ts",
      spec: "./b.ts",
      rule: null,
    },

    // Rule 3 — a plugin may name kernel/ports/* or kernel/plugin.ts, nothing else under kernel/
    {
      desc: "plugin -> kernel/runtime, violates rule 3 (the plan's own example)",
      from: "plugins/x/a.ts",
      spec: "../../kernel/runtime/db.ts",
      rule: 3,
    },
    {
      desc: "plugin -> kernel/config.ts, violates rule 3 (the plan's own example — this is the EnvSpec trap)",
      from: "plugins/x/a.ts",
      spec: "../../kernel/config.ts",
      rule: 3,
    },
    {
      desc: "plugin -> kernel/ports/job.ts, permitted (the plan's own example)",
      from: "plugins/x/a.ts",
      spec: "../../kernel/ports/job.ts",
      rule: null,
    },
    {
      desc: "plugin -> kernel/plugin.ts, permitted (the plan's own example)",
      from: "plugins/x/a.ts",
      spec: "../../kernel/plugin.ts",
      rule: null,
    },
    {
      desc: "plugin -> another file under kernel/ports/, permitted",
      from: "plugins/x/a.ts",
      spec: "../../kernel/ports/runner.ts",
      rule: null,
    },

    // Rule 4 — a plugin may not name host/ or cli/
    {
      desc: "plugin -> host, violates rule 4",
      from: "plugins/x/a.ts",
      spec: "../../host/config.ts",
      rule: 4,
    },
    {
      desc: "plugin -> cli, violates rule 4",
      from: "plugins/x/a.ts",
      spec: "../../cli/skills.ts",
      rule: 4,
    },
    {
      desc: "plugin -> its own sibling, permitted (not host/ or cli/)",
      from: "plugins/x/a.ts",
      spec: "./sibling.ts",
      rule: null,
    },

    // Outside kernel/ and plugins/ — none of the four rules has a subject: they constrain the
    // FRAMEWORK and the PLUGINS, never the app that hosts them.
    {
      desc: "host -> kernel, no rule applies to a host importer",
      from: "host/schedule.ts",
      spec: "../kernel/config.ts",
      rule: null,
    },

    // The rows below are the answers this function used to get WRONG. Each one was found by
    // attacking the function directly, not by reading it; the header records the three bugs.
    {
      desc: "plugin -> kernel/ports/ WITH a trailing slash, permitted",
      from: "plugins/a/x.ts",
      spec: "../../kernel/ports/",
      rule: null,
    },
    {
      desc: "plugin -> kernel/ports with NO trailing slash, permitted — the same place, so the same verdict",
      from: "plugins/a/x.ts",
      spec: "../../kernel/ports",
      rule: null,
    },
    {
      desc: "kernel -> the kernel/ directory itself, permitted (`..` used to read as 'outside kernel/')",
      from: "kernel/runtime/proc.ts",
      spec: "..",
      rule: null,
    },
    {
      desc: "plugin -> another plugin's DIRECTORY, no trailing slash, still violates rule 2",
      from: "plugins/a/x.ts",
      spec: "../b",
      rule: 2,
    },
    {
      desc: "plugin -> the cli/ directory, no trailing slash, still violates rule 4",
      from: "plugins/a/x.ts",
      spec: "../../cli",
      rule: 4,
    },
    {
      desc: "a stray file directly at plugins/x.ts -> host, violates rule 4 (rule 4 is 'a file under plugins/', not 'a file inside a plugin')",
      from: "plugins/x.ts",
      spec: "../host/config.ts",
      rule: 4,
    },
    {
      desc: "a stray file directly at plugins/x.ts -> kernel/runtime, violates rule 3",
      from: "plugins/x.ts",
      spec: "../kernel/runtime/db.ts",
      rule: 3,
    },
    {
      desc: "plugin -> out of its own directory and back in, permitted (same plugin, spelled the long way)",
      from: "plugins/a/x.ts",
      spec: "../../plugins/a/y.ts",
      rule: null,
    },
    {
      desc: "a deeply nested plugin file -> kernel/plugin.ts, permitted",
      from: "plugins/a/deep/nested/x.ts",
      spec: "../../../../kernel/plugin.ts",
      rule: null,
    },
    {
      desc: "plugin -> kernel/runtime spelled through kernel/ports, violates rule 3 (the rule reads the resolved path, not the spelling)",
      from: "plugins/a/sub/x.ts",
      spec: "../../../kernel/ports/../runtime/db.ts",
      rule: 3,
    },
    {
      desc: "kernel -> a sibling whose name merely starts with 'kernel', violates rule 1",
      from: "kernel/paths.ts",
      spec: "../kernelx/y.ts",
      rule: 1,
    },
    {
      desc: "plugin -> a sibling whose name merely starts with 'plugins', permitted (not another plugin, not kernel/host/cli)",
      from: "plugins/a/x.ts",
      spec: "../../pluginsx/y.ts",
      rule: null,
    },
  ];

  assert.ok(rows.length >= 12, `table must have at least 12 rows, has ${rows.length}`);
  const rulesSeen = new Set(rows.map((r) => r.rule));
  for (const rule of [1, 2, 3, 4, null] as const) {
    assert.ok(rulesSeen.has(rule), `table must cover rule ${rule === null ? "null (permitted)" : rule}`);
  }

  for (const { desc, from, spec, rule } of rows) {
    const msg = deepImportViolation(from, spec);
    if (rule === null) {
      assert.equal(msg, null, `${desc}: expected no violation, got ${JSON.stringify(msg)}`);
    } else {
      assert.ok(msg !== null, `${desc}: expected rule ${rule} to fire, got null`);
      assert.ok(msg.includes(`rule ${rule}`), `${desc}: message does not name rule ${rule}: ${msg}`);
      assert.ok(msg.includes(from), `${desc}: message does not name the importer ${from}: ${msg}`);
      assert.ok(
        msg.includes(JSON.stringify(spec)),
        `${desc}: message does not name the specifier ${JSON.stringify(spec)}: ${msg}`,
      );
    }
  }
});

test("deepImportViolation over the real tree: the layering law holds today (TST-03) — reuses the walk() above; rule 1 has a subject, rules 2-4 do not (plugins/ holds only package.json and SKILL.md)", () => {
  const files: string[] = [];
  walk(ROOT, files);

  const offenders: string[] = [];
  for (const file of files) {
    const fromFile = file.slice(ROOT.length + 1);
    const src = readFileSync(file, "utf8");
    const info = ts.preProcessFile(src, true, true);
    for (const imported of info.importedFiles) {
      if (!imported.fileName.startsWith(".")) continue;
      const violation = deepImportViolation(fromFile, imported.fileName);
      if (violation) offenders.push(violation);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} deep-import violation(s) of the layering law (D1):\n  ${offenders.join("\n  ")}`,
  );
});
