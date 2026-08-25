# N0 — Ground truth · UAC breakdown

N0 is done when `npm test` runs green on a clean checkout and the repo can prove things about
itself. The proof is the point: the directory layout, the workspace list, the `pretest` wiring, the
absence of a linter or bundler, the Node floor, the rendered skill and the reference-corpus path are
all asserted by tests, not by prose. No engine code is written in N0 — the only new source files are
the repo's own drift gates.

Three open questions are closed here with written rulings, not with guesses: **§5 Q0** (render, no
symlinks — ruled by the user, J0.9), **§5 Q5** (measured on the target Node, J0.7), and the
SKL-07/TST-24 boundary between an output vocabulary and an authorization token (J0.9).

**Rule this plan obeys at every step: the phase is green at every commit.** `npm test` exits 0 after
each job, including the first. Where three files are green only together, they are one job and one
commit — splitting them to make jobs smaller would break the stronger rule.

---

## Job order

1. **J0.1** — `.gitignore`. Nothing else can land until `node_modules` is ignored.
2. **J0.2** — The repo runs its own suite: `package.json` + `tsconfig.json` + `.nvmrc` + the first
   test. These four are green only together (measured — see the job), so they are one commit.
3. **J0.3** — Workspace stubs + lockfile. Creates `kernel/` and `cli/`, each with a real file.
4. **J0.4** — Update §1 to name `cli/` and `test/`. The layout test must cite a §1 that is true.
5. **J0.5** — `test/layout.test.ts`. The §1 layout gate; needs J0.3's stubs and J0.4's §1.
6. **J0.6** — `test/commands.test.ts` (TST-21). Pins `pretest` and the test globs.
7. **J0.7** — Settle §5 Q5 in the spec. J0.8's wording depends on the answer, so it comes first.
8. **J0.8** — `test/toolchain.test.ts` (TST-22). Implements the rule J0.7 just corrected.
9. **J0.9** — Settle §5 Q0, SKL-10 ownership and the SKL-07 boundary; delete the dead `ln -s`
   prescriptions. J0.10's test cites all of it.
10. **J0.10** — `test/skills-example.test.ts`. Gates the already-landed worked example.
11. **J0.11** — Refresh the four stale corpus counts in two files. Facts first, gate second.
12. **J0.12** — `test/corpus.test.ts`. Gates the path and the provenance of J0.11's numbers.
13. **J0.13** — CI workflow + `test/ci.test.ts`. Last, so CI goes green on a finished suite.
14. **J0.14** — Close N0 in `WORK.md` and `LOOP.md`. Bookkeeping, after everything is green.

---

## J0.1 — `.gitignore`  ·  §1, INS-02

**Goal:** stop `node_modules`, build output and scratch databases from entering git.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/.gitignore` (new)

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
2. Create no directories. git stores no empty directory, so a commit that only makes directories
   commits nothing. Every directory §1 names is created by the job that gives it a real file:
   `test/` in J0.2, `kernel/` and `cli/` in J0.3. `kernel/ports/`, `kernel/runtime/`,
   `kernel/contracts/`, `host/` and `fleet/` wait for N1/N2/N5.
3. Add no `.gitkeep`. A placeholder is a directory that lies about being used, and J0.5 asserts none
   exists.

**Reading of "repo layout per §1" used here:** §1 is the *target* layout. N0 establishes it and
gates it; it does not pre-create empty directories for milestones that have not run. J0.5's gate is
written to allow that: a §1 directory is either absent or non-empty, never an empty placeholder.

**Acceptance criteria:**
- [ ] AC1 — `git check-ignore -q node_modules` exits 0 from the repo root.
- [ ] AC2 — `git check-ignore -q lease.db && git check-ignore -q dist && git check-ignore -q .env`
  exits 0.
- [ ] AC3 — `find . -not -path './.git/*' -name '.gitkeep' | wc -l` prints `0`.
- [ ] AC4 — `git status --porcelain` shows no `node_modules` entry after an `npm install`.

**Commit:** `Add .gitignore for node_modules, dist and scratch databases`

**Depends on:** nothing.

**Risks / what could be wrong:** `*.db` could later hide a fixture database a test wants committed
(TST-19 lifts fixtures from real data). If that happens, add a negated line rather than dropping the
rule.

---

## J0.2 — The repo runs its own suite  ·  ADO-14, TST-21, DBS-01

**Goal:** one commit that makes `npm test` exit 0: the root manifest, the tsconfig, the Node pin and
the first test file.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/package.json` (new)
- `/home/hyhilman/projects/me/doppelganger/tsconfig.json` (new)
- `/home/hyhilman/projects/me/doppelganger/.nvmrc` (new)
- `/home/hyhilman/projects/me/doppelganger/test/node.test.ts` (new)

**Why these four are one commit, not four.** Measured with `typescript@5.9.3`:
- `package.json` alone → `pretest` runs `tsc --noEmit -p tsconfig.json` → **`TS5058`, exit 1**. There
  is no tsconfig.
- `package.json` + `tsconfig.json`, no `.ts` file anywhere under `include` → **`TS18003`, exit 2**
  ("No inputs were found in config file").
- `package.json` + `tsconfig.json` + one real `.ts` file → **exit 0**, even though four of the five
  `include` globs still match nothing.

So the minimum green unit is manifest + tsconfig + at least one `.ts` file. Splitting it leaves a red
commit in the middle of the phase, which is the one thing this plan is not allowed to do.

**Do:**

