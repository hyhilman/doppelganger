# MVP loop — state of record

**Goal:** the MVP of `roadmap.md` = **N0 → N4**, 125 items, ending at "safe to leave alone".
N5 (the framework claim) is out of scope for this loop.

**Branch:** `dev`. Every step is a small, self-contained commit citing its feature ID.

## The per-phase cycle

Each phase runs the same four steps. The main loop only reads the output of each step
and decides whether to advance — it does not re-verify the work itself.

1. **PLAN** — one Opus agent reads `roadmap.md` §2 rows for the phase's IDs plus the
   xenith reference, and writes `plan/N<x>-uac.md`: one job per item, each with a
   detailed, testable acceptance criterion.
2. **GAP** — one Opus verifier reads the plan against the roadmap and reports what is
   missing, wrong, or untestable. Its findings are folded back into the plan.
3. **BUILD** — Sonnet agents work the plan job by job. Small change, `npm test`, commit,
   next. No agent bundles unrelated items into one commit.
4. **VERIFY** — one Opus verifier checks the finished phase against `plan/N<x>-uac.md`
   and the roadmap. Its findings become follow-up fix jobs, worked the same way.

Advance only when VERIFY comes back with nothing blocking.

## Phase state

| Phase | Items | Est. | Plan | Gap | Build | Verify |
|-------|-------|------|------|-----|-------|--------|
| N0 — Ground truth | 11 | 2 d | ✅ | ✅ | ✅ | ⚠ |
| N1 — Kernel the loop needs | 26 | 1.5–2 wk | ✅ | ✅ | ✅ | ✅ |
| N2 — Supervisor and gate, no entry yet | 32 | 1 wk | ✅ | ✅ | ✅ | ✅ |
| N3 — Harness + skills + the pass | 34 | 1.5–2 wk | ✅ | ✅ | ✅ | ✅ |
| N4 — Safe to leave alone | 22 | 1 wk | ✅ | ✅ | ✅ | — |

Legend: `—` not started · `▶` running · `✅` done · `⚠` done with open follow-ups.

## Standing rules for every agent in this loop

- `roadmap.md` is the spec of record. Cite the feature ID (`KRN-01`, `LSE-07`, …) in the
  commit message, the test name, and any comment that needs one.
- Read the reference at `/home/hyhilman/projects/xenith/` (`engine/**`,
  `compose-data/docker-compose.yml`) rather than guessing at behaviour. It is the
  acceptance criterion, not something to copy verbatim.
- `CLAUDE.md` layering law, working rules, and the invariants (INV-1…12) are not
  negotiable.
- One small change per commit. Run `npm test` before each commit once a suite exists.
- Never hand-edit `.claude/skills/` — it is rendered.
- **Every gate must name the mutation that turns it RED.** A gate with no such mutation is
  decoration. Prove it: make the change, watch the suite fail, put it back.
- **An unused import is never a valid gate mutation.** `noUnusedLocals` kills it at `pretest`
  with TS6133, so the test reads as "exits non-zero" while the gate it names never runs. The
  mutation must consume the binding.
- **Never assert a number the same commit writes.** Parse it from the file that owns it.
- **Never pin an exact value of something outside this repo.** It rots. State the claim as an
  approximation and gate the approximation.

## Settled questions

- **§5 Q0 — no symlinks.** Every skill is a **project skill**. `.claude/skills/<job>/SKILL.md`
  is a real file in the project tree: a rendered copy of `plugins/<x>/skills/<job>/SKILL.md`,
  not a link, and not delivered through the plugin-skill mechanism. Confirms SKL-04 as
  written and kills the symlink branch of TST-23. (Decided by the user, 2026-08-25.)
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
- **§5 Q1 settled (J2.6)** — the host names the gate's resources as `{ name, path, why }` rows;
  `path` is ROOT-relative, which is INS-05's constraint made mechanical. Two names at N2: `repo`,
  `skills`.
