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
every job. Walk the commits in order and no job imports a file a later job creates.

**Revision 2, after the GAP step.** Four preconditions this plan opened have since been CLOSED by the
N3 closer's own follow-ups (R1–R4) and are recorded below rather than deleted. Five things the first
draft got wrong are corrected and attributed: the quota fixture counts (ruling 1 — it claimed five
parks where the store holds four, and three nesting depths where it holds two), ruling 3's candidate
list (it declared a space exhausted that had an obvious third member), ruling 5's premise (the fix
partly landed while this plan was being written), ruling 6's second delivery channel (**measured
absent on this host, not merely weak**), and ruling 7's producer (`beat()` stamps on a `status.json`
failure too, so probe 4's message would have been wrong). Four build blockers the GAP step found are
now preconditions or job clauses.

**Baseline, measured 2026-08-26 on this checkout at `2a38193`:**
`npm test` → `# tests 528 / # pass 526 / # fail 0 / # skipped 2`, `duration_ms 10446`.

---

## Preconditions — three closed by the N3 closer, one still open

**P1 — the repo-wide walkers. CLOSED by `97fecfc` (R2).** The first draft opened with four red
assertions caused by J3.17's real pass leaving a full second checkout under
`.doppelganger/worktrees/` while five repo-wide walkers skipped only top-level `node_modules` and
`.git`. R2 fixed all five — and **narrowly, which is better than this plan proposed**: it skips
`.doppelganger/worktrees` **specifically**, not `.doppelganger` wholesale, so a stray at
`.doppelganger/state/junk.db` is still caught. J4.1 does **no walker work**; the plan's earlier AC5
named a `.doppelganger` skip-list entry that does not exist. Re-baselined: **528 / 526 / 0 / 2**.

**P2 — N4's `§1` rows must be exempt. CLOSED.** `test/layout.test.ts` assertion 12 reads WORK.md: the
first phase with an unticked box is CURRENT and exempt, everything after it is FUTURE and must not
exist. Verified 2026-08-26: **N3 is 34/34 ticked, N4 is 0/22**, so **N4 is the current phase** and
every `N4` row in §1 is exempt. J4.1 may create files.

**P3 — the Ships-line parser. CLOSED by `2a38193` (R4).** `expandShipsIds` classified a plain id as
`/^[A-Z]+-\d+$/` and `workPhaseIds` captured `\*\*([A-Z]+-\d+)\*\*`; **N3's own Ships line names
`JOB-C15`**, whose infix letter breaks `\d+`. Ticking N3 would have made assertion 14 **throw** —
inside the classifier's own enumeration loop, not fail cleanly. R4 widened both regexes to
`[A-Z]+-[A-Z]?\d+`. Verified by re-test: `JOB-O09`, `JOB-O10`, `JOB-O11` and `JOB-C15` all classify
as plain ids on both sides. **So J4.1's §3 rewrite uses bare `JOB-` ids, not the `JOB-*` wildcard** —
a wildcard excludes the prefix from BOTH sides and compares nothing, where bare ids now really
compare.

**P4 — OPEN, and it blocks J4.8. `test/model.test.ts` test 6 scans `*.fixture.ts`.**

```ts
test("6. DEFAULTS.model is reachable from exactly one file", () => {
  const modelLiteralRe = /(["'`])claude-[^"'`]*\1/g;
  const withLiteral = files.filter(f => modelLiteralRe.test(readFileSync(f, "utf8")));
  assert.deepEqual(withLiteral, ["kernel/ports/job.ts"]);
});
```

`allNonTestTsFiles()` in that file excludes `.test.ts` **and nothing else** — unlike
`test/layout.test.ts`'s `realFiles()`, which excludes `.fixture.ts` too. So
`kernel/runtime/quota.fixture.ts` **is scanned**, and every quota wording starts `claude-code
exited…`. Measured 2026-08-26:

| candidate fixture literal | test 6 |
|---|---|
| `"claude-code exited with code 1:\nYou've hit your org's monthly spend limit …"` | **no match** — the `'` in `You've` ends the character class early |
| `"task 502 failed: claude-code exited with code 1:\nYou've hit…"` | **no match**, same accident |
| `"claude-code exited with code 3:\nboom"` | **MATCHES — test 6 goes red** |

**The first draft's tier-1 rows pass only because every one of them contains an apostrophe.** That is
not a design, it is a coincidence one added row destroys. **J4.8 must close it before it writes the
fixture** — see J4.8's `Do (P4)` step: exclude `*.fixture.ts` from `test/model.test.ts`'s walker,
**and pay for the exclusion** with a compensating scan asserting no non-test file imports a
`*.fixture.ts`. Verified that the compensation is already true: `kernel/runtime/log/values.fixture.ts`
is imported by `emitters.test.ts` and `parse.test.ts` only.

## The nine rulings that shape every job below

### 1. Every quota state is producible without a walled account — and the fixtures are real

The reference is not the only evidence available. **This machine holds a live quota store with real
parks recorded by real runs**, and that is the primary fixture source (TST-19: lifted from REAL
data, never invented).

**Tier 1 — recorded on this machine, first-hand. Re-measured 2026-08-26; the first draft's counts
were wrong and are corrected here rather than quietly fixed.**
`/home/hyhilman/projects/xenith/engine/.sandcastle/state/quota.db`, every row read:

| scope | `note:` form | `since:` | `class:` |
|---|---|---|---|
| `claude` | `task 502 failed: claude-code exited with code 1:\nYou've hit your org's monthly spend limit · run /usage-credits to ask your admin for a higher limit` | `2026-08-12T03:04:13Z` | **absent** |
| `worker:worker-nexus-bennet` | `claude-code exited with code 1:\nYou've hit your org's monthly spend limit · …` | `2026-08-26T07:24:07Z` | `spend` |
| `worker:worker-nexus-keaton` | same | `2026-08-26T05:39:07Z` | `spend` |
| `worker:worker-nexus-ashton` | same | `2026-08-26T06:40:42Z` | `spend` |

**Four parks, not five. Three dated 2026-08-26, not four. `class: spend` is recorded on the three
workers only — `claude` predates the `class:` key and is exactly the row QTA-06's `inspect` fallback
exists for** (*"a breaker opened before the class was recorded still carries the message it opened
on, so classify that rather than reporting `unknown` for a wall that is right there to read"*). That
row is therefore a fixture in its own right, not a duplicate.

**TWO nesting depths first-hand, not three.** `claude-code exited with code 1:\n…` (the three worker
rows, plus **22 rows** of `job_queue.note` in `engine/.sandcastle/state/queue.db`, all carrying the
**same single distinct string**) and `task 502 failed: claude-code exited with code 1:\n…`
(`note:claude`). **No first-hand row carries the bare wording** — the bare form exists only in the
reference's test corpus. **A row spelling the bare message and marked `via: "first-hand"` would be an
invention, which is precisely what TST-19 forbids**, so the fixture marks it tier 2 and the
provenance test below is what stops the mistake being made twice.

**Tier 2 — the reference's own test corpus** (`xenith/engine/src/lib/quota.test.ts`): the bare
`You've hit your weekly limit · resets Aug 5, 4am (UTC)`, `Claude AI usage limit reached`,
`5-hour limit reached`, `Monthly limit reached — upgrade to continue`, `SESSION LIMIT reached`,
`daily limit reached`, plus the six NEGATIVES that matter more than the positives —
`Validation Failed: body exceeds the 65536 character limit`, `API rate limit exceeded for user ID 1234`,
`ENOENT: no such file or directory, open '.sandcastle/.env'`, `gh: Not Found (HTTP 404)`,
`worker blew up`, `""`.

**Dates: only three of these rows have one, and the fixture must not claim otherwise.** Verified by
reading the corpus: the three *spend* positives carry dated incident comments (cps#1820 and #649 on
2026-08-10, a status-service review on 2026-08-05, the org-cap outage of 2026-08-18). **The six
period wordings and all six negatives are bare list entries with no date at all.** So `recordedAt` is
`string | null`, `null` is legal for a tier-2 row that has no date, and the provenance test asserts
`recordedAt !== null` **only** for `via: "first-hand"` and for the three dated spend rows. Writing a
plausible date onto an undated row is invention by another route.

**Tier 3 — invented.** None.

**The recheck, not a pin.** A test must never pin an exact value of something outside this repo, so
nothing asserts the reference's store still says this. `QUOTA_FIXTURE_RECHECK=1` (opt-in, never in
CI — the `CORPUS_RECHECK` precedent) reads the reference store if present and reports any `note:`
wording the fixture does not classify. Default `npm test` never opens it.

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

**BOTH ARE GATED ON `job.exec === undefined`, and the first draft was wrong to put them at the top of
`runNamed` unconditionally.** A deterministic job spawns no model and cannot hit a plan wall, so an
ungated breaker does two wrong things at once: `ops-cron-check` gets **skipped by a wall it could
never have caused**, and an unrelated failure of its own — a `crontab -l` that happens to say
`limit` — would **open** the breaker and park every job on the host. The reference has a whole
`describe("only agent-spawning jobs touch the breaker")` block for exactly this, written after the
2026-08-07 incident. Ours does it as a runtime gate (`if (job.exec !== undefined) …` skips both
halves) **plus** the reference's source scan ported: every registered `exec:` job's file must import
neither `quota.ts` nor call `runJob(`.

Both halves live in `runNamed`, which is **exported and tested** — never in the argv block, which no
test reaches. The argv block passes the impure pieces in.

### 3. There IS a correct writer — the hourly key — and `withLease` loses everything it does not feed

**The first draft declared a two-member space exhausted and it had a third member.** It rejected
`nightly-sandcastle@<base sha>` (a no-op pass leaves the SHA where it was, so `done` retires the key
forever) and `<job>@<minute>` (a constant key in disguise, needing LSE-12's `clear(force)` release,
which is M9). Both rejections stand. But the criterion it stated — *a versioned key is correct when
the version moves for a reason unrelated to the job's own success* — is satisfied exactly by

```ts
withLease("job", `${job.name}@${deps.now().toISOString().slice(0, 13)}`, …)   // …@2026-08-26T22
```

**The clock moves for a reason wholly unrelated to whether the pass worked.** `nightly-sandcastle`
fires `38 16-21 * * *` — six firings, six distinct UTC hours, one key per firing. `done` being
terminal is then exactly right: that hour's pass happened once. It excludes the one thing the gate
cannot — a hand-run beside a scheduled tick, or a second checkout (INS-05, the gate is per-process).
And it needs no `renew`, no `settle` and no LSE-12.

**So N4 gets a real writer, and every LSE member without a caller is CUT.** The reviewer's judgement
is adopted in full: the store half (`acquire` / `release` / `clear` / `reapDead` / the owner format)
is a transcription of code with ten writers, a persisted `max_attempts` migration and a dated 47-hour
incident, so its design risk is near zero — but `withLease`'s **surface** was speculative, and the
tell was `beatMs`, a parameter added to a production signature purely so a test could observe a path
no caller takes. That is D9's symptom, named.

| member | first draft | N4 | why |
|---|---|---|---|
| `acquire` `release` `clear` `read` `list` `parseOwner` `reapDead` | ship | **ship** | each has a caller: `withLease`, `lease-clear`, the boot sweep |
| `withLease(scope, key, fn, opts?)` | ship | **ship, four members only** (`ttlMs`, `maxAttempts`) | one caller: `runNamed` |
| `settle` callback | ship | **CUT** | `runNamed` returns an exit code; the pass's own outcome never reaches it. Zero callers. |
| `maxConcurrent` / `"capped"` | ship | **CUT** | one key per job per hour, and `acquireSelf` already caps per program in-process. LSE-05's `"exhausted"` stays — it has a real path. |
| `heldCount` | ship | **CUT** | existed only to feed `maxConcurrent`. **LSE-12 (M9) names it explicitly** and brings it back with the serial group that needs it. |
| `renew` + the heartbeat interval + `AbortSignal` + `lost` | ship | **CUT** | a heartbeat exists so a long task can hold a small TTL. Ours sizes the TTL directly (below), so the interval, the abort and the `{ ran: true, lost: true }` result have no path. |
| **`beatMs`** | ship | **CUT — and it is why the rest was cut** | a test seam in a production signature |

