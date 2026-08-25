# N0 — Ground truth · UAC breakdown

N0 is done when `npm test` runs green on a clean checkout and the repo can prove things about
itself. The proof is the point: the directory layout, the workspace list, the `pretest` wiring, the
absence of a linter or bundler, the Node floor, the rendered skill and the reference-corpus path are
all asserted by tests, not by prose. No engine code is written in N0 — the only new source files are
the repo's own drift gates.

Two open questions are closed here with written rulings, not with guesses: **§5 Q0** (render, no
symlinks — ruled by the user) and **§5 Q5** (measured on the target Node, see J0.8).

---

## Job order

1. **J0.1** — Repo layout + `.gitignore`. Nothing else can land until `node_modules` is ignored.
2. **J0.2** — Root `package.json`. Every later job reads or extends it.
3. **J0.3** — Workspace stubs + lockfile. Makes the `workspaces` list true on disk.
4. **J0.4** — `tsconfig.json`. `pretest` cannot run without it.
5. **J0.5** — Node floor: `.nvmrc`, `engines`, capability test. First test file; proves the suite runs.
6. **J0.6** — `test/layout.test.ts`. The §1 layout gate; needs a working suite (J0.4).
7. **J0.7** — `test/commands.test.ts` (TST-21). Pins `pretest` and the test globs.
8. **J0.8** — Settle §5 Q5 in the spec. J0.9's wording depends on the answer, so it comes first.
9. **J0.9** — `test/toolchain.test.ts` (TST-22). Implements the rule J0.8 just corrected.
10. **J0.10** — Settle §5 Q0 + SKL-10 ownership in the spec. J0.11's test cites this ruling.
11. **J0.11** — `test/skills-example.test.ts`. Gates the already-landed worked example.
12. **J0.12** — Corpus gate + refreshed counts (D15). Independent; can land any time after J0.6.
13. **J0.13** — CI workflow. Last, so it goes green on a finished suite.
14. **J0.14** — Close N0 in `WORK.md` and `LOOP.md`. Bookkeeping, after everything is green.

---

## J0.1 — Repo layout and `.gitignore`  ·  §1, ADO-14

**Goal:** create the directories §1 names that have a real file to hold, and stop `node_modules` and
scratch databases from entering git.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/.gitignore` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/` (new dir)
- `/home/hyhilman/projects/me/doppelganger/cli/` (new dir)
- `/home/hyhilman/projects/me/doppelganger/test/` (new dir)

**Do:**
1. Write `.gitignore` with exactly these lines and nothing else:
   ```
   node_modules/
   dist/
   *.db
   *.db-wal
   *.db-shm
   .env
   ```
2. Create `kernel/`, `cli/` and `test/`. Do **not** create `kernel/ports/`, `kernel/runtime/`,
   `kernel/contracts/`, `host/` or `fleet/` — they have no file to hold at N0 and a `.gitkeep`
   placeholder is a directory that lies about being used. N1/N2/N5 create them with real code.
3. Each new directory gets its real file in J0.3 (`package.json`) or J0.5 (the first test).

**Reading of "repo layout per §1" used here:** §1 is the *target* layout. N0 establishes it and
gates it; it does not pre-create empty directories for milestones that have not run. The gate in
J0.6 is written to allow that: a §1 directory is either absent or non-empty, never an empty
placeholder.

**Acceptance criteria:**
- [ ] AC1 — `git check-ignore -q node_modules` exits 0 from the repo root.
- [ ] AC2 — `test -d kernel && test -d cli && test -d test` exits 0.
- [ ] AC3 — `find . -not -path './.git/*' -name '.gitkeep' | wc -l` prints `0`.
- [ ] AC4 — `git status --porcelain` shows no `node_modules` entry after an `npm install`.

**Commit:** `Create the §1 repo layout and .gitignore (ADO-14)`

**Depends on:** nothing.

**Risks / what could be wrong:** `*.db` in `.gitignore` could later hide a fixture database a test
wants committed (TST-19 lifts fixtures from real data). If that happens, add a negated line rather
than dropping the rule.

---

## J0.2 — Root `package.json`  ·  ADO-14, TST-21, TST-22

**Goal:** one root manifest that declares the workspaces, the Node floor, and the three scripts N0
needs — with no linter, no bundler, and no test-runner dependency.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/package.json` (new)

**Do:**
1. Write it:
   ```json
   {
     "name": "doppelganger",
     "private": true,
     "version": "0.0.0",
     "type": "module",
     "workspaces": ["kernel", "plugins/*", "cli"],
     "engines": { "node": ">=22.18.0" },
     "scripts": {
       "typecheck": "tsc --noEmit -p tsconfig.json",
       "pretest": "npm run typecheck",
       "test": "node --test \"kernel/**/*.test.ts\" \"plugins/**/*.test.ts\" \"host/**/*.test.ts\" \"cli/**/*.test.ts\" \"test/**/*.test.ts\""
     },
     "devDependencies": {
       "typescript": "5.9.3",
       "@types/node": "26.1.1"
     }
   }
   ```
2. `workspaces` is ADO-14's list **verbatim**. Do not add `host/` — ADO-14 says host is deliberately
   not a workspace, and J0.9 asserts that.
3. `version` is `0.0.0` and is the ONE version ADO-01 talks about. Every workspace copies it.
4. Both dev dependencies are pinned EXACT (no `^`). A floating typechecker is a floating build.
   `typescript` and `@types/node` are the only two dependencies N0 adds. The reference uses `tsx`;
   this repo does not need it — `node --test` runs `.ts` directly on the target Node (measured, see
   J0.5), so `tsx` is a dependency with no job.

**What `pretest` is in this repo — the tension, resolved:**
CLAUDE.md and ADO-16 say `pretest` is `typecheck && build`. **At N0 it is `npm run typecheck` and
nothing else.** Two reasons, both mechanical:
- There is nothing to build. `kernel/` has no source, there is no `tsconfig.build.json`, and no
  workspace imports another. `&& npm run build` would be a script that compiles zero files.
- ADO-16's stated reason is false on the target Node. Measured on Node 22.23.1 (J0.8): a workspace
  link is a **symlink**, Node resolves it to its real path before deciding whether to strip types,
  and the real path is outside `node_modules` — so type stripping works and the dev loop needs no
  build. The consumer half of §5 Q5 is different and unchanged (a real install copies files under
  `node_modules` and fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so ADO-15's publish
  build stays. J0.8 writes that measurement into the spec.

**Acceptance criteria:**
- [ ] AC1 — `npm install` from the repo root exits 0.
- [ ] AC2 — `npm test` exits 0 (zero tests at this point is a pass; J0.5 adds the first).
- [ ] AC3 — `node -e "const p=require('./package.json'); console.assert(JSON.stringify(p.workspaces)===JSON.stringify(['kernel','plugins/*','cli']))"` exits 0.
- [ ] AC4 — `npm run typecheck` runs and its exit code is the exit code `npm test` reports when
  typecheck fails. Check by temporarily adding a type error to a `.ts` file and confirming
  `npm test` exits non-zero **before** any test output is printed.
- [ ] AC5 — the `scripts` object has no `build` key and no `lint` key.

**Commit:** `Add the root package.json with the ADO-14 workspace list (TST-21)`

**Depends on:** J0.1.

**Risks / what could be wrong:** `npm install` with `workspaces: ["kernel","plugins/*","cli"]` where
none of those directories has a `package.json` exits 0 and links nothing (measured). So AC1 passing
does **not** prove the workspaces exist — J0.3 and J0.6 are what prove that.

---

## J0.3 — Workspace stubs and the lockfile  ·  ADO-01, ADO-13, ADO-14

**Goal:** make every entry in the `workspaces` list resolve to a real package, so the list is a fact
rather than a promise.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/package.json` (new)
- `/home/hyhilman/projects/me/doppelganger/plugins/nightly/package.json` (new)
- `/home/hyhilman/projects/me/doppelganger/cli/package.json` (new)
- `/home/hyhilman/projects/me/doppelganger/package-lock.json` (new, generated)

