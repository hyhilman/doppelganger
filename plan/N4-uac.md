# N4 — Safe to leave alone · UAC breakdown

The last MVP phase. N3 ended with a pass that runs. N4 ends with a loop you can walk away from.

**N4 is done when three sentences are true, each proved by a command:**

1. **A walled account parks and recovers by itself.** A run that dies on the CLI's limit message
   opens a breaker for a window sized by the limit CLASS, every later tick refuses before it spawns
   anything, and when the window lapses the next real task IS the probe — nothing re-probes, nothing
   reads the reset the message stated. A recent SPEND-class wall additionally sheds: a `chore` tick
   is skipped before the gate, an opus request from any non-`review` job is downshifted.
2. **A killed pass does not wedge the next one.** A `held` lease whose owning process is gone is
   deleted at the next supervisor boot, before a single timer registers — and every guard on that
   path fails toward NOT reaping, over an exhaustive table of what `/proc` can refuse to say.
3. **The watchdog says so when it stops.** One entry, outside the supervisor, on the real crontab,
   bash and system binaries only — it reports a dead scheduler through a path that shares nothing
   with the toolchain it watches.

That is WORK.md's `✅ MVP READY` line. **22 items, 16 jobs, one week.**

**Rule this plan obeys at every step: the phase is green at every commit.** `npm test` exits 0 after
every job — subject to Precondition P1 below, which is the reason it does not exit 0 today. Walk the
commits in order and no job imports a file a later job creates.

---

## Preconditions — N4 cannot start green, and the reason is not N4's

**P1 — `npm test` is RED on this checkout right now: 4 failures, all one cause.**
Measured 2026-08-26, this machine, `main`-line `dev`:

```
$ npm test
# tests 526 / # pass 520 / # fail 4 / # skipped 2 / duration_ms 10496
not ok 447 - 4. every *.test.ts file is matched by at least one glob in scripts.test
not ok 474 - 4. every package.json outside node_modules is claimed by exactly one workspaces entry, or is the root
not ok 485 - 15. .doppelganger/ holds only allowlisted entries, recursively
not ok 493 - node:sqlite is imported by exactly the allowlisted files
```

The cause is one thing wearing four hats: **J3.17's real pass left `.doppelganger/worktrees/nightly-sandcastle/`
and `.doppelganger/state/nightly.db{,-wal,-shm}` on disk, and five repo-wide walkers skip only
top-level `node_modules` and `.git`.** A pass worktree is a full second checkout, so every scanner
walks into it and finds a second `package.json`, a second `kernel/runtime/db.ts` importing
`node:sqlite`, and 40-odd `*.test.ts` files no `scripts.test` glob names. The five walkers:

| file | line | what it skips today |
|---|---|---|
| `test/commands.test.ts` | 22 | `.git`, `node_modules`, top level only |
| `test/deps.test.ts` | 17 | `.git`, `node_modules`, top level only |
| `test/layout.test.ts` | 39 | `.git`, `node_modules`, top level only |
| `test/no-raw-sqlite.test.ts` | 24 | `.git`, `node_modules`, top level only |
| `test/toolchain.test.ts` | 78 | `.git`, `node_modules`, top level only |

**Ownership ruling.** The bug belongs to N3 (J3.5 created the directory, J3.12 the pass that fills
it). J3.17/J3.18 may fix it first, and if they do **J4.1 does nothing here**. If they have not when
N4 starts, **J4.1 fixes it as its first commit**, citing the N3 IDs, because N4 cannot have an
honest baseline otherwise. It is a test-only change and touches no N3 behaviour, so it does not
collide with anything J3.17/J3.18 owns.

**N4 makes half of it structural rather than incidental**, which is why the fix cannot simply wait:
`.doppelganger/state/` gains `lease.db` (J4.3) and `quota.db` (J4.8), and `test/layout.test.ts`
assertion 15 currently declares *any* `.db` below the top level an offender. That rule was written
for a leaked test store and cannot tell one from `STATE_DIR`, which is where `dbPath()` puts every
database **by design**. J4.3 replaces it with a derived rule (below).

**P2 — N4's `§1` rows are `must-be-absent` until WORK.md marks N3 complete.**
`test/layout.test.ts` assertion 12 reads WORK.md: the first phase with an unticked box is CURRENT
and exempt; everything after it is FUTURE and **must not exist on disk**. N3's boxes are all `- [ ]`
today, so N3 is current and every `N4` row in §1 (`kernel/runtime/lease.ts`, `cli/lease-clear.ts`)
is a must-be-absent row. **Creating `kernel/runtime/lease.ts` before J3.18 ticks N3 turns assertion
12 RED.** So: **J4.1 runs after J3.18, not before.** This is a hard ordering constraint, not a
preference.

**Baseline to record in J4.1's commit body:** re-run `npm test` after P1 is resolved and write the
four numbers down. Every later job's AC1 compares against it.

---

## The nine rulings that shape every job below

### 1. Every quota state is producible without a walled account — and the fixtures are real

The reference is not the only evidence available. **This machine holds a live quota store with real
parks recorded by real runs**, and that is the primary fixture source (TST-19: lifted from REAL
data, never invented).

**Tier 1 — recorded on this machine, first-hand.** `/home/hyhilman/projects/xenith/engine/.sandcastle/state/quota.db`,
read 2026-08-26:

| key | value (verbatim) |
|---|---|
| `note:claude` | `task 502 failed: claude-code exited with code 1:\nYou've hit your org's monthly spend limit · run /usage-credits to ask your admin for a higher limit` |
| `since:claude` | `2026-08-12T03:04:13Z` |
| `note:worker:worker-nexus-{bennet,keaton,ashton}` | `claude-code exited with code 1:\nYou've hit your org's monthly spend limit · run /usage-credits to ask your admin for a higher limit` |
| `class:worker:worker-nexus-{bennet,keaton,ashton}` | `spend` |
| `since:worker:worker-nexus-bennet` | `2026-08-26T07:24:07Z` (dark 8h 13m at read time) |

The same wording appears once in `engine/.sandcastle/state/queue.db`'s `job_queue.note`. So tier 1
gives the `spend` family in **three nesting depths** — bare, `claude-code exited with code 1:\n…`,
and `task N failed: …` — which is exactly the shape our own `sandcastleRunner` produces (N3 ruling 1
measured `run()` rejecting with `claude-code exited with code 3:\nboom\n`).

**Tier 2 — recorded in the reference's own test corpus, each carrying a dated provenance comment**
(`xenith/engine/src/lib/quota.test.ts`): the `weekly`, `usage`, `monthly`, `session`, `daily` and
`5-hour` wordings, plus the six NEGATIVES that matter more than the positives —
`Validation Failed: body exceeds the 65536 character limit`, `API rate limit exceeded for user ID 1234`,
`ENOENT: …`, `gh: Not Found (HTTP 404)`, `worker blew up`, `""`. Second-hand but real; the fixture
file says so per row.

**Tier 3 — invented.** None. Every row carries `source`, `recordedAt` and `via`.

**The recheck, not a pin.** A test must never pin an exact value of something outside this repo, so
nothing asserts the reference's store still says this. Instead `QUOTA_FIXTURE_RECHECK=1` (opt-in,
never in CI — the `CORPUS_RECHECK` precedent) reads the reference store if present and reports any
`note:` wording the fixture does not classify. Default `npm test` never opens it.

**The five states, and the seam each one uses.** No sleeps, no fake timers, no clock injection
beyond an argument:

| state | how a test produces it | impurity used |
|---|---|---|
| never walled | fresh `QUOTA_DB=<tmp>`, no `pause` | none |
| walled, window live | `withWindow(60_000, () => pause(s, msg))` | `QUOTA_PAUSE_MS` read per call |
| walled, window lapsed — the probe | `withWindow(0, () => pause(s, msg))` | same |
| dark, continuous across a re-park | `metaSet("until:"+s, isoAgo(1h))` then `pause` | direct store write |
| dark ended, a NEW outage | `metaSet("until:"+s, isoAgo(3h))`, `QUOTA_DARK_GAP_MS=2h`, then `pause` | direct store write |
| lifted by hand | `clearPause(s)` | none |
| every shed branch | `decideShed(snapshot, cls, now, windowMs)` — four arguments, no I/O | none |

**And the whole loop, end to end, with no model call.** N3's layer B is a fake `claude` earlier on
`PATH` (measured 104 ms). J4.8's AC drives it: a fake `claude` that prints the tier-1 spend wording
to stderr and exits 1 → `run()` rejects → `runNamed` catches → `isLimitError` true → `pause` writes
to a throwaway `QUOTA_DB` → the next `runNamed` refuses with `quota-paused`. That is QTA-01 and
QTA-05 proved on the real path, against a real library, for free, on every commit.

### 2. The breaker has a real producer and a real consumer at N4 — both in `runNamed`

QTA-01 without a writer is a table nothing fills. The writer exists and it is the one argv path:

- **Producer.** `runNamed` catches a rejection out of `runJob`. If `isLimitError(message)` it calls
  `pause(QUOTA_SCOPE, message)`, logs `quota-parked` with `until` and `class`, and exits **0** —
  a walled account is a skipped tick, not a job failure (INV-10: a wall costs the item nothing).
  Any other rejection re-throws unchanged.
- **Consumer.** `runNamed` refuses **before** it builds a `RunRequest` when `isPaused(QUOTA_SCOPE)`,
  logs `quota-paused` with `until`, exits 0.

Both live in `runNamed`, which is **exported and tested** — never in the argv block, which no test
reaches. The argv block passes the impure pieces in.

### 3. The lease ships with no production writer, and the plan says which two candidates were declined

`reapDead` and the boot sweep are real, but nothing at N4 takes a lease. Two candidates were
considered and both were declined **for reasons, not for time**:

- **`nightly-sandcastle` takes `nightly/sandcastle@<base sha>`.** Declined: a pass that changes
  nothing leaves the base SHA where it was, so the key stays the same and `done` is terminal — the
  next of six firings a night would be refused forever until somebody else moved the SHA. A
  versioned key is only correct when the version moves for a reason unrelated to the job's own
  success, and this one does not.
- **`runNamed` takes `<job>@<minute>`.** Declined: it excludes exactly what the gate cannot (a
  hand-run beside a scheduled tick, a second instance, INS-05) — but it puts the lease DB on the
  critical path of every job at the last phase before "safe to leave alone", and "the minute" is a
  version only in the sense that croner already fires once per minute per entry. A constant key
  would be right, and a constant key needs `clear(force)` release — which is **LSE-12, moved to M9**.

So N4 ships LSE-01…11 one phase ahead of their first writer, deliberately. That is defensible in a
way a designed-from-nothing port is not: the primitive is lifted from a reference where it has ten
writers, a persisted `max_attempts` migration, and a documented 47-hour incident (XEN-8365) that
shaped `clear()`. Nothing here is being invented. **Flagged in Gaps item 3.**

The phase gate — *a killed pass does not wedge the next one* — is therefore proved by seeding a
`held` claim owned by a **real dead pid** into a throwaway `LEASE_DB` and booting the **real
supervisor as a child process** (J4.6). No spy, no fake.

### 4. `isOwnerAlive` fails toward DEAD in three branches of the reference, and ours must not

LSE-11's row is *"every branch failing toward alive"*. The reference's own code breaks it:

```ts
function processStartedAt(pid) {
  const btime = bootTimeSec();
  if (btime === null) return null;          // /proc/stat unreadable  -> reads as DEAD
  try { stat = readFileSync(`/proc/${pid}/stat`) } catch { return null }
  const ticks = Number(tail[19]);
  if (!Number.isFinite(ticks)) return null; // unparseable            -> reads as DEAD
  ...
}
function isOwnerAlive(pid, claimedAtMs) {
  const startedAt = processStartedAt(pid);
  if (startedAt === null) return false;     // <- all three collapse here
  ...
}
```

`pidNamespace()` reads `/proc/self/ns/pid`; `bootTimeSec()` reads `/proc/stat`. They are **different
files with different permissions**, so a `/proc` that answers the first and refuses the second is
reachable — `hidepid=2`, a restricted bind mount, a seccomp profile. In that state the reference's
reaper would judge **every** owner dead and force-delete every live claim on the host. Measured on
this machine that an unreadable `/proc` file is a real, distinct outcome: `/proc/1/environ` →
`EACCES`, while an absent pid → `ENOENT`.

**Ours splits the two.** `ownerLiveness()` returns a three-member union and `reapDead` acts on
exactly one member:

```ts
export type Liveness = "alive" | "dead" | "unknown";
```

| observation | verdict |
|---|---|
| `/proc/<pid>/stat` raises `ENOENT` | `dead` — the one piece of positive evidence |
| `/proc/<pid>/stat` raises anything else (`EACCES`, `EPERM`, `EIO`) | `unknown` |
| stat readable, `/proc/stat` `btime` unreadable or unparseable | `unknown` |
| stat readable, field 22 not a finite number | `unknown` |
| stat readable, `startedAt > claimedAt + 2 s` | `dead` — a recycled pid |
| otherwise | `alive` |

`reapDead` reaps on `"dead"` only. `isOwnerAlive(pid, at)` stays as a thin
`ownerLiveness(...) !== "dead"` so the row's own vocabulary survives. **The three readers are
injected** (`readNsLink`, `readBootStat`, `readProcStat`), which is what turns "fails toward alive"
from three lucky branches into a property checkable over a table.

**Measured on this host, 2026-08-26, Linux 6.8.0-136-generic:** `/proc/self/ns/pid` →
`pid:[4026531836]` · `/proc/stat` → `btime 1785088352` · absent pid → `ENOENT` · `/proc/1/environ` →
`EACCES` · USER_HZ arithmetic verified: computed self-start `2026-08-26T16:06:48.040Z` against
`now = 16:06:48.979Z`, 0.94 s apart.

### 5. `commandOf` renders `node host/watchdog.sh` — the first `script:` entry exposes a live bug

```ts
export function commandOf(e: ScheduleEntry): string {
  const target = e.job !== undefined ? `${JOB_ENTRYPOINT} ${e.job}` : (e.script ?? "");
  return `cd ${ROOT} && node ${target} >> ${e.log} 2>&1`;   // <- `node` unconditionally
}
```

`node` cannot run bash. Meanwhile `host/supervisor.ts`'s `spawnChild` renders a script as
`[join(root, e.script), []]` — **exec it directly**. The two disagree, and nothing catches it because
`SCHEDULE` has never held a `script:` entry: `host/schedule.test.ts` test 7 asserts only that the
script name survives, never that `node` is absent.

This is the same defect class as N3 F1 (`commandOf` and `jobRunner` naming two different targets,
suite green). **Same fix: ONE function, two consumers.** J4.11 extracts

```ts
export function scriptCommand(script: string): readonly [string, readonly string[]]
```

used by both `commandOf` and `spawnChild`, dispatching on the extension:

| `e.script` | rendered | why |
|---|---|---|
| `*.ts` | `node <ROOT>/<script>` | Node strips types natively (N0's J0.7 measurement) |
| `*.sh` | `<ROOT>/<script>` | its own shebang; no interpreter name to look up on `PATH` |
| anything else | `validate()` refuses | an extension nobody has ruled on |

`.sh` renders **no interpreter at all** on purpose. `bash` would be a bare-name `PATH` lookup in
cron's stripped environment — the exact hazard `assertAbsoluteCmd` exists for (N2 F1) — and
`/bin/bash` would be a hardcoded absolute path needing a door-1 exception for something that moves
between distributions. A shebang is neither. `validate()` grows two rules to make it safe:
**the script file is executable (`X_OK`)** and **its first two bytes are `#!`**. A stray `chmod -x`
silently disabling the one liveness probe on the box is precisely the failure JOB-O10 exists to
catch, so it is a boot-time refusal, not a runtime surprise.

### 6. The watchdog's delivery at N4 is cron, a file, and an exit code — and that is the honest list

There is no Slack plugin, no Jira plugin, no MCP hub and no connector before v1. **Do not invent
one.** What exists on this host at N4, and shares nothing with the toolchain the watchdog watches:

- **Path 1 — the breach file.** `.doppelganger/watchdog.breach`, written on every tick that finds a
  fault, `rm -f`'d on the first clean tick. **Presence is the alarm** (JOB-O11's rule, applied to the
  watchdog's own report): a healthy loop writes nothing, so a quiet week never trips it, which a
  staleness test would.
- **Path 2 — exit non-zero.** Cron mails a non-zero-exit job's output to `MAILTO` (or the crontab
  owner) by default. Cron is bash-free, node-free, `node_modules`-free, supervisor-free and gate-free
  — it is already the thing that runs the watchdog, so it cannot be down while the watchdog runs.
  It is a weak channel (nobody reads local mail on a laptop) and the plan says so rather than
  pretending otherwise.
- **Always — the log.** `log_error breach msg=…`, one line per fault, through `log.sh` (LOG-01's
  bash emitter, byte-identical to the TS one, TST-18). This is what `ops-log-report` (JOB-O02, **N5**)
  will read the day it exists.

**Declined at N4, each for a subject that does not exist yet**, and declined rather than shipped
vacuous — the SUP-12 precedent ("deliberately not shipped as a vacuous placeholder"):

| reference probe / knob | N4 status |
|---|---|
| probe 3 — the reporter's log is fresh | DECLINED: `ops-log-report` is JOB-O02, N5. Nothing writes the log it would stat. |
| probe 5/6 — Slack / Jira delivery stamps | DECLINED as probes: no send path exists. The **contract** ships (ruling 7). |
| `WATCHDOG_STALE_M` | DECLINED with probe 3 — a knob with no reader is a lie (KRN-06). |
| `WATCHDOG_COOLDOWN_M` | DECLINED: the cooldown rate-limits a Slack post. There is no post; the breach file is idempotent. |
| the `claude -p` fallback send | DECLINED: it would make the liveness probe cost a model call and depend on an integration that does not exist. |

**Four probes ship**, all with a real subject on this host:

1. `node_modules` is a real directory, not a symlink (the 2026-07-30 failure).
2. `node` executes AND strips types — probed by *running* `node --version` and by running a
   two-line `.ts` file, not by testing for a path. A dangling symlink is present, looks executable,
   and does not run.
3. The supervisor heartbeat (`.doppelganger/supervisor.heartbeat`, SUP-14) is younger than
   `WATCHDOG_SUPERVISOR_STALE_M` (5 = five missed 60 s beats). **This is the probe that matters** —
   a dead supervisor means nothing is scheduled at all.
4. The heartbeat **failure stamp** is absent (ruling 7).

### 7. JOB-O11's producer at N4 is `beat()`'s catch block, and the circularity is stated, not hidden

JOB-O11 says: *written on a failed send, removed on the next good one; the watchdog reports its
PRESENCE.* The only outbound signal that exists at N4 is the supervisor's heartbeat — and it already
has the exact shape:

```ts
export function beat(deps: BootDeps): void {
  try { …writeFileSync(deps.heartbeatPath, …); …writeFileSync(deps.statusPath, …) }
  catch (e) { log.warn("heartbeat-failed", { msg: errText(e) }) }   // <- to a log the watchdog cannot read
}
```

A supervisor that is **alive and scheduling fine but cannot stamp** is indistinguishable, from
outside, from one that is dead — and probe 3 reports the second. That is a live misdiagnosis in code
that exists today. So:

- `beat()` calls `deliveryStamp(deps.heartbeatFailPath)(false, errText(e))` in the catch and
  `(true)` after a successful write.
- Probe 4 reads presence and, when present, reports **"the supervisor is alive but cannot write its
  heartbeat — probe 3 above is a false alarm"** instead of "NOTHING is being scheduled".

**The circularity, stated as the row's documented limit, exactly as the reference states its own:**
a full disk kills both writes. What probe 4 *does* catch is every per-file failure — a `chmod 400`
on the heartbeat, a root-owned stamp left by a `sudo` run, a read-only bind mount over one path, an
`ENOSPC` that clears between the two writes. Two paths, two inodes; one filesystem.

**The v1 seam is a register, not an edit.** `kernel/runtime/delivery.ts` exports
`DELIVERY_STAMPS` — one row per stamp: `name`, project-relative `path`, the module that writes it,
and `why`. At N4 it has exactly **one** row. A drift gate parses `host/watchdog.sh` for the paths it
stats and asserts the two sets are equal, so the day `plugins/slack` adds a send path it adds a row
and the script must grow the probe or the build fails. Same technique as the `log.sh` ↔ `emit.ts`
byte-identity gate (TST-18) and `crontab check`.

### 8. `SHED_MODEL` cannot be a literal — `test/model.test.ts` test 6 is exact

