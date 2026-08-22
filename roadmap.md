# doppelganger — roadmap

Extraction of the `xenith/engine` unattended-agent engine into a structured, reusable framework.

**Reference corpus** (`/Users/hyhilman/Projects/xenith/`):
`engine/CLAUDE.md` · `engine/README.md` · `engine/jobs.md` · `engine/pipeline.md` ·
`engine/distribution.md` · `engine/herdr-migration.md` · `engine/mcp-bridge-migration.md` ·
`engine/cron/schedule.ts` · `engine/labels.sh` · `engine/fleet.sh` · `engine/watchdog.sh` ·
`engine/src/**` (214 files) · `compose-data/docker-compose.yml` · the framework-extraction draft.

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

**Not adopted from Hermes Agent / OpenClaw:** conversation hooks (`before_tool_call`,
`message_received`, `before_compaction`), plugin sandboxing, marketplace/dynamic loading,
plugin↔kernel version compatibility surface. One idea is taken: *plugins use published entry points
and never import core internals* — shipped as a test (TST-03).

---

## 1. Target layout

```
kernel/                   the framework. imports no plugin, ever.
  registry.ts             typed, named, hand-registered, duplicate-throws
  plugin.ts               the manifest — one integration, every contribution
  boot.ts                 validation over the whole graph
  ports/
    source.ts   route.ts   relay.ts   job.ts   schedule.ts   lane.ts   runner.ts
  runtime/
    gate.ts     lease.ts   queue.ts   log.ts   db.ts   quota.ts   shed.ts   pool.ts
  contracts/              drift-gate suite factory a host repo calls
plugins/
  jira/ slack/ github/ notion/ tracker/ pr-review/ corpus/ ops/
host/
  supervisor.ts  config.ts  schedule.ts  jobs/            the app
fleet/
  Dockerfile  compose.yml  fleet.sh                        workers
```

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
  job declares a model · required env unset with no default · duplicate names across registries ·
  writer names an unknown gate resource.
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
- **PRT-05** `Job` shape: `name`, `description`, `prompt` | `promptFile`, `exec?`, `model`, `effort`,
  `permissionMode`, `maxIterations`, `completionSignal`, `promptArgs`, `env`, `worktree`,
  `taskClass`, `session`, `local`.
- **PRT-06** `ScheduleEntry`: `name`, `cron`, `log`, `env?`, `gateWait?`, `clearsRefreshWindow?`,
  `maxRunMin?`, `job` | `script`, `supervised?`, `why` (required).
- **PRT-07** `Lane { id, title, jobKeys, leaseScopes, wrong }` — what BEING WRONG means in that lane.
- **PRT-08** `Runner` port — the sandcastle→own-library seam (D2/D3).

### 2.3 Runtime — gate (`GAT`)

- **GAT-01** In-memory reader/writer gate over named resources (reference: `factory`, `plugin`,
  `services`). Replaces `flock` + 17 wrapper scripts; possible because one supervisor process owns
  every tick.
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
- **GAT-10** Lock-starve visibility: `lockloss:<job>` counters, `BACKLOG_LOCK_STARVE_N`, plus a
  per-job raised threshold (`_N_TODO_EXEC`).

### 2.4 Runtime — leases (`LSE`)

- **LSE-01** SQLite lease mutex: `scope` + `key`, TTL, `held|done|failed`, attempts, owner string.
- **LSE-02** `done` is **terminal** — refused at any horizon; deletion is the only way back.
- **LSE-03** `withLease` settles `done` on any non-throwing return, early returns included (the
  XEN-8365 47h trap) — documented, not silently fixed.
- **LSE-04** Versioned keys (`todo:<n>@<updatedAt>`, `repo#n@<sha>`) vs constant keys (serial groups)
  and the opposite release rules each needs.
- **LSE-05** `maxAttempts` crash-loop brake; `capped` return distinct from `held`.
- **LSE-06** Owner = `<host>:<pidns>:<pid>:<uuid8>`.
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
  duplicate name · non-5-field cron · relative `log` · empty `why` · both `job` and `script` ·
  neither · missing `src/jobs/<job>.ts` · missing script on disk · no `PROGRAMS` row · writer naming
  an unknown resource · reader naming resources · `gateWait` on an ungated program ·
  `clearsRefreshWindow` on an ungated program · unescaped `%` in a bootstrap command.
- **SUP-06** A boot refusal is loud: restart loop + watchdog reports within 15 min.
- **SUP-07** Croner-vs-POSIX parity test over every expression across a fixed 14-day window.
- **SUP-08** Bootstrap crontab block: `render` / `sync` / `check` / `sync --adopt`; managed markers;
  foreign lines untouched; duplicate detection refuses a plain splice.
- **SUP-09** `supervised: false` — exactly one entry (the watchdog), because a liveness probe
  scheduled by the process it probes reports nothing in the case that matters.
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
- **HRN-16** A worker RUNS a skill **by name** (`<plugin>:<skill>`); its payload stays in code. Never
  a path into a skill's files; a prompt naming a skill should be short.
- **HRN-17** `plugin-names.test` holds the skill/agent name list to the prompts.
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
- **TST-22** No linter, no bundler, no build step — TS runs directly.