**The TTL is DERIVED, not chosen.** `SUPERVISOR_MAX_RUN_MIN` (180, SUP-13) plus
`SUPERVISOR_KILL_GRACE_MS` is a **proved** upper bound on any supervised child: past it the
supervisor has already SIGKILLed the process. A hand-run has no such bound, and that is what
`lease-clear` (LSE-10) is for — the refusal message names the command. No new knob, no guess, and
`host/schedule.test.ts`'s existing budget assertion already pins the relation the number comes from.

**What the hourly key does and does not buy, stated so nobody oversells it.** A killed pass leaves
its claim `held` until the TTL — but the **next firing is a new hour and a new key**, so the wedge is
**self-limiting and costs the next tick nothing**. What the boot sweep (LSE-09) actually buys back is
the ability to **re-run the same job inside the same hour** after a kill, which is exactly what an
operator does at 03:40 after a crash. The phase gate — *a killed pass does not wedge the next one* —
is therefore true twice over: by the key's construction, and by the sweep. **And the sweep now has
real rows to find on a real host**, which is what makes LSE-01…09 exercised in production rather than
only in tests. That is the D9 answer the first draft could not give.

`withLease` and its one caller land in **the same commit** (J4.4). Splitting them would ship a
primitive with no caller for the length of one commit, which is the thing this ruling refuses.

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

**And `ENOENT` is positive evidence ONLY on an unrestricted `/proc`.** Under `hidepid=1|2` or
`subset=pid`, another user's **live** `/proc/<pid>` raises `ENOENT`, not `EACCES` — so guard 8 would
read a running process as dead. Two checkouts owned by different users whose directory basenames
match share `INSTANCE`, host and pid-namespace, so guards 4, 5 and 6 all pass and a **live claim gets
force-deleted**. That breaks LSE-07's own rule.

**Documentation is not enough, and the fix is cheap.** A fourth injected reader,
`readMountInfo: () => string`, reads `/proc/self/mountinfo` once per sweep; if the `/proc` mount's
options contain `hidepid` or `subset=`, **every `ENOENT` is downgraded to `"unknown"`** and the
reaper reaps nothing at all. It fails toward not reaping by construction, costs one file read per
sweep, and is exactly checkable. **Measured on this host 2026-08-26: `/proc rw,nosuid,nodev,noexec,relatime`
— no `hidepid`, no `subset=`, so the downgrade is inactive here and the reaper works.** The row is in
J4.2's grid and in `reapDead`'s header.

**Measured on this host, 2026-08-26, Linux 6.8.0-136-generic:** `/proc/self/ns/pid` →
`pid:[4026531836]` · `/proc/stat` → `btime 1785088352` · absent pid → `ENOENT` · `/proc/1/environ` →
`EACCES` · USER_HZ arithmetic verified: computed self-start `2026-08-26T16:06:48.040Z` against
`now = 16:06:48.979Z`, 0.94 s apart.

### 5. Half of this landed while the plan was being written — here is what is left

The first draft found a real bug: `commandOf` rendered `cd ROOT && node ${target} …` for **both**
branches, so a `.sh` script would have been handed to `node`, while `spawnChild` exec'd it directly.
Two spellings, disagreeing, suite green — N3 F1 one row over.

**`b48c89f` (R3) landed the fix's first half**, and the plan must be read against the code, not
against its own earlier draft:

```ts
export function scriptCommandOf(root: string, script: string): readonly [cmd: string, args: readonly string[]] {
  return [join(root, script), []];
}
export function commandOf(e: ScheduleEntry): string {
  if (e.job !== undefined) return `cd ${ROOT} && node ${JOB_ENTRYPOINT} ${e.job} >> ${e.log} 2>&1`;
  const [cmd, args] = scriptCommandOf(ROOT, e.script ?? "");
  return `cd ${ROOT} && ${[cmd, ...args].join(" ")} >> ${e.log} 2>&1`;
}
```

`host/supervisor.ts:189` calls the same function, `host/schedule.test.ts` test 7 already asserts a
`.sh` command names no `\bnode\b`, and test 8 already asserts `commandOf` contains exactly what
`scriptCommandOf` renders. **Three call sites and two tests use the landed two-argument signature; do
not re-invent a one-argument one.**

**What is LEFT for J4.11, and it is only this:**

1. **The `.ts` branch.** `scriptCommandOf` returns `[join(root, script), []]` unconditionally, so a
   `.ts` script would be **exec'd directly** — no interpreter, and a `.ts` file has no shebang. There
   is no such entry today, which is why nothing is red; adding one silently would be the same class
   of bug one extension over. Dispatch on the extension: `.ts` → `[process.execPath, [join(root, script)]]`,
   `.sh` → `[join(root, script), []]` (its own shebang).
2. **`validate()` rules 12a and 12b** — the script's extension is `.ts` or `.sh`, and a `.sh` is
   executable (`X_OK`) and starts with `#!`. Rule 12b is what makes "render no interpreter" safe: a
   stray `chmod -x` on the one liveness probe on the box is exactly the failure JOB-O10 exists to
   catch, and a boot-time refusal beats discovering it at 03:18 with nothing able to report it.

**`.sh` renders no interpreter, deliberately.** A bare `bash` is a PATH lookup in cron's stripped
environment — N2 F1's hazard — and `/bin/bash` is a door-1 absolute literal for a path that moves
between distributions. A shebang is neither.

**The `job:` branch keeps its bare `node`, unchanged.** The first draft's code sketch showed
`process.execPath` there while its own prose two paragraphs later said keep `node` — a contradiction,
now deleted. Whether a rendered crontab line may name a bare binary at all is a real question and it
is **out of scope for N4**: it changes every rendered line, `cli/crontab.test.ts` pins those lines,
and it is a distribution (ADO) decision, not a liveness one. **Gaps item 9.**

### 6. The watchdog's delivery at N4 is a file and a log line — TWO channels, measured

There is no Slack plugin, no Jira plugin, no MCP hub and no connector before v1. **Do not invent
one.** What exists on this host at N4, and shares nothing with the toolchain the watchdog watches:

- **Path 1 — the breach file.** `.doppelganger/watchdog.breach`, written on every tick that finds a
  fault, `rm -f`'d on the first clean tick. **Presence is the alarm** (JOB-O11's rule, applied to the
  watchdog's own report): a healthy loop writes nothing, so a quiet week never trips it, which a
  staleness test would.
- **Path 2 — the log.** `log_error breach msg=…`, one line per fault, through `log.sh` (LOG-01's
  bash emitter, byte-identical to the TS one, TST-18). This is what `ops-log-report` (JOB-O02, **N5**)
  will read the day it exists.

**TWO channels, not three. The first draft claimed cron's `MAILTO` as a third and it does not exist
on this host — measured, 2026-08-26:**

| probe | result |
|---|---|
| `command -v sendmail mail mailx postfix exim4 ssmtp msmtp` | **all seven ABSENT** |
| `/var/mail`, `/var/spool/mail` (a symlink to it) | **empty — no user mailbox at all** |
| `strings /usr/sbin/cron` (cron `3.0pl1-184ubuntu2`) | contains **`No MTA installed, discarding output`** |

So a non-zero exit produces a line in cron's own syslog saying the output was **discarded**, and the
fault text reaches nobody. `exit 1` is kept — it is the correct exit status for a program reporting a
fault, and it is what a process manager or a future MTA would read — **but it is not counted as a
delivery channel**, in ruling 6, in `host/watchdog.sh`'s header, and in the schedule entry's `why`.
Claiming otherwise would be exactly the invented integration this ruling refuses.

**The log channel can itself be missing, and `set -uo pipefail` hides it.** A failed
`. "$ROOT/kernel/runtime/log/log.sh"` returns non-zero **without exiting**; `log_init` is then an
undefined command, and so is every `log_error`. Each one prints `command not found` to stderr and the
script continues to `exit 0` on a healthy tick — **every fault silently lost from the one channel
that remains**. So the source is guarded: if the `.` fails or `declare -F log_error` is empty, the
script writes the breach file with a bare `printf` and exits 1 without ever calling a log function.
Tested (J4.14 test 11).

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

Plus **probe 0**, which is not a probe of the system but of the watchdog itself: `log.sh` sourced and
`log_error` defined, or the breach file is written by `printf` and the script exits before it can
pretend to be healthy.

### 7. JOB-O11's producer is the heartbeat write — two `try` blocks, not one, and the circularity is stated

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

- `beat()` stamps `false` on a heartbeat write failure and `true` on success — **and on nothing
  else**, per the split above.
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

Every dependency runs forward. Nothing here waits on N3: it is closed and ticked, and
preconditions P1, P2 and P3 are all satisfied at `2a38193`.

