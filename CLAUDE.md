# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**N0 and N1 are done.** `kernel/` holds the framework primitives N1 shipped, each with its own test
file: `config.ts` (`EnvSpec` and the env readers), `instance.ts`, `paths.ts`, `stages.ts`, `time.ts`,
and `runtime/` — `db.ts`, `exec.ts`, `pool.ts`, and `runtime/log/` (`emit.ts`, `parse.ts`, `route.ts`,
`cause.ts`, `tail.ts`, `log.sh`). `plugins/nightly/skills/nightly-sandcastle/SKILL.md` and its
rendered `.claude/skills/` entry are still the only skill on disk — the worked example of SKL-03/04,
landed before the code that runs it. `roadmap.md` is still the complete feature inventory and build
order for extracting the `xenith/engine` unattended-agent engine into a reusable framework, and
remains the spec of record as more of it ships (N2 onward).

The reference corpus is `/home/hyhilman/projects/xenith/` (`engine/**`,
`compose-data/docker-compose.yml`) — the acceptance criterion for behaviour, not something to copy
verbatim. **It IS present on this machine** (verified 2026-08-25: about 250 TS files / about
57,000 lines outside `node_modules` — approximate; xenith is a live repo other people commit to,
see roadmap.md D15). Read it
rather than guessing at reference behaviour. Earlier revisions of this file gave the macOS path
`/Users/hyhilman/Projects/xenith/` and said it was absent; both were wrong.

`roadmap.md` remains the single spec of record. Its §3 build order is **N0–N5** — the self-running
loop first, the plugin seam second (D16); §3.2 maps the old `M0`–`M4` numbers that older commits cite.

`roadmap.md` is the spec of record. Every feature carries an ID (`KRN-01`, `PIP-04`, `LSE-07`, …).
**Cite the ID** in commit messages, test names, and comments — that is how a line of code is traced
back to the behaviour it is reproducing. Keeping `roadmap.md` current is part of M0 and stays part of
every milestone.

## Commands

None exist yet. M0 fixes what they must be — do not introduce anything outside this shape:

- `npm test` — the whole suite, **including `boot()`** (KRN-11): a validation that only runs in the
  supervisor has moved the failure from compile time to 3am.
- `npm run typecheck` wired as `pretest` (TST-21), `tsconfig` `noEmit`. Tests remain the type check
  for what typecheck cannot express.
- **No linter, no bundler** (TST-22). No build step **in a host repo**, and none in `pretest` here
  either: measured on Node `22.23.1` (`2026-08-25`, §5 Q5), a workspace link is a symlink and Node
  strips types through it, so `pretest` is `npm run typecheck` alone (ADO-14, corrects the old
  ADO-16 premise). This repo is still an npm workspace monorepo publishing `@doppelganger/kernel` +
  one package per plugin, and the publish build (ADO-15, `tsc -p tsconfig.build.json` → `dist/`)
  stays — a real install copies the package under `node_modules`, where type stripping does not
  apply. If this repo ever consumes a workspace by copy instead of by link, `pretest` gains
  `&& npm run build` that day.
- Workspaces are `["kernel", "plugins/*", "cli"]` — globs over the existing layout; nothing lives in
  a `packages/` directory, and `host/` is deliberately not a workspace.
- `node:sqlite` (DBS-01) pins a Node version that ships it; prefer the built-in test runner
  (`node --test <path>`) over adding a dependency.
- CI runs `npm test`, nothing else.

Operator CLIs that the roadmap requires and that arrive with their milestone: `supervisor --list`
(SUP-17), `skills render|sync|check` (SKL-04), `lease-clear` (LSE-10), the crontab bootstrap block
`render|sync|check|sync --adopt` (SUP-08). Deferred to v1: `dlq list|show|revive` (DLQ-14), `fleet`.

## Architecture

### The layering law (D1)

```
kernel/   the framework — imports no plugin, EVER
  registry.ts plugin.ts boot.ts
  ports/     job schedule runner          (v0)  · source route relay lane (v1)
  runtime/   gate lease log db pool       (v0)  · queue quota shed (v1)
  contracts/ drift-gate suite a host repo calls as one function
plugins/  git ops nightly                 (v0 builtins — each owns skills/<job>/SKILL.md)
          jira slack github notion tracker pr-review corpus (v1)
host/     supervisor.ts config.ts schedule.ts jobs/   — the app
.claude/skills/<job>/                      RENDERED from the manifests — never hand-edited
fleet/    Dockerfile compose.yml fleet.sh            — workers (v1)
```

A plugin never imports past `kernel/ports/`, and never another plugin's internals. This is enforced
as a test (`assertNoDeepImports`, TST-03), not a convention.

### Extension model (D7, D8)

