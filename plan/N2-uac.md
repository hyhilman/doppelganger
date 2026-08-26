# N2 — Supervisor and gate, no entry yet · UAC breakdown

**Retitled.** `WORK.md` and §3 call this phase "Supervisor, one schedule entry". There is no entry
N2 can ship (ruling 1), and a title promising a running entry would let J2.18 tick 32 boxes over a
loop that has never run. The honest claim at the end of this phase is one sentence, and it is what
J2.18 writes into `WORK.md`:

> **Every mechanism the supervisor needs exists, each is exercised over its whole input space, and
> they are wired together in a six-line block that nothing tests. No job has ever run.**

N2 is done when one process owns every tick. Concretely: a schedule that is DATA, read live, with no
compiled copy · a `validate()` that runs before a single timer is registered and collects every fault
in one throw · one croner timer per entry · an in-memory reader/writer gate whose fixed acquisition
order is proved over the whole finite request space, not over one scenario · a heartbeat, a runtime
bound and a drain · `supervisor --list` · and the crontab bootstrap block whose markers carry the
instance name, tested end to end against a fake `crontab` binary that records every call.

No harness, no skills, no jobs. Those are N3. **`SCHEDULE` and `PROGRAMS` ship EMPTY**, and every
mechanism is exercised with fixture entries — see the ruling in "The empty schedule" below.

Eight things the roadmap states but does not resolve are settled here rather than left to the
builder: whether `croner` is a dependency (J2.8) · what the POSIX oracle IS and where croner and
POSIX genuinely disagree, measured (J2.10) · how a test proves the deadlock argument instead of one
scenario, and what it deliberately does NOT prove (J2.4) · what `validate()` can check with no jobs
(J2.9) · how the crontab is exercised without ever reaching the real one, and why `isAbsolute` is
the layer that makes that safe by construction rather than by care (J2.16) · what a declared
non-goal's test asserts (J2.6) · how FIFO with writer priority is tested with no sleeps at all
(J2.5) · and the resource naming §5 Q1 leaves open (J2.6).

**Rule this plan obeys at every step: the phase is green at every commit.** `npm test` exits 0 after
every job. Walk the commits in order and no job imports a file a later job creates.

---

## The three rulings that shape every job below

### 1. The empty schedule

`WORK.md` titles this phase "Supervisor, **one schedule entry**". There is no entry N2 can ship. An
entry must set `job` or `script` (PRT-06, SUP-05); a `job` needs `host/jobs/<name>.ts`, which is N3;
the only `script` entry the roadmap names is `watchdog`, which is JOB-O10 at N4. §3.0 agrees — it
sizes `schedule.ts` at "~1 entry" and lists `nightly-sandcastle` under **N3**.

So: **`SCHEDULE = []` and `PROGRAMS = {}` at N2, and `validate([])` is legal by decision, not by
accident** (J2.9 asserts it with that reason in the test name). Every mechanism is driven by fixture
entries built by an `entry(over)` helper, the same shape the reference's `cron/validate.test.ts`
uses. The first real entry is N3's `nightly-sandcastle`.

This is the same call N1 made when it declined TST-09's job-name gate: build the mechanism, do not
invent the subject. **But "fixture entries cover it" is not one claim, it is three**, and this plan
grades every use of it rather than repeating the phrase:

| grade | what it means | where |
|---|---|---|
| **REAL** | the subject is a function over a value, so a fixture IS the correct input and the input space is fully covered | the gate (J2.4, J2.5) · `parseFive` + the parity walk (J2.8, J2.10) · `validate()`'s 23 rules (J2.9) · `inRefreshWindow` (J2.6, J2.17) · the crontab transforms (J2.15, J2.16) |
| **UNTESTED BY CONSTRUCTION** | the argv block, where `ROOT`, the real gate, the real `spawn`, the real paths and `CRONTAB_CMD` are wired together. No test reaches it — that is exactly what ruling 2 buys, and it is also what ruling 2 costs | `host/supervisor.ts` (~6 lines) · `cli/crontab.ts` (~8 lines) |
| **VACUOUS** | an assertion over an empty subject that cannot fail. **Not shipped.** Three were in the first draft and all three are deleted | ~~`validate(SCHEDULE)` (was J2.9 test 1)~~ · ~~`SCHEDULE.length >= 0` (was J2.10 test 2)~~ · ~~`entriesInWindow(SCHEDULE, null) === []` (was J2.17 test 6)~~ |

**The untested middle is this phase's real risk, and it is counted rather than waved at.** Each argv
block gets one end-to-end AC that runs the real binary against a temp `ENGINE_ROOT` (J2.13 AC7,
J2.14 AC2, J2.16 AC7). Those are **smoke checks, not tests** — they prove the block parses and
dispatches, not that it wired the right values. Everything the blocks assemble is covered; the
assembling is read by a human once and that is the whole assurance there is.

### 2. Impure defaults are resolved in the argv block, never at module scope

Every path and every external command in `host/` and `cli/` arrives through a **required** field on a
`deps` argument. No default. The real values (`ROOT`, `projectPath(".doppelganger/...")`, the
`crontab` binary) are assembled inside a block guarded by
`if (import.meta.filename === process.argv[1])`, which no test ever reaches.

Two things follow, and both are gated (J2.3):

- A test cannot forget to redirect a path, because TypeScript refuses the call without it. This is
  the structural answer to N1's F4 leak (`./leak.db` survived a whole phase because it was
  gitignored and `git status` stayed clean).
- Importing a tool module in a test never runs a command.

### 3. The cron grammar is the INTERSECTION of croner and POSIX

Measured on this machine, 2026-08-26, croner 10.0.1 / Node 22.23.1 — the full numbers are in J2.10:

- **Only one of `dom`/`dow` restricted: 320 of 320 sweep cases agree.** croner is solid there.
- **Both restricted, croner's `nextRun()` skips real firings.** Swept exhaustively over 2024–2032 ×
  `dow` 0–6 × `dom` {1, 2, 15, 29, 30, 31}: **20 missed (expression, date) pairs across 14 distinct
  dates, every one of them in March.** POSIX ORs the two day fields and fires; `nextRun` steps over
  the day.
- **It is NOT a 28-day-February artifact** — the first draft of this plan said it was, and that was
  wrong. The list includes **2024-03-01** and **2028-03-01**, both after a *29-day leap* February.
  What the sweep supports is narrower and more durable: `nextRun`'s day advance loses `dom`-only
  matches on the first days of March. Why, is croner's to explain.
- **The fault is in `nextRun()`, not in the pattern semantics.** `croner.match(date)` agrees with the
  POSIX oracle **30,660 of 30,660** day-slots (2025–2028 × 28 dom/dow expressions), including every
  skipped date above. croner *knows* 2026-03-01 matches `0 0 1 * 1`; only its iterator refuses to
  stop there. That is why no constructor option can avoid it: the supervisor is driven by croner's
  timer, and the timer is driven by `nextRun`.
- **`5/10` (numeric-prefix step): croner THROWS**, POSIX accepts it as `5-59/10`.
- **Names (`MON`), `L`, `#`, `?`, `W`, `@daily`, a 6-field seconds pattern: croner accepts them all**,
  POSIX crontab does not.

So `validate()` refuses everything outside the intersection — the whole dom+dow class included,
because `match` being correct does not help when `nextRun` drives the timer — and the parity test
proves the intersection really is shared. Where they cannot agree, the grammar narrows — it never picks a side.
No test asserts that croner is still wrong (that would rot on the next croner release); the
measurement lives in a comment with its date, and an opt-in `CRON_PARITY_RECHECK=1` re-measures it,
on N0's `CORPUS_RECHECK` precedent.

---

## Job order

1. **J2.1** — `roadmap.md` §1: name the `host/` and `cli/` modules N2 builds, one file per line with
   a milestone tag. Every later job's `Files touched` must be a path §1 already blesses, and J2.2's
   gate reads what this job writes. The J1.1 / J0.4 precedent. Doc only.
2. **J2.2** — `test/layout.test.ts`: the map gate learns (a) which phases have SHIPPED, derived from
   `WORK.md`, and (b) `host/` and `cli/`. Must land before the first N2 file: §1 already tags
   `runtime/gate.ts` as `v0 · N2`, and today's rule says a non-N1 row must be ABSENT from disk — so
   J2.4 would turn the suite red without this.
3. **J2.3** — the three repo-wide registers (`writes`, `knobs`, `process.env`) learn about `host/` and
   `cli/`, plus the two new doors ruling 2 needs. Lands before any host file exists, so every host
   file is gated from its first commit.
4. **J2.4** — `kernel/runtime/gate.ts`. Independent of everything above; the only kernel file N2 adds.
5. **J2.5** — the gate's FIFO queue and writer priority. Split from J2.4 because the queue is where
   the interleaving question lives and it deserves its own commit.
6. **J2.6** — `host/config.ts`: the named resources (§5 Q1) and the refresh window (SUP-10), plus
   INS-05's two assertions. First file under `host/`.
7. **J2.7** — `host/schedule.ts`: `ScheduleEntry`, `Program`, the empty `SCHEDULE`/`PROGRAMS`.
8. **J2.8** — `croner` becomes this repo's first runtime dependency; `host/cron.ts` is the only file
   that imports it. `tickSeconds` and `gateWait` derive from croner, so no cron parser ships.
9. **J2.9** — `validate()`. Needs J2.6, J2.7 and J2.8's `parseFive`.
10. **J2.10** — SUP-07 / TST-15, the parity walk. Needs J2.9's grammar to know what its corpus is.
11. **J2.11** — `runEntry`: the pre-flight order, the child, the runtime bound. The heart of SUP.
12. **J2.12** — GAT-10, lock-starve visibility. Needs J2.11's `lock-held` line.
13. **J2.13** — `main()`: boot, timers, heartbeat, drain, the loud refusal.
14. **J2.14** — `supervisor --list`. Pure; needs the whole resolved shape, so it goes after `main`.
15. **J2.15** — `cli/crontab.ts`, the pure managed-block transforms with per-instance markers.
16. **J2.16** — the crontab tool's side effects, its argv surface and its safe-run surface.
17. **J2.17** — SUP-12: the refresh-window allowlist and the minute-for-minute walk.
18. **J2.18** — close N2 in `WORK.md` and `LOOP.md`.

---

## J2.1 — `roadmap.md` §1: the `host/` and `cli/` module map  ·  §1, SUP-02, SUP-08, GAT-01

**Goal:** make §1 name the files N2 builds, one per line with a milestone tag, so every later job's
`Files touched` is a path the spec already names and J2.2 has a real map to gate against.

**Files touched:** `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§1 layout block only)

**Do:**

1. Replace §1's one-line `host/` block with one file per line, in the same column style the `kernel/`
   block uses:
   ```
   host/                     the app. owns its own schedule, its own resources.
     config.ts               the gate's named resources + the refresh window     N2
     cron.ts                 the croner seam — parseFive, tickSeconds, gateWait  N2
     schedule.ts             ScheduleEntry, Program, SCHEDULE, validate()        N2
     supervisor.ts           runEntry, main, --list — one timer per entry        N2
     jobs/                   one file per job                                    N3
   ```
2. Replace the one-line `cli/` row with a block:
   ```
   cli/                      operator surfaces
     crontab.ts              render | sync | check | sync --adopt (SUP-08)       N2
     skills.ts               render | sync | check (SKL-04)                      N3
     lease-clear.ts          list scope | delete key | --force (LSE-10)          N4
   ```
   `supervisor --list` is deliberately NOT a `cli/` file: SUP-17 is a flag on the supervisor, which
   is where the resolved schedule already lives, and the reference does the same
   (`tsx src/supervisor.ts --list`). Add one sentence under the block saying so, because §1 used to
   name it here and a reader will look.
3. Add one sentence under the block: *"`host/cron.ts` reads cron EXPRESSIONS; `cli/crontab.ts` writes
   the user's CRONTAB. They share four letters and nothing else."* Two files whose names differ by
   three characters need the distinction written down once, exactly as J1.1 did for `kernel/config.ts`
   vs `host/config.ts`.
4. Change nothing else. Do not touch the `kernel/` block — `runtime/gate.ts` is already tagged
   `v0 · N2` and J2.4 ships it under that tag.

**Acceptance criteria:**

- [ ] AC1 — `sed -n '/^## 1\. Target layout/,/^## 2\./p' roadmap.md | grep -c 'supervisor\.ts'`
      prints `1`.
- [ ] AC2 — for each of `config.ts`, `cron.ts`, `schedule.ts`, `supervisor.ts`, `crontab.ts`,
      `skills.ts`, `lease-clear.ts`, `grep -c` over the §1 range prints at least `1`.
- [ ] AC3 — every new file row carries a milestone tag, and **no count is asserted** — the first
      draft asserted `8` and then told the builder not to trust the number, which is two
      instructions where one will do. Run
      `sed -n '/^## 1\. Target layout/,/^## 2\./p' roadmap.md | grep -E '^  \S+\.ts\s' | grep -vcE '\b(N1|N2|N3|N4|N5|v0|v1)\b'`
      and confirm it prints `0`: no file row lacks a tag. Record the tagged-row count in the commit
      body as an observation, never as an assertion.
- [ ] AC4 — the §1 block still closes before `## 2.`:
      `sed -n '/^## 1\. Target layout/,/^## 2\./p' roadmap.md | tail -1` prints
      `## 2. Feature inventory`.
- [ ] AC5 — `git diff --stat` names `roadmap.md` and nothing else.
- [ ] AC6 — `npm test` exits 0. `test/layout.test.ts` assertion 12 parses only the `kernel/` block
      (it anchors on `roadmap.indexOf("kernel/                   the framework")` and stops at
      `"\nplugins/"`), so the new `host/`/`cli/` rows are invisible to it and nothing regresses.

**Commit:** `Name the N2 host/ and cli/ modules in §1 (SUP-02, SUP-08, GAT-01)`

**Depends on:** nothing.

**Risks / what could be wrong:** AC3's count is the one number here that a hand edit can get wrong.
Do not assert it in a test — J2.2's gate derives the set from the file instead.

---

## J2.2 — the layout gate learns about phases and about `host/`/`cli/`  ·  §1, ADO-14

**Goal:** `test/layout.test.ts` assertion 12 currently reads *"a row exists on disk iff its tags
include `N1`"*. The moment J2.4 creates `kernel/runtime/gate.ts` — which §1 tags `v0 · N2` — that
assertion goes red. Fix the rule so it is derived from phase state rather than hand-edited each
phase, and point it at `host/` and `cli/` as well.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/test/layout.test.ts`

**Do:**

1. **Derive the phase state from `WORK.md`, which owns it.** Add `shippedPhases()`:
   - Parse `## N<d> — …` headings and the `- [x]` / `- [ ]` bullets under each, stopping at the next
     `##` or `#` heading (the `# ✅ MVP READY` banner sits between N4 and N5).
   - Ignore `<details>` blocks — the "moved out" rows carry no checkbox.
   - A phase is **SHIPPED** when it has at least one bullet and every bullet is `[x]`.
   - The first phase with an unticked bullet is **CURRENT**. Everything after it is **FUTURE**.
   - Today that yields `SHIPPED = {N0, N1}`, `CURRENT = N2`, `FUTURE = {N3, N4, N5}`, and it stays
     that way for the whole phase because only J2.18 ticks an N2 box.
2. Rewrite assertion 12's rule as three clauses:
   - every real file on disk is named in §1 (**unchanged**, and it is the half that catches a file
     nobody documented);
   - a row whose tags name a SHIPPED phase MUST exist;
   - a row whose tags name no phase at all (`v0`, `v1` alone) or only FUTURE phases MUST be absent;
   - a row naming the CURRENT phase is exempt from both existence clauses — mid-phase it may or may
     not be there yet, and clause 1 still covers it.
3. **Generalise the block parser to take a top-level directory.** It already handles two indent
   levels, the `log/` sub-prefix and multi-file rows; parameterise the anchor
   (`"kernel/                   the framework"` → the first line beginning `<dir>/`) and the stop
   (the next line at indent 0). Run it for `kernel`, `host` and `cli`.
4. `realFiles(dir)` must return `[]` for a directory that does not exist yet — `host/` and `cli/`
   have no `.ts` file at this commit and `readdirSync` on a missing path throws.