```ts
test("6. DEFAULTS.model is reachable from exactly one file", () => {
  const withLiteral = files.filter(f => /(["'`])claude-[^"'`]*\1/g.test(read(f)));
  assert.deepEqual(withLiteral, ["kernel/ports/job.ts"]);
});
```

A `const SHED_MODEL = "claude-sonnet-5"` anywhere — including `kernel/runtime/shed.ts`, where the
reference puts it — turns that RED. **So the downshift target lands as `DEFAULTS.shedModel` in
`kernel/ports/job.ts`**, beside `DEFAULTS.model`. That is not a workaround, it is HRN-01's own rule
("`DEFAULTS` in ONE place") and it is what the reference's own comment asks for — *"kept beside
`DEFAULTS.model` rather than guessed at each call site; bump both the day `DEFAULTS.model` bumps
generation."* Tests 3 and 4 grow one assertion each so `DEFAULTS.shedModel` is held to `PINNED` and
to the alias denylist too. Test 6's allowlist does **not** grow.

`claude-sonnet-5` satisfies `PINNED` (`^claude-[a-z][a-z0-9]*(?:-\d+)+$`) and matches no `ALIASES`
entry; test 5's accepted table already carries it.

### 9. The N2 spies are replaced, not supplemented

N2 shipped `reapOnBoot` and `shouldShed` as **placement-only** proofs with injected fakes
(`host/supervisor.test.ts` tests 19, 20, 3, and the `shouldShed: () => ({ skip: false })` in every
harness). Their own headers say the predicate is N4's. N4 does not leave them beside a new test —
it **replaces the fake with the real thing** and keeps the ordering assertion:

| N2 test | N4 |
|---|---|
| 19 — `reapOnBoot` runs before the first `newTimer` | keeps the ordering; the injected fake is replaced by `realReapOnBoot`, and a **new** end-to-end child-process AC seeds a real dead-owner claim and reads `event=lease-reaped` off the real supervisor's stderr |
| 20 — a throwing reaper does not stop the boot | unchanged; a throwing fake is still the right way to prove that arm |
| 3 — `quota-shed` logs and does not spawn | keeps the shape; the injected fake is replaced by `realShouldShed` over a throwaway `QUOTA_DB` seeded to a spend wall |
| every harness's `shouldShed: () => ({ skip: false })` | stays — a per-test override is not a spy, it is a fixture |

The argv block stays untestable by construction (N2 ruling 1), so both real predicates are
**exported top-level constants** — `realReapOnBoot`, `realShouldShed` — the `realJobRunner`
precedent (N3 F1), which exists because an inline literal in the argv block regressed once with the
whole suite green.

---

## Job order

Every dependency runs forward. J4.1 must land **after J3.18** (precondition P2).

1. **J4.1** — `roadmap.md` §1/§3/§2.27 + P1's walker fix. Doc and test-only; must land first, or
   assertion 12 refuses every N4 file.
2. **J4.2** — `kernel/runtime/proc.ts`: LSE-11, the injected readers, the fails-toward-alive table.
3. **J4.3** — `kernel/runtime/lease.ts` core: LSE-01, LSE-02, LSE-04, LSE-05, LSE-06, INS-04.
   Carries the `.doppelganger/` allowlist derivation, because this is the commit that adds `lease.db`.
4. **J4.4** — `withLease`: LSE-03, and the mutation that proves the early-return path.
5. **J4.5** — `reapDead`: LSE-07, LSE-08 — the guard table.
6. **J4.6** — LSE-09: the real boot sweep, the N2 spy replaced.
7. **J4.7** — `cli/lease-clear.ts`: LSE-10.
8. **J4.8** — `kernel/runtime/quota.ts`: QTA-01, QTA-05, QTA-06, QTA-07 + the producer/consumer in
   `runNamed`.
9. **J4.9** — `kernel/runtime/shed.ts` + `host/classes.ts`: QTA-08, QTA-09, `DEFAULTS.shedModel`.
10. **J4.10** — SUP-16 wired to the real `decideShed`; the N2 spy replaced; the downshift call site.
11. **J4.11** — `scriptCommand` and the two new `validate()` rules. Must land before any `script:`
    entry.
12. **J4.12** — JOB-O09 `ops-cron-check`, its entry and its `PROGRAMS` row.
13. **J4.13** — `kernel/runtime/delivery.ts` + `beat()`'s stamp: JOB-O11.
14. **J4.14** — JOB-O10 `host/watchdog.sh`, the `ops-watchdog` entry, the bash↔`EnvSpec` gate, and
    the first non-empty crontab bootstrap block.
15. **J4.15** — TST-17: what is new versus what N2 already shipped, and the live gate contract the
    third entry makes possible.
16. **J4.16** — close N4.

---

## J4.1 — `roadmap.md` §1/§3/§2.27, and the four walkers that walk into a worktree  ·  §1, §3, KNB, LSE-11, QTA-08, JOB-O10, JOB-O11

**Goal:** make the spec name every file N4 builds with an `N4` tag so `test/layout.test.ts`
assertion 12 blesses each one as it lands; make §3's N4 `Ships:` line agree with WORK.md so
assertion 14 stays green the moment N4 becomes a shipped phase; and restore a green baseline (P1).

**Files touched:**
- `roadmap.md` — §1's layout block, §2.27's knob list, §3's N4 section
- `test/commands.test.ts`, `test/deps.test.ts`, `test/layout.test.ts`,
  `test/no-raw-sqlite.test.ts`, `test/toolchain.test.ts` — the walker fix (P1), **only if J3.18 has
  not already landed it**

**Do (§1):** add or move these rows. A row's tag is what assertion 12 reads.

```
kernel/
  runtime/
    proc.ts                 pid liveness in the CALLER's namespace (LSE-11)      v0 · N4
    lease.ts                                                                     v0 · N4   (already present)
    quota.ts  shed.ts       the account breaker and the value tiers (QTA)        v0 · N4   (MOVED from the v1 row)
    delivery.ts             the delivery stamp contract (JOB-O11)                v0 · N4
    queue.ts                                                                     v1        (what is LEFT of the old row)
host/
  classes.ts              the job value classes chore/watch/review (QTA-08)      N4
  watchdog.sh             liveness outside the supervisor, bash only (JOB-O10)   N4
  jobs/
    ops-cron-check.ts     crontab drift, logged every run (JOB-O09)              N4
cli/
  lease-clear.ts                                                                 N4        (already present)
```

`quota.ts` and `shed.ts` currently sit on the `queue.ts  quota.ts  shed.ts   v1` line, which
assertion 12 reads as three `must-be-absent` rows. Splitting the line is required, not cosmetic.

**Do (§2.27):** the Quota/shed bullet already carries `QUOTA_SCOPE`, `QUOTA_PAUSE_MS`,
`QUOTA_PAUSE_MS_<CLASS>`, `QUOTA_DARK_GAP_MS`, `QUOTA_SHED_WINDOW_MS` — no change. The Watchdog
bullet must become `WATCHDOG_SUPERVISOR_STALE_M`, `WATCHDOG_DRY_RUN`, and **must drop**
`WATCHDOG_STALE_M` and `WATCHDOG_COOLDOWN_M`, each replaced by a half-sentence naming the phase
that brings its subject (ruling 6). `test/knobs.test.ts` assertion 6 requires every shipped row's
key to appear inside `### 2.27`; nothing requires the reverse, so a stale key is invisible — which
is why it is deleted by hand here rather than left to rot.

**Do (§3):** rewrite the N4 section's three lines to what this phase actually ships.

```
### N4 — Safe to leave alone · **1 week**
`quota.ts` breaker + classes · `shed.ts` value tiers · leases · watchdog + delivery stamp.
**Ships:** QTA-01, QTA-05…09, LSE-01…11, INS-04, JOB-*, TST-17.
**Not shipped, deliberately:** QTA-02…04 (worker-side classification, release and `claimNext` — M9,
each needs the queue) · QTA-10 (M10, needs the health digest) · LSE-12 (M9, the serial-group lease
needs the queue) · JOB-O12 (M10, mutual watching needs the health job) · `ops-lease-reap` (JOB-O03,
N5 — the boot sweep is LSE-09 and lands here; the one-minute cadence does not).
**Gate:** a walled account parks and recovers inside one window · a killed pass does not wedge the
next one · every reaper guard fails toward **not** reaping.
```

The old line reads `QTA-01…10, LSE-01…12, INS-04, JOB-O09…12` and disagrees with WORK.md on six
items. Assertion 14 only checks SHIPPED phases, so this is invisible today and becomes a hard
failure the instant J4.16 ticks N4 — fix it at the start of the phase, not at the end.

**`JOB-*`, not `JOB-O09, JOB-O10, JOB-O11` — and the reason is measured, not stylistic.**
`expandShipsIds` classifies a token with three patterns and **throws by name on anything else**:

| token | classified as | verified 2026-08-26 |
|---|---|---|
| `QTA-01`, `INS-04`, `TST-17` | bare, `/^[A-Z]+-\d+$/` | ok |
| `QTA-05…09`, `LSE-01…11` | range, `/^([A-Z]+)-(\d+)…(\d+)$/` | ok |
| `JOB-*` | wildcard, `/^([A-Z]+)-\*$/` | ok — the prefix is excluded from BOTH sides |
| **`JOB-O09`** | **THROWS** — `O09` is not `\d+` | *the gate cannot classify this token* |
| **`JOB-O09…12`** | **THROWS** — same reason | |
| **`TST-17 (lease + breaker half)`** | **THROWS** — the parser's own comment names this shape | |

`workPhaseIds` has the same blind spot from the other side: its capture is `\*\*([A-Z]+-\d+)\*\*`,
so `**JOB-O09**` on a ticked WORK.md bullet is never collected either. The two blind spots agree, so
`JOB-*` is not a workaround — it is the one token that tells the gate the truth: *this phase ships
`JOB-` rows and neither side can compare them.*

**This is not only N4's problem, and J4.1 must check before it edits.** N3's Ships line already
reads `… SKL-01…10, JOB-C15, SAF-01…08, …`, and `JOB-C15` throws exactly like `JOB-O09`. **The
moment J3.18 ticks N3, assertion 14 expands N3 for the first time and throws.** If that has already
been fixed when N4 starts — by extending the parser to accept a `[A-Z]+-[A-Z]?\d+` shape, which is
the better fix — write **bare `JOB-O09, JOB-O10, JOB-O11`** here instead and record which form was
used. **Run AC3 first; it tells you which world you are in.**

**Do (P1 — only if J3.18 has not):** give all five walkers one shared exclusion. Each already skips
`.git` and `node_modules` at the top level; add `.doppelganger`, with the reason in a comment that
names the ID: *a pass worktree (HRN-12, J3.5) is a full second checkout, so a repo-wide scan finds a
second `package.json`, a second `node:sqlite` importer and forty `*.test.ts` files no glob names —
and `NIGHTLY_SANDCASTLE_MAX=0` leaves one behind by design.*

**Do NOT** touch `test/layout.test.ts` assertion 15's `.db` rule here — J4.3 owns it, because J4.3
is the commit that makes it structural.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0. Record `# tests / # pass / # fail / # skipped / duration_ms` in the
      commit body. This is N4's baseline and every later AC1 compares against it.
- [ ] AC2 — **assertion 12 accepts the new rows and would refuse a wrong one.** With N3 ticked,
      `node --test test/layout.test.ts` passes 15/15. Then change `proc.ts`'s tag from `N4` to `N5`
      and create an empty `kernel/runtime/proc.ts`; the run must fail with
      `§1 names kernel/runtime/proc.ts as N5 (not shipped, not current), but it exists on disk`.
      Delete the file and revert the tag.
- [ ] AC3 — **the Ships line is parsed, not just written — and run this FIRST.** Temporarily tick
      every N4 box in WORK.md and run `node --test test/layout.test.ts`; assertion 14 must pass.
      Untick them and confirm `git diff WORK.md` is empty. This is the only way to exercise assertion
      14 against N4 before J4.16, and it decides which `JOB-` token shape to write:
      - **assertion 14 passes with `JOB-*`** → the parser is unchanged; keep `JOB-*`.
      - **assertion 14 throws `cannot classify … "JOB-C15"` while expanding N3** → J3.18 has ticked
        N3 and the parser was not extended. That is N3's bug surfacing, not N4's; **record it, do not
        fix it here**, and keep `JOB-*` so N4's own line is at least well-formed.
      - **assertion 14 passes with bare `JOB-O09`** → the parser was extended; use the bare form and
        say so in the commit body.
      Record which of the three happened. **This AC's output decides the previous `Do` step.**
- [ ] AC4 — **the knob doc gate still binds.** `node --test test/knobs.test.ts` passes. Then delete
      `QUOTA_DARK_GAP_MS` from §2.27 and re-run: it must still pass **today** (no row names it yet),
      which records that assertion 6 is a one-way gate. Restore.
- [ ] AC5 — **P1's fix is proved by the failure it removes.** Before: `npm test` reports the four
      failures named in Precondition P1 while `.doppelganger/worktrees/nightly-sandcastle/` exists.
      After: 0 failures with the directory still present. Then delete `.doppelganger` from
      `test/no-raw-sqlite.test.ts`'s skip list alone and re-run — that one test must go red naming
      `.doppelganger/worktrees/nightly-sandcastle/kernel/runtime/db.ts`. Revert. (If J3.18 landed
      this, record that instead and mark AC5 satisfied by J3.18's commit sha.)

**Commit:** `roadmap: name N4's modules in §1, fix §3's Ships list, drop two knobs with no subject (§1, §3, KNB)`

**Depends on:** J3.18 (precondition P2 — hard).

**Risks / what could be wrong:**
- **§3's `Not shipped, deliberately` block is prose and nothing checks it.** Assertion 14 compares
  the `Ships:` line only. A row moved out of WORK.md but left in the prose rots silently. Flagged in
  Gaps item 8.
- **AC3 requires editing WORK.md's N4 boxes temporarily.** They are N4's own boxes, not N3's, so
  this does not touch anything J3.18 owns. Untick before committing; `git diff WORK.md` must be
  empty at commit time.

---

## J4.2 — `kernel/runtime/proc.ts`: liveness that fails toward alive, as a property  ·  LSE-11

**Goal:** answer the one question a TTL cannot — is the process that claimed this lease still
running — and be wrong only in the direction that costs a TTL, never in the direction that deletes a
live worker's lock.

**Files touched:**
- `kernel/runtime/proc.ts` (new)
- `kernel/runtime/proc.test.ts` (new)
- `test/writes.test.ts` — three `DOOR1_EXCEPTIONS` rows

**Do:**

```ts
export type Liveness = "alive" | "dead" | "unknown";

export interface ProcReaders {
  /** `/proc/self/ns/pid` -> "pid:[4026531836]". Throws or returns junk on a hardened /proc. */
  readonly readNsLink: () => string;
  /** `/proc/stat`, for the `btime <seconds>` line. */
  readonly readBootStat: () => string;
  /** `/proc/<pid>/stat`. ENOENT means absent IN THIS NAMESPACE — see the header. */
  readonly readProcStat: (pid: number) => string;
}

export const realReaders: ProcReaders;
export function pidNamespace(readers?: ProcReaders): string | null;
export function ownerLiveness(pid: number, claimedAtMs: number, readers?: ProcReaders): Liveness;
export const isOwnerAlive = (pid: number, claimedAtMs: number, r?: ProcReaders): boolean =>
  ownerLiveness(pid, claimedAtMs, r) !== "dead";
```

- **`USER_HZ = 100`**, hardcoded with the reference's own reason kept: it is the `/proc` interface's
  fixed unit on every Linux architecture, not the kernel's `CONFIG_HZ`. Shelling out to
  `getconf CLK_TCK` would be a subprocess per reaped row to read a constant.
- **`START_SLACK_MS = 2_000`.** `nowIso()` is second-granular and `/proc` counts in 10 ms ticks, so a
  process is only judged recycled when it started **demonstrably** after the claim.
- **The parse anchors at the LAST `)`.** Field 2 of `/proc/<pid>/stat` is the executable name,
  unquoted, parenthesised, and free to contain spaces and parens — `(n (o d) (e))` is a legal
  `comm`. Splitting the whole line on whitespace mis-indexes every field after it, silently, for
  exactly the processes whose names are unusual enough that nobody tests them. `tail[0]` is field 3,
  so `starttime` (field 22) is `tail[19]`.
- **The verdict table is ruling 4's, verbatim**, and it is the module's whole content. Every arm
  that is not `ENOENT` or a demonstrably-later start returns `"unknown"`.
- **`pidNamespace()` returns `null` when `/proc` will not say**, and every caller treats null as
  "reap nothing" — which is also the correct no-op on a non-Linux host.

**Do (door 1):** `proc.ts` names three absolute paths that are not write targets. Sign them:

```ts
{ file: "kernel/runtime/proc.ts", literal: '"/proc/self/ns/pid"', count: 1,
  why: "the pid-namespace inode link - a kernel interface read, not a write path (LSE-11)" },
{ file: "kernel/runtime/proc.ts", literal: '"/proc/stat"', count: 1,
  why: "the kernel boot-time origin /proc/<pid>/stat counts from - a read (LSE-11)" },
{ file: "kernel/runtime/proc.ts", literal: "`/proc/${pid}/stat`", count: 1,
  why: "one process's stat line - the ONE positive liveness read (LSE-11)" },
```

Door 3 is untouched: `readFileSync` and `readlinkSync` are not in `WRITE_MEMBERS`, and correctly so.

**Do (tests):** `kernel/runtime/proc.test.ts`.

1. **The table.** Every cell of ruling 4's matrix, driven with injected readers — 4 outcomes
   (`ok`, `throws ENOENT`, `throws EACCES`, `returns junk`) × 3 readers, plus the recycled-pid case.
   Assert `ownerLiveness` returns `"dead"` in exactly two cells and `"alive"`/`"unknown"` everywhere
   else, as a `deepEqual` over the whole grid — one assertion, not thirteen.
2. **`pidNamespace` against the real `/proc`** returns a bare digit string. Recorded, never pinned:
   this host answered `4026531836` on 2026-08-26 and the test asserts `/^\d+$/`.
3. **A real dead pid reads `"dead"`.** `spawnSync("/bin/sh", ["-c", "echo $$"])` yields a pid that
   ran and exited — a genuinely dead owner, not a number chosen to look dead.
4. **This process reads `"alive"`** against its own start time.
5. **A pid that started AFTER the claim reads `"dead"`** — `ownerLiveness(process.pid, 0)`. This
   process began long after epoch 0, so a claim dated then cannot be ours.
6. **The comm-with-parens fixture.** `symlinkSync(process.execPath, join(tmp, "n (o d) (e)"))`,
   spawn it, wait for it to speak (so `/proc` is read after the exec that names it, never between
   the fork and the exec), assert `comm` matches `/[ )]/` — *the fixture has teeth* — and that the
   computed start sits inside `[before - 2 s, after + 2 s]`. **Bounded, never equated:** `btime` is
   whole seconds and `/proc` counts in 10 ms ticks, but a mis-indexed field misses by hours.
7. **`/proc/stat` unreadable does not make a live pid dead.** `readBootStat: () => { throw enoent() }`
   with a real, running pid → `"unknown"`, and `isOwnerAlive` → `true`. **This is the branch the
   reference gets wrong** (ruling 4); the assertion carries that sentence.
8. **EACCES is not ENOENT.** `readProcStat: () => { throw eacces() }` → `"unknown"`, never `"dead"`.
   Measured reachable on this host: `/proc/1/environ` raises `EACCES`.
9. **`realReaders` is what production uses.** Assert `ownerLiveness(process.pid, Date.now())` with no
   readers argument is `"alive"` — the default parameter is exercised, not just the injected path.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/proc.test.ts` reports 9 passing.
- [ ] AC2 — **the fails-toward-alive property fires.** Change the `EACCES` arm of `ownerLiveness`
      from `"unknown"` to `"dead"`. `npm test` exits non-zero on tests 1 and 8. Revert.
- [ ] AC3 — **the btime arm fires.** Change `readBootStat`'s failure arm from `"unknown"` to
      `"dead"`. `npm test` exits non-zero on tests 1 and 7. Revert.
- [ ] AC4 — **the last-`)` anchor fires.** Replace `stat.slice(stat.lastIndexOf(")") + 2).split(" ")`
      with `stat.split(" ")` and re-index. `npm test` exits non-zero on test 6 only — tests 3, 4 and
      5 stay green, because `node` is a single token and the naive parse agrees with the correct one
      on every process this suite otherwise spawns. **Record which tests went red**; if test 6 is not
      among them the fixture has lost its teeth.
- [ ] AC5 — **the recycled-pid slack is not a rounding artefact.** Set `START_SLACK_MS = 0` and run
      test 4 fifty times (`for i in $(seq 50); do node --test kernel/runtime/proc.test.ts; done`).
      Record how many runs flake. Restore `2_000` and record zero flakes over the same fifty.
- [ ] AC6 — `node --test test/writes.test.ts` passes: door 1's three signed rows match exactly. Then
      add a fourth copy of `"/proc/stat"` to `proc.ts` in a value position; door 1 must go red with
      `signed literal "/proc/stat" appears 2x, signed for 1`. Revert.

**Commit:** `proc: pid liveness that fails toward alive, as a checkable property (LSE-11)`

**Depends on:** J4.1.

**Risks / what could be wrong:**
- **`Liveness` is a three-member union where the roadmap says a boolean.** LSE-11's row says "every
  branch failing toward alive" and a boolean cannot express the difference between *I read a live
  process* and *I could not read at all* — which is the difference between a reap and a skip.
  `isOwnerAlive` is kept as the boolean face so callers and the row still agree. Flagged in Gaps
  item 2.
- **Test 6 spawns a real child and symlinks the real `node`.** It writes only inside its own
  `mkdtempSync` directory and kills the child in a `finally`. `test/layout.test.ts` assertion 13
  (no stray `.db*` in the checkout) and N1 F4's rule (a test leaves nothing behind) both apply; the
  temp directory is removed in `after()`.

---

## J4.3 — `kernel/runtime/lease.ts`: the mutex, the owner, the attempts brake  ·  LSE-01, LSE-02, LSE-04, LSE-05, LSE-06, INS-04

**Goal:** a SQLite lease over `scope` + `key` where the whole test-and-set is ONE statement, `done`
is terminal at any horizon, and an owner string carries enough to be checked later by a reaper that
refuses to guess.

**Files touched:**
- `kernel/runtime/lease.ts` (new)
- `kernel/runtime/lease.test.ts` (new)
- `host/jobs/nightly-sandcastle.ts` — `DB_NAMESPACES` gains `"lease"`
- `test/layout.test.ts` — assertion 15's `.db` rule becomes derived (see below)

**Do (the store):**

```ts
export const NS = "lease";
export type LeaseStatus = "held" | "done" | "failed";
export interface Lease { scope; key; owner; claimedAt; expiresAt; attempts }
export interface LeaseRow extends Lease { status; note; updatedAt; maxAttempts }
export type RefusedReason = "held" | "done" | "exhausted";
export type AcquireResult = { ok: true; lease: Lease } | { ok: false; reason: RefusedReason; current: LeaseRow | null };

