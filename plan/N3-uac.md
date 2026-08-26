# N3 — The harness and the pass · UAC breakdown

**Revision 2**, after the GAP step. The first draft's reasoning survives; three of its designs did
not. The headline defect is recorded in full rather than quietly fixed: **the first draft's scheduled
entry would have spawned a file with no argv block and exited 0 having done nothing, every night,
silently** — the phase's own acceptance bar, failed by its own plan, with no AC that could see it.
Ruling 3 is that fix. Two more designs were replaced (one worktree owner, not two; `local` is not an
authorization precondition) and six measurements were added or corrected. Every change is attributed.

N2 ended with one honest sentence: *every mechanism the supervisor needs exists, each is exercised
over its whole input space, and they are wired together in a six-line block that nothing tests — no
job has ever run.* N3 ends that sentence.

**N3 is done when a real `SCHEDULE` entry exists, a real `PROGRAMS` row backs it, and the exact
command `commandOf`/`jobRunner` renders reaches `runNamed` and runs a real agent** through
`ports/runner`, parses its `<<<SANDCASTLE` block, puts the change through a three-tier ship gate and
lands it with `merge --ff-only` — or refuses, loudly, at any of eight named gates. Concretely:
`DEFAULTS` in one place with a pinned model · `defineJob` · one `RunResult` contract behind one
`Runner` seam · the `@ai-hero/sandcastle` adapter · the sentinel parser · worktree realization and
`{{WORKTREE}}` · `skills render|sync|check` with the six findings · SKL-06 gated both ways · the whole
safe-run surface · and the first entry.

**Rule this plan obeys at every step: the phase is green at every commit.** `npm test` exits 0 after
every job. Walk the commits in order and no job imports a file a later job creates.

**Baseline, measured 2026-08-26 on this checkout:** `npm test` → `# tests 375 / # pass 373 / # fail 0
/ # skipped 2`, `duration_ms 10217`, `real 0m11.5s`.

---

## The six rulings that shape every job below

### 1. `@ai-hero/sandcastle` is real, installable, and typechecks here — measured

Everything in this block was run on this machine, Node 22.23.1, npm from `.nvmrc`. The GAP step
independently reproduced the install, the peers, the typecheck, the no-stdin-path finding, the
`buildPrintCommand` purity and both halves of the `GIT_CONFIG_GLOBAL` fix, and rebuilt layer B from
this description alone in 63–69 ms.

| claim | measurement |
|---|---|
| the package exists | `@ai-hero/sandcastle@0.12.0`, MIT, `github.com/mattpocock/sandcastle`, `bin.sandcastle → dist/main.js`, `exports` carries `.` and five `./sandboxes/*` subpaths |
| install cost | `npm install @ai-hero/sandcastle@0.12.0` → **`added 7 packages`**: the package + `@clack/prompts`, `@clack/core`, `fast-wrap-ansi`, `fast-string-width`, `fast-string-truncated-width`, `sisteransi`. ~15 MB, **~14 MB of it `.js.map`** |
| the two peers | `peerDependenciesMeta` marks **both** `@daytona/sdk` and `@vercel/sandbox` `optional: true`. `npm install` exits 0, `npm ci` exits 0, `npm ls --all` **exits 0** and prints them as `UNMET OPTIONAL DEPENDENCY` |
| **the Node floor it imposes** | `@clack/prompts` and `@clack/core` declare `engines.node >= 20.12.0` (`@clack/core` imports `styleText` from `node:util`, added at 20.12); the other four declare none. **This repo's floor is `>=22.18.0`, so the new dependency lowers nothing and changes no `.nvmrc` decision.** Measured, because a dependency that raised the floor would be an N0 decision reopened |
| it typechecks under OUR tsconfig | a probe using `run`, `claudeCode`, `noSandbox`, `RunOptions`, `RunResult`, `PromptArgs`, `ClaudeCodeOptions` under this repo's exact `tsconfig.json` → **`tsc --noEmit` exit 0** |
| importing it is inert | `import()` of `.` **and** `./sandboxes/no-sandbox`, stdin closed: exit 0, **97 ms**, **zero files created in cwd** |
| it never blocks on stdin | the three interactive calls (`clack.text`, `clack.isCancel`, `clack.cancel`) live only inside **`interactive()`**, on the branch collecting a **missing `{{KEY}}` for a `promptFile`**. `run()` reaches none. The other `clack.*` uses are `ClackDisplay`, selected only by `logging: { type: "stdout" }` |

**`./sandboxes/no-sandbox` is the subpath N3 targets, and the reason is HRN-07 itself.** `run()`
computes `dangerouslySkipPermissions: sandboxProvider.tag !== "none"`, which is **`false`** for
`noSandbox()`. Measured through the provider's own pure `buildPrintCommand`:

```
permissionMode UNSET      → claude --print --verbose --output-format stream-json --model 'claude-opus-5' --effort high -p -
permissionMode set        → claude --print --verbose --permission-mode bypassPermissions --output-format stream-json --model 'claude-opus-5' --effort high -p -
```

The first line carries **no permission flag at all** — HRN-07's hang, made visible.

**The permission-mode vocabulary: three lists, none equal — measured, and it corrects a claim made
during review.** The installed CLI (2.1.246) validates the flag in **0.2 s** and, on an unknown
value, prints `Allowed choices are acceptEdits, auto, bypassPermissions, manual, dontAsk, plan`.
But that advertised list is not the accepted set: probing all seven values with an empty prompt
(rejection at 0.2 s, acceptance reaching the "Input must be provided" check at ~1.7 s) shows
**`auto`, `bypassPermissions`, `acceptEdits`, `plan`, `default`, `manual` and `dontAsk` are ALL
accepted**, and only a genuinely unknown value is refused. So `default` **is** accepted, contrary to
the review's parenthetical, while `manual` is accepted and is **absent from sandcastle's
`ClaudeCodeOptions` union**, and `default` is **in** that union but absent from the CLI's own
advertised list. N3 therefore pins none of them: it owns a two-member `PERMISSION_MODES` allowlist
(`"auto"`, `"bypassPermissions"`) and gates every literal against **that**, with the divergence
recorded in a dated comment and an opt-in `CLI_MODES_RECHECK=1` probe that prints and asserts
nothing — the `CORPUS_RECHECK` precedent.

**The real signature, so `ports/runner` is designed against something true:**

```ts
run(options: RunOptions): Promise<RunResult>
// RunOptions (what N3 uses): agent, sandbox, cwd?, prompt?, maxIterations?, logging?,
//   completionSignal?, idleTimeoutSeconds?, completionTimeoutSeconds?, name?, branchStrategy?, signal?
// RunResult: { iterations: IterationResult[]; completionSignal?: string; stdout: string;
//   commits: {sha:string}[]; branch: string; logFilePath?: string; preservedWorktreePath?: string; resume?; fork? }
claudeCode(model: string, options?: ClaudeCodeOptions): AgentProvider & { sessionStorage }
noSandbox(options?: { env?: Record<string,string>; maxOutputTailChars?: number }): NoSandboxProvider
```

`RunResult` is **not** adopted. HRN-03 says ONE `RunResult` and M11 swaps the library with *"every job
file unchanged"*; adopting a third party's interface makes that swap a rewrite. `kernel/ports/runner.ts`
declares our own six-field `RunResult` and `host/runner.ts` maps sandcastle's onto it.

**The dependency arithmetic.** One dependency becomes two, seven installed packages. `croner` was
accepted because SUP-07 was circular without it; sandcastle is accepted because D2 names it, because
an unattended agent runner is M11's own 3-week line item, and because every measurement above came
back clean. `test/deps.test.ts` grows an importer register so both are single-importer claims.

### 2. What proves the real path works — three layers, and the one manual step

**Layer A — the pure seam, in `npm test`, zero cost, zero spawn.** `AgentProvider.buildPrintCommand({ prompt, dangerouslySkipPermissions })`
is a pure function on the real provider object built by the real package. `host/runner.test.ts`
builds it through `host/runner.ts`'s own exported `buildAgent(req)` — the same call the runner makes
— and asserts the command names our `permissionMode` value and our model string. Deleting
`permissionMode:` turns it RED. Proves the **configuration**; proves nothing about an agent running.

**Layer B — the whole `run()` path, in `npm test`, zero cost, against a FAKE `claude` on `PATH`.**
`noSandbox().create()` spawns `sh -c <command>` with `{ ...process.env, ...providerEnv }`, so a fake
`claude` earlier on `PATH` is found. Measured: a real `run()` with a real `claudeCode()`, a real
`noSandbox()`, a real temp git repo and a shell script printing a `<<<SANDCASTLE` block and
`<promise>COMPLETE</promise>` returns in **104 ms** (the GAP step reproduced it at 63–69 ms) with
`completionSignal` matched, `iterations: 1`, `branch: "main"`, the log at the path we passed, and
`stdout` carrying the agent's bytes verbatim. Four failure modes measured: **non-zero exit** → rejects
with an `instanceof Error` whose `.message` is `claude-code exited with code 3:\nboom\n` · **no
completion signal, exit 0** → resolves with `completionSignal: undefined` · **`logging: {type:"file"}`**
keeps the terminal UI off and prints a two-line banner to **stdout** · **a `GIT_CONFIG_GLOBAL` whose
parent directory is missing** → rejects with `Command failed (exit 255): git config --global --add
safe.directory …` / `could not lock config file …: No such file or directory` (ruling 6).

**Layer C — the one manual step, J3.17.** `NIGHTLY_SANDCASTLE_DRY_RUN=1 npm run job nightly-sandcastle`
on a host where `claude` is logged in (measured present: 2.1.246 at `~/.local/bin/claude`). It costs
one Opus pass. It is the only thing that proves the CLI accepts our flags, the skill is found by
name, a real model emits a block `parseVerdict` accepts, and the pass fits inside `maxRunMin`. **J3.17
commits the real stdout as the TST-19 fixture.** Until it lands, N3 is not done.

### 3. The spawned command must reach `runNamed` — the defect that failed the phase's own goal

**This is the first draft's headline defect and it is recorded, not quietly fixed.** N2 shipped, in
`host/supervisor.ts`'s argv block:

```ts
jobRunner: (job: string) => [process.execPath, [projectPath(`host/jobs/${job}.ts`)]],
```

and `host/schedule.ts`'s `commandOf` renders `cd <ROOT> && node host/jobs/<job>.ts`. The first draft
put the only argv block in `host/run.ts`. So a real supervisor tick would have spawned
`host/jobs/nightly-sandcastle.ts`, evaluated its module scope, exported a `Job`, and **exited 0
having done nothing** — every night, silently, with a `job-ok` line to say so. No AC could see it:
`npm run job` exercises `host/run.ts`, and `--list` never spawns anything.

**The fix: one argv block, and `jobRunner`/`commandOf` point at it.** Two lines change:

```ts
// host/supervisor.ts argv block
jobRunner: (job: string) => [process.execPath, [projectPath("host/run.ts"), job]],
// host/schedule.ts commandOf — the `job` branch only
const target = e.job !== undefined ? `host/run.ts ${e.job}` : (e.script ?? "");
```

Rejected alternative: an argv block in every job file. It duplicates the wiring once per job — twenty
copies by N5 — and puts the assembly of `runner`, `db`, `git` and four paths in twenty places instead
of one, which is the opposite of ruling 2's whole point.

**Checked, so the change is cheap:** `cli/crontab.test.ts` and `cli/crontab-cli.test.ts` build their
expected lines by *calling* `commandOf` (`const line = \`${e.cron} ${commandOf(e)}\``), so they derive
rather than pin. The one hand-built expectation (`cli/crontab.test.ts:356`) is on the **`script`**
branch, which this change does not touch. Measured by reading both files.

**And the AC that would have caught it becomes mandatory.** Every phase from here on drives the
**jobRunner path itself**: spawn the exact `[cmd, ...args]` that `jobRunner` returns, with the kill
switch set, and require `event=killed` on stderr. A silent exit 0 fails it. J3.14 AC4 and J3.15 AC4
are that assertion, at two layers.

### 4. One owner for the worktree, and it is the caller

The first draft gave the worktree two owners: `runJob` prepped from `job.worktree` and tore down in
its `finally`, while `nightly-sandcastle`'s `exec` prepped its own and committed from it. Both
branches were broken. With `job.worktree` set, `runJob`'s `finally` removed the tree **before** `exec`
parsed the verdict and landed; with it unset, `runJob` passed `cwd: deps.root` — the live checkout,
the exact failure ruling 5 exists to prevent — and `{{WORKTREE}}` threw as a missing key.

**Ruling: `RunJobDeps` carries a required `cwd`. `runJob` never prepares or removes a worktree.
`Job.worktree` is dropped at N3.** The caller that owns the pass owns the tree, because the pass's
whole life cycle — prep, run, verdict, gate, land or discard, teardown — is scoped to it, and
splitting that across two modules is what produced the bug.

`{{WORKTREE}}` stays in `runJob`: the caller supplies `WORKTREE` as a `promptArgs` entry and `runJob`
substitutes it, so HRN-12's placeholder is real and the substitution is still in one place.

**What this costs, stated:** HRN-12 says the **runner** realizes the worktree, *"so a review reads the
PR's own head wherever the agent runs"* — which is a statement about a **dispatched** run reaching a
node that has no tree yet. There is no dispatch until M9. N3 ships the realization machinery
(`kernel/runtime/worktree.ts`), the placeholder and the substitution; the runner-realizes-it half
arrives with the pool that gives it meaning (D9). Flagged in Gaps. `Job.worktree` returns then, as
the field a `TaskSpec` carries across the socket — which is what it was always for.

### 5. Nothing this suite runs can commit to `dev` — eight layers, each performable

1. **Ruling 2 from N2, unchanged.** Every impure value arrives as a **required** `deps` field, so
   TypeScript refuses a call that omits one, and the real values are assembled in one argv block.
   **One interface, quoted identically on both sides** — the first draft's `exec` deps and
   `RunJobDeps` disagreed, and `worktreeRoot` never arrived. J3.12 names `PassDeps` once and `exec`
   builds `RunJobDeps` from it.
2. `NIGHTLY_NO_SANDCASTLE=1` — the KRN-07 kill switch. Returns before anything is read.
3. `NIGHTLY_SANDCASTLE_MAX=0` — SAF-04's free smoke: rotation, worktree prep, gate wiring and report
   render, **zero agent runs**.
4. `NIGHTLY_SANDCASTLE_DRY_RUN=1` — SAF-01. No commit, no merge, no state write.
5. `NIGHTLY_SANDCASTLE_NO_MERGE=1` — SAF-02's shadow mode: commit in the worktree, never move the base.
6. `NIGHTLY_SANDCASTLE_ONLY=<goal-key>` — SAF-06's single-item mode: force one rotation entry.
7. **`not-on-base`** — refuses unless `HEAD` equals `NIGHTLY_SANDCASTLE_BASE` (a knob, not a literal).
8. **`tree-dirty`** — refuses on a non-empty `git status --porcelain`.

Backstop: every test reaching `exec()` points `deps.root` at a `mkdtempSync` git repo, and each job's
ACs re-check `git status --porcelain`, `git log --oneline -1`, `git branch --list 'nightly/*'` and
`git worktree list | wc -l` against the real checkout.

### 6. The agent has two escape routes out of the worktree, and both are closed by measurement

**Route one — `~/.gitconfig`.** `run()` unconditionally executes, inside the sandbox (which under
`noSandbox` is the host):

```
git config --global --add safe.directory "<repoDir>"
git config --global user.name  "<the host repo's user.name>"
git config --global user.email "<the host repo's user.email>"
```

Measured: `md5sum ~/.gitconfig` changed after one probe run. **The scale, re-measured after review, is
three orders of magnitude worse than the first draft said:** this host's `~/.gitconfig` is **4,529
lines carrying 4,523 `safe.directory` entries, 4,448 of them the same `/home/hyhilman/projects/xenith`
line**. Every `git` invocation on this machine parses that file. Three problems: **INS-02 has no third
category** for a machine-global write · it is **HRN-18's `~/.gitconfig` race with its cause finally
named** · and it grows one line per run, forever.

**Closed by one env var, measured:** `noSandbox({ env: { GIT_CONFIG_GLOBAL: <project path> } })` leaves
`~/.gitconfig` byte-identical and puts the three entries in a project-relative file. Three further
measurements shape the design:

- **The agent child inherits it.** A fake `claude` that prints `$GIT_CONFIG_GLOBAL` sees the
  redirected path, and `git config --global --get-all safe.directory` inside the agent reads the
  redirected file. That is not a side effect to tolerate — **it is what makes the agent's own commits
  inside the worktree work at all**, because the agent needs `safe.directory` for a tree it did not
  create. (Added by the GAP step; reproduced here.)
- **The parent directory must exist.** With the target under a missing directory, `run()` **rejects**:
  `Command failed (exit 255): git config --global --add safe.directory …` / `could not lock config
  file …: No such file or directory`. `projectPath(".doppelganger/gitconfig")` does not exist on a
  fresh clone, so `sandcastleRunner` must `mkdirSync(dirname(...), { recursive: true })` — a real
  `node:fs` write, and therefore a real door-3 row.
- **The key goes on exactly one provider.** Setting it on both throws `Overlapping env keys between
  agent provider and sandbox provider: GIT_CONFIG_GLOBAL`.

**Route two — `origin`, over SSH, invisible to the escape check.** `origin` is
`git@github.com:hyhilman/doppelganger.git`. `GIT_CONFIG_GLOBAL` strips a credential helper but not
`~/.ssh`, and a `git push` leaves the working tree **clean**, so step 11's
`git status --porcelain` comparison cannot see it. Measured, with a fake `claude` running
`git ls-remote origin` inside the run:

```
without GIT_SSH_COMMAND   → REMOTE_REACHABLE=yes
with GIT_SSH_COMMAND=/bin/false → REMOTE_REACHABLE=no
```

**Closed by one more env var plus a detector.** `sandcastleRunner` sets `GIT_SSH_COMMAND: "/bin/false"`
in the same `noSandbox({ env })` — the plumbing already exists — and `exec` captures
`git rev-parse origin/<base>` before and after, logging `write-scope-escaped reason=remote-moved` on
movement. A gate and a detector, because the gate is one env var away from being deleted.

---

## Job order

Renumbered from revision 1 so every dependency runs forward. Two ordering notes the GAP step raised
are gone, not annotated: J3.10 (the model gate) now lands **after** the registry that gives it call
sites to count, and J3.16 (TST-09) lands **after** the schedule entry that gives it entries to check.

1. **J3.1** — `roadmap.md` §1: name every file N3 builds, with a milestone tag. Must land first:
   §1's `ports/` line tags `job.ts schedule.ts runner.ts` as bare `v0`, which `classifyRow` reads as
   *must-be-absent*, so J3.2 would turn the suite red without it. Doc only.
2. **J3.2** — `kernel/ports/job.ts` + `kernel/ports/runner.ts`: the shapes, `DEFAULTS`, the seam.
3. **J3.3** — the dependency and the adapter; the `WRITE_MEMBERS` symlink hole; ruling 6's two env vars.
4. **J3.4** — `kernel/runtime/payload.ts`: HRN-10.
5. **J3.5** — `kernel/runtime/worktree.ts`: HRN-12's machinery.
6. **J3.6** — `kernel/runtime/runjob.ts`: one entry point, one worktree owner (the caller).
7. **J3.7** — `cli/skills.ts`: `render`, ownership, the six findings, and layer 0.
8. **J3.8** — JOB-C15's pure decisions + `host/jobs/index.ts`, the hand-registered list.
9. **J3.9** — `skills render|sync|check`, the prune, the argv block. Needs J3.8's registry.
10. **J3.10** — TST-08 / HRN-11. Needs J3.8's call sites and J3.6's `runJob`.
11. **J3.11** — JOB-C15's ship gate.
12. **J3.12** — JOB-C15's pass, the landing, the safe-run surface.
13. **J3.13** — SKL-06 both ways, TST-23 live, TST-24, the vocabulary drift gate.
14. **J3.14** — `host/run.ts`, and ruling 3's `jobRunner`/`commandOf` fix.
15. **J3.15** — the first `SCHEDULE` entry and `PROGRAMS` row.
16. **J3.16** — TST-09: one name, four consumers. Needs J3.15's entry.
17. **J3.17** — the manual step: one real pass, its stdout the TST-19 fixture.
18. **J3.18** — close N3.

---

## J3.1 — `roadmap.md` §1: the N3 module map  ·  §1, PRT-08, SKL-04, JOB-C15

**Goal:** make §1 name every file N3 builds, one per line with a milestone tag, so
`test/layout.test.ts` assertion 12 blesses each one as it lands and refuses anything N3 does not
declare.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§1 only)

**Do:**

`parseBlock` in `test/layout.test.ts` is strict and this job must obey it: an **indent-2** line is
either a bare `<name>/` directory line (matching `^([a-z]+)/$`, nothing after it) or a
`<file>.ts <prose> <tags>` row; an **indent-4** line is `<file.ts> [<file.ts> …] <prose> <tags>`
prefixed by the current directory; tags are any of `N1 N2 N3 N4 N5 v0 v1` found anywhere on the line.

**That last rule is a trap: never write a phase token inside the prose.** "re-homes at N5" adds an
`N5` tag. Write "re-homed later".

`kernel/` — replace the `ports/` block, add three `runtime/` files:

```
  ports/
    job.ts                Job, defineJob, DEFAULTS — the shape a job declares    v0 · N3
    runner.ts             RunRequest / RunResult / Runner — the M11 seam         v0 · N3
    schedule.ts           ScheduleEntry, re-homed from host/ (PRT-06)            v0 · N5
    source.ts  route.ts  relay.ts  lane.ts    v1 — NOT designed until a plugin needs one
  runtime/
    db.ts  pool.ts  exec.ts                   v0 · N1
    payload.ts  worktree.ts  runjob.ts        v0 · N3
    log/   emit.ts  log.sh  parse.ts  route.ts  cause.ts  tail.ts  index.ts   v0 · N1
    gate.ts                                   v0 · N2
    lease.ts                                  v0 · N4
    queue.ts  quota.ts  shed.ts               v1
```

`host/` — three rows, and `jobs/` restructured into a **bare** directory line (today's
`  jobs/   one file per job … N3` matches neither `dirOnly` nor the `.ts` row pattern, so it sets no
prefix and an indent-4 child would be recorded as `host/nightly-sandcastle.ts`):

```
  runner.ts               the @ai-hero/sandcastle adapter (D2)                 N3
  run.ts                  the ONE argv block — npm run job <name>, and what
                          jobRunner spawns                                     N3
  jobs/
    index.ts              the hand-registered job list (SKL-05)                N3
    nightly-sandcastle.ts one small verified improvement, gated (JOB-C15)      N3
```

`cli/` — `skills.ts … N3` is already there; leave it.

Add three sentences under the block: `kernel/ports/job.ts` and `kernel/ports/runner.ts` are declared
at N3 and re-homed under PRT-05/PRT-08's rows later, on the `EnvSpec` precedent (J1.2) ·
`host/runner.ts` is the **only** file that imports an agent-runner package, which is what makes M11 a
file swap · and **`host/run.ts` is the only argv block a scheduled job reaches**, which is ruling 3's
statement in the spec rather than only in a plan.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0, `# tests 375 / # pass 373 / # fail 0 / # skipped 2` unchanged. Every
      new row is tagged `N3`, which `classifyRow` reads as **exempt** while N3 is CURRENT.
- [ ] AC2 — **the parser really sees the new rows.** Create an empty `kernel/ports/runner.ts`;
      `node --test test/layout.test.ts` stays green (exempt). Retag that §1 row `N2` and re-run: it
      exits non-zero with `§1 names kernel/ports/runner.ts as v0,N2, but …`. Revert both.
- [ ] AC3 — **no stray tag in prose.** For each new row,
      `grep -n "ports/job.ts\|ports/runner.ts\|payload.ts\|worktree.ts\|runjob.ts\|host/runner.ts\|host/run.ts\|jobs/index.ts" roadmap.md`
      and read each line's tail; none may contain a second phase token.
- [ ] AC4 — `git status --porcelain` shows exactly one modified file, `roadmap.md`.

**Commit:** `roadmap §1: name the files N3 builds, and the one argv block a job reaches (§1, PRT-08, SKL-04, JOB-C15)`

**Depends on:** nothing.

