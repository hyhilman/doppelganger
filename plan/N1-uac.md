# N1 — The kernel the loop needs · UAC breakdown

N1 is done when the supervisor has something to stand on. Concretely: a SQLite wrapper that names the
file, the statement and the wait when a lock is refused, and never hides the fault by retrying · one
log line shape with two emitters that produce the same bytes, proved under every locale the machine
has · the `EnvSpec` row that is the only place a knob is defined · the stage-prefix vocabulary · a
bounded process pool and a timeout-bounded exec helper · and one `INSTANCE` name per checkout with a
gate that says every write is project-relative or `INSTANCE`-discriminated and there is no third
category.

No supervisor, no gate, no jobs, no schedule, no registry, no `boot()`. Those are N2, N3 and N5. What
N1 ships is only what the loop stands on, and every piece is green with a test in the same commit.

Four things are settled here that the roadmap states but does not resolve, and each one is written
down rather than left to the builder: what "byte-identical" means when two processes read two clocks
(J1.9) · how a real `SQLITE_BUSY` is produced on demand and how the wait is measured with no fake
clock (J1.6) · what "blind spot" means concretely, with a live example the reference misses (J1.6) ·
and how "there is no third category" is turned into an assertion (J1.19).

**Rule this plan obeys at every step: the phase is green at every commit.** `npm test` exits 0 after
every job. Each job adds a module and its test together — a module with no test is a claim, and this
repo does not ship claims. Walk the commits in order and no job imports a file a later job creates.

---

## Job order

1. **J1.1** — `roadmap.md` §1: the kernel module map. §1 says `runtime/log.ts`; LOG is a directory of
   four files. Every later job's file path has to be a path §1 already names, so the doc moves first
   (the J0.4 precedent). J1.19's map gate reads what this job writes, twenty commits later.
2. **J1.2** — `kernel/config.ts` (`EnvSpec`, `envStr`, `envNum`) + `kernel/time.ts`. Everything else
   reads a knob or a clock. Nothing depends on anything.
3. **J1.3** — `kernel/instance.ts` (INS-01). Needs J1.2's `envStr`. `paths.ts` needs the name.
4. **J1.4** — `kernel/paths.ts` + `dbPath` (DBS-07). Needs J1.2 and J1.3. Every default path in the
   kernel comes from here, so it lands before the first thing that writes a file.
5. **J1.5** — `kernel/runtime/db.ts` core (DBS-01/02/03/05/08). Needs J1.2 and J1.4.
6. **J1.6** — DBS-04 busy context + DBS-06 proxy. Split from J1.5 on purpose: J1.5 is the store,
   J1.6 is the reporter, and the reporter has three design questions of its own.
7. **J1.7** — `log/emit.ts` + `log/log.sh` (LOG-01/02/03/05/06/10). Needs J1.2's `time.ts`.
8. **J1.8** — `log/parse.ts` (LOG-07) + the render↔parse round trip. Needs J1.7's `Level`.
9. **J1.9** — TST-18, both emitters agree. Needs J1.7 and J1.8. The hardest job in N1.
10. **J1.10** — `log/route.ts` (LOG-04). Needs J1.8's `LogLine`.
11. **J1.11** — `log/cause.ts` (LOG-09) + a real dead-child fixture captured on this Node.
12. **J1.12** — `log/tail.ts` (LOG-08). Needs J1.6 (a database), J1.8 (a parser), J1.4 (a root).
13. **J1.13** — `log/index.ts` barrel + the `node:sqlite` warning contract. Last of the LOG jobs
    because it asserts a property of the whole directory.
14. **J1.14** — `kernel/runtime/pool.ts` (HRN-18). Independent; placed after LOG so the log jobs run
    as one block.
15. **J1.15** — `kernel/runtime/exec.ts` (HRN-19). Adds `EXEC_TIMEOUT_MS`, which the roadmap does not
    yet name — so it also edits §2.27.
16. **J1.16** — `kernel/stages.ts` (SUP-20) + the doc↔code prefix gate. Independent.
17. **J1.17** — TST-20, the shared-database traps and their gate. Needs J1.6.
18. **J1.18** — KRN-06's real gate: `process.env` is named in exactly one kernel file, and every
    `EnvSpec` row is read and every read has a row. Needs every knob to exist, so it comes after
    J1.15.
19. **J1.19** — INS-02 "no third category" + the §1 module map gate. Needs the whole tree.
20. **J1.20** — close N1 in `WORK.md` and `LOOP.md`.

---

## J1.1 — `roadmap.md` §1: the kernel module map  ·  §1, LOG-01, HRN-19

**Goal:** make §1 name the files N1 actually builds, so every later job's `Files touched` is a path
the spec already blesses, and J1.19 has a true map to gate against.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§1 layout block, and one
row in §2.22)

**Do:**
1. In the `kernel/` block, add the four root-level modules N1 builds, under the existing three:
   ```
   kernel/                   the framework. imports no plugin, ever.
     registry.ts             typed, named, hand-registered, duplicate-throws        N5
     plugin.ts               the manifest — one integration, every contribution     N5
     boot.ts                 validation over the whole graph                        N5
     config.ts               EnvSpec + the only file that names process.env         N1
     instance.ts             ONE INSTANCE name per checkout (INS-01)                N1
     paths.ts                ROOT, projectPath, dbPath — every default path         N1
     time.ts                 nowIso / today — the clock the log line reads          N1
     stages.ts               the stage-prefix vocabulary (SUP-20)                   N1
   ```
2. Replace `runtime/`'s `log.ts` with the directory it really is, and add `exec.ts`:
   ```
     runtime/
       db.ts  pool.ts  exec.ts                   v0 · N1
       log/   emit.ts  log.sh  parse.ts  route.ts  cause.ts  tail.ts  index.ts   v0 · N1
       gate.ts                                   v0 · N2
       lease.ts                                  v0 · N4
       queue.ts  quota.ts  shed.ts               v1
   ```
   `log.sh` is listed **inside `kernel/runtime/log/`**, next to `emit.ts`. LOG-01 says the two halves
   are one format; putting them in one directory is that sentence as a filesystem fact, and it is the
   one place a reader looking for the bash half will look.
3. Add one sentence under the block: *"`kernel/config.ts` is the `EnvSpec` reader and is not
   `host/config.ts`, which is the host app's own settings. The two never merge — one is the
   framework's knob mechanism, the other is one app's configuration."* §1 lists both and nothing
   said they were different things.
4. **Give `time.ts` an owning ID, in §2.22.** This is *Gaps* item 5, fixed here rather than deferred,
   because `CLAUDE.md` requires every commit to cite a feature ID and J1.2 creates `time.ts` in the
   very first code commit of the phase — a file with no ID breaks the rule immediately. **Do not mint
   a new ID.** Amend LOG-01's row to name the clock it already depends on:
   > **LOG-01** ONE line shape, two emitters (TS + bash), byte-identical; nothing else formats a
   > line. The `ts=` field comes from ONE clock helper (`kernel/time.ts`, `nowIso()`) so both
   > emitters agree on precision and suffix, not only on layout.
   That is the smallest true change: the clock is part of the line shape, so LOG-01 owns it, and
   `time.ts` commits now cite `LOG-01`.
5. Change nothing else in §1 or §2.22. Do not touch the five-manifest-members paragraph, do not
   renumber, do not reword LOG-02…LOG-10.

**Acceptance criteria:**
- [ ] AC1 — `sed -n '/^## 1\. Target layout/,/^## 2\./p' roadmap.md | grep -c 'log\.sh'` prints `1`.
- [ ] AC2 — the same range contains no line matching `log\.ts` (the file that never existed).
- [ ] AC3 — the same range names `config.ts`, `instance.ts`, `paths.ts`, `time.ts`, `stages.ts` and
  `exec.ts`, one line each: for each name, `grep -c` over the §1 range prints at least `1`.
- [ ] AC4 — `git diff --stat` names `roadmap.md` and nothing else, and the §1 block still closes
  before `## 2.`: `sed -n '/^## 1\. Target layout/,/^## 2\./p' roadmap.md | tail -1` prints
  `## 2. Feature inventory`. (The first draft asserted "no hunk outside lines 53–92", which its own
  steps 1–3 make false — they add about a dozen lines, so every later line number moves.)
- [ ] AC5 — `npm test` exits 0 (nothing regressed; `test/layout.test.ts` assertions 1–11 still pass).

- [ ] AC6 — `sed -n '/^### 2\.22/,/^### 2\.23/p' roadmap.md | grep -c 'time.ts'` prints `1`, so
  every later `time.ts` commit has an ID to cite.

**Commit:** `Name the N1 kernel modules, the log/ directory, and time.ts's owning row (LOG-01, HRN-19)`

**Depends on:** nothing.

**Risks / what could be wrong:** none. This is the plan closing its own gap before it can bite,
exactly as J0.4 did for `cli/` and `test/`.

---

## J1.2 — `EnvSpec`, the env readers, and the clock  ·  KRN-06

**Goal:** one row shape that IS a knob's definition, two readers that take a row rather than a
string, and the one clock the log line reads.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/config.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/time.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/config.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/time.test.ts` (new)

**Do:**

1. **`kernel/config.ts`** — the type KRN-06 names, verbatim, and nothing added to it:
   ```ts
   export interface EnvSpec {
     readonly key: string;
     readonly required?: boolean;
     readonly default?: string;
     /** One line. This IS the knob doc — there is no second place a knob is described. */
     readonly why: string;
   }
   ```
   Plus three functions and nothing else:
   - `envStr(spec: EnvSpec): string` — `process.env[spec.key]`, treating `""` as unset; else
     `spec.default`; else throw naming `spec.key` and `spec.why` when `required`; else throw
     "no value and no default".
   - `envOptional(spec: EnvSpec): string | undefined` — the same read, returning `undefined` rather
     than falling back or throwing. **Two knobs need it and both are in this phase:** `INSTANCE`
     (J1.3) and `ENGINE_ROOT` (J1.4) have defaults that are *computed* (a directory basename, a
     `cwd`) and no string can express them, so their rows carry no `default` and the caller supplies
     the fallback. Without this reader those two modules would have to name `process.env` themselves,
     which J1.18's gate forbids.
   - `envDynamic(key: string): string | undefined` — the one read taking a raw key rather than a
     spec, for the `<NAME>_DB` family (DBS-07). It carries the comment naming the family and pointing
     at the Gaps entry; J1.18 asserts it has exactly one call site. Landed here rather than in J1.4
     so `config.ts` is written once.
   - `envNum(spec: EnvSpec): number` — same resolution, then `Number(...)`; a value that is not a
     finite number `>= 0` throws naming the key, the value seen and `spec.why`. **This is a
     deliberate difference from the reference,** which silently falls back to the default on a
     garbage value: a typo'd `LOG_MAX_BYTES=8MB` becoming the default is the class of failure that is
     found at 3am, not at boot. Write the reason in the comment.
   - `errText(e: unknown): string`.

   **The readers take a spec, not a key.** That is the whole point: with `envNum(BUSY_TIMEOUT)` there
   is exactly one copy of the default and exactly one copy of the doc, so nothing can drift from
   anything. A `envNum("SQLITE_BUSY_TIMEOUT_MS", 5000)` signature puts the default in two places, and
   J1.18's gate could then only check that the two agree instead of making disagreement impossible.

2. **`kernel/time.ts`** — only what N1 consumes: `nowIso()` (ISO-8601, seconds precision, always
   `Z` — `new Date().toISOString().replace(/\.\d{3}Z$/, "Z")`) and `today()` (UTC `YYYY-MM-DD`).
   Do NOT port `hoursSince`, `age`, `minutesSince` or `wibDate` from the reference — nothing in N1
   calls them, and a helper with no caller gets its edge cases wrong in private.

3. **Tests**, one `test()` per numbered assertion.
   `config.test.ts`:
   1. `envStr` returns the env value when set.
   2. `envStr` treats `""` as unset and returns the default — a blank env var is how a `.env` line
      with nothing after the `=` arrives.
   3. `envStr` on a `required` spec with nothing set throws, and the message contains both the key
      and the `why`.
   4. `envNum` parses an integer, and `envNum` on `"8MB"` throws naming the key and the value.
   5. `envNum` rejects a negative value; `envOptional` returns `undefined` for an unset key and never
      falls back to `default`; `envDynamic("NOPE_DB")` returns `undefined`.
   6. `EnvSpec` shape rules, over a hand-built array of rows inside the test: key matches
      `^[A-Z][A-Z0-9_]*$` or is the one documented family form `<NAME>_DB`; `why` is non-empty and
      contains no `\n`; `required` and `default` are never both set.
   Assertion 6 is a **function** `assertSpecShape(rows)` exported from `config.ts`, because J1.18
   runs it over the real rows and this test runs it over a fixture of good and bad rows.
   `time.test.ts`:
   7. `nowIso()` matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$` and is exactly 20 characters.
   8. `nowIso()` is unchanged by `TZ`: run it in a child process with `TZ=Asia/Jakarta` and with
      `TZ=UTC` and assert both are within 5 seconds of the parent's `Date.now()`. This is the
      assertion J1.9 leans on when it says TZ cannot move the two emitters apart.
   9. `today()` is `nowIso().slice(0, 10)`.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/config.test.ts` reports 6 passing tests,
  `kernel/time.test.ts` reports 3.
- [ ] AC2 — `npm run typecheck` exits 0 on its own.
- [ ] AC3 — the gate fires: change `envNum` to `return Number.isFinite(v) ? v : Number(spec.default)`
  (the reference's silent fallback) and `npm test` exits non-zero on assertion 4 naming `8MB`. Revert.
- [ ] AC4 — the gate fires: change `assertSpecShape` to accept a two-line `why` and `npm test` exits
  non-zero on assertion 6. Revert.
- [ ] AC5 — `node -e "process.env.X='';import('./kernel/config.ts').then(m=>console.log(m.envStr({key:'X',default:'d',why:'w'})))"`
  prints `d`.
- [ ] AC6 — `grep -c 'process.env' kernel/config.ts` prints `1` or more and
  `grep -rl 'process.env' kernel --include='*.ts' | grep -v '.test.ts'` prints only
  `kernel/config.ts`. (The invariant J1.18 will gate; checked by hand from the first commit that
  could break it.)

**Commit:** `Add EnvSpec, the spec-taking env readers and the clock (KRN-06)`

**Depends on:** J1.1.

**Risks / what could be wrong:** `envNum` throwing where the reference falls back is a behaviour
change against the acceptance corpus. It is deliberate and argued above; if a later job finds a knob
that legitimately wants a lenient read, that knob states it at its own call site rather than
loosening the shared reader.

---

## J1.3 — `INSTANCE`: one name per checkout  ·  INS-01

**Goal:** one validated instance name, resolved from the env or the project directory's basename, so
N2's crontab markers and N4's lease owner have something to be discriminated by.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/instance.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/instance.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27 KNB — Core/paths list)

**Do:**

1. **`instance.ts`** exports three things and no more:
   - `INSTANCE_ENV: EnvSpec` = `{ key: "INSTANCE", why: "names this checkout; discriminates every host-global write (INS-01)" }`.
     No `default` on the row — the default is *computed* from the directory, which no string can
     express, and a row claiming a default it does not have would be a lie J1.18 could not catch.
   - `resolveInstance(raw: string | undefined, root: string): string` — **pure**. Returns
     `raw?.trim()` when non-empty, else `basename(root)`. Then validates and returns, or throws.
   - `INSTANCE: string` — the resolved value for this process, computed once at import as
     `resolveInstance(envOptional(INSTANCE_ENV), process.cwd())`. `envOptional`, not `envStr`,
     because the row has no `default` and `envStr` would throw before the basename fallback ran.

   **Wait — `ROOT` lands in J1.4.** To keep the dependency one-directional, `instance.ts` takes the
   root from `process.cwd()` at import and J1.4 does not change it: the supervisor spawns every child
   with `cwd = ROOT` (SUP-03), so `cwd` IS the root for every job by construction, and `paths.ts`
   resolves `ROOT` the same way. Write that sentence in the file.

2. **The validation rule, and why it is not `ns`'s.**
   ```
   /^[a-z][a-z0-9_-]{0,63}$/
   ```
   It is the intersection of three surfaces `INSTANCE` is interpolated into: a Docker object name
   (DKR-05/06), a shell word that needs no quoting (INS-03's crontab markers), and a token with no
   `:` so LSE-06's `<instance>:<host>:<pidns>:<pid>:<uuid8>` stays splittable on `:`. It is
   deliberately **not** DBS-03's `^[a-z][a-z0-9_]*$` — that one guards a value interpolated into
   DDL, and `INSTANCE` never reaches DDL. Add the comment: *if `INSTANCE` is ever used as a `ns`, it
   is re-validated at that call site, because a hyphen is legal here and illegal there.*

3. **The throw is an instruction, not a complaint.** A checkout at `/home/u/My Project` resolves to
   `My Project` and must fail with:
   ```
   INSTANCE: "My Project" is not a bare identifier (INS-01)
     it came from the project directory name: /home/u/My Project
     fix: export INSTANCE=my-project
   ```

4. **Add `INSTANCE` to `roadmap.md` §2.27's Core/paths knob list.** It is a real env knob that INS-01
   requires and §2.27 does not name — see *Gaps* below. One token added to the existing backtick
   list, nothing else touched.

5. **Tests**, one `test()` each:
   1. `resolveInstance("nonprod", "/a/b/doppelganger")` → `"nonprod"` (env wins).
   2. `resolveInstance(undefined, "/a/b/doppelganger")` → `"doppelganger"` (basename default).
   3. `resolveInstance("  ", "/a/b/doppelganger")` → `"doppelganger"` (whitespace-only is unset).
   4. Accepts: `"a"`, `"doppelganger"`, `"nonprod"`, `"x-1_2"`, `"a".repeat(64)`.
   5. Rejects, each with a message naming `INS-01`: `""`, `"My-App"`, `"1st"`, `"a b"`, `"a:b"`,
      `"a/b"`, `"."`, `".."`, `"-lead"`, `"a".repeat(65)`.
   6. This checkout's `INSTANCE` is a bare identifier. **Asserts the property, never the value** —
      pinning `"doppelganger"` would pin the reader's directory name, which is outside this repo.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/instance.test.ts` reports 6 passing tests.