export function leaseDb(): Db;                       // openDb(dbPath(NS)) + migrate
export function read(scope, key): LeaseRow | null;
export function acquire(scope, key, opts?): AcquireResult;
export function renew(lease, ttlMs?): boolean;
export function release(lease, outcome?): boolean;
export function clear(scope, key, opts?: { force?: boolean }): number;
export function heldCount(scope): number;
export function list(scope?): LeaseRow[];
```

- **One migration step, not two.** The reference's second step (`ALTER TABLE … ADD COLUMN
  max_attempts`) is a historical fact of *its* database, not of ours; ours declares the column in
  step 1. The `STEPS` array stays **append-only** from here (DBS-02) and the header says so.
- **`max_attempts` is persisted**, because otherwise a `failed` row cannot be told apart from one
  still retryable without a registry of every scope's own cap.
- **`acquire` is ONE statement** — `INSERT … ON CONFLICT(scope, key) DO UPDATE … WHERE
  lease_claim.status <> 'done' AND lease_claim.expires_at <= excluded.claimed_at AND
  lease_claim.attempts < ?`. A read-then-write leaves a window where two ticks both see the key
  free, which is the exact bug the primitive exists to prevent. The refusal REASON is re-read
  afterwards, and nothing is being decided there, so that race is moot.
- **LSE-02, `done` is terminal at any horizon.** `status <> 'done'` in the WHERE is the whole rule.
  Deletion (`clear`) is the only way back, and the header names XEN-8365 as why that is deliberate
  rather than a bug.
- **LSE-05, `capped` is distinct from `held`.** The refusal maps to `"exhausted"` when
  `attempts >= maxAttempts` **and** the row has expired — an unexpired over-attempt row is still
  somebody's live claim and reads `"held"`.
- **`release`'s owner guard is load-bearing.** A worker whose lease was stolen must not be able to
  mark the key done underneath its successor: `WHERE … AND owner = ? AND status = 'held'`.
- **`clear` refuses a `held` claim unless `force`.** Deleting one lets a second runner start beside
  the first — the exact race the primitive prevents. `force` is for an owner known dead.

**Do (INS-04, the owner — five fields, not four):**

```ts
const newOwner = (): string =>
  `${INSTANCE}:${hostname()}:${pidNamespace() ?? "?"}:${process.pid}:${randomUUID().slice(0, 8)}`;

