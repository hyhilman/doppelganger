# N3 — The harness and the pass · UAC breakdown

N2 ended with one honest sentence: *every mechanism the supervisor needs exists, each is exercised
over its whole input space, and they are wired together in a six-line block that nothing tests — no
job has ever run.* N3 ends that sentence.

**N3 is done when a real `SCHEDULE` entry exists, a real `PROGRAMS` row backs it, `host/jobs/nightly-sandcastle.ts`
is a real file that `validate()` rule 10 finds on disk, and one supervisor tick can take the gate,
spawn that job, run a real agent through `ports/runner`, parse its `<<<SANDCASTLE` block, put the
change through a three-tier ship gate and land it with `merge --ff-only` — or refuse, loudly, at
any of seven named gates.** Concretely: `DEFAULTS` in one place with a pinned model · `defineJob` ·
one `RunResult` contract behind one `Runner` seam · the `@ai-hero/sandcastle` adapter · the sentinel
parser · worktree realization and `{{WORKTREE}}` · `skills render|sync|check` with the five findings ·
SKL-06 gated both ways · the whole safe-run surface · and the first entry.

Ten things the roadmap states but does not resolve are settled here rather than left to the builder:
whether `@ai-hero/sandcastle` is real and installable (ruling 1, **measured — it is**) · what proves
the real agent path works when a suite cannot pay for a model call (ruling 2) · what "pinned, never a
floating alias" means as a testable predicate (J3.7) · who owns the worktree, sandcastle or us (ruling
3) · the five `skills check` findings and the sixth the roadmap forgot (J3.8) · how `parseVerdict`
reproduces a vocabulary that lives in markdown (J3.13) · which `validate()` rules fire for the first
time and what they break (J3.16) · what stops a test run from committing to `dev` (ruling 4) · which
dry run is not free (J3.12) · and the one machine-global write a dependency performs behind our back
(ruling 5, **measured — and fixed**).

**Rule this plan obeys at every step: the phase is green at every commit.** `npm test` exits 0 after
every job. Walk the commits in order and no job imports a file a later job creates.

**Baseline, measured 2026-08-26 on this checkout:** `npm test` → `# tests 375 / # pass 373 / # fail 0
/ # skipped 2`, `duration_ms 10217`, `real 0m11.5s`. Every AC below that quotes a suite total is
relative to this.

---

## The five rulings that shape every job below

### 1. `@ai-hero/sandcastle` is real, installable, and typechecks here — measured, not assumed

Everything in this block was run on this machine on 2026-08-26, Node 22.23.1, npm from `.nvmrc`.

| claim | measurement |
|---|---|
| the package exists | `@ai-hero/sandcastle@0.12.0`, MIT, repo `github.com/mattpocock/sandcastle`, `bin.sandcastle → dist/main.js`, `exports` carries `.` and five `./sandboxes/*` subpaths |
| install cost | `npm install @ai-hero/sandcastle@0.12.0` in a scratch project → **`added 7 packages`**: the package itself + `@clack/prompts`, `@clack/core`, `fast-wrap-ansi`, `fast-string-width`, `fast-string-truncated-width`, `sisteransi`. ~15 MB on disk, **~14 MB of which is `.js.map`** |
| the two peers | `peerDependenciesMeta` marks **both** `@daytona/sdk` and `@vercel/sandbox` `optional: true`. `npm install` exits 0, `npm ci` exits 0, `npm ls --all` **exits 0** and prints them as `UNMET OPTIONAL DEPENDENCY`. They are backend-specific and are not demanded |
| it typechecks under OUR tsconfig | a probe file using `run`, `claudeCode`, `noSandbox`, `RunOptions`, `RunResult`, `PromptArgs`, `ClaudeCodeOptions` compiled with this repo's exact `tsconfig.json` (`strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`, `nodenext`, `skipLibCheck`, `@types/node` 22.20.1, `typescript` 5.9.3) → **`tsc --noEmit` exit 0** |
| importing it is inert | `import()` of `.` **and** `./sandboxes/no-sandbox`, with stdin closed (`< /dev/null`): exit 0, **97 ms**, **zero files created in cwd** |
| it never blocks on stdin | `@clack/prompts` is imported statically by `index.js`, but the only three interactive calls (`clack.text`, `clack.isCancel`, `clack.cancel`) live inside **`interactive()`**, on the branch that collects a **missing `{{KEY}}` for a `promptFile`**. `run()` reaches none of them. The other `clack.*` uses (`intro`, `log`, `note`, `spinner`, `taskLog`) are `ClackDisplay`, selected only by `logging: { type: "stdout" }` |

**`./sandboxes/no-sandbox` is the subpath N3 targets, and the reason is HRN-07 itself.** Its own
doc comment says it *"Does not pass `--dangerously-skip-permissions` to the agent — the user manages
permissions themselves"*, and `run()` computes `dangerouslySkipPermissions: sandboxProvider.tag !== "none"`,
which is **`false`** for `noSandbox()`. Measured, by calling the provider's own pure
`buildPrintCommand({ prompt, dangerouslySkipPermissions: false })`:

```
permissionMode UNSET      → claude --print --verbose --output-format stream-json --model 'claude-opus-5' --effort high -p -
permissionMode set        → claude --print --verbose --permission-mode bypassPermissions --output-format stream-json --model 'claude-opus-5' --effort high -p -
```

The first line carries **no permission flag at all**. That is HRN-07's hang, made visible: an
unattended `claude -p` with no permission flag waits on the first tool prompt forever. Docker,
Podman, Vercel and Daytona are the M9 fleet story and N3 targets none of them.

**The real signature, so `ports/runner` is designed against something true:**

```ts
run(options: RunOptions): Promise<RunResult>
// RunOptions (the fields N3 uses): agent, sandbox, cwd?, prompt? | promptFile?, maxIterations?,
//   promptArgs?, logging?, completionSignal?, idleTimeoutSeconds?, completionTimeoutSeconds?,
//   name?, branchStrategy?, signal?, timeouts?, output?
// RunResult: { iterations: IterationResult[]; completionSignal?: string; stdout: string;
//   commits: {sha:string}[]; branch: string; logFilePath?: string; preservedWorktreePath?: string;
//   resume?; fork? }
claudeCode(model: string, options?: ClaudeCodeOptions): AgentProvider & { sessionStorage }
// ClaudeCodeOptions: { effort?: "low"|"medium"|"high"|"xhigh"|"max"; env?; captureSessions?;
//   sessionStorage?; permissionMode?: "default"|"acceptEdits"|"plan"|"auto"|"dontAsk"|"bypassPermissions" }
noSandbox(options?: { env?: Record<string,string>; maxOutputTailChars?: number }): NoSandboxProvider
```

`RunResult` is **not** adopted as our contract. HRN-03 says ONE `RunResult` and M11 swaps the
library with *"every job file unchanged"*; adopting a third party's interface makes that swap a
rewrite. `kernel/ports/runner.ts` declares our own six-field `RunResult` and `host/runner.ts` maps
sandcastle's onto it (J3.2, J3.3).

**The dependency arithmetic, stated so the GAP step can check it.** This repo has one dependency
(`croner`, zero transitive). After N3 it has two and **seven** installed packages. `croner` was
accepted because SUP-07 was circular without it; sandcastle is accepted because D2 names it, because
writing an unattended agent runner is M11's own 3-week line item, and because every measurement above
came back clean. `test/deps.test.ts` grows an importer register so both are single-importer claims
(J3.3).

### 2. What proves the real path works — three layers, and the one manual step

A suite cannot make paid model calls. N3 does not pretend otherwise. It buys assurance in three
layers, and says exactly what each one does **not** prove.

**Layer A — the pure seam, in `npm test`, zero cost, zero spawn.** `AgentProvider.buildPrintCommand({ prompt, dangerouslySkipPermissions })`
is a **pure function on the real provider object built by the real package**. `host/runner.test.ts`
builds the provider through `host/runner.ts`'s own exported `buildAgent(job)` — the same call
`runLocal` makes — and asserts the returned command names our `permissionMode` value and our model
string. Deleting `permissionMode:` from `buildAgent` turns it RED (J3.3 AC3). This proves the
**configuration** the real path uses, against the real package. It does not prove an agent runs.

**Layer B — the whole `run()` path, in `npm test`, zero cost, against a FAKE `claude` on `PATH`.**
Measured and working. `noSandbox().create()` spawns `sh -c <command>` with `env: { ...process.env, ...providerEnv }`,
so a fake `claude` executable earlier on `PATH` is found. A probe run — real `run()`, real
`claudeCode()`, real `noSandbox()`, a real temp git repo, a shell script printing a `<<<SANDCASTLE`
block and `<promise>COMPLETE</promise>` — returned in **104 ms** with:

```
completionSignal: "<promise>COMPLETE</promise>"
branch: main   commits: 0   iterations: 1
logFilePath: <the path we passed>
stdout: the agent's bytes, verbatim, sentinel block included
```

Three failure modes measured too: **agent exits non-zero** → `run()` rejects with an
`instanceof Error` whose `.message` is `claude-code exited with code 3:\nboom\n` (so
`kernel/config.ts`'s `errText` reads it) · **no completion signal, exit 0** → resolves with
`completionSignal: undefined` and the raw stdout · **`logging: {type:"file"}`** keeps the terminal UI
off and prints a two-line banner (`[<name>] Started on branch <b>` / `  tail -f <log>`) to **stdout**.

This proves the library's contract, our adapter's mapping, `completionSignal` matching, sentinel
extraction, worktree cwd, and the `GIT_CONFIG_GLOBAL` redirect (ruling 5) — end to end, on every
commit, on CI, for free. **It does not prove that a real model, given our real prompt, emits a
parsable block.** Nothing in a suite can.

**Layer C — the one manual step a human must run. It is J3.17 and it is not optional.**

```
NIGHTLY_SANDCASTLE_DRY_RUN=1 NIGHTLY_SANDCASTLE_BASE=dev npm run job nightly-sandcastle
```

on a host where `claude` is logged in (measured present here: `claude` 2.1.246 at
`~/.local/bin/claude`). It costs one Opus pass. It is the only thing that proves: the `claude` CLI
accepts our flags, the skill is found by name from `.claude/skills/`, the model returns a
`<<<SANDCASTLE` block our `parseVerdict` accepts, and the pass completes inside `maxRunMin`.
**J3.17 commits the real stdout as a fixture** (`host/jobs/fixtures/sandcastle-real-<date>.txt`) and
re-points `parseVerdict`'s tests at it — which is also how TST-19 gets its "lifted from REAL data,
never invented" fixture. Until J3.17 lands, N3 is not done, and no later job may substitute an
invented fixture for it.

### 3. This repo owns the worktree; sandcastle is pointed at it

`run()` has its own branch machinery — `head` (agent writes the host working directory, no worktree),
`merge-to-head` (temp branch, **merged back automatically**), `branch` (commits land on a named
branch in a worktree under `.sandcastle/worktrees/`). None of the three fits JOB-C15, because
JOB-C15's whole content is **gate first, land second**: `merge-to-head` merges before our gate runs,
`head` writes the live checkout, and `branch` leaves the worktree path out of `RunResult` (only
`preservedWorktreePath`, and only when dirty).

**So: `kernel/runtime/worktree.ts` creates the worktree with `git worktree add -B <branch> <path> <base>`,
`runJob` passes that path to `run()` as `cwd` with `branchStrategy: { type: "head" }`, and the job
tears it down.** Measured consequences of that combination, all good: sandcastle creates no second
worktree, merges nothing, and — with an explicit `logging.path` — **creates no `.sandcastle/` directory
at all** (`git status --porcelain` in the probe repo was empty after the run).

`{{WORKTREE}}` (HRN-12) is substituted **by `runJob`, in our code**, never by sandcastle's
`promptArgs`. Two reasons, and the second is the load-bearing one: the port must not depend on a
library feature M11 has to reimplement, and `run()`'s `promptArgs` path is the *only* route to
`clack.text`, which waits on stdin. **`host/runner.ts` passes neither `promptArgs` nor `promptFile`
to `run()`, ever**, and J3.3 gates that as text.

### 4. Nothing this suite runs can commit to `dev` — seven layers, each performable

`nightly-sandcastle` modifies this repo. That is JOB-C15's point and it is the sharpest hazard in
N3. Seven independent things stop a test run reaching the real checkout, and each has a test:

1. **Ruling 2 from N2 applies unchanged.** `exec(deps)` takes every impure value as a **required**
   field — `root`, `runner`, `git`, `now`, `db`. TypeScript refuses a call that omits one, so a test
   cannot forget to redirect. The real values are assembled only in `host/run.ts`'s argv block.
2. **`NIGHTLY_NO_SANDCASTLE=1`** — the KRN-07 kill switch. Logs `event=killed` and returns before
   anything is read. Degrades to the safest verdict: nothing happens.
3. **`NIGHTLY_SANDCASTLE_MAX=0`** — SAF-04's free smoke test. Rotation, worktree prep, gate wiring
   and report render all run; **zero agent runs**. This is the mode the suite's one integration test
   uses.
4. **`NIGHTLY_SANDCASTLE_DRY_RUN=1`** — SAF-01. No commit, no merge, no state write.
5. **`NIGHTLY_SANDCASTLE_NO_MERGE=1`** — SAF-02's shadow mode. The commit is made **in the worktree**
   and the base branch is not touched.
6. **`not-on-base`** — `exec` refuses unless `git rev-parse --abbrev-ref HEAD` equals
   `NIGHTLY_SANDCASTLE_BASE` (default `main`). During this loop the base is `dev`, set in `.env`.
7. **`tree-dirty`** — refuses when `git status --porcelain` on the base is non-empty. Committing on
   top of in-progress human work is worse than a skipped night.

And the mechanical backstop: **every test that runs `exec()` points `deps.root` at a `mkdtempSync`
git repo**, and `test/layout.test.ts` assertion 13 plus a per-job `git status --porcelain` AC prove
the checkout is untouched.

### 5. `run()` writes `~/.gitconfig` behind your back — measured, and fixed by one env var

This is the finding that most changes the design, and it was found by measuring rather than reading.
`run()` unconditionally executes, inside the sandbox (which under `noSandbox` means **on the host**):

```
git config --global --add safe.directory "<repoDir>"
git config --global user.name  "<the host repo's user.name>"
git config --global user.email "<the host repo's user.email>"
```

Measured: `md5sum ~/.gitconfig` **changed** after one probe run, and five probe runs appended **five
duplicate `safe.directory` lines**. (The developer's real `~/.gitconfig` on this machine already
carries five duplicate `/home/hyhilman/projects/xenith` entries — the reference has been leaking
exactly this for months.) Three problems at once:

- **INS-02 has no category for it.** A machine-global write is neither project-relative nor
  `INSTANCE`-discriminated, and INS-02 says there is no third category.
- **It is HRN-18's `~/.gitconfig` race, with its source finally named.** N1 shipped
  `*_SPAWN_STAGGER_MS` for "the `~/.gitconfig` start-up race" without a caller. This is the caller.
- **It grows without bound** — one `safe.directory` line per distinct repo path, per run, forever.

**The fix, measured working:** `noSandbox({ env: { GIT_CONFIG_GLOBAL: projectPath(".doppelganger/gitconfig") } })`.
After the run, `~/.gitconfig` is **byte-identical**, and the redirected file holds exactly:

```
[safe]
	directory = /tmp/sc-e2e/repo
[user]
	name = t
	email = t@t
```

INS-02 category: **project-relative**, signed in the writes register. One constraint, also measured:
setting the same key on **both** providers throws `Overlapping env keys between agent provider and
sandbox provider: GIT_CONFIG_GLOBAL`, so it goes on `noSandbox` only — and that is itself a test.

---

## Job order

1. **J3.1** — `roadmap.md` §1: name every file N3 builds, one per line with a milestone tag. Every
   later job's `Files touched` must be a path §1 already blesses, and `test/layout.test.ts`
   assertion 12 reads what this job writes. **Must land first**: §1's `ports/` line currently tags
   `job.ts schedule.ts runner.ts` as bare `v0`, which `classifyRow` reads as *must-be-absent* — so
   J3.2 would turn the suite red without it. Doc only.
2. **J3.2** — `kernel/ports/job.ts` + `kernel/ports/runner.ts`: `Job`, `defineJob`, `DEFAULTS`,
   `OPUS_GUIDANCE`, `RunRequest`, `RunResult`, `Runner`, `runTimeoutMs`. Pure; imports nothing but
   `kernel/`, so `test/deps.test.ts` assertion 3 (kernel names no bare specifier) stays green.
3. **J3.3** — the dependency and the adapter. `@ai-hero/sandcastle` pinned exact; `host/runner.ts`
   is its only importer; `test/deps.test.ts` generalises to an importer register. Ruling 1 and
   ruling 5 land here.
4. **J3.4** — `kernel/runtime/payload.ts`: HRN-10's sentinel parser. Independent of J3.2/J3.3.
5. **J3.5** — `kernel/runtime/worktree.ts`: HRN-12. Needs only `kernel/runtime/exec.ts`.
6. **J3.6** — `kernel/runtime/runjob.ts`: the one entry point. Needs J3.2, J3.4, J3.5.
7. **J3.7** — TST-08 / HRN-11: every agent run names its model, and the model is pinned. Needs a
   call site to scan, so it goes after J3.6.
8. **J3.8** — `cli/skills.ts`: `render` and the findings, pure. Independent of the harness.
9. **J3.9** — `skills render|sync|check`, the prune, the argv block, the safe-run flag.
10. **J3.10** — JOB-C15's pure decisions + `host/jobs/index.ts`, the hand-registered job list.
11. **J3.11** — JOB-C15's ship gate: suite, import smoke, dry run with the DB redirected.
12. **J3.12** — JOB-C15's pass: `exec()`, the landing, the whole safe-run surface, SAF-07.
13. **J3.13** — SKL-06 both ways, TST-23 live, TST-24, and the vocabulary drift gate.
14. **J3.14** — TST-09: one name, four consumers.
15. **J3.15** — `host/run.ts`: `npm run job <name>` and the argv block that assembles the real runner.
16. **J3.16** — the first `SCHEDULE` entry and `PROGRAMS` row. Needs J3.10 (validate rule 10 wants
    the job file on disk) and J3.15.
17. **J3.17** — **the manual step**: one real pass, its stdout committed as the TST-19 fixture.
18. **J3.18** — close N3 in `WORK.md`, `LOOP.md`, and `roadmap.md` §3.

---

## J3.1 — `roadmap.md` §1: the N3 module map  ·  §1, PRT-08, SKL-04, JOB-C15

**Goal:** make §1 name every file N3 builds, one per line with a milestone tag, so `test/layout.test.ts`
assertion 12 blesses each one the moment it lands and refuses anything N3 does not declare.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§1 only)

**Do:**

Rewrite three blocks. The `parseBlock` parser in `test/layout.test.ts` is strict about shape, and
this job must obey it exactly:

- an **indent-2** line is either a bare `<name>/` directory line (matching `^([a-z]+)/$`, nothing
  after it) or a `<file>.ts <prose> <tags>` row;
- an **indent-4** line is `<file.ts> [<file.ts> …] <prose> <tags>`, prefixed by the current
  directory;
- tags are any of `N1 N2 N3 N4 N5 v0 v1` found anywhere on the line by `\b(N1|…|v1)\b`.

**That last rule is a trap and this job must avoid it: never write a phase token inside the prose.**
"re-homes at N5" adds an `N5` tag to the row. Write "re-homed later" instead.

`kernel/` — replace the two-line `ports/` block and add two `runtime/` rows:

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

`host/` — add three rows and restructure `jobs/` into a bare directory line:

```
  runner.ts               the @ai-hero/sandcastle adapter (D2)                 N3
  run.ts                  npm run job <name> — the dispatcher                  N3
  jobs/
    index.ts              the hand-registered job list (SKL-05)                N3
    nightly-sandcastle.ts one small verified improvement, gated (JOB-C15)      N3
```

`cli/` — `skills.ts … N3` is already there and correct; leave it.

Add two sentences under the block: one saying `kernel/ports/job.ts` and `kernel/ports/runner.ts` are
declared at N3 and re-homed under PRT-05/PRT-08's rows later, on the `EnvSpec` precedent (J1.2), and
one saying `host/runner.ts` is the **only** file in the repo that imports an agent-runner package —
which is what makes M11 a file swap rather than a rewrite.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0, `# tests 375 / # pass 373 / # fail 0 / # skipped 2` unchanged. This
      job adds no file, so assertion 12's clause 1 has nothing new to check and every new row is
      tagged `N3`, which `classifyRow` reads as **exempt** while N3 is CURRENT.
- [ ] AC2 — **the parser really sees the new rows.** Run
      `node --test test/layout.test.ts` after temporarily creating an empty
      `kernel/ports/runner.ts`; it stays green (exempt). Then retag that row `N2` in §1 and re-run:
      it exits non-zero with `§1 names kernel/ports/runner.ts as v0,N2, but ...` — proving the row
      is parsed, not ignored. Revert both.
- [ ] AC3 — **no stray tag in prose.** `node -e` over `roadmap.md`: for each new row, the tag list
      extracted by `/\b(N1|N2|N3|N4|N5|v0|v1)\b/g` equals the tags intended for that row. Concretely
      `grep -n "ports/job.ts\|ports/runner.ts\|payload.ts\|host/runner.ts" roadmap.md` and read the
      tail of each line; none may contain a second phase token.
- [ ] AC4 — `git status --porcelain` shows exactly one modified file, `roadmap.md`.

**Commit:** `roadmap §1: name the files N3 builds (§1, PRT-08, SKL-04, JOB-C15)`

**Depends on:** nothing.

**Risks / what could be wrong:**
- **`jobs/` as a bare directory line changes an existing row.** Today `  jobs/   one file per job … N3`
  matches neither `dirOnly` nor the `.ts` row pattern, so it produces no entry *and does not set the
  prefix*. Splitting it is required, not cosmetic — without it an indent-4 `nightly-sandcastle.ts`
  would be recorded with an empty prefix and assertion 12 would report `host/nightly-sandcastle.ts`.