- **croner is a dependency (J2.8)** — exact `10.0.1`, root `dependencies`, zero transitive deps,
  imported by exactly one file. Writing the parser instead would have made SUP-07 circular.
- **The cron grammar is the intersection of croner and POSIX (J2.9/J2.10)** — measured divergence:
  one of `dom`/`dow` restricted, 320/320 agree; both restricted, `nextRun()` misses 20
  (expression, date) pairs over 14 dates, swept 2024–2032, all in March; `croner.match(date)`
  agrees with the POSIX oracle 30,660/30,660 day-slots including every missed date, so the fault is
  in `nextRun`'s iterator, not croner's semantics. Measured 2026-08-26, croner 10.0.1 / Node
  22.23.1.
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
- **J3.17's real pass, what it measured (N3 close, J3.18).** `@ai-hero/sandcastle` is real, and
  every N3-uac measurement of it held up against a real paid run · `jobRunner` spawns
  `host/run.ts <job>`, never the job file directly — the first draft's version would have run
  nothing, silently, every night (this plan's own headline defect, named in `plan/N3-uac.md`'s
  own opening paragraph) · `run()` writes `~/.gitconfig` (4,523 duplicate `safe.directory` lines
  measured on this host before the fix) and `GIT_CONFIG_GLOBAL` is the fix, inherited by the
  agent child (which is what lets it commit inside a worktree it did not create), needing its own
  parent directory to exist first · an unattended agent can reach `origin` over SSH, and
  `GIT_SSH_COMMAND=/bin/false` is the gate · layer B (a fake `claude` earlier on `PATH`) makes the
  real `run()` path testable for free, with no paid call · "pinned" is a shape predicate plus an
  alias denylist plus a runtime `assertPinned` check, never a promise that one exact string never
  changes · the CLI's advertised permission-mode list, its actually-accepted set, and sandcastle's
  own type union are three different lists, and N3 pins none of them — it owns a two-member
  allowlist and gates every literal against it.
- **`isOwnerAlive` fails toward DEAD in three branches of the reference; ours splits `unknown` from
  `dead` (J4.2, ruling 4).** And `ENOENT` is positive evidence only on a `/proc` without
  `hidepid`/`subset=pid` — this host measured unrestricted, `rw,nosuid,nodev,noexec,relatime`.
- **`commandOf` rendered `node <script>.sh` while `spawnChild` exec'd it directly (J4.11,
  ruling 5).** `b48c89f` fixed the `.sh` half and J4.11 the `.ts` half — the N3 F1 precedent
  applied a second time.
- **The quota fixture corpus is first-hand from this machine's reference store (J4.8, ruling 1).**
  Four parks, three dated 2026-08-26, `class: spend` on the three workers only, two nesting
  depths, 22 `job_queue` rows carrying one distinct string.
- **`DEFAULTS.shedModel` cannot be a literal outside `kernel/ports/job.ts` (J4.9, ruling 8;
  precondition P4)** — `test/model.test.ts` test 6 is exact, and `*.fixture.ts` was scanned by it
  until J4.8.
- **This host has no MTA of any kind (J4.14, ruling 6).** `/var/mail` is empty and cron
  `3.0pl1-184ubuntu2` contains `No MTA installed, discarding output` — so a non-zero exit is a
  status, not a channel.
- **The hourly key is the writer the first draft missed (J4.4, ruling 3).** The clock versions a
  key for a reason unrelated to the job's success, so `withLease` keeps four members and loses
  six.
- **`beat()` writes the heartbeat and `status.json` in two independent `try` blocks (J4.13,
  ruling 7).** One block made a failing status write set the heartbeat stamp and probe 4 correct a
  probe that never fired.

## Open items the loop must not silently skip