**Risks / what could be wrong:**
- **`run.ts`'s row wraps onto a continuation line.** `parseBlock` reads one line at a time, so the
  continuation must not begin with a `.ts` token and must carry no phase tag — the tag stays on the
  first physical line. Checked against the parser's `while (/\.(?:ts|sh)$/.test(tokens[i]))` loop.
- **`runjob.ts` versus putting `runJob` in `ports/runner.ts`.** The driver lives in `runtime/`
  because it imports `worktree.ts` and `exec.ts`, and a port importing runtime inverts the layer it
  defines. If the GAP step prefers the port, it is one `git mv` and a §1 row.

---

## J3.2 — `kernel/ports/job.ts` and `kernel/ports/runner.ts`: the shapes, the defaults, the seam  ·  HRN-01, HRN-02, HRN-07, HRN-13, HRN-15, SKL-01, PRT-08

**Goal:** one place that says what a job IS, one place that says what a run RETURNS, and a `Runner`
type narrow enough that M11 can replace its only implementation with every job file unchanged.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/ports/job.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/ports/job.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/ports/runner.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/ports/runner.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/test/knobs.test.ts` (`ROWS` + two rows — assertion 2 is an exact set comparison, so a new `EnvSpec` anywhere must be listed in the same commit)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27: the two run-timeout knobs)

**The shapes:**

```ts
// kernel/ports/job.ts
export const PERMISSION_MODES = ["auto", "bypassPermissions"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const DEFAULTS = {
  model: "claude-opus-5",
  effort: "high",
  permissionMode: "bypassPermissions",
} as const;

export interface Job {
  readonly name: string;                    // SUP-20 prefix; SKL-01: it IS the skill name
  readonly description: string;
  readonly plugin: string;                  // owns the skill file: plugins/<plugin>/skills/<name>/
  readonly skill?: string;                  // defaults to `name`. Absent ⇒ `exec` must be set
  readonly exec?: (deps: never) => Promise<void>;
  readonly model?: string;
  readonly effort?: Effort;
  readonly permissionMode: PermissionMode;  // REQUIRED — see below
  readonly maxIterations?: number;
  readonly completionSignal?: string;
  readonly promptArgs?: Readonly<Record<string, string>>;
  readonly taskClass?: "impl";
  readonly local?: boolean;
}
export const defineJob = (job: Job): Job => job;
export const skillOf = (job: Job): string => job.skill ?? job.name;
export const OPUS_GUIDANCE: string = [...].join("\n");
```

```ts
// kernel/ports/runner.ts
export interface RunRequest {
  readonly name: string; readonly prompt: string;   // FULLY substituted; no {{KEY}} survives
  readonly cwd: string;                              // the CALLER owns it (ruling 4)
  readonly model: string; readonly effort: Effort; readonly permissionMode: PermissionMode;
  readonly maxIterations: number; readonly completionSignal: string;
  readonly logPath: string; readonly deadlineMs: number;
  readonly env: Readonly<Record<string, string>>;
}
export interface RunResult {
  readonly stdout: string; readonly completionSignal: string | null;
  readonly iterations: number; readonly commits: readonly string[];
  readonly branch: string; readonly logPath: string | null;
}
export type Runner = (req: RunRequest) => Promise<RunResult>;
export function runTimeoutMs(job: Pick<Job, "taskClass">): number;
```

**Seven decisions, each with its reason in the file:**

- **`RunResult` is ours, six fields, all required.** Sandcastle's has eleven, two of them functions
  that exist only when the provider supports session capture. `completionSignal` is `string | null`,
  never `undefined` — an absent optional and a signal that did not fire read identically at a call
  site, and the second is a warning.
- **`RunRequest` carries a fully-substituted `prompt`, no `promptArgs`, and a required `cwd`**
  (rulings 1 and 4).
- **`permissionMode` is REQUIRED on `Job`, and `DEFAULTS.permissionMode` is `"bypassPermissions"` —
  the value the one real job uses.** This replaces the first draft's optional field defaulting to
  `"auto"`, which the GAP step correctly called a default that guards nothing: nothing at N3 used
  `auto`, and the claim "`auto` does not hang" is unmeasurable without a real run that reaches a tool
  prompt. Required-plus-real is strictly better than optional-plus-aspirational, for three reasons:
  HRN-07 becomes a **compile error** rather than a runtime hope · the default is exercised on every
  run instead of never · and nothing is silently inherited, so J3.10's "a bypass run declares
  `local: true`" scan is reachable for every write-capable job (a silently-inherited bypass would be
  invisible to a source scan). HRN-01 still holds — `DEFAULTS` is one place and the call site spells
  `DEFAULTS.permissionMode`, exactly as HRN-11 says inheriting a model is spelled `DEFAULTS.model`.
  **Making an optional field required is a deviation from PRT-05's shape and is flagged in Gaps.**
- **`PERMISSION_MODES` is a two-member allowlist this repo owns**, not sandcastle's six-member union
  and not the CLI's advertised list — measured, all three disagree (ruling 1). A dated comment
  records the divergence and `CLI_MODES_RECHECK=1` re-probes it, printing and asserting nothing.
- **`DEFAULTS.model` is a literal in this file and nowhere else.** J3.10's gate depends on it.
- **`taskClass` gets a real N3 consumer** — `runTimeoutMs(job)`, feeding the run's abort deadline.
  Both ceilings are `EnvSpec` rows, because every tunable here is a knob whose one-line `why` IS its
  doc (KRN-06):

  | key | default | why |
  |---|---|---|
  | `RUN_TIMEOUT_MS` | `1500000` (25 min) | wall-clock bound on ONE agent run (the run is aborted, not the supervisor's child — that is SUP-13). **Unread at N3: the only job is `taskClass: "impl"`.** The branch exists so HRN-13 has two sides to select between |
  | `RUN_TIMEOUT_IMPL_MS` | `2400000` (40 min) | the ceiling for a `taskClass: "impl"` run — a build-and-verify pass, not a read (HRN-13). Sized against `maxRunMin` in J3.15's budget assertion, not chosen freely |

- **`exec`'s parameter type is `never`.** A `Job` in the registry must not be callable by anyone who
  does not know the job's own deps shape; the job file re-declares `exec` with its real type. `host/run.ts`
  casts once, in one place.

**Do (tests):**

1. `defineJob` is identity (`strictEqual`).
2. `skillOf` returns `name` when `skill` is absent and `skill` when present.
3. **`DEFAULTS.model` is the file's only model literal — across every quote spelling.** The GAP step
   found the first draft's scan counted only double-quoted `claude-…`; a single-quoted or backticked
   literal evaded it. The scan is `/(["'\`])claude-[^"'\`]*\1/g`, and the test's own comment names
   the standing rule ("a gate that matches one spelling is not a gate") and states what it still
   cannot see: a model id built by concatenation.
4. `DEFAULTS.permissionMode` is a member of `PERMISSION_MODES`, and `PERMISSION_MODES` excludes
   `"plan"`, `"acceptEdits"` and `"default"` — the modes that are supervised-only or that this repo
   has decided not to use. The test names HRN-07.
5. `OPUS_GUIDANCE` is non-empty, contains no `{{`, and names none of `plugins/`, `.claude/`,
   `SKILL.md` (HRN-16's "never a path into a skill's files").
6. `runTimeoutMs({}) < runTimeoutMs({ taskClass: "impl" })`, both finite and > 0.
7. **Type-level:** a `Runner` returning a `RunResult` with a missing field does not compile, written
   as an `@ts-expect-error` block that DOES compile, plus a runtime `assert.ok` naming what it proves.
8. **`Job.permissionMode` is required** — an `@ts-expect-error` on a `defineJob({…})` literal that
   omits it. This is HRN-07 as a compile error, and it is the assertion that makes it one.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/ports/job.test.ts kernel/ports/runner.test.ts`
      reports 8 passing.
- [ ] AC2 — **the one-model-literal gate fires, in every quote spelling.** Three mutations, each
      adding an **exported** const (so `noUnusedLocals` cannot short-circuit at `pretest`):
      `export const a = "claude-opus-5";`, then `export const b = 'claude-opus-5';`, then
      ``export const c = `claude-opus-5`;``. `npm test` exits non-zero on test 3 all three times.
      Revert each. Recording all three is the point — one spelling is not a gate.
- [ ] AC3 — **the permission-mode allowlist fires.** Change `DEFAULTS.permissionMode` to `"plan"`.
      `npm test` exits non-zero on test 4 **and** fails to typecheck at `pretest` (it is not in the
      union). Record both, because the type is the real guard and the test is the readable one.
      Revert.
- [ ] AC4 — **`permissionMode` really is required.** Delete the `@ts-expect-error` on test 8's
      literal. `npm run typecheck` exits non-zero — the expectation was satisfied and is now unused.
      Revert. Then make the field optional in `Job` and confirm `npm run typecheck` exits non-zero
      for the opposite reason (`@ts-expect-error` unused). Revert.
- [ ] AC5 — **the HRN-16 gate fires.** Append
      `"  - The skill lives at plugins/nightly/skills/nightly-sandcastle/SKILL.md."` to
      `OPUS_GUIDANCE`. `npm test` exits non-zero on test 5. Revert.
- [ ] AC6 — **`kernel/` is still dependency-free.** `node --test test/deps.test.ts` reports 5 passing;
      assertion 3 finds no bare specifier under `kernel/`.
- [ ] AC7 — `node --test test/knobs.test.ts` reports 7 passing with `RUN_TIMEOUT_MS` and
      `RUN_TIMEOUT_IMPL_MS` in `ROWS`; remove one and confirm assertion 2 exits non-zero, then
      restore. `sed -n '/^### 2\.27/,/^### 2\.28/p' roadmap.md | grep -c 'RUN_TIMEOUT_IMPL_MS'`
      prints `1`.
- [ ] AC8 — `node --test test/layout.test.ts` passes: both files are named in §1 by J3.1.
- [ ] AC9 — `git status --porcelain` is empty after `npm test`.

**Commit:** `ports: Job with a required permissionMode, DEFAULTS, and the one RunResult contract (HRN-01, HRN-02, HRN-07, HRN-13, HRN-15, SKL-01, PRT-08)`

**Depends on:** J3.1.

**Risks / what could be wrong:**
- **A required `permissionMode` is a deviation from PRT-05's optional-field shape**, taken because
  HRN-07 is the one field whose omission is a 3am hang rather than a wrong default. Flagged in Gaps.
- **`DEFAULTS.permissionMode = "bypassPermissions"` is a permissive default.** It is mitigated by the
  field being required — no job gets it by silence — and by J3.10's companion scan. If the GAP step
  prefers a safe default, the alternative is dropping `permissionMode` from `DEFAULTS` entirely,
  which contradicts HRN-01's own list of three.
- **`exec: (deps: never) => Promise<void>` may be too clever.** The alternative is `exec?: unknown`
  plus a cast at the one call site — the same unsafety with less type information.

---

## J3.3 — `@ai-hero/sandcastle` arrives; `host/runner.ts` is its only importer  ·  HRN-07, HRN-11 (command half), D2, TST-25 (narrow), INS-02

**Goal:** one file that turns a `RunRequest` into a real agent run, ruling 6's two env vars, and five
gates that keep the package from spreading and the agent from leaving the worktree.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/package.json` (`dependencies`)
- `/home/hyhilman/projects/me/doppelganger/package-lock.json`
- `/home/hyhilman/projects/me/doppelganger/host/runner.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/host/runner.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/test/deps.test.ts` (the importer register)
- `/home/hyhilman/projects/me/doppelganger/test/writes.test.ts` (`WRITE_MEMBERS` + `REGISTER`)
- `/home/hyhilman/projects/me/doppelganger/.gitignore` (`.sandcastle/`)

### The `WRITE_MEMBERS` hole, fixed before anything signs the register

The GAP step found two related defects in the first draft's register handling, and both are fixed
here, in this order, because the order is what makes the later rows honest:

1. **`symlinkSync`/`symlink` are absent from `WRITE_MEMBERS`.** A genuine one-spelling hole in a
   landed N1 gate — LOOP.md's standing rule, sixth occurrence. J3.12 needs `symlinkSync` (the
   worktree's `node_modules`), so without this fix that write would be invisible to door 3.
2. **Door 3 is an exact `deepEqual` between the scan and the register, so the first draft's
   ACs were inverted.** `host/runner.ts` naming no `WRITE_MEMBERS` member meant **adding** the row
   turned the suite red, not removing it. The fix that makes the row legitimate is ruling 6's
   `mkdirSync(dirname(gitConfigGlobal), { recursive: true })` — a real write the scan really finds.

So this commit: adds `symlinkSync` and `symlink` to `WRITE_MEMBERS` (no new signer yet — J3.12's is
the first), adds `mkdirSync` to `host/runner.ts`, and signs `host/runner.ts` in `REGISTER` as
`project-relative`. The AC mutations are stated in the correct direction.

**Do (`host/runner.ts`):**

```ts
export interface RunnerDeps {
  readonly gitConfigGlobal: string;   // ruling 6 — required, no default
  readonly gitSshCommand: string;     // ruling 6 — required, no default; "/bin/false" in the argv block
}
export function buildAgent(req: RunRequest): AgentProvider;   // exported for layer A
export function sandcastleRunner(deps: RunnerDeps): Runner;
```

- `buildAgent(req)` = `claudeCode(req.model, { effort: req.effort, permissionMode: req.permissionMode })`.
  **Exported**, because it is the pure half layer A tests, and a test that rebuilt the provider
  itself would test its own copy of the configuration (N2 F3: code being right is not being gated).
- `sandcastleRunner(deps)` returns a `Runner` that first
  `mkdirSync(dirname(deps.gitConfigGlobal), { recursive: true })` (measured: `run()` rejects without
  it), then calls `run({ agent: buildAgent(req), sandbox: noSandbox({ env: { GIT_CONFIG_GLOBAL: deps.gitConfigGlobal, GIT_SSH_COMMAND: deps.gitSshCommand, ...req.env } }), cwd: req.cwd, name: req.name, prompt: req.prompt, maxIterations: req.maxIterations, completionSignal: req.completionSignal, branchStrategy: { type: "head" }, logging: { type: "file", path: req.logPath }, signal: AbortSignal.timeout(req.deadlineMs) })`
  and maps the result onto our six fields.
- **`promptArgs` and `promptFile` are never passed** — one comment naming ruling 1 and `clack.text`.
- **`req.env` merges into `noSandbox`, never into `claudeCode`** — measured, the same key on both
  throws.
- **Both env values are required `deps` fields with no default** — the N2 F1 lesson: a default that
  is a real path is a real file someone forgets to redirect, and a default of `""` for
  `GIT_SSH_COMMAND` is a silently open remote.
- Errors are not caught; `run()` rejects with an `instanceof Error` and the caller decides.

**Do (`test/deps.test.ts`, generalised):** replace the hardcoded `["croner"]` with an importer
register, the shape `test/writes.test.ts` already uses:

```ts
const IMPORTERS: Record<string, { importer: string; why: string }> = {
  croner: { importer: "host/cron.ts", why: "the only cron seam (SUP-07, J2.8)" },
  "@ai-hero/sandcastle": { importer: "host/runner.ts", why: "the only agent-runner seam; M11 replaces this file (D2, D3)" },
};
```

Test 1: for every declared root dependency, the files naming it across **all four spellings** equal
exactly `[IMPORTERS[dep].importer]`, and the register's key set equals `Object.keys(pkg.dependencies)`.
Test 2's expected set becomes `Object.keys(IMPORTERS)`, derived. Test 4 gains a second clause: the
installed `@ai-hero/sandcastle/package.json`'s `dependencies` keys equal `["@clack/prompts"]`, its
`peerDependenciesMeta` marks both peers optional, and **its transitive floor (`>= 20.12.0`) is at or
below this repo's `engines.node`** — three claims about a version the lockfile pins, so none can rot
without a lockfile commit. Test 5 covers both dependencies.

**Do (`host/runner.test.ts`):**

1. **HRN-07, layer A.** `buildAgent({…, permissionMode: "bypassPermissions"}).buildPrintCommand({ prompt: "P", dangerouslySkipPermissions: false }).command`
   contains `"bypassPermissions"`. Negative control: a provider built by calling `claudeCode(model, { effort })`
   directly produces a command containing no permission-mode value. The pair is what makes the first
   assertion mean something, and both assert **our value appearing**, never sandcastle's flag
   spelling — a value outside this repo.
2. **HRN-11, layer A.** The same command contains `req.model`; a command built for a different model
   does not.
3. **`promptArgs`/`promptFile` never reach `run()`** — a text assertion over `host/runner.ts` with
   its honest limit stated (the real enforcement is that `RunRequest` has no such field).
4. **The two env keys go on exactly one provider.** Build both option objects the way
   `sandcastleRunner` does; assert their key sets are disjoint. Measured failure mode, asserted.
5. **Layer B — the real `run()` against a fake `claude`.** A **child process** (`test/knobs.test.ts`'s
   `scrubbedChild` shape) with `env: { PATH: <fakeBin>:<PATH>, HOME: <tmpHome> }` and a `mkdtempSync`
   git repo (`git init -b main`, `git -c user.email=… -c user.name=… commit`). The fake `claude`
   reads stdin and echoes a `<<<SANDCASTLE` block plus `<promise>COMPLETE</promise>`. Assert, as JSON
   on the child's stdout: `completionSignal` matched, `iterations === 1`, `stdout` contains
   `<<<SANDCASTLE`, `branch === "main"`, `logPath` is the path we passed. **The child's own `HOME` is
   a temp directory**, so AC6's mutation cannot reach the developer's real `~/.gitconfig` — the
   J2.16 layer-0 lesson applied to a new destructive surface.
6. **Ruling 6, route one.** Same child: `<tmpHome>/.gitconfig` **does not exist** afterwards, and the
   file named by `GIT_CONFIG_GLOBAL` contains `safe.directory`.
7. **Ruling 6, the missing parent.** `GIT_CONFIG_GLOBAL` under a directory that does not exist: with
   `mkdirSync` in place the run succeeds; the AC mutation removes it and the run rejects with
   `could not lock config file`. **This is the fresh-clone case, and it is why the redirect is not
   free.**
8. **Ruling 6, the agent inherits it.** The fake `claude` prints `$GIT_CONFIG_GLOBAL` and
   `git config --global --get-all safe.directory | wc -l`; assert the child sees the redirected path
   and a non-zero count. Not a curiosity — it is what lets the agent commit inside a worktree it did
   not create.
9. **Ruling 6, route two.** The fake `claude` runs `git ls-remote origin` against an SSH remote and
   prints `REMOTE_REACHABLE=yes|no`; assert `no`. Measured both ways before writing this test.
10. **A non-zero agent is an Error with a readable message** — exits 3 printing `boom`; the rejection
    is `instanceof Error` and its message contains `code 3` and `boom`.
11. **No completion signal is not a failure** — `completionSignal === null`, `stdout` carries the bytes.
12. **`.sandcastle/` is not created** — `readdirSync(repo)` contains no `.sandcastle`, the measured
    consequence of `logging.path` + `branchStrategy: "head"`, pinned so an edit dropping either is
    caught.

**Acceptance criteria:**

- [ ] AC1 — `npm ci` exits 0 from a clean `node_modules`; `npm ls --all` exits 0 and reports the two
      peers as `UNMET OPTIONAL DEPENDENCY`. Record the `added N packages` line in the commit body.
- [ ] AC2 — `npm test` exits 0; `node --test host/runner.test.ts` reports 12 passing;
      `test/deps.test.ts` reports 5.
- [ ] AC3 — **HRN-07's gate fires.** Delete `permissionMode: req.permissionMode` from `buildAgent`.
      `npm test` exits non-zero on test 1. Revert.
- [ ] AC4 — **the importer register fires, across every spelling.** Add, at the bottom of
      `host/cron.ts`, each of: `const p = await import("@ai-hero/sandcastle"); export const n1 = Object.keys(p).length;`
      · `import "@ai-hero/sandcastle";` · `import sc from "@ai-hero/sandcastle"; export const n2 = Object.keys(sc).length;`
      · `import * as ns from "@ai-hero/sandcastle"; export const n3 = Object.keys(ns).length;`. Every
      binding is consumed, so none is TS6133. `npm test` exits non-zero on `test/deps.test.ts` test 1
      naming `host/cron.ts` all four times. Revert each.
- [ ] AC5 — **`WRITE_MEMBERS` really grew.** Before the fix, `grep -c symlink test/writes.test.ts`
      prints `0`; after, ≥ 2. Then add `import { symlinkSync } from "node:fs";` plus a consuming
      export to `host/cron.ts` and confirm `npm test` exits non-zero on door 3 naming it. Revert.
      **This is the mutation that proves the hole was real**, and it must be performed before J3.12
      relies on it.
- [ ] AC6 — **ruling 6 route one fires, safely.** Delete `GIT_CONFIG_GLOBAL` from the `noSandbox(...)`
      env. `npm test` exits non-zero on test 6 — `<tmpHome>/.gitconfig` now exists. Revert. Confirm
      the mutation is safe by construction first: `grep -n "HOME:" host/runner.test.ts` must show a
      `mkdtempSync` path. Record `md5sum ~/.gitconfig` and `wc -l ~/.gitconfig` before and after the
      whole job — **both must be unchanged**, against a file that is 4,529 lines long.
- [ ] AC7 — **the `mkdirSync` fires.** Delete it. `npm test` exits non-zero on test 7 with
      `could not lock config file`. Revert. Record the message — it is the fresh-clone failure.
- [ ] AC8 — **ruling 6 route two fires.** Delete `GIT_SSH_COMMAND` from the env. `npm test` exits
      non-zero on test 9 (`REMOTE_REACHABLE=yes`). Revert. **Record it**: this is a mutation that
      re-opens a push path from an unattended agent.
- [ ] AC9 — **layer B really runs the library.** Rename the fake `claude` so it is not on `PATH`;
      `node --test host/runner.test.ts` exits non-zero with a spawn failure rather than passing.
      Restore.
- [ ] AC10 — `node --test test/writes.test.ts` reports 6 passing with `host/runner.ts` in `REGISTER`
      as `project-relative`, reason naming ruling 6. **Remove the row** and confirm door 3 exits
      non-zero saying the scan found a file the register does not name (the correct direction — the
      first draft had this inverted). Restore.
- [ ] AC11 — `git status --porcelain` empty after `npm test`;
      `test -e .sandcastle && echo LEAK || echo clean` prints `clean`.
- [ ] AC12 — `time npm test` stays under 30 s wall (baseline 11.5 s; this job adds twelve tests, five
      of them child processes at ~100 ms of library time plus Node start-up).

**Commit:** `runner: the sandcastle adapter, its dependency, and the two env vars that keep an agent in its worktree (HRN-07, D2, TST-25, INS-02)`

**Depends on:** J3.2.

**Risks / what could be wrong:**
- **`GIT_SSH_COMMAND=/bin/false` also blocks a legitimate fetch.** `nightly-sandcastle` never fetches
  — its base is local and there is no rebase-onto-origin. A future job that must fetch supplies its
  own value through `req.env`, which merges into the same object; the required-dep shape means it is
  a deliberate act. Stated in the field's doc comment.
- **`git` is not in `EXTERNAL_COMMANDS`**, so door 5 does not see this job's git writes; door 3's
  `REGISTER` covers `host/runner.ts` only because of `mkdirSync`. Flagged in Gaps — the exemption's
  stated reason ("read-mostly wrappers whose write paths are JOB-G's at N5") stops being true at N3.

---

## J3.4 — `kernel/runtime/payload.ts`: the sentinel, last block wins  ·  HRN-10

**Goal:** one parser for the `<<<TAG … TAG>>>` shape, so no job re-implements extraction and a
malformed payload writes nothing.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/payload.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/payload.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/plan/N3-uac.md` — **not a file; see the exceptions table below**

**Do:**

```ts
export function extractBlock(stdout: string, tag: string): string | null;
export function extractFields(block: string): Record<string, string>;
```

- `extractBlock` — **last match wins**, `\r\n` normalised, trimmed, `null` when no closed block.
  HRN-10's own words: agents echo the template first, so the first block is the instruction.
- `extractFields` takes the **block**, not the stdout — a deliberate split from the reference (whose
  `extractFields` scans stdout for a one-line `TAG k=v`), because our skill emits a multi-line block.
  The two compose: `extractFields(extractBlock(out, "SANDCASTLE") ?? "")`. Split at the **first** `=`,
  so `verified=npm test / 375 pass` survives. Unknown keys carried through, never an error.
- Neither function knows any vocabulary. The vocabulary is the job's (SKL-07).

**Do (tests):**

1. Two blocks → the **second** wins.
2. Unclosed block → `null`.
3. No block → `null`, distinct from an empty block (`""`).
4. `\r\n` normalised; no `\r` survives.
5. A tag that is a prefix of another (`<<<SAND` inside `<<<SANDCASTLE`) does not cross-match.
6. `extractFields` over a real six-line block → six keys; `verified` keeps its `/` and spaces.
7. A line with no `=` is skipped; `=value` (empty key) is skipped; the others survive.
8. A block indented two spaces inside a fenced sample still parses — the reference learned this the
   hard way (a model ending its report inside a list emits the same line two columns over, and
   anchoring at column 0 read that as NO PAYLOAD, the one verdict every caller treats as "the work
   did not happen").
9. **Complexity, an upper bound with an exceptions-table row.** A 1 MB stdout with the block at the
   end parses in `< 500` ms. Direction: **upper**. Measured on this machine: **≈4 ms**. Headroom:
   two orders of magnitude, so it guards "the regex went quadratic", not "the machine was busy" —
   the J1.6 assertion-8 shape. **The row belongs in this file's own header comment**, naming the
   direction, the measured value and the headroom, because N1's exceptions rule requires every
   non-lower bound to carry one and the first draft omitted it.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/payload.test.ts` reports 9 passing.
- [ ] AC2 — **last-wins fires.** Change `all.at(-1)` to `all[0]`. `npm test` exits non-zero on test 1.
      Revert.
- [ ] AC3 — **the prefix-tag gate fires.** Build the closing pattern from a bare `\\w+` instead of the
      escaped `tag`. `npm test` exits non-zero on test 5. Revert.
- [ ] AC4 — **the first-`=` split fires.** Change `indexOf("=")` to a two-part `split("=")`.
      `npm test` exits non-zero on test 6 — `verified` truncated. Revert.
- [ ] AC5 — **the complexity bound is measured, not guessed.** Run test 9 five times and record the
      five durations in the commit body; the header comment's stated measurement must match.
- [ ] AC6 — `node --test test/layout.test.ts` and `node --test test/writes.test.ts` pass: the file is
      named in §1 and names no `node:fs` member.

**Commit:** `payload: extractBlock / extractFields — last block wins (HRN-10)`

**Depends on:** J3.1.

**Risks / what could be wrong:**
- **Splitting `extractFields` from the stdout scan deviates from the reference.** The reference needs
  the one-line form for its Slack/Jira readers; this repo has one consumer and a multi-line block.
  If a v1 plugin needs the one-line form it is a second exported function, not a change to this one.

---

## J3.5 — `kernel/runtime/worktree.ts`: HRN-12's machinery, and what a killed pass leaves behind  ·  HRN-12

**Goal:** a worktree this repo creates, names, hands to an agent and removes — including the one a
SIGKILLed pass leaves behind. **The caller owns it** (ruling 4); this file is the machinery.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/worktree.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/worktree.test.ts` (new)

**Do:**

```ts
export interface Worktree { readonly path: string; readonly branch: string; readonly base: string; readonly head: string; }
export function prepWorktree(repo: string, spec: { branch: string; base: string }, path: string): Worktree;
export function teardownWorktree(repo: string, path: string): void;
export function reapWorktrees(repo: string, under: string, keep: string): string[];
export function worktreePromptLines(wt: Worktree): string[];
```

- `prepWorktree` is **idempotent and re-entrant**: an existing registered worktree at `path` is
  hard-reset onto `base` (`reset --hard` + `clean -fd -e node_modules`) rather than refused;
  otherwise `git -C <repo> worktree add -B <branch> <path> <base>`. Idempotence is what makes the
  crash case survivable without a lock. **`-e node_modules`** is deliberate and is asserted: J3.12
  symlinks `node_modules` into the tree and a bare `clean -fd` would remove it, making tier 2 fail
  for a reason unrelated to the diff.
- **`branch` carries `INSTANCE`** (INS-06). Two checkouts are two repos, so branch names cannot
  collide — but `git worktree list` on a shared machine can, and an operator who cannot attribute a
  stale worktree cannot remove one. The caller supplies `nightly/<INSTANCE>`.
- **The crash case, in order:** `prepWorktree` resets rather than refuses, so the next pass reclaims
  it and the common case costs nothing · `reapWorktrees(repo, under, keep)` runs
  `git worktree list --porcelain`, removes every registered worktree under `under` that is not
  `keep`, and returns what it removed · `git worktree prune` runs first, clearing a
  deleted-directory-still-registered entry. Nothing on a timer, and `under` is always
  project-relative (INS-02).
- `teardownWorktree` = `git worktree remove --force <path>`, wrapped so a failure logs and does not
  throw — a stranded worktree is disk, not correctness.
- `worktreePromptLines(wt)` returns `{{WORKTREE}}`'s substitution: where to read, the base to diff
  against, the head SHA, and — the half the reference calls the important one — an explicit
  instruction **not** to fall back to the main checkout, which would silently answer every read.
- Every git call goes through `kernel/runtime/exec.ts`'s `git()` (HRN-19's wall clock).

**Do (tests):** each builds a real git repo under `mkdtempSync`.

1. `prepWorktree` creates and registers the directory, checks out the branch, `head` equals the base's SHA.
2. **Idempotent** — twice, and `git worktree list` still shows one.
3. **The crash case** — an uncommitted file inside is gone after a re-prep; `status --porcelain` empty.
4. **`node_modules` survives a re-prep** — symlink it in, re-prep, assert it is still there. The
   `-e node_modules` clause, asserted rather than remembered.
5. **Reset onto a moved base** — advance `main`, re-prep, `head` is the new SHA.
6. `teardownWorktree` removes and deregisters; twice does not throw.
7. **`reapWorktrees` removes a stranded sibling and keeps the live one**; the returned array names
   exactly the stranded one.
8. **`reapWorktrees` never touches a worktree outside `under`** — one in a sibling temp directory
   survives and is not returned.
9. **Prune-first** — `rm -rf` a registered worktree's directory, then reap; `git worktree list` no
   longer names it and nothing throws.
10. `worktreePromptLines` contains the path, the base ref and the short head SHA, and contains **no**
    path under `plugins/` or `.claude/` (HRN-16/SKL-08).

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/worktree.test.ts` reports 10 passing.
- [ ] AC2 — **the idempotence gate fires.** Remove the "already registered" branch. `npm test` exits
      non-zero on test 2 (git refuses an existing path). Revert.
- [ ] AC3 — **the crash-recovery gate fires.** Delete the `clean -fd` call. `npm test` exits non-zero
      on test 3. Revert. This is the difference between "the next pass starts clean" and "the next
      pass inherits last night's half-edit".
- [ ] AC4 — **the `node_modules` exclusion fires.** Drop `-e node_modules` from the clean.
      `npm test` exits non-zero on test 4. Revert.
- [ ] AC5 — **the reap scope gate fires.** Accept every registered worktree instead of filtering on
      `under`. `npm test` exits non-zero on test 8. Revert — a reaper that removes a worktree it did
      not create is worse than one that removes nothing.
- [ ] AC6 — **the prune gate fires.** Delete `git worktree prune`. `npm test` exits non-zero on test
      9. Revert.
- [ ] AC7 — `git status --porcelain` empty after `npm test`, and `git worktree list | wc -l` prints
      `1` — no test worktree was registered against the real repo.
- [ ] AC8 — `node --test test/writes.test.ts` passes: `worktree.ts` names no `node:fs` write member
      and no absolute path literal, so it signs neither register.

**Commit:** `worktree: prep, teardown, reap — and the tree a killed pass leaves behind (HRN-12)`

**Depends on:** J3.1.

**Risks / what could be wrong:**
- **`git worktree add -B` fails if a human is standing on `nightly/<INSTANCE>`.** Correct, but the
  message is git's. The job's `not-on-base` guard refuses before `prepWorktree` is reached.
- **`git worktree list --porcelain` is a format outside this repo.** The parser reads only
  `worktree <path>` lines and ignores the rest, so a new field cannot break it — asserted by test 7
  rather than by pinning the whole output.

---

## J3.6 — `kernel/runtime/runjob.ts`: one entry point, one worktree owner  ·  HRN-02, HRN-12, HRN-13, HRN-16, SKL-08

**Goal:** `runJob(job, deps)` — build the prompt from the skill NAME and the args, substitute every
placeholder, run, return one `RunResult`. **It does not create or destroy a worktree** (ruling 4).

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/runjob.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/runjob.test.ts` (new)

**The one interface, quoted here and nowhere else.** The first draft had `exec`'s deps and
`RunJobDeps` disagree — `logPath` and `worktreeRoot` never arrived, and ruling 5 listed five fields
where the test section listed six. `RunJobDeps` is now four fields, and J3.12's `PassDeps` **builds
one from its own**, so the two lists cannot drift:

```ts
export interface RunJobDeps {
  readonly runner: Runner;
  readonly cwd: string;        // where the agent runs. The CALLER owns this directory.
  readonly logPath: string;    // the run log, one file per run
  readonly env?: Readonly<Record<string, string>>;
}
export function buildPrompt(job: Job, args: Readonly<Record<string, string>>): string;              // pure
export function substitute(text: string, args: Readonly<Record<string, string>>): { out: string; missing: string[] };  // pure
export async function runJob(job: Job, deps: RunJobDeps): Promise<RunResult>;
```

**`buildPrompt` is the whole of HRN-16 and SKL-08, and it is pure:**

```
<OPUS_GUIDANCE>

/<skillOf(job)>

<key>=<value>            (one line per promptArgs entry, sorted, so two builds are byte-identical)
```

Nothing else. No path into a skill's directory, no environment read, no inline prompt text. The skill
is named; its payload stays in the markdown a human edits.

**`substitute` returns its `missing` keys rather than throwing**, and `runJob` throws once naming
every one — the `boot()` shape (KRN-08) one layer down. A prompt shipped with an unsubstituted
`{{WORKTREE}}` is a prompt telling an agent to read a literal brace.

**Order inside `runJob` — five steps, and no worktree among them:**

```
1. job.skill && job.exec both set, or neither      → throw (D10: there is no third shape)
2. args = { ...job.promptArgs };  prompt = buildPrompt(job, args)
3. { out, missing } = substitute(prompt, args);  missing.length → throw naming all
4. model = job.model ?? DEFAULTS.model;  assertPinned(model)          ← see below
5. return deps.runner({ name: job.name, prompt: out, cwd: deps.cwd, model, effort, permissionMode,
                        maxIterations: job.maxIterations ?? 20,
                        completionSignal: job.completionSignal ?? "<promise>COMPLETE</promise>",
                        logPath: deps.logPath, deadlineMs: runTimeoutMs(job), env: deps.env ?? {} })
```

**Step 4 is HRN-11's runtime half, and the GAP step is right that it is required.** J3.10's gate is a
**source-text** scan and cannot see an env-supplied model: `NIGHTLY_SANDCASTLE_MODEL=opus` in `.env`
produces exactly the floating alias the build gate bans, and no static analysis reaches it. So
`assertPinned(model)` runs at **the one place `RunRequest.model` is built**, throwing with the same
`PINNED`/`ALIASES` predicate J3.10 defines. Static gate for the source, runtime gate for the env,
one predicate exported from one module so the two can never disagree.

**`{{WORKTREE}}`** is substituted here, from an arg the caller supplies. The caller prepped the tree
and will tear it down; `runJob` only interpolates. That is ruling 4 in one sentence.

**Do (tests):** `deps.runner` is a recording fake; `deps.cwd` is a `mkdtempSync` directory.

1. **The prompt names the skill and nothing else.** Contains `/nightly-sandcastle` exactly once,
   contains `OPUS_GUIDANCE`'s first line, contains every arg key, and contains no `plugins/`, no
   `.claude/`, no `SKILL.md`, no `process.env`.
2. **Deterministic** — two calls with the same args are byte-identical.
3. **`{{WORKTREE}}` is substituted from the caller's arg.** With `promptArgs.WORKTREE` set to the
   lines `worktreePromptLines` returns, the request's prompt contains the path and contains no `{{`.
4. **Missing keys throw once, naming all of them** — `{{A}}` and `{{B}}` with neither supplied.
5. **`cwd` is what the caller passed, always.** `req.cwd === deps.cwd`, and there is **no** code path
   producing any other value — asserted by a text check that `runjob.ts` names neither `prepWorktree`
   nor `teardownWorktree`. Ruling 4 as a gate, not a promise.
6. **D10's two shapes** — both `skill` and `exec` throws; neither throws; the message names D10.
7. **HRN-13 reaches the request** — `deadlineMs` for `taskClass: "impl"` is strictly greater.
8. **Defaults flow** — a job naming no `model`/`effort` produces a request carrying `DEFAULTS`'
   values (HRN-01's one place).
9. **`assertPinned` fires on an env-supplied alias.** `runJob({ …, model: "opus" }, deps)` throws
   naming the value and the rule; `model: "claude-opus-latest"` throws; `model: "claude-opus-5"`
   does not. **The gate a source scan cannot reach**, and its title says so.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/runjob.test.ts` reports 9 passing.
- [ ] AC2 — **the one-owner gate fires.** Add `import { prepWorktree } from "./worktree.ts";` and a
      consuming call in `runJob`. `npm test` exits non-zero on test 5. Revert. This is the mutation
      that keeps the first draft's two-owner bug from coming back.
- [ ] AC3 — **the missing-key gate fires.** Make `substitute` leave unknown placeholders in place and
      return `missing: []`. `npm test` exits non-zero on test 4. Revert.
- [ ] AC4 — **the runtime model gate fires.** Delete `assertPinned(model)`. `npm test` exits non-zero
      on test 9. Revert. **Record it** — without this line, one `.env` entry defeats TST-08 entirely.
- [ ] AC5 — **the SKL-08 gate fires.** Add `` `The skill is at plugins/${job.plugin}/skills/…` `` to
      `buildPrompt`'s output. `npm test` exits non-zero on test 1. Revert.
- [ ] AC6 — `git status --porcelain` empty after `npm test`; `git worktree list | wc -l` prints `1`.

**Commit:** `runJob: skill by name, one worktree owner, and the runtime model gate (HRN-02, HRN-12, HRN-13, HRN-16, SKL-08)`

**Depends on:** J3.2, J3.4, J3.5.

**Risks / what could be wrong:**
- **`assertPinned` lives in `kernel/ports/job.ts` beside `PINNED`/`ALIASES`, and J3.10 imports it.**
  That means J3.6 writes the predicate and J3.10 writes the scan that uses it — a small forward
  reference. The alternative (predicate in the test file) puts the runtime gate and the build gate on
  two copies of one rule, which is the drift `TST` exists to refuse.
- **`maxIterations` defaults to 20, copied from the reference, unmeasured here.** It is a runaway
  bound, not a target — the run stops on the completion signal. J3.17 records the real count.

---

## J3.7 — `cli/skills.ts`: `render`, ownership, the six findings, and layer 0  ·  SKL-03, SKL-04, SKL-05, SKL-10, TST-23

**Goal:** the pure half of the skills tool — one `render` byte-identical to the file already on disk,
one ownership predicate decidable from the filesystem alone, a `check` that names what is wrong
rather than fixing it, and a layer 0 that makes the phase's only `rm -rf` safe by construction.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/cli/skills.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/cli/skills.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.30 SKL-10: the sixth finding)

**Do — `render`, lifted from `test/skills-example.test.ts`'s local helper, unchanged:**

```ts
export const MARKER_RE = /^<!-- managed:doppelganger-skills v=(\d+) src=(\S+) -->$/;
export const MARKER_VERSION = 1;
export function render(sourceText: string, srcDirPosix: string): string;
```

frontmatter block byte for byte · the two managed marker lines · the rest of the source byte for
byte. **J0.10's copy moves here and the test file imports it** — a second copy of a render function
is drift with two authors.

**Layer 0 — the crontab precedent's most important half, and the first draft omitted it.**
`cli/crontab.ts` refuses a non-absolute `CRONTAB_CMD` so every route to the real binary must first
spell a bare name, which is what turned "be careful" into "cannot happen" (J2.16). `skills sync` is
this phase's only `rm -rf`, and its scoping was two caller-supplied strings. So:

```ts
export function assertSafeTree(tree: SkillsTree, root: string): void;
// throws unless: isAbsolute(renderedRoot) && isAbsolute(sourceRoot)
//   && renderedRoot is inside `root` && sourceRoot is inside `root`
//   && renderedRoot !== root && basename(renderedRoot) === "skills"
```

Called at the top of every verb, before any read and long before any prune. **This is what makes
J3.9 AC9's mutation safe to perform**: with layer 0, a mutation that widens the prune still cannot
escape the checkout.

**Ownership, from the filesystem alone (§5 Q0, settled at N0):**

```ts
export type Owner = "ours" | "foreign" | "absent";
export function ownerOf(dir: string): Owner;
```

`ours` ⟺ `<dir>/SKILL.md` exists **and** the line immediately after the closing frontmatter `---`
matches `MARKER_RE`. Anything else with a `SKILL.md` is `foreign`; no `SKILL.md` is also `foreign`
(SKL-10: "anything else … is FOREIGN and never touched"); a missing directory is `absent`. **A
hand-edited rendered file is still `ours`** — that is the point: it is reported as `drift` and
refused, not reclassified as someone else's and left alone.

**The findings — five named by SKL-10, and a sixth this job adds to the row:**

```ts
export type Finding =
  | { kind: "missing";        job: string; want: string }
  | { kind: "drift";          job: string; path: string; line: number }
  | { kind: "orphan";         name: string; path: string }
  | { kind: "collision";      job: string; path: string }
  | { kind: "stray";          name: string; path: string; extra: readonly string[] }
  | { kind: "source-missing"; job: string; want: string };
export function check(jobs: readonly Job[], tree: SkillsTree): readonly Finding[];
```

| finding | condition |
|---|---|
| **missing** | a registered job whose `.claude/skills/<name>/` is `absent` |
| **drift** | `ours`, and the bytes differ from `render(source)`; carries the first differing line |
| **orphan** | an `ours` entry whose name is not a registered job |
| **collision** | a registered job's name occupied by a `foreign` entry |
| **stray** | an `ours` directory containing anything but `SKILL.md` |
| **source-missing** | a registered job whose `plugins/<plugin>/skills/<name>/SKILL.md` does not exist |

`drift` requires `ours`, so a `collision` never also reports `drift` — the two are exclusive and
reporting both would tell an operator to fix a file we do not own. Findings are sorted
deterministically (kind, then name) so two reports diff meaningfully.

**The roadmap edit** (approved by the GAP step): §2.30 SKL-10's finding list gains **`source-missing`
(a registered job whose plugin-owned source file is gone)**, with the sentence saying why the five
did not cover it — `check` would report `missing` and `sync` would then throw a raw `ENOENT` reading
a file that is not there.

**`SkillsTree` is a required argument**, `{ renderedRoot, sourceRoot }`, no default, so a test cannot
reach the real tree by forgetting; the real values are assembled in J3.9's argv block.

**Do (tests):** every test builds a `mkdtempSync` tree; one uses the real one, read-only.

1. **`render` reproduces the file on disk** — the real source and the real rendered copy, byte for
   byte. J0.10 test 4, now over the production function.
2. `render` refuses a source with no frontmatter, and one with an unclosed frontmatter.
3. `render` is deterministic.
4. **`ownerOf`** — rendered → `ours`; marker deleted → `foreign`; marker moved three lines down →
   `foreign` (position is part of ownership); a `README.md` and no `SKILL.md` → `foreign`; missing →
   `absent`.
5. **A hand-edited rendered file is still `ours`** — append a line after the marker.
6. **missing** · 7. **drift** (with the 1-indexed first differing line) · 8. **orphan** ·
   9. **collision** (and **no** `drift`) · 10. **stray** (listing the extra file) ·
   11. **source-missing** (and no `drift`). Six tests, one per finding.
12. A clean tree returns `[]`, and so does zero jobs over an empty tree — stated in the title as a
    decision, not an accident.
13. Determinism — one tree with one of each finding, `check` twice, `deepEqual`.
14. **Layer 0 refuses four ways** — a relative `renderedRoot`; an absolute one outside `root`;
    `renderedRoot === root`; a `renderedRoot` whose basename is not `skills`. Four throws, each
    naming the rule. **This is the test that makes the prune safe**, and it runs before any other
    verb test in the file.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test cli/skills.test.ts` reports 14 passing.
- [ ] AC2 — **`render` really is the same function J0.10 asserted.** Delete the second marker line
      from `render`. `npm test` exits non-zero on **both** `cli/skills.test.ts` test 1 and
      `test/skills-example.test.ts` test 4. Revert. Two files going red is the evidence the copy was
      removed rather than duplicated.
- [ ] AC3 — **the marker-position rule fires.** Search the whole file for `MARKER_RE` instead of the
      line after the frontmatter. `npm test` exits non-zero on test 4's third case. Revert.
- [ ] AC4 — **collision and drift stay exclusive.** Remove the `ownerOf === "ours"` guard from the
      drift branch. `npm test` exits non-zero on test 9. Revert.
- [ ] AC5 — **`source-missing` fires.** Delete the branch. `npm test` exits non-zero on test 11.
      Revert. `sed -n '/SKL-10/,/^---/p' roadmap.md | grep -c 'source-missing'` prints ≥ 1.
- [ ] AC6 — **layer 0 fires.** Delete `assertSafeTree`'s `renderedRoot is inside root` clause.
      `npm test` exits non-zero on test 14's second case. Revert.
- [ ] AC7 — **no test can reach the real tree by forgetting.** `grep -n '\.claude/skills' cli/skills.ts`
      prints only comment lines (or nothing).
- [ ] AC8 — `git status --porcelain` empty after `npm test`; `git diff --stat .claude/` is empty.

**Commit:** `skills: render, ownership from the file, six findings, and layer 0 (SKL-03, SKL-04, SKL-05, SKL-10, TST-23)`

**Depends on:** J3.2 (for `Job`), J3.1.

**Risks / what could be wrong:**
- **`ownerOf` requiring the marker at a fixed position** is stricter than SKL-10's wording ("a
  managed marker in the body"). Chosen because ownership must be decidable without parsing and
  because `render` puts it there. A marker that drifted position reads `foreign`, the conservative
  verdict: we do not touch it.
- **Layer 0's `basename === "skills"` clause is a belt over a brace.** It is cheap and it makes a
  `renderedRoot` of `<root>/host` — inside the checkout, absolute, not equal to root — still refuse.

---

## J3.8 — JOB-C15's pure decisions, and the hand-registered job list  ·  JOB-C15, SKL-02, SKL-05, SKL-07, TST-19, HRN-10

**Goal:** everything `nightly-sandcastle` decides without touching the world, plus the registry
SKL-05 requires and every later job reads.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/jobs/nightly-sandcastle.ts` (new — pure half)
- `/home/hyhilman/projects/me/doppelganger/host/jobs/nightly-sandcastle.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/host/jobs/index.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/host/jobs/index.test.ts` (new)

**Do — `host/jobs/index.ts`, the registry:**

```ts
import nightlySandcastle from "./nightly-sandcastle.ts";
export const JOBS: readonly Job[] = [nightlySandcastle];
```

Hand-registered, duplicate-throws at import (KRN-01's shape, one phase early and one file wide): a
five-line loop over `JOBS` throwing on a repeated `name` at module scope. **No directory scan** —
SKL-05's whole content, and the reference's `run.ts` gets this wrong (`readdirSync(JOBS_DIR)`), which
is worth a comment naming the deviation. J3.16 asserts the directory and the list agree both ways;
the *list* is what exists, the directory is only ever checked.

**Do — the pure decisions:**

```ts
export const OUTCOMES = ["changed", "none", "too-large", "suite-failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export interface Verdict { goal: string; outcome: Outcome; files: readonly string[]; ids: readonly string[]; summary: string; verified: string; }
export function parseVerdict(stdout: string): Verdict | null;

export const BLOCKED: readonly { re: RegExp; why: string }[] = [...];
export function blockedBy(file: string): string | null;      // the `why`, or null

export const GOALS: readonly { key: string; title: string; brief: string }[] = [...];
export function nextGoal(state: { index: number; recent: readonly string[] }, only?: string): { goal: Goal; nextIndex: number };

export const DB_NAMESPACES = ["nightly", "log"] as const;
export function importSmoke(path: string): string;
export function head(out: string, n?: number): string;
export function tail(out: string, n?: number): string;
```

**`parseVerdict` reproduces the markdown's vocabulary and nothing else.** `extractBlock(stdout,
"SANDCASTLE")` → `extractFields`, returning `null` — never a partial verdict — when there is no
block, or `outcome` is absent, or `outcome` is not in `OUTCOMES`, or `goal` or `summary` is absent.
HRN-10's "malformed payload writes nothing", as a return value. `files` and `ids` split on `,`, and a
literal `-` means the empty list (the skill's own convention). **The vocabulary check is where SKL-07
lands**: the values a run may report are a list in code, and a skill emitting something outside it
produces `null`, not a widened outcome.

**`DB_NAMESPACES` is `["nightly", "log"]`, and the first draft had it wrong.** The GAP step found it:
`kernel/runtime/log/tail.ts` has `NS = "logtail"` (the **table** namespace, DBS-02) but opens
`dbPath("log")` — so the file is `log.db` and the knob is `LOG_DB`. `["nightly","logtail"]` would have
set `LOGTAIL_DB`, which nothing reads, and tier 4's scratch redirect would have **missed the log
store entirely** while every AC still passed. Confirmed by scanning every `dbPath(` call site in the
repo: exactly one non-test caller, `tail.ts:57`, with `"log"`. **The drift gate the first draft
promised and never listed is J3.13 assertion 11**, and it derives the list from those call sites
rather than from this constant.

**`BLOCKED` — seven rows, each with its own `why`,** because a list of regexes with no reasons is a
list of things somebody once approved:

| pattern | why |
|---|---|
| `^host/schedule\.ts$` | JOB-C15 names it. The crontab is generated from it and `npm test` says nothing about whether a job still fires |
| `^host/supervisor\.ts$` | JOB-C15 names it. One process owns every tick |
| `^host/jobs/nightly-sandcastle\.ts$` | JOB-C15 names it. A job that can rewrite its own kill switch does not have one |
| `^package(-lock)?\.json$` | JOB-C15 names it. A dependency change is not reviewable from a diff stat at 3am |
| `^plugins/[^/]+/skills/` | its own prompt. A pass rewriting the instructions the next pass reads is unbounded |
| `^\.claude/skills/` | rendered, never hand-edited (SKL-04) |
| `^\.github/` | a green suite says nothing about whether CI still runs it |

`blockedBy` returns the **reason**, so a refusal says why rather than which regex index.

**`GOALS`** — three, each `{ key, title, brief }`, phrased for THIS repo: `docs-vs-code` (a claim in
`CLAUDE.md`/`roadmap.md` checked against the source, and where the claim is derivable, wire the drift
gate instead of re-typing the value) · `test-gaps` (a behaviour with no test that goes red when
deleted — LOOP.md's standing rule as a goal) · `dead-weight` (remove a thing rather than add one).
`nextGoal(state, only)` rotates by index; **`only` forces one key and is SAF-06's single-item mode**
(see J3.12), throwing on an unknown key rather than silently rotating.

**`importSmoke(path)`** — this repo has no `tsx`; Node strips types natively. Measured on Node
22.23.1: `node -e 'import("<abs>.ts").then(()=>{}, e=>{console.error(e);process.exit(1)})'` returns 0
for a good module, 1 with `SyntaxError: Expression expected` for a syntax error, and 1 with the
thrown message for a throw at load. The path is `JSON.stringify`'d — it is source code, not a string.
**The reference's three-day silent failure is why this is exported and tested**: its `tsx -e` probe
built CJS, top-level `await` was a build error there, and the smoke rejected 100% of inputs from the
job's first commit while reading as a strict gate.

**Do (tests):**

1. **`parseVerdict` accepts the block the skill documents** — the fixture is the report template read
   **from the source `SKILL.md` at test time** with the placeholders filled, not retyped, so the test
   fails if the skill changes shape. (J3.17 adds the real-data fixture beside it.)
2. Two blocks → the second wins.
3. `outcome=shipped` → `null`. 4. Missing `outcome`/`goal`/`summary` → `null`, three cases.
5. `files=-` → `[]`; `files=a.ts,b.ts` → two trimmed entries.
6. A `verified=` value containing `=` and `/` survives intact.
7. **`blockedBy` covers the four things the markdown names.** Parse the "Off limits:" bullet from the
   source `SKILL.md`, map each named thing to a concrete repo path, assert a non-null reason for
   each. **SKL-07's line made mechanical**: the skill may *describe* a rule, and code must *enforce*
   one at least as strong.
8. `blockedBy` returns `null` for a path a pass legitimately edits (`CLAUDE.md`, `kernel/stages.ts`).
9. Every `BLOCKED` row has a non-empty `why`, and no two share one.
10. `nextGoal` cycles all three and wraps; `nextIndex` stays in range; `only: "test-gaps"` returns
    that goal and does not advance past it; `only: "nope"` throws.
11. **`importSmoke` accepts a module that loads** — the case the reference's probe could never reach.
    Against a real `mkdtempSync` `.ts` file and a real repo file (`kernel/stages.ts`).
12. `importSmoke` rejects a syntax error, a missing relative import, and a throw at load — three
    cases, each asserting `head(out)` names the fault.
13. `importSmoke` JSON-encodes its path: a path containing `"` and `\` keeps its quoting.
14. `head` leads with the error class, drops `at ` frames and the `Node.js v…` banner, stays under
    400 characters; `tail` takes the last meaningful lines. The comment says which failure each is
    right for.
15. **`host/jobs/index.ts` throws on a duplicate name** — a local re-registration helper with two
    jobs of one name.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test host/jobs/nightly-sandcastle.test.ts` reports 14 passing
      and `host/jobs/index.test.ts` 1.
- [ ] AC2 — **the vocabulary gate fires.** Add `"shipped"` to `OUTCOMES`. `npm test` exits non-zero
      on test 3. Revert.
- [ ] AC3 — **the partial-verdict gate fires.** Return `summary: ""` instead of `null` when `summary`
      is absent. `npm test` exits non-zero on test 4. Revert.
- [ ] AC4 — **the markdown-coverage gate fires.** Delete `^host/supervisor\.ts$` from `BLOCKED`.
      `npm test` exits non-zero on test 7 naming `host/supervisor.ts`. Revert.
- [ ] AC5 — **the import smoke really rejects.** Change the rejection branch to
      `.then(()=>{}, ()=>{})`. `npm test` exits non-zero on test 12 — the probe now accepts
      everything. Revert. **A probe that accepts everything is the exact failure the reference
      shipped for three days**, and this AC is the only thing that catches it.
- [ ] AC6 — **`DB_NAMESPACES` names files, not table namespaces.**
      `grep -n 'dbPath(' kernel host cli --include=*.ts -r | grep -v '\.test\.ts'` prints exactly one
      line, `kernel/runtime/log/tail.ts` with `"log"`. Record it — this is the check that caught the
      first draft's `logtail`.
- [ ] AC7 — `node --test test/layout.test.ts`, `test/writes.test.ts` pass.
- [ ] AC8 — `git status --porcelain` empty after `npm test`; every probe fixture is under
      `mkdtempSync` and removed in an `after` hook.
- [ ] AC9 — `time node --test host/jobs/nightly-sandcastle.test.ts` under 8 s — six real `node -e`
      children at ~60 ms each plus start-up. Record the measured value.

**Commit:** `nightly-sandcastle: the verdict, the blocked paths, the goals, the import smoke (JOB-C15, SKL-02, SKL-05, SKL-07, TST-19, HRN-10)`

**Depends on:** J3.2, J3.4.

**Risks / what could be wrong:**
- **The `defineJob` literal names `permissionMode`, `model`, `skill`, `local` and `taskClass` before
  J3.12 writes `exec`.** Valid at every commit in between: `exec` is optional and the job has `skill`.
- **Three goals is a guess.** Enough for rotation to be observable, small enough that each brief is
  written for this repo rather than adapted from another.

---

## J3.9 — `skills render | sync | check`: the prune, the argv block, the safe run  ·  SKL-04, SKL-10, SAF-01, TST-23

**Goal:** the impure half — three verbs, a `sync` that prunes only what it owns, and a `check` that
fails the build without repairing it.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/cli/skills.ts` (verbs + argv block)
- `/home/hyhilman/projects/me/doppelganger/cli/skills.test.ts` (verb tests)
- `/home/hyhilman/projects/me/doppelganger/cli/skills-cli.test.ts` (new — the child-process smoke)
- `/home/hyhilman/projects/me/doppelganger/package.json` (`"skills": "node cli/skills.ts"`)
- `/home/hyhilman/projects/me/doppelganger/test/knobs.test.ts` (`ROWS` + one row)
- `/home/hyhilman/projects/me/doppelganger/test/writes.test.ts` (`REGISTER`: `cli/skills.ts`)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27: `SKILLS_DRY_RUN`)

**Do — the same `run(argv, deps)` shape `cli/crontab.ts` uses**, so an operator learns one tool and
gets two:

```ts
export interface SkillsDeps { readonly jobs: readonly Job[]; readonly tree: SkillsTree; readonly root: string; readonly dryRun: boolean; }
export function run(argv: readonly string[], deps: SkillsDeps): { out: string; err: string; code: number };
```

| verb | behaviour |
|---|---|
| `render` | prints what each registered job's rendered file **would** contain; writes nothing; exit 0 |
| `sync` | writes `missing`, rewrites `drift`, **removes** `orphan`, **refuses** `stray`, `collision` and `source-missing` with exit 1 and a per-finding line. Prints `wrote`/`rewrote`/`pruned` and a tally |
| `check` | prints every finding, exits 1 on any; exit 0 and a one-line tally when clean. **Never writes** |

Every verb calls `assertSafeTree(deps.tree, deps.root)` first (J3.7's layer 0).

**Where the crontab precedent does NOT survive, because SKL-10 says so:** a crontab is one file with
a delimited block, so "foreign lines untouched" is a splice. `.claude/skills/` is a tree with nowhere
to put a block marker, so the unit of ownership is a **directory**, decided by `ownerOf`. `sync`
never edits, renames or deletes a foreign directory; a `collision` is refused and reported, because
the only correct fix is a human deciding whose name it is.

**`sync`'s prune is scoped three times**: layer 0 (the tree is absolute, inside `ROOT`, named
`skills`, not `ROOT` itself), `ownerOf(dir) === "ours"`, and the directory sits **directly** under
`renderedRoot`. It removes the directory, not its contents — a `stray` inside would otherwise be
deleted as collateral, which is what SKL-10's "REFUSES a stray" forbids. Order inside `sync`:
**refuse first, write second, prune third.** A run with any refusal writes nothing at all.

**SAF-01 for a CLI:** `SKILLS_DRY_RUN=1` makes `sync` print its plan and call no write. This is the
second operator CLI with a dry run and no `SAF-` row that covers it (`CRONTAB_DRY_RUN` was the
first) — the pair is now a pattern, flagged in Gaps.

**The argv block** assembles `JOBS` from `host/jobs/index.ts`, `renderedRoot: projectPath(".claude/skills")`,
`sourceRoot: projectPath("plugins")`, `root: ROOT`, `dryRun: envStr(SKILLS_DRY_RUN_ENV) === "1"`, and
is **UNTESTED BY CONSTRUCTION** except for two smoke checks.

**Do (tests):** `cli/skills.test.ts`, appended —

15. `render` writes nothing — `readdirSync` before and after, `deepEqual`.
16. `sync` on an empty rendered root writes the file, bytes equal `render(source)`.
17. `sync` on drift rewrites and reports `rewrote`.
18. `sync` prunes an orphan and reports `pruned`; the directory is gone.
19. **`sync` refuses a collision**: exit 1, nothing written, nothing pruned — the tree is
    byte-identical afterwards **including an orphan that would otherwise have been pruned**.
    "Refuse first", asserted.
20. `sync` refuses a stray, and the stray file survives.
21. `sync` is idempotent — twice; the second prints `already in sync` and writes nothing.
22. `deps.dryRun: true` prints the same plan and writes nothing.
23. `check` on a clean tree exits 0; on each of the six findings exits 1 and names it.
24. **`sync` never touches a foreign directory that is not a registered job's name** — create
    `.claude/skills/some-other-tool/SKILL.md` with no marker; after `sync` it is byte-identical.
25. **Every verb refuses an unsafe tree** — layer 0's four refusals reached through `run(argv, deps)`,
    for `render`, `sync` and `check`. Three verbs × one refusal each.

`cli/skills-cli.test.ts` (child process, `ENGINE_ROOT` at a temp tree):

26. **The argv block parses and dispatches** — `check` on a temp tree with a registered job and no
    rendered file exits 1 and names `missing`. A **smoke check, not a test**.
27. **`check` against the REAL tree exits 0** — `spawnSync(process.execPath, ["cli/skills.ts","check"])`
    in the real checkout, no env overrides. TST-23 as a build gate, run the way an operator runs it.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test cli/skills.test.ts` reports 25 passing and
      `cli/skills-cli.test.ts` 2.
- [ ] AC2 — `npm run skills check` exits 0 and prints a one-line tally naming 1 skill.
- [ ] AC3 — **the drift gate fires on the real tree.**
      `printf '\n<!-- drift -->\n' >> .claude/skills/nightly-sandcastle/SKILL.md`;
      `npm run skills check` exits 1 naming `drift` and the first differing line; `npm test` exits
      non-zero; `npm run skills sync` restores it and `git diff --stat .claude/` is empty. Three
      commands, and the third proves `sync` is the repair path and `check` is not.
- [ ] AC4 — **the missing gate fires.** `rm -rf .claude/skills/nightly-sandcastle`; `npm test` exits
      non-zero naming `missing`; `npm run skills sync` restores it byte-for-byte.
- [ ] AC5 — **the orphan gate fires and prune is scoped.** `mkdir -p .claude/skills/ops-ghost && cp
      .claude/skills/nightly-sandcastle/SKILL.md .claude/skills/ops-ghost/`; `npm test` exits
      non-zero naming `orphan`; `npm run skills sync` removes `ops-ghost` and leaves the real entry
      untouched; `git status --porcelain` clean.
- [ ] AC6 — **the collision gate fires and refuses.** Replace the rendered `SKILL.md` with a copy
      whose two marker lines are deleted. `npm test` exits non-zero naming `collision`;
      `npm run skills sync` exits **1** and the file is still the marker-less copy. `git checkout .claude/`.
- [ ] AC7 — **the stray gate fires.** `touch .claude/skills/nightly-sandcastle/NOTES.md`; `npm test`
      exits non-zero naming `stray`; `npm run skills sync` exits 1 and `NOTES.md` survives. `rm` it.
- [ ] AC8 — **refuse-first fires.** Move the refusal check after the write loop. `npm test` exits
      non-zero on test 19. Revert.
- [ ] AC9 — **the foreign-untouched gate fires, safely.** Drop the `ownerOf === "ours"` guard from the
      prune. `npm test` exits non-zero on test 24. Revert. **This mutation is a tool deleting a
      directory it did not create, and it is only safe to perform because layer 0 (J3.7) bounds every
      path it can reach to `<ROOT>/.claude/skills`** — confirm that first with
      `node --test cli/skills.test.ts` test 25 passing.
- [ ] AC10 — `node --test test/knobs.test.ts` reports 7 passing with `SKILLS_DRY_RUN` in `ROWS`;
      remove it and confirm assertion 2 exits non-zero. `sed -n '/^### 2\.27/,/^### 2\.28/p'
      roadmap.md | grep -c 'SKILLS_DRY_RUN'` prints `1`.
- [ ] AC11 — `node --test test/writes.test.ts` reports 6 passing with `cli/skills.ts` in `REGISTER`.
- [ ] AC12 — `git status --porcelain` empty after `npm test`.

**Commit:** `skills sync/check/render: the prune, the refusals, the argv block (SKL-04, SKL-10, SAF-01, TST-23)`

**Depends on:** J3.7, J3.8.

**Risks / what could be wrong:**
- **`sync`'s directory removal is the only destructive operation in the phase.** Four things bound it
  now: layer 0, `ownerOf`, the direct-parent check, and `SKILLS_DRY_RUN`. AC9 proves the second is
  load-bearing and test 25 proves the first is.
- **`.claude/skills/` is a gate resource (`skills`) and this CLI takes no gate.** It is an operator
  tool, not a scheduled entry, so nothing orders it against a running agent. That is also why J3.15
  drops `skills` from the entry's `resources` — flagged in Gaps as INS-05's sibling problem for a CLI.

---

## J3.10 — TST-08 / HRN-11: every agent run names a pinned model  ·  HRN-11, HRN-14, TST-08

**Goal:** make "every agent run names its model, a pinned version, never a floating alias" a failing
build; define "pinned" as a predicate that does not rot; and add the companion scan the GAP step
substituted for `runJob`'s rejected `local` precondition.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/test/model.test.ts` (new)

### Where the model string lives

Two places, both checked: `kernel/ports/job.ts`'s `DEFAULTS.model`, and a `model:` key on a
`defineJob({…})`/`runJob({…})` object literal. `host/runner.ts` receives `req.model` and writes no
literal. **The env is a third place a source scan cannot reach, and J3.6's `assertPinned` covers it.**

### What "pinned" means

Checked against the current Anthropic model list: **current IDs carry no date suffix and are complete
as written** — `claude-opus-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`,
`claude-fable-5`. Appending a date is wrong, not more pinned. So "pinned" means **names a generation
and cannot silently become a different one**:

```ts
export const PINNED = /^claude-[a-z][a-z0-9]*(?:-\d+)+$/;
export const ALIASES = [/(^|-)latest$/, /^(opus|sonnet|haiku|fable|mythos|default|opusplan)$/, /^claude$/];
export function assertPinned(model: string): void;   // exported from kernel/ports/job.ts (J3.6)
```

`PINNED` accepts a family this plan has never heard of and a dated snapshot; it rejects
`claude-opus-latest`, `opus`, `claude-3-5-sonnet-latest` and `""`. `ALIASES` is the belt. **No exact
value is pinned** — the standing rule forbids pinning something outside this repo.

### The scan, and every spelling it must survive

The reference's `model-declaration.test.ts` masker is ported — 132 lines of measured-correct code
whose failure mode the reference documented (a mis-read regex literal blanks the rest of a file and
every call site in it stops existing, which reads as a pass). Three things carry over: the
`lost = raw.matchAll(CALL).length - masked.matchAll(CALL).length` self-check · the floor · and the
rule it implies, in a comment: **never spell `runJob(` or `defineJob(` inside a string in this repo.**

**Two spelling holes the GAP step found, both closed here:**

- **The masker finds callees by name**, so `import { defineJob as dj } from "…"` evades it entirely.
  Fixed by porting door 6's `moduleScopeLocalNames` alias resolution (N2 F4, the same fix for the
  same class of bug): resolve each file's LOCAL names for `defineJob`/`runJob` first, following
  `as`, then build that file's `CALL` regex from the local names actually in scope there. A comment
  states what remains uncovered: a callee held in a variable and invoked indirectly.
- **The floor must be derived.** `assert.equal(checked, JOBS.filter(...).length + runJobLiteralSites)`
  — both operands from the walk and the registry, never a number this commit writes. **This job
  lands after J3.8 for exactly this reason**: at its old position there were zero call sites in
  non-test source and `checked >= 1` was unsatisfiable at its own commit.

**Do (tests):**

1. **Every `defineJob`/`runJob` object literal names `model`.** Walk `kernel/`, `host/`, `plugins/`,
   `cli/` (non-test), mask, resolve local names, find call sites, take top-level keys, require
   `model` unless the literal has `exec`.
2. **The masker did not lose a call site** — `lost === 0` per file.
3. **Every model literal is PINNED**, across every quote spelling (J3.2 AC2's lesson applied to the
   repo-wide scan, not only to one file).
4. **No model literal is an ALIAS.** The failure message names four rejected spellings so a reader
   learns the rule from the failure.
5. **The predicate is exercised over a table** — twelve strings, six accepted (`claude-opus-5`,
   `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-fable-5`,
   `claude-opus-4-5-20251101`), six rejected (`claude-opus-latest`, `opus`, `sonnet`, `claude`,
   `claude-3-5-sonnet-latest`, `""`). Without this, clauses 3 and 4 are satisfied by a regex that
   accepts everything.
6. **`DEFAULTS.model` is reachable from exactly one file**, so a bump moves one line.
7. **HRN-14's companion scan — the GAP step's substitute for `runJob`'s rejected precondition.** Any
   job literal whose `permissionMode` resolves to `bypassPermissions` — spelled as the literal **or**
   as `DEFAULTS.permissionMode`, since J3.2 makes that the default value — must also carry
   `local: true`. The test's comment records why this is a scan and not a runtime throw: HRN-14 is a
   **placement** field, and making it an authorization precondition would give one field two
   meanings and pin a safety-`local` job off the pool at M9 for no dispatch reason.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test test/model.test.ts` reports 7 passing.
- [ ] AC2 — **clause 1 fires.** Delete `model:` from the `defineJob` literal in
      `host/jobs/nightly-sandcastle.ts`. `npm test` exits non-zero naming the file, the line and the
      keys it did find. Revert.
- [ ] AC3 — **clause 4 fires on a `-latest` alias.** Change `DEFAULTS.model` to
      `"claude-opus-latest"`. `npm test` exits non-zero on test 4 **and** on test 3 (no numeric
      segment). Record both — a rule only one clause enforces is one edit from unenforced. Revert.
- [ ] AC4 — **clause 4 fires on a bare alias.** Change `DEFAULTS.model` to `"opus"`. `npm test` exits
      non-zero. Revert. `--model opus` is what a human types and is the exact spelling HRN-11 bans.
- [ ] AC5 — **the alias-import hole is closed.** Change `host/jobs/index.ts` to
      `import { defineJob as dj } from "…"` and re-export a job built with `dj({...})` that omits
      `model`. `npm test` exits non-zero on test 1. Revert. **Without the `moduleScopeLocalNames`
      port this passes silently**, and recording it is the point.
- [ ] AC6 — **the masker self-check fires.** Add
      `export const doc = "call defineJob({ model: 1 }) to declare a job";` to `kernel/ports/job.ts`.
      `npm test` exits non-zero on test 2 (`masker lost 1 call site(s)`). Revert.
- [ ] AC7 — **the predicate table fires.** Add `"opus"` to the accepted half of test 5. `npm test`
      exits non-zero. Revert.
- [ ] AC8 — **the HRN-14 companion fires.** Delete `local: true` from `nightly-sandcastle`'s literal.
      `npm test` exits non-zero on test 7 naming the file. Revert.
- [ ] AC9 — **the floor is derived.** Add a second job to `JOBS` (a `defineJob` with a `model`);
      `test/model.test.ts` stays green. Remove its `model`; it goes red. Remove the fixture job.
- [ ] AC10 — `time node --test test/model.test.ts` under 3 s — it reads every non-test `.ts` file in
      four directories (~65 today).

**Commit:** `TST-08: every agent run names a pinned model, and a bypass run declares local (HRN-11, HRN-14, TST-08)`

**Depends on:** J3.6, J3.8.

**Risks / what could be wrong:**
- **The masker is 132 lines of ported code and it is the whole test.** Its failure mode is silent;
  test 2 is the only guard, and the reference's comment saying so is carried verbatim.
- **`PINNED` accepts a dated snapshot.** Deliberate — a dated snapshot is maximally pinned — but it
  means the regex cannot also enforce "no date on a current id", which is a naming convention rather
  than a pinning property. Flagged in Gaps.

---

## J3.11 — JOB-C15's ship gate: the suite, the import smoke, the dry run  ·  JOB-C15, SAF-05, TST-19

**Goal:** the three tiers that decide whether tonight's diff may land, cheapest first, each a real
signal — and a scratch DB redirect that makes the third safe even when the pass just edited the code
that keeps its own promise.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/jobs/nightly-sandcastle.ts` (the gate)
- `/home/hyhilman/projects/me/doppelganger/host/jobs/nightly-sandcastle.test.ts` (gate tests)

**Do:**

```ts
export const GATE_TIMEOUT_MS = 300_000;   // one tier's child; sized in J3.15's budget assertion
export interface GateDeps {
  readonly work: string;
  readonly runIn: (dir: string, cmd: string, args: readonly string[], env?: Record<string,string>) => { ok: boolean; out: string };
  readonly scratch: string;
  readonly jobs: readonly Job[];
}
export interface GateResult { ok: boolean; detail: string; }
export function gate(files: readonly string[], deps: GateDeps): GateResult;
```

Tiers, in order, returning on the first failure:

1. **Blocked paths.** A string match, free, and it must be first: a pass that touched
   `host/supervisor.ts` should not spend three minutes on a suite before being refused. The detail
   names the file **and its `why`**.
2. **`npm test` in the worktree.** Detail is `tail(out)` — a suite's verdict is its last lines.
3. **An import smoke of every changed non-test `.ts` file.** Catches what a green suite does not: a
   file with no test that no longer parses or throws at module load. Detail is `head(out)` — a
   crashed child's class and message are its *first* non-frame line, and the reference measured that
   `tail` is useless here because every Node dump ends `}` / `Node.js v22.x`.
4. **A dry run of every changed registry job.** For each changed `host/jobs/<name>.ts` in
   `deps.jobs`, run `node host/run.ts <name>` with that job's `*_DRY_RUN` set **and every
   `<NS>_DB` from `DB_NAMESPACES` pointed into `deps.scratch`**.

**Three honest limits on tier 4, stated rather than discovered:**

- **It is dormant at N3.** `BLOCKED` forbids a pass touching `host/jobs/nightly-sandcastle.ts`, the
  only registry job, so no pass can produce a changed job for tier 4 to run. The tier is built now
  because building it later means building it against a diff that already exists; it becomes live
  the day a second job lands (N5's `ops` builtins).
- **The dry-run knob name is derived from the job name (`<NAME>_DRY_RUN`), and one knob is not.**
  `NIGHTLY_NO_SANDCASTLE` is KRN-07's `*_NO_<FEATURE>` shape — plugin plus feature — and cannot be
  derived from `nightly-sandcastle`. Tier 4 derives only the dry-run knob and never the kill switch,
  and the comment says which is which so nobody generalises the derivation.
- **A job whose `*_DRY_RUN` runs an agent (SAF-07) makes this tier expensive.** For
  `nightly-sandcastle` itself, one nightly pass would spend a **second** Opus run inside its own
  gate. That is the cost of SAF-07's non-free dry run meeting tier 4, it is why the tier is dormant
  by construction today, and it is a real design question for N5 — flagged in Gaps.

**The DB redirect is the load-bearing half**, and the comment says so: a dry-run flag is the job's own
promise about itself, and this gate exists precisely because tonight's pass may have just edited the
code that keeps it. `DB_NAMESPACES` names **files**, not table namespaces (J3.8), and J3.13
assertion 11 derives the list from every `dbPath(` call site so a new integration cannot be forgotten.

`deps.runIn` is a **required** field — a test supplies a recording fake and never spawns `npm test`
inside a test. The real one wraps `execFileSync` with `GATE_TIMEOUT_MS` and a 16 MB buffer.

**Do (tests):** `runIn` is a fake returning scripted results per `(cmd, args)`.

16. **Tier 1 refuses and returns first** — a list containing `host/supervisor.ts`: `ok` false, the
    detail contains the row's `why`, the fake recorded **zero** calls.
17. **Tier order** — a clean list with a failing `npm test`: the fake was called once, no import
    smoke ran.
18. **Tier 3 runs once per changed non-test source file**, skipping `.test.ts` and non-`.ts`. Exact
    call list.
19. **Tier 4 runs only for changed registry jobs**, and the env contains `<NAME>_DRY_RUN=1` and one
    `<NS>_DB` per `DB_NAMESPACES` entry, **every value under `deps.scratch`**.
20. **Tier 4 skips a changed `host/jobs/*.ts` that is not in `deps.jobs`** — an unregistered file is
    not a job (SKL-05), and running it would be discovery through the back door.
21. **A passing gate's detail counts what ran** — `npm test, 2 import smoke(s), 1 dry run(s)` — from
    the arrays, never from literals.
22. **Docs-only change** — one `.md` file: `npm test` runs, no smoke, no dry run, `ok` true.
23. **`gate([])` returns `ok: true` with a detail saying so**, and `exec` never calls it (asserted in
    J3.12) — rather than running a suite over nothing.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test host/jobs/nightly-sandcastle.test.ts` reports 22 passing
      (14 from J3.8 + 8 here).
- [ ] AC2 — **tier order fires.** Move the blocked-path check after `npm test`. `npm test` exits
      non-zero on test 16. Revert.
- [ ] AC3 — **the DB redirect fires.** Remove the `<NS>_DB` loop from tier 4's env. `npm test` exits
      non-zero on test 19. Revert. Record the message — without it the third tier runs a
      possibly-broken dry run against the live store.
- [ ] AC4 — **the namespace list is right.** Change `DB_NAMESPACES` back to `["nightly","logtail"]`.
      `npm test` exits non-zero on **J3.13's assertion 11** (the derivation from `dbPath(` call
      sites). Revert. **This is the AC the first draft did not have, and its absence is why the bug
      shipped past review.**
- [ ] AC5 — **the registry filter fires.** Make tier 4 accept any changed `host/jobs/*.ts`. `npm test`
      exits non-zero on test 20. Revert.
- [ ] AC6 — **the detail counts are derived.** Change tier 3's count to a literal `1`. `npm test`
      exits non-zero on test 21. Revert.
- [ ] AC7 — `grep -n "execFileSync\|spawnSync" host/jobs/nightly-sandcastle.test.ts` prints nothing
      in this group's line range: no gate test spawns a process.
- [ ] AC8 — `git status --porcelain` empty after `npm test`.

**Commit:** `nightly-sandcastle: the three-tier ship gate and its scratch DB redirect (JOB-C15, SAF-05, TST-19)`

**Depends on:** J3.8.

**Risks / what could be wrong:**
- **Tier 2 runs `npm test` in a worktree with no `node_modules`.** `git worktree add` copies nothing
  and `pretest` is `tsc`. J3.12 symlinks `<root>/node_modules` in; J3.5's `clean -fd -e node_modules`
  keeps it through a re-prep and a discard. The single most likely reason tier 2 fails for a reason
  unrelated to the diff.
- **`GATE_TIMEOUT_MS = 300_000` is ~26× today's measured 11.5 s suite**, stated as headroom rather
  than as a measurement, and it enters J3.15's budget assertion.

---

## J3.12 — JOB-C15's pass: `exec()`, the landing, and the whole safe-run surface  ·  JOB-C15, SAF-01…SAF-07, INS-06, KRN-07, INV-1

**Goal:** the pass itself — rotate, refuse, prep, run, check both escape routes, gate, land or
discard, report — with every write path env-gated so any of it runs without touching the outside
world.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/jobs/nightly-sandcastle.ts` (`exec`, the knobs, the state store)
- `/home/hyhilman/projects/me/doppelganger/host/jobs/nightly-sandcastle.test.ts` (pass tests)
- `/home/hyhilman/projects/me/doppelganger/test/knobs.test.ts` (`ROWS` + **seven** new rows)
- `/home/hyhilman/projects/me/doppelganger/test/writes.test.ts` (`REGISTER`: the job file — `symlinkSync`)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27: the seven knobs; §2.28 SAF-02: `*_NO_MERGE`)

**The knobs — seven rows, and the whole safe-run surface is these seven:**

| key | default | `why` (KRN-06: the one-line knob doc) |
|---|---|---|
| `NIGHTLY_NO_SANDCASTLE` | `0` | KRN-07 kill switch: the pass logs `killed` and returns before reading anything |
| `NIGHTLY_SANDCASTLE_BASE` | `main` | the branch a pass lands on; a checkout on any other branch refuses (`not-on-base`) |
| `NIGHTLY_SANDCASTLE_DRY_RUN` | `0` | SAF-01: run the agent and the gate for real, write nothing — no commit, no merge, no state. **This dry run COSTS one agent pass** (SAF-07); `*_MAX=0` is the free one |
| `NIGHTLY_SANDCASTLE_NO_MERGE` | `0` | SAF-02 shadow mode: commit inside the worktree, never move the base branch |
| `NIGHTLY_SANDCASTLE_MAX` | `1` | SAF-03/04: passes per tick. `0` is the **free** smoke test — everything but the agent |
| `NIGHTLY_SANDCASTLE_ONLY` | *(none, optional)* | SAF-06: force one goal key instead of the rotation, for debugging one brief end to end |
| `NIGHTLY_SANDCASTLE_MODEL` | *(none, optional)* | override the tier one pass spends on without a code change; the value is checked against `PINNED` at the one place `RunRequest.model` is built (HRN-11) |

`NIGHTLY_DB` is **not** a new row — it is the `<NAME>_DB` family `kernel/paths.ts` already declares.
**`*_ONLY` and `*_MODEL` carry neither `required` nor `default`, so they are read with `envOptional`,
not `envStr` — `envStr` throws on a row with no default** (the GAP step's catch; `kernel/config.ts`'s
own contract).

**SAF-06 exists because the GAP step found it had zero mentions in the first draft**, which would
have made J3.18 tick a box nothing implemented. `NIGHTLY_SANDCASTLE_ONLY=<goal-key>` is a real
operator need — J3.17 debugging one brief end to end — and it flows into `nextGoal(state, only)`,
which throws on an unknown key rather than silently rotating.

**§2.28 SAF-02's named list gains `*_NO_MERGE`** (approved by the GAP step): the four names it lists
are all tracker- or remote-shaped, and a job whose write is a local `merge --ff-only` has no member
that fits.

**INV-1: there is no local state file.** Rotation lives in `nightly.db`, namespace `nightly`
(DBS-02/03), append-only migration, `nightly_meta` row. That satisfies INV-1 (a JSON file next to the
code is exactly what it bans), gets SAF-05's `NIGHTLY_DB` redirect free, and gets TST-20's
shared-database discipline free. A deviation from the reference and an improvement, not a liberty.

**The one deps interface, so ruling 5's point 1 holds** (the first draft's two lists disagreed):

```ts
export interface PassDeps {
  readonly root: string;                       // the checkout — read, never written by the agent
  readonly runner: Runner;
  readonly git: (dir: string, ...args: string[]) => string;
  readonly now: () => Date;
  readonly db: Db;
  readonly log: Logger;
  readonly worktreeRoot: string;               // project-relative parent of every pass worktree
  readonly runLogPath: (name: string) => string;
  readonly runIn: GateDeps["runIn"];
  readonly scratchRoot: string;
  readonly jobs: readonly Job[];
}
```

`exec` builds `RunJobDeps` from it — `{ runner, cwd: wt.path, logPath: runLogPath(passName) }` — so
the two interfaces are one list quoted twice, and `worktreeRoot` arrives where the first draft's did
not.

**The pass, as an ordered list — every step is a place it can stop:**

```
 1. NIGHTLY_NO_SANDCASTLE=1        → log info killed, return                          (KRN-07)
 2. branch !== BASE                → log warn skip reason=not-on-base, return          (ruling 5)
 3. status --porcelain non-empty   → log warn skip reason=tree-dirty, return           (ruling 5)
 4. originBefore = git rev-parse origin/<BASE>  (empty string if no remote)            (ruling 6)
 5. reapWorktrees(root, worktreeRoot, keep)                                            (HRN-12)
 6. state = readState(db); goal = nextGoal(state, ONLY)                                 (SAF-06)
 7. wt = prepWorktree(root, { branch: `nightly/${INSTANCE}`, base: BASE }, path)        (INS-06)
 8. symlink <root>/node_modules into wt
 9. MAX === 0                      → log info free-smoke; skip 10-13; go to 14          (SAF-04)
10. run = await runJob(job, { runner, cwd: wt.path, logPath: runLogPath(passName) })
11. verdict = parseVerdict(run.stdout)                                                  (HRN-10)
12. escape checks, BOTH routes:
      porcelain(root) !== before      → log error write-scope-escaped reason=tree-dirty
      rev-parse origin/<BASE> !== originBefore → log error write-scope-escaped reason=remote-moved
13. files = changedFiles(wt); files.length === 0 ? no-op : gate(files, …) ? land : discard
14. report → log.raw(body);  DRY_RUN ? return : writeState(db, nextIndex, recent)
    finally: teardownWorktree
```

**Step 12 covers both escape routes (ruling 6).** The tree comparison catches a write into the
checkout; the `origin/<BASE>` comparison catches a push, which leaves the tree **clean** and is
therefore invisible to the first. `GIT_SSH_COMMAND=/bin/false` (J3.3) is the gate; this is the
detector, because a gate one env var from deletion needs one.

**Detection without containment, stated.** The agent runs under `bypassPermissions` on a host with no
isolation; nothing *stops* it writing outside the worktree. N3 **detects and reports** and does not
revert or stash — the reference learned that reverting a shared checkout destroys concurrent human
work, and its answer (`escape-stash.ts`) has no roadmap row. Named in the code, in the test titles
and in Gaps.

**The landing, step 13:**

```
git -C <wt> add -A -- <the changed paths, as a pathspec, never bare -A>
git -C <wt> commit -m "chore(nightly): <summary>" -m "nightly sandcastle — goal: <key>"
git -C <root> merge --ff-only nightly/<INSTANCE>
```

`--ff-only` is the guarantee: the base only moves forward onto a commit made on top of it, so a
concurrent human commit **fails loudly**. **The ff-miss recovery**: on failure,
`git -C <wt> rebase <BASE>` once, **re-run `gate(files)` from scratch**, retry. A second failure
discards and reports `ff-miss`. The re-gate is not optional — a rebased diff is a different diff and
landing it on the strength of the pre-rebase gate is exactly what JOB-C15 exists to prevent.

**Do (tests):** every test builds a real `mkdtempSync` git repo and a SQLite file under it.

24. **The kill switch** — one `event=killed`, zero runner calls, `git log` unchanged.
25. **`not-on-base`** — repo on `feature/x`, base `main`: one `event=skip reason=not-on-base`, zero
    runner calls.
26. **`tree-dirty`** — an uncommitted file: one `event=skip reason=tree-dirty`, zero runner calls.
27. **`MAX=0` is free and complete** — zero runner calls, **and** a worktree was prepared and torn
    down, the goal rotated, a report line emitted. Four assertions, because otherwise "free"
    degrades into "does nothing".
28. **The happy path lands** — one commit on `nightly/<INSTANCE>`, the base HEAD moved to it, one
    `event=landed` carrying the sha and the goal.
29. **`DRY_RUN=1` runs the agent and lands nothing** — the runner was called **once**, the base HEAD
    unchanged, the worktree has **no** commit, and the rotation state in the DB is unchanged. Four
    assertions; the last is the one people forget.
30. **`NO_MERGE=1`** — the worktree HEAD advanced, the base HEAD did not.
31. **`ONLY=<key>`** — the named goal is used, an unknown key throws before anything is prepped, and
    the rotation index does not advance past it (SAF-06).
32. **A failing gate discards** — `git -C <wt> status --porcelain` empty afterwards, the base
    unchanged, one `event=gate-failed` carrying the detail, **and the `node_modules` symlink still
    present** (the `clean -fd -e node_modules` clause, asserted at the level that uses it).
33. **A blocked path is a gate failure, not a crash** — the fake runner touches `host/supervisor.ts`
    inside the worktree; `gate-failed`, detail names the `why`.
34. **No verdict is a warning, not a failure** — stdout with no block; the report says the agent
    emitted none, the pass still lands if files changed, and the commit subject falls back to the
    goal title (never `chore: -`).
35. **Escape route one fires** — the fake runner writes into `deps.root`; one
    `level=error event=write-scope-escaped reason=tree-dirty` naming the path, and the file is
    **still there** (detection, not containment — the title says so).
36. **Escape route two fires** — a fixture repo with a local bare `origin`; the fake runner pushes;
    assert one `level=error event=write-scope-escaped reason=remote-moved`. A local bare remote, so
    the test needs no network and no SSH.
37. **The ff-miss recovery** — advance the base while the fake runner runs: the first
    `merge --ff-only` fails, a rebase happens, `gate` is called a **second** time, the merge
    succeeds. Then a second failure: `event=ff-miss`, base unchanged.
38. **Rotation advances once per landing pass and not on a dry run** — three passes cycle the keys;
    a dry-run pass does not move the index.
39. **`INSTANCE` is in the branch name and every path is project-relative** (INS-06) — under a probe
    `ENGINE_ROOT` and `INSTANCE=probe`: branch `nightly/probe`, worktree path and DB path both start
    with the probe root.
40. **SAF-07 is documented** — `NIGHTLY_SANDCASTLE_DRY_RUN`'s `why` contains `COSTS`, and
    `NIGHTLY_SANDCASTLE_MAX`'s contains `free`.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test host/jobs/nightly-sandcastle.test.ts` reports 39 passing.
- [ ] AC2 — **the kill switch fires.** Delete step 1. `npm test` exits non-zero on test 24. Revert.
- [ ] AC3 — **`not-on-base` fires.** Compare against a literal `"main"` instead of the knob.
      `npm test` exits non-zero on test 25 (the fixture's base is a temp branch name). Revert. N2
      F1's lesson: the guard must check the property it claims, and a hardcoded `main` is a guard
      against a different repo.
- [ ] AC4 — **`--ff-only` fires.** Change the merge to plain `git merge`. `npm test` exits non-zero
      on test 37's second half. Revert. **Record the output** — a silent non-ff merge at 3am is a
      merge commit nobody reviews.
- [ ] AC5 — **the re-gate fires.** Delete the second `gate(files, …)` in the rebase-retry path.
      `npm test` exits non-zero on test 37. Revert.
- [ ] AC6 — **the dry-run state gate fires.** Move `writeState` above the `DRY_RUN` return.
      `npm test` exits non-zero on test 29's fourth assertion. Revert.
- [ ] AC7 — **both escape detectors fire.** (a) Delete the porcelain comparison → non-zero on test
      35. (b) Delete the `origin/<BASE>` comparison → non-zero on test 36. Revert each. **(b) is the
      one that would otherwise be invisible**, since a push leaves the tree clean.
- [ ] AC8 — **SAF-06 fires.** Delete `only` from `nextGoal`'s signature and the `ONLY` read.
      `npm test` exits non-zero on test 31. Revert.
- [ ] AC9 — **SAF-07's documentation gate fires.** Remove `COSTS` from the dry-run knob's `why`.
      `npm test` exits non-zero on test 40. Revert.
- [ ] AC10 — **the env readers are right.** `grep -n "envStr(NIGHTLY_SANDCASTLE_ONLY_ENV\|envStr(NIGHTLY_SANDCASTLE_MODEL_ENV" host/jobs/nightly-sandcastle.ts`
      prints nothing (both use `envOptional`). Then swap one to `envStr` and confirm
      `NIGHTLY_SANDCASTLE_ONLY` unset makes the job **throw** — the failure `envStr` produces on a
      row with no default. Revert.
- [ ] AC11 — `node --test test/knobs.test.ts` reports 7 passing with the **seven** new rows; remove
      one from `ROWS` and confirm assertion 2 exits non-zero.
      `sed -n '/^### 2\.27/,/^### 2\.28/p' roadmap.md | grep -c 'NIGHTLY_SANDCASTLE_'` prints **6**
      (BASE, DRY_RUN, NO_MERGE, MAX, ONLY, MODEL) and `grep -c 'NIGHTLY_NO_SANDCASTLE'` prints `1`.
      Seven rows, six of them sharing the `NIGHTLY_SANDCASTLE_` prefix — the first draft said four.
- [ ] AC12 — `node --test test/writes.test.ts` reports 6 passing with
      `host/jobs/nightly-sandcastle.ts` in `REGISTER` as `project-relative` (reason: the
      `node_modules` symlink and the worktree). **Remove the row** and confirm door 3 exits non-zero
      saying the scan found a file the register does not name — the correct direction, and it only
      works because J3.3 added `symlinkSync` to `WRITE_MEMBERS`. Restore.
- [ ] AC13 — **nothing reached the real checkout.** After `npm test`: `git status --porcelain` empty,
      `git log --oneline -1` unchanged, `git worktree list | wc -l` prints `1`,
      `git branch --list 'nightly/*'` prints nothing, `git rev-parse origin/dev` unchanged, and
      `test -e .doppelganger && echo LEAK || echo clean` prints `clean`.
- [ ] AC14 — `time node --test host/jobs/nightly-sandcastle.test.ts` under 40 s. Seventeen real git
      repos under `mkdtempSync`. Record the measured value; if it exceeds 40 s, share one repo per
      group rather than loosening the bound.

**Commit:** `nightly-sandcastle: the pass, the landing, and the safe-run surface (JOB-C15, SAF-01…07, INS-06, KRN-07, INV-1)`

**Depends on:** J3.6, J3.11.

**Risks / what could be wrong:**
- **This is the largest job in the phase** — 17 tests, 14 ACs. Splitting it would put a half-written
  `exec` in a commit and the suite must be green at every commit. If the GAP step wants it split, the
  seam is step 13: "the pass up to the verdict" then "the landing", with tests 28-37 in the second.
- **Test 36 needs a real remote.** A **local bare repo** as `origin` (`git init --bare`) gives a real
  `rev-parse origin/<base>` and a real push with no network and no SSH — which is also why
  `GIT_SSH_COMMAND` is not the thing under test here (that is J3.3 test 9).
- **`deps.root` means "the agent never writes the checkout" only because `cwd` is the worktree.**
  J3.6 test 5 gates that; test 35 detects the residue if it fails.

---

## J3.13 — SKL-06 both ways, TST-23 live, TST-24, and the vocabulary that lives in markdown  ·  SKL-02, SKL-06, SKL-07, SKL-09, TST-23, TST-24

**Goal:** the gate that runs both directions over the real registry and the real filesystem, the one
that makes `parseVerdict` reproduce a vocabulary a human edits in markdown, and the `DB_NAMESPACES`
drift gate the first draft promised and never listed.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/test/skills.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/test/skills-example.test.ts` (tests 9 and 10 rewritten)

**Do — `test/skills.test.ts`, over `JOBS` and the real tree:**

1. **TST-23 live.** `check(JOBS, { renderedRoot: ".claude/skills", sourceRoot: "plugins" })` returns
   `[]`. The build gate SKL-04 promises: *drift FAILS the build; it is never silently re-rendered.*
   The failure message prints every finding, one per line.
2. **SKL-06, direction one.** Every `skillOf(job)` resolves to a real **source** directory
   `plugins/<job.plugin>/skills/<skill>/` holding a `SKILL.md`.
3. **SKL-06, direction two.** Every source skill directory under `plugins/*/skills/` is named by a
   registered job. *An orphan skill is a prompt nothing runs.*
4. **SKL-02.** No two jobs share a skill name, and no plugin contributes a skill whose name is the
   plugin's own name — the "one `/corpus` with a mode argument" shape, refused.
5. **The rendered set equals the source set equals the registry set.** Three sets, two `deepEqual`s.
   Replaces `test/skills-example.test.ts` test 9's hand-held comparison, which had no registry at N0
   and said so.
6. **SKL-09.** For every job, the file a human invokes at `/<name>` and the file the unattended pass
   uses are the same bytes. Stated separately from `drift` because SKL-09 is a claim about *identity
   of procedure*, and reading it out of a findings array buries it.
7. **SKL-07, the output vocabulary, both directions.** Parse `outcome=<a|b|c|d>` out of the **source**
   `SKILL.md` and `deepEqual` it to `OUTCOMES` imported from `host/jobs/nightly-sandcastle.ts`.
   **Neither side is written by this commit** — the markdown pre-dates N0's first code commit and
   `OUTCOMES` landed in J3.8 — so this is a real drift gate, not a number asserted by its own author.
8. **SKL-07, the authorization-token ban — narrowed to the report block, and scanned in BOTH copies.**
   Extract the `<<<SANDCASTLE … SANDCASTLE>>>` block from every source `SKILL.md` **and from every
   rendered `.claude/skills/*/SKILL.md`**, and assert neither contains a member of
   `AUTH_TOKENS = ["agent"]` (JOB-T03's, the row SKL-07 cites; N5). **Two changes from N0's
   stand-in, both deliberate:** the scope narrows from the whole file to the block, because a grant
   has to appear in what the skill EMITS to widen anything and the old scan banned an ordinary
   English word from prose; and the **rendered** copy is scanned too, because the rendered file is
   what the CLI actually loads and test 10 read only the source (the GAP step's catch — a
   hand-written rendered file with a token would have passed while `check` called it a `collision`
   rather than a grant).
9. **No skill reads the environment or names a path into its own files** (SKL-08, HRN-16) — carried
   from `test/skills-example.test.ts` test 8, now over every registered skill.
10. **Every skill directory name carries a SUP-20 stage prefix** — the third of TST-09's consumers,
    asserted where the directory list is already in hand.
11. **`DB_NAMESPACES` is derived from the code, not written beside it.** Walk every non-test `.ts`
    file under `kernel/`, `host/`, `cli/`, `plugins/` for `dbPath("<name>")` literals across every
    quote spelling, and assert the resulting set is a **subset** of `DB_NAMESPACES` — with the
    difference reported by name. Subset, not equality, because `DB_NAMESPACES` legitimately names a
    store the current code has not opened yet (`nightly`, until J3.12's `openDb` lands in the argv
    block). **This is the gate that would have caught `logtail`**: `tail.ts` opens `dbPath("log")`,
    so `log` must be in the list, and `logtail` — a table namespace, not a file — must not be
    mistaken for one. The test's comment states the DBS-02 distinction in one sentence so nobody
    re-introduces it.

**Do — `test/skills-example.test.ts`:** delete test 9 (superseded by test 5, which has a registry) and
rewrite test 10 to import `AUTH_TOKENS`, scope to the report block, and read both copies. Keep tests
1-8: they are the *worked example*'s own gate and must survive the general one, because a general
gate over a registry of one is exactly as strong as its one member.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test test/skills.test.ts` reports 11 passing and
      `test/skills-example.test.ts` reports 9 (was 10). Record both counts.
- [ ] AC2 — **the vocabulary drift gate fires from the markdown side.** Change
      `outcome=<changed|none|too-large|suite-failed>` to `outcome=<changed|none|too-large|failed>` in
      the source `SKILL.md`, re-render with `npm run skills sync`. `npm test` exits non-zero on test 7
      naming both lists. `git checkout plugins/ .claude/`. **This is the AC that proves the markdown
      and the code cannot drift apart.**
- [ ] AC3 — **and from the code side.** Remove `"too-large"` from `OUTCOMES`. `npm test` exits
      non-zero on test 7 **and** on `host/jobs/nightly-sandcastle.test.ts` test 1. Revert.
- [ ] AC4 — **SKL-06 direction two fires.** `mkdir -p plugins/nightly/skills/ops-ghost && cp
      plugins/nightly/skills/nightly-sandcastle/SKILL.md plugins/nightly/skills/ops-ghost/`;
      `npm test` exits non-zero on test 3. `rm -rf` it.
- [ ] AC5 — **SKL-06 direction one fires.** Change the job's `plugin` field to `"ops"`. `npm test`
      exits non-zero on test 2 naming the missing source directory. Revert.
- [ ] AC6 — **the auth-token ban fires where it should, not where it should not, and in both copies.**
      (a) Insert `agent=allow` inside the report block in the **source** + `npm run skills sync` →
      non-zero on test 8. Revert. (b) Insert `The agent decides what the change is.` into the skill's
      **prose** + sync → `npm test` exits **0**. Revert — this shows the narrowing was correct.
      (c) Insert `agent=allow` into the **rendered** copy only, without touching the source →
      non-zero on test 8, **and** on test 1 as `drift`. Revert. (c) is the case the first draft
      could not see.
- [ ] AC7 — **TST-23 live fires.** `printf '\n' >> .claude/skills/nightly-sandcastle/SKILL.md`;
      non-zero on test 1 with `drift`; `npm run skills sync` restores; `git status --porcelain` clean.
- [ ] AC8 — **assertion 11 fires.** Change `DB_NAMESPACES` to `["nightly", "logtail"]`. `npm test`
      exits non-zero on test 11 naming `log` as a `dbPath()` name absent from the list. Revert.
      **Record it** — this is the gate whose absence let the first draft ship a redirect that missed
      the log store.
- [ ] AC9 — `git status --porcelain` empty after every mutation is reverted, and
      `git diff --stat plugins/ .claude/` is empty.

**Commit:** `SKL-06 both ways, TST-23 live, and the vocabulary and DB-namespace drift gates (SKL-02, SKL-06, SKL-07, SKL-09, TST-23, TST-24)`

**Depends on:** J3.7, J3.9, J3.8.

**Risks / what could be wrong:**
- **Narrowing test 10's scope is a change to a landed N0 gate**, approved by the GAP step: a real
  weakening in one direction (prose may say "agent") and a real strengthening in two (derived from a
  named `AUTH_TOKENS` list, and now over the rendered copy as well). Recorded in Gaps.
- **`AUTH_TOKENS` has one member and its consumer is N5.** A denylist of one guarding a row that does
  not exist yet is close to a placeholder. Kept because SKL-07 names JOB-T03 explicitly and the
  alternative — no check until N5 — is what TST-24 exists to prevent.

---

## J3.14 — `host/run.ts`: the ONE argv block, and the command a scheduled tick actually spawns  ·  HRN-02, SKL-05, D10, SUP-03, §1

**Goal:** ruling 3's fix. One command that runs a job by name, one argv block where the real runner,
the real root and the real paths are assembled, and `jobRunner`/`commandOf` pointing at it — plus the
AC that would have caught the first draft's silent no-op.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/run.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/host/run.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/host/supervisor.ts` (`jobRunner`, one line in the argv block)
- `/home/hyhilman/projects/me/doppelganger/host/schedule.ts` (`commandOf`, the `job` branch only)
- `/home/hyhilman/projects/me/doppelganger/host/schedule.test.ts` (the `commandOf` shape assertion)
- `/home/hyhilman/projects/me/doppelganger/test/layout.test.ts` (assertion 15: what may live under `.doppelganger/`)
- `/home/hyhilman/projects/me/doppelganger/package.json` (`"job": "node host/run.ts"`)

**Do — ruling 3's two lines:**

```ts
// host/supervisor.ts argv block
jobRunner: (job: string) => [process.execPath, [projectPath("host/run.ts"), job]],
// host/schedule.ts commandOf — the `job` branch only; the `script` branch is untouched
const target = e.job !== undefined ? `host/run.ts ${e.job}` : (e.script ?? "");
```

Checked before writing: both crontab suites build their expected lines by **calling** `commandOf`, so
they derive; the one hand-built expectation (`cli/crontab.test.ts:356`) is on the `script` branch.

**Do — the dispatcher:**

```ts
export function resolveJob(name: string | undefined, jobs: readonly Job[]): Job | { error: string };
export function jobListing(jobs: readonly Job[]): string;                 // byStage — the SUP-20 payoff
export async function runNamed(job: Job, deps: PassDeps): Promise<number>; // exit code
```

- **Gate on the NAME, never on catching the import.** A job that throws while *loading* must surface
  as its own error, not be disguised as "no such job". Our registry is a hand-written list (SKL-05),
  so every job file is imported at module load and the failure surfaces before `resolveJob` — which
  is stronger than the reference's arrangement.
- `runNamed` dispatches D10's two shapes and no third: `job.exec` → call it with the assembled deps
  and return 0; otherwise `runJob(job, …)` and report `iterations`, `commits.length` and
  `completionSignal ?? "none"` on **stderr** (LOG-06: stdout stays free for the payload).
- **The argv block** assembles `runner: sandcastleRunner({ gitConfigGlobal: projectPath(".doppelganger/gitconfig"), gitSshCommand: "/bin/false" })`,
  `root: ROOT`, `worktreeRoot: projectPath(".doppelganger/worktrees")`,
  `runLogPath: n => projectPath(\`.doppelganger/runs/${n}-${utcStamp()}.log\`)`,
  `scratchRoot: projectPath(".doppelganger/scratch")`, `db: openDb(dbPath("nightly"))`, `git`, `now`,
  `log`, `runIn`, `jobs: JOBS`. **UNTESTED BY CONSTRUCTION** except the smoke checks below.
  `openDb` is called **inside** `runNamed`, after the kill switch, so a killed pass creates no file.

**Why the run log is `.doppelganger/runs/` and not `.doppelganger/logs/`:** sandcastle's run log is
human prose, not logfmt. Under `LOG_ROOTS` it would be walked by `tail.ts` (harmless — `parseLine`
returns null, as N1 settled for the `node:sqlite` warning) but it would also be subject to LOG-08's
copy-then-truncate rotation **while sandcastle holds it open in append mode**, which is a corruption
hazard for a file nothing needs rotated. One file per run keeps any single file small. Nothing prunes
the directory before `ops-retention` (JOB-O06, N5) — flagged in Gaps.

**Do — `test/layout.test.ts` assertion 15, closing N1 F4's blind spot one directory over.** Assertion
13 (no stray `*.db`) explicitly **excludes** `.doppelganger/`, and `.gitignore` covers it — the exact
pair that let `./leak.db` survive a whole phase (N1 F4). N3 starts writing real things there, so the
rule becomes an **allowlist of what may exist**: `state/`, `logs/`, `runs/`, `worktrees/`, `scratch/`,
`gitconfig`, `supervisor.heartbeat`, `supervisor.status.json`. Anything else is a leak, named in the
failure. A directory that does not exist passes trivially, so a fresh clone is green. Non-flaky (no
mtimes), and it grows by a signed row rather than by silence.

**Do (tests):**

1. `resolveJob(undefined, JOBS)` → an error naming `usage: npm run job <name>`.
2. `resolveJob("nope", JOBS)` → `unknown job "nope"` plus the available list.
3. `resolveJob("nightly-sandcastle", JOBS)` → `strictEqual` to the registry's object.
4. `jobListing(JOBS)` groups under the `nightly` stage heading and names the job.
5. `runNamed` with an `exec` job calls `exec` once, returns 0, and never calls the fake runner.
6. `runNamed` with a skill-only job calls the runner once and returns 0; a rejecting runner returns
   non-zero and the message reaches stderr rather than being swallowed.
7. **`commandOf` for a `job:` entry names `host/run.ts`**, not `host/jobs/<job>.ts` — and for a
   `script:` entry it is unchanged. Two assertions, in `host/schedule.test.ts`. **Ruling 3, pinned at
   the pure layer.**
8. **The argv smoke check** (child process, `ENGINE_ROOT` at a temp directory): `node host/run.ts`
   with no argument exits non-zero naming `usage`; `node host/run.ts nope` exits non-zero naming
   `unknown job`. A **smoke check, not a test**.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test host/run.test.ts` reports 7 passing and
      `host/schedule.test.ts` reports its previous count plus 2.
- [ ] AC2 — `npm run job` (no argument) exits non-zero and prints the job list grouped by stage;
      `npm run job nope` exits non-zero naming `unknown job "nope"`.
- [ ] AC3 — **the cheapest live proof the whole wiring works.**
      `NIGHTLY_NO_SANDCASTLE=1 npm run job nightly-sandcastle` exits 0 and its stderr carries one
      logfmt line with `event=killed`. This runs the **real** argv block — the real
      `sandcastleRunner`, the real paths — and stops before spending anything. Record the line.
- [ ] AC4 — **ruling 3's own AC: the jobRunner path is driven, not assumed.** In a child process,
      compute the exact command the supervisor would spawn and run it:
      ```
      node -e 'const {jobRunner}=await import("./host/run.ts")' # not this — jobRunner lives in the argv block, so:
      NIGHTLY_NO_SANDCASTLE=1 node "$(node -e 'import("./kernel/paths.ts").then(m=>console.log(m.projectPath("host/run.ts")))')" nightly-sandcastle
      ```
      exits 0 with `event=killed` on stderr. Then the negative control that proves the AC can fail:
      run `node host/jobs/nightly-sandcastle.ts` (the path the first draft's `jobRunner` would have
      spawned) and confirm it exits 0 with **no output at all**. **Record both.** The second command
      is what the first draft would have run every night, and the difference between the two outputs
      is the defect.
- [ ] AC5 — **`commandOf` and `jobRunner` agree.** `node -e` prints both the `commandOf` string for
      the fixture entry and the `jobRunner` argv, and the AC records that both name `host/run.ts`.
      Then revert `commandOf`'s `job` branch to `host/jobs/${e.job}.ts` and confirm `npm test` exits
      non-zero on test 7. Revert.
- [ ] AC6 — **the name gate is not a swallowed import.** Add `import "./does-not-exist.ts";` to
      `host/jobs/nightly-sandcastle.ts`. `npm run job nightly-sandcastle` exits non-zero with
      `Cannot find module` naming that specifier — **not** with `unknown job`. Revert.
- [ ] AC7 — **assertion 15 fires.** `mkdir -p .doppelganger && touch .doppelganger/leak.db`;
      `npm test` exits non-zero naming `leak.db` as an entry the allowlist does not cover. `rm` it.
      Then `touch .doppelganger/notes.txt` and confirm the same. **This closes N1 F4's blind spot**:
      the file is gitignored, so `git status` stays clean and nothing else would have seen it.
- [ ] AC8 — after AC3, `test -e .doppelganger/runs && echo present || echo absent` prints `absent`
      (the kill switch returns before any run log or DB is opened) and `git status --porcelain` is
      empty.
- [ ] AC9 — `node --test test/layout.test.ts` passes: `host/run.ts` is named in §1 by J3.1.
- [ ] AC10 — `node --test cli/crontab.test.ts cli/crontab-cli.test.ts` both pass unchanged — the
      `commandOf` edit touched only the `job` branch, and both suites derive their expected lines by
      calling it. Record that neither file was edited.

**Commit:** `host/run.ts: the one argv block, and the command a scheduled tick actually spawns (HRN-02, SKL-05, D10, SUP-03)`

**Depends on:** J3.3, J3.6, J3.8, J3.12.

**Risks / what could be wrong:**
- **The argv block assembles eleven real values and no test reaches it.** AC3 and AC4 are the
  mitigation: they run the real block end to end through **both** entry paths and stop at the kill
  switch, so a typo in any of the eleven surfaces as an exception rather than as a 3am silence.
- **`host/run.ts` imports `host/jobs/index.ts`, which imports every job**, so a supervisor-spawned
  child loads all of them. One job today, ~20 at N5, all module loads. Acceptable, and it is what
  makes SKL-05's "code declares" work.

---

## J3.15 — the first `SCHEDULE` entry and `PROGRAMS` row  ·  SUP-01, SUP-02, SUP-03, SUP-12, GAT-07, TST-09

**Goal:** the moment N3 exists for. One entry, one program row, and every `validate()` rule that has
only ever seen a fixture now sees a real value.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/schedule.ts` (`SCHEDULE`, `PROGRAMS`)
- `/home/hyhilman/projects/me/doppelganger/host/schedule.test.ts` (the empty-schedule assertion, the budget assertion)
- `/home/hyhilman/projects/me/doppelganger/host/window.test.ts` (the SUP-12 fixture-window assertion)
- `/home/hyhilman/projects/me/doppelganger/host/window.ts` (the header's N3 reminder, resolved)
- `/home/hyhilman/projects/me/doppelganger/.gitignore` (`.sandcastle/`)

**The entry:**

```ts
export const SCHEDULE: readonly ScheduleEntry[] = [
  {
    name: "nightly-sandcastle",
    cron: "38 16-21 * * *",
    job: "nightly-sandcastle",
    log: projectPath(".doppelganger/logs/nightly-sandcastle.log"),
    maxRunMin: 90,
    why: "hourly overnight (23:38–04:38 WIB): one small, verified improvement to this repo, gated on the full suite, an import smoke of every changed file and a dry run of every changed job (JOB-C15). :38 leaves the :08s free for nightly-polish (JOB-C16, N5) so the pair fires every 30 minutes without sharing a minute — both take the gate exclusively, non-blocking, so a shared minute would mean one silently skipping every night.",
  },
];

export const PROGRAMS: Readonly<Record<string, Program>> = {
  "nightly-sandcastle": { self: true, gate: "excl", resources: ["repo"], dotenv: true },
};
```

**Six field decisions, two of them corrected after review:**

- **`cron: "38 16-21 * * *"`** — inside the croner ∩ POSIX intersection N2 measured: `dow` is
  unrestricted, so the whole dom+dow divergence class (20 missed pairs across 14 March dates) cannot
  apply. Six firings a night.
- **`resources: ["repo"]` — `skills` is DROPPED, and the GAP step is right that the first draft had
  it backwards.** The pass reads `.claude/skills/` for its whole duration, but its only writer is
  `skills sync`, **an operator CLI that takes no gate at all** (J3.9's own statement). Holding
  `skills` `excl` for a whole pass would therefore exclude future scheduled entries from a resource
  nothing contends, buying nothing and costing JOB-C16's concurrency at N5. The read is unprotected,
  and that is INS-05's problem (a resource whose writer is outside the supervisor is not a gate
  problem) rather than GAT's. Written into the entry's comment and flagged in Gaps.
- **`self: true`** — GAT-06. A pass runs minutes; the next tick is an hour away, but a wedged pass
  under SUP-13's bound would otherwise overlap its successor exactly once.
- **`gateWait` unset** — GAT-08's zero, the old `flock -n`. A contended tick skips, because the next
  tick sees the same work.
- **`dotenv: true`** — SUP-04. `NIGHTLY_SANDCASTLE_BASE` lives in `.env` while this loop runs on
  `dev`, and it must reach the child.
- **`maxRunMin: 90`, raised from the first draft's 60, and now DERIVED rather than chosen.** The GAP
  step showed 60 nearly collides: `RUN_TIMEOUT_IMPL_MS` (40 min) + `GATE_TIMEOUT_MS` (5 min) × **2**
  (the ff-miss path re-runs the gate) = 50 min, plus worktree prep and reporting, against a 60-minute
  SIGKILL. **And the first draft's asserted relation checked a weaker property than it claimed** —
  `runTimeoutMs < maxRunMin*60_000` is true at 40 < 60 while the real budget is the sum. N2 F1's
  exact shape, in this plan's own text.

**The budget assertion, in `host/schedule.test.ts`:**

```
RUN_TIMEOUT_IMPL_MS + 2 * GATE_TIMEOUT_MS  <  maxRunMin * 60_000
      2_400_000     +   2 *   300_000      <      5_400_000
                3_000_000                  <      5_400_000        ✓ 2.4 min of headroom per 10
```

and the same for `RUN_TIMEOUT_MS`. Two numbers in two files agreeing by luck is the drift `TST`
refuses; if the runner's deadline plus its gate exceeded SUP-13's bound, the supervisor would SIGKILL
a pass that was about to report cleanly and the log would say `signal=SIGTERM` with no cause.

**`log:` is a module-scope `projectPath` call in `host/`, and door 6 does not fire — measured, and
that is a hole, not a blessing.** Door 6 matches a top-level call only when the line starts at column
0 or the call sits on the same line as `export const`. `SCHEDULE`'s entries are indented inside an
array literal, so the call is invisible — a limit the door's own comment already declares. This job
neither widens door 6 nor adds an exception; it records the reasoning (`projectPath` performs no I/O,
`ENGINE_ROOT` redirects it, SUP-01 requires the schedule to be DATA rather than a function, and
`tail.ts`'s `LOG_ROOTS` already does exactly this one layer down) and flags it in Gaps.

### Which `validate()` rules fire for the first time, and what could break

| rule | first real exercise | what could break |
|---|---|---|
| 2 — stage prefix | `nightly-sandcastle` | nothing; `nightly-` is in `STAGES` |
| 3/4 — cron grammar | `38 16-21 * * *` | a range in the hour field is the first non-`*` field the real schedule has carried |
| 5/6 — log absolute, under a root | `projectPath(".doppelganger/logs/…")` | **`LOG_ROOTS[0]` and this path must derive from the same `ROOT`.** Both are `projectPath`, so they do — but a test setting `ENGINE_ROOT` for one and not the other now fails rule 6 instead of silently passing |
| 10 — job file exists | `host/jobs/nightly-sandcastle.ts` via `jobsDir = projectPath("host/jobs")` | **the sharpest.** `cli/crontab.ts`'s `render()` calls `validate()`, so `npm run crontab render\|sync\|check` now stats a real path. J2.15/J2.16's tests redirect `CRONTAB_CMD` and the state file but keep the real `ENGINE_ROOT` — checked, they stay green; this row exists so the GAP step re-checks it |
| 14 — a `PROGRAMS` row exists | `PROGRAMS["nightly-sandcastle"]` | the first time rule 14 finds a row instead of erroring |
| 15 — resources are known names | `["repo"]` vs `RESOURCE_NAMES` | the first live coupling between `host/config.ts` and `host/schedule.ts` |
| 22/23 — bootstrap | no entry sets `supervised: false` | **`crontab render` still emits a managed block with zero command lines.** Nothing starts the supervisor yet — that is SUP-09/JOB-O10 at N4, and this job writes that sentence into `host/schedule.ts`'s header so it is not rediscovered |

**Three other things move the same day, each with an assertion:** `host/parity.test.ts`'s corpus is
`[...FORMS, ...SCHEDULE.map(e => e.cron)]` (N2's design, so the first entry is walked with no test to
remember) — `38 16-21 * * *` fires 84 times in 14 days · `supervisor --list`'s footer goes
`0 supervised` → `1 supervised` · `crontab check`'s tally goes `(0 more …)` → `(1 more …)`.

**SUP-12's live assertion, which N2 deferred to N3.** `REFRESH_WINDOW` is still `null` and N3 does
**not** invent one — declaring a window for a single job is inventing the subject (N2's own
discipline, which deleted three vacuous assertions). So `entriesInWindow(SCHEDULE, REFRESH_WINDOW,
PROGRAMS)` stays `[]` and no vacuous test ships. What **is** real: the same call over the **real**
`SCHEDULE` and **real** `PROGRAMS` with a **fixture** window covering 16:00–22:00 UTC returns exactly
`[{ name: "nightly-sandcastle", gate: "excl" }]`. It goes red if the cron moves out of the window or
the program's gate changes. `host/window.ts`'s "REMINDER FOR N3" header is rewritten to say the entry
landed, the window did not, and which phase gets one.

**Also:** add `.sandcastle/` to `.gitignore`. Measured, with `logging.path` set and
`branchStrategy: "head"`, sandcastle creates no such directory — but a human running
`npx @ai-hero/sandcastle init`, or a future strategy change, would, and an untracked directory inside
a worktree is a directory `git add` can sweep into a nightly commit.

**Do (tests):**

- `host/schedule.test.ts`: replace `assert.deepEqual(SCHEDULE, [])` with — `SCHEDULE` has one entry ·
  `validate()` over the real schedule does not throw (the first non-vacuous `validate(SCHEDULE)` in
  the repo's life) · `programOf` has a `PROGRAMS` row · the entry's `log` is under `LOG_ROOTS[0]` ·
  **the budget assertion above** · **`commandOf` names `host/run.ts`** (J3.14 test 7, living here).
- `host/window.test.ts`: the fixture-window assertion, plus the unchanged `null` case.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0. Record the new totals against the 375/373/2 baseline.
- [ ] AC2 — **`validate(SCHEDULE)` is now a real gate.** Change the entry's `cron` to
      `38 16-21 * * MON` (a `dow` name, outside the intersection). `npm test` exits non-zero from
      `host/schedule.test.ts`, **and** `npm run crontab check` exits non-zero with the same message.
      Revert. Two surfaces, one rule.
- [ ] AC3 — `node host/supervisor.ts --list` prints one row under a `nightly` stage heading and the
      footer `1 supervised, 0 on the real crontab`. Record the whole output — the first time this
      command has had anything to list.
- [ ] AC4 — **rule 10 fires.** Rename `host/jobs/nightly-sandcastle.ts` to `.bak`. `npm test` exits
      non-zero naming `job file does not exist: <abs path>`; `node host/supervisor.ts --list` still
      works (it never calls `validate`, SUP-17's own decision, J2.14). Restore.
- [ ] AC5 — **the parity corpus really grew.** `CRON_PARITY_RECHECK=1 node --test host/parity.test.ts`
      exits 0 and names `38 16-21 * * *`. Record `time node --test host/parity.test.ts` before and
      after.
- [ ] AC6 — **the SUP-12 fixture-window assertion fires, both ways.** Change the cron to
      `38 6-9 * * *` (outside the window) → non-zero on `host/window.test.ts`. Revert. Change the
      program's `gate` to `"shared"` → the same test goes red on the `gate` field. Revert. An
      allowlist row that only checks the name is half a row.
- [ ] AC7 — **the gate resource coupling fires.** Change `resources` to `["repo", "plugins"]`.
      `npm test` exits non-zero on rule 15 naming the unknown resource. Revert.
- [ ] AC8 — **the budget assertion fires.** Raise `RUN_TIMEOUT_IMPL_MS`'s default to `5_000_000`.
      `npm test` exits non-zero naming both operands and the sum. Revert. Then raise
      `GATE_TIMEOUT_MS` to `1_600_000` and confirm the **same** assertion fires — proving it checks
      the sum and not just the one term the first draft checked.
- [ ] AC9 — `npm run crontab render` still emits a managed block with zero command lines, and
      `npm run crontab check` (against a fake) reports
      `0 bootstrap entries (1 more run under host/supervisor.ts)`.
- [ ] AC10 — `git status --porcelain` empty after `npm test`; `test -e .doppelganger && echo LEAK ||
      echo clean` prints `clean`.

**Commit:** `the first schedule entry: nightly-sandcastle (SUP-01, SUP-02, SUP-03, SUP-12, GAT-07, TST-09)`

**Depends on:** J3.8, J3.14.

**Risks / what could be wrong:**
- **Rule 10 makes `cli/crontab.ts` depend on the real filesystem.** Every crontab test that keeps the
  real `ENGINE_ROOT` is fine; one that redirects it is not. Checked against J2.15/J2.16, but a red
  here reads as a crontab bug and is a schedule bug.
- **90 minutes is derived from three defaults that N3 has never measured under load.** J3.17 records
  the first real duration and the budget is retuned then, with evidence.

---

## J3.16 — TST-09: one name, four consumers  ·  TST-09, SUP-20, SKL-01, SKL-05

**Goal:** the job registry, the `host/jobs/` directory, the skill directories and the schedule
entries all name the same set, and every name carries a known stage prefix.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/test/jobs.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/test/model.test.ts` (the floor tightens to the registry)

**Do:**

1. **Every registered job's name carries a known SUP-20 prefix** — `stageOf(job.name) !== MISC`, with
   the message naming `STAGES`. The vocabulary is `kernel/stages.ts`'s, imported, never re-listed.
2. **The registry and the directory agree, both ways.** `JOBS.map(j => j.name)` sorted equals every
   `host/jobs/*.ts` minus `*.test.ts` and `index.ts`, sorted. **The list is what exists; the
   directory is only checked** (SKL-05) — the failure message says which side is which, because "add
   the file" and "register the job" are different fixes.
3. **Every registered job is default-exported by its own file**, and `(await import(f)).default.name`
   equals the filename. A job file whose default export names a different job would run under the
   wrong log, the wrong gate and the wrong skill.
4. **Every schedule entry naming a `job` names a registered one**, and every registered job appears
   at most once in `SCHEDULE`. (A registered job need not be scheduled — a job a human runs by hand
   is legitimate; an entry naming an unregistered job is not.)
5. **Every schedule entry name carries a known prefix** — already `validate()` rule 2, asserted here
   over the real `SCHEDULE` so the third consumer is covered by the same test as the others.
   **Non-vacuous only because J3.15 landed first**, which is why this job moved from 14 to 16: the
   alternative was shipping `[] === []`, the exact shape N2 deleted three of.

**And in `test/model.test.ts`:** the floor tightens from J3.10's derived-but-loose form to
`assert.equal(checked, JOBS.filter(j => j.exec === undefined || j.model !== undefined).length + runJobLiteralSites)`,
now that the registry is stable.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test test/jobs.test.ts` reports **5** passing, and
      `node --test test/model.test.ts` reports 7 (the tightened floor lands in that file, not this
      one — the first draft's AC counted six in the wrong file).
- [ ] AC2 — **the prefix gate fires, in three places at once.** Rename the job to
      `sandcastle-nightly` in its `defineJob`. `npm test` exits non-zero on assertion 1, **and** on
      `test/skills.test.ts` assertion 2 (the skill no longer resolves), **and** on
      `host/schedule.test.ts` via `validate()` rule 2. Record all three — SUP-20 says one name, three
      consumers, and this is the evidence. Revert.
- [ ] AC3 — **the registry/directory gate fires both ways.** (a) `touch host/jobs/ops-ghost.ts` with a
      valid default export → non-zero naming an unregistered file. `rm` it. (b) Remove
      `nightlySandcastle` from `JOBS` → non-zero naming an unregistered job. Revert.
- [ ] AC4 — **the default-export gate fires.** Change the `name` inside the `defineJob` literal to
      `"nightly-other"` while leaving the filename alone. `npm test` exits non-zero on assertion 3.
      Revert.
- [ ] AC5 — **the schedule coupling fires.** Change the entry's `job` to `"nightly-other"`.
      `npm test` exits non-zero on assertion 4 **and** on `validate()` rule 10. Revert.
- [ ] AC6 — **the tightened floor is derived.** Add a second job to `JOBS` (a `defineJob` with a
      `model`); `test/model.test.ts` stays green. Remove its `model`; it goes red. Remove the fixture.
- [ ] AC7 — `git status --porcelain` empty after `npm test`.

**Commit:** `TST-09: one name across the registry, the directory, the skills and the schedule (TST-09, SUP-20, SKL-01, SKL-05)`

**Depends on:** J3.8, J3.13, J3.15.

**Risks / what could be wrong:**
- **Assertion 3 imports every job file**, running its module scope. `host/jobs/nightly-sandcastle.ts`
  reads `EnvSpec` defaults at module scope like every other file, but must not open a database or
  touch git there. If it does, this test finds out — the good failure.
- **Assertion 4's "at most once" is weaker than "exactly once".** A registered job with no schedule
  entry is legitimate at N3 and becomes suspicious at N5 when the `ops` builtins arrive. Stated, not
  enforced.

---

## J3.17 — the manual step: one real pass, and its stdout becomes the fixture  ·  JOB-C15, TST-19, HRN-11, SAF-07

**Goal:** the only thing in N3 a test cannot do. One real agent pass, on a real login, with the real
skill, and the artifact committed so every later parser test is fed real data.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/jobs/fixtures/sandcastle-real-<YYYY-MM-DD>.txt` (new)
- `/home/hyhilman/projects/me/doppelganger/host/jobs/nightly-sandcastle.test.ts` (one test added)
- `/home/hyhilman/projects/me/doppelganger/LOOP.md` (a settled-question entry recording the run)

**Do — the human runs exactly this, in this order:**

```bash
# 0. Preconditions, each checked and recorded.
claude --version                       # a logged-in CLI on this host
git rev-parse --abbrev-ref HEAD        # must equal NIGHTLY_SANDCASTLE_BASE
git status --porcelain                 # must be empty
wc -l ~/.gitconfig; md5sum ~/.gitconfig   # recorded; re-checked at the end (ruling 6)
git rev-parse origin/dev               # recorded; re-checked at the end (ruling 6, route two)

# 1. The free smoke first — proves the wiring without spending anything.
NIGHTLY_SANDCASTLE_MAX=0 NIGHTLY_SANDCASTLE_BASE=dev npm run job nightly-sandcastle

# 2. The one paid pass. SAF-07: this dry run is NOT free — it runs the agent.
NIGHTLY_SANDCASTLE_DRY_RUN=1 NIGHTLY_SANDCASTLE_BASE=dev \
NIGHTLY_SANDCASTLE_ONLY=docs-vs-code npm run job nightly-sandcastle \
  2> .doppelganger/runs/first-pass.stderr
```

`NIGHTLY_SANDCASTLE_ONLY` is used here on purpose: SAF-06 exists so one brief can be debugged end to
end, and the first paid pass is exactly that occasion. It is also the run that proves SAF-06 works.

**What must be observed and written into the commit body, verbatim:**

1. the `event=pass-start` line, with `goal=` and `model=`;
2. the raw `<<<SANDCASTLE … SANDCASTLE>>>` block the model emitted;
3. the parsed `outcome=`, and whether `parseVerdict` returned non-null;
4. `completionSignal` — fired or `none`;
5. **iterations and wall-clock duration** — the first real numbers behind `maxRunMin: 90` and
   `RUN_TIMEOUT_IMPL_MS`. If the pass is anywhere near the budget, J3.15's numbers are retuned in
   this commit;
6. **`wc -l ~/.gitconfig` and `md5sum ~/.gitconfig` before and after — must be identical**, against a
   file that is 4,529 lines long (ruling 6, on a real run);
7. **`git rev-parse origin/dev` before and after — must be identical** (ruling 6, route two);
8. `git status --porcelain` and `git log --oneline -1` before and after — identical (`DRY_RUN=1`);
9. the contents of `.doppelganger/gitconfig` — `safe.directory` for the worktree path;
10. **whether the agent's own `git commit` inside the worktree succeeded**, which is the practical
    test of the GAP step's inheritance finding.

**Then:** copy the agent's raw stdout into `host/jobs/fixtures/sandcastle-real-<date>.txt` and add a
test that `parseVerdict` accepts it. **TST-19 says fixtures are lifted from REAL data, never
invented** — this is the commit where that becomes true. Keep the template-derived fixture as its own
test (it checks the *documented* shape); the real one checks the *observed* shape, and the difference
between them is worth knowing.

**If the pass fails**, the commit still lands: the failure output becomes the fixture for a
`parseVerdict → null` test, LOOP.md records what broke, and N3 is not done until a later run
succeeds. **A failing first pass is a result, not a reason to skip the step.**

**Acceptance criteria:**

- [ ] AC1 — the free smoke (`MAX=0`) exits 0, emits `event=free-smoke`, and `git status --porcelain`
      is empty afterwards. Record the elapsed time.
- [ ] AC2 — the paid pass exits 0 and its stderr contains a `<<<SANDCASTLE` block. Record the block.
- [ ] AC3 — `parseVerdict` over the recorded stdout returns a non-null verdict whose `outcome` is in
      `OUTCOMES`. `npm test` exits 0 with `host/jobs/nightly-sandcastle.test.ts` reporting one more
      passing test than before.
- [ ] AC4 — **the fixture is real.** `git show --stat` shows the file added, and
      `grep -c 'outcome=<' <fixture>` prints `0` — a template carries the angle brackets, an answer
      does not.
- [ ] AC5 — **ruling 6 holds on a real run.** `wc -l ~/.gitconfig` and `md5sum ~/.gitconfig`
      unchanged across the whole session, and `grep -c safe.directory .doppelganger/gitconfig` ≥ 1.
- [ ] AC6 — **route two holds on a real run.** `git rev-parse origin/dev` unchanged.
- [ ] AC7 — **nothing landed.** `git log --oneline -1` and `git status --porcelain` unchanged;
      `git branch --list 'nightly/*'` shows the branch (the worktree existed) and
      `git worktree list | wc -l` prints `1` (it was torn down).
- [ ] AC8 — **`.doppelganger/` holds only allowlisted entries.** `npm test` still passes assertion 15
      after a real run has created `state/`, `logs/`, `runs/`, `worktrees/` and `gitconfig`. This is
      the assertion's first contact with real content, and if it goes red the allowlist was wrong,
      not the run.
- [ ] AC9 — `npm test` exits 0 and `git status --porcelain` shows only the intended files.
- [ ] AC10 — LOOP.md gains a "settled questions" bullet naming the date, the model, the outcome, the
      duration and the iteration count. **This is the entry the GAP and VERIFY steps read to know the
      real path was exercised**; without it, layers A and B are all N3 can claim.

**Commit:** `nightly-sandcastle: the first real pass, and its stdout as the TST-19 fixture (JOB-C15, TST-19, HRN-11, SAF-07)`

**Depends on:** J3.15.

**Risks / what could be wrong:**
- **This job cannot run on CI and cannot run unattended.** It is the phase's one human dependency. If
  the loop is driven by an agent, the agent must stop here and ask.
- **It costs one Opus pass at `effort: high` with up to 20 iterations.** Step 1's free smoke is not
  optional — it catches every wiring fault for free, so the paid pass is spent on the question only a
  model can answer.
- **A first pass reporting `too-large` or `none` is a success**, not a retry trigger. The fixture is
  still real and `parseVerdict` still has to accept it.
- **`DEFAULTS.permissionMode` is exercised for the first time here** — J3.2 made it
  `bypassPermissions`, the value this job uses, precisely so this run exercises the default rather
  than a value nothing uses.

---

## J3.18 — close N3  ·  §3, `WORK.md`, `LOOP.md`

**Goal:** tick 34 boxes, and fix the two places the bookkeeping is already wrong — before
`test/layout.test.ts` assertion 14 finds them.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/WORK.md` (34 boxes)
- `/home/hyhilman/projects/me/doppelganger/LOOP.md` (phase table, settled questions, open items)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§3's N3 `**Ships:**` line)

**Do — the roadmap fix, which is not optional:**

Assertion 14 compares §3's `**Ships:**` list against WORK.md's ticked IDs **for every SHIPPED phase**.
Ticking N3 makes it SHIPPED, and the two lists **disagree today**:

| roadmap §3 N3 says | WORK.md N3 says | why |
|---|---|---|
| `HRN-10…19` | `HRN-10…16` | HRN-17 moved to N5 (`plugin-names.test` needs plugins); HRN-18/19 shipped at **N1** and are in N1's Ships line |
| `SAF-01…08` | `SAF-01…07` | SAF-08 cut by D17 (the safe-run table is a doc) |

So:

```
**Ships:** HRN-01…02, HRN-07, HRN-10…16, SKL-01…10, JOB-C15, SAF-01…07, INS-06,
TST-08, TST-09, TST-19, TST-23, TST-24.
```

**A latent bug found before it fires:** assertion 14 has never checked N3 because N3 has never been
SHIPPED, and the moment it is, the suite goes red on a documentation line.

**Do — `WORK.md`:** tick all 34, each `- [x] (J3.n) **ID** …` naming the job that shipped it (the
J2.18/J1.20 format). **SAF-06 is ticked by J3.12's `NIGHTLY_SANDCASTLE_ONLY`, not silently** — the
GAP step found it had zero implementation in the first draft, and a box ticked over nothing is the
one thing this loop's bookkeeping exists to prevent. Add the honest end-of-phase claim:

> **A real entry exists, a real job file backs it, and the exact command the supervisor spawns runs a
> real agent against a real skill, gates its diff on the full suite plus an import smoke plus a dry
> run, and lands it with `merge --ff-only`. The loop is not yet safe to leave alone: nothing parks on
> a quota wall, a killed pass leaves a lease nobody reaps, no watchdog says when it stops, and
> nothing starts the supervisor. That is N4.**

**Do — `LOOP.md`:** phase table `N3 → ✅` (or `⚠` if J3.17's first pass failed and no second has run).
Move resolved items out of "Open items" and add this phase's settled questions — at minimum:
`@ai-hero/sandcastle` is real and its measurements · **`jobRunner` spawns `host/run.ts <job>`, not the
job file, and the first draft's version would have run nothing silently** · `run()` writes
`~/.gitconfig` (4,523 duplicate entries on this host) and `GIT_CONFIG_GLOBAL` is the fix, inherited by
the agent, needing its parent directory to exist · an unattended agent can reach `origin` over SSH and
`GIT_SSH_COMMAND=/bin/false` is the gate · layer B (a fake `claude` on `PATH`) makes the real `run()`
path testable for free · "pinned" is a shape predicate plus an alias denylist plus a runtime
`assertPinned`, never an exact value · the CLI's advertised permission-mode list, its accepted set and
sandcastle's type union are three different lists.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0. **Assertion 14 checks N3 for the first time** — record that it passes
      and record the corrected Ships line.
- [ ] AC2 — **assertion 14 really fires on N3.** Put `HRN-17` back into the roadmap's N3 Ships line.
      `npm test` exits non-zero naming the disagreement. Revert. Without this the fix is a claim.
- [ ] AC3 — **assertion 12 flips from exempt to must-exist.** With N3 SHIPPED, every §1 row tagged
      `N3` must exist. `git mv kernel/ports/runner.ts kernel/ports/runner.bak`; `npm test` exits
      non-zero with `§1 names kernel/ports/runner.ts as v0,N3, but it is absent from disk`. Restore.
      **This is the moment every §1 row J3.1 wrote is proved to have been built.**
- [ ] AC4 — `grep -c '^- \[ \]' WORK.md` in the N3 section prints `0`; `grep -c '^- \[x\]' WORK.md` in
      the N3 section prints `34`. Both read from the file, never written into a test.
- [ ] AC5 — `npm run skills check` exits 0 and `npm run crontab check` (against a fake) exits 0 — the
      two operator gates N3 shipped, run at the end of the phase.
- [ ] AC6 — **the phase's own goal, run once more end to end.**
      `NIGHTLY_NO_SANDCASTLE=1 node "$(node -e 'import("./kernel/paths.ts").then(m=>console.log(m.projectPath("host/run.ts")))')" nightly-sandcastle`
      exits 0 with `event=killed`. The jobRunner path, driven at the close of the phase as well as at
      J3.14.
- [ ] AC7 — `git status --porcelain` shows exactly three modified files.
- [ ] AC8 — the phase is pushed: `git push origin dev` and the CI run is green. Record the run URL, as
      J0.13 AC4 now requires at the end of every phase.

**Commit:** `close N3: 34 items, and fix §3's Ships line before assertion 14 reads it (§3, WORK.md, LOOP.md)`

**Depends on:** every other job.

**Risks / what could be wrong:**
- **AC3's mutation is the only proof every §1 N3 row was built.** If a file J3.1 named was quietly
  dropped, this is where it surfaces — late, but before N4.
- **If J3.17's real pass has not happened**, the phase table gets `⚠`, not `✅`, and LOOP.md's open
  items carry the reason. N2's own `⚠` for a missing VERIFY pass is the precedent.

---

## Summary of the resolved tensions

| Tension | Resolution |
|---|---|
| **`ports/runner` names `@ai-hero/sandcastle` (D2) and this repo has one dependency** | **Real, and N3 adds it pinned exact as the second.** Measured and independently reproduced: `0.12.0`, MIT, `added 7 packages`, ~15 MB (14 MB of it source maps), one runtime dep (`@clack/prompts`), both peers `optional: true` so `npm install`/`npm ci`/`npm ls --all` exit 0. Typechecks clean under this repo's exact tsconfig. Importing both entry points with stdin closed: 97 ms, zero files. **The Node floor it imposes is `>= 20.12.0`** (`@clack/core` imports `node:util.styleText`), below this repo's `>=22.18.0`, so no N0 decision reopens. `test/deps.test.ts` grows an **importer register** so both dependencies are single-importer claims across all four import spellings, and test 4 pins each package's declared dependency set, peer optionality and engine floor at the version the lockfile resolves — claims that cannot rot without a lockfile commit. |
| **A suite cannot make paid model calls, and a mock that never talks to a model proves nothing** | Three layers, each with its limit stated. **A** — `buildPrintCommand` is a pure function on the real provider, so the exact command is assertable free: `permissionMode` unset yields a command with **no permission flag at all**. **B** — the whole `run()` path against a **fake `claude` on `PATH`**: 104 ms here, 63–69 ms when the GAP step rebuilt it from this description alone. Real library, real git repo, real signal matching, real sentinel, real `GIT_CONFIG_GLOBAL` redirect, on every commit and on CI. Four failure modes measured, including the fresh-clone `could not lock config file` case. **C** — J3.17's one manual pass, whose real stdout becomes the TST-19 fixture. Nothing in a suite proves a real model emits a parsable block; J3.17 is the only thing that does, and N3 is not done without it. |
| **THE HEADLINE: the scheduled entry would have run nothing, silently, every night** | N2's `jobRunner` spawns `host/jobs/<job>.ts` and `commandOf` renders the same path; the first draft's only argv block was in `host/run.ts`. A real tick would have evaluated module scope, exported a `Job`, and **exited 0** with a `job-ok` line to say so — the phase's own acceptance bar, failed by its own plan. **Fixed by two lines**: `jobRunner` returns `[execPath, [projectPath("host/run.ts"), job]]` and `commandOf`'s **`job` branch only** renders `host/run.ts <job>`. Cheap, because both crontab suites build expected lines by *calling* `commandOf` and the one hand-built expectation is on the `script` branch — checked by reading both files. Rejected alternative: an argv block per job file, which duplicates the assembly of eleven impure values twenty times by N5. **And the AC that would have caught it is now mandatory at two layers**: J3.14 AC4 drives the exact jobRunner command with the kill switch set and requires `event=killed`, with a negative control that runs the job file directly and records its silent, output-free exit 0; J3.18 AC6 repeats it at the close of the phase. |
| **Two owners for one worktree** | The first draft had `runJob` prep from `job.worktree` and tear down in its `finally` while `exec` prepped its own and committed from it — so with the field set the tree vanished before the verdict was parsed, and without it `runJob` passed `cwd: deps.root`, the live checkout, and `{{WORKTREE}}` threw. **Ruling: `RunJobDeps` carries a required `cwd`, `runJob` never prepares or removes a worktree, and `Job.worktree` is dropped at N3.** The caller that owns the pass owns the tree, because prep → run → verdict → gate → land → teardown is one life cycle and splitting it across two modules is what produced the bug. `{{WORKTREE}}` stays in `runJob`, substituted from an arg the caller supplies. Gated, not promised: J3.6 test 5 asserts `runjob.ts` names neither `prepWorktree` nor `teardownWorktree`, and AC2's mutation adds one back. Cost stated: HRN-12's "the **runner** realizes it" is a claim about a **dispatched** run reaching a node with no tree, and there is no dispatch until M9 — so `Job.worktree` returns then, as the field a `TaskSpec` carries across the socket, which is what it was always for. |
| **`exec`'s deps did not satisfy `runJob`'s** | The first draft quoted five fields in one place and six in another, and `worktreeRoot` and `logPath` never arrived. **One interface, quoted twice by construction:** `RunJobDeps` is four fields (`runner`, `cwd`, `logPath`, `env?`) and J3.12's `PassDeps` **builds one from its own eleven**, so the two lists cannot drift — `exec` writes `{ runner, cwd: wt.path, logPath: runLogPath(passName) }` and nothing else can be omitted without a type error. |
| **`run()` writes `~/.gitconfig`, and the scale is three orders of magnitude worse than first measured** | **Measured, not read.** `run()` unconditionally executes `git config --global --add safe.directory` plus `user.name`/`user.email` on the host under `noSandbox`. This machine's `~/.gitconfig` is **4,529 lines carrying 4,523 `safe.directory` entries, 4,448 of them the same `xenith` line** — every `git` invocation on the host parses it. Three problems: INS-02 has no third category for a machine-global write · it is **HRN-18's `~/.gitconfig` race with its cause finally named** · it grows one line per run forever. **Closed by `noSandbox({ env: { GIT_CONFIG_GLOBAL: … } })`,** with three further measurements shaping the design: **the agent child inherits it** (added by the GAP step, reproduced here — and it is what makes the agent's own commits inside the worktree work at all) · **the parent directory must exist**, or `run()` rejects with `could not lock config file`, which is the fresh-clone case and why `sandcastleRunner` must `mkdirSync` (a real write, and therefore the door-3 row that fixes the first draft's inverted AC) · **the key goes on exactly one provider**, or `run()` throws `Overlapping env keys`. The RED mutation runs in a child with `HOME` at a `mkdtempSync` path, so it cannot reach the real 4,529-line file. |
| **Nothing stopped the agent pushing, and the escape check could not see it** | `origin` is SSH; `GIT_CONFIG_GLOBAL` strips a credential helper but not `~/.ssh`; a `git push` leaves the tree **clean**, so the porcelain comparison is blind to it. **Measured with a fake `claude` running `git ls-remote origin` inside a real run: `REMOTE_REACHABLE=yes` without `GIT_SSH_COMMAND`, `no` with `GIT_SSH_COMMAND=/bin/false`.** N3 ships **both halves**: the gate (`GIT_SSH_COMMAND=/bin/false` in the same `noSandbox({ env })`, one line, the plumbing already there) and the detector (`git rev-parse origin/<base>` before and after, logging `write-scope-escaped reason=remote-moved`), because a gate one env var from deletion needs one. J3.3 AC8 mutates the gate; J3.12 AC7(b) mutates the detector, using a **local bare repo** as `origin` so the test needs no network and no SSH. |
| **HRN-11 was defeated by this plan's own knob** | `NIGHTLY_SANDCASTLE_MODEL=opus` in `.env` produces exactly the floating alias the build gate bans, and a source-text scan cannot reach an env value. **Fixed by `assertPinned(model)` at the one place `RunRequest.model` is built** (`runJob` step 4), using the **same** `PINNED`/`ALIASES` predicate exported from `kernel/ports/job.ts` that J3.10's static scan imports — one rule, two enforcement points, no second copy to drift. J3.6 AC4 deletes the call and watches test 9 go red. Separately: `*_MODEL` and `*_ONLY` carry neither `required` nor `default`, so they are read with **`envOptional`, not `envStr`** — `envStr` throws on a row with no default, and J3.12 AC10 proves it by swapping one and observing the throw. |
| **`DEFAULTS.permissionMode = "auto"` guarded nothing** | The claim "`auto` does not hang" is unmeasurable without a real run that reaches a tool prompt, and no N3 job used `auto` — a default nothing exercises. **Fixed twice over: `Job.permissionMode` becomes REQUIRED, and `DEFAULTS.permissionMode` becomes `"bypassPermissions"`, the value the one real job uses.** Required-plus-real beats optional-plus-aspirational on three counts: HRN-07 becomes a **compile error** (J3.2 test 8 is an `@ts-expect-error` on a literal that omits it) · the default is exercised on every run including J3.17's · and nothing is silently inherited, so J3.10's "a bypass run declares `local: true`" scan is reachable for every write-capable job, which a silently-inherited bypass would defeat. HRN-01 still holds — `DEFAULTS` is one place and the call site spells `DEFAULTS.permissionMode`. **Making an optional field required is a deviation from PRT-05's shape and is flagged.** |
| **Three permission-mode vocabularies, none equal** | Measured: the installed CLI 2.1.246 validates in 0.2 s and advertises `acceptEdits, auto, bypassPermissions, manual, dontAsk, plan` — but probing all seven values shows **`default` is also accepted**, correcting a claim made during review, while `manual` is accepted and is **absent from sandcastle's type union** and `default` is **in** that union but absent from the CLI's own list. N3 pins none of them: it owns a two-member `PERMISSION_MODES` allowlist (`auto`, `bypassPermissions`), gates every literal against it, records the divergence in a dated comment, and re-probes under an opt-in `CLI_MODES_RECHECK=1` that prints and asserts nothing — the `CORPUS_RECHECK` precedent. |
| **`DB_NAMESPACES` named a table namespace, not a file — and every AC still passed** | `kernel/runtime/log/tail.ts` has `NS = "logtail"` (the DBS-02 **table** namespace) but opens `dbPath("log")`, so the file is `log.db` and the knob is `LOG_DB`. The first draft's `["nightly","logtail"]` would have set `LOGTAIL_DB`, which nothing reads, and **tier 4's scratch redirect would have missed the log store entirely** while a dry run wrote the live `log.db`. Fixed to `["nightly","log"]`, verified by scanning every `dbPath(` call site (exactly one non-test caller), and — the part the first draft was missing — **J3.13 assertion 11 derives the required set from those call sites** instead of trusting a constant written beside the code it describes. J3.11 AC4 restores `logtail` and watches it go red. |
| **Two register ACs were inverted, and `WRITE_MEMBERS` had a one-spelling hole** | Door 3 is an exact `deepEqual` between a scan and the register, so **adding** a row for a file the scan does not find is what turns the suite red — the first draft's "remove the row and confirm non-zero" was backwards in two jobs. And `symlinkSync`/`symlink` were **absent from `WRITE_MEMBERS`** (LOOP.md's standing rule, sixth occurrence), which J3.12's `node_modules` symlink needs. Fixed in order: J3.3 adds both members and proves the hole with a mutation, and adds `mkdirSync` to `host/runner.ts` (ruling 6's fresh-clone fix), which is what makes that file's row legitimately required. Then J3.12's row is legitimately required too, and both ACs are stated in the correct direction. |
| **`skills sync` is the phase's only `rm -rf` and its scoping was two caller-supplied strings** | The crontab tool's most important half is layer 0 — `isAbsolute(cmd)`, which turned "be careful" into "cannot happen" (J2.16) — and the first draft ported the verbs without it. **`assertSafeTree(tree, root)` now runs at the top of every verb**, refusing a `renderedRoot` that is not absolute, not inside `ROOT`, equal to `ROOT`, or not named `skills` — four refusals, four tests, reached through `run(argv, deps)` for all three verbs. **This is what makes J3.9 AC9's mutation safe to perform**: widening the prune still cannot escape `<ROOT>/.claude/skills`. |
| **SAF-06 had zero implementation and would have been ticked silently** | One of WORK.md's 34 items, absent from the first draft entirely. **`NIGHTLY_SANDCASTLE_ONLY=<goal-key>`** forces one rotation entry instead of the cycle, throwing on an unknown key rather than silently rotating — a real operator need, and J3.17 uses it for the first paid pass, which is also what proves it works. A box ticked over nothing is the one thing this loop's bookkeeping exists to prevent. |
| **The pass budget nearly collided with `maxRunMin`, and the assertion checked a weaker property** | 40 min impl timeout + 5 min gate × **2** (the ff-miss path re-gates) = 50 min against a 60-minute SIGKILL, and the first draft asserted `runTimeoutMs < maxRunMin*60_000` — true at 40 < 60 while the real budget is the sum. N2 F1's exact shape, in this plan's own text. **Fixed both ways:** `maxRunMin` rises to 90, and the assertion becomes `RUN_TIMEOUT_IMPL_MS + 2*GATE_TIMEOUT_MS < maxRunMin*60_000` (3,000,000 < 5,400,000). J3.15 AC8 mutates **each** operand separately and requires the same assertion to fire for both, which is what proves it checks the sum. |
| **The entry held `skills` `excl` for a whole pass, excluding nothing** | The first draft over-excluded on the theory that a rewrite of the skill tree mid-pass changes the prompt under a running agent. True — but J3.9's own text says `skills sync` is an **operator CLI that takes no gate at all**, so there is nothing to order against, and holding it would cost JOB-C16's concurrency at N5 for no protection. **`resources: ["repo"]`**, with the unprotected read written into the entry's comment as INS-05's problem (a resource whose writer is outside the supervisor is not a gate problem) rather than GAT's. |
| **`taskClass` and `local` had no consumer, and one of the two fixes was rejected** | `taskClass` gets a real N3 consumer — `runTimeoutMs(job)` feeding the run's abort deadline — and both ceilings are `EnvSpec` rows with `RUN_TIMEOUT_MS`'s `why` stating plainly that **it is unread at N3**, since the only job is `impl`-shaped. `local` does **not**: the first draft made it an authorization precondition (`runJob` throws on a bypass run without it) and that was **rejected** — HRN-14 is a *placement* field, giving one field two meanings would pin a safety-`local` job off the pool at M9 for no dispatch reason. **The approved substitute is this plan's own fallback**: J3.10 test 7, a source scan requiring any job literal whose `permissionMode` resolves to `bypassPermissions` — as the literal **or** as `DEFAULTS.permissionMode` — to carry `local: true`. |
| **SKL-10's five findings did not cover a missing SOURCE, and the auth-token scan read the wrong file** | Two additions, both approved. **`source-missing`** is a sixth finding and a sentence added to §2.30 SKL-10 — without it `check` reports `missing` and `sync` throws a raw `ENOENT` reading a file that is not there. And the SKL-07 auth-token ban, narrowed from N0's whole-file `!includes("agent")` to the `<<<SANDCASTLE>>>` block, is now scanned in **both the source and the rendered copy** — the rendered file is what the CLI loads, and N0's test read only the source, so a hand-written rendered file carrying a token would have passed while `check` called it a `collision` rather than a grant. J3.13 AC6 has three mutations: a token in the source block (red), the word "agent" in prose (green — the narrowing was correct), and a token in the rendered copy only (red on two tests). |
| **HRN-12: who creates and destroys the worktree, and what a killed pass leaves behind** | **This repo creates it** — `git worktree add -B nightly/<INSTANCE> <path> <base>` through `kernel/runtime/exec.ts` — and sandcastle is pointed at it as `cwd` with `branchStrategy: { type: "head" }`. None of sandcastle's three strategies fits: `merge-to-head` merges **before** our gate runs, `head`-on-the-checkout writes the live tree, and `branch` leaves the worktree path out of `RunResult`. The chosen combination was measured to create no `.sandcastle/` directory and to merge nothing. **The crash case has three answers, in order:** `prepWorktree` is idempotent and hard-resets an existing tree onto the base with `clean -fd -e node_modules` (so the next pass reclaims it and the symlink survives) · `reapWorktrees` removes registered worktrees under a project-relative root that are not the live one · `git worktree prune` runs first for a deleted-directory-still-registered entry. Nothing on a timer, nothing outside `under` — asserted by its own test, because a reaper that removes a worktree it did not create is worse than one that removes nothing. |
| **SAF-07's "one non-free dry run" for this job** | **`NIGHTLY_SANDCASTLE_DRY_RUN=1`.** Inert against the repository — no commit, no `merge --ff-only`, no rotation-state write — and it **runs the agent**, so it spends one Opus pass. `NIGHTLY_SANDCASTLE_MAX=0` is the free one. Both facts live in the two knobs' `EnvSpec.why` lines, which KRN-06 makes the knob doc, and a test asserts the dry-run row's `why` contains `COSTS` and the max row's contains `free` — SAF-07's "must be documented as such" as a failing assertion. **And SAF-07 meets tier 4 head-on**: a job whose `*_DRY_RUN` runs an agent makes the ship gate spend a *second* Opus pass on itself. Today `BLOCKED` forbids a pass touching the only registry job, so tier 4 is dormant by construction — stated as a limit, and flagged as a real design question for N5's second job. |
| **`nightly-sandcastle` modifies this repo and the suite must never commit to `dev`** | Eight layers, each with a test: **required `deps`** (one interface, quoted twice by construction) · the KRN-07 kill switch · `*_MAX=0` · `*_DRY_RUN=1` · `*_NO_MERGE=1` · `*_ONLY` · a **`not-on-base`** refusal comparing HEAD to a **knob**, not a literal (AC3 mutates it to a hardcoded `main` to prove the guard checks the property it claims — N2 F1) · and a **`tree-dirty`** refusal. Every test reaching `exec()` points `deps.root` at a `mkdtempSync` git repo, and each job's ACs re-check `git status --porcelain`, `git log --oneline -1`, `git branch --list 'nightly/*'`, `git rev-parse origin/dev` and `git worktree list \| wc -l` against the real checkout. |
| **N1 F4's blind spot, one directory over** | `test/layout.test.ts` assertion 13 explicitly **excludes** `.doppelganger/` and `.gitignore` covers it — the exact pair that let `./leak.db` survive a whole phase. N3 starts writing real things there, so J3.14 adds **assertion 15: an allowlist of what may exist under `.doppelganger/`** (`state/`, `logs/`, `runs/`, `worktrees/`, `scratch/`, `gitconfig`, `supervisor.heartbeat`, `supervisor.status.json`). Anything else is a leak, named in the failure; a missing directory passes, so a fresh clone is green; no mtimes, so nothing is flaky. J3.14 AC7 drops a `leak.db` and a `notes.txt` there and watches both go red, and J3.17 AC8 is the allowlist's first contact with real content. |
| **The first `SCHEDULE` entry exercises 23 rules that have only ever seen fixtures** | Enumerated: rule 2 · 3/4 (the first non-`*` field the real schedule has carried) · 5/6 (`log` and `LOG_ROOTS` must derive from the same `ROOT`) · **10, the sharpest, because `cli/crontab.ts`'s `render()` calls `validate()`, so `npm run crontab render\|sync\|check` now stats a real `host/jobs/` path** · 14 (the first `PROGRAMS` row ever found) · 15 (the first live coupling between `host/config.ts` and `host/schedule.ts`). Three other things move the same day and each gets an assertion: the parity corpus grows by one expression (N2 wired it as `[...FORMS, ...SCHEDULE.map(e => e.cron)]` precisely so no one has to remember), `--list`'s footer goes `0 supervised` → `1 supervised`, and `crontab check`'s tally goes `(0 more …)` → `(1 more …)`. **`log: projectPath(...)` at module scope does not trip door 6** — the door matches column-0 lines and same-line declarations, and an array literal's indented member is neither, a limit the door's own comment declares. No exception added, no gate widened; the reasoning is recorded and flagged. |
| **SUP-12's live allowlist assertion was deferred to N3 and is still vacuous** | `REFRESH_WINDOW` is `null` and **N3 does not invent one** — a window declared for a single job is inventing the subject, the discipline N2 used to delete three vacuous assertions. What **is** shipped is real: the same call over the **real** `SCHEDULE` and **real** `PROGRAMS` with a **fixture** window returns exactly `[{ name: "nightly-sandcastle", gate: "excl" }]`, and two mutations (move the cron out of the window; change the program's gate) turn it red. `host/window.ts`'s "REMINDER FOR N3" header is rewritten to say the entry landed, the window did not, and which phase gets one. |
| **`INV-1` forbids a local state file and the reference keeps rotation in JSON** | Rotation lives in `nightly.db`, namespace `nightly` (DBS-01/02/03), append-only migration. Satisfies INV-1 (a JSON file next to the code is exactly what it bans), inherits SAF-05's `NIGHTLY_DB` redirect free, inherits TST-20's shared-database discipline free. A deviation from the reference and an improvement, not a liberty. |
| **`npm test` inside a worktree has no `node_modules`, and `pretest` is `tsc`** | The pass symlinks `<root>/node_modules` into the worktree — a project-relative write, registered, and **only visible to door 3 because J3.3 added `symlinkSync` to `WRITE_MEMBERS`**. `prepWorktree`'s `clean -fd -e node_modules` keeps it through a re-prep (J3.5 test 4) and the discard path keeps it too (J3.12 test 32). A per-run `npm ci` would cost minutes of the pass budget and a second copy of 15 MB of source maps. Named as the single most likely reason tier 2 fails for a reason unrelated to the diff. |
| **The escape check detects but does not contain** | An agent under `bypassPermissions` on a bare host can write anywhere; nothing in N3 stops it. N3 **detects and reports** on both routes — the tree and `origin/<base>` — and deliberately does not revert or stash: the reference learned that reverting a shared checkout destroys concurrent human work, and its answer (`escape-stash.ts`) has no roadmap row. Stated in the code, in the test titles and in Gaps, rather than left for a reader to infer from the absence of a revert. |

---

## Gaps I found in the roadmap

Items 1–18 carry over from revision 1 with two corrected and four added. The GAP step verified items
13, 14 and 15 as exactly right.

1. **Nothing anticipates that the runner dependency writes `~/.gitconfig`.** Measured: `run()`
   executes `git config --global --add safe.directory` plus `user.name`/`user.email` on the host under
   `noSandbox`, growing the file by one line per distinct repo path per run — **4,523 entries on this
   machine, 4,448 of them identical**. INS-02 says every write is project-relative or
   `INSTANCE`-discriminated and there is no third category; this is a third category, performed by a
   dependency. N3 redirects it and signs the register, but **INS-02 should say what happens when a
   dependency writes outside both categories**: is redirecting mandatory, or is a registered
   exception allowed? Related: HRN-18 describes the `~/.gitconfig` race and never says what causes
   it. This is the cause.

2. **Nothing says an unattended agent must not be able to reach the remote.** Measured: with
   `origin` over SSH and no `GIT_SSH_COMMAND`, an agent inside a run reaches `git ls-remote origin`
   successfully, and a `git push` would leave the working tree clean and therefore invisible to any
   porcelain-based escape check. HRN-08's "workers never write, except where the work IS the write"
   is about *workers*; a host run under `bypassPermissions` has no equivalent row. Either HRN-07 or
   SAF-02 should name the remote as a write surface an unattended run must be gated off.

3. **`SAF-02`'s named shadow modes have no member that fits a local-merge job.** The row names
   `*_NO_COMMENT`, `*_NO_LABEL`, `*_NO_CLOSE`, `*_NO_PUSH` — all tracker- or remote-shaped.
   `nightly-sandcastle` never pushes; its write is `git merge --ff-only` into a local branch. J3.12
   ships `*_NO_MERGE` and adds the name to the row. Confirm, or say the four names are examples of a
   shape rather than the shape itself.

4. **`SKL-10`'s five findings do not cover a missing SOURCE.** SKL-06's first half is about the
   source directory, and a registered job whose `plugins/<x>/skills/<name>/SKILL.md` is gone produces
   `missing` and then a raw `ENOENT` from `sync`. J3.7 adds `source-missing` and the SKL-10 sentence.

5. **`SKL-04` says `.claude/skills/` is rendered "from the manifests", and there is no manifest until
   N5.** N3 renders from a hand-registered `host/jobs/index.ts`, with `Job.plugin` naming the owner so
   the source path (and the marker's `src=`) is derivable. That is KRN-04's `jobs` member one phase
   early, as `EnvSpec` was its `env` member one phase early. Worth a sentence so N5 reads it as a
   re-homing.

6. **`SKL-07` needs a third clause: a skill may DESCRIBE a rule code enforces.** The landed
   `SKILL.md` says "**Off limits:** the schedule file, the supervisor, `package.json`, and this
   skill's own files" — a guard matrix in markdown by a literal reading, correct behaviour by every
   practical one. N3 makes it checkable: a test parses that bullet and asserts `blockedBy` returns a
   reason for each named thing. The row should say so, because "never put a guard matrix in a skill"
   and "the prompt should tell the agent what it may not touch" currently read as contradictory.

7. **The gate cannot express "excl on A, shared on B".** `nightly-sandcastle` moves `repo` and reads
   `.claude/skills/` for the pass's whole duration. GAT-01…09 describe reader-takes-all-shared and
   writer-takes-some-excl and nothing between. N3 takes `excl` on `["repo"]` only and leaves the read
   unprotected, because the skill tree's only writer is an operator CLI that takes no gate — so the
   contention GAT would order does not exist, and the exposure is INS-05's. Either a mixed hold, or a
   row saying a resource whose only writer is outside the supervisor is not a gate resource at all.

8. **`TST-08` and `HRN-11` never say what "pinned" MEANS.** Current Anthropic IDs carry no date suffix
   and are complete as written, so "has a date" is the wrong predicate. N3 defines it as a shape regex
   plus an alias denylist plus a runtime `assertPinned`, and pins no exact value. The row should carry
   the predicate or say the enforcement is local — because two builders will invent two, and one will
   invent "must match `claude-opus-5`", which rots on the next release. **Corollary:** `PINNED`
   accepts a dated snapshot, so it cannot also enforce "no date on a current id" — a naming
   convention, not a pinning property.

9. **`SAF-01` is defined per JOB and two operator CLIs now need one.** N2 flagged `CRONTAB_DRY_RUN`
   (its Gaps item 9); N3 adds `SKILLS_DRY_RUN`. Two is a pattern. §2.28 should carry a row for an
   operator CLI's own dry run, or SAF-01 should say "per job **or tool**".

10. **`HRN-13` and `HRN-14` have no consumer at N3 and D9 says a port with no consumer gets designed
    wrong.** `taskClass` is given one (the abort deadline), with `RUN_TIMEOUT_MS`'s `why` stating it
    is the unread branch. `local` is **not** — the first draft's runtime precondition was rejected for
    overloading a placement field, and the approved substitute is a source scan. Confirm both, or
    accept two fields nothing reads until M9 and say so in the rows so a reviewer does not report them
    as unimplemented.

11. **Nothing says who prunes `.doppelganger/runs/`.** The runner's log is human prose, not logfmt, so
    it must not sit under `LOG_ROOTS` (LOG-08's copy-then-truncate would truncate a file sandcastle
    holds open in append mode). N3 writes one file per run. `ops-retention` (JOB-O06) is N5. Until
    then the directory grows six small files a night. A `LOG-` or `SAF-` row should name the second
    log root's sibling, or JOB-O06 should move earlier.

12. **`INV-1` and `JOB-C15` disagree about the rotation state.** INV-1 says the declared state store is
    the state store and there is no local state file; JOB-C15 says "goal rotation state" without
    saying where; the reference uses JSON, which INV-1 bans. N3 puts it in SQLite. Confirm, or state
    which state is exempt from INV-1.

13. **Detection without containment has no row.** N3 detects and reports on both escape routes and
    does not revert, because reverting a shared checkout destroys concurrent human work. The
    reference's answer is `escape-stash.ts`, which appears in no `HRN-`, `SAF-` or `JOB-C` row. Add
    one, or state that reporting is the whole contract at v0 — the difference matters and today it is
    decided by whoever writes the job. *(Verified by the GAP step as exactly right.)*

14. **`test/writes.test.ts` door 6 cannot see a call inside a multi-line top-level declaration, and
    the first real schedule entry lands one.** `log: projectPath(...)` inside `SCHEDULE`'s array
    literal is invisible, which the door's own comment declares as an accepted limit. N3 neither
    widens the door nor adds an exception. A `TST-` row saying which of the six members are I/O and
    which are pure path builders would let the door narrow honestly instead of relying on a
    formatting accident. *(Verified by the GAP step as exactly right.)*

15. **`kernel/runtime/exec.ts` names `git` and the writes register exempts it, and N3 adds real git
    write paths.** `EXTERNAL_COMMANDS` is `["crontab","systemctl","docker","at"]` with a comment
    saying `gh`/`git` are "read-mostly wrappers whose write paths are JOB-G's (N5) to register". N3's
    worktree, commit and `merge --ff-only` arrive at N3, not N5. Either add `git` to
    `EXTERNAL_COMMANDS` (and register `kernel/runtime/worktree.ts` and the job), or restate the
    exemption. *(Verified by the GAP step as exactly right.)*

16. **`roadmap.md` §3's N3 `**Ships:**` line is wrong in two places** and assertion 14 will find it the
    moment N3 is ticked: `HRN-10…19` (HRN-17 moved to N5; HRN-18/19 shipped at N1) and `SAF-01…08`
    (SAF-08 cut by D17). J3.18 fixes it. Flagged because it is a spec line, and the same class of
    error may sit in N4's and N5's lines where nothing has checked them.

17. **Nothing says the supervisor is not started by anything.** N3 ships one entry the supervisor
    schedules, and `crontab render` still emits a managed block with zero command lines, because only
    `supervised: false` entries render and the only one the roadmap names is the watchdog (JOB-O10,
    N4). So after N3 the loop runs **only while someone runs `host/supervisor.ts` by hand**. Correct,
    and nowhere written down. SUP-09 or §3's N3 line should say the bootstrap entry arrives at N4.

18. **`SAF-03` and `SAF-04` are one knob with two rows, and `*_LIMIT` is a third spelling.** N3 ships
    one `NIGHTLY_SANDCASTLE_MAX` whose `0` is the free smoke and whose `1` is one real unit. Collapse
    the rows, or say `*_MAX` and `*_LIMIT` are one knob under two names for historical reasons.

19. **`HRN-03`'s contract is designed at N3 by a phase with one implementation.** §3 defers HRN-03…06
    and PRT-08 is N5, so the shape every future runner must satisfy is fixed by the phase that has
    exactly one — the failure D9 warns about. N3 mitigates by keeping `RunResult` to six fields any
    runner can supply and refusing sandcastle's `resume`/`fork`/`preservedWorktreePath`. Worth a
    sentence in PRT-08 saying the shape lands early and the port is a re-homing.

20. **`PRT-05` lists `permissionMode` as an optional `Job` field and N3 makes it required.** HRN-07
    says an unattended job hangs on the first tool prompt without it — which is the one omission that
    is a 3am hang rather than a wrong default, so a type error is the right enforcement. But it means
    `Job` at N3 and `Job` at N5 differ in a way a re-homing does not usually change. Confirm, or say
    PRT-05's list is of names rather than of optionality.

21. **`JOB-C15`'s ship gate and `SAF-07` collide, and no row notices.** Tier 4 runs a changed job's
    `*_DRY_RUN`; `nightly-sandcastle`'s dry run **runs an agent**. So a pass that changed a job whose
    dry run is non-free spends a second model pass inside its own gate. At N3 the collision is dormant
    (BLOCKED forbids the pass touching the only registry job) and it becomes live at N5's second job.
    Either JOB-C15 should say tier 4 skips jobs whose dry run is non-free, or SAF-07's audit should
    list which dry runs a gate may invoke.

22. **Nothing anywhere says what a job spawned by the supervisor actually IS.** SUP-03 says "spawn
    child with `cwd = ROOT`"; PRT-06 gives `ScheduleEntry` a `job` field; §1 says `host/jobs/` is "one
    file per job". None of that says whether the spawned command is the job file or a dispatcher, and
    N2 chose the job file in an untested argv block. That choice would have run nothing, silently,
    every night. SUP-03 or PRT-06 should state the contract in one sentence: **a `job:` entry spawns
    the dispatcher with the job name as its argument, and a job file is a module, not an entry
    point.**