The unit of extension is a **unit of work**, not a conversation loop. There are no conversation
hooks, no sandboxing, no marketplace, no dynamic discovery. A `Plugin` manifest (KRN-04) declares
everything one integration contributes, and registries are hand-registered with duplicate-throws
**at import time** (KRN-01). Nothing at runtime may distinguish "member missing" from "member
broken" (KRN-02).

**v0 ships five manifest members** — `name`, `kill`, `jobs`, `schedule`, `env`. `sources`, `routes`,
`relays` and `lanes` are NOT designed until a plugin needs one (D9): a port with no consumer gets
designed wrong. This is also why KRN-10 is not a live question — no v0 builtin emits a route, so
there is no `Route` union to open.

`boot(plugins)` (KRN-08/09) walks the whole graph, collects **all** problems, then throws once with
each line attributed to a plugin. It is the replacement for the closed-union exhaustiveness that
KRN-10 gives up.

### Skills are the prompt mechanism (SKL, D10)

A job has no `prompt` and no `promptFile`. It names a **skill** or it is deterministic (`exec`), and
there is no third shape. The skill name IS the job name, so the schedule entry, the unattended run
and a human's `/<name>` are one identifier — and skills inherit SUP-20's stage prefixes for free.

- One skill per **job**, never per plugin (SKL-02). `corpus` contributes `corpus-refresh`,
  `corpus-checklist`, `corpus-lint` — not one `/corpus` with a mode argument.
- The plugin owns the file: `plugins/<x>/skills/<job>/SKILL.md`. `.claude/skills/` is **rendered**
  from the manifests under managed markers, on the crontab precedent (SUP-08) — never hand-edited,
  and `skills check` fails the build on drift rather than re-rendering. `skills sync` **prunes** entries it owns and
  never touches a foreign one (SKL-10) — which requires ownership be decidable from the filesystem,
  the heavier half of §5 Q0.
- Code declares, the filesystem is only ever **checked** (SKL-05). That is how KRN-02 survives a
  tool whose native discovery is a directory scan.
- **Never put a guard matrix, an eligibility rule, a verdict token, or any authorization decision in
  a skill** (SKL-07). JOB-T03 is the precedent: `agent` is reachable only from a literal token,
  *enforced in `parseVerdict`, not asked for in the prompt*. A skill is markdown a human edits.
- A skill's only inputs are `promptArgs`; it never reads env and never names a path into its own
  directory (SKL-08, HRN-16).

### The pipeline (PIP — v1)

`source → switch → backlog → watchers`, one job and one failure mode per stage, and the stage
contracts are the point (PIP-02): an entry point **transcribes** and never classifies · the switch
assigns a route and never handles · the backlog is source-agnostic and never knows what a channel is
· a watcher claims by route, handles, settles, and never re-classifies (one exception: `reroute`,
PIP-19).

Six states (PIP-03), and `handled` means **left the backlog**, not that work happened — `handled_ref`
carries the difference. A route is a **label** that selects a handler; it never authorises a write,
and every watcher re-verifies its own preconditions (CLS-05).

Work is counted per **step** with a cap per step kind (DLQ-02); an uncapped step is an unbounded loop
that fails silently. The DLQ is a **report, not a bin** (DLQ-10) and nothing revives on a schedule.

### Runtime primitives

- **Gate** (GAT) — in-memory reader/writer gate over named resources, possible only because one
  supervisor process owns every tick. Readers take `shared` on all resources; a writer takes `excl`
  on only what it moves. Fixed global acquisition order is the deadlock argument.
- **Leases** (LSE) — SQLite mutex on `scope`+`key` with TTL and attempts. `done` is terminal. Every
  reaper guard fails toward **not** reaping; liveness reads fail toward **alive**.
- **Queue/broker** (QUE) — one SQLite table the scheduler fills and workers drain, single-writer by
  construction (only the broker opens the DB). Workers run ONE generic `claude-task` handler with
  zero job knowledge, so new jobs distribute for free (QUE-12).
- **DB** (DBS) — one SQLite file per integration, namespaced tables, append-only migrations, `tx`
  BEGIN IMMEDIATE. On `SQLITE_BUSY`: rethrow with file + SQL + waited-ms; do **not** retry and do
  **not** raise the timeout — the wait is the discriminator.
- **Log** (LOG) — one logfmt line shape, two byte-identical emitters (TS + bash), to STDERR so stdout
  stays free for the payload. Severity is SET by the emitter, never inferred from text; routing is a
  property of the level, not of the caller.
- **Instance** (INS) — two checkouts on one host are independent, never coordinated (D12). Every
  write is project-relative or `INSTANCE`-discriminated, no third category; the crontab is the one
  surface they cannot avoid sharing, so its markers carry the name. The gate is per-process and
  excludes nothing across instances — a resource shared across them is a lease, not a gate (INS-05).