1. **J4.1** — `roadmap.md` §1/§3/§2.27. Doc only (P1's walker work landed in `97fecfc`); must land
   first, or assertion 12 refuses every N4 file.
2. **J4.2** — `kernel/runtime/proc.ts`: LSE-11, the four injected readers, the fails-toward-alive
   grid, and the `hidepid` downgrade.
3. **J4.3** — `kernel/runtime/lease.ts` core: LSE-01, LSE-02, LSE-04, LSE-05, LSE-06, INS-04.
4. **J4.4** — `withLease` **and its one caller**: LSE-03, LSE-04's versioned key, the hourly key in
   `runNamed`. Ruling 3 — the primitive and its writer land together.
5. **J4.5** — `reapDead`: LSE-07, LSE-08 — the guard table.
6. **J4.6** — LSE-09: the real boot sweep, the N2 spy replaced.
7. **J4.7** — `cli/lease-clear.ts`: LSE-10.
8. **J4.8** — `kernel/runtime/quota.ts`: QTA-01, QTA-05, QTA-06, QTA-07 + the producer/consumer in
   `runNamed`, gated on `job.exec`. Closes precondition P4 before it writes the fixture.
9. **J4.9** — `kernel/runtime/shed.ts` + `host/classes.ts`: QTA-08, QTA-09, `DEFAULTS.shedModel`.
10. **J4.10** — SUP-16 wired to the real `decideShed`; the N2 spy replaced; the downshift call site.
11. **J4.11** — `scriptCommandOf`'s `.ts` branch and `validate()` rules 12a/12b. Must land before any
    `script:` entry. (Its first half landed in `b48c89f`.)
12. **J4.12** — JOB-O09 `ops-cron-check`, its entry and its `PROGRAMS` row.
13. **J4.13** — `kernel/runtime/delivery.ts` + `beat()`'s two independent writes: JOB-O11.
14. **J4.14** — JOB-O10 `host/watchdog.sh`, the `ops-watchdog` entry, the bash↔`EnvSpec` gate, and
    the first non-empty crontab bootstrap block.
15. **J4.15** — TST-17: what is new versus what N2 already shipped, and the live gate contract the
    third entry makes possible.
16. **J4.16** — close N4.

**Sixteen jobs, sixteen commits.** J4.4 is the only one that touches two directories in one commit,
and ruling 3 is why: a primitive and the caller that justifies it are one change.

**Three jobs carry no `N4` feature id and each says which shipped row it serves:** J4.1 and J4.16 are
`§1`/`§3`/`WORK.md` bookkeeping, and **J4.11 is a FIX to SUP-03/SUP-05/SUP-08 — rows N2 shipped** —
not new behaviour. A reviewer counting 22 ids across 16 jobs should find them all in the other
thirteen.

---

## J4.1 — `roadmap.md` §1/§3/§2.27: name what N4 builds, and fix the Ships line  ·  §1, §3, KNB

**Goal:** make the spec name every file N4 builds with an `N4` tag so `test/layout.test.ts`
assertion 12 blesses each one as it lands, and make §3's N4 `Ships:` line agree with WORK.md so
assertion 14 is green the moment N4 becomes a shipped phase.

**Doc only.** P1's walker work landed in `97fecfc` and P3's parser fix in `2a38193`; this job touches
no test file.

**Files touched:**
- `roadmap.md` — §1's layout block, §2.27's knob list, §3's N4 section

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
  watchdog.probe.ts       two lines the watchdog RUNS to prove node strips types N4
  jobs/
    ops-cron-check.ts     crontab drift, logged every run (JOB-O09)              N4
cli/
  lease-clear.ts                                                                 N4        (already present)
```

`quota.ts` and `shed.ts` currently sit on the `queue.ts  quota.ts  shed.ts   v1` line, which
assertion 12 reads as three `must-be-absent` rows. Splitting the line is required, not cosmetic.

**`host/watchdog.probe.ts` is easy to forget and the first draft did.** J4.14 needs it and said it
was "named in §1 (J4.1)" while J4.1's row block did not contain it. `realFiles()` walks `.ts` **and**
`.sh`, excluding only `*.test.ts` and `*.fixture.ts`, so an unnamed probe file turns assertion 12 red
by name the moment J4.14 creates it. It is the only `.ts` file in this repo whose purpose is to be
run **by bash**, and its §1 row says so.

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
**Ships:** QTA-01, QTA-05…09, LSE-01…11, INS-04, JOB-O09, JOB-O10, JOB-O11, TST-17.
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

**Bare `JOB-` ids, verified against the LANDED parser (precondition P3).** `expandShipsIds` used to
classify a plain id as `/^[A-Z]+-\d+$/`, which `JOB-O09` fails on its infix letter — and the
classifier **throws** rather than failing cleanly on a token it cannot place. `2a38193` (R4) widened
both that regex and `workPhaseIds`' bold-id capture to `[A-Z]+-[A-Z]?\d+`. Re-verified 2026-08-26:

| token | classified as |
|---|---|
| `QTA-01`, `INS-04`, `TST-17`, **`JOB-O09`**, **`JOB-C15`** | plain id |
| `QTA-05…09`, `LSE-01…11` | range |
| `JOB-*` | wildcard — **excludes the prefix from BOTH sides, comparing nothing** |
| `TST-17 (lease + breaker half)` | **THROWS** — the parser's own comment names this shape |

So write **bare ids**. The wildcard would be a silent opt-out of the very comparison this line
exists for, and it is no longer needed. **No qualified `ID (some half)` token may appear** — that is
why §3's N4 line moves `TST-17`'s qualification into the prose beneath it.

**Do NOT touch any test file.** P1's five walkers landed in `97fecfc`, and they skip
`.doppelganger/worktrees` **specifically** rather than `.doppelganger` wholesale — a narrower and
better fix than this plan first proposed, because a stray at `.doppelganger/state/junk.db` is still
caught. Assertion 15's `.db` rule also already derives `LEGIT_DB_NAMES` from `DB_NAMESPACES`
(`test/layout.test.ts:514`), so J4.3 inherits it rather than writing it.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0 and reports **528 / 526 / 0 / 2** (the measured baseline at `2a38193`;
      a doc-only commit must not move it). Record the four numbers plus `duration_ms` in the commit
      body. Every later AC1 compares against this.
- [ ] AC2 — **assertion 12 accepts the new rows and would refuse a wrong one.** With N3 ticked,
      `node --test test/layout.test.ts` passes 15/15. Then change `proc.ts`'s tag from `N4` to `N5`
      and create an empty `kernel/runtime/proc.ts`; the run must fail with
      `§1 names kernel/runtime/proc.ts as N5 (not shipped, not current), but it exists on disk`.
      Delete the file and revert the tag.
- [ ] AC3 — **assertion 14 already expands N3, so the Ships parser is exercised for real today.**
      `node --test test/layout.test.ts` passes 15/15 with N3 SHIPPED (34/34 ticked, verified). Then
      change §3's **N3** Ships token `JOB-C15` to `JOB-C15x`: the run must fail with
      `a token this drift gate cannot classify`. Revert. **This replaces the first draft's rehearsal,
      which was vacuous** — `shippedPhases()` marks everything after the first unticked phase FUTURE,
      so ticking N4 alone would have put it in neither `shipped` nor `current` and assertion 14 would
      simply have skipped it.
- [ ] AC4 — **the knob doc gate still binds.** `node --test test/knobs.test.ts` passes. Then delete
      `QUOTA_DARK_GAP_MS` from §2.27 and re-run: it must still pass **today** (no row names it yet),
      which records that assertion 6 is a one-way gate. Restore.
- [ ] AC5 — **P1's fix is confirmed as a regression check, not re-done.** Delete the
      `entry === "worktrees"` skip from `test/no-raw-sqlite.test.ts` alone (`97fecfc` added it at
      line 27) and re-run: that one test must go red naming
      `.doppelganger/worktrees/nightly-sandcastle/kernel/runtime/db.ts` — **provided a pass worktree
      exists**; if it does not, create one with `NIGHTLY_SANDCASTLE_MAX=0 npm run job
      nightly-sandcastle` or record that the AC could not be performed and why. Revert. Cite
      `97fecfc` as the owning commit.

**Commit:** `roadmap: name N4's modules in §1, fix §3's Ships list, drop two knobs with no subject (§1, §3, KNB)`

**Depends on:** nothing. N3 is closed and ticked; preconditions P1, P2 and P3 are all satisfied at
`2a38193`.

**Risks / what could be wrong:**
- **§3's `Not shipped, deliberately` block is prose and nothing checks it.** Assertion 14 compares
  the `Ships:` line only. A row moved out of WORK.md but left in the prose rots silently. Flagged in
  Gaps item 8.
- **`TST-17`'s qualification cannot go on the Ships line.** `TST-17 (lease + breaker half)` throws in
  the classifier. The qualification moves to the prose beneath, which nothing checks — the same hole
  as the previous bullet, and the reason J4.15 states the four halves in a table inside the plan.

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
  /** `/proc/self/mountinfo`, for the /proc mount's own options — ruling 4's hidepid downgrade. */
  readonly readMountInfo: () => string;
}

export const realReaders: ProcReaders;
export function pidNamespace(readers?: ProcReaders): string | null;
/** True when this `/proc` hides other users' pids, so ENOENT stops being positive evidence. */
export function procIsRestricted(readers?: ProcReaders): boolean;
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
- **`procIsRestricted()` downgrades the `ENOENT` arm to `"unknown"`.** It parses
  `/proc/self/mountinfo` for the line whose mount point is `/proc` and whose filesystem type is
  `proc`, and returns true when its options contain `hidepid` or `subset=`. **Under such a mount
  another user's LIVE pid raises `ENOENT`, not `EACCES`** — so without this, two checkouts owned by
  two users with the same directory basename (same `INSTANCE`, same host, same pid-namespace: guards
  4, 5 and 6 all pass) would let one force-delete the other's live claim. A read failure of
  `mountinfo` itself returns **true**, because "I could not tell" must also stop the reap.
  Measured on this host 2026-08-26: `/proc rw,nosuid,nodev,noexec,relatime` — unrestricted, so the
  downgrade is inactive here and the reaper works.
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
{ file: "kernel/runtime/proc.ts", literal: '"/proc/self/mountinfo"', count: 1,
  why: "the /proc mount's own options - the hidepid downgrade that keeps ENOENT honest (LSE-11)" },
```

Door 3 is untouched: `readFileSync` and `readlinkSync` are not in `WRITE_MEMBERS`, and correctly so.

**Do (tests):** `kernel/runtime/proc.test.ts`.

1. **The grid.** Every cell of ruling 4's matrix, driven with injected readers — 4 outcomes
   (`ok`, `throws ENOENT`, `throws EACCES`, `returns junk`) × 4 readers, plus the recycled-pid case,
   **plus the two `hidepid` rows**: a genuinely-absent pid under a restricted `/proc` → `"unknown"`,
   and the same pid under an unrestricted one → `"dead"`. Assert `ownerLiveness` returns `"dead"` in
   exactly the enumerated cells and `"alive"`/`"unknown"` everywhere else, as one `deepEqual` over
   the whole grid — one assertion, not seventeen.
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
10. **`procIsRestricted` against the real `/proc`.** Asserted as a boolean and RECORDED, never
    pinned: this host answered `false` on 2026-08-26 with options
    `rw,nosuid,nodev,noexec,relatime`. Then the parser is driven over two fixture `mountinfo` texts —
    one with `hidepid=2`, one with `subset=pid` — and both must read `true`, plus one where the
    reader throws, which must also read `true`.
11. **A restricted `/proc` makes the reaper a no-op.** With `readMountInfo` returning a `hidepid=2`
    fixture and `readProcStat` throwing `ENOENT` for a pid that is genuinely dead, `ownerLiveness` is
    `"unknown"`. **This is the cell that says a live claim cannot be force-deleted.**

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/proc.test.ts` reports 11 passing.
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
- [ ] AC6 — `node --test test/writes.test.ts` passes: door 1's **four** signed rows match exactly.
      Then add a second copy of `"/proc/stat"` to `proc.ts` in a value position; door 1 must go red
      with `signed literal "/proc/stat" appears 2x, signed for 1`. Revert.
- [ ] AC7 — **the hidepid downgrade fires.** Delete the `procIsRestricted()` check from
      `ownerLiveness`'s `ENOENT` arm. `npm test` exits non-zero on tests 1 and 11. Revert. Then make
      `procIsRestricted` return `false` when `readMountInfo` throws (instead of `true`): non-zero on
      test 10. Revert.

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

**NOT touched: `test/layout.test.ts`.** The first draft planned to rewrite assertion 15's `.db` rule
here. `97fecfc` already did it — `test/layout.test.ts:514` derives `LEGIT_DB_NAMES` from
`DB_NAMESPACES` and exempts `state/<name>.db` for exactly those names. The plan's further idea (lift
the `dbPath(` scanner into a helper shared with `test/skills.test.ts` assertion 11) is now **churn**:
assertion 11 already gates `DB_NAMESPACES` as a superset of every real call site, so the derivation
is one hop from the truth either way. AC7 below keeps it as a **regression check**.

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
export function release(lease, outcome?): boolean;
export function clear(scope, key, opts?: { force?: boolean }): number;
export function list(scope?): LeaseRow[];
```

**`renew` and `heldCount` are NOT here, and ruling 3 is why.** `renew` exists to let a long task hold
a small TTL; ours derives the TTL from SUP-13's own bound instead, so it has no caller. `heldCount`
existed only to feed `maxConcurrent`, which is cut — **LSE-12 (M9) names `heldCount` explicitly** and
brings it back with the serial group that needs it. Every member above has a caller in this phase:
`acquire`/`release` from `withLease` (J4.4), `read`/`clear`/`list` from `lease-clear` (J4.7) and
`reapDead` (J4.5).

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
9. **A second scope's claim on the same key does not collide** — `scope` + `key` is the primary key,
   and `list(scope)` reports one scope only. (This replaces the first draft's `heldCount` test, cut
   with the member.)
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
      Baseline moves from 528 to 528 + 14; record the exact number.
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
- [ ] AC7 — **`97fecfc`'s derived `.db` rule still holds, in both directions — a regression check,
      not new work.** `touch .doppelganger/state/lease.db` → `node --test test/layout.test.ts`
      passes (the stem is now in `DB_NAMESPACES`). `touch .doppelganger/state/leek.db` → assertion 15
      goes red naming `state/leek.db`. `touch .doppelganger/runs/lease.db` → red naming
      `runs/lease.db`, because the stem is legitimate but the directory is not. Delete all three and
      confirm `git status --porcelain` is clean.
- [ ] AC8 — **the single-statement claim is real.** Assert `acquire`'s body contains **exactly one**
      `write(` call, textually, before its `if (changes === 1)`. **The first draft also proposed
      scanning for a `SELECT … FOR` pattern; that is decoration — SQLite has no `SELECT … FOR
      UPDATE`, so the scan can never go red.** Only the call-count form ships. Prove it: split
      `acquire` into a `read` then a conditional `write` and watch the assertion go red. Revert.

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

## J4.4 — `withLease` **and its one caller**: the 47-hour trap, and the hourly key  ·  LSE-03, LSE-04, LSE-09 (subject)

**Goal:** acquire → run → release, with the ONE behaviour that cost the reference 47 hours reproduced
deliberately and tested by name — **and the writer that makes the whole LSE stack have a caller in
production** (ruling 3).

**One commit for two files, and that is the ruling.** A primitive with no caller is what ruling 3
refuses to ship; landing them apart would ship exactly that for the length of one commit.

**Files touched:**
- `kernel/runtime/lease.ts` — `withLease`, `WithLeaseResult`
- `kernel/runtime/lease.test.ts` — a `describe("withLease")` block
- `host/run.ts` — `runNamed` takes the hourly key
- `host/run.test.ts` — the writer's own tests

**Do (the primitive — four members, and every one has a caller):**

```ts
export type WithLeaseResult<T> =
  | { ran: true; result: T }
  | { ran: false; reason: RefusedReason };

export async function withLease<T>(
  scope: string,
  key: string,
  fn: () => Promise<T>,
  opts?: { ttlMs?: number; maxAttempts?: number },
): Promise<WithLeaseResult<T>>;
```

- **LSE-03, stated in the header as a TRAP and not as a feature.** *`withLease` settles `done` on any
  non-throwing return, early returns included.* Measured in the reference 2026-07-31: XEN-8365's plan
  was drafted, the post failed, `handle` returned early, the lease went `done` with the row still
  `routed`, and nothing would ever have retried it — 47 hours. The row says **documented, not
  silently fixed**, and this is why: a handler that returns normally has told the caller it finished,
  and a primitive that second-guesses that would settle nothing for the handlers that genuinely did.
  Every future caller's review checklist starts at this paragraph.
- **A throw releases `failed`** — which self-expires — leaving the key retryable and bounded by
  `maxAttempts`, and **re-throws the original error unchanged**.
- **No heartbeat, no `renew`, no `AbortSignal`, no `lost`, no `settle`, no `maxConcurrent`, and above
  all no `beatMs`.** Ruling 3's table says why each is cut and what brings it back. The header
  carries that table in three lines so the next reader does not re-add them.

**Do (the caller — LSE-04's versioned key, in `runNamed`):**

```ts
const hour = deps.now().toISOString().slice(0, 13);          // "2026-08-26T22"
const got = await withLease("job", `${job.name}@${hour}`, () => …, {
  ttlMs: SUPERVISOR_MAX_RUN_MIN * 60_000 + SUPERVISOR_KILL_GRACE_MS,
  maxAttempts: 3,
});
if (!got.ran) {
  log.info("lease-held", { key: `${job.name}@${hour}`, reason: got.reason,
    msg: `another run of ${job.name} owns this hour — \`npm run lease-clear -- job ${job.name}@${hour}\` to release it` });
  return 0;
}
```

- **The version is the clock**, which moves for a reason wholly unrelated to whether the pass worked
  — ruling 3's criterion, satisfied. Six firings a night, six distinct UTC hours, one key each.
- **`done` terminal is correct here**: that hour's run happened once.
- **It excludes what the gate cannot** — a hand-run beside a scheduled tick, a second checkout
  (INS-05: the gate is in-memory and per-process).
- **The TTL is derived, never chosen**: `SUPERVISOR_MAX_RUN_MIN` (SUP-13's own bound, past which the
  supervisor has already SIGKILLed the child) plus `SUPERVISOR_KILL_GRACE_MS`. No new knob.
- **A refusal is a skipped tick, exit 0**, logged at `info` with the exact `lease-clear` command —
  the same shape as `quota-paused` (J4.8) and for the same reason (INV-10's spirit: a refusal costs
  the work nothing).
- **`generic`, not special-cased.** Every registered job gets the same treatment, so `ops-cron-check`
  (J4.12) and any N5 job inherit it without an edit.

**Do (tests — `kernel/runtime/lease.test.ts`):**

15. **A handler that returns a value settles `done`.**
16. **LSE-03 — a handler that returns EARLY, having done nothing, ALSO settles `done`, and the key is
    then terminal.** The handler is `async () => { return; }`; the assertions are that
    `read(...)?.status === "done"` **and** that a following `acquire` is refused `"done"`. The test's
    own name carries `LSE-03` and `XEN-8365`.
17. **A throw releases `failed` and re-throws unchanged** — `assert.rejects` on the original error
    identity, not just its message — and the key is immediately re-acquirable.
18. **A refused key returns `{ ran: false, reason }` and never calls `fn`** — asserted with a
    counter, so "did not run" is observed rather than inferred.
19. **`maxAttempts` reaches `"exhausted"` through `withLease`, not only through `acquire`.**
20. **`withLease` opens no interval and holds nothing open.** A child process (the `scrubbedChild`
    shape) that calls `withLease` with a long TTL and returns exits **of its own accord**, within
    5 s. Direction: **upper bound**, and the reason is recorded — this guards "somebody re-added an
    un-`unref`'d timer", not "the machine was busy". Measured headroom in the commit body. **This is
    the assertion that keeps the cut surface cut.**

**Do (tests — `host/run.test.ts`):**

21. **The key is the job name and the UTC hour.** Drive `runNamed` with a frozen `deps.now()` and
    assert the row exists at `job` / `<name>@2026-08-26T22`.
22. **A second run in the same hour is refused, exit 0, one `lease-held` line naming the
    `lease-clear` command** — and `fn` never ran.
23. **A run in the NEXT hour succeeds** — the version moved, so the key moved. **LSE-04, as
    behaviour.**
24. **The TTL is the derived one**, read off the row: `expiresAt - claimedAt` within a second of
    `SUPERVISOR_MAX_RUN_MIN * 60_000 + SUPERVISOR_KILL_GRACE_MS`.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/lease.test.ts` reports 20 and
      `node --test host/run.test.ts` reports its previous count plus four.