- [ ] AC2 — `INSTANCE=nonprod node -e "import('./kernel/instance.ts').then(m=>console.log(m.INSTANCE))"`
  prints `nonprod`.
- [ ] AC3 — `INSTANCE='My App' node -e "import('./kernel/instance.ts').catch(e=>{console.error(e.message);process.exit(1)})"`
  exits 1 and the message contains `INS-01` and `export INSTANCE=`.
- [ ] AC4 — the gate fires: widen the regex to `/^.+$/` and `npm test` exits non-zero on assertion 5
  naming `a:b`. Revert.
- [ ] AC5 — `sed -n '/^### 2\.27/,/^### 2\.28/p' roadmap.md | grep -c '`INSTANCE`'` prints `1`.
- [ ] AC6 — `grep -c 'process.env' kernel/instance.ts` prints `0`. The knob is read through
  `config.ts`, which is the invariant J1.18 gates.

**Commit:** `Resolve and validate one INSTANCE name per checkout (INS-01)`

**Depends on:** J1.2.

**Risks / what could be wrong:** validating at import means a checkout in a badly-named directory has
a red suite from this commit onward, on every test file that imports the kernel. That is the intended
failure — INS-01 says "validated at boot" and there is no boot yet — but it makes the suite depend on
the checkout's directory name. Mitigated by AC3's message, which names the one-line fix. If it ever
becomes a real nuisance, the answer is to move the throw into a `assertInstance()` that N2's
supervisor calls, **not** to soften the regex.

---

## J1.4 — `ROOT`, `projectPath`, `dbPath`  ·  DBS-07, INS-02