- **`runjob.ts` versus putting `runJob` in `ports/runner.ts`.** The plan puts the driver in
  `runtime/` because it imports `worktree.ts` and `exec.ts`, and a port that imports runtime inverts
  the layer it exists to define. If the GAP step prefers the port, the change is one `git mv` and a
  §1 row.

---

## J3.2 — `kernel/ports/job.ts` and `kernel/ports/runner.ts`: the shapes, the defaults, the seam  ·  HRN-01, HRN-02, HRN-13, HRN-14, HRN-15, SKL-01, PRT-08

**Goal:** one place that says what a job IS, one place that says what a run RETURNS, and a `Runner`
function type narrow enough that M11 can replace its only implementation with every job file
unchanged.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/ports/job.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/ports/job.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/ports/runner.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/ports/runner.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/test/knobs.test.ts` (`ROWS` + two new rows — `test/knobs.test.ts` assertion 2 is an exact set comparison, so a new `EnvSpec` anywhere must be listed in the same commit)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27: the two run-timeout knobs)

**The shapes:**

```ts
// kernel/ports/job.ts
export const DEFAULTS = {
  model: "claude-opus-5",
  effort: "high",
  permissionMode: "auto",
} as const;

export interface Job {
  readonly name: string;                 // SUP-20 stage prefix; SKL-01 says it IS the skill name
  readonly description: string;
  readonly plugin: string;               // owns the skill file: plugins/<plugin>/skills/<name>/ (SKL-03)
  readonly skill?: string;               // defaults to `name` (SKL-01). Absent ⇒ `exec` must be set
  readonly exec?: (deps: never) => Promise<void>;   // deterministic / self-orchestrated (D10's second shape)
  readonly model?: string;
  readonly effort?: Effort;
  readonly permissionMode?: PermissionMode;
  readonly maxIterations?: number;
  readonly completionSignal?: string;
  readonly promptArgs?: Readonly<Record<string, string>>;
  readonly worktree?: { readonly branch: string; readonly base: string };  // HRN-12
  readonly taskClass?: "impl";           // HRN-13
  readonly local?: boolean;              // HRN-14
}