**Do:**
1. Three stubs, each with the SAME `version` as the root (`0.0.0` — ADO-01), `"type": "module"`,
   and `"private": true` until N5 decides the publish surface:
   ```json
   { "name": "@doppelganger/kernel",         "version": "0.0.0", "private": true, "type": "module" }
   { "name": "@doppelganger/plugin-nightly", "version": "0.0.0", "private": true, "type": "module" }
   { "name": "@doppelganger/cli",            "version": "0.0.0", "private": true, "type": "module" }
   ```
2. No `main`, no `exports`, no `files` yet — ADO-03 decides the `exports` map and ADO-15 the `files`
   list, both at N5. Adding them now would be guessing at a shape no consumer has argued with.
3. Run `npm install` and commit `package-lock.json`.

**The `cli` tension, resolved:** ADO-14 lists `cli` as a workspace and §1's layout diagram does not
show a `cli/` directory. Measured: `npm install` exits 0 when a workspace glob matches nothing, so
nothing forces the issue — which is exactly why it would rot. **Create `cli/` as a real workspace.**
CLAUDE.md already names four operator CLIs that must live somewhere (`supervisor --list`,
`skills render|sync|check`, `lease-clear`, the crontab bootstrap block), and a declared-but-absent
workspace is a claim no test can check. J0.6 then asserts the list and the filesystem agree in both
directions.

**Acceptance criteria:**
- [ ] AC1 — `npm install` exits 0 and `ls node_modules/@doppelganger` prints exactly
  `cli`, `kernel`, `plugin-nightly`.
- [ ] AC2 — `npm ls --workspaces --depth=0` exits 0 and names three packages.
- [ ] AC3 — every workspace `package.json` has the same `version` string as the root
  `package.json`. Checked by `test/layout.test.ts` in J0.6.
- [ ] AC4 — `package-lock.json` is committed and `npm ci` from a clean clone exits 0.

**Commit:** `Add the three workspace package stubs at one version (ADO-01, ADO-13)`

**Depends on:** J0.2.

**Risks / what could be wrong:** `@doppelganger/cli` is a package name ADO-01 does not cover — it
names `@doppelganger/kernel` and `@doppelganger/plugin-*` only. Listed under *Gaps* below.

---

## J0.4 — `tsconfig.json`  ·  TST-21

