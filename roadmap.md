# doppelganger — roadmap

Extraction of the `xenith/engine` unattended-agent engine into a structured, reusable framework.

**Reference corpus** (`/home/hyhilman/projects/xenith/` — present on this machine, verified 2026-08-25):
`engine/CLAUDE.md` · `engine/README.md` · `engine/jobs.md` · `engine/pipeline.md` ·
`engine/distribution.md` · `engine/herdr-migration.md` · `engine/mcp-bridge-migration.md` ·
`engine/cron/schedule.ts` · `engine/labels.sh` · `engine/fleet.sh` · `engine/watchdog.sh` ·
`engine/src/**` (about 240 files, about 134 non-test — approximate, measured 2026-08-25) ·
`compose-data/docker-compose.yml` · the framework-extraction draft.

`engine/**` is about 250 TS files / about 57,000 lines outside `node_modules` (measured 2026-08-25
— approximate; xenith is a live repo other people commit to, see D15).

This file is the **complete feature inventory** plus the order to build it in. Every feature in the
reference is listed with an ID. Nothing was dropped; where a feature is deliberately re-shaped
(LXC→Docker, sandcastle→own runner) the row says so and keeps the original behaviour as the
acceptance criterion.

---

## 0. Decisions carried in

| # | Decision | Consequence |
|---|---|---|
| D1 | Framework, not an app | `kernel/` never imports a plugin; a plugin never imports past `kernel/ports/` |
| D2 | Agent runtime = `@ai-hero/sandcastle` **now** | one seam (`ports/runner`), swapped later — see M11 |
| D3 | Own runner library **later** | `RunResult` is the contract; no caller learns which runner ran |
| D4 | Workers = **Docker**, not LXC | `fleet.sh` → compose + a `fleet` CLI; every LXD concept has a row below |
| D5 | Headless DB/MCP stack reused | `headless-mcp` + `headless-db-mcp` from `compose-data/docker-compose.yml` |
| D6 | State store = SQLite (`node:sqlite`) | one file per integration, opened only by the scheduler/broker |
| D7 | Not an agent-runtime plugin system | extension points are a unit of WORK, not a conversation loop |
| D8 | No dynamic plugin discovery | hand-registered, duplicate-throws at import (see KRN-01) |
| D9 | **v0 ships three builtins**: `git` · `ops` · `nightly` | pipeline, tracker, sources, fleet and quota defer to v1 with every ID kept — §3.1 |
| D10 | A job's prompt **IS a skill**, named in code | `prompt`/`promptFile` are gone; a job names a `skill` or it is deterministic (`exec`) — SKL |
| D11 | `.claude/skills/` is **rendered**, never hand-edited | the plugin owns the file; the scanned directory is a derived artifact under managed markers (SKL-04) |
| D12 | Two checkouts on one host are **independent, never coordinated** | one `INSTANCE` name discriminates every host-global write; a resource shared ACROSS instances is a lease, not a gate — INS |
| D13 | **One repository, many published packages, ONE version** | a host is a separate repo that DEPENDS on the engine; four deployments update with one bump (ADO-01/02) |
| D14 | The package's `exports` map IS the layering law | `ports` · `db` · `log` public; `gate` · `queue` · `shed` · `registry` internal (ADO-03) |
| D15 | The reference corpus **is on this machine** | `/home/hyhilman/projects/xenith/` — v0 is an extraction with the original open, not a re-derivation from prose |
| D16 | **Build the self-running loop first, the plugin seam second** | §3 is N0–N5; M0–M4 map at §3.2. The seam is designed better once a second consumer exists (D9) |
| D17 | **Prose docs are cut, and the drift gates on prose go with them** | README/jobs/pipeline docs, 16 `*docs*.test.ts` files, long `why:` paragraphs. The **one-line** `why` on each entry and each `EnvSpec` stays — it is a decision record, not documentation. Cost at §4.3 |
| D18 | The loop **maintains**; it does not build | 44 unattended commits in 3 days, one of them an `Added` (§4.1). A human builds every milestone |
| D19 | The suite is **not** optional | SKILL.md step 4 reverts a pass on a failing suite; a thin suite makes that gate vacuous and the loop ships noise to `master` by `merge --ff-only` |

**Not adopted from Hermes Agent / OpenClaw:** conversation hooks (`before_tool_call`,
`message_received`, `before_compaction`), plugin sandboxing, marketplace/dynamic loading,
plugin↔kernel version compatibility surface. One idea is taken: *plugins use published entry points
and never import core internals* — shipped as a test (TST-03).

---

## 1. Target layout

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
  contracts/              drift-gate suite factory a host repo calls
plugins/
  git/  ops/  nightly/                        v0 builtins
    <name>/plugin.ts                          the manifest
    <name>/skills/<job>/SKILL.md              the prompt, owned by the plugin (SKL-03)
  jira/ slack/ github/ notion/ tracker/ pr-review/ corpus/   v1
host/                     the app. owns its own schedule, its own resources.
  config.ts               the gate's named resources + the refresh window     N2
  cron.ts                 the croner seam — parseFive, tickSeconds, gateWait  N2
  schedule.ts             ScheduleEntry, Program, SCHEDULE, validate()        N2
  supervisor.ts           runEntry, main, --list — one timer per entry        N2
  window.ts               entriesInWindow — the refresh-window allowlist (SUP-12) N2
  runner.ts               the @ai-hero/sandcastle adapter (D2)                 N3
  run.ts                  the ONE argv block — what jobRunner spawns           N3
  jobs/
    index.ts              the hand-registered job list (SKL-05)                N3
    nightly-sandcastle.ts one small verified improvement, gated (JOB-C15)      N3
cli/                      operator surfaces
  crontab.ts              render | sync | check | sync --adopt (SUP-08)       N2
  skills.ts               render | sync | check (SKL-04)                      N3
  lease-clear.ts          list scope | delete key | --force (LSE-10)          N4
.claude/skills/<job>/     RENDERED from the manifests — never hand-edited (SKL-04)
fleet/                                        v1
  Dockerfile  compose.yml  fleet.sh                        workers
test/                     repo-wide drift gates — layout, commands, toolchain, skills, corpus
```

`test/` holds the repo-wide drift gates until `kernel/contracts` exists to generalise them (TST-01).
At N5 they fold into `kernel/contracts`; until then, `test/` at the repo root is their home, because
ADO-17 needs a suite invoked at the root across every workspace and there is nowhere else for it to
live before N5.

**The v0 manifest ships FIVE members** — `name`, `kill`, `jobs`, `schedule`, `env`. `sources`,
`routes`, `relays` and `lanes` arrive with the plugin that needs them: a port designed against no
consumer gets designed wrong, which is the failure §4 already warns about.

`kernel/config.ts` is the `EnvSpec` reader and is not `host/config.ts`, which is the host app's own
settings. The two never merge — one is the framework's knob mechanism, the other is one app's
configuration.

`kernel/ports/job.ts` and `kernel/ports/runner.ts` are declared at N3 and re-homed under PRT-05's and
PRT-08's rows later, on the `EnvSpec` precedent (J1.2): ship the shape the port will carry, in the
module that needs it, and re-home it later without rewriting it. `host/runner.ts` is the **only**
file that imports an agent-runner package, which is what makes M11 a file swap. **`host/run.ts` is
the only argv block a scheduled job reaches** — ruling 3's statement in the spec, not only in a plan.

`supervisor --list` is deliberately NOT a `cli/` file: SUP-17 is a flag on the supervisor, which is
where the resolved schedule already lives, and the reference's own entry point takes the same flag.

`host/cron.ts` reads cron EXPRESSIONS; `cli/crontab.ts` writes the user's CRONTAB. They share four
letters and nothing else.

---

## 2. Feature inventory

### 2.1 Kernel — registry, manifest, boot (`KRN`)

- **KRN-01** `registry<T extends Named>(kind)` — `register` throws on duplicate **at import time**;
  `get` throws naming the miss (never returns `undefined`); `tryGet` / `has` / `all()` in
  registration order / `names()`.
- **KRN-02** No discovery, ever. Nothing at runtime distinguishes "member missing" from "member
  broken"; a directory scan makes them identical.
- **KRN-03** The five registries collapse onto KRN-01: entry points, relays, watchers, programs,
  retro lanes.
- **KRN-04** `Plugin` manifest: `name`, `kill`, `sources`, `routes`, `relays`, `jobs`, `schedule`,
  `lanes`, `env`.
- **KRN-05** `definePlugin(p)` — identity helper, so the type error names the plugin not the registry.
- **KRN-06** `EnvSpec { key, required?, default?, why }` — `why` is one line and IS the knob doc.
- **KRN-07** Per-plugin kill switch `*_NO_<FEATURE>=1`, degrading toward the **safest** verdict.
- **KRN-08** `boot(plugins)` collects ALL problems then throws once, each line attributed to a plugin.
- **KRN-09** boot checks: route has watcher **or** an `unwatched` reason · watcher names a
  registered job · schedule entry names a registered job · relay gates a target it cannot receive ·
  job declares a model · **job names a `skill` that resolves to a directory on disk** · **every
  skill directory on disk is named by a registered job** (SKL-06) · required env unset with no
  default · duplicate names across registries · writer names an unknown gate resource.
- **KRN-10** `Route` becomes an **open** set; `boot()` replaces the closed union's exhaustiveness.
  One-way: decide before the first plugin ships a route.
- **KRN-11** `boot()` runs in `npm test`, not only in the supervisor.

### 2.2 Ports (`PRT`)

- **PRT-01** `Source.fetch(): Promise<FetchOutcome>` — **no cursor argument**; every adapter's cursor
  shape differs (Slack 3 marks, Jira JQL watermark, GitHub ETag, Notion state diff), so the cursor is
  read and committed inside `fetch()`.
- **PRT-02** `FetchOutcome { items, caughtUp, status, severity }` — `caughtUp:false` while walking a
  gap; `severity` is a closed enum **SET** by the adapter, never derived from free-text `status`.
- **PRT-03** `Relay { name, strip, targeted, admit?, send }` — `strip` = personal-tracker strip-pass
  policy per relay; `targeted:false` pins the destination inside `send`; `admit` refuses host-side.
- **PRT-04** `RouteDef { name, watcher?, unwatched? }`; `Watcher { job, leases?, holdsUnsettled? }`.
- **PRT-05** `Job` shape: `name`, `description`, **`skill`** | `exec?`, `model`, `effort`,
  `permissionMode`, `maxIterations`, `completionSignal`, `promptArgs`, `env`, `worktree`,
  `taskClass`, `session`, `local`. `prompt`/`promptFile` are GONE (D10): a job names a skill or it
  is deterministic, and there is no third shape.
- **PRT-06** `ScheduleEntry`: `name`, `cron`, `log`, `env?`, `gateWait?`, `clearsRefreshWindow?`,
  `maxRunMin?`, `job` | `script`, `supervised?`, `why` (required).
- **PRT-07** `Lane { id, title, jobKeys, leaseScopes, wrong }` — what BEING WRONG means in that lane.
- **PRT-08** `Runner` port — the sandcastle→own-library seam (D2/D3).

### 2.3 Runtime — gate (`GAT`)

- **GAT-01** In-memory reader/writer gate over named resources (reference: `factory`, `plugin`,
  `services`). Replaces `flock` + 17 wrapper scripts; possible because one supervisor process owns
  every tick — which also bounds it: the gate is per-PROCESS, so it excludes nothing between two
  instances on one host (INS-05).
- **GAT-02** Reader takes `shared` on ALL resources; writer takes `excl` on **only what it moves**;
  a writer naming nothing takes all (safe default).
- **GAT-03** Two writers on disjoint resources run concurrently — the reason the split exists.
- **GAT-04** Fixed global acquisition order (`RESOURCES` left-to-right) — the deadlock argument for
  the one multi-resource writer.
- **GAT-05** FIFO queue with writer priority: a queued writer blocks readers arriving after it.
- **GAT-06** Per-**program** self-exclusion (not per entry) — one program, many entries.
- **GAT-07** `gate: "none"` exemptions, each stating why (8 programs in the reference).
- **GAT-08** `gateWait: true` blocks for one of the entry's own ticks, **derived** by `gateWait(cron)`
  and capped at 30 min; otherwise a contended tick SKIPS.
- **GAT-09** Never hand-pick a wait: a blocked pass holds its self-lock, so the ticks it waits
  through are the ticks it forces to skip.
- **GAT-10** Lock-starve visibility: `lockloss:<job>` counters, `LOCK_STARVE_N`, plus a
  per-job raised threshold (`_N_TODO_EXEC`). **Renamed from `BACKLOG_LOCK_STARVE_N` at J2.12**: the
  `BACKLOG_` prefix is a pipeline stage name, and this is a property of the GATE, not the backlog.

### 2.4 Runtime — leases (`LSE`)

- **LSE-01** SQLite lease mutex: `scope` + `key`, TTL, `held|done|failed`, attempts, owner string.
- **LSE-02** `done` is **terminal** — refused at any horizon; deletion is the only way back.
- **LSE-03** `withLease` settles `done` on any non-throwing return, early returns included (the
  XEN-8365 47h trap) — documented, not silently fixed.
- **LSE-04** Versioned keys (`todo:<n>@<updatedAt>`, `repo#n@<sha>`) vs constant keys (serial groups)
  and the opposite release rules each needs.
- **LSE-05** `maxAttempts` crash-loop brake; `capped` return distinct from `held`.
- **LSE-06** Owner = `<instance>:<host>:<pidns>:<pid>:<uuid8>` (INS-04).
- **LSE-07** `reapDead` guard table, every guard failing toward NOT reaping: pid-namespace ≠ ours ·
  host ≠ ours · claimed <30s ago · `/proc/<pid>` present · already expired · `done`/`failed`.
- **LSE-08** Owners written before the namespace was recorded are skipped, never guessed.
- **LSE-09** Supervisor runs the same sweep **on boot**, before registering any timer.
- **LSE-10** `lease-clear` operator surface: list scope · delete key · `--force` a `held` claim.
- **LSE-11** `proc.ts` — liveness read in the CALLER's namespace, every branch failing toward "alive".
- **LSE-12** Serial-group lease in its own scope, so `heldCount` (the concurrency cap) is not eaten
  by group keys; released by `clear(force)`, never by settling.

### 2.5 Runtime — queue, broker, workers (`QUE`)

- **QUE-01** `job_queue`: one SQLite table the scheduler fills and workers drain.
- **QUE-02** Dedup `(program, dedup_key)` UNIQUE — same head never re-enqueues; new head = new row.
- **QUE-03** `enqueueTask` / `claimNext` / `renew` / `settle` / `release` / `listByStatus`.
- **QUE-04** Single-writer by construction (only the broker opens the DB) — no `SKIP LOCKED` needed.
- **QUE-05** Crashed worker's `claimed` row ages back via TTL reclaim.
- **QUE-06** Request/reply: `enqueueTask(spec)` → worker runs → `awaitResult(id)` polls to terminal.
- **QUE-07** Broker over a unix socket: newline-delimited JSON, one request → one response by `id`,
  overlapping calls on one connection.
- **QUE-08** `hello` handshake refuses mismatched `PROTOCOL_VERSION` or `ENGINE_VERSION`
  (`dev` unenforced).
- **QUE-09** `BrokerClient.withLease` reproduces the local lease ergonomics over RPC.
- **QUE-10** Broker relays a worker may ASK for, never perform: `postSlack` (no destination
  argument at all), `postJiraComment` (re-checks live assignment + strip-pass), `clickstackQuery`
  (instance NAME, never a URL; credential read host-side at call time).