- **Supervisor** (SUP) — the schedule is DATA read live, `validate()` runs on every boot and render,
  one croner timer per entry: take gate → spawn child → append to the entry's `log:` → release.

### Agent harness (HRN)

Three runners behind ONE `RunResult` contract — `runSession` → `dispatchToPool` → `runLocal` — and no
caller learns which ran. `ports/runner` is the seam: `@ai-hero/sandcastle` now (D2), an own library at
M11 (D3), with "every job file unchanged" as the acceptance criterion.

Non-negotiables: every agent run **names its model** (pinned version, never a floating alias; a test
fails the build otherwise, HRN-11) · `permissionMode` is load-bearing on a host runner, since an
unattended job hangs forever on the first tool prompt without it · **workers never write, except
where the work IS the write** (four named exceptions, each with a kill switch and a ration; the
tracker write never crosses, HRN-08) · a worker may **ASK** the broker for a Slack/Jira write, never
perform one (HRN-09/QUE-10).

### Tracker & claims (TRK)

The tracker is the state store — no local state file. A label is one watcher's **claim** that it
still owes work, with exactly one owner; closing is therefore not a decision, zero claims means
finished. Every label has exactly one definition in one file, read by both runtimes at import.

## Working rules

- **Invariants (INV-1…12) and the pipeline's eight are carried over verbatim.** They are not
  refactorable. Read §2.29 before changing behaviour in any of those areas.
- **Drift gates over prose (TST).** The convention is: *a claim derivable from the source is checked
  against the source.* Entry counts, knob paragraphs, the module map, the `validate()` check list,
  ~250 backticked env knobs, plugin doc lists — all asserted. If you write a count in a doc, wire the
  test that pins it.
- **Every knob is an `EnvSpec` row on the owning plugin** (KRN-06); its one-line `why` IS the knob
  doc. Kill switches are `*_NO_<FEATURE>=1` and degrade toward the safest verdict.
- **Safe-run surface (SAF).** Every write path is env-gated so any job can be exercised without
  touching the outside world: `*_DRY_RUN` (fully inert — no writes, no step attempts, no watermark
  movement), shadow modes (`*_NO_COMMENT`/`_NO_LABEL`/`_NO_CLOSE`/`_NO_PUSH`), `*_MAX=1` for one real
  unit, `*_MAX=0` for a free smoke test, `<NAME>_DB=/tmp/x.db` for a throwaway store. New jobs ship
  this surface with them.
- **Stage prefixes** (SUP-20, TST-09): every job name, schedule entry **and skill directory** starts
  with a known prefix — `source-`, `triage-`, `backlog-`, `watch-`, `todo-`, `corpus-`, `nightly-`,
  `retro-`, `ops-`. One name, three consumers.
- **Both halves of the skill gate** (SKL-06, TST-24): every `job.skill` resolves to a real directory,
  and every skill directory is named by a registered job. An orphan skill is a prompt nothing runs.
- Test fixtures are lifted from **real** data, never invented (TST-19).
- **Tests share a filesystem, so a database path that is not unique leaks between test FILES.**
  Settle what you seed. Two traps: `openDb` caches by path, so a reused path inside one file hands
  two tests one connection and one already-migrated schema; and `node --test` gives each file its
  own process, so a reused path ACROSS files leaks rows with no cache to make it obvious — and a
  held `BEGIN IMMEDIATE` turns it into a `SQLITE_BUSY` that reads as a product fault. Every test
  database lives under `mkdtempSync(tmpdir())`, one directory per file, one file per test.

## Build order

**v0 is N0–N5** (§3 of `roadmap.md`): N0 skeleton → N1 kernel the loop needs → N2 supervisor +
gate → N3 harness + skills + `nightly-sandcastle` → N4 quota/shed/lease/watchdog (**the loop is live
and unattended here, ~4.5–6 weeks**) → N5 manifest/boot/ports/contracts + the `git` and `ops`
builtins. Each is green on its own and none needs the next.

v0 is honestly **an unattended job runner with a plugin-shaped seam**, not a framework — that claim
is unproven until a plugin contributes a source and a route. Do not describe it as the second thing.

M5–M11 (pipeline, tracker, sources, job families, Docker fleet, quota/retro, own runner) are §3.1,
unchanged and with every ID kept. Two rows carry the highest risk of being designed wrong before a
second plugin arrives to argue with them: SKL-02 and SKL-07. §5's open questions (skills render vs
symlink, gate resource naming, tracker-as-port, DinD vs mounted socket, session-runner fate) should
be checked before designing around any of them.