**Goal:** one root tsconfig with `noEmit`, covering every workspace and `test/`, that refuses TypeScript
syntax Node cannot strip.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/tsconfig.json` (new)

**Do:**
1. Write it, following the reference (`/home/hyhilman/projects/xenith/engine/tsconfig.json`) with two
   deliberate differences named below:
   ```jsonc
   {
     "compilerOptions": {
       "target": "ES2022",
       "lib": ["ES2023"],
       "module": "nodenext",
       "moduleResolution": "nodenext",
       "strict": true,
       // An unused import in a job file is not tidiness — it is the shape of a phase that was
       // described, wired at the top of the file, and never called. Carried from the reference.
       "noUnusedLocals": true,
       "allowImportingTsExtensions": true,
       "verbatimModuleSyntax": true,
       // Node strips types; it does not execute enums, namespaces or parameter properties.
       // tsc refuses them here so the failure is at typecheck, not at 3am (TST-21).
       "erasableSyntaxOnly": true,
       "noEmit": true,
       "skipLibCheck": true,
       "types": ["node"]
     },
     "include": ["kernel/**/*.ts", "plugins/**/*.ts", "host/**/*.ts", "cli/**/*.ts", "test/**/*.ts"]
   }
   ```
2. **Difference 1 from the reference — no `exclude`.** The reference excludes `**/*.test.ts` from
   typecheck with a backlog note (`tracker #645`, 66 loosely-typed fixtures). Do not copy the debt.
   TST-21 says *tests remain the type check for what typecheck excludes* — a test file that is not
   typechecked is neither.
3. **Difference 2 — `erasableSyntaxOnly`.** The reference runs `tsx`, which compiles. This repo runs
   `node --test` on `.ts` directly, so non-erasable syntax is a runtime failure. This option turns it
   into a typecheck failure.

**Acceptance criteria:**
- [ ] AC1 — `npm run typecheck` exits 0.
- [ ] AC2 — `node -e "const c=require('fs').readFileSync('tsconfig.json','utf8'); console.assert(!/\"exclude\"/.test(c))"` exits 0 — no `exclude` key.
- [ ] AC3 — adding `enum E { A }` to any `.ts` file under `include` makes `npm run typecheck` exit
  non-zero with `TS1294` (erasable-syntax error). Verify once by hand, then revert.
- [ ] AC4 — `test/layout.test.ts` (J0.6) asserts `compilerOptions.noEmit === true` and that
  `include` names every workspace root plus `host` and `test`.

**Commit:** `Add the root tsconfig with noEmit and erasableSyntaxOnly (TST-21)`

**Depends on:** J0.2.

**Risks / what could be wrong:** `erasableSyntaxOnly` needs TypeScript 5.8 or newer; 5.9.3 has it.
If tsc rejects the option name the pin is wrong, and AC1 fails loudly rather than silently.
`allowImportingTsExtensions` with `noEmit` is fine now, but ADO-15's publish build will need
`rewriteRelativeImportExtensions` — an N5 problem, not an N0 one.

---

## J0.5 — Node floor: `.nvmrc`, `engines`, and a capability test  ·  DBS-01, D6

**Goal:** pin the Node version in one place, and back the number with a test that checks the two
capabilities the number exists for, instead of trusting the number.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/.nvmrc` (new)
- `/home/hyhilman/projects/me/doppelganger/test/node.test.ts` (new)

**Do:**
1. `.nvmrc` contains one line: `22.23.1` — the version measured on this machine.
2. `engines.node` in the root `package.json` is `>=22.18.0` (already written in J0.2). The floor is
   the later of the two features the repo depends on:
   - `node:sqlite` without a flag (DBS-01, D6) — available from Node 22.13.
   - TypeScript type stripping without a flag — available from Node 22.18.
3. Write `test/node.test.ts` with three assertions:
   - `require('node:sqlite')` resolves and `new DatabaseSync(':memory:')` runs a `CREATE TABLE`.
   - the running Node satisfies `engines.node` from `package.json`.
   - `.nvmrc`'s version also satisfies `engines.node` — the two pins may never disagree.
4. Type stripping needs no assertion of its own: this test file *is* a `.ts` file with type
   annotations that Node ran. If stripping were off, the suite would not start.

**Where the version is pinned:** `.nvmrc` is the single source of truth for what CI and a developer
run. `engines.node` is the floor a future consumer sees. A test holds them together. The reference
pins Node **nowhere** — `/home/hyhilman/projects/xenith/` has no `.nvmrc`, no `.node-version`, no
`engines` field and no CI at all. This is a place where the reference is not the acceptance
criterion, because `node:sqlite` under an old Node is a 3am failure and the reference never had CI
to be broken by one.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and reports at least 3 passing tests from `test/node.test.ts`.
- [ ] AC2 — `cat .nvmrc` prints `22.23.1`.
- [ ] AC3 — setting `engines.node` to `>=99.0.0` makes `npm test` exit non-zero with a message
  naming both the running version and `.nvmrc`. Verify once by hand, then revert.
- [ ] AC4 — `node --disable-warning=ExperimentalWarning -e "require('node:sqlite')"` exits 0 with no
  output.

**Commit:** `Pin the Node floor in .nvmrc and engines, gated by a capability test (DBS-01)`

**Depends on:** J0.4.

**Risks / what could be wrong:** the `22.18` / `22.13` feature floors are read from release history,
not measured — only 22.23.1 is on this machine. The capability test protects the version we actually
run; it cannot prove the floor. If that matters later, add a second CI matrix entry at
`22.18.0` — CI still runs `npm test` and nothing else, so the "nothing else" rule survives.

---

## J0.6 — `test/layout.test.ts` — the §1 layout gate  ·  §1, ADO-14

**Goal:** assert the repo's shape against §1 and ADO-14, in both directions, so the layout cannot
drift silently.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/test/layout.test.ts` (new)

**Do:** write one test file with these assertions.

*What must exist:*
1. `kernel/`, `plugins/`, `plugins/nightly/`, `cli/`, `.claude/skills/`, `test/` are directories.
2. `kernel/package.json`, `cli/package.json`, `plugins/nightly/package.json` exist.

*What the workspace list must mean:*
3. Every entry of root `workspaces` expands to at least one directory that has a `package.json`
   (so a glob may never match nothing).
4. Every directory with a `package.json`, outside `node_modules`, is matched by exactly one
   `workspaces` entry — **or** is the repo root. This is the reverse direction: a package nobody
   declared is as bad as a declared package that does not exist.
5. Every workspace `package.json` has `version` equal to the root's (ADO-01).

*What must NOT exist:*
6. `host/package.json` does not exist — ADO-14 says `host/` is deliberately not a workspace.
7. No `packages/` directory at the repo root — ADO-14 says nothing moves into one.
8. No `src/` directory at the repo root.
9. No empty directory anywhere outside `.git/` and `node_modules/`, and no file named `.gitkeep`.
   This is what lets N0 leave `kernel/ports/`, `kernel/runtime/`, `kernel/contracts/`, `host/` and
   `fleet/` uncreated: a §1 directory is absent or real, never a placeholder.

*The tsconfig half (from J0.4 AC4):*
10. `tsconfig.json` has `compilerOptions.noEmit === true`.
11. `tsconfig.json` `include` names `kernel`, `plugins`, `host`, `cli` and `test`.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `test/layout.test.ts` reports 11 passing assertions.
- [ ] AC2 — `mkdir packages` then `npm test` exits non-zero naming `packages/`. Verify by hand,
  then `rmdir packages`.
- [ ] AC3 — adding `"host"` to `workspaces` makes `npm test` exit non-zero naming ADO-14.
  Verify by hand, then revert.
- [ ] AC4 — creating an empty directory `kernel/ports` makes `npm test` exit non-zero naming it.
  Verify by hand, then `rmdir`.

**Commit:** `Gate the §1 layout and the ADO-14 workspace list with a test (ADO-14)`

**Depends on:** J0.4.

**Risks / what could be wrong:** assertion 9 (no empty directories) will fight anyone who wants a
scratch directory in-tree. That is the intended fight — a scratch directory belongs in `.gitignore`
or in `/tmp`. Assertion 4 will need a small allowlist once `host/` gains a `package.json`; it must
not, per ADO-14, so there is nothing to allow yet.

---

## J0.7 — `test/commands.test.ts` — `typecheck` as `pretest`  ·  TST-21

**Goal:** pin the command shape CLAUDE.md fixes, so `npm test` can never stop running the type check
and no test file can be left out of the suite.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/test/commands.test.ts` (new)

**Do:** write these assertions against the root `package.json`.
1. `scripts.pretest` exists and its command runs `typecheck` (`npm run typecheck`).
2. `scripts.typecheck` contains `tsc` and `--noEmit`.
3. `scripts.test` starts with `node --test`.
4. **Every test file is in the suite.** Walk the repo for `**/*.test.ts` outside `node_modules` and
   `.git`; assert each path is matched by at least one glob in `scripts.test`. This is the assertion
   that matters: `node --test` with globs that match nothing exits 0 (measured), so a test file in an
   unglobbed directory would pass by being invisible.
5. `scripts.test` names no test framework binary (`jest`, `vitest`, `mocha`, `ava`, `tape`) and no
   runner shim (`tsx`, `ts-node`).

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `test/commands.test.ts` reports 5 passing assertions.
- [ ] AC2 — creating `kernel/orphan.test.ts` with one trivial test makes `npm test` exit non-zero
  from assertion 4 only if `kernel/**/*.test.ts` were removed from `scripts.test`; verify the
  negative by temporarily deleting that glob, then revert.
- [ ] AC3 — deleting `scripts.pretest` makes `npm test` exit non-zero naming TST-21. Verify by hand,
  then revert.
- [ ] AC4 — putting a type error in `test/commands.test.ts` makes `npm test` fail during `pretest`,
  before any TAP output. Verify by hand, then revert.

**Commit:** `Pin typecheck as pretest and the full test glob (TST-21)`

**Depends on:** J0.6.

**Risks / what could be wrong:** assertion 4 needs a glob matcher. Use `node:path.matchesGlob` if the
target Node has it, otherwise translate each glob to a regexp inside the test — do not add a
dependency for it (TST-22).

---

## J0.8 — Settle §5 Q5 in the spec: the measured build answer  ·  ADO-15, ADO-16, TST-22

**Goal:** record what was measured on the target Node, correct ADO-16's stated reason, and make
CLAUDE.md agree — so J0.9 can be written without contradicting itself.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§5 Q5, §2.32 ADO-16)
- `/home/hyhilman/projects/me/doppelganger/CLAUDE.md` (Commands section)

**Do:**
1. Mark §5 Q5 **decided**, and write the measurement (Node 22.23.1, 2026-08-25):
   - **Consumer half — the build IS needed.** A real install copies the package under
     `node_modules`. Importing a `.ts` entry point from there fails with
     `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. ADO-15's `tsc -p tsconfig.build.json` → `dist/`
     stays exactly as written.
   - **This repo's own dev loop — the build is NOT needed.** An npm workspace link is a symlink
     (`node_modules/@doppelganger/kernel -> ../../kernel`). Node resolves the symlink to its real
     path before deciding whether to strip types, and the real path is outside `node_modules`, so
     stripping applies. A cross-workspace `import { x } from '@doppelganger/kernel'` where the
     `exports` map points at `./src/index.ts` runs under `node --test` with no build.