- **R1 — the real pass's headline finding (N3 close, J3.18): one verdict did not end the run.**
  The 2026-08-26 paid pass ran 6 Opus iterations against a 20-iteration cap for one intended
  improvement. Cause: `runJob`'s default `completionSignal` is sandcastle's own
  `<promise>COMPLETE</promise>`, a string the `nightly-sandcastle` skill never emits (it emits a
  `<<<SANDCASTLE ... SANDCASTLE>>>` block instead) — read in
  `node_modules/@ai-hero/sandcastle/dist/index.js`'s `orchestrate()`: the loop only stops early on
  a literal substring match of the signal in the agent's accumulated stdout, and otherwise runs
  every iteration up to the cap. Fixed with `nightlySandcastleJob.maxIterations = 1` (over making
  the signal match, or hooking the runner to stop on a parsed verdict): it matches the skill's own
  contract ("one pass, one improvement ... report ONCE") and is one field read by the dry-run and
  real-run paths alike. Gated by `host/runner.test.ts` test 13 — a fake `claude` that emits a real
  verdict but never sandcastle's signal, driven with the job's OWN configured `maxIterations`, so a
  regression that removes the field is caught, not silently re-defaulted to 20.
- **R2 — a real pass's runtime litter tripped five repo-wide walkers and one drift gate (N3 close,
  J3.18, INS-02).** `.doppelganger/worktrees/<job>/` is a second full checkout (own
  `package.json`, `node_modules`, `*.test.ts` files); five walkers
  (`test/commands.test.ts`, `test/deps.test.ts`, `test/layout.test.ts`, `test/no-raw-sqlite.test.ts`,
  `test/toolchain.test.ts`) skipped `.git`/`node_modules` only at the repo top level and walked
  straight into it. Separately, `test/layout.test.ts` assertion 15 called any `.db` file below
  `.doppelganger/`'s top level an offender, but `.doppelganger/state/` is `dbPath()`'s DESIGNED
  home for every integration's database — so a normal run's own `nightly.db` tripped the gate
  meant to catch a leak. Both fixed: the walkers now also skip an entry named `worktrees` directly
  under `.doppelganger`; assertion 15 now reads `DB_NAMESPACES` (itself gated as a superset of
  every real `dbPath(` call site) and excuses a `.db` file in `state/` under one of those real
  names, while still catching anything else there or anywhere else in the tree. N1 F4's original
  stray-`leak.db` detection is unchanged and still fires.
- **R3 — `commandOf` and `spawnChild` disagreed on a `script:` entry's command (N3 close, J3.18,
  SUP-03).** N3 F1's exact defect shape, one row over: `commandOf` rendered `node <script>`
  unconditionally, while `spawnChild` executed the script file directly via its own shebang.
  Nothing caught it because `SCHEDULE` has never held a `script:` entry — N4's watchdog
  (JOB-O10) is the first, and would have tripped on it immediately. Fixed the same way N3 F1
  was: one function, `scriptCommandOf(root, script)`, that both consumers call. The fuller
  `.sh`/`.ts` dispatch and the `validate()` executable-bit rule stay J4.11's job, not smuggled in
  here.
- **R4 — the Ships-line drift gate (test 14) would have THROWN, not merely failed, the moment N3
  was ticked (N3 close, J3.18, TST-06).** Its token classifier only recognised a plain id as
  PREFIX-DIGITS; N3's own Ships line names `JOB-C15`, and every `JOB-` id carries one infix letter
  before its digits. Fixed on both sides of the comparison (`expandShipsIds` and `workPhaseIds`)
  before N3 was ticked, proven with a scratch, never-committed copy of WORK.md with every N3 box
  ticked: the old regex threw `roadmap.md N3's Ships line has a token this drift gate cannot
  classify: "JOB-C15"`; the fixed one produces a clean diff instead.