1. **`package.json`:**
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
       "@types/node": "22.20.1"
     }
   }
   ```
   - `workspaces` is ADO-14's list **verbatim**. Do not add `host/` — ADO-14 says host is
     deliberately not a workspace, and J0.5 asserts that.
   - `version` is `0.0.0` and is the ONE version ADO-01 talks about. Every workspace copies it.
   - `"type": "module"` is **load-bearing**, not cosmetic. Without it, `verbatimModuleSyntax` +
     `module: nodenext` makes tsc read every `.ts` file as CommonJS and reject every `import` with
     `TS1295`. Measured. Every workspace stub in J0.3 needs it for the same reason.
   - Both dev dependencies are pinned EXACT (no `^`). A floating typechecker is a floating build.
   - **`@types/node` is `22.20.1`, not `26.x`.** The runtime floor is 22.18 and `.nvmrc` is 22.23.1.
     Types a major version ahead let tsc bless APIs that do not exist at 3am — the same failure class
     HRN-11's model pin exists to stop. Measured: `22.20.1` typechecks `node:sqlite`
     (`DatabaseSync`, `prepare`, `run`, `get`, `close`) and `path.matchesGlob` cleanly at exit 0.
     The reference uses `^26.1.1`; this is a deliberate difference, and the reason goes in the commit
     body.
   - No `tsx`. The reference runs `tsx`; this repo does not need it — `node --test` runs `.ts`
     directly on the target Node (measured), so `tsx` is a dependency with no job.

2. **`tsconfig.json`**, following `/home/hyhilman/projects/xenith/engine/tsconfig.json` with two
   deliberate differences:
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
   - **Difference 1 — no `exclude`.** The reference excludes `**/*.test.ts` from typecheck with a
     backlog note (`tracker #645`, 66 loosely-typed fixtures). Do not copy the debt. TST-21 says
     *tests remain the type check for what typecheck excludes* — a test file that is not typechecked
     is neither.
   - **Difference 2 — `erasableSyntaxOnly`.** The reference compiles with `tsx`; this repo runs
     `.ts` directly, so non-erasable syntax is a runtime failure. Measured: `export enum E { A }`
     under this option gives `TS1294`, exit 2.

3. **`.nvmrc`** contains one line: `22.23.1` — the version measured on this machine.

4. **`test/node.test.ts`** — the Node capability test, one `test()` per assertion:
   - `require('node:sqlite')` resolves and `new DatabaseSync(':memory:')` runs a `CREATE TABLE`.
   - the running Node satisfies `engines.node` from `package.json`.
   - `.nvmrc`'s version also satisfies `engines.node` — the two pins may never disagree.
   Type stripping needs no assertion of its own: this file *is* a `.ts` file with type annotations
   that Node ran. If stripping were off, the suite would not start.
   **Unstated work:** comparing a version against a range needs semver logic. Write ~15 lines that
   handle the one operator form this repo uses (`>=x.y.z`) and throw on anything else. Do **not**
   add a `semver` dependency (TST-22).

**Where the Node version is pinned:** `.nvmrc` is the single source of truth for what CI and a
developer run. `engines.node` is the floor a future consumer sees. The floor is the later of the two
features the repo depends on — `node:sqlite` unflagged from 22.13 (DBS-01, D6), type stripping
unflagged from 22.18. A test holds `.nvmrc` and `engines` together, and the capability assertions
mean the gate is the behaviour, not the number. **The reference pins Node nowhere** —
`/home/hyhilman/projects/xenith/` has no `.nvmrc`, no `.node-version`, no `engines` field and no CI.
This is a place where the reference is not the acceptance criterion, because `node:sqlite` under an
old Node is a 3am failure and the reference never had CI to be broken by one.

**What `pretest` is in this repo — the tension, resolved:**
CLAUDE.md and ADO-16 say `pretest` is `typecheck && build`. **Here it is `npm run typecheck` and
nothing else.** Two reasons, both mechanical:
- There is nothing to build. `kernel/` has no source, there is no `tsconfig.build.json`, and no
  workspace imports another. `&& npm run build` would compile zero files.
- ADO-16's stated reason is false on the target Node. Measured on Node 22.23.1 (J0.7): a workspace
  link is a **symlink**, Node resolves it to its real path before deciding whether to strip types,
  and the real path is outside `node_modules` — so stripping applies and the dev loop needs no build.
  The consumer half of §5 Q5 is different and unchanged (a real install copies files under
  `node_modules` and fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so ADO-15's publish
  build stays. J0.7 writes that measurement into the spec.

**Acceptance criteria:**
- [ ] AC1 — `npm install` from the repo root exits 0.
- [ ] AC2 — `npm test` exits 0 and reports 3 passing tests from `test/node.test.ts`.
- [ ] AC3 — `npm run typecheck` exits 0 on its own.
- [ ] AC4 — `pretest` really gates `test`: add `const x: number = "s";` to `test/node.test.ts`, run
  `npm test`, confirm it exits non-zero with `TS2322` and **no TAP output**. Revert.
- [ ] AC5 — `node -e "const p=require('./package.json'); if(JSON.stringify(p.workspaces)!==JSON.stringify(['kernel','plugins/*','cli']))process.exit(1)"` exits 0.
- [ ] AC6 — `scripts` has no `build` key and no `lint` key; `devDependencies` has exactly two keys.
- [ ] AC7 — `cat .nvmrc` prints `22.23.1`, and setting `engines.node` to `>=99.0.0` makes `npm test`
  exit non-zero naming both the running version and `.nvmrc`. Revert.
- [ ] AC8 — `node --disable-warning=ExperimentalWarning -e "require('node:sqlite')"` exits 0 with no
  output.

**Commit:** `Make the repo run its own suite: package.json, tsconfig, .nvmrc, node gate (TST-21, ADO-14, DBS-01)`

**Depends on:** J0.1.

**Risks / what could be wrong:**
- `npm install` with `workspaces: ["kernel","plugins/*","cli"]` where none of those directories has a
  `package.json` exits 0 and links nothing (measured). AC1 passing does **not** prove the workspaces
  exist — J0.3 and J0.5 are what prove that.
- Importing `node:sqlite` prints an `ExperimentalWarning` on stderr. Harmless, and not silenced:
  `--disable-warning=ExperimentalWarning` in the `test` script would hide every other experimental
  warning too. DBS-01 at N1 revisits it.
- The `22.18` / `22.13` feature floors are read from release history, not measured here — only
  22.23.1 is on this machine. The capability test protects the version we actually run; it cannot
  prove the floor. If that matters later, add a second CI matrix entry at `22.18.0`; CI still runs
  `npm test` and nothing else, so the "nothing else" rule survives.

---

## J0.3 — Workspace stubs and the lockfile  ·  ADO-01, ADO-13, ADO-14

**Goal:** make every entry in the `workspaces` list resolve to a real package, so the list is a fact
rather than a promise.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/package.json` (new — creates `kernel/`)
- `/home/hyhilman/projects/me/doppelganger/cli/package.json` (new — creates `cli/`)
- `/home/hyhilman/projects/me/doppelganger/plugins/nightly/package.json` (new)
- `/home/hyhilman/projects/me/doppelganger/package-lock.json` (new, generated)

**Do:**
1. Three stubs, each with the SAME `version` as the root (`0.0.0` — ADO-01), and `"type": "module"`
   (J0.2 explains why that field is load-bearing):
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
workspace is a claim no test can check. J0.4 puts `cli/` into §1; J0.5 asserts the list and the
filesystem agree in both directions.

**Acceptance criteria:**
- [ ] AC1 — `npm install` exits 0 and `ls node_modules/@doppelganger` prints exactly
  `cli`, `kernel`, `plugin-nightly`.
- [ ] AC2 — `npm ls --workspaces --depth=0` exits 0 and names three packages.
- [ ] AC3 — `npm test` still exits 0 (nothing regressed).
- [ ] AC4 — `package-lock.json` is committed and `npm ci` in a fresh clone of this commit exits 0.
- [ ] AC5 — every workspace `package.json` has `"type": "module"` and `"version": "0.0.0"`.
  Asserted by `test/layout.test.ts` in J0.5; check by hand here.

**Commit:** `Add the three workspace package stubs at one version (ADO-01, ADO-13)`

**Depends on:** J0.2.

**Risks / what could be wrong:** `@doppelganger/cli` is a package name ADO-01 does not cover — it
names `@doppelganger/kernel` and `@doppelganger/plugin-*` only. Listed under *Gaps* below.

---

## J0.4 — Put `cli/` and `test/` into §1  ·  §1, ADO-14, ADO-17

**Goal:** N0 is the commit that creates `cli/` and `test/`, so N0 is where §1 stops omitting them.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§1, lines ~51–83)

**Do:**
1. Add `cli/` to the §1 layout block, under `host/`:
   ```
   cli/                      operator surfaces — supervisor --list, skills, lease-clear, cron
   ```
   ADO-14 already declares it a workspace; §1 was the only place it was missing.
2. Add `test/` to the §1 layout block:
   ```
   test/                     repo-wide drift gates — layout, commands, toolchain, skills, corpus
   ```
   ADO-17 requires the contract suite to be "invoked at the repo ROOT across every workspace", which
   needs a root-level home. Add one sentence saying these fold into `kernel/contracts` at N5 where
   they generalise (TST-01), and that until then they live here.
3. Change nothing else in §1. Do not renumber, do not touch the five-manifest-members paragraph.

**Acceptance criteria:**
- [ ] AC1 — `sed -n '/^## 1\. Target layout/,/^## 2\./p' roadmap.md | grep -c '^cli/'` prints `1`.
- [ ] AC2 — the same range contains a line starting `test/`.
- [ ] AC3 — `git diff roadmap.md` touches only lines inside §1.
- [ ] AC4 — `npm test` still exits 0.

**Commit:** `Name cli/ and test/ in the §1 target layout (ADO-14, ADO-17)`

**Depends on:** J0.3.

**Risks / what could be wrong:** none. This is the plan closing its own gap rather than reporting it.

---

## J0.5 — `test/layout.test.ts` — the §1 layout gate  ·  §1, ADO-14

**Goal:** assert the repo's shape against §1 and ADO-14, in both directions, so the layout cannot
drift silently.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/test/layout.test.ts` (new)

**Do:** write one test file, **one `test()` per numbered assertion** — the AC counts below only hold
if the builder does that.

*What must exist:*
1. `kernel/`, `plugins/`, `plugins/nightly/`, `cli/`, `.claude/skills/`, `test/` are directories.
2. `kernel/package.json`, `cli/package.json`, `plugins/nightly/package.json` exist.

*What the workspace list must mean:*
3. Every entry of root `workspaces` expands to at least one directory that has a `package.json` — a
   glob may never match nothing.
4. Every directory with a `package.json`, outside `node_modules`, is matched by exactly one
   `workspaces` entry, **or** is the repo root. The reverse direction: a package nobody declared is
   as bad as a declared package that does not exist.
5. Every workspace `package.json` has `version` equal to the root's (ADO-01) and `"type": "module"`.

*What must NOT exist:*
6. `host/package.json` does not exist — ADO-14 says `host/` is deliberately not a workspace.
   **This assertion lives here and only here.** J0.8's toolchain test carries a comment pointing at
   it rather than a second copy.
7. No `packages/` directory at the repo root — ADO-14 says nothing moves into one.
8. No `src/` directory at the repo root.
9. No empty directory anywhere outside `.git/` and `node_modules/`, and no file named `.gitkeep`.
   This is what lets N0 leave `kernel/ports/`, `kernel/runtime/`, `kernel/contracts/`, `host/` and
   `fleet/` uncreated: a §1 directory is absent or real, never a placeholder.

*The tsconfig half:*
10. `tsconfig.json` has `compilerOptions.noEmit === true` and no `exclude` key.
11. `tsconfig.json` `include` names `kernel`, `plugins`, `host`, `cli` and `test`.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `test/layout.test.ts` reports **11** passing tests (one per
  numbered assertion above).
- [ ] AC2 — `mkdir packages` then `npm test` exits non-zero naming `packages/` and ADO-14. Verify by
  hand, then `rmdir packages`.
- [ ] AC3 — adding `"host"` to `workspaces` makes `npm test` exit non-zero naming ADO-14. Verify by
  hand, then revert.
- [ ] AC4 — `mkdir -p kernel/ports` (empty) makes `npm test` exit non-zero naming it. Verify by hand,
  then `rmdir`.
- [ ] AC5 — changing `cli/package.json`'s `version` to `0.0.1` makes `npm test` exit non-zero naming
  ADO-01. Verify by hand, then revert.

**Commit:** `Gate the §1 layout and the ADO-14 workspace list with a test (ADO-14)`

**Depends on:** J0.3 (assertions 2, 3, 4, 5 need the stubs) and J0.4 (assertions 1 and 11 cite the
updated §1).

**Risks / what could be wrong:** assertion 9 will fight anyone who wants a scratch directory in-tree.
That is the intended fight — a scratch directory belongs in `.gitignore` or in `/tmp`. Assertion 4
will need a small allowlist if `host/` ever gains a `package.json`; it must not, per ADO-14, so
there is nothing to allow yet.

---

## J0.6 — `test/commands.test.ts` — `typecheck` as `pretest`  ·  TST-21

**Goal:** pin the command shape CLAUDE.md fixes, so `npm test` can never stop running the type check
and no test file can be left out of the suite.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/test/commands.test.ts` (new)

**Do:** write these assertions against the root `package.json`, **one `test()` each**.
1. `scripts.pretest` exists and its command runs `typecheck`.
2. `scripts.typecheck` contains `tsc` and `--noEmit`.
3. `scripts.test` starts with `node --test`.
4. **Every test file is in the suite.** Walk the repo for `**/*.test.ts` outside `node_modules` and
   `.git`; assert each path is matched by at least one glob in `scripts.test`. This is the assertion
   that matters: `node --test` with globs that match nothing exits 0 (measured), so a test file in an
   unglobbed directory would pass by being invisible.
5. `scripts.test` names no test framework binary (`jest`, `vitest`, `mocha`, `ava`, `tape`) and no
   runner shim (`tsx`, `ts-node`).

**Unstated work:** assertion 4 needs a glob matcher. Use `node:path`'s `matchesGlob` — **confirmed
present and correct on the target Node** (`typeof matchesGlob === 'function'`, and
`matchesGlob('kernel/a/b.test.ts', 'kernel/**/*.test.ts') === true`). Add no dependency (TST-22).

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `test/commands.test.ts` reports **5** passing tests.
- [ ] AC2 — delete `"kernel/**/*.test.ts"` from `scripts.test`, create `kernel/x.test.ts` with one
  trivial test, run `npm test`: it exits non-zero from assertion 4 naming the unmatched file. Verify
  by hand, then revert both.
- [ ] AC3 — deleting `scripts.pretest` makes `npm test` exit non-zero naming TST-21. Verify by hand,
  then revert.
- [ ] AC4 — putting a type error in `test/commands.test.ts` makes `npm test` fail during `pretest`,
  before any TAP output. Verify by hand, then revert.

**Commit:** `Pin typecheck as pretest and the full test glob (TST-21)`

**Depends on:** J0.5.

**Risks / what could be wrong:** none outstanding — the `matchesGlob` risk noted in the first draft
is closed by measurement.

---

## J0.7 — Settle §5 Q5 in the spec: the measured build answer  ·  ADO-15, ADO-16, TST-22

**Goal:** record what was measured on the target Node, correct ADO-16's stated reason, and make
CLAUDE.md agree — so J0.8 can be written without contradicting itself.

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
   `pretest` gains `&& npm run build` on that day. J0.8's test is written so the flip is one line.

**Acceptance criteria:**
- [ ] AC1 — the §5 Q5 paragraph in `roadmap.md` contains `**decided**`, the date `2026-08-25` and the
  Node version `22.23.1`.
- [ ] AC2 — `grep -n 'typecheck && build' roadmap.md CLAUDE.md` returns no hits.
- [ ] AC3 — `grep -c 'ADO-16' roadmap.md` still finds the row in §2.32 (nothing is renumbered).
- [ ] AC4 — reproduce the measurement: build the two-case fixture in `/tmp` (one workspace-symlink
  case, one copied-under-`node_modules` case) and confirm the symlink case exits 0 and the copy case
  exits non-zero with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Paste both exit codes into the
  commit body.
- [ ] AC5 — `npm test` still exits 0.

**Commit:** `Settle §5 Q5 with a measurement and correct ADO-16 (ADO-15, ADO-16)`

**Depends on:** J0.6.

**Risks / what could be wrong:** Node could change the symlink-realpath behaviour in a future
release, which would silently break the dev loop. The trip-wire sentence is the mitigation; a
stronger one is a test at N5 that imports across workspaces and would fail loudly.

---

## J0.8 — `test/toolchain.test.ts` — no linter, no bundler, no build on the run path  ·  TST-22

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

**Do:** write these assertions, **one `test()` each**.
1. Read every `package.json` outside `node_modules`. Assert no `dependencies` or `devDependencies`
   key appears in the denylist: `eslint`, `@eslint/*`, `prettier`, `biome`, `@biomejs/*`, `oxlint`,
   `xo`, `standard`, `tslint`, `rollup`, `webpack`, `esbuild`, `vite`, `parcel`, `tsup`, `swc`,
   `@swc/*`, `babel`, `@babel/*`, `browserify`, `tsx`, `ts-node`, `jest`, `vitest`, `mocha`, `ava`,
   `tape`, `nodemon`, `semver`. `typescript` and `@types/node` are explicitly allowed and named as
   such in a comment.
2. Assert no config file exists at any level for any of them: `.eslintrc*`, `eslint.config.*`,
   `.prettierrc*`, `prettier.config.*`, `biome.json*`, `rollup.config.*`, `webpack.config.*`,
   `vite.config.*`, `.babelrc*`, `babel.config.*`, `jest.config.*`, `vitest.config.*`,
   `.markdownlint*`.
3. **Run path:** for each of `scripts.test`, `scripts.pretest`, `scripts.typecheck` in every
   `package.json`, assert the command contains none of `npm run build`, `tsc -p tsconfig.build`,
   `dist/`. `tsc --noEmit` is allowed — it emits nothing, so it is a check and not a build.
4. **Publish path, N0 state:** assert root `scripts.build` is absent and no `tsconfig.build.json`
   exists anywhere. Put this comment directly above it:
   ```
   // ADO-15 lands at N5. On that day this assertion flips to:
   //   scripts.build === "tsc -p tsconfig.build.json --workspaces"
   //   AND scripts.pretest still does NOT reference build (TST-22, §5 Q5 measured at N0).
   ```
5. Add a comment, not an assertion, for the ADO-14 half:
   ```
   // "host/ is not a workspace" (ADO-14) is asserted once, in test/layout.test.ts assertion 6.
   // A second copy here would be a second place to update. Do not add one.
   ```

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `test/toolchain.test.ts` reports **4** passing tests (item 5 is a
  comment, not a test).
- [ ] AC2 — `npm i -D --no-save eslint` then `npm test` exits non-zero naming `eslint` and TST-22.
  Verify by hand, then `npm ci` to restore.
- [ ] AC3 — adding `"build": "tsc -p tsconfig.build.json"` to root `scripts` makes `npm test` exit
  non-zero naming ADO-15 and the line to flip. Verify by hand, then revert.
- [ ] AC4 — the file contains the strings `ADO-15`, `TST-22` and `test/layout.test.ts`, so a future
  reader finds the reconciliation and the single home of the ADO-14 assertion without reading this
  plan.
- [ ] AC5 — `grep -c "host/package.json" test/toolchain.test.ts` finds it only inside the comment
  from item 5, never inside an `assert`.

**Commit:** `Assert no linter, no bundler and no build on the run path (TST-22)`

**Depends on:** J0.7.

**Risks / what could be wrong:** the denylist is a list, and a list goes stale — a linter published
next year passes. Accepted: the cost of the alternative (an allowlist of every legal dependency) is
higher, and every new dependency is a reviewed commit anyway.

---

## J0.9 — Settle §5 Q0, SKL-10 ownership and the SKL-07 boundary  ·  SKL-04, SKL-07, SKL-10, TST-23, TST-24

**Goal:** write the user's ruling into `roadmap.md` — render, never symlink — settle how
`skills sync` decides an entry is his, draw the SKL-07 line the worked example already sits on, and
delete the three places that still prescribe the dead `ln -s` experiment.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§5 Q0 at ~1417–1430, §2.30 SKL-04, SKL-07,
  SKL-10, and §3's N0 block at line 1214)
- `/home/hyhilman/projects/me/doppelganger/WORK.md` (line 13)

**The ruling (from the user, 2026-08-25):** no symlinks. Every skill is a **project skill**:
`.claude/skills/<job>/SKILL.md` is a real, regular file in the project tree — a rendered COPY of
`plugins/<x>/skills/<job>/SKILL.md`. Not a link. Not delivered through the Claude Code plugin-skill
mechanism. SKL-04 is confirmed as written; the symlink branch of TST-23 is dead.

**Do:** mark §5 Q0 **decided**, record the ruling, and write these five rules.

**1. Where the managed marker lives.**
Two HTML comment lines in the markdown **body**, immediately after the closing `---` of the YAML
frontmatter, before the blank line that starts the body. This is already what the landed worked
example does — verified, they are **lines 5 and 6** of
`.claude/skills/nightly-sandcastle/SKILL.md` — so **no migration job is needed**:
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
  touched, never overwritten, never counted as drift (SKL-10, carried from SUP-08).
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

**5. The SKL-07 boundary: an output vocabulary is allowed, an authorization token is not.**
Write this into §2.30 SKL-07 now, while the pin is being written, because TST-24 as currently worded
("no `SKILL.md` carries … a verdict token that code owns") would fail the worked example at N3. The
landed skill carries `outcome=<changed|none|too-large|suite-failed>` at line 47 of
`plugins/nightly/skills/nightly-sandcastle/SKILL.md`, and that is correct, not a violation.

The distinction, in SKL-07's own terms:
- An **output vocabulary** is the set of values the skill must EMIT so the caller can read its
  report. It is a report format. Nothing is granted by naming it. The skill must state it, because a
  report nobody can parse is a report nobody reads. `outcome=` is this.
- An **authorization token** is a value that WIDENS what the run is allowed to do. It must never
  appear in markdown, because a grant that lives in markdown is a grant anyone can widen in a text
  editor. SKL-07's own precedent is **JOB-T03**: `agent` is reachable only from a literal token,
  *enforced in `parseVerdict`, not asked for in the prompt*. The skill never names `agent`; the code
  decides.
- The test that tells them apart: **if a value's presence changes what the caller is permitted to
  do, it is a token — keep it out.** If it only changes what the caller *learns*, it is a vocabulary
  — the skill states it, and code still validates it (an unknown `outcome=` is a parse failure, not
  a new outcome).

Restate TST-24's third clause with that wording, keeping the ID. J0.10 assertion 10 pins the
vocabulary so N3's `parseVerdict` must match it.

**6. Delete the dead `ln -s` prescriptions.** Three lines still tell someone to run the settled
experiment. Verified locations:
- `roadmap.md:1214` (§3 N0) — "settle §5 Q0 with the `ln -s` test **before** N3 hand-writes a
  renderer". Replace with the ruling: "§5 Q0 settled — render, never symlink (2026-08-25)".
- `roadmap.md:1425` (§5 Q0 itself) — "Cheapest test: `ln -s` one skill, restart the CLI, see if it
  lists." Keep it only as the rejected branch inside the decided answer, never as an instruction.
- `WORK.md:13` — "Settle §5 Q0 — `ln -s` one skill, restart the CLI, see if it lists." Rewrite to
  name the ruling.
`LOOP.md` needs no edit — it already carries the settled ruling.

**Scope, restated so it is not lost:** PROJECT level only. Never `~/.claude/skills/` (shared across
checkouts, contradicts INS-02, and would let SKL-10 prune another instance's skills). Never an
agent-CLI plugin namespace, whose `plugin:skill` prefix breaks SKL-01's one identifier.

**Acceptance criteria:**
- [ ] AC1 — the §5 Q0 paragraph in `roadmap.md` contains `**decided**`, the words "render" and
  "never symlink", and the date `2026-08-25`.
- [ ] AC2 — §2.30 SKL-10 no longer requires a `ledger`, and contains the marker regexp and the five
  `check` findings.
- [ ] AC3 — the marker text written into `roadmap.md` matches the landed file byte for byte:
  `diff <(sed -n '5,6p' .claude/skills/nightly-sandcastle/SKILL.md) <(grep -A1 -F 'managed:doppelganger-skills v=1 src=plugins' roadmap.md | head -2)`
  exits 0. (The markers are on lines **5 and 6**, verified.)
- [ ] AC4 — §2.30 SKL-07 contains the phrase "output vocabulary" and the phrase "authorization
  token", and §2.26 TST-24's third clause uses the same two phrases. `grep -c 'output vocabulary'
  roadmap.md` is at least `2`.
- [ ] AC5 — `grep -rn 'ln -s' --include='*.md' . | grep -v '^./plan/'` returns at most one hit, and
  that hit is inside §5 Q0's record of the rejected branch. (Today it returns three:
  `WORK.md:13`, `roadmap.md:1214`, `roadmap.md:1425`.)
- [ ] AC6 — the IDs `SKL-04`, `SKL-07`, `SKL-10` and `TST-24` all still appear and nothing is
  renumbered.
- [ ] AC7 — `npm test` still exits 0.

**Commit:** `Settle §5 Q0 as render-not-symlink, fix SKL-10 ownership and the SKL-07 boundary (SKL-04, SKL-07, SKL-10)`

**Depends on:** J0.8.

**Risks / what could be wrong:** the REFUSE-on-stray-file rule makes `sync` less automatic than
SUP-08's crontab `sync`. That is deliberate — a crontab block has one file and a delimiter, a
directory tree does not, and SKL-10 already says the crontab precedent does not survive the port.

---

## J0.10 — `test/skills-example.test.ts` — gate the worked example  ·  SKL-01, SKL-03, SKL-04, SKL-06, SKL-07, SKL-08, SUP-20

**Goal:** the `nightly-sandcastle` skill already landed. Assert the checks it must satisfy, so N3's
real `skills check` has a pinned target to reproduce.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/test/skills-example.test.ts` (new)

**Note on scope:** N0 does **not** build the `skills render|sync|check` CLI — that is N3 (SKL-04,
TST-23). N0 writes the pure `render(source)` function as a local helper inside this test file and
asserts it against the one entry on disk. N3 moves that function into `cli/` unchanged and adds the
verbs around it. Say so in a comment at the top of the file.

**Do:** write these assertions, **one `test()` each**.
1. `plugins/nightly/skills/nightly-sandcastle/SKILL.md` exists and is a regular file (SKL-03).
2. Its YAML frontmatter `name` equals the directory name `nightly-sandcastle` (SKL-01 — the skill
   name IS the job name).
   **Unstated work:** this needs frontmatter parsing with zero dependencies. Do not add `yaml`.
   The block is delimited by a leading `---` line and the next `---` line; inside it, read only
   `^(\w+):\s*(.*)$` for the two keys that matter (`name`, `description`) and ignore the rest.
   Write ~12 lines and note in a comment that it is a `key: value` reader, not a YAML parser, and
   that a skill whose frontmatter needs more than that is a skill to simplify.
3. The directory name starts with a known SUP-20 stage prefix. Hold the prefix list in the test:
   `source- triage- backlog- watch- todo- corpus- nightly- retro- ops-`. `nightly-sandcastle`
   matches `nightly-`.
4. `render(source)` equals `.claude/skills/nightly-sandcastle/SKILL.md` byte for byte, using the
   render rule written in J0.9.
5. `.claude/skills/nightly-sandcastle/` contains exactly one entry, `SKILL.md`.
6. `lstat('.claude/skills/nightly-sandcastle').isSymbolicLink()` is `false`, and the same for
   `SKILL.md`. This pins the Q0 ruling in code, so nobody re-opens it by hand.
7. The marker's first line matches `^<!-- managed:doppelganger-skills v=1 src=(\S+) -->$` and the
   captured `src` resolves to the source directory from assertion 1.
8. **SKL-08 / HRN-16** — the SOURCE body contains neither the substring `plugins/nightly/skills/`
   (a skill never names a path into its own directory) nor `process.env` nor `$ENV` (a skill's only
   inputs are `promptArgs`).
9. **SKL-06, both ways, in the form N0 can check.** There is no job registry yet, so hold the
   expected set in the test: the set of directory names under `.claude/skills/` must equal the set
   under `plugins/*/skills/`, and both must equal `{ nightly-sandcastle }`. Comment it as the N0
   stand-in for TST-24, replaced by the registry walk at N3/N5.
10. **SKL-07, the output vocabulary.** The source contains the `<<<SANDCASTLE … SANDCASTLE>>>` block,
    and the `outcome=` values it names are exactly `changed|none|too-large|suite-failed` (verified at
    line 47 of the source today). Pin that set here so N3's `parseVerdict` has to match it. Add the
    comment:
    ```
    // This is an OUTPUT VOCABULARY, not an authorization token — see roadmap §2.30 SKL-07.
    // It changes what the caller LEARNS, never what the run is PERMITTED to do. Pinning it here
    // is what makes parseVerdict at N3 reproduce the markdown instead of drifting from it.
    // TST-24's ban is on tokens like JOB-T03's `agent`, which this file must never name.
    ```
    Also assert the source contains no `agent` verdict token, so the ban has a live subject.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `test/skills-example.test.ts` reports **10** passing tests (one per
  numbered assertion).
- [ ] AC2 — appending one space to `.claude/skills/nightly-sandcastle/SKILL.md` makes `npm test` exit
  non-zero with the drift message from J0.9 step 4, naming the first differing line. Verify by hand,
  then `git checkout` the file.
- [ ] AC3 — replacing `.claude/skills/nightly-sandcastle` with a symlink to the plugin source makes
  `npm test` exit non-zero from assertion 6, naming §5 Q0. Verify by hand, then restore.
- [ ] AC4 — creating `plugins/nightly/skills/nightly-orphan/SKILL.md` makes `npm test` exit non-zero
  from assertion 9 (an orphan skill is a prompt nothing runs). Verify by hand, then delete.
- [ ] AC5 — dropping a second file into `.claude/skills/nightly-sandcastle/` makes `npm test` exit
  non-zero from assertion 5. Verify by hand, then delete.
- [ ] AC6 — changing one `outcome=` value in the source makes `npm test` exit non-zero from
  assertion 10. Verify by hand, then revert.

**Commit:** `Gate the nightly-sandcastle worked example against SKL-03/04/06/07/08`

**Depends on:** J0.9.

**Risks / what could be wrong:** assertion 3's prefix list is a second copy of SUP-20's vocabulary
(the first is `roadmap.md`). N1 ships `stages.ts` as the single source; this test imports from it
then, and the duplicate goes. Note that in a comment so N1 does not miss it.

---

## J0.11 — Refresh the four stale corpus counts  ·  D15

**Goal:** make the numbers true, in every place they appear, with a stated measurement date — before
J0.12 writes a gate over them.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (lines 9, 11, 1188)
- `/home/hyhilman/projects/me/doppelganger/CLAUDE.md` (line 15)

**Do:**
1. Re-measure on this machine:
   ```
   X=/home/hyhilman/projects/xenith
   find $X/engine -name '*.ts' -not -path '*/node_modules/*' | wc -l
   find $X/engine -name '*.ts' -not -path '*/node_modules/*' -print0 | xargs -0 cat | wc -l
   find $X/engine/src -name '*.ts' -not -path '*/node_modules/*' | wc -l
   find $X/engine/src -name '*.ts' -not -name '*.test.ts' -not -path '*/node_modules/*' | wc -l
   ```
   Measured 2026-08-25: **251** files / **56,872** lines for `engine/**`; **240** files /
   **134** non-test for `engine/src/**`.
2. Update **all four** places (the first draft of this plan named only three; `roadmap.md:1188` and
   `CLAUDE.md:15` were missed):
   - `roadmap.md:9` — `engine/src/**` (238 files, 133 non-test) → **240 files, 134 non-test**.
   - `roadmap.md:11` — 249 TS files / 56,645 lines → **251 TS files / 56,872 lines**.
   - `roadmap.md:1188` (§3.0) — "19 files, 4,517 lines — 8% of the engine's 56,645" → recompute
     against 56,872. `4517 / 56872 = 7.9%`, so the phrasing stays **8%** and only the denominator
     changes. Keep the derivation visible so the next refresh knows the two numbers move together.
   - `CLAUDE.md:15` — "verified 2026-08-25: 249 TS files / 56,645 lines outside `node_modules`" →
     the new pair.
3. Give every one of the four a `measured 2026-08-25` stamp in the same sentence. That turns each
   count from a live claim into a dated observation, which is the only honest thing a number about
   somebody else's repository can be.

**Acceptance criteria:**
- [ ] AC1 — `grep -rn '56,645\|249 TS files\|238 files\|133 non-test' --include='*.md' . | grep -v '^./plan/'`
  returns **no hits**. (Today it returns four: `CLAUDE.md:15`, `roadmap.md:9`, `:11`, `:1188`.)
- [ ] AC2 — each of the four edited lines, or the sentence containing it, carries `2026-08-25`.
- [ ] AC3 — the four new numbers match a fresh run of the four commands in step 1.
- [ ] AC4 — `npm test` still exits 0.

**Commit:** `Refresh the four stale corpus counts with a measurement date (D15)`

**Depends on:** J0.10.

**Risks / what could be wrong:** the counts will be stale again within days — xenith is a live repo.
That is the whole reason J0.12 does not gate them live.

---

## J0.12 — `test/corpus.test.ts` — path and provenance  ·  D15, TST convention

**Goal:** gate what can honestly be gated about the reference corpus, and refuse to build a gate that
can never fail.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/test/corpus.test.ts` (new)

**The ±2% band is dropped. Here is why, and what replaces it.**
The first draft proposed a ±2% tolerance on the counts. That gate **could not catch the failure it
was written for**. The four stale numbers drift by 0.4%–0.84% (249→251 is 0.8%; 56,645→56,872 is
0.4%; 238→240 is 0.84%; 133→134 is 0.75%). Every one of them passes a ±2% gate. The band would have
stayed green through exactly the staleness that motivated it, and the only AC that made it fire used
a 10% change that nothing real will produce. A gate that cannot fail is worse than no gate: it
reports safety it does not provide.

Exact equality against the live corpus was the other option, and it is also wrong here — it goes red
whenever somebody else commits to xenith, on a number that is sizing evidence and not behaviour, and
a test that goes red for reasons outside the repo gets disabled. The landed
`nightly-sandcastle/SKILL.md` states the escape hatch itself: *"If you write a count, wire the test
that pins it; **if you cannot, do not write the count**."*

So the claim is **split into the part that must be true now and the part that is a dated
observation**, and each gets the gate it can actually carry:

| Claim | Kind | Gate | Runs in CI |
|---|---|---|---|
| The corpus path resolves; `engine/` and `compose-data/docker-compose.yml` exist | live | exact, skip when the corpus is absent | skipped |
| `roadmap.md` names no old macOS corpus path | live | exact | yes |
| The four counts | dated observation | **provenance**: same date stamp in all four places, and §3.0's 8% is consistent with the denominator | yes |
| The four counts vs. the live corpus | live, but not ours | **opt-in** re-measure under `CORPUS_RECHECK=1` | no |

The provenance gate is what catches the failure that actually happened: the same number lived in two
files, both went stale, and nothing noticed because nothing tied them together.

**Do:** write these assertions, **one `test()` each**.

1. **Path claim, always, no corpus needed.** Assert `roadmap.md` contains no `/Users/hyhilman/`
   path. **Scope this to `roadmap.md` only.** `CLAUDE.md:18` contains that path on purpose — it is
   the sentence recording that the old path was wrong — so a repo-wide grep is red on arrival.
   `roadmap.md` is the spec of record and has no reason to name it. Put that reasoning in a comment
   so nobody "fixes" the scope later.
2. **Path resolution.** Parse the corpus path out of `roadmap.md` line 5 rather than hard-coding it,
   so the document is the source of the claim. Allow `CORPUS_OVERRIDE` to replace it — **test-only,
   read only by this file, deliberately not an `EnvSpec` row** (KRN-06 governs knobs the engine
   reads at runtime; a test fixture switch is not one). Say that in a comment.
3. **Corpus present → assert.** `<corpus>/engine/` is a directory and
   `<corpus>/compose-data/docker-compose.yml` is a file. Both are named by D15 and §3.0.
4. **Corpus absent → skip, never fail.** `t.skip('reference corpus absent')`. CI has no xenith
   checkout and never will.
5. **Provenance, always, no corpus needed.** Collect every corpus count in `roadmap.md` and
   `CLAUDE.md` (the four lines J0.11 touched). Assert:
   - every one sits in a sentence carrying a `YYYY-MM-DD` stamp;
   - all the stamps are the **same** date — one snapshot, one date, four places;
   - §3.0's percentage is consistent with its own denominator: `round(4517 / <lines> * 100)` equals
     the percentage written there.
6. **Opt-in re-measure.** When `CORPUS_RECHECK=1` **and** the corpus is present, assert each of the
   four counts equals the live measurement **exactly** — no band. Otherwise `t.skip`. Also test-only,
   also no `EnvSpec`. The failure message says: re-measure, update all four places, move the date.
   Document in a comment that a human runs this when refreshing, and that a `nightly-polish` job at
   N5 is the natural owner.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 on this machine, and `test/corpus.test.ts` reports assertions 1, 2, 3
  and 5 as **passing** and assertion 6 as **skipped**.
- [ ] AC2 — `CORPUS_OVERRIDE=/nonexistent npm test` exits 0, with assertion 3 reported as **skipped**
  and assertions 1, 2 and 5 still passing. This is the CI shape, proven locally.
- [ ] AC3 — `CORPUS_RECHECK=1 npm test` exits 0 immediately after J0.11 (the numbers are fresh), and
  exits non-zero after any real change in xenith. Verify the first half now.
- [ ] AC4 — writing `/Users/hyhilman/Projects/xenith/` into `roadmap.md` makes `npm test` exit
  non-zero even with the corpus absent. Verify by hand, then revert.
- [ ] AC5 — changing the date stamp on `CLAUDE.md:15` alone makes `npm test` exit non-zero from
  assertion 5, naming both files. This is the assertion that catches the real historical failure.
  Verify by hand, then revert.
- [ ] AC6 — `npm test` with `CLAUDE.md:18` untouched exits 0 — the scoping in assertion 1 works.

**Commit:** `Gate the corpus path and the provenance of its counts (D15)`

**Depends on:** J0.11.

**Risks / what could be wrong:** the exact re-measure only runs when someone asks for it, so the
counts can still go stale silently — but they now go stale as *dated observations*, which is a
smaller and more honest failure than a live claim going wrong. CI protects the path and the
provenance; a human protects the numbers.

---

## J0.13 — CI: `npm test` and nothing else  ·  TST-21, TST-22

**Goal:** one GitHub Actions workflow that installs and runs `npm test`, plus a test that keeps it
that way.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/.github/workflows/test.yml` (new)
- `/home/hyhilman/projects/me/doppelganger/test/ci.test.ts` (new)

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
   - `node-version-file: .nvmrc` — one pin, one place (J0.2). Never a literal version here.
   - `npm ci`, not `npm install` — CI must fail on a stale lockfile rather than quietly fixing it.
   - Nothing else. No `npm run lint` (there is none), no `npm run build` (there is none, J0.8), no
     separate typecheck step — `pretest` already runs it, and a separate step would let the two
     drift.
2. Write `test/ci.test.ts` — **its own file, not an extension of `test/layout.test.ts`**, so J0.5's
   asserted count of 11 stays true. Three assertions, one `test()` each:
   - the workflow has exactly two `run:` steps, and they are `npm ci` and `npm test`;
   - the workflow references `.nvmrc` via `node-version-file` and contains no literal Node version;
   - the workflow names no linter, no bundler and no build script.
   Scan lines; add no YAML parser dependency (TST-22). The file is eleven lines.

**The reference has no CI at all.** `/home/hyhilman/projects/xenith/` has no `.github/workflows/`.
There is nothing to copy, so this file is written from CLAUDE.md's rule ("CI runs `npm test`, nothing
else") rather than from the corpus. Say so in the commit body.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `test/ci.test.ts` reports **3** passing tests.
- [ ] AC2 — adding a third `run:` step to the workflow makes `npm test` exit non-zero. Verify by
  hand, then revert.
- [ ] AC3 — replacing `node-version-file: .nvmrc` with `node-version: 22` makes `npm test` exit
  non-zero naming `.nvmrc`. Verify by hand, then revert.
- [ ] AC4 — the first CI run on `dev` is green. Record the run URL in the commit body or the PR.
- [ ] AC5 — `test/corpus.test.ts`'s corpus assertion is reported as **skipped** in the CI log, not
  failed — J0.12 AC2 proven in the environment it was written for.

**Commit:** `Run npm test in CI and nothing else (TST-21, TST-22)`

**Depends on:** J0.12 (AC5 needs the corpus gate to exist and to skip correctly).

**Risks / what could be wrong:** a line scan of YAML is brittle against reformatting. Accepted for an
eleven-line file; a parser dependency is not (TST-22). If the file ever grows, that growth is itself
the signal that CI stopped being "npm test and nothing else".

---

## J0.14 — Close N0 in `WORK.md` and `LOOP.md`

**Goal:** make the state files true: eleven N0 items, all ticked, each naming the job that did it.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/WORK.md` (N0 section, lines 6–16)
- `/home/hyhilman/projects/me/doppelganger/LOOP.md` (phase table, open items)

**Do:**
1. **Add two items to `WORK.md`'s N0 list.** Today it has nine, and two pieces of N0 work have no
   line to tick against:
   - `Node floor — `.nvmrc`, `engines`, capability test (DBS-01)` → J0.2
   - `Settle §5 Q5 — the build answer, measured; corrects ADO-16 (ADO-15/16)` → J0.7
   Then change the section header from **9 items** to **11 items**, and the `Items` cell for N0 in
   `LOOP.md`'s phase table from `9` to `11`.
2. **Fix the wrong "done" marker.** `WORK.md` line 14 reads "…corpus path, engine file counts
   (done 2026-08-25)" while its box is unticked — and J0.11 proved the counts were still stale on
   that date. Rewrite the line to name what was actually done and by which job (J0.11 refreshed all
   four, J0.12 gated the path and provenance).
3. Tick all eleven boxes, each line naming its `J0.x` job id.
4. In `LOOP.md`, fill the N0 row's Plan/Gap/Build/Verify columns.
5. In `LOOP.md`'s "Open items the loop must not silently skip", replace the §5 Q0 bullet with the
   ruling and a pointer to `roadmap.md` §5 Q0 and §2.30 SKL-10. Add a line that §5 Q5 was also
   settled at N0 (J0.7), since it changed ADO-16, and a line that the SKL-07 output-vocabulary
   boundary was drawn (J0.9), since it changes TST-24 at N3.

**Acceptance criteria:**
- [ ] AC1 — `sed -n '/^## N0/,/^## N1/p' WORK.md | grep -c '^- \[ \]'` prints `0`. (Today it prints
  `9`; the unscoped `grep -c '^- \[ \]' WORK.md` prints `163` for the whole file and must not be
  used.)
- [ ] AC2 — `sed -n '/^## N0/,/^## N1/p' WORK.md | grep -c '^- \[x\]'` prints `11`, and every one of
  those lines matches `J0\.[0-9]+`.
- [ ] AC3 — `grep -c 'done 2026-08-25' WORK.md` prints `0`.
- [ ] AC4 — `grep -n '9 items' WORK.md` returns no hit in the N0 section, and `LOOP.md`'s N0 row
  shows `11`.
- [ ] AC5 — `LOOP.md`'s N0 row no longer shows `—` in the Plan and Build columns, and its open-items
  list names §5 Q0, §5 Q5 and SKL-07 as settled.
- [ ] AC6 — `npm test` still exits 0.

**Commit:** `Close N0 in WORK.md and LOOP.md`

**Depends on:** J0.13.

**Risks / what could be wrong:** none.

---

## Summary of the resolved tensions

| Tension | Resolution |
|---|---|
| `pretest` = `typecheck && build` (CLAUDE.md, ADO-16) vs. TST-22 "no build step" | `pretest` is **`npm run typecheck`** and nothing else. Measured: a workspace link is a symlink and Node strips types through it, so ADO-16's stated reason is false for this repo's dev loop. The publish build (ADO-15) is real and stays, and it is a different script. J0.7 corrects the spec; J0.8's test separates the RUN path from the PUBLISH path by script name. |
| TST-22 wording that does not contradict itself | Three assertions: no linter/bundler **anywhere**; no compile in `test`/`pretest`/`typecheck` **anywhere**; `scripts.build` and `tsconfig.build.json` **absent at N0**, with the exact line that flips at ADO-15 written in a comment. `host/` is not a workspace — asserted once, in `test/layout.test.ts`. |
| Node version pin | Floor `engines.node: ">=22.18.0"` (type stripping unflagged; `node:sqlite` unflagged from 22.13, so 22.18 binds). Exact run version in **`.nvmrc` = `22.23.1`**; CI reads `.nvmrc` via `node-version-file`. A test asserts the running Node and `.nvmrc` both satisfy `engines`, and that `node:sqlite` actually opens a database. `@types/node` is pinned to **22.20.1**, not 26.x — types a major ahead bless APIs that do not exist at runtime (measured: 22.20.1 typechecks `node:sqlite` and `path.matchesGlob` at exit 0). **The reference pins Node nowhere and has no CI.** |
| `cli` is a workspace but §1 shows no `cli/`; `host/` is not a workspace | Measured: `npm install` exits 0 when a workspace glob matches nothing, so nothing on disk is *required*. **Create `cli/` as a real workspace** (J0.3) **and put it into §1** (J0.4) — a declared workspace with no directory is a claim no test can check. `host/` is created only when N2 gives it a real file, and J0.5 asserts `host/package.json` never exists. J0.5 asserts the workspace list and the filesystem agree **in both directions**. |
| Phase must be green at every commit | `package.json`, `tsconfig.json`, `.nvmrc` and the first test file are **one commit** (J0.2). Measured: manifest alone → `TS5058` exit 1; manifest + tsconfig with no `.ts` file → `TS18003` exit 2; all three → exit 0. Directories are created by the job that gives them a real file, never by a commit of their own — git stores no empty directory, and `.gitkeep` is banned by J0.5 assertion 9. |
| §5 Q0 | **Settled by the user, not by an experiment.** Render, no symlinks; every skill is a project skill and `.claude/skills/<job>/SKILL.md` is a regular file. J0.9 writes the ruling, the SKL-10 ownership rule (marker in the body at lines 5–6, no ledger, five `check` findings, refuse-never-re-render on a hand-edit) and deletes the three surviving `ln -s` prescriptions. J0.10 pins it with `isSymbolicLink() === false`. |
| SKL-07 / TST-24 vs. the landed skill's `outcome=` | TST-24 as worded would fail the worked example at N3. J0.9 draws the line in §2.30: an **output vocabulary** the skill must emit is allowed (it changes what the caller LEARNS); an **authorization token** is not (it changes what the run is PERMITTED to do). JOB-T03's `agent` is the precedent — enforced in `parseVerdict`, never named in the prompt. J0.10 pins the four `outcome=` values and asserts the skill names no `agent` token. |
| The two fixed `roadmap.md` claims | Split three ways. The **path** claim is gated everywhere including CI, scoped to `roadmap.md` (CLAUDE.md:18 names the old macOS path on purpose). The **counts** are refreshed in all four places with a date (J0.11) and gated on **provenance** — same stamp everywhere, §3.0's percentage consistent with its denominator — which is what catches the failure that actually happened. Exact re-measure is opt-in under `CORPUS_RECHECK=1`. |
| The ±2% band | **Dropped.** All four stale numbers drift 0.4%–0.84% and pass a ±2% gate — it could not catch the failure it was written for, and its only firing AC used a 10% change nothing real produces. Replaced by the provenance gate plus the opt-in exact re-measure. See J0.12 for the full reasoning. |

---

## Gaps I found in the roadmap

Two gaps from the first draft are now **closed by J0.4** (§1 did not name `test/` or `cli/`). The
rest stand.

1. **ADO-01 does not name the `cli` package.** It names `@doppelganger/kernel` and every
   `@doppelganger/plugin-*` as the release set. ADO-14 makes `cli` a workspace, so it is a fourth
   package with no naming rule and no place in the lockstep. This plan uses `@doppelganger/cli` at
   the same version. Confirm or correct.

2. **SKL-10's ledger claim is wrong.** It says a rendered copy "can only answer [ownership] by
   keeping a ledger of the last render". The worked example already carries a managed marker inside
   the rendered file, which answers it from the filesystem with no ledger. J0.9 rewrites the
   sentence; flagged here because it is a spec statement, not an implementation detail.

3. **ADO-16's premise is measurably false on the target Node.** Fixed by J0.7; listed so the GAP step
   does not report it as a plan error.

4. **TST-24's third clause bans something the worked example legitimately does.** "No `SKILL.md`
   carries … a verdict token that code owns" reads as banning `outcome=`, which is a report format.
   J0.9 rewrites it around the output-vocabulary / authorization-token distinction. Flagged because
   it changes a `TST` row, not just a plan.

5. **`.gitignore` is not in the roadmap.** A repo with `node_modules`, `dist/` and `*.db` files needs
   one, and INS-02 makes `*.db` a project-relative write that must not be committed. J0.1 adds it.
   Consider a row.

6. **No row says where repo-wide drift gates live before `kernel/contracts` exists.** TST-01 ships
   `contractTests` at N5, but N0–N4 need self-checks with nowhere named to put them. J0.4 puts
   `test/` into §1 with a note that they fold into `kernel/contracts` at N5. Confirm that reading, or
   say the split is permanent.

7. **Two test-only env knobs have no `EnvSpec` and should not get one.** `CORPUS_OVERRIDE` and
   `CORPUS_RECHECK` are read by `test/corpus.test.ts` and by nothing else. KRN-06 says every knob is
   an `EnvSpec` row on the owning plugin; a test fixture switch has no owning plugin and never
   reaches the runtime. Either state the exemption in KRN-06 or accept that these two live outside
   it. J0.12 documents the reasoning in a comment either way.

8. **§5 Q0's own text said "verify before M4 hand-writes a renderer" while §3's N0 said "before N3".**
   §3.2 maps `M4 → N3 · N5`, so they agreed, but the mixed numbering in one sentence cost a lookup.
   Moot for Q0 now (J0.9 settles it), but the same mixed reference may appear elsewhere.