5. Keep assertion 12's failure messages naming the phase they read, e.g.
   `§1 names host/schedule.ts as N2, WORK.md says N2 is the current phase — exempt`.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0. `test/layout.test.ts` reports the same assertion count as before plus
      nothing new (this job changes one assertion's rule and adds a helper; it adds no test).
- [ ] AC2 — the phase derivation is right, checked by hand:
      `node -e "…shippedPhases()…"` — or simplest, add a `console.error` temporarily — prints
      `shipped=N0,N1 current=N2`. Record the output in the commit body.
- [ ] AC3 — **the gate fires (FUTURE row must be absent).** Create
      `kernel/registry.ts` containing `export const KIND = "probe";` — §1 tags `registry.ts` as `N5`,
      which is FUTURE. `npm test` exits non-zero, naming
      `§1 names kernel/registry.ts as N5 (not shipped, not current), but it exists on disk`. Delete
      the file. (The mutation consumes nothing and adds no import, so `noUnusedLocals` cannot
      pre-empt it — the file is a module with one used-nowhere export, which TS permits.)
- [ ] AC4 — **the gate fires (SHIPPED row must exist).** `git mv kernel/time.ts kernel/time.ts.bak`,
      run `npm test`: it exits non-zero on `§1 names kernel/time.ts as N1 … but it is absent from
      disk`. Move it back. (Typecheck will also fail here, so run `node --test test/layout.test.ts`
      directly to see assertion 12 itself fire, and record both.)
- [ ] AC5 — **the gate fires (phase state is really read).** Tick every `- [ ]` box under `## N2` in
      `WORK.md`. N2 becomes SHIPPED, and `npm test` exits non-zero naming `kernel/runtime/gate.ts`,
      `host/config.ts` and the rest as absent. Revert `WORK.md`.
- [ ] AC6 — `npm test` exits 0 with `host/` and `cli/` still holding no `.ts` file, proving clause 4
      tolerates the absent directory.

**Commit:** `Derive the §1 map gate's phase rule from WORK.md, and extend it to host/ and cli/ (§1, ADO-14)`

**Depends on:** J2.1.

**Risks / what could be wrong:**
- **`WORK.md` parsing is brittle.** The file has `## N0 — …` headings, a `# ✅ MVP READY — 123 items`
  banner, `<details>` blocks and `~~**SUP-19**~~` strike-through rows. The parser must stop a phase's
  bullet run at the next line starting `#`, and must not count a `- [ ]` inside `<details>` (there is
  none today, which is exactly why a future one would slip through). Assert the derivation's output
  in AC2 rather than trusting it.
- **A partially-ticked N2 keeps the phase CURRENT, which is the whole point** — but it also means the
  N2 rows are ungated until J2.18. Accepted: clause 1 (every disk file is named) still holds all
  phase long, and that is the clause that catches an undocumented file.

---

## J2.3 — the repo-wide registers learn about `host/` and `cli/`  ·  INS-02, KRN-06

**Goal:** `test/writes.test.ts` and `test/knobs.test.ts` walk `kernel/` only. Every file N2 adds
outside `kernel/` would be born ungated. Extend all three registers before the first such file
exists, and add the two doors ruling 2 needs.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/test/writes.test.ts`
- `/home/hyhilman/projects/me/doppelganger/test/knobs.test.ts`

**Do:**

1. Both files: replace the single `KERNEL` root with `SCANNED = ["kernel", "host", "cli"]` and make
   the walker skip a root that does not exist. `plugins/` stays out — it holds no `.ts` file until
   N5, and adding it now would be a scan with no subject.
2. `writes.test.ts` **door 1** (no hardcoded path, no `homedir()`/`tmpdir()`): applies to all three
   roots unchanged. The `HARDCODED_PATH` lookbehind already survives regex literals.
3. `writes.test.ts` **door 3** (fs-writing files sign the register): scan all three roots. `REGISTER`
   gains no entry in this commit — `host/` is empty — but the two-word category vocabulary
   (assertion 4) now governs files outside the kernel too.
4. **New door 5 — writes that leave through a command, not through `node:fs`.** The crontab is
   INS-02's first `INSTANCE`-discriminated write and it is performed by `crontab -`, which door 3
   cannot see. Add:
   - `COMMAND_REGISTER: Record<file, { command, category, reason }>`, empty at this commit;
   - a scan for a **quoted command-name literal** in every non-test file under the three roots,
     against a small set of externally-mutating commands: `crontab`, `systemctl`, `docker`, `at`.
     A file naming one must appear in `COMMAND_REGISTER` with a two-word category.
   - A comment stating the one spelling it cannot see: a name built by concatenation
     (`"cron" + "tab"`) or read from a variable set elsewhere. That is the honest limit, written
     down, per LOOP.md's "a gate that pattern-matches ONE spelling of an import is not a gate".
     `gh` and `git` are deliberately not in the set — `kernel/runtime/exec.ts` names both and they
     are read-mostly wrappers whose write paths are JOB-G's (N5) to register.
5. **New door 6 — no module-scope side-effect path in `host/` or `cli/`** (ruling 2). For every
   non-test file under those two roots, refuse a **top-level** call to `projectPath(`, `dbPath(`,
   `mkdirSync(`, `createWriteStream(` or `readFileSync(`. "Top-level" = the call's line begins at
   column 0 or the call appears inside a top-level `const`/`let` initialiser — implement it as: the
   line matches
   `^(export )?(const|let|var)\b.*\b(projectPath|dbPath|mkdirSync|createWriteStream|readFileSync|writeFileSync)\(`
   OR the line starts at column 0 and contains one of those calls. **The member list in the regex
   and the member list in the prose above it must be the same list** — the first draft named
   `readFileSync` in the prose and dropped it from the pattern three lines later, which is how a
   door ends up narrower than its own documentation. Files under `kernel/` are exempt
   and stay exempt: `kernel/runtime/log/tail.ts`'s `LOG_ROOTS` is a module-scope `projectPath` on
   purpose, and it is a kernel default, not a host one.
   State in a comment which spelling this cannot see: a top-level call routed through a helper
   defined in the same file. Accepted; the required-`deps` typing is the real enforcement and this
   door is the cheap second line.
6. `knobs.test.ts`: extend `findEnvSpecKeys()` and assertion 3 (`process.env` is named in exactly one
   non-test file) to all three roots. Assertion 3's expected value stays `["kernel/config.ts"]`.
7. `knobs.test.ts` assertion 7 (`envDynamic` has exactly one call site): leave the expected list as
   `["kernel/paths.ts"]` — J2.12 adds the second and updates it there, with its reason.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0. `test/writes.test.ts` reports 6 tests (was 4) and
      `test/knobs.test.ts` reports 7 (unchanged).
- [ ] AC2 — **door 5 fires.** Create `cli/probe.ts` with
      `export const CMD = "crontab"; export const use = (): string => CMD;`. `npm test` exits
      non-zero naming `cli/probe.ts names "crontab" and is not in COMMAND_REGISTER`. Delete the file.
      (The export is consumed by `use`, so `noUnusedLocals` cannot fire first.)
- [ ] AC3 — **door 6 fires.** Create `host/probe.ts` with
      `import { projectPath } from "../kernel/paths.ts";\nexport const P = projectPath("x");`.
      `npm test` exits non-zero naming `host/probe.ts: module-scope projectPath(`. Delete the file.
- [ ] AC4 — **the extended door 3 fires outside the kernel.** Create `host/probe.ts` with
      `import { writeFileSync } from "node:fs";\nexport const w = (p: string): void => writeFileSync(p, "x");`.
      `npm test` exits non-zero naming `host/probe.ts` as an unregistered fs writer. Delete.
- [ ] AC5 — **the extended `process.env` rule fires.** Create `host/probe.ts` with
      `export const V = process.env.PROBE ?? "";`. `npm test` exits non-zero: assertion 3's
      `deepEqual` reports `["host/probe.ts", "kernel/config.ts"]`. Delete.
- [ ] AC6 — with `host/` and `cli/` still holding no `.ts` file, `npm test` exits 0 — the walkers
      tolerate an absent root.
- [ ] AC7 — `git status --porcelain` is empty after `npm test`.

**Commit:** `Extend the write, knob and env registers to host/ and cli/, and add the command and module-scope doors (INS-02, KRN-06)`

**Depends on:** J2.2 (order only — these touch different files and could swap, but keeping the two
gate-teaching jobs adjacent keeps the diff readable).

**Risks / what could be wrong:**
- **Door 6's regex is a heuristic.** It reads source text and cannot see indirection. The comment
  must say so, and the required-`deps` typing is what actually enforces ruling 2. Do not let the
  door's existence become an argument for a default.
- **Door 5's command set is a judgement call.** Four names, each with a reason in a comment. A fifth
  arrives with the job that runs it.

---

## J2.4 — `kernel/runtime/gate.ts`: resources, modes, fixed order, self-exclusion  ·  GAT-01, GAT-02, GAT-03, GAT-04, GAT-06

**Goal:** the in-memory reader/writer gate, with its exclusion decision proved against a pure model
over the **entire finite request space** rather than over a handful of scenarios.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/gate.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/gate.test.ts` (new)

### The one design divergence from the reference, and why

The reference's `rwlock.ts` is a **module-global singleton**: a `Map<Resource, ResourceLock>` and a
`Set<string>` at module scope, a hard-coded three-member `Resource` union, and an exported
`__resetGate()` marked *"Test seam: never called in production"*.

N2 ships a **factory**: `createGate(names)` returns a `Gate` object holding its own state. Three
reasons, and the third is the one that matters:

- The resource names are workspace-specific (§5 Q1). A kernel module cannot hard-code
  `factory | plugin | services` without importing the host's vocabulary, which D1 forbids.
- A factory needs no reset seam, so a production export that exists only for tests disappears.
- **INS-05 becomes assertable.** Two gates in one process are two supervisors' worth of independence,
  and J2.6 asserts they exclude nothing from each other. With a singleton that sentence cannot be
  written down at all.

### The API

```ts
export type Mode = "shared" | "excl";
export interface GateHold {
  readonly mode: Mode;
  readonly resources: readonly string[];
  release(): void;                       // idempotent, so `finally` is always safe
}
export interface ResourceState { readonly readers: number; readonly writer: boolean; readonly queued: number }
export interface GateState { readonly resources: Record<string, ResourceState>; readonly self: readonly string[] }
export interface Gate {
  readonly resources: readonly string[];          // the fixed global acquisition order
  acquire(mode: Mode, resources?: readonly string[], waitMs?: number): Promise<GateHold | null>;
  acquireSelf(key: string): (() => void) | null;
  selfHeld(key: string): boolean;
  state(): GateState;
}
export function createGate(names: readonly string[]): Gate;
```

**Do:**

1. `createGate(names)` throws, naming the fault, on: an empty list · a duplicate name · a name that
   is not `^[a-z][a-z0-9_-]*$`. The last one is not fussiness — a resource name is interpolated into
   a `lock-held` log line's `lock=` field (GAT-10) and into `--list`'s resources column (SUP-17), so
   it is checked for the same reason DBS-03 guards `ns` and INS-01 guards `INSTANCE`.
2. **GAT-02, the normalisation, stated once and used everywhere:**
   ```
   want(mode, asked) = mode === "shared"
     ? [...names]                                  // a reader ALWAYS takes all; `asked` is ignored
     : asked.length === 0
       ? [...names]                                // a writer naming nothing takes all (safe default)
       : names.filter(n => asked.includes(n));     // global order, whatever order the caller listed
   ```
   `acquire` throws when `asked` names something the gate does not have — the reference returns a
   bare "no known resource named", which cannot say *which*. `validate()` (J2.9) catches it at boot;
   this throw is the backstop for a caller `validate()` never saw.
3. **GAT-04, the fixed global order.** `want()` filters `names` left to right, so acquisition order
   is a property of the gate, not of the caller. The deadlock argument goes in the module header as
   prose — a total order over resources means no two holders can each hold one and want the other —
   and the test proves the premise (see below).
4. `ResourceLock` is **not exported**. `readers`, `writer`, `queue` are private; `state()` is the only
   view. That is what makes the exhaustive test a test of the contract rather than of the internals.
5. **Partial acquisition is never stranded.** On failing resource *k*, release resources *0…k-1* in
   reverse and return `null`.
6. **GAT-06, per-program self-exclusion.** `acquireSelf(key)` over an own `Set`, keyed on the PROGRAM
   (J2.7's `programOf`), never the entry. The release closure is idempotent.
7. **The MINIMAL queue ships here, not in J2.5.** The first draft shipped only `waitMs <= 0` in this
   job and then had its own level-3 liveness walk start an acquire "with a long wait and NOT
   awaited" — which, with no queue, resolves `null` at once and makes the headline test of GAT-04
   unperformable at its own commit. So J2.4 ships: a FIFO `queue` per resource, a waiter pushed
   **synchronously**, `drain()` on release, and the `waitMs <= 0` fast path that creates no timer.
   J2.5 then owns exactly what its own row is about — **writer priority** (`tryEnter` refusing while
   anyone is queued) and the **whole-acquisition wait budget** — plus the timeout path and its
   unwind.
   Concretely: at this commit `tryEnter` is `admissible(mode)` alone, and J2.5 adds the
   `queue.length > 0` clause. Drain-on-release therefore passes here; J2.5's writer-priority test is
   red until J2.5 adds the clause, which is why it is J2.5's test and not this job's.

### How the test PROVES GAT-04, rather than showing one scenario worked

Three levels, over a synthetic three-name gate `createGate(["a","b","c"])`. The space is finite and
small, so "exhaustive" is literal.

- **The request space.** A request is a `(mode, subset)` pair. Eight subsets of `{a,b,c}` including
  the empty one (which means "all" for a writer and is ignored for a reader), times two modes =
  **16 request shapes**.
- **Level 1 — the exclusion decision matches a pure model, over all 256 ordered pairs.** The model
  is four lines:
  ```ts
  const compatible = (x: Req, y: Req): boolean =>
    (x.mode === "shared" && y.mode === "shared") ||
    want(x).every(r => !want(y).includes(r));
  ```
  For each ordered pair: a fresh gate, A acquires with `waitMs = 0` (must succeed), B acquires with
  `waitMs = 0`, and `assert.equal(b !== null, compatible(a, b))`. Then release A and assert B now
  succeeds. **No timers anywhere** — `waitMs = 0` never creates one.
- **Level 2 — the order is normalised for every caller spelling.** For each of the 7 non-empty
  subsets, for each permutation of that subset (3·1 + 3·2 + 1·6 = 15 orderings), assert
  `hold.resources` deep-equals the subset in `["a","b","c"]` order. This is the premise the deadlock
  argument rests on, checked over every input a caller can produce.
- **Level 3 — no wait-for cycle, over all 64 ordered writer pairs.** For each: A takes its subset;
  B's acquire is started with a long wait and NOT awaited; A releases; `await B` resolves truthy; B
  releases; `state()` shows every resource at `readers: 0, writer: false, queued: 0`. Both complete
  and nothing leaks, for every pair of multi-resource writers there is.

**What this does and does not prove, stated in the module header so nobody overclaims.** A test
cannot prove the absence of deadlock in general. What the three levels give is: the exclusion
decision is exactly the model (level 1, all 256 pairs) · the acquisition order is total and
caller-independent (level 2, all 15 orderings) · and two contending holders both always finish
(level 3, all 64 writer pairs). A total acquisition order extends that to three or more holders by
the standard argument, with no further test needed.

**But the argument carries one premise nothing here tests and nothing in the code forbids: NO HOLDER
EVER ACQUIRES WHILE ALREADY HOLDING.** One task doing `acquire(["c"])` and then, still holding it,
`acquire(["a"])` breaks the total order — it holds a later resource and wants an earlier one, which
is precisely the wait-for cycle the fixed order exists to make impossible, and its mirror deadlocks
against it. The exhaustive walks cannot see this, because every task in them acquires exactly once.

Two things follow, and both are in this job:

- **The premise goes in the module header, in those words, directly above the deadlock argument.** An
  argument whose premise is unstated reads as a proof of more than it proves, and the first draft of
  this plan read that way.
- `runEntry` (J2.11) takes the gate exactly once per tick and holds nothing across the call, which is
  what makes the premise true for the only caller N2 ships. It is **not** enforced by the gate.
  Enforcing it — an owner token, a re-entrancy check — is a design change with no second caller to
  argue with, which is D9's rule. **Flagged in Gaps as a rule the roadmap does not state.**

**Do (tests), one `test()` per group:**

1. `createGate` refuses an empty list, a duplicate name and a bad name — three assertions, each
   naming the offending value.
2. The 256-pair model agreement (level 1).
3. The 15-ordering normalisation (level 2).
4. The 64-pair liveness and no-leak walk (level 3). Performable at this commit because point 7 ships
   the minimal queue: B's unawaited acquire really parks and A's release really drains it.
5. GAT-03 stated by name, because the row exists for it: two writers on disjoint resources both hold
   at once — `excl ["a"]` and `excl ["b"]` — and the assertion message says this is the reason the
   gate is per-resource at all.
6. GAT-02 stated by name: a reader passed `["a"]` still holds all three; a writer passed `[]` holds
   all three.
7. Release is idempotent: `release(); release();` then a writer on the same resource still succeeds
   (a double release must not have decremented twice).
8. Partial acquisition is not stranded: hold `["b"]`, fail `excl ["a","b"]` at `waitMs = 0`, then
   `excl ["a"]` at `waitMs = 0` succeeds.
9. `acquire` throws naming the unknown resource for `excl ["nope"]`.
10. GAT-06: `acquireSelf` refuses a second holder, frees on release, is independent across keys, and
    `selfHeld` agrees with both.
11. **Two gates over the same names exclude nothing from each other** — one assertion here, so
    `gate.ts` carries the property, and J2.6 asserts the INS-05 consequence over the real resource
    list.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0 and `kernel/runtime/gate.test.ts` reports 11 passing tests.
- [ ] AC2 — **the gate fires on the order.** Change `want()` to
      `asked.filter(n => names.includes(n))` (caller order instead of global order). `npm test` exits
      non-zero on group 3, naming a permutation and the two orders. Revert. This is the mutation that
      breaks the deadlock argument, and it is the reason group 3 exists.
- [ ] AC3 — **the gate fires on the model.** Change `admissible("shared")` to `true` (a reader may
      enter while a writer holds). `npm test` exits non-zero on group 2, and the message names the
      first `(a, b)` pair where the implementation and `compatible()` disagree. Revert.
- [ ] AC4 — **the gate fires on the stranding.** Delete the reverse-release loop in the failure path.
      `npm test` exits non-zero on group 8. Revert.
- [ ] AC5 — **the gate fires on self-exclusion.** Change `acquireSelf` to always return a release
      function. `npm test` exits non-zero on group 10. Revert.
- [ ] AC6 — the file contains no `setTimeout` and no `sleep`:
      `grep -cE 'setTimeout|timers/promises' kernel/runtime/gate.test.ts` prints `0`. Every
      assertion in this job is synchronous or awaits an already-settled promise.
- [ ] AC7 — `kernel/runtime/gate.ts` exports no reset function:
      `grep -c '__reset' kernel/runtime/gate.ts` prints `0`.
- [ ] AC8 — the whole file runs in under 2 seconds:
      `time node --test kernel/runtime/gate.test.ts`. 256 + 15 + 64 cases with no timers is a few
      thousand promise resolutions.
- [ ] AC9 — `test/layout.test.ts` assertion 12 still passes: §1 tags `runtime/gate.ts` as `v0 · N2`
      and J2.2 made a CURRENT-phase row exempt from the absence clause.

**Commit:** `The in-memory gate: named resources, fixed global order, per-program self-exclusion (GAT-01, GAT-02, GAT-03, GAT-04, GAT-06)`

**Depends on:** J2.2 (or the layout gate goes red).

**Risks / what could be wrong:**
- **256 fresh gates is 256 objects, not 256 processes.** If this is slow, the test is doing something
  else wrong.
- **The factory is a one-way divergence from the reference.** If N3 finds it needs a process-global
  gate after all, the fix is one module-level `export const gate = createGate(RESOURCE_NAMES)` in
  `host/config.ts` — not a change to `gate.ts`. Flagged so the GAP step can argue now.

---

## J2.5 — the FIFO queue and writer priority  ·  GAT-05

**Goal:** a queued writer blocks readers that arrive after it, the wait budget spans the whole
acquisition rather than each resource, and **the whole phase spends exactly one timing assertion**
getting there.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/gate.ts`
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/gate.test.ts`

### The design constraint that makes this testable without sleeps

**Enqueue is SYNCHRONOUS.** `acquire(mode, res, waitMs)` with `waitMs > 0` pushes its waiter onto the
queue before the call returns — inside the `Promise` executor, which runs synchronously — so
immediately after

```ts
const queued = gate.acquire("excl", ["a"], 60_000);   // NOT awaited
```

`gate.state().resources.a.queued` is already `1`. Every FIFO assertion below reads that fact and
needs no sleep at all. An implementation that enqueued in a `queueMicrotask` or after an `await`
would make writer priority untestable without timing, so **the synchronicity is asserted directly**
(group 1 below) rather than relied on.

The reference's own tests sleep 10 ms "to let the writer queue". They did not need to; this plan
proves they did not.

**Do:**

1. J2.4 already ships the FIFO, the synchronous push and `drain()` on release. This job adds the
   three things GAT-05 is actually about:
   - **Writer priority.** `tryEnter(mode)` refuses when **anyone is queued**, even if the mode would
     otherwise be admissible. That refusal IS the fairness — without it a stream of readers walks
     past a waiting writer, which is the `flock` starvation this replaces.
   - **The timeout.** `acquire(mode, waitMs)` with `waitMs > 0` arms one `setTimeout(waitMs)`
     alongside the waiter. On fire: splice the waiter out, settle `false`, then `drain()` — removing
     a waiter can unblock the ones behind it, and nothing else would notice until the current holder
     happens to release.
   - **The unwind on timeout.** A multi-resource acquire that holds resources `0…k-1` and then times
     out on resource `k` must release what it holds before returning `null`. J2.4 covers this for
     the `waitMs = 0` path; the timeout path is a **different code path** and the first draft never
     restated it. It is the one failure that strands the gate forever, with no owner left to release
     it, so it gets its own test (group 7).
   - The timer is **not** `unref`ed. A pass parked at the gate is real pending work; an unref'd timer
     lets the loop drain out from under it and the promise never settles, so the caller hangs forever
     instead of skipping its tick. `main()`'s drain path calls `process.exit` explicitly (J2.13), so
     nothing here can hold a shutdown open.
2. **The wait budget spans the WHOLE acquisition** (GAT-08's "one of the entry's own ticks" must stay
   true for the entry, not be multiplied by its resource count): compute `deadline = now + waitMs`
   once, and pass `max(0, deadline - now)` to each resource in turn.

**Do (tests), added to the same file:**

1. **Enqueue is synchronous.** A writer holds `["a"]`; start a second writer's acquire with
   `waitMs = 60_000` and do not await; assert `state().resources.a.queued === 1` on the very next
   line. Then release the holder and `await` the queued acquire — it resolves truthy with no timer
   having fired.
2. **GAT-05, writer priority.** A reader holds (all three); start a writer on `["a"]` with a long
   wait, unawaited; assert `queued === 1`; then `await gate.acquire("shared", [], 0)` returns `null`
   — a later reader must NOT overtake the queued writer. Release the reader; `await` the writer,
   truthy.
3. **A run of queued readers drains together.** A writer holds `["a"]`; queue two readers unawaited;
   assert `queued === 2`; release the writer; both readers resolve truthy. A writer would have taken
   it alone — assert that too by queueing a writer behind the two readers and checking it does not
   resolve until both readers release.
4. **The timeout path.** A writer holds `["a"]`; `await gate.acquire("excl", ["a"], 50)` returns
   `null`; `state().resources.a.queued === 0` afterwards, so the timed-out waiter was removed. **This
   is the one timing assertion in N2** — see the table below.
5. **A timeout unblocks the queue behind it.** Writer holds `["a"]`; reader queued with `waitMs = 50`;
   writer queued behind it with a long wait; let the reader time out; release the holder; the queued
   writer resolves truthy.
6. **The budget is whole-acquisition, not per resource.** A writer holds `["c"]`; a writer on
   `["a","c"]` with `waitMs = 50` returns `null`, and the elapsed time is asserted as
   `elapsed < 2 * 50` — the failure it catches is a *per-resource* budget, which would take a full
   100 ms. An upper bound, and therefore an exception (table below).
7. **The unwind on timeout — the one failure that strands the gate forever.** A writer holds `["c"]`
   only. A second writer asks for `["a","c"]` with `waitMs = 50`: it takes `a` at once, parks on
   `c`, and times out. Assert it returned `null` **and** that `a` is free afterwards —
   `await gate.acquire("excl", ["a"], 0)` succeeds, and `state().resources.a` shows
   `{ readers: 0, writer: false, queued: 0 }`. Without the unwind, `a` is held by a caller that no
   longer exists and no release will ever come.
8. **Mixed reader/writer liveness across MULTIPLE resources.** Level 3 in J2.4 walks writer pairs
   only, and group 3 above covers readers on one resource. This is the gap between them: a reader
   holds all three; a writer queues on `["a","b"]`; a second reader queues behind it; release the
   first reader; assert the writer takes `a` and `b` together, then release the writer and assert
   the second reader gets in. Three parties, two resources, and every step observed through
   `state()` with no timer.

### Timing assertions in N2 — the exceptions table

Every other assertion in this phase is synchronous or awaits an already-settled promise. **The first
draft claimed three exceptions and had five**, and two of the missing ones were upper bounds — the
flaky direction — sitting in J2.8 with no entry here. All five are listed.

| # | Where | Assertion | Direction | Headroom | Why it cannot race |
|---|---|---|---|---|---|
| 1 | J2.5 group 4 | `elapsed >= 40` for `waitMs = 50` | lower | 10 ms | A loaded host makes a wait longer, never shorter. Node's `setTimeout` does not fire before its delay. |
| 2 | J2.5 group 6 | `elapsed < 100` for `waitMs = 50` over two resources | **upper** | 50 ms (100%) | The failure it catches is a *per-resource* budget, which takes a full 100 ms. 50 ms of headroom on a 50 ms timer. |
| 3 | J2.8 test 10 | `gateWait("* * * * *")` returns in `< 1000` ms | **upper** | ~1000× | Measured: with the early stop the call is **1 ms** (2 `nextRun` calls); without it, **6.4 s** (30,240 calls). Three orders of magnitude either side of the bound. |
| 4 | J2.8 test 11 | the memoised second `gateWait` call is `< 100` ms | **upper** | ~100× | Same measurement: 1 ms served, and the un-memoised path it guards is seconds. Asserted as a flat bound, never as a ratio between two sub-millisecond numbers. |
| 5 | J2.11 group 7 | second spawn starts `>= 20` ms after the first, with `spawnStaggerMs = 30` | lower | 10 ms | Same direction as row 1. |

Two lower bounds (1, 5) and three upper ones (2, 3, 4). Rows 3 and 4 are upper bounds but not races:
each guards a difference of three orders of magnitude, not a difference of tens of milliseconds. Row 2 is the only upper bound whose headroom is of the same
size as the thing it measures; if it ever flakes the fix is to raise `waitMs` to 200 and keep the
`< 2×` shape, never to delete the assertion.

**One `testDeps` default is load-bearing for this budget: `spawnStaggerMs = 0`.** `spawnChain` in
`kernel/runtime/pool.ts` is module-global and never resets, so `node --test` running one file in one
process means every `runEntry` call in that file joins the same chain. At the default 2000 ms, the
37 tests in `host/supervisor.test.ts` would serialise into over a minute and blow J2.14 AC1. Only
group 7, which is about the stagger, sets a non-zero value.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0 and `kernel/runtime/gate.test.ts` reports 19 passing tests (11 from
      J2.4 + 8).
- [ ] AC2 — **the gate fires on writer priority.** Delete the `this.queue.length > 0` clause from
      `tryEnter`. `npm test` exits non-zero on group 2 — the later reader overtakes. Revert. This is
      GAT-05's whole content and the mutation is one condition.
- [ ] AC3 — **the gate fires on synchronous enqueue.** Wrap the `queue.push(waiter)` in
      `queueMicrotask(() => …)`. `npm test` exits non-zero on group 1 with `queued === 0`. Revert.
      Groups 2, 3 and 5 also go red, which is the point: every FIFO assertion in the file depends on
      this property and it is now stated.
- [ ] AC4 — **the gate fires on the budget.** Change the per-resource wait to the full `waitMs`
      instead of the remaining budget. `npm test` exits non-zero on group 6. Revert.
- [ ] AC5 — **the gate fires on the drain-after-timeout.** Delete the `this.drain()` call in the
      timeout handler. `npm test` exits non-zero on group 5. Revert.
- [ ] AC5b — **the gate fires on the timeout unwind.** Delete the reverse-release loop from the
      *timeout* branch of `acquire` (leaving J2.4's `waitMs = 0` branch intact, so J2.4's own
      stranding test still passes and only the new path goes red). `npm test` exits non-zero on
      group 7. Revert. Two branches, two tests — that is the point of splitting them.
- [ ] AC5c — **the gate fires on multi-resource mixed liveness.** Change `drain()` to `if` instead of
      `while`, so only one queue-head is ever handed the resource. `npm test` exits non-zero on
      group 8 (and on group 3). Revert.
- [ ] AC6 — `grep -c 'setTimeout' kernel/runtime/gate.test.ts` prints `0`: the tests never create a
      timer of their own. The only timers in play are the gate's own, driven by `waitMs`.
- [ ] AC7 — `time node --test kernel/runtime/gate.test.ts` stays under 3 seconds. The only real waits
      are four 50 ms timeouts.

**Commit:** `Gate FIFO with writer priority, and a wait budget that spans the whole acquisition (GAT-05)`

**Depends on:** J2.4.

**Risks / what could be wrong:**
- **Group 6's upper bound is the one assertion here that a very loaded host could flake.** 50 ms of
  headroom on a 50 ms timer means it fails only if the process is starved for a full timer period.
  Named in the table rather than hidden; if it ever flakes, the fix is to raise `waitMs` to 200 and
  keep the `< 2×` shape, not to delete the assertion.
- **`drain()` recursion.** A long queue of readers drains in a loop, not by recursion. Keep it a
  `while`, or a 500-deep reader queue overflows the stack.

---

## J2.6 — `host/config.ts`: the named resources, the refresh window, and INS-05 declined  ·  SUP-10, INS-05, §5 Q1

**Goal:** settle §5 Q1 (who names the gate's resources), state the refresh window ONCE as data, and
give INS-05 — a declared non-goal — a test that keeps it declined.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/config.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/host/config.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§5 Q1: record the answer)

### §5 Q1, settled: the HOST names the resources, and each name carries its path

The question is *"does the kernel take them as config or does each host declare its own set?"* The
roadmap leans host config and INS-05 constrains the answer: **no named resource may be machine-wide,
because the gate cannot exclude across instances.**

That constraint is what turns the leaning into a decision with a test. A resource is not a bare
string; it is a row:

```ts
export interface GateResource {
  readonly name: string;   // what a `lock=` field and `--list` print
  readonly path: string;   // ROOT-relative. This is what makes INS-05 checkable.
  readonly why: string;    // one line; this IS the resource's doc
}
```

`path` is ROOT-relative and never absolute, so `projectPath(path)` resolving inside `ROOT` is the
mechanical form of "this resource lives inside its own checkout". A machine-wide resource cannot be
spelled without the test going red.

**The two resources this repo names at N2**, each with a real writer and a real reader already in the
roadmap:

| name | path | why |
|---|---|---|
| `repo` | `.` | the checkout itself — its refs, its worktrees, its working tree. Every job that commits or resets holds `excl` on it; every job that only reads the tree holds `shared`. |
| `skills` | `.claude/skills` | the rendered skill tree. `skills render`/`sync` (SKL-04, N3) writes it; every spawned agent reads its skills mid-run, so a render under a live agent is the reference's `plugin` resource with the names changed. |

Two, not three, and not one. One resource makes GAT-03 ("two writers on disjoint resources run
concurrently") unexerciseable against the real list, and three would be a guess. Both of these have a
named writer in the roadmap; a third arrives with the job that needs it, and deleting a name from a
host list is a one-line change, not a design change.

### SUP-10: the refresh window, stated once, as data

The reference spells the window as a two-clause predicate (`(dow===5||dow===6) && (h===22&&m>=50 ||
h===23)` plus a tail clause), which is one definition written twice and has an off-by-one at the tail
bound. N2 states it as **an opening time and a length**, so the day-crossing tail falls out instead
of being spelled:

```ts
export interface RefreshWindow {
  readonly opensDow: readonly number[];   // 0 = Sunday
  readonly opensAt: string;               // "HH:MM", UTC
  readonly lengthMin: number;             // half-open: [open, open + lengthMin)
  readonly why: string;
}
export const REFRESH_WINDOW: RefreshWindow | null = null;
export function inRefreshWindow(at: Date, w: RefreshWindow | null = REFRESH_WINDOW): boolean;
```

**`REFRESH_WINDOW` is `null` at N2** and `inRefreshWindow` returns `false` for it. The window exists
to keep readers off a corpus refresh; there is no corpus job until v1 and no job at all until N3, so
declaring bounds now would be a guess dressed as configuration. `validate()` (J2.9) refuses
`clearsRefreshWindow: true` while the window is `null`, so nobody can flag an entry against a window
that protects nothing.

The **mechanism** is fully real and fully tested against a fixture window — the reference's own
Fri/Sat 22:50 + 91 min, used as the test's example precisely because it is the one window anyone has
ever run.

**Half-open is the ruling.** `[open, open + lengthMin)`. The reference's window is inclusive at
00:20, so it is `lengthMin = 91`, and the test pins 22:49 out / 22:50 in / 00:20 in / 00:21 out.

**Do:**

1. Write `host/config.ts` with `GateResource`, `RESOURCES`, `RESOURCE_NAMES`, `RefreshWindow`,
   `REFRESH_WINDOW = null`, `inRefreshWindow`.
   - No module-scope `projectPath` call (J2.3 door 6): `RESOURCES` carries ROOT-relative strings and
     nothing resolves them here.
   - `inRefreshWindow` converts `at` to a minute-of-week in UTC and tests each opening against a
     modular interval, so a window crossing Sunday midnight works with no second clause.
2. Add to `roadmap.md` §5 Q1: the answer, dated, in the shape J0.7 and J0.9 used — *"decided
   2026-08-26: the HOST declares them, as `{ name, path, why }` rows in `host/config.ts`, validated
   at boot (SUP-05). `path` is ROOT-relative, which is INS-05's constraint made mechanical: a
   machine-wide resource cannot be written down. This repo names two, `repo` and `skills`."* Do not
   delete the question — amend it, as §5 Q0 and Q5 were amended.

**Do (tests):**

1. `RESOURCES` is non-empty, names are unique, and each name matches the gate's own name rule
   (`^[a-z][a-z0-9_-]*$`) — imported from `gate.ts` if it is exported there, otherwise re-stated with
   a comment saying which file owns it.
2. Every `why` is one non-empty line (the KRN-06 `why` discipline, applied to a second row type).
3. **INS-05, half one — every resource is inside the checkout.** For each row,
   `projectPath(r.path)` does not throw and starts with `ROOT`. A row with `path: "/var/lib/x"` is the
   mutation.
4. **INS-05, half two — two gates coordinate nothing.** `createGate(RESOURCE_NAMES)` twice; the first
   takes `excl` on `repo`; the second takes `excl` on `repo` at `waitMs = 0` and **succeeds**. The
   assertion message is INS-05's own sentence: *"two supervisors hold two gates with NO mutual
   exclusion between them, and the silence is the hazard. This test exists so the non-goal is
   declined rather than discovered."*
5. `inRefreshWindow(any, null)` is `false` for a spread of 200 minutes across a week — the N2 state.
6. Against the fixture window, the four boundary minutes: 22:49 Fri out, 22:50 Fri in, 00:20 Sat in,
   00:21 Sat out. Plus a Wednesday 23:00, out.
7. A window that crosses Sunday midnight (`opensDow: [6], opensAt: "23:30", lengthMin: 90`) is in at
   Sun 00:00 and out at Sun 01:00 — the modular-interval case the reference needed a second clause
   for.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0 and `host/config.test.ts` reports 7 passing tests.
- [ ] AC2 — **the INS-05 path gate fires.** Add a row
      `{ name: "hostwide", path: "/var/lib/doppelganger", why: "probe" }` to `RESOURCES`. `npm test`
      exits non-zero on test 3: `projectPath("/var/lib/doppelganger")` **throws** `escapes ROOT
      (INS-02)` and the test asserts `doesNotThrow`, so the throw is the failure. (The first draft
      wrote "does not throw", which describes the passing case, not the mutation.) Revert. This is
      the mutation §5 Q1's constraint exists for.
- [ ] AC3 — **the INS-05 independence gate fires.** Change `createGate` to memoise gates by their
      joined name list (a singleton by the back door). `npm test` exits non-zero on test 4. Revert.
- [ ] AC4 — **the window gate fires.** Change `inRefreshWindow` to a closed interval
      (`<= open + lengthMin`). `npm test` exits non-zero on test 6's 00:21 boundary. Revert.
- [ ] AC5 — `sed -n '/^1\. \*\*Name the resources/,/^2\. \*\*Tracker/p' roadmap.md | grep -c '2026-08-26'`
      prints at least `1`.
- [ ] AC6 — `test/writes.test.ts` and `test/knobs.test.ts` still pass with the first `host/` file on
      disk: `host/config.ts` names no `process.env`, no `node:fs` writer and no module-scope path
      call.
- [ ] AC7 — `test/layout.test.ts` passes: §1 names `host/config.ts` with tag `N2`, which J2.2 made
      exempt while N2 is the current phase.

**Commit:** `Name the gate's resources in the host, state the refresh window once, and decline INS-05 with a test (SUP-10, INS-05, §5 Q1)`

**Depends on:** J2.4 (test 4 needs `createGate`), J2.3 (or the new host file is ungated).

**Risks / what could be wrong:**
- **`skills` has no writer until N3.** If SKL-04's renderer turns out not to need gating — it writes
  a tree nothing reads concurrently on this host — the name goes away in one line. Declared here so
  the N3 plan has something to argue with rather than inventing a resource under time pressure.
- **`REFRESH_WINDOW = null` means SUP-10's live subject is absent all phase.** The mechanism is
  tested against a fixture and `validate()` refuses the flag while the window is null, so the
  combination cannot silently read as protection. J2.17 carries the minute-for-minute walk.

---

## J2.7 — `host/schedule.ts`: the entry and program shapes, and the empty schedule  ·  SUP-01, SUP-02, SUP-04, SUP-09, GAT-07

**Goal:** the schedule as DATA — the two shapes, the two empty registries, and the one derivation
(`programOf`) that keys everything else.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/schedule.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/host/schedule.test.ts` (new)

### The shapes

`ScheduleEntry` is **PRT-06 verbatim** — `name`, `cron`, `log`, `env?`, `gateWait?`,
`clearsRefreshWindow?`, `maxRunMin?`, `job` | `script`, `supervised?`, `why` (required). PRT-06 is an
N5 row (`kernel/ports/schedule.ts`) and N2 has to build the thing now, so the interface lives in
`host/schedule.ts` and **moves to the port at N5 unchanged**. That is the same call N1 made for
`EnvSpec`: ship the shape KRN-04 will carry, in the module that needs it, and re-home it later
without rewriting it. Say so in the file header.

`Program` is SUP-02 plus one field:

```ts
export interface Program {
  readonly self: boolean;                      // the old lock_self — per PROGRAM, not per entry
  readonly gate: Mode | "none";
  readonly resources?: readonly string[];      // writers only; omitted means all (GAT-02)
  readonly dotenv: boolean;                    // SUP-04, and it is load-bearing
  readonly whyNoGate?: string;                 // required when gate === "none" (GAT-07)
}
```

**`whyNoGate` is an addition, and it is flagged in Gaps.** GAT-07 says `gate: "none"` exemptions each
state why; the reference states them in code comments, which nothing can check. A required field
makes the row refusable by `validate()` (J2.9) and turns eight comments into eight checked claims.

**`dotenv` has no default** — every program states it. SUP-04 calls it load-bearing for a reason: a
knob reachable only from an `env:` prefix on the entry is the mechanism that keeps a shared `.env`
out of the four programs that must not see it, and a defaulted field would hand it to them silently.

**Do:**

1. Write `host/schedule.ts`: the two interfaces, `PROGRAMS: Readonly<Record<string, Program>> = {}`,
   `SCHEDULE: readonly ScheduleEntry[] = []`, and
   `programOf = (e) => e.job ?? e.script ?? e.name`.
2. Header comment carrying SUP-01's content: the supervisor imports this file and registers one timer
   per entry, so **an entry IS the schedule**. There is no compiled copy, and the crontab
   (`cli/crontab.ts`, J2.15) holds only what carries `supervised: false` — never a rendering of the
   whole schedule. That last sentence is what SUP-01 means after the reference's 2026-08 change, and
   J2.15 asserts it.
3. Header comment carrying SUP-09: `supervised: false` is for an entry the supervisor must NOT own,
   the bar is deliberately high, and the only candidate in the roadmap is `watchdog` (JOB-O10, N4) —
   because a liveness probe scheduled by the process it probes reports nothing in the case that
   matters.
4. `export const supervisedEntries = (s = SCHEDULE) => s.filter(e => e.supervised !== false);` and
   `bootstrapEntries` for its complement. Both take the schedule as an argument with a default, so
   every test drives them with fixtures.
5. **Export the fixture builder from the TEST file, not from the module.** `host/schedule.test.ts`
   exports `entry(over?: Partial<ScheduleEntry>): ScheduleEntry` and
   `program(over?: Partial<Program>): Program`, and J2.9/J2.11/J2.13/J2.14/J2.17 import them. A
   fixture builder in a production module is a shape nothing ships using.
   `node --test` runs the file that exports them, and it has its own tests, so nothing is a bare
   fixture module.

**Do (tests):**

1. `SCHEDULE` is empty and `PROGRAMS` is empty — asserted **by name**, with the reason in the test
   title: `"the schedule is empty at N2 by decision — the first entry needs a job (N3) or the
   watchdog script (N4)"`. This is what stops a later reader reading emptiness as an accident.
2. `programOf` prefers `job`, then `script`, then `name` — three assertions, plus one for an entry
   with both set (returns `job`; `validate()` refuses the entry separately, and this test says which
   layer owns which).
3. `supervisedEntries` / `bootstrapEntries` partition a five-entry fixture with two `supervised:
   false`, and their lengths sum to the input length.
4. The fixture builders produce an entry and a program that satisfy every rule `validate()` will
   check — asserted at J2.9, not here, because `validate` does not exist yet. Here: assert the
   builders are deterministic (two calls with no arguments deep-equal each other) so a later test
   comparing two fixtures is comparing the values it thinks it is.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0 and `host/schedule.test.ts` reports 4 passing tests.
- [ ] AC2 — `npm run typecheck` exits 0 with `Program.dotenv` required: adding a program literal
      without `dotenv` fails with `TS2741` naming `dotenv`. Prove it by adding
      `PROBE: { self: false, gate: "none", whyNoGate: "probe" }` to `PROGRAMS`, running
      `npm run typecheck`, recording the error, and reverting. (The mutation is consumed by the
      object literal, so `noUnusedLocals` cannot fire first.)
- [ ] AC3 — the same for `why`: an entry literal without `why` fails typecheck with `TS2741`.
- [ ] AC4 — **the gate fires on emptiness.** Add one fixture-shaped entry to `SCHEDULE`. `npm test`
      exits non-zero on test 1. Revert. The point of an assertion nobody can pass by accident is
      that adding the first real entry at N3 is a deliberate act with a test to update.
- [ ] AC5 — `grep -c 'PRT-06' host/schedule.ts` prints at least `1`, so the shape's owning row is
      cited where the shape lives.
- [ ] AC6 — `git status --porcelain` is empty after `npm test`.

**Commit:** `The schedule as data: ScheduleEntry, Program, and two empty registries (SUP-01, SUP-02, SUP-04, SUP-09, GAT-07)`

**Depends on:** J2.4 (`Mode`), J2.6 (nothing structural — order only).

**Risks / what could be wrong:**
- **`whyNoGate` is an addition to SUP-02's field list.** If the GAP step rejects it, the fallback is
  a comment and `validate()` loses one check. Flagged in Gaps item 4.
- **A fixture builder living in a `.test.ts` file is imported by four other test files.** That is
  fine for `node --test` (it is a module like any other) but it means editing the builder can turn
  four files red at once. That is the correct blast radius for a shared fixture and it is why the
  builder is deterministic (test 4).

---

## J2.8 — `croner` arrives; `host/cron.ts` derives the tick  ·  GAT-08, GAT-09, TST-25 (narrow)

**Goal:** answer the dependency question in code, put the only `croner` import behind one file, and
derive `gateWait(cron)` from croner itself so **no cron parser ships in production**.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/package.json` (a new `dependencies` key)
- `/home/hyhilman/projects/me/doppelganger/package-lock.json`
- `/home/hyhilman/projects/me/doppelganger/host/cron.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/host/cron.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/test/deps.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/test/knobs.test.ts` (`ROWS` + `readers`)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27: `GATE_WAIT_CAP_S`)

**Every job below that lands an `EnvSpec` row also touches `test/knobs.test.ts`, and it is not
optional.** Since N1 F3 closed the `>=` hole, assertion 2 is an exact `deepEqual` between the keys
scanned out of the tree and the curated `ROWS` list — so a new row with no `ROWS` entry fails the
suite in the commit that adds it. The first draft of this plan omitted `knobs.test.ts` from four
jobs' `Files touched` (J2.8, J2.11, J2.13, J2.16) and every one of them would have shipped red.

### The dependency question, answered plainly

**N2 adds `croner`, pinned exactly at `10.0.1`, as a root `dependencies` entry.** Node ships no cron
scheduler and no cron parser; there is no `node:` builtin to prefer, which is the only reason N0 and
N1 could get to **200 tests (199 pass, 1 skip)** with two devDependencies. Measured, not recalled — the
first draft wrote "199 tests", which is the pass count, not the total.

Why the alternative was rejected: writing the parser instead would make SUP-07 circular. The row
demands croner-vs-POSIX parity, and **parity with what** if croner is not there? The whole value of
that test is that two independent implementations agree on ~100k minute-slots — one of them has to be
software somebody else wrote. Writing our own `nextRun` would put the scheduler and its only oracle
in the same head, and the failure it protects against (a job quietly running on the wrong minutes, or
never) does not throw.

How it survives the constraints already in force:

- **TST-22 (no linter, no bundler, no build step) is untouched.** It governs the toolchain, not the
  runtime. `test/toolchain.test.ts`'s `DENYLIST` names linters, bundlers, test frameworks and runner
  shims; `croner` is none of those and the file needs no edit.
- **TST-25 (no phantom dependencies, N5)** says every package specifier in a workspace resolves to a
  declared dependency **of that workspace**. `host/` is deliberately not a workspace (ADO-14,
  asserted in `test/layout.test.ts` assertion 6), so its dependency owner is the root manifest, which
  is where `croner` goes. No workspace imports it, so nothing is phantom. `test/deps.test.ts` (below)
  ships the narrow form of the check now and the general form arrives with TST-25 at N5.
- **The publish story is unaffected.** `@doppelganger/kernel` and the plugin packages are what
  publish (ADO-01); `host/` is the app and publishes nothing. `kernel/` must never import `croner`,
  and that is asserted, not assumed.
- **Zero transitive dependencies.** Measured: `croner@10.0.1` has an empty `dependencies`, ships its
  own `.d.ts`, and declares `engines.node >= 18`. Asserted from the installed package, with a failure
  message that says *"croner gained a dependency — decide, then update the pin"*, because a new
  transitive dep can only arrive with a `package.json` commit in this repo.

### `gateWait` derives from croner, so nothing hand-written parses cron

The reference walks 21 days minute-by-minute with its own `expand()`. N2 enumerates croner's own
firings instead, which is strictly more correct: "one of the entry's own ticks" must mean one of the
ticks the supervisor will actually fire, and the supervisor fires croner's.

**And it must stop early, or it is unusably slow.** Measured on this machine, croner 10.0.1: one
`nextRun` call costs about 0.2 ms, so enumerating `* * * * *` over 14 days (20,160 firings) takes
**3.4 s**, and over 21 days (30,240 firings) about 5 s. `runEntry` calls `gateWait` on every tick.

Two mechanisms, both required:

- **Early stop.** `gateWait` only ever needs `min(tick, GATE_WAIT_CAP_S)`, so the enumeration stops
  the moment it sees a gap `<= cap`. A dense expression stops after two firings; a sparse one runs
  the window but a sparse one has few firings. Worst case — every gap just above the 1800 s cap —
  is 21·86400/1800 ≈ 1008 firings ≈ 0.25 s.
- **Memoisation.** A `Map<string, number>` keyed on the expression, because the same entry asks the
  same question every tick.

```ts
export const CRON_ANCHOR = Date.UTC(2026, 1, 22);   // Sunday 22 Feb 2026, 00:00 UTC
export const GATE_WAIT_CAP_S_ENV: EnvSpec;          // default "1800"
export function parseFive(expr: string): { ok: true } | { ok: false; problems: readonly string[] };
export function firings(expr: string, fromMs: number, toMs: number, stopAtS?: number): number[];
export function tickSeconds(expr: string, days?: number, stopAtS?: number): number;
export function gateWait(expr: string): number;     // memoised; min(tick || cap, cap)
export interface Timer {          // the slice of croner's `Cron` this repo depends on
  readonly name: string | undefined;
  nextRun(from?: Date): Date | null;
  stop(): void;
}
export function newTimer(e: ScheduleEntry, fn: () => void): Timer;
```

**`CRON_ANCHOR` is Sunday 22 February 2026, 00:00 UTC**, and every window in N2 starts there. Three
reasons, all of which matter: it is a Sunday, so all seven weekdays appear in the first seven days ·
February 2026 has 28 days, so a 14-day window crosses a month end on day seven, which is exactly
where croner and POSIX disagree (J2.10) · and it is fixed, never `Date.now()`, or `gateWait` would
differ run to run and `crontab check` would report drift that is not there.

`tickSeconds` uses **21 days** (a weekly expression needs more than 14 to show two firings);
J2.10's parity walk uses **14** because SUP-07 says so. One anchor, two lengths, each with its reason
in a comment.

**Do:**

1. `npm install --save-exact croner@10.0.1`. Confirm `package.json` gains
   `"dependencies": { "croner": "10.0.1" }` — exact, no caret, matching how `typescript` and
   `@types/node` are already pinned — and that `package-lock.json` is updated in the same commit.
2. Write `host/cron.ts`:
   - `parseFive` implements the **intersection grammar** (ruling 3): exactly five whitespace-separated
     fields; each field a comma list of `*` | `N` | `N-M`, optionally `/S`; numeric values only;
     `N <= M`; values in range (`dow` accepts 0–7 with 7 ≡ 0); `1 <= S <= fieldMax`; **`N/S` without
     a range is refused** with a message telling the writer to spell it `N-max/S`; **`dom` and `dow`
     may not both be restricted**; and finally `new Cron(expr, { paused: true })` must not throw.
     Returns every problem, never the first.
   - `firings` enumerates with `nextRun` from `fromMs - 60_000`, stopping when a gap `<= stopAtS` is
     seen (when `stopAtS` is given).
   - `tickSeconds` = the smallest consecutive gap in the window, in seconds; `0` when fewer than two
     firings — the caller reads `0` as "rarer than the window" and takes the cap.
   - `newTimer` = `new Cron(e.cron, { timezone: "UTC", name: e.name, protect: false, catch: true },
     fn)`. `protect: false` on purpose: overlap is a per-PROGRAM property and `PROGRAMS[].self` is
     where it is already stated; two mechanisms for one question is how they drift apart.
     **A live `Cron` holds the event loop open** — measured: `timeout 5 node -e '<construct one>'`
     exits **124**, and the same script with a `stop()` exits **0**. The return type is `Timer`
     above, not `{ stop(): void }`, because the test asserts `nextRun()` and `name`, and because
     `stop()` is the only thing that lets a process — or a `node --test` file — exit. Any test that
     builds a live timer must `stop()` it in a `finally`, and the module header says so.
   - Add `GATE_WAIT_CAP_S` to §2.27's Core/paths list in the same commit (`knobs.test.ts` assertion 6
     requires it), with the row's `why`: *"longest a gate writer may block — a job whose own tick is
     rarer than this waits the cap, not its interval"*.
3. Write `test/deps.test.ts`, on `test/no-raw-sqlite.test.ts`'s shape:
   - the set of files importing `croner` equals `{ "host/cron.ts" }`, matched with a regex covering
     **four** spellings: `from "croner"`, `require("croner")`, a dynamic `import("croner")`, and
     **the bare side-effect form `import "croner";`** — no `from` clause at all.
     **The fourth is the one this repo has now missed four times.** Measured: `import "croner";`
     resolves and loads the module, and `no-raw-sqlite.test.ts`'s three-form pattern — which this
     test was going to copy — does not see it. `LOOP.md`'s standing rule exists because N1 shipped
     three gates that matched one spelling; this would have been the fourth.
   - the set of **bare package specifiers** (not `node:`, not relative) across every non-test `.ts`
     under `kernel/`, `host/`, `cli/` equals `{ "croner" }`, and each is declared in the root
     `dependencies`. The scan must match a specifier in **all four positions** too, not only after
     `from` — one shared `SPECIFIER_RE` used by both clauses, so the two cannot drift. This is
     TST-25's narrow form, shipped by the phase that creates the first dependency; the general
     per-workspace form arrives at N5.
   - a comment naming what the scan cannot see: a specifier built by concatenation, or one held in a
     variable and passed to a dynamic import. Accepted and written down, per LOOP.md.
   - `kernel/` names no bare specifier at all — the published package stays dependency-free.
   - `node_modules/croner/package.json` has no non-empty `dependencies`.
   - `package.json`'s `croner` version has no range character (`^`, `~`, `*`, `>`, `<`) and equals
     the version `package-lock.json` resolved.

**Do (tests, `host/cron.test.ts`):**

1. `parseFive` accepts the forms this repo will use: `* * * * *`, `*/10 15-21 * * *`,
   `0,10,20,30 22 * * *`, `4-59/5 * * * 1-4`, `13-58/15 1-10 * * 1-5`, `0 23 * * 5,6`, `0 0 * * 7`,
   `45 * * * *`, `0 0 1 * *`, `0 0 28-31 * *`.
2. `parseFive` refuses, each with its own assertion and a message naming the rule: four fields · six
   fields · `5/10` · `*/0` · `*/61` · `60 * * * *` · `* 24 * * *` · `0 0 32 * *` · `0 0 0 * *` ·
   `0 0 * 13 *` · `0 0 * * 8` · `10-5 * * * *` · `0 0 * * MON` · `0 0 L * *` · `0 0 * * 5#2` ·
   `0 0 ? * 5` · `0 0 15W * *` · `@daily` · `0 0 1 * 1` (dom+dow).
3. `parseFive` reports **every** problem, not the first: `bad 24 32 13 8` yields five problems.
4. `tickSeconds` takes the CLOSEST gap, not the first or the mean: `*/10 15-21 * * *` → 600 (10 min
   inside the hour, ~17 h from 21:50 to the next 15:00) and `0,10,20,30 22 * * *` → 600.
5. `tickSeconds` crosses hour and day boundaries: `45 * * * *` → 3600, `53 8 * * *` → 86400.
6. `tickSeconds` reads a multi-leg weekly as the gap between its own legs: `0 23 * * 5,6` → 86400 and
   `0 1 * * 0,6` → 86400 — reading "weekly" off the day field would overstate both by 7×.
7. `tickSeconds` is deterministic: two calls on the same expression are equal, and a comment says the
   anchor is fixed for exactly this reason.
8. `gateWait` is one tick under the cap (`*/10 15-21 * * *` → 600) and the cap above it
   (`53 8 * * *` → 1800, `45 * * * *` → 1800).
9. **GAT-09, the invariant the derivation exists for:** for every expression in the corpus with
   `tickSeconds > 0`, `gateWait(expr) <= tickSeconds(expr)`. Waiting longer than your own interval is
   strictly worse than skipping — you hold your self-lock through the ticks you are waiting for, so
   you cause the skips you were trying to avoid.
   **The corpus for THIS test excludes `* * * * *`, and the reason is a measurement, not taste.**
   The invariant needs the true tick, so it calls `tickSeconds` **without** `stopAtS` — and for
   `* * * * *` that is 30,240 `nextRun` calls, measured at **6.4 s**, which alone breaks AC8's
   "under 5 seconds" budget for the whole suite. `*/5 * * * *` (6,048 firings, ~1.3 s) is the densest
   expression this test walks and it exercises the same code path. A comment carries both numbers so
   nobody adds the every-minute case back without seeing the price.
10. **The early stop is real and is what makes this usable.** `gateWait("* * * * *")` returns 60, and
    the call completes in under 100 ms. Without the early stop the same call enumerates 30,240
    firings and takes about 5 s. Recorded as a *lower-bound-free* assertion: assert only
    `elapsed < 1000`, with 10× headroom over the measured 3–5 s failure and 10× over the measured
    sub-10 ms success. Comment names both measurements.
11. Memoisation: `gateWait` called twice on the same expression returns the same value and the second
    call is not slower — asserted as "both under 100 ms", not as a ratio.
12. `newTimer` builds a live timer for a fixture entry: the returned object's `nextRun()` is
    non-null and its `name` equals the entry name. **The timer is stopped in a `finally`** — a live
    `Cron` keeps the event loop open (measured above), so without the `stop()` this one test hangs
    `node --test` for the whole file. Assert afterwards that `nextRun()` still answers, so `stop()`
    is not silently a `dispose()`.
    **We do not test that croner's timer fires** — that would cost a minute of wall clock and would
    be a test of croner. What we test is that the pattern croner will fire on is the pattern POSIX
    fires on, and that is J2.10.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `host/cron.test.ts` reports 12 passing tests and `test/deps.test.ts`
      reports 5. `test/knobs.test.ts` still reports 7, now with `GATE_WAIT_CAP_S` in `ROWS`.
- [ ] AC2 — `npm ci` in a fresh clone of this commit exits 0 and `npm test` exits 0 there — the
      lockfile is in the same commit. Record the clone path in the commit body.
- [ ] AC3 — assert on a **field**, not on an object dump:
      `node -e "console.log(require('./package.json').dependencies.croner)"` prints `10.0.1` — a bare
      string with no `^`, `~` or other range character. (`console.log` of the object itself can print
      a `[Object: null prototype]` prefix depending on how the JSON was parsed, which makes an
      eyeball comparison unreliable; a field read cannot.)
- [ ] AC4 — **the import gate fires.** Add `import { Cron } from "croner";` plus a use
      (`export const probe = (): unknown => Cron;`) to `kernel/runtime/gate.ts`. `npm test` exits
      non-zero on `test/deps.test.ts` naming `kernel/runtime/gate.ts` in two assertions — the
      croner-importers set and the "kernel names no bare specifier" clause. Revert. The mutation
      consumes the binding, so TS6133 cannot pre-empt it.
- [ ] AC4b — **the fourth spelling is really covered.** Add the bare side-effect line
      `import "croner";` to `kernel/runtime/gate.ts` — nothing to consume, so `noUnusedLocals` has
      nothing to say and the file still typechecks. `npm test` exits non-zero on the same two
      assertions. Revert. Run this one even if AC4 passed: AC4 passes with a three-spelling regex
      and this one does not, which is the whole point.
- [ ] AC4c — **the knob row is registered.** Remove `GATE_WAIT_CAP_S_ENV` from `ROWS` in
      `test/knobs.test.ts` while leaving the row in `host/cron.ts`. `npm test` exits non-zero on
      knobs assertion 2. Restore.
- [ ] AC5 — **the grammar gate fires.** Delete the dom+dow clause from `parseFive`. `npm test` exits
      non-zero on test 2's `0 0 1 * 1` case. Revert.
- [ ] AC6 — **the early-stop gate fires.** Remove the `stopAtS` argument from `gateWait`'s call into
      `firings`. `npm test` exits non-zero on test 10 (`elapsed < 1000`), and the run takes several
      seconds longer. Revert. Record the two measured times in the commit body.
- [ ] AC7 — **the GAT-09 invariant gate fires.** Change `gateWait` to
      `Math.min(tickSeconds(e) * 2 || cap, cap)`. `npm test` exits non-zero on test 9 for every
      expression whose tick is under 900 s. Revert.
- [ ] AC8 — `time npm test` grows by under 5 seconds against the N1 baseline. Record both numbers.
- [ ] AC9 — `test/toolchain.test.ts` still passes unmodified: `croner` is on no denylist and adds no
      config file.

**Commit:** `Add croner (10.0.1, exact, zero deps) and derive the gate wait from it (GAT-08, GAT-09)`

**Depends on:** J2.7 (`ScheduleEntry` for `newTimer`), J2.3 (the knob scan must already reach
`host/`).

**Risks / what could be wrong:**
- **This is the phase's one-way door.** Every later job assumes croner. If the GAP step rejects the
  dependency, J2.8, J2.10, J2.11 and J2.13 all change shape, so it is the first thing to rule on.
- **croner's `nextRun` is slow.** 0.2 ms per call is a measured property of a library outside this
  repo, so no test pins it. Test 10 pins the CONSEQUENCE — that `gateWait` on the densest possible
  expression returns in well under a second — which stays true whether croner gets faster or the
  early stop is what saves us.
- **`GATE_WAIT_CAP_S` is inherited from the reference (1800), not derived.** There is no measured
  pass here to size it against. Written down as inherited, in the knob's `why`.

---

## J2.9 — `validate()`: the boot gate  ·  SUP-05, SUP-18, SUP-09, GAT-07

**Goal:** the one function standing between a typo in the schedule and a fleet that comes up looking
alive and doing nothing. It collects every fault and throws once, each line naming its entry.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/schedule.ts`
- `/home/hyhilman/projects/me/doppelganger/host/validate.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.7 SUP-05: two added checks)

### What `validate()` can actually check with no jobs and no skills

The prompt's warning is the right one: do not build a gate whose subject does not exist. `validate()`
is not that. It is a **function over a value**, and its subject is the entry it is handed. Every rule
below is exercised against a fixture entry with exactly one field broken — the reference's own
`cron/validate.test.ts` shape — so the rule set is fully covered on a day when `SCHEDULE` is empty.

What N2 does NOT build, deliberately:

- **No docs↔code count of the check list.** TST-06 is **cut by D17** and §3's N2 line says so. A test
  that counts the bullets in §2.7 SUP-05 and compares them to the number of rules would be exactly
  the gate D17 removed.
- **No live assertion over `SCHEDULE`** beyond `validate([])` not throwing. There is nothing in it.

### The rule list

`validate(entries, opts)` where `opts` carries `{ programs, resourceNames, refreshWindow, logRoots,
jobsDir, root }`, all defaulted to the real values so a caller writes `validate()` and a test writes
`validate([e], { logRoots: [tmp] })`.

Per entry, `entry "<name>": <problem>`:

1. duplicate `name`
2. `name` carries a known stage prefix (`stageOf(name) !== MISC`) — SUP-20's own words are *"every job
   name **and schedule entry** carries a known prefix"*. The entry half is checkable now; the job-file
   half is TST-09 at N3.
3. `cron` is exactly five whitespace-separated fields
4. `cron` satisfies `parseFive` — every problem it reports becomes a line here, prefixed with the
   entry name
5. `log` is absolute
6. `log` sits under one of `logRoots` — **an addition, flagged in Gaps.** SUP-18 says two log roots
   and both are read; an entry writing outside both is a job whose output the reporter never sees,
   which is the silent half of "log paths explicit per entry"
7. `why` is non-empty after `trim()`
8. both `job` and `script` set
9. neither set
10. `job` set but `<jobsDir>/<job>.ts` does not exist
11. `script` set but `<root>/<script>` does not exist
12. `script` is absolute — INS-02: a script path is project-relative or it is a third category
13. `maxRunMin` present and not `> 0`
14. no `PROGRAMS` row for `programOf(e)` — refusing to boot is the only safe reading: defaulting to
    `shared` ungates a writer and defaulting to `excl` deadlocks a reader against itself
15. the program's `resources` names something outside `resourceNames`
16. `gate: "shared"` **and** `resources` set — a reader takes all three, so naming any is a
    contradiction
17. `gate: "none"` with no non-empty `whyNoGate` (GAT-07) — **an addition, flagged in Gaps**
18. `dotenv` is not a boolean
19. `gateWait` set on a program whose `gate` is `"none"` — nothing to wait for
20. `clearsRefreshWindow` set on a program whose `gate` is `"none"` — it blocks nothing, and it reads
    to the next person as though that job had been considered and made safe
21. `clearsRefreshWindow` set while `refreshWindow` is `null` — **an addition**: at N2 there is no
    window, so the flag would skip nothing and claim protection
22. more than one entry with `supervised: false` — SUP-09 says *exactly* one; an empty schedule has
    zero, so the enforceable form is **at most one**, and the difference is flagged in Gaps
23. unescaped `%` in a bootstrap entry's rendered command (`supervised: false` only) — `%` is a
    newline to cron and everything after it becomes the command's stdin. The supervisor spawns argv
    directly with no shell, so the rule is scoped to the entries that actually reach a crontab
24. `validate([])` does not throw — asserted as a decision, in a test whose title says so

Then: `if (errs.length) throw new Error("host/schedule.ts is invalid:\n  - " + errs.join("\n  - "))`.

**Do:**

1. Implement `validate` in `host/schedule.ts`, importing `parseFive` (J2.8), `stageOf`/`MISC`
   (`kernel/stages.ts`), `LOG_ROOTS` (`kernel/runtime/log/tail.ts`), `RESOURCE_NAMES` and
   `REFRESH_WINDOW` (`host/config.ts`). Nothing here resolves a path at module scope (J2.3 door 6):
   `opts`'s defaults are computed inside the function.
2. `commandOf(e)` — the rendered bootstrap command, used by rule 23 and by `cli/crontab.ts` (J2.15).
   Export it; two callers must not spell it twice.
3. Amend `roadmap.md` §2.7 SUP-05's check list with the three additions (rules 6, 17, 21) and note
   rule 22's "at most one" wording beside SUP-09. Keep every existing bullet.

**Do (tests, `host/validate.test.ts`):**

1. `validate([])` does not throw, with the decision in the title: *"an empty schedule is valid by
   decision — the first entry needs a job (N3) or the watchdog script (N4)"*.
   **The first draft also had a `validate(SCHEDULE)` test. It is deleted.** With `SCHEDULE = []` it
   is the same call as this one wearing a different name, and a test that cannot fail is worse than
   no test: it reads, in a review, as coverage of the live schedule. N3 adds it back on the day
   there is something in there.
2. The baseline fixture validates, so every refusal below is about the field it changed.
3. One `it()` per rule, 1–23. Each breaks exactly one field of the baseline and asserts the thrown
   message matches a rule-specific regex. Rules needing a real file on disk (10, 11) point `jobsDir`
   and `root` at a `mkdtempSync` directory the test writes into and removes.
4. Every fault is reported, not just the first: two entries with different broken fields, and both
   appear in one message.
5. The `%` rule is scoped: refused on a `supervised: false` entry, accepted escaped (`50\%`), ignored
   on a supervised entry. Three assertions in one test — a negative filter is the kind that reads as
   dead code until someone drops it and the one bootstrap entry silently gains a truncated command.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0 and `host/validate.test.ts` reports 28 passing tests (23 rules + 5).
- [ ] AC2 — **each rule is really reachable.** For each of the 23, the corresponding `it()` fails when
      that single rule is deleted from `validate`. Prove it for the five most easily broken —
      rules 2, 6, 17, 21, 22 — by deleting each in turn, running
      `node --test host/validate.test.ts`, recording the failing test's name, and reverting. Record
      the five names in the commit body.
- [ ] AC3 — **the collect-all behaviour fires.** Change the loop to `return` on the first error.
      `npm test` exits non-zero on test 4. Revert.
- [ ] AC4 — `validate()` with no arguments over the real, empty `SCHEDULE` prints nothing and returns
      `undefined`: `node -e "import('./host/schedule.ts').then(m=>{m.validate();console.log('ok')})"`
      prints `ok`.
- [ ] AC5 — the thrown message names the entry for every rule: `assert.match(msg, /entry "…"/)` is
      part of every one of the 23 assertions, so a rule that reports a fault without saying where
      fails its own test.
- [ ] AC6 — `sed -n '/\*\*SUP-05\*\*/,/\*\*SUP-06\*\*/p' roadmap.md` names the three added checks.
- [ ] AC7 — `git status --porcelain` is empty and no `mkdtemp` directory survives:
      `ls /tmp | grep -c doppel` is unchanged before and after `npm test`.

**Commit:** `validate(): the boot gate, every fault in one throw (SUP-05, SUP-18, SUP-09, GAT-07)`

**Depends on:** J2.6, J2.7, J2.8.

**Risks / what could be wrong:**
- **Three added rules and one reworded rule.** Rules 6, 17 and 21 are additions and rule 22 softens
  SUP-09's "exactly" to "at most". All four are in Gaps; if the GAP step rejects one, the test for it
  goes with it and nothing else moves.
- **Rule 2 does part of TST-09's job at N2.** SUP-20's text covers schedule entries explicitly, so
  this is not a gate ahead of its subject — but the ID cited in the commit is SUP-05, and TST-09 at
  N3 still has the job-file half to do.

---

## J2.10 — croner-vs-POSIX parity over a fixed 14-day window  ·  SUP-07, TST-15

**Goal:** the migration's one silent-failure risk, closed. A parser disagreement does not throw — it
runs a job on the wrong minutes, or never — and a job that quietly stops honouring its window is
indistinguishable from a quiet week.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/parity.test.ts` (new)

### The oracle, named exactly

**A hand-written POSIX matcher, living in this test file, importing nothing from `host/cron.ts`.**
Not a second library (that would move the question one hop and add a dependency to answer a question
about a dependency), and not `run-parts` semantics (which is a directory runner, not a parser).

Three properties make it an oracle rather than a second copy of our own bug:

1. **It is a different SHAPE.** The oracle answers *"does minute t match?"* over a walked window; the
   production side answers *"what is the next run after t?"* through croner's iterator. A shared bug
   across a matcher and an iterator is very unlikely; the reference's own file makes this argument
   and then quietly reuses `cron/lib.ts`'s `expand()` in `tickSeconds`, which is the mistake this
   plan avoids by not shipping an expander at all.
2. **It is STRICT: it throws on anything it cannot expand**, and the reason is narrower than the
   first draft claimed. That draft said the reference's parity test "passes over a hole". **It does
   not** — measured: `engine/cron/schedule-croner.test.ts` line 81 already carries
   `assert.ok(expected.length > 0, …)`, and for `0 0 * * 7` the oracle yields 0 firings while croner
   yields 2, so the test goes **RED**. The true objection is about the message, and it is still
   enough to justify throwing: the failure reads *"`0 0 * * 7` fires at least once in 14 days"*,
   which tells the reader their expression is too sparse, when the real fault is that the oracle
   cannot parse `7`. A wrong diagnosis on a 3am failure costs more than the failure.
   And the guard only holds where the expression fires **zero** times. `0 0 * * 1,7` fires on
   Mondays, so `expected.length > 0` passes while the oracle silently drops every Sunday — a
   **partial** expansion the count guard cannot see at all. Throwing catches both; counting catches
   one.
3. **It is pinned by literal data, not only by agreement with croner.** A table of hand-computed
   minute sets — the reference's "the step forms this schedule actually relies on" block — so if
   croner and the oracle ever agree on something wrong, the table still disagrees.

The oracle's rules, written straight from POSIX `crontab`: five fields · each a comma list of `*`,
`N`, `N-M`, optionally `/S` · `dow` accepts 0–7 and **7 maps to 0 after expansion, not before** (so
`0-7` expands to all seven days rather than collapsing to `0-0`) · and when **both** `dom` and `dow`
are restricted, the two are **ORed**.

### The window, pinned

`START = Date.UTC(2026, 1, 22)` — Sunday 22 February 2026, 00:00 UTC. `END = START + 14 days`. The
same `CRON_ANCHOR` J2.8 exports, imported rather than re-spelled. Never `Date.now()`: a window that
moves makes a failure unreproducible and makes a green run meaningless.

Why this fortnight and not the reference's 1–15 February: it **crosses a month end on day seven**
(28 February → 1 March), and that is precisely where croner and POSIX disagree.

### What the sweep measured, 2026-08-26, croner 10.0.1 / Node 22.23.1

| what was swept | slots | agree | disagree |
|---|---|---|---|
| exactly one of `dom`/`dow` restricted (8 minute × 5 hour × 8 day forms, 14-day window) | 320 | **320** | 0 |
| `croner.match(date)` vs the oracle, 2025–2028 × 28 dom/dow expressions, day by day | 30,660 | **30,660** | 0 |
| `croner.nextRun()` vs the oracle, 2024–2032 × `dow` 0–6 × `dom` {1,2,15,29,30,31} | 42 expressions | — | **20 missed (expression, date) pairs, 14 distinct dates** |

Every missed date is in **March**. The list includes **2024-03-01** and **2028-03-01**, both after a
**29-day leap February** — so the first draft's "28-day February" explanation was wrong and is
withdrawn. What the sweep supports: `nextRun`'s day advance loses `dom`-only matches on the first
days of March. It is not a window artifact either — from an explicit cursor of `2026-02-28T23:59Z`,
`nextRun` returns `2026-03-02T00:00Z`.

**The middle row is the important one.** `match()` is right everywhere, including on every skipped
date, so croner's pattern semantics agree with POSIX exactly and only its **iterator** is wrong.
That is why no constructor option fixes it: the supervisor is driven by croner's timer and the timer
is driven by `nextRun`. Neighbouring cases behave normally — `0 0 1 * 3` DOES fire on 2026-03-01 and
`0 0 1 * 1` DOES fire on 2026-05-01 — which is what makes this the silent class rather than an
obvious breakage.

**Therefore `validate()` refuses dom+dow both restricted (J2.9 rule 4/`parseFive`), and this file's
corpus contains only expressions `validate()` accepts.** Where two implementations cannot agree, the
grammar narrows to their intersection; it never picks a side and it never reproduces a bug on
purpose.

**No assertion in this file says croner is wrong.** That claim is about a package outside this repo
and it would rot the day croner fixes it. It lives in a dated comment, and an opt-in re-measure
(below) is how a future reader checks it — N0's `CORPUS_RECHECK` precedent, applied to a second
outside claim.

### The corpus

`FORMS`, a fixed list in this file, one entry per grammar production plus the shapes a real schedule
uses, **plus every expression in the live `SCHEDULE`** (empty today, non-empty from N3 — so the file
grows a real subject without being rewritten):

```
* * * * *            every minute — the ops-lease-reap shape (N4)
*/5 * * * *          bare step
*/10 15-21 * * *     step inside an hour range, ~17h across the day boundary
1-51/10 15-21 * * *  range with a step and a non-zero origin
0,10,20,30 22 * * *  comma list
3,18,33,48 * * * *   comma list, no hour restriction
4-59/5 * * * 1-4     range+step with a dow range
2-57/5 * * * 1-4     the same, offset — the pair that must not collide
13-58/15 1-10 * * 1-5  range+step in both minute and hour
10-50/13 * * * *     a step that does not divide the range
0-59/60 * * * *      a step equal to the field width
*/13 2-20/3 * * *    steps in two fields
45 * * * *           hourly
53 8 * * *           daily
0 23 * * 5,6         two weekly legs
0 1 * * 0,6          weekend, with 0 meaning Sunday
0 0 * * 7            7 as Sunday — the case the reference's oracle silently drops
30 23 * * 6          a single weekday
0 22 * * 1-5         weekdays
0 0 1 * *            day-of-month only, crossing the month end
0 0 28-31 * *        a dom range that overruns February
0 0 * 3 *            a month restriction
```

**Cost, measured:** 22 forms, 32,695 firings, **6.9 s** of croner time, of which `* * * * *` alone is
3.4 s. The oracle's side is about 100 ms. Exactly one every-minute expression is in the corpus and
its comment says why (it is the shape N4's `ops-lease-reap` will use); a second would add another
3.4 s for no new grammar.

**Do (tests):**

1. **Parity over the corpus.** For each form: enumerate croner's firings in `[START, END)` and the
   oracle's matching minutes, assert both are non-empty (a form that fires zero times in 14 days
   proves nothing), and `assert.deepEqual` the two ISO-minute lists. On failure the message names
   the form and the first differing minute.
   **There is no separate "parity over the live `SCHEDULE`" test.** The first draft had one and it
   asserted `SCHEDULE.length >= 0`, which cannot fail. Instead, the corpus is built as
   `[...FORMS, ...SCHEDULE.map(e => e.cron)]` in **this same test**, so N3's first entry is walked
   the day it lands with no test to remember to add.
2. **The oracle is pinned by literal data.** A table of `[expression, minutes[]]` — the nine step
   forms from the reference plus `0-59/60` and `*/13` — asserting the distinct minute values the
   oracle produces. A regression here reads as "the job is just quiet lately" rather than as a fault,
   which is why it is spelled out separately.
3. **The oracle is strict.** For each of `0 0 * * MON`, `0 0 L * *`, `5/10 * * * *`, `0 0 * * 8`,
   `10-5 * * * *`: the oracle THROWS. Not "returns empty" — the assertion is `assert.throws`, and the
   comment names the reference bug this closes.
4. **`7` is Sunday on both sides.** `0 0 * * 7` and `0 0 * * 0` produce identical firing lists from
   croner AND from the oracle, and `0 0 * * 0-7` produces the same list as `0 0 * * *` at midnight.
5. **The corpus is inside the grammar.** Every form in `FORMS` is accepted by `parseFive`. A form
   `validate()` would refuse has no business being asserted as shared.
6. **The refused class is refused.** For each of two measured `nextRun` divergences (`0 0 1 * 1`,
   `0 0 1 * 2` — two of the twenty, chosen because their skipped date is inside this file's own
   window) and each croner-only extension (`0 0 L * *`, `0 0 * * 5#2`, `@daily`,
   `0 0 0 * * *`, `0 0 * * MON`), `parseFive` reports a problem. This is the live half of the
   divergence story and it never mentions croner's behaviour, only our grammar's.
7. **The opt-in re-measure.** Under `CRON_PARITY_RECHECK=1` only, run **both** sweeps and
   `console.error` what they find:
   - `nextRun` vs the oracle over 2024–2032 × `dow` 0–6 × `dom` {1, 2, 15, 29, 30, 31}, printing
     every missed (expression, date) pair. Recorded here as 20 pairs over 14 distinct dates, all in
     March — printed, never asserted, so a croner fix shows up as a shorter list rather than as a
     red suite.
   - `match()` vs the oracle over the same expressions, day by day for 2025–2028, printing the
     agreement count. Recorded here as 30,660 of 30,660. **This is the sweep that says WHERE the
     fault is**, and it is the one a future reader needs to decide whether the dom+dow refusal is
     still the right rule or whether croner fixed its iterator.
   Skipped by default with `t.skip("set CRON_PARITY_RECHECK=1 to re-measure the croner nextRun/match
   split")`. It asserts nothing.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0 and `host/parity.test.ts` reports 6 passing tests and 1 skipped.
- [ ] AC2 — `CRON_PARITY_RECHECK=1 node --test host/parity.test.ts` exits 0, reports 7 tests, and
      prints the `nextRun` skip list for 2024–2032 — **a count, not a fixed pair**. The measurement
      recorded here is 20 (expression, date) pairs over 14 distinct dates, all in March; the recheck
      prints whatever it finds and asserts nothing, so a croner fix shows up as a shorter list
      rather than as a red suite. Record the output in the commit body. (The first draft said
      "exactly two disagreeing expressions", which was the 2026-only slice of a much larger list.)
- [ ] AC3 — **the parity gate fires.** Change the oracle's day rule from OR to AND when both fields
      are restricted. Every corpus form has a `*` in at least one day field, so nothing moves —
      **which is the point**: add `0 0 13 * 5` to `FORMS` temporarily, and now test 1 fails naming
      the first differing minute. Revert both. Record that the corpus-only mutation was NOT enough,
      because that is what proves the corpus, not the oracle, is what limits coverage here.
- [ ] AC4 — **the strictness gate fires.** Change the oracle's `expand` to return an empty set instead
      of throwing on an unparseable token. `npm test` exits non-zero on test 4. Revert. This is the
      reference's live bug and the mutation restores it exactly.
- [ ] AC5 — **the strictness gate catches what a count guard cannot.** The first draft's version of
      this AC was unperformable: it claimed that removing `expected.length > 0` and making the
      oracle return empty for `0 0 * * 7` would still pass — measured, `deepEqual([2 firings], [])`
      fails either way. The performable mutation is a **silently partial** expansion: make the
      oracle's `expand` skip the value `7` inside a comma list instead of throwing, and add
      `0 0 * * 1,7` to `FORMS`. The expression still fires (Mondays), so `expected.length > 0`
      passes, and only `assert.deepEqual` and the strictness test catch the dropped Sundays.
      `npm test` exits non-zero on tests 1 and 3. Revert both. **Record that the count guard alone
      passes this mutation** — that is the sentence this whole oracle design rests on.
- [ ] AC6 — **the window is pinned.** `grep -c 'Date.now' host/parity.test.ts` prints `0`, and the
      file imports `CRON_ANCHOR` from `host/cron.ts` rather than re-spelling a date:
      `grep -c 'CRON_ANCHOR' host/parity.test.ts` prints at least `1`.
- [ ] AC7 — `time node --test host/parity.test.ts` stays under 20 seconds. Measured budget: 22 forms,
      ~34,000 firings, **7.0–7.8 s** of croner (measured twice, independently) plus about 100 ms for
      the oracle's walk. If it is slower, a second dense expression was added — the
      corpus comment says to say why.

**Commit:** `Croner-vs-POSIX parity over a fixed 14-day window, with a strict independent oracle (SUP-07, TST-15)`

**Depends on:** J2.8, J2.9.

**Risks / what could be wrong:**
- **The corpus, not the oracle, is what bounds coverage.** AC3 makes that explicit rather than
  leaving it implied. A new grammar production means a new corpus line; there is no way around that
  and no test can invent one.
- **7 s of croner time in one file.** It is the price of the row as written. Flagged in Gaps: SUP-07
  says "every expression across a fixed 14-day window" and does not say the walk is O(firings).
- **The oracle could be wrong in the same direction as croner on something the corpus does not
  reach.** That is what test 3's literal table is for, and it is the only defence there is.

---

## J2.11 — `runEntry`: the pre-flight order, the child, the runtime bound  ·  SUP-03, SUP-04, SUP-11, SUP-13, SUP-16, GAT-08, GAT-09

**Goal:** one entry's tick, end to end — the four pre-flight checks in the order that makes a skipped
tick cost nothing, the child spawned with `cwd = ROOT`, its output appended to the entry's own log,
and a wall-clock bound that releases the locks when a pass wedges.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/supervisor.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/host/supervisor.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/config.ts` (add `parentEnv`)
- `/home/hyhilman/projects/me/doppelganger/test/knobs.test.ts` (`ROWS` + `readers`, three new rows)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27: three supervisor knobs)

### `deps`, and why every field is required

Ruling 2 in full: `runEntry(e, deps)` takes everything impure through `deps`, with **no default on
any field**, so TypeScript refuses a call that would write into the real checkout.

```ts
export interface SupervisorDeps {
  readonly root: string;                                  // SUP-03: the child's cwd
  readonly gate: Gate;
  readonly programs: Readonly<Record<string, Program>>;
  readonly refreshWindow: RefreshWindow | null;
  readonly spawn: SpawnFn;                                // (cmd, args, opts) => ChildProcess
  readonly openSink: (path: string) => Sink;              // one stream per DISTINCT path
  readonly dotenvPath: string;
  readonly now: () => Date;
  readonly shouldShed: (program: string, at: Date) => { skip: boolean; class?: string };
  readonly maxRunMin: (e: ScheduleEntry) => number;
  readonly killGraceMs: number;
  readonly spawnStaggerMs: number;
  readonly jobRunner: (job: string) => readonly [string, readonly string[]];
}
```

`jobRunner` is how `job:` entries become a command without N2 knowing what a job is: at N3 it becomes
`(job) => [process.execPath, [`${root}/host/jobs/${job}.ts`]]`. At N2 the real one is assembled in
the argv block and nothing calls it, because `SCHEDULE` is empty.

`shouldShed` and the boot reaper are the two N4 seams, and both are honest:

- **SUP-16** is a *placement* row — "quota-shed skip at `runEntry`, **before the gate**, logged
  `event=quota-shed`". The placement is N2's to get right and it is testable now. The predicate is
  QTA-08/09's, which is N4, so `deps.shouldShed` is supplied by the caller and the argv block passes
  `() => ({ skip: false })` until N4 replaces it.
- **SUP-15** is likewise an *ordering* row and it is J2.13's.

### The pre-flight order — the row content, stated as a sequence

```
1. draining?                       → return, nothing held
2. clearsRefreshWindow && inWindow → log debug refresh-window, return   (SUP-10, SUP-11)
3. shouldShed(program)             → log info quota-shed,     return    (SUP-16)
4. acquireSelf(program)            → null? log warn lock-held mode=self, return  (GAT-06)
5. gate !== "none" → acquire(mode, resources, gateWait)                 (GAT-08)
                     null? log warn lock-held, releaseSelf, return
6. draining? → log info drain-skipped, return                           (J2.13's stop())
7. await spawnSlot(spawnStaggerMs)   ← HOLDS THE GATE. See below.       (HRN-18)
8. draining? → log info drain-skipped, return
9. spawn(...)       finally { hold?.release(); releaseSelf(); }
```

**Step 7 is in the numbered list, not only in prose under "The child".** The first draft buried it,
and a step that holds the gate for up to `SUPERVISOR_SPAWN_STAGGER_MS` belongs where the order is
argued, not in a paragraph three screens down.

Steps 2 and 3 are **before** the self-lock and the gate because a skipped tick should cost nothing
and hold nothing. Step 4 is **before** step 5 because that is GAT-09's whole content: a pass that
blocks at the gate holds its self-lock while it waits, so the ticks it waits through are the ticks it
forces to skip — which is why the wait is derived and capped rather than hand-picked.

**SUP-11**, stated as behaviour: the window check happens once, at fire time, and nothing re-checks
during the run. A flagged entry firing at 22:47 legitimately runs INTO the window. That is correct
for a job measured in seconds and wrong for a long pass, which is why a long pass keeps real day-split
legs instead of reaching for the flag.

**GAT-08's wait**: `e.gateWait ? gateWait(e.cron) * 1000 : 0`. Zero is the old `flock -n` — a
contended tick SKIPS, because the next tick sees the same work.

### The child

- `spawn(cmd, args, { cwd: deps.root, env: childEnv(e, spec), stdio: ["ignore", "pipe", "pipe"] })`.
  `cwd = ROOT` and never the package directory: a spawned agent's cwd picks its project scope, and
  getting it wrong fails as a denied tool call with no explanation.
- `await spawnSlot(deps.spawnStaggerMs)` from `kernel/runtime/pool.ts`, **after** the gate and
  immediately before the spawn. This is HRN-18's cross-ENTRY use: `pool.ts`'s chain is module-global
  precisely so two pools — here, two entries — in one process share it.

  **This placement was challenged as a regression against the reference. It is not, and the check is
  on the record.** The claim was that `engine/src/supervisor.ts:209` calls `spawnSlot` *before* the
  window check (318) and the gate (330). Those line numbers are real but they are **definition
  order, not execution order**: line 209 sits inside `spawnChild`, which is *defined* above
  `runEntry` and *called* from it at line 355, inside the `try` that the gate acquire at 342 guards.
  The reference's own comment on the line directly above 209 says so in as many words:

  > *"Hold here, not before the gate — a queued spawn still holds whatever resource claim it already
  > took, exactly like a job's own internal `spawnSlot` wait does mid-pass."*

  **And the reference is right, for a reason stronger than fidelity: staggering before the gate does
  not work.** The stagger exists to space the moment two children each run
  `git config --global --add safe.directory`, which takes an OS lock on `~/.gitconfig`. If two
  entries stagger 2 s apart and then both block at the gate, they are released by the same
  `drain()` and spawn in the same instant — the stagger has been spent and the race is still there.
  The stagger only removes the race if it is the last thing before `spawn`.

  **The cost is real and it is stated rather than waved at.** With N entries firing on one minute,
  the last one holds its gate for up to `N × SUPERVISOR_SPAWN_STAGGER_MS`, and the chain is
  module-global so it is genuinely serial. At the 2000 ms default and the reference's 12-entries-on-
  one-minute worst case that is 24 s of held gate. Three things bound it: readers hold `shared` and
  do not exclude each other, so the cost lands only on a writer waiting behind them · a writer's
  `gateWait` is derived from its own tick and capped at 30 min, so 24 s does not push it over · and
  N2 has zero entries, so the first real measurement is N3's. **Flagged in Gaps**: no row states the
  trade, and the reference states it in a comment inside `spawnChild`, which is the last place a
  reader looking at the pre-flight order will find it.
- Both streams pipe into `openSink(e.log)`, with `{ end: false }`, and the sink is cached **per
  distinct path**, never per entry: one log file backing fifteen entries with fifteen streams
  interleaves their buffers into unparseable lines.
- `stderrTail()` from `kernel/runtime/log/cause.ts` tees stderr so the `job-failed` line can name a
  cause. Tee'd, not intercepted — the full stream still reaches the file.
- **SUP-13, the runtime bound.** `setTimeout(limit * 60_000)` → log `job-failed` with
  `exit=-1 signal=SIGTERM limitMin=<n> log=<path>` and the distilled cause → `SIGTERM` → after
  `killGraceMs`, `SIGKILL`, and settle on the SIGKILL rather than on `close`: `close` also waits on
  the stdio pipes, and a pass's own grandchildren keep those open after it dies, so waiting would
  leave the gate held by exactly the child this kills to release it.
- `child.on("error")` (ENOENT on the interpreter) logs `job-failed` and settles — that failure is why
  a bare `exec` in a wrapper was invisible for years.
- Exactly one terminal line per child: `job-ok` or `job-failed`, never both, never two.

### `childEnv` and SUP-04

Precedence, matching the wrapper it replaces: **inherited < `.env` < the entry's own `env:`**.

```ts
{ ...parentEnv(), ...(spec.dotenv ? dotenv(deps.dotenvPath) : {}), ...(e.env ?? {}) }
```

`parentEnv()` is a new three-line export on `kernel/config.ts` returning `{ ...process.env }`. It
exists so `host/` never names `process.env` and `test/knobs.test.ts` assertion 3's one-file rule —
now covering `host/` and `cli/` (J2.3) — stays exactly `["kernel/config.ts"]`. That is a real
improvement over the reference, which spreads `process.env` inline in the supervisor.

`dotenv(path)` is a plain `KEY=VALUE` reader, deliberately **not** a shell: the moment it needs
`export`, `$VAR` expansion or command substitution to be read correctly, the thing reading it has to
be bash again.

**The knobs**, added to §2.27 in this commit (`knobs.test.ts` assertion 6):

| key | default | why |
|---|---|---|
| `SUPERVISOR_MAX_RUN_MIN` | 180 | already in §2.27; the row is added to `ROWS` here |
| `SUPERVISOR_KILL_GRACE_MS` | 10000 | SIGTERM → this → SIGKILL; the window to flush a stack trace, not to finish |
| `SUPERVISOR_SPAWN_STAGGER_MS` | 2000 | the cross-entry half of HRN-18's `~/.gitconfig` start-up race |

`SUPERVISOR_DRAIN_MS` belongs to `main()` and lands with J2.13.

**Do (tests, `host/supervisor.test.ts`):** every test builds `deps` from a `testDeps(over)` helper
whose paths are `mkdtempSync` and whose `spawn` is a fake returning an `EventEmitter` with
`PassThrough` stdout/stderr and a recording `kill`.

**`testDeps` sets `spawnStaggerMs: 0`, and that default is load-bearing.** `spawnChain` in
`kernel/runtime/pool.ts` is module-global and never resets, and `node --test` runs one file in one
process — so every `runEntry` call in this file joins the same chain. At the 2000 ms production
default the 37 tests here would serialise into over a minute and blow J2.14 AC1's budget. Group 7,
which is about the stagger, is the only test that sets a non-zero value, and it uses 30 ms.

1. **The happy path.** One entry, `gate: "shared"`, fake child exits 0. Assert: the gate was taken
   `shared` over all resources and released; the self-lock was taken and released; the sink received
   the child's stdout AND stderr; exactly one `job-ok` line, `job=` carrying the PROGRAM.
2. **The order, proved by a recording gate.** `deps.gate` is a spy wrapping a real gate. For an entry
   that is shed, assert `acquireSelf` and `acquire` were never called. For an entry inside the
   window, the same. For an entry whose self-lock is held, assert `acquire` was never called. Three
   assertions, and together they are the sequence.
3. **SUP-16.** `shouldShed` returns `{ skip: true, class: "chore" }`; assert one
   `level=info event=quota-shed class=chore` line, no gate call, no spawn.
4. **SUP-10 / SUP-11.** A `clearsRefreshWindow` entry with a fixture window and a `now` inside it:
   one `level=debug event=refresh-window` line and no spawn. Then `now` at 22:47 with the window
   opening at 22:50: the pass **runs**, and the test's comment states SUP-11 — the flag bounds where
   a pass may start, never how long it runs.
5. **GAT-06 / GAT-09.** Two ticks of the same program: the second logs
   `warn lock-held lock=<program> mode=self` and does not spawn. Then the harder one: entry A blocks
   at the gate with a long `gateWait` (unawaited, using J2.5's synchronous enqueue), and a second
   tick of A returns immediately with `mode=self` — the ticks it waits through are the ticks it
   forces to skip, asserted rather than described.
6. **GAT-08.** An entry with `gateWait: true` and `cron: "*/10 15-21 * * *"` against a held gate:
   assert the `waitMs` handed to `acquire` is `600_000` (the spy records it) and the resulting
   `lock-held` line carries `waited=600`. An entry without the flag gets `0` and no `waited` field.
7. **HRN-18's stagger, cross-entry, and the gate it holds.** `spawnStaggerMs = 30`, two entries on
   disjoint resources fired back to back; assert the second `spawn` call happened at least 20 ms
   after the first (lower bound, exceptions table row 5). **Then assert the cost, so it is a
   measured property rather than a footnote:** while the second entry is parked in `spawnSlot`,
   `deps.gate.state()` shows its resource already held. A reader arriving at that moment is
   excluded. The test title says this is deliberate and names the reason — a stagger that releases
   the gate first would let both children spawn in the same instant and buy nothing.
8. **SUP-03.** Assert the recorded spawn options: `cwd === deps.root`, `stdio` deep-equals
   `["ignore", "pipe", "pipe"]`, and `args` came from `jobRunner` for a `job:` entry and from
   `<root>/<script>` for a `script:` entry.
9. **SUP-04, all three layers.** A `.env` at `dotenvPath` sets `A=env`; the entry sets `A=entry` and
   `B=entry`; the process has `C` set. With `dotenv: true`: the child env has `A=entry`, `B=entry`,
   `C` present. With `dotenv: false`: `A=entry` still (the entry wins) but a key set ONLY in the
   `.env` is **absent** — that is SUP-04's load-bearing claim, and the assertion says so.
10. **One sink per distinct path.** Two entries sharing one `log`; assert `openSink` was called once
    and that every line in the file parses with `parseLine` (no interleaved fragment).
11. **SUP-13, the bound.** A fixture entry with `maxRunMin: 0.005` (0.3 s) and a fake child that
    never exits. Assert: one `job-failed` line with `exit=-1 signal=SIGTERM limitMin=0.005`, `kill`
    called with `SIGTERM`, then with `SIGKILL` after `killGraceMs` (set to 20 in `testDeps`), the
    gate released, and `runEntry`'s promise resolved. The field is minutes and its type is `number`;
    a fractional minute is used rather than adding a milliseconds seam production would never use,
    and the comment says so.
12. **One terminal line, never two.** The capped child then emits `close`; assert the log still holds
    exactly one `job-failed` and no `job-ok`.
13. **Spawn failure.** The fake emits `error` with `ENOENT`; assert one
    `job-failed msg="spawn failed: …"`, gate released, promise resolved.
14. **The cause is attached.** The fake child writes three stderr lines ending in a stack frame and
    exits 3; assert the `job-failed` line's `msg` contains the distilled cause from
    `kernel/runtime/log/cause.ts` and its `exit=3` and `log=<path>`.
15. **A real child, once.** `deps.spawn` is the real `node:child_process.spawn`, `deps.root` is a
    `mkdtempSync` directory holding `probe.sh` (`#!/usr/bin/env bash` / `echo hi` / `echo bad >&2`),
    and the entry is `{ script: "probe.sh", log: <tmp>/x.log }`. Assert exit 0, one `job-ok`, and
    both `hi` and `bad` in the log file. One test, because everything above it is a fake and a fake
    that never meets the real API is a fake of the wrong thing.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0 and `host/supervisor.test.ts` reports 15 passing tests.
- [ ] AC2 — **the order gate fires.** Move the `shouldShed` check to after `acquireSelf`. `npm test`
      exits non-zero on test 2 (`acquireSelf` was called on a shed tick). Revert. This is SUP-16's
      "before the gate" made a failing assertion.
- [ ] AC3 — **the GAT-09 gate fires.** Move `acquireSelf` to after the gate acquire. `npm test` exits
      non-zero on test 5's second half — the waiting pass no longer excludes its own next tick.
      Revert.
- [ ] AC4 — **the SUP-04 gate fires.** Change `childEnv` to always spread `dotenv(...)`. `npm test`
      exits non-zero on test 9's `dotenv: false` half, naming the key that leaked. Revert.
- [ ] AC5 — **the sink gate fires.** Key the sink cache on `e.name` instead of on the path.
      `npm test` exits non-zero on test 10 (`openSink` called twice). Revert.
- [ ] AC6 — **the bound gate fires.** Settle the cap on `close` instead of on the SIGKILL.
      `npm test` exits non-zero on test 11 — the promise never resolves and the test times out.
      Revert. Record the timeout message, because "the gate stays held by the child this kills to
      release it" is exactly what a hang looks like.
- [ ] AC7 — **the one-terminal-line gate fires.** Delete the `if (settled) return;` guard in
      `close`. `npm test` exits non-zero on test 12. Revert.
- [ ] AC8 — **`parentEnv` keeps the one-file rule.** `test/knobs.test.ts` assertion 3 still reports
      `["kernel/config.ts"]`. Then spread `process.env` inline in `host/supervisor.ts` instead and
      confirm `npm test` exits non-zero naming `host/supervisor.ts`. Revert.
- [ ] AC9 — `sed -n '/^### 2\.27/,/^### 2\.28/p' roadmap.md | grep -c 'SUPERVISOR_KILL_GRACE_MS'`
      prints `1`, and the same for `SUPERVISOR_SPAWN_STAGGER_MS`. `test/knobs.test.ts` reports 7
      passing with all three new rows in `ROWS`; remove one row from `ROWS` and confirm assertion 2
      exits non-zero, then restore.
- [ ] AC9b — **the stagger holds the gate, and that is asserted, not assumed.** Move
      `await spawnSlot(...)` to before the gate acquire. `npm test` exits non-zero on group 7's
      second half (the gate is not held while the second entry is parked). Revert. The mutation is
      the placement the review proposed, so the test is what settles it rather than the prose.
- [ ] AC10 — `git status --porcelain` is empty after `npm test`, and `.doppelganger/` does not exist
      in the checkout: `test -e .doppelganger && echo LEAK || echo clean` prints `clean`. Every path
      this job can write is a required `deps` field pointing at `mkdtempSync`.
- [ ] AC11 — `time node --test host/supervisor.test.ts` stays under 5 seconds. The only real waits
      are one 30 ms stagger, one 300 ms bound and one 20 ms kill grace.

**Commit:** `runEntry: the pre-flight order, the child, and the runtime bound (SUP-03, SUP-04, SUP-11, SUP-13, SUP-16, GAT-08, GAT-09)`

**Depends on:** J2.5, J2.6, J2.7, J2.8.

**Risks / what could be wrong:**
- **`deps.root` means "cwd = ROOT" is only true because the argv block says so.** The real `ROOT` is
  passed in one place, six lines long and typechecked, and test 15 asserts the child really lands in
  whatever root it was given. The residual risk — the argv block passing the wrong thing — is not
  covered by a test, and it is named here rather than papered over.
- **The fake spawn is an `EventEmitter`, not a `ChildProcess`.** `SpawnFn`'s return type must be
  narrow enough for a fake to satisfy (`{ stdout, stderr, kill, on }`) and wide enough that the real
  `spawn` satisfies it. Get this wrong and the file will not typecheck, which is the good failure.
- **`maxRunMin: 0.005`.** If the GAP step objects to a fractional minute, the alternative is a
  `maxRunMs` field on `deps`, which is one more knob for a value the entry already states. Flagged.

---

## J2.12 — GAT-10: lock-starve visibility  ·  GAT-10

**Goal:** make a starved job visible. What is real at N2 is the **line shape** the counter reads and
the **threshold** it is compared against; the counting itself belongs to a job that does not exist.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/gate.ts`
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/gate.test.ts`
- `/home/hyhilman/projects/me/doppelganger/test/knobs.test.ts` (assertion 7's `envDynamic` list)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27: two renames)

### What is not built, and why

GAT-10 names three things: `lockloss:<job>` counters, `BACKLOG_LOCK_STARVE_N`, and a per-job raised
threshold. In the reference the counter is written by `ops-log-report` (JOB-O02, **N5**) into the log
database's meta table, and the threshold is read by `backlog-health` (**v1 pipeline**). Neither
consumer exists here.

So N2 ships:

- **the `lock-held` line, with `job=` carrying the PROGRAM** (already emitted by J2.11) — and that
  detail is the whole reason the row works. `ops-log-report` counts consecutive `lock-held` lines per
  `job`, with a per-job threshold keyed on that exact string. Emitting the ENTRY name would split one
  counter N ways and quietly disarm the alarm. A test pins it.
- **`starveThreshold(job)`** — a pure resolver over `LOCK_STARVE_N` and the `LOCK_STARVE_N_<JOB>`
  family.

and declines the counter, with the reason in a comment naming JOB-O02 as its owner.

### The two knob renames

§2.27 carries `BACKLOG_LOCK_STARVE_N` and `BACKLOG_LOCK_STARVE_N_TODO_EXEC`. The `BACKLOG_` prefix is
a pipeline stage name from the reference's own backlog job; there is no backlog in this repo before
v1, and the knob is a property of the GATE. Rename to **`LOCK_STARVE_N`** and the family form
**`LOCK_STARVE_N_<JOB>`**, on J1.4's `FACTORY_STATE_DIR` → `ENGINE_STATE_DIR` precedent: a knob
carrying a name from a different part of the system is a knob nobody can find. Flagged in Gaps.

**Do:**

1. Add to `kernel/runtime/gate.ts`:
   ```ts
   export const LOCK_STARVE_N_ENV: EnvSpec = {
     key: "LOCK_STARVE_N",
     default: "6",
     why: "consecutive lock-held skips before a job counts as starved at the gate (GAT-10)",
   };
   export const LOCK_STARVE_FAMILY_ENV: EnvSpec = {
     key: "LOCK_STARVE_N_<JOB>",
     why: "raise the starve threshold for one job whose cadence makes 6 skips normal (GAT-10)",
   };
   export function starveThreshold(job: string): number;
   ```
   `starveThreshold` reads `envDynamic("LOCK_STARVE_N_" + job.toUpperCase().replace(/-/g, "_"))`,
   falls back to `envNum(LOCK_STARVE_N_ENV)`, and throws on a non-numeric override by routing the
   override through the same `Number.isFinite` check `envNum` applies — a silent fallback here is
   exactly the 3am class N1 rejected.
2. `test/knobs.test.ts`: add both rows to `ROWS` (the family row with `readers: []`, like
   `NAME_DB_ENV`), and update assertion 7's expected `envDynamic` call-site list to
   `["kernel/paths.ts", "kernel/runtime/gate.ts"]` with a one-line comment naming the second family.
3. `roadmap.md` §2.27: rename both keys in the Health bullet, and move them to the Core/paths bullet
   — they are gate knobs, not health knobs, and leaving them under Health is why the rename was
   needed.

**Do (tests, added to `kernel/runtime/gate.test.ts`):**

1. `starveThreshold("nightly-sandcastle")` is 6 by default, in a scrubbed child (the
   `scrubbedChild` helper `test/knobs.test.ts` already uses, copied with a comment saying why an
   in-process test cannot move an env read that a module resolved at import).
2. `LOCK_STARVE_N=9` moves every job's threshold to 9.
3. `LOCK_STARVE_N_TODO_EXEC=72` moves only `todo-exec`, and `nightly-sandcastle` stays at the base.
4. The hyphen-to-underscore mapping is exact: `todo-exec` reads `LOCK_STARVE_N_TODO_EXEC` and nothing
   else — assert that setting `LOCK_STARVE_N_TODO-EXEC` (an impossible env name, set through the
   child's env object) changes nothing.
5. A non-numeric override throws naming the key and the value.

**Do (test, added to `host/supervisor.test.ts`):**

6. **`job=` is the PROGRAM, not the entry.** Two entries, `todo-triage-weekday` and
   `todo-triage-weekend`, both with `job: "todo-triage"`; both lose the gate; assert both
   `lock-held` lines carry `job=todo-triage`. The test title says what splitting the counter would
   cost.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `kernel/runtime/gate.test.ts` reports 24 tests (19 from J2.4+J2.5,
      plus 5) and `host/supervisor.test.ts` reports 16 (15 + 1).
- [ ] AC2 — **the program-grain gate fires.** Change J2.11's `emit` to use `e.name` instead of
      `programOf(e)`. `npm test` exits non-zero on the new supervisor test. Revert.
- [ ] AC3 — **the family gate fires.** Delete the `envDynamic` lookup from `starveThreshold`.
      `npm test` exits non-zero on gate test 3. Revert.
- [ ] AC4 — **the knob registry gate fires.** Remove `LOCK_STARVE_N_ENV` from `ROWS` in
      `test/knobs.test.ts` while leaving the row in `gate.ts`. `npm test` exits non-zero on knobs
      assertion 2 (`scanned` and `ROWS` disagree). Revert.
- [ ] AC5 — **the `envDynamic` call-site gate still bites.** Add a third `envDynamic(` call to any
      kernel file with a use. `npm test` exits non-zero on knobs assertion 7. Revert.
- [ ] AC6 — `sed -n '/^### 2\.27/,/^### 2\.28/p' roadmap.md | grep -c 'BACKLOG_LOCK_STARVE'`
      prints `0`, and `grep -c 'LOCK_STARVE_N'` prints at least `2`.
- [ ] AC7 — `grep -c 'JOB-O02' kernel/runtime/gate.ts` prints at least `1` — the declined half names
      its owner.

**Commit:** `Lock-starve visibility: the program-grained lock-held line and the starve threshold (GAT-10)`

**Depends on:** J2.11.

**Risks / what could be wrong:**
- **`starveThreshold` has no consumer until N5.** It is 10 lines and GAT-10 is an N2 row; the
  alternative is leaving the row half-done and the knob undeclared. Named in Gaps as the row whose
  consumers sit two phases away.
- **The rename touches §2.27, which `knobs.test.ts` assertion 6 reads.** Both must move in the same
  commit or the suite goes red between them.

---

## J2.13 — `main()`: boot, timers, heartbeat, drain, the loud refusal  ·  SUP-06, SUP-14, SUP-15, SUP-18

**Goal:** the process. Validate before a single timer registers, register exactly one timer per
supervised entry, stamp liveness every minute, drain on a signal, and refuse loudly.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/supervisor.ts`
- `/home/hyhilman/projects/me/doppelganger/host/supervisor.test.ts`
- `/home/hyhilman/projects/me/doppelganger/test/knobs.test.ts` (`ROWS` + `readers`, `SUPERVISOR_DRAIN_MS`)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27: `SUPERVISOR_DRAIN_MS`)

### `main`'s shape

```ts
export interface BootDeps extends SupervisorDeps {
  readonly newTimer: (e: ScheduleEntry, fn: () => void) => { stop(): void };
  readonly heartbeatPath: string;
  readonly statusPath: string;
  readonly bootLog: string;
  readonly drainMs: number;
  readonly reapOnBoot?: () => Iterable<Record<string, string | number>>;   // LSE-09 lands here at N4
}
export async function main(schedule: readonly ScheduleEntry[], deps: BootDeps): Promise<Supervisor>;
export async function bootOrDie(schedule: readonly ScheduleEntry[], deps: BootDeps): Promise<Supervisor>;
```

The boot sequence, and the order is the row:

```
1. validate(schedule, …)            throws → bootOrDie prints every line and exits non-zero  (SUP-05, SUP-06)
2. reapOnBoot?.()                   each row logged `lease-reaped`; a throw logs `lease-reap-failed` and
                                    boot CONTINUES                                            (SUP-15)
3. one newTimer per supervised entry                                                          (SUP-03)
4. beat() once, then every 60 s, unref'd                                                      (SUP-14)
5. log `supervisor-up entries=<n> unsupervised=<m> heartbeat=<path> pid=<pid>`
6. install SIGTERM/SIGINT → stop(), and an unhandledRejection handler that logs and does not exit
```

**SUP-15's reap is before the timers, and that is the whole row.** A sweep racing the ticks it is
meant to unblock would miss by exactly one tick, every restart. It is non-fatal on purpose: a
supervisor that refuses to boot because the lease database was busy turns a stale row into a dead
fleet. At N2 `reapOnBoot` is absent from the argv block's deps and the ordering is asserted with a
fake — which is exactly what LSE-09 needs to be able to rely on at N4.

**SUP-06's loud refusal.** `bootOrDie` catches `validate`'s throw, writes every problem line to
stderr through the log emitter, and sets `process.exitCode = 1`. The other two halves of the row —
"restart loop" and "watchdog reports within 15 min" — are **declined**: the restart policy is SUP-19
(moved to M9 with the fleet) and the watchdog is JOB-O10 (N4). N2 ships the exit code and the
message, and the file says which phase owns the rest. Flagged in Gaps.

**SUP-14's heartbeat is a FILE, not `systemctl is-active` and not a pidfile.** The watchdog runs from
cron with a bare environment — no `XDG_RUNTIME_DIR`, no session bus — so `systemctl --user` there is
a coin flip, and a pidfile survives the process that wrote it. An mtime cannot lie about either. The
same beat writes `statusPath`, a JSON snapshot of `gate.state()` plus what is running under it, so a
second process asking about the gate gets an answer at all: the gate is MEMORY, and a fresh process
calling `state()` can only ever describe its own empty one.

**SUP-18** at this layer: `bootLog` is a required `deps` field, so the supervisor's own lines go to a
named path like every entry's do — never derived. `validate` (J2.9 rule 6) is what ties every path to
one of the two roots `kernel/runtime/log/tail.ts` already reads.

**Do:**

1. Implement `main`, `bootOrDie`, `beat`, `snapshot`, `stop` in `host/supervisor.ts`.
   - `stop(sig)`: set `draining`, log `supervisor-draining signal=<sig> children=<n>`, SIGTERM every
     live child, then after `drainMs` SIGKILL the stragglers and exit; poll every 200 ms and exit
     early when the last child is gone. Both timers `unref`'d — `stop` exits explicitly, so nothing
     here can hold a shutdown open. A `runEntry` parked at the gate is checked on both sides of its
     wait (J2.11 step 1 and again before the spawn) so a pass that queues during the sweep is not
     spawned after it.
   - `beat()` never throws: a supervisor that dies because it could not write its own liveness stamp
     turns a full disk into a dead fleet, which is strictly worse than the watchdog firing. It logs
     `heartbeat-failed` and continues.
   - The argv block: `if (import.meta.filename === process.argv[1])`, assembling the real deps
     (`ROOT`, `createGate(RESOURCE_NAMES)`, `projectPath(".doppelganger/supervisor.heartbeat")`,
     `projectPath(".doppelganger/supervisor.status.json")`,
     `projectPath(".doppelganger/logs/supervisor.log")`, the real `spawn`, `createWriteStream`,
     `shouldShed: () => ({ skip: false })`) and dispatching `--list` / `--gate` / `bootOrDie`.
2. `test/writes.test.ts`: `host/supervisor.ts` now imports `createWriteStream`, `mkdirSync` and
   `writeFileSync`, so add it to `REGISTER` with category `project-relative` and the reason
   *"log sinks, the heartbeat stamp and the gate snapshot, all under ROOT (SUP-03, SUP-14)"*.
3. `roadmap.md` §2.27: add `SUPERVISOR_DRAIN_MS` (30000) — *"how long a child gets to exit on
   shutdown before it is killed; a process manager's own stop timeout must exceed it"*.

**Do (tests):**

1. **One timer per supervised entry.** A five-entry fixture with two `supervised: false`; assert
   `newTimer` was called three times, once per supervised entry, each with that entry's `cron` and
   `name`, and never for the two bootstrap entries.
2. **`validate` runs before any timer.** A fixture schedule with one broken entry; `main` rejects and
   `newTimer` was called **zero** times. This is the whole reason `validate` exists at boot.
3. **SUP-15's ordering.** `reapOnBoot` is a spy returning two rows; assert it was called, both rows
   were logged `lease-reaped`, and its call index is lower than the first `newTimer` call index — a
   shared call-order array, so "before" is an assertion and not a reading of the source.
4. **A throwing reaper does not stop the boot.** `reapOnBoot` throws; assert one
   `warn lease-reap-failed` line and that the timers were still registered.
5. **SUP-06.** `bootOrDie` with a broken schedule sets `process.exitCode` to 1 and writes one stderr
   line per problem, each naming its entry. Assert the count equals the number of broken fields.
6. **SUP-06 in a real child**, so the exit code is real: `node -e` importing `host/supervisor.ts` and
   calling `bootOrDie` with an inline broken fixture exits non-zero and prints the entry names.
   Asserted with `spawnSync`, status `!== 0`.
7. **SUP-14.** `beat()` writes both files; the heartbeat is a unix-second integer plus a newline; the
   status parses as JSON and carries `pid`, `at`, `gate` and `children`. Call `beat()` twice with a
   controlled `now` and assert the stamp changed.
8. **A failing beat is not fatal.** Point `heartbeatPath` at a path inside a file (so `mkdirSync`
   fails); assert one `warn heartbeat-failed` and no throw.
9. **`supervisor-up`.** Assert the boot line's fields: `entries`, `unsupervised`, `heartbeat`, `pid`,
   and that `entries + unsupervised === schedule.length`.
10. **Drain.** Two fake children in flight; call `stop("SIGTERM")`; assert one
    `supervisor-draining signal=SIGTERM children=2` line, both children got `SIGTERM`, and — with
    `drainMs = 30` and children that never exit — both got `SIGKILL`. `stop` takes its exit function
    through `deps` so the test does not kill the runner.
11. **A tick that throws is caught.** The registered handler is invoked directly with a `runEntry`
    that rejects; assert one `error tick-crashed` line and that no other timer was affected.
12. **The empty schedule boots.** `main([], deps)` resolves, `newTimer` was never called, and the
    boot line reads `entries=0 unsupervised=0`. Titled so the reason is on the page: this is N2's
    real state and it must not read as a failure.
13. **The argv guard exists.** Importing `host/supervisor.ts` in this test file ran no command —
    asserted structurally by `grep`ing the module for `import.meta.filename === process.argv[1]` and
    by the fact that every other test in the file has already imported it without side effects.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0 and `host/supervisor.test.ts` reports 29 passing tests (16 + 13).
- [ ] AC2 — **the timer-after-validate gate fires.** Move `validate()` to after the timer loop.
      `npm test` exits non-zero on test 2. Revert.
- [ ] AC3 — **the SUP-15 ordering gate fires.** Move the `reapOnBoot` call to after the timer loop.
      `npm test` exits non-zero on test 3 with the two call indexes. Revert.
- [ ] AC4 — **the non-fatal-reaper gate fires.** Remove the `try`/`catch` around `reapOnBoot`.
      `npm test` exits non-zero on test 4. Revert.
- [ ] AC5 — **the non-fatal-beat gate fires.** Remove the `try`/`catch` in `beat`. `npm test` exits
      non-zero on test 8. Revert.
- [ ] AC6 — **the exit code is real.** `node -e "import('./host/supervisor.ts').then(m=>m.bootOrDie([{name:'ops-x',cron:'bad',log:'/tmp/x.log',why:'w',script:'nope.sh'}],D))"`
      exits non-zero. Recorded in the commit body with its stderr.
- [ ] AC7 — **a smoke check of the argv block, and it is named as one.** It proves the block parses
      and dispatches; it does NOT prove it wired the right values, and nothing does — see ruling 1's
      "untested by construction" row.
      `ENGINE_ROOT=$(mktemp -d) timeout 3 node host/supervisor.ts` prints a `supervisor-up entries=0`
      line to stderr, writes a heartbeat under that temp root, and exits on the timeout's SIGTERM
      with a `supervisor-draining` line. Record the two lines and the temp root.
- [ ] AC8 — `test -e .doppelganger && echo LEAK || echo clean` prints `clean` after `npm test`.
- [ ] AC9 — `test/writes.test.ts` assertion 3 passes with `host/supervisor.ts` newly in `REGISTER`,
      and assertion 4 accepts its category. Remove the register entry and confirm `npm test` exits
      non-zero naming the file. Restore.
- [ ] AC10 — `sed -n '/^### 2\.27/,/^### 2\.28/p' roadmap.md | grep -c 'SUPERVISOR_DRAIN_MS'` prints
      `1`, and `test/knobs.test.ts` reports 7 passing with the row in `ROWS`. Remove it from `ROWS`
      and confirm assertion 2's `deepEqual` exits non-zero. Restore.

**Commit:** `main(): validate then reap then timers, a heartbeat, a drain, and a loud refusal (SUP-06, SUP-14, SUP-15, SUP-18)`

**Depends on:** J2.11, J2.12.

**Risks / what could be wrong:**
- **SUP-06 is two-thirds declined.** The restart loop (M9) and the watchdog (N4) are the parts that
  make a refusal loud to a HUMAN. N2 ships the parts a machine can see. Flagged in Gaps.
- **`stop()` taking its exit function through `deps` is a seam with a real production reason** (the
  argv block passes `process.exit`), but it is also the seam a test needs. Both are true; the deps
  object is where such things belong, and it is required rather than defaulted.
- **AC7 runs the real supervisor.** With `ENGINE_ROOT` pointed at a temp directory it writes nothing
  into the checkout. Do not run it without that, or AC8 in a later job will find the heartbeat.

---

## J2.14 — `supervisor --list`  ·  SUP-17

**Goal:** the resolved schedule, printed — entry → program → gate → resources → wait — so a change
can be eyeballed before it is installed.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/supervisor.ts`
- `/home/hyhilman/projects/me/doppelganger/host/supervisor.test.ts`

**Do:**

1. `export function list(schedule, opts): string` — **returns a string, prints nothing.** The argv
   block does the printing. A function that writes to stdout cannot be asserted without capturing a
   stream, and the thing worth asserting is the resolution, not the write.
2. Columns: `by` (`sup` | `cron`), `entry`, `cron`, `program`, `gate` (`shared` / `excl` / `none`,
   plus `+self`), `resources` (a writer's own list joined with `+`; `all` for a reader; `-` for
   `none`), `wait` (`<n>s` when `gateWait` is set, else `-`), `dotenv` (`env` | `-`). Widths are the
   max of each column, computed from the data.
3. Grouped by stage prefix using `byStage` from `kernel/stages.ts` — the same derivation `--list`
   and every future job listing share, so a new prefix is added in one place. **The schedule's own
   order is preserved WITHIN a group**, because that order encodes the minute-by-minute reasoning in
   each `why` and re-sorting it would break the one thing the listing is read for.
4. A tally line: `<n> supervised, <m> on the real crontab`.
5. An entry whose program has no `PROGRAMS` row prints `??` rather than throwing — `validate` refuses
   to boot on it, and `--list` is the tool an operator reaches for **while** the schedule is broken.

**Do (tests):**

1. A six-entry fixture spanning four stages and both `by` values: assert the exact rendered string,
   compared as a whole. A column layout is one of the few things where an exact-output assertion is
   the right shape, and the fixture is in this repo so nothing outside it is pinned.
2. Grouping: the four stage headers appear in `STAGES` order, and within `todo` the two entries keep
   the order they had in the fixture (not alphabetical).
3. `resources`: a reader prints `all` even when its program names none; a writer prints its own list
   joined with `+` in the gate's global order, not the order the program listed them.
4. `wait`: an entry with `gateWait: true` and `cron: "*/10 15-21 * * *"` prints `600s`; without the
   flag, `-`.
5. `gate`: `excl+self`, `shared+self`, `shared`, `none` all render, and `none` prints `-` for
   resources.
6. The tally counts what is INSTALLED where: `2 supervised, 1 on the real crontab` for a fixture with
   one `supervised: false`. Reporting `schedule.length` here would read "3 supervised" while one is
   not, which is the most misleading thing this command could say.
7. A missing `PROGRAMS` row prints `??` and does not throw.
8. `list([], opts)` returns a header, a rule line and `0 supervised, 0 on the real crontab` — N2's
   real output, asserted so it reads as correct rather than as broken.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0 and `host/supervisor.test.ts` reports 37 passing tests (29 + 8).
- [ ] AC2 — `ENGINE_ROOT=$(mktemp -d) node host/supervisor.ts --list` prints the header, the rule and
      `0 supervised, 0 on the real crontab`, and exits 0 **writing nothing** — no heartbeat under the
      temp root. Record the output. `--list` must not boot.
- [ ] AC3 — **the grouping gate fires.** Sort the rows alphabetically inside `byStage`. `npm test`
      exits non-zero on test 2. Revert.
- [ ] AC4 — **the resources gate fires.** Print the program's own `resources` order instead of the
      gate's. `npm test` exits non-zero on test 3. Revert.
- [ ] AC5 — **the tally gate fires.** Change the tally to `schedule.length`. `npm test` exits
      non-zero on test 6. Revert.
- [ ] AC6 — `grep -c 'console.log' host/supervisor.ts` counts only lines inside the argv block —
      record the number and confirm by eye that `list` itself contains none.

**Commit:** `supervisor --list: the resolved schedule, grouped by stage (SUP-17)`

**Depends on:** J2.13.

**Risks / what could be wrong:**
- **Test 1 pins an exact multi-line string.** It is this repo's own fixture, so nothing outside the
  repo is pinned — but a column-width change turns it red for a cosmetic reason. That is acceptable
  for a listing whose whole job is legibility; a looser assertion would not catch a swapped column.

---

## J2.15 — `cli/crontab.ts`: the managed block, per instance  ·  SUP-08 (pure half), INS-03, TST-16

**Goal:** the string transforms behind `render` / `sync` / `check` / `sync --adopt`, with markers that
carry the instance name, so two checkouts splice side by side instead of clobbering each other. This
job touches no crontab at all — every function here is a pure string transform, which is the whole
reason the block is delimited by markers rather than the crontab being overwritten wholesale.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/cli/crontab.ts` (new; pure exports only in this commit)
- `/home/hyhilman/projects/me/doppelganger/cli/crontab.test.ts` (new)

### INS-03: the markers carry the instance

The crontab is the one unavoidably shared resource — one file, one user, no way to make it
project-relative. So:

```
# >>> doppelganger:<instance> managed block (npm run crontab sync) >>>
# Generated from host/schedule.ts — do not hand-edit. `npm run crontab check` diffs it.
# BOOTSTRAP ONLY: everything else is scheduled by host/supervisor.ts.
…one comment run + one command line per `supervised: false` entry…
# <<< doppelganger:<instance> managed block <<<
```

`markers(instance)` returns `{ begin, end }` and **takes the instance as an argument**, defaulting to
`INSTANCE`. Two reasons: the two-instance test can then run in one process (`INSTANCE` is resolved at
import in `kernel/instance.ts` and cannot be moved in-process), and a function that reads a module
global is a function a test has to spawn a child to exercise.

The rules, each with its own test:

- `blockRange(lines, instance)` finds **only this instance's** pair. A lone `END`, an inverted pair,
  or another instance's pair yields `null`. *"A lone END is not the start of a region"* is the part
  that must not drift: slicing on one would eat every line above it, which is the one failure here
  that is unrecoverable rather than merely wrong.
- `splice(crontab, block, instance)` replaces this instance's region and appends when there is none,
  leaving every other line — including another instance's whole block — byte-identical.
- `collisions(crontab, block, instance)` strips **every** doppelganger managed block, of any
  instance, before looking for unmanaged lines that duplicate a rendered command. Counting another
  instance's block would make `sync` refuse forever on exactly the hosts that were already correct.
- `adopt(crontab, block, instance)` drops those duplicates plus the contiguous comment run directly
  above each, and leaves the marker pair standing so the splice after it REPLACES rather than
  appends.
- **The unnamed pair is an unmigrated block** (INS-03's own sentence). `# >>> doppelganger managed
  block …` with no `:instance` is recognised by `legacyRange(lines)`; `check` fails on it with
  *"unnamed managed block — run `crontab sync --adopt` to claim it for this instance"*, and
  `adopt` rewrites its markers to carry the instance.
- `render(entries, instance)` calls `validate(entries)` first — over **every** entry, supervised or
  not. `crontab check` on a daily tick is then the cheapest place a boot-breaking schedule surfaces,
  well before the next restart finds out the hard way.
- `diff(want, got)` is an LCS line diff, so `check` can say WHAT drifted rather than only that it
  did.

**SUP-01's crontab half, asserted here:** `render` emits **only** entries with `supervised === false`.
The crontab is not a compiled copy of the schedule; it holds what the supervisor cannot schedule for
itself, and nothing more.

**Do:**

1. Write `cli/crontab.ts` with `markers`, `blockRange`, `legacyRange`, `installedBlock`, `splice`,
   `stripAllBlocks`, `collisions`, `adopt`, `render`, `comment` (the `why` word-wrapper at 98
   columns) and `diff`. **No `readCrontab`, no `install`, no argv in this commit** — J2.16 adds them,
   so this file has no side effect at all and `test/writes.test.ts`'s door 5 stays quiet.
2. `render` imports `validate`, `bootstrapEntries` and `commandOf` from `host/schedule.ts`. Note in
   the header that `cli/` is `private: true` and therefore reaching into `host/` is an app-internal
   path — and that ADO-01 has an open question about whether `cli` publishes at all (N0 Gaps item 1),
   which is where that decision belongs.

**Do (tests, `cli/crontab.test.ts`)** — a `BLOCK` constant standing in for `render()`, because the
mechanics never read its content, exactly as the reference does:

1. `installedBlock` reads back exactly what `splice` wrote.
2. `installedBlock` returns `null` on a half-written pair, an inverted pair, and **another instance's
   pair** — three assertions, the third being INS-03's.
3. `splice` replaces the block and leaves every foreign line untouched, before AND after, in order.
4. `splice` appends when no block is installed, keeping what is there; and a host with no crontab at
   all gets the block alone.
5. `splice` is idempotent — a second sync writes the same bytes, not a second block. `sync` compares
   before/after and only calls `crontab -` when they differ, so drift here would make every daily
   tick rewrite the crontab and report a change.
6. **Two instances splice side by side.** Start from a crontab holding instance `alpha`'s block plus
   two foreign lines; splice instance `beta`'s block; assert `alpha`'s block is byte-identical,
   both foreign lines survive in order, and `installedBlock(result, "alpha")` and
   `installedBlock(result, "beta")` each return their own block. Then splice `alpha` again and assert
   `beta`'s block is untouched. This is INS-03's core claim and it is the test that would have caught
   a global marker.
7. `collisions` finds an unmanaged line duplicating a rendered entry.
8. `collisions` does **not** count the block's own copy of the line — the negative half, and the one
   that has to hold on every ordinary run.
9. `collisions` does not count **another instance's** block's copy either.
10. `collisions` ignores comments and blank lines.
11. `adopt` + `splice` together — the way the CLI calls them — drop the duplicate with its comment
    run, keep every other line, and leave `collisions` empty afterwards.
12. `adopt` leaves the marker pair standing, so the splice after it replaces rather than appends:
    assert exactly one `BEGIN` line in the result.
13. **The unnamed block.** `legacyRange` finds it; `installedBlock` with an instance returns `null`
    for it (it is not ours until adopted); `adopt` rewrites its markers to carry the instance and the
    following `splice` produces exactly one named pair and no unnamed one.
14. **SUP-01.** `render` over a five-entry fixture with two `supervised: false` emits exactly those
    two command lines and neither of the three supervised ones.
15. `render` calls `validate` over every entry: a fixture whose only broken entry is a **supervised**
    one still makes `render` throw. Scoping validation to the rendered subset would move that
    discovery to the next restart.
16. `render` is deterministic: two calls produce identical bytes. A `why` word-wrap that depended on
    anything variable would make `check` report drift that is not there.
17. `diff` names the changed line, with `installed:` and `expected:` prefixes, for a one-line change
    in the middle of a five-line block.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0 and `cli/crontab.test.ts` reports 17 passing tests.
- [ ] AC2 — **the instance-scoping gate fires.** Change `markers` to ignore its argument and return a
      global pair. `npm test` exits non-zero on tests 2, 6, 9 and 13 — four independent assertions,
      which is what INS-03 being load-bearing looks like. Revert.
- [ ] AC3 — **the lone-END gate fires.** Change `blockRange` to accept `e < s`. `npm test` exits
      non-zero on test 2. Revert. This is the failure that eats every line above the marker.
- [ ] AC4 — **the collisions gate fires.** Remove `stripAllBlocks` from `collisions` so the block's
      own copy counts. `npm test` exits non-zero on tests 8 and 9. Revert.
- [ ] AC5 — **the SUP-01 gate fires.** Change `render` to emit every entry. `npm test` exits non-zero
      on test 14. Revert.
- [ ] AC6 — **the validate-everything gate fires.** Change `render` to validate only
      `bootstrapEntries(entries)`. `npm test` exits non-zero on test 15. Revert.
- [ ] AC7 — the file performs no I/O: `grep -cE 'execFileSync|spawnSync|readFileSync|writeFileSync' cli/crontab.ts`
      prints `0`, and `test/writes.test.ts` passes with `cli/crontab.ts` in neither register.
- [ ] AC8 — `test/layout.test.ts` passes: §1 names `cli/crontab.ts` with tag `N2`.

**Commit:** `The crontab managed block: per-instance markers and the four pure transforms (SUP-08, INS-03, TST-16)`

**Depends on:** J2.9 (`validate`, `commandOf`), J2.7 (`bootstrapEntries`).

**Risks / what could be wrong:**
- **The marker text changes if this repo ever renames itself.** Nothing outside the repo is pinned,
  but an installed block written by an older version would read as foreign and be appended beside.
  That is the correct behaviour for a marker change and it is the reason `sync --adopt` exists;
  worth a line in the module header.
- **`cli/` reaching into `host/` is an open ADO-01 question**, not this plan's to settle. Recorded in
  Gaps.

---

## J2.16 — the crontab tool's side effects and its safe-run surface  ·  SUP-08 (impure half), SAF-01, SAF-05

**Goal:** `render` / `sync` / `check` / `sync --adopt` as commands, and a way to exercise all four
end to end **without ever touching the developer's real crontab**.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/cli/crontab.ts`
- `/home/hyhilman/projects/me/doppelganger/cli/crontab-cli.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/test/writes.test.ts` (`COMMAND_REGISTER`)
- `/home/hyhilman/projects/me/doppelganger/test/knobs.test.ts` (`ROWS` + `readers`, two new rows)
- `/home/hyhilman/projects/me/doppelganger/package.json` (one script)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27: `CRONTAB_CMD`, `CRONTAB_DRY_RUN`)

### How this is tested without a real crontab — the four layers

**A test that edits the developer's crontab is unacceptable**, and "we were careful" is not a
mechanism. Five layers. **Layer 0 is new and it is the one that makes the rest safe by construction
rather than by discipline** — the first draft had only layers 1–4, and its own AC3 would have
overwritten the developer's crontab.

0. **`readCrontab` and `install` REFUSE a command name that is not absolute.**
   `if (!isAbsolute(cmd)) throw new Error(\`crontab command must be an absolute path, got \${cmd} —
   a bare name is a PATH lookup, and the thing PATH finds is the user's real crontab\`)`.
   One line, and it closes the last door: `execFileSync` with a bare `"crontab"` does a PATH lookup,
   so **any** path that reaches the real binary must first spell a bare name, and now that throws.
   The argv block therefore resolves `CRONTAB_CMD` through `which`-style absolutisation — or the
   operator sets it to an absolute path — and a default of `"crontab"` fails loudly at the one place
   a human is watching, instead of quietly at 3am in a test.
1. **The command name is a knob.** `CRONTAB_CMD` (`EnvSpec`, default `"/usr/bin/crontab"` — absolute,
   because of layer 0) is read in exactly one place.
2. **The command is a value, not a global.** `readCrontab(cmd)` and `install(cmd, text)` take it as
   an argument; the knob is resolved only in the argv block (ruling 2). A test that forgets to pass
   it does not compile. **This stops omission; it cannot stop a literal**, which is why layer 0
   exists.
3. **A fake binary that RECORDS.** The end-to-end test writes into a `mkdtempSync` directory:
   ```bash
   #!/usr/bin/env bash
   # argv: <log-path> <state-path> <crontab-args...>
   log="$1"; state="$2"; shift 2
   echo "$*" >> "$log"
   case "$1" in
     -l) [ -s "$state" ] && cat "$state" || exit 1 ;;
     -)  cat > "$state" ;;
     *)  exit 2 ;;
   esac
   ```
   `chmod 0o755`. **The log and state paths come in as argv, not from the environment.** `node --test`
   runs one file in one process and may have two tests in flight, so two tests reading
   `$FAKE_CRONTAB_LOG` out of a shared `process.env` would write each other's files. `CRONTAB_CMD`
   is therefore a small per-test **wrapper script** whose first two argv entries are that test's own
   paths, and the wrapper `exec`s the shared fake. One fake, N wrappers, no shared global.
   Every test asserts the **contents of its own log** — the exact argv of every invocation, in
   order. That turns "we hope the redirect worked" into "the fake was called twice, with `-l` then
   `-`". A `PATH` trick could silently fall through to the real binary; an absolute path, a refusal
   of non-absolute names, and a recorded call log cannot.
4. **`crontab -l` exits 1 when the user has no crontab**, and `readCrontab` treats a non-zero exit as
   `""`. The fake reproduces that, so the "fresh host" path is exercised rather than assumed.

Both impure functions go through `run(...)` from `kernel/runtime/exec.ts` — the repo's single
`execFileSync` call site (HRN-19) — so a hung `crontab` is bounded by `EXEC_TIMEOUT_MS` for free.
`install` uses the exported `BASE` with `stdio: ["pipe","pipe","pipe"]` and `input`, the same shape
`ghIn` already uses.

### The safe-run surface (SAF)

| knob | effect |
|---|---|
| `CRONTAB_CMD=/path/to/fake` | SAF-05's throwaway-store analogue: point the tool at something that is not the system crontab. Must be **absolute** (layer 0) — a bare name throws |
| `CRONTAB_DRY_RUN=1` | SAF-01: `sync` prints the crontab it WOULD install, byte for byte, and calls nothing. It still **reads** — the read is what makes the printed diff true, and SAF-01's "fully inert" is about writes |
| `render` | already side-effect-free by definition (SUP-08) |
| `check` | never writes, in any mode |

### The commands

- `render` → stdout gets `render(SCHEDULE, INSTANCE)`; exit 0.
- `sync` → render, read, compute collisions; a non-empty collision list **refuses** with the offending
  lines and `re-run as \`npm run crontab sync -- --adopt\``, exit 1. Otherwise
  `splice(adopt?(raw), block)`; if the result equals the input, print `already in sync — nothing
  written` and call nothing; else `install`.
- `check` → compare `installedBlock(read, INSTANCE)` against `render()`; on drift print the `diff` and
  exit 1; on a missing block say `no managed block installed — run \`crontab sync\``; on an **unnamed**
  block say so and name `--adopt`. Exit 0 and one line when in sync.
- The tally line counts what is INSTALLED, never `SCHEDULE.length` — at N2 that is
  `0 bootstrap entries (0 more run under host/supervisor.ts)`.

**Do:**

1. Add the **`isAbsolute(cmd)` refusal (layer 0) first**, in both `readCrontab` and `install`, with
   the message spelled out above. Write its two unit tests before anything else in this job: a bare
   `"crontab"` throws, and an absolute path does not. This is the guard that makes every mutation in
   the ACs below safe to perform.
2. Add `readCrontab(cmd)`, `install(cmd, text)`, `CRONTAB_CMD_ENV`, `CRONTAB_DRY_RUN_ENV` and a
   `run(argv, deps)` command dispatcher returning `{ out, err, code }` — a **pure-ish** function that
   takes the crontab command and the schedule as arguments and returns text plus an exit code, so
   every command is assertable without capturing a stream. The argv block resolves the knobs, calls
   `run`, writes the two streams and sets `process.exitCode`.
3. Add `"crontab": "node cli/crontab.ts"` to root `scripts`.
4. `test/writes.test.ts`: add `cli/crontab.ts` to `COMMAND_REGISTER` with
   `{ command: "crontab", category: "INSTANCE-discriminated", reason: "the managed block, delimited by markers carrying INSTANCE (INS-03)" }`. **This is INS-02's second category getting its first
   member** — LOOP.md records that it had none until N2, and this is the line that fills it.
5. `roadmap.md` §2.27 Core/paths: add `CRONTAB_CMD` and `CRONTAB_DRY_RUN`; add both rows to
   `test/knobs.test.ts`'s `ROWS` in the same commit, or assertion 2's `deepEqual` fails.
6. **The per-test wrapper helper.** `makeFakeCrontab(dir)` writes the shared fake once, then writes
   a wrapper `fake-<n>.sh` that `exec`s it with this test's own log and state paths as `$1`/`$2`,
   and returns `{ cmd, logPath, statePath, calls() }`. Every test calls it; no test reads a
   `FAKE_CRONTAB_*` variable out of the environment.

**Do (tests, `cli/crontab-cli.test.ts`):** each test builds a fresh temp dir, the fake and its two
files.

1. **A fresh host.** No crontab file; `sync`; assert the fake log is exactly `["-l", "-"]`, the
   resulting file is the rendered block alone, and the output says a new block was appended.
2. **Idempotence end to end.** `sync` twice; assert the second run's fake log is `["-l"]` only —
   nothing was installed — and the output says `already in sync`.
3. **Foreign lines survive.** Seed the file with two foreign lines around a hand-written block;
   `sync`; assert both foreign lines are byte-identical in the result.
4. **Collision refusal.** Seed a foreign line duplicating a rendered command; `sync` exits 1, names
   the line, mentions `--adopt`, and the fake log is `["-l"]` — **nothing was written**. That last
   assertion is the one that matters: a refusal that still writes is not a refusal.
5. **`sync --adopt`.** The same seed; exits 0; the duplicate and its comment run are gone; the block
   is present once; a following `check` exits 0.
6. **`check` drift.** Seed an installed block with one changed line; `check` exits 1, prints
   `installed:` / `expected:` lines naming the change, and the fake log is `["-l"]`.
7. **`check` missing.** Empty crontab; exits 1 with `no managed block installed`.
8. **`check` unnamed.** Seed an unnamed block; exits 1 naming `--adopt`, and writes nothing.
9. **`render` writes nothing.** `render`; the fake log is empty (`-l` is not even read) and stdout is
   the block.
10. **`CRONTAB_DRY_RUN=1 sync`** on a host that would change: exits 0, stdout contains the full
    would-be crontab, and the fake log is `["-l"]` — read, never written. Assert the crontab file's
    bytes are unchanged.
11. **The fake was really used.** Every test asserts a non-empty (or explicitly empty) fake log. Add
    one test that sets `CRONTAB_CMD` to a path that does not exist and asserts the command fails
    loudly rather than falling back to anything — proving there is no `PATH` fallback in the code.
12. **Two instances, end to end.** Two child processes with `INSTANCE=alpha` and `INSTANCE=beta`
    against **one** fake crontab state file; `sync` in each; assert the file holds two named blocks,
    that running `alpha`'s `sync` again leaves `beta`'s block byte-identical, and that `check` exits
    0 for both. Children, because `INSTANCE` resolves at import.
    **Each child's `env` must carry `CRONTAB_CMD` explicitly** — this is a Do-list item, not a risk
    note. The children run the argv block, which resolves `CRONTAB_CMD` from the environment;
    `run()` in `kernel/runtime/exec.ts` passes no `env` option, so the fake inherits whatever the
    child got. If the test builds the child's env without `CRONTAB_CMD`, both children resolve the
    default and call the real `crontab -`. Build the env explicitly —
    `{ PATH, INSTANCE, CRONTAB_CMD: wrapper.cmd }` — never by spreading `process.env` and hoping.
    Layer 0 does not save this case on its own, because the default is absolute; the **call-log
    assertion** is what catches it, and both children's logs are asserted non-empty.
13. **The argv guard.** `grep` the module for `import.meta.filename === process.argv[1]`, and note
    that this whole test file imports `cli/crontab.ts` without any command running — which the other
    twelve tests demonstrate.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0 and `cli/crontab-cli.test.ts` reports 15 passing tests (13 plus the
      two layer-0 refusal tests from Do step 1).
- [ ] AC2 — **the developer's crontab is untouched.** Record `crontab -l | md5sum` before and after
      `npm test`. The two are identical. If the developer has no crontab, record that `crontab -l`
      exits 1 both times. **This AC is mandatory and its output goes in the commit body.**
- [ ] AC3 — **the recording proves the redirect, and the mutation is safe by construction.**
      **DO NOT** hard-code `"crontab"`: measured, `execFileSync` with a bare name does a PATH lookup,
      and tests 1/3/4/5 then reach `install` → `crontab -` → **the developer's real crontab is
      overwritten**. The first draft's version of this AC did exactly that, and its hedge ("run with
      `CRONTAB_CMD` still exported") was incoherent, because the plumbing it deleted is what reads
      that variable.
      The safe mutation, and it tests the same thing: hard-code
      **`"/nonexistent/crontab-DOES-NOT-EXIST"`** — absolute, so layer 0 lets it through, and
      guaranteed to `ENOENT`. `npm test` exits non-zero on tests 1–11: the fake's log stays empty
      because the fake was never called, which is the assertion that proves the redirect was load-
      bearing. Revert.
- [ ] AC3b — **layer 0 fires.** Call `readCrontab("crontab")` directly in a scratch test. It throws
      `crontab command must be an absolute path`. This is the one line that makes a bare name
      unreachable, and it is why AC3 can be performed at all.
- [ ] AC4 — **the refusal really refuses.** Change `sync`'s collision path to install anyway.
      `npm test` exits non-zero on test 4's fake-log assertion. Revert.
- [ ] AC5 — **the dry run really is inert.** Remove the `CRONTAB_DRY_RUN` guard around `install`.
      `npm test` exits non-zero on test 10. Revert.
- [ ] AC6 — **the two-instance path holds end to end.** Change `markers` to a global pair.
      `npm test` exits non-zero on test 12. Revert.
- [ ] AC7 — **a smoke check of the argv block** (ruling 1's "untested by construction" row).
      `INSTANCE=probe npm run crontab render` prints a block with
      `# >>> doppelganger:probe managed block` and no command lines (the schedule is empty), and
      exits 0. `render` reaches no crontab at all, so this is the one argv-block command that is
      safe to run without a redirect. Record the output.
- [ ] AC8 — `test/writes.test.ts` door 5 passes with `cli/crontab.ts` registered, and assertion 4
      accepts `INSTANCE-discriminated`. Remove the register entry; `npm test` exits non-zero naming
      the file. Restore.
- [ ] AC9 — `sed -n '/^### 2\.27/,/^### 2\.28/p' roadmap.md | grep -c 'CRONTAB_CMD'` prints `1`,
      **and the same for `CRONTAB_DRY_RUN`** — the first draft grepped only the first of the two rows
      it added. `test/knobs.test.ts` reports 7 passing with both rows in `ROWS`; remove either and
      confirm assertion 2 exits non-zero.
- [ ] AC10 — `git status --porcelain` is empty and no fake survives: `ls /tmp | grep -c crontab` is
      unchanged before and after.

**Commit:** `The crontab tool: render, sync, check, sync --adopt, driven end to end against a recording fake (SUP-08, SAF-01, SAF-05)`

**Depends on:** J2.15.

**Risks / what could be wrong:**
- **This is the one job in N2 that can damage something outside the repo.** AC2 is the guard and it
  is not optional: run it before the first commit of this job and after the last, not only at the
  end. Layer 0 is what turns "be careful" into "cannot happen": with `isAbsolute` in place, every
  route to the real binary has to spell a bare name first, and that throws.
- **`CRONTAB_DRY_RUN` is a new knob with no roadmap row of its own.** SAF-01 is the row it satisfies
  (`*_DRY_RUN` per job); the crontab tool is not a job. Flagged in Gaps.
- **The fake is bash.** On a host without bash the tests fail at spawn rather than silently — which
  is the right direction, and N1's `log.sh` already makes bash a hard requirement of this suite.

---

## J2.17 — SUP-12: the refresh-window allowlist and the minute-for-minute walk  ·  SUP-12, TST-15

**Goal:** two spellings of the same window can never disagree, and the set of entries that may
legally fire inside it is a checked claim rather than a reading of six hour fields.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/window.test.ts` (new)

### What is real at N2 and what is not

SUP-12 has two halves and they are in different states:

- **The minute-for-minute walk is fully real.** Its subject is `inRefreshWindow` versus its own
  declaration, and both exist (J2.6). This is the half that catches the drift the row is about: every
  allowlist assertion reads one spelling of the window and the supervisor reads another, and if those
  disagree the allowlist is checking a window nothing enforces — **and it would still pass**, because
  the exemption is keyed on the flag rather than on the window.
- **The allowlist over the live schedule is vacuous today.** `SCHEDULE` is empty, so the expected set
  is `[]`. The reference's own reasoning is why it still ships: *"an empty list is a checked claim
  that nothing is excused, where the whole-week form could only ever pass or fail."* The machinery —
  `entriesInWindow(schedule, window, programs)` — is a pure function with real fixture tests, so it
  is not a gate over a nonexistent subject; only its one live invocation is vacuous, and it becomes
  load-bearing the moment N3 adds an entry.

**Do (tests):**

1. **The predicate matches its own declaration, minute for minute.** Over a fixture window, walk all
   10,080 minutes of a week from a fixed base (`Date.UTC(2026, 1, 22)`, which is a Sunday so
   minute-of-week 0 is dow 0 and the two indexes line up with no offset). Compare
   `inRefreshWindow(new Date(base + t * 60_000), w)` against a **locally written** minute-of-week
   predicate spelled from the same `{ opensDow, opensAt, lengthMin }` fields but computed differently
   (a set of opening minutes built up front versus a modular interval test). Assert the disagreeing
   minutes list is empty, and print the first five on failure.
2. The same walk for a window crossing Sunday midnight, and for a two-day window
   (`opensDow: [5, 6]`), so the modular case and the multi-opening case are both covered.
3. **A window longer than a day** (`lengthMin: 2000`) still agrees minute for minute — the case a
   two-clause predicate cannot express at all, and the reason J2.6 chose open-plus-length.
4. `entriesInWindow` over a fixture: three entries, one firing only inside the window, one only
   outside, one both. Assert the returned set is exactly the two that fire inside.
5. `entriesInWindow` **skips `clearsRefreshWindow` entries**, because the supervisor drops those at
   fire time (`runEntry` step 2) and their expression legitimately fires in there. Assert a flagged
   entry that fires inside is NOT in the set — and assert in the same test that the unflagged one
   beside it IS, so the skip cannot silently swallow both.
6. **The two halves are tied together.** Assert `entriesInWindow` calls the same `inRefreshWindow`
   the supervisor does, by passing a window and checking that an entry firing one minute before the
   opening is out and one minute after is in — the boundary, resolved through the real predicate.
7. **A `gate: "none"` program cannot cost the lint its slot**, so it is exempt from the allowlist's
   concern: assert `entriesInWindow` reports the program's gate mode alongside each name, so the
   allowlist at N3 can say *why* each entry is allowed rather than only that it is. (A name with no
   reason is how an allowlist becomes a list of things somebody once approved.)

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0 and `host/window.test.ts` reports 7 passing tests.
      **The first draft had 8**; the live-allowlist test — `entriesInWindow(SCHEDULE, null)` deep-
      equals `[]`, over an empty schedule and a null window — is deleted. It asserts `[] === []` and
      cannot fail, and an assertion that cannot fail reads in review as coverage of the live
      schedule. N3 adds it on the day there is an entry to excuse. The machinery it would have
      called is fully covered by tests 4, 5 and 7, which use fixtures with real entries.
- [ ] AC2 — **the walk fires.** Change `inRefreshWindow`'s interval to closed (`<=`). `npm test`
      exits non-zero on test 1, naming the single disagreeing minute. Revert. One minute out of
      10,080 is exactly the size of drift this walk exists to catch.
- [ ] AC3 — **the midnight-crossing gate fires.** Change `inRefreshWindow` to compare against a plain
      (non-modular) interval. `npm test` exits non-zero on test 2. Revert.
- [ ] AC4 — **the flag-skip gate fires.** Remove the `clearsRefreshWindow` skip from
      `entriesInWindow`. `npm test` exits non-zero on test 5. Revert. Then remove the *second* half
      of test 5 (the unflagged entry) and confirm the first half alone would have passed a skip that
      swallowed everything — record that, because it is why the test has two halves.
- [ ] AC5 — **the allowlist machinery fires on real data.** Change `entriesInWindow` to return every
      entry rather than only those firing inside the window. `npm test` exits non-zero on test 4,
      naming the entry that fires only outside. Revert. (This replaces the first draft's mutation,
      which poked a fixture entry into the live `SCHEDULE` to give a vacuous test something to
      fail — a mutation that only proves the test would work if it had a subject.)
- [ ] AC6 — `grep -c 'Date.now' host/window.test.ts` prints `0`.
- [ ] AC7 — `time node --test host/window.test.ts` stays under 2 seconds: four 10,080-minute walks
      are about 40,000 predicate calls.

**Commit:** `SUP-12: the refresh-window allowlist and a minute-for-minute walk of its predicate (SUP-12, TST-15)`

**Depends on:** J2.6, J2.7, J2.8.

**Risks / what could be wrong:**
- **N3 has to remember to add the live allowlist**, because this plan deletes the vacuous version
  rather than shipping it as a placeholder. That trade is deliberate: a placeholder that cannot fail
  is worse than a gap, because it looks like coverage. The handover is written into `WORK.md` by
  J2.18 and into the module comment beside `entriesInWindow`, which is the file N3 will already be
  editing.
- **Test 1's local predicate could be written the same way as the production one**, which would make
  it a copy rather than a check. The instruction is explicit: build a set of opening minutes up
  front on one side and test a modular interval on the other. If the builder writes the same
  algorithm twice, the test proves nothing and AC2 is what catches it.

---

## J2.18 — close N2, and retitle it  ·  §3, `WORK.md`

**Goal:** the phase's own bookkeeping, the retitle, and the moment N2 stops being the CURRENT phase
for J2.2's gate.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/WORK.md`
- `/home/hyhilman/projects/me/doppelganger/LOOP.md`

**Do:**

1. **Retitle the phase, in both places that name it.** `WORK.md`'s
   `## N2 — Supervisor, one schedule entry` and `roadmap.md` §3's `### N2 — Supervisor, one schedule
   entry` both become **`N2 — Supervisor and gate, no entry yet`**. §3's N2 body already describes
   only mechanisms, so nothing else in it moves. The old title promises a running entry, and ticking
   32 boxes underneath it would be the phase claiming more than it built.
2. **Write the end-of-phase claim into `WORK.md`**, directly under the retitled heading, in the words
   this plan opens with:
   > Every mechanism the supervisor needs exists, each is exercised over its whole input space, and
   > they are wired together in a six-line block that nothing tests. **No job has ever run.** The
   > first entry, the first spawned child and the first real gate contention all arrive at N3.
3. `WORK.md`: tick all 32 N2 boxes, each with the job number(s) that did it, in the `(J1.5) **DBS-01**`
   style N1 used. Where a row is partly declined, say so on the row itself:
   - `SUP-06` — the loud refusal ships; the restart loop is SUP-19 (M9) and the watchdog is JOB-O10
     (N4).
   - `SUP-15` — the ordering and its test ship; the reap itself is LSE-09 (N4).
   - `SUP-16` — the placement and its test ship; `decideShed` is QTA-09 (N4).
   - `GAT-10` — the line shape and the threshold ship; the `lockloss:` counter is JOB-O02 (N5).
   - `SUP-12` — the walk is live and the allowlist machinery has fixture tests; **the live allowlist
     assertion is N3's**, deliberately not shipped as a vacuous placeholder.
4. `LOOP.md`: mark N2's Plan/Gap/Build/Verify, and add to **Settled questions**:
   - **§5 Q1 settled (J2.6)** — the host names the gate's resources as `{ name, path, why }` rows;
     `path` is ROOT-relative, which is INS-05's constraint made mechanical. Two names at N2: `repo`,
     `skills`.
   - **croner is a dependency (J2.8)** — exact `10.0.1`, root `dependencies`, zero transitive deps,
     imported by exactly one file. Writing the parser instead would have made SUP-07 circular.
   - **The cron grammar is the intersection of croner and POSIX (J2.9/J2.10)** — with the measured
     divergence and its date.
   - **The schedule is empty at N2 by decision (J2.7)** — the first entry is N3's.
   - **Impure defaults are resolved in the argv block (rulings 2)** — the structural answer to N1's
     F4 leak.
   - **Enqueue is synchronous, so FIFO needs no sleeps (J2.5)** — and the reference's own tests did
     not need theirs.
   - **The gate's deadlock argument has one unchecked premise (J2.4)** — no holder ever acquires
     while already holding. `runEntry` satisfies it; the gate does not enforce it; N3's first job is
     the first chance to get it wrong.
   - **`spawnSlot` goes AFTER the gate (J2.11)** — challenged as a regression, checked, upheld. The
     reference's line 209 is definition order, not execution order, and staggering before the gate
     buys nothing because two entries released by one `drain()` spawn in the same instant anyway.
     The cost — a gate held for up to `N × stagger` — is stated and asserted.
   - **`isAbsolute` on the crontab command (J2.16)** — the one line that makes a bare-name PATH
     lookup unreachable, and therefore makes the destructive mutation in AC3 performable at all.
5. `LOOP.md` **Open items**: carry forward anything the Gaps section below leaves unresolved, plus
   the ADO-01 `cli`-publishes question now that `cli/crontab.ts` imports `host/`.

**Acceptance criteria:**

- [ ] AC1 — `grep -c '^- \[ \]' WORK.md` drops by exactly 32, and
      `grep -c 'one schedule entry' WORK.md roadmap.md` prints `0` for both files.
- [ ] AC2 — `npm test` exits 0. **This is the moment J2.2's phase rule flips N2 from CURRENT to
      SHIPPED**, so every §1 row tagged `N2` must now exist — and it does. If this fails, a file was
      named in §1 and never built, which is precisely what the flip is for. Record the pass.
- [ ] AC3 — the phase totals: `npm test` reports the N1 baseline — measured **200 tests, 199 pass,
      0 fail, 1 skip** — plus N2's, and the commit body records the exact `# tests` / `# pass` /
      `# fail` / `# skipped` lines.
- [ ] AC4 — `git status --porcelain` is empty; `test -e .doppelganger && echo LEAK || echo clean`
      prints `clean`; and `crontab -l | md5sum` matches the value recorded at J2.16 AC2.
- [ ] AC5 — `LOOP.md`'s phase table shows N2 `✅` in all four columns, or `⚠` with the open items
      named.

**Commit:** `Close N2: supervisor, gate, crontab bootstrap (SUP-01…18, GAT-01…10, INS-03, INS-05, TST-15, TST-16)`

**Depends on:** every job above.

**Risks / what could be wrong:** AC2 is a real gate and it fires only here. If a §1 row was written
in J2.1 for a file the plan later renamed, this is where it shows up — which is late, but it is the
only place the check can be honest.

---

## Summary of the resolved tensions

| Tension | Resolution |
|---|---|
| **This repo has no dependencies, and SUP-07 demands croner-vs-POSIX parity** | **N2 adds `croner`, exactly `10.0.1`, as a root `dependencies` entry.** Node ships no cron scheduler and no cron parser, so there is no builtin to prefer. Writing the parser instead makes SUP-07 circular — parity with *what*, if croner is not there? TST-22 is untouched (it governs linters, bundlers and build steps; `croner` is on no denylist and adds no config file). TST-25 survives because `host/` is deliberately not a workspace (ADO-14), so the root manifest is its dependency owner and nothing is phantom; `test/deps.test.ts` ships TST-25's narrow form now — one importer, one bare specifier repo-wide, `kernel/` names none — and the general per-workspace form arrives at N5. Measured: zero transitive dependencies, own `.d.ts`, `engines.node >= 18`. |
| **`gateWait(cron)` needs a cron parser at N2** | It does not. `tickSeconds` enumerates **croner's own firings** over a fixed 21-day window and takes the smallest gap, so nothing hand-written parses cron in production and "one of the entry's own ticks" means one of the ticks the supervisor will actually fire. Two mechanisms make it usable: **early stop** (`gateWait` only needs `min(tick, cap)`, so the walk halts on the first gap under 1800 s — a dense expression stops after two firings) and **memoisation** per expression, because `runEntry` asks the same question every tick. Measured: `nextRun` costs ~0.2 ms, so an un-stopped `* * * * *` walk is 3.4 s over 14 days and ~5 s over 21; with the stop it is under 10 ms. |
| **SUP-07's POSIX oracle: which library, or what?** | **Neither — a strict hand-written matcher inside `host/parity.test.ts`.** A second library moves the question one hop and answers a dependency question with a dependency. It is a real oracle for three reasons: it is a different SHAPE (a matcher over a walked window versus croner's next-run iterator, so a shared bug is unlikely) · it **throws** on any token it cannot expand · and it is pinned by a table of hand-computed minute sets, so croner and the oracle agreeing on something wrong still goes red. **The justification for throwing is narrower than the first draft claimed and is corrected here.** That draft said the reference's parity test "passes over a hole"; measured, it does not — line 81 already carries `assert.ok(expected.length > 0)`, and `0 0 * * 7` (oracle 0, croner 2) goes RED. Two true objections remain and both are enough: the failure message reads *"fires at least once in 14 days"*, which diagnoses a sparse expression rather than an unparseable `7` — a wrong diagnosis at 3am costs more than the failure — and the count guard is blind to a **partial** expansion, where `0 0 * * 1,7` fires on Mondays, passes `> 0`, and silently drops every Sunday. Throwing catches both; counting catches one. |
| **Where croner and POSIX actually disagree** | Measured 2026-08-26, croner 10.0.1 / Node 22.23.1. **One of `dom`/`dow` restricted: 320/320 agree.** **Both restricted, `nextRun()` skips real firings: 20 missed (expression, date) pairs over 14 distinct dates**, swept exhaustively over 2024–2032 × `dow` 0–6 × `dom` {1,2,15,29,30,31}, every one of them in March. **The first draft blamed the 28-day February and that was wrong** — the list contains 2024-03-01 and 2028-03-01, both after a 29-day *leap* February; the claim is withdrawn and replaced by the narrower one the data supports. **The decisive measurement is that the fault is in the ITERATOR, not the semantics:** `croner.match(date)` agrees with the oracle **30,660/30,660** day-slots (2025–2028 × 28 expressions) including every skipped date, so croner knows 2026-03-01 matches `0 0 1 * 1` and only `nextRun` refuses to stop there. No constructor option avoids it, because the timer is driven by `nextRun`. Separately, croner **throws** on `5/10` (POSIX accepts it) and **accepts** names, `L`, `#`, `?`, `W`, `@daily` and 6-field patterns (POSIX does not). **Resolution: the grammar is the INTERSECTION**, enforced by `validate()`. No test asserts croner is still wrong — that would rot on the next release; it lives in a dated comment with an opt-in `CRON_PARITY_RECHECK=1` re-measure that prints a list and asserts nothing, on N0's `CORPUS_RECHECK` precedent. |
| **The parity window must not depend on today's date** | One exported anchor, `CRON_ANCHOR = Date.UTC(2026, 1, 22)` — Sunday 22 Feb 2026, 00:00 UTC — imported by both the parity walk (14 days, per SUP-07) and `tickSeconds` (21 days, because a weekly expression needs more than 14 to show two firings). A Sunday, so all seven weekdays appear in the first week; February 2026 has 28 days, so a 14-day window crosses a month end on day seven, which is exactly where the divergence lives. The reference's own 1–15 February window would have missed it. |
| **GAT-04's deadlock argument must be PROVED, not demonstrated** | A test cannot prove absence of deadlock in general. It can prove the premises the argument rests on, **over the entire finite request space**, because the space is small: 3 resources → 8 subsets → 16 request shapes. Level 1: the exclusion decision matches a four-line pure model for all **256 ordered pairs**. Level 2: `hold.resources` is the global order for all **15 caller orderings**. Level 3: for all **64 ordered writer pairs**, A holds, B queues, A releases, B completes, gate fully idle. A total order extends that to three or more holders by the standard argument, with no further test. **But one premise is unchecked and nothing in the code forbids breaking it: no holder ever acquires while already holding.** `acquire(["c"])` then, still holding, `acquire(["a"])` inverts the order and deadlocks against its mirror; every task in the exhaustive walks acquires exactly once, so they cannot see it. The premise is written in the module header above the argument, `runEntry` satisfies it by taking the gate once per tick, and the gate does **not** enforce it — a re-entrancy check is a design change with no second caller to argue with (D9). Flagged in Gaps. |
| **§5 Q1 — naming the gate's resources** | Settled: **the host declares them**, as `{ name, path, why }` rows in `host/config.ts`, validated at boot (SUP-05). `path` is ROOT-relative and never absolute, which is INS-05's constraint made mechanical — a machine-wide resource cannot be written down without `projectPath` throwing. Two names at N2: **`repo`** (the checkout, its refs and worktrees) and **`skills`** (`.claude/skills`, written by SKL-04's renderer and read by every spawned agent mid-run — the reference's `plugin` resource with the names changed). Two rather than one because GAT-03 has no subject with one; two rather than three because a third would be a guess, and deleting a name from a host list is a one-line change. |
| **`validate()` with no jobs and no skills** | It is a function over a value, not a gate over a corpus, so all 23 rules are exercised against fixture entries with exactly one field broken — the reference's own shape. What is **not** built: no docs↔code count of the check list (TST-06 is cut by D17, and §3's N2 line says so), and no live assertion over `SCHEDULE` beyond `validate([])` not throwing. Three rules are added to SUP-05's list and flagged: `log` must sit under one of the two roots (SUP-18's operational meaning) · `gate: "none"` needs a non-empty `whyNoGate` (GAT-07 turned from a comment into a checkable field) · `clearsRefreshWindow` is refused while no window is declared. |
| **SUP-08 writes to the developer's real crontab** | Four independent layers: the command name is a knob (`CRONTAB_CMD`) read in exactly one place · the command is passed as a **value**, so a test that forgets to redirect does not compile · the end-to-end tests use a **recording** fake binary at an absolute path whose invocation log is asserted, so a fall-through to the real binary shows up as an empty log rather than as silence · and `CRONTAB_DRY_RUN=1` makes `sync` print without installing. J2.16 AC2 is mandatory and records `crontab -l | md5sum` before and after the whole job. INS-03 is honoured by putting the instance INTO the markers, and it is load-bearing in four separate assertions — another instance's pair is not ours, `splice` leaves it byte-identical, `collisions` does not count its lines, and an unnamed pair is an unmigrated block that `check` refuses and `sync --adopt` claims. |
| **INS-05 is a declared non-goal, and a non-goal needs a test that keeps it declined** | Two assertions, and the second is the valuable one. **(a)** Two `createGate` instances over the same names exclude nothing from each other — INS-05's own sentence, executable, and it only exists because N2 ships a factory instead of the reference's module-global singleton. **(b)** Every declared resource's `path` resolves inside `ROOT` via `projectPath`, so *"this is sound only while every named gate resource lives inside its own checkout"* becomes a line of code that goes red when someone writes `/var/lib/x`. Mutations for both are one line each. |
| **GAT-05's FIFO needs controlled interleaving, and flaky timing bounds are banned** | **Enqueue is synchronous** — `acquire` pushes its waiter inside the `Promise` executor, which runs before the call returns — so `gate.state().resources.a.queued === 1` is readable on the line after an unawaited `acquire`, with no sleep. The synchronicity is asserted directly rather than relied on, and wrapping the push in a `queueMicrotask` turns four tests red. Release and drain are synchronous too, so a queued acquire resolves without any timer. The reference's own tests sleep 10 ms to let a writer queue; they did not need to. **The first draft claimed three timing assertions and had five, two of them upper bounds sitting in J2.8 with no table entry.** All five are now listed with direction and headroom: **two lower bounds and three upper ones**. Two of the three upper bounds guard a difference of three orders of magnitude (1 ms served vs 6.4 s un-stopped), not a difference of tens of milliseconds, so neither can race. Only J2.5 group 6 has headroom the same size as what it measures, and its remedy — raise `waitMs` to 200 and keep the `< 2×` shape — is written down rather than left to whoever sees it flake. |
| **N2's phase title says "one schedule entry" and there is no entry to ship** | **The phase is retitled to "Supervisor and gate, no entry yet"**, in `WORK.md` and in §3, by J2.18 — ticking 32 boxes under the old title would be the phase claiming a running loop it does not have. `SCHEDULE = []` and `PROGRAMS = {}`, by decision, asserted in a test whose title says so. An entry needs a `job` (N3's `host/jobs/`) or the watchdog `script` (JOB-O10, N4); §3.0 itself lists `nightly-sandcastle` under N3. The end-of-phase claim J2.18 writes down: *every mechanism exists, each is exercised over its whole input space, and they are wired together in a six-line block that nothing tests — no job has ever run.* |
| **"Fixture entries cover it" was said in eight places and means three different things** | Graded once, in ruling 1, and every use points at the grade. **REAL** — the gate, `parseFive` and the parity walk, `validate()`'s 23 rules, `inRefreshWindow`, the crontab transforms: all functions over values, where a fixture IS the correct input and the space is fully covered. **UNTESTED BY CONSTRUCTION** — the two argv blocks (~14 lines total) where `ROOT`, the real gate, the real `spawn` and `CRONTAB_CMD` are wired; no test reaches them, which is what ruling 2 buys and also what it costs. Each gets one **smoke check** against a temp `ENGINE_ROOT`, named as a smoke check, proving the block parses and dispatches but not that it wired the right values. **VACUOUS** — three assertions over an empty subject that could not fail: `validate(SCHEDULE)`, `SCHEDULE.length >= 0`, and `entriesInWindow(SCHEDULE, null) === []`. **All three are deleted rather than shipped as placeholders**, because an assertion that cannot fail reads in review as coverage. The parity corpus instead becomes `[...FORMS, ...SCHEDULE.map(e => e.cron)]`, so N3's first entry is walked the day it lands with no test to remember. |
| **Three N2 rows depend on N4 modules** | SUP-15 (LSE-09's reap), SUP-16 (QTA-09's `decideShed`) and half of SUP-06 (the watchdog). Each is an **ordering or placement** row, and the ordering is N2's to get right: `deps.reapOnBoot` and `deps.shouldShed` are supplied by the caller, and the tests assert with spies that the reap runs before the first timer registers and that a shed tick takes neither the self-lock nor the gate. Both become live at N4 by changing one line in the argv block. |
| **`test/layout.test.ts` assertion 12 hard-codes "N1 means it exists"** | Replaced by a rule **derived from `WORK.md`**, which owns phase state: a phase is SHIPPED when every one of its checkboxes is `[x]`; the first with an unticked box is CURRENT; the rest are FUTURE. SHIPPED rows must exist, FUTURE rows must be absent, CURRENT rows are exempt from both while clause 1 (every file on disk is named in §1) still covers them. Only J2.18 ticks an N2 box, so the phase stays CURRENT throughout and the suite is green at every commit — and J2.18 AC2 is the moment the flip proves every §1 row was really built. |
| **Every path a test could leak into the checkout** | Ruling 2: every path and every external command in `host/` and `cli/` is a **required** field on a `deps` argument, with no default, and the real values are assembled inside an `import.meta.filename === process.argv[1]` block no test reaches. TypeScript refuses a call that omits one. Two cheap doors back it up (J2.3): no module-scope `projectPath`/`mkdirSync`/`createWriteStream` in `host/` or `cli/`, and a register for files naming an externally-mutating command. This is the structural answer to N1's F4 leak, where a gitignored `leak.db` survived a whole phase because `git status` stayed clean. |
| **`spawnSlot` after the gate was challenged as a regression** | Checked and **upheld**, with the check on the record. The claim was that `engine/src/supervisor.ts:209` staggers before the window check (318) and the gate (330); those are **definition** line numbers, not execution order — 209 is inside `spawnChild`, which `runEntry` calls at 355, inside the `try` the gate acquire at 342 guards. The reference's own comment above 209 reads *"Hold here, not before the gate"*. And it is right for a reason stronger than fidelity: the stagger exists to space two children's `git config --global` calls, so if two entries stagger apart and then both block at the gate, one `drain()` releases them into the same instant and the stagger bought nothing. It only works as the last step before `spawn`. **The cost is real and is now stated and asserted rather than buried in prose**: the last of N entries firing on one minute holds its gate for up to `N × stagger`, and group 7 asserts the gate IS held while a pass is parked, so the trade is a measured property. Bounded by three things: readers do not exclude each other, a writer's `gateWait` is capped at 30 min, and N2 has no entries. Flagged in Gaps — no row states the trade. |
| **A mutation in the first draft would have destroyed the developer's crontab** | J2.16 AC3 said to hard-code `"crontab"`; measured, `execFileSync` with a bare name does a PATH lookup and four tests then reach `install` → `crontab -`. **Fixed twice over.** The mutation becomes `"/nonexistent/crontab-DOES-NOT-EXIST"` — absolute, guaranteed `ENOENT`, and it proves the same thing (the fake's log stays empty). And a new **layer 0** makes it safe by construction: `readCrontab`/`install` throw unless `isAbsolute(cmd)`, so every route to the real binary must first spell a bare name and every bare name now throws. One line, and it is what turns "be careful" into "cannot happen". The fake's log and state paths also move from shared environment variables to per-test wrapper scripts taking them as argv, because `node --test` runs one file in one process and two tests in flight would otherwise share one global. |
| **`host/` names `process.env` for the child's inherited environment** | `kernel/config.ts` gains a three-line `parentEnv()` returning `{ ...process.env }`, so `test/knobs.test.ts` assertion 3 — now scanning `kernel/`, `host/` and `cli/` — stays exactly `["kernel/config.ts"]`. The reference spreads `process.env` inline in the supervisor; this keeps KRN-06's one-file rule true as the repo grows past the kernel. |

---

## Gaps I found in the roadmap

1. **Three N2 rows cannot be finished at N2 because their mechanism is N4 or N5.** `SUP-15` needs
   LSE-09's `reapDead`, `SUP-16` needs QTA-09's `decideShed`, and `GAT-10`'s `lockloss:` counter is
   written by JOB-O02 (N5) and read by `backlog-health` (v1). All three are placement/ordering rows
   at heart, so this plan ships the placement with an injected fake and a spy-based ordering test,
   and names the owning phase in the code. Either move the rows, or state in §2.7/§2.3 that the row
   is satisfied by the placement and the consumer arrives later. As written they read as
   unimplementable in their own phase.

2. **SUP-06 is two-thirds outside N2.** "A boot refusal is loud: restart loop + watchdog reports
   within 15 min" — the restart loop is SUP-19, moved to M9 with the fleet, and the watchdog is
   JOB-O10 at N4. N2 can ship the non-zero exit and the per-entry message and nothing else. The row
   should either split or say which phase makes it loud to a human.

3. **SUP-09 says "exactly one entry (the watchdog)" and N2's schedule has zero.** The enforceable rule
   is **at most one**, which is what this plan implements. Confirm the softening, or say the rule
   only applies once a bootstrap entry exists.

4. **GAT-07 says `gate: "none"` exemptions "each stating why" and names no mechanism.** The reference
   states them in code comments, which nothing can check. This plan adds a required `whyNoGate` field
   to `Program` and has `validate()` refuse a `none` without it — turning eight comments into eight
   checked claims. That is an addition to SUP-02's field list; confirm it.

5. **§5 Q1 is answered here and the roadmap should record it.** J2.6 amends §5 Q1 in place (the J0.7 /
   J0.9 precedent): the host declares `{ name, path, why }` rows, `path` is ROOT-relative, and this
   repo names `repo` and `skills`. Flagged so the GAP step reviews the answer rather than only the
   fact that one was given.

6. **SUP-07 does not say the 14-day walk is O(firings), and it is.** Measured: one `* * * * *`
   expression costs 3.4 s of croner time over 14 days (6.4 s over the 21-day window `tickSeconds`
   uses), and a 22-form corpus costs 7.0–7.8 s. The row should either bound the corpus or say the
   window is walked per expression, because the natural reading — "every expression" — puts a
   multi-second test on the critical path of every commit and no note anywhere says so. The same
   cost is what forces `gateWait`'s early stop and its memoisation, neither of which GAT-08
   mentions.

7. **Nothing anywhere says the schedule's cron grammar is the intersection of croner and POSIX, and
   it has to be.** Measured, they disagree on dom+dow-both-restricted (20 missed pairs, 14 dates,
   2024–2032) and they disagree on `a/n` in the other direction. SUP-05's check list should name the
   refusal, or SUP-07 should say what happens when parity FAILS rather than only that it is tested.
   A row that mandates a comparison and is silent on the outcome leaves the builder to invent the
   policy, which is how two builders invent two.

8. **`BACKLOG_LOCK_STARVE_N` and `BACKLOG_LOCK_STARVE_N_TODO_EXEC` carry a pipeline stage name that
   means nothing in this repo** and sit under §2.27's "Health" bullet, while the knob is a property
   of the GATE. Renamed here to `LOCK_STARVE_N` and the family `LOCK_STARVE_N_<JOB>`, and moved to
   Core/paths, on J1.4's `FACTORY_STATE_DIR` → `ENGINE_STATE_DIR` precedent. Confirm.

9. **Five supervisor knobs are missing from §2.27.** `SUPERVISOR_KILL_GRACE_MS`,
   `SUPERVISOR_DRAIN_MS`, `SUPERVISOR_SPAWN_STAGGER_MS`, `GATE_WAIT_CAP_S` and `CRONTAB_CMD` are all
   real knobs in the reference or required by this phase, and §2.27 names none of them. Added by the
   jobs that create them (the J1.15 `EXEC_TIMEOUT_MS` precedent). `CRONTAB_DRY_RUN` is genuinely new
   — SAF-01 is a per-JOB row and the crontab tool is not a job, so the safe-run surface has no row
   that covers an operator CLI. Consider one.

10. **KRN-06 still cannot express a knob FAMILY, and N2 adds the second one.**
    `LOCK_STARVE_N_<JOB>` joins `<NAME>_DB` in using a literal `key` plus an allowlisted `envDynamic`
    call site. N1's Gaps item 4 said this gets worse at N3 when jobs declare their own; it got worse
    at N2 instead. A `pattern?` field on `EnvSpec`, or a rule that a family is declared once per
    concrete key by its owner, needs deciding before N3.

11. **§3's N2 line and `WORK.md` disagree twice.** §3 says N2 ships `SUP-01…21` (SUP-19 and SUP-21 are
    moved out, and `WORK.md` says so) and `TST-17 (gate half)` (`WORK.md` lists TST-17 only under
    N4). The gate-contract tests really are in N2 — J2.4 and J2.5 are TST-17's gate half — so the
    work is not lost, but the bookkeeping says two different things.

12. **`WORK.md`'s N2 title, "Supervisor, one schedule entry", promises an entry N2 cannot ship.** An
    entry needs a job (N3) or the watchdog script (N4). §3.0's own table agrees, sizing `schedule.ts`
    at "~1 entry" and listing `nightly-sandcastle` under N3. Retitle, or say the entry is N3's.

13. **No row says where `validate()` lives, and §1's `cli/` line names four tools with no files.** §1
    listed `supervisor --list` under `cli/` while SUP-17 is a flag on the supervisor. J2.1 rewrites
    both blocks one file per line with milestone tags; confirm the placement, particularly that the
    crontab tool is `cli/crontab.ts` and imports `host/schedule.ts`.

14. **ADO-01's open question now has a consumer.** `cli/` is a declared workspace with
    `private: true`, and `cli/crontab.ts` imports `../host/schedule.ts` — `host/` is deliberately not
    a workspace, so nothing is phantom today, but TST-25's sibling clause ("no workspace names
    another workspace's `src/` by path") will have to rule on it at N5. N0's Gaps item 1 asked
    whether `cli` publishes at all; that answer decides this one.

15. **PRT-06 fixes `ScheduleEntry` at N5 and N2 has to build it now.** The interface ships in
    `host/schedule.ts` and moves to `kernel/ports/schedule.ts` unchanged — the same pattern KRN-06's
    `EnvSpec` followed at N1. Worth a sentence in PRT-06 saying the shape lands early and the port
    is a re-homing, so N5 does not read it as a rewrite.

16. **SUP-18 states "two log roots, both read; log paths explicit per entry, never derived" and names
    no enforcer.** An entry writing outside both roots is a job whose output the reporter never sees,
    which is the silent half of the row. This plan makes `validate()` refuse it. Confirm, or mark the
    root membership advisory.

17. **`maxRunMin` is minutes and its type is `number`, so the only way to test SUP-13 in under a
    minute is a fractional minute** (`0.005`). It works and it needs no new seam, but the row does
    not say fractions are legal. Either say so, or accept a millisecond field on `deps`.

18. **No row states the `spawnSlot`-holds-the-gate trade, and the reference states it in the worst
    possible place.** HRN-18 describes the stagger; SUP-03 describes the spawn; neither says the
    stagger runs INSIDE the gate hold, so the last of N entries firing on one minute holds its gate
    for up to `N × SUPERVISOR_SPAWN_STAGGER_MS` (24 s at the reference's own 12-entries-on-one-minute
    worst case). The reference's justification is a two-line comment inside `spawnChild`, three
    hundred lines from the pre-flight order a reader is actually looking at — which is why this
    plan's first reviewer read the line numbers as execution order and called the correct placement
    a regression. Either HRN-18 or SUP-03 should carry the trade in one sentence.

19. **`nextRun` and `match` are two different questions and the roadmap treats croner as one thing.**
    Measured: `match()` agrees with POSIX on 30,660 of 30,660 day-slots while `nextRun()` skips 20
    (expression, date) pairs. SUP-07 says "croner-vs-POSIX parity" without saying which entry point,
    and the answer decides the whole design: if it were `match`, the grammar would need no dom+dow
    refusal at all. The row should name `nextRun`, because that is what a croner timer runs on.

20. **Nothing forbids a nested gate acquire, and GAT-04's deadlock argument silently assumes none.**
    A caller that holds `["c"]` and then asks for `["a"]` inverts the fixed global order and
    deadlocks against its mirror — the exact failure GAT-04 exists to make impossible. GAT-01…09 say
    nothing about re-entrancy, and the exhaustive test cannot see it because every task acquires
    once. `runEntry` happens to satisfy the premise; N3's first job is the first chance to break it.
    Either GAT-04 states the premise, or a row mandates that the gate enforce it — and the second is
    a design change that wants a second caller to argue with (D9) rather than a guess now.