- [ ] AC2 — **the early-return path is covered, and EXACTLY ONE test covers it.** Change
      `release(got.lease, …)` to `if (result !== undefined) release(got.lease, …)`. `npm test` must
      exit non-zero on **test 16 only**. Record which tests went red.
      - **zero red** → the early-return case is not exercised: some fixture handler returns a value
        where it should return nothing.
      - **more than one red** → the fixture is not discriminating: a neighbour's handler also returns
        `undefined`, so test 16 proves nothing its neighbour does not.
      **The AC is the count, not merely the redness.**
- [ ] AC3 — **the throw path releases `failed`, not `done`.** Change `{ status: "failed" }` to
      `{ status: "done" }` in the catch. `npm test` exits non-zero on test 17's re-acquire. Revert.
- [ ] AC4 — **the surface stayed cut.** `grep -c 'beatMs\|maxConcurrent\|setInterval\|AbortController' kernel/runtime/lease.ts`
      returns 0. Record it. Then add a `setInterval(() => renew(...), 1000)` without `.unref()` and
      watch test 20 go red with the child never exiting; record the observed duration. Revert.
- [ ] AC5 — **the writer is real.** Delete the `withLease` wrapper from `runNamed` (call `fn`
      directly). `npm test` exits non-zero on tests 21–24. Revert.
- [ ] AC6 — **the version is the hour, not the day or the minute.** Change `slice(0, 13)` to
      `slice(0, 10)`. `npm test` exits non-zero on test 23 (the next hour is refused). Change it to
      `slice(0, 16)`: non-zero on test 22 (a second run in the same hour is allowed). Revert.
- [ ] AC7 — **the TTL is derived, not typed.** Replace the expression with a literal `5_400_000`.
      `npm test` exits non-zero on test 24. Revert. (The mutation must be a *different* number, not
      the same one spelled out — a literal equal to the derived value proves nothing.)
- [ ] AC8 — **nothing writes the real lease store.** After the full run,
      `ls .doppelganger/state/lease.db` reports no such file and `git status --porcelain` is clean.

**Commit:** `lease: withLease settles done on any non-throwing return, and every job claims its hour (LSE-03, LSE-04)`

**Depends on:** J4.3.

**Risks / what could be wrong:**
- **The lease DB is now on every job's critical path.** A `SQLITE_BUSY` on `lease.db` fails the run
  before any work. That is DBS-04's design (rethrow with file, SQL and waited-ms; do not retry, do
  not raise the timeout) and the wait is the discriminator. The store holds tens of rows and one
  writer, so contention would itself be the fault worth seeing.
- **A hand-run inside the same hour as a scheduled tick is refused.** That is the feature (INS-05),
  and the refusal message names `lease-clear`. An operator who finds it obstructive has a one-line
  escape; a silent double-run has none.
- **A killed pass leaves its claim `held` for the derived TTL.** The next firing is a new hour and a
  new key, so the wedge costs the next tick nothing — the boot sweep (J4.6) is what buys back a
  re-run inside the same hour. Both are stated in ruling 3 rather than oversold.

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
| 8 | `ownerLiveness(id.pid, claimedAt) !== "dead"` | J4.2's whole content: `"unknown"` is not `"dead"`. **And `ENOENT` is positive evidence ONLY on an unrestricted `/proc`** — under `hidepid`/`subset=pid` another user's LIVE pid raises `ENOENT`, so `procIsRestricted()` downgrades the whole arm to `"unknown"` and this guard then skips everything. Stated in `reapDead`'s own header, not only here. |
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
11b. **A restricted `/proc` reaps nothing at all.** Seed a reapable row, inject a `hidepid=2`
    `mountinfo` fixture, sweep: `reapDead` returns `[]` and the row survives. **This is the
    assertion that says a live claim owned by another user cannot be force-deleted.**
12. **The whole guard table as ONE grid.** Seed twelve rows, one per guard, run one sweep, and
    `deepEqual` the reaped key list against the single key that should have gone. A per-guard test
    proves each arm; this proves no arm is reachable by accident from another row's state.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/lease-reap.test.ts` reports 13 passing.
- [ ] AC2 — **each guard fires.** Delete guards 2, 3, 4, 5, 6, 7 and 8 **one at a time**, run
      `npm test` after each, and record the test number(s) that went red for each. Seven mutations.
      **Six produce ONE red; guard 8 produces TWO — tests 2 and 11** (a live owner survives, and an
      `EACCES` owner survives) — because guard 8 is the only guard two tests approach from opposite
      directions. **A two-red result there is correct, not a broken guard**; the first draft said
      "seven distinct reds" and a builder would have read it as a fault. A guard whose deletion turns
      *nothing* red is decoration and must get a test before this job closes.
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
- [ ] AC6 — `node --test kernel/runtime/lease.test.ts` still reports 20 passing: J4.5 adds behaviour
      and changes none.