2. Correct **ADO-16**. Its premise — *"a workspace link resolves through `node_modules`, so whatever
   §5 Q5 answers for a consumer it answers for this repo's own test run"* — is false on the target
   Node. Rewrite the row to say: the build lands at **publish** (ADO-15) and at any point where a
   package is consumed by copy; `pretest` is `typecheck` alone while every internal edge is a
   workspace symlink. Keep the row's real conclusion — TST-22's narrowing to "no build step in a
   HOST repo" is still load-bearing — and keep the ID.
3. Correct the matching sentence in `CLAUDE.md`'s Commands section, which restates ADO-16.
4. State the trip-wire in both places: **if this repo ever consumes a workspace by copy instead of by
   link** (a vendored package, a `file:` tarball, a Docker image that installs rather than mounts),
   `pretest` gains `&& npm run build` on that day. J0.9's test is written so the flip is one line.

**Acceptance criteria:**
- [ ] AC1 — `grep -c 'Q5' roadmap.md` finds the question marked `**decided**` with the date
  `2026-08-25` and the Node version `22.23.1` in the same paragraph.
- [ ] AC2 — `grep -n 'typecheck && build' roadmap.md CLAUDE.md` returns no hits.
- [ ] AC3 — the ID `ADO-16` still appears in `roadmap.md` §2.32 (nothing is renumbered).
- [ ] AC4 — reproduce the measurement: build the two-case fixture in `/tmp` (one workspace-symlink
  case, one copied-under-`node_modules` case) and confirm the symlink case exits 0 and the copy case
  exits non-zero with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Paste the two exit codes into
  the commit body.

**Commit:** `Settle §5 Q5 with a measurement and correct ADO-16 (ADO-15, ADO-16)`

**Depends on:** J0.2 (needs the `pretest` wiring to describe).

**Risks / what could be wrong:** Node could change the symlink-realpath behaviour in a future
release, which would silently break the dev loop. The trip-wire sentence is the mitigation; a
stronger one is a test at N5 that imports across workspaces and would fail loudly.

---

## J0.9 — `test/toolchain.test.ts` — no linter, no bundler, no build on the run path  ·  TST-22

**Goal:** assert TST-22 in a form that does not contradict ADO-15's publish build.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/test/toolchain.test.ts` (new)

**How TST-22 is worded here, so it stays consistent:** TST-22 and ADO-15 talk about two different
scripts, and the test separates them by name rather than by intent.
- **Forbidden everywhere:** a linter or a bundler, as a dependency or as a config file.
- **Forbidden on the RUN path:** any script that runs the loop, the suite or the type check may not
  compile anything. That is the whole of "no build step in a host repo", applied to this repo too.
- **Permitted on the PUBLISH path only, and absent at N0:** `scripts.build` and
  `tsconfig.build.json` arrive with ADO-15 at N5. Until then the test asserts they do **not** exist,
  with a comment naming the exact assertion that flips when ADO-15 lands.

**Do:** write these assertions.
1. Read every `package.json` outside `node_modules`. Assert no `dependencies` or `devDependencies`
   key appears in the denylist: `eslint`, `@eslint/*`, `prettier`, `biome`, `@biomejs/*`, `oxlint`,
   `xo`, `standard`, `tslint`, `rollup`, `webpack`, `esbuild`, `vite`, `parcel`, `tsup`, `swc`,
   `@swc/*`, `babel`, `@babel/*`, `browserify`, `tsx`, `ts-node`, `jest`, `vitest`, `mocha`, `ava`,
   `tape`, `nodemon`. `typescript` and `@types/node` are explicitly allowed and named as such.