export const defineJob = (job: Job): Job => job;          // HRN-02, identity
export const skillOf = (job: Job): string => job.skill ?? job.name;   // SKL-01, one identifier
export const OPUS_GUIDANCE: string = [...].join("\n");    // HRN-15
```

```ts
// kernel/ports/runner.ts
export interface RunRequest {
  readonly name: string;
  readonly prompt: string;          // FULLY substituted; no {{KEY}} survives (ruling 3)
  readonly cwd: string;
  readonly model: string;
  readonly effort: Effort;
  readonly permissionMode: PermissionMode;
  readonly maxIterations: number;
  readonly completionSignal: string;
  readonly logPath: string;
  readonly deadlineMs: number;
  readonly env: Readonly<Record<string, string>>;
}
export interface RunResult {
  readonly stdout: string;
  readonly completionSignal: string | null;
  readonly iterations: number;
  readonly commits: readonly string[];   // SHAs
  readonly branch: string;
  readonly logPath: string | null;
}
export type Runner = (req: RunRequest) => Promise<RunResult>;
```

**Six decisions, each with its reason written in the file:**

- **`RunResult` is ours, six fields, all required.** Sandcastle's has eleven, two of them functions
  (`resume`, `fork`) that only exist when the provider supports session capture. HRN-03's "ONE
  contract" and M11's "every job file unchanged" both die the moment a job reads a field only one
  runner can supply. `completionSignal` is `string | null`, never `undefined` — an absent optional
  and a signal that did not fire read identically at a call site, and the second is a warning.
- **`RunRequest` carries a fully-substituted `prompt` and no `promptArgs`.** Ruling 3.
- **`DEFAULTS.permissionMode` is `"auto"`, not `"bypassPermissions"`.** `auto` is AI-mediated
  per-tool approve/deny and does not hang; `bypassPermissions` is full host access with no
  isolation. A job that needs the second states it at its own call site, and J3.6 makes that
  statement cost something (it forces `local: true`).
- **`DEFAULTS.model` is a literal string in this file and nowhere else.** J3.7's gate depends on
  there being exactly one.
- **`taskClass` gets a real N3 consumer** — `runTimeoutMs(job)` in `runner.ts`, pure:
  `job.taskClass === "impl" ? RUN_TIMEOUT_IMPL_MS : RUN_TIMEOUT_MS`. J3.6 feeds it to the run's
  abort deadline. Without a consumer the field would be designed against nothing (D9); the
  reference's consumer is `dispatchTimeoutMs`, which needs the queue (M9).
  **Both ceilings are `EnvSpec` rows, not bare constants**, because every tunable in this repo is a
  knob whose one-line `why` IS its doc (KRN-06):

  | key | default | why |
  |---|---|---|
  | `RUN_TIMEOUT_MS` | `1500000` (25 min) | wall-clock bound on ONE agent run; the run is aborted, not the supervisor's child (that is SUP-13) |
  | `RUN_TIMEOUT_IMPL_MS` | `2700000` (45 min) | the ceiling for a `taskClass: "impl"` run — a build-and-verify pass, not a read (HRN-13) |

  Both are added to `test/knobs.test.ts`'s `ROWS` and to §2.27 in **this** commit, because assertion
  2 is an exact set comparison and a new row anywhere turns the suite red until it is listed.
- **`exec`'s parameter type is `never`.** A `Job` in the registry must be callable by nobody who
  does not know the job's own `deps` shape; the job file re-declares `exec` with its real type. This
  is deliberate and commented: it makes `host/run.ts` cast once, in one place, rather than letting
  every consumer believe it can call `exec()`.

**Do (tests):** `kernel/ports/job.test.ts` and `kernel/ports/runner.test.ts`.

1. `defineJob` is identity — `assert.strictEqual(defineJob(j), j)`. It exists for the type check, and
   a test that says so stops someone adding a clone.
2. `skillOf` returns `name` when `skill` is absent and `skill` when present (SKL-01's one identifier).
3. `DEFAULTS.model` is non-empty, and the file contains **exactly one** double-quoted
   `claude-…` literal — parsed from the source with `readFileSync`, so J3.7's premise is asserted
   where the constant lives.
4. `DEFAULTS.permissionMode` is not `"default"`, `"plan"` or `"acceptEdits"` — the three that are
   supervised-only. The test names HRN-07 and says an unattended run under any of them either hangs
   or refuses every edit.
5. `OPUS_GUIDANCE` is non-empty, contains no `{{`, and names none of `plugins/`, `.claude/`,
   `SKILL.md` — HRN-16's "never a path into a skill's files", asserted on the one shared preamble.
6. `runTimeoutMs({}) < runTimeoutMs({ taskClass: "impl" })` and both are finite and > 0. The whole
   of HRN-13 that is real at N3, as one assertion.
7. **Type-level, expressed as a test that must compile:** a `Runner` implementation returning a
   `RunResult` with a missing field does not typecheck. Written as a commented-out block with an
   `@ts-expect-error` sibling that DOES compile, so `tsc` is the assertion — plus a runtime
   `assert.ok` naming what the block proves, so the test file has a passing test rather than only a
   compile-time claim.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/ports/job.test.ts kernel/ports/runner.test.ts`
      reports 7 passing tests.
- [ ] AC2 — **the one-model-literal gate fires.** Add a second `model: "claude-opus-5"` line inside
      a new exported const in `kernel/ports/job.ts` **and export it** (so `noUnusedLocals` cannot
      short-circuit the run at `pretest`). `npm test` exits non-zero on test 3, naming two literals.
      Revert.
- [ ] AC3 — **the permissionMode gate fires.** Change `DEFAULTS.permissionMode` to `"plan"`.
      `npm test` exits non-zero on test 4 with the HRN-07 message. Revert.
- [ ] AC4 — **the HRN-16 gate fires.** Append the line
      `"  - The skill lives at plugins/nightly/skills/nightly-sandcastle/SKILL.md."` to
      `OPUS_GUIDANCE`. `npm test` exits non-zero on test 5. Revert.
- [ ] AC5 — **`kernel/` is still dependency-free.** `node --test test/deps.test.ts` reports its 5
      tests passing; assertion 3 still finds no bare specifier under `kernel/`.
- [ ] AC6 — `node --test test/layout.test.ts` passes: both new files are named in §1 by J3.1.
- [ ] AC7 — `node --test test/knobs.test.ts` reports 7 passing with `RUN_TIMEOUT_MS` and
      `RUN_TIMEOUT_IMPL_MS` in `ROWS`; remove one row and confirm assertion 2 exits non-zero, then
      restore. `sed -n '/^### 2\.27/,/^### 2\.28/p' roadmap.md | grep -c 'RUN_TIMEOUT_IMPL_MS'`
      prints `1`.
- [ ] AC8 — `git status --porcelain` is empty after `npm test`.

**Commit:** `ports: Job, defineJob, DEFAULTS, and the one RunResult contract (HRN-01, HRN-02, HRN-13, HRN-14, HRN-15, SKL-01, PRT-08)`

**Depends on:** J3.1.

**Risks / what could be wrong:**
- **`exec: (deps: never) => Promise<void>` may be too clever.** The alternative is
  `exec?: unknown` plus a cast at the one call site, which is the same amount of unsafety with less
  type information. Flagged; either is a one-line change.
- **Declaring `Job` in `kernel/ports/` before PRT-05 exists at N5** repeats N2's `ScheduleEntry`
  decision (N2 Gaps item 15). If the GAP step wants it in `host/` instead, note that `cli/skills.ts`
  and `kernel/runtime/runjob.ts` both need it, and `kernel/` may not import `host/`.

---

## J3.3 — `@ai-hero/sandcastle` arrives; `host/runner.ts` is its only importer  ·  HRN-07, HRN-11 (command half), D2, TST-25 (narrow), INS-02

**Goal:** one file that turns a `RunRequest` into a real agent run, and four gates that keep the
package from spreading, from hanging on a prompt, and from writing outside the checkout.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/package.json` (`dependencies`)
- `/home/hyhilman/projects/me/doppelganger/package-lock.json`
- `/home/hyhilman/projects/me/doppelganger/host/runner.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/host/runner.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/test/deps.test.ts` (the importer register)
- `/home/hyhilman/projects/me/doppelganger/test/writes.test.ts` (`REGISTER`: `host/runner.ts`)
- `/home/hyhilman/projects/me/doppelganger/.gitignore` (`.sandcastle/`)

**Do (`host/runner.ts`):**

```ts
export interface RunnerDeps {
  readonly gitConfigGlobal: string;   // ruling 5 — required, no default
  readonly onBanner?: (line: string) => void;
}
export function buildAgent(req: RunRequest): AgentProvider;   // exported for layer A
export function sandcastleRunner(deps: RunnerDeps): Runner;
```

- `buildAgent(req)` = `claudeCode(req.model, { effort: req.effort, permissionMode: req.permissionMode })`.
  **Exported**, because it is the pure half layer A tests, and because a test that rebuilds the
  provider itself would be testing its own copy of the configuration (N2 F3: code being right is not
  the same as being gated).
- `sandcastleRunner(deps)` returns a `Runner` that calls
  `run({ agent: buildAgent(req), sandbox: noSandbox({ env: { GIT_CONFIG_GLOBAL: deps.gitConfigGlobal, ...req.env } }), cwd: req.cwd, name: req.name, prompt: req.prompt, maxIterations: req.maxIterations, completionSignal: req.completionSignal, branchStrategy: { type: "head" }, logging: { type: "file", path: req.logPath }, signal: AbortSignal.timeout(req.deadlineMs) })`
  and maps the result onto our six fields:
  `{ stdout, completionSignal: r.completionSignal ?? null, iterations: r.iterations.length, commits: r.commits.map(c => c.sha), branch: r.branch, logPath: r.logFilePath ?? null }`.
- **`promptArgs` and `promptFile` are never passed.** One line of comment naming ruling 3 and the
  `clack.text` path.
- **`req.env` is merged into `noSandbox`, never into `claudeCode`** — measured: the same key on both
  throws `Overlapping env keys between agent provider and sandbox provider`.
- **`GIT_CONFIG_GLOBAL` is a required `deps` field with no default** — the N2 F1 lesson applied: a
  default that is a real path is a real file someone forgets to redirect.
- Errors are not caught. `run()` rejects with an `instanceof Error` (measured), and `runJob`'s caller
  decides what a failed run means.

**Do (`test/deps.test.ts`, generalised):** replace the hardcoded `["croner"]` expectation with an
**importer register**, the same shape `test/writes.test.ts` already uses:

```ts
const IMPORTERS: Record<string, { importer: string; why: string }> = {
  croner: { importer: "host/cron.ts", why: "the only cron seam (SUP-07, J2.8)" },
  "@ai-hero/sandcastle": { importer: "host/runner.ts", why: "the only agent-runner seam; M11 replaces this file (D2, D3)" },
};
```

Test 1 becomes: for every declared root dependency, the set of files that name it across **all four
spellings** (`from "x"`, `require("x")`, `import("x")`, bare `import "x"` — the existing
`SPECIFIER_RE`) equals exactly `[IMPORTERS[dep].importer]`, and the register's key set equals
`Object.keys(pkg.dependencies)`. Test 2's expected specifier set becomes `Object.keys(IMPORTERS)`,
derived, not written twice. Test 4 grows a second clause: the installed
`@ai-hero/sandcastle/package.json`'s `dependencies` keys equal `["@clack/prompts"]` and its
`peerDependenciesMeta` marks both peers `optional: true` — a claim about a version this repo pins in
its lockfile, so it cannot rot without a lockfile commit. Test 5 covers both dependencies.

**Do (`host/runner.test.ts`):**

1. **HRN-07, layer A.** `buildAgent({ ...req, permissionMode: "bypassPermissions" }).buildPrintCommand({ prompt: "P", dangerouslySkipPermissions: false }).command`
   **contains `"bypassPermissions"`**. Then the negative control: a provider built by calling
   `claudeCode(model, { effort })` directly, with no `permissionMode`, produces a command that
   contains **no** permission-mode value. Two assertions, and the pair is what makes the first one
   mean something. The test asserts on **our own value appearing**, never on sandcastle's flag
   spelling — a package outside this repo may rename `--permission-mode` and this test must not rot.
2. **HRN-11, layer A.** The same command contains `req.model`. Negative control: a command built for
   a different model does not.
3. **`promptArgs`/`promptFile` never reach `run()`** — a text assertion over `host/runner.ts`:
   neither identifier appears. Honest limit written in the comment: this is a text scan, and the
   real enforcement is that `RunRequest` has no such field, so a call would not typecheck.
4. **`GIT_CONFIG_GLOBAL` goes on exactly one provider.** Build the two option objects the way
   `sandcastleRunner` does and assert `Object.keys(agentEnv)` and `Object.keys(sandboxEnv)` are
   disjoint. Measured failure mode, asserted rather than remembered.
5. **Layer B — the real `run()` against a fake `claude`.** A **child process** (`spawnSync`,
   `test/knobs.test.ts`'s `scrubbedChild` shape) with `env: { PATH: <fakeBin>:<PATH>, HOME: <tmpHome>, ... }`
   and a `mkdtempSync` git repo initialised with `git init -b main` +
   `git -c user.email=… -c user.name=… commit`. The fake `claude` is a `#!/usr/bin/env bash` script
   that reads stdin, echoes a `<<<SANDCASTLE` block and `<promise>COMPLETE</promise>`. Assert the
   child prints, as JSON on its stdout: `completionSignal` equals the signal, `iterations === 1`,
   `stdout` contains `<<<SANDCASTLE`, `branch === "main"`, and `logPath` is the path we passed.
   **The child runs in its own `HOME`, so the mutation in AC5 cannot reach the developer's real
   `~/.gitconfig`** — the J2.16 layer-0 lesson, applied to a different destructive surface.
6. **Ruling 5, asserted.** Same child: after the run, `<tmpHome>/.gitconfig` **does not exist**, and
   the file named by `GIT_CONFIG_GLOBAL` contains `safe.directory`.
7. **A non-zero agent is an Error with a readable message.** Fake `claude` exits 3 printing `boom` on
   stderr; assert the child reports the rejection is `instanceof Error` and its message contains
   `code 3` and `boom`.
8. **No completion signal is not a failure.** Fake `claude` exits 0 printing nothing recognisable;
   assert `completionSignal === null` and `stdout` carries the bytes.
9. **`.sandcastle/` is not created.** Same child, then `readdirSync(repo)` contains no `.sandcastle`
   — the measured consequence of passing `logging.path` and `branchStrategy: "head"`, pinned so a
   future edit that drops either is caught.

**Acceptance criteria:**

- [ ] AC1 — `npm ci` exits 0 from a clean `node_modules`, `npm ls --all` exits 0, and
      `npm ls --all --json | node -e "…"` reports the two peers as `UNMET OPTIONAL DEPENDENCY`
      rather than as errors. Record the printed `added N packages` line in the commit body.
- [ ] AC2 — `npm test` exits 0; `node --test host/runner.test.ts` reports 9 passing tests, and
      `test/deps.test.ts` reports 5.
- [ ] AC3 — **HRN-07's gate fires.** Delete `permissionMode: req.permissionMode` from `buildAgent`.
      `npm test` exits non-zero on `host/runner.test.ts` test 1. Revert. This is the mutation that
      makes HRN-07 a checked claim rather than a comment.
- [ ] AC4 — **the importer register fires, across every spelling.** Add
      `const probe = await import("@ai-hero/sandcastle"); void probe;` at the bottom of
      `host/cron.ts` (the binding is consumed, so this is not TS6133). `npm test` exits non-zero on
      `test/deps.test.ts` test 1 naming `host/cron.ts`. Repeat with `import "@ai-hero/sandcastle";`
      (bare side-effect form) and with
      `import sc from "@ai-hero/sandcastle"; export const n = Object.keys(sc).length;` (default
      import used as a namespace). All three go red. Revert each.
- [ ] AC5 — **ruling 5's gate fires, safely.** Delete the `env: { GIT_CONFIG_GLOBAL: … }` from the
      `noSandbox(...)` call. `npm test` exits non-zero on test 6 — `<tmpHome>/.gitconfig` now
      exists. Revert. Before running this, confirm the mutation is safe by construction:
      `grep -n "HOME:" host/runner.test.ts` must show the child's `HOME` is a `mkdtempSync` path, and
      record `md5sum ~/.gitconfig` before and after the whole job.
- [ ] AC6 — **layer B really runs the library.** Temporarily rename the fake `claude` script so it is
      not on `PATH`; `node --test host/runner.test.ts` exits non-zero with a spawn failure rather
      than passing. This proves the test executes `run()` instead of stubbing it. Restore.
- [ ] AC7 — `node --test test/writes.test.ts` reports 6 passing; `host/runner.ts` is signed in
      `REGISTER` as `project-relative` with the reason naming ruling 5. Remove the row and confirm
      door 3 exits non-zero. Restore.
- [ ] AC8 — `git status --porcelain` is empty after `npm test`, and
      `test -e .sandcastle && echo LEAK || echo clean` prints `clean`.
- [ ] AC9 — `time npm test` stays under 25 s wall (baseline 11.5 s; this job adds nine tests, one of
      which is three child processes at ~100 ms of library time each plus Node start-up).

**Commit:** `runner: the sandcastle adapter, its dependency, and the four gates around it (HRN-07, D2, TST-25, INS-02)`

**Depends on:** J3.2.

**Risks / what could be wrong:**
- **`host/runner.ts` imports `node:fs`? It must not.** It writes nothing directly — sandcastle owns
  the log file. If a later edit adds `mkdirSync` for the log directory, door 3 fires and the
  `REGISTER` row is already there. The row is added in this commit anyway, because `git config
  --global` writing into `deps.gitConfigGlobal` is a write this repo causes and INS-02 says a write
  path states its category. **That is a register entry for a write door 3 cannot see** — same class
  as `cli/crontab.ts`'s `COMMAND_REGISTER` row. Consider `git` as a fourth `EXTERNAL_COMMANDS`
  member; today `kernel/runtime/exec.ts` names it and the register explicitly exempts it, so
  adding it here would need that exemption revisited. Flagged in Gaps.
- **`AbortSignal.timeout` on a long run.** Measured only on a 100 ms fake. Its documented behaviour
  is to kill the in-flight agent subprocess and reject; the first real observation is J3.17's.
- **The banner goes to stdout.** Under the supervisor the child's stdout is appended to the entry's
  log and `parseLine` returns null for both lines — the same shape as N1's `node:sqlite` warning
  (LOOP.md, settled). Noted in the file, not gated.

---

## J3.4 — `kernel/runtime/payload.ts`: the sentinel, last block wins  ·  HRN-10

**Goal:** one parser for the `<<<TAG … TAG>>>` payload shape, so no job re-implements extraction and
a malformed payload writes nothing.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/payload.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/payload.test.ts` (new)

**Do:**

```ts
export function extractBlock(stdout: string, tag: string): string | null;
export function extractFields(block: string): Record<string, string>;
```

- `extractBlock` — **last match wins**, `\r\n` normalised to `\n`, result trimmed, `null` when there
  is no closed block. HRN-10's own words: agents echo the template first, so the first block is the
  instruction and the last is the answer.
- `extractFields` takes the **block**, not the stdout — a deliberate split from the reference, whose
  `extractFields` re-scans stdout for a one-line `TAG k=v` shape. Our skill emits a multi-line
  `key=value` block, so the two halves compose: `extractFields(extractBlock(out, "SANDCASTLE") ?? "")`.
  One `=` splits at the **first** `=`, so `verified=npm test / 375 pass` keeps its value intact and a
  value containing `=` is not truncated. Unknown keys are carried through, never an error.
- Neither function knows any vocabulary. The vocabulary is `host/jobs/nightly-sandcastle.ts`'s
  (SKL-07: verdict parsing is code's, and the code that owns the verdict owns the vocabulary).

**Do (tests):**

1. Two blocks in one stdout → the **second** is returned. The single most important behaviour and the
   one a naive `exec()` gets wrong.
2. An unclosed `<<<SANDCASTLE` with no `SANDCASTLE>>>` → `null`.
3. No block at all → `null`, distinct from an empty block (`<<<T\n\nT>>>` → `""`).
4. `\r\n` line endings → normalised; the returned block has no `\r`.
5. A block whose tag is a prefix of another tag (`<<<SAND` inside `<<<SANDCASTLE`) does not
   cross-match. Regex built from `tag` must anchor the closing delimiter on the same tag.
6. `extractFields` over a real six-line block → six keys, `verified` keeps its `/` and its spaces.
7. `extractFields` over a line with no `=` → that line is skipped, the others survive; over `=value`
   (empty key) → skipped.
8. Indentation: a block indented two spaces inside a fenced code sample still parses — the reference
   learned this the hard way (a model that ends its report inside a list emits the same line two
   columns over, and anchoring at column 0 read that as NO PAYLOAD).
9. A 1 MB stdout with the block at the end parses in under 50 ms — a lower-bound-free shape check
   that the regex is not quadratic. Assert `< 500` ms with the measured value in a comment
   (exceptions-table row: an upper bound guarding two orders of magnitude, the J1.6 assertion-8
   shape).

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/payload.test.ts` reports 9 passing.
- [ ] AC2 — **last-wins fires.** Change `all.at(-1)` to `all[0]`. `npm test` exits non-zero on test
      1. Revert.
- [ ] AC3 — **the prefix-tag gate fires.** Build the closing pattern from a bare `\\w+` instead of
      the escaped `tag`. `npm test` exits non-zero on test 5. Revert.
- [ ] AC4 — **the first-`=` split fires.** Change `indexOf("=")` to `split("=")` with two parts.
      `npm test` exits non-zero on test 6 — `verified` is truncated. Revert.
- [ ] AC5 — `node --test test/layout.test.ts` and `node --test test/writes.test.ts` pass: the new
      file is named in §1 and names no `node:fs` member.

**Commit:** `payload: extractBlock / extractFields — last block wins (HRN-10)`

**Depends on:** J3.1.

**Risks / what could be wrong:**
- **Splitting `extractFields` away from the stdout scan is a deviation from the reference.** The
  reference needs the one-line `TAG k=v` form for its Slack/Jira readers; this repo has one consumer
  and a multi-line block. If a v1 plugin needs the one-line form, it is a second exported function,
  not a change to this one.

---

## J3.5 — `kernel/runtime/worktree.ts`: HRN-12, and what happens when a pass dies inside one  ·  HRN-12

**Goal:** a worktree this repo creates, names, hands to an agent, and removes — including the one
left behind when a pass is killed mid-run.

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

- `prepWorktree` is **idempotent and re-entrant**: if `path` already exists as a registered worktree
  it hard-resets it onto `base` (`git -C <path> reset --hard <base>` + `git -C <path> clean -fd`)
  rather than failing; otherwise `git -C <repo> worktree add -B <branch> <path> <base>`. Idempotence
  is what makes the crash case survivable without a lock.
- **`branch` carries `INSTANCE`** (INS-06). Two checkouts on one host are two repos, so branch names
  cannot collide — but `git worktree list` on a shared machine can, and an operator who cannot
  attribute a stale worktree cannot remove one. The branch is `nightly/<INSTANCE>`; the caller
  supplies it, and `host/jobs/nightly-sandcastle.ts` is where `INSTANCE` is spelled.
- **The crash case, answered explicitly.** A pass killed by SUP-13's SIGKILL leaves the worktree
  registered and on disk. Three things handle it, in order: (a) `prepWorktree` resets rather than
  refuses, so the **next** pass reuses it — the common case costs nothing; (b) `reapWorktrees(repo,
  under, keep)` runs `git -C <repo> worktree list --porcelain`, removes every registered worktree
  whose path is under `under` and is not `keep`, and returns what it removed — called by
  `nightly-sandcastle` at pass start, so a renamed or orphaned tree does not accumulate; (c)
  `git worktree prune` is run first, so a *deleted-directory-but-still-registered* entry is cleared.
  Nothing runs on a timer and nothing removes a worktree it did not create: `under` is always
  `projectPath(".doppelganger/worktrees")`, project-relative (INS-02).
- `teardownWorktree` = `git worktree remove --force <path>`, wrapped so a failure logs and does not
  throw — a stranded worktree is disk, not correctness, and the next `prepWorktree` reclaims it.
- `worktreePromptLines(wt)` returns the `{{WORKTREE}}` substitution: where to read, the base to diff
  against, the head SHA, and — the half the reference says is the important one — an explicit
  instruction **not** to fall back to the main checkout, which would silently answer every read.
- Every git call goes through `kernel/runtime/exec.ts`'s `git()` (HRN-19's wall clock).

**Do (tests):** every test builds a real git repo under `mkdtempSync` with
`git init -b main`, `git -c user.email=t@t -c user.name=t commit`.

1. `prepWorktree` creates the directory, registers it (`git worktree list` names it), checks out the
   branch, and `head` equals the base's SHA.
2. **Idempotent.** Call it twice; the second call succeeds and `git worktree list` still shows one.
3. **The crash case.** Create it, write an uncommitted file inside it, call `prepWorktree` again;
   the file is gone and `git -C <path> status --porcelain` is empty. This is the "a pass died
   mid-run" recovery, asserted.
4. **Reset onto a moved base.** Advance `main` by one commit, re-prep, assert `head` is the new SHA.
5. `teardownWorktree` removes the directory and deregisters it; calling it twice does not throw.
6. **`reapWorktrees` removes a stranded sibling and keeps the live one.** Create two under `under`,
   reap with `keep` = the first; assert the second is gone, the first is registered, and the returned
   array names exactly the second.
7. **`reapWorktrees` never touches a worktree outside `under`.** Create one in a sibling temp
   directory; reap; assert it survives and is not in the returned array.
8. **Prune-first.** `rm -rf` a registered worktree's directory, then reap; assert `git worktree list`
   no longer names it and nothing throws.
9. `worktreePromptLines` contains the worktree path, the base ref, the short head SHA, and the word
   the "do not read from" instruction is built on. It contains **no** path under `plugins/` or
   `.claude/` (HRN-16/SKL-08).

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/worktree.test.ts` reports 9 passing.
- [ ] AC2 — **the idempotence gate fires.** Remove the "already registered" branch so `prepWorktree`
      always calls `worktree add`. `npm test` exits non-zero on test 2 (git refuses an existing
      path). Revert.
- [ ] AC3 — **the crash-recovery gate fires.** Delete the `clean -fd` call. `npm test` exits
      non-zero on test 3 — the uncommitted file survives. Revert. This is the difference between
      "the next pass starts clean" and "the next pass inherits last night's half-edit".
- [ ] AC4 — **the reap scope gate fires.** Change the `under` filter to accept every registered
      worktree. `npm test` exits non-zero on test 7. Revert. A reaper that removes a worktree it did
      not create is worse than one that removes nothing.
- [ ] AC5 — **the prune gate fires.** Delete the `git worktree prune` call. `npm test` exits
      non-zero on test 8. Revert.
- [ ] AC6 — `git status --porcelain` is empty after `npm test`, and
      `git worktree list | wc -l` prints `1` (only the checkout itself) — no test worktree was
      registered against the real repo.
- [ ] AC7 — `node --test test/writes.test.ts` passes: `worktree.ts` names no `node:fs` write member
      and no absolute path literal, so it signs neither register. If a `mkdirSync` is needed for the
      parent directory, the row is added in the same commit.

**Commit:** `worktree: prep, teardown, reap — and the tree a killed pass leaves behind (HRN-12)`

**Depends on:** J3.1.

**Risks / what could be wrong:**
- **`git worktree add -B` moves a branch that already exists.** If a human is standing on
  `nightly/<INSTANCE>`, `-B` fails rather than silently moving it — which is correct, but the failure
  message is git's. The job's `not-on-base` guard (ruling 4) already refuses in that situation
  before `prepWorktree` is reached.
- **`reapWorktrees` reads `git worktree list --porcelain`**, whose format is stable but is a value
  outside this repo. The parser reads only the `worktree <path>` lines and ignores everything else,
  so a new field cannot break it — asserted by test 6 rather than by pinning the whole output.

---

## J3.6 — `kernel/runtime/runjob.ts`: one entry point, no caller learns which runner ran  ·  HRN-02, HRN-12, HRN-13, HRN-14, HRN-16, SKL-08

**Goal:** `runJob(job, deps)` — build the prompt from the skill NAME and the args, realize the
worktree, substitute `{{WORKTREE}}`, run, tear down, return one `RunResult`.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/runjob.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/kernel/runtime/runjob.test.ts` (new)

**Do:**

```ts
export interface RunJobDeps {
  readonly runner: Runner;
  readonly root: string;
  readonly logPath: string;
  readonly worktreeRoot: string;
  readonly env?: Readonly<Record<string, string>>;
}
export function buildPrompt(job: Job, args: Readonly<Record<string, string>>): string;   // pure
export function substitute(text: string, args: Readonly<Record<string, string>>): { out: string; missing: string[] };  // pure
export async function runJob(job: Job, deps: RunJobDeps): Promise<RunResult>;
```

**`buildPrompt` is the whole of HRN-16 and SKL-08, and it is pure:**

```
<OPUS_GUIDANCE>

/<skillOf(job)>

<key>=<value>            (one line per promptArgs entry, sorted, so two builds are byte-identical)
```

Nothing else. No path into a skill's directory, no environment read, no inline prompt text. The
skill is named; its payload stays in the markdown a human edits.

**`substitute` returns its `missing` keys rather than throwing**, and `runJob` throws once, naming
every one — the `boot()` shape (KRN-08) applied one layer down. A prompt shipped with an
unsubstituted `{{WORKTREE}}` is a prompt that tells an agent to read a literal brace.

**Order inside `runJob`:**

```
1. job.skill && job.exec both set, or neither      → throw (D10: there is no third shape)
2. permissionMode resolves to "bypassPermissions" and job.local !== true → throw  (HRN-14)
3. args = { ...job.promptArgs }
4. job.worktree ? prepWorktree(root, job.worktree, <worktreeRoot>/<branch-slug>) : null
   → args.WORKTREE = worktreePromptLines(wt).join("\n")
5. prompt = buildPrompt(job, args); substitute; throw on missing
6. req = { model: job.model ?? DEFAULTS.model, effort: …, permissionMode: …,
           cwd: wt?.path ?? root, deadlineMs: runTimeoutMs(job), maxIterations: job.maxIterations ?? 20,
           completionSignal: job.completionSignal ?? "<promise>COMPLETE</promise>", … }
7. try { return await deps.runner(req); } finally { if (wt) teardownWorktree(root, wt.path); }
```

**Step 2 is HRN-14 given a real meaning at N3.** With no worker pool, `local` selects nothing —
so instead of shipping an inert field, `runJob` makes it a **required declaration for a
write-capable run**: `bypassPermissions` means "this run may write anything on this host", and
`local: true` is the call site saying "and it must not leave this host". At M9 the same field
selects the dispatch branch and no job file changes. This is an addition to the row and is flagged
in Gaps.

**Step 7's `finally` is load-bearing** — the worktree is removed whether the run resolves, rejects,
or is aborted by the deadline.

**Do (tests):** `deps.runner` is a recording fake returning a fixed `RunResult`; `root` is a real
`mkdtempSync` git repo (worktree calls are real).

1. **The prompt names the skill and nothing else.** `buildPrompt` output contains `/nightly-sandcastle`
   exactly once, contains `OPUS_GUIDANCE`'s first line, contains every arg key, and contains no
   `plugins/`, no `.claude/`, no `SKILL.md`, no `process.env` (SKL-08, HRN-16).
2. **Deterministic.** Two calls with the same args are byte-identical (args sorted).
3. **`{{WORKTREE}}` is substituted by us.** A job with a `worktree` spec: the request's prompt
   contains the real worktree path and contains no `{{`.
4. **Missing keys throw once, naming all of them.** A prompt arg referencing `{{A}}` and `{{B}}` with
   neither supplied → one throw whose message names both.
5. **`cwd` is the worktree, not the root.** Assert `req.cwd === wt.path`, and for a job with no
   worktree, `req.cwd === deps.root`. Getting this wrong makes an agent edit the live checkout,
   which is the failure ruling 4 exists to prevent.
6. **Teardown on success and on failure.** After a resolving run and after a rejecting run, the
   worktree directory is gone and `git worktree list` does not name it. Two assertions.
7. **D10's two shapes.** A job with both `skill` and `exec` throws; a job with neither throws. The
   message names D10.
8. **HRN-14.** A job with `permissionMode: "bypassPermissions"` and no `local` throws, naming the
   field; with `local: true` it runs.
9. **HRN-13 reaches the request.** `req.deadlineMs` for a `taskClass: "impl"` job is strictly greater
   than for one without.
10. **Defaults flow.** A job naming no `model`/`effort`/`permissionMode` produces a request carrying
    `DEFAULTS`' three values — the one place inheritance is spelled (HRN-01).

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/runjob.test.ts` reports 10 passing.
- [ ] AC2 — **the cwd gate fires.** Change step 6 to `cwd: deps.root` unconditionally. `npm test`
      exits non-zero on test 5. Revert.
- [ ] AC3 — **the teardown gate fires.** Move `teardownWorktree` out of the `finally` into the
      success path. `npm test` exits non-zero on test 6's second half. Revert. This is N2 F3's
      lesson applied: a correct call in the wrong block is not a gated call.
- [ ] AC4 — **the HRN-14 gate fires.** Delete step 2. `npm test` exits non-zero on test 8. Revert.
- [ ] AC5 — **the missing-key gate fires.** Make `substitute` leave unknown placeholders in place
      and return `missing: []`. `npm test` exits non-zero on test 4. Revert.
- [ ] AC6 — **the SKL-08 gate fires.** Add `` `The skill is at plugins/${job.plugin}/skills/...` ``
      to `buildPrompt`'s output. `npm test` exits non-zero on test 1. Revert.
- [ ] AC7 — `git status --porcelain` is empty after `npm test`; `git worktree list | wc -l` prints
      `1`.

**Commit:** `runJob: skill by name, worktree realized, one RunResult (HRN-02, HRN-12, HRN-13, HRN-14, HRN-16, SKL-08)`

**Depends on:** J3.2, J3.4, J3.5.

**Risks / what could be wrong:**
- **`maxIterations` defaults to 20, copied from the reference, and this repo has measured nothing.**
  It is a runaway bound, not a target: the run stops on the completion signal. J3.17 records the real
  iteration count of the first pass and the default is retuned then, or kept with evidence.
- **Step 2 turns an optional field into a conditional requirement.** If the GAP step rejects the
  addition, the fallback is a `TST` assertion over job files instead of a runtime throw — weaker,
  because it cannot see a `runJob` called with a constructed object.
- **`runjob.ts` imports `worktree.ts`, so `kernel/ports/runner.ts` stays type-only.** If a later
  refactor moves `runJob` into the port, the port acquires a runtime dependency and D1's "a plugin
  never imports past `kernel/ports/`" starts meaning something different.

---

## J3.7 — TST-08 / HRN-11: every agent run names its model, and the model is pinned  ·  HRN-11, TST-08

**Goal:** make "every agent run names its model, a pinned version, never a floating alias" a failing
build rather than a sentence — and define "pinned" as a predicate that does not rot when Anthropic
ships a new family.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/test/model.test.ts` (new)

### Where the model string lives

**Exactly two places may spell one, and both are checked:**

1. `kernel/ports/job.ts`'s `DEFAULTS.model` — the one inherited value. J3.2 test 3 already asserts
   that file contains exactly one `claude-…` literal.
2. A `model:` key on a `defineJob({…})` or a `runJob({…})` object literal — a job naming its own tier.

Nothing else. `host/runner.ts` receives `req.model` and never writes a literal.

### What "pinned" means, as a predicate

Checked, 2026-08-26, against the current Anthropic model list: **current model IDs carry no date
suffix and are complete as written** — `claude-opus-5`, `claude-opus-4-8`, `claude-sonnet-5`,
`claude-haiku-4-5`, `claude-fable-5`. Appending a date is wrong, not more pinned. So "pinned" cannot
mean "has a date"; it means **the id names a generation and cannot silently become a different one**.

Two clauses, and the negative one is where the value is:

```ts
// A generation-naming id: family letters, then one or more numeric segments.
const PINNED = /^claude-[a-z][a-z0-9]*(?:-\d+)+$/;

// Spellings that FLOAT. Each one resolves to whatever is newest at call time.
const ALIASES = [
  /(^|-)latest$/,                                  // claude-opus-latest, claude-3-5-sonnet-latest
  /^(opus|sonnet|haiku|fable|mythos|default|opusplan)$/,  // the CLI's bare tier names
  /^claude$/,
];
```

`PINNED` accepts a family this plan has never heard of (`claude-<newfamily>-7`) — deliberate: a
regex enumerating today's families is a value outside this repo and would rot on the next release.
It rejects `claude-opus-latest` (no numeric segment), `opus` (no prefix), `claude-3-5-sonnet-latest`
(trailing non-numeric), and `""`. `ALIASES` is the belt: a spelling that somehow satisfies `PINNED`
and still floats fails the second clause. **This repo pins no exact model value** — the test asserts
shape and non-membership, never `model === "claude-opus-5"`.

### The scan, and every spelling it must survive

The reference's `model-declaration.test.ts` masks strings, template literals, comments and regex
literals, then counts braces. This plan **ports that masker** rather than writing a new one: it is
132 lines of measured-correct code whose failure mode the reference already documented (a mis-read
regex literal blanks the rest of a file and every call site in it stops existing — which reads as a
pass). Three things carry over with it:

- the `lost = raw.matchAll(CALL).length - masked.matchAll(CALL).length` self-check, which is the
  only thing that catches the masker failing silently;
- the `checked > N` floor, so a walk that stopped finding call sites fails rather than passing by
  finding nothing;
- the rule it implies, stated in a comment: **never spell `runJob(` or `defineJob(` inside a string
  in this repo**, because a mention and a swallowed call look identical from here.

**The floor is derived, not written.** N3 has exactly one job, so a hardcoded `checked > 18` would
be false. Instead: `assert.equal(checked, JOBS.length + runJobCallSites)` where `JOBS` is imported
from `host/jobs/index.ts` — the count comes from the registry, which a later job grows, not from a
number this commit writes. Until J3.10 exists, this job asserts `checked >= 1` **and** that the one
site it found is `kernel/ports/job.ts`'s `DEFAULTS`; J3.14 tightens it to the registry-derived
equality once the registry exists.

**Do (tests, `test/model.test.ts`):**

1. **Every `defineJob`/`runJob` object literal names `model`.** Walk `kernel/`, `host/`, `plugins/`,
   `cli/` (non-test files), mask, find call sites, take top-level keys, require `model` unless the
   literal has `exec` (a self-orchestrated job's top-level model is inert; its inner `runJob` calls
   are what this test reaches).
2. **The masker did not lose a call site.** `lost === 0` for every file, reported per file.
3. **Every model literal in the repo is PINNED.** Collect every `model:` value that is a string
   literal, plus `DEFAULTS.model`; each matches `PINNED`.
4. **No model literal is an ALIAS.** Each fails every `ALIASES` pattern. The test names the four
   rejected example spellings in its failure message so a reader learns the rule from the failure.
5. **The predicate itself is exercised over a table** — twelve fixture strings, six accepted
   (`claude-opus-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-fable-5`,
   `claude-opus-4-5-20251101`) and six rejected (`claude-opus-latest`, `opus`, `sonnet`, `claude`,
   `claude-3-5-sonnet-latest`, `""`). Without this, clauses 3 and 4 are satisfied by a regex that
   accepts everything.
6. **`DEFAULTS.model` is reachable from exactly one file** — `kernel/ports/job.ts` — so a bump moves
   one line and `grep -rn "model:" kernel host plugins cli` really is the blast radius. The test
   prints that grep's file list on failure.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test test/model.test.ts` reports 6 passing.
- [ ] AC2 — **clause 1 fires.** Delete `model: DEFAULTS.model` from a `defineJob` literal (at J3.7
      the only literal is a fixture inside the test's own walk target — so instead add a real
      one-line `export const probe = defineJob({ name: "ops-probe", description: "x", plugin: "ops" });`
      to `kernel/ports/job.ts`, exported so it is consumed). `npm test` exits non-zero naming
      `kernel/ports/job.ts:<line> — defineJob({ name, description, plugin })`. Revert.
- [ ] AC3 — **clause 4 fires.** Change `DEFAULTS.model` to `"claude-opus-latest"`. `npm test` exits
      non-zero on test 4, and *also* on test 3 (no numeric segment) — both, and the AC records both,
      because a rule that only one clause enforces is one edit from being unenforced. Revert.
- [ ] AC4 — **clause 4 fires on a bare alias too.** Change `DEFAULTS.model` to `"opus"`. `npm test`
      exits non-zero. Revert. Two mutations, because `--model opus` is what a human types and is the
      exact spelling HRN-11 bans.
- [ ] AC5 — **the masker self-check fires.** Add the line
      `export const doc = "call defineJob({ model: 1 }) to declare a job";` to `kernel/ports/job.ts`.
      `npm test` exits non-zero on test 2 (`masker lost 1 call site(s)`) — proving the self-check is
      live, not decorative. Revert.
- [ ] AC6 — **the predicate table fires.** Add `"opus"` to the accepted half of test 5's table.
      `npm test` exits non-zero. Revert.
- [ ] AC7 — `time node --test test/model.test.ts` stays under 3 s (it reads every non-test `.ts`
      file in four directories — ~60 files today).

**Commit:** `TST-08: every agent run names a pinned model, never a floating alias (HRN-11, TST-08)`

**Depends on:** J3.6.

**Risks / what could be wrong:**
- **The masker is 132 lines of ported code and it is the whole test.** Its own failure mode is
  silent. Test 2 is the only guard and the reference says so in as many words; this plan keeps that
  comment verbatim rather than paraphrasing it.
- **`PINNED` accepts a dated snapshot (`claude-opus-4-5-20251101`).** That is deliberate — a dated
  snapshot is maximally pinned — but it means the regex cannot also enforce "no date suffix on a
  current id", which is a naming convention, not a pinning property. Flagged in Gaps.

---

## J3.8 — `cli/skills.ts`: `render`, ownership, and the five findings  ·  SKL-03, SKL-04, SKL-05, SKL-10, TST-23

**Goal:** the pure half of the skills tool — one `render(source, srcDir)` that is byte-identical to
the file already on disk, one ownership predicate decidable from the filesystem alone, and a `check`
that names what is wrong rather than fixing it.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/cli/skills.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/cli/skills.test.ts` (new)

**Do — `render`, lifted from `test/skills-example.test.ts`'s local helper, unchanged:**

```ts
export const MARKER_RE = /^<!-- managed:doppelganger-skills v=(\d+) src=(\S+) -->$/;
export const MARKER_VERSION = 1;
export function render(sourceText: string, srcDirPosix: string): string;
```

frontmatter block, byte for byte · the two managed marker lines · the rest of the source, byte for
byte. **J0.10's `render` moves here and the test file imports it instead of keeping a copy** — a
second copy of a render function is drift with two authors.

**Ownership, from the filesystem alone (§5 Q0, settled at N0):**

```ts
export type Owner = "ours" | "foreign" | "absent";
export function ownerOf(dir: string): Owner;
```

`ours` ⟺ `<dir>/SKILL.md` exists **and** the line immediately after the closing frontmatter `---`
matches `MARKER_RE`. Anything else with a `SKILL.md` is `foreign`. No `SKILL.md` at all is also
`foreign` (SKL-10's own words: "anything else … is FOREIGN and never touched"). A directory that does
not exist is `absent`. **A hand-edited rendered file is still `ours`** — that is the point: it is
reported as `drift` and refused, not silently reclassified as someone else's and left alone.

**The findings — five named by SKL-10, and a sixth the roadmap does not name:**

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

**`source-missing` is an addition and is flagged in Gaps.** SKL-06's first half — "every `job.skill`
resolves to a real directory" — is about the *source*, and none of SKL-10's five findings covers a
job whose source file is gone. Without it, `check` would report `missing` (no rendered file) and a
`sync` would then crash reading a file that is not there. Findings are **sorted deterministically**
(kind, then name) so two runs produce the same report and a diff of two reports is meaningful.

**`SkillsTree` is a required `deps`-style argument** (ruling 2 from N2): `{ renderedRoot: string;
sourceRoot: string }`, no default, so a test cannot reach the real `.claude/skills/` by forgetting.
The real values are assembled in J3.9's argv block.

**Do (tests, `cli/skills.test.ts`):** every test builds a `mkdtempSync` tree; one test uses the real
one, read-only.

1. **`render` reproduces the file on disk.** Read the real
   `plugins/nightly/skills/nightly-sandcastle/SKILL.md` and the real `.claude/skills/…/SKILL.md`;
   `render(source, "plugins/nightly/skills/nightly-sandcastle")` equals the rendered bytes exactly.
   This is J0.10 test 4, now over the production function.
2. **`render` refuses a source with no frontmatter**, and one with an unclosed frontmatter — two
   throws, each naming the file.
3. **`render` is deterministic** — two calls are byte-identical.
4. **`ownerOf`**: a rendered file → `ours`; the same file with the marker line deleted → `foreign`;
   the same file with the marker moved three lines down → `foreign` (position is part of ownership);
   a directory with a `README.md` and no `SKILL.md` → `foreign`; a missing directory → `absent`.
5. **`ownerOf` on a hand-edited rendered file is still `ours`** — append a line after the marker;
   still `ours`. The assertion names SKL-10's "never silently re-rendered".
6. **missing** — a registered job, an empty rendered root → exactly one `missing`.
7. **drift** — append a line to the rendered copy → exactly one `drift`, and its `line` is the
   1-indexed first difference.
8. **orphan** — an extra `ours` directory named `ops-ghost` → exactly one `orphan`.
9. **collision** — a `SKILL.md` without the marker at the registered job's name → exactly one
   `collision`, and **no `drift`**: the two are mutually exclusive and reporting both would tell an
   operator to fix a file we do not own.
10. **stray** — `NOTES.md` beside a correct `SKILL.md` → exactly one `stray`, listing `NOTES.md`.
11. **source-missing** — a registered job whose source directory is absent → exactly one
    `source-missing`, and no `drift`.
12. **A clean tree returns `[]`**, and `[]` is what `check` returns for zero jobs and an empty tree —
    stated in the test title as a decision, not an accident.
13. **Determinism of the report** — build a tree with one of each finding, run `check` twice, assert
    the two arrays deep-equal.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test cli/skills.test.ts` reports 13 passing.
- [ ] AC2 — **`render` really is the same function J0.10 asserted.** Delete the second marker line
      from `render`. `npm test` exits non-zero on **both** `cli/skills.test.ts` test 1 and
      `test/skills-example.test.ts` test 4. Revert. Two files going red is the evidence that the
      copy was removed rather than duplicated.
- [ ] AC3 — **the marker-position rule fires.** Change `ownerOf` to search the whole file for
      `MARKER_RE` instead of the line after the frontmatter. `npm test` exits non-zero on test 4's
      third case. Revert.
- [ ] AC4 — **collision and drift stay exclusive.** Remove the `ownerOf === "ours"` guard from the
      drift branch. `npm test` exits non-zero on test 9 (two findings where one was expected).
      Revert.
- [ ] AC5 — **`source-missing` fires.** Delete the branch. `npm test` exits non-zero on test 11.
      Revert.
- [ ] AC6 — **no test can reach the real tree by forgetting.** `grep -c "renderedRoot" cli/skills.ts`
      is ≥ 1 and `cli/skills.ts` contains no `.claude/skills` string literal outside a comment:
      `grep -n '\.claude/skills' cli/skills.ts` prints only comment lines (or nothing).
- [ ] AC7 — `git status --porcelain` is empty after `npm test`; `.claude/skills/` is byte-unchanged
      (`git diff --stat .claude/` is empty).

**Commit:** `skills: render, ownership from the file, and the six check findings (SKL-03, SKL-04, SKL-05, SKL-10, TST-23)`

**Depends on:** J3.2 (for `Job`), J3.1.

**Risks / what could be wrong:**
- **`ownerOf` requiring the marker at a fixed position** is stricter than SKL-10's wording ("a
  managed marker in the body"). It is chosen because ownership must be decidable without parsing,
  and because `render` puts it there. A file whose marker drifted position is reported `foreign`,
  which is the conservative verdict: we do not touch it.
- **The sixth finding.** If the GAP step rejects `source-missing` as an unauthorised addition, the
  fallback is to fold it into SKL-06's gate (J3.13) — but then `sync` reads a missing file and
  throws a raw `ENOENT`, which is a worse operator experience for the same fault.

---

## J3.9 — `skills render | sync | check`: the prune, the argv block, the safe run  ·  SKL-04, SKL-10, SAF-01, TST-23

**Goal:** the impure half — the three verbs, a `sync` that prunes only what it owns, and a `check`
that fails the build without repairing it.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/cli/skills.ts` (verbs + argv block)
- `/home/hyhilman/projects/me/doppelganger/cli/skills.test.ts` (verb tests)
- `/home/hyhilman/projects/me/doppelganger/cli/skills-cli.test.ts` (new — the child-process smoke)
- `/home/hyhilman/projects/me/doppelganger/package.json` (`"skills": "node cli/skills.ts"`)
- `/home/hyhilman/projects/me/doppelganger/test/knobs.test.ts` (`ROWS` + one new row)
- `/home/hyhilman/projects/me/doppelganger/test/writes.test.ts` (`REGISTER`: `cli/skills.ts`)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27: `SKILLS_DRY_RUN`)

**Do — the same `run(argv, deps)` shape `cli/crontab.ts` already uses**, so an operator learns one
tool and gets two:

```ts
export interface SkillsDeps {
  readonly jobs: readonly Job[];
  readonly tree: SkillsTree;
  readonly dryRun: boolean;
}
export function run(argv: readonly string[], deps: SkillsDeps): { out: string; err: string; code: number };
```

| verb | behaviour |
|---|---|
| `render` | prints what each registered job's rendered file **would** contain; writes nothing; exit 0. The `crontab render` precedent exactly |
| `sync` | writes `missing`, rewrites `drift`, **removes** `orphan`, **refuses** `stray` and `collision` and `source-missing` with exit 1 and a per-finding line. Prints a per-file verb (`wrote`/`rewrote`/`pruned`) and the tally |
| `check` | prints every finding and exits 1 on any; exit 0 and a one-line tally when clean. **Never writes.** |

**Where the crontab precedent does NOT survive, stated because SKL-10 says so:** the crontab is one
file with a delimited block, so "foreign lines untouched" is a splice. `.claude/skills/` is a tree
with nowhere to put a block marker, so the unit of ownership is a **directory**, decided by
`ownerOf`. `sync` therefore never edits a foreign directory, never renames one, and never deletes
one — a `collision` is refused and reported, because the only correct fix is a human deciding whose
name it is.

**`sync`'s prune is scoped twice.** It removes a directory only when `ownerOf(dir) === "ours"` **and**
the directory sits directly under `deps.tree.renderedRoot`. It removes the directory, not its
contents — a `stray` inside would otherwise be deleted as collateral, which is exactly what SKL-10's
"REFUSES a stray" forbids. So the order inside `sync` is: **refuse first, write second, prune third.**
A run with any refusal writes nothing at all.

**SAF-01 for a CLI:** `SKILLS_DRY_RUN=1` makes `sync` print exactly what it would do and call no
write. `EnvSpec` row added to `kernel`-style `ROWS` and to §2.27. This is the second operator CLI
with a dry-run flag and no `SAF-` row that covers it (`CRONTAB_DRY_RUN` was the first) — the pair is
now a pattern and is flagged in Gaps.

**The argv block** (`if (import.meta.filename === process.argv[1]`) assembles the real deps —
`JOBS` from `host/jobs/index.ts`, `renderedRoot: projectPath(".claude/skills")`,
`sourceRoot: projectPath("plugins")`, `dryRun: envStr(SKILLS_DRY_RUN_ENV) === "1"` — and is
**UNTESTED BY CONSTRUCTION** (N2 ruling 1) except for one smoke check.

**Do (tests):**

`cli/skills.test.ts`, appended:

14. `render` writes nothing — snapshot the temp tree's `readdirSync` before and after; deep-equal.
15. `sync` on an empty rendered root writes the file and the bytes equal `render(source)`.
16. `sync` on drift rewrites and reports `rewrote`.
17. `sync` prunes an orphan and reports `pruned`; the directory is gone.
18. `sync` **refuses** a collision: exit 1, nothing written, nothing pruned — assert the tree is
    byte-identical afterwards, including the orphan that would otherwise have been pruned. This is
    "refuse first" asserted.
19. `sync` refuses a stray, and the stray file survives.
20. `sync` is idempotent — run it twice, second run prints `already in sync` and writes nothing.
21. `SKILLS_DRY_RUN` via `deps.dryRun: true` — prints the same plan, writes nothing.
22. `check` on a clean tree exits 0; on each of the six findings exits 1 and names it.
23. `sync` never touches a foreign directory that is **not** a registered job's name — create
    `.claude/skills/some-other-tool/SKILL.md` with no marker; after `sync` it is byte-identical.
    SKL-10's "never touches a foreign one", asserted directly.

`cli/skills-cli.test.ts` (child process, `spawnSync(process.execPath, ["cli/skills.ts", "check"])`
with `ENGINE_ROOT` pointed at a temp tree):

24. **The argv block parses and dispatches.** `check` on a temp tree with a registered job and no
    rendered file exits 1 and its stderr names `missing`. A **smoke check, not a test** (N2 ruling
    1) — it proves the block runs, not that it wired the right values.
25. **`check` against the REAL tree exits 0.** `spawnSync(process.execPath, ["cli/skills.ts", "check"])`
    in the real checkout, no env overrides. This is TST-23 as a build gate, run the way an operator
    runs it.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test cli/skills.test.ts` reports 23 passing and
      `node --test cli/skills-cli.test.ts` reports 2.
- [ ] AC2 — `npm run skills check` exits 0 and prints a one-line tally naming 1 skill.
- [ ] AC3 — **the drift gate fires, on the real tree.** `printf '\n<!-- drift -->\n' >> .claude/skills/nightly-sandcastle/SKILL.md`.
      `npm run skills check` exits 1 naming `drift` and the first differing line; `npm test` exits
      non-zero. Then `npm run skills sync` restores it and `git diff --stat .claude/` is empty.
      Three commands, and the third is the proof that `sync` is the repair path and `check` is not.
- [ ] AC4 — **the missing gate fires.** `rm -rf .claude/skills/nightly-sandcastle`; `npm test` exits
      non-zero naming `missing`; `npm run skills sync` restores it byte-for-byte
      (`git status --porcelain .claude/` empty).
- [ ] AC5 — **the orphan gate fires and prune is scoped.** `mkdir -p .claude/skills/ops-ghost && cp
      .claude/skills/nightly-sandcastle/SKILL.md .claude/skills/ops-ghost/`; `npm test` exits
      non-zero naming `orphan`; `npm run skills sync` removes `ops-ghost` and leaves
      `nightly-sandcastle` untouched. `git status --porcelain` clean afterwards.
- [ ] AC6 — **the collision gate fires and refuses.** Replace the rendered `SKILL.md` with a copy
      that has the two marker lines deleted. `npm test` exits non-zero naming `collision`;
      `npm run skills sync` exits **1** and the file is still the marker-less copy — `sync` did not
      "fix" a file it does not own. Restore with `git checkout .claude/`.
- [ ] AC7 — **the stray gate fires.** `touch .claude/skills/nightly-sandcastle/NOTES.md`; `npm test`
      exits non-zero naming `stray`; `npm run skills sync` exits 1 and `NOTES.md` still exists.
      `rm` it.
- [ ] AC8 — **refuse-first fires.** In `sync`, move the refusal check after the write loop.
      `npm test` exits non-zero on test 18. Revert.
- [ ] AC9 — **the foreign-untouched gate fires.** Drop the `ownerOf === "ours"` guard from the prune.
      `npm test` exits non-zero on test 23 — and record the message, because that mutation is a tool
      deleting a directory it did not create.
- [ ] AC10 — `node --test test/knobs.test.ts` reports 7 passing with `SKILLS_DRY_RUN` in `ROWS`;
      remove the row and confirm assertion 2 exits non-zero. `sed -n '/^### 2\.27/,/^### 2\.28/p'
      roadmap.md | grep -c 'SKILLS_DRY_RUN'` prints `1`.
- [ ] AC11 — `git status --porcelain` is empty after `npm test`.

**Commit:** `skills sync/check/render: the prune, the refusals, the argv block (SKL-04, SKL-10, SAF-01, TST-23)`

**Depends on:** J3.8, J3.10 (for `host/jobs/index.ts`).

> **Ordering note.** The argv block imports `host/jobs/index.ts`, which J3.10 creates. Two ways to
> keep the suite green: land J3.10 first, or land J3.9 with `deps.jobs` supplied by the caller and
> the argv block's import added by J3.10. **This plan takes the first** — J3.10 moves ahead of J3.9
> in the commit order, and the "Job order" list above reflects the numbering, not the sequence. The
> GAP step should confirm the renumbering rather than the ordering.

**Risks / what could be wrong:**
- **`sync` removing a directory is the only destructive operation in this tool.** Three things bound
  it: `ownerOf === "ours"` (a marker we wrote), the parent must be `renderedRoot` (a required dep),
  and `SKILLS_DRY_RUN`. AC9's mutation is the proof the first one is load-bearing.
- **`.claude/skills/` is a gate resource (`skills`, `host/config.ts`) and this CLI takes no gate.**
  It is an operator tool, not a scheduled entry, so nothing orders it against a running agent.
  Flagged in Gaps — INS-05's sibling problem for a CLI.

---

## J3.10 — JOB-C15's pure decisions, and the hand-registered job list  ·  JOB-C15, SKL-02, SKL-05, SKL-07, TST-19, HRN-10

**Goal:** everything `nightly-sandcastle` decides without touching the world — the verdict, the
blocked paths, the goal rotation, the smoke probe — plus the registry SKL-05 requires.

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

Hand-registered, duplicate-throws at import (`KRN-01`'s shape, one phase early and one file wide):
a five-line loop over `JOBS` throwing on a repeated `name` at module scope. **No directory scan** —
SKL-05's whole content, and the reference's `run.ts` gets this wrong (`readdirSync(JOBS_DIR)`), which
is worth a comment naming the deviation. A test (J3.14) asserts the directory and the list agree in
both directions; the *list* is what exists, the directory is only ever checked.

**Do — the pure decisions:**

```ts
export const OUTCOMES = ["changed", "none", "too-large", "suite-failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export interface Verdict { goal: string; outcome: Outcome; files: readonly string[]; ids: readonly string[]; summary: string; verified: string; }
export function parseVerdict(stdout: string): Verdict | null;

export const BLOCKED: readonly { re: RegExp; why: string }[] = [...];
export function blockedBy(file: string): string | null;      // returns the `why`, or null

export const GOALS: readonly { key: string; title: string; brief: string }[] = [...];
export function nextGoal(state: { index: number; recent: readonly string[] }): { goal: Goal; nextIndex: number };

export function importSmoke(path: string): string;
export function head(out: string, n?: number): string;
export function tail(out: string, n?: number): string;
```

**`parseVerdict` reproduces the markdown's vocabulary and nothing else.** It calls
`extractBlock(stdout, "SANDCASTLE")` then `extractFields`, and returns `null` — never a partial
verdict — when: there is no block · `outcome` is absent · `outcome` is not in `OUTCOMES` · `goal` or
`summary` is absent. HRN-10's "malformed payload writes nothing", made a return value. `files` and
`ids` split on `,`, and the literal `-` means the empty list (the skill's own convention). **The
vocabulary check is where SKL-07 lands**: the values a run may report are a list in code, and a
skill that emits something outside it produces `null`, not a widened outcome.

**`BLOCKED` — seven rows, each with its own `why`,** because a list of regexes with no reasons is a
list of things somebody once approved:

| pattern | why |
|---|---|
| `^host/schedule\.ts$` | JOB-C15 names it. The crontab is generated from it and `npm test` says nothing about whether a job still fires |
| `^host/supervisor\.ts$` | JOB-C15 names it. One process owns every tick; a bad edit stops all of them |
| `^host/jobs/nightly-sandcastle\.ts$` | JOB-C15 names it. A job that can rewrite its own kill switch does not have one |
| `^package(-lock)?\.json$` | JOB-C15 names it. A dependency change is not reviewable from a diff stat at 3am |
| `^plugins/[^/]+/skills/` | its own prompt. A pass that rewrites the instructions the next pass reads is unbounded |
| `^\.claude/skills/` | rendered, never hand-edited (SKL-04); an edit here is drift `skills check` would fail anyway |
| `^\.github/` | a green suite says nothing about whether CI still runs it |

`blockedBy` returns the **reason**, so a refusal message says why rather than which regex index.

**The four things the markdown calls "off limits" are covered, and a test proves the coverage**
rather than trusting two lists to agree — see J3.13.

**`GOALS`** — three at N3, each a `{ key, title, brief }`, phrased for THIS repo:
`docs-vs-code` (a claim in `CLAUDE.md`/`roadmap.md` checked against the source, and where the claim is
derivable, wire the drift gate instead of re-typing the value) · `test-gaps` (a behaviour with no
test that goes red when deleted — LOOP.md's own standing rule turned into a goal) ·
`dead-weight` (remove a thing rather than add one). `nextGoal` rotates by index and returns the next
index; `recent` steers off a file just touched. Pure.

**`importSmoke(path)`** — this repo has no `tsx`; Node strips types natively. Measured on Node
22.23.1: `node -e 'import("<abs>.ts").then(()=>{}, e=>{console.error(e);process.exit(1)})'` returns
0 for a good module, 1 with `SyntaxError: Expression expected` for a syntax error, and 1 with the
thrown message for a throw at load. The path is `JSON.stringify`'d — it is source code, not a
string. **The reference's three-day silent failure is why this function is exported and tested at
all**: its `tsx -e` probe built CJS, top-level `await` was a build error there, and the smoke
rejected 100% of inputs from the job's first commit while reading as a strict gate.

**Do (tests):**

1. **`parseVerdict` accepts the block the skill actually documents.** The fixture is the report
   template lifted verbatim from `plugins/nightly/skills/nightly-sandcastle/SKILL.md` with the
   angle-bracket placeholders filled — read from the file at test time, not retyped, so the test
   fails if the skill changes shape.
2. Two blocks → the second wins (HRN-10 through this consumer).
3. `outcome=shipped` (outside the vocabulary) → `null`.
4. Missing `outcome` → `null`. Missing `goal` → `null`. Missing `summary` → `null`.
5. `files=-` → `[]`; `files=a.ts,b.ts` → two entries, trimmed.
6. A `verified=` value containing `=` and `/` survives intact.
7. **`blockedBy` covers the four things the markdown names.** Parse the "Off limits:" bullet from the
   source `SKILL.md`, map each named thing to a concrete repo path, assert `blockedBy` returns a
   non-null reason for each. **This is the SKL-07 line made mechanical**: the skill may *describe* a
   rule, and code must *enforce* one at least as strong.
8. `blockedBy` returns `null` for a path a pass legitimately edits (`CLAUDE.md`, `kernel/stages.ts`,
   `roadmap.md`).
9. Every `BLOCKED` row has a non-empty `why`, and no two rows share one.
10. `nextGoal` cycles through all three and wraps; `nextIndex` is always in range.
11. `importSmoke` **accepts a module that loads** — the case the reference's probe could never
    reach. Runs the real probe against a real `mkdtempSync` `.ts` file and against a real repo file
    (`kernel/stages.ts`).
12. `importSmoke` rejects a syntax error, a missing relative import, and a throw at load — three
    cases, each asserting `head(out)` names the fault.
13. `importSmoke` JSON-encodes its path: a path containing `"` and `\` produces a probe string whose
    quoting is intact.
14. `head` leads with the error class, drops `at ` frames and the `Node.js v…` banner, and stays
    under 400 characters. `tail` takes the last meaningful lines. Both are needed and the comment
    says which failure each is right for.
15. **`host/jobs/index.ts` throws on a duplicate name** — a local re-registration helper is exercised
    with two jobs of one name.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test host/jobs/nightly-sandcastle.test.ts` reports 14 passing
      and `host/jobs/index.test.ts` 1.
- [ ] AC2 — **the vocabulary gate fires.** Add `"shipped"` to `OUTCOMES`. `npm test` exits non-zero
      on test 3. Revert. (J3.13 adds the other direction: the markdown and `OUTCOMES` must agree.)
- [ ] AC3 — **the partial-verdict gate fires.** Make `parseVerdict` return a verdict with
      `summary: ""` instead of `null` when `summary` is absent. `npm test` exits non-zero on test 4.
      Revert.
- [ ] AC4 — **the markdown-coverage gate fires.** Delete the `^host/supervisor\.ts$` row from
      `BLOCKED`. `npm test` exits non-zero on test 7 naming `host/supervisor.ts`. Revert. This is the
      mutation that makes the skill's prose a checked claim.
- [ ] AC5 — **the import smoke really accepts a loading module.** Replace `importSmoke`'s body with
      the reference's broken form (`await import(...)` at top level under `node -e`, which is legal
      here) — it still passes, so instead make the mutation the one that matters: change the
      rejection branch to `.then(()=>{}, ()=>{})` (swallow the error). `npm test` exits non-zero on
      test 12 — the probe now accepts everything. Revert. **A probe that accepts everything is the
      exact failure the reference shipped for three days, and this AC is the only thing that catches
      it.**
- [ ] AC6 — `node --test test/layout.test.ts` passes (both files named in §1 by J3.1),
      `node --test test/model.test.ts` passes (the registry now has one job with a `model` key),
      `node --test test/writes.test.ts` passes.
- [ ] AC7 — `git status --porcelain` is empty after `npm test`; `ls /tmp | grep -c nightly-smoke` is
      unchanged (every probe fixture is under `mkdtempSync` and removed in an `after` hook).
- [ ] AC8 — `time node --test host/jobs/nightly-sandcastle.test.ts` stays under 8 s — six real
      `node -e` child processes at ~60 ms each plus start-up. Record the measured value.

**Commit:** `nightly-sandcastle: the verdict, the blocked paths, the goals, the import smoke (JOB-C15, SKL-02, SKL-05, SKL-07, TST-19, HRN-10)`

**Depends on:** J3.2, J3.4.

**Risks / what could be wrong:**
- **The `defineJob` literal in this file names `model`, `skill`, `worktree`, `local` and
  `permissionMode` before J3.12 writes `exec`.** That is fine — `Job.exec` is optional and J3.12
  adds it. But `runJob` (J3.6) throws when neither `skill` nor `exec` is set, and this job has
  `skill`, so it is valid at every commit in between.
- **Three goals is a guess.** The reference has more. Three is enough for rotation to be observable
  and small enough that each brief can be written for this repo rather than adapted from another.
- **`test/model.test.ts`'s floor** (J3.7) tightens here — the registry now exists, so the count
  becomes derived. Doing that is J3.14's job, not this one; until then the loose floor stands.

---

## J3.11 — JOB-C15's ship gate: the suite, the import smoke, the dry run  ·  JOB-C15, SAF-05, TST-19

**Goal:** the three tiers that decide whether tonight's diff may land, cheapest first, each a real
signal — and a scratch DB redirect that makes the third tier safe even when the pass just edited the
code that keeps its own promise.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/jobs/nightly-sandcastle.ts` (the gate)
- `/home/hyhilman/projects/me/doppelganger/host/jobs/nightly-sandcastle.test.ts` (gate tests)

**Do:**

```ts
export interface GateDeps {
  readonly work: string;                                     // the worktree path
  readonly runIn: (dir: string, cmd: string, args: readonly string[], env?: Record<string,string>) => { ok: boolean; out: string };
  readonly scratch: string;                                  // a throwaway directory for the DB redirect
}
export interface GateResult { ok: boolean; detail: string; }
export function gate(files: readonly string[], deps: GateDeps): GateResult;
```

Tiers, in order, each returning on the first failure:

1. **Blocked paths.** `files.filter(blockedBy)` — a string match, free, and it must be first: a pass
   that touched `host/supervisor.ts` should not spend three minutes on a suite before being refused.
   The detail names the file **and its `why`**.
2. **`npm test` in the worktree.** The contract the repo already keeps. Detail is `tail(out)` — a
   suite's verdict is its last lines.
3. **An import smoke of every changed non-test `.ts` file.** Catches what a green suite does not: a
   file with no test that no longer parses or throws at module load. Detail is `head(out)` — a
   crashed child's class and message are its *first* non-frame line, and the reference measured that
   `tail` is useless here because every Node dump ends `}` / `Node.js v22.x`.
4. **A dry run of every changed job.** For each changed `host/jobs/<name>.ts` that is in the registry
   and has a `*_DRY_RUN` knob, run `node host/run.ts <name>` with `<NAME>_DRY_RUN=1` **and every
   `<NS>_DB` pointed into `deps.scratch`**. Detail is `head(out)`.

**The DB redirect is the load-bearing half of tier 4, and the comment says so:** a dry-run flag is
the job's own promise about itself, and this gate exists precisely because tonight's pass may have
just edited the code that keeps it. The namespace list is **derived, not written**: `DB_NAMESPACES`
is exported from the job and asserted (J3.13) against every `openDb(dbPath(<ns>))` call site in the
repo, so a new integration cannot be forgotten. At N3 the list is `["nightly", "logtail"]`.

`deps.runIn` is a **required** field (ruling 2) — a test supplies a recording fake and never spawns
`npm test` inside a test. The real one is a thin wrapper over `execFileSync` with a 300 s timeout
and a 16 MB buffer, assembled in J3.12's `exec`.

**Do (tests):** `runIn` is a fake that returns scripted results per `(cmd, args)`.

16. **Tier 1 refuses and returns first.** A file list containing `host/supervisor.ts`; assert `ok`
    is false, the detail contains the row's `why`, and the fake recorded **zero** calls — no suite
    was run.
17. **Tier order.** A clean file list with a failing `npm test`: assert the fake was called once and
    no import smoke ran.
18. **Tier 3 runs once per changed non-test source file**, and skips `.test.ts` files and non-`.ts`
    files. Assert the exact call list.
19. **Tier 4 runs only for changed registry jobs with a dry-run knob**, and the env it passes
    contains `<NAME>_DRY_RUN=1` and one `<NS>_DB` per `DB_NAMESPACES` entry, every value under
    `deps.scratch`. Assert every DB value `startsWith(deps.scratch)`.
20. **A passing gate's detail counts what ran** — `npm test, 2 import smoke(s), 1 dry run(s)` — and
    the counts come from the arrays, not from literals.
21. **Docs-only change.** A file list of one `.md` file: `npm test` runs, no import smoke, no dry
    run, `ok` true.
22. **An empty file list never reaches the gate** — `gate([])` is not called by `exec` (asserted in
    J3.12); here, assert it returns `ok: true` with a detail saying so, rather than running a suite
    over nothing.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test host/jobs/nightly-sandcastle.test.ts` reports 21
      passing (14 from J3.10 + 7 here).
- [ ] AC2 — **tier order fires.** Move the blocked-path check after `npm test`. `npm test` exits
      non-zero on test 16 (the fake recorded a call). Revert.
- [ ] AC3 — **the DB redirect fires.** Remove the `<NS>_DB` loop from tier 4's env. `npm test` exits
      non-zero on test 19. Revert. Record the message, because without this the third tier runs a
      possibly-broken dry run against the live store.
- [ ] AC4 — **the smoke/dry-run selection fires.** Change tier 3's filter to include `.test.ts`
      files. `npm test` exits non-zero on test 18. Revert.
- [ ] AC5 — **the detail counts are derived.** Change tier 3's count in the detail string to a
      literal `1`. `npm test` exits non-zero on test 20. Revert — a count written by hand in a report
      is the drift `TST` exists to refuse.
- [ ] AC6 — `grep -n "execFileSync\|spawnSync" host/jobs/nightly-sandcastle.test.ts` prints nothing:
      no test in this group spawns a process. (J3.10's import-smoke tests do, and they are a
      different group with their own budget in AC8 there.)
- [ ] AC7 — `git status --porcelain` is empty after `npm test`.

**Commit:** `nightly-sandcastle: the three-tier ship gate and its scratch DB redirect (JOB-C15, SAF-05, TST-19)`

**Depends on:** J3.10.

**Risks / what could be wrong:**
- **Tier 2 runs `npm test` inside a worktree whose `node_modules` may be absent.** `git worktree add`
  does not copy `node_modules`, and this repo's `pretest` is `tsc`, which needs `typescript` and
  `@types/node`. Two options: a `node_modules` symlink created by `prepWorktree`'s caller, or
  `--prefix`. **This plan symlinks**: `ln -s <root>/node_modules <work>/node_modules` in J3.12,
  registered as a project-relative write, because a per-run `npm ci` in a worktree is minutes of the
  pass budget and a second copy of 15 MB of source maps. Named here because it is the single most
  likely thing to make tier 2 fail for a reason unrelated to the diff.
- **300 s is a guess for `npm test`'s timeout.** Measured today the suite is 11.5 s. The bound is
  ~26× headroom and is stated as such, not as a measurement.

---

## J3.12 — JOB-C15's pass: `exec()`, the landing, and the whole safe-run surface  ·  JOB-C15, SAF-01…SAF-07, INS-06, KRN-07, INV-1

**Goal:** the pass itself — rotate, refuse, prep, run, check the escape, gate, land or discard,
report — with every write path env-gated so any of it can be exercised without touching the outside
world.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/jobs/nightly-sandcastle.ts` (`exec`, the knobs, the state store)
- `/home/hyhilman/projects/me/doppelganger/host/jobs/nightly-sandcastle.test.ts` (pass tests)
- `/home/hyhilman/projects/me/doppelganger/test/knobs.test.ts` (`ROWS` + seven new rows)
- `/home/hyhilman/projects/me/doppelganger/test/writes.test.ts` (`REGISTER`: the job file)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§2.27: the seven knobs)

**The knobs — seven rows, and the whole safe-run surface is these seven:**

| key | default | `why` (the one-line knob doc, KRN-06) |
|---|---|---|
| `NIGHTLY_NO_SANDCASTLE` | `0` | KRN-07 kill switch: the pass logs `killed` and returns before reading anything |
| `NIGHTLY_SANDCASTLE_BASE` | `main` | the branch a pass lands on; a checkout on any other branch refuses (`not-on-base`) |
| `NIGHTLY_SANDCASTLE_DRY_RUN` | `0` | SAF-01: run the agent and the gate for real, write nothing — no commit, no merge, no state |
| `NIGHTLY_SANDCASTLE_NO_MERGE` | `0` | SAF-02 shadow mode: commit inside the worktree, never move the base branch |
| `NIGHTLY_SANDCASTLE_MAX` | `1` | SAF-03/04: passes per tick. `0` is the free smoke test — everything but the agent |
| `NIGHTLY_SANDCASTLE_MODEL` | *(none)* | override the tier one pass spends on, without a code change |
| `NIGHTLY_DB` | *(the `<NAME>_DB` family)* | SAF-05: point the rotation store at a throwaway file |

`NIGHTLY_DB` is **not** a new row — it is the `<NAME>_DB` family `kernel/paths.ts` already declares
(N1 Gaps item 4). Six new `ROWS` entries, six §2.27 lines.

**INV-1: there is no local state file.** The reference keeps rotation in
`.sandcastle/nightly-sandcastle.json`. This repo has a declared state store (DBS-01), so rotation
lives in `nightly.db` under namespace `nightly` (DBS-02/03), with an append-only migration and a
`nightly_meta` row. That satisfies INV-1, gets `SAF-05` for free, and gets `TST-20`'s shared-database
discipline for free. **This is a deviation from the reference and it is an improvement, not a
liberty** — INV-1 is carried over verbatim and a JSON file next to the code is exactly what it bans.

**The pass, as an ordered list — every step is a place it can stop:**

```
 1. NIGHTLY_NO_SANDCASTLE=1        → log info killed, return                          (KRN-07)
 2. branch !== BASE                → log warn skip reason=not-on-base, return         (ruling 4)
 3. status --porcelain non-empty   → log warn skip reason=tree-dirty, return          (ruling 4)
 4. MAX === 0                      → run steps 5-8 and 13, skip 9-12, log free-smoke  (SAF-04)
 5. reapWorktrees(root, worktreeRoot, keep)                                           (HRN-12)
 6. state = readState(db); goal = nextGoal(state)
 7. wt = prepWorktree(root, { branch: `nightly/${INSTANCE}`, base: BASE }, path)       (INS-06)
 8. symlink <root>/node_modules into wt                                                (J3.11 risk)
 9. run = await runJob(job, deps)                                                      (HRN-02)
10. verdict = parseVerdict(run.stdout)                                                 (HRN-10)
11. escaped = porcelain(root) !== before  → log error write-scope-escaped              (the escape check)
12. files = changedFiles(wt);  files.length === 0 ? no-op : gate(files) ? land : discard
13. report → log.raw(body);  DRY_RUN ? return : writeState(db, nextIndex, recent)
    finally: teardownWorktree
```

**Step 11, the escape check, is the one that has no gate above it.** The agent runs under
`bypassPermissions` on a host with no isolation; nothing *stops* it writing outside the worktree.
What N3 does is **detect and report**: `git status --porcelain` on the main checkout is captured
before and compared after, and any change logs `level=error event=write-scope-escaped` with the
paths. It does **not** revert or stash — the reference learned that reverting a shared checkout
destroys a human's concurrent work, and this repo has no `escape-stash` module (it is not an N3
row). Named honestly as **detection without containment**, and flagged in Gaps.

**The landing, step 12:**

```
git -C <wt> add -A -- <the changed paths, as a pathspec, never bare -A>
git -C <wt> commit -m "chore(nightly): <summary>" -m "nightly sandcastle — goal: <key>"
git -C <root> merge --ff-only nightly/<INSTANCE>
```

`--ff-only` is the guarantee: the base only ever moves forward onto a commit made on top of it, so a
concurrent human commit makes this **fail loudly** instead of merging. **The ff-miss recovery** (§3's
N3 line names it): on failure, `git -C <wt> rebase <BASE>` once, re-run `gate(files)` from scratch,
and retry the merge; a second failure discards and reports `ff-miss`. The re-gate is not optional —
a rebased diff is a different diff and landing it on the strength of the pre-rebase gate is exactly
the shape JOB-C15 exists to prevent.

**SAF-07 — the one non-free dry run, named.** `NIGHTLY_SANDCASTLE_DRY_RUN=1` **runs the agent**. It
is inert against the repository — no commit, no merge, no state write — but it spends one Opus pass.
`NIGHTLY_SANDCASTLE_MAX=0` is the free one. Both facts go in the two knobs' `why` lines, and a test
asserts the `why` of `NIGHTLY_SANDCASTLE_DRY_RUN` contains the word `costs`. That is SAF-07's "must
be documented as such", made a failing assertion rather than a promise.

**Do (tests):** `exec(deps)` takes `{ root, runner, git, now, db, log }`, every field required. Every
test builds a real `mkdtempSync` git repo and an in-memory-path SQLite file under it.

23. **The kill switch.** `NIGHTLY_NO_SANDCASTLE=1`: one `event=killed` line, the fake runner recorded
    zero calls, `git log` unchanged.
24. **`not-on-base`.** The temp repo is on `feature/x`, base is `main`: one
    `event=skip reason=not-on-base`, zero runner calls.
25. **`tree-dirty`.** An uncommitted file in the temp repo: one `event=skip reason=tree-dirty`, zero
    runner calls.
26. **`MAX=0` is free and complete.** Zero runner calls, **and** a worktree was prepared and torn
    down, the goal rotated, and a report line was emitted. SAF-04's "everything but the model calls",
    asserted as four separate things — otherwise "free" degrades into "does nothing".
27. **The happy path lands.** The fake runner writes a file in the worktree and returns a stdout
    carrying a `changed` verdict; the fake `gate` passes. Assert: one commit on `nightly/<INSTANCE>`,
    the base branch's HEAD moved to it, one `event=landed` line carrying the sha and the goal.
28. **`DRY_RUN=1` runs the agent and lands nothing.** Assert: the runner was called **once**, the
    base HEAD is unchanged, the worktree has **no** commit, and the rotation state in the DB is
    unchanged. Four assertions — the last one is the one people forget.
29. **`NO_MERGE=1` commits in the worktree and does not move the base.** Assert the worktree HEAD
    advanced and the base HEAD did not.
30. **A failing gate discards.** Assert `git -C <wt> status --porcelain` is empty afterwards (hard
    reset + clean), the base is unchanged, and one `event=gate-failed` line carries the detail.
31. **A blocked path is a gate failure, not a crash.** The fake runner touches
    `host/supervisor.ts` inside the worktree; assert `gate-failed` and the detail names the `why`.
32. **No verdict is a warning, not a failure.** The runner returns stdout with no block; assert the
    report says the agent emitted no report block, and the pass still lands if files changed —
    matching the reference's "the agent can land a good diff and still botch its report block; never
    ship `chore: -`" (the commit subject falls back to the goal title).
33. **The escape check fires.** Write a file into `deps.root` (outside the worktree) from the fake
    runner; assert one `level=error event=write-scope-escaped` line naming the path, and that the
    file is **still there** (detection, not containment — the test title says so).
34. **The ff-miss recovery.** Advance the base by one commit *while* the fake runner runs; assert the
    first `merge --ff-only` fails, a rebase happens, `gate` is called a **second** time, and the merge
    succeeds. Then the same with a second failure: assert `event=ff-miss` and the base unchanged.
35. **Rotation advances once per landing pass and not on a dry run** — three passes, assert the goal
    keys cycle; then a dry-run pass, assert the index did not move.
36. **`INSTANCE` is in the branch name and every path is project-relative** (INS-06). Under a probe
    `ENGINE_ROOT` and `INSTANCE=probe`: the branch is `nightly/probe`, the worktree path and the DB
    path both start with the probe root, and nothing resolves outside it.
37. **SAF-07 is documented.** `NIGHTLY_SANDCASTLE_DRY_RUN`'s `EnvSpec.why` contains `costs`, and
    `NIGHTLY_SANDCASTLE_MAX`'s contains `free`.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test host/jobs/nightly-sandcastle.test.ts` reports 36
      passing.
- [ ] AC2 — **the kill switch fires.** Delete step 1. `npm test` exits non-zero on test 23. Revert.
- [ ] AC3 — **`not-on-base` fires.** Compare against `"main"` as a literal instead of against the
      knob. `npm test` exits non-zero on test 24 (the fixture repo's base is a temp branch name).
      Revert. This is N2 F1's lesson: the guard must check the property it claims, and a hardcoded
      `main` is a guard against a different repo.
- [ ] AC4 — **`--ff-only` fires.** Change the merge to plain `git merge`. `npm test` exits non-zero
      on test 34's second half — the merge succeeds where it must fail. Revert. **Record the output**,
      because a silent non-ff merge at 3am is a merge commit nobody reviews.
- [ ] AC5 — **the re-gate fires.** Delete the second `gate(files)` call in the rebase-retry path.
      `npm test` exits non-zero on test 34. Revert.
- [ ] AC6 — **the dry-run state gate fires.** Move `writeState` above the `DRY_RUN` return.
      `npm test` exits non-zero on test 28's fourth assertion. Revert.
- [ ] AC7 — **the escape check fires.** Delete the before/after porcelain comparison. `npm test`
      exits non-zero on test 33. Revert.
- [ ] AC8 — **SAF-07's documentation gate fires.** Remove the word `costs` from the dry-run knob's
      `why`. `npm test` exits non-zero on test 37. Revert.
- [ ] AC9 — `node --test test/knobs.test.ts` reports 7 passing with the six new rows; remove one from
      `ROWS` and confirm assertion 2 exits non-zero. `sed -n '/^### 2\.27/,/^### 2\.28/p' roadmap.md
      | grep -c 'NIGHTLY_SANDCASTLE_'` prints `4` and `grep -c 'NIGHTLY_NO_SANDCASTLE'` prints `1`.
- [ ] AC10 — `node --test test/writes.test.ts` reports 6 passing with `host/jobs/nightly-sandcastle.ts`
      in `REGISTER` as `project-relative`; remove the row and confirm door 3 exits non-zero.
- [ ] AC11 — **nothing reached the real checkout.** After `npm test`: `git status --porcelain` empty,
      `git log --oneline -1` unchanged from before the run, `git worktree list | wc -l` prints `1`,
      `git branch --list 'nightly/*'` prints nothing, and `test -e .doppelganger && echo LEAK || echo clean`
      prints `clean`.
- [ ] AC12 — `time node --test host/jobs/nightly-sandcastle.test.ts` stays under 30 s. Fourteen real
      git repos under `mkdtempSync`, each a handful of `git` calls. Record the measured value; if it
      exceeds 30 s, share one repo per group rather than loosening the bound.

**Commit:** `nightly-sandcastle: the pass, the landing, and the safe-run surface (JOB-C15, SAF-01…07, INS-06, KRN-07, INV-1)`

**Depends on:** J3.6, J3.11.

**Risks / what could be wrong:**
- **This is the largest job in the phase by a wide margin** — 14 tests and ~12 ACs. Splitting it
  would put a half-written `exec` in a commit, and the suite must be green at every commit. If the
  GAP step wants it split, the seam is step 12: "the pass up to the verdict" and "the landing", with
  the second commit adding steps 12-13 and tests 27-34.
- **Detection without containment (step 11).** A `bypassPermissions` agent on a bare host can write
  anywhere. N3 reports it. The reference's answer is `escape-stash.ts`, which has no roadmap row.
  Flagged in Gaps.
- **`node_modules` symlink into the worktree.** A `git status` in the worktree would show it as
  untracked unless `.gitignore` covers it — it does (`node_modules/`). But `git clean -fd` in the
  discard path would remove the symlink; the discard uses `clean -fd -e node_modules`, and a test
  should assert the symlink survives a discard. **Add that as test 30's second assertion.**

---

## J3.13 — SKL-06 both ways, TST-23 live, TST-24, and the vocabulary that lives in markdown  ·  SKL-02, SKL-06, SKL-07, SKL-09, TST-23, TST-24

**Goal:** the gate that runs both directions over the real registry and the real filesystem, and the
one that makes `parseVerdict` reproduce a vocabulary a human edits in markdown.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/test/skills.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/test/skills-example.test.ts` (tests 9 and 10 rewritten)

**Do — `test/skills.test.ts`, over `JOBS` and the real tree:**

1. **TST-23 live.** `check(JOBS, { renderedRoot: ".claude/skills", sourceRoot: "plugins" })` returns
   `[]`. One assertion, and it is the build gate SKL-04 promises: *drift FAILS the build; it is never
   silently re-rendered.* The failure message prints every finding, one per line.
2. **SKL-06, direction one.** Every `skillOf(job)` resolves to a real **source** directory
   `plugins/<job.plugin>/skills/<skill>/` holding a `SKILL.md`.
3. **SKL-06, direction two.** Every source skill directory under `plugins/*/skills/` is named by a
   registered job. *An orphan skill is a prompt nothing runs.*
4. **SKL-02.** No two jobs share a skill name, and no plugin contributes a skill whose name is the
   plugin's own name — the "one `/corpus` with a mode argument" shape, refused. At N3 there is one
   plugin and one job, so clause 2 is the one with content; clause 1 is a set-size check that costs
   nothing and starts working the day a second job lands.
5. **The rendered set equals the source set equals the registry set.** Three sets, two `deepEqual`s.
   This replaces `test/skills-example.test.ts` test 9's hand-held comparison, which had no registry
   to compare against at N0 and said so.
6. **SKL-09.** For every job, the file a human invokes at `/<name>` and the file the unattended pass
   uses are the same bytes: `readFileSync(.claude/skills/<name>/SKILL.md)` equals
   `render(readFileSync(<source>), <srcDir>)`. Stated separately from finding `drift` because SKL-09
   is a claim about *identity of procedure*, and reading it out of a findings array buries it.
7. **SKL-07, the output vocabulary, both directions.** Parse `outcome=<a|b|c|d>` out of the **source**
   `SKILL.md` and `assert.deepEqual` it to `OUTCOMES` imported from
   `host/jobs/nightly-sandcastle.ts`. **Neither side is written by this commit** — the markdown
   pre-dates N0's first code commit and `OUTCOMES` landed in J3.10 — so this is a real drift gate,
   not a number asserted by its own author. This is how "N3's real `parseVerdict` must reproduce the
   pinned vocabulary" (LOOP.md) becomes mechanical.
8. **SKL-07, the authorization-token ban, narrowed to where a grant could live.** Extract the
   `<<<SANDCASTLE … SANDCASTLE>>>` block from every source `SKILL.md` and assert it contains no
   member of `AUTH_TOKENS = ["agent"]` (JOB-T03's, the row SKL-07 cites; N5). **Narrowed on purpose:**
   N0's stand-in asserted `!source.includes("agent")` over the whole file, which bans an ordinary
   English word from prose. A grant has to appear in what the skill EMITS to widen anything, so the
   report block is the correct scope and the whole-file scan was over-broad. The test's comment
   records the change and why.
9. **No skill reads the environment or names a path into its own files** (SKL-08, HRN-16) — carried
   over from `test/skills-example.test.ts` test 8, now over every registered skill rather than one
   hardcoded path.
10. **Every skill directory name carries a SUP-20 stage prefix** — the third of TST-09's consumers,
    asserted here where the directory list is already in hand. J3.14 asserts the other three against
    each other.

**Do — `test/skills-example.test.ts`:** delete test 9 (superseded by test 5 above, which has a
registry), and rewrite test 10 to import `AUTH_TOKENS` and scope to the report block. Keep tests
1-8: they are the *worked example*'s own gate and they must survive the general one, because a
general gate over a registry of one is exactly as strong as its one member.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test test/skills.test.ts` reports 10 passing and
      `test/skills-example.test.ts` reports 9 (was 10 — test 9 removed). Record both counts in the
      commit body.
- [ ] AC2 — **the vocabulary drift gate fires, from the markdown side.** Change
      `outcome=<changed|none|too-large|suite-failed>` to
      `outcome=<changed|none|too-large|failed>` in
      `plugins/nightly/skills/nightly-sandcastle/SKILL.md`, re-render with `npm run skills sync`.
      `npm test` exits non-zero on test 7 naming both lists. `git checkout plugins/ .claude/` to
      revert. **This is the one AC that proves the markdown and the code cannot drift apart.**
- [ ] AC3 — **the vocabulary drift gate fires from the code side too.** Remove `"too-large"` from
      `OUTCOMES`. `npm test` exits non-zero on test 7 **and** on `host/jobs/nightly-sandcastle.test.ts`
      test 1 (the fixture's outcome is no longer accepted). Revert.
- [ ] AC4 — **SKL-06 direction two fires.** `mkdir -p plugins/nightly/skills/ops-ghost && cp
      plugins/nightly/skills/nightly-sandcastle/SKILL.md plugins/nightly/skills/ops-ghost/`.
      `npm test` exits non-zero on test 3. `rm -rf` it.
- [ ] AC5 — **SKL-06 direction one fires.** Change `nightly-sandcastle`'s `plugin` field to `"ops"`.
      `npm test` exits non-zero on test 2 naming the missing source directory. Revert.
- [ ] AC6 — **the auth-token ban fires where it should and not where it should not.** Insert
      `agent=allow` inside the report block in the source `SKILL.md` + `npm run skills sync` →
      `npm test` exits non-zero on test 8. Revert. Then insert the sentence
      `The agent decides what the change is.` into the skill's **prose** + sync → `npm test` exits
      **0**. Revert. Two mutations, and the second is the one that shows the narrowing was correct.
- [ ] AC7 — **TST-23 live fires.** `printf '\n' >> .claude/skills/nightly-sandcastle/SKILL.md`;
      `npm test` exits non-zero on test 1 with `drift`; `npm run skills sync` restores;
      `git status --porcelain` clean.
- [ ] AC8 — `git status --porcelain` is empty after every mutation is reverted, and
      `git diff --stat plugins/ .claude/` is empty.

**Commit:** `SKL-06 both ways, TST-23 live, and the vocabulary drift gate (SKL-02, SKL-06, SKL-07, SKL-09, TST-23, TST-24)`

**Depends on:** J3.8, J3.9, J3.10.

**Risks / what could be wrong:**
- **Narrowing test 10's scope is a change to a landed N0 gate.** It is a real weakening in one
  direction (prose can now say "agent") and a real strengthening in another (it is now derived from
  a named `AUTH_TOKENS` list rather than one inline string, and it runs over every skill rather than
  one). Flagged in Gaps so the GAP step rules rather than the builder.
- **`AUTH_TOKENS` has one member and its consumer is N5.** A denylist of one, guarding a row that
  does not exist yet, is close to a placeholder. It is kept because SKL-07 names JOB-T03 explicitly
  and because the alternative — no check at all until N5 — is what TST-24 exists to prevent.

---

## J3.14 — TST-09: one name, four consumers  ·  TST-09, SUP-20, SKL-01, SKL-05

**Goal:** the job registry, the `host/jobs/` directory, the skill directories and the schedule
entries all name the same set, and every name carries a known stage prefix.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/test/jobs.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/test/model.test.ts` (the floor becomes derived)

**Do:**

1. **Every registered job's name carries a known SUP-20 prefix** — `stageOf(job.name) !== MISC`, with
   the message naming `STAGES`. The vocabulary is `kernel/stages.ts`'s, imported, never re-listed.
2. **The registry and the directory agree, both ways.** `JOBS.map(j => j.name)` sorted equals every
   `host/jobs/*.ts` minus `*.test.ts` and minus `index.ts`, sorted. **The list is what exists; the
   directory is only checked** (SKL-05) — the failure message says which side is which, because
   "add the file" and "register the job" are different fixes.
3. **Every registered job is default-exported by its own file**, and `import(f).default.name ===
   <filename>`. A job file whose default export names a different job is a file that would run under
   the wrong log, the wrong gate and the wrong skill.
4. **Every schedule entry naming a `job` names a registered one**, and every registered job that is
   *scheduled* appears at most once in `SCHEDULE`. (A registered job need not be scheduled — a job a
   human runs by hand is legitimate; an entry naming an unregistered job is not.)
5. **Every schedule entry name carries a known prefix** — already `validate()` rule 2, asserted here
   over the real `SCHEDULE` so the third consumer is covered by the same test as the other three.
   Vacuous until J3.16 lands the first entry; **this job therefore lands after J3.16 or asserts
   nothing** — see the ordering note.
6. **`test/model.test.ts`'s floor becomes derived.** Replace `checked >= 1` with
   `assert.equal(checked, JOBS.filter(j => j.exec === undefined || j.model !== undefined).length + EXTRA)`
   where `EXTRA` counts `runJob(` literal call sites, and both operands come from the walk and the
   registry, never from a number this commit writes.

**Ordering note.** Assertions 4 and 5 need a non-empty `SCHEDULE`. This job is listed at 14 for
grouping, and **lands after J3.16**. The alternative — ship it now with 4 and 5 written as vacuous
`[] === []` checks — is the exact shape N2 deleted three of (ruling 1's VACUOUS grade) and this plan
will not reintroduce it.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test test/jobs.test.ts` reports 6 passing.
- [ ] AC2 — **the prefix gate fires.** Rename the job to `sandcastle-nightly` in
      `host/jobs/nightly-sandcastle.ts`'s `defineJob`. `npm test` exits non-zero on assertion 1
      **and** on `test/skills.test.ts` assertion 2 (the skill no longer resolves) **and** on
      `host/validate.test.ts` via `validate()` rule 2. Three files, and recording all three is the
      point: SUP-20 says one name, three consumers, and this is the evidence. Revert.
- [ ] AC3 — **the registry/directory gate fires, both ways.** (a) `touch host/jobs/ops-ghost.ts` with
      a valid default export → `npm test` exits non-zero naming an unregistered file. `rm` it.
      (b) Remove `nightlySandcastle` from `JOBS` → `npm test` exits non-zero naming an unregistered
      job. Revert.
- [ ] AC4 — **the default-export gate fires.** Change the `name` inside the `defineJob` literal to
      `"nightly-other"` while leaving the filename alone. `npm test` exits non-zero on assertion 3.
      Revert.
- [ ] AC5 — **the model floor is derived.** Add a second job to `JOBS` (a two-line
      `defineJob` with a `model`) and confirm `test/model.test.ts` stays green; remove the `model`
      key from it and confirm it goes red. Then remove the fixture job. This proves the floor tracks
      the registry rather than a written constant.
- [ ] AC6 — `git status --porcelain` is empty after `npm test`.

**Commit:** `TST-09: one name across the registry, the directory, the skills and the schedule (TST-09, SUP-20, SKL-01, SKL-05)`

**Depends on:** J3.10, J3.13, J3.16.

**Risks / what could be wrong:**
- **Assertion 3 imports every job file**, which runs its module scope. `host/jobs/nightly-sandcastle.ts`
  reads `EnvSpec` defaults at module scope (like every other file in the repo) but must not open a
  database or touch git there. If it does, this test finds out — which is the good failure.
- **Assertion 4's "at most once" is weaker than "exactly once".** A registered job with no schedule
  entry is legitimate at N3 (nothing else is scheduled) and would become suspicious at N5 when the
  `ops` builtins arrive. Stated, not enforced.

---

## J3.15 — `host/run.ts`: `npm run job <name>`  ·  HRN-02, SKL-05, D10

**Goal:** the one command that runs a job by name, and the one argv block where the real runner, the
real root and the real log path are assembled.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/run.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/host/run.test.ts` (new)
- `/home/hyhilman/projects/me/doppelganger/package.json` (`"job": "node host/run.ts"`)

**Do:**

```ts
export function resolveJob(name: string | undefined, jobs: readonly Job[]): Job | { error: string };
export function jobListing(jobs: readonly Job[]): string;       // byStage, the SUP-20 payoff
export async function runNamed(job: Job, deps: RunDeps): Promise<number>;   // exit code
```

- **Gate on the NAME, never on catching the import.** The reference says it and it is right: a job
  that throws while *loading* (syntax error, bad import) must surface as its own error, not be
  disguised as "no such job" by a blanket `try/catch`. Since our registry is a hand-written list
  (SKL-05), the whole file is imported at module load anyway — so the failure surfaces before
  `resolveJob` is reached, which is stronger than the reference's arrangement.
- `jobListing` groups by `byStage` from `kernel/stages.ts` — the reason the prefixes exist, printed.
- `runNamed` dispatches D10's two shapes and no third: `job.exec` → call it with the assembled deps
  and return 0; otherwise `runJob(job, deps)` and report `iterations`, `commits.length` and
  `completionSignal ?? "none"` on stderr (LOG-06: stdout stays free for the payload).
- **The argv block** assembles `runner: sandcastleRunner({ gitConfigGlobal: projectPath(".doppelganger/gitconfig") })`,
  `root: ROOT`, `worktreeRoot: projectPath(".doppelganger/worktrees")`,
  `logPath: projectPath(`.doppelganger/runs/${name}-${utcStamp()}.log`)`, `db: openDb(dbPath("nightly"))`,
  `git`, `now`. **UNTESTED BY CONSTRUCTION** except for one smoke check.

**Why the run log is `.doppelganger/runs/` and not `.doppelganger/logs/`:** sandcastle's run log is
human prose, not logfmt. Under `LOG_ROOTS` it would be walked by `tail.ts` (harmless — `parseLine`
returns null for every line, the same as N1 settled for the `node:sqlite` warning) but it would also
be **subject to LOG-08's copy-then-truncate rotation while sandcastle holds it open in append mode**,
which is a real corruption hazard for a file nothing needs rotated. One file per run keeps any single
file small. **Nothing prunes the directory before `ops-retention` (JOB-O06, N5)** — flagged in Gaps.

**Do (tests):**

1. `resolveJob(undefined, JOBS)` → an error naming `usage: npm run job <name>`.
2. `resolveJob("nope", JOBS)` → an error naming `unknown job "nope"` and listing the available ones.
3. `resolveJob("nightly-sandcastle", JOBS)` → the job object, `strictEqual` to the registry's.
4. `jobListing(JOBS)` groups under the `nightly` stage heading and names the job.
5. `runNamed` with an `exec` job calls `exec` once and returns 0; the fake `runner` is never called.
6. `runNamed` with a skill-only job calls `runner` once and returns 0; a rejecting runner returns a
   non-zero code and the error message reaches stderr rather than being swallowed.
7. **The argv smoke check** (child process): `node host/run.ts` with no argument exits non-zero and
   its stderr names `usage`. `node host/run.ts nope` exits non-zero and names `unknown job`. Both
   with `ENGINE_ROOT` pointed at a temp directory. A **smoke check, not a test** — it proves the
   block parses and dispatches, not that it wired the right values.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test host/run.test.ts` reports 7 passing.
- [ ] AC2 — `npm run job` (no argument) exits non-zero and prints the job list grouped by stage.
      `npm run job nope` exits non-zero naming `unknown job "nope"`.
- [ ] AC3 — **`npm run job nightly-sandcastle` with the kill switch is the cheapest live proof the
      whole wiring works.** `NIGHTLY_NO_SANDCASTLE=1 npm run job nightly-sandcastle` exits 0 and its
      stderr carries one logfmt line with `event=killed`. This runs the **real** argv block — the
      real `sandcastleRunner`, the real `openDb`, the real paths — and stops before spending
      anything. Record the line in the commit body.
- [ ] AC4 — **the name gate fires, and is not a swallowed import.** Add
      `import "./does-not-exist.ts";` to `host/jobs/nightly-sandcastle.ts`. `npm run job
      nightly-sandcastle` exits non-zero with `Cannot find module` naming that specifier — **not**
      with `unknown job`. Revert. This is the reference's own rule, asserted.
- [ ] AC5 — after AC3, `test -e .doppelganger/runs && echo present || echo absent` prints `absent`
      (the kill switch returns before any run log is opened) and `git status --porcelain` is empty.
- [ ] AC6 — `node --test test/layout.test.ts` passes: `host/run.ts` is named in §1 by J3.1.

**Commit:** `host/run.ts: npm run job <name>, and the one place the real runner is assembled (HRN-02, SKL-05, D10)`

**Depends on:** J3.3, J3.6, J3.10.

**Risks / what could be wrong:**
- **The argv block is the only untested wiring in the phase** and it now assembles seven real values.
  AC3 is the mitigation: it runs the real block end to end and stops at the kill switch, so a typo in
  any of the seven surfaces as an exception rather than as a 3am silence.
- **`openDb` at argv-block scope opens a file.** That is correct (it is the real run) and it is why
  AC5 checks the checkout is clean afterwards — the kill switch path must not leave a `nightly.db`
  behind. If it does, move `openDb` behind the kill-switch check inside `exec`.

---

## J3.16 — the first `SCHEDULE` entry and `PROGRAMS` row  ·  SUP-01, SUP-02, SUP-03, SUP-12, GAT-07, TST-09

**Goal:** the moment N3 exists for. One entry, one program row, and every `validate()` rule that has
only ever seen a fixture now sees a real value.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/schedule.ts` (`SCHEDULE`, `PROGRAMS`)
- `/home/hyhilman/projects/me/doppelganger/host/schedule.test.ts` (the empty-schedule assertion)
- `/home/hyhilman/projects/me/doppelganger/host/window.test.ts` (the SUP-12 live assertion)
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
    maxRunMin: 60,
    why: "hourly overnight (23:38–04:38 WIB): one small, verified improvement to this repo, gated on the full suite, an import smoke of every changed file and a dry run of every changed job (JOB-C15). :38 leaves the :08s free for nightly-polish (JOB-C16, N5) so the pair fires every 30 minutes without sharing a minute — both take the gate exclusively, non-blocking, so a shared minute would mean one silently skipping every night.",
  },
];

export const PROGRAMS: Readonly<Record<string, Program>> = {
  "nightly-sandcastle": { self: true, gate: "excl", resources: ["repo", "skills"], dotenv: true },
};
```

**Six field decisions, each with its reason:**

- **`cron: "38 16-21 * * *"`** — inside the croner ∩ POSIX intersection N2 measured: `dow` is
  unrestricted, so the whole dom+dow divergence class (20 missed pairs across 14 March dates) cannot
  apply. Six firings a night.
- **`gate: "excl"` on `["repo", "skills"]`, not on `["repo"]`.** The pass moves `repo` (worktree,
  branch, `merge --ff-only`) and **reads `skills` for its whole duration** — the agent loads the
  rendered skill tree mid-run, so anything rewriting that tree changes the prompt under a running
  agent. **The gate cannot express "excl on A, shared on B"** (GAT-01…09 say nothing about a mixed
  hold), so the entry over-excludes. That costs nothing while one entry exists and is flagged in
  Gaps as a real hole the first real entry found.
- **`self: true`** — GAT-06. A pass runs minutes; the next tick is an hour away, but a wedged pass
  under SUP-13's 60-minute bound would otherwise overlap its successor exactly once.
- **`gateWait` unset** — GAT-08's zero, the old `flock -n`. A contended tick skips, because the next
  tick sees the same work. Correct for an hourly job and wrong for a daily one.
- **`dotenv: true`** — SUP-04. `NIGHTLY_SANDCASTLE_BASE` lives in `.env` while this loop runs on
  `dev`, and it must reach the child.
- **`maxRunMin: 60`** — **no measurement exists at N3**, and the `why` says so. The reference's pass
  takes ~5 minutes; 60 is a runaway bound, not a target, and J3.17 records the first real duration.

**`log:` is a module-scope `projectPath` call in `host/`, and door 6 does not fire — measured, and
that is a hole, not a blessing.** `test/writes.test.ts` door 6 matches a top-level call only when the
line starts at column 0 or the call sits on the same line as `export const`. `SCHEDULE`'s entries are
indented inside an array literal, so the call is invisible to it — a limit the door's own comment
already declares ("one spread across a multi-line top-level declaration's continuation lines.
Accepted"). This job does **not** widen door 6 and does **not** add an exception; it records the
reasoning: `projectPath` performs no I/O, `ENGINE_ROOT` redirects it, SUP-01 requires the schedule to
be DATA rather than a function, and `kernel/runtime/log/tail.ts`'s `LOG_ROOTS` already does exactly
this one layer down. Flagged in Gaps.

### Which `validate()` rules fire for the first time, and what could break

Every one of the 23 rules has been exercised over fixtures. These now run against real values:

| rule | first real exercise | what could break |
|---|---|---|
| 2 — stage prefix | `nightly-sandcastle` | nothing; `nightly-` is in `STAGES` |
| 3/4 — cron grammar | `38 16-21 * * *` through `parseFive` | a range in the hour field is the first non-`*` field the real schedule has ever carried |
| 5/6 — log absolute, under a root | `projectPath(".doppelganger/logs/…")` | **`LOG_ROOTS[0]` and this path must both derive from the same `ROOT`.** They do — both are `projectPath` — but a test that sets `ENGINE_ROOT` for one and not the other now fails rule 6 rather than silently passing |
| 10 — job file exists | `host/jobs/nightly-sandcastle.ts` via `jobsDir = projectPath("host/jobs")` | **this is the sharpest one.** `cli/crontab.ts`'s `render()` calls `validate(entries)`, so **`npm run crontab render|sync|check` now stats a real path**. Any crontab test running under a temp `ENGINE_ROOT` without a `host/jobs/` directory goes red. J2.16's tests pass `CRONTAB_CMD` and a temp state file but keep the real `ENGINE_ROOT` — checked, they stay green; this row exists so the GAP step re-checks it |
| 14 — a `PROGRAMS` row exists | `PROGRAMS["nightly-sandcastle"]` | the first time rule 14 finds a row instead of erroring |
| 15 — resources are known names | `["repo","skills"]` vs `RESOURCE_NAMES` | the first live coupling between `host/config.ts` and `host/schedule.ts` |
| 16 — `shared` must not set resources | not applicable (`excl`) | — |
| 17 — `none` needs `whyNoGate` | not applicable | — |
| 22/23 — bootstrap | no entry sets `supervised: false` | **`crontab render` still emits a managed block with zero command lines**, because only bootstrap entries render. Nothing starts the supervisor yet — that is JOB-O10/SUP-09 at N4, and this job writes that sentence into `host/schedule.ts`'s header so it is not rediscovered |

**Three other things move the day this entry lands, and each gets an assertion:**

- **`host/parity.test.ts`'s corpus is `[...FORMS, ...SCHEDULE.map(e => e.cron)]`** (N2's design, so
  the first entry is walked with no test to remember). `38 16-21 * * *` fires 84 times in 14 days;
  measured cost of one croner walk at that density is well under 100 ms. AC5 records the suite delta.
- **`supervisor --list`'s footer** goes from `0 supervised, 0 on the real crontab` to
  `1 supervised, 0 on the real crontab`. No test asserts the real one (test 37 uses `list([])`), but
  AC3 records the output.
- **`crontab check`'s tally** goes from `(0 more run under host/supervisor.ts)` to `(1 more …)`.

**SUP-12's live assertion, which N2 deliberately deferred to N3.** `REFRESH_WINDOW` is still `null`
and N3 does **not** invent one — declaring a window for a single job would be inventing the subject
(N2's own discipline). So `entriesInWindow(SCHEDULE, REFRESH_WINDOW, PROGRAMS)` remains `[]` and
remains vacuous, and no vacuous test is shipped. What *is* real and is shipped: the same call over
the **real** `SCHEDULE` and **real** `PROGRAMS` with a **fixture window** covering 16:00–22:00 UTC
returns exactly `[{ name: "nightly-sandcastle", gate: "excl" }]`. That is a genuine assertion about
the real entry — it goes red if the cron moves out of the window or the program's gate changes — and
it is the strongest form available while no window exists. `host/window.ts`'s "REMINDER FOR N3"
header is rewritten to say the entry landed, the window did not, and which phase gets one.

**Do:** also add `.sandcastle/` to `.gitignore`. Measured: with `logging.path` set and
`branchStrategy: "head"`, sandcastle creates no such directory — but a human running
`npx @ai-hero/sandcastle init` or a future strategy change would, and an untracked directory inside a
worktree is a directory `git add` can sweep into a nightly commit.

**Do (tests):**

- `host/schedule.test.ts`: replace `assert.deepEqual(SCHEDULE, [])` with: `SCHEDULE` has one entry;
  `validate()` over the real schedule does not throw (the real call, no fixtures, no options — the
  first non-vacuous `validate(SCHEDULE)` in the repo's life); `programOf` of the entry has a
  `PROGRAMS` row; the entry's `log` is under `LOG_ROOTS[0]`.
- `host/window.test.ts`: the fixture-window assertion above, plus the unchanged `null` case.
- **The two ceilings must not collide.** `host/schedule.test.ts` asserts
  `runTimeoutMs({}) < (entry.maxRunMin ?? SUPERVISOR_MAX_RUN_MIN) * 60_000` **and** the same for a
  `taskClass: "impl"` job. Two numbers in two files agreeing by luck is exactly the drift the `TST`
  convention refuses: if the runner's abort deadline were the longer one, SUP-13 would SIGKILL a
  pass that was about to report cleanly, and the log would say `signal=SIGTERM` with no cause.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0. Record the new totals (`# tests`, `# pass`, `# skipped`) in the
      commit body against the 375/373/2 baseline.
- [ ] AC2 — **`validate(SCHEDULE)` is now a real gate.** Change the entry's `cron` to `38 16-21 * * MON`
      (a `dow` name — outside the croner ∩ POSIX intersection). `npm test` exits non-zero from
      `host/schedule.test.ts`, and `npm run crontab check` also exits non-zero with the same message.
      Revert. Two surfaces, one rule.
- [ ] AC3 — `node host/supervisor.ts --list` prints one row under a `nightly` stage heading and the
      footer `1 supervised, 0 on the real crontab`. Record the whole output in the commit body — it
      is the first time this command has had anything to list.
- [ ] AC4 — **rule 10 fires.** Rename `host/jobs/nightly-sandcastle.ts` to `.bak`. `npm test` exits
      non-zero naming `job file does not exist: <abs path>`; `node host/supervisor.ts --list` still
      works (it never calls `validate`, SUP-17's own decision, J2.14). Restore.
- [ ] AC5 — **the parity corpus really grew.** `CRON_PARITY_RECHECK=1 node --test host/parity.test.ts`
      exits 0 and its output names `38 16-21 * * *`. Record `time` for
      `node --test host/parity.test.ts` before and after this job.
- [ ] AC6 — **the SUP-12 fixture-window assertion fires.** Change the entry's `cron` to
      `38 6-9 * * *` (outside the fixture window). `npm test` exits non-zero on `host/window.test.ts`.
      Revert. Then change the program's `gate` to `"shared"` and confirm the same test goes red on
      the `gate` field. Revert. Two mutations, because an allowlist row that only checks the name is
      half a row.
- [ ] AC7 — **the gate resource coupling fires.** Change `resources` to `["repo", "plugins"]`.
      `npm test` exits non-zero on rule 15 naming the unknown resource. Revert.
- [ ] AC8 — `npm run crontab render` still emits a managed block with zero command lines, and
      `npm run crontab check` (with `CRONTAB_CMD` pointed at a fake) reports
      `0 bootstrap entries (1 more run under host/supervisor.ts)`.
- [ ] AC9 — **the two-ceiling gate fires.** Raise `RUN_TIMEOUT_IMPL_MS`'s default above
      `maxRunMin * 60_000`. `npm test` exits non-zero on `host/schedule.test.ts`, naming both values.
      Revert.
- [ ] AC10 — `git status --porcelain` is empty after `npm test`; `test -e .doppelganger && echo LEAK
      || echo clean` prints `clean`.

**Commit:** `the first schedule entry: nightly-sandcastle (SUP-01, SUP-02, SUP-03, SUP-12, GAT-07, TST-09)`

**Depends on:** J3.10, J3.15.

**Risks / what could be wrong:**
- **Rule 10 makes `cli/crontab.ts` depend on the real filesystem.** `render()` → `validate()` →
  `existsSync(projectPath("host/jobs/<job>.ts"))`. Every crontab test that keeps the real
  `ENGINE_ROOT` is fine; one that redirects it is not. Checked against J2.15/J2.16's tests, which
  redirect `CRONTAB_CMD` and the state file but not the root — but the GAP step should re-check,
  because a red here reads as a crontab bug and is a schedule bug.
- **`maxRunMin: 60` versus `runTimeoutMs`.** The supervisor's bound and the runner's abort deadline
  are two ceilings on one pass. They must not be equal — if the runner's deadline is longer, SUP-13
  SIGKILLs a run that would have reported cleanly. `runTimeoutMs`'s default must be **strictly less**
  than `maxRunMin * 60_000`, and that relation deserves an assertion. **Add it to J3.16's test list**
  rather than leaving two numbers in two files to agree by luck.

---

## J3.17 — the manual step: one real pass, and its stdout becomes the fixture  ·  JOB-C15, TST-19, HRN-11, SAF-07

**Goal:** the only thing in N3 that a test cannot do. One real agent pass, on a real login, with the
real skill, and the artifact committed so every later parser test is fed real data.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/host/jobs/fixtures/sandcastle-real-<YYYY-MM-DD>.txt` (new)
- `/home/hyhilman/projects/me/doppelganger/host/jobs/nightly-sandcastle.test.ts` (test 1 re-pointed)
- `/home/hyhilman/projects/me/doppelganger/LOOP.md` (a settled-question entry recording the run)

**Do — the human runs exactly this, in this order:**

```bash
# 0. Preconditions, each checked and recorded.
claude --version                       # a logged-in CLI on this host
git rev-parse --abbrev-ref HEAD        # must equal NIGHTLY_SANDCASTLE_BASE
git status --porcelain                 # must be empty
md5sum ~/.gitconfig                    # recorded, and re-checked at the end (ruling 5)

# 1. The free smoke test first — proves the wiring without spending anything.
NIGHTLY_SANDCASTLE_MAX=0 NIGHTLY_SANDCASTLE_BASE=dev npm run job nightly-sandcastle

# 2. The one paid pass. SAF-07: this dry run is NOT free — it runs the agent.
NIGHTLY_SANDCASTLE_DRY_RUN=1 NIGHTLY_SANDCASTLE_BASE=dev npm run job nightly-sandcastle \
  2> .doppelganger/runs/first-pass.stderr
```

**What must be observed and written into the commit body, verbatim:**

1. the `event=pass-start` line, with `goal=` and `model=`;
2. the raw `<<<SANDCASTLE … SANDCASTLE>>>` block the model emitted;
3. the parsed `outcome=`, and whether `parseVerdict` returned non-null;
4. `completionSignal` — fired or `none`;
5. the number of iterations and the wall-clock duration (this is the first real number behind
   `maxRunMin: 60`, and if it is anywhere near 60 minutes the entry is retuned in the same commit);
6. `md5sum ~/.gitconfig` before and after — **must be identical** (ruling 5, on a real run);
7. `git status --porcelain` and `git log --oneline -1` before and after — **must be identical**
   (`DRY_RUN=1`, so nothing lands);
8. the contents of `.doppelganger/gitconfig` — should carry `safe.directory` for the worktree path.

**Then:** copy the agent's raw stdout into
`host/jobs/fixtures/sandcastle-real-<date>.txt` and re-point test 1 of
`host/jobs/nightly-sandcastle.test.ts` at it. **TST-19 says fixtures are lifted from REAL data, never
invented** — this is the commit where that becomes true for this repo. Keep the template-derived
fixture as a second test (it checks the *documented* shape); the real one checks the *observed*
shape, and the difference between them is the thing worth knowing.

**If the pass fails**, the commit still lands: the failure output becomes the fixture for a
`parseVerdict → null` test, LOOP.md records what broke, and N3 is not done until a subsequent run
succeeds. **A failing first pass is a result, not a reason to skip the step.**

**Acceptance criteria:**

- [ ] AC1 — the free smoke (`MAX=0`) exits 0, emits `event=free-smoke`, and `git status --porcelain`
      is empty afterwards. Record the elapsed time.
- [ ] AC2 — the paid pass exits 0 and its stderr contains a `<<<SANDCASTLE` block. Record the block.
- [ ] AC3 — `parseVerdict` over the recorded stdout returns a non-null verdict whose `outcome` is in
      `OUTCOMES`. Demonstrated by the new fixture test: `npm test` exits 0 with
      `node --test host/jobs/nightly-sandcastle.test.ts` reporting one more passing test than before.
- [ ] AC4 — **the fixture is real.** `git show --stat` on the commit shows the fixture file added;
      its first line is not the skill's template (`grep -c 'outcome=<' <fixture>` prints `0` — a
      template carries the angle brackets, an answer does not).
- [ ] AC5 — **ruling 5 holds on a real run.** `md5sum ~/.gitconfig` is unchanged across the whole
      session, and `grep -c safe.directory .doppelganger/gitconfig` is ≥ 1.
- [ ] AC6 — **nothing landed.** `git log --oneline -1` and `git status --porcelain` are unchanged;
      `git branch --list 'nightly/*'` shows the branch (the worktree existed) and
      `git worktree list | wc -l` prints `1` (it was torn down).
- [ ] AC7 — `npm test` exits 0 and `git status --porcelain` shows only the two intended files.
- [ ] AC8 — LOOP.md gains a "settled questions" bullet naming the date, the model, the outcome, the
      duration and the iteration count. **This is the entry the GAP and VERIFY steps read to know
      the real path was exercised**; without it, layers A and B are all N3 can claim.

**Commit:** `nightly-sandcastle: the first real pass, and its stdout as the TST-19 fixture (JOB-C15, TST-19, HRN-11, SAF-07)`

**Depends on:** J3.16.

**Risks / what could be wrong:**
- **This job cannot run on CI and cannot run unattended.** It is the phase's one human dependency and
  it is named as one. If the loop is being driven by an agent, the agent must stop here and ask.
- **It costs one Opus pass at `effort: high` with up to 20 iterations.** `NIGHTLY_SANDCASTLE_MAX=0`
  first (step 1) is not optional — it catches every wiring fault for free, so the paid pass is spent
  on the question only a model can answer.
- **A first pass that reports `too-large` or `none` is a success**, not a retry trigger. The fixture
  is still real and `parseVerdict` still has to accept it.

---

## J3.18 — close N3  ·  §3, `WORK.md`, `LOOP.md`

**Goal:** tick 34 boxes, and fix the three places the bookkeeping is already wrong — before
`test/layout.test.ts` assertion 14 finds them.

**Files touched:**
- `/home/hyhilman/projects/me/doppelganger/WORK.md` (34 boxes)
- `/home/hyhilman/projects/me/doppelganger/LOOP.md` (phase table, settled questions, open items)
- `/home/hyhilman/projects/me/doppelganger/roadmap.md` (§3's N3 `**Ships:**` line)

**Do — the roadmap fix, which is not optional:**

`test/layout.test.ts` assertion 14 compares roadmap §3's `**Ships:**` list against WORK.md's ticked
IDs **for every SHIPPED phase**. Ticking N3's boxes makes N3 SHIPPED, and the two lists **disagree
today**:

| roadmap §3 N3 says | WORK.md N3 says | why |
|---|---|---|
| `HRN-10…19` | `HRN-10…16` | HRN-17 moved to N5 (`plugin-names.test` needs plugins); HRN-18 and HRN-19 shipped at **N1** and are in N1's Ships line |
| `SAF-01…08` | `SAF-01…07` | SAF-08 cut by D17 (the safe-run table is a doc) |

So the line becomes:

```
**Ships:** HRN-01…02, HRN-07, HRN-10…16, SKL-01…10, JOB-C15, SAF-01…07, INS-06,
TST-08, TST-09, TST-19, TST-23, TST-24.
```

**This is a real, currently-latent bug**: assertion 14 has never checked N3 because N3 has never been
SHIPPED, and the moment it is, the suite goes red on a documentation line. Finding it before the tick
is the whole reason this job exists as a job.

**Do — `WORK.md`:** tick all 34, each `- [x] (J3.n) **ID** …` naming the job that shipped it, the
J2.18/J1.20 format. Add the honest end-of-phase claim under the N3 heading:

> **A real entry exists, a real job file backs it, and one supervisor tick can run a real agent
> against a real skill, gate its diff on the full suite plus an import smoke plus a dry run, and land
> it with `merge --ff-only`. The loop is not yet safe to leave alone: nothing parks on a quota wall,
> a killed pass leaves a lease nobody reaps, and no watchdog says when it stops. That is N4.**

**Do — `LOOP.md`:** phase table `N3 → ✅` (or `⚠` if J3.17's first pass failed and a second has not
run). Move the resolved items out of "Open items" and add the settled questions this phase produced —
at minimum: `@ai-hero/sandcastle` is real and its measurements · `run()` writes `~/.gitconfig` and
`GIT_CONFIG_GLOBAL` is the fix · layer B (a fake `claude` on `PATH`) makes the real `run()` path
testable for free · "pinned" is a shape predicate plus an alias denylist, never an exact value · the
gate cannot express excl-plus-shared.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0. **`test/layout.test.ts` assertion 14 now checks N3 for the first
      time** — record that it passes, and record the corrected Ships line.
- [ ] AC2 — **assertion 14 really fires on N3.** Put `HRN-17` back into the roadmap's N3 Ships line.
      `npm test` exits non-zero naming the disagreement. Revert. Without this the fix is a claim.
- [ ] AC3 — **assertion 12 flips from exempt to must-exist.** With N3 SHIPPED, every §1 row tagged
      `N3` must exist on disk. Temporarily `git mv kernel/ports/runner.ts kernel/ports/runner.bak`;
      `npm test` exits non-zero with `§1 names kernel/ports/runner.ts as v0,N3, but it is absent from
      disk`. Restore. **This is the moment every §1 row J3.1 wrote is proved to have been built.**
- [ ] AC4 — `grep -c '^- \[ \]' WORK.md` in the N3 section prints `0`; `grep -c '^- \[x\]' WORK.md`
      in the N3 section prints `34`. Both counts are read from the file, not written into a test.
- [ ] AC5 — `npm run skills check` exits 0 and `npm run crontab check` (against a fake) exits 0 —
      the two operator gates N3 shipped, run at the end of the phase.
- [ ] AC6 — `git status --porcelain` shows exactly three modified files.
- [ ] AC7 — the phase is pushed: `git push origin dev` and the CI run is green. Record the run URL,
      as J0.13 AC4 now requires at the end of every phase.

**Commit:** `close N3: 34 items, and fix §3's Ships line before assertion 14 reads it (§3, WORK.md, LOOP.md)`

**Depends on:** every other job.

**Risks / what could be wrong:**
- **AC3's mutation is the only proof that §1's N3 rows were all built.** If any file J3.1 named was
  quietly dropped, this is where it surfaces — and it surfaces as a red suite on the last commit of
  the phase, which is late but is still before N4.
- **If J3.17's real pass has not happened**, the phase table gets `⚠`, not `✅`, and LOOP.md's open
  items carry the reason. N2's own `⚠` for a missing VERIFY pass is the precedent: the marker is
  honest, and a `✅` for a phase whose one manual step was skipped is exactly the claim this loop
  keeps refusing to make.

---

## Summary of the resolved tensions

| Tension | Resolution |
|---|---|
| **`ports/runner` names `@ai-hero/sandcastle` (D2) and this repo has one dependency** | **The package is real and N3 adds it, pinned exact, as this repo's second dependency.** Measured 2026-08-26: `@ai-hero/sandcastle@0.12.0`, MIT, `added 7 packages`, ~15 MB (14 MB of it source maps), one runtime dep (`@clack/prompts`), both peers `optional: true` so `npm install`/`npm ci`/`npm ls --all` all exit 0 with them UNMET. It typechecks clean under this repo's exact tsconfig (`strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`, nodenext, `@types/node` 22.20.1) — `tsc --noEmit` exit 0. Importing both entry points with stdin closed takes 97 ms and creates no files. `test/deps.test.ts` grows an **importer register** so `croner → host/cron.ts` and `@ai-hero/sandcastle → host/runner.ts` are both single-importer claims across all four import spellings, and test 4 pins each package's own declared dependency set at the version this repo's lockfile resolves — a claim that cannot rot without a lockfile commit. |
| **`@clack/prompts` is an interactive prompt library and an unattended job must never wait on stdin** | Measured: the three blocking calls (`clack.text`, `clack.isCancel`, `clack.cancel`) exist **only inside `interactive()`**, on the branch that collects a missing `{{KEY}}` for a `promptFile`. `run()` reaches none of them. The other `clack.*` uses are `ClackDisplay`, selected only by `logging: { type: "stdout" }`. N3 closes the door twice anyway: `host/runner.ts` always passes `logging: { type: "file", path }`, and it **never passes `promptArgs` or `promptFile`** — the only route to that branch. Both are asserted, the second as a text scan with its honest limit stated (the real enforcement is that `RunRequest` has no such field, so the call would not typecheck). |
| **A suite cannot make paid model calls, and a mock that never talks to a model proves nothing** | Three layers, each with its limit stated. **A** — `AgentProvider.buildPrintCommand` is a **pure function on the real provider**, so the exact command `claude` would be invoked with is assertable for free: measured, `permissionMode` unset yields `claude --print --verbose --output-format stream-json --model 'claude-opus-5' --effort high -p -` with **no permission flag at all**, and set yields `--permission-mode bypassPermissions`. Deleting the field turns it red. **B** — the whole `run()` path against a **fake `claude` on `PATH`**: measured working in **104 ms**, because `noSandbox().create()` spawns `sh -c <command>` with `{...process.env}`. Real library, real git repo, real completion-signal matching, real sentinel in `stdout`, real `GIT_CONFIG_GLOBAL` redirect — on every commit, on CI, free. Three failure modes measured too (non-zero exit → `instanceof Error` with a readable message; no signal → resolves with `completionSignal: undefined`; `logging.path` set → no terminal UI and no `.sandcastle/`). **C** — the one manual step, J3.17: `NIGHTLY_SANDCASTLE_DRY_RUN=1 npm run job nightly-sandcastle` on a logged-in host, whose real stdout becomes the TST-19 fixture. Nothing in a suite proves a real model emits a parsable block; J3.17 is the only thing that does, and N3 is not done without it. |
| **HRN-11: "a pinned version, never a floating alias" — but current Claude IDs carry no date** | Checked against the current model list: `claude-opus-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-fable-5` are **complete as written**, and appending a date is wrong rather than more pinned. So "pinned" is defined as **names a generation and cannot silently become a different one**, and enforced as two clauses: `PINNED = /^claude-[a-z][a-z0-9]*(?:-\d+)+$/` accepts any family with a numeric generation (including a family this plan has never heard of, and a dated snapshot), and an `ALIASES` denylist rejects `(^|-)latest$`, the bare CLI tier names (`opus`, `sonnet`, `haiku`, `fable`, `mythos`, `default`, `opusplan`) and bare `claude`. **No exact value is pinned** — the standing rule forbids pinning something outside this repo. The predicate is itself exercised over a twelve-entry table, six accepted and six rejected, because clauses 3 and 4 are otherwise satisfied by a regex that accepts everything. The scan is the reference's masker, ported with its `lost` self-check and the rule it implies ("never spell `runJob(` inside a string"), and its floor is **derived from the registry**, never written. |
| **SKL-04's renderer versus SUP-08's crontab precedent** | Reused where it fits, and the break is named. **Fits:** `run(argv, deps)` returning `{ out, err, code }` so every verb is assertable without capturing a stream · pure transforms separated from an argv block no test reaches · `render`/`sync`/`check` with the same operator semantics (`sync` installs, `check` diffs and exits 1) · a `*_DRY_RUN` flag · a required `deps` field for every path. **Does not fit, and SKL-10 says why:** a crontab is one file with a delimited block, so "foreign lines untouched" is a splice; `.claude/skills/` is a tree with nowhere to put a block marker, so the unit of ownership is a **directory** and the token is a marker in the rendered file's body, at a fixed position (line after the frontmatter), decided by `ownerOf`. `sync` therefore **refuses first, writes second, prunes third** — a run with any refusal writes nothing — and removes a directory only when it is `ours` **and** sits directly under `renderedRoot`. |
| **SKL-10 names five findings and one more is needed** | The five ship exactly as written — **missing, drift, orphan, collision, stray** — with the two exclusivity rules that make them a partition (`drift` requires `ours`, so a `collision` never also reports `drift`). A sixth, **`source-missing`**, is added: SKL-06's first half is about the *source*, and none of the five covers a registered job whose `plugins/<x>/skills/<name>/SKILL.md` is gone — without it `check` reports `missing` and `sync` then throws a raw `ENOENT` reading a file that is not there. Flagged in Gaps as an addition to be confirmed. |
| **The skill's vocabulary lives in markdown and `parseVerdict` lives in code** | Gated as a **two-file drift check**, and neither file is written by the commit that asserts it: `outcome=<changed\|none\|too-large\|suite-failed>` is parsed out of the source `SKILL.md` (which pre-dates N0's first code commit) and `deepEqual`-ed to `OUTCOMES` exported from `host/jobs/nightly-sandcastle.ts` (which lands in J3.10). Mutating either side goes red. SKL-07's authorization-token ban is **narrowed** from N0's whole-file `!includes("agent")` to the `<<<SANDCASTLE … SANDCASTLE>>>` block, because a grant has to appear in what the skill EMITS to widen anything, and the old scan banned an ordinary English word from prose. Two AC mutations prove the narrowing: a token inside the block goes red, the sentence "The agent decides what the change is" in prose stays green. |
| **HRN-07 has no runtime moment to observe, since no real agent runs in the suite** | It has a *pure* one. `buildPrintCommand` is a function on the provider object, so the flag is observable without a spawn. The test builds the provider through `host/runner.ts`'s own exported `buildAgent` — never a re-built copy, which would test the test (N2 F3) — and asserts **our `permissionMode` value appears in the command**, never sandcastle's flag spelling, which is a value outside this repo. A negative control (a provider built with no `permissionMode`) produces a command carrying no mode, which is what makes the positive assertion mean something. Deleting `permissionMode:` from `buildAgent` is the RED mutation. |
| **HRN-12: who creates and destroys the worktree, and what a killed pass leaves behind** | **This repo creates it** — `git worktree add -B nightly/<INSTANCE> <path> <base>` through `kernel/runtime/exec.ts` — and sandcastle is pointed at it as `cwd` with `branchStrategy: { type: "head" }`. None of sandcastle's three strategies fits: `merge-to-head` merges **before** our gate runs, `head`-on-the-checkout writes the live tree, and `branch` leaves the worktree path out of `RunResult`. The chosen combination was measured to create no `.sandcastle/` directory and to merge nothing. **The crash case has three answers, in order:** `prepWorktree` is idempotent and hard-resets an existing tree onto the base (so the *next* pass reclaims it and the common case costs nothing) · `reapWorktrees(repo, under, keep)` removes registered worktrees under a project-relative root that are not the live one, and returns what it removed · `git worktree prune` runs first, clearing a deleted-directory-still-registered entry. Nothing runs on a timer and nothing removes a tree outside `under` — asserted by its own test, because a reaper that removes a worktree it did not create is worse than one that removes nothing. `{{WORKTREE}}` is substituted by `runJob`, in our code, never by sandcastle's `promptArgs`. |
| **`run()` writes `~/.gitconfig`, and nothing in the roadmap says a dependency might** | **Measured, not read.** `run()` unconditionally executes `git config --global --add safe.directory "<repo>"` plus `user.name`/`user.email` inside the sandbox, which under `noSandbox` is the host: `md5sum ~/.gitconfig` changed after one probe run, and five runs appended five duplicate `safe.directory` lines. (The developer's real file already carries five duplicate xenith entries — the reference has been leaking this for months.) Three problems at once: **INS-02 has no third category** for a machine-global write · it is **HRN-18's `~/.gitconfig` race with its caller finally named**, which retro-justifies `*_SPAWN_STAGGER_MS` · and it grows without bound. **Fixed by one env var**, measured working: `noSandbox({ env: { GIT_CONFIG_GLOBAL: projectPath(".doppelganger/gitconfig") } })` leaves `~/.gitconfig` byte-identical and puts the three entries in a project-relative file. It goes on the **sandbox** provider only — setting it on both throws `Overlapping env keys between agent provider and sandbox provider`, which is itself a test. The RED mutation runs in a child process with `HOME` set to a `mkdtempSync` directory, so it cannot reach the developer's real file — the J2.16 layer-0 lesson applied to a new destructive surface. |
| **SAF-07's "one non-free dry run" has to be identified for this job** | It is **`NIGHTLY_SANDCASTLE_DRY_RUN=1`**. It is fully inert against the repository — no commit, no `merge --ff-only`, no rotation-state write — and it **runs the agent**, so it spends one Opus pass. `NIGHTLY_SANDCASTLE_MAX=0` is the free one (rotation, worktree prep, gate wiring and report render, zero agent runs). Both facts live in the two knobs' `EnvSpec.why` lines, which KRN-06 makes the knob doc, and a test asserts the dry-run row's `why` contains `costs` and the max row's contains `free` — SAF-07's "must be documented as such" as a failing assertion rather than a promise. |
| **`nightly-sandcastle` modifies this repo and the suite must never commit to `dev`** | Seven independent layers, each with a test: **ruling 2's required `deps`** (TypeScript refuses a call that omits `root`, `runner`, `git`, `now`, `db`, so a test cannot forget to redirect) · `NIGHTLY_NO_SANDCASTLE=1`, the KRN-07 kill switch, returning before anything is read · `NIGHTLY_SANDCASTLE_MAX=0`, the free smoke · `*_DRY_RUN=1` · `*_NO_MERGE=1`, the SAF-02 shadow mode that commits in the worktree and never moves the base · a **`not-on-base` refusal** comparing HEAD to `NIGHTLY_SANDCASTLE_BASE` (a knob, not a literal — the N2 F1 lesson, and AC3 mutates it to a hardcoded `main` to prove the guard checks the property it claims) · and a **`tree-dirty` refusal**. Every test that reaches `exec()` points `deps.root` at a `mkdtempSync` git repo, and each job's ACs re-check `git status --porcelain`, `git log --oneline -1`, `git branch --list 'nightly/*'` and `git worktree list \| wc -l` against the real checkout. |
| **The first `SCHEDULE` entry exercises 23 rules that have only ever seen fixtures** | Enumerated rather than hoped: rule 2 (prefix), 3/4 (the first non-`*` field the real schedule has carried), 5/6 (`log` and `LOG_ROOTS` must derive from the same `ROOT`), **10 — the sharpest, because `cli/crontab.ts`'s `render()` calls `validate()`, so `npm run crontab render\|sync\|check` now stats a real `host/jobs/` path**, 14 (the first `PROGRAMS` row ever found), 15 (the first live coupling between `host/config.ts` and `host/schedule.ts`). Three other things move the same day and each gets an assertion: the parity corpus grows by one expression (N2 wired it as `[...FORMS, ...SCHEDULE.map(e => e.cron)]` precisely so no one has to remember), `supervisor --list`'s footer goes `0 supervised` → `1 supervised`, and `crontab check`'s tally goes `(0 more …)` → `(1 more …)`. **`log: projectPath(...)` at module scope in `host/schedule.ts` does not trip door 6** — measured: the door matches column-0 lines and same-line declarations, and an array literal's indented member is neither, a limit the door's own comment already declares. No exception is added and no gate is widened; the reasoning is recorded and flagged. |
| **SUP-12's live allowlist assertion was deferred to N3 and is still vacuous** | `REFRESH_WINDOW` is `null` and **N3 does not invent one** — a window declared for a single job is inventing the subject, which is the discipline N2 used to delete three vacuous assertions. So no `entriesInWindow(SCHEDULE, REFRESH_WINDOW, PROGRAMS) === []` test is shipped. What **is** shipped is real: the same call over the **real** `SCHEDULE` and **real** `PROGRAMS` with a **fixture** window returns exactly `[{ name: "nightly-sandcastle", gate: "excl" }]`, and two mutations (move the cron out of the window; change the program's gate) turn it red. `host/window.ts`'s "REMINDER FOR N3" header is rewritten to say the entry landed, the window did not, and which phase gets one. |
| **`gate: "excl"` on `repo` plus a read of `skills`, and the gate has no mixed hold** | The entry takes `excl` on **both** `["repo", "skills"]`. It moves `repo` (worktree, branch, `merge --ff-only`) and it **reads `skills` for the whole pass** — the agent loads the rendered skill tree mid-run, so anything rewriting that tree changes the prompt under a running agent, which is the reference's `plugin` resource with the names changed. GAT-01…09 describe `shared`-on-all and `excl`-on-some and say nothing about holding one mode on one resource and another on a second, so the entry over-excludes rather than inventing a mode. That costs nothing while one entry exists, and it is the first real hole the first real entry found. |
| **INV-1 forbids a local state file and the reference keeps rotation in JSON** | Rotation lives in `nightly.db`, namespace `nightly` (DBS-01/02/03), with an append-only migration. That satisfies INV-1 (which is carried over verbatim and is exactly what a JSON file next to the code violates), inherits `SAF-05`'s `NIGHTLY_DB` redirect for free, and inherits TST-20's shared-database discipline for free. A deviation from the reference, and an improvement rather than a liberty. |
| **`npm test` inside a worktree has no `node_modules`, and `pretest` is `tsc`** | `git worktree add` copies nothing, and this repo's `pretest` needs `typescript` and `@types/node`. The pass symlinks `<root>/node_modules` into the worktree — a project-relative write, registered — because a per-run `npm ci` is minutes of the pass budget and a second copy of 15 MB of source maps. The discard path uses `git clean -fd -e node_modules` so the symlink survives, and a test asserts it does. Named as the single most likely reason tier 2 fails for a reason unrelated to the diff. |
| **`taskClass` and `local` have no consumer until M9, and a field with no consumer gets designed wrong (D9)** | Both are given a **real N3 consumer** rather than shipped inert. `taskClass` selects `runTimeoutMs(job)`, which becomes the run's `AbortSignal` deadline — an impl-shaped job gets a longer one, asserted as a pure comparison. `local` becomes a **required declaration for a write-capable run**: `runJob` throws when the resolved `permissionMode` is `bypassPermissions` and `local !== true`, because `bypassPermissions` means "this run may write anything on this host" and `local: true` is the call site saying "and it must not leave this host". At M9 the same field selects the dispatch branch and no job file changes — which is the acceptance criterion the roadmap already states for the runner seam. Both are additions to their rows and both are flagged. |
| **The escape check detects but does not contain** | An agent under `bypassPermissions` on a bare host can write anywhere; nothing in N3 stops it. What N3 does is capture `git status --porcelain` on the main checkout before the run and compare after, logging `level=error event=write-scope-escaped` with the paths. It deliberately does **not** revert or stash: the reference learned that reverting a shared checkout destroys a human's concurrent work, and its answer (`escape-stash.ts`) has no roadmap row. Stated as **detection without containment** in the code, in the test title, and in Gaps — rather than left for a reader to discover from the absence of a revert. |

---

## Gaps I found in the roadmap

1. **Nothing in the roadmap anticipates that the runner dependency writes `~/.gitconfig`.**
   Measured: `run()` executes `git config --global --add safe.directory` plus `user.name`/`user.email`
   on the host under `noSandbox`, growing the file by one line per distinct repo path per run,
   forever. INS-02 says every write is project-relative or `INSTANCE`-discriminated and there is no
   third category — this is a third category, performed by a dependency. N3 fixes it with
   `GIT_CONFIG_GLOBAL` and signs the writes register, but **INS-02 should say what happens when a
   dependency writes outside both categories**: is redirecting it mandatory, or is a registered
   exception allowed? Related: HRN-18 describes the `~/.gitconfig` race and never says what causes
   it; this is the cause, and the row should name it now that it is known.

2. **`SAF-02`'s named shadow modes have no member that fits a job whose write is a local merge.**
   The row names `*_NO_COMMENT`, `*_NO_LABEL`, `*_NO_CLOSE`, `*_NO_PUSH` — all tracker- or
   remote-shaped. `nightly-sandcastle` never pushes; its write is `git merge --ff-only` into a local
   branch. N3 ships `NIGHTLY_SANDCASTLE_NO_MERGE` in the same spirit. Either add `*_NO_MERGE` to the
   row, or state that the four names are examples of a shape rather than the shape itself.

3. **`SKL-10`'s five findings do not cover a missing SOURCE.** SKL-06's first half is about the
   source directory, and a registered job whose `plugins/<x>/skills/<name>/SKILL.md` is gone produces
   `missing` (no rendered file) and then a raw `ENOENT` from `sync`. N3 adds a sixth finding,
   `source-missing`. Confirm it, or say SKL-06's gate owns that case and `sync` must pre-check.

4. **`SKL-04` says `.claude/skills/` is rendered "from the manifests", and there is no manifest until
   N5.** N3 renders from a hand-registered `host/jobs/index.ts` list, with `Job.plugin` naming the
   owning plugin so the source path (and the marker's `src=`) is derivable. That is the KRN-04 `jobs`
   member one phase early, the same way `EnvSpec` was KRN-04's `env` member one phase early (J1.2).
   Worth a sentence in SKL-04 so N5 reads it as a re-homing rather than a rewrite.

5. **`SKL-07`'s boundary needs a third clause: a skill may DESCRIBE a rule code enforces.** The
   landed `SKILL.md` says "**Off limits:** the schedule file, the supervisor, `package.json`, and
   this skill's own files" — which is a guard matrix in markdown by a literal reading of SKL-07, and
   is correct behaviour by every practical reading (the reference does exactly this, and enforces it
   in `BLOCKED`). N3 makes it checkable: a test parses the "Off limits" bullet and asserts
   `blockedBy` returns a reason for each named thing, so the prose is a claim code must cover rather
   than a duplicate that can drift. The row should say so, because "never put a guard matrix in a
   skill" and "the prompt should tell the agent what it may not touch" are both true and currently
   read as contradictory.

6. **The gate cannot express "excl on A, shared on B", and the first real entry needs exactly that.**
   `nightly-sandcastle` moves `repo` and reads `skills` for the pass's whole duration. GAT-01…09
   describe reader-takes-all-shared and writer-takes-some-excl and nothing in between, so the entry
   over-excludes. With one entry that is free; with JOB-C16's two concurrent nightlies (N5) it means
   two jobs designed to run concurrently cannot, because both read `skills`. Either a mixed hold, or
   a row saying a read-only resource is not a gate resource at all.

7. **`TST-08` says "every agent run names its model" and HRN-11 says "a pinned version, never a
   floating alias", and neither says what pinned MEANS.** Current Anthropic IDs carry no date suffix
   and are complete as written, so "has a date" is the wrong predicate. N3 defines it as a shape
   regex plus an alias denylist and pins no exact value. The row should either carry the predicate or
   say the enforcement is a local decision — because two builders will invent two, and one of them
   will invent "must match `claude-opus-5`", which rots on the next release.

8. **`SAF-01` is defined per JOB and two operator CLIs now need one.** N2 flagged `CRONTAB_DRY_RUN`
   as having no `SAF-` row (N2 Gaps item 9); N3 adds `SKILLS_DRY_RUN` with the same problem. Two is a
   pattern. §2.28 should carry a row for an operator CLI's own dry run, or SAF-01 should say "per job
   **or tool**".

9. **`HRN-13` and `HRN-14` have no consumer at N3 and D9 says a port with no consumer gets designed
   wrong.** N3 gives each a real one — `taskClass` selects the run's abort deadline, and `local`
   becomes a required declaration for a `bypassPermissions` run — rather than shipping two inert
   fields. Both are additions to their rows. Confirm them, or accept two fields that nothing reads
   until M9 and say so in the rows, so a reviewer does not report them as unimplemented.

10. **Nothing says who prunes `.doppelganger/runs/`.** The runner's own log is human prose, not
    logfmt, so it must not sit under `LOG_ROOTS` (LOG-08's copy-then-truncate rotation would truncate
    a file sandcastle holds open in append mode). N3 writes one file per run under
    `.doppelganger/runs/`. `ops-retention` (JOB-O06) is N5. Until then the directory grows one small
    file per tick — six a night. A `LOG-` or `SAF-` row should name the second log root's sibling, or
    JOB-O06 should move earlier.

11. **`INV-1` and `JOB-C15` disagree about the rotation state.** INV-1 says the declared state store
    is the state store and there is no local state file; JOB-C15 says "goal rotation state" without
    saying where. The reference uses a JSON file, which INV-1 bans. N3 puts it in SQLite. Confirm, or
    state that a job's own rotation state is exempt from INV-1 — but then say which other state is.

12. **Detection without containment has no row.** An agent under `bypassPermissions` on a host with
    no isolation can write anywhere; N3 detects and reports it (`write-scope-escaped`) and does not
    revert, because reverting a shared checkout destroys concurrent human work. The reference's
    answer is `escape-stash.ts`, which appears in no `HRN-`, `SAF-` or `JOB-C` row. Either add one,
    or state that reporting is the whole contract at v0 — because the difference matters and today it
    is decided by whoever writes the job.

13. **`test/writes.test.ts` door 6 cannot see a call inside a multi-line top-level declaration, and
    the first real schedule entry lands one.** `log: projectPath(...)` inside `SCHEDULE`'s array
    literal is invisible to the door, which the door's own comment already declares as an accepted
    limit. N3 neither widens the door nor adds an exception — `projectPath` performs no I/O,
    `ENGINE_ROOT` redirects it, and SUP-01 requires the schedule to be a value. But a `TST-` row
    saying which of the six members are I/O and which are pure path builders would let the door
    narrow honestly instead of relying on a formatting accident.

14. **`kernel/runtime/exec.ts` names `git` and the writes register explicitly exempts it, and N3 adds
    a real git write path.** `EXTERNAL_COMMANDS` is `["crontab","systemctl","docker","at"]` with a
    comment saying `gh`/`git` are "read-mostly wrappers whose write paths are JOB-G's (N5) to
    register". N3's worktree, commit and `merge --ff-only` are git write paths that arrive at N3, not
    N5. Either add `git` to `EXTERNAL_COMMANDS` (and register `kernel/runtime/worktree.ts` and
    `host/jobs/nightly-sandcastle.ts`), or restate the exemption to say why a job's git writes are
    covered by door 3's `REGISTER` instead.

15. **`roadmap.md` §3's N3 `**Ships:**` line is wrong in two places and `test/layout.test.ts`
    assertion 14 will find it the moment N3 is ticked.** It says `HRN-10…19` (HRN-17 moved to N5;
    HRN-18/19 shipped at N1 and are in N1's line) and `SAF-01…08` (SAF-08 cut by D17). J3.18 fixes it
    to `HRN-10…16` and `SAF-01…07`. Flagged because it is a spec line, not a plan detail, and because
    the same class of error may sit in N4's and N5's lines where nothing has checked them yet.

16. **Nothing in the roadmap says the supervisor is not started by anything.** N3 ships one entry the
    supervisor schedules, and `crontab render` still emits a managed block with zero command lines —
    because only `supervised: false` entries render, and the only one the roadmap names is the
    watchdog (JOB-O10, N4). So after N3 the loop runs **only while someone runs `host/supervisor.ts`
    by hand**. That is correct and it is nowhere written down. SUP-09 or §3's N3 line should say the
    bootstrap entry arrives at N4.

17. **`SAF-03` (`*_MAX=1`) and `SAF-04` (`*_MAX=0`) are one knob with two rows, and `*_LIMIT` is a
    third spelling.** N3 ships one `NIGHTLY_SANDCASTLE_MAX` whose `0` is the free smoke and whose `1`
    is one real unit. The rows read as three knobs. Collapse them, or say `*_MAX` and `*_LIMIT` are
    the same knob under two names for historical reasons.

18. **`HRN-03`'s "three runners, ONE `RunResult` contract" is deferred to M9/M11, but the contract is
    designed now, by N3, against one implementation.** §3 defers HRN-03…06; PRT-08 (`Runner` port) is
    N5. So the shape every future runner must satisfy is fixed at N3 by the phase that has exactly
    one, which is the failure D9 warns about. N3 mitigates by keeping `RunResult` to six fields that
    any runner can supply and refusing sandcastle's `resume`/`fork`/`preservedWorktreePath`. Worth a
    sentence in PRT-08 saying the shape lands early and the port is a re-homing.


