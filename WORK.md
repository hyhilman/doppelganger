# doppelganger — work list

Generated from `roadmap.md` §3. Every item is a feature ID from §2 — cite it in the commit.
Rows marked **moved** are listed once, where they were dropped, so nothing goes missing silently.

## N0 — Ground truth · 2 days · **11 items**

- [x] (J0.3, J0.4, J0.5) Repo layout per §1 — `kernel/` `plugins/` `host/` `.claude/skills/`. J0.3
      created the stubs, J0.4 named `cli/` and `test/` in §1, J0.5 gates the whole shape.
- [x] (J0.2, J0.3, J0.8) `package.json` — workspaces `["kernel","plugins/*","cli"]`, no linter, no
      bundler, direct-TS run. J0.2 wrote it, J0.3 added the workspace stubs, J0.8 gates no
      linter/no bundler.
- [x] (J0.2, J0.5, J0.6) `tsconfig.json` — `noEmit`; `npm run typecheck` wired as `pretest`. J0.2
      wrote it, J0.5 and J0.6 gate the shape.
- [x] (J0.13) CI running `npm test` and nothing else.
- [x] (J0.10) `plugins/nightly/skills/nightly-sandcastle/SKILL.md` + its rendered
      `.claude/skills/` entry (already landed before N0; J0.10 gates it).
- [x] (J0.9) §5 Q0 settled — render, never symlink (2026-08-25). Confirms SKL-04, fixes SKL-10,
      kills the symlink branch of TST-23.
- [x] (J0.11, J0.12) The two `roadmap.md` claims this repo can check: the corpus path and the
      engine file counts. This line used to claim the counts were already fixed on 2026-08-25 —
      that claim was wrong, the counts were still stale. J0.11 actually refreshed all four; J0.12
      gates the path always and the counts' provenance, dropping a ±2% band that could not have
      caught the staleness it was written for.
- [x] (J0.2, J0.6) **TST-21** `typecheck` as `pretest`. J0.2 wired it, J0.6 gates it.
- [x] (J0.8) **TST-22** No linter, no bundler, no build step **in a host repo**.
- [x] (J0.2) Node floor — `.nvmrc`, `engines`, capability test (DBS-01).
- [x] (J0.7) Settle §5 Q5 — the build answer, measured; corrects ADO-16 (ADO-15/16).

## N1 — The kernel the loop needs · 1.5–2 wk · **26 items**

- [x] (J1.5) **DBS-01** `openDb(path)` — handle + `tx` + ordered migrations, one file per
      integration (`slack.db`, `jira.db`, `backlog.db`, `lease.db`, `quota.db`, `queue.db`, `log.db`).
- [x] (J1.5) **DBS-02** Namespaced tables (`<ns>_message`, `<ns>_meta`) with
      `<ns>_meta.schema_version`; migrations are append-only steps owned by the source.
- [x] (J1.5) **DBS-03** Namespace identifier guard (`ns` is interpolated into DDL).
- [x] (J1.6) **DBS-04** SQLITE_BUSY context: rethrow naming file + one-line SQL + waited-ms; do NOT
      retry and do NOT raise the timeout (the wait is the discriminator).
- [x] (J1.5) **DBS-05** `tx` begins IMMEDIATE, not DEFERRED.
- [x] (J1.6) **DBS-06** Proxy-wrapped `exec`/`prepare` and statement `run`/`get`/`all` so no call
      site is a blind spot.
- [x] (J1.4) **DBS-07** `dbPath(name)` with `<NAME>_DB` override for throwaway runs.
- [x] (J1.5) **DBS-08** `closeAll()` at job end.
- [x] (J1.1, J1.7, J1.9) **LOG-01** ONE line shape, two emitters (TS + bash), byte-identical;
      nothing else formats a line. The `ts=` field comes from ONE clock helper (`kernel/time.ts`,
      `nowIso()`) so both emitters agree on precision and suffix, not only on layout.
- [x] (J1.7) **LOG-02** logfmt, not JSONL; `msg=` is the only quoted field.
- [x] (J1.7) **LOG-03** Four levels `debug|info|warn|error`; no `fatal`.
- [x] (J1.10) **LOG-04** Routing is a property of the level, not the caller: `error` → the next
      report tick, batched per `job/event`; `warn` → a bare count on a tick that already had an
      error; `info`/`debug` → the file only.
- [x] (J1.7) **LOG-05** Severity is SET by the emitter, never inferred from text.
- [x] (J1.7) **LOG-06** Writes to STDERR so stdout stays free for the payload.
- [x] (J1.8) **LOG-07** `parse.ts` parses a LINE; unrecognised lines are not an error (two thirds of
      a file is agent stdout).