- **CI is triggering on push; the earlier "stopped triggering" note is retired.**
  `gh run list --branch dev` (checked 2026-08-26, this session): the most recent push before this
  session ("Plan N4 — 16 jobs...", run `32992202936`) completed **successfully**. One earlier run,
  for 71f6f12 (run `32984580094`), has sat in `queued` state for 2+ hours with no jobs listed — a
  one-off GitHub-side scheduling stall on that single run, not a persistent stop, since the next
  push after it triggered and completed normally. This session's own commits (R1–R4, J3.18) are
  **not pushed** — the task's safety rule for this session is "do not push" — so there is no new
  run to check for them; the next push should confirm CI is still green.


- **A "guard" that checks the wrong property is not a guard (N2 F1).** The crontab command was
  gated on `isAbsolute`, which stops a PATH lookup — while the knob's own default was
  `/usr/bin/crontab`, an absolute path to the real binary. The check passed and the reader
  returned the developer's real crontab. The knob is now `required: true` with no default, so
  forgetting it throws. When a header claims something is "unreachable", read the defaults.
- **Code being right is not the same as being gated (N2 F3).** Deleting the `releaseSelf()` call
  on the gate-failure path left the whole suite green. Every N3 behaviour that matters needs a
  test that goes red when it is deleted, not a reviewer who reads it and agrees.
- **J0.13 AC4 — CLOSED.** CI ran green on a real runner: `https://github.com/hyhilman/doppelganger/actions/runs/32952736069`.
  `dev` is pushed at the end of every phase from now on (the user authorised this 2026-08-26).
- **(historic) J0.13 AC4 — CI had never run.** `dev` is not pushed, so no GitHub Actions run exists and
  no run URL is recorded. The workflow content is correct and its shape was proved locally:
  a fresh clone + `npm ci` + `CORPUS_OVERRIDE=/nonexistent npm test` exits 0 and reports
  `# SKIP reference corpus absent`, which is what AC5 wanted to observe. Residual risk is
  low but the AC stays UNMET until someone pushes. **Waiting on the user.**
- **`log.sh` would not ship at N5.** LOG-01's second emitter is a shell file inside a package
  whose publish build is `tsc`, so a real install gets one emitter, not two — and TST-18 has
  nothing to compare against. Nothing publishes before N5, so this belongs to ADO-15's row,
  not to N1. Recorded here so N5 does not rediscover it.
- **The corpus counts will keep drifting, by design.** xenith grew twice while N0 was being
  built — 251 → 252 → 254 files in one day. That is why the four figures are now stated as
  approximations and the recheck asserts rounding, not equality (N0 F4). If a future reader
  wants exact numbers, the answer is to measure, not to pin.

- **SKL-10 ownership — settled at N0 (J0.9).** The rendered file itself carries a managed
  marker in its body (two HTML comment lines, right after the frontmatter), so `sync` can
  decide ownership from the filesystem alone, no ledger. `check` reports five findings:
  missing, drift, orphan, collision, stray. A hand-edited rendered file fails the build and
  is never silently re-rendered. See `roadmap.md` §5 Q0 and §2.30 SKL-10.
- **§5 Q5 — settled at N0 (J0.7).** Measured on the target Node: this repo's own dev loop
  needs no build (a workspace link is a symlink, and Node strips types through it), but a
  real install still does (ADO-15 stays). This corrects ADO-16's old premise. See
  `roadmap.md` §5 Q5 and §2.32 ADO-16.