**Goal:** every default path the kernel computes comes from one file, and every one of them lands
inside the checkout — which is the "project-relative" half of INS-02 made mechanical rather than
promised.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/paths.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/paths.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/.gitignore` (one line added)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27 KNB — Core/paths list)

`kernel/config.ts` is **not** touched: `envOptional` and `envDynamic`, the two readers this job needs,
landed in J1.2 so `config.ts` is written once and stays a leaf.

**Do:**

1. **`paths.ts`** exports exactly these, and the list being exactly this is itself gated in J1.19:
   - `ENGINE_ROOT_ENV: EnvSpec` = `{ key: "ENGINE_ROOT", why: "the checkout every project-relative write resolves inside (INS-02)" }`
     — no `default` key at all, because the fallback is `process.cwd()` and no string expresses it.
     Read with `envOptional`, the same shape as `INSTANCE`.
   - `ROOT: string` = `resolve(envOptional(ENGINE_ROOT_ENV) ?? process.cwd())`.
   - `projectPath(...segs: string[]): string` — `resolve(ROOT, ...segs)`, and **throws if the result
     escapes `ROOT`** (a `..` segment). Without that check `projectPath("../../etc/x")` is a
     third-category write wearing the first category's name.
   - `STATE_DIR_ENV: EnvSpec` = `{ key: "ENGINE_STATE_DIR", default: ".doppelganger/state", why: "where every integration's database lives, resolved inside the checkout (DBS-01, INS-02)" }`
     and `STATE_DIR: string` = `projectPath(envStr(STATE_DIR_ENV))`.
     **The row carries a `default`, and it is a ROOT-RELATIVE string, not an absolute path.** This is
     pinned because the first draft left it ambiguous: the value is a plain `default` (so J1.18's
     defaulted-row check covers it and the count is **five**), while `projectPath` is what makes it
     absolute — which is precisely INS-02's project-relative category, expressed once. An operator
     setting `ENGINE_STATE_DIR=/var/lib/x` gets a `projectPath` throw, not a silent third-category
     write, and that is the intended behaviour.
   - `NAME_DB_ENV: EnvSpec` = `{ key: "<NAME>_DB", why: "redirect one integration's database to a throwaway file for a safe run (DBS-07, SAF-05)" }`
     — the row for the family, so J1.18's doc gate has something to match against §2.27's `<NAME>_DB`.
   - `dbPath(name: string): string` — `envDynamic(\`${name.toUpperCase()}_DB\`) ?? join(STATE_DIR, \`${name}.db\`)`
     (DBS-07). The dynamic read lives in `config.ts` (J1.2), so J1.18's "only `config.ts` names
     `process.env`" stays true.

2. **`ROOT` locates itself from `cwd`, not from `import.meta.dirname`.** The reference walks three
   levels up from its own file, and that is right for an app that is only ever a checkout. It is
   wrong for a published framework: at N5 `kernel/` sits under `node_modules/@doppelganger/kernel/dist/`
   and three levels up is not the host repo. SUP-03 already spawns every child with `cwd = ROOT`, so
   `cwd` is the root by construction, and `ENGINE_ROOT` is the explicit override for anything the
   supervisor did not start. Write this as a comment; it is a deliberate divergence from the
   reference.

3. **Rename `FACTORY_STATE_DIR` → `ENGINE_STATE_DIR` in `roadmap.md` §2.27.** §2.27 already renames
   `XENITH_ROOT` → `ENGINE_ROOT`; `FACTORY_` is a leftover from the same rename that was missed. Add
   `ENGINE_STATE_DIR` and strike `FACTORY_STATE_DIR` on the same line. See *Gaps*.

4. **`.gitignore`** gains one line: `.doppelganger/`. `*.db` already ignores the files, but not the
   directory, and `test/layout.test.ts` assertion 9 fails on a state directory left empty. Put the
   reason in the commit body — J0.1 said "exactly these lines and nothing else", so this is a
   deliberate amendment, not a drift.

5. **Tests**, one `test()` each:
   1. `projectPath("a", "b")` starts with `ROOT` and ends `/a/b`.
   2. `projectPath("../escape")` throws naming INS-02.
   3. `projectPath()` with no segments returns `ROOT`.
   4. `dbPath("lease")` with no override is inside `STATE_DIR` and inside `ROOT`.
   5. `LEASE_DB=/tmp/x.db` makes `dbPath("lease")` return `/tmp/x.db` — read in a child process,
      because `dbPath` reads the env at call time but `STATE_DIR` resolves at import.
   6. `ENGINE_ROOT=/tmp/fake-root` in a child process moves `ROOT`, `STATE_DIR` and `dbPath("lease")`
      all together — they are one anchor, not three.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/paths.test.ts` reports 6 passing tests.
- [ ] AC2 — `ENGINE_ROOT=/tmp/fake node -e "import('./kernel/paths.ts').then(m=>console.log(m.dbPath('lease')))"`
  prints `/tmp/fake/.doppelganger/state/lease.db`.
- [ ] AC3 — `LEASE_DB=/tmp/x.db node -e "import('./kernel/paths.ts').then(m=>console.log(m.dbPath('lease')))"`
  prints `/tmp/x.db`.
- [ ] AC4 — the gate fires: drop the escape check from `projectPath` and `npm test` exits non-zero on
  assertion 2. Revert.
- [ ] AC5 — `git check-ignore -q .doppelganger/` exits 0.
- [ ] AC6 — `sed -n '/^### 2\.27/,/^### 2\.28/p' roadmap.md | grep -c 'FACTORY_STATE_DIR'` prints `0`
  and the same range contains `ENGINE_STATE_DIR`.
- [ ] AC7 — `grep -c 'process.env' kernel/paths.ts` prints `0`.

**Commit:** `Anchor every default path in ROOT, and add dbPath with its <NAME>_DB override (DBS-07, INS-02)`

**Depends on:** J1.2, J1.3.

**Risks / what could be wrong:** `ROOT = cwd` is right for a supervised child and wrong for a human
running `node kernel/something.ts` from a subdirectory. `ENGINE_ROOT` is the escape, and N2's
`validate()` is where a wrong root becomes loud. The reference's self-location cannot be reinstated
later without breaking the published case, so this decision is one-way — it is called out here so
the GAP step can argue with it now rather than at N5.

---

## J1.5 — `openDb`: the store  ·  DBS-01, DBS-02, DBS-03, DBS-05, DBS-08

**Goal:** one SQLite file per integration, namespaced tables, append-only migrations that record
their version in the same transaction as the step, `tx` that begins IMMEDIATE, and `closeAll`.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/db.ts` (new — creates `kernel/runtime/`)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/db.test.ts` (new)

**Do:**

1. Port `openDb` from `/home/hyhilman/projects/xenith/engine/src/lib/db.ts` — the `Db` interface
   (`path`, `handle()`, `tx`, `migrate`, `metaGet`, `metaSet`, `close`), the by-path cache, the
   `mkdirSync(dirname(path))`, the two pragmas on the BARE handle, and `closeAll()`. **Leave the
   proxy and the busy context out** — they are J1.6.
2. `assertNs` guards `^[a-z][a-z0-9_]*$` and runs on `migrate`, `metaGet` and `metaSet` (DBS-03).
3. `tx` runs `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` (DBS-05). Carry the reference's comment: a
   DEFERRED begin takes a read snapshot and an intervening commit refuses the upgrade outright —
   `SQLITE_BUSY` that `busy_timeout` never waits out.
4. `migrate(ns, steps)` writes `<ns>_meta.schema_version` in the SAME `tx` as the step it describes.
   That pairing is the expensive one to break: split across two transactions, a step that throws
   halfway still reads as applied and nothing ever retries it.
5. **DBS-02 gets an enforcer, which the reference does not have.** After each step runs inside its
   `tx`, diff `sqlite_master` before and after and throw naming the offender if any table or index
   created by that step does not start with `<ns>_`. The throw is inside the transaction, so it rolls
   the step back and does not record the version. DBS-02 states "namespaced tables" as a rule and
   names nothing that checks it; N1 is the one place there is a single implementation to put it in.
   Flagged in *Gaps* as an addition to be confirmed.
6. **Tests**, adapted from `db.test.ts` in the reference, one `mkdtempSync` directory for the file and
   a fresh path per test (`db-${n++}.db`) — the discipline J1.17 turns into a gate:
   1. `assertNs` refuses `"queue; DROP TABLE queue_meta"`, `"Queue"`, `"1queue"`, `"pr-review"`,
      `"pr review"`, `""` — on all three of `migrate`, `metaGet`, `metaSet`.
   2. `assertNs` accepts `queue`, `slack`, `pr_review`, `log`, and an empty step list records no
      version.
   3. `migrate` applies each step once; a re-run applies nothing (a green second call IS the
      idempotence assertion, because `ALTER TABLE` on an existing column throws).
   4. A grown list applies only the appended step.
   5. A step that throws leaves the version at the last GOOD step, and the retry re-runs it.
   6. `tx` rolls every write back when the body throws.
   7. `tx` holds the write lock from `BEGIN`: inside the body, a second `DatabaseSync` connection's
      insert is refused with `database is locked`, and the body's own later write succeeds. This is
      the DBS-05 assertion, and it is deterministic — the second connection is opened with
      `PRAGMA busy_timeout = 50`.
      **The body MUST read before it writes.** A `SELECT COUNT(*)` first, then the insert. Without
      the read, a DEFERRED `BEGIN` takes no lock at all until the write, and the mutation in AC2
      would not fire — the test would pass under both `BEGIN` and `BEGIN IMMEDIATE` and prove
      nothing. Read-then-write is also the real shape DBS-05 exists for: it is the body that loses
      the upgrade.
   8. `tx` returns the body's value once committed.
   9. The cache hands one path back as the same handle; `close()` evicts it and the next `openDb` is
      a live handle over the same file's surviving state (DBS-08).
   10. `closeAll()` empties the cache: after it, `openDb(p) !== theOldHandle` for every path opened.
   11. DBS-02's enforcer: `migrate("app", ["CREATE TABLE oops (id INTEGER)"])` throws naming `oops`
       and `app_`, and `metaGet("app","schema_version")` is still `null`.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/runtime/db.test.ts` reports 11 passing tests.
- [ ] AC2 — the gate fires: change `BEGIN IMMEDIATE` to `BEGIN` and `npm test` exits non-zero on
  assertion 7 — the intervening insert now **succeeds** where the test requires it to be refused.
  Revert. (The first draft quoted an expected error string SQLite never produces. The driver's
  message is `database is locked`; the refused-upgrade case carries `errcode 517`, measured. Assert
  on `/database is locked|SQLITE_BUSY/`, never on prose.)
- [ ] AC3 — the gate fires: move the `schema_version` write out of the step's `tx` into its own `tx`
  and `npm test` exits non-zero on assertion 5, because the failed step now reads as applied. Revert.
- [ ] AC4 — the gate fires: relax `assertNs` to `^[a-zA-Z][a-zA-Z0-9_]*$` and `npm test` exits
  non-zero on assertion 1 naming `Queue`. Revert.
- [ ] AC5 — the gate fires: drop the `sqlite_master` diff and `npm test` exits non-zero on assertion
  11. Revert.
- [ ] AC6 — `find . -name '*.db' -not -path './node_modules/*' -not -path './.git/*' | wc -l` prints
  `0` after a full `npm test`: the suite left no database inside the checkout.
- [ ] AC7 — `grep -c 'process.env' kernel/runtime/db.ts` prints `0`.

**Commit:** `Add openDb with namespaced append-only migrations and an IMMEDIATE tx (DBS-01, DBS-02, DBS-03, DBS-05, DBS-08)`

**Depends on:** J1.2 (`envNum` for the busy-timeout pragma), J1.4 (nothing imported yet, but
`dbPath` is the caller this file exists for).

**Risks / what could be wrong:** the `sqlite_master` diff runs on every migration step. It is one
`SELECT name, type FROM sqlite_master` before and after, inside a transaction that is already open —
negligible, and migrations run once per process start. If a future step legitimately creates an
un-prefixed object (a temp table, a trigger on a foreign table), the enforcer needs an explicit
opt-out and that is a spec change, not a patch.

---

## J1.6 — The busy context and the proxy  ·  DBS-04, DBS-06

**Goal:** every statement that a held write lock can refuse reports the file, the one-line SQL and
the wait — and no new call site can be added that does not.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/db.ts` (edit)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/db.test.ts` (edit)
- `/home/hyhilman/projects/me/doppelganger/test/no-raw-sqlite.test.ts` (new)

### What "blind spot" means, concretely

A blind spot is a code path that executes SQL against the file and, when the lock is refused, reaches
the log as the driver's bare `database is locked` — no file, no statement, no wait. Three facts are
missing and all three are the ones that narrow it.

On Node 22.23.1 the members that execute SQL are, **measured**:

```
DatabaseSync   aggregate applyChangeset close createSession enableLoadExtension
               exec function loadExtension location open prepare
StatementSync  all columns get iterate run setAllowBareNamedParameters
               setAllowUnknownNamedParameters setReadBigInts setReturnArrays
```

**The reference wraps `run`, `get`, `all` — and `StatementSync.iterate` exists and is not in that
set** (`xenith/engine/src/lib/db.ts:79`). A caller writing `for (const row of stmt.iterate(...))`
executes SQL through an unwrapped path. That is a live blind spot in the acceptance corpus, and N1
must not inherit it.

**But adding `"iterate"` to the executor set fixes nothing, and this is the part the first draft of
this plan got wrong.** Measured on Node 22.23.1: `iterate()` builds the iterator and returns it
**without throwing**. The lock refusal surfaces on the **first `next()`**, inside the `for…of`:

```
B iterate() returned WITHOUT throwing
B threw on first next(): database is locked errcode= 5
```

So wrapping the *call* wraps the moment nothing happens. **The wrapper must wrap the returned
iterator's `next`.** `instrument`'s statement proxy therefore has two shapes, not one:

- `run` / `get` / `all` — wrap the call itself; that is where they execute.
- `iterate` — call it inside `withBusyContext` (a refusal at build time is still possible), then wrap
  the returned iterator so that **`next()` runs inside `withBusyContext` too**, carrying the same
  `path` and `sql`. Return a proxy over the iterator, and keep `[Symbol.iterator]` returning the
  proxy so `for…of` goes through it rather than around it.

The N1 executor set is `{ run, get, all, iterate }` on statements — with `iterate` handled by the
second shape — and `{ exec, prepare }` on the handle. `applyChangeset` also writes; nothing uses it,
so it is banned by name rather than wrapped (a wrapper with no caller gets its edge cases wrong in
private).

### The fixture that can actually contend an `iterate`

**Under WAL a reader is never blocked.** Measured: with a second connection holding `BEGIN IMMEDIATE`,
a `SELECT … ` driven through `iterate()` completes normally — `A WAL select-iterate: NO ERROR`. So the
hog that works for `run`, `get` and `all` produces *no error at all* for a plain select, and a test
built on it would pass while proving nothing.

Two fixtures were measured and both work. **This plan uses the first**, because it keeps every busy
test on one journal mode and one hog:

- **`INSERT … RETURNING` under WAL** — a statement that WRITES and yields rows, so it is refused like
  any other write while still being consumed through `iterate()`. Measured above: returns from
  `iterate()`, throws `database is locked` (errcode 5) on the first `next()`.
- *(Rejected, kept for the record)* a rollback-journal `SELECT` under `BEGIN EXCLUSIVE`. It works, but
  it needs a second journal mode inside a file whose whole point is WAL behaviour, and a reader who
  later changes the pragma would silently disarm the test.

### How a NEW call site is proved unable to bypass

Three assertions, at three different levels, because no one of them is enough:

1. **Nobody can reach the driver.** `db.handle()` returns the proxy; the bare handle is a closure
   local and is never exported. A static gate (`test/no-raw-sqlite.test.ts`) asserts that
   `node:sqlite` is imported by exactly one non-test file in the repo — `kernel/runtime/db.ts` — and
   by exactly two test files, each named in the test with its reason (`db.test.ts` needs a raw
   contending connection; `test/node.test.ts` is N0's capability probe). A new module importing the
   driver directly goes red.
2. **Everything currently wrapped really reports.** Four assertions under real contention, one per
   statement method, plus `exec` and `tx`.
3. **A sixth method cannot appear unnoticed.** The test reads the driver's own member list at
   runtime — `Object.getOwnPropertyNames(Object.getPrototypeOf(stmt))` — and asserts it equals a
   literal list in the test file. The comment above it says: *if a Node upgrade adds a member to
   `StatementSync`, this assertion goes red first and a human decides whether the new member executes
   SQL.* This pins an API surface outside the repo, which N0 warns against — the difference is that
   Node's version is pinned by `.nvmrc`, which is IN this repo, so the list can only change in a
   commit that also changes `.nvmrc`. That is the whole point: it fails on a Node upgrade instead of
   at 3am.

### How a real `SQLITE_BUSY` is produced deterministically

A second `DatabaseSync` on the same file, `PRAGMA journal_mode = WAL`, `BEGIN IMMEDIATE`, one insert.
That connection now holds the WAL write lock and holds it for the whole of the call under test — it
is released in a `finally` **after** the assertion, so there is no race and no timing dependency. A
mocked throw would pass against a wrapper that has never seen a real error, so both are used: the
real hog proves the wrapper sees the driver's actual shape, and a synthetic throw proves the
arithmetic.

**This hog refuses a WRITE, and that is its whole reach.** It covers `run`, `get`, `all`, `exec` and
`tx` because each of those executes a write or takes the write lock. It does **not** contend a plain
`SELECT` — under WAL a reader is never blocked — which is why `iterate` needs the
`INSERT … RETURNING` fixture named above rather than this one. Two fixtures, one hog.

### How `waited=` is measured with no fake clock

`Date.now()` before the call, `Date.now()` after the catch. Measured five times on this machine:
`busy_timeout=200 → waited=201ms`, `busy_timeout=5000 → waited=5005ms`. Two assertions, one per end
of the discriminator:

- **The full wait.** With `PRAGMA busy_timeout = 200` on the instrumented handle, `waited` is
  `>= 180`. A **lower bound only** — a loaded host makes a wait longer and never shorter, so an
  upper bound is the flaky half and it protects nothing.
- **The refusal.** A DEFERRED `BEGIN`, a `SELECT` that takes a read snapshot, another connection's
  commit in between, then the upgrade. Measured: `waited=0ms errcode=517`, **with `busy_timeout`
  left at its 5000 default**. `waited` is asserted `< 50`.

**Why the 517 fixture rather than `busy_timeout = 0`.** Both produce a near-zero wait, but only one
of them means anything: DBS-04's claim is that a small number tells you *no timeout would ever have
helped*. Zeroing the timeout makes that trivially true and proves nothing about the fault. The
deferred-upgrade refusal shows the near-zero wait **while the real timeout is in force**, which is
the fault the roadmap's file header was actually hunting — and it is the shape DBS-05's
`BEGIN IMMEDIATE` exists to move off the reader and onto a writer where the timeout applies. The two
numbers land two orders of magnitude apart, and the test asserts that gap as well as each bound.

**On the `< 50` upper bound.** It is one of exactly two upper bounds in N1 (the other is J1.14's
"the first spawn starts at once"), and both are named in the summary table rather than hidden behind
a blanket "one direction only" claim. Neither measures elapsed work: the refusal involves no waiting
at all — `0ms` on every measured run — so 50 ms is headroom around a shape, not a race.

### How "does NOT retry" is proved

`withBusyContext` is exported as a test seam (the precedent is the reference's `exec.ts`, which
exports `run` for exactly this reason). Then:

```ts
let calls = 0;
assert.throws(() => withBusyContext("/p", "SQL", () => { calls++; throw new Error("database is locked"); }));
assert.equal(calls, 1, "DBS-04: the wrapper must not retry — the wait is the discriminator");
```

Exact, deterministic, and it goes red the moment anyone adds a loop. A wall-clock proxy for the same
claim would only catch a retry count large enough to notice.

### How "does NOT raise the timeout" is proved

`openDb` writes `PRAGMA busy_timeout` exactly once, on the bare handle, from
`envNum(BUSY_TIMEOUT_ENV)`. The test reads `PRAGMA busy_timeout` back after a busy throw and asserts
it is unchanged. A wrapper that escalates on failure goes red.

**Do:**
1. Add `isBusy`, `oneLine` (collapse whitespace, trim, slice 160), `withBusyContext` (exported),
   `EXECUTES = new Set(["run","get","all","iterate"])`, `passThrough`, `instrument`.
2. `BUSY_TIMEOUT_ENV: EnvSpec` = `{ key: "SQLITE_BUSY_TIMEOUT_MS", default: "5000", why: "how long a statement waits on a held write lock; deliberately unchanged while the cause is unknown (DBS-04)" }`.
   Read through `envNum`. This is `db.ts`'s only knob.
3. The pragmas stay on the BARE handle, before `instrument` — wrapping the setup that makes
   contention survivable in the reporter that exists to describe contention is circular. Assert it:
   the error message from a contended `tx` names `BEGIN IMMEDIATE`, and a `PRAGMA` never appears in
   any `sql=` field.
4. The error message shape is fixed and gated:
   `database is locked: <path> waited=<n>ms sql=<JSON-quoted one-line SQL>` with the driver's error
   kept as `cause`.
5. **Tests** added to `db.test.ts`, one `test()` each:
   1. A contended prepared `run` names the file and `INSERT INTO t_busy`.
   2. A contended `get` reports the same way.
   3. A contended `all` reports the same way.
   4. A contended `iterate` reports the same way — driven through
      `INSERT INTO t_busy (v) VALUES ('i') RETURNING id`, consumed with `for (const r of stmt.iterate())`,
      and the throw is expected **from the loop**, not from `iterate()`. Assert the message names the
      file, `INSERT INTO t_busy`, and `waited=`. **This is the assertion the reference does not
      have.**
   4b. A plain `SELECT … ` through `iterate()` under the same hog completes with **no error** — the
      measured fact that makes 4's fixture necessary. Pinned so nobody "simplifies" 4 back to a
      select and gets a green test that exercises nothing.
   5. A contended `exec` reports.
   6. A contended `tx` reports and names `BEGIN IMMEDIATE` — the body never runs.
   7. `waited=` is `>= 180` with `busy_timeout = 200`.
   8. `waited=` is `< 50` **at the DEFAULT `busy_timeout` of 5000**, for the refused-outright shape.
      The fixture is the one DBS-04's own text describes: a DEFERRED `BEGIN`, a `SELECT` that takes a
      read snapshot, another connection's commit in between, then the upgrade. Measured:
      `waited=0ms errcode=517 busy_timeout=5000`. This is strictly better than forcing
      `busy_timeout = 0`, because it shows the near-zero wait **with the real timeout in force** —
      which is exactly what "no timeout would ever have helped" means, and it is unarguable in a way
      that a zeroed timeout is not. Assert `waited` is `< 50` and that the two shapes (this one and
      assertion 7's) produce numbers two orders of magnitude apart.
   9. `withBusyContext` calls its function exactly once.
   10. `PRAGMA busy_timeout` reads back unchanged after a busy throw.
   11. `sql=` is one line and at most 160 characters, given a 400-character multi-line statement.
   12. The driver's error is kept as `cause`.
   13. The uncontended path is untouched: an insert and a select behave normally, and
       `Object.getPrototypeOf(rows[0]) === null` — `node:sqlite` returns null-prototype rows and the
       proxy must PRESERVE that rather than normalise it away.
   14. `StatementSync`'s member list equals the pinned literal list (see above).
   15. `DatabaseSync`'s member list equals the pinned literal list, and `applyChangeset` is not named
       in any **non-test** file under `kernel/`. The scope matters: the pinned literal in assertion
       15 lives in `kernel/runtime/db.test.ts` and contains the word `applyChangeset`, so an
       unscoped search would make this assertion fail on its own text.
6. **`test/no-raw-sqlite.test.ts`**: one `test()` — the set of files under the repo (outside
   `node_modules`, `.git`) importing `node:sqlite` equals the three-entry allowlist.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0; `kernel/runtime/db.test.ts` reports 27 passing tests (11 from J1.5,
  plus 15 and the added 4b) and `test/no-raw-sqlite.test.ts` reports 1.
- [ ] AC2 — the gate fires, and it must be **this** mutation: keep `"iterate"` in `EXECUTES` and
  return the raw iterator instead of the wrapped one. `npm test` exits non-zero on assertion 4 with
  the bare `database is locked` and no `waited=`. Revert.
  **Do not use "remove `iterate` from `EXECUTES`" as the mutation — measured, it is a no-op in both
  directions**, because the call never throws and the set is only consulted at call time. An AC whose
  mutation cannot change the outcome is how a gate ships green over an open blind spot.
- [ ] AC3 — the gate fires: wrap `withBusyContext`'s body in `for (let i=0;i<2;i++) try { return fn() } catch {}`
  and `npm test` exits non-zero on assertion 9 with `calls` of `2`. Revert.
- [ ] AC4 — the gate fires: add `raw.exec("PRAGMA busy_timeout = 30000")` to the catch path and
  `npm test` exits non-zero on assertion 10. Revert.
- [ ] AC5 — the gate fires: add **and use** the driver in `kernel/paths.ts` (the only other kernel
  module at this commit) —
  `import { DatabaseSync } from "node:sqlite"; export const _probe = () => new DatabaseSync(":memory:");`
  — and `npm test` exits non-zero from `test/no-raw-sqlite.test.ts` naming the file. Revert.
  The binding must be **consumed**: see the standing note on mutations at the top of this plan.
- [ ] AC6 — the gate fires: return `bare` instead of `raw` from `handle()` and `npm test` exits
  non-zero on assertions 1–5 at once. Revert.
- [ ] AC7 — measure the run time: `npm test` still finishes in under 60 seconds on this machine.
  Assertions 7 and 8 add ~200 ms and no more; if the number moves by seconds, a hog was left holding
  a lock.

**Commit:** `Report SQLITE_BUSY with file, statement and wait, through a proxy no call site can bypass (DBS-04, DBS-06)`

**Depends on:** J1.5.

**Risks / what could be wrong:**
- The pinned driver member lists will go red on the first Node bump. That is the feature, but the
  builder must write the comment that says so, or the next reader deletes the assertion.
- **`iterate` is settled, not open.** The first draft of this plan filed it under Risks as "the error
  may surface on the first `next()` — a discovery, not a plan change". It is neither a maybe nor a
  discovery: measured, `iterate()` returns without throwing and the refusal always lands on the first
  `next()`. The design above wraps the iterator. The residual risk is narrower — the proxy must keep
  `[Symbol.iterator]` returning the proxy, or `for…of` walks around it and assertion 4 goes red
  immediately, which is the right way to find out.
- The `INSERT … RETURNING` fixture writes a row on the runs where it does NOT throw. Each busy test
  gets its own database file under `mkdtempSync`, so nothing carries between them — but a builder who
  reuses `seeded()` across assertions must re-read J1.17's trap 1 first.

---

## J1.7 — `emit.ts` and `log.sh`: the one line shape  ·  LOG-01, LOG-02, LOG-03, LOG-05, LOG-06, LOG-10

**Goal:** two emitters, one format, written together in one commit because a format only one side can
produce is not a format.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/emit.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/log.sh` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/emit.test.ts` (new)

### The line shape, stated once so two implementations can match it

```
ts=<ISO seconds, Z> level=<debug|info|warn|error> job=<value> src=<ts|sh> event=<value> [k=<value>]… [msg=<value>]
```

Five fixed fields, in that order, then the caller's fields in insertion order, then `msg` last always.
Fields are separated by exactly one space (0x20). The line ends with exactly one LF (0x0A) and no CR.

### The escaping rules, named exactly

A value renders **bare** if and only if it is non-empty and every character is one of the 70:

```
A-Z  a-z  0-9  _  .  /  :  @  #  +  -
```

Otherwise it renders **quoted**: `"`, then the value with these three substitutions applied in this
order, then `"`.

1. `\` (0x5C) → `\\`
2. `"` (0x22) → `\"`
3. LF (0x0A) → one space (0x20)

Explicitly **not** transformed, on either side: CR (0x0D), TAB (0x09), and every byte ≥ 0x80. They
pass through inside the quotes as raw bytes. So:

- **spaces** → quoted, kept.
- **quotes** → quoted, escaped.
- **`=`** → not in the bare set, so quoted. `a=b` is one value on both sides.
- **newlines** → quoted, and folded to a space. A log line is a line.
- **non-ASCII** → always quoted (never in the bare set) and emitted as raw UTF-8. No `\u` escaping on
  either side, so `café` costs the same bytes in both.
- **the empty string** → quoted as `""`. Bare would make `k=` read as a key with the next token as
  its value.
- **NUL (0x00)** → out of scope, stated rather than handled: `execFileSync` argv cannot carry it, so
  the bash side can never receive one, and a contract only one side can honour is not a contract.

### The two things the reference gets wrong here, and what N1 does instead

**1. The bare/quoted predicate must not depend on the machine's locale.** The reference's bash side
is `case "$1" in *[!A-Za-z0-9_./:@#+-]*)`. A bracket-expression **range** is resolved in the current
`LC_COLLATE`, and glibc's `en_US.UTF-8` collation places characters outside ASCII inside `A-Z`.
Measured on this machine, bash 5.2.21, glibc en_US.utf8:

```
LC_ALL=C            "İ" -> QUOTED
LC_ALL=en_US.UTF-8  "İ" -> BARE       ← and the TypeScript side says QUOTED, always
```

That is a real, reproducible byte divergence between the two emitters that depends on nothing but who
is logged in. **N1 enumerates the class instead of using ranges**, which is collation-proof by
construction:

```sh
*[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_./:@#+-]*)
```

Measured: enumerated, `İ` is QUOTED under every locale on this machine. (`local LC_ALL=C` inside the
function also works and does not leak — measured — but it makes a correctness property depend on a
shell scoping rule, and the enumeration is one line either way.)

**2. `msg=""` must not vanish.** The reference's bash half writes `msg` only `if [ -n "$msg" ]`, so an
EMPTY msg is dropped by bash and written as `msg=""` by TypeScript. The reference pins that as an
accepted divergence ("the bytes differ, and nothing downstream can see it"). N1 **fixes it**: track
"a `msg` pair was supplied" in a separate flag rather than testing the value for emptiness. It is
three lines, and it is the difference between TST-18 asserting byte equality and TST-18 asserting
byte equality *except here*. A contract with one carve-out grows a second one.

**3. Use `process.stderr.write(line + "\n")`, not `console.error(line)`.** Measured: with a single
argument and no substitution arguments, `util.format` leaves `%s`, `%d` and `%%` untouched, so
`console.error` is byte-safe **today**. It stops being byte-safe the moment someone writes
`console.error(fmt, x)`. `process.stderr.write` cannot be turned into a format call by accident.
Pin `%%`, `%s` and `50% done` in the value matrix so a refactor back to `console.error(a, b)` goes
red.

**Do:**

1. **`emit.ts`**: `Level`, `ORDER` (`debug:10 info:20 warn:30 error:40`), `MIN` read once at module
   load from `LOG_LEVEL_ENV` through `envStr`, `Fields`, `renderValue`, `renderLine`, `Logger`,
   `logger(job)` with `.debug/.info/.warn/.error/.raw`.
   - `LOG_LEVEL_ENV: EnvSpec` = `{ key: "LOG_LEVEL", default: "info", why: "below this level a line is dropped by BOTH emitters (LOG-10)" }`.
     An unknown value falls back to `info` — an unreadable log level must not silence the log.
   - `renderLine` forces `msg` last regardless of insertion order (LOG-01).
   - **No `fatal`** (LOG-03): four levels, and `logger()` has no fifth member.
   - **Severity is SET** (LOG-05): `emit.ts` contains no regex or string test over `event` or `msg`.
2. **`log.sh`**: `log_init`, `_log_rank`, `_log_val` (enumerated class), `_log_emit` (with the
   `msg_set` flag), `log_debug/info/warn/error`, `log_run`. Sourced, never executed — mode 644, no
   executable bit, with the reason in the header. `date -u +%Y-%m-%dT%H:%M:%SZ` is the ONLY external
   command the file uses; everything else is a bash builtin.
3. **Tests** (`emit.test.ts` — TypeScript side and the static properties of the bash file; the
   cross-emitter comparison is J1.9), one `test()` each:
   1. `renderLine("info","j","e",{})` matches the five-field shape exactly.
   2. `msg` is last even when passed first: `{msg:"m", after:"x"}` renders `… after=x msg="m"`.
   3. `null` and `undefined` fields are dropped entirely.
   4. `renderValue` bare/quoted over the full value matrix (see J1.9), asserted against the written
      rule — this is the TypeScript half of the predicate, pinned independently of bash.
   5. Escaping order: `a\"b` renders `"a\\\"b"` — backslash first, then quote.
   6. A value containing a newline renders on one line, with the newline as a space.
   7. LOG-06: `logger("j").info("e")` writes to fd 2 and **stdout is empty** — asserted in a child
      process capturing both streams separately.
   8. LOG-10: with `LOG_LEVEL=warn`, `.debug` and `.info` emit nothing and `.warn`/`.error` emit —
      asserted in a child process, because `MIN` is read at module load.
   9. LOG-05: `.info("e", {msg:"FATAL: everything is on fire"})` emits `level=info`, and
      `.error("e", {msg:"all good"})` emits `level=error`. Severity is not inferred from text.
   10. LOG-03: `Object.keys(ORDER)` is exactly the four levels, and `logger("j")` has no `fatal` key.
   11. `log.sh` static: the file contains no `A-Z`, `a-z` or `0-9` **range** inside a bracket
       expression. Grep for `\[[^]]*[A-Za-z0-9]-[A-Za-z0-9]`.
   12. `log.sh` static: the file names no external command other than `date` — no `awk`, `sed`,
       `grep`, `cut`, `tr`, `python`, `perl`, `jq`, `expr`.
   13. `log.sh` static: no `log_fatal` function is defined.
   14. `log.sh` is not executable: `statSync(p).mode & 0o111` is `0`.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/runtime/log/emit.test.ts` reports 14 passing tests.
- [ ] AC2 — `node -e "import('./kernel/runtime/log/emit.ts').then(m=>console.log(m.renderLine('warn','ops-hello','tick-start',{n:3,msg:'hello there'})))"`
  prints a line matching `^ts=\S{20} level=warn job=ops-hello src=ts event=tick-start n=3 msg="hello there"$`.
- [ ] AC3 — `bash -c '. kernel/runtime/log/log.sh; log_init ops-hello; log_warn tick-start n=3 msg="hello there"' 2>&1`
  prints the same line with `src=sh` and a different `ts=`.
- [ ] AC4 — the gate fires: change `log.sh`'s class back to `[!A-Za-z0-9_./:@#+-]` and `npm test`
  exits non-zero on assertion 11. Revert. (J1.9 adds the runtime half of the same gate.)
- [ ] AC5 — the gate fires: add `sed` to `log.sh` and `npm test` exits non-zero on assertion 12.
  Revert.
- [ ] AC6 — the gate fires: change `.info` to emit `error` when the msg matches `/fatal/i` and
  `npm test` exits non-zero on assertion 9. Revert.
- [ ] AC7 — `node -e "import('./kernel/runtime/log/emit.ts').then(m=>m.logger('j').info('e'))" 2>/dev/null`
  prints nothing on stdout, and `… 1>/dev/null` prints one line on stderr.
- [ ] AC8 — `grep -c 'process.env' kernel/runtime/log/emit.ts` prints `0`.

**Commit:** `Add the one log line shape, both emitters (LOG-01, LOG-02, LOG-03, LOG-05, LOG-06, LOG-10)`

**Depends on:** J1.2.

**Risks / what could be wrong:** the enumerated character class is 70 characters written by hand, and
a typo in it is a silent divergence — which is exactly what J1.9 exists to catch, one commit later.
Do not land J1.7 without J1.9 in the same day.

---

## J1.8 — `parse.ts`: the reader half  ·  LOG-07

**Goal:** the exact inverse of `renderLine`, that returns `null` rather than throwing on anything that
is not ours — because two thirds of every log file is agent stdout, Node warnings and framing.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/parse.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/parse.test.ts` (new)

**Do:**

1. `LogLine` (`ts`, `level`, `job`, `src`, `event`, `msg`, `fields`, `raw`), `parseLine`, `unquote`,
   `isFault`, `renderFault`. The `PAIR` regex mirrors `renderValue`'s two shapes:
   `/([A-Za-z_][\w.-]*)=("(?:[^"\\]|\\.)*"|[^\s]*)/g`.
2. The `raw.startsWith("ts=")` gate is kept and its reason written down: it is the cheap prefilter on
   a 5-minute tick, and it is what stops a line merely *containing* `level=error` in prose (an agent
   quoting a log line back at us) from being read as an emitted one.
3. `parseLine` returns `null` when: the line does not start with `ts=`; `level` is missing or not one
   of the four; `ts` is missing; `event` is missing.
4. **Tests**, one `test()` each:
   1. **Round trip.** For every case in the value matrix, `parseLine(renderLine(...))` returns a
      record whose `job`, `event`, `msg` and `fields` deep-equal the inputs. This is the assertion
      that makes the escaping rules reversible rather than merely written down.
   2. A bare value and a quoted value both unquote to the same string.
   3. Escapes round-trip: `a\b"c` in, `a\b"c` out.
   4. A value containing `=` stays one value.
   5. `msg` with spaces stays one value, and a field emitted after it lands inside the message —
      asserted as the documented consequence, not as a bug.
   6. `null` for: `""`, `"hello world"`, `"  ts=... "` (leading space), `"ts=x level=fatal event=e"`,
      `"ts=x event=e"` (no level), `"ts=x level=info"` (no event).
   7. `null` for a line that merely contains `level=error` in prose.
   8. `isFault` is true only for `level=error`.
   9. `renderFault` produces `` `job/event` — msg (k=v) `` and omits the parenthesis when there are
      no extra fields.
   10. `src` survives: a line with `src=sh` parses to `src: "sh"`.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/runtime/log/parse.test.ts` reports 10 passing tests.
- [ ] AC2 — the gate fires: remove the `startsWith("ts=")` guard and `npm test` exits non-zero on
  assertion 7. Revert.
- [ ] AC3 — the gate fires: make `parseLine` throw instead of returning `null` on an unrecognised
  line and `npm test` exits non-zero on assertion 6. Revert.
- [ ] AC4 — the gate fires: drop the `\\.` alternative from `PAIR`'s quoted branch and `npm test`
  exits non-zero on assertion 3. Revert.
- [ ] AC5 — `node -e "import('./kernel/runtime/log/parse.ts').then(m=>console.log(JSON.stringify(m.parseLine('ts=2026-01-01T00:00:00Z level=error job=j src=sh event=e a=1 msg=\"x y\"'))))"`
  prints a JSON object with `"level":"error"`, `"src":"sh"`, `"msg":"x y"` and `"fields":{"a":"1"}`.

**Commit:** `Parse a line, and return null for anything that is not ours (LOG-07)`

**Depends on:** J1.7.

**Risks / what could be wrong:** the round trip in assertion 1 shares its value matrix with J1.9. Put
the matrix in one place — a plain exported array in `parse.test.ts` is wrong (a test importing a
test), so put it in a tiny `kernel/runtime/log/values.fixture.ts` that both tests import. It is a
fixture, not shipped behaviour; name it so, and note that it is lifted from the shapes the reference's
own emitter test uses plus the locale case this plan found (TST-19).

---

## J1.9 — TST-18: both emitters agree  ·  TST-18, LOG-01

**Goal:** turn "the two MUST stay identical" from a sentence at the top of two files into an
assertion, and make it a real byte comparison rather than a string one.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/emitters.test.ts` (new)

### What "byte-identical" is allowed to mean

Two fields cannot be byte-equal by construction, and each is excluded for a stated reason. Everything
else is compared as raw bytes.

- **`ts=`** — two processes read two clocks. It cannot be equal and must not be faked with a seam that
  exists only for a test.
- **`src=`** — the one field the two are SUPPOSED to disagree on. It is how a reader tells a bash line
  from a TypeScript one, and it is the only intended difference.

**The comparison splits the line at `" event="`.** The head — `ts=…  level=…  job=…  src=…` — is four
fields, each asserted on its own terms:

- `ts` matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`, is exactly 20 bytes, and is within 5 seconds
  of the test's own `Date.now()`. Both sides.
- `level` is the literal level, byte for byte, both sides.
- `job` equals `renderValue(job)` byte for byte, both sides — so the job field is inside the
  predicate check even though it is in the head.
- `src` is `ts` on one side and `sh` on the other, and nothing else.

**The tail — every byte from `event=` to the end — is compared as `Buffer` against `Buffer`.** That
region contains `event`, every caller field, and `msg`: everything the escaping rules govern. The
split index is `buf.indexOf(Buffer.from(" event="))`, and the test first asserts the head consists of
exactly four pairs, so a crafted job value containing `" event="` cannot move the split silently.

`assert.deepEqual` on two `Buffer`s. On failure the test prints both as hex — a diff of two strings
that render identically in a terminal is how "byte-identical" quietly becomes "close enough".

### How the bash emitter is invoked from `node --test`

```ts
execFileSync(
  "bash",
  ["-c", 'exec 2>&1; . "$1"; log_init "$2"; lvl=$3; ev=$4; shift 4; "log_$lvl" "$ev" "$@"',
   "bash", LOG_SH, job, level, event, ...pairs],
  { encoding: "buffer", env: { PATH: process.env.PATH, LC_ALL: locale, TZ: tz, LOG_LEVEL: level } },
)
```

- `encoding: "buffer"`, never `"utf8"`. A UTF-8 string round trip is lossless for valid UTF-8 and
  would hide nothing here — but the claim under test is about bytes, and the test should be about
  bytes.
- `exec 2>&1` because both emitters write to STDERR (LOG-06). A test reading stdout would be testing
  a stream neither side uses.
- The env is **built, not inherited**, so the developer's own `LOG_LEVEL` cannot make the suite pass
  or fail. `PATH` is inherited because `date` has to be findable.
- The trailing byte is checked and stripped: assert the last byte is `0x0a`, strip exactly one, and
  assert there is no `0x0d` anywhere. `printf '%s\n'` must produce LF and nothing else.

### The TypeScript side, when the env matters

`MIN` is read at module load, so a test cannot move `LOG_LEVEL` in-process. For the LOG-10 matrix the
TypeScript side runs in a child too: **four** node children, one per `LOG_LEVEL` value, each looping
over the four levels, capturing stderr as a `Buffer`. Four bash children the same way. Sixteen
comparisons, eight spawns.

**That child must import `emit.ts` directly and never the barrel.** `log/index.ts` re-exports
`tail.ts`, which imports `db.ts`, which imports `node:sqlite` — and `node:sqlite` prints a two-line
`ExperimentalWarning` on **stderr**, the same stream the log line goes to. Importing the barrel would
put two foreign lines into the byte comparison. This is the operational bite of the experimental
warning, and J1.13 turns it into a gate.

### The input matrix

**(a) Field shapes** — five whole-line cases with this repo's own job names:
`("info","ops-hello","tick-start",{})` ·
`("warn","nightly-sandcastle","dirty-tree",{repo:"doppelganger"})` ·
`("error","ops-log-report","adapter-failed",{source:"notion",msg:"no payload in agent output"})` ·
`("error","watchdog","job-failed",{exit:3,msg:"node kernel/x.ts exited non-zero"})` ·
`("warn","todo-triage","labels-unreadable",{issue:288,msg:'gh said "Not Found" — keeping the session'})`.

**(b) The value predicate** — one line per value, passed as `v=<value>`, the matrix shared with J1.8:

```
plain · a-b_c.d/e:f@g#h+i · "" · "has space" · 'has "quote"' · back\slash · comma,list ·
star* · tilde~ · 50% · a=b · "100%%" · "%s" · café · İ · ā · ŉ · → · 😀 · 3 · - · _ ·
"tab\there" · "cr\rhere" · "two\nlines"
```

**The non-ASCII half needs three values, not one, and the reason goes in a comment beside them.** The
divergence is not a quirk of one character: measured under `LC_ALL=en_US.utf8`, **135 codepoints in
U+00A1–U+0190 render BARE** under the range predicate — effectively all of Latin Extended-A — while
the same characters render QUOTED under `C`, `C.utf8` and `POSIX`, and QUOTED on the TypeScript side
always. So:

- **`İ` (U+0130) and `ā` (U+0101) — both fire.** Two, not one, so a future reader who deletes `İ` as
  an oddity still has a failing case.
- **`é` (U+00E9) does NOT fire.** Measured QUOTED under every locale. `café` alone catches nothing,
  which is exactly what the reference's own matrix relies on — keep it for coverage, but it is not
  the guard.
- **`ŉ` (U+0149) does NOT fire either** — measured QUOTED under `en_US.utf8`, despite sitting inside
  Latin Extended-A. It is in the matrix as a **negative control**: it proves the divergence is a
  property of the collation table and not of the Unicode block, so nobody "generalises" the fix into
  a block range and reintroduces the bug from the other side.

`%%` and `%s` are in the matrix because they are what a `console.error(fmt, x)` refactor would break.
The three- and four-byte UTF-8 cases are there because "non-ASCII" is not one case.

**(c) `msg` hold-back** — `{msg:"…", after:"x"}` on both sides puts `msg=` last and leaves `after` a
field.

**(d) An empty `msg`** — `msg=` on both sides renders `msg=""`. This is the reference's one accepted
divergence, fixed in J1.7 and pinned here as agreement.

**(e) LOG-10** — the 16 (level × `LOG_LEVEL`) pairs; for each, both sides produce a line or both
produce zero bytes.

### The locale matrix — the part that actually catches the bug

`locale -a` is read at test time, and **(b) is run under every locale the machine reports**, requiring
identical bytes from all of them. Nothing about which locales exist is pinned: a machine with only
`C` runs it once, this machine runs it four times, a CI image with thirty runs it thirty. The gate
adapts instead of rotting.

Combined with J1.7's static assertion that `log.sh` contains no bracket-expression range, the property
is covered from both ends: statically, so it fires even on a `C`-only machine; and dynamically, so it
fires on the real collation wherever one exists.

**Do:** write the file with the harness above and one `test()` per group:
1. Head fields agree (four assertions in one test, over case group (a)).
2. Tails are byte-identical over case group (a).
3. Tails are byte-identical over the value matrix (b), under `LC_ALL=C`.
4. Tails are byte-identical over (b) under **every** locale `locale -a` reports.
5. `msg` hold-back agrees (c).
6. An empty `msg` renders `msg=""` on both sides (d).
7. `LOG_LEVEL` gating agrees over all 16 pairs (e).
8. Every bash line ends with exactly one `0x0a` and contains no `0x0d`.
9. Every bash line parses: `parseLine(line) != null` and `src === "sh"` — one reader covers both
   emitters, which is the failure this whole row exists for.
10. The bash child writes nothing to stdout when stderr is not redirected — run without `exec 2>&1`
    and assert stdout is zero bytes (LOG-06 for the bash half).
11. **`log_run` succeeds.** `log_run true` emits exactly one line, `level=info event=job-ok`, and the
    wrapper's own exit code is 0. Untested in the reference, and it is the function every bash job
    ends with.
12. **`log_run` fails.** `log_run false` emits exactly one line, `level=error event=job-failed
    exit=1`, with a non-empty `msg`, and the wrapper returns 1 — the caller's exit code is unchanged,
    which is why `log_run` goes last in a script. This line is `cause.ts`'s ONLY consumer (LOG-09):
    `job-failed` is the event a distilled cause is attached to, so an untested `log_run` makes J1.11
    a module with no reachable caller.
13. **LOG-02 — logfmt, not JSONL.** For every line both emitters produce in this file:
    `JSON.parse(line)` throws (it is not a JSON document), and every whitespace-separated token
    before `msg=` splits on its **first** `=` into a key matching `^[A-Za-z_][\w.-]*$` and a value.
    LOG-02 had no assertion of its own anywhere in the first draft — it was assumed by the parser
    rather than stated.
14. **`raw()` and the deliberate asymmetry.** `logger(j).raw(text)` writes `text` verbatim to stderr
    with one trailing LF and no `ts=` prefix, and `parseLine` returns `null` for it — it is the one
    escape hatch, and the reporter must skip it. **`log.sh` defines no `log_raw`**, asserted here.
    That asymmetry is correct and is written down rather than discovered: a bash job's payload
    already goes to stdout, which LOG-06 keeps free, so the bash half needs no hatch. Pinning it
    stops someone "restoring symmetry" with a second bash line shape.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/runtime/log/emitters.test.ts` reports 14 passing tests.
- [ ] AC2 — the gate fires, and this is the one that matters: restore `log.sh`'s
  `[!A-Za-z0-9_./:@#+-]` range, run `npm test`, and assertion 4 exits non-zero naming `İ` and the
  locale it diverged under. Revert. (Measured on this machine: `en_US.utf8` is present, so the gate
  really does fire here rather than skipping.)
- [ ] AC3 — the gate fires: restore the reference's `if [ -n "$msg" ]` guard and `npm test` exits
  non-zero on assertion 6 with a hex diff. Revert.
- [ ] AC4 — the gate fires: change `emit.ts` to emit `msg` in insertion order and `npm test` exits
  non-zero on assertion 5. Revert.
- [ ] AC5 — the gate fires: change `log.sh`'s `_log_rank` so `warn` ranks below `info` and `npm test`
  exits non-zero on assertion 7. Revert.
- [ ] AC6 — `bash -c 'locale -a' | wc -l` is recorded in the commit body, with the note that the
  number is a property of the machine and is never asserted. (Measured here: 4 — `C`, `C.utf8`,
  `en_US.utf8`, `POSIX` — so the dynamic half really runs more than once on this machine.)
- [ ] AC7 — the whole file runs in under 15 seconds. Spawn budget, corrected: **4 node children**
  (one per `LOG_LEVEL` value, each looping the four levels) and **4 bash children** for the same
  matrix — the first draft said 8 node and 16 bash, which contradicted its own design text. Plus 5
  for case group (a), 3 for (c)/(d), 2 for `log_run`, and 25 per locale for the value matrix. On
  this machine (4 locales) that is 8 spawns for LOG-10 and ~110 for everything else. If it is
  slower, the matrix is being re-spawned per value rather than per case.

**Not an AC here, deliberately — a forward reference.** The obvious mutation for "the LOG-10 child
must not import the barrel" is to point it at `../log/index.ts`. **`log/index.ts` does not exist
until J1.13**, four commits later, so that mutation cannot be performed at this commit and an AC
naming it would be unperformable. The property is gated at **J1.13 AC2**, which is where the barrel
lives. This is the same rule this plan applied when it declined to build TST-09's job-name gate at
N1 — and the first draft broke it here.

**Commit:** `Assert the two emitters produce the same bytes, under every locale on the machine (TST-18)`

**Depends on:** J1.7, J1.8.

**Risks / what could be wrong:**
- **Spawn cost.** ~120 bash spawns at ~4 ms and 8 node spawns at ~50 ms is well under a second of
  real work, but the suite runs test files in parallel and a loaded machine can stretch it. There is
  no timing assertion in this file, so slowness cannot make it flaky — only slow.
- **A locale that bash cannot set** prints `setlocale: cannot change locale` on stderr and falls back
  to `C` (measured). Because the harness captures stderr, that warning would land in the compared
  bytes. The harness must therefore filter lines beginning `bash: warning:` before comparing, and
  assert that it filtered the same count from both sides.
- **`locale -a` may not exist** on a minimal image. Fall back to `["C"]` and record why in a comment;
  the static gate from J1.7 still holds there.

---

## J1.10 — `route.ts`: routing is a property of the level  ·  LOG-04

**Goal:** the routing rule as a pure function, so the caller cannot choose where its line goes.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/route.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/route.test.ts` (new)

**Do:**

1. Two exports:
   ```ts
   export type Route = "report" | "count" | "file";
   export const routeOf = (level: Level): Route =>
     level === "error" ? "report" : level === "warn" ? "count" : "file";

   export interface TickSummary {
     /** faults batched per `job/event` — the key IS the batch key. */
     faults: Map<string, number>;
     /** warns are a bare count, and only on a tick that already had an error. */
     warns: number;
     /** true when the tick has anything to report at all. */
     report: boolean;
   }
   export function summarise(lines: readonly LogLine[]): TickSummary;
   ```
2. `summarise` implements the whole of LOG-04: `error` lines are batched per `job/event`; `warns` is
   the count of `warn` lines, and it is reported **only when `faults.size > 0`**; `info` and `debug`
   never appear.
3. **The caller never names a route.** `routeOf` takes a `Level` and nothing else — not a job, not an
   event, not a flag. That is LOG-04's sentence expressed as a signature: a function that cannot see
   the caller cannot be steered by it.
4. **Tests**, one `test()` each:
   1. `routeOf` over all four levels.
   2. `summarise([])` reports nothing.
   3. Two errors with the same `job/event` batch to one key with count 2.
   4. Two errors with different events are two keys.
   5. Warns alone produce `report: false` and `warns: 0` — a tick with no error carries no warn
      count. This is the assertion the rule is actually about.
   6. Warns alongside an error produce the bare count.
   7. `info` and `debug` never reach the summary, whatever their `msg` says.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/runtime/log/route.test.ts` reports 7 passing tests.
- [ ] AC2 — the gate fires: make `summarise` always report the warn count and `npm test` exits
  non-zero on assertion 5. Revert.
- [ ] AC3 — the gate fires: batch faults on `job` alone and `npm test` exits non-zero on assertion 4.
  Revert.
- [ ] AC4 — `grep -c 'job\|event' kernel/runtime/log/route.ts` shows `routeOf`'s signature names
  neither: `node -e "..."` printing `routeOf.length` prints `1`.

**Commit:** `Route on the level, batch faults per job/event, count warns only beside an error (LOG-04)`

**Depends on:** J1.8.

**Risks / what could be wrong:** `summarise` has no consumer until `ops-log-report` at N5. That is a
port with no consumer, which D9 warns about — mitigated because it is not a port: it is a pure
function over a shape that already exists (`LogLine`), and the rule it encodes is written in the
roadmap rather than guessed. If N5 finds the shape wrong, changing a pure function with one caller is
cheap. Flagged in *Gaps* because LOG-04 names no module.

---

## J1.11 — `cause.ts` and a real dead-child fixture  ·  LOG-09, TST-19

**Goal:** the one line worth reporting out of a child's dying output — the line `parse.ts` skips by
design, which is why `job-failed` currently names no cause.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/cause.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/cause.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/fixtures/` (new — three captured files)

**Do:**

1. Port `causeOf(lines)` and `stderrTail(keep = 60)` from the reference. The pick is by **shape, not
   position**: the Node uncaught-exception header first, then the last weak-signal line, then the last
   non-noise line. A tail-N reports the runtime's version banner, which is the failure this exists to
   avoid.
2. `NOISE` includes `/ExperimentalWarning|^\(Use `node --trace-warnings/` — which is exactly the
   `node:sqlite` warning this repo now emits from every process that opens a database. J1.13 asserts
   that link explicitly.
3. **Capture the fixtures from this machine, once, and commit the bytes** (TST-19: lifted from real
   data, never invented). Three files, each produced by a script committed alongside them in the same
   directory as `fixtures/README` — no, as a comment at the top of `cause.test.ts` naming the exact
   command that produced each:
   - `throw.txt` — `node -e 'throw new TypeError("bad thing")'` 2>&1. Contains the header, the
     frames, the blank line and the `Node.js v22.23.1` banner.
   - `missing-module.txt` — `node kernel/does-not-exist.ts` 2>&1. `ERR_MODULE_NOT_FOUND`, where the
     same token appears above and below the line worth carrying.
   - `killed.txt` — a bash child that prints a partial line and is `kill -9`'d, captured so the last
     words are unterminated.
   Committing the bytes rather than regenerating at test time is deliberate: regenerating would pin
   the running Node's banner text, which changes with `.nvmrc`.
4. **Tests**, one `test()` each:
   1. `throw.txt` → `TypeError: bad thing`, not `Node.js v22.23.1`.
   2. `missing-module.txt` → the `Cannot find module …` message, not the `code:` echo below it and
      not the `throw` site above it.
   3. `killed.txt` → the unterminated partial line, because a child killed mid-line is exactly the
      run whose cause is worth having.
   4. Every `NOISE` shape returns `undefined` on its own: blank, `ts=…`, `  ^`, `    at f (x:1:1)`,
      `Node.js v22`, an `ExperimentalWarning` line, and `(Use \`node --trace-warnings …`.
   5. `causeOf([])` is `undefined`, not `""`.
   6. A cause over 300 characters is clipped and ends with `…`.
   7. `stderrTail(3)` keeps the last three lines and drops earlier ones.
   8. `stderrTail` carries a partial line across chunk boundaries: push `"abc"` then `"def\n"` and
      the ring holds `"abcdef"`.
   9. `stderrTail().cause()` on a stream ending mid-line includes the partial.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/runtime/log/cause.test.ts` reports 9 passing tests.
- [ ] AC2 — the gate fires: change `causeOf` to `said.at(-1)` (a tail-1) and `npm test` exits
  non-zero on assertion 1 with `Node.js v22.23.1`. Revert.
- [ ] AC3 — the gate fires: drop the `ExperimentalWarning` entry from `NOISE` and `npm test` exits
  non-zero on assertion 4. Revert.
- [ ] AC4 — the gate fires: reorder `causeOf` to try `findLast(SIGNAL)` before `find(HEADER)` and
  `npm test` exits non-zero on assertion 2. Revert.
- [ ] AC5 — each fixture file is non-empty and the command that produced it is named in a comment:
  `head -3 kernel/runtime/log/cause.test.ts | grep -c 'node -e'` is at least `1`.

**Commit:** `Distil a dead child's stderr into the one line job-failed carries (LOG-09, TST-19)`

**Depends on:** nothing beyond J1.1 (it imports only its own file).

**Risks / what could be wrong:** the fixtures freeze one Node's crash output. When `.nvmrc` moves, a
fixture may stop resembling reality without any test going red — the test would still pass against
stale bytes. Mitigation: name the producing command in the comment so re-capturing is one line, and
note in the commit body that re-capture belongs in the same commit as a `.nvmrc` bump.

---

## J1.12 — `tail.ts`: the incremental reader  ·  LOG-08

**Goal:** read every log file forward from where the last tick stopped, survive rotation and
truncation, and bound what one tick will pull into memory.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/tail.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/tail.test.ts` (new)

**Do:**

1. Port `tail.ts` from the reference: `logFiles(roots)`, `readRange`, `step(path, st, prev)`,
   `tail()`, the `logtail_cursor` table under namespace `logtail`, and the two knobs.
2. **Two roots**, both read. In this repo they are `projectPath(".doppelganger/logs")` and
   `projectPath("logs")` — declared in one exported `LOG_ROOTS` and derived from `projectPath`, so
   INS-02's project-relative half holds and J1.19's gate can see it. A root that does not exist yet
   is skipped, not a fault: the first job to run creates it.
3. Knobs, as `EnvSpec` rows on this module:
   - `LOG_MAX_BYTES` default `8388608` — "rotate a log above this; ~4x normal traffic, so it fires on
     a runaway job (LOG-08)".
   - `LOG_MAX_READ_BYTES` default `4194304` — "cap on what one tick reads from one file, so a runaway
     cannot pull itself into memory before rotation bounds it (LOG-08)".
4. The three orderings that are the whole module, each kept as a comment because each is a silent
   failure when reversed: **read first, truncate second, cursor last** · a trailing partial line is
   NOT consumed, so a line still being written is read once, whole, next tick · **copy-then-truncate,
   never rename**, because cron holds the log open with `>>` and `O_APPEND` writes land at the
   current end.
5. **Tests**, one `test()` each, over a `mkdtempSync` root and a `mkdtempSync` database path:
   1. A first sight of a file starts at its END — the first tick does not replay history as new
      faults.
   2. Lines appended after the first tick are returned on the second.
   3. A trailing partial line is held: append `"ts=… evt"` with no newline, tick, get nothing; append
      `"…\n"`, tick, get one whole line.
   4. Truncation in place (`size < offset`) resets the cursor to zero and reports the path in `reset`.
   5. Replacement (a new inode at the same path) resets and reports.
   6. `LOG_MAX_READ_BYTES` skips the excess and reports the skipped byte count; the cursor still ends
      at the file's end.
   7. A file above `LOG_MAX_BYTES` is rotated **after** its content is read: the returned lines
      include everything, `path.1` holds the old bytes, the live file is zero-length, and the cursor
      is 0.
   8. Non-`ts=` lines in the file are skipped without error (LOG-07 in situ — a real file is two
      thirds agent stdout).
   9. Both roots are read; a root that does not exist is skipped silently.
   10. The cursor survives a `closeAll()` and a reopen: two `tail()` calls across a close return
       disjoint line sets.
   11. `logFiles` returns only `*.log`, sorted.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/runtime/log/tail.test.ts` reports 11 passing tests.
- [ ] AC2 — the gate fires: start a first sight at `0` instead of `st.size` and `npm test` exits
  non-zero on assertion 1. Revert.
- [ ] AC3 — the gate fires: move the rotation above the read and `npm test` exits non-zero on
  assertion 7 with lines missing. Revert.
- [ ] AC4 — the gate fires: drop the inode from the cursor (offset only) and `npm test` exits
  non-zero on assertion 5. Revert.
- [ ] AC5 — the gate fires: consume the trailing partial line and `npm test` exits non-zero on
  assertion 3 with a half line. Revert.
- [ ] AC6 — `find . -path ./node_modules -prune -o -name '*.db' -print | wc -l` prints `0` after the
  suite, and `.doppelganger/` does not exist in the checkout.

**Commit:** `Read both log roots forward with (inode, offset) cursors and copy-then-truncate rotation (LOG-08)`

**Depends on:** J1.6 (a database with the busy reporter), J1.8 (a parser), J1.4 (`projectPath`,
`dbPath`).

**Risks / what could be wrong:** rotation writes `path.1` next to `path`. `.gitignore` has no rule for
`*.log` or `*.log.1`; the tests write under `mkdtempSync`, so nothing lands in the checkout, but the
first real job at N2 will create `.doppelganger/logs/`. `.gitignore` already ignores `.doppelganger/`
from J1.4, so no new rule is needed — confirm it, do not assume it.

---

## J1.13 — The log barrel, and the `node:sqlite` warning contract  ·  LOG-01, LOG-06, LOG-07, DBS-01

**Goal:** one import surface for logging, and a written, gated answer to what the experimental warning
does to the STDERR contract.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/index.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/log/warning.test.ts` (new)

### The measurement

On Node 22.23.1, importing `node:sqlite` — **even without using it** — prints two lines on stderr:

```
(node:475552) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
```

Type stripping, by contrast, prints nothing at 22.23.1 (measured). So the only foreign stderr this
repo produces is the SQLite one, once per process.

### What that does to the LOG-06 contract, and the ruling

It does **not** break it, and the roadmap already anticipated the shape: LOG-07 says unrecognised
lines are not an error, because two thirds of every file is agent stdout. Both warning lines fail
`parseLine`'s `startsWith("ts=")` gate and are skipped. `causeOf`'s `NOISE` list already names
`ExperimentalWarning` and `(Use \`node --trace-warnings`, so a dead child's warning is never reported
as its cause.

**It is not silenced.** `--disable-warning=ExperimentalWarning` in the `test` script would hide every
other experimental warning too, and N0 already rejected that. The warning is a true statement about a
pinned runtime and it belongs in the log.

**It has one real consequence, and it is a rule:** a process that only logs must not load
`node:sqlite`. `emit.ts` must be importable without pulling in `db.ts`. The barrel re-exports `tail`,
which imports `db`, so **the barrel is the expensive import and `emit.ts` is the cheap one**. J1.9's
LOG-10 children depend on this being true, and AC6 there shows what breaks when it is not.

**Do:**

1. `index.ts` re-exports `./emit.ts`, `./parse.ts`, `./route.ts`, `./cause.ts`, `./tail.ts` — with the
   header comment naming the four roles (writer, reader's parser, routing rule, transport) and the
   sentence: *importing this barrel loads `node:sqlite`; import `./emit.ts` directly if all you do is
   log.*
2. **Tests**, one `test()` each:
   1. **The warning exists and is captured live.** A child process importing `node:sqlite` writes at
      least one line to stderr and zero bytes to stdout. The lines are captured, never hardcoded —
      the pid in them is not a fact this repo owns.
   2. Every captured warning line returns `null` from `parseLine`.
   3. `causeOf(capturedLines)` is `undefined`.
   4. **The cheap import stays cheap.** A child running
      `node -e "import('./kernel/runtime/log/emit.ts').then(()=>{})"` writes **zero bytes** to
      stderr. This is the rule, as an assertion.
   5. **The expensive import is expensive, and that is fine.** A child importing the barrel writes
      the warning to stderr — asserted so that nobody "fixes" it by silencing the warning and then
      wonders why the log has no `ExperimentalWarning` in it.
   6. Every module the barrel names exists and is reachable: `import * as log from index.ts` exposes
      `renderLine`, `logger`, `parseLine`, `isFault`, `routeOf`, `summarise`, `causeOf`,
      `stderrTail`, `tail`, `logFiles`.
   7. LOG-01's "nothing else formats a line": the set of non-test files under `kernel/` containing
      the literal `ts=` is exactly **four**, each named in the test with its role:
      - `log/emit.ts` — **writer**, the TypeScript half.
      - `log/log.sh` — **writer**, the bash half (`line="ts=$(date -u …)"`). The scan runs over
        `*.ts` **and** `*.sh`. Narrowing the glob to `*.ts` would make the set three and quietly hide
        the second emitter, and LOG-01's entire claim is that there are two — so having both writers
        appear in the gate is better than scoping the gate until only one can.
      - `log/parse.ts` — **reader**, `raw.startsWith("ts=")`.
      - `log/cause.ts` — **reader**, `NOISE`'s `/^ts=/`, skipping lines the reporter already has.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/runtime/log/warning.test.ts` reports 7 passing tests.
- [ ] AC2 — the gate fires: add `import "../db.ts";` to `emit.ts` and `npm test` exits non-zero on
  assertion 4 showing the two warning lines. Revert.
- [ ] AC3 — the gate fires: build a line by hand in `tail.ts` (`\`ts=${nowIso()} …\``) and `npm test`
  exits non-zero on assertion 7 naming `tail.ts`. Revert.
- [ ] AC4 — `node -e "import('./kernel/runtime/log/emit.ts')" 2>&1 | wc -c` prints `0`.
- [ ] AC5 — `node -e "import('./kernel/runtime/log/index.ts')" 2>&1 | grep -c ExperimentalWarning`
  prints `1`.
- [ ] AC6 — `grep -rn 'disable-warning' package.json .github/workflows/test.yml` returns nothing —
  the warning is not silenced anywhere.

**Commit:** `Barrel the log surface, and pin what the node:sqlite warning does to STDERR (LOG-01, LOG-06, LOG-07)`

**Depends on:** J1.10, J1.11, J1.12.

**Risks / what could be wrong:** if a future Node makes `node:sqlite` stable, assertion 1 and
assertion 5 both go red at once. That is correct and the fix is to delete them together — write that
in the comment, because a reader who deletes only one leaves a test asserting a warning that no longer
exists.

---

## J1.14 — `pool.ts`: bounded concurrency and the spawn stagger  ·  HRN-18

**Goal:** the two spawn guards every agent-pooling job runs through, neither of which fails loudly
when broken.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/pool.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/pool.test.ts` (new)

**Do:**

1. `pool(items, limit, fn)` — bounded worker pool; each worker pulls the next index as it frees up, so
   a slow item delays only itself. `limit` is floored at 1: zero workers leaves every slot in the
   returned array unwritten rather than doing the work serially. Carry the reference's warning that
   `fn` **must never reject** — a rejection abandons every other in-flight worker with whatever claim
   it holds still held until TTL.
2. `spawnSlot(staggerMs)` — a module-global chain that serialises the FIRST MOMENT of every spawn and
   returns the PRIOR link, so a spawn arriving after a quiet gap waits on an already-resolved promise
   and starts immediately. The chain is module-global on purpose: it guards one `~/.gitconfig`, not
   one pool.
3. `export const DEFAULT_SPAWN_STAGGER_MS = 2000;` and **no `EnvSpec` row**. HRN-18 spells the knob
   `*_SPAWN_STAGGER_MS` — a per-job family, and at N1 there is no job to own one. `pool.ts` therefore
   reads no env at all and takes both `limit` and `staggerMs` as arguments; a job at N3 declares its
   own `TODO_TRIAGE_SPAWN_STAGGER_MS` row defaulting to this constant. Write that sentence in the
   file. It keeps J1.18's "only `config.ts` names `process.env`" true and it avoids designing a knob
   with no owner.
4. Carry the measured failure into the header comment, because it is the reason the stagger exists:
   twelve agents starting on one tick raced the `~/.gitconfig` lock and two died with
   `could not lock config file: File exists`, each burning a lease attempt on a failure that had
   nothing to do with the work.
5. **Tests**, one `test()` each, following the reference's shape:
   1. **Peak, not results.** Never more than `limit` run at once, whatever the completion order — a
      break that spawns one worker per item still returns the right answers, so the assertion leads
      with the peak.
   2. Results are indexed, not appended: a slow item 0 still lands at index 0.
   3. A worker frees the moment its item lands: the fast lane drains the tail while item 0 runs.
   4. More workers than items runs each item exactly once and leaves no slot unwritten.
   5. `limit` of `0` is floored to 1 and the work still happens.
   6. `spawnSlot` lets the first spawn start at once and holds each one after it a stagger apart —
      **lower bounds only**, because a loaded host makes a wait longer and never shorter.
   7. A spawn arriving after the chain has drained starts immediately.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/runtime/pool.test.ts` reports 7 passing tests.
- [ ] AC2 — the gate fires: change the worker count to `items.length` and `npm test` exits non-zero on
  assertion 1 with a peak of 8. Revert.
- [ ] AC3 — the gate fires: make `spawnSlot` return the NEW link instead of the prior one and
  `npm test` exits non-zero on assertion 6 — the first spawn now pays a stagger. Revert.
- [ ] AC4 — the gate fires: drop the chaining from `spawnSlot` entirely and `npm test` exits non-zero
  on assertion 6 with all three waits near zero. Revert.
- [ ] AC5 — the gate fires: chunk with `Promise.all` and `npm test` exits non-zero on assertion 3 with
  `[1, 0, 2, 3]`. Revert.
- [ ] AC6 — `grep -c 'process.env' kernel/runtime/pool.ts` prints `0`.

**Commit:** `Bound concurrency and stagger the first moment of every spawn (HRN-18)`

**Depends on:** J1.2 (nothing imported, but it is the phase's floor).

**Risks / what could be wrong:** assertions 6 and 7 are timing tests. They assert lower bounds only
and use a 50 ms stagger with a 5 ms tolerance, which is the reference's own shape and has not flaked
there. If they do flake on a loaded CI box, raise the stagger, never the tolerance — raising the
tolerance is how a timing test stops testing anything.

---

## J1.15 — `exec.ts`: one process wrapper with a wall clock  ·  HRN-19

**Goal:** no `gh` or `git` call can stall forever, and a call that does time out says so.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/exec.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/exec.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27 KNB — Core/paths list)

**Do:**

1. `run(file, args, opts = BASE)` — the single `execFileSync` call site, exported as a **test seam**
   (a timeout is otherwise reachable only through a genuinely hung call). `BASE` carries
   `encoding: "utf8"`, `maxBuffer: 16 MiB`, `stdio: ["ignore","pipe","pipe"]`, the timeout, and
   `killSignal: "SIGKILL"` — `spawnSync` signals once and never escalates, so a child that ignores
   SIGTERM would hang the caller exactly as the missing timeout did.
2. `EXEC_TIMEOUT_MS_ENV: EnvSpec` = `{ key: "EXEC_TIMEOUT_MS", default: "180000", why: "wall-clock bound on ONE gh/git call; an unbounded stalled gh blocks the event loop so lease heartbeats stop (HRN-19)" }`.
3. `timedOut(e)` reads `code` and `error.code` — which of them Node populates is not a fact this file
   depends on.
4. On timeout, rethrow naming the file, the deadline in seconds and the command, clipped at 200
   characters. Node's own `spawnSync gh ETIMEDOUT` names neither the subcommand nor the deadline and
   matches nothing in `cause.ts`, so the reported fault would be the tail of whatever the child last
   printed. Every other failure passes through **untouched** — `status`, `stdout` and `stderr`
   included, since callers branch on them.
5. `gh(...args)`, `ghIn(input, ...args)` (stdin, for `--body-file -`, keeping large bodies out of
   argv), `git(dir, ...args)` (`-C dir`).
6. **Add `EXEC_TIMEOUT_MS` to `roadmap.md` §2.27's Core/paths list.** It appears nowhere in the
   roadmap today and HRN-19 requires it — see *Gaps*.
7. **Tests**, one `test()` each, driven through `bash` so no `gh` or `git` binary is needed:
   1. A timed-out call is relabelled: `run("bash", ["-c","sleep 30"], { ...BASE, timeout: 250 })`
      throws with `timed out after 0.25s: bash -c sleep 30`.
      **`BASE` must be exported for this to typecheck.** A bare `{ timeout: 250 }` does not satisfy
      `ExecFileSyncOptionsWithStringEncoding`, which requires `encoding` — so the first draft's call
      would have failed at `pretest`, not in the test. Spreading `BASE` also keeps the test on the
      real options (`SIGKILL`, `maxBuffer`, `stdio`) with only the deadline changed, which is what
      the assertion is about.
   2. A non-timeout failure passes through: `exit 3` throws with `status === 3` and
      `stderr` containing `boom`.
   3. Success returns stdout.
   4. A command longer than 200 characters is clipped and ends with `…`.
   5. `killSignal` is `SIGKILL` on the exported `BASE`, and `BASE.encoding` is `"utf8"` — asserted on
      the constant, because a child that ignores SIGTERM cannot be produced reliably in a unit test
      and the constant is the contract.
   6. `gh`, `ghIn` and `git` all route through `run`: each is called against a `bash` stand-in via a
      spy on the exported `run`… **no** — `run` is imported by name and cannot be spied without a
      module mock. Instead assert the shape: `git("/tmp", "status")` builds argv
      `["-C","/tmp","status"]`, checked by calling `git` against a `git` that is absent and reading
      the `ENOENT` error's `path`/`spawnargs`. If `git` is present on the machine the assertion still
      holds via `spawnargs`. Note the fallback in a comment.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/runtime/exec.test.ts` reports 6 passing tests.
- [ ] AC2 — the gate fires: remove `timeout` from `BASE` and `npm test` exits non-zero on assertion 1
  — the test now takes 30 seconds and then fails. Revert. (Note the 30-second cost in the commit body
  so nobody tries this on a whim.)
- [ ] AC3 — the gate fires: rethrow every error as a timeout and `npm test` exits non-zero on
  assertion 2 with `status` gone. Revert.
- [ ] AC4 — the gate fires: change `killSignal` to `SIGTERM` and `npm test` exits non-zero on
  assertion 5. Revert.
- [ ] AC5 — `sed -n '/^### 2\.27/,/^### 2\.28/p' roadmap.md | grep -c 'EXEC_TIMEOUT_MS'` prints `1`.
- [ ] AC6 — `grep -c 'process.env' kernel/runtime/exec.ts` prints `0`.
- [ ] AC7 — `node -e "import('./kernel/runtime/exec.ts').then(m=>console.log(m.run('bash',['-c','echo hi'])))"`
  prints `hi`.

**Commit:** `Bound every gh/git call with a wall clock and name the deadline when it fires (HRN-19)`

**Depends on:** J1.2.

**Risks / what could be wrong:** assertion 6's argv check depends on how Node populates `spawnargs`
on a spawn error, which is not a documented field. If it turns out to be absent, replace it with a
`bash` stand-in placed first on `PATH` in the child env — more setup, same claim. Do not drop the
assertion: an argv-building helper with no test is a helper that reorders its arguments in a future
refactor.

---

## J1.16 — `stages.ts`: the prefix vocabulary  ·  SUP-20

**Goal:** the nine prefixes as data, one function that reads them, and a gate that the two documents
naming them cannot drift from the code.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/stages.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/stages.test.ts` (new)

### What is real at N1, and what is only vocabulary

SUP-20's subject is *every job name and schedule entry*. There are no jobs (N3) and no schedule (N2),
so **TST-09's gate is not built here** — a gate whose subject does not exist is decoration, and
`WORK.md` already places TST-09 in N3 where the jobs are.

What IS real at N1 is the vocabulary itself, and it already has three consumers: `roadmap.md` SUP-20,
`CLAUDE.md`'s "Stage prefixes" rule, and the code. Those three can disagree today and nothing would
say so. **That** is the N1 gate.

**Do:**

1. `STAGES` as a `readonly` tuple in the order both documents already use:
   `source · triage · backlog · watch · todo · corpus · nightly · retro · ops`.
   Note in the comment that the reference lists the same nine in a different order (`ops` before
   `corpus`); this repo follows its own two documents, and the test pins that choice.
2. `Stage` type, `MISC = "misc"`, `stageOf(name)` matched **longest-first** and anchored on a
   following `-`, so `todo-exec` matches `todo` and a hypothetical `todoist` does not.
3. `byStage(items, nameOf)` grouping in `STAGES` order, dropping empty groups, `misc` last.
4. Carry the reason a prefix beats a `stage:` field: a field is a second place to say the same thing
   and the two drift the moment somebody fills in the wrong one, silently, because nothing can check a
   declaration against a name. A prefix cannot disagree with itself.
5. **Tests**, one `test()` each:
   1. `stageOf` maps `source-slack`, `triage-switch`, `backlog-health`, `watch-jira`, `todo-exec`,
      `corpus-lint`, `nightly-sandcastle`, `retro-grade`, `ops-hello` to their stages.
   2. A bare stage name is its own stage: `stageOf("ops")` is `ops`.
   3. `stageOf("todoist-sync")` is `misc` — the trap this guards is a name that merely STARTS with a
      stage's letters.
   4. `stageOf("deploy")` is `misc`, and `misc` is never silently dropped.
   5. Longest-first, in the only form that can fire. No stage in today's nine is a prefix of another,
      so a "the longer one wins" case cannot be constructed from real data and would be decoration.
      Assert two things instead: (a) no stage in `STAGES` is a prefix of another — the property that
      makes the ordering currently unobservable, and which goes red the day someone adds `todo-item`
      next to `todo`; and (b) `stageOf` matches in descending length order, asserted against an
      exported `matchOrder()` compared to `[...STAGES].sort((a,b) => b.length - a.length)`.
   6. `byStage` groups in `STAGES` order, drops empty groups, and puts `misc` last when non-empty.
   7. **The doc gate.** Parse the backticked prefix list out of `roadmap.md` SUP-20 and out of
      `CLAUDE.md`'s "Stage prefixes" bullet, strip the trailing `-`, and assert both equal `STAGES`
      **in order**. Both documents were written before this commit, so the code is what must match
      them — not the other way round.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/stages.test.ts` reports 7 passing tests.
- [ ] AC2 — the gate fires: add `"deploy"` to `STAGES` and `npm test` exits non-zero on assertion 7
  naming both documents. Revert.
- [ ] AC3 — the gate fires: swap `corpus` and `ops` in `STAGES` (the reference's order) and `npm test`
  exits non-zero on assertion 7 — the order is part of the claim. Revert.
- [ ] AC4 — the gate fires: drop the `-` anchor from `stageOf` and `npm test` exits non-zero on
  assertion 3 with `todoist-sync` reading as `todo`. Revert.
- [ ] AC5 — the gate fires: sort shortest-first in `matchOrder()` and `npm test` exits non-zero on
  assertion 5(b). And: add `"todo-item"` to `STAGES` and `npm test` exits non-zero on assertion 5(a)
  naming the pair — before assertion 7 even gets to complain about the documents. Revert both.
- [ ] AC6 — `node -e "import('./kernel/stages.ts').then(m=>console.log(m.stageOf('nightly-sandcastle')))"`
  prints `nightly`.

**Commit:** `Add the stage-prefix vocabulary and hold both documents to it (SUP-20)`

**Depends on:** J1.1.

**Risks / what could be wrong:** assertion 7 parses prose. Both lists are a single backticked run on
one logical line in each file, and the parser must tolerate a markdown line wrap in the middle of the
run — `test/corpus.test.ts` already had to learn this. Use `\s+` between tokens, never a literal
space.

---

## J1.17 — TST-20: the shared-database traps and their gate  ·  TST-20, DBS-01

**Goal:** write down the two ways a test suite poisons itself through a database, prove both, and gate
the discipline that avoids them.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/db-sharing.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/CLAUDE.md` (Working rules — one bullet)

### The two traps, at N1

The reference's two documented traps are pipeline-shaped (`setRoute` claiming an `immediate` route
straight into `processing`; a revived row reappearing in a later assertion). Neither exists at N1 —
there is no pipeline. The two that DO exist at N1 are these, and both were measured:

**Trap 1 — the process cache.** `openDb` returns the SAME handle for a path already open. A test that
"opens a fresh database" with a path another test in the same FILE used gets that test's connection,
its already-applied migrations and its rows. The migration you meant to assert never runs, and the
test passes for the wrong reason. `db.test.ts` already avoids it with one `mkdtempSync` directory and
`db-${n++}.db` per test; this job is where that becomes a rule instead of a habit.

**Trap 2 — the file outlives the process.** Measured: `node --test` runs each `*.test.ts` in its own
child process (different pids). So the cache is per FILE, not per suite — which is exactly why a path
that is not unique leaks *between* files, with no shared cache to make it obvious. The second file
sees the first file's rows. Worse: if the first file holds a `BEGIN IMMEDIATE` when the second writes,
the second gets a real `SQLITE_BUSY`, and DBS-04 will faithfully report a product fault that is really
a test-layout fault — a diagnostic message doing its job on the wrong subject.

**Do:**

1. **Add one bullet to `CLAUDE.md`'s Working rules**, in the style of the reference's own line:
   > **Tests share a filesystem, so a database path that is not unique leaks between test FILES.**
   > Settle what you seed. Two traps: `openDb` caches by path, so a reused path inside one file hands
   > two tests one connection and one already-migrated schema; and `node --test` gives each file its
   > own process, so a reused path ACROSS files leaks rows with no cache to make it obvious — and a
   > held `BEGIN IMMEDIATE` turns it into a `SQLITE_BUSY` that reads as a product fault. Every test
   > database lives under `mkdtempSync(tmpdir())`, one directory per file, one file per test.
2. **Tests** in `db-sharing.test.ts`, one `test()` each — these PIN the traps as behaviour so a future
   change to `openDb` that quietly "fixes" the cache goes red and gets discussed:
   1. Trap 1, proved: `openDb(p) === openDb(p)`, and the second caller sees the first's migration —
      `metaGet(ns,"schema_version")` is already `"1"` before it calls `migrate`.
   2. Trap 1, the escape: two different paths under one `mkdtempSync` directory are independent
      handles with independent schema versions.
   3. Trap 2, proved: a child `node -e` process writes a row into a temp database and exits; the
      parent then `openDb`s the same path and reads the row. The file outlives the process.
   4. Trap 2, the sharp end: a child holds `BEGIN IMMEDIATE` and prints `ready`; the parent's write
      to the same path throws the DBS-04 message. The point of the assertion is the message — it
      names the file and the statement, which is exactly what makes the *test-layout* fault
      diagnosable rather than mysterious.
   5. **Deleted.** The first draft asserted `process.ppid !== process.pid`, which is true in every
      process that has ever run — a tautology wearing a gate's clothes. Assertions 3 and 4 already
      prove the whole of trap 2 by *effect*: the file outlives the process, and a lock held across
      processes surfaces as DBS-04's message. The measurement that `node --test` forks per file
      (different pids, measured) stays where it belongs — in this job's prose and in the `CLAUDE.md`
      bullet, cited as measured, not re-derived by a test that cannot fail.
   6. **The discipline gate.** Walk every `*.test.ts` in the repo. For each file whose source names
      `openDb(`, assert it also names `mkdtempSync(`. For each file, assert no `openDb(` call is
      passed a literal starting with `.`, `/` (other than a `tmpdir()`-derived one) or the word
      `projectPath`. This is a static proxy and says so in a comment — the real rule is the CLAUDE.md
      bullet, and this catches the shape that has actually gone wrong.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `kernel/runtime/db-sharing.test.ts` reports 5 passing tests
  (assertion 5 was deleted; the file has 1, 2, 3, 4 and 6).
- [ ] AC2 — the gate fires: add a test file `kernel/runtime/leak.test.ts` that calls
  `openDb("./leak.db")` with no `mkdtempSync`, run `npm test`, and assertion 6 exits non-zero naming
  the file. Delete it.
- [ ] AC3 — the gate fires: remove the by-path cache from `openDb` and `npm test` exits non-zero on
  assertion 1. Revert. (The cache is load-bearing — ten modules opening one file must share one
  connection.)
- [ ] AC4 — `sed -n '/^## Working rules/,/^## Build order/p' CLAUDE.md | grep -c 'mkdtempSync'`
  prints `1`.
- [ ] AC5 — `find . -path ./node_modules -prune -o -name '*.db*' -print | wc -l` prints `0` after a
  full `npm test`.

**Commit:** `Document and gate the two shared-database traps (TST-20)`

**Depends on:** J1.6.

**Risks / what could be wrong:** assertion 4's child holding a lock is the one place a test depends on
a child process being ready. Use the child's stdout `ready` line as the handshake, never a sleep, and
kill the child in a `finally`. A leaked child holding a WAL lock on a temp file is harmless — the file
is under `mkdtempSync` — but a leaked child is still a leaked child.

---

## J1.18 — KRN-06's gate: one place a knob is defined  ·  KRN-06, TST-07

**Goal:** make it impossible for a knob to exist without a row, or a row to exist without a reader.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/config.ts` (edit — `kernelEnv()`)
- `/home/hyhilman/projects/me/doppelganger/test/knobs.test.ts` (new)

### Where the rows live at N1

Each owning module exports its own `EnvSpec` constants, next to the code that reads them:

| module | rows |
|---|---|
| `kernel/instance.ts` | `INSTANCE` |
| `kernel/paths.ts` | `ENGINE_ROOT`, `ENGINE_STATE_DIR`, `<NAME>_DB` (the one family) |
| `kernel/runtime/db.ts` | `SQLITE_BUSY_TIMEOUT_MS` |
| `kernel/runtime/log/emit.ts` | `LOG_LEVEL` |
| `kernel/runtime/log/tail.ts` | `LOG_MAX_BYTES`, `LOG_MAX_READ_BYTES` |
| `kernel/runtime/exec.ts` | `EXEC_TIMEOUT_MS` |
| `kernel/runtime/pool.ts` | *(none — see J1.14)* |

`kernel/config.ts` gains `kernelEnv(): readonly EnvSpec[]`, which imports and concatenates them. At N5
this function is replaced by the `env` member of each `Plugin` manifest (KRN-04) and the rows move
onto plugins **unchanged** — the row shape is already what KRN-04 will carry, so nothing is rewritten,
only re-homed. Write that sentence at `kernelEnv`.

Note the import direction: `config.ts` importing `db.ts` would be a cycle (`db.ts` imports
`config.ts`). So `kernelEnv()` lives in `test/knobs.test.ts`'s own import list instead — the test
imports each module and builds the list. That keeps `config.ts` a leaf, and the *test* is the thing
that has to know every module, which is exactly what it is for.

### What the test can check now

**Do:** one `test()` per numbered assertion.

1. `assertSpecShape` (from J1.2) passes over every real row: key shape, one-line non-empty `why`,
   never both `required` and `default`.
2. **No duplicate keys** across every module's rows. This is KRN-01's duplicate-throws idea one
   milestone early, over data instead of a registry.
3. **`process.env` is named in exactly one non-test file under `kernel/`: `kernel/config.ts`.** This
   is the strongest of the three and the reason the readers take a spec rather than a key: with no
   module able to reach `process.env`, there is no way to read a knob that has no row.
4. **Every row is read.** For each row, its key appears as `<MODULE>_ENV`-style usage: assert the
   owning module's source names the key literal exactly once, and names `envStr(` or `envNum(` with
   that constant. A row nobody reads is documentation pretending to be a mechanism.
5. **Every row's default is the value you get.** Each module exports its resolved value beside its
   row — `export const BUSY_TIMEOUT_MS`, `export const MAX_BYTES`, `export const EXEC_TIMEOUT_MS`,
   and so on. For each row with a `default`, run a child process with a scrubbed env and assert the
   exported value equals the parsed default. **Six children**, one per defaulted row:
   `ENGINE_STATE_DIR` (`.doppelganger/state`, root-relative — J1.4 pins it as a real string
   default), `SQLITE_BUSY_TIMEOUT_MS`, `LOG_LEVEL`, `LOG_MAX_BYTES`, `LOG_MAX_READ_BYTES`,
   `EXEC_TIMEOUT_MS`. The three rows with **no** `default` — `INSTANCE`, `ENGINE_ROOT`, `<NAME>_DB`
   — are skipped by name, each with its reason in the test (two have computed fallbacks, one is a
   family with no single value). This is what makes the spec-taking readers provable rather than
   merely tidy: the row and the value are one object, so they cannot disagree — this assertion
   catches the *reader* breaking, not the two drifting.
6. **Every row appears in `roadmap.md` §2.27.** Parse the backticked tokens out of §2.27's Core/paths
   and Log-report bullets and assert all **nine** N1 keys are among them: `INSTANCE`, `ENGINE_ROOT`,
   `ENGINE_STATE_DIR`, `<NAME>_DB`, `SQLITE_BUSY_TIMEOUT_MS`, `LOG_LEVEL`, `LOG_MAX_BYTES`,
   `LOG_MAX_READ_BYTES`, `EXEC_TIMEOUT_MS`. `EXEC_TIMEOUT_MS` and `INSTANCE` are there because J1.15
   and J1.3 put them there; `ENGINE_STATE_DIR` because J1.4 renamed it. **The parser must handle
   §2.27's rename arrow** — `ENGINE_ROOT` appears as `` `XENITH_ROOT`(→`ENGINE_ROOT`) ``, so take
   every backticked token in the range, not the first one per bullet. This is TST-07's shape, scoped
   to the nine knobs that exist.
7. The one dynamic read (`envDynamic` for `<NAME>_DB`) exists at exactly one call site, in
   `config.ts`, and carries a comment naming the family.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0 and `test/knobs.test.ts` reports 7 passing tests.
- [ ] AC2 — the gate fires: add **and export** the read in `kernel/runtime/pool.ts` —
  `export const SNEAKY = process.env.SNEAKY ?? "";` — and `npm test` exits non-zero on assertion 3
  naming the file. Revert. A bare `const x = process.env.SNEAKY;` is **not** a valid mutation: it
  fails at `pretest` with TS6133 and the gate is never reached (standing note at the top of this
  plan).
- [ ] AC3 — the gate fires: change `envStr` to return `""` for an unset key instead of falling back
  to `spec.default`, and `npm test` exits non-zero on assertion 5 for all six defaulted rows at
  once. Revert. **Note what CANNOT be produced as a mutation: a row whose `default` disagrees with
  the module's value. There is one object, so there is nothing to make disagree — that is the design
  working, and assertion 5 exists to catch the reader breaking, not the two drifting.**
- [ ] AC4 — the gate fires: delete `EXEC_TIMEOUT_MS` from §2.27 and `npm test` exits non-zero on
  assertion 6. Revert.
- [ ] AC5 — the gate fires: add a second row with key `LOG_LEVEL` in `tail.ts` and `npm test` exits
  non-zero on assertion 2. Revert.
- [ ] AC6 — the gate fires: give a row `required: true` and a `default` and `npm test` exits non-zero
  on assertion 1. Revert.

**Commit:** `Gate every knob to exactly one EnvSpec row, and one file that reads the env (KRN-06)`

**Depends on:** J1.15 (the last module with a knob).

**Risks / what could be wrong:** assertion 4 reads source text to prove a row is used, which is a
proxy — a row used only inside a dead branch would pass. The stronger check is assertion 5, which
actually resolves the value in a child. Between them the weak one is redundant; keep both anyway,
because assertion 4 is the one that fires when someone deletes a *reader* and leaves the row.

---

## J1.19 — INS-02's "no third category", and the §1 module map  ·  INS-02, §1

**Goal:** turn two claims that read as prose into two assertions — every write is project-relative or
`INSTANCE`-discriminated with no third category, and §1 names the files that exist.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/test/writes.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/test/layout.test.ts` (edit — one added assertion)

### How "there is no third category" becomes testable

The claim is not that two categories are *nice*. It is that the set of categories is **closed**, and a
closed set is testable if a new member has to be written down somewhere before it works. Three
assertions, and each one shuts a different door.

**Door 1 — a hardcoded path.** No non-test file under `kernel/` may contain a string literal starting
with `/`, nor call `homedir()`, `os.homedir`, `tmpdir()` or `os.tmpdir`. Every path in the kernel is
therefore derived, and every derivation starts at `ROOT`. Firing mutation: add
`const P = "/var/lib/doppelganger";` to `paths.ts`. (The `/` check excludes regular expressions and
`node:` specifiers by only inspecting string literals that reach a path position — in practice, by
matching `"[/~]` and `'[/~]` and allowlisting the handful of `"/"` separators, each named in the
test.)

**Door 2 — a default that escapes the checkout.** For every `EnvSpec` row whose key ends `_DB`, `_DIR`
or `_ROOT`, run a child with `ENGINE_ROOT=/tmp/probe-root` and a scrubbed env and assert the resolved
value starts with `/tmp/probe-root`. A default that resolves anywhere else is a third-category write
by construction, whatever it is called. Firing mutation: change `STATE_DIR`'s default to
`"/var/lib/doppelganger/state"`.

**Two rows in that key set are skipped, by name and with a reason in the test** — a skip nobody wrote
down is a hole:
- **`<NAME>_DB`** ends `_DB` but is the knob **family** row (Gaps item 4). It has no `key` a child can
  set and no single resolved value, so instead the test resolves the family through its one real
  entry point: `dbPath("probe")` under `ENGINE_ROOT=/tmp/probe-root` must start with
  `/tmp/probe-root`. That covers what the row stands for without pretending the row has a value.
- **`ENGINE_ROOT`** ends `_ROOT` and IS the probe. Asserting it starts with itself is a tautology;
  the meaningful check is that setting it **moves** `STATE_DIR` and `dbPath` together, which is
  J1.4's assertion 6.

**Door 3 — a new write path has to sign the register.** The set of non-test files under `kernel/` that
import a write-capable member of `node:fs` or `node:fs/promises` (`writeFileSync`, `appendFileSync`,
`mkdirSync`, `truncateSync`, `rmSync`, `renameSync`, `openSync`, `createWriteStream`, and their
promise forms) must **equal** a literal list in the test, each entry carrying a one-line reason and
its category:

```
kernel/runtime/db.ts        project-relative — mkdirSync for the database's own directory (DBS-01)
kernel/runtime/log/tail.ts  project-relative — copy-then-truncate rotation under LOG_ROOTS (LOG-08)
```

A new module that writes goes red until someone adds a line saying which category it is — which is
INS-02's "a new write path states which it is", made into a build failure. And there is no third
category because **the register has two columns and only two words are accepted in the category
column**: `project-relative` and `INSTANCE-discriminated`. The test asserts that too. A future entry
saying `machine-global` fails on the word.

### Why no `instancePath()` is shipped at N1

INS-02's second category has **no member yet**. The crontab markers are N2 (INS-03), the lease owner
is N4 (INS-04), the queue rows and container names are v1. Shipping a path builder for a category with
no consumer is exactly what D9 warns against: a port designed against no consumer gets designed wrong.
So N1 ships `INSTANCE` (real: it is read, validated and gated) and the **register**, and the first
`INSTANCE`-discriminated write writes the first line in the second column. That is the honest N1
shape, and the register is what makes it safe to defer.

### The §1 module map

One assertion added to `test/layout.test.ts` (it already owns §1's shape):

12. Every `*.ts` and `*.sh` file under `kernel/`, excluding `*.test.ts` and fixtures, is named in §1's
    layout block; and every file §1's `kernel/` block names, whose row is marked `N1`, exists on disk.
    Rows marked `N2`, `N4`, `N5` or `v1` are expected NOT to exist and are asserted absent — the same
    "absent or real, never a placeholder" rule assertion 9 already enforces for directories.

That gate reads what J1.1 wrote nineteen commits earlier, so no commit both writes the map and asserts
it.

**Do:** write `test/writes.test.ts` with doors 1–3, one `test()` each, plus one for the two-word
category vocabulary. Add assertion 12 to `test/layout.test.ts`.

**Acceptance criteria:**
- [ ] AC1 — `npm test` exits 0; `test/writes.test.ts` reports 4 passing tests and
  `test/layout.test.ts` reports 12.
- [ ] AC2 — the gate fires: add `const P = "/var/lib/doppelganger";` to `kernel/paths.ts` and
  `npm test` exits non-zero on door 1 naming the file and the literal. Revert.
- [ ] AC3 — the gate fires: change `STATE_DIR`'s default to an absolute path and `npm test` exits
  non-zero on door 2 showing the resolved value outside `/tmp/probe-root`. Revert.
- [ ] AC4 — the gate fires: add **and use** the write in `kernel/runtime/pool.ts` —
  `import { writeFileSync } from "node:fs"; export const _w = (p: string) => writeFileSync(p, "");`
  — and `npm test` exits non-zero on door 3 naming `pool.ts` and asking which category it is.
  Revert. An unused `import { writeFileSync }` is **not** a valid mutation (TS6133 at `pretest`;
  standing note at the top of this plan).
- [ ] AC5 — the gate fires: change a register entry's category word to `machine-global` and
  `npm test` exits non-zero on the vocabulary assertion. Revert.
- [ ] AC6 — the gate fires: rename `kernel/stages.ts` to `kernel/prefixes.ts` and `npm test` exits
  non-zero on layout assertion 12 naming the unlisted file. Revert.
- [ ] AC7 — `ENGINE_ROOT=/tmp/probe-root node -e "import('./kernel/paths.ts').then(m=>console.log(m.STATE_DIR, m.dbPath('lease')))"`
  prints two paths both starting `/tmp/probe-root`.

**Commit:** `Close the write categories at two, and hold §1's module map to the tree (INS-02)`

**Depends on:** every module job (J1.2–J1.16).

**Risks / what could be wrong:**
- Door 1's string-literal scan is the crudest of the three and will need a small allowlist for
  separators and for `parse.ts`'s regular expressions. Keep the allowlist in the test with a reason
  per entry; a growing allowlist is itself the signal that the check has stopped meaning anything.
- Door 3's import scan matches on the imported NAME, so `import * as fs from "node:fs"` slips through.
  Add `import * as` from `node:fs` to the forbidden shapes and say why: a namespace import hides which
  members are used, which is the whole thing the register exists to make visible.

---

## J1.20 — Close N1 in `WORK.md` and `LOOP.md`

**Goal:** make the state files true: twenty-six N1 items, all ticked, each naming the job that did it.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/WORK.md` (N1 section)
- `/home/hyhilman/projects/me/doppelganger/LOOP.md` (phase table, settled questions, open items)

**Do:**
1. Tick all twenty-six N1 boxes in `WORK.md`, each line naming its `J1.x` job (or jobs).
2. `WORK.md`'s N1 list truncates several rows mid-word (`DBS-06 … so no call site is a blin`,
   `INS-01 … basename, valida`, `INS-02 … and there is`, `TST-20`'s trailing text). Restore each to
   the full §2 sentence while ticking it — a checklist that cannot be read is not a checklist.
3. Fill `LOOP.md`'s N1 row: Plan / Gap / Build / Verify.
4. Add to `LOOP.md`'s **Settled questions**, one bullet each, because each changes a spec row:
   - **TST-18's "byte-identical" is defined** (J1.9): everything from `event=` compared as bytes; `ts`
     and `src` excluded, each asserted on its own terms; the bare/quoted predicate is enumerated so
     collation cannot reach it; and the reference's `msg=""` divergence is fixed rather than pinned.
   - **`node:sqlite` warns on import and the warning stays** (J1.13): two stderr lines per process,
     `parseLine` returns null for both, `causeOf` already filters them, and `emit.ts` must never load
     `node:sqlite` so a logging-only process pays nothing.
   - **`StatementSync.iterate` is a real DBS-06 blind spot in the reference** (J1.6), and naming it
     in the executor set does not close it: measured, `iterate()` returns without throwing and the
     refusal lands on the **first `next()`**, so the wrapper wraps the returned iterator. Its fixture
     is `INSERT … RETURNING` under WAL, because a plain WAL reader is never blocked. The driver's
     member list is pinned so a Node upgrade reports the next member.
   - **An unused import is never a valid gate mutation** (standing note, J1.6/J1.18/J1.19).
     `noUnusedLocals` + `pretest` means TS6133 exits 2 before any test runs, so the AC reads as
     satisfied while the gate is never reached. Every mutation consumes its binding.
   - **`ROOT` comes from `cwd`, not from self-location** (J1.4), because self-location is wrong for a
     published package. One-way; the reference does it the other way and the reason is written down.
   - **INS-02's second category has no member until N2** (J1.19); N1 ships the register instead of a
     speculative builder.
5. Add to `LOOP.md`'s open items: the roadmap gaps this plan found and did not fix (see below), so the
   GAP and VERIFY steps see them.

**Acceptance criteria:**
- [ ] AC1 — `sed -n '/^## N1/,/^## N2/p' WORK.md | grep -c '^- \[ \]'` prints `0`.
- [ ] AC2 — the ticked count equals the count `WORK.md`'s own N1 header states, read from the file
  rather than written twice:
  `H=$(sed -n '/^## N1/p' WORK.md | grep -o '[0-9]\+ items' | grep -o '[0-9]\+'); X=$(sed -n '/^## N1/,/^## N2/p' WORK.md | grep -c '^- \[x\]'); [ "$H" = "$X" ]`
  exits 0. And every ticked line matches `J1\.[0-9]+`. (The first draft wrote `26` into the AC, which
  is the same number the header states — asserting a literal against a literal proves only that the
  author typed it twice.)
- [ ] AC3 — `sed -n '/^## N1/,/^## N2/p' WORK.md | grep -c 'blin$\|valida$\|there is$'` prints `0`.
- [ ] AC4 — `LOOP.md`'s N1 row shows no `—` in Plan or Build, and its Settled questions list names
  TST-18, `node:sqlite`, `iterate`, `ROOT` and INS-02.
- [ ] AC5 — `npm test` still exits 0.

**Commit:** `Close N1 in WORK.md and LOOP.md`

**Depends on:** J1.19.

**Risks / what could be wrong:** none.

---

## Summary of the resolved tensions

| Tension | Resolution |
|---|---|
| **TST-18 says "byte-identical" and two processes read two clocks** | Split the line at `" event="`. The head (`ts`, `level`, `job`, `src`) is four fields asserted individually — `ts` by shape, length and freshness; `job` against `renderValue`; `src` as the one intended difference. The tail, from `event=` onward, is compared `Buffer` to `Buffer`, and that region holds every field the escaping rules govern. `encoding: "buffer"`, hex on failure, exactly one trailing `0x0a` and no `0x0d`. **No test-only seam is added to the emitter to make its clock fakeable.** |
| **The bare/quoted predicate depends on the machine's locale** | Measured, bash 5.2.21 + glibc: **135 codepoints in U+00A1–U+0190 render BARE** under `LC_ALL=en_US.utf8` and QUOTED under `C`, `C.utf8` and `POSIX`, while TypeScript always says QUOTED. A bracket-expression **range** is resolved in `LC_COLLATE`. Fixed by **enumerating** all 70 characters instead of using ranges, which is collation-proof by construction. Gated twice: statically (`log.sh` contains no `[a-z]`-style range, so it fires even on a `C`-only machine) and dynamically (the value matrix runs under every locale `locale -a` reports — 4 here, so the dynamic half really runs more than once). Nothing about which locales exist is pinned. **The matrix carries three non-ASCII values, not one:** `İ` and `ā` both fire; `é` does **not**, so `café` alone catches nothing; and `ŉ` does not either despite sitting inside Latin Extended-A — kept as a negative control, so the fix is never over-generalised into a block range. |
| **The reference's `msg=""` divergence** | The reference drops an empty `msg` in bash and writes `msg=""` in TypeScript, and pins the gap as invisible to the reader. N1 **fixes it** with a `msg_set` flag: a contract with one carve-out grows a second one, and TST-18's whole value is that it has none. |
| **`console.error` could be a format call** | Measured: with a single argument `util.format` leaves `%s`, `%d` and `%%` untouched, so `console.error(line)` is byte-safe today. It stops being safe the moment someone writes `console.error(fmt, x)`. Use `process.stderr.write(line + "\n")`, and pin `%%`, `%s` and `50% done` in the matrix so the refactor goes red. |
| **DBS-04: producing a real `SQLITE_BUSY`, and measuring the wait with no fake clock** | A second `DatabaseSync` holding `BEGIN IMMEDIATE` for the whole call, released in a `finally` after the assertion — deterministic, no timing race, measured five times (`busy_timeout=200 → waited=201ms`; `=5000 → 5005ms`). The wait is `Date.now()` either side. Two ends of the discriminator: `>= 180` at `busy_timeout = 200`, and for "refused outright" the **517 fixture** — a DEFERRED `BEGIN`, a read, an intervening commit, then the upgrade — measuring `waited=0ms errcode=517` **with `busy_timeout = 5000` still in force**. That is strictly better than zeroing the timeout: it shows the near-zero wait with the real timeout applied, which is what "no timeout would ever have helped" actually means. **No retry** is proved exactly, not by wall clock: `withBusyContext` is exported and called with a counting function that must be called once. **No timeout escalation** is proved by reading `PRAGMA busy_timeout` back after a busy throw. |
| **The plan claimed "bounds in one direction only" and has two upper bounds** | Named rather than hidden, because a blanket rule with two silent exceptions is worse than a stated one. **The rule:** every timing assertion is a lower bound, since a loaded host makes a wait longer and never shorter. **The two exceptions, both deliberate:** J1.6 assertion 8's `waited < 50` — measured `0ms` on every run, because a refusal involves no waiting at all, so the bound is a shape check with 50 ms of headroom, not a race; and J1.14 assertion 6's "the first spawn starts at once" (`waited[0] < STAGGER`) — the same shape, an *empty* chain resolving with no timer, with a full stagger of headroom. Neither measures elapsed work; both assert that a wait did **not** happen. Every other timing assertion in N1 is `>=`. |
| **DBS-06: what "blind" means, and proving a NEW call site cannot bypass** | Blind = a path that executes SQL and reports the driver's bare `database is locked` — no file, no statement, no wait. Measured on the pinned Node, `StatementSync` carries **`iterate`**, unwrapped in the reference at `db.ts:79`. N1's set is `{run, get, all, iterate}` + `{exec, prepare}`. Three gates: `node:sqlite` is imported by exactly one non-test file (nobody can reach the driver) · every wrapped method reports under real contention · the driver's member list is pinned to a literal so a Node upgrade — which can only arrive with a `.nvmrc` commit in this repo — reports the next member before it becomes a 3am blind spot. |
| **`iterate` cannot be fixed by adding it to the executor set** | Measured: `iterate()` returns the iterator **without throwing**; the refusal lands on the first `next()`. So adding `"iterate"` to `EXECUTES` changes nothing observable, and "remove it and watch the test go red" is a no-op in both directions — a gate that would ship green over an open blind spot. **The wrapper wraps the returned iterator's `next()`**, keeping `[Symbol.iterator]` on the proxy so `for…of` goes through it. And the fixture cannot be a plain `SELECT`: under WAL a reader is never blocked (measured, `NO ERROR`). N1 uses **`INSERT … RETURNING` under WAL** — a statement that writes and yields rows — and pins the no-error select beside it so nobody simplifies the fixture back into uselessness. Rejected alternative, kept for the record: a rollback-journal `SELECT` under `BEGIN EXCLUSIVE` works, but needs a second journal mode inside a file whose subject is WAL. |
| **An unused import is not a valid gate mutation** | `noUnusedLocals` + `typecheck`-as-`pretest` means an unused binding fails with `TS6133` and `tsc` exits 2 **before any test runs** — measured. The AC then reads as satisfied ("exits non-zero") while the gate it names was never reached. Three ACs in the first draft did this. Every mutation that adds a binding now consumes it, and a standing note at the top of the plan says so once, so the builder does not reintroduce the shape. |
| **INS-02's "there is no third category" is prose** | Made testable by closing three doors. No absolute path literal and no `homedir()`/`tmpdir()` in the kernel · every `_DB`/`_DIR`/`_ROOT` default resolves inside a probe `ENGINE_ROOT` · and every non-test kernel file that imports a write-capable `node:fs` member must appear in a two-column register in the test, whose category column accepts exactly two words. A new write path goes red until someone writes which category it is, and a third word fails on the word. |
| **INS-02's second category has no member at N1** | The crontab is N2, the lease owner N4, queue rows and container names v1. So N1 ships `INSTANCE` (read, validated, gated) and the **register**, and does NOT ship an `instancePath()` builder — a builder with no consumer gets designed wrong (D9). The first `INSTANCE`-discriminated write writes the first line in the second column. |
| **KRN-06 has no plugin to hang off until N5** | Rows live on the owning **module** and are collected by the test, not by `config.ts` (which must stay a leaf, or `db.ts → config.ts → db.ts` is a cycle). The shape is already KRN-04's `env` member, so at N5 the rows are re-homed and not rewritten. The readers take a **spec, not a key** — `envNum(BUSY_TIMEOUT)`, never `envNum("SQLITE_BUSY_TIMEOUT_MS", 5000)` — so there is exactly one copy of every default and drift is impossible rather than merely detected. The gate that makes this stick: **`process.env` is named in exactly one non-test file under `kernel/`.** |
| **SUP-20 has no jobs and no schedule to gate** | TST-09's job-name gate is **not built here** — its subject does not exist until N3, and `WORK.md` already places it there. What is real at N1 is the vocabulary and its three consumers: `roadmap.md` SUP-20, `CLAUDE.md`'s stage-prefix rule, and `STAGES`. The N1 gate holds all three to the same nine prefixes **in order**, and the two documents pre-date the code, so the code is what must match. |
| **`node:sqlite` is experimental and warns on import** | Measured: two stderr lines per process on import alone; type stripping warns not at all. It does **not** break LOG-06 — LOG-07 exists for exactly this, `parseLine` skips both lines, and `causeOf`'s `NOISE` already names them. It is **not silenced** (N0 rejected `--disable-warning`, and the warning is a true statement about a pinned runtime). Its one real consequence is a rule: **`emit.ts` must never load `node:sqlite`**, so a logging-only process pays nothing and TST-18's child processes compare clean bytes. That rule is gated (J1.13 assertion 4) and its violation is demonstrated (J1.9 AC6). |
| **TST-20's two documented traps are pipeline-shaped and the pipeline does not exist** | Replaced with the two that are real at N1 and were measured: the by-path **process cache** inside one file, and the **file outliving the process** across files — `node --test` gives each file its own pid, so a reused path leaks with no cache to make it obvious, and a held `BEGIN IMMEDIATE` turns it into a `SQLITE_BUSY` that reads as a product fault. Both pinned as behaviour; the discipline (one `mkdtempSync` per file) goes into `CLAUDE.md` and is gated statically. |
| **`ROOT`: self-locate or read `cwd`** | The reference walks three levels up from its own file, which is right for a checkout and wrong for a published package — at N5 `kernel/` lives under `node_modules/@doppelganger/kernel/dist/`. N1 reads `ENGINE_ROOT` with a `process.cwd()` fallback, which is exact because SUP-03 spawns every child with `cwd = ROOT`. One-way decision, flagged so the GAP step can argue with it now. |
| **`envNum` on a garbage value** | The reference falls back to the default. N1 **throws**, naming the key and the value: `LOG_MAX_BYTES=8MB` silently becoming 8 MiB is the class of failure found at 3am rather than at boot. |
| **DBS-02 states a rule and names no enforcer** | `migrate` diffs `sqlite_master` around each step and throws, inside the step's own transaction, when an object is created without the `<ns>_` prefix — so the version is not recorded and the fix is a retry. Flagged in Gaps as an addition to be confirmed. |

---

## Gaps I found in the roadmap

1. **`EXEC_TIMEOUT_MS` appears nowhere in `roadmap.md`.** HRN-19 requires a wall-clock bound and the
   reference has the knob; §2.27's Core/paths list does not name it. J1.15 adds it, so J1.18's
   knob↔doc gate can pass. Confirm the name.

2. **`INSTANCE` is not in §2.27's knob list.** INS-01 makes it a real env override with a computed
   default, and §2.27 is meant to be "every knob in the reference, to be re-homed" — but `INSTANCE`
   is not in the reference at all (checked: xenith has no such concept), so it fell through both
   lists. J1.3 adds it.

3. **`FACTORY_STATE_DIR` is a leftover from an incomplete rename.** §2.27 renames
   `XENITH_ROOT`→`ENGINE_ROOT` and `XENITH_TRACKER`→`ENGINE_TRACKER` but leaves `FACTORY_STATE_DIR`,
   which carries a product name from a different repo. J1.4 renames it to `ENGINE_STATE_DIR`.

4. **KRN-06 cannot express a knob FAMILY.** `<NAME>_DB` (DBS-07) and `*_SPAWN_STAGGER_MS` (HRN-18)
   are both families, not keys, and `EnvSpec { key, required?, default?, why }` has no way to say so.
   N1 works around it: `<NAME>_DB` gets a row whose `key` is the literal `<NAME>_DB` and one
   allowlisted dynamic read in `config.ts`; `*_SPAWN_STAGGER_MS` gets **no** row and `pool.ts` takes
   the value as an argument. Both work-arounds are honest at N1 and both get worse at N3 when jobs
   start declaring their own. Either add a `pattern?` field or state that a family is declared once
   per concrete key by its owning plugin.

5. **`time.ts` has no feature ID — FIXED in J1.1, not deferred.** §3's N1 line names it as a file to
   ship and §2 had no row for it, so the very first code commit of the phase would have had no ID to
   cite, breaking `CLAUDE.md`'s own rule immediately. J1.1 folds it into **LOG-01** rather than
   minting a new ID: the clock is what `ts=` *is*, so the line-shape row owns it. Listed here so the
   GAP step does not report it as an unaddressed gap.

6. **`kernel/config.ts` and `host/config.ts` are two different things with one name.** §1 lists both.
   One is the framework's `EnvSpec` reader, the other is one app's settings. J1.1 adds a sentence
   distinguishing them; a rename of one would be better and is not this plan's to make.

7. **LOG-04 states a routing rule and names no module.** LOG-07, LOG-08 and LOG-09 each name their
   file (`parse.ts`, `tail.ts`, `cause.ts`); LOG-04 does not, and its consumer (`ops-log-report`,
   JOB-O02) is N5. J1.10 puts it in `log/route.ts` as a pure function so the rule is testable now.
   Confirm the file name or say the rule lives inside the report job.

8. **DBS-02 states "namespaced tables" and names nothing that enforces it.** The reference does not
   check it. J1.5 enforces it in `migrate` with a `sqlite_master` diff. Confirm that reading, or mark
   DBS-02 advisory — because if it is advisory, the first plugin that creates an un-prefixed table is
   the one that finds out.

9. **DBS-06's executor set is under-specified, and "wrap the method" is not even the right shape.**
   `StatementSync.iterate` exists on the pinned Node and the reference does not wrap it
   (`db.ts:79`); `DatabaseSync.applyChangeset` also executes writes and is wrapped by nobody. Worse,
   measured: `iterate()` does not throw — the refusal lands on the first `next()` — so a row that
   says "wrap `exec`/`prepare` and statement `run`/`get`/`all`" describes a mechanism that cannot
   cover a lazy method **even after you add its name to the list**. The row should either name the
   members and say that a method returning an iterator has its iterator wrapped too, or say the set
   is derived from the driver and pinned. This is the one gap in this list that hides a live bug
   rather than a documentation miss.

10. **`log.sh` is a `.sh` file inside a package whose publish build is `tsc`.** ADO-15's build emits
    `.ts` → `dist/*.js`; a `.sh` next to `emit.ts` is not emitted and is not in any `files` list yet.
    LOG-01's second emitter would silently not ship. This is an N5 problem discovered at N1 — ADO-15's
    row should name non-TS assets, or `log.sh` needs a copy step, and either way it wants deciding
    before the first `npm pack`.

11. **TST-20's two documented traps are stated as if they were universal, and they are not.** Both are
    pipeline-shaped (`setRoute`'s `immediate` route, a revived row) and neither exists before M5. The
    row should either name the traps as pipeline examples of a general rule, or the general rule
    should be stated separately — because at N1 the rule is real and the examples are not.

12. **§2.27's knob list is an inventory of the REFERENCE, not of this repo.** J1.18's gate asserts
    every N1 key appears there, which works only because this plan adds the two missing ones. As
    plugins arrive, §2.27 becomes a second copy of every plugin's `env` member — exactly the drift
    KRN-06 exists to remove. Decide whether §2.27 survives KRN-04 or is generated from it.

13. **No row says a test may leave nothing in the checkout.** J1.5 AC6, J1.12 AC6 and J1.17 AC5 all
    assert it, and it is the practical form of INS-02 for the test suite, but it is nobody's row. A
    `TST-` row saying "the suite writes only under `mkdtempSync`" would give those ACs something to
    cite.