- [ ] AC7 — **the hidepid downgrade reaches the reaper.** Delete the `procIsRestricted` downgrade
      from `ownerLiveness` (J4.2's arm). `npm test` exits non-zero on test 11b **and** on J4.2's
      grid. Revert.

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
- **NEW test — `main()` and `realReapOnBoot` in a real child process. This is the phase gate.**

  **The first draft's version could not run, and both faults are named rather than quietly fixed.**
  (a) `spawnSync` on a supervisor that never exits **blocks forever** — the child must be `spawn`ed
  with a stderr reader and killed on the line the test is waiting for. (b) `ENGINE_ROOT: <fixture>`
  makes `ROOT` the fixture (`kernel/paths.ts:19`), so `validate()` looks for
  `<fixture>/host/jobs/nightly-sandcastle.ts`, **throws**, and no `lease-reaped` line is ever
  emitted.

  **And keeping `ROOT` real is not the answer either**, because the real argv block imports the real
  `SCHEDULE` and registers a real croner timer for `nightly-sandcastle` at `38 16-21 * * *`. A test
  that happens to run at `:38` in one of those hours would **spawn a real, paid agent run**. That is
  a 1-in-1440 flake with a money cost, and it is not acceptable at any rate.

  **The resolution, stated explicitly:** the child is a **three-line driver the test writes into its
  own temp directory**, which imports `main` and `realReapOnBoot` from the REAL module and calls
  `main([], { ...realDeps, reapOnBoot: realReapOnBoot })` — an **empty schedule**, which
  `validate([])` accepts by decision (`host/validate.test.ts` test 1) and which registers no timer at
  all. Everything else is real: the real `reapDead`, the real `parseOwner`, the real `/proc`, the
  real `openDb`, the real `main()` boot order. `LEASE_DB` is redirected to the test's temp file; no
  other path is redirected, so `ROOT` stays the checkout and nothing else moves.

  Seed one `held` claim whose owner is `<instance>:<hostname>:<pidns>:<deadPid>:aaaaaaaa` with a
  `claimed_at` 60 s old, then assert off the child's **stderr**:
  - `event=lease-reaped` appears, carrying the seeded `key=` and a `ttlLeftMin=` above 0;
  - it appears **before** `event=supervisor-up`, by byte offset in the stream;
  - the row is gone from the seeded DB afterwards;
  - the child exits 0 after `stop("SIGTERM")`.

- **NEW: the argv block names the real predicate.** The driver above proves `main()` + `reapDead`;
  it cannot reach the argv block, which is untestable by construction (N2 ruling 1). So a
  **source-text assertion** pins the other half: `host/supervisor.ts`'s argv block contains
  `reapOnBoot: realReapOnBoot` and **no `reapOnBoot: (` arrow literal**. This is the `realJobRunner`
  precedent (N3 F1) — it exists because an inline literal there regressed once with the whole suite
  green.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test host/supervisor.test.ts` reports its previous count plus
      one.
- [ ] AC2 — **the wiring fires.** In the argv block, change `reapOnBoot: realReapOnBoot` back to an
      inline `() => []`. `npm test` exits non-zero on the **source-text assertion** — the child-driver
      test does not reach the argv block and must stay green. Record both outcomes. (If the
      source-text assertion stays green too, it is matching a substring the mutation preserved; make
      it match the arrow form as well.)
- [ ] AC3 — **the ordering still fires.** Move the `reapOnBoot` block in `main()` to after the
      `timers` map. `npm test` exits non-zero on test 19. Revert.
- [ ] AC4 — **`required` is enforced.** Delete `reapOnBoot` from one test harness's `deps` literal.
      `npm run typecheck` exits non-zero naming the missing property — a compile error, not a
      runtime one. Revert.
- [ ] AC5 — **the sweep really deletes.** In the child-driver test, change the seeded owner's pid to
      `process.pid` (a live owner). The test must go red on the "row is gone" assertion, proving the
      assertion is about a deletion and not about a log line. Revert.
- [ ] AC6 — **no real lease DB is touched, and no timer is registered.** `git status --porcelain` is
      clean after the run; `ls .doppelganger/state/lease.db` reports no such file; and the child's
      `supervisor-up` line reports `entries=0`. Record all three — the third is what proves the
      empty-schedule resolution held and no croner timer could have fired.

**Commit:** `supervisor: LSE-09's boot sweep is the real reapDead, proved end to end (LSE-09, SUP-15)`

**Depends on:** J4.5.

**Risks / what could be wrong:**
- **The child writes the REAL heartbeat and status files.** `ROOT` is the checkout, so `beat()`
  writes `.doppelganger/supervisor.heartbeat` and `supervisor.status.json` — both already
  allowlisted by `test/layout.test.ts` assertion 15, both gitignored, and both are what a real
  supervisor writes anyway. Nothing else in `.doppelganger/` is touched.
- **Timing.** The child is killed as soon as `supervisor-up` is seen, never after a fixed sleep. No
  unlisted timing bound. A stderr reader with a per-test timeout is the only bound, and it is the
  test runner's own.
- **`INSTANCE` in the child.** Guard 4 compares the seeded owner's instance to the child's own, so
  the seed must be written with the SAME value the child computes. Set `INSTANCE` explicitly in both
  the seeding process and the child's env — never rely on both defaulting to the same basename.
- **The driver is a fixture the test writes.** It lives under `mkdtempSync`, is removed in `after()`,
  and is a `.ts` file outside the scanned directories, so no repo-wide gate sees it.

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
- `test/knobs.test.ts` — four rows, **and assertion 7's title** (below)
- `test/model.test.ts` — precondition **P4**: the walker excludes `*.fixture.ts`, paid for
- `roadmap.md` §2.27 already names all four keys

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

**ONE vocabulary, and both patterns are BUILT from it — not written twice and compared.**

```ts
/** The period words the CLI names. LIMIT_RE and PERIOD_RE are both constructed from this, so a
 *  wording added to one and not the other is not a thing that can happen. */
const PERIODS = ["weekly", "monthly", "daily", "usage", "session"] as const;
const ALT = PERIODS.join("|");
const LIMIT_RE  = new RegExp(`\\b(?:${ALT})\\s+limit\\b|\\bspend\\s+limit\\b|\\blimit\\s+reached\\b`, "i");
const PERIOD_RE = new RegExp(`\\b(${ALT})\\s+limit\\b`, "i");
```

**This replaces the first draft's plan to SCAN both regex literals and compare their alternations.**
That scan had to parse a possibly multi-line regex literal out of source text — the reference's own
`LIMIT_RE` wraps across lines — and a scanner that mis-parses one of them reports agreement it never
checked. Construction removes the drift instead of detecting it, which is strictly better and is the
same call `kernel/stages.ts` made for `STAGES`.

`spend limit` is its **own alternative** because the period word is not adjacent to `limit` in that
family — *"your org's monthly spend limit"* — so the first alternative misses them. That is not
hypothetical: it is the exact wording in this machine's own quota store (ruling 1), and the reference
records it going unmatched twice before the alternative was added. `limitClass` tests `spend`
**first** and it wins over the period word standing next to it: an admin raising a cap is a different
remedy from a plan reset, and the two share a window anyway.

**Why it matters that they cannot drift:** a period word in `LIMIT_RE` but not `PERIOD_RE`
classifies as `unknown` a wall it has just matched — the shortest window on a wall that may need the
longest. Test 12 below asserts the construction behaviourally, over `PERIODS` itself.

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

**`QUOTA_PAUSE_MS_<CLASS>` is the third `envDynamic` call site — and assertion 7's TITLE must move
with its body.** `test/knobs.test.ts:377` currently reads
`test("7. envDynamic has exactly two call sites (paths.ts's <NAME>_DB, gate.ts's LOCK_STARVE_N_<JOB>)")`
and its `deepEqual` pins `["kernel/runtime/gate.ts", "kernel/paths.ts"]`. Both grow to three, **title
included** — a title that says "exactly two" over a body asserting three is a lie a reader trusts
before they read the code.

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

`recordedAt` is **`string | null`**, and that is not laziness — ruling 1 measured it. Tier 1 rows
carry `source: "xenith/engine/.sandcastle/state/quota.db note:worker:worker-nexus-bennet"` and
friends, `recordedAt` the store's own `since:` value, `via: "first-hand"`. Tier 2 rows carry
`source: "xenith/engine/src/lib/quota.test.ts"`, `via: "reference-corpus"`, and `recordedAt`
**only if the corpus comment actually names a date** — which it does for the three *spend* positives
(2026-08-05, 2026-08-10, 2026-08-18) and **for none of the six period wordings or the six
negatives**. Writing a plausible date onto an undated row is invention by another route, so the
provenance test asserts `recordedAt !== null` **only** for `via: "first-hand"`, and asserts
`source` and `via` non-empty for every row.

**Four first-hand rows exactly** (ruling 1's table), and the test asserts that count is at least
four — otherwise the corpus has quietly become second-hand. **No row spells the BARE wording with
`via: "first-hand"`**: no first-hand row carries it, and a test asserts that too, because it is the
single easiest TST-19 violation to introduce here.

**Do (P4 — before the fixture file exists, or the commit is red):** `test/model.test.ts`'s
`allNonTestTsFiles()` excludes `.test.ts` and nothing else, so `kernel/runtime/quota.fixture.ts`
would be scanned by test 6 (`every file containing a "claude-…" literal must be exactly
kernel/ports/job.ts`). Measured: the tier-1 wordings survive **only because `You've` contains an
apostrophe that ends the regex's character class early** — a coincidence one added row destroys, and
`"claude-code exited with code 3:\nboom"` matches outright.

1. Exclude `*.fixture.ts` from that walker, matching `test/layout.test.ts`'s `realFiles()`, which
   already does — with a comment naming this measurement.
2. **Pay for the exclusion.** Add an assertion that **no non-test file imports a `*.fixture.ts`**, so
   a `claude-` literal in a fixture can never reach production code. Verified already true:
   `kernel/runtime/log/values.fixture.ts` is imported by `emitters.test.ts` and `parse.test.ts` only.

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
12. **Every word in `PERIODS` is matched by BOTH patterns**, driven over the exported vocabulary
    rather than over a source scan: for each `W`, `isLimitError(\`${W} limit reached\`)` is true
    **and** `limitClass(\`${W} limit reached\`)` is `W`. Plus: a word NOT in `PERIODS`
    (`"hourly limit reached"`) is still a wall via `limit reached` and classifies `unknown`. **This
    is the construction's own test; there is no regex-literal scan to get wrong.**
13. **`QUOTA_FIXTURE_RECHECK=1`** (opt-in, skipped by default with a `t.skip` reason) reads the
    reference's `quota.db` if present and reports any `note:` value the fixture does not already
    classify. Asserts nothing about specific bytes.

**Do (`host/run.ts` — the producer and the consumer, ruling 2):**

```ts
export async function runNamed(job, deps, shed): Promise<number> {
  // A deterministic job spawns no model, so it can neither hit a plan wall nor legitimately open
  // one. Ungated, `ops-cron-check` would be SKIPPED by a wall it could not have caused, and its own
  // unrelated failure could OPEN one and park every job on the host (the reference's 2026-08-07
  // incident, and its `describe("only agent-spawning jobs touch the breaker")`).
  const spawnsAgent = job.exec === undefined;

  if (spawnsAgent && isPaused(QUOTA_SCOPE)) {
    log.info("quota-paused", { until: pausedUntil(QUOTA_SCOPE) ?? "" });
    return 0;                                  // a wall is a skipped tick, never a failure (INV-10)
  }
  // … the J4.4 lease wrapper sits here, and it is NOT gated: a double-run is a hazard for every
  //   job shape, model or not.
  try { … } catch (e) {
    const msg = errText(e);
    if (!spawnsAgent || !isLimitError(msg)) throw e;
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
17. **An `exec:` job never reads the breaker.** With the breaker OPEN, `runNamed` on a fabricated
    `exec` job still runs it — asserted with a counter, so "ran" is observed, not inferred.
18. **An `exec:` job never SETS the breaker.** Its `exec` throws
    `Validation Failed: body exceeds the 65536 character limit`… no — it throws a message that DOES
    match `isLimitError` (`"usage limit reached"`), and `runNamed` must **re-throw** it with the
    breaker still closed. **A message that matches is the only fixture that proves the gate rather
    than the classifier.**
19. **The reference's source scan, ported.** Every registered job whose `exec` is set has a file that
    imports neither `quota.ts` nor calls `runJob(` — the same shape as
    `describe("only agent-spawning jobs touch the breaker")`, derived from `JOBS` rather than from a
    hand-typed name list, so a new `exec` job is covered without an edit.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/quota.test.ts` reports 13 (one skipped
      by default) and `node --test host/run.test.ts` reports its previous count plus six.
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
- [ ] AC13 — **P4 is closed and paid for.** Add a row spelling `"claude-code exited with code 3: boom"`
      (no apostrophe) to the fixture. Before the walker change, `npm test` exits non-zero on
      `test/model.test.ts` test 6; after it, green. **Record both runs** — the AC is the pair, since
      the exclusion alone proves nothing. Then add `import { LIMITS } from "../runtime/quota.fixture.ts"`
      to a non-test file: the compensating scan must go red. Revert both.
- [ ] AC14 — **the exec gate fires in both directions.** Delete `spawnsAgent &&` from the `isPaused`
      guard: `npm test` exits non-zero on test 17. Restore, and delete `!spawnsAgent ||` from the
      catch: non-zero on test 18. Revert both.
- [ ] AC15 — **assertion 7's title moved with its body.** `grep -n 'exactly two call sites' test/knobs.test.ts`
      returns nothing. Record it.

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
| `spend` | **unparseable** (`"garbage"`) | `NaN` | any | **false** | **false** |
| any of `session daily usage weekly monthly unknown` | any | any | any | false | false |

Two rules produce it and nothing else does:

- **`recent = limit === "spend" && since != null && now − Date.parse(since) ≤ windowMs`.**
- **`recent ? { skip: cls === "chore", downshift: cls !== "review" } : NO_SHED`.**

**The unparseable row is not an extra case — it is the first rule falling out correctly, and it is
worth a test because nothing else proves it.** `Date.parse("garbage")` is `NaN`, and
`NaN <= windowMs` is `false`, so `recent` is false and nothing sheds. That is the **safe** direction
(shed less, spend more) and it is the direction that matters, because `since` comes from a
key/value store an operator can hand-edit with `sqlite3` — the reference's own `clearPause` writes
`""` into a sibling key for exactly that reason. The first draft's grid had three `since` states and
would have left this untested.

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

1. **The whole table as one grid.** 7 limit classes × 3 job classes × **4** `since` states
   (`null`, recent, old, **unparseable**) = **84 cells**, `deepEqual`'d against the two rules
   computed independently in the test. Not seven `it`s — one grid, so no cell can be forgotten, and
   the grid is **total for the type**: every member of `LimitClass` × every member of `JobClass` ×
   every shape `since` can hold.
2. **A recent spend wall**: chore `{true,true}`, watch `{false,true}`, review `{false,false}`.
3. **A wall older than the window sheds nothing, for any class.**
4. **A scope never paused (`since: null`) sheds nothing — and neither does an unparseable `since`.**
   Named separately from the grid because it is the row an operator's hand-edit produces.
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
- [ ] AC4b — **the unparseable row fails safe.** Change `recent`'s comparison to
      `!(now.getTime() - Date.parse(since) > windowMs)` — which is true for `NaN`. `npm test` exits
      non-zero on tests 1 and 4, with an unparseable `since` now shedding. Revert. (The mutation is
      a `!(a > b)` for `a <= b`; they differ **only** on `NaN`, which is the point.)
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

## J4.11 — `scriptCommandOf`'s `.ts` branch, and the two `validate()` rules that make a shebang safe  ·  SUP-03, SUP-05, SUP-08 (a FIX to rows N2 shipped)

**Goal:** finish ruling 5. The first half landed in `b48c89f`; what is left is the extension dispatch
and the two boot-time refusals that make "render no interpreter" safe.

**This job carries no N4 feature id on purpose.** It is a **fix to SUP-03, SUP-05 and SUP-08 — rows
N2 shipped** — and it lands here because N4 is the phase that first writes a `script:` entry. The
commit message says so.

**Files touched:**
- `host/schedule.ts` — `scriptCommandOf`'s extension dispatch, `validate()` rules 12a/12b
- `host/schedule.test.ts`, `host/validate.test.ts` — the new cases

**Read the landed code first, not the first draft's sketch.** `b48c89f` shipped:

```ts
export function scriptCommandOf(root: string, script: string): readonly [cmd: string, args: readonly string[]] {
  return [join(root, script), []];
}
```

with three call sites (`host/schedule.ts:162` inside `commandOf`, `host/supervisor.ts:189` inside
`spawnChild`, and `host/schedule.test.ts`) and two tests already green: test 7 asserts a `.sh`
command names no `\bnode\b`, test 8 asserts `commandOf`'s rendering contains exactly what
`scriptCommandOf` renders. **Keep the two-argument signature.**

**Do (1 — the `.ts` branch, the only shape still wrong):**

```ts
export function scriptCommandOf(root: string, script: string): readonly [cmd: string, args: readonly string[]] {
  const abs = join(root, script);
  // A .sh carries its own shebang, so no interpreter is named: a bare `bash` would be a PATH lookup
  // in cron's stripped environment (N2 F1's hazard) and `/bin/bash` a door-1 literal that moves
  // between distributions. A .ts has no shebang and must name one. validate()'s rules 12a/12b are
  // what make the first arm safe.
  return script.endsWith(".sh") ? [abs, []] : [process.execPath, [abs]];
}
```

Today every script is exec'd directly, so a `.ts` entry would be handed to the kernel with no
interpreter and no shebang. **There is no such entry, which is why nothing is red** — and adding one
silently is the same class of bug one extension over.

**Do (2 — `validate()` rules 12a and 12b, on the `script:` branch):**

```
12a. script must end in .ts or .sh
     -> "script must end in .ts or .sh, got …"
12b. a .sh script is executable and starts with `#!`
     -> "script <p> is not executable — a chmod -x silently disables it (SUP-05)"
     -> "script <p> does not start with #! — it is rendered with no interpreter (SUP-05)"
```

Rule 12b is what earns the no-interpreter rendering. A stray `chmod -x` on the one liveness probe on
the box is exactly the failure JOB-O10 exists to catch, and a boot-time refusal beats discovering it
at 03:18 with nothing able to report it.

**The `job:` branch keeps its bare `node`, unchanged.** Ruling 5 says why, and says the first draft
contradicted itself here. Out of scope; **Gaps item 9**.

**Do (tests):**

- **`host/schedule.test.ts` grows one case, it does not rewrite tests 7 and 8.** A `.ts` script must
  render `process.execPath` followed by the absolute path, and must NOT be exec'd bare. Assert
  `scriptCommandOf(ROOT, "host/x.ts")[0] === process.execPath`.
- **Tests 7 and 8 stay exactly as `b48c89f` wrote them** — they already cover the `.sh` arm and the
  one-spelling agreement, and re-writing them would be the "re-ship under a new name" this plan bans
  elsewhere. AC6 confirms they are untouched.
- **`host/validate.test.ts`:** a `.py` script → refused (12a); a `.sh` without the exec bit →
  refused; a `.sh` without a shebang → refused; a `.sh` with both → accepted; **a `.ts` script is
  accepted without an exec bit or a shebang** — 12b applies to `.sh` only, because a `.ts` is handed
  to an interpreter. Fixtures written into the test's own temp root with `chmodSync`.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0.
- [ ] AC2 — **the `.ts` branch fires.** Revert `scriptCommandOf` to the unconditional
      `[abs, []]`. `npm test` exits non-zero on the new `.ts` case — **and tests 7 and 8 stay
      green**, which is the proof that the landed half and the new half cover different arms.
      Record both. Revert.
- [ ] AC3 — **one spelling still holds.** Change `spawnChild`'s script branch back to an inline
      `[join(root, e.script), []]`. `npm test` exits non-zero on `host/supervisor.test.ts:509`
      (`assert.deepEqual([call.cmd, call.args], scriptCommandOf(h.root, "scripts/probe.sh"))`) once a
      `.ts` fixture is used there, or on test 8. Record which. Revert.
- [ ] AC4 — **rule 12b fires both ways.** `chmodSync(fixture, 0o644)` → validate refuses naming it;
      remove the `#!` line → refuses naming that. Both messages recorded verbatim.
- [ ] AC5 — **rule 12a fires, and 12b does not over-reach.** A `script: "host/x.py"` fixture →
      refused. A `.ts` fixture with mode 644 and no shebang → **accepted**. Both recorded.
- [ ] AC6 — **nothing landed was re-shipped.** `git diff -U0 host/schedule.test.ts` touches only the
      new `.ts` case; tests 7 and 8 are byte-identical to `b48c89f`. Record the line count.
- [ ] AC7 — `node --test cli/crontab.test.ts` and `node --test cli/crontab-cli.test.ts` pass
      unchanged: they build command lines through `commandOf`, so a shape change must not have broken
      the block mechanics.

**Commit:** `schedule: a .ts script names its interpreter; validate refuses a non-executable probe (SUP-03, SUP-05, SUP-08 — fix)`

**Depends on:** J4.1. Must land before J4.14.

**Risks / what could be wrong:**
- **The exec bit is not preserved by every checkout path.** Git stores it; a zip export or an odd
  mount may not. Rule 12b turns that into a boot refusal with an actionable message — the right
  trade, and it means a clone onto a filesystem with no exec bit refuses to boot. Named in the rule's
  own message.
- **`process.execPath` in `scriptCommandOf` is an absolute path in a value position** — door 1 scans
  string LITERALS, and this is an expression, so nothing trips. Confirmed by AC1; if a future
  refactor inlines it as a literal, door 1 is the gate.

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

`15 22 * * *` — a single minute, a single hour, `dom` and `dow` both unrestricted — is inside the
croner ∩ POSIX intersection N2 measured, so the `dom`+`dow` divergence class cannot apply.

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
- [ ] AC7 — **it runs, read-only, against the developer's real crontab.**
      `CRONTAB_CMD=/usr/bin/crontab npm run job ops-cron-check` exits 1 with
      `no managed block installed — run \`npm run crontab sync\`` and writes one
      `level=error event=cron-drift` line. Paste both.
      **Why this is safe, measured 2026-08-26 rather than assumed:** the developer's crontab is NOT
      empty — it carries 22 lines including a **foreign managed block** whose marker is
      `# >>> engine managed block (npm run cron:sync) >>>`, left by the reference. Ours are
      `# >>> doppelganger:<instance> managed block …` and `LEGACY_BEGIN` is
      `# >>> doppelganger managed block …`, so **`installedBlock` and `legacyRange` both see
      nothing** and the job reports "no managed block installed" rather than offering to adopt the
      reference's. Verified live: `CRONTAB_CMD=/usr/bin/crontab node cli/crontab.ts check` → that
      exact message, `rc=1`, crontab unchanged.
      **This is the ONE AC that reads a real crontab; it never writes one, and the suite never runs
      it** (AC4 proves that).

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

**The obvious shape is wrong, and the first draft had it.** `beat()` writes the heartbeat and then
`status.json` inside ONE `try`. Stamping from that catch means a **good heartbeat plus a failing
`status.json` write** sets the stamp — and probe 4 then prints *"the supervisor is alive but cannot
write its heartbeat — probe 3 is a false alarm"* while probe 3 never fired and the heartbeat is
perfectly fresh. A liveness probe whose correction fires when there is nothing to correct is worse
than no correction. So the two writes are **independent**, and only the heartbeat feeds the stamp:

```ts
export function beat(deps: BootDeps): void {
  const log = logger("supervisor");
  const stamp = deliveryStamp(deps.heartbeatFailPath);

  let heartbeatOk = false;
  try {
    mkdirSync(dirname(deps.heartbeatPath), { recursive: true });
    writeFileSync(deps.heartbeatPath, `${Math.floor(deps.now().getTime() / 1000)}\n`);
    heartbeatOk = true;
  } catch (e) {
    log.warn("heartbeat-failed", { msg: errText(e) });
  }
  stamp(heartbeatOk);                       // the stamp means EXACTLY what probe 4's message says

  try {
    mkdirSync(dirname(deps.statusPath), { recursive: true });
    writeFileSync(deps.statusPath, JSON.stringify(snapshot(deps)));
  } catch (e) {
    log.warn("status-failed", { msg: errText(e) });   // its own event; it is not a liveness fault
  }
}
```

**`beat()` still never throws, and `main()` step 4 calls it unguarded** — *a supervisor that dies
because it could not write its own liveness stamp turns a full disk into a dead fleet, which is
strictly worse than the watchdog firing.* `stamp()` sits **outside** both `try` blocks, so its own
safety is `deliveryStamp`'s internal swallow and nothing else. **That is asserted, not assumed**
(J4.13 test 9): with `heartbeatFailPath` pointing at a directory, `beat()` must return normally and
`main()` must still reach `supervisor-up`.

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
8b. **A failing `status.json` write does NOT stamp** — and this is the test the first draft's design
   would have failed. `statusPath` inside a file, `heartbeatPath` fine: assert the heartbeat file is
   fresh, one `status-failed` warn is logged, `heartbeat-failed` is NOT, and **`heartbeatFailPath`
   does not exist**. Without the split, probe 4 would print *"the supervisor is alive but cannot
   write its heartbeat — probe 3 is a false alarm"* while probe 3 never fired.
9. **`beat()` never throws even when the STAMP path is unwritable, and `main()` still boots.**
   `heartbeatFailPath` pointed at a directory: `beat(deps)` returns normally, and a full
   `main(schedule, deps)` still emits `supervisor-up`. `stamp()` sits outside both `try` blocks, so
   its only protection is `deliveryStamp`'s internal swallow — **asserted, not assumed**, because
   `main()` step 4 calls `beat(deps)` unguarded and a throw there kills the boot.

**Do (`test/writes.test.ts`):** `kernel/runtime/delivery.ts` signs door 3 —
`category: "project-relative"`, `reason: "writes and removes one delivery stamp under ROOT (JOB-O11)"`.
`host/supervisor.ts`'s existing row grows the stamp to its reason text.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0; `node --test kernel/runtime/delivery.test.ts` reports 6 passing and
      `node --test host/supervisor.test.ts` reports its previous count plus three.
- [ ] AC2 — **the direction is not inverted.** Swap `rmSync` and `writeFileSync`. `npm test` exits
      non-zero on tests 1 and 2 **and** on supervisor tests 7 and 8. Revert. (Four reds is the point:
      the contract and its producer are separately covered.)
- [ ] AC3 — **it never throws.** Delete the `try`/`catch`. `npm test` exits non-zero on test 4.
      Revert.
- [ ] AC4 — **the producer fires.** Delete `stamp(heartbeatOk)`. `npm test` exits non-zero on
      supervisor tests 7 and 8. Revert.
- [ ] AC4b — **the split is load-bearing.** Merge the two writes back into one `try` and stamp from
      its catch (the first draft's shape). `npm test` exits non-zero on **test 8b**. Revert. Record
      the failure message — it is the misdiagnosis this job exists to prevent.
- [ ] AC4c — **an unwritable stamp does not kill the boot.** Delete `deliveryStamp`'s internal
      `try`/`catch`. `npm test` exits non-zero on delivery test 4 **and** supervisor test 9. Revert.
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
BREACH="$ROOT/.doppelganger/watchdog.breach"

# PROBE 0 — the log channel itself. `set -uo pipefail` does NOT exit on a failed `.`, so a missing
# log.sh leaves log_init/log_error undefined, every fault line becomes `command not found` on
# stderr, and a healthy-looking `exit 0` follows: EVERY FAULT SILENTLY LOST from the one channel
# that remains. Detected here, reported with a bare printf, and the script stops before it can
# pretend to be healthy.
if ! . "$ROOT/kernel/runtime/log/log.sh" 2>/dev/null || ! declare -F log_error >/dev/null 2>&1; then
  printf '%s watchdog: log.sh missing or broken at %s — the log channel is DOWN\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ROOT/kernel/runtime/log/log.sh" | tee -a "$BREACH" >&2
  exit 1
fi
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

**The report — TWO channels, and `exit 1` is not one of them (ruling 6, measured):**

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
- **`exit 1` is the correct exit status and NOT a delivery channel.** Measured on this host
  2026-08-26: no `sendmail`/`mail`/`mailx`/`postfix`/`exim4`/`ssmtp`/`msmtp`, `/var/mail` empty, and
  `strings /usr/sbin/cron` (`3.0pl1-184ubuntu2`) contains **`No MTA installed, discarding output`**.
  Cron writes that line to syslog and **throws the fault text away**. The header states the
  measurement and the date, so nobody re-discovers it at 3am. The exit status is kept because it is
  what a process manager, a future MTA or a human running the script reads.
- **The day a Slack plugin lands, `DELIVERY_STAMPS` grows a row and probe 4 covers it for free** —
  no edit to this script's probe logic, only its path list, which test 2 forces.

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

1. **Every KNOB in the script has a matching `EnvSpec` row, and the DEFAULTS agree — and membership
   does NOT depend on the default-form regex.** The first draft's single pattern
   `\$\{([A-Z][A-Z0-9_]*):-([^}]*)\}` misses `${N:=d}`, `${N-d}`, `${N=d}`, `${N:?…}`,
   `: "${N:=d}"` and a bare `$N` — six spellings, each of which would make a knob invisible to the
   gate. So membership is decided by a rule that has no spelling at all:

   > **A knob is an uppercase name the script READS and never ASSIGNS.**

   Two passes over the source. **Reads:** every `$NAME` and every `${NAME…}`, one pattern
   `\$\{?([A-Z][A-Z0-9_]*)\b`, which catches all seven forms because it stops at the name.
   **Assignments:** every `^\s*NAME=` and every `local NAME=`/`declare NAME=`. The difference is the
   knob set — so `ROOT`, `BREACH`, `HEARTBEAT`, `DIR` and every other local drops out **by
   construction**, not by an allowlist. A short SIGNED exclusion list covers the names that are read,
   never assigned, and are not this script's knobs: `PATH`, `HOME`, `BASH_SOURCE`, `ENGINE_ROOT`,
   `LOG_LEVEL`, `LOG_JOB` — each with a one-line reason, and the list is asserted exactly so it
   cannot grow silently.
   **Defaults** are then read per knob from whichever expansion form that knob uses (all seven
   patterns tried, first match wins) and `deepEqual`'d against the rows. **Neither side may grow
   alone.**
2. **Every path the script stats is a `DELIVERY_STAMPS` row or a named constant — and assignments are
   resolved first.** The first draft would have scanned only for `.doppelganger/…` literals, and
   **this script's own body defeats that**: `BREACH` and `HEARTBEAT` are built by assignment and used
   as `"$BREACH"`, while `heartbeat.fail` is stated inline — two spellings of a path in one file. So
   the scan does a one-pass literal substitution of every `NAME=<literal>` assignment into every
   later `$NAME`/`${NAME}` occurrence, THEN extracts the `.doppelganger/…` set. Assert it equals
   `DELIVERY_STAMPS.map(r => r.path)` plus `{watchdog.lock, watchdog.breach, supervisor.heartbeat}`.
   **This is the v1 seam's teeth**: a new stamp row with no probe goes red here.
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
11. **Probe 0: a missing `log.sh` is reported, not swallowed.** Fixture root whose
    `kernel/runtime/log/log.sh` is absent → exit 1, **the breach file exists and names log.sh**, and
    stderr carries the bare `printf` line and **no `command not found`**. Then the same with a
    present-but-empty `log.sh` (sourced fine, defines nothing) → identical outcome, because
    `declare -F log_error` is what decides, not the `.`'s status.
12. **`exit 1` is asserted as a status, never as a delivery.** The test asserts the exit code and
    asserts **nothing** about mail — and carries the ruling-6 measurement in its comment, so a future
    reader does not add a mail assertion for a channel that does not exist.

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

- [ ] AC1 — `npm test` exits 0; `node --test host/watchdog.test.ts` reports 12 passing.
- [ ] AC2 — **the knob gate binds both ways, and across spellings.** Change the script's
      `${WATCHDOG_SUPERVISOR_STALE_M:-5}` to `:-20` → test 1 red on the default. Revert. Add
      `${WATCHDOG_COOLDOWN_M:-60}` with no row → red on membership. Remove. **Then re-spell an
      existing knob three ways in turn — `${WATCHDOG_DRY_RUN-0}`, `${WATCHDOG_DRY_RUN:=0}`, and a
      bare `$WATCHDOG_DRY_RUN` — and confirm the gate still finds it every time.** Record all five
      outcomes. A gate that only sees `:-` is the one-spelling failure this repo has shipped five
      times.
- [ ] AC3 — **the stamp seam has teeth.** Add a second `DELIVERY_STAMPS` row without touching the
      script. `npm test` exits non-zero on test 2. Remove.
- [ ] AC4 — **the toolchain ban is real.** Add `"$ROOT/node_modules/.bin/tsc" --version` to the
      script. `npm test` exits non-zero on test 3. Remove.
- [ ] AC5 — **`set -e` would silence it.** Add `set -e`. `npm test` exits non-zero on test 4 **and**
      on test 6 (the first failing probe aborts before any fault is logged). Record both. Revert.
- [ ] AC5b — **probe 0 fires.** Delete the `declare -F log_error` half of the guard (keep the `.`'s
      status check) and point the fixture at a present-but-empty `log.sh`. `npm test` exits non-zero
      on test 11's second half. Revert. Then delete the whole guard: non-zero on both halves, and
      **record that the failing run emits `command not found` and exit 0** — the silent-loss shape.
- [ ] AC6 — **probe 3 is the one that matters, and probe 4 corrects it.** Delete probe 3: non-zero on
      test 6. Restore; delete probe 4: non-zero on test 8. Revert.
- [ ] AC7 — **SUP-09 is enforced.** Add `supervised: false` to the `ops-cron-check` entry too.
      `npm test` exits non-zero with
      `more than one entry sets supervised: false (SUP-09) — at most one is allowed` —
      **validate rule 22's first live subject**. Revert.
- [ ] AC8 — **rule 23 has a subject.** Put a bare `%` in the watchdog entry's `log` path.
      `npm test` exits non-zero with the unescaped-% message — **rule 23's first live subject**.
      Revert.
- [ ] AC9 — **the crontab block is real.** `CRONTAB_CMD=/usr/bin/crontab npm run crontab -- render`
      prints a block with exactly one command line, and it names `host/watchdog.sh` with **no
      `node`** (ruling 5). `render` reads nothing and writes nothing, so no dry-run flag is needed.
      Paste it. Capture `crontab -l > /tmp/before.txt` before the suite and `diff` after: empty.
- [ ] AC10 — **it runs on this machine, healthy and breaching.** `bash host/watchdog.sh` against the
      live checkout with no supervisor running → exit 1, the heartbeat-missing fault, a breach file.
      Start nothing; `rm .doppelganger/watchdog.breach` afterwards and record that `git status
      --porcelain` is clean.
- [ ] AC11 — `node --test host/classes.test.ts` passes with `"watchdog.sh"` in `WATCH`; removing it
      goes red naming the program.

**Commit:** `watchdog: four probes, bash only, the one entry on the real crontab (JOB-O10, SUP-09)`

**Depends on:** J4.11 (`scriptCommand`), J4.13 (the stamp), J4.9 (`WATCH`).

**Risks / what could be wrong:**
- **Two channels, and both are local.** The breach file and the log. `exit 1` delivers nothing on
  this host — measured, not guessed — so an operator who never looks at `.doppelganger/` learns
  nothing. That is the honest N4 state; inventing an integration to make the story nicer is the one
  thing this plan refuses. **Gaps item 4.**
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
4. **Record the seven measurements** this phase produced, in LOOP.md's `Settled questions`:
   - `isOwnerAlive` fails toward DEAD in three branches of the reference; ours splits `unknown` from
     `dead`, **and `ENOENT` is positive evidence only on a `/proc` without `hidepid`/`subset=pid`**
     — this host measured unrestricted, `rw,nosuid,nodev,noexec,relatime` (J4.2, ruling 4).
   - `commandOf` rendered `node <script>.sh` while `spawnChild` exec'd it directly; `b48c89f` fixed
     the `.sh` half and J4.11 the `.ts` half — the N3 F1 precedent applied a second time (ruling 5).
   - The quota fixture corpus is first-hand from this machine's reference store: **four parks, three
     dated 2026-08-26, `class: spend` on the three workers only, two nesting depths, 22 `job_queue`
     rows carrying one distinct string** (J4.8, ruling 1).
   - `DEFAULTS.shedModel` cannot be a literal outside `kernel/ports/job.ts` because
     `test/model.test.ts` test 6 is exact — **and `*.fixture.ts` was scanned by it until J4.8**
     (J4.9, ruling 8; precondition P4).
   - **This host has no MTA of any kind**, `/var/mail` is empty, and cron `3.0pl1-184ubuntu2`
     contains `No MTA installed, discarding output` — so a non-zero exit is a status, not a channel
     (J4.14, ruling 6).
   - **The hourly key is the writer the first draft missed**: the clock versions a key for a reason
     unrelated to the job's success, so `withLease` keeps four members and loses six (J4.4,
     ruling 3).
   - `beat()` writes the heartbeat and `status.json` in **two independent `try` blocks**, because one
     block made a failing status write set the heartbeat stamp and probe 4 correct a probe that never
     fired (J4.13, ruling 7).
5. **Push `dev`** and record the CI run URL. LOOP.md's own note says CI stopped triggering on
   2026-08-26 — check `gh run list --branch dev` before trusting the badge, and if no run appears,
   record that instead of claiming one.

**Acceptance criteria:**

- [ ] AC1 — `npm test` exits 0. Record the four numbers against the **528 / 526 / 0 / 2** baseline
      and the delta.
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
| **TST-19 says fixtures are lifted from real data, and this repo has never been walled** | The reference's LIVE store on this machine is the source — **and the first draft miscounted it, which is a TST-19 fault, not a typo.** Re-measured: **four** parks (`claude` plus three workers), **three** dated 2026-08-26, `class: spend` on the **three workers only** (`claude` predates the key and is the row `inspect`'s fallback exists for), and **two** nesting depths, not three: `claude-code exited with code 1:\n…` and `task 502 failed: …`. **No first-hand row carries the bare wording**, so a bare row marked `first-hand` would be an invention. The `job_queue.note` occurrence is **22 rows carrying one distinct string**, not one row. Tier 2's six period wordings and six negatives are **undated bare list entries** — only the three *spend* positives carry incident dates — so `recordedAt` is `string \| null` and the provenance test requires it only where a date exists. Nothing pinned: `QUOTA_FIXTURE_RECHECK=1` is opt-in and asserts no bytes. |
| **LSE-11 says every branch fails toward alive; the reference's own code fails toward DEAD in three** | Measured: `pidNamespace()` reads `/proc/self/ns/pid`, `bootTimeSec()` reads `/proc/stat`, and a `/proc` that answers the first while refusing the second turns every owner into a corpse and every live claim into a reap. Ours returns a three-member `Liveness` and reaps on **`"dead"` only**, with **four** `/proc` readers injected, so "fails toward alive" is a grid rather than three lucky branches. **And `ENOENT` is positive evidence only on an unrestricted `/proc`** — under `hidepid`/`subset=pid` another user's LIVE pid raises `ENOENT`, and two checkouts by different users with the same basename share `INSTANCE`, host and pidns, so guards 4/5/6 all pass and a live claim would be force-deleted. `procIsRestricted()` reads `/proc/self/mountinfo` once per sweep and downgrades the whole arm; a read failure downgrades too. Measured here: `/proc rw,nosuid,nodev,noexec,relatime` — unrestricted, downgrade inactive, reaper works. |
| **"A killed pass does not wedge the next one" — and the first draft could not name a writer** | It declared a two-member space exhausted and there was a third. **`<job>@<UTC hour>`**: the clock versions the key for a reason wholly unrelated to whether the pass worked — the draft's own stated criterion — so six firings a night are six keys, `done`-is-terminal is exactly right, and it excludes what the gate cannot (a hand-run beside a tick, a second checkout; INS-05). No LSE-12 needed. **So the writer ships and everything without a caller is cut**: `settle`, `maxConcurrent`, `heldCount`, `renew`, the heartbeat interval, the `AbortSignal`, the `lost` result — and `beatMs`, a parameter added to a production signature purely so a test could watch a path no caller takes, which is D9's symptom and was the tell for the rest. The TTL is **derived** from SUP-13's own bound, not chosen. The gate is then true twice: by the key's construction (a killed pass's claim never blocks the next hour) and by the boot sweep, which now has real rows to find on a real host. |
| **JOB-O11 says "written on a failed send", and N4 has no send** | The contract ships with **one real producer and its limit written down**: the supervisor's heartbeat write. A supervisor alive and scheduling but unable to stamp is, from outside, identical to a dead one — probe 3 reports the second, and probe 4 corrects it. **The obvious implementation is wrong and the first draft had it**: `beat()` writes the heartbeat and `status.json` in ONE `try`, so stamping from that catch would set the stamp on a failing `status.json` write and probe 4 would then "correct" a probe that never fired. The two writes become **independent**, with two events (`heartbeat-failed`, `status-failed`) and the stamp fed by the heartbeat only. The circularity (one filesystem) is stated. The v1 seam is a **register plus a bash drift gate**: a Slack send path adds a `DELIVERY_STAMPS` row and the watchdog must grow a probe or the build fails. |
| **The watchdog must report, and there is nothing to report to** | **TWO channels, not the three the first draft claimed.** The **breach file** (presence is the alarm) and the **log** (`log_error breach`, which JOB-O02 reads at N5). **`exit 1` delivers nothing here — measured, not guessed:** no `sendmail`/`mail`/`mailx`/`postfix`/`exim4`/`ssmtp`/`msmtp`, `/var/mail` empty, and cron `3.0pl1-184ubuntu2` carries the string `No MTA installed, discarding output`. The exit status is kept as a status. **And the log channel can itself vanish silently**: `set -uo pipefail` does not exit on a failed `.`, so a missing `log.sh` leaves `log_error` undefined and every fault becomes `command not found` before a healthy `exit 0` — so probe 0 detects it, writes the breach file with a bare `printf`, and stops. **Declined with the phase that brings each subject:** the reporter-freshness probe (JOB-O02, N5), the Slack and Jira stamps, `WATCHDOG_STALE_M`, `WATCHDOG_COOLDOWN_M`, the `claude -p` fallback. Declining beats a vacuous probe — SUP-12's precedent. |
| **`commandOf` would have rendered `node host/watchdog.sh`** | Found by writing the first `script:` entry, not by review — `SCHEDULE` had never held one, and test 7 asserted only that the script NAME survived, so `node` was invisible while `spawnChild` exec'd the script directly. N3 F1 exactly, one row over. **`b48c89f` landed the `.sh` half while this plan was being written**, with `scriptCommandOf(root, script)`, three call sites and two green tests — so J4.11 is rewritten against the landed two-argument signature and re-ships none of it. What is left: the **`.ts` branch** (still exec'd bare, with no shebang to fall back on) and `validate()` rules 12a/12b — **executable, and starts with `#!`** — which are what earn the no-interpreter rendering. The `job:` branch keeps its bare `node`; the first draft's sketch contradicted its own prose there and the sketch is deleted (Gaps 9). |
| **The watchdog's knobs are read by bash, and KRN-06 says every knob is an `EnvSpec` row** | Both, bound together. The rows live in `host/config.ts` with `readers: []` (the `<NAME>_DB` precedent) and a **drift gate parses `${NAME:-default}` out of `host/watchdog.sh` and `deepEqual`s the set against the rows** — neither side may grow alone. Same technique as `log.sh` ↔ `emit.ts` (TST-18) and `crontab check`. A row nothing reads would be a lie; a row a gate binds to the script that reads it is a definition. |
| **`SHED_MODEL` is a model literal, and `test/model.test.ts` test 6 admits exactly one file** | The downshift target lands as **`DEFAULTS.shedModel` in `kernel/ports/job.ts`**, and `kernel/runtime/shed.ts` contains no `claude-` literal at all. That is not a dodge around a gate — it is HRN-01's own rule and the reference's own stated intent ("bump both the day `DEFAULTS.model` bumps generation"). Test 6's allowlist does not grow; tests 3 and 4 grow one assertion each so the new value is held to `PINNED` and the alias denylist too. |
| **TST-17 names six things and four of them exist or are v1** | A table, in the job, saying which is which: the **gate contract shipped at N2** (24 tests, three levels — `kernel/runtime/gate.test.ts` gains a header paragraph and **not one test**), the lease primitive and reaper guards are J4.3–J4.5, the breaker is J4.8, and queue/broker/worker are M9. What is genuinely new is the half N2 could not write: the contract over the **real** `PROGRAMS` and `RESOURCES`, which needed a schedule with more than one entry to say anything at all. AC2 measures the diff to `gate.test.ts` in lines, so "re-shipped under a new name" is checkable. |
| **The schedule grows for the first time, and three `validate()` rules have never had a subject** | Named and exercised: **rule 22** (at most one `supervised: false`) fires for the first time — AC7 of J4.14 adds a second and watches it refuse. **Rule 23** (unescaped `%` in a rendered bootstrap command) gets its first subject — AC8. **Rule 17** (`gate: "none"` needs a `whyNoGate`) gets its first two — J4.12 AC5. Plus `bootstrapEntries` becomes non-empty, so `crontab render` emits its first command line and `tally()`'s count stops being 0; and `entriesInWindow` stops being a one-element assertion and starts discriminating three entries against a fixture window (J4.15 AC5's two mutations). |
| **The suite WAS red before N4 starts, and the N3 closer fixed it under this plan** | `97fecfc` (R2) made all five repo-wide walkers skip `.doppelganger/worktrees` — **narrowly**, so a stray at `.doppelganger/state/junk.db` is still caught — and made assertion 15 derive `LEGIT_DB_NAMES` from `DB_NAMESPACES`, which is the structural half `lease.db` and `quota.db` would otherwise have made permanent. `2a38193` (R4) widened the Ships-line parser on **both** sides to `[A-Z]+-[A-Z]?\d+`, which was a build blocker N3 would have hit first on its own `JOB-C15`. `b48c89f` (R3) landed half of ruling 5. **This revision deletes the work rather than re-doing it, cites the shas, keeps each as a regression AC, and re-baselines at 528 / 526 / 0 / 2.** The one precondition still open is P4, and it belongs to J4.8. |

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

3. **No `LSE-` row says what a lease is FOR at v0, so the writer had to be invented rather than
   read.** LSE-01…11 describe a mutex in complete detail and never name a single caller; every
   consumer the roadmap does name is v1 (pipeline watchers), M9 (LSE-12's serial group) or N5
   (`ops-lease-reap`). N4's writer — `<job>@<UTC hour>` in `runNamed` — is a design decision this
   plan made, not one the spec implies, and it is the difference between shipping a primitive with
   twenty tests and no callers and shipping one that runs every night. A `LSE-` row should say that
   the v0 unit of exclusion is **one job's one firing**, and that the gate (per-process) and the
   lease (per-host, per-instance) divide at exactly that line.

4. **`JOB-O10` and `JOB-O11` both assume an outbound integration v0 does not have, and one of the
   reference's two send paths does not exist on a normal host at all.** JOB-O11's producer ("a failed
   send") and consumer ("the watchdog reports its presence") are separated by every plugin that
   arrives at v1; N4 substitutes the supervisor's heartbeat, which is a *signal* rather than a
   *send*, and the circularity is real (one filesystem). JOB-O10 says the watchdog "reports" and the
   roadmap never says to whom before v1. **Measured on this host: cron's `MAILTO` is not a channel**
   — no MTA of any kind is installed, `/var/mail` is empty, and cron `3.0pl1-184ubuntu2` carries the
   string `No MTA installed, discarding output`. So v0's honest answer is "a file and a log line,
   both local", and §2.19 should say so rather than leaving a builder to assume a delivery that
   silently discards.

5. **`TST-17` bundles six subjects across three milestones into one row.** Gate contract (N2), lease
   primitive and reaper guards (N4), queue claim/settle and the broker socket and the worker loop
   (M9). A row that is one-third done reads as undone, and a builder who takes it literally either
   re-ships N2's gate tests or skips the phase's own half. It should be split — the `(… half)` qualification
   §3's old N4 line used **cannot** go on a Ships line at all, because `test/layout.test.ts`'s
   classifier throws on a qualified token (item 14), so today that qualification has nowhere
   checkable to live.

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
   NOT changed in N4** — it touches every rendered line, `cli/crontab.test.ts` pins those lines, and
   it is a distribution (ADO) decision, not a liveness one. The first draft's own code sketch changed
   it while its prose said not to; the sketch is deleted (ruling 5).

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

13. **Nothing said a repo-wide drift gate must skip the engine's own working directories, and it
    cost four red assertions on a verified phase.** Five walkers skipped `node_modules` and `.git`
    and none skipped `.doppelganger/`, which holds a full second checkout whenever a pass worktree
    exists — and `NIGHTLY_SANDCASTLE_MAX=0` leaves one behind **by design** (J3.12's own header says
    so). **Fixed in `97fecfc`**, narrowly and correctly: the skip is `.doppelganger/worktrees`
    specifically, and assertion 15 now derives `LEGIT_DB_NAMES` from `DB_NAMESPACES` so `state/` is a
    database's designed home rather than a leak. N1 F4 gave the checkout a "a test leaves nothing
    behind" rule; the mirror — **"a gate may not read what the engine legitimately writes"** — still
    has no `TST-` row, and the next directory the engine starts writing will rediscover it.

14. **The Ships-line parser could not classify a `JOB-` id, and it THREW rather than failing.**
    `expandShipsIds` accepted `PREFIX-NN`, a range and `PREFIX-*`, and threw by name on anything
    else; `workPhaseIds` had the mirror blind spot. `JOB-C15` sits in **N3's own** Ships line, so
    ticking N3 would have thrown inside the classifier's own enumeration loop. **Fixed in
    `2a38193`** — both regexes now accept `[A-Z]+-[A-Z]?\d+`, so ~20 `JOB-` rows across N5 start
    being compared for the first time. **Promoted out of Gaps into precondition P3** because it was a
    build blocker; recorded here because the shape problem remains: a token the classifier cannot
    place **throws**, which is strictly worse than a failed assertion, and `TST-17 (lease + breaker
    half)` — the exact qualification §3's N4 line wants — is still such a token.

15. **`test/model.test.ts` test 6 scans `*.fixture.ts`, and nothing says a fixture is not production
    code.** `test/layout.test.ts`'s `realFiles()` excludes `*.fixture.ts`; `test/model.test.ts`'s and
    `test/knobs.test.ts`'s walkers do not. So a model-shaped literal in a fixture turns the one-file
    rule red, and the quota corpus passes only because every recorded wording happens to contain an
    apostrophe that ends the regex's character class early. A `TST-` row should say what a
    `*.fixture.ts` is and which gates it sits inside — and the answer is not the same for all of
    them, since a knob declared in a fixture WOULD be a real knob.

16. **Nothing rules on whether an operator CLI may be a runtime dependency of a job.** Item 7
    restated, because J4.12 makes it concrete: `ops-cron-check` imports `cli/crontab.ts` for
    `render`/`diff`/`installedBlock`, and the only alternative is a second copy of the render, which
    SUP-08 forbids in the same breath.

17. **`INS-04` gives the lease owner an instance field and no row says what a reaper does with it.**
    LSE-07's guard table names pid-namespace, host, grace, expiry and terminal status — not the
    instance. Without a guard the field is decorative; with one (J4.5 guard 4), a stale claim from a
    deleted checkout can only be removed by `lease-clear --force`, never by a sweep. That is INS-05
    applied correctly, and it is a behaviour the roadmap does not state anywhere.