- **QUE-11** Worker loop: claim → run → settle, failed-retry, `WORKER_POLL_MS`.
- **QUE-12** ONE generic `claude-task` handler — zero job knowledge in a worker; new jobs distribute
  for free.
- **QUE-13** Worktree spec on a task realised by `runLocal` inside the worker.
- **QUE-14** Dark-pool fallback: a `pending` task past `DISPATCH_PICKUP_MS` with **zero** `claimed`
  rows fleet-wide is taken over by the scheduler under a conditional UPDATE; row goes terminal with
  `owner='scheduler'`. Refused only when the host's own breaker is open. `DISPATCH_FALLBACK=0`
  restores pre-fallback behaviour.
- **QUE-15** `dispatchTimeoutMs` by `taskClass` — `impl` gets `DISPATCH_TIMEOUT_IMPL_MS`.
- **QUE-16** No intra-job parallelism by default (a job's `exec()` awaits each `runJob`); pool
  utilisation comes from many jobs dispatching concurrently.
- **QUE-17** No worker registry — a worker appears only once it claims. Documented limit, not a gap.

### 2.6 Runtime — DB (`DBS`)

- **DBS-01** `openDb(path)` — handle + `tx` + ordered migrations, one file per integration
  (`slack.db`, `jira.db`, `backlog.db`, `lease.db`, `quota.db`, `queue.db`, `log.db`).
- **DBS-02** Namespaced tables (`<ns>_message`, `<ns>_meta`) with `<ns>_meta.schema_version`;
  migrations are append-only steps owned by the source.
- **DBS-03** Namespace identifier guard (`ns` is interpolated into DDL).
- **DBS-04** SQLITE_BUSY context: rethrow naming file + one-line SQL + waited-ms; do NOT retry and
  do NOT raise the timeout (the wait is the discriminator).
- **DBS-05** `tx` begins IMMEDIATE, not DEFERRED.
- **DBS-06** Proxy-wrapped `exec`/`prepare` and statement `run`/`get`/`all` so no call site is a
  blind spot.
- **DBS-07** `dbPath(name)` with `<NAME>_DB` override for throwaway runs.
- **DBS-08** `closeAll()` at job end.

### 2.7 Scheduling & supervision (`SUP`)

- **SUP-01** The schedule is DATA, read live — no compiled copy to drift.
- **SUP-02** `PROGRAMS` registry: `self`, `gate`, `resources?`, `dotenv` — keyed on program, not entry.
- **SUP-03** Supervisor: one croner timer per entry → take gate → spawn child with `cwd = ROOT` →
  append child stdout/stderr to the entry's `log:` → release.
- **SUP-04** `dotenv: false` is load-bearing: a knob reachable only from an `env:` prefix on the entry.
- **SUP-05** `validate()` on **every boot** and every render, over every entry incl. unsupervised:
  duplicate name · non-5-field cron · relative `log` · **`log` not under one of the two log roots
  (SUP-18, added at J2.9)** · empty `why` · both `job` and `script` · neither · missing
  `src/jobs/<job>.ts` · missing script on disk · no `PROGRAMS` row · writer naming an unknown
  resource · reader naming resources · `gateWait` on an ungated program · `clearsRefreshWindow` on
  an ungated program · **`clearsRefreshWindow` while the refresh window is `null` (added at J2.9,
  N2 ships no live window)** · **`gate: "none"` with no non-empty `whyNoGate` (GAT-07, added at
  J2.9)** · unescaped `%` in a bootstrap command.
- **SUP-06** A boot refusal is loud: restart loop + watchdog reports within 15 min.
- **SUP-07** Croner-vs-POSIX parity test over every expression across a fixed 14-day window.
- **SUP-08** Bootstrap crontab block: `render` / `sync` / `check` / `sync --adopt`; managed markers;
  foreign lines untouched; duplicate detection refuses a plain splice. Markers are per-INSTANCE
  (INS-03) — the crontab is the one host-global surface two checkouts cannot avoid sharing.
- **SUP-09** `supervised: false` — exactly one entry (the watchdog), because a liveness probe
  scheduled by the process it probes reports nothing in the case that matters. **`validate()`'s
  enforceable form is "at most one" (reworded at J2.9): an empty schedule has zero, and "exactly
  one" would refuse the state N2 ships in.**
- **SUP-10** Refresh window stated ONCE (`inRefreshWindow`); `clearsRefreshWindow: true` drops a
  firing before the self-lock and before the gate.
- **SUP-11** The flag bounds where a pass may **start**, never how long it **runs** — long passes
  keep real day-split legs instead.
- **SUP-12** `order.test` allowlist for what may legally fire inside the window, plus a companion
  assertion walking `inRefreshWindow` minute-for-minute.
- **SUP-13** `maxRunMin` — SIGTERM then SIGKILL then release the locks; default
  `SUPERVISOR_MAX_RUN_MIN` (180) = 1.5× the longest legitimate pass.
- **SUP-14** Supervisor heartbeat stamp (60 s) — the fastest liveness signal there is.
- **SUP-15** Boot-time lease reap (LSE-09) before any timer registers.
- **SUP-16** Quota-shed skip at `runEntry`, before the gate, logged `event=quota-shed`.
- **SUP-17** `supervisor --list` — the resolved schedule: entry → program → gate → resources → wait.
- **SUP-18** Two log roots, both read; log paths explicit per entry, never derived.
- **SUP-19** Process manager: **Docker restart policy** replaces `engine.service` + `enable-linger`;
  the pinned-node-path gotcha disappears with the image.
- **SUP-20** Stage-prefix vocabulary: every job name and schedule entry carries a known prefix
  (`source-`, `triage-`, `backlog-`, `watch-`, `todo-`, `corpus-`, `nightly-`, `retro-`, `ops-`).
- **SUP-21** Docs-count drift gate: prose restating entry counts is checked against the schedule.

### 2.8 Pipeline — backlog (`PIP`)

- **PIP-01** `source → switch → backlog → watchers`; one job and one failure mode per stage.
- **PIP-02** Stage contracts: entry point transcribes (never classifies) · switch assigns a route
  (never handles) · backlog is source-agnostic (never knows what a channel is) · watcher claims by
  route, handles, settles (never re-classifies).
- **PIP-03** Six states: `new` · `routed` · `processing` · `handled` · `failed` · `dead`.
- **PIP-04** `handled` means **left the backlog**, not that work happened; `handled_ref` carries the
  difference: `https://…` · `terminal:<route>` · `skip:<reason>` · `resolved:eod` · `picked:<issue>` ·
  `read:<day>` · `dlq:<step>@<n>`.
- **PIP-05** `setRoute` writes route + status in ONE statement (`WHERE route IS NULL` = CAS).
- **PIP-06** Terminal routes settle inside that same UPDATE, leaving `attempts` at 0.
- **PIP-07** `terminalSweep()` on every brief — for terminal rows written outside `setRoute`.
- **PIP-08** `immediate` pull claims at route time; `immediateSweep()` for rows stranded by a route
  promoted to immediate.
- **PIP-09** Route modes, one per route, asserted by test: **terminal** · **watched** · **manual**.
- **PIP-10** Route set (reference): `pr-review`, `pr-feedback`, `release-approval`, `devops-request`,
  `question`, `assignment`, `incident`, `human-action`, `fyi`, `context`, `unknown`,
  `tracker-triage`, `todo-agent`, `todo-human`.
- **PIP-11** Pull policy per manual route: `immediate` (incident, release-approval) · `brief`
  (question, devops-request, human-action) · `read` (unknown). `PULL_PRIORITY` orders the
  brief-eligible ones so the cap bites the tail.
- **PIP-12** `read` route: seen once IS the handling; settled in the run that prints it, uncapped
  reads sliced by `BRIEF_READ_CAP`, later modes re-derive from `read:<day>` refs.
- **PIP-13** `unknown` is a real bucket with a count, never a synonym for `fyi`.
- **PIP-14** Unit of work is a **conversation**: `conv_key` per source (slack
  `slack:<ch>:<thread_ts??ts>` · jira `jira:<KEY>` · github `github:<url>` · notion `notion:<page>` ·
  tracker `tracker:<n>`).
- **PIP-15** `unhandledSince` is the one query filtering status NEGATIVELY — every new status must be
  told about it (asserted by `statuses.test`).
- **PIP-16** `columns.test` — every `backlog_item` column is projected or excluded on purpose.
- **PIP-17** `owed` vs `unhandledSince` skip different sets, deliberately.
- **PIP-18** `holdsUnsettled` — a watcher declaring that unsettled rows on its route are inventory,
  not a fault (`pr-review` only).
- **PIP-19** `reroute` + `notFromSource` — the ONE exception to "a watcher never re-classifies":
  a watcher that cannot serve a row hands it to `human-action` after a grace window.
- **PIP-20** `held.ts` — generic source-side hold-until-due queue, per source's own DB.
- **PIP-21** `prlink.ts` — PR-link extraction from parent or direct message.
- **PIP-22** `clone-detect.ts` — duplicate-ask fingerprint on TITLE, families of 3+ surfaced once,
  silent until a family gains a member.
- **PIP-23** `render.ts` — shared render + `marker()` / `tickedIds()` tick parsing, source-agnostic.
- **PIP-24** Reconcile always runs **before** render.

### 2.9 Pipeline — classification (`CLS`)

- **CLS-01** Source-blind classifier over an `IntentInput` (`container` is a channel/db/project/repo).
- **CLS-02** Two rules resolve before the model, both per-source: the **bot filter** (attacker-authored
  text never reaches the model; asserted by test) and the **tracker lane** (already written down as a
  label).
- **CLS-03** One batched call per tick, `SWITCH_MAX_BATCH`; a tick with nothing untriaged makes no
  model call.
- **CLS-04** Output validated against the ids sent and the route enum; anything else → `unknown`.
- **CLS-05** Bodies fenced as untrusted data; a route is a label that selects a handler and never
  authorises a write; every watcher re-verifies its own preconditions.
- **CLS-06** `botRoute` splits `pr-review` from `pr-feedback` on GitHub's `reason=author`, read from
  `raw` and never from `text`.
- **CLS-07** Bots excluded **by name** (e.g. `sonarqubecloud`), never by absence from an allow-list.
- **CLS-08** `triage-probe` — run the classifier over live data and print the grouping; writes nothing.
- **CLS-09** `SWITCH_DRY_RUN` — print the bot/model split, spend nothing.

### 2.10 Pipeline — steps, caps, DLQ (`DLQ`)

- **DLQ-01** `backlog_step`: one row per `(item, step)`; key is `<kind>` or `<kind>:<qualifier>`.
- **DLQ-02** Caps: `route` 5 · `watch:<route>[:<stage>]` 3 · `brief` 7 (per MORNING) · `pr-fix` 2 ·
  unregistered 10 (`STEP_CAP_DEFAULT`) — an uncapped step is an unbounded loop that fails silently.
- **DLQ-03** Counted on **ENTRY** where a loop leaves no failure record; on the **failed settle**
  where a job settles everything it reaches (`watch-pr-review`, `watch-pr-feedback`).
- **DLQ-04** **Never** charge an attempt to a row a per-run cap refused (3h / 1-day false
  dead-letter arithmetic).
- **DLQ-05** Keys qualified per route and per stage so `reroute` and multi-stage jobs cannot inherit
  each other's exhaustion.
- **DLQ-06** `takeStep` dead-letters the row itself rather than returning a flag every call site must
  remember to act on.
- **DLQ-07** `backlog_item.attempts` is NOT reused (it bumps on success and spans three stages).
- **DLQ-08** Conversation-level counting where the unit is a conversation, on the oldest row.
- **DLQ-09** Every `*_DRY_RUN` counts NO step attempts, anywhere.
- **DLQ-10** DLQ is a **report, not a bin**: own section in the brief in every mode, above the fold,
  naming the step and the count that gave up.
- **DLQ-11** Two ways out: tick (`dead → handled` permitted, `dead → failed` refused) or revive.
- **DLQ-12** `revive` resets counters, **clears leases** (`WATCHERS[route].leases`) and requeues.
- **DLQ-13** Nothing revives on a schedule.
- **DLQ-14** Operator surface: `dlq` list · `dlq show <id>` full step history · `dlq revive <id>` ·
  `dlq revive --all` oldest-death-first.
- **DLQ-15** `BACKLOG_DLQ_MAX` breach; DLQ fills within the hour where a stuck count needs a day, and
  it is the only signal for a `route`-step death.

### 2.11 Agent harness (`HRN`)

- **HRN-01** `DEFAULTS` in ONE place: `model` (a pinned version, never a floating alias), `effort`,
  `permissionMode`.
- **HRN-02** `defineJob` identity helper; `runJob` builds and runs.
- **HRN-03** Three runners, ONE `RunResult` contract: `runSession` (warm session) → `dispatchToPool`
  (worker) → `runLocal` (here). **Session branch first** — a session is a terminal on this host.
- **HRN-04** A session has no stdout: the payload is a FILE named by a prompt trailer; the sentinel
  format is unchanged and the file is also the completion signal.
- **HRN-05** The session is a warm cache and never the record — payload read and persisted BEFORE
  `/compact`.
- **HRN-06** A session is the one runner that does not clean up after itself (→ `session-reap`).
- **HRN-07** `permissionMode` is load-bearing on a host runner — no auto-skip, so an unattended job
  hangs on the first tool prompt without it.
- **HRN-08** **Workers never write, except where the work IS the write** — four named exceptions,
  each with a kill switch and a ration; the TRACKER write never crosses.
- **HRN-09** Third shape: a worker may **ASK** for a Slack/Jira write via the broker, never perform one.
- **HRN-10** Sentinel payload parsing: last `<<<TAG … TAG>>>` block wins (agents echo the template);
  `extractBlock` / `extractFields`; malformed payload writes nothing.
- **HRN-11** Every agent run **names its model**; a test fails the build on a `runJob`/single-agent
  `defineJob` with no `model` key. Inheriting is spelled `DEFAULTS.model`.
- **HRN-12** `worktree` realization + `{{WORKTREE}}` prompt placeholder, so a review reads the PR's
  own head wherever the agent runs.
- **HRN-13** `taskClass` declared at the call site that knows the work is implementation-shaped.
- **HRN-14** `job.local` pins a shared-master writer to one node.
- **HRN-15** `OPUS_GUIDANCE` — shared agent-discipline preamble (delegate only for wide independent
  sweeps; never spawn a subagent to check your own work; count a skill's fan-out).
- **HRN-16** Every run — worker or host — names a skill **by name**; its payload stays in code.
  Never a path into a skill's files; the prompt around a skill stays short. Promoted from a worker
  detail to the only prompt mechanism there is (D10, SKL).
- **HRN-17** `plugin-names.test` holds the skill/agent name list to the prompts (SKL-06 is the
  registry half of the same gate).
- **HRN-18** `pool.ts` — bounded concurrency + spawn stagger (`*_SPAWN_STAGGER_MS`, 2000) for the
  `~/.gitconfig` start-up race.
- **HRN-19** `exec.ts` — `gh` / `ghIn` / `git` wrappers with a wall-clock timeout (an unbounded
  stalled `gh` blocks the event loop, so lease heartbeats stop).

### 2.12 Jobs — sources & switch (`JOB-S`)

- **JOB-S01** `source-sweep` — phase 1 for EVERY source, two stages: Slack sweep (mention-following,
  channel-agnostic; thread parents + recent human replies) then every registered `fetch()`.
  A crashed sweep does not skip the ingest; one failing adapter does not stop the others.
- **JOB-S02** `triage-switch` — route every untriaged item; two minutes behind the sweep.
- **JOB-S03** `triage-probe` — read-only classifier probe.
- **JOB-S04** `source-jira` / `source-github` / `source-notion` — per-adapter manual runners with
  their own `*_DRY_RUN`; they INSERT and must (the cursor commits as `fetch()`'s last act).

### 2.13 Jobs — brief & health (`JOB-B`)

- **JOB-B01** `backlog-brief`, one job, `BRIEF_MODE` per entry: `morning` (reconcile ticks, pull
  brief-eligible → `processing` under `BRIEF_CAP`, file today's issue, close yesterday's) ·
  `progress` ×2 (movement only, no pull) · `eod` (resolver, auto-close, edit and leave open).
- **JOB-B02** Only `morning` opens or closes a brief issue; a `progress`/`eod` run with no open brief
  writes nothing.
- **JOB-B03** Daily issue sections in render order: possible duplicate asks · open · dead letters ·
  auto-closed at EOD (struck through, no checkbox) · read and cleared · my open PRs (informational) ·
  a `<details>` fold naming what `BRIEF_CAP` held back.
- **JOB-B04** EOD resolver: one batched cheap call over `processing` items **with new replies only**;
  bias-to-open enforced in `parseResolve` (literal `true` required; malformed → open); every
  auto-close listed with its reason; thread-level only.
- **JOB-B05** `backlog-weekly` — deterministic period report from `backlog_item`, watermarked so
  nothing repeats, leading with PR-URL rows that were not routed for review, silent on a quiet week.
- **JOB-B06** `backlog-add` — self-authored todo straight into the backlog pre-routed to
  `human-action`; no LLM, no source, no tracker issue.
- **JOB-B07** `backlog-dlq` — DLQ-14.
- **JOB-B08** `backlog-health` — the inventory digest: `remaining`, oldest-untriaged age, `unknown`,
  DLQ size, per-route counts, stuck-per-route split by whether a watcher exists, reporter staleness,
  quota-dark section, dead-ends. No LLM.
- **JOB-B09** Off-shift handling: "watched and stuck" only means failing while that watcher is on
  shift, **derived from the schedule** via a day-aware `isScheduledInHour`, never a list of windowed
  jobs. A watcher with NO schedule entry still breaches (`hasSchedule`).
- **JOB-B10** Breaches and all-clears on **separate clocks**, each rate-limited off its own mark
  (`BACKLOG_BREACH_COOLDOWN_H`, `BACKLOG_OK_EVERY_H`).
- **JOB-B11** Dead-ends: derived from leases and failed queue rows, flagged-once, reported as
  breaches.
- **JOB-B12** Liveness stamps stamped only after a completed tick — never on a crash, never on a
  quota park (`last_switch_at`, `last_fetch_ok_at`, `last_report_ok_at`).

### 2.14 Jobs — PR family (`JOB-P`)

- **JOB-P01** `watch-pr-review`, three phases per tick: **reconcile** (every open todo vs live
  GitHub: resolve merged/closed, adopt unmarked, decide what went quiet) · **review** (one headless
  run per unseen PR, one tracker todo each) · **re-review** (the ones that came back ready).
- **JOB-P02** Two entries differing only by `PR_DISCOVER` — the broad poll is the one input that can
  hand the job PRs nobody asked for.
- **JOB-P03** Phase 1.5 **bible chain**: a doc-backed PR with no `[PRD]`/`[RFC]` bible chains one,
  under `bypassPermissions`, scoped to the personal tracker only; rationed (`_BIBLE_MAX`),
  switchable (`_BIBLE_CHAIN=0` restores prior behaviour exactly), previewable (`_BIBLE_DRY_RUN`).
- **JOB-P04** State on line 1 of the todo body:
  `<!-- pr-review-state v=1 head=<sha> pr=OPEN reviewed=… rereviewed=… n= sev= fails= posted= -->`;
  reviewed head vs `headRefOid` IS the entire change signal; `pr` going non-OPEN is terminal.
- **JOB-P05** Dedup by title marker `[PR <repo>#<num>]`; no local state file.
- **JOB-P06** Inline posting policy in ONE module: confirmed only · at or above
  `PR_REVIEW_MIN_SEVERITY` (default `low`, unrecognised falls back to `low`) · PR OPEN at the exact
  reviewed head · strip-pass blocking any body leaking the private tracker · one API call per
  comment · a partial failure never aborts the rest.
- **JOB-P07** Never approves a team PR — a human does.
- **JOB-P08** **Merge readiness** scored every pass: `quality`/`readiness`/`confidence` 0–10 plus an
  `approvable` verdict, rendered from one parsed payload into three places (state marker, a
  `**Merge readiness**` line, the `merge-ready` label). Reconciled, not trusted (a confirmed
  HIGH/CRITICAL wins); a partial score is no score; the label is applied AND cleared by the same pass.
- **JOB-P09** An approvable re-review DMs Slack once per tick (`PR_REVIEW_SLACK_APPROVABLE`); the
  re-review is the dedup; first reviews are silent.
- **JOB-P10** Readiness is ONE rule (`decide()`): something happened since the last review and it has
  since STOPPED. A **reply is activity**; the head SHA is kept alongside the timestamp; the comment
  signal turns on from the first re-review.
- **JOB-P11** An outstanding ask outranks the quiet wait, never the caps and never the changed check;
  the watcher must NOT settle an ask while that PR's todo is open.
- **JOB-P12** Per-PR lease `repo#num@headSha` shared by both PR jobs; `done` terminality is correct
  here, so `pr-review` deliberately registers no revive leases.
- **JOB-P13** Re-review append is idempotent (`## Re-review <date>`); `validateSection` gates the
  write; overflow splits narrative sub-sections to a comment while `### Still open` / `### New
  findings` stay in the body; a failed append **counts** toward `MAX_FAILS_PER_PR`.
- **JOB-P14** `watch-pr-status` — read-only dashboard rebuilt from the tracker.
- **JOB-P15** `watch-pr-feedback` — reviewer-bot findings on MY open PRs; one `[BOT <repo>#<n>]` todo
  per PR; one child process per PR; no LLM (GraphQL read + severity parse).
- **JOB-P16** Pre-check `isUnchanged` on `updatedAt` (never head SHA), overridden by a backlog row
  newer than the stamp; `rotate()` least-recently-checked-first over survivors; `stampProcessed`
  after the pool and only for a PR actually processed; `coveredVerdict` settles rows against an
  earlier look.
- **JOB-P17** `reapStranded` — the sweep is `--state=open`, so a merged PR's todo is unreachable
  otherwise; `merged-with-open-findings` stays open, anything else closes.
- **JOB-P18** The todo body is **EDITED, never re-rendered** — a re-render drops every ticked
  auto-closed row.
- **JOB-P19** A backlog row naming two PRs settles only once BOTH have a verdict.
- **JOB-P20** `PR_FEEDBACK_CHILD_TIMEOUT_MS` — a wedged child holds its pool slot forever and takes
  the whole job dark; SIGKILL is the only bound.
- **JOB-P21** `watch-pr-fix` — nine deterministic candidate gates (no model spent choosing): todo
  open + labelled · title parses · live PR open + authored by me · ≥1 unticked finding read live ·
  **no local worktree work** (dirty or ahead) · author-only quiet window · free per-head lease ·
  lifetime per-PR push cap · per-finding attempt cap.
- **JOB-P22** Then three validation gates per finding, run by the worker: re-read the code · ask the
  owning bundle's knowledge-navigator agent · check the PR's own ticket acceptance criteria →
  fix (commit + push) or DECLINE (reply on the thread, then resolve it).
- **JOB-P23** CI gate before fixing (`awaitChecks`/`reduceBuild`/`problemChecks`, reused not copied):
  red + base unmoved stops the tick; red + base moved merges base in (never rebase, never force-push)
  and re-checks.
- **JOB-P24** Never writes the tracker todo; the watcher's `retireFixed()` ticks a resolved thread.
- **JOB-P25** Counters that survive across heads live in a meta blob (`pr_fix_pushes`), separate from
  the feedback job's `pr_feedback_examined_at`; an unreadable meta blob ENDS the tick (a degraded
  `{}` zeroed every PR's lifetime count).
- **JOB-P26** An unresolvable `gh api user` is a total outage for the job, not a per-item skip.
- **JOB-P27** `watch-bug-digest` — the week's unaddressed high/critical findings as BUGS:
  statuses `shipped` / `unseen` / `ignored` / `standing`; cheap grouping call; one Opus repro agent
  per bug reading real code in a PR-head worktree; verdicts `armed` / `latent` / `refuted` /
  `unverified` (malformed → `unverified`, never `refuted`).
- **JOB-P28** `standing` is opt-in by label **plus** a body marker — declared, never inferred; skips
  classify; reads the repo's own `main`; ranks with `shipped`.
- **JOB-P29** Two fingerprints, deliberately asymmetric: exact identifies a finding, loose
  (`repo#pr:file:severity`) suppresses only the expensive re-run.
- **JOB-P30** The cap bounds the expensive half only; everything qualifying reaches the report and
  overflow is named under `## Deferred`.
- **JOB-P31** Repro queue ordered `shipped` → `standing` → `unseen` → `ignored`, then severity.
- **JOB-P32** Three closures, ordered strictly AFTER the new digest is filed: a refuted finding
  renders **pre-ticked** · last week's digest issue is retired · a review todo whose every high+
  finding is settled and whose PR is non-OPEN is closed.
- **JOB-P33** Ticks read back off the filed ISSUES (`--state all`), not the state file.
- **JOB-P34** Failure paths degrade toward reporting: failed grouping → one bug per finding · quota
  park → findings with no repros · a report that does not land leaves the state file untouched.
- **JOB-P35** `findings.ts` tolerates five live renderings incl. a bullet with no severity (inherit
  from the first review's block for the same FILE); a bullet with no severity and no prior is
  dropped, COUNTED, and the count reaches the report.
- **JOB-P36** `botfindings.ts` — the `[BOT …]` checkbox family, which the prose parser cannot read.

### 2.15 Jobs — Jira watcher (`JOB-J`)

- **JOB-J01** `watch-jira` — the `assignment` watcher: plan an idle assigned ticket, implement one
  moved to In Progress (the human's move IS the gate).
- **JOB-J02** Disposition is TOTAL over a ticket's column: `finished` · `candidates` · `implCandidates`
  · `noStage` (no lease, no model); an unparseable column fails CLOSED and stays visible.
- **JOB-J03** Settling is not forgetting — `externalId` is `<key>:<updated>`, so the next transition
  mints a fresh row.
- **JOB-J04** Foreign-row sweep: rows on this route it cannot serve go to `human-action` after
  `JIRA_WATCH_FOREIGN_H`.
- **JOB-J05** Stage 2 carries a LIST of PRs (one `pr=` line inside the block; the repo is read off
  each URL). Meta-line `pr=` is a fallback that can only recover the first URL; an unreadable token
  stops the pass.
- **JOB-J06** Every gate holds across the whole list: one CI budget for all, worst verdict wins,
  `gh pr ready` is all-or-nothing, each promote its own `try`.
- **JOB-J07** PRs are born **drafts** and promoted only on clean self-review AND passing dev-verify.
- **JOB-J08** The build gates the rest of stage 2 and runs first (a fix round under a red build spends
  a pass making a red build differently red).
- **JOB-J09** Review rounds capped (`_REVIEW_ROUNDS`); an uncleared self-review hands the PR to a human.
- **JOB-J10** The plan probe is one MCP read (`hasCommentMarker`), not a spawn; the prompt's check
  stays as the backstop.
- **JOB-J11** Confirmation issues: one `[JIRA <KEY>]` thread per ticket, four stages appending to it
  (`plan`, `ci`, `review`, `test`), each filed with its own `stage:` label; best-effort and never
  fails the ticket, reported at `error` when it fails.
- **JOB-J12** Two ways out of a thread: `sweepDecisions` (boxes ticked) and `sweepMoot` (the ticket
  reached a done column, however the boxes stand), status read LIVE in one batched query; fails
  closed; `_NO_MOOT_SWEEP=1` disables that arm alone.
- **JOB-J13** `JIRA_WATCH_DRY_RUN` is the one dry run that is NOT free (the lease is taken outside the
  guard) — redirect `LEASE_DB`.

### 2.16 Jobs — todo loop (`JOB-T`)

- **JOB-T01** `todo-triage` — sorts every open issue carrying neither lane into one; selection by
  **absence** of both lane labels, never by `needs-triage`.
- **JOB-T02** Its worker never writes; the verdict IS the payload and applying the label IS the
  authorization grant.
- **JOB-T03** Every degradation lands on `human`; `agent` is reachable only from a literal token in a
  payload that also carried a reason — enforced in `parseVerdict`, not asked for in the prompt.
- **JOB-T04** Re-reads live labels before spending, so a hand-laned issue settles `handled`.
- **JOB-T05** Concurrency INSIDE the tick (`_CONCURRENCY`), a per-tick verdict cap (`_MAX`) and a
  tick budget (`_TICK_BUDGET_MIN`) that never interrupts a running verdict.
- **JOB-T06** Assigns a `space:<x>` (closed set, unknown = fallback) for the session spawner.
- **JOB-T07** `todo-exec` — works a `ready-for-agent` issue pass by pass, then CLOSES it.
- **JOB-T08** `ready-for-agent` IS the authorization (an unattended pass may push to team PRs);
  the grant is re-read live per pass (`liveTodo` + `eligible`), failing closed.
- **JOB-T09** Gate `shared` with **no** self-lock: ticks overlap on purpose; the per-issue lease
  (`todo:<n>@<updatedAt>`) is the entire guarantee.
- **JOB-T10** Three bounds: `_CONCURRENCY` (in flight, read from live leases) · `_MAX` (starts per
  tick) · `_TICK_BUDGET_MIN` (stops starting more, never interrupts).
- **JOB-T11** `_MAX_PASSES` is the only runaway guard (the lease mints a fresh key each pass); passes
  counted from the job's own comment markers; an unreadable comment list counts as **at the cap**.
- **JOB-T12** Serial groups: `serial:<group>` takes a second lease in its own scope before the
  per-issue one; a refusal is SILENT — no comment, no pass, no pause.
- **JOB-T13** The worker prompt requires a worktree named after its own issue.
- **JOB-T14** A malformed payload degrades to `blocked`, never to `done`.
- **JOB-T15** `needs-human` is one label read by three moving parts; removing it is the resume; the
  paused lane is NEVER filtered; parse failures fall through to KEEPING an agent.
- **JOB-T16** Nothing hides an issue from the reading queue. The bar for anything proposed in its
  place: a **machine-observable** unblock condition, watched and lifted by something here.
- **JOB-T17** `todo-human-close` — three passes in order: **self-settle** (PR-shaped candidate whose
  PR is merged/closed; never over `merged-with-open-findings`) · **aging** (escalate at
  `_AGING_ESCALATE_DAYS`, propose close at `_PROPOSE_DAYS` = escalate+14, flag-once via a lease mark,
  `_AGING_MAX` per tick) · **model verdict** `close` / `carry` / `hold`.
- **JOB-T18** `carry` files ONE standalone follow-up holding the remainder (evidence inline, why it
  could not be fixed where found, `- [ ]` acceptance criteria, never "see the parent"), BEFORE the
  close; no parsable carry block → `hold`, never a bare close.
- **JOB-T19** Evidence discipline in the prompt: re-ground at today's primary source, test predicted
  failures against what happened, attribute with `git log -S` before blaming, use sibling repos as an
  oracle, check whether a file is generated; name an unrunnable check with the access it needs.
- **JOB-T20** Before ANY close the orchestrator re-reads the issue live and fails closed on mismatch.
- **JOB-T21** A `hold` writes nothing but marks a `done` lease so the same issue is not re-spent.
- **JOB-T22** `_SELECT_LIMIT` must clear the WHOLE lane, not merely `_MAX`; a truncated read goes out
  at `error` (`selection-truncated`).
- **JOB-T23** Independent kill switches per pass (`_NO_SELF_SETTLE`, `_NO_AGING`, `_NO_CARRY`,
  `_NO_CLOSE`); `_NO_CLOSE` shadows all three passes and still writes the hold lease.
- **JOB-T24** `todo-relevance` — daily read-only re-check of every held claim against the world: is
  the wait still real, or already overtaken (PR merged, fix superseded, sibling ticket)?
- **JOB-T25** `todo-decision-watch` — observes the HUMAN's action and releases the label it answers.
  No model. Observables: owner comment after the question or an edit to the question comment ·
  every checkbox ticked · the human closing the issue. Also strips `q:` with the pause release.
- **JOB-T26** `todo-claim-reap` — closes every open issue whose last CLAIM has been released. No
  model: a set-emptiness check over the label contract.
- **JOB-T27** Session spawner (`todo-herdr.sh`) — one live agent per issue waiting on you, seeded
  with the QUESTION. Two lanes from two labels: pages (never rationed) and reviews (oldest-first,
  capped at `REVIEW_MAX`). Takes `self` (spawning is two calls) and `gate: none` (a spawner's hold
  cannot cover what it starts).
- **JOB-T28** Session reaper (`todo-herdr-reap.sh`) — closes an agent when its issue is closed,
  carries neither lane, or outlives `MAX_AGE_DAYS`; plus sweeps for panes orphaned mid-spawn and
  records whose process is gone.
- **JOB-T29** `todo-herdr-ls` / `todo-herdr-attach` — list (issue · kind · age · status · space ·
  title · labels) and attach by issue number, resolved never computed.
- **JOB-T30** Agent names are `todo-<6-digit-padded-issue>` — fixed width sorts, prefix-free set.
- **JOB-T31** `todo-space-backfill.sh` — idempotent one-shot filling `space:` from existing labels
  for issues triage can no longer reach.

### 2.17 Jobs — corpus & nightly (`JOB-C`)

- **JOB-C01** `corpus-refresh` — pull latest on every service repo, refresh the docs snapshot,
  regenerate + lint the corpus, auto-fix safe drift, then a bounded runbook rotation for services
  that actually moved. Files one report; §4 items ride into the backlog as ONE row.
- **JOB-C02** `corpus-checklist` — lane 1 harvests human review comments on newly merged PRs and
  clusters them; lane 2 RCAs new bug-fix commits, ONE AGENT PER COMMIT.
- **JOB-C03** The bug-commit selector filters SUBJECTS in code, never `git log --grep` (measured
  35 vs 95 commits, 10 false positives).
- **JOB-C04** One flat queue across ALL repos, sorted newest-first globally, no per-repo cap.
- **JOB-C05** Two lanes, different terms: a shipped bug lands **permanently**; comment clustering
  lands on **PROBATION**, deleted by a later leg at `_ZERO_HIT_RUNS` unless cited or backed.
- **JOB-C06** Probation membership decided by DIFFING the file before and after the editor, never by
  trusting candidate titles.
- **JOB-C07** An RCA verdict of `covered` is a VERIFIER miss, never a gap: it never reaches the
  editor, is COUNTED per item, and escalates at `_MISS_ESCALATE` with its own backlog row.
- **JOB-C08** Established zero-hit items are reported as **prune candidates, never deleted**; a
  single miss disqualifies both pruning and probation-dropping.
- **JOB-C09** Two watermarks: lane 1 always advances; lane 2's floor **holds until a run drains**,
  measured against the QUEUE (over the limit, no usable verdict, or held back by the item cap all
  count as not-recorded).
- **JOB-C10** `_UNTIL` holds BOTH watermarks (backfill safety), mirroring the retro's contract.
- **JOB-C11** Separate caps for new items and for widenings; every cap names what it deferred, in the
  report and on the log.
- **JOB-C12** `_RCA_LIMIT=0` is the free smoke test: scan, queue, deferral accounting and full render
  with zero agents.
- **JOB-C13** `corpus-lint` — ABSOLUTE lint of all reference roots every tick, auto-fixes the
  deterministic half (frontmatter from the path, then indices, in that order), commits + pushes what
  it resolved incl. partial; residue at `error` + ONE backlog row; also reports a dirty primary
  checkout. No LLM.
- **JOB-C14** `nightly-polish` — one small docs improvement per pass, rotating goals; edits land in a
  worktree, pass a lint gate, reach master by `merge --ff-only` (the commit IS the release); one
  issue per pass, created and closed in the same pass; rotation state keeps the last N targets to
  steer off a file just touched; ff-only miss + rebase-retry recovery.
- **JOB-C15** `nightly-sandcastle` — the same idea on the engine repo, gated on the full suite plus
  an import smoke and a dry run of every changed file with the DB redirected to a scratch dir;
  the schedule file, the supervisor, `package.json` and its own file are off limits.
- **JOB-C16** Both nightlies run CONCURRENTLY (disjoint gate resources) offset by one minute.

### 2.18 Jobs — retro / grading (`JOB-R`)

- **JOB-R01** `retro-weekly` — the only job that asks *was the last thing I did right*.
- **JOB-R02** A **lane** is a place this machine makes a judgement something outside it can later
  contradict. Ten lanes: `pr-review`, `pr-feedback`, `assignment`, `tracker-triage`, `todo-agent`,
  `switch`, `brief`, `corpus`, `bug-digest`, `ops`. Hand-maintained registry.
- **JOB-R03** Keyed on logfmt `job=`, **never** the log filename and never the job filename; two
  gates: a test failing on any `logger("…")` literal no lane claims, and `unclaimedJobKeys` printed
  in every report for bash-side emitters.
- **JOB-R04** Four evidence tiers, each with a floor **DERIVED from its own data**: `outcome`
  (never pruned) · `lease` · `queue` · `log` (truncate-to-zero, no archive). A window opening before a
  tier's floor is `no-coverage`, never zero.
- **JOB-R05** The named case: every posted finding correlated back to its review thread by
  `file:line` (no comment ids stored). Deterministic buckets `accepted-code-moved`, `answered`,
  `closed-silent`, `ignored-at-merge`, plus `pending` / `self-resolved` excluded from every rate;
  `answered` reply prose handed to a model verbatim.
- **JOB-R06** The SNAPSHOT is the deliverable; the report and the issue are renderings of it. Lands
  in a committed directory, never under a gitignored state dir.
- **JOB-R07** The commit is conditional — a dirty index SKIPS the commit and leaves the files.
- **JOB-R08** Two entries, one pass, no mode flag: the watermark makes the second run near-free if
  the first landed and complete if it died.
- **JOB-R09** `RETRO_UNTIL` **holds** the watermark; `RETRO_LANE_LIMIT=0` is the free smoke test;
  `RETRO_LANES` with an unknown id THROWS rather than silently narrowing.
- **JOB-R10** Proposals re-enter the backlog as ONE row; the retro grades, it does not self-apply.
- **JOB-R11** `chore` class — a spend wall SKIPS it rather than downshifting the judgement.
- **JOB-R12** `backfill-retro.sh` — engine-era weeks serially under one lock, every week carrying
  `RETRO_UNTIL`.

### 2.19 Jobs — ops (`JOB-O`)

- **JOB-O01** `ops-hello` — read-only smoke test.
- **JOB-O02** `ops-log-report` — parses `level=error` out of BOTH log roots, groups by `job/event`,
  posts one batched line; counts `warn` as a bare tail line only on a tick that already had an error;
  per-key cooldown (a NEW key is never delayed); `_MAX_KEYS`; rotates logs past the size cap; stamps
  `last_report_ok_at`; silent when healthy.
- **JOB-O03** `ops-lease-reap` — every minute; LSE-07 guards; no LLM, no network, no gate.
- **JOB-O04** `ops-lease-clear` — LSE-10.
- **JOB-O05** `ops-session-reap` — closes sessions in order: PR merged/closed → age → idle → over the
  live cap (LRU); tears down the worktree each held; a `working` session is NEVER closed; every
  unreadable input KEEPS the session; selects only agents carrying a session token.
- **JOB-O06** `ops-retention` — the only job that deletes durable state: prunes terminal queue rows
  (`RETENTION_QUEUE_DAYS`), terminal leases (`RETENTION_LEASE_DAYS`) and dead log cursors, reclaims
  the WAL; `RETENTION_DRY_RUN` counts every row and deletes nothing.
- **JOB-O07** `ops-hub-health` — `tools/list` per profile against a per-backend BASELINE count; a
  dropped OAuth grant removes tools from the listing rather than failing calls. Documented blind
  spot: it cannot see a grant that lists but can no longer refresh.
- **JOB-O08** `ops-fleet-status` — in-flight set (container → item → age → attempt), per-container
  throughput (live / done-1h / failed-1h), backlog depth, recent failures, open quota breakers.
- **JOB-O09** `ops-cron-check` — diffs the installed managed block against a fresh render; logs every
  run, alerts only on drift.
- **JOB-O10** `watchdog` — bash + the agent CLI only, no node, no `node_modules`, on the real cron,
  outside the supervisor. **Five probes**: `node_modules` is a real directory · the TS runner
  executes · the reporter's log is fresh · the supervisor heartbeat is fresh · Slack **delivery** is
  working (the delivery stamp file is absent). Two send paths. Silent when healthy.
- **JOB-O11** Delivery stamp: written on a failed send, removed on the next good one; the watchdog
  reports its PRESENCE, not staleness (a healthy system posts only when something is wrong).
- **JOB-O12** Mutual watching: the reporter and the health job watch each other because neither can
  watch itself — and the watchdog exists because mutual watching does not survive a SHARED dependency.

### 2.20 Jobs — git / repo ops (`JOB-G`)

- **JOB-G01** `ops-reset-branches.sh` — hourly `git fetch --prune --force` then force each long-lived
  branch to its remote counterpart. No LLM.
- **JOB-G02** Guard matrix with overrides: dirty worktree (skip / `RESET_FORCE_DIRTY`) · unpushed
  commits carrying **your** email (skip / `RESET_FORCE_AHEAD`) · ahead only of rewritten commits
  (reset, report count) · checkout parked on a feature branch (move back to main /
  `RESET_CHECKOUT_MAIN=0`) · missing env worktree (recreate / `RESET_ENSURE_WORKTREES=0`) ·
  `RESET_DRY_RUN`.
- **JOB-G03** Ref writes via `update-ref`, except a branch checked out in a worktree, which is
  `reset --hard` in the owning tree.
- **JOB-G04** Scope listed explicitly, never globbed — a glob also matches the write-repos.
- **JOB-G05** Branch names are not uniform; per-repo candidate list, missing remotes skipped.
- **JOB-G06** Nothing is discarded silently — every outcome prints, no-ops included.
- **JOB-G07** `ops-ensure-env-worktrees.sh` — idempotent worktree per env branch, re-run at the top
  of every reset; the point is that "what is on staging right now" is an ordinary file read.
- **JOB-G08** These trees are disposable and must never be edited.
- **JOB-G09** `ops-reset-env-to-main.sh` — weekly: push `backup/<branch>-pre-reset-<date>` FIRST,
  then force env branches to `main` under `--force-with-lease` pinned to the snapshotted head.
- **JOB-G10** Guard matrix: already at main · absent on origin · today's backup at the same head
  (resume) · at a different commit (skip / `RECUT_FORCE` snapshots beside it) · backup push failed
  (abort that branch) · origin moved (lease refuses) · `RECUT_DRY_RUN`.
- **JOB-G11** `main` is the SOURCE and is refused as a target before any repo is touched.
- **JOB-G12** Reported as "not on main", never "discarded" (squash-merges overstate).
- **JOB-G13** `branches.ts` — the protected-branch set as a MODULE, not prose in N prompts.
- **JOB-G14** PR-head detached worktree prep/teardown, shared by reviewer and digest.

### 2.21 Quota & shedding (`QTA`)

- **QTA-01** A breaker per **account scope**: host `QUOTA_SCOPE`, each worker `workerScope(container)`
  — keyed on the container so a restart's new pid cannot clear a wall belonging to the account.
- **QTA-02** The worker classifies (it saw the CLI message); the broker never regex-sniffs a note.
- **QTA-03** A walled worker **`release`s** the item (refunding the attempt), never settles it
  `failed`.
- **QTA-04** `claimNext` refuses a parked container **before touching a row** — unbypassable and
  restart-proof.
- **QTA-05** Nothing re-probes: the window expires and the next real task IS the probe.
- **QTA-06** Window sized by the limit CLASS the CLI named, never by the reset it stated:
  1× session/daily/usage/unknown, 2× weekly, 4× monthly/spend; `unknown` keeps the SHORTEST window;
  per-class pin via `QUOTA_PAUSE_MS_<CLASS>`.
- **QTA-07** `QUOTA_DARK_GAP_MS` — how long after a window expires a fresh park counts as the same
  outage, so reports show the darkness rather than the current window.
- **QTA-08** `shed.ts` — value classes `chore` / `watch` / `review`. A recent spend-class wall SKIPS a
  chore tick before the gate and DOWNSHIFTS an opus request from any non-review job; `review` is
  never skipped and never downshifted.
- **QTA-09** `decideShed` is pure (snapshot + class + now) so every branch is pinned without a DB.
- **QTA-10** Quota-dark section in the health digest: every open breaker, how long that ACCOUNT has
  been continuously dark, its limit class, its re-probe instant; breach past `BACKLOG_DARK_H`.

### 2.22 Logging & observability (`LOG`)

- **LOG-01** ONE line shape, two emitters (TS + bash), byte-identical; nothing else formats a line.
  The `ts=` field comes from ONE clock helper (`kernel/time.ts`, `nowIso()`) so both emitters agree
  on precision and suffix, not only on layout.
- **LOG-02** logfmt, not JSONL; `msg=` is the only quoted field.
- **LOG-03** Four levels `debug|info|warn|error`; no `fatal`.
- **LOG-04** Routing is a property of the level, not the caller: `error` → the next report tick,
  batched per `job/event`; `warn` → a bare count on a tick that already had an error; `info`/`debug`
  → the file only.
- **LOG-05** Severity is SET by the emitter, never inferred from text.
- **LOG-06** Writes to STDERR so stdout stays free for the payload.
- **LOG-07** `parse.ts` parses a LINE; unrecognised lines are not an error (two thirds of a file is
  agent stdout).
- **LOG-08** `tail.ts` — incremental read over BOTH roots, `(file, inode, offset)` cursors, rotation
  and truncation detection, `LOG_MAX_BYTES`, `LOG_MAX_READ_BYTES`.
- **LOG-09** `cause.ts` — distils a dead child's stderr (which the parser skips) into the one line
  `job-failed` carries.
- **LOG-10** `LOG_LEVEL` gates both emitters.

### 2.23 Tracker, labels, claims (`TRK`)

- **TRK-01** The tracker is the state store — no local state file; state = issues, deduped by a title
  marker.
- **TRK-02** Every label has exactly ONE definition in one file, parsed by the other runtime at
  import — one source, two readers; no generated twin.
- **TRK-03** The vocabulary names the ROLE, never the audience: a lane is a resting state, the pause
  is a doorbell.
- **TRK-04** Label families: lanes (`ready-for-agent`, `ready-for-human`) · pause (`needs-human`) ·
  scheduling annotation (`serial:`) · spaces (`space:`, closed set + fallback) · question taxonomy
  (`q:`) · stage (`stage:`, free text, shape-checked, auto-created) · topics · job filing markers ·
  filing marker (`needs-triage`, never a selector) · per-PR families (`pr-review`, `pr-feedback`) ·
  opt-in (`bug-standing`) · verdicts (`merge-ready`, `merged-with-open-findings`) · generated
  surfaces (two lists, deliberately asymmetric).
- **TRK-05** **The claim model**: a label is one watcher's claim that it still owes work. One owner
  each. `kind=claim|annotation`, `owner=`, `watch=`, `pre=`, `success=`, `escalates=`, `after=`.
- **TRK-06** Closing is therefore NOT a decision — zero claims ⇒ finished by definition.
- **TRK-07** No job owns the lifecycle; a watcher releases its own claim and stops.
- **TRK-08** READING is free and unlimited; OWNING (removal) is singular.
- **TRK-09** `owner=human` never means a human edits labels — a `watch=` job observes the human act.
- **TRK-10** `MAX_CLAIMS_PER_OWNER` — an owner holding many claims has re-accumulated the lifecycle.
- **TRK-11** `labels-contract.test`: every label has a row and every row a live label · a
  model-spending owner declares a real `pre` · `pre` gates exist in the named module · `owner=human`
  ⇒ a real `watch=` job · `owner=human` ⇒ `escalates` + `after` · no owner over the claim cap.
- **TRK-12** `confirm.ts` — the ONE sanctioned way a job publishes a fresh issue: one open thread per
  `(kind, key)`, deduped on a title marker, questions as unticked checkboxes, born in the human lane,
  filed best-effort, appending a second batch into the thread the first opened; caller supplies kind,
  four lines of prose, and a **stage**.
- **TRK-13** The test for the exception is not "is this important" — it is **"does this need a
  THREAD"**. Everything else files a backlog row.
- **TRK-14** `report.ts` — long-report filing that survives the body-size limit (a lost body is lost
  content: 106 candidates once existed only there).
- **TRK-15** `overflow.ts` — section splitting that keeps the machine-read lists in the body.

### 2.24 Integrations (`INT`)

- **INT-01** `mcp/client.ts` — direct JSON-RPC to the headless-mcp hub; replaces a spawned agent on
  every path whose agent only ever called ONE tool.
- **INT-02** **`Profile` is a PORT, and that is the whole authorization model** — read and write tool
  sets are two ports sharing one bearer token; asking the read port for a write tool is *no such
  tool*, not a permission error.
- **INT-03** `McpError` kinds `config | auth | transport | rpc | tool`; only `transport` is retried.
- **INT-04** A `tool`-kind *no such tool* usually means a DISCONNECTED backend, not a typo.
- **INT-05** Why the agent went, kept as the measurement: cheap tiers failed to LOAD a deferred MCP
  tool at all (23/30 and 30/30 lost posts vs 0.73% over 274); latency tens of seconds → ~450 ms;
  per-message cost → zero. Measure ≥30 before believing any such change.
- **INT-06** Slack fetch: search + read-thread over the hub, two tool formats with disagreeing field
  spellings accepted, a `formatDrift` detector, `_FAIL_STREAK` debounce (`sweep-flap` at `info`
  below it, `0`/`1` both mean alert-on-every-failure), cursor untouched on failure.
- **INT-07** Three Slack cursor marks (`cursor_ts`, `sweep_top`, `backfill_before`) — the watermark
  advances only once a sweep reaches the bottom (search is newest-first and page-capped).
- **INT-08** `response_format: "detailed"` is load-bearing — without it attachment links flatten and
  thread-parent → PR resolution silently stops.
- **INT-09** The Slack parent join is on `(channel, ts)` and NOT on `kind`.
- **INT-10** Slack notify: one shared outbound function, the write profile, `SLACK_NOTIFY=0`,
  `SLACK_CHANNEL` (user id = DM); a non-`sent` outcome is emitted at `error` by the notify path
  itself; `send-failed` vs `run-failed` are different faults.
- **INT-11** Jira post: the one write path, `toCommonMark` byte-level conversion, shared by the job
  and the broker relay.
- **INT-12** Jira fetch: cursor + three JQL searches, projection inside `fetch()`, cursor committed
  last; `JIRA_SITE_URL` retargets every emitted browse URL (asserted by test).
- **INT-13** Notion: trigger is a **state diff**, not a timestamp (no "changed since X" query exists).
- **INT-14** GitHub: `gh` CLI + GraphQL where REST cannot express resolution state; the entry point
  exists because a poll cannot see a PR that lives three minutes (four measured losses).
- **INT-15** ClickStack query: ONE read path shared by host jobs and the broker relay; `validate`
  guards what reaches the cluster; loopback-forward transport with an explicit `servername`.
- **INT-16** Headless DB MCP: non-prod service databases (Postgres + Redis) on the dev instance;
  prod + sandbox ClickHouse on its own instance, `readonly=1` enforced per query.
- **INT-17** No prod Postgres/Redis by design — prod is read as TELEMETRY, never by handing a worker
  a prod database credential.
- **INT-18** Herdr session domain: typed CLI transport (`.result` JSON, `agent read` is the raw-text
  exception), spawn/find/close resolved through a `session_key` token rather than a truncated name,
  one-turn prompt (gate → prompt → read payload file → compact), reap decisions pure.

### 2.25 Distribution — LXC → Docker (`DKR`)

Every LXD concept from `fleet.sh` mapped. Behaviour is the acceptance criterion; the mechanism changes.

- **DKR-01** Roles unchanged: `standalone` (default) · `scheduler` · `worker`.
- **DKR-02** Golden LXD image → **Dockerfile** (node, agent CLI, `gh`, ripgrep, git, session server).
  One image per agent CLI, not one carrying both (`FLEET_AGENT`: claude | opencode | …).
- **DKR-03** `lxc launch` clones → `docker compose up --scale worker=N` (+ a `fleet` CLI wrapper).
- **DKR-04** One tree, not N checkouts: the workspace bind-mounted **read-write** into every worker,
  so `sha256(config)` is equal by construction. Docker bind mount replaces the `ws` device.
- **DKR-05** uid alignment: LXD `shift=true` (1000↔1000) → Docker `--user`/build-arg UID/GID so a
  file a worker writes is owned by the host user on both sides.
- **DKR-06** Same absolute path inside and outside, derived from `$HOME`, so no path is ever
  translated (worktree paths, trust-seed keys, paths handed to an agent in a prompt).
- **DKR-07** Broker socket lives **inside** the mounted tree — no separate socket device/volume.
- **DKR-08** Only the scheduler opens SQLite; workers never touch the files. No cross-container
  permission or WAL question.
- **DKR-09** Credential persistence: per-worker host dir bind-mounted at the agent config dir so the
  OAuth token survives a rebuild; one manual login per worker, not per boot.
- **DKR-10** Worker settings seeded (merged, never overwritten) to disable account-synced cloud
  connectors — they cannot be suppressed by removing a definition, and an unauthenticated one
  reports the capability unavailable instead of using the hub that works.
- **DKR-11** Trust seed: mark the workspace trusted in the agent's config, or a headless worker is
  silently denied on the first tool call.
- **DKR-12** `security.nesting=true` → Docker-in-Docker (or a mounted socket) so a write-job can run
  its `bypassPermissions` agent in an inner container.
- **DKR-13** Hub access: LXD `proxy` device at `127.0.0.1:9797` → a Docker **network** to the
  `headless-mcp` service, READ profile only. The write profile stays unreachable from a worker.
- **DKR-14** Headless DB access likewise on the compose network: dev instance (Postgres + Redis) and
  the ClickHouse instance.
- **DKR-15** **No device/route for any other internal HTTP service.** Two proxies that once allowed a
  whole internal domain were removed; a worker that needs telemetry asks the broker. Grant a route
  only for something a worker must reach DIRECTLY, and expect to justify why the broker cannot carry it.
- **DKR-16** Per-worker env: role, workspace root, state dir, broker socket, agent OAuth token.
- **DKR-17** ssh into a worker (LXD) → `docker exec` / `compose exec`; the remote-drive seam for the
  session server keeps working.
- **DKR-18** `fleet` CLI verbs preserved: `build` · `add` · `token` · `serve` · `list` · `shell` ·
  `rm` (+ `logs`, `status`).
- **DKR-19** Version consistency: the one-tree mount makes drift structurally impossible; the `hello`
  handshake stays as the backstop for a worker PROCESS still running old code after the tree changed.
- **DKR-20** Identity split preserved: agent compute per-user; engine code one shared tree; context
  reads on the worker; every outward WRITE under one scheduler identity.
- **DKR-21** Single-host by design; spanning hosts is the only thing needing a networked store.
- **DKR-22** Compose reuses the reference stack shape: `headless-mcp`, `db-headless-mcp-<env>`,
  `db-headless-mcp-ch`, tunnel/proxy sidecars, named volumes, loopback-only published ports.

### 2.26 Contracts / drift gates (`TST`)

The convention: *a claim derivable from the source is checked against the source.* Shipped as
`kernel/contracts` so a host repo gets them by calling one function.

- **TST-01** `contractTests(kernel, opts)` — graph boots · every route a source can emit is claimed ·
  every scheduled entry's gate resources exist.
- **TST-02** `assertDocumented` — the prose lists a plugin contributes to are DERIVED; a new plugin
  names itself in the docs or fails.
- **TST-03** `assertNoDeepImports` — core may not name a plugin module; a plugin may not name another
  plugin's internals or reach past `kernel/ports`.
- **TST-04** Layout: which directories carry a barrel and which are imported by path.
- **TST-05** Every relative module specifier points at a file that exists.
- **TST-06** Docs↔code counts: entry counts, knob paragraphs, the step registry, the module map, the
  `validate()` check list.
- **TST-07** ~250 backticked env knobs in the docs must EXIST in code.
- **TST-08** Every agent run names its model.
- **TST-09** Every job file and schedule entry carries a known stage prefix.
- **TST-10** Label vocabulary + the claim contract (TRK-11); the ABSENCE of a retired filter is pinned
  too — a queue silently shortened reads as "there is less to do".
- **TST-11** Source registry holds every adapter in its directory, exactly once.
- **TST-12** Every route has exactly one mode; no bot id can appear in a prompt; pipeline invariants.
- **TST-13** Every `ItemStatus` is ruled on by the negative-filter query; every column projected or
  excluded on purpose.
- **TST-14** Retro: registry uniqueness, window contract, no unclaimed `logger()` literal.
- **TST-15** Croner-vs-POSIX parity; gate-wait derivation; ordering between jobs; the refresh-window
  allowlist plus a minute-for-minute walk of the window definition.
- **TST-16** Crontab managed-block mechanics (the only code that rewrites a real crontab).
- **TST-17** Gate contract; lease primitive; reaper guards; queue claim/settle; broker over a real
  socket (exactly-once claim, TTL reclaim, lease dedup, dispatch round-trip, quota breaker, fallback,
  handshake refusal); worker loop with a fake handler — **no agent CLI needed**.
- **TST-18** Log: both emitters agree; render↔parse round-trip; the tail cursor; the real dead-child
  fixture.
- **TST-19** Per-job pure decisions pinned directly (eligibility, verdict parsing, gates, selection),
  with fixtures lifted from REAL data, never invented.
- **TST-20** Suites share one database — settle what you seed (two documented traps).
- **TST-21** `typecheck` as `pretest`; tests remain the type check for what typecheck excludes.
- **TST-22** No linter, no bundler, no build step **in a host repo** — TS runs directly. Whether the
  published package needs one is §5 Q5; the answer never reaches a consumer either way.
- **TST-23** `skills check` — the rendered `.claude/skills/` matches its plugin-owned source under
  the managed markers, byte for byte. Drift FAILS the build; it is never silently re-rendered.
- **TST-24** SKL-06 both ways (no job without a skill, no skill without a job) plus SKL-07: no
  `SKILL.md` carries a guard matrix, an eligibility rule, or an authorization token that code owns.
  An output vocabulary a skill must emit (like `nightly-sandcastle`'s `outcome=`) is not banned by
  this row — only a value that would widen what the run is PERMITTED to do is (§2.30 SKL-07).
- **TST-25** **No phantom dependencies** — every PACKAGE specifier in a workspace resolves to a
  declared dependency OF THAT WORKSPACE. TST-05 pins relative specifiers and cannot see this one:
  hoisting makes an undeclared import resolve locally and fail only for a consumer, which is the
  monorepo failure that reaches users first and the repo last. Its sibling: no workspace names
  another workspace's `dist/` or `src/` by path (ADO-03 is the only door).

### 2.27 Ops knobs (`KNB`)

Every knob in the reference, to be re-homed as `EnvSpec` rows on the owning plugin (KRN-06).

- **Core/paths**: `INSTANCE`, `XENITH_ROOT`(→`ENGINE_ROOT`), `XENITH_TRACKER`(→`ENGINE_TRACKER`),
  `ENGINE_ROLE`, `ENGINE_VERSION`, `ENGINE_STATE_DIR`, `BROKER_SOCK`, `<NAME>_DB`,
  `SQLITE_BUSY_TIMEOUT_MS`, `SUPERVISOR_MAX_RUN_MIN`, `LOG_LEVEL`, `EXEC_TIMEOUT_MS`,
  `GATE_WAIT_CAP_S`, `SUPERVISOR_KILL_GRACE_MS`, `SUPERVISOR_SPAWN_STAGGER_MS`,
  `SUPERVISOR_DRAIN_MS`, `LOCK_STARVE_N`, `LOCK_STARVE_N_<JOB>`, `CRONTAB_CMD`, `CRONTAB_DRY_RUN`,
  `SKILLS_DRY_RUN`.
- **Harness (`kernel/ports/runner.ts`, N3)**: `RUN_TIMEOUT_MS` (unread at N3 — the only job is
  `taskClass: impl`), `RUN_TIMEOUT_IMPL_MS` (HRN-13's one consumer, the abort deadline for an
  impl-shaped run).
- **Switch/pipeline**: `SWITCH_MAX_BATCH`, `SWITCH_DRY_RUN`, `INTENT_MODEL`, `STEP_CAP_ROUTE`,
  `STEP_CAP_WATCH`, `STEP_CAP_BRIEF`, `STEP_CAP_DEFAULT`, `BACKLOG_DB`.
- **Brief**: `BRIEF_MODE`, `BRIEF_CAP`, `BRIEF_READ_CAP`, `BRIEF_DRY_RUN`, `SLACK_WEEKLY_DRY_RUN`.
- **Health**: `SWITCH_STALE_H`, `SLACK_FETCH_STALE_H`, `BACKLOG_STUCK_H`, `BACKLOG_UNKNOWN_MAX`,
  `BACKLOG_UNTRIAGED_AGE_H`, `BACKLOG_BREACH_COOLDOWN_H`, `BACKLOG_OK_EVERY_H`, `BACKLOG_DLQ_MAX`,
  `BACKLOG_DARK_H`, `BACKLOG_HEALTH_DRY_RUN`, `LOG_REPORT_STALE_M`.
- **Log report**: `LOG_REPORT_COOLDOWN_M`, `LOG_REPORT_MAX_KEYS`, `LOG_MAX_BYTES`,
  `LOG_MAX_READ_BYTES`, `LOG_REPORT_DRY_RUN`, `LOG_DB`.
- **Slack**: `SLACK_NOTIFY`, `SLACK_CHANNEL`, `SLACK_DB`, `SLACK_FETCH_LIMIT`,
  `SLACK_FETCH_MAX_PAGES`, `_MAX_THREADS`, `_THREAD_REPLIES`, `_COLD_START_MIN`,
  `SLACK_FETCH_FAIL_STREAK`, `SLACK_FETCH_DRY_RUN`, `FETCH_NOTIFICATION_DRY_RUN`.
- **Jira source**: `JIRA_SITE_URL`, `JIRA_FETCH_LIMIT`, `JIRA_COLD_START_DAYS`, `JIRA_DRY_RUN`.
- **GitHub/Notion sources**: `GITHUB_MAX_PAGES`, `GITHUB_DRY_RUN`, `NOTION_DRY_RUN`.
- **watch-pr-review**: `PR_DISCOVER`, `PR_REVIEW_MAX`, `PR_REVIEW_NO_COMMENT`,
  `PR_REVIEW_MIN_SEVERITY`, `PR_REVIEW_MODEL`, `PR_REVIEW_BACKLOG_MAX`, `PR_REVIEW_BACKLOG_SCAN`,
  `PR_REVIEW_LEASE_TTL_MIN`, `PR_REVIEW_LEASE_MAX_ATTEMPTS`, `PR_REVIEW_SLACK_APPROVABLE`,
  `PR_REVIEW_BIBLE_CHAIN`, `PR_REVIEW_BIBLE_MAX`, `PR_REVIEW_BIBLE_DRY_RUN`, `PR_WATCH_MODEL`,
  `PR_WATCH_MAX_REREVIEWS`, `PR_WATCH_MAX_PER_PR`, `PR_WATCH_MAX_FAILS`, `PR_WATCH_QUIET_MIN`,
  `PR_WATCH_NO_COMMENT`, `PR_WATCH_SESSION`.
- **watch-pr-feedback**: `PR_FEEDBACK_MIN_SEVERITY`, `_INCLUDE_OUTDATED`, `_MAX_PER_PR`, `_MAX_PRS`,
  `_CONCURRENCY`, `_CHILD_TIMEOUT_MS`, `_SWEEP_SINCE`, `_OWNER`, `_DRY_RUN`, `_ONLY`.
- **watch-pr-fix**: `PR_FIX_MAX`, `_MAX_PER_PR`, `_MAX_ATTEMPTS`, `_QUIET_MIN`, `_CI_TIMEOUT_M`,
  `_POLL_S`, `_LEASE_TTL_MIN`, `_MODEL`, `_DRY_RUN`, `_NO_PUSH`.
- **watch-bug-digest**: `BUG_DIGEST_MIN_SEVERITY`, `_LIMIT`, `_CONCURRENCY`, `_SPAWN_STAGGER_MS`,
  `_GROUP_MODEL`, `_REPRO_MODEL`, `_STATE`, `_DRY_RUN`.
- **watch-jira**: `JIRA_WATCH_IDLE_H`, `_MAX`, `_IMPL_MAX`, `_MAX_ATTEMPTS`, `_STATUSES`,
  `_EXCLUDE_TYPES`, `_DONE_STATUSES`, `_IMPL_STATUS`, `_STAGE2`, `_REVIEW_ROUNDS`, `_CI_TIMEOUT_M`,
  `_CI_POLL_S`, `_MODEL`, `_IMPL_MODEL`, `_FABLE_MODEL`, `_ENV`, `_FOREIGN_H`, `_FOREIGN_ROUTE`,
  `_NO_CONFIRM`, `_NO_MOOT_SWEEP`, `_DRY_RUN`.
- **todo-triage**: `TODO_TRIAGE_CONCURRENCY`, `_MAX`, `_TICK_BUDGET_MIN`, `_MAX_ATTEMPTS`,
  `_TTL_MIN`, `_MODEL`, `_DRY_RUN`, `_NO_LABEL`.
- **todo-exec**: `TODO_EXEC_CONCURRENCY`, `_MAX`, `_TICK_BUDGET_MIN`, `_MAX_PASSES`, `_MAX_ATTEMPTS`,
  `_TTL_MIN`, `_MODEL`, `_DRY_RUN`.
- **todo-human-close**: `_SELECT_LIMIT`, `_CONCURRENCY`, `_MAX`, `_TTL_MIN`, `_MAX_ATTEMPTS`,
  `_SPAWN_STAGGER_MS`, `_MODEL`, `_DRY_RUN`, `_NO_CLOSE`, `_NO_CARRY`, `_NO_SELF_SETTLE`,
  `_NO_AGING`, `_AGING_ESCALATE_DAYS`, `_AGING_PROPOSE_DAYS`, `_AGING_MAX`.
- **todo-relevance / decision-watch / claim-reap**: `RELEVANCE_MAX`, `CLAIM_REAP_MAX`,
  `CLAIM_REAP_DRY_RUN`.
- **Sessions**: `SESSION_MAX_AGE_H`, `SESSION_MAX_IDLE_H`, `SESSION_MAX_LIVE`, `SESSION_REAP_DRY`,
  `REVIEW_MAX`, `MAX_AGE_DAYS`.
- **Corpus**: `CHECKLIST_SINCE`, `_RCA_SINCE`, `_UNTIL`, `_STATE`, `_MAX_REPOS`, `_RCA_LIMIT`,
  `_RCA_CONCURRENCY`, `_SPAWN_STAGGER_MS`, `_MAX_NEW_ITEMS`, `_MAX_BROADEN`, `_ZERO_HIT_RUNS`,
  `_MISS_ESCALATE`, `_MODEL`, `CHECKLIST_REFRESH_DRY_RUN`, `CORPUS_LINT_DRY_RUN`,
  `CORPUS_LINT_NO_PUSH`, `REFRESH_DOCS_MODEL`.
- **Nightly**: `NIGHTLY_MODEL`, `NIGHTLY_DRY_RUN`, `NIGHTLY_SANDCASTLE_MODEL`,
  `NIGHTLY_SANDCASTLE_DRY_RUN`.
- **Retro**: `RETRO_SINCE`, `RETRO_UNTIL`, `RETRO_DRY_RUN`, `RETRO_LANE_LIMIT`, `RETRO_LANES`,
  `RETRO_LANE_CONCURRENCY`, `RETRO_PR_LIMIT`, `RETRO_MODEL`, `RETRO_SPAWN_STAGGER_MS`,
  `RETRO_GITHUB_LOGIN`.
- **Quota/shed**: `QUOTA_SCOPE`, `QUOTA_PAUSE_MS`, `QUOTA_PAUSE_MS_<CLASS>` ×7, `QUOTA_DARK_GAP_MS`,
  `QUOTA_SHED_WINDOW_MS`.
- **Dispatch/fleet**: `DISPATCH_TIMEOUT_MS`, `DISPATCH_TIMEOUT_IMPL_MS`, `DISPATCH_PICKUP_MS`,
  `DISPATCH_FALLBACK`, `WORKER_POLL_MS`, `FLEET_AGENT`, `FLEET_IMAGE`, `FLEET_SSH_KEY`, `TOKEN_DIR`,
  `GUEST_ROOT`, `GUEST_HOME`, `CLAUDE_CODE_OAUTH_TOKEN`.
- **Git ops**: `RESET_FORCE_DIRTY`, `RESET_FORCE_AHEAD`, `RESET_CHECKOUT_MAIN`,
  `RESET_ENSURE_WORKTREES`, `RESET_DRY_RUN`, `RECUT_BRANCHES`, `RECUT_FORCE`, `RECUT_DRY_RUN`.
- **Retention**: `RETENTION_QUEUE_DAYS`, `RETENTION_LEASE_DAYS`, `RETENTION_DRY_RUN`.
- **Watchdog**: `WATCHDOG_STALE_M`, `WATCHDOG_SUPERVISOR_STALE_M`, `WATCHDOG_COOLDOWN_M`.

### 2.28 Safe-run surface (`SAF`)

Every write path is env-gated so any job can be exercised without touching the outside world.

- **SAF-01** Per-job `*_DRY_RUN` (inert: no writes, no step attempts, no watermark movement).
- **SAF-02** Per-job shadow modes (`*_NO_COMMENT`, `*_NO_LABEL`, `*_NO_CLOSE`, `*_NO_PUSH`) — classify
  for real, print every verdict, write nothing.
- **SAF-03** Per-job `*_MAX=1` — one real unit end to end against live data.
- **SAF-04** Per-job `*_MAX=0` / `*_LIMIT=0` — the free smoke test: everything but the model calls.
- **SAF-05** Throwaway DB redirection (`<NAME>_DB=/tmp/x.db`) and throwaway state files.
- **SAF-06** Child/single-item modes (`*_ONLY='{…}'`).
- **SAF-07** The one non-free dry run must be documented as such (JOB-J13) — audit for others.
- **SAF-08** The safe-run table itself is documentation and stays in the docs.

### 2.29 Invariants to carry over verbatim (`INV`)

1. The tracker (or the declared state store) is the state store — no local state file.
2. Workers never write, except where the work IS the write — and the tracker write never crosses.
3. Review posting is conservative in WHAT, not in HOW MUCH; nothing here approves.
4. One log line shape, and severity is SET rather than inferred.
5. A stage that re-reads a row calls `takeStep`, and counts only what it ATTEMPTED.
6. One gate, two levels: the gate orders jobs, leases order items.
7. A pause label is one label read by three moving parts.
8. The lane assigner applies the authorization, so it degrades toward the safe lane on every
   unreadable input.
9. Every label has exactly ONE definition and no two share a name; hiding work needs a
   machine-observable unblock condition.
10. A quota `scope` is one ACCOUNT, and a wall costs the item nothing.
11. Follow-up work re-enters the BACKLOG; the one exception is a question, through one module, and
    every filing NAMES ITS STAGE.
12. Every judgement gets GRADED, and the grade is read back weekly.

Plus the pipeline's eight: a route is a label · `handled` means left the backlog · every route has
one mode · reconcile before render · the unit of work is a conversation · bias to not-closing ·
every step counts its own attempts and every step has a cap · the DLQ is reported, never silent.

---

### 2.30 Skills as the prompt mechanism (`SKL`)

A prompt is not a string in a job file. It is a **skill**: a directory the plugin owns, run by an
unattended pass and by a human at a terminal, under ONE name.

- **SKL-01** `defineJob({ skill })` — the skill name IS the job name, so the schedule entry, the
  unattended run and the human's `/<name>` are one identifier. SUP-20 already fixes the vocabulary
  and TST-09 already gates it, so skills inherit the stage prefixes for free.
- **SKL-02** ONE skill per JOB, never per plugin. `corpus` contributes `corpus-refresh`,
  `corpus-checklist` and `corpus-lint` — not one `/corpus` with a mode argument. D7: the unit of
  extension is a unit of WORK, and a mode argument is a conversation loop wearing a hat.
- **SKL-03** The plugin owns the file: `plugins/<x>/skills/<job>/SKILL.md`. A manifest that declares
  a job whose prompt lives somewhere else is exactly the KRN-04 lie TST-02 exists to catch.
- **SKL-04** `.claude/skills/` is RENDERED from the manifests, never hand-edited — the same
  managed-block contract as the crontab (SUP-08): `skills render` · `sync` · `check`, managed
  markers, foreign entries untouched, duplicate detection refuses a plain splice. The scope is
  PROJECT-level and nothing else: never `~/.claude/skills/`, which is shared across checkouts and
  contradicts INS-02, and never an agent-CLI plugin namespace, whose `plugin:skill` prefix would
  break SKL-01's one identifier. `plugins/<x>/` is the ENGINE's plugin concept, not the CLI's — it
  owns the source file (SKL-03) and contributes nothing the CLI discovers on its own.
- **SKL-05** Code declares; the filesystem is only ever CHECKED against it. A directory scan never
  determines what EXISTS — that is how KRN-02 survives contact with a tool whose native discovery
  mechanism is a directory scan.
- **SKL-06** The gate runs both ways: every `job.skill` resolves to a real directory, and every
  skill directory is named by a registered job. An orphan skill is a prompt nothing runs.
- **SKL-07** What may NOT move into a skill: guard matrices, verdict parsing, eligibility, and every
  authorization decision. JOB-T03 states the rule already — `agent` is reachable only from a literal
  token, *enforced in `parseVerdict`, not asked for in the prompt*. A skill is markdown a human
  edits; a grant that lives in markdown is a grant anyone can widen in a text editor. The boundary,
  drawn at §5 Q0: an **output vocabulary** (a report format the skill must EMIT — it changes what the
  caller LEARNS, and nothing is granted by naming it) is allowed; an **authorization token** (a value
  that WIDENS what the run is PERMITTED to do) is not, and must never appear in markdown. The landed
  `nightly-sandcastle` skill's `outcome=<changed|none|too-large|suite-failed>` is an output
  vocabulary, not a violation — `agent` in JOB-T03 is the authorization token this row bans.
- **SKL-08** A skill's only inputs are `promptArgs` (PRT-05). `SKILL.md` never reads the
  environment, and never names a path into its own directory (HRN-16) — a skill that can be
  refactored by moving a file is not a unit.
- **SKL-09** The free safe-run surface: the file a job runs unattended is the file a human runs at
  `/<name>` to see what it would do. It does NOT replace `*_DRY_RUN` (SAF-01) — the env gate governs
  the WRITE, the skill governs the PROCEDURE, and only the pair is a safe run.
- **SKL-10** `sync` PRUNES, and the crontab precedent does not survive the port: SUP-08's "foreign
  lines untouched" works because a crontab is ONE file with a delimited block, and `.claude/skills/`
  is a directory TREE with nowhere to put a marker. So ownership must be decidable from the
  filesystem alone. **Not a ledger** — §5 Q0 settles it: the rendered file itself carries the
  ownership token, a managed marker in the body matching
  `^<!-- managed:doppelganger-skills v=(\d+) src=(\S+) -->$`, so the filesystem answers "did we
  create this?" with no second store to keep in sync. Given that: an entry whose marker matches is
  OURS; anything else (no `SKILL.md`, or one without that line) is FOREIGN and never touched, never
  overwritten, never counted as drift. `check` reports six findings: **missing** (a registered job
  with no rendered file), **drift** (the bytes differ from `render(source)`), **orphan** (an OURS
  entry not named by a registered job), **collision** (a FOREIGN entry occupying a registered job's
  name), **stray** (an OURS directory holding anything but `SKILL.md`), **source-missing** (a
  registered job whose plugin-owned source file, `plugins/<x>/skills/<name>/SKILL.md`, is gone).
  The sixth exists because the first five do not cover a missing SOURCE — without it, `check` would
  report `missing` and `sync` would then throw a raw `ENOENT` reading a file that is not there
  (J3.7). `sync` REMOVES an orphan and REFUSES a stray, a collision or a source-missing rather than
  guessing. SKL-06 only DETECTS the orphan — without this row, deleting a job leaves a red build and
  a manual `rm`, which is housekeeping the tool declined to do.

---

### 2.31 Instance identity (`INS`)

Nothing stops a second checkout of a host app from running the same engine on the same box, and most
of what the engine writes is already project-relative. These rows name the few things that are not.

- **INS-01** ONE `INSTANCE` name per checkout, defaulting to the project directory's basename,
  validated at boot as a bare identifier — it is interpolated into crontab text, an owner string and
  container names, so KRN-09 checks it for the same reason DBS-03 guards `ns`. It is the only thing
  that distinguishes two copies of the engine on one host.
- **INS-02** Every write is either **project-relative** or **`INSTANCE`-discriminated**, and there is
  no third category. Project-relative: `<NAME>_DB` defaults resolve inside the checkout (DBS-01),
  `.claude/skills/` is repo-relative (SKL-04, and therefore SKL-10 can never prune another
  instance's skills). Discriminated: crontab markers (INS-03), lease owner (INS-04), queue rows
  (QUE), container and volume names (DKR-05/06). A new write path states which it is.
- **INS-03** The crontab is the one unavoidably shared resource — one file, one user, no way to make
  it project-relative. Markers carry the instance; a `sync` never reads or writes another instance's
  block, and SUP-08's duplicate detection is scoped per instance so two checkouts splice side by side
  instead of clobbering. An unnamed marker pair is an unmigrated block: `check` fails on it,
  `sync --adopt` claims it.
- **INS-04** Lease owner (LSE-06) leads with the instance. Without it, `lease-clear` (LSE-10) shows a
  `held` claim with no way to tell which checkout owns it, while LSE-07's reap guards correctly
  refuse to touch it — a stuck key no operator can safely attribute.
- **INS-05** **Non-goal, declared so it is declined rather than discovered:** two instances never
  coordinate. The gate is in-memory and per-process (GAT-01), so two supervisors hold two gates with
  NO mutual exclusion between them, and the silence is the hazard — you learn it from corruption,
  not from an error. This is sound only while every named gate resource lives inside its own
  checkout. A resource genuinely shared across instances is not a gate problem, it is a lease
  (LSE-01), and moving it is a design change and not a config change. §5 Q1 must not answer with a
  machine-wide resource.
- **INS-06** Corollary, free: `INSTANCE` is the cheapest isolation for a real smoke test. A second
  checkout under its own name gets its own DB files, its own crontab block and its own leases, so
  SAF's env gates can be exercised end to end without a path into the live instance's state.

---

### 2.32 Distribution & adoption (`ADO`)

D12: the engine is published, a host is a separate repo that depends on it. Four deployments exist
so that four sets of rules can differ (that is the reason for N hosts, not an accident of them), and
they all take an engine fix from one version bump.

- **ADO-01** One repository, many packages, **ONE version number** — `@doppelganger/kernel` and
  every `@doppelganger/plugin-*` release as a set. There is no supported combination in which two
  of them differ.
- **ADO-02** `boot()` refuses a plugin whose version is not EQUAL to the kernel's; `dev` is
  unenforced. This is QUE-08's `hello` handshake pointed at plugins instead of workers, and it is
  what keeps §0's rejected *plugin↔kernel compatibility surface* rejected: separate packages make
  skew expressible, so an equality check refuses it. A matrix is the thing being avoided; a scalar
  is not a matrix.
- **ADO-03** The published surface: **`ports` · `db` · `log` public; `gate` · `queue` · `shed` ·
  `registry` internal.** A plugin owns its own SQLite file and migrations (DBS-01/02) and emits log
  lines (LOG-01), so `ports` alone cannot express one — §0's real rule is *published entry points,
  never core internals*, and the `exports` map is now the mechanism. TST-03 stays as the backstop
  for IN-TREE plugins, where there is no package boundary to do it for you.
- **ADO-04** `init` — scaffolds a host repo: `package.json` with the set pinned at one version,
  `host/plugins.ts` carrying real imports and a real `boot([...])`, the rendered `.claude/skills/`,
  and `.env.example` derived from the `EnvSpec` rows (KRN-06).
- **ADO-05** `add <plugin>` — installs it at the kernel's EXACT version and appends the import plus
  the registration line. The version is never chosen by a human, which is how ADO-01 stays true in
  practice rather than only in policy.
- **ADO-06** `new plugin <name>` — scaffolds an in-tree plugin under `plugins/`, byte-identical in
  shape to a published one.
- **ADO-07** `update` — bumps the whole set or nothing.
- **ADO-08** Every generator discovers at **scaffold** time and writes CODE; nothing scans at boot.
  KRN-02 and D8 survive intact because the scan happens when a human runs a command, and its output
  is a diff in git rather than a fact known only at runtime.
- **ADO-09** FOUR render targets, ONE verb family — crontab (SUP-08) · skills (SKL-04) ·
  registration (ADO-04/05) · `.env.example` (KRN-06), each `render` / `sync` / `check` with managed
  ownership and drift failing the build. A fifth target adopts this contract or it does not ship.
- **ADO-10** A custom plugin is identical in-tree and published; only the import specifier differs.
  Nothing in the manifest, the skills layout or the boot checks knows which it is.
- **ADO-11** `init` is the only supported install path. A hand-written `package.json` can express a
  skew, and ADO-02 will refuse it at boot — documented, not prevented, because preventing it means
  the compatibility surface again.
- **ADO-12** Per-deployment isolation is INS's problem, not this section's: N hosts on one box are
  N instances (INS-01), and every ADO generator writes through the instance discriminator rather
  than beside it.
- **ADO-13** Each plugin is its OWN package (§5 Q6, decided). The kernel package therefore contains
  zero plugins — D1 restated as a publish artifact rather than only as a test.
- **ADO-14** **npm workspaces, no orchestrator.** `{"private": true, "workspaces": ["kernel",
  "plugins/*", "cli"]}` — globs take §1's layout as it stands, so nothing moves into a `packages/`
  directory. Turbo/Nx/Lerna are each a dependency plus a build graph this repo has no use for; the
  argument is the same one that picked `node --test` over a framework and `node:sqlite` over a
  driver. `host/` is deliberately NOT a workspace — it is the reference host and is never published.
- **ADO-15** Build and publish: per package `tsc -p tsconfig.build.json` → `dist/` with
  `declaration: true`, `files: ["dist"]`, `exports` pointing at `dist` (ADO-03 decides the shape of
  that map). Internal deps are pinned EXACT. `npm version <x> --workspaces` then
  `npm publish --workspaces` IS ADO-01's lockstep — there is no release tool and no changeset file.
- **ADO-16** **Corrected by §5 Q5's measurement (Node `22.23.1`, `2026-08-25`).** The premise this
  row used to state — "a workspace link resolves through `node_modules`, so whatever §5 Q5 answers
  for a consumer it answers for this repo's own test run" — is **false** on the target Node: a
  workspace link is a symlink, and Node resolves it to its real path (outside `node_modules`) before
  deciding whether to strip types. The build lands at **publish** (ADO-15) and at any point a
  package is consumed by copy rather than by link; `pretest` is `typecheck` alone while every
  internal edge in this repo is a workspace symlink. TST-22's narrowing to "no build step in a HOST
  repo" stays load-bearing — that is still the real conclusion this row protects. Trip-wire: if this
  repo ever consumes a workspace by copy instead of by link, `pretest` gains `&& npm run build` that
  day.
- **ADO-17** The contract suite has TWO homes: shipped in `kernel/contracts` for a consumer to call
  (TST-01), and invoked at the repo ROOT across every workspace for the engine itself — because
  `assertNoDeepImports` and "boot the whole graph" are repo-wide by nature and cannot be run from
  inside one package.

---

## 3. Build order

**v0 is N0–N5.** The order changed on 2026-08-25: build the **self-running loop first**, the plugin
seam second. The evidence is §4.1. Nothing is dropped and every ID is kept — §3.2 maps the old
M-numbers so a commit or comment citing `M2` still resolves.

### 3.0 The loop's measured surface

Traced transitively from `supervisor.ts`, `sandcastle.ts`, `jobs/nightly-sandcastle.ts` and
`cron/schedule.ts` in the reference: **19 files, 4,517 lines — 8% of the engine's about 57,000**
(measured 2026-08-25 — approximate; `4517 / 57000 = 7.9%`, rounds to 8% — the two numbers move
together).

| Lines | Reference file | IDs |
|---|---|---|
| 1207 | `cron/schedule.ts` | SUP-01…21 — 69% prose (178 comment + ~657 `why:` lines); MVP needs ~1 entry, so **~120 lines** |
| 660 | `src/jobs/nightly-sandcastle.ts` | JOB-C15 |
| 543 | `src/supervisor.ts` | SUP |
| 343 | `cron/lib.ts` | SUP-08, refresh window, gate wait |
| 290 | `src/sandcastle.ts` | HRN-01…02, HRN-10…11 |
| 221 | `src/lib/rwlock.ts` | GAT-01…09 — **required**, §4.2 |
| 211 | `src/lib/quota.ts` | QTA — **required**, §4.2 |
| 206 | `src/lib/db.ts` | DBS |
| 442 | `src/lib/log/*` (4 files) | LOG |
| 97 | `src/lib/shed.ts` | QTA — **required**, §4.2 |
| 74 · 68 · 68 · 65 · 59 · 31 | `config` · `exec` · `log/parse` · `pool` · `stages` · `time` | KRN-06, HRN-18/19, SUP-20 |

Tests for the same closure are ~3,400 lines, near 1:1 with the code. 475 of those are doc-gates that
D17 drops. **MVP ≈ 3,100 lines of code + ~2,900 lines of test, ported and re-layered — not invented.**

There is no `supervisor.test.ts` in the reference; the supervisor is covered by `cron/*.test.ts`
(order, croner parity, gate-wait, validate). Copy that shape, minus the three `docs-*` files.

### N0 — Ground truth · **2 days**
Repo layout (§1) · `package.json` (no bundler, no linter, direct-TS run) · `tsconfig` `noEmit` ·
`typecheck` as `pretest` · CI on `npm test` · this file kept current ·
`plugins/nightly/skills/nightly-sandcastle/` + its rendered `.claude/skills/` entry as the worked
example of SKL-03/04 · §5 Q0 settled — render, never symlink (2026-08-25).
**Ships:** D1–D19, TST-21, TST-22.

### N1 — The kernel the loop needs · **1.5–2 weeks**
`db.ts` · `log/` (emit, parse, tail, cause) · `config.ts` · `time.ts` · `exec.ts` · `pool.ts` ·
`stages.ts`.
**Ships:** DBS-*, LOG-*, KRN-06, SUP-20, HRN-18, HRN-19, INS-01…02, TST-18, TST-20.
**Gate:** log round-trip · both emitters agree · tail cursor · dead-child fixture · DB busy-context ·
the shared-database trap (TST-20).
**Not shipped, deliberately:** `registry.ts`, `plugin.ts`, `boot.ts`. The loop does not need the
plugin seam, and the seam is designed better once a second consumer exists to argue with it (D9).

### N2 — Supervisor and gate, no entry yet · **1 week**
`host/supervisor.ts` · schedule-as-data · `PROGRAMS` · `validate()` on every boot · one croner timer
per entry · refresh window · heartbeat · `gate.ts` · `--list` · the crontab bootstrap block.
**Ships:** SUP-01…18, GAT-01…10, INS-03, INS-05, TST-15, TST-16.
**Gate:** croner-vs-POSIX parity · gate-wait derivation · ordering between jobs · minute-for-minute
window walk · crontab managed-block mechanics.
**Cut by D17:** TST-06 (docs↔code counts), the `docs-counts` / `docs-nightly` / `validate-docs` suites.

### N3 — The harness and the pass · **1.5–2 weeks**
`ports/runner` + a sandcastle adapter · `DEFAULTS` · `defineJob`/`runJob` · `runLocal` · worktree
realization · `parseVerdict` for the `<<<SANDCASTLE` block · **the ship gate** (full suite + import
smoke + a dry run of every changed file with the DB redirected to a scratch dir) · `merge --ff-only`
with ff-miss rebase-retry recovery · goal rotation state · `OPUS_GUIDANCE` · the SKL mechanism with
its `render`/`sync`/`check` verbs.
**Ships:** HRN-01…02, HRN-07, HRN-10…19, SKL-01…10, JOB-C15, SAF-01…08, INS-06,
TST-08, TST-09, TST-19, TST-23, TST-24.
**Gate:** `npm test` green · `skills check` clean · every agent run names its model (TST-08) ·
one pass at `*_DRY_RUN` and one at `*_MAX=1`.
**Deferred:** HRN-03…06 (session runner) and dispatch → M9/M11, unchanged.

### N4 — Safe to leave alone · **1 week**
`quota.ts` breaker + classes · `shed.ts` value tiers · leases · watchdog + delivery stamp · log report.
**Ships:** QTA-01…10, LSE-01…12, INS-04, JOB-O09…12, TST-17 (lease + breaker half).
**Gate:** a walled account parks and recovers inside one window · a killed pass does not wedge the
next one · every reaper guard fails toward **not** reaping.

> **The loop is live and unattended here. N0–N4 ≈ 4.5–6 weeks.**

### N5 — The rest of v0: the framework claim · **3.5–4.5 weeks**
`registry.ts` · `plugin.ts` · `boot.ts` · `ports/job` · `ports/schedule` · `kernel/contracts` ·
then `plugins/git` (JOB-G01…14, deterministic, no model) · `plugins/ops` (JOB-O01…06) ·
`plugins/nightly` proper (JOB-C14 polish, JOB-C16 concurrency).
**Ships:** KRN-01…09, KRN-11, PRT-05, PRT-06, PRT-08, TST-01, TST-03, TST-04, TST-05, TST-25,
JOB-G01…14, JOB-O01…06, JOB-C14, JOB-C16.
**Not shipped, deliberately:** KRN-10 — with no routes there is no union to open. TST-02
(`assertDocumented`) has no subject under D17; see §4.3, this is the one cut with a real cost.
From N4 on the loop is running, so it maintains N1–N4's code while you build this.

**v0 stops here.** What it is: an unattended job runner with a plugin-shaped seam, three builtins,
and one name per unit of work. What it is NOT: a framework — that claim is unproven until a plugin
contributes a source and a route (§3.1). Name it the first thing, not the second.

## 3.1 Deferred to v1 — unchanged, every ID kept

Nothing below is dropped and nothing is re-scoped; these blocks are the v0 backlog. The only change
is that M5's reference plugin is now the SECOND plugin — `plugins/git` proved the seam, `jira` is
what proves the *pipeline* seam.

### M5 — Pipeline core + first source plugin
`backlog/` (store, states, attempts, stats) · steps + DLQ + operator surface · watchers · watcher
contract (`drain`/`revive`/`reroute`) · entry registry · intent classifier · `held` · `prlink` ·
`render` · `clone-detect` · `resolve`.
Then **`plugins/jira/`** as the reference plugin: source + relay + route + watcher + jobs +
schedule + env, one file answering "what does Jira contribute".
**Ships:** PIP-*, CLS-*, DLQ-*, JOB-S04, JOB-J01…13, TST-11…13.

### M6 — Tracker, labels, claims, reporting
Label vocabulary as data · the claim contract + its test · `confirm` · `report` · `overflow` ·
state markers.
**Ships:** TRK-01…15, TST-10.

### M7 — Remaining source plugins
slack · github · notion · tracker (+ each one's manual runner and dry run).
**Ships:** JOB-S01…03, INT-06…09, INT-12…14, PIP-14, PIP-20.

### M8 — Job families
brief/health/weekly/add/dlq · PR family (review, status, feedback, fix, bug-digest) · todo loop
(triage, exec, human-close, relevance, decision-watch, claim-reap, spawner, reaper, ls/attach,
space-backfill) · corpus (refresh, checklist, lint) · session runner.
**Ships:** JOB-B*, JOB-P*, JOB-T*, JOB-C01…13, HRN-03…06, INT-18, TST-19.
**Already shipped in v0:** JOB-G* (git ops) and JOB-C14…16 (the nightlies).

### M9 — Docker fleet
broker (protocol, server, client, handshake) · distributed queue · worker loop + generic handler ·
dispatch seam · fallback · relays · Dockerfile + compose (incl. `headless-mcp` + `headless-db-mcp`) ·
`fleet` CLI · fleet status.
**Ships:** QUE-01…17, DKR-01…22, HRN-08, HRN-09, JOB-O08, TST-17.
**Gate:** the whole broker/queue/worker suite runs with a fake handler — no agent CLI needed.

### M10 — Quota, shedding, retro, retention, watchdog
quota breaker + classes · shed · retro (lanes, tiers, snapshot, render, threads, backfill) ·
retention · log report · hub health · watchdog + delivery stamp · session reap.
**Ships:** QTA-*, JOB-R*, JOB-O01…07, JOB-O09…12, TST-14.

### M11 — Own runner library
Replace the sandcastle adapter behind `ports/runner`. Acceptance: every job file unchanged, every
`RunResult` field preserved, the three-runner ordering preserved, `permissionMode` semantics
preserved, the full suite green with the adapter swapped.
**Ships:** D3, HRN-01…09 re-homed.

---

### 3.2 Old milestone map

Commits, comments and older notes cite `M0`–`M4`. They resolve as:

| Old | Now | Why it moved |
|---|---|---|
| M0 | N0 | unchanged |
| M1 | N1 · N2 · N4 | split — kernel-the-loop-needs / gate+supervisor / leases |
| M2 | N5 | the plugin seam is not on the loop's path (D16) |
| M3 | N2 | pulled forward — the loop IS a supervisor |
| M4 | N3 · N5 | harness + JOB-C15 forward; `git`/`ops` builtins back |
| M10 (part) | N4 | QTA pulled forward — a cadence without a breaker is §4.2 |
## 4. Known cost and measured evidence

### 4.1 What the self-running loop actually does — measured 2026-08-23 … 2026-08-25

52 commits landed in the reference between this repo's first commit (2026-08-23 02:19 +0700) and
2026-08-25 18:11. **44 — 85% — were written unattended** by `nightly-sandcastle` / `nightly-polish`.
The loop works. What it does with that autonomy:

| Verb group | Count | What it is |
|---|---|---|
| Gated · Covered · Pinned | 20 | new tests and drift gates on code that already existed |
| Collapsed · Folded · Flattened · Split · Extracted · Replaced | 12 | refactor, behaviour unchanged |
| Corrected · Deleted · Dropped · Renamed · Moved | 13 | remove stale code, stale docs, dead paths |
| **Added** | **1** | a missing status row in a README table |

**One `Added` in three days, and it was a table row.** By design: `nightly-sandcastle/SKILL.md` says
*"prefer the one that removes a thing over the one that adds a thing"*, and a pass that cannot finish
reports `too-large` and changes nothing.

So *"it runs itself until the roadmap is done"* is two different asks. **Runs 24/7 with nobody
watching** — yes, that is N0–N4. **Builds the remaining roadmap by itself** — no; 44 commits of
evidence say it will not. A human builds every milestone; the loop keeps what exists honest, and that
compounds over every later one. Under D17 it loses its 9 doc-gating commits and keeps the other ~35.

### 4.2 24/7 — the reference tried denser and walked it back

The two nightlies run `0,30 15-22 * * *` and `1,31 15-22 * * *`: **16 Opus passes a night in a 7-hour
window (22:00–05:30 WIB), not round the clock.** The entry's own `why` records the history — `*/10`
(~45 passes/day) until 2026-08-08 → hourly while that spend rate was reassessed → `0,30` since
2026-08-17, *"walked down and back up rather than guessed"*.

Continuous at a 30-minute cadence is ~48 passes/day — about the rate already tried and abandoned on
cost. **Build for continuous operation, schedule a window.** It is one cron field and nothing else
moves with it.

Three modules that look deferrable are inside the loop's import closure (§3.0), because running on a
*cadence* is what makes them load-bearing:

- **`quota.ts`** — *"an exhausted plan quota fails EVERY invocation identically until it resets, so a
  1-minute cadence turns one outage into ~780 pointless spawns a day."* Without the breaker the loop
  does not merely stop at the wall; it burns process starts against it until a human notices. The
  pause is a **window**, not a park until the reported reset, so a mid-outage plan upgrade recovers —
  the next real run IS the probe. There is no separate prober and there should not be.
- **`shed.ts`** — the breaker pauses but never *degrades*: a nightly chore and a PR review burn the
  same wall and it cannot tell them apart. A job's value class decides whether it runs at all, and at
  which tier. `decideShed` is pure; the supervisor's per-tick skip and sandcastle's per-run model
  choice do the impure half.
- **`rwlock.ts`** — two nightlies run concurrently, offset one minute, on **disjoint** resources
  (`plugin` vs `factory`), JOB-C16. `engine.lock` used to be one lock, so `-x` self-excluded and made
  every writer pair mutually exclusive whether or not they touched the same tree.

Plus two outside the closure that are what "leave it alone" means: a **lease** (a pass killed mid-run
must not wedge the next one — `.sandcastle/nightly-sandcastle.lock` is the reference's) and a
**watchdog** (nothing tells you the loop stopped except its own silence, and silence is
indistinguishable from a quiet night).

### 4.3 The cost of D17

Cutting prose docs also cuts **TST-02 `assertDocumented`** — and §4.4 below calls TST-02 *the piece
most likely to be skipped and most costly to skip*, because nothing else forces a plugin to list
every schedule entry it owns. With no prose there is no list to assert against. The surviving half is
TST-01 (*every scheduled entry's gate resources exist*), which catches a bad row but not a missing
one. Accepted at MVP scale — one person, one plugin, one entry — and it is the first thing to
reconsider at N5 when `git` and `ops` add real manifests.

The other named risk survives D17 intact: **`boot()` must run in the test suite**, and N1–N4 do not
have `boot()` at all. See §5 Q6.

### 4.4 Carried from the draft, still true

- **KRN-10 is one-way in practice** — but v0 dissolves it rather than deciding it. No builtin emits
  a route, so there is no union to open; the decision returns, intact, on the first v1 plugin that
  ships one. Do not open the set speculatively in M2.
- **The skills mechanism has one consumer in v0** (`nightly`, plus `ops-hello`). That is thin, and
  it is the same "designed against no consumer" trap as the ports — SKL-02 and SKL-07 are the two
  rows most likely to be got wrong before a second plugin arrives to argue with them.
- **`boot()` must run in the test suite.** A validation that only runs in the supervisor has moved
  the failure from compile time to 3am.
- **A manifest can lie.** Nothing forces a plugin to list every schedule entry it owns; a row left in
  `host/` still runs. That is what TST-02 is for, and it is the piece most likely to be skipped and
  most costly to skip.
- **Five registries is not many.** `registry.ts` saves ~60 lines; the real win is the manifest, boot
  and the contract suite. If M1 lands and M2/M5 do not, this was a lateral move.
- **Docker is not a drop-in for LXD here.** DKR-05 (uid), DKR-06 (identical absolute paths) and
  DKR-12 (nesting) are the three that break silently if got wrong, and all three are load-bearing for
  a shared read-write tree.

## 5. Open questions

0. **`.claude/skills/` render vs symlink — decided by the user, render, never symlink, 2026-08-25.**
   Every skill is a **project skill**: `.claude/skills/<job>/SKILL.md` is a real, regular file in the
   project tree, a rendered COPY of `plugins/<x>/skills/<job>/SKILL.md`. Not a link. Not delivered
   through the Claude Code plugin-skill mechanism. SKL-04 is confirmed as written; the symlink branch
   of TST-23 is dead. (Rejected branch, kept for the record: a symlink per skill would have been
   zero-drift and would have let SKL-10 answer ownership from the inode instead of a marker — the
   cheapest test would have been `ln -s` one skill and see if the CLI lists it. The user ruled this
   out; the five rules below are the render answer instead.)

   **Where the managed marker lives.** Two HTML comment lines in the markdown BODY, immediately
   after the closing `---` of the YAML frontmatter, before the blank line that starts the body —
   already what the landed worked example does, at lines 5 and 6 of
   `.claude/skills/nightly-sandcastle/SKILL.md`:
   ```
<!-- managed:doppelganger-skills v=1 src=plugins/nightly/skills/nightly-sandcastle -->
<!-- rendered by `skills render` — do not edit; edit the source and re-render (SKL-04) -->
   ```
   The body, not the frontmatter, because the CLI parses the frontmatter block and nobody controls
   whether an unknown key there is ignored or rejected — an HTML comment in the body is inert to
   every markdown reader, and it is proven: the rendered `nightly-sandcastle` skill with these two
   lines is listed by the CLI today. The render rule, stated so two implementations produce the same
   bytes:
   ```
   render(source) = <the frontmatter block, "---\n" … "---\n", copied byte for byte>
                  + "<!-- managed:doppelganger-skills v=1 src=<POSIX path from repo root to the source DIR> -->\n"
                  + "<!-- rendered by `skills render` — do not edit; edit the source and re-render (SKL-04) -->\n"
                  + <the rest of the source file, copied byte for byte>
   ```

   **How `skills sync` decides an entry is its to delete — filesystem-decidable, no ledger.**
   - `.claude/skills/<dir>/SKILL.md` exists AND its first body line matches
     `^<!-- managed:doppelganger-skills v=(\d+) src=(\S+) -->$` → **OURS**.
   - Anything else — no `SKILL.md`, or a `SKILL.md` without that line → **FOREIGN**. Never touched,
     never overwritten, never counted as drift (SKL-10, carried from SUP-08).
   - OURS and `<dir>` is not the name of a registered job → **PRUNE** the whole `<dir>`.
   - OURS and `<dir>` contains any entry other than `SKILL.md` → **REFUSE**, and say which files —
     the renderer writes exactly one file, so an extra file is a human's work sitting in a directory
     the tool owns.
   - `render` about to create a `<dir>` that already exists and is FOREIGN → **REFUSE the whole
     render**, naming the collision (SKL-04's "duplicate detection refuses a plain splice").
   This closes SKL-10's own open point below: the ownership token lives INSIDE the rendered file, so
   the filesystem answers "did we create this?" with no ledger. The one case a ledger would still
   beat the marker — a human deleted `SKILL.md` but left other files in an owned directory — is
   covered by the REFUSE rule, which reports it instead of guessing.

   **How `skills check` detects drift.** For each registered job: compute `render(source)` IN MEMORY
   and compare byte for byte to the file on disk. Never write. Exit non-zero on **missing** (the job
   names a skill with no rendered file), **drift** (the bytes differ), **orphan** (an OURS entry
   whose dir is not a registered job), **collision** (a FOREIGN entry occupying a registered job's
   name), or **stray** (an OURS directory containing anything but `SKILL.md`). No hash is stored in
   the marker — a hash would be a second copy of a fact the source file already is.

   **What happens on a hand-edit.** `skills check` fails the build. It never re-renders — silently
   repairing a hand-edit throws away the human's work and teaches them the file is editable:
   ```
   skills: drift in .claude/skills/nightly-sandcastle/SKILL.md
     the rendered copy does not match its source
     source:  plugins/nightly/skills/nightly-sandcastle/SKILL.md
     first difference at line 12
     .claude/skills is rendered, never hand-edited (SKL-04).
     fix: move your change into the source file, then run `skills render`.
   ```
   `skills sync` behaves the same way — it refuses a drifted entry rather than overwriting it. Only
   an explicit `skills render` writes over an owned file.

   **The SKL-07 boundary: an output vocabulary is allowed, an authorization token is not.** TST-24 as
   worded below ("no `SKILL.md` carries … a verdict token that code owns") would fail the worked
   example: the landed skill carries `outcome=<changed|none|too-large|suite-failed>` at line 47 of
   `plugins/nightly/skills/nightly-sandcastle/SKILL.md`, and that is correct, not a violation. An
   **output vocabulary** is the set of values a skill must EMIT so the caller can read its report —
   nothing is granted by naming it, and `outcome=` is this. An **authorization token** is a value
   that WIDENS what the run is allowed to do — it must never appear in markdown, because a grant that
   lives in markdown is a grant anyone can widen in a text editor. SKL-07's own precedent is
   JOB-T03: `agent` is reachable only from a literal token, *enforced in `parseVerdict`, not asked
   for in the prompt* — the skill never names `agent`; the code decides. The test that tells them
   apart: if a value's presence changes what the caller is PERMITTED to do, it is a token — keep it
   out. If it only changes what the caller LEARNS, it is a vocabulary — the skill states it, and code
   still validates it (an unknown `outcome=` is a parse failure, not a new outcome).

   **Scope, restated so it is not lost.** PROJECT level only. Never `~/.claude/skills/` (shared
   across checkouts, contradicts INS-02, and would let SKL-10 prune another instance's skills).
   Never an agent-CLI plugin namespace, whose `plugin:skill` prefix breaks SKL-01's one identifier.
1. **Name the resources.** The gate's three resources are workspace-specific (`factory`, `plugin`,
   `services`). Does the kernel take them as config (`resources: string[]`) or does each host declare
   its own set? Leaning: host config, validated at boot (KRN-09 already checks unknown resources).
   Constrained by INS-05: whatever the answer, no named resource may be machine-wide, because the
   gate cannot exclude across instances.

   **decided 2026-08-26: the HOST declares them, as `{ name, path, why }` rows in `host/config.ts`,
   validated at boot (SUP-05). `path` is ROOT-relative, which is INS-05's constraint made
   mechanical: a machine-wide resource cannot be written down. This repo names two, `repo` and
   `skills`.**
2. **Tracker abstraction.** The reference hard-codes GitHub issues. Is "tracker" a port (so a plugin
   could back it with something else), or does the host own it? Leaning: a port, because TRK-05's
   claim model is the interesting part and it is store-agnostic.
3. **Docker-in-Docker vs mounted socket** for DKR-12 — the containment trade differs, and the
   reference already accepts host-level `bypassPermissions` runs deliberately.
4. **Session runner** — keep the external session server, or fold the warm-session runner into the
   own-runner library at M11?
5. **Does the published package need a build step?** **decided** — measured on Node `22.23.1`,
   `2026-08-25`.
   Split answer — the CONSUMER half and this repo's OWN dev loop are different, and the plan of
   record before this measurement (assuming they were the same) was wrong:
   - **Consumer half — YES, the build is needed.** A real install copies the package under
     `node_modules`. Importing a `.ts` entry point from there fails with
     `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. ADO-15's `tsc -p tsconfig.build.json` → `dist/`
     stays exactly as written.
   - **This repo's own dev loop — NO, the build is not needed.** An npm workspace link is a
     symlink (`node_modules/@doppelganger/kernel -> ../../kernel`). Node resolves the symlink to its
     real path before deciding whether to strip types, and the real path is outside `node_modules`,
     so stripping applies. A cross-workspace `import { x } from '@doppelganger/kernel'`, where the
     `exports` map points at a `.ts` source file, runs under `node --test` with no build.
   - **Reproduced with a two-case fixture in `/tmp`**: a workspace-symlink case exits `0`; the same
     package copied under `node_modules` (no symlink) exits `1` with
     `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
   - **Trip-wire:** if this repo ever consumes a workspace by copy instead of by link — a vendored
     package, a `file:` tarball, a Docker image that installs rather than mounts — `pretest` gains
     `&& npm run build` on that day. `test/toolchain.test.ts` (J0.8) is written so the flip is one
     line.
   This corrects **ADO-16** (§2.32), whose stated reason ("a workspace link resolves through
   `node_modules`") is false on the target Node — §2.32 carries the fix.

6. **Does deferring `boot()` past N4 cost more than it saves?** §4.4 is blunt: *a validation that only
   runs in the supervisor has moved the failure from compile time to 3am.* N1–N4 carry one plugin's
   worth of wiring, so the manifest buys little — but the loop runs unattended from N3, which is
   exactly when a 3am failure costs the most. Revisit at the end of N2, not at N5.
7. **Which repo do the first passes improve?** doppelganger has almost no code until N5, so
   `nightly-sandcastle` pointed at itself has nothing to do and the ship gate passes vacuously. A repo
   with real code — or `nightly-polish` against docs elsewhere — is the better proving ground for N3.
8. **Does D17 need a re-entry point?** If a second person ever joins, the cut docs were the onboarding
   path. Cheapest hedge: keep the one-line `why`s religiously, so prose can be regenerated from
   decisions rather than reconstructed from memory.