- **SKL-07 output-vocabulary boundary — drawn at N0 (J0.9).** A skill may emit an output
  vocabulary (a report format, like `nightly-sandcastle`'s `outcome=`) but never an
  authorization token (a value that widens what the run may do, like JOB-T03's `agent`).
  TST-24's third clause is reworded around this line. N3's real `parseVerdict` must
  reproduce the pinned vocabulary in `test/skills-example.test.ts`.

- **KRN-06 cannot express a knob FAMILY (N1 Gaps item 4).** `<NAME>_DB` and `*_SPAWN_STAGGER_MS`
  are both families, not keys, and `EnvSpec { key, required?, default?, why }` has no `pattern?`
  field to say so. N1 works around it per-family (a literal `<NAME>_DB` row plus one allowlisted
  dynamic read; `pool.ts` takes `staggerMs` as an argument with no row at all). **Got worse at N2,
  not N3 (plan/N2-uac.md's Gaps item 10):** `LOCK_STARVE_N_<JOB>` is a second family, worked around
  the same way (`kernel/config.ts`'s `assertSpecShape` generalized from one hardcoded
  `"<NAME>_DB"` exception to any single-`<PLACEHOLDER>` key, J2.12). Decide before N3, where jobs
  start declaring their own.
- **`kernel/config.ts` vs `host/config.ts` (N1 Gaps item 6).** Two different things with one name;
  J1.1 added a distinguishing sentence to §1, but a rename of one would be better and is not a
  build-phase's call to make.
- **§2.27 becomes a second copy of every plugin's `env` member as plugins arrive (N1 Gaps item
  12).** J1.18's gate works today because this plan added the two N1 keys §2.27 was missing.
  Decide whether §2.27 survives KRN-04 (N5) or is generated from it.
- **No row says a test may leave nothing in the checkout (N1 Gaps item 13).** J1.5, J1.12 and
  J1.17 each assert it by hand. N1 F4 now gates it once for the whole checkout
  (`test/layout.test.ts` assertion 13), after a stray `leak.db` survived a full phase unnoticed —
  it was gitignored, so `git status` stayed clean. A `TST-` row would give the gate something to
  cite.
- **A gate that pattern-matches ONE spelling of an import is not a gate.** N1 shipped three that
  did: the INS-02 write register, the DBS-06 driver allowlist, and the KRN-06 knob scan. A live
  `writeFileSync` reached `pool.ts` through a default import, through a named binding used as a
  namespace, and through a dynamic `import()` — green every time. All three are fixed. Any future
  gate that reads source text must cover every spelling, or say in a comment which it cannot.

- **N2's VERIFY step has not run as a separate pass.** LOOP.md's own four-step cycle calls for one
  Opus verifier to check the finished phase against `plan/N2-uac.md` and the roadmap, independent
  of BUILD. That step has not happened in this session — BUILD self-checked every job's own
  acceptance criteria by literally running the command each one names (including all 24 RED
  mutations across the 18 jobs) and recorded the results in each commit body, which is a real check
  but not the same guarantee as an independent pass. The phase table marks Verify `⚠` for this
  reason, not `✅`.
- **ADO-01's open question now has a real consumer (plan/N2-uac.md Gaps item 14).** `cli/` is a
  declared workspace (`private: true`), and `cli/crontab.ts` imports `../host/schedule.ts` — `host/`
  is deliberately not a workspace, so nothing is phantom today, but TST-25's sibling clause ("no
  workspace names another workspace's `src/` by path") will have to rule on this at N5. Whether
  `cli` publishes at all decides it; still undecided.
- **SUP-07 does not bound the parity corpus, and the walk is O(firings) (plan/N2-uac.md Gaps item
  6).** Measured: one `* * * * *` expression costs ~3.4s of croner time over 14 days, and the
  22-form corpus in `host/parity.test.ts` costs ~7-8s total were it not gated behind
  `CRON_PARITY_RECHECK=1` (opt-in, not run by default `npm test`). The row's natural reading —
  "every expression" — would put a multi-second test on every commit's critical path if the corpus
  ever grew unbounded or the recheck became default-on. No row says so.
- **`CRONTAB_DRY_RUN` has no `SAF-` row of its own (J2.16's own Risks note, plan/N2-uac.md Gaps
  item 9).** SAF-01 is defined per-JOB (`*_DRY_RUN`), and the crontab tool is not a job — it is an
  operator CLI. The safe-run surface (§2.28) has no category that covers a CLI tool's own dry-run
  flag. `CRONTAB_DRY_RUN` behaves exactly like a SAF-01 knob and is documented as satisfying its
  intent, but nothing in §2.28 says an operator CLI gets one.