2. Assert no config file exists at any level for any of them: `.eslintrc*`, `eslint.config.*`,
   `.prettierrc*`, `prettier.config.*`, `biome.json*`, `rollup.config.*`, `webpack.config.*`,
   `vite.config.*`, `.babelrc*`, `babel.config.*`, `jest.config.*`, `vitest.config.*`,
   `.markdownlint*`.
3. **Run path:** for each of `scripts.test`, `scripts.pretest`, `scripts.typecheck` in every
   `package.json`, assert the command contains none of `npm run build`, `tsc -p tsconfig.build`,
   `dist/`. `tsc --noEmit` is allowed — it emits nothing, so it is a check and not a build.
4. **Host is not a workspace:** assert `host/package.json` does not exist (ADO-14), so a host repo
   inherits no build step by construction.
5. **Publish path, N0 state:** assert root `scripts.build` is absent and no `tsconfig.build.json`
   exists anywhere. Put this comment directly above it:
   ```
   // ADO-15 lands at N5. On that day this assertion flips to:
   //   scripts.build === "tsc -p tsconfig.build.json --workspaces"
   //   AND scripts.pretest still does NOT reference build (TST-22, §5 Q5 measured at N0).
   ```

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `test/toolchain.test.ts` reports 5 passing assertions.
- [ ] AC2 — `npm i -D --no-save eslint` then `npm test` exits non-zero naming `eslint` and TST-22.
  Verify by hand, then `npm i` to restore.
- [ ] AC3 — adding `"build": "tsc -p tsconfig.build.json"` to root `scripts` makes `npm test` exit
  non-zero naming ADO-15 and the line to flip. Verify by hand, then revert.
- [ ] AC4 — creating `host/package.json` makes `npm test` exit non-zero naming ADO-14. Verify by
  hand, then delete.
- [ ] AC5 — the test file contains the word `ADO-15` and the word `TST-22`, so a future reader finds
  the reconciliation without reading this plan.

**Commit:** `Assert no linter, no bundler and no build on the run path (TST-22)`

**Depends on:** J0.8.

**Risks / what could be wrong:** the denylist is a list, and a list goes stale — a linter published
next year passes. Accepted: the cost of the alternative (an allowlist of every legal dependency) is
higher, and every new dependency is a reviewed commit anyway.

---

## J0.10 — Settle §5 Q0 and SKL-10 ownership in the spec  ·  SKL-04, SKL-10, TST-23

**Goal:** write the user's ruling into `roadmap.md` — render, never symlink — and settle the design
question it leaves open: how `skills sync` decides a `.claude/skills/` entry is his.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§5 Q0, §2.30 SKL-04 and
SKL-10)

**The ruling (from the user, 2026-08-25):** no symlinks. Every skill is a **project skill**:
`.claude/skills/<job>/SKILL.md` is a real, regular file in the project tree — a rendered COPY of
`plugins/<x>/skills/<job>/SKILL.md`. Not a link. Not delivered through the Claude Code plugin-skill
mechanism. SKL-04 is confirmed as written; the symlink branch of TST-23 is dead.

**Do:** mark §5 Q0 **decided**, record the ruling, and write these four rules into SKL-04/SKL-10.

**1. Where the managed marker lives.**
Two HTML comment lines in the markdown **body**, immediately after the closing `---` of the YAML
frontmatter, before the blank line that starts the body. This is already what the landed worked
example does, so **no migration job is needed**:
```
<!-- managed:doppelganger-skills v=1 src=plugins/nightly/skills/nightly-sandcastle -->
<!-- rendered by `skills render` — do not edit; edit the source and re-render (SKL-04) -->
```
Why the body and not a frontmatter key: the CLI parses the frontmatter block and we do not control
whether an unknown key is ignored or rejected. An HTML comment in the body is inert to every
markdown reader, and it is proven — the rendered `nightly-sandcastle` skill with these two lines is
listed by the CLI today. A frontmatter key would be a bet on someone else's parser.

The render rule, stated so two implementations produce the same bytes:
```
render(source) = <the frontmatter block, "---\n" … "---\n", copied byte for byte>
               + "<!-- managed:doppelganger-skills v=1 src=<POSIX path from repo root to the source DIR> -->\n"
               + "<!-- rendered by `skills render` — do not edit; edit the source and re-render (SKL-04) -->\n"
               + <the rest of the source file, copied byte for byte>
```

**2. How `skills sync` decides an entry is his to delete.** Filesystem-decidable, no ledger:
- `.claude/skills/<dir>/SKILL.md` exists AND its first body line matches
  `^<!-- managed:doppelganger-skills v=(\d+) src=(\S+) -->$` → **OURS**.
- Anything else — no `SKILL.md`, or a `SKILL.md` without that first body line → **FOREIGN**. Never
  touched, never overwritten, never counted as drift. (SKL-10, carried from SUP-08.)
- OURS **and** `<dir>` is not the name of a registered job → **PRUNE** the whole `<dir>`.
- OURS **and** `<dir>` contains any entry other than `SKILL.md` → **REFUSE**, and say which files.
  The renderer writes exactly one file, so an extra file is a human's work sitting in a directory the
  tool owns, and deleting it silently is the failure this rule exists to stop.
- `render` about to create `<dir>` that already exists and is FOREIGN → **REFUSE the whole render**,
  naming the collision. SKL-04's "duplicate detection refuses a plain splice".

This closes SKL-10's own open point. SKL-10 currently says a rendered copy "can only answer by
keeping a ledger of the last render". That is not true of the marker the worked example already
carries: the ownership token is INSIDE the rendered file, so the filesystem answers "did we create
this?" without a ledger. Rewrite the sentence and keep the ID. The one case a ledger would still
beat the marker — a human deleted `SKILL.md` but left other files in an owned directory — is covered
by the REFUSE rule above, which reports it instead of guessing.

**3. How `skills check` detects drift.** For each registered job: compute `render(source)` **in
memory** and compare byte for byte to the file on disk. Never write. Exit non-zero on any of:
- **missing** — the job names a skill with no `.claude/skills/<job>/SKILL.md`.
- **drift** — the bytes differ (the hand-edit case, below).
- **orphan** — an OURS entry whose `<dir>` is not a registered job.
- **collision** — a FOREIGN entry occupying a registered job's name.
- **stray** — an OURS directory containing anything but `SKILL.md`.