### 2.27 Ops knobs (`KNB`)

Every knob in the reference, to be re-homed as `EnvSpec` rows on the owning plugin (KRN-06).

- **Core/paths**: `XENITH_ROOT`(→`ENGINE_ROOT`), `XENITH_TRACKER`(→`ENGINE_TRACKER`), `ENGINE_ROLE`,
  `ENGINE_VERSION`, `FACTORY_STATE_DIR`, `BROKER_SOCK`, `<NAME>_DB`, `SQLITE_BUSY_TIMEOUT_MS`,
  `SUPERVISOR_MAX_RUN_MIN`, `LOG_LEVEL`.
- **Switch/pipeline**: `SWITCH_MAX_BATCH`, `SWITCH_DRY_RUN`, `INTENT_MODEL`, `STEP_CAP_ROUTE`,
  `STEP_CAP_WATCH`, `STEP_CAP_BRIEF`, `STEP_CAP_DEFAULT`, `BACKLOG_DB`.
- **Brief**: `BRIEF_MODE`, `BRIEF_CAP`, `BRIEF_READ_CAP`, `BRIEF_DRY_RUN`, `SLACK_WEEKLY_DRY_RUN`.
- **Health**: `SWITCH_STALE_H`, `SLACK_FETCH_STALE_H`, `BACKLOG_STUCK_H`, `BACKLOG_UNKNOWN_MAX`,
  `BACKLOG_UNTRIAGED_AGE_H`, `BACKLOG_BREACH_COOLDOWN_H`, `BACKLOG_OK_EVERY_H`, `BACKLOG_DLQ_MAX`,
  `BACKLOG_DARK_H`, `BACKLOG_LOCK_STARVE_N`, `BACKLOG_LOCK_STARVE_N_TODO_EXEC`,
  `BACKLOG_HEALTH_DRY_RUN`, `LOG_REPORT_STALE_M`.
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

## 3. Milestones

Each step is green on its own and none needs the next.

### M0 — Skeleton & decisions
Repo layout (§1) · `package.json` (no bundler, no linter, direct-TS run, `typecheck` as `pretest`) ·
`tsconfig` `noEmit` · CI running `npm test` · this file kept current.
**Ships:** D1–D8, TST-21, TST-22.

### M1 — Kernel primitive + runtime core
`registry.ts` · `db.ts` · `log/` · `gate.ts` · `lease.ts` · `proc` · `pool` · `time` · `exec`.
**Ships:** KRN-01…03, DBS-*, LOG-*, GAT-01…09, LSE-01…12, HRN-18, HRN-19.
**Gate:** gate contract, lease primitive, reaper guards, log round-trip, tail cursor, DB busy-context.

### M2 — Manifest, boot, ports, contracts suite
`plugin.ts` · `boot.ts` · every port · `kernel/contracts`.
**Ships:** KRN-04…11, PRT-01…08, TST-01…05.
**Fork to settle before M5:** KRN-10 (open the route set) — one-way in practice.

### M3 — Host supervisor & schedule
`host/supervisor.ts` · schedule-as-data · `PROGRAMS` · `validate()` · bootstrap block CLI ·
refresh window · heartbeat · boot lease sweep · `--list`.
**Ships:** SUP-01…21, GAT-10.
**Gate:** validate list ↔ docs, croner parity, gate-wait derivation, ordering, window walk,
crontab block.

### M4 — Agent harness over sandcastle
`ports/runner` + a sandcastle adapter · `DEFAULTS` · `defineJob`/`runJob` · `runLocal` · worktree
realization · payload parsing · model-declaration gate · `OPUS_GUIDANCE`.
**Ships:** HRN-01…02, HRN-07, HRN-10…17, PRT-05, PRT-08.
**Deliberately deferred:** HRN-03…06 (session runner) → M8; dispatch → M9.

### M5 — Pipeline core + first plugin
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
space-backfill) · corpus (refresh, checklist, lint) · nightlies · git ops · session runner.
**Ships:** JOB-B*, JOB-P*, JOB-T*, JOB-C*, JOB-G*, HRN-03…06, INT-18, TST-19.

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

## 4. Known cost (carried from the draft, still true)

- **KRN-10 is one-way in practice.** Once a plugin ships a route, restoring a closed union means
  un-plugging it. Decide before M5 lands.
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

1. **Name the resources.** The gate's three resources are workspace-specific (`factory`, `plugin`,
   `services`). Does the kernel take them as config (`resources: string[]`) or does each host declare
   its own set? Leaning: host config, validated at boot (KRN-09 already checks unknown resources).
2. **Tracker abstraction.** The reference hard-codes GitHub issues. Is "tracker" a port (so a plugin
   could back it with something else), or does the host own it? Leaning: a port, because TRK-05's
   claim model is the interesting part and it is store-agnostic.
3. **Docker-in-Docker vs mounted socket** for DKR-12 — the containment trade differs, and the
   reference already accepts host-level `bypassPermissions` runs deliberately.
4. **Session runner** — keep the external session server, or fold the warm-session runner into the
   own-runner library at M11?