- [x] (J1.12) **LOG-08** `tail.ts` — incremental read over BOTH roots, `(file, inode, offset)`
      cursors, rotation and truncation detection, `LOG_MAX_BYTES`, `LOG_MAX_READ_BYTES`.
- [x] (J1.11) **LOG-09** `cause.ts` — distils a dead child's stderr (which the parser skips) into
      the one line `job-failed` carries.
- [x] (J1.7) **LOG-10** `LOG_LEVEL` gates both emitters.
- [x] (J1.2, J1.18) **KRN-06** `EnvSpec { key, required?, default?, why }` — `why` is one line and
      IS the knob doc.
- [x] (J1.16) **SUP-20** Stage-prefix vocabulary: every job name and schedule entry carries a known
      prefix (`source-`, `triage-`, `backlog-`, `watch-`, `todo-`, `corpus-`, `nightly-`, `retro-`,
      `ops-`).
- [x] (J1.14) **HRN-18** `pool.ts` — bounded concurrency + spawn stagger (`*_SPAWN_STAGGER_MS`,
      2000) for the `~/.gitconfig` start-up race.
- [x] (J1.15) **HRN-19** `exec.ts` — `gh` / `ghIn` / `git` wrappers with a wall-clock timeout (an
      unbounded stalled `gh` blocks the event loop, so lease heartbeats stop).
- [x] (J1.3) **INS-01** ONE `INSTANCE` name per checkout, defaulting to the project directory's
      basename, validated at boot as a bare identifier — it is interpolated into crontab text, an
      owner string and container names, so KRN-09 checks it for the same reason DBS-03 guards `ns`.
      It is the only thing that distinguishes two copies of the engine on one host.