No hash is stored in the marker. A hash would be a second copy of a fact the source file already is,
and a second copy is a second thing to keep in sync.

**4. What happens when a human hand-edits a rendered file.** `skills check` fails the build. It never
re-renders — silently repairing a hand-edit throws away the human's work and teaches them the file
is editable. The message:
```
skills: drift in .claude/skills/nightly-sandcastle/SKILL.md
  the rendered copy does not match its source
  source:  plugins/nightly/skills/nightly-sandcastle/SKILL.md
  first difference at line 12
  .claude/skills is rendered, never hand-edited (SKL-04).
  fix: move your change into the source file, then run `skills render`.
```
`skills sync` behaves the same way — it refuses a drifted entry rather than overwriting it. Only an
explicit `skills render` writes over an owned file.

**Scope, restated so it is not lost:** PROJECT level only. Never `~/.claude/skills/` (shared across
checkouts, contradicts INS-02, and would let SKL-10 prune another instance's skills). Never an
agent-CLI plugin namespace, whose `plugin:skill` prefix breaks SKL-01's one identifier.

**Acceptance criteria:**
- [ ] AC1 — `grep -n 'Q0' roadmap.md` shows the question marked `**decided**` with the ruling
  "render, no symlink" and the date.
- [ ] AC2 — `roadmap.md` §2.30 SKL-10 no longer contains the word `ledger` as a requirement, and
  contains the marker regexp and the five `check` findings.
- [ ] AC3 — the marker text written into `roadmap.md` matches, byte for byte, the two lines already
  in `.claude/skills/nightly-sandcastle/SKILL.md`. Check with
  `diff <(sed -n '4,5p' .claude/skills/nightly-sandcastle/SKILL.md) <(grep -A1 'managed:doppelganger-skills v=1 src=plugins' roadmap.md | head -2)`.
- [ ] AC4 — the IDs `SKL-04` and `SKL-10` still appear in §2.30 and nothing is renumbered.
- [ ] AC5 — `grep -n 'symlink' roadmap.md` shows the symlink option only as the rejected branch,
  never as a live choice.

**Commit:** `Settle §5 Q0 as render-not-symlink and fix SKL-10 ownership (SKL-04, SKL-10)`

**Depends on:** nothing (spec-only), but must land before J0.11.

**Risks / what could be wrong:** the REFUSE-on-stray-file rule makes `sync` less automatic than
SUP-08's crontab `sync`. That is deliberate — a crontab block has one file and a delimiter, a
directory tree does not, and SKL-10 already says the crontab precedent does not survive the port.

---

## J0.11 — `test/skills-example.test.ts` — gate the worked example  ·  SKL-03, SKL-04, SKL-06, SKL-08, SUP-20

**Goal:** the `nightly-sandcastle` skill already landed. Define and assert the checks it must satisfy,
so N3's real `skills check` has a pinned target to reproduce.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/test/skills-example.test.ts` (new)

**Note on scope:** N0 does **not** build the `skills render|sync|check` CLI — that is N3 (SKL-04,
TST-23). N0 writes the pure `render(source)` function as a local helper inside this test file and
asserts it against the one entry on disk. N3 moves that function into `cli/` unchanged and adds the
verbs around it. Say so in a comment at the top of the file.

**Do:** write these assertions.
1. `plugins/nightly/skills/nightly-sandcastle/SKILL.md` exists and is a regular file (SKL-03).
2. Its YAML frontmatter `name` equals the directory name `nightly-sandcastle` (SKL-01 — the skill
   name IS the job name).
3. The directory name starts with a known SUP-20 stage prefix. Hold the prefix list in the test:
   `source- triage- backlog- watch- todo- corpus- nightly- retro- ops-`. `nightly-sandcastle` matches
   `nightly-`.
4. `render(source)` equals `.claude/skills/nightly-sandcastle/SKILL.md` byte for byte, using the
   render rule written in J0.10.
5. `.claude/skills/nightly-sandcastle/` contains exactly one entry, `SKILL.md`.
6. `lstat('.claude/skills/nightly-sandcastle').isSymbolicLink()` is `false`, and the same for
   `SKILL.md`. This pins the Q0 ruling in code, so nobody re-opens it by hand.
7. The marker's first line matches `^<!-- managed:doppelganger-skills v=1 src=(\S+) -->$` and the
   captured `src` resolves to the source directory from assertion 1.
8. **SKL-08 / HRN-16** — the SOURCE body contains neither the substring
   `plugins/nightly/skills/` (a skill never names a path into its own directory) nor `process.env`
   nor `$ENV` (a skill's only inputs are `promptArgs`).
9. **SKL-06, both ways, in the form N0 can check.** There is no job registry yet, so hold the
   expected set in the test: the set of directory names under `.claude/skills/` must equal the set
   under `plugins/*/skills/`, and both must equal `{ nightly-sandcastle }`. Comment it as the N0
   stand-in for TST-24, replaced by the registry walk at N3/N5.
10. **SKL-07, the checkable half.** The source contains the `<<<SANDCASTLE … SANDCASTLE>>>` block,
    and the `outcome=` values it names are exactly `changed|none|too-large|suite-failed`. Pin that
    set here so N3's `parseVerdict` has to match it — the verdict vocabulary lives in code, and this
    is the record of what the markdown currently promises.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `test/skills-example.test.ts` reports 10 passing assertions.
- [ ] AC2 — appending one space to `.claude/skills/nightly-sandcastle/SKILL.md` makes `npm test` exit
  non-zero with the drift message from J0.10 step 4, naming the first differing line. Verify by hand,
  then `git checkout` the file.
- [ ] AC3 — replacing `.claude/skills/nightly-sandcastle` with a symlink to the plugin source makes
  `npm test` exit non-zero from assertion 6, naming §5 Q0. Verify by hand, then restore.
- [ ] AC4 — creating `plugins/nightly/skills/nightly-orphan/SKILL.md` makes `npm test` exit non-zero
  from assertion 9 (an orphan skill is a prompt nothing runs). Verify by hand, then delete.
- [ ] AC5 — dropping a second file into `.claude/skills/nightly-sandcastle/` makes `npm test` exit
  non-zero from assertion 5. Verify by hand, then delete.

**Commit:** `Gate the nightly-sandcastle worked example against SKL-03/04/06/08`

**Depends on:** J0.10.

**Risks / what could be wrong:** assertion 3's prefix list is a second copy of SUP-20's vocabulary
(the first is `roadmap.md`). N1 ships `stages.ts` as the single source; this test imports from it
then, and the duplicate is removed. Note that in a comment so N1 does not miss it.

---

## J0.12 — Corpus reachability gate and refreshed counts  ·  D15

**Goal:** keep the two `roadmap.md` claims this repo can check — the corpus path and the engine file
counts — from silently going wrong again, without turning a live third-party repo into a red CI.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (lines 5, 9, 11 — refreshed counts + date)
- `/home/hyhilman/projects/me/doppelganger/test/corpus.test.ts` (new)

**Does a gate belong in N0? Yes — but only the half that is stable.** The two claims are not the same
kind of claim:
- **The path** is stable. `/home/hyhilman/projects/xenith/` either is the corpus or it is not, and the
  old macOS path `/Users/hyhilman/Projects/xenith/` is simply wrong. That half is checkable
  everywhere, including CI.
- **The counts drift by the hour.** Measured today, 2026-08-25, the roadmap's own numbers are already
  stale: `engine/**` is 251 files / 56,872 lines (roadmap says 249 / 56,645) and `engine/src/**` is
  240 files / 134 non-test (roadmap says 238 / 133). xenith is a live repo. A byte-exact count gate
  would go red for reasons that have nothing to do with doppelganger, and a gate that cries wolf gets
  disabled.

**Do:**
1. Re-measure and rewrite the three claims in `roadmap.md` with today's numbers and a stated date:
   `engine/**` = 251 TS files / 56,872 lines outside `node_modules`; `engine/src/**` = 240 files,
   134 non-test; measured 2026-08-25.
2. Write `test/corpus.test.ts`:
   - **Always, everywhere:** assert `roadmap.md` and `CLAUDE.md` contain no `/Users/hyhilman/` path.
     This is the durable half of the fix and it runs in CI.
   - **Always:** parse the corpus path out of `roadmap.md` line 5 rather than hard-coding it, so the
     document is the source of the claim.
   - **When the corpus is absent** (CI, another machine): `t.skip('reference corpus absent')`. Do not
     fail. CI has no xenith checkout and never will.
   - **When the corpus is present:** assert `<corpus>/engine/` is a directory and
     `<corpus>/compose-data/docker-compose.yml` is a file (both named by D15 and §3.0), then assert
     each of the four counts in `roadmap.md` is within **±2%** of the live measurement. The failure
     message says: re-measure, update `roadmap.md`, and move the date.
3. Comment the ±2% band with its honest lifetime: it holds for months, not years. Re-measuring is a
   `nightly-polish` job at N5, or a human.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 on this machine with the corpus present, and `test/corpus.test.ts`
  reports its assertions as passing (not skipped).
- [ ] AC2 — `CORPUS_OVERRIDE=/nonexistent npm test` (or temporarily renaming the parsed path) exits 0
  with the corpus assertions reported as **skipped**, not failed.
- [ ] AC3 — writing `/Users/hyhilman/Projects/xenith/` anywhere in `roadmap.md` makes `npm test` exit
  non-zero even with the corpus absent. Verify by hand, then revert.
- [ ] AC4 — `grep -n '56,872\|56,645' roadmap.md` shows only the refreshed number, and the same
  paragraph carries `2026-08-25`.
- [ ] AC5 — changing a roadmap count by 10% makes `npm test` exit non-zero on this machine. Verify by
  hand, then revert.

**Commit:** `Refresh the corpus counts and gate the corpus path (D15)`

**Depends on:** J0.6.

**Risks / what could be wrong:** a skip-when-absent gate is a local gate, so CI never exercises the
count half. That is the trade and it is worth naming out loud: CI protects the path claim; a human on
this machine protects the counts. The alternative — vendoring a file list of a repo we do not own —
costs more than it returns.

---

## J0.13 — CI: `npm test` and nothing else  ·  TST-21, TST-22

**Goal:** one GitHub Actions workflow that installs and runs `npm test`. No lint step, no build step,
no cache tuning, no matrix.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/.github/workflows/test.yml` (new)

**Do:**
1. Write the workflow:
   ```yaml
   name: test
   on:
     push: { branches: [main, dev] }
     pull_request:
   jobs:
     test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version-file: .nvmrc
         - run: npm ci
         - run: npm test
   ```
2. `node-version-file: .nvmrc` — one pin, one place (J0.5). Never a literal version here.
3. `npm ci`, not `npm install` — CI must fail on a stale lockfile rather than quietly fixing it.
4. Nothing else. No `npm run lint` (there is none), no `npm run build` (there is none, J0.9), no
   separate typecheck step — `pretest` already runs it, and a separate step would let the two drift.

**The reference has no CI at all.** `/home/hyhilman/projects/xenith/` has no `.github/workflows/`.
There is nothing to copy, so this file is written from CLAUDE.md's rule ("CI runs `npm test`, nothing
else") rather than from the corpus. Say so in the commit body.

**Acceptance criteria:**
- [ ] AC1 — `.github/workflows/test.yml` parses as YAML:
  `node -e "require('fs').readFileSync('.github/workflows/test.yml','utf8')"` plus a push that shows
  a green run on GitHub.
- [ ] AC2 — the workflow file contains exactly two `run:` steps, and they are `npm ci` and
  `npm test`. Checked by `test/layout.test.ts` extended with one assertion, or by
  `grep -c '^ *- run:' .github/workflows/test.yml` printing `2`.
- [ ] AC3 — the workflow contains no literal Node version string; it references `.nvmrc`. Checked by
  `grep -q 'node-version-file: .nvmrc' .github/workflows/test.yml` exiting 0 and
  `grep -qE 'node-version: *[0-9]' .github/workflows/test.yml` exiting non-zero.
- [ ] AC4 — the first CI run on `dev` is green. Recorded by the run URL in the commit body or the PR.
- [ ] AC5 — `test/corpus.test.ts` reports as **skipped** in the CI log, not failed (J0.12 AC2, proven
  in the environment it was written for).

**Commit:** `Run npm test in CI and nothing else (TST-21, TST-22)`

**Depends on:** J0.12 (CI should go green on the finished suite, and AC5 needs the corpus gate).

**Risks / what could be wrong:** AC2 as a `grep -c` is brittle against reformatting. If it fights,
move it into `test/layout.test.ts` as a parsed check of the `run:` lines. Do not add a YAML parser
dependency (TST-22) — a line scan is enough for a file this small.

---

## J0.14 — Close N0 in `WORK.md` and `LOOP.md`

**Goal:** mark the nine N0 items done and move the loop's phase table forward, so the next phase
starts from a true state file.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/WORK.md` (N0 section)
- `/home/hyhilman/projects/me/doppelganger/LOOP.md` (phase table, open items)

**Do:**
1. Tick the nine N0 boxes in `WORK.md`, each with the job id that did it (`J0.x`).
2. In `LOOP.md`, set the N0 row's Plan/Gap/Build/Verify columns.
3. In `LOOP.md`'s "Open items the loop must not silently skip", replace the §5 Q0 bullet with the
   ruling and a pointer to `roadmap.md` §5 Q0 and §2.30 SKL-10. Add a one-line note that §5 Q5 was
   also settled at N0 (J0.8), since it changed ADO-16.

**Acceptance criteria:**
- [ ] AC1 — `grep -c '^- \[ \]' WORK.md` counts zero unchecked boxes in the N0 section.
- [ ] AC2 — every ticked N0 line names a `J0.x` job id.
- [ ] AC3 — `LOOP.md`'s N0 row no longer shows `—` in the Plan and Build columns.
- [ ] AC4 — `LOOP.md` no longer says §5 Q0 "needs a human to run `ln -s`".
- [ ] AC5 — `npm test` still exits 0 (nothing in this job touches code, so a failure means something
  else regressed).

**Commit:** `Close N0 in WORK.md and LOOP.md`

**Depends on:** J0.13.

**Risks / what could be wrong:** none.

---

## Summary of the resolved tensions

| Tension | Resolution |
|---|---|
| `pretest` = `typecheck && build` (CLAUDE.md, ADO-16) vs. TST-22 "no build step" | `pretest` is **`npm run typecheck`** and nothing else. Measured: a workspace link is a symlink and Node strips types through it, so ADO-16's stated reason is false for this repo's dev loop. The publish build (ADO-15) is real and stays, and it is a different script. J0.8 corrects the spec; J0.9's test separates the RUN path from the PUBLISH path by script name. |
| TST-22 wording that does not contradict itself | Three assertions: no linter/bundler **anywhere**; no compile in `test`/`pretest`/`typecheck` **anywhere**, and no `host/package.json`; `scripts.build` and `tsconfig.build.json` **absent at N0**, with the exact line that flips at ADO-15 written in a comment. |
| Node version pin | Floor `engines.node: ">=22.18.0"` (type stripping unflagged; `node:sqlite` unflagged from 22.13, so 22.18 is the binding one). Exact run version in **`.nvmrc` = `22.23.1`**, and CI reads `.nvmrc` via `node-version-file`. A test asserts the running Node and `.nvmrc` both satisfy `engines`, and that `node:sqlite` actually opens a database — the capability, not the number, is the gate. **The reference pins Node nowhere and has no CI**, so this is written from CLAUDE.md, not copied. |
| `cli` is a workspace but §1 shows no `cli/`; `host/` is not a workspace | Measured: `npm install` exits 0 when a workspace glob matches nothing, so nothing on disk is *required*. **Create `cli/` as a real workspace anyway** (`@doppelganger/cli`), because a declared workspace with no directory is a claim no test can check and CLAUDE.md already names four CLIs that need a home. `host/` is created only when N2 gives it a real file, and J0.9 asserts `host/package.json` never exists. J0.6 asserts the workspace list and the filesystem agree **in both directions**. |
| §5 Q0 | **Settled by the user, not by an experiment.** Render, no symlinks; every skill is a project skill and `.claude/skills/<job>/SKILL.md` is a regular file. J0.10 writes the ruling plus the SKL-10 ownership rule (marker in the body, no ledger, five `check` findings, refuse-never-re-render on a hand-edit). J0.11 pins it with `isSymbolicLink() === false`. |
| The two fixed `roadmap.md` claims | Split. The **path** claim is gated everywhere including CI (no `/Users/hyhilman/` anywhere). The **count** claims are gated at ±2% and **skipped when the corpus is absent** — they are already stale as of today, because xenith is a live repo. J0.12 refreshes them with a date. |

---

## Gaps I found in the roadmap

1. **`test/` at the repo root is not in §1's layout.** ADO-17 requires the contract suite to be
   "invoked at the repo ROOT across every workspace", which implies a root-level test location, but
   §1's diagram does not show one. This plan uses `test/`. Add it to §1 or say where repo-wide tests
   belong instead.

2. **ADO-01 does not name the `cli` package.** It says `@doppelganger/kernel` and every
   `@doppelganger/plugin-*` release as a set. ADO-14 makes `cli` a workspace, so it is a fourth
   package with no naming rule and no place in the lockstep. This plan uses `@doppelganger/cli` at
   the same version. Confirm or correct.

3. **SKL-10's ledger claim is wrong.** It says a rendered copy "can only answer [ownership] by
   keeping a ledger of the last render". The worked example already carries a managed marker inside
   the rendered file, which answers it from the filesystem with no ledger. J0.10 rewrites the
   sentence; flagging it here because it is a spec statement, not an implementation detail.

4. **ADO-16's premise is measurably false on the target Node.** Covered by J0.8; listed here so the
   GAP step does not report it as a plan error.

5. **`.gitignore` is not in the roadmap.** A repo with `node_modules`, `dist/` and `*.db` files needs
   one, and INS-02 says every write is project-relative or `INSTANCE`-discriminated — which makes
   `*.db` a project-relative write that must not be committed. J0.1 adds it. Consider a row.

6. **No row says where repo-wide drift gates live before `kernel/contracts` exists.** TST-01 ships
   `contractTests` at N5, but N0–N4 need self-checks (layout, commands, toolchain, skills, corpus)
   with nowhere named to put them. This plan puts them in `test/`, to be folded into
   `kernel/contracts` at N5 where they generalise. Say so, or accept the split as permanent.

7. **§5 Q0's own text says "verify before M4 hand-writes a renderer" while §3's N0 says "before N3".**
   §3.2 maps `M4 → N3 · N5`, so they agree, but the mixed numbering in one sentence costs a lookup.
   Now moot for Q0 (settled), but the same mixed reference may appear elsewhere.