export interface OwnerId { instance: string; host: string; pidns: string; pid: number }
export function parseOwner(owner: string): OwnerId | null;
```

- **The instance leads.** INS-04's own words: without it `lease-clear` shows a `held` claim with no
  way to tell which checkout owns it, while LSE-07's guards correctly refuse to touch it — a stuck
  key no operator can safely attribute.
- **The split is unambiguous by construction.** `kernel/instance.ts`'s `NAME_RE` is
  `/^[a-z][a-z0-9_-]{0,63}$/` and its own header already says why: *"a token with no `:` so LSE-06's
  `<instance>:<host>:<pidns>:<pid>:<uuid8>` stays splittable on `:`"*. Hostnames cannot contain `:`
  (RFC 1123). The uuid8 is hex.
- **`parseOwner` returns `null` for anything not in the exact five-field shape** — including the
  reference's own four-field owner. It validates `instance` against INS-01's rule, `pidns` and `pid`
  as digit strings, and every part as non-empty. A hostname that somehow contained a `:` yields six
  parts → `null` → not reapable, which fails toward not reaping.
- **The uuid is what makes it per-ACQUISITION, not per-process** — a stolen-from zombie must fail to
  release. The first four fields are what make the pid checkable later, and all four are needed.

**Do (`DB_NAMESPACES`):** add `"lease"`. `test/skills.test.ts` assertion 11 derives the required set
from every real `dbPath(` call site and asserts `DB_NAMESPACES` is a superset — adding
`dbPath("lease")` without the constant turns it red by name. The knock-on is correct and wanted:
`nightly-sandcastle`'s tier-4 dry run now points `LEASE_DB` at its scratch directory, so a dry run
can never touch the live lease store. `kernel/paths.ts`'s doc comment already says `dbPath("lease")`
as an EXAMPLE; assertion 11 strips comments first, so it does not widen the set.

**Do (assertion 15's `.db` rule — the structural half of P1):** replace

```ts
if (!top && /\.db(-wal|-shm)?$/.test(entry.name)) offenders.push(...)
```

with a rule that knows what `STATE_DIR` is for: **a `.db` file directly inside `state/` is
legitimate iff its stem is a real `dbPath(` argument; a `.db` anywhere else under `.doppelganger/`
is an offender.** The legitimate set is **derived by the same call-site scan `test/skills.test.ts`
assertion 11 already performs**, not written by hand beside the code it describes — the standing
rule ("never assert a list the same commit writes"). Lift that scan into a shared helper both files
import, so one scanner bug cannot blind two gates in opposite directions.

**Do (tests):** `kernel/runtime/lease.test.ts`, `LEASE_DB` redirected to a `mkdtempSync` file,
`closeAll()` + `rmSync` in `after()`.

1. `acquire` on a free key succeeds; a second `acquire` while live is refused `"held"` and reports
   the current row.
2. **The window is the only thing that makes a claim stealable.** `ttlMs: 1`, then a second
   `acquire` succeeds and `attempts` is 2.
3. **LSE-02, at any horizon.** `release(lease, { status: "done" })`, then `acquire` with
   `ttlMs: -10_000_000` (an expiry far in the past) is still refused `"done"`.
4. **LSE-05.** `maxAttempts: 2` — the third expired re-acquire is refused `"exhausted"`, distinct
   from `"held"`, and the persisted `max_attempts` is 2 on the row.
5. **An unexpired over-attempt row reads `"held"`, not `"exhausted"`** — the discriminator is the
   expiry, not the counter alone.
6. **`release`'s owner guard.** A hand-built `Lease` with a different `owner` cannot settle the row;
   `release` returns false and the status is unchanged.
7. **`failed` self-expires; `done` does not.** After `release(…, "failed")` the row's `expires_at`
   is `now`, and `acquire` succeeds. After `done` it does not, whatever the expiry.
8. **`clear` refuses a `held` claim, deletes it with `force`, and reports the row count.**
9. **`heldCount` counts live claims in one scope only** — the number a concurrency cap gates on,
   and the reason LSE-12's serial group needs its own scope (M9).
10. **LSE-04, the two key shapes.** A versioned key (`repo#7@abc1234`) and a constant key
    (`serial:checklist`) in the same scope do not collide, and the versioned one is a NEW key when
    the version moves — asserted as behaviour, with the opposite release rules named in a comment
    and the constant-key half pointed at LSE-12/M9.
11. **INS-04's format**, five fields, `parseOwner` round-trips its own `newOwner()` output.
12. **`parseOwner` refuses**: the reference's four-field owner, a non-numeric `pidns`, a non-numeric
    `pid`, an empty instance, an instance with a capital letter, `""`, and a six-field string. One
    `deepEqual` over a table of eight, all `null`.
13. **The migration is idempotent** — `leaseDb()` twice creates nothing new and leaves
    `lease_meta.schema_version` at 1.
14. **DBS-02's prefix enforcer is live**: every object the migration creates starts `lease_`.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/lease.test.ts` reports 14 passing.
- [ ] AC2 — **LSE-02 fires.** Delete `AND lease_claim.status <> 'done'` from the ON CONFLICT WHERE.
      `npm test` exits non-zero on tests 3 and 7. Revert.
- [ ] AC3 — **the attempts brake fires.** Delete `AND lease_claim.attempts < ?` (and the bound
      parameter). `npm test` exits non-zero on test 4. Revert.
- [ ] AC4 — **the owner guard fires.** Delete `AND owner = ?` from `release`'s WHERE. `npm test`
      exits non-zero on test 6. Revert.
- [ ] AC5 — **the five-field shape is enforced, not assumed.** Change `parseOwner`'s
      `parts.length !== 5` to `< 4`. `npm test` exits non-zero on test 12 (the four-field row).
      Revert.
- [ ] AC6 — **the namespace scan fires.** Remove `"lease"` from `DB_NAMESPACES`. `npm test` exits
      non-zero on `test/skills.test.ts` assertion 11 with
      `dbPath( name(s) not covered by DB_NAMESPACES: lease`. Restore.
- [ ] AC7 — **the derived `.db` rule fires in both directions.** With `.doppelganger/state/lease.db`
      present (create it by running test 1 with `LEASE_DB` unset — no: instead `touch
      .doppelganger/state/lease.db`), `node --test test/layout.test.ts` passes. Then
      `touch .doppelganger/state/leek.db` — assertion 15 must go red naming `state/leek.db`. Then
      `touch .doppelganger/runs/lease.db` — it must go red naming `runs/lease.db`, because the stem
      is legitimate but the directory is not. Delete all three.
- [ ] AC8 — **the single-statement claim is real.** Add a `console.trace`-free counter around
      `write()` and assert `acquire` issues exactly one `INSERT`; simpler equivalent: assert the
      module source contains no `SELECT … FOR` pattern and that `acquire`'s body has exactly one
      `write(` call before its `if (changes === 1)`. Record which form was used.

**Commit:** `lease: SQLite mutex, terminal done, attempts brake, five-field owner (LSE-01/02/04/05/06, INS-04)`

**Depends on:** J4.2 (the owner needs `pidNamespace`).

**Risks / what could be wrong:**
- **`INSTANCE` is read at import.** `kernel/instance.ts` computes it once at module load from
  `process.cwd()`. A test that redirects `INSTANCE` after importing `lease.ts` gets the old value.
  Every test that cares must set it in a `spawnSync` child (the `scrubbedChild` pattern
  `test/knobs.test.ts` already uses) or accept the checkout's own name. Test 11 asserts the SHAPE and
  that field 1 equals the imported `INSTANCE`, never a literal.
- **AC7's third case depends on `runs/` existing.** Create it if absent; delete it again only if
  this AC created it.

---

## J4.4 — `withLease`: the 47-hour trap, kept and documented  ·  LSE-03

**Goal:** acquire → run → release with a heartbeat, so a slow task keeps its claim without a TTL
sized for the worst case — and so the ONE behaviour that cost 47 hours in the reference is
reproduced deliberately, tested by name, and impossible to lose to a refactor.

**Files touched:**
- `kernel/runtime/lease.ts` — `withLease`, `WithLeaseResult`
- `kernel/runtime/lease.test.ts` — a `describe("withLease")` block

**Do:**

```ts
export type WithLeaseResult<T> =
  | { ran: true; result: T; lost?: true }
  | { ran: false; reason: RefusedReason | "capped"; current?: LeaseRow | null };

export async function withLease<T>(
  scope: string,
  key: string,
  fn: (lease: Lease, signal: AbortSignal) => Promise<T>,
  opts?: AcquireOptions & {
    maxConcurrent?: number;
    settle?: (r: T) => Exclude<LeaseStatus, "held"> | { status: Exclude<LeaseStatus, "held">; note?: string };
  },
): Promise<WithLeaseResult<T>>;
```

- **LSE-03, stated in the header as a TRAP and not as a feature.** *`withLease` settles `done` on any
  non-throwing return, early returns included.* Measured in the reference 2026-07-31: XEN-8365's plan
  was drafted, the post failed, `handle` returned early, the lease went `done` with the row still
  `routed`, and nothing would ever have retried it — 47 hours. The row says **documented, not
  silently fixed**, and this is why: a handler that returns normally has told the caller it finished,
  and a primitive that second-guesses that would settle nothing for the handlers that genuinely did.
  `settle` is the escape hatch for callers that can tell the difference, and every future caller's
  review checklist starts here.
- **A throw releases `failed`**, leaving the key retryable and bounded by `maxAttempts`.
- **The heartbeat is the ONLY notice a runner gets that it was stolen from**, so it is not discarded:
  `renew` returning false stops the interval, aborts `fn`'s `signal`, and **nothing settles a key
  this process no longer holds** — settling it is the double-run the primitive exists to prevent, and
  the successor is mid-task on it. `fn` is told rather than killed: it may be mid-write, and only it
  knows where stopping is safe.
- **The interval is `unref`'d** — a pending heartbeat must never hold the process open after the job
  is done. Period is `max(ttl / 3, 30_000)`.
- **`maxConcurrent` checks `heldCount(scope)` BEFORE `acquire`** and returns `"capped"`, which is a
  distinct reason from every refusal `acquire` can produce.

**Do (tests):**

15. **A handler that returns a value settles `done`.**
16. **LSE-03 — a handler that returns EARLY, having done nothing, ALSO settles `done`, and the key is
    then terminal.** The handler is `async () => { return; }`; the assertion is on `read(...)`'s
    status being `"done"` **and** on a following `acquire` being refused `"done"`. The test's own
    name carries `LSE-03` and `XEN-8365`.
17. **`settle` maps a result to `failed`, and the key is retryable.**
18. **A throw releases `failed` and re-throws unchanged** — `assert.rejects` on the original error
    identity, not just its message.
19. **A stolen lease aborts the signal and settles nothing here.** Steal it mid-run with
    `clear(scope, key, { force: true })` plus a fresh `acquire` by a hand-built owner; drive the
    heartbeat with `ttlMs` small enough that the interval fires (`ttlMs: 90` → period 30 s… no:
    the period floor is 30 s, so **inject the beat** rather than waiting). `withLease` takes an
    optional `beatMs` in `opts` for exactly this, defaulted to the real formula, and the test passes
    `beatMs: 5`. Assert `{ ran: true, lost: true }` and that the successor's row is untouched.
20. **`maxConcurrent` returns `"capped"`** without touching the row, and `"capped"` is not
    `"held"`.
21. **The interval does not keep the process alive.** A child process (`scrubbedChild` shape) that
    calls `withLease` with a long TTL and returns exits within 5 s of its own accord. Direction:
    **upper bound**, with the reason recorded — this guards "somebody deleted `.unref()`", not "the
    machine was busy". Measured headroom to be recorded in the commit body.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/lease.test.ts` reports 21 passing.
- [ ] AC2 — **the early-return path is covered, and exactly one test covers it.** Change
      `release(got.lease, …)` to `if (result !== undefined) release(got.lease, …)`. `npm test` must
      exit non-zero on **test 16 only**. Record which tests went red.
      - If **zero** go red, the early-return case is not exercised — the fixture handler returns a
        value somewhere it should not.
      - If **more than one** goes red, the fixture is not discriminating: another test's handler also
        returns `undefined`, so test 16 proves nothing that its neighbour does not.
      This is the mutation Q3 asks for, and the AC is the count, not merely the redness.
- [ ] AC3 — **the stolen-lease path settles nothing.** Delete the `if (lost.signal.aborted) return …`
      guard so the settle runs anyway. `npm test` exits non-zero on test 19 with the successor's row
      marked `done`. Revert.
- [ ] AC4 — **the throw path releases `failed`, not `done`.** Change `{ status: "failed" }` to
      `{ status: "done" }` in the catch. `npm test` exits non-zero on test 18's follow-up acquire.
      Revert.
- [ ] AC5 — **`unref` is load-bearing.** Delete `beat.unref()`. `npm test` exits non-zero on test 21
      (the child never exits, and the test's own timeout fires). Record the observed duration.
      Revert.

**Commit:** `lease: withLease settles done on any non-throwing return, early ones included (LSE-03)`

**Depends on:** J4.3.

**Risks / what could be wrong:**
- **`beatMs` is a test seam in a production signature.** N2's ruling 2 says impure values arrive
  through `deps` with no default; this is a scalar with a derived default, closer to
  `SUPERVISOR_SPAWN_STAGGER_MS`. It is documented as *derived, overridable, and the only way to
  observe the steal path without a 30-second test*. The alternative — a 30 s sleep — is banned by the
  no-unlisted-timing-bounds rule.
- **Test 19 fabricates a successor by hand.** There is no second process; the successor is a
  hand-built owner string. That is the same honest limit `lease-reap.test.ts` states for its
  foreign-namespace case, and it is written into the test's header.

---

## J4.5 — `reapDead`: the guard table, every guard failing toward not reaping  ·  LSE-07, LSE-08

**Goal:** delete live claims whose owning process is gone, so the key is reusable NOW rather than at
expiry — and be able to say, guard by guard, why every other row was left alone.

**Files touched:**
- `kernel/runtime/lease.ts` — `reapDead`, `Reaped`, `REAP_GRACE_MS`
- `kernel/runtime/lease-reap.test.ts` (new — a separate file, because the emphasis is different:
  every assertion here is about a SKIP)

**Do:**

```ts
export interface Reaped { scope; key; owner; pid: number; claimedAt: string; ttlLeftMin: number }
export function reapDead(opts?: { now?: number; readers?: ProcReaders }): Reaped[];
```

**The guard table, in order. Every row is a SKIP, and the order is cheapest-and-most-decisive first:**

| # | guard | why it fails toward NOT reaping |
|---|---|---|
| 0 | `pidNamespace() === null` → return `[]` | liveness is unknowable here (no `/proc`, a hardened one, a non-Linux host). Reaping nothing is the correct no-op. |
| 1 | `row.status !== "held"` | `done` is terminal by design (that IS the dedup) and `failed` self-expires. Neither blocks anyone. |
| 2 | `expiresAt` unparseable or `<= now` | an EXPIRED claim is already stealable by `acquire`, so deleting it buys no latency and LOSES the crash-loop brake: `attempts` would reset. A claim expired AND out of attempts is the `exhausted` poison pill, held for a person to look at. |
| 3 | `parseOwner(row.owner) === null` | **LSE-08.** We were never told enough to judge it. Not reapable, never guessed — it ages out on the TTL exactly as it always did, which is what makes a deploy self-limiting rather than a flag day. |
| 4 | `id.instance !== INSTANCE` | another checkout on this host owns it (INS-04). Two instances never coordinate (INS-05). |
| 5 | `id.pidns !== ns` | **the load-bearing one.** A pid only means something inside the `/proc` that issued it. A container run `--uts=host` matches on hostname while keeping its own pid namespace, and every one of its live claims then reads as a dead pid. |
| 6 | `id.host !== hostname()` | not ours to judge. |
| 7 | `now - claimedAt < REAP_GRACE_MS` (30 s) | a claim is written before its worker has done anything observable; a sweep landing in that window would read a still-forking process as dead. |
| 8 | `ownerLiveness(id.pid, claimedAt) !== "dead"` | J4.2's whole content: `"unknown"` is not `"dead"`. |
| 9 | `clear(scope, key, { force: true }) === 0` | somebody else got there first. |

Only a row that survives all ten is reaped, and it is reaped with `force` **because it is `held` —
that is the whole point**. The guards above are what earn the `force`, and the header says so: this
is not the same operation as a hand-typed `lease-clear --force`.

`ttlLeftMin` is reported per reaped row — **what the wedge would otherwise have cost**. It is the
field that makes a real fault visible in a log line that is otherwise routine (a planned restart
reaps too).

**Guard 4 is ours, not the reference's.** The reference's owner has no instance field, so it cannot
draw this line; INS-04 exists precisely so `lease-clear` can attribute a stuck key. Adding the guard
is what makes the field load-bearing rather than decorative.

**Do (tests):** `LEASE_DB` redirected; a `seed(key, owner, opts)` helper that goes through `acquire`
with an explicit `owner`, bypassing `newOwner`; `deadPid()` = `spawnSync("/bin/sh", ["-c", "echo $$"])`.

1. **Reaps a live-but-orphaned claim and reports the TTL it cut short.** `ttlLeftMin > 0`, the row is
   GONE (not marked), and the reaped record names the pid.
2. **Leaves a claim whose owner is still running** (`process.pid`).
3. **Leaves a dead pid in ANOTHER pid namespace** (`${NS}+1`). The hazard the hostname guard alone
   would miss: same host, own `/proc`. Asserted with a hand-written owner **because there is no way
   to produce one from inside this test's namespace — which is precisely why the namespace has to be
   recorded at claim time rather than inferred at reap time.**
4. **Leaves a dead pid belonging to another host.**
5. **Leaves a dead pid belonging to another INSTANCE** — guard 4, the row the reference cannot test.
6. **LSE-08: leaves a four-field (reference-shaped) owner to age out on its TTL.**
7. **Leaves a claim younger than `REAP_GRACE_MS`** — `now` unshifted, the row written milliseconds
   ago.
8. **Leaves an ALREADY-EXPIRED claim, so `attempts` keeps braking a crash loop.** Assert
   `attempts === 1` afterwards, not merely that the row survives.
9. **Leaves terminal claims alone** — `done` stays `done`, `failed` is not in the reaped set.
10. **Returns `[]` when the namespace is unknowable**, driven with an injected `readNsLink` that
    throws, and asserts the table is unchanged by count.
11. **`"unknown"` liveness is not `"dead"`** — a dead pid with `readProcStat` throwing `EACCES`
    survives. This is J4.2's property reaching the one caller that acts on it.
12. **The whole guard table as ONE grid.** Seed twelve rows, one per guard, run one sweep, and
    `deepEqual` the reaped key list against the single key that should have gone. A per-guard test
    proves each arm; this proves no arm is reachable by accident from another row's state.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/lease-reap.test.ts` reports 12 passing.
- [ ] AC2 — **each guard fires.** Delete guards 2, 3, 4, 5, 6, 7 and 8 **one at a time**, run
      `npm test` after each, and record the test number that went red for each. Seven mutations,
      seven distinct reds. A guard whose deletion turns nothing red is decoration and must get a
      test before this job closes.
- [ ] AC3 — **the grid is not a duplicate.** With every guard restored, delete test 12 and re-run:
      the suite stays green (so 12 adds no coverage of its own arms) — then restore 12, delete
      guards 5 and 7 **together**, and confirm test 12 goes red where the per-guard tests report two
      separate failures. Record both observations. This is what distinguishes "twelve tests" from
      "one table".
- [ ] AC4 — **`force` is what earns the reap.** Change `clear(..., { force: true })` to
      `clear(...)`. `npm test` exits non-zero on test 1 — a `held` row is never deleted without it.
      Revert.
- [ ] AC5 — **the grace window is measured, not assumed.** Run test 7 twenty times and record how
      many pass. Then set `REAP_GRACE_MS = 0` and record how many pass. The second number must be 0.
- [ ] AC6 — `node --test kernel/runtime/lease.test.ts` still reports 21 passing: J4.5 adds behaviour
      and changes none.

**Commit:** `lease: reapDead's guard table, every guard failing toward not reaping (LSE-07, LSE-08)`

**Depends on:** J4.4.

**Risks / what could be wrong:**
- **`deadPid()` can be recycled between the spawn and the sweep.** The window is microseconds and a
  recycled pid reads as ALIVE (guard 8's recycled arm), so the failure mode is a flaky *skip*, never
  a wrong reap. AC5's twenty runs are the measurement that says how flaky.
- **Guard 4 changes `reapDead`'s semantics on a shared host.** A second checkout's claims are now
  skipped where the reference would have reaped them. That is INS-05 applied, and it means a stale
  claim from a deleted checkout needs `lease-clear --force` (J4.7) rather than a sweep. Named in the
  header and in J4.7's usage text.

---

## J4.6 — LSE-09: the real sweep on boot, and the N2 spy replaced  ·  LSE-09, SUP-15

**Goal:** the supervisor runs the same sweep on boot, before registering any timer — for real, on
the real argv path, proved by a claim it actually deletes.

**Files touched:**
- `host/supervisor.ts` — `realReapOnBoot`, and the argv block wires it
- `host/supervisor.test.ts` — test 19 loses its fake; a new end-to-end test lands

**Do:**

```ts
/** LSE-09's real sweep. Exported top-level so a test can pin it — the argv block below is
 *  untestable by construction (N2 ruling 1), and N3 F1 is the precedent: an inline literal there
 *  regressed once with the whole suite green. */
export const realReapOnBoot = (): Iterable<Record<string, string | number>> =>
  reapDead().map((r) => ({ scope: r.scope, key: r.key, pid: r.pid, claimed: r.claimedAt, ttlLeftMin: r.ttlLeftMin }));
```

and in the argv block, `reapOnBoot: realReapOnBoot` replacing the absent field.

- **`reapOnBoot?` stops being optional.** N2 made it optional because it had no implementation; it
  now has one, and an optional field is a field a future argv-block edit can drop in silence. Make it
  **required** on `BootDeps`. Every test harness already supplies one.
- **The ordering does not change and its test does not move.** `main()` already calls the sweep
  between `validate()` and the first `newTimer`, wrapped so a throw becomes `lease-reap-failed` at
  `warn` and the boot continues — *a supervisor that refuses to boot because the lease DB was busy
  turns a stale row into a dead fleet.*
- **`realReapOnBoot` opens `lease.db` on first call and the handle lives for the supervisor's
  process.** `openDb` caches by path, so this is one long-lived connection to a file that holds tens
  of rows. Say it in the comment rather than adding a close nothing else needs.

**Do (tests):**

- **Test 19 keeps its ordering assertion and loses its fake.** It becomes: `main(schedule, { ...h.deps,
  reapOnBoot: realReapOnBoot, newTimer })` against a `LEASE_DB` redirected into the harness's temp
  root and seeded with two dead-owner claims. The `callOrder` assertion (`reap` before `newTimer`)
  is unchanged — that is SUP-15's whole content and it must survive. The `lease-reaped` line count
  now comes from rows the real sweep really deleted.
- **Test 20 is untouched.** A throwing fake is still the right way to prove the non-fatal arm; a real
  `reapDead` cannot be made to throw on demand without breaking the DB, and breaking the DB is not
  what that test is about.
- **NEW test — the real supervisor, as a child process, end to end.** This is the phase gate.
  `spawnSync(process.execPath, ["host/supervisor.ts"], { env: { …, LEASE_DB: <tmp>, INSTANCE: <the
  checkout's own name>, ENGINE_ROOT: <a fixture root> } })` after seeding one `held` claim whose
  owner is `<instance>:<hostname>:<pidns>:<deadPid>:aaaaaaaa` and whose `claimed_at` is 60 s old.
  Assert, off the child's **stderr**:
  - `event=lease-reaped` appears, carrying the seeded `key=` and a `ttlLeftMin=` above 0;
  - it appears **before** `event=supervisor-up`, by byte offset in the stream;
  - the row is gone from the seeded DB afterwards.
  Send `SIGTERM` (or run with an empty schedule and a `--exit-after-boot` argv guard — **no**: use
  the real path and kill it) and assert exit 0.

  **This is the test that replaces a spy with a proof.** Nothing in it is injected: the real
  `reapDead`, the real `parseOwner`, the real `/proc`, the real `main()`, the real argv block.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test host/supervisor.test.ts` reports its previous count plus
      one.
- [ ] AC2 — **the wiring fires.** In the argv block, change `reapOnBoot: realReapOnBoot` back to an
      inline `() => []`. `npm test` exits non-zero on the new end-to-end test — **and on nothing
      else**. Record the count. (If any other test goes red, it was reading the argv block through a
      path it should not.)
- [ ] AC3 — **the ordering still fires.** Move the `reapOnBoot` block in `main()` to after the
      `timers` map. `npm test` exits non-zero on test 19. Revert.
- [ ] AC4 — **`required` is enforced.** Delete `reapOnBoot` from one test harness's `deps` literal.
      `npm run typecheck` exits non-zero naming the missing property — a compile error, not a
      runtime one. Revert.
- [ ] AC5 — **the sweep really deletes.** In the end-to-end test, change the seeded owner's pid to
      `process.pid` (a live owner). The test must go red on the "row is gone" assertion, proving the
      assertion is about a deletion and not about a log line. Revert.
- [ ] AC6 — **no real lease DB is touched.** `git status --porcelain` is clean after the run, and
      `ls .doppelganger/state/lease.db` reports no such file (the child wrote only to its `LEASE_DB`
      redirect). Record both.

**Commit:** `supervisor: LSE-09's boot sweep is the real reapDead, proved end to end (LSE-09, SUP-15)`

**Depends on:** J4.5.

**Risks / what could be wrong:**
- **The end-to-end test starts a real supervisor.** It must not touch the real crontab, the real
  `~/.gitconfig` or make a model call — it does none of those: `main()` registers timers and beats,
  and the fixture schedule is empty apart from what the harness stubs. `ENGINE_ROOT` points at a
  temp root so the heartbeat and status writes land there.
- **Timing.** The child is killed as soon as `supervisor-up` is seen, not after a fixed sleep. No
  unlisted timing bound.
- **`INSTANCE` in the child.** Guard 4 compares the seeded owner's instance to the child's own, so
  the seed must be written with the SAME value the child will compute. Set `INSTANCE` explicitly in
  both the seeding process and the child's env — never rely on both defaulting to the same basename.

---

## J4.7 — `cli/lease-clear.ts`: list a scope, delete a key, force a `held` claim  ·  LSE-10

**Goal:** the supported form of the one-off `DELETE`, because `acquire` refuses on `status <> 'done'`
and waiting out the TTL therefore does nothing, at any horizon.

**Files touched:**
- `cli/lease-clear.ts` (new)
- `cli/lease-clear.test.ts` (new)
- `package.json` — `"lease-clear": "node cli/lease-clear.ts"`
- `test/commands.test.ts` — nothing (its globs already cover `cli/**`)

**Do:** the `cli/crontab.ts` shape exactly — a pure `run(argv, deps)` returning `{ out, err, code }`
so every command is assertable without capturing a stream, plus an argv block that writes the two
streams itself and is untested by construction.

```
npm run lease-clear -- <scope>                      # list the scope's claims
npm run lease-clear -- <scope> <key>                # delete it, if it is not `held`
npm run lease-clear -- <scope> <key> --force        # even if it is
npm run lease-clear                                 # usage, exit 1
```

- **No key is the DISCOVERY path, not an error.** A key is `repo#7@abc1234`-shaped and nobody types
  it from memory; listing first is how you find the one to clear. The listing goes to **stdout**
  (LOG-06: stdout is the payload) and the count line to **stderr**.
- **A refused `held` claim names its OWNER and its expiry**, so the choice to force is made against a
  real process rather than a guess — and with INS-04's instance leading, the operator can tell which
  checkout owns it. Exit 1.
- **A missing claim is exit 0 with `no claim <scope>/<key> — nothing to clear`.** Idempotent by
  design: running it twice must not start looking like a failure.
- **`--force` is where the guard-4 escape hatch lives** (J4.5's risk): a stale claim from a deleted
  checkout is never reaped by a sweep, and this is the supported way to remove it. The usage text
  says so in one line.
- **`SAF`:** `LEASE_CLEAR_DRY_RUN=1` prints what it would delete and calls nothing. This is the
  **third** operator CLI to need a dry run that §2.28 has no row for (`CRONTAB_DRY_RUN`,
  `SKILLS_DRY_RUN`) — Gaps item 6.

**Do (tests):** `LEASE_DB` redirected; every case driven through `run(argv, deps)`.

1. Bare argv → usage on stderr, code 1, nothing written.
2. `<scope>` alone → every claim on stdout, one line each, `status attempts=N updated=… <key>`;
   the count on stderr; code 0.
3. `<scope>` with no claims → `0 claim(s)`, code 0, stdout empty.
4. A `done` claim is deleted without `--force`; a following `acquire` on that key succeeds — **the
   only retry path a terminal lease has**, and the test's name says it.
5. A `held` claim without `--force` → code 1, stderr names the owner and `expires_at`, the row
   survives.
6. The same with `--force` → code 0, the row is gone.
7. An absent key → code 0, `nothing to clear`, and running it again gives byte-identical output.
8. `LEASE_CLEAR_DRY_RUN=1` over a `held` claim with `--force` → prints the deletion, deletes
   nothing.
9. The five-field owner is printed whole in case 5 — an operator can copy it into
   `parseOwner`'s vocabulary.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test cli/lease-clear.test.ts` reports 9 passing.
- [ ] AC2 — **the `held` refusal fires.** Delete the `force` branch's guard so `clear` is always
      called with `{ force: true }`. `npm test` exits non-zero on test 5. Revert.
- [ ] AC3 — **the dry run is inert.** Delete the `dryRun` early return. `npm test` exits non-zero on
      test 8 with the row gone. Revert.
- [ ] AC4 — **the real CLI runs.** `LEASE_DB=/tmp/lc.db npm run lease-clear -- nightly` exits 0 and
      prints `0 claim(s) in scope \`nightly\``. Then `npm run lease-clear` (bare) exits 1 and prints
      the usage. Record both, and `rm /tmp/lc.db*`.
- [ ] AC5 — `node --test test/commands.test.ts` and `node --test test/layout.test.ts` pass: the new
      file is named in §1 (J4.1 put it there) and its test is matched by an existing glob.
- [ ] AC6 — `node --test test/knobs.test.ts` passes with `LEASE_CLEAR_DRY_RUN` added to `ROWS`, to
      §2.27's Core/paths bullet, and to assertion 5's probe list.

**Commit:** `lease-clear: list scope, delete key, --force a held claim (LSE-10)`

**Depends on:** J4.5.

**Risks / what could be wrong:**
- **This is the third `*_DRY_RUN` on a tool rather than a job.** SAF-01 is defined per JOB. Shipping
  it anyway is consistent with N2's and N3's rulings; §2.28 still has no row. Gaps item 6.
- **A `.db` file in `/tmp` in AC4.** Removed by the AC itself; `test/layout.test.ts` assertion 13
  only sweeps the checkout, so this leaves nothing a gate would see either way.

---

## J4.8 — `kernel/runtime/quota.ts`: the breaker, the class windows, the dark gap  ·  QTA-01, QTA-05, QTA-06, QTA-07

**Goal:** a walled account parks itself once and recovers by itself, and nothing on the host spawns a
CLI against an account that rejects on arrival.

**Files touched:**
- `kernel/runtime/quota.ts` (new)
- `kernel/runtime/quota.test.ts` (new)
- `kernel/runtime/quota.fixture.ts` (new — the messages, with provenance per row)
- `host/run.ts` — `runNamed` gains the producer and the consumer (ruling 2)
- `host/run.test.ts` — the fake-`claude` loop
- `host/jobs/nightly-sandcastle.ts` — `DB_NAMESPACES` gains `"quota"`
- `test/knobs.test.ts` — four rows; `roadmap.md` §2.27 already names all four

**Do (the module):**

```ts
export const NS = "quota";
export type LimitClass = "session" | "daily" | "usage" | "weekly" | "monthly" | "spend" | "unknown";
export const QUOTA_SCOPE_ENV: EnvSpec;            // default "claude"
export const QUOTA_SCOPE: string;
export const workerScope = (container: string): string => `worker:${container}`;
export function isLimitError(message: string): boolean;
export function limitClass(message: string): LimitClass;
export function pause(scope: string, message?: string): string;   // returns the re-probe instant
export function isPaused(scope: string): boolean;
export function pausedUntil(scope: string): string | null;
export function clearPause(scope: string): void;
export interface PauseInfo { scope; until; since; limit; note; active }
export function inspect(scope: string): PauseInfo;
export function listPaused(): PauseInfo[];
```

**QTA-01 — a breaker per ACCOUNT SCOPE, not per job.** Standalone, every job spawns the same CLI
against the same account, so they share `QUOTA_SCOPE` and whichever job discovers the limit parks the
rest (INV-10: a quota `scope` is one ACCOUNT). `workerScope(container)` ships with **no caller** —
QTA-01's own text names it, and it is three characters of string concatenation whose absence would
make QTA-02/03/04 (M9) a redesign rather than a wiring job. Its `why` says so and
`test/knobs.test.ts` has nothing to say about a function.

**QTA-05 — nothing re-probes.** There is no prober and there must not be: the window expires, and the
next real run IS the probe. A still-limited probe simply re-parks. `clearPause` exists for a
successful probe or a hand-lift after an upgrade; nothing calls it on a schedule.

**QTA-06 — the window is sized by the limit CLASS the CLI named, never by the reset it stated.**

| class | env pin | multiple of `QUOTA_PAUSE_MS` | why |
|---|---|---|---|
| `session` | `QUOTA_PAUSE_MS_SESSION` | 1 | can genuinely lift within the hour |
| `daily` | `QUOTA_PAUSE_MS_DAILY` | 1 | same |
| `usage` | `QUOTA_PAUSE_MS_USAGE` | 1 | same |
| `unknown` | `QUOTA_PAUSE_MS_UNKNOWN` | **1** | **the SHORTEST window.** Only a POSITIVELY identified long period may probe less often, or one unrecognised wording darkens an account for hours over nothing |
| `weekly` | `QUOTA_PAUSE_MS_WEEKLY` | 2 | cannot lift inside the hour |
| `monthly` | `QUOTA_PAUSE_MS_MONTHLY` | 4 | days out — but an admin CAN raise it, so the ceiling stays hours, not month-end |
| `spend` | `QUOTA_PAUSE_MS_SPEND` | 4 | same, and the remedy is a person |

The stated reset survives **only** inside the raw `note:`, and is never consulted for timing. Reading
it back would leave an upgraded plan dark long after quota returned. Every class still recovers
within one window of the limit actually being lifted; a longer period only probes slower.

**The classifier, and why it is narrow.** `isLimitError` is the predicate every call site branches
on, and both directions are silent failures. Widen it to `/\blimit\b/` and an unrelated failure parks
every job on the host for a window — the run that would have reported the real fault is the run that
gets skipped. Narrow it and a walled run settles `failed`, retiring work nobody refused. So:

```ts
const LIMIT_RE = /\b(?:weekly|monthly|daily|usage|session)\s+limit\b|\bspend\s+limit\b|\blimit\s+reached\b/i;
const PERIOD_RE = /\b(weekly|monthly|daily|usage|session)\s+limit\b/i;
```

`spend limit` is its **own alternative** because the period word is not adjacent to `limit` in that
family — *"your org's monthly spend limit"* — so the first alternative misses them. That is not
hypothetical: it is the exact wording in this machine's own quota store (ruling 1), and the reference
records it going unmatched twice before the alternative was added. `limitClass` tests `spend`
**first** and it wins over the period word standing next to it: an admin raising a cap is a different
remedy from a plan reset, and the two share a window anyway.

**`PERIOD_RE` is `LIMIT_RE`'s own alternation, captured, in the same order.** A wording added to one
and not the other classifies as `unknown` a wall it has just matched — so a test asserts the two
alternations are the same set, derived from the source, not written twice by hand.

**QTA-07 — `QUOTA_DARK_GAP_MS`, how long after a window expires a fresh park is the SAME outage.**
`since:` has to answer *how long has this account been dark*, and re-parking IS the shape of a long
outage: the window expires, the next real run probes, fails, parks again. Stamping `since` at every
park makes every outage read as one window old — the one number that is never news. The reference
measured `worker-nexus-keaton` parking seven times in five and a half hours on one org spend cap,
reading 30 minutes old at every one. **This machine's store shows the same thing today:**
`since:worker:worker-nexus-bennet` = `2026-08-26T07:24:07Z` against `until:` = `15:37:11Z` — 8h 13m of
continuous darkness surviving many re-parks, which is only possible because `since` is not restamped.

`darkGapMs(cls) = max(pauseMs(cls), QUOTA_DARK_GAP_MS)` — the window is the FLOOR for a class that
probes more slowly than the gap. Default 2 h, which is a guess at a real distribution and is
documented as one: the gap between expiry and the next park is bounded by when work next ARRIVES, not
by the cadence.

**Every knob is read PER CALL**, so a change lands on the next tick rather than needing a restart.
That is a deliberate difference from every other knob in this repo, and the header says why:
standalone, a park idles EVERYTHING; on a fleet it idles one subscription of N, and the right number
differs by deployment.

**The store has no tables of its own** — `migrate(NS, [])` and the `quota_meta` key/value store is
enough. Keys: `until:<scope>`, `since:<scope>`, `class:<scope>`, `note:<scope>`. A cleared pause holds
`""`, which sorts below any ISO instant, so it drops out of `listPaused` with the expired ones.

**`QUOTA_PAUSE_MS_<CLASS>` is the third `envDynamic` call site.** `test/knobs.test.ts` assertion 7
pins the list exactly (`["kernel/runtime/gate.ts", "kernel/paths.ts"]`); it grows to three. That is a
real gate doing its job, not an obstacle.

**Do (the fixture file):** `kernel/runtime/quota.fixture.ts`, one row per message:

```ts
export interface LimitFixture {
  readonly message: string;
  readonly expect: { readonly isLimit: boolean; readonly class: LimitClass };
  readonly source: string;      // where the bytes came from
  readonly recordedAt: string;  // when
  readonly via: "first-hand" | "reference-corpus";
}
```

Tier 1 rows carry `source: "xenith/engine/.sandcastle/state/quota.db note:claude"` and friends,
`recordedAt` the store's own `since:` value, `via: "first-hand"`. Tier 2 rows carry
`source: "xenith/engine/src/lib/quota.test.ts"` plus the dated incident its comment names,
`via: "reference-corpus"`. **No row is invented** (TST-19). A test asserts every row has all three
provenance fields non-empty and that at least two rows are `first-hand` — otherwise the corpus has
quietly become second-hand.

**Do (tests — `kernel/runtime/quota.test.ts`):** `QUOTA_DB` redirected; the `withWindow` and `meta`
helpers of ruling 1.

1. **The fixture drives the classifier**, `deepEqual` over every row's `{ isLimit, class }`. One
   assertion, the whole corpus.
2. **The negatives**, separately named, because they are the ones that matter: `body exceeds the
   65536 character limit`, `API rate limit exceeded`, `ENOENT`, `gh: Not Found`, `worker blew up`,
   `""` — all `isLimitError === false`.
3. **`unknown` is the fallback and the SHORTEST window.** `5-hour limit reached` is a wall
   (`isLimitError` true) whose period is unread (`limitClass` `unknown`), and its window equals the
   session window.
4. **The class multiples**, with the base pinned by `withWindow(30 * 60_000)` so what is asserted is
   the MULTIPLE: 30 / 30 / 30 / 30 / 60 / 120 / 120 minutes for session, daily, usage, unknown,
   weekly, monthly, spend.
5. **The stated reset never reaches the timing.** `You've hit your weekly limit · resets Aug 5, 4am
   (UTC)` under `withWindow(60_000)` re-probes inside five minutes; `inspect().note` still carries
   `resets Aug 5` verbatim — read, never timed on.
6. **An elapsed window is not a pause.** `withWindow(0)`, then `isPaused` false, `active` false, the
   record survives (`pausedUntil` non-null), and `listPaused` excludes it. **QTA-05 as an
   assertion.**
7. **`since` survives a re-park inside the gap.** Age `until:` by 1 h, `QUOTA_DARK_GAP_MS` = 2 h,
   re-park, and `since` is unchanged.
8. **`since` restarts outside the gap.** Age `until:` by 3 h, same knob, re-park, and `since` moves.
9. **A hand-lifted breaker starts a new outage** — `clearPause` then `pause` gives a fresh `since`.
10. **`class:` is recorded beside `since:`**, and `inspect` on a breaker opened before the class was
    recorded classifies its `note:` rather than reporting `unknown` for a wall that is right there
    to read.
11. **`listPaused` returns open breakers, soonest re-probe first**, and excludes cleared and expired
    ones.
12. **`PERIOD_RE` and `LIMIT_RE` name the same period set**, derived from the module source by
    extracting both alternations and comparing them as sets. A wording added to one only goes red
    here.
13. **`QUOTA_FIXTURE_RECHECK=1`** (opt-in, skipped by default with a `t.skip` reason) reads the
    reference's `quota.db` if present and reports any `note:` value the fixture does not already
    classify. Asserts nothing about specific bytes.

**Do (`host/run.ts` — the producer and the consumer, ruling 2):**

```ts
export async function runNamed(job, deps, shed): Promise<number> {
  if (isPaused(QUOTA_SCOPE)) {
    log.info("quota-paused", { until: pausedUntil(QUOTA_SCOPE) ?? "" });
    return 0;                                  // a wall is a skipped tick, never a failure (INV-10)
  }
  try { … } catch (e) {
    const msg = errText(e);
    if (!isLimitError(msg)) throw e;
    const until = pause(QUOTA_SCOPE, msg);
    log.warn("quota-parked", { until, class: limitClass(msg) });
    return 0;
  }
}
```

`runNamed` is exported and tested; the argv block gains nothing but the `shed` argument J4.10 adds.

**Do (tests — `host/run.test.ts`):** two new tests on N3's measured fake-`claude`-on-`PATH` harness.

14. **The whole park loop, no model call.** A fake `claude` that writes this repo's own tier-1
    wording to stderr and exits 1 → `run()` rejects → `runNamed` returns 0 → `isPaused(QUOTA_SCOPE)`
    is true against the throwaway `QUOTA_DB` → the recorded `class` is `spend`.
15. **The consumer refuses before it spawns.** With the breaker open, a fake `claude` that would
    `exit 0` is **never executed** — assert on a marker file the fake would have created. Then
    `withWindow(0)` and re-run: it IS executed. **QTA-05's "the next real task IS the probe", proved
    against a real spawn.**
16. **A non-limit failure still throws.** The fake exits 1 with `worker blew up`; `runNamed` rejects
    and nothing is parked.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/quota.test.ts` reports 13 (one skipped
      by default) and `node --test host/run.test.ts` reports its previous count plus three.
- [ ] AC2 — **`spend` must be its own alternative.** Delete `|\bspend\s+limit\b` from `LIMIT_RE`.
      `npm test` exits non-zero on test 1 with the org-spend rows — **the exact wording this machine
      recorded**. Revert.
- [ ] AC3 — **`spend` must be tested first.** Move the `spend` check in `limitClass` below
      `PERIOD_RE`. `npm test` exits non-zero on test 1: `You've hit your org's monthly spend limit`
      classifies `monthly`, a 4× window with the wrong remedy in the report. Revert.
- [ ] AC4 — **`unknown` must stay shortest.** Change `unknown`'s multiple from 1 to 4. `npm test`
      exits non-zero on tests 3 and 4. Revert.
- [ ] AC5 — **the reset is never read.** Add `const stated = Date.parse(/resets (.+)$/.exec(message)?.[1] ?? "")`
      and use it as `until` when finite. `npm test` exits non-zero on test 5. Revert.
- [ ] AC6 — **`since` continuity fires.** Delete the `if (!continuous)` guard so `since` is stamped
      on every park. `npm test` exits non-zero on test 7. Revert.
- [ ] AC7 — **the two alternations are gated.** Add `hourly` to `LIMIT_RE` only. `npm test` exits
      non-zero on test 12. Revert.
- [ ] AC8 — **the park loop is real, not mocked.** Delete the `pause(QUOTA_SCOPE, msg)` call from
      `runNamed`'s catch. `npm test` exits non-zero on test 14. Then restore it and delete the
      `isPaused` guard: non-zero on test 15. Revert both.
- [ ] AC9 — **the provenance holds.** Delete one tier-1 row's `recordedAt`. `npm run typecheck`
      exits non-zero (the field is required), and with `recordedAt: ""` the provenance test goes red.
      Revert.
- [ ] AC10 — `node --test test/knobs.test.ts` passes: four rows in `ROWS`, assertion 7's
      `envDynamic` list is now three files, and the three defaulted keys are probed in assertion 5.
      Then remove `QUOTA_DARK_GAP_MS` from `ROWS` only: assertion 2's `deepEqual` must go red.
- [ ] AC11 — `node --test test/skills.test.ts` passes with `"quota"` in `DB_NAMESPACES`; removing it
      goes red by name.
- [ ] AC12 — **no live store is touched.** After the full run, `ls .doppelganger/state/quota.db`
      reports no such file, and `git status --porcelain` is clean.

**Commit:** `quota: an account breaker sized by limit class, with fixtures lifted from real parks (QTA-01, QTA-05/06/07)`

**Depends on:** J4.1.

**Risks / what could be wrong:**
- **`isLimitError` sees only what reaches `errText(e)`.** N3 measured `run()` rejecting with
  `claude-code exited with code N:\n<stderr>` — so the CLI's own message IS in the message. If a
  future sandcastle version truncates that, the breaker goes silent with nothing red. Test 14 is the
  guard, but it uses a fake `claude`, so it proves the plumbing and not the library's future
  behaviour. `test/deps.test.ts` test 4 pins sandcastle's shape at the resolved version; a bump is a
  lockfile commit and a re-measure.
- **Reading knobs per call is unlike every other knob here.** It is stated in the header with the
  reference's reason; `test/knobs.test.ts` assertion 5 probes the DEFAULTS in a scrubbed child, which
  is unaffected by when they are read.
- **`workerScope` has no caller.** Named as such, with M9's rows cited. It is a naming decision, not
  a port (D9 is about ports).

---

## J4.9 — `kernel/runtime/shed.ts` + `host/classes.ts`: the value tiers, pure  ·  QTA-08, QTA-09

**Goal:** `quota.ts` detects a walled account and PAUSES; it never DEGRADES — a chore-class nightly
and a PR review burn the exact same wall and the breaker cannot tell them apart. This is the missing
half.

**Files touched:**
- `kernel/runtime/shed.ts` (new)
- `kernel/runtime/shed.test.ts` (new)
- `host/classes.ts` (new — the name table)
- `host/classes.test.ts` (new)
- `kernel/ports/job.ts` — `DEFAULTS.shedModel` (ruling 8)
- `test/model.test.ts` — one assertion each in tests 3 and 4

**Do (the split, and why D1 forces it):** `decideShed` is pure and belongs in the kernel;
`CHORE`/`REVIEW` are a hand-picked subset of the HOST's `PROGRAMS` and cannot live there — a kernel
module naming `nightly-sandcastle` would import the host's vocabulary, which D1 forbids. This is
exactly §5 Q1's ruling for gate resources, applied a second time: **the host names its own things.**

```ts
// kernel/runtime/shed.ts
export type JobClass = "chore" | "watch" | "review";
export interface ShedDecision { readonly skip: boolean; readonly downshift: boolean }
export const QUOTA_SHED_WINDOW_MS_ENV: EnvSpec;         // default "86400000"
export const SHED_WINDOW_MS = (): number;               // read per call, like every quota knob
export function decideShed(
  snapshot: Pick<PauseInfo, "limit" | "since">,
  cls: JobClass,
  now: Date,
  windowMs?: number,
): ShedDecision;
export function shedModel(model: string, d: ShedDecision): string;
export const NO_SHED: ShedDecision = { skip: false, downshift: false };
```

```ts
// host/classes.ts
export const CHORE: readonly string[] = ["nightly-sandcastle"];
export const REVIEW: readonly string[] = [];            // empty at N4 — nothing is waiting on a human yet
export function classOf(name: string): JobClass;        // unlisted -> "watch", the safe default
```

**QTA-09 — `decideShed` is pure: a snapshot, a class, an instant, a window. No DB read, no
`Date.now()`, no env lookup inside it.** The two call sites do the impure half. That is what lets
every branch be pinned without touching `quota.db`.

**The decision table, exactly. This is the whole function:**

| `snapshot.limit` | `snapshot.since` | `now − since` | class | `skip` | `downshift` |
|---|---|---|---|---|---|
| `spend` | non-null | ≤ `windowMs` | `chore` | **true** | **true** |
| `spend` | non-null | ≤ `windowMs` | `watch` | false | **true** |
| `spend` | non-null | ≤ `windowMs` | `review` | false | false |
| `spend` | non-null | > `windowMs` | any | false | false |
| `spend` | `null` | — | any | false | false |
| any of `session daily usage weekly monthly unknown` | any | any | any | false | false |

Two rules produce it and nothing else does:

- **`recent = limit === "spend" && since != null && now − Date.parse(since) ≤ windowMs`.**
- **`recent ? { skip: cls === "chore", downshift: cls !== "review" } : NO_SHED`.**

**It reads `limit`/`since`, never `active`/`until`.** The pause WINDOW is short — spend is 4×
`QUOTA_PAUSE_MS`, about two hours — and keying on it would stop shedding the moment the LAST park
expired, even though the account re-parks on its next real task. `since` survives exactly that
re-park (QTA-07), so it is what "recently" has to mean here too.

**Only a SPEND wall sheds.** A session/daily/weekly wall already recovers inside its own class window
(QTA-06), so widening this to every class would shed load for a wall that has probably lifted. Spend
is the one class a person has to act on.

**`review` is never skipped and never downshifted.** At N4 `REVIEW` is **empty** and the row says
why: nothing in this repo has a human waiting on it yet. The empty list is a checked claim, not a
placeholder — `host/classes.test.ts` asserts the three-way split covers `PROGRAMS` exactly, so the
first `review`-class job forces an explicit choice.

**`shedModel` is a CEILING, never a floor.** Opus only, and only when asked: a job that already names
sonnet or haiku is left alone.

**Ruling 8's constraint, restated because it is easy to lose:** `DEFAULTS.shedModel` lives in
`kernel/ports/job.ts`. `kernel/runtime/shed.ts` imports it and contains **no `claude-` literal**.

**Do (tests — `kernel/runtime/shed.test.ts`):**

1. **The whole table as one grid.** 7 limit classes × 3 job classes × 3 `since` states (null, recent,
   old) = 63 cells, `deepEqual`'d against the two rules computed independently in the test. Not seven
   `it`s — one grid, so no cell can be forgotten.
2. **A recent spend wall**: chore `{true,true}`, watch `{false,true}`, review `{false,false}`.
3. **A wall older than the window sheds nothing, for any class.**
4. **A scope never paused (`since: null`) sheds nothing.**
5. **An explicit `windowMs` beats the env default** — 90 minutes ago is outside a 1 h window and
   inside a 2 h one.
6. **`shedModel`** downshifts opus, leaves sonnet and haiku alone, and leaves opus alone when not
   asked.
7. **`decideShed` touches nothing.** Run the whole grid with `QUOTA_DB` pointed at a path that does
   not exist and assert no file is created — purity as an observation, not a promise.

**Do (tests — `host/classes.test.ts`):**

8. **`CHORE` and `REVIEW` are pinned to the assignment table this feature shipped with**, with the
   failure message saying *a change here is a value-class decision, not a refactor*.
9. **Every `PROGRAMS` key is chore, review, or in the pinned `WATCH` set** — `deepEqual` on
   `Object.keys(PROGRAMS).sort()` against `[...CHORE, ...REVIEW, ...WATCH].sort()`. **A new program
   must choose.** At N4 `WATCH` is `["ops-cron-check", "watchdog.sh"]` after J4.12/J4.14 land; this
   test lands with them and is written here so the shape is fixed before the entries exist.
10. **`classOf` defaults an unknown name to `watch`.**
11. **`classOf`'s two call sites are handed two different strings, and they agree only by
    convention.** The supervisor asks `classOf(programOf(e))` — `e.job ?? e.script ?? e.name`;
    `runNamed` asks `classOf(job.name)`. `test/jobs.test.ts` test 3 already pins that a job's declared
    name IS its filename, so this test asserts the coupling by name and cites it rather than
    re-implementing the scan. **Break it and half the shedding goes quiet**: the supervisor still
    skips (it read the filename) while `runNamed` falls through to `watch` and stops downshifting.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/shed.test.ts` reports 7 and
      `node --test host/classes.test.ts` reports 4 passing.
- [ ] AC2 — **the spend-only rule fires.** Change `recent`'s first clause to `limit !== "unknown"`.
      `npm test` exits non-zero on test 1's grid. Revert.
- [ ] AC3 — **`since`, not `until`, fires.** Change `decideShed` to key on `snapshot.active`. It must
      fail `npm run typecheck` first (the parameter is `Pick<PauseInfo, "limit" | "since">`) —
      **record that**, then widen the Pick and watch test 1 go red. Revert both.
- [ ] AC4 — **`review` is never downshifted.** Change `downshift: cls !== "review"` to
      `downshift: true`. `npm test` exits non-zero on tests 1 and 2. Revert.
- [ ] AC5 — **the class table is a checked claim.** Add a fake key to `PROGRAMS`. `npm test` exits
      non-zero on test 9 naming it. Remove it.
- [ ] AC6 — **ruling 8 holds.** Move `DEFAULTS.shedModel`'s value into `kernel/runtime/shed.ts` as a
      literal. `npm test` exits non-zero on `test/model.test.ts` test 6 with
      `["kernel/ports/job.ts","kernel/runtime/shed.ts"]`. Revert.
- [ ] AC7 — **the new default is held to the model rules.** Change `DEFAULTS.shedModel` to
      `"claude-sonnet-latest"`. `npm test` exits non-zero on test 3 and test 4. Revert.
- [ ] AC8 — `node --test test/knobs.test.ts` passes with `QUOTA_SHED_WINDOW_MS` in `ROWS` and probed
      in assertion 5.

**Commit:** `shed: decideShed is pure, and the value classes are the host's own vocabulary (QTA-08, QTA-09)`

**Depends on:** J4.8.

**Risks / what could be wrong:**
- **`REVIEW` is empty and test 9 makes that a checked claim.** If a reviewer reads the empty list as
  an oversight, the test's failure message is the answer. It is the same call `host/config.ts` made
  for `REFRESH_WINDOW = null`.
- **`host/classes.test.ts` test 9 lands before its subjects.** J4.12 and J4.14 add the two `WATCH`
  entries; until then `WATCH` is `[]` and the assertion still binds against the one real program.
  Each of those jobs updates the list in its own commit, which is exactly the forcing function the
  test exists for.

---

## J4.10 — SUP-16 wired to the real `decideShed`, and the downshift call site  ·  QTA-08, SUP-16

**Goal:** the placement N2 shipped gets its predicate, and the N2 spy is replaced by the real thing.

**Files touched:**
- `host/supervisor.ts` — `realShouldShed`, and the argv block wires it
- `host/supervisor.test.ts` — test 3 loses its fake
- `host/run.ts` — `runNamed(job, deps, shed)`; the argv block computes it
- `kernel/runtime/runjob.ts` — `RunJobDeps.shed`, applied before `assertPinned`
- `host/jobs/nightly-sandcastle.ts` — `PassDeps.shed`, passed to its own `runJob` call
- `host/run.test.ts`, `kernel/runtime/runjob.test.ts`, `host/jobs/nightly-sandcastle.test.ts` — one
  field each in their harnesses

**Do (the skip half):**

```ts
export const realShouldShed = (program: string, at: Date): { skip: boolean; class?: string } => {
  const cls = classOf(program);
  const d = decideShed(inspect(QUOTA_SCOPE), cls, at);
  return d.skip ? { skip: true, class: cls } : { skip: false };
};
```

The placement does not move: `runEntry` step 3, **before the self-lock and before the gate**, because
a skipped tick should cost nothing and hold nothing. `deps.shouldShed` stays a required field.
`realShouldShed` opens `quota.db` on the first tick and the cached handle lives for the supervisor's
process — one long-lived reader of a key/value store with a handful of rows.

**Do (the downshift half):** `RunJobDeps` gains `shed: ShedDecision`, **required, no default**
(N2 ruling 2: a default a caller can silently inherit is the failure mode). `runJob` applies it at
the one place `RunRequest.model` is built:

```ts
const model = shedModel(job.model ?? DEFAULTS.model, deps.shed);
assertPinned(model);
```

Order matters: `shedModel` first, `assertPinned` second, so the downshift target is held to HRN-11
too. `runNamed` computes the decision once and passes it into both `runJob` and `PassDeps`.

**Note what this means for the one real job.** `nightly-sandcastle` is `chore`, so under a recent
spend wall the supervisor SKIPS it at step 3 and `runJob` is never reached — the downshift arm is
reachable for it only from a hand-run (`npm run job nightly-sandcastle`). That is not a defect; it is
QTA-08's design (skip beats downshift for a chore), and the test says so rather than leaving a
reviewer to wonder why the arm looks dead.

**Do (tests):**

- **Supervisor test 3 keeps its shape and loses its fake.** It becomes: `QUOTA_DB` redirected and
  seeded with a spend park via `pause`, `shouldShed: realShouldShed`, program `nightly-sandcastle` →
  one `quota-shed` line at `info` with `class=chore`, and **`h.spawnCalls.length === 0`**. The
  gate-untouched half of test 2(a) is unchanged and still uses an injected fake — a per-test override
  of a required dep is a fixture, not a spy.
- **NEW: a `watch`-class program under the same wall is NOT skipped.** Same seeded store, program
  `ops-cron-check` → no `quota-shed` line, one spawn. This is the assertion that makes test 3 about
  the PREDICATE rather than about the placement.
- **NEW: `runJob` downshifts.** `deps.shed = { skip: false, downshift: true }` with a job naming
  `DEFAULTS.model` → the `RunRequest` the fake runner receives names `DEFAULTS.shedModel`. With
  `NO_SHED` → it names `DEFAULTS.model`.
- **NEW: the downshift target is pinned.** `deps.shed = { skip: false, downshift: true }` with a job
  naming a hand-set unpinned model still throws from `assertPinned` — proving the order.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0. Record the four numbers against J4.1's baseline.
- [ ] AC2 — **the wiring fires.** In the argv block, change `shouldShed: realShouldShed` back to
      `() => ({ skip: false })`. `npm test` exits non-zero — record which tests. If **none** go red,
      the argv block is still unreachable and the export is not pinned: add a source-text assertion
      that `host/supervisor.ts`'s argv block names `realShouldShed` and no arrow literal, the same
      way N3 F1 pinned `realJobRunner`, and re-run the mutation.
- [ ] AC3 — **the placement still fires.** Move step 3 below step 5 in `runEntry`. `npm test` exits
      non-zero on supervisor test 2(a) (a shed tick must never touch the gate). Revert.
- [ ] AC4 — **the predicate is real.** In `realShouldShed`, replace `inspect(QUOTA_SCOPE)` with
      `{ limit: "unknown", since: null }`. `npm test` exits non-zero on supervisor test 3. Revert.
- [ ] AC5 — **the class matters.** Add `"ops-cron-check"` to `CHORE`. `npm test` exits non-zero on
      the new watch-class test **and** on `host/classes.test.ts` test 9. Revert.
- [ ] AC6 — **`shed` is required, not defaulted.** Delete `shed` from one `RunJobDeps` literal in a
      test. `npm run typecheck` exits non-zero naming the property. Revert.
- [ ] AC7 — **the order is `shedModel` then `assertPinned`.** Swap them. `npm test` exits non-zero on
      the new pinning test. Revert.

**Commit:** `supervisor: SUP-16's quota-shed gets its real predicate; runJob downshifts opus (QTA-08, SUP-16)`

**Depends on:** J4.9.

**Risks / what could be wrong:**
- **Three test harnesses grow a field.** `PassDeps` is the noisy one — `host/jobs/nightly-sandcastle.test.ts`
  is 686 lines with a shared harness, so it is one line there. Required-over-optional is N2 ruling 2
  and N3 ruling 6's precedent; the cost is stated rather than avoided.
- **AC2's "if none go red" branch is the one to expect.** The argv block is untestable by
  construction, so the honest outcome is that the mutation changes nothing until the source-text
  assertion exists. Write the assertion; do not skip the AC.

---

## J4.11 — `scriptCommand`: one spelling for a `script:` entry, and two new `validate()` rules  ·  SUP-01, SUP-03, SUP-05, SUP-08

**Goal:** fix ruling 5's live bug before the first `script:` entry meets it, so `crontab render` and
`spawnChild` can never name two different commands.

**Files touched:**
- `host/schedule.ts` — `scriptCommand`, `commandOf`, two `validate()` rules
- `host/supervisor.ts` — `spawnChild` uses `scriptCommand`
- `host/schedule.test.ts`, `host/validate.test.ts` — the new cases
- `host/supervisor.test.ts` — the spawn-a-script case

**Do:**

```ts
/** The ONE place a `script:` entry becomes a command. `commandOf` (the crontab line, SUP-08) and
 *  `spawnChild` (the supervised spawn, SUP-03) both call it, so the two cannot drift — N3 F1's
 *  precedent, after `commandOf` and `jobRunner` named two different targets with the suite green. */
export function scriptCommand(script: string): readonly [cmd: string, args: readonly string[]] {
  if (script.endsWith(".sh")) return [join(ROOT, script), []];
  return [process.execPath, [join(ROOT, script)]];
}
```

`commandOf` becomes:

```ts
export function commandOf(e: ScheduleEntry): string {
  const target = e.job !== undefined
    ? `${process.execPath} ${join(ROOT, JOB_ENTRYPOINT)} ${e.job}`
    : scriptCommand(e.script as string).flat().join(" ");   // shape only; see the note
  return `cd ${ROOT} && ${target} >> ${e.log} 2>&1`;
}
```

**Careful, and it must be got right rather than approximated:** the existing rendering is
`cd ${ROOT} && node ${target} …`, a bare `node`. That is a PATH lookup in cron's stripped environment
and the current job path already relies on it. Two changes, both deliberate:

- **`.sh` renders no interpreter at all** — the script's own shebang, and `validate()` refuses a
  script that is not executable or does not start with `#!` (below). No `bash` on `PATH`, no
  `/bin/bash` literal needing a door-1 exception for a path that moves between distributions.
- **`.ts` keeps a `node`, and the `job:` branch keeps its `node` unchanged.** Whether that `node`
  should become `process.execPath` is a real question — an absolute interpreter path would survive a
  cron PATH that has no `node` — but it is **out of scope for N4 and must not be smuggled in**: it
  changes every rendered crontab line, `cli/crontab.test.ts` pins those lines, and it is a
  distribution decision (ADO), not a liveness one. Keep `node` for both existing branches, render no
  interpreter for `.sh`, and **flag it in Gaps item 9**. Show the exact diff in the commit body so
  the choice is visible.

**Do (`validate()`, two new rules on the `script:` branch, numbered 12a and 12b):**

```
12a. script must end in .ts or .sh          -> "script must end in .ts or .sh, got …"
12b. a .sh script must be executable and start with `#!`
     -> "script <p> is not executable — a chmod -x silently disables it (SUP-05)"
     -> "script <p> does not start with #! — it is rendered with no interpreter (SUP-05)"
```

Rule 12b is what makes "render no interpreter" safe. A stray `chmod -x` on the one liveness probe on
the box is exactly the failure JOB-O10 exists to catch, and catching it at boot is strictly better
than catching it at 03:18 with nothing to report it.

**Do (`spawnChild`):** replace

```ts
e.job !== undefined ? deps.jobRunner(e.job) : [join(deps.root, e.script as string), []]
```

with `: scriptCommand(e.script as string)`. Today the two happen to agree for `.sh` and disagree for
`.ts`; after this they are the same function.

**Do (tests):**

- **`host/schedule.test.ts` test 7 grows teeth.** Today it asserts only that the script name survives.
  Add: for a `.sh` script the command **contains no `node`** (`assert.ok(!/\bnode\b/.test(cmd))`) and
  starts the target with `ROOT`. For a `.ts` script it DOES name `node`.
- **NEW: `scriptCommand` and `commandOf` agree.** For both extensions, assert
  `commandOf(e).includes(scriptCommand(e.script).flat().join(" "))` — one spelling, checked, the way
  `JOB_ENTRYPOINT` is.
- **NEW: `spawnChild` spawns what `commandOf` renders.** In `host/supervisor.test.ts`, a `script:`
  entry pointing at a real temp `.sh` that writes a marker; assert the recorded `spawn` call's
  `[cmd, args]` deep-equals `scriptCommand(script)`.
- **`host/validate.test.ts`:** a `.py` script → refused; a `.sh` without the exec bit → refused; a
  `.sh` without a shebang → refused; a `.sh` with both → accepted. Fixtures written into the test's
  own temp root with `chmod`.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0.
- [ ] AC2 — **ruling 5's bug is gone and stays gone.** Restore `commandOf`'s old body
      (`node ${target}` for both branches). `npm test` exits non-zero on the grown test 7 with a
      rendered `node …/watchdog.sh`. Revert. **Record the exact rendered line from the failure
      message in the commit body** — it is the defect this job exists for.
- [ ] AC3 — **one spelling.** Change `spawnChild`'s script branch back to the inline
      `[join(root, e.script), []]` and change `scriptCommand`'s `.sh` arm to prepend an argument.
      `npm test` exits non-zero on the agreement test. Revert.
- [ ] AC4 — **rule 12b fires both ways.** `chmod -x` a fixture script → validate refuses naming it;
      remove the `#!` line → refuses naming that. Both messages recorded.
- [ ] AC5 — **rule 12a fires.** A `script: "host/x.py"` fixture → refused. `npm test` non-zero on the
      validate test only.
- [ ] AC6 — `node --test cli/crontab.test.ts` and `node --test cli/crontab-cli.test.ts` pass
      unchanged: they build their command lines through `commandOf`, so a shape change must not have
      broken the block mechanics. If any assertion there hardcodes `node`, fix the test and say so.

**Commit:** `schedule: one spelling for a script: entry; validate refuses a non-executable probe (SUP-01, SUP-03, SUP-05)`

**Depends on:** J4.1. Must land before J4.14.

**Risks / what could be wrong:**
- **The exec bit is not preserved by every checkout path.** Git stores it; a zip export or a
  `--no-checkout` copy may not. Rule 12b turns that into a boot refusal with an actionable message,
  which is the right trade — but it means a fresh clone on a filesystem without an exec bit
  (a Windows share, an odd mount) refuses to boot. Named in the rule's own message.
- **`commandOf` is now longer than one line and rendered into a real crontab.** Rule 23's unescaped-%
  check still runs over the result; `cli/crontab.test.ts`'s determinism assertion (two renders are
  byte-identical) still holds because `scriptCommand` is pure.

---

## J4.12 — JOB-O09 `ops-cron-check`: drift, on a cadence, logged every run  ·  JOB-O09, SUP-01, SUP-02, GAT-07

**Goal:** the installed managed block is diffed against a fresh render on a schedule, every run leaves
a line, and only drift is an error.

**Files touched:**
- `host/jobs/ops-cron-check.ts` (new)
- `host/jobs/ops-cron-check.test.ts` (new)
- `host/jobs/index.ts` — one registry entry
- `plugins/ops/skills/…` — **NOT created**: this is an `exec:` job, D10's deterministic shape, so it
  names no skill (SKL-06's gate runs both ways and an `exec` job is exempt by construction)
- `host/schedule.ts` — one `SCHEDULE` entry, one `PROGRAMS` row
- `host/classes.ts` — `"ops-cron-check"` joins `WATCH` in the test's pinned list
- `roadmap.md` §1 — already tagged by J4.1

**What the JOB adds beyond `crontab check`, which has existed since N2.** The question is fair and
the answer is four things, none of them the diff:

1. **A cadence.** `crontab check` is a tool a human runs when they remember. Drift is invisible
   between the change and the next restart, and the change that causes it is a merge, not a
   deployment. One entry a day fixes that.
2. **A log line every run, at `info`.** `crontab check` writes prose to stdout/stderr for a person.
   The job writes ONE logfmt line — `event=cron-check drift=0 bootstrap=1` — so *silent because
   healthy* and *silent because not running* stop looking alike, which is this job's own failure
   mode. On drift it writes `level=error event=cron-drift` with the first differing line, and
   **LOG-04 does the routing**: only the `error` reaches the report tick, and only when JOB-O02 (N5)
   exists to read it.
3. **A `PROGRAMS` row that states an exemption.** `gate: "none"` with a real `whyNoGate` (GAT-07),
   because the check reads `crontab -l` and renders — it races nothing, including a writer holding
   the gate exclusively, **which is exactly when you still want drift reported**. It is the first
   `gate: "none"` row this repo has, so validate rule 17 gets its first subject.
4. **It is covered by the config it verifies.** The entry is declared in `host/schedule.ts`, so the
   checker appears in the block it checks. That is deliberate and worth one line of `why`.

**Do (the job):**

```ts
export interface CronCheckDeps {
  readonly log: Logger;
  readonly crontabCmd: string;                     // envStr(CRONTAB_CMD_ENV) at the argv block
  readonly readCrontab: (cmd: string) => string;   // the seam; never the real binary in a test
  readonly schedule: readonly ScheduleEntry[];
  readonly instance: string;
}
export function check(deps: CronCheckDeps): { drift: string[]; bootstrap: number };
export default defineJob({ name: "ops-cron-check", plugin: "ops", description: …,
  permissionMode: "auto", exec: async (deps) => { … } });
```

- **It calls `cli/crontab.ts`'s `render`, `installedBlock`, `legacyRange` and `diff` — never a second
  copy.** `cli/` importing `host/` is already the shape N2 settled (ADO-01's open question, plan
  N2's Gaps item 14); this is `host/` importing `cli/`, the other direction, and it is the same one
  file that already couples them. Say it in the header; **flagged in Gaps item 7**, because it makes
  `cli` a runtime dependency of a job rather than an operator surface.
- **`CRONTAB_CMD` stays `required: true` with no default.** N2 F1's whole lesson: a real absolute
  default *is* a real crontab binary, so a caller who forgets must throw rather than silently read
  the developer's own crontab. **The schedule entry does NOT set it** — it arrives through the
  `dotenv: true` layer (`.env`, gitignored, per host). If unset, the job fails loudly with the row's
  own `why`, which is correct and is written into the entry's `why` so an operator knows the one
  thing they must do to turn this job on.
- **`permissionMode: "auto"`** — the field is required (PRT-05 since N3) and this job never runs an
  agent, so the value is inert. Use the narrower of the two rather than `bypassPermissions`, and say
  in a comment that it is unreachable. (`test/model.test.ts` test 7's companion scan says a
  `bypassPermissions` run declares `local: true`; an `exec` job that declared it would be claiming
  something untrue.)
- **`SAF`:** no new knob. The job performs no write at all — `readCrontab` reads, `render` is pure.
  It is the one job whose safe-run surface is *it has no write path*, and that sentence goes in the
  header rather than an unused `*_DRY_RUN`.

**Do (the schedule entry and program):**

```ts
{
  name: "ops-cron-check",
  cron: "15 22 * * *",
  job: "ops-cron-check",
  log: projectPath(".doppelganger/logs/ops-cron-check.log"),
  why: "Crontab drift, once a day at 22:15 UTC (05:15 WIB) — after the nightly window closes and clear of :00/:30, so a report is waiting before the workday. Diffs the installed managed block against a fresh render of host/schedule.ts: one info line every run, an error line only on drift. Declared here deliberately, so the checker is covered by the config it verifies. Needs CRONTAB_CMD set in .env (required, no default — N2 F1) or it fails loudly.",
}
```

```ts
"ops-cron-check": {
  self: true, gate: "none", dotenv: true,
  whyNoGate: "reads `crontab -l` and renders; it races nothing the gate protects, and it is most useful precisely when a writer is holding the gate and jobs are backing up behind it — queueing it would blind the check in the case it exists for",
}
```

`22 * * *` with a single minute is inside the croner ∩ POSIX intersection N2 measured (`dom` and
`dow` both unrestricted, so the divergence class cannot apply).

**Do (tests):**

1. **In sync → `drift: []`, `bootstrap` counted off the block itself**, one `info` line, no `error`.
2. **Drift → the diff lines**, one `error` line carrying the first differing line, exit code set.
3. **No managed block at all → one `error`** naming `crontab sync`, distinct from drift.
4. **An unnamed (legacy) block → a THIRD, distinct message** naming `sync --adopt` (INS-03).
5. **`readCrontab` throwing → one `error`, exit non-zero, and no `info` line** — a job that cannot
   read must not report "in sync".
6. **The real binary is never called.** Assert `deps.readCrontab` is the only path to a crontab and
   that no test supplies a real `crontabCmd`; belt-and-braces, `CRONTAB_CMD` is unset in the suite so
   the argv block would throw anyway.
7. **`ops-cron-check` is registered, its file exists, and its name carries an `ops-` prefix** — comes
   free from `test/jobs.test.ts` 1/2/3/5 once the registry entry lands, so this test asserts nothing
   new and the AC just names the suites that must stay green.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test host/jobs/ops-cron-check.test.ts` reports 6 passing.
- [ ] AC2 — **the three no-block cases are distinct.** Collapse case 4 into case 3 (drop the
      `legacyRange` branch). `npm test` exits non-zero on test 4. Revert.
- [ ] AC3 — **a read failure is not "in sync".** Change the catch to `return { drift: [] }`.
      `npm test` exits non-zero on test 5. Revert.
- [ ] AC4 — **the tests never touch the real crontab.** Run `crontab -l > /tmp/before.txt` before the
      suite and again after; `diff` must be empty. Record it. (This is LOOP.md's standing rule and it
      is the one job where it is worth performing rather than asserting.)
- [ ] AC5 — **the entry validates and the exemption is stated.** `node --test host/validate.test.ts`
      and `node --test test/jobs.test.ts` pass. Then blank `whyNoGate`: `npm test` exits non-zero
      with `gate "none" requires a non-empty whyNoGate (GAT-07)` — **validate rule 17's first live
      subject**. Revert.
- [ ] AC6 — **`--list` shows it.** `npm run supervisor -- --list`… there is no such script; run
      `node host/supervisor.ts --list` and paste the output in the commit body. Two entries, the
      `ops` group present, `gate` reading `none` and `resources` reading `-` for the first time.
- [ ] AC7 — **it runs.** `CRONTAB_CMD=/usr/bin/crontab npm run job ops-cron-check` on this machine
      exits 1 with `no managed block installed — run \`npm run crontab sync\`` (no block is installed
      here) and writes one `level=error event=cron-drift` line. Paste both. **This is the one AC that
      reads the developer's real crontab, deliberately and read-only**, and it is run by hand, never
      by the suite.

**Commit:** `ops-cron-check: crontab drift on a daily cadence, one line every run (JOB-O09)`

**Depends on:** J4.9 (the `WATCH` list), J4.11.

**Risks / what could be wrong:**
- **`host/` imports `cli/`.** New direction, one file, stated. TST-25's sibling clause ("no workspace
  names another workspace's `src/` by path") will rule on it at N5; `host/` is not a workspace, so
  nothing is phantom today. Gaps item 7.
- **AC7 reads a real crontab.** By hand, read-only, once, and the output is recorded. The SUITE never
  does — AC4 proves it.

---

## J4.13 — `kernel/runtime/delivery.ts`: the stamp, and the one thing that can fail  ·  JOB-O11, SUP-14

**Goal:** ship JOB-O11's contract with a producer that is real on this host, and say plainly what it
does and does not cover.

**Files touched:**
- `kernel/runtime/delivery.ts` (new)
- `kernel/runtime/delivery.test.ts` (new)
- `host/supervisor.ts` — `beat()` stamps; `BootDeps.heartbeatFailPath`
- `host/supervisor.test.ts` — two new tests
- `test/writes.test.ts` — one `REGISTER` row
- `test/layout.test.ts` — `.doppelganger/` allowlist gains `heartbeat.fail`

**Do:**

```ts
/** One stamp: a file that exists exactly while one outbound path is broken. */
export interface StampRow {
  readonly name: string;
  /** ROOT-relative. Never absolute — the same rule host/config.ts's GateResource follows. */
  readonly path: string;
  /** The module that writes it. */
  readonly writer: string;
  /** One line. This IS the stamp's doc. */
  readonly why: string;
}

export const DELIVERY_STAMPS: readonly StampRow[] = [
  {
    name: "supervisor-heartbeat",
    path: ".doppelganger/heartbeat.fail",
    writer: "host/supervisor.ts beat()",
    why: "the supervisor is alive and scheduling but could not write its liveness stamp — without this, probe 3 reports a healthy scheduler as dead",
  },
];

/** Never throws: a reporting path must not fail its caller over its own bookkeeping. */
export function deliveryStamp(path: string): (ok: boolean, detail?: string) => void;
```

- **PRESENCE, not staleness.** A healthy system writes nothing, so *no write in N minutes* is the
  normal state and a staleness test would cry outage on a quiet week.
- **`ok: true` → `rmSync(path, { force: true })`; `ok: false` → `writeFileSync(path, "<iso> <detail>\n")`.**
  Both inside one `try {} catch {}` — *a stamp we cannot write is not worth losing the send outcome
  over*.
- **The register is the v1 seam.** One row at N4. A `plugins/slack` send path adds a row, and J4.14's
  drift gate then forces `host/watchdog.sh` to grow the probe or the build fails. **No edit to the
  watchdog is needed for the mechanism; only for the new row.**

**Do (`beat()` — ruling 7's producer):**

```ts
export function beat(deps: BootDeps): void {
  const stamp = deliveryStamp(deps.heartbeatFailPath);
  try {
    mkdirSync(dirname(deps.heartbeatPath), { recursive: true });
    writeFileSync(deps.heartbeatPath, `${…}\n`);
    mkdirSync(dirname(deps.statusPath), { recursive: true });
    writeFileSync(deps.statusPath, JSON.stringify(snapshot(deps)));
    stamp(true);
  } catch (e) {
    log.warn("heartbeat-failed", { msg: errText(e) });
    stamp(false, errText(e));
  }
}
```

`beat()` still never throws — *a supervisor that dies because it could not write its own liveness
stamp turns a full disk into a dead fleet, which is strictly worse than the watchdog firing.*

**The documented limit, in the module header, not in a plan only.** A full disk kills both writes and
this probe goes with them. What it DOES catch is every per-file failure: a `chmod 400` on the
heartbeat, a root-owned file left by a `sudo` run, a read-only bind mount over one path, an `ENOSPC`
that clears between the two writes. **Two paths, two inodes; one filesystem.** The reference states
its own equivalent limit the same way, and this row is honest about being weaker than the reference's
because the reference has a send and N4 does not.

**Do (tests — `kernel/runtime/delivery.test.ts`):**

1. `(false, "boom")` creates the file; its first line matches `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ boom$`
   — the `nowIso()` shape, so the stamp and the log line agree on precision (LOG-01's clock).
2. `(true)` removes it; `(true)` again on an absent file is a no-op, not a throw.
3. `(false)` with no detail writes `unknown`.
4. **A path that cannot be written swallows the error.** Point it inside a file (`<tmpfile>/x`) →
   `ENOTDIR` → no throw, no file.
5. **`DELIVERY_STAMPS` paths are ROOT-relative** — never absolute, the `GateResource` rule — and
   every row has all four fields non-empty.
6. **Every row's `path` resolves inside ROOT** via `projectPath`, which is INS-02's project-relative
   category made mechanical (host/config.test.ts test 3's shape).

**Do (tests — `host/supervisor.test.ts`):**

7. **A failing heartbeat write stamps.** `heartbeatPath` pointed inside a file so `writeFileSync`
   throws; assert one `heartbeat-failed` warn **and** that `heartbeatFailPath` now exists.
8. **A succeeding write removes it.** Pre-create the stamp, beat successfully, assert it is gone.

**Do (`test/writes.test.ts`):** `kernel/runtime/delivery.ts` signs door 3 —
`category: "project-relative"`, `reason: "writes and removes one delivery stamp under ROOT (JOB-O11)"`.
`host/supervisor.ts`'s existing row grows the stamp to its reason text.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/delivery.test.ts` reports 6 passing.
- [ ] AC2 — **the direction is not inverted.** Swap `rmSync` and `writeFileSync`. `npm test` exits
      non-zero on tests 1 and 2 **and** on supervisor tests 7 and 8. Revert. (Four reds is the point:
      the contract and its producer are separately covered.)
- [ ] AC3 — **it never throws.** Delete the `try`/`catch`. `npm test` exits non-zero on test 4.
      Revert.
- [ ] AC4 — **the producer fires.** Delete `stamp(false, …)` from `beat()`'s catch. `npm test` exits
      non-zero on supervisor test 7. Then restore and delete `stamp(true)`: non-zero on test 8.
      Revert both.
- [ ] AC5 — **the register is checked, not decorative.** Add a row with an absolute `path`.
      `npm test` exits non-zero on test 5. Then make it ROOT-relative but point outside
      (`"../x.fail"`): non-zero on test 6. Remove.
- [ ] AC6 — `node --test test/writes.test.ts` passes; deleting `kernel/runtime/delivery.ts` from
      `REGISTER` turns door 3 red by name.
- [ ] AC7 — `node --test test/layout.test.ts` passes with `heartbeat.fail` allowlisted; removing it
      turns assertion 15 red only when the file exists — **record whether it exists after the run**
      (it must not: every test uses its own temp root).

**Commit:** `delivery: the stamp contract, with the supervisor's heartbeat as its one real producer (JOB-O11, SUP-14)`

**Depends on:** J4.1.

**Risks / what could be wrong:**
- **One row, and the reference has two.** Slack and Jira delivery are v1. Shipping the register with
  one row rather than the probe with none is the line this plan draws between *a contract with a
  producer* and *a vacuous placeholder* (SUP-12's precedent). Gaps item 4 records that JOB-O11's row
  describes a SEND and N4 has none.
- **`BootDeps` gains a required field.** Every harness supplies it; the argv block computes
  `projectPath(".doppelganger/heartbeat.fail")`. Required for the same reason `reapOnBoot` became
  required in J4.6.

---

## J4.14 — JOB-O10 `host/watchdog.sh`: the one entry outside the supervisor  ·  JOB-O10, SUP-09, SUP-08, INS-03, KRN-06

**Goal:** a liveness path that does not run through the toolchain it watches, on the real crontab,
bash and system binaries only — the only program that can still speak when everything else is wedged.

**Files touched:**
- `host/watchdog.sh` (new, mode 755)
- `host/watchdog.test.ts` (new)
- `host/config.ts` — two `EnvSpec` rows (the bash knobs)
- `host/schedule.ts` — the `ops-watchdog` entry (`supervised: false`) and its `PROGRAMS` row
- `host/classes.ts` — `"watchdog.sh"` joins the pinned `WATCH` list
- `test/knobs.test.ts` — two rows
- `test/layout.test.ts` — `watchdog.lock`, `watchdog.breach` allowlisted
- `roadmap.md` §2.27 — already fixed by J4.1

**Do (the script). No node, no npm, no `node_modules`, no SQLite, no model call, no network.**

```bash
#!/usr/bin/env bash
# JOB-O10 — the liveness path that does NOT run through the toolchain it watches.
set -uo pipefail            # NOT set -e: each probe is EXPECTED to fail sometimes; that is the
                            # signal, not an error. A watchdog that exits on its first failed probe
                            # reports nothing, which is precisely the failure it exists to catch.

ROOT="${ENGINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
. "$ROOT/kernel/runtime/log/log.sh"
log_init ops-watchdog
```

**Self-location is the fallback and it matters MOST here**: this is the one program on the real
crontab, where the environment is bare and `ENGINE_ROOT` is not exported. A hardcoded path resolves
to nothing on any other host, silently — a watchdog probing nothing reports nothing.

**Its own lock, deliberately NOT the gate (GAT-07).** `flock -n` on
`.doppelganger/watchdog.lock`, inlined. This is the one job that must run precisely when everything
else is wedged, **including behind a writer holding the gate exclusively**; gating it would let the
failure it exists to catch silence it. And the gate is in-memory inside the supervisor, which this
process is deliberately outside of — so it has no memory to share with anything, and a real `flock`
is the only lock available.

**The four probes (ruling 6):**

```bash
# 1. node_modules is a real directory. A symlink here IS the reference's 2026-07-30 failure:
#    a worktree's link reached master and the main checkout materialized it over its own tree.
[ -L "$ROOT/node_modules" ] && fault "node_modules is a SYMLINK -> $(readlink …)"
[ ! -d "$ROOT/node_modules" ] && fault "node_modules is missing"

# 2. node runs AND strips types. Checked by RUNNING it, not by testing for a file: a dangling
#    symlink is present, looks executable, and does not run.
node --version                      || fault "node does not execute — every job is failing"
node "$ROOT/host/watchdog.probe.ts" || fault "node cannot strip types — every job is failing"

# 3. the supervisor's 60s heartbeat (SUP-14). THE probe that matters: a dead supervisor means
#    NOTHING is scheduled. Checked by mtime, never by `systemctl is-active` — cron hands this
#    script a bare environment with no XDG_RUNTIME_DIR and no session bus.
[ ! -f "$HEARTBEAT" ]                                  && fault "heartbeat missing — the scheduler has never started"
[ -n "$(find "$HEARTBEAT" -mmin "+$SUPERVISOR_STALE_M" -print -quit)" ] && fault "heartbeat stale …"

# 4. the delivery stamp (JOB-O11). PRESENCE is the fault.
[ -f "$ROOT/.doppelganger/heartbeat.fail" ] && fault "the supervisor is ALIVE but cannot write its heartbeat since $(head -c 40 …) — probe 3 above is a false alarm"
```

`host/watchdog.probe.ts` is a two-line typed file whose only purpose is probe 2. It is named in §1
(J4.1) and is the only `.ts` file in this repo that exists to be *run by bash*.

**Probe 4 is ordered LAST and read FIRST in the report** — when the stamp is present, its line is
printed above probe 3's, because it is the correction to it.

**The report (ruling 6's honest delivery):**

```bash
if [ ${#faults[@]} -eq 0 ]; then
  rm -f "$BREACH"                      # PATH 1 cleared — the next good tick removes the alarm
  log_info healthy supervisor_stale_m="$SUPERVISOR_STALE_M"
  exit 0
fi
for f in "${faults[@]}"; do log_error breach msg="$f"; done   # ALWAYS — one line per fault
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${faults[@]}" > "$BREACH"   # PATH 1
[ "$DRY" = "1" ] && { log_info dry-run faults="${#faults[@]}"; exit 0; }
exit 1                                  # PATH 2 — cron's own MAILTO carries stdout+stderr
```

- **There is no Slack, no hub, no `claude -p` fallback, and no cooldown.** All four are declined with
  their reasons in ruling 6 and repeated in the script header, so the next reader does not think they
  were forgotten.
- **`exit 1` is the second path and it is weak.** Cron mails a non-zero-exit job's output to `MAILTO`
  or the crontab owner. It shares nothing with node, `node_modules`, the supervisor or the gate — but
  nobody reads local mail on a laptop. The header says exactly that, and says the day a Slack plugin
  lands, `DELIVERY_STAMPS` grows a row and probe 4 covers it for free.

**Do (the knobs — a bash-read knob still gets an `EnvSpec` row, KRN-06):** in `host/config.ts`,

```ts
export const WATCHDOG_SUPERVISOR_STALE_M_ENV: EnvSpec = {
  key: "WATCHDOG_SUPERVISOR_STALE_M", default: "5",
  why: "how many missed 60s supervisor heartbeats (SUP-14) count as a dead scheduler; read by host/watchdog.sh, never by TypeScript",
};
export const WATCHDOG_DRY_RUN_ENV: EnvSpec = {
  key: "WATCHDOG_DRY_RUN", default: "0",
  why: "the watchdog logs and prints its faults, writes no breach file and exits 0 (SAF-01, for a tool)",
};
```

with `readers: []` in `test/knobs.test.ts`'s `ROWS` — the `<NAME>_DB` precedent for a row no TS
reader resolves. **The row is not a lie because a drift gate binds it to the script.**

**Do (the drift gate — `host/watchdog.test.ts`):** the `log.sh` ↔ `emit.ts` precedent (TST-18),
one directory over.

1. **Every `${NAME:-default}` in the script has a matching `EnvSpec` row, and the DEFAULTS agree.**
   Parse `\$\{([A-Z][A-Z0-9_]*):-([^}]*)\}` out of `host/watchdog.sh`, drop the ones a row already
   owns elsewhere (`ENGINE_ROOT`, `LOG_LEVEL`), and `deepEqual` the remaining `{key, default}` set
   against the two rows above. **Neither side may grow alone.**
2. **Every path the script stats is a `DELIVERY_STAMPS` row or a named constant.** Extract the
   `.doppelganger/…` literals; assert the stamp set is exactly `DELIVERY_STAMPS.map(r => r.path)`
   plus `{watchdog.lock, watchdog.breach, supervisor.heartbeat}`. **This is the v1 seam's teeth**:
   a new row with no probe goes red here.
3. **The script names no node, no npm and nothing under `node_modules`** — except probe 2's
   deliberate `node --version` and `node …/watchdog.probe.ts`, which are signed by name in the test.
   A grep for `npm `, `node_modules/`, `tsx`, `sqlite3` finds nothing.
4. **`set -e` is absent and `set -uo pipefail` is present** — the one shell option choice that
   decides whether this program reports anything at all.
5. **It runs, healthy.** `ENGINE_ROOT=<tmp fixture with node_modules symlinked, a fresh heartbeat,
   no stamp> bash host/watchdog.sh` → exit 0, one `level=info event=healthy` line on stderr, no
   breach file.
6. **It runs, breaching.** Same fixture with the heartbeat aged (`touch -d`) → exit 1, one
   `level=error event=breach` line naming the heartbeat, and the breach file exists.
7. **The next healthy tick removes the breach file.**
8. **Probe 4 corrects probe 3.** Fixture with an aged heartbeat AND the stamp present → the report
   carries the *alive but cannot stamp* line, and it is printed before the stale-heartbeat line.
9. **`WATCHDOG_DRY_RUN=1` on the breaching fixture** → exit 0, the faults printed, **no breach
   file**.
10. **The log lines are the ONE shape.** Feed the script's stderr to `kernel/runtime/log/parse.ts`
    and assert every line parses — LOG-01/TST-18, applied to the fifth bash emitter.

**Do (the entry — SUP-09's one `supervised: false`):**

```ts
{
  name: "ops-watchdog",
  cron: "3,18,33,48 * * * *",
  script: "host/watchdog.sh",
  supervised: false,
  log: projectPath(".doppelganger/logs/ops-watchdog.log"),
  why: "Runtime liveness every 15 min, round the clock — the ONE job that does not run through the toolchain it watches, and THE ONLY ENTRY ON THE REAL CRONTAB (SUP-09). bash plus system binaries: no node except a deliberate two-line type-strip probe, no npm, nothing under node_modules, no model call, no network. A liveness probe scheduled by the process it probes reports nothing in the one case that matters. Four probes: node_modules is a real directory, node runs and strips types, the supervisor's 60s heartbeat (SUP-14) is younger than WATCHDOG_SUPERVISOR_STALE_M, and JOB-O11's heartbeat stamp is absent. It reports to its own log, to .doppelganger/watchdog.breach (presence is the alarm) and by exiting non-zero so cron's MAILTO carries it — there is no Slack path before v1 and this entry does not pretend otherwise.",
}
```

```ts
"watchdog.sh": {
  self: true, gate: "none", dotenv: false,
  whyNoGate: "must run precisely when everything else is wedged, including behind a writer holding the gate exclusively; gating it would let the failure it exists to catch silence it. It takes its own flock instead — the gate is in-memory inside the supervisor and this process is deliberately outside it",
}
```

**Note the `PROGRAMS` key is `watchdog.sh`, not `ops-watchdog`** — `programOf(e)` is
`e.job ?? e.script ?? e.name`, so a `script:` entry keys on the script path. That is the first time
this repo has had one, and it is why `host/classes.test.ts`'s `WATCH` list carries the string
`"watchdog.sh"` while the ENTRY carries the `ops-` prefix SUP-20 requires. **`stageOf("watchdog")`
is `misc`** — `watchdog` does not start with `watch-` — so a bare `watchdog` entry name would be
refused by validate rule 2. `ops-watchdog` is not cosmetic; it is the only spelling that validates.

**Do (the crontab's first real content):** `bootstrapEntries(SCHEDULE)` becomes non-empty for the
first time, so `crontab render` emits its first command line and `tally()`'s `bootstrapCount` stops
being 0. `cli/crontab.test.ts` already covers the mechanics against fixtures; the LIVE render does
not, so add one assertion there: `render(SCHEDULE, "probe")` contains exactly one command line and it
is `commandOf` of the watchdog entry.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test host/watchdog.test.ts` reports 10 passing.
- [ ] AC2 — **the knob gate binds both ways.** Change the script's `${WATCHDOG_SUPERVISOR_STALE_M:-5}`
      to `:-20`. `npm test` exits non-zero on test 1 naming the disagreement. Revert. Then add a
      `${WATCHDOG_COOLDOWN_M:-60}` to the script with no row: non-zero again. Remove.
- [ ] AC3 — **the stamp seam has teeth.** Add a second `DELIVERY_STAMPS` row without touching the
      script. `npm test` exits non-zero on test 2. Remove.
- [ ] AC4 — **the toolchain ban is real.** Add `"$ROOT/node_modules/.bin/tsc" --version` to the
      script. `npm test` exits non-zero on test 3. Remove.
- [ ] AC5 — **`set -e` would silence it.** Add `set -e`. `npm test` exits non-zero on test 4 **and**
      on test 6 (the first failing probe aborts before any fault is logged). Record both. Revert.
- [ ] AC6 — **probe 3 is the one that matters, and probe 4 corrects it.** Delete probe 3: non-zero on
      test 6. Restore; delete probe 4: non-zero on test 8. Revert.
- [ ] AC7 — **SUP-09 is enforced.** Add `supervised: false` to the `ops-cron-check` entry too.
      `npm test` exits non-zero with
      `more than one entry sets supervised: false (SUP-09) — at most one is allowed` —
      **validate rule 22's first live subject**. Revert.
- [ ] AC8 — **rule 23 has a subject.** Put a bare `%` in the watchdog entry's `log` path.
      `npm test` exits non-zero with the unescaped-% message — **rule 23's first live subject**.
      Revert.
- [ ] AC9 — **the crontab block is real.** `CRONTAB_DRY_RUN=1 CRONTAB_CMD=/usr/bin/crontab npm run
      crontab -- render` prints a block with exactly one command line, and it names
      `host/watchdog.sh` with **no `node`** (ruling 5). Paste it. Run `crontab -l | diff - /tmp/before.txt`
      before and after the whole suite: empty.
- [ ] AC10 — **it runs on this machine, healthy and breaching.** `bash host/watchdog.sh` against the
      live checkout with no supervisor running → exit 1, the heartbeat-missing fault, a breach file.
      Start nothing; `rm .doppelganger/watchdog.breach` afterwards and record that `git status
      --porcelain` is clean.
- [ ] AC11 — `node --test host/classes.test.ts` passes with `"watchdog.sh"` in `WATCH`; removing it
      goes red naming the program.

**Commit:** `watchdog: four probes, bash only, the one entry on the real crontab (JOB-O10, SUP-09)`

**Depends on:** J4.11 (`scriptCommand`), J4.13 (the stamp), J4.9 (`WATCH`).

**Risks / what could be wrong:**
- **Path 2 is weak and the plan says so.** Cron mail on a developer laptop reaches nobody. It is the
  only channel that exists at N4 that shares nothing with the toolchain, and inventing an integration
  to make the story nicer is the thing this plan refuses to do. **Gaps item 4.**
- **`host/watchdog.probe.ts` is a file that exists to be run by bash.** It needs a §1 row and it is
  the only one of its kind. An alternative — `node --input-type=module -e` with an inline type
  annotation — was rejected because quoting TypeScript inside bash inside a crontab line is exactly
  the kind of thing that works until it does not.
- **`find -mmin` is GNU-specific.** So is `readlink` without `-f`. This host is Linux; the reference
  runs the same shapes. Stated in the header as a platform assumption, not hidden.

---

## J4.15 — TST-17: what is new, what N2 already shipped, and the contract the third entry makes possible  ·  TST-17, GAT-03, GAT-07, SUP-10, SUP-12, SUP-17

**Goal:** satisfy TST-17 honestly — name the halves that already exist, ship the half that does not,
and **re-ship nothing under a new name.**

**Files touched:**
- `kernel/runtime/gate.test.ts` — a header paragraph, no new test
- `host/gate-contract.test.ts` (new — the live half)
- `host/window.test.ts` — the discrimination the third entry makes real
- `host/supervisor.test.ts` — `--list` over three entries

**TST-17's row reads: *Gate contract; lease primitive; reaper guards; queue claim/settle; broker over
a real socket …; worker loop with a fake handler.* Roadmap §3's N4 line narrows it to "(lease +
breaker half)". Four halves, four different states:**

| half | state |
|---|---|
| **gate contract** | **SHIPPED AT N2**, J2.4/J2.5, `kernel/runtime/gate.test.ts` — 24 tests over three levels: the exclusion decision against a pure model over all 256 ordered request pairs; the acquisition order over every caller spelling; no wait-for cycle over all 64 ordered writer pairs. **Nothing here is re-shipped.** J4.15 adds one paragraph to that file's header naming TST-17 as the row it satisfies, so a reader looking for TST-17 finds it. |
| **lease primitive** | **NEW, J4.3 + J4.4** — 21 tests. |
| **reaper guards** | **NEW, J4.5** — 12 tests, ten guards. |
| **breaker** | **NEW, J4.8** — 13 tests plus the three real-spawn ones. |
| queue claim/settle · broker over a socket · worker loop | **v1** (M9). Not in this phase's Ships list. |

**What is genuinely new and is honestly called "the gate contract":** N2's 24 tests all build
**fixture** gates over `["a","b","c"]`. Nothing has ever asserted the contract over the REAL
`RESOURCE_NAMES` and the REAL `PROGRAMS`, because until N4 there was one program and one entry, and
an assertion over one element is an assertion about nothing. With three entries and three programs it
becomes real:

**Do (`host/gate-contract.test.ts`):**

1. **Every program's `resources` names a real gate resource.** `validate()` rule 14 already refuses
   this at boot; the contract test asserts it as a property of the pair `(PROGRAMS, RESOURCE_NAMES)`
   with no schedule involved — so a program added without an entry is still checked.
2. **GAT-03 live: the concurrency the split buys is the concurrency the schedule needs.** For every
   ordered pair of programs, compute whether the gate would let them hold at once (a real
   `createGate(RESOURCE_NAMES)`, two real `acquire` calls, `state()` read between them). Assert the
   set of concurrent pairs equals the set computed independently from the declared `resources` —
   disjoint `excl` sets, or either side `gate: "none"`, or both `shared`. At N4 that is: {cron-check,
   watchdog} concurrent, {cron-check, nightly} concurrent, {watchdog, nightly} concurrent,
   {nightly, nightly} not — **and the last one is the whole point of `self`.**
3. **GAT-07 live: every `gate: "none"` program has a non-empty `whyNoGate`, and there are exactly
   two.** The COUNT is derived from `PROGRAMS`, never written beside it; what is asserted is that
   every exemption states a reason.
4. **GAT-06 live: `acquireSelf` is keyed on the PROGRAM, not the entry.** Build two entries of the
   same program (there are none in `SCHEDULE`, so build them as a fixture from a REAL `PROGRAMS`
   row) and assert the second is refused — the property N2 tested against a fixture key, now against
   a real program name.
5. **The gate a real boot builds is the gate this contract ran against.** Assert
   `createGate(RESOURCE_NAMES).resources` deep-equals `RESOURCES.map(r => r.name)` — one line,
   and it is what makes 1–4 statements about production rather than about a copy.

**Do (`host/window.test.ts` — SUP-10/12's first discriminating subject):** the existing live test
drives `entriesInWindow(SCHEDULE, <fixture window>, PROGRAMS)` and asserts the one entry that
existed. With three entries it becomes a real discrimination: a 16:00–22:00 UTC fixture window
contains `nightly-sandcastle` (`38 16-21 * * *`) and `ops-watchdog` (`3,18,33,48 * * * *`, which
fires inside ANY window) but **not** `ops-cron-check` (`15 22 * * *`, one minute past the close).
Assert the exact two-name set, and add the mutation to the AC below. **This is the assertion N2
called vacuous and J3.15 called half-real; N4 is where it earns its place.**

`REFRESH_WINDOW` itself stays `null` — no phase declares one, and inventing a maintenance window for
three jobs would be inventing the subject. The live call still correctly returns `[]`.

**Do (`host/supervisor.test.ts` — SUP-17 over three entries):** `list(SCHEDULE, …)` now produces two
stage groups (`nightly`, `ops`), a `by` column with both `sup` and `cron`, a `resources` column with
both `repo` and `-`, and a tally line reading `2 supervised, 1 on the real crontab`. Assert the tally
by parsing it, never by writing `2` and `1` as literals — derive both from `supervisedEntries` and
`bootstrapEntries`.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test host/gate-contract.test.ts` reports 5 passing.
- [ ] AC2 — **nothing is re-shipped.** `git diff --stat` for this commit shows `kernel/runtime/gate.test.ts`
      changed by comment lines only (`git diff -U0 kernel/runtime/gate.test.ts | grep -c '^[+-][^+-]'`
      counts only comment lines). Record the number.
- [ ] AC3 — **the live GAT-03 assertion fires.** Change `ops-cron-check`'s program to
      `gate: "excl", resources: ["repo"]`. `npm test` exits non-zero on test 2 — the pair
      {cron-check, nightly} is no longer concurrent while the independent computation says it should
      be. Revert.
- [ ] AC4 — **the exemption count is derived.** Add a third `gate: "none"` program with an empty
      `whyNoGate`. `npm test` exits non-zero on test 3 and on `host/validate.test.ts`. Remove.
- [ ] AC5 — **the window now discriminates.** Change `ops-cron-check`'s cron to `15 21 * * *` (inside
      the fixture window). `npm test` exits non-zero on `host/window.test.ts` with a three-name set.
      Revert. Then change `nightly-sandcastle`'s cron to `38 9-14 * * *`: non-zero with a one-name
      set. Revert.
- [ ] AC6 — **`--list` is derived, not written.** Change the tally assertion's parse to a literal
      `"2 supervised, 1 on the real crontab"` and add a fourth entry: the literal version stays green
      while the derived one goes red. Record both, then keep the derived form.
- [ ] AC7 — **the real gate is the tested gate.** Add a third `RESOURCES` row. `npm test` exits
      non-zero on test 5 **and** the pair computation in test 2 changes. Remove.

**Commit:** `gate-contract: TST-17's live half over the real PROGRAMS and RESOURCES (TST-17, GAT-03/06/07)`

**Depends on:** J4.12, J4.14 (it needs three entries to be non-vacuous).

**Risks / what could be wrong:**
- **Test 2 is an O(n²) walk over programs.** Three programs today, nine pairs, microseconds. It grows
  with the schedule; if it ever costs more than the suite's own noise, the bound goes in the file's
  exceptions table with a direction and a measurement (the J1.6 assertion-8 shape). Measure and record
  the duration now, so the growth has a baseline.
- **TST-17's queue/broker/worker clauses have no subject and this job says so rather than skipping
  the row.** A reviewer looking for them finds the table above. Gaps item 5.

---

## J4.16 — close N4  ·  §3, `WORK.md`, `LOOP.md`

**Goal:** the MVP is done; the record says so, and every drift gate that reads the record agrees.

**Files touched:** `WORK.md`, `LOOP.md`, `roadmap.md` §3 (only if J4.1's rewrite drifted)

**Do:**

1. **Tick every N4 box in WORK.md**, each carrying its job number the way N0–N2 do:
   `- [x] (J4.8) **QTA-01** …`. All 22. The `moved out of this milestone` block already lists
   QTA-02/03/04/10, LSE-12 and JOB-O12; **confirm each is still out** and add `JOB-O03` with
   `→ N5 · the one-minute cadence is a job; the boot sweep is LSE-09 and shipped here`.
2. **Update LOOP.md's phase table** — N4's four cells. Mark Verify `—` (it has not run); the loop's
   own next step is the VERIFY pass.
3. **Add the honest close under `✅ MVP READY`**, replacing nothing: the three sentences from this
   plan's opening, plus what is NOT true yet — no plugin, no manifest, no `boot()`, one job that
   runs an agent, and **no production lease writer** (ruling 3). The line already says "What it is
   NOT yet: a framework"; extend it rather than softening it.
4. **Record the four measurements** this phase produced, in LOOP.md's `Settled questions`:
   - `isOwnerAlive` fails toward DEAD in three branches of the reference; ours splits `unknown` from
     `dead` (J4.2, ruling 4).
   - `commandOf` rendered `node <script>.sh` and `spawnChild` exec'd it directly; one function now,
     the N3 F1 precedent applied a second time (J4.11, ruling 5).
   - The quota fixture corpus is first-hand from this machine's reference store; the four tier-1
     rows and their dates (J4.8, ruling 1).
   - `SHED_MODEL` cannot be a literal outside `kernel/ports/job.ts` because `test/model.test.ts`
     test 6 is exact (J4.9, ruling 8).
5. **Push `dev`** and record the CI run URL. LOOP.md's own note says CI stopped triggering on
   2026-08-26 — check `gh run list --branch dev` before trusting the badge, and if no run appears,
   record that instead of claiming one.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0. Record the four numbers against J4.1's baseline and the delta.
- [ ] AC2 — **assertion 12 flips.** With N4 ticked, `node --test test/layout.test.ts` passes and N4
      becomes a SHIPPED phase — so every `N4` row in §1 is now `must-exist`. Delete
      `kernel/runtime/proc.ts`: the run must fail with `§1 names kernel/runtime/proc.ts as N4, but it
      is absent from disk`. Restore.
- [ ] AC3 — **assertion 14 binds N4 for the first time.** `node --test test/layout.test.ts` passes.
      Then change §3's Ships range from `LSE-01…11` to `LSE-01…10`: it must go red naming `LSE-11` as
      the disagreement. Restore. (A bare ID cannot be deleted from a range without changing its
      bounds, which is why the mutation edits the range rather than removing a token — removing
      `INS-04` works too and is the simpler second mutation; perform both.)
      **This is the AC J4.1 could only rehearse.**
- [ ] AC4 — **the count is right.** WORK.md's N4 section has exactly 22 ticked boxes and the
      `✅ MVP READY — 123 items` line matches the sum of the five phases' ticked boxes, derived by a
      one-liner pasted into the commit body — never asserted by writing 123 again.
- [ ] AC5 — **the moved-out rows are still out.** `grep -c 'QTA-02\|QTA-03\|QTA-04\|QTA-10\|LSE-12\|JOB-O12'`
      inside WORK.md's N4 checklist (excluding the `<details>` block) returns 0.
- [ ] AC6 — CI: `gh run list --branch dev --limit 3`. Paste it. If no run appears within 10 minutes
      of the push, record that and cite LOOP.md's open item rather than waiting.

**Commit:** `work: N4 done — the loop is safe to leave alone (§3, WORK.md, LOOP.md)`

**Depends on:** J4.15.

**Risks / what could be wrong:**
- **Ticking N4 makes every N4 §1 row `must-exist` and every N5 row `must-be-absent`.** If any job
  created a file §1 does not name, or named one it did not create, this is where it surfaces. AC2 is
  the rehearsal; run it before committing, not after.
- **The `123 items` line.** It is a number in a doc with no gate. AC4 derives it once by hand; a
  `TST-` row that pins it would be better and does not exist. Gaps item 10.

---

## Summary of the resolved tensions

| Tension | Resolution |
|---|---|
| **A test cannot wall a real account, and a breaker nothing exercises proves nothing** | Three independent seams, none of them a clock mock. **The classifier is pure** — a fixture corpus, driven as one `deepEqual`. **The window is a knob read per call** — `withWindow(0, …)` produces a lapsed window and `withWindow(60_000, …)` a live one, with no sleep. **The stored instants are writable** — `metaSet("until:…", isoAgo(3h))` produces a continuous outage or a new one on demand. And the **whole loop** runs on N3's measured fake-`claude`-on-`PATH` harness: a fake that prints this machine's own recorded spend-limit wording and exits 1 parks the breaker through the real `run()`, the real rejection, the real `errText`, in ~100 ms, on every commit. |
| **TST-19 says fixtures are lifted from real data, and this repo has never been walled** | The reference's LIVE store on this machine is the source: `xenith/engine/.sandcastle/state/quota.db` holds five real parks, four of them dated 2026-08-26, in three nesting depths — bare, `claude-code exited with code 1:\n…`, and `task N failed: …`. That is first-hand. The other six wordings come from the reference's own test corpus, each with a dated incident comment, marked `via: "reference-corpus"` per row. Nothing is invented. Nothing is pinned: `QUOTA_FIXTURE_RECHECK=1` is opt-in and asserts no bytes. |
| **LSE-11 says every branch fails toward alive; the reference's own code fails toward DEAD in three** | Measured: `pidNamespace()` reads `/proc/self/ns/pid`, `bootTimeSec()` reads `/proc/stat`, and a `/proc` that answers the first while refusing the second turns every owner into a corpse and every live claim into a reap. `ENOENT` and `EACCES` are distinct and both reachable on this host. Ours returns a three-member `Liveness` and reaps on **`"dead"` only** — with the three `/proc` readers injected, so "fails toward alive" is a grid, not three lucky branches. `isOwnerAlive` survives as the boolean face so LSE-11's own vocabulary still fits. |
| **"A killed pass does not wedge the next one" — and nothing at N4 takes a lease** | Stated, not papered over. Two candidate writers were considered and **declined with reasons** (a base-SHA key retires itself on a no-op pass; a per-minute key needs LSE-12's constant-key release, which is M9). So the gate is proved where it is provable: a `held` claim owned by a **real dead pid**, seeded into a throwaway `LEASE_DB`, deleted by the **real supervisor booting as a child process**, with `event=lease-reaped` read off its stderr before `event=supervisor-up`. No spy anywhere in that sentence. Gaps item 3 records that LSE-01…11 land one phase ahead of their first writer. |
| **JOB-O11 says "written on a failed send", and N4 has no send** | The contract ships with **one real producer and its limit written down**: `beat()`'s catch block. A supervisor that is alive and scheduling but cannot stamp is, from outside, identical to a dead one — and probe 3 reports the second. That is a live misdiagnosis in code that exists today, and probe 4 corrects it. The circularity is stated (one filesystem) rather than hidden, and the v1 seam is a **register plus a bash drift gate**: a Slack send path adds a `DELIVERY_STAMPS` row and the watchdog must grow a probe or the build fails. |
| **The watchdog must report, and there is nothing to report to** | Three channels, all local, all honest: the **log** (`log_error breach`, which JOB-O02 will read at N5), a **breach file** whose presence is the alarm, and **exit 1** so cron's own `MAILTO` carries it. Cron shares nothing with node, `node_modules`, the supervisor or the gate. It is a weak channel and the script header says so. **Declined, each with the phase that brings its subject:** the reporter-freshness probe (JOB-O02, N5), the Slack and Jira stamps, `WATCHDOG_STALE_M`, `WATCHDOG_COOLDOWN_M`, and the `claude -p` fallback. Declining beats a vacuous probe — SUP-12's own precedent. |
| **`commandOf` would have rendered `node host/watchdog.sh`** | Found by writing the first `script:` entry, not by review — `SCHEDULE` has never held one, and `host/schedule.test.ts` test 7 asserts only that the script NAME survives, so `node` was invisible. Meanwhile `spawnChild` exec'd the script directly: two spellings, disagreeing, suite green. **This is N3 F1 exactly, one row over**, and it gets N3 F1's fix: `scriptCommand(script)`, one function, two consumers. A `.sh` renders **no interpreter** — a bare `bash` is a PATH lookup in cron's bare environment (N2 F1's hazard) and `/bin/bash` is a door-1 literal that moves between distributions — so `validate()` grows two rules that make a shebang safe: **executable, and starts with `#!`**. |
| **The watchdog's knobs are read by bash, and KRN-06 says every knob is an `EnvSpec` row** | Both, bound together. The rows live in `host/config.ts` with `readers: []` (the `<NAME>_DB` precedent) and a **drift gate parses `${NAME:-default}` out of `host/watchdog.sh` and `deepEqual`s the set against the rows** — neither side may grow alone. Same technique as `log.sh` ↔ `emit.ts` (TST-18) and `crontab check`. A row nothing reads would be a lie; a row a gate binds to the script that reads it is a definition. |
| **`SHED_MODEL` is a model literal, and `test/model.test.ts` test 6 admits exactly one file** | The downshift target lands as **`DEFAULTS.shedModel` in `kernel/ports/job.ts`**, and `kernel/runtime/shed.ts` contains no `claude-` literal at all. That is not a dodge around a gate — it is HRN-01's own rule and the reference's own stated intent ("bump both the day `DEFAULTS.model` bumps generation"). Test 6's allowlist does not grow; tests 3 and 4 grow one assertion each so the new value is held to `PINNED` and the alias denylist too. |
| **TST-17 names six things and four of them exist or are v1** | A table, in the job, saying which is which: the **gate contract shipped at N2** (24 tests, three levels — `kernel/runtime/gate.test.ts` gains a header paragraph and **not one test**), the lease primitive and reaper guards are J4.3–J4.5, the breaker is J4.8, and queue/broker/worker are M9. What is genuinely new is the half N2 could not write: the contract over the **real** `PROGRAMS` and `RESOURCES`, which needed a schedule with more than one entry to say anything at all. AC2 measures the diff to `gate.test.ts` in lines, so "re-shipped under a new name" is checkable. |
| **The schedule grows for the first time, and three `validate()` rules have never had a subject** | Named and exercised: **rule 22** (at most one `supervised: false`) fires for the first time — AC7 of J4.14 adds a second and watches it refuse. **Rule 23** (unescaped `%` in a rendered bootstrap command) gets its first subject — AC8. **Rule 17** (`gate: "none"` needs a `whyNoGate`) gets its first two — J4.12 AC5. Plus `bootstrapEntries` becomes non-empty, so `crontab render` emits its first command line and `tally()`'s count stops being 0; and `entriesInWindow` stops being a one-element assertion and starts discriminating three entries against a fixture window (J4.15 AC5's two mutations). |
| **The suite is RED before N4 starts, and it is not N4's fault** | Precondition P1, with the ownership ruling written down: J3.17's real pass left a full second checkout under `.doppelganger/worktrees/` and five repo-wide walkers skip only top-level `node_modules` and `.git`. J3.18 may fix it; if not, J4.1 does, as a test-only commit citing the N3 IDs. **Half of it is structural and cannot wait**: `.doppelganger/state/` gains `lease.db` and `quota.db`, and assertion 15's "any `.db` below the top level is an offender" rule cannot tell a leaked test store from `STATE_DIR`, which is where `dbPath()` puts every database by design. J4.3 replaces it with a rule **derived from the real `dbPath(` call sites**, sharing the scanner `test/skills.test.ts` assertion 11 already uses. |

---

## Gaps I found in the roadmap

1. **`§1` marks `quota.ts` and `shed.ts` as `v1`, and WORK.md ships them at N4.** They sit on the
   `queue.ts  quota.ts  shed.ts   v1` line, which `test/layout.test.ts` assertion 12 reads as three
   must-be-absent rows. `queue.ts` genuinely is v1; the other two are not. J4.1 splits the line.
   The roadmap should say whether §1's tags or §3's Ships lists are authoritative when they
   disagree — today the TEST believes §1 and the PLANNER believes §3.

2. **`LSE-11` says "every branch failing toward alive" and a boolean cannot express it.** There are
   three answers — *I read a live process*, *I read positive evidence of absence*, *I could not read
   at all* — and the middle one is the only one that may delete somebody's lock. The reference
   collapses all three into `boolean` and gets it wrong in three branches (ruling 4). The row should
   either name the three-way shape or say that the boolean's `true` must cover both "alive" and
   "unknown", which is what makes the reference's `bootTimeSec() === null → false` a bug rather than
   a choice.

3. **LSE-01…11 land one phase before their first writer, and no row says so.** `ops-lease-reap`
   (JOB-O03) is N5; the serial-group lease (LSE-12) is M9; every pipeline watcher is v1. So N4 ships
   `acquire`, `withLease`, `reapDead` and the boot sweep with nothing in production taking a lease.
   That is defensible (ruling 3) but it means the phase gate — *a killed pass does not wedge the next
   one* — is proved against a seeded claim rather than against a real one. Either §3's N4 gate should
   say "the machinery, proved against a seeded claim", or JOB-O03 should move to N4 and bring a
   writer with it.

4. **`JOB-O11` describes a SEND, and v0 has no outbound integration at all.** The row's producer
   ("a failed send") and its consumer ("the watchdog reports its presence") are separated by every
   plugin that does not exist until v1. N4 ships the contract with the supervisor's heartbeat as its
   producer, which is a *signal* rather than a *send*, and the circularity is real (one filesystem).
   §2.19 should either widen JOB-O11 to "an outbound signal" or move it beside the first relay.

5. **`TST-17` bundles six subjects across three milestones into one row.** Gate contract (N2), lease
   primitive and reaper guards (N4), queue claim/settle and the broker socket and the worker loop
   (M9). A row that is one-third done reads as undone, and a builder who takes it literally either
   re-ships N2's gate tests or skips the phase's own half. It should be split, or carry the same
   `(… half)` qualification §3's N4 line uses — noting that `test/layout.test.ts`'s Ships-line parser
   **throws** on a qualified `ID (some half)` token, so the qualification cannot go there.

6. **`SAF-01` is per JOB and this is now the THIRD operator CLI that needs a dry run.**
   `CRONTAB_DRY_RUN` (N2 Gaps 9), `SKILLS_DRY_RUN` (N3 Gaps 9), and now `LEASE_CLEAR_DRY_RUN` and
   `WATCHDOG_DRY_RUN` — four. §2.28 has no category for a tool's own dry run. Three occurrences was a
   pattern; four is a missing row. Either SAF-01 says "per job **or tool**", or §2.28 gains one.

7. **Nothing rules on `host/` importing `cli/`.** N2 flagged the reverse (`cli/crontab.ts` imports
   `host/schedule.ts`, plan N2 Gaps 14). `ops-cron-check` (JOB-O09) needs `render`/`diff`/
   `installedBlock`, which live in `cli/crontab.ts` — so a JOB now depends on an operator surface at
   runtime. The alternative is a second copy of the render, which is exactly what SUP-08's
   "one render, checked against the installed block" forbids. TST-25's sibling clause will rule at
   N5; the roadmap should say now whether `cli/` is a library with an argv block or a tool.

8. **§3's `Not shipped, deliberately` prose has no gate.** `test/layout.test.ts` assertion 14
   compares the `Ships:` line to WORK.md's ticked boxes and never reads the prose beneath it. A row
   moved out of a milestone but left in the prose — or moved out of the prose and left in `Ships:` —
   rots silently. The N4 line is wrong today (`QTA-01…10, LSE-01…12, JOB-O09…12`) and has been since
   WORK.md moved six items out, invisibly, because N4 is not a shipped phase yet.

9. **Nothing says which interpreter a rendered crontab line names.** `commandOf` renders a bare
   `node`, which is a PATH lookup in cron's stripped environment — the same hazard `CRONTAB_CMD`'s
   `assertAbsoluteCmd` exists for one file over (N2 F1). It works today because the developer's cron
   PATH has `node`; it would fail silently on a host where it does not, at 03:38, with the log line
   never written. SUP-08 should say whether a rendered command may name a bare binary. **Deliberately
   NOT changed in N4** — it touches every rendered line and is a distribution (ADO) decision, not a
   liveness one.

10. **`✅ MVP READY — 123 items` is a number in a doc with no gate.** The convention (TST, CLAUDE.md's
    "if you write a count in a doc, wire the test that pins it") says it should be derived from
    WORK.md's own ticked boxes. Assertion 14 counts IDs per phase and never sums them. J4.16 AC4
    derives it by hand once; a `TST-` row would make it stay true.

11. **`KRN-06` still cannot express a knob FAMILY, and N4 adds the third.** N1 flagged `<NAME>_DB`,
    N2 added `LOCK_STARVE_N_<JOB>`, and N4 adds `QUOTA_PAUSE_MS_<CLASS>` — seven keys behind one row,
    read through the one dynamic reader whose call-site list `test/knobs.test.ts` assertion 7 pins
    exactly. Three families is no longer a workaround, it is the shape. `EnvSpec` should gain a
    `pattern?` or a `family?` field before N5, where plugins start declaring their own.

12. **`SUP-20`'s prefix vocabulary has no `watch`-vs-`watchdog` rule, and the near-miss is silent.**
    `stageOf("watchdog")` is `misc` (it does not start with `watch-`), so a bare `watchdog` entry name
    is refused by validate rule 2 — correctly, and only by accident of the anchor. The reference names
    the entry `ops-watchdog` and the SCRIPT `watchdog.sh`, so `programOf` keys `PROGRAMS` on a name
    with no prefix at all. SUP-20 says "every job name **and schedule entry**"; it is silent on a
    `PROGRAMS` key, which is a third consumer of the same vocabulary and is exempt today.

13. **Nothing says a repo-wide drift gate must skip the engine's own working directories.** Five
    walkers skip `node_modules` and `.git`; none skips `.doppelganger/`, which holds a full second
    checkout whenever a pass worktree exists — and a `NIGHTLY_SANDCASTLE_MAX=0` smoke leaves one
    behind **by design** (J3.12's own header says so). N1 F4 gave the checkout a "a test may leave
    nothing behind" rule; the mirror rule — "a gate may not read what the engine legitimately writes"
    — has no row, and it cost four red assertions on a verified phase.

14. **`test/layout.test.ts`'s Ships-line parser cannot classify a `JOB-` id, and N3's own line
    contains one.** `expandShipsIds` accepts `PREFIX-NN`, `PREFIX-NN…NN` and `PREFIX-*`, and
    **throws by name** on anything else. `JOB-C15` (N3's Ships line, already written) and `JOB-O09`
    (N4's) are neither — the sub-letter breaks `\d+`. `workPhaseIds` has the mirror blind spot, so
    no `JOB-` row has ever been compared on either side. **The gate has never expanded a phase whose
    Ships line names a job**, and it will throw the first time it does, which is the moment J3.18
    ticks N3. Either the parser gains a `[A-Z]+-[A-Z]?\d+` shape on both sides — the real fix, and it
    would start comparing 20-odd `JOB-` rows that nothing checks today — or §3 must use `JOB-*` and
    the roadmap should say that job rows are deliberately outside this gate.

15. **`INS-04` gives the lease owner an instance field and no row says what a reaper does with it.**
    LSE-07's guard table names pid-namespace, host, grace, expiry and terminal status — not the
    instance. Without a guard the field is decorative; with one (J4.5 guard 4), a stale claim from a
    deleted checkout can only be removed by `lease-clear --force`, never by a sweep. That is INS-05
    applied correctly, and it is a behaviour the roadmap does not state anywhere.