- [x] (J1.19) **INS-02** Every write is either **project-relative** or **`INSTANCE`-discriminated**,
      and there is no third category. Project-relative: `<NAME>_DB` defaults resolve inside the
      checkout (DBS-01), `.claude/skills/` is repo-relative (SKL-04, and therefore SKL-10 can never
      prune another instance's skills). Discriminated: crontab markers (INS-03), lease owner
      (INS-04), queue rows (QUE), container and volume names (DKR-05/06). A new write path states
      which it is.
- [x] (J1.9) **TST-18** Log: both emitters agree; render↔parse round-trip; the tail cursor; the
      real dead-child fixture.
- [x] (J1.17) **TST-20** Suites share one database — settle what you seed (two documented traps).

## N2 — Supervisor, one schedule entry · 1 wk · **32 items**

- [ ] **SUP-01** The schedule is DATA, read live
- [ ] **SUP-02** `PROGRAMS` registry: `self`, `gate`, `resources?`, `dotenv`
- [ ] **SUP-03** Supervisor: one croner timer per entry → take gate → spawn child with `cwd = ROOT` → app
- [ ] **SUP-04** `dotenv: false` is load-bearing: a knob reachable only from an `env:` prefix on the entr
- [ ] **SUP-05** `validate()` on **every boot** and every render, over every entry incl
- [ ] **SUP-06** A boot refusal is loud: restart loop + watchdog reports within 15 min.
- [ ] **SUP-07** Croner-vs-POSIX parity test over every expression across a fixed 14-day window.
- [ ] **SUP-08** Bootstrap crontab block: `render` / `sync` / `check` / `sync --adopt`
- [ ] **SUP-09** `supervised: false`
- [ ] **SUP-10** Refresh window stated ONCE
- [ ] **SUP-11** The flag bounds where a pass may **start**, never how long it **runs**
- [ ] **SUP-12** `order.test` allowlist for what may legally fire inside the window, plus a companion ass
- [ ] **SUP-13** `maxRunMin`
- [ ] **SUP-14** Supervisor heartbeat stamp
- [ ] **SUP-15** Boot-time lease reap
- [ ] **SUP-16** Quota-shed skip at `runEntry`, before the gate, logged `event=quota-shed`.
- [ ] **SUP-17** `supervisor --list`
- [ ] **SUP-18** Two log roots, both read
- [ ] **GAT-01** In-memory reader/writer gate over named resources
- [ ] **GAT-02** Reader takes `shared` on ALL resources
- [ ] **GAT-03** Two writers on disjoint resources run concurrently
- [ ] **GAT-04** Fixed global acquisition order
- [ ] **GAT-05** FIFO queue with writer priority: a queued writer blocks readers arriving after it.
- [ ] **GAT-06** Per-**program** self-exclusion
- [ ] **GAT-07** `gate: "none"` exemptions, each stating why
- [ ] **GAT-08** `gateWait: true` blocks for one of the entry's own ticks, **derived** by `gateWait(cron)
- [ ] **GAT-09** Never hand-pick a wait: a blocked pass holds its self-lock, so the ticks it waits throug
- [ ] **GAT-10** Lock-starve visibility: `lockloss:<job>` counters, `BACKLOG_LOCK_STARVE_N`, plus a per-j
- [ ] **INS-03** The crontab is the one unavoidably shared resource
- [ ] **INS-05** **Non-goal, declared so it is declined rather than discovered:** two instances never coo
- [ ] **TST-15** Croner-vs-POSIX parity
- [ ] **TST-16** Crontab managed-block mechanics

<details><summary>moved out of this milestone</summary>

- ~~**SUP-19**~~ → M9 · Docker restart policy has no subject until the fleet exists
- ~~**SUP-21**~~ cut by D17 · docs-count drift gate has no docs to gate

</details>

## N3 — The harness and the pass · 1.5–2 wk · **34 items**

- [ ] **HRN-01** `DEFAULTS` in ONE place: `model`
- [ ] **HRN-02** `defineJob` identity helper
- [ ] **HRN-07** `permissionMode` is load-bearing on a host runner
- [ ] **HRN-10** Sentinel payload parsing: last `<<<TAG … TAG>>>` block wins
- [ ] **HRN-11** Every agent run **names its model**
- [ ] **HRN-12** `worktree` realization + `{{WORKTREE}}` prompt placeholder, so a review reads the PR's o
- [ ] **HRN-13** `taskClass` declared at the call site that knows the work is implementation-shaped.
- [ ] **HRN-14** `job.local` pins a shared-master writer to one node.
- [ ] **HRN-15** `OPUS_GUIDANCE`
- [ ] **HRN-16** Every run
- [ ] **SKL-01** `defineJob({ skill })`
- [ ] **SKL-02** ONE skill per JOB, never per plugin
- [ ] **SKL-03** The plugin owns the file: `plugins/<x>/skills/<job>/SKILL.md`
- [ ] **SKL-04** `.claude/skills/` is RENDERED from the manifests, never hand-edited
- [ ] **SKL-05** Code declares
- [ ] **SKL-06** The gate runs both ways: every `job.skill` resolves to a real directory, and every skill
- [ ] **SKL-07** What may NOT move into a skill: guard matrices, verdict parsing, eligibility, and every
- [ ] **SKL-08** A skill's only inputs are `promptArgs`
- [ ] **SKL-09** The free safe-run surface: the file a job runs unattended is the file a human runs at `/
- [ ] **SKL-10** `sync` PRUNES, and the crontab precedent does not survive the port: SUP-08's "foreign li
- [ ] **JOB-C15** `nightly-sandcastle`
- [ ] **SAF-01** Per-job `*_DRY_RUN`
- [ ] **SAF-02** Per-job shadow modes
- [ ] **SAF-03** Per-job `*_MAX=1`
- [ ] **SAF-04** Per-job `*_MAX=0` / `*_LIMIT=0`
- [ ] **SAF-05** Throwaway DB redirection
- [ ] **SAF-06** Child/single-item modes
- [ ] **SAF-07** The one non-free dry run must be documented as such
- [ ] **INS-06** Corollary, free: `INSTANCE` is the cheapest isolation for a real smoke test
- [ ] **TST-08** Every agent run names its model.
- [ ] **TST-09** Every job file and schedule entry carries a known stage prefix.
- [ ] **TST-19** Per-job pure decisions pinned directly
- [ ] **TST-23** `skills check`
- [ ] **TST-24** SKL-06 both ways

<details><summary>moved out of this milestone</summary>

- ~~**HRN-17**~~ → N5 · `plugin-names.test` needs plugins
- ~~**SAF-08**~~ cut by D17 · the safe-run table is a doc; keep the knobs, drop the table

</details>

## N4 — Safe to leave alone · 1 wk · **22 items**

- [ ] **QTA-01** A breaker per **account scope**: host `QUOTA_SCOPE`, each worker `workerScope(container)
- [ ] **QTA-05** Nothing re-probes: the window expires and the next real task IS the probe.
- [ ] **QTA-06** Window sized by the limit CLASS the CLI named, never by the reset it stated: 1× session/
- [ ] **QTA-07** `QUOTA_DARK_GAP_MS`
- [ ] **QTA-08** `shed.ts`
- [ ] **QTA-09** `decideShed` is pure
- [ ] **LSE-01** SQLite lease mutex: `scope` + `key`, TTL, `held|done|failed`, attempts, owner string.
- [ ] **LSE-02** `done` is **terminal**
- [ ] **LSE-03** `withLease` settles `done` on any non-throwing return, early returns included
- [ ] **LSE-04** Versioned keys
- [ ] **LSE-05** `maxAttempts` crash-loop brake
- [ ] **LSE-06** Owner = `<instance>:<host>:<pidns>:<pid>:<uuid8>`
- [ ] **LSE-07** `reapDead` guard table, every guard failing toward NOT reaping: pid-namespace ≠ ours · h
- [ ] **LSE-08** Owners written before the namespace was recorded are skipped, never guessed.
- [ ] **LSE-09** Supervisor runs the same sweep **on boot**, before registering any timer.
- [ ] **LSE-10** `lease-clear` operator surface: list scope · delete key · `--force` a `held` claim.
- [ ] **LSE-11** `proc.ts`
- [ ] **INS-04** Lease owner
- [ ] **JOB-O09** `ops-cron-check`
- [ ] **JOB-O10** `watchdog`
- [ ] **JOB-O11** Delivery stamp: written on a failed send, removed on the next good one
- [ ] **TST-17** Gate contract

<details><summary>moved out of this milestone</summary>

- ~~**QTA-02**~~ → M9 · worker-side classification
- ~~**QTA-03**~~ → M9 · worker release
- ~~**QTA-04**~~ → M9 · `claimNext` needs the queue
- ~~**QTA-10**~~ → M10 · needs the health digest
- ~~**LSE-12**~~ → M9 · serial-group lease needs the queue
- ~~**JOB-O12**~~ → M10 · mutual watching needs the health job

</details>

---

# ✅ MVP READY — 123 items

The loop runs unattended on a nightly window and is safe to walk away from:
a walled account parks and recovers by itself, a killed pass does not wedge the next one,
and the watchdog says so when it stops. **~4.5–6 weeks.**

What it is NOT yet: a framework. No manifest, no `boot()`, one plugin. That is N5.

---

## N5 — The rest of v0 — the framework claim · 3.5–4.5 wk · **40 items**

- [ ] **KRN-01** `registry<T extends Named>(kind)`
- [ ] **KRN-02** No discovery, ever
- [ ] **KRN-03** The five registries collapse onto KRN-01: entry points, relays, watchers, programs, retr
- [ ] **KRN-04** `Plugin` manifest: `name`, `kill`, `sources`, `routes`, `relays`, `jobs`, `schedule`, `l
- [ ] **KRN-05** `definePlugin(p)`
- [ ] **KRN-07** Per-plugin kill switch `*_NO_<FEATURE>=1`, degrading toward the **safest** verdict.
- [ ] **KRN-08** `boot(plugins)` collects ALL problems then throws once, each line attributed to a plugin
- [ ] **KRN-09** boot checks: route has watcher **or** an `unwatched` reason · watcher names a registered
- [ ] **KRN-11** `boot()` runs in `npm test`, not only in the supervisor.
- [ ] **PRT-05** `Job` shape: `name`, `description`, **`skill`** | `exec?`, `model`, `effort`, `permissio
- [ ] **PRT-06** `ScheduleEntry`: `name`, `cron`, `log`, `env?`, `gateWait?`, `clearsRefreshWindow?`, `ma
- [ ] **PRT-08** `Runner` port
- [ ] **HRN-17** `plugin-names.test` holds the skill/agent name list to the prompts
- [ ] **TST-01** `contractTests(kernel, opts)`
- [ ] **TST-03** `assertNoDeepImports`
- [ ] **TST-04** Layout: which directories carry a barrel and which are imported by path.
- [ ] **TST-05** Every relative module specifier points at a file that exists.
- [ ] **TST-25** **No phantom dependencies**
- [ ] **JOB-G01** `ops-reset-branches.sh`
- [ ] **JOB-G02** Guard matrix with overrides: dirty worktree
- [ ] **JOB-G03** Ref writes via `update-ref`, except a branch checked out in a worktree, which is `reset
- [ ] **JOB-G04** Scope listed explicitly, never globbed
- [ ] **JOB-G05** Branch names are not uniform
- [ ] **JOB-G06** Nothing is discarded silently
- [ ] **JOB-G07** `ops-ensure-env-worktrees.sh`
- [ ] **JOB-G08** These trees are disposable and must never be edited.
- [ ] **JOB-G09** `ops-reset-env-to-main.sh`
- [ ] **JOB-G10** Guard matrix: already at main · absent on origin · today's backup at the same head
- [ ] **JOB-G11** `main` is the SOURCE and is refused as a target before any repo is touched.
- [ ] **JOB-G12** Reported as "not on main", never "discarded"
- [ ] **JOB-G13** `branches.ts`
- [ ] **JOB-G14** PR-head detached worktree prep/teardown, shared by reviewer and digest.
- [ ] **JOB-O01** `ops-hello`
- [ ] **JOB-O02** `ops-log-report`
- [ ] **JOB-O03** `ops-lease-reap`
- [ ] **JOB-O04** `ops-lease-clear`
- [ ] **JOB-O05** `ops-session-reap`
- [ ] **JOB-O06** `ops-retention`
- [ ] **JOB-C14** `nightly-polish`
- [ ] **JOB-C16** Both nightlies run CONCURRENTLY
