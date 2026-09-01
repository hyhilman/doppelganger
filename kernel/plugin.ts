// KRN-04/05/07 — the Plugin manifest, definePlugin, and the one kill switch this repo has a
// subject for.
//
// KRN-04: the manifest ships EXACTLY FIVE members — `name`, `kill`, `jobs`, `schedule`, `env`.
// `sources`, `routes`, `relays` and `lanes` are ABSENT, not optional (D9): an optional member is
// a designed member with a `?` typed onto it, and a port designed against no consumer gets
// designed wrong. Each comes back with the plugin that needs it, not before:
//   - `sources` and `routes` — M5, `plugins/jira/` as the reference plugin (PIP-*): the first
//     manifest to declare a source and a route the switch can assign.
//   - `relays` — M5, the same `plugins/jira/` row: "source + relay + route + watcher + jobs +
//     schedule + env, one file answering 'what does Jira contribute'".
//   - `lanes` — M10, retro (JOB-R*: "retro (lanes, tiers, snapshot, render, threads, backfill)").
// Widening this interface ahead of any of those four landing is the D9 failure mode this file
// exists to refuse.
//
// KRN-05: `definePlugin` is identity. Its only job is making a type error at a plugin's own
// literal name the plugin, not the registry that later consumes it — the same reason
// `kernel/ports/job.ts`'s `defineJob` exists.
//
// The `EnvSpec` RE-EXPORT below is not incidental. `test/imports.test.ts`'s TST-03 rule 3 lets a
// file under `plugins/` name `kernel/ports/*` and `kernel/plugin.ts`, and nothing else under
// `kernel/` — a manifest's `env` member is `EnvSpec[]`, and that type is defined one file PAST
// `ports/`, in `kernel/config.ts`. Widening the allowlist to `config.ts` directly would also hand
// a plugin `parentEnv()` and the one file in this repo that reads the process environment
// directly. Re-exporting the
// TYPE only, from the one file every plugin already imports to declare itself, closes the gap
// without widening it.
//
// KRN-07: `killSwitch(plugin, feature, why)` builds one `EnvSpec` row, key `<PLUGIN>_NO_<FEATURE>`,
// `default: "0"`. `isKilled(spec)` reads it: `"1"` -> killed, `"0"` or unset or `""` (envStr's own
// fallback to `default`) -> not killed, and ANYTHING ELSE THROWS, naming the key and the value
// seen. That is a real behaviour change from the call site it replaces (`envStr(SPEC) === "1"`),
// which read `NIGHTLY_NO_SANDCASTLE=true` as *not killed*.
//
// WHY A THROW IS THE SAFEST VERDICT HERE, AND NOT MERELY THE LOUDEST. KRN-07 says a kill switch
// degrades toward the safest verdict, and a throw is not a verdict at all, so the rule does not
// settle this by its wording. The other candidate is "any value that is not `0` means killed" —
// the operator who typo'd wanted the pass stopped, and stopping costs nothing. The choice was made
// by tracing the live path instead, measured on this tree (2026-09-01):
//
//   - WHERE THE SWITCH SITS. A tick spawns `host/run.ts nightly-sandcastle`; `runNamed` acquires
//     the hour lease FIRST (`withLease("job", "<name>@<UTC hour>")`) and only then calls
//     `execPass`, whose step 1 is this read. So the lease is already held, and the worktree
//     (step 7) and the runner (step 10) are not yet touched.
//   - WHAT THE THROW LEAVES. `withLease` catches, settles the claim `failed` — `expires_at` moves
//     to now, so the key is immediately retryable and still bounded by `maxAttempts` — and
//     rethrows. Measured row: status `failed`, attempt 1 of a max of 3, and an `expiresAt` equal
//     to its own `claimedAt`. `runNamed`'s catch rethrows too (the message is not an `isLimitError`), so no quota wall
//     opens and the breaker records nothing. No worktree is prepped. The child exits 1, and
//     `spawnChild`'s `finally` releases the gate and the self-lock on ANY exit code. Nothing is
//     stranded and nothing is held.
//   - WHAT THE OPERATOR SEES. `causeOf` distils the child's stderr to exactly
//     `Error: NIGHTLY_NO_SANDCASTLE: kill switch must read "0" or "1", got "true" — …`, which the
//     supervisor writes as the `msg=` of one `level=error event=job-failed` line. Measured by
//     feeding the real stderr through `kernel/runtime/log/cause.ts`, not assumed.
//   - THE COMPARISON. On EVERY value the two readings agree about whether the pass runs: `"1"`
//     kills both ways, `"0"`/unset/`""` run both ways, and a garbage value runs under NEITHER. The
//     throw never lets through a pass that "non-`0` is killed" would have stopped, so on the axis
//     KRN-07 exists for — does an unattended agent that commits to this repo run when it must not
//     — the two are identical and "safest verdict" does not separate them.
//   - WHAT DOES SEPARATE THEM. The operator who typed the bad value. `.env.example` ships the line
//     commented out as `NIGHTLY_NO_SANDCASTLE=0`, so someone who uncomments it and writes a WORD
//     (`false`, `off`, or `0 ` with a trailing space) is as likely to be turning the switch OFF as
//     ON. Reading every non-`0` as killed stops that person's nightly loop and says so only at
//     `level=info event=killed`; `host/watchdog.sh` probes the supervisor heartbeat, not per-job
//     delivery, so nothing else notices and the loop dies quietly. The throw stops the same pass
//     and says so at `level=error` with the key and the value in the message. Its whole cost is
//     one error line per firing (six a night on `38 16-21 * * *`) until `.env` is fixed.
//   - THE CONDITION THAT FLIPS THIS, so the next person can check it rather than re-argue it: if
//     this repo ever gains a breaker that disables a job after N `job-failed`s, or if a manifest's
//     `kill` rows are ever READ at `boot()` (KRN-11 runs `boot()` inside `npm test`), then one bad
//     value costs more than one tick and "non-`0` is killed" becomes the safer read. Neither
//     exists today: `job-failed` has no consumer but the log, and no `boot()` check calls
//     `isKilled`.
//
// The throw also matches the house rule `envNum` already set (kernel/config.ts:
// `LOG_MAX_BYTES=8MB` throws rather than silently defaulting) — read before citing, not assumed.
// The difference the objection raises is real and does not change the answer: `envNum` governs a
// number with no safe direction, while a kill switch has one. Here BOTH directions stop the pass,
// so the safe direction is already taken by either choice and only findability is left to decide.
//
// The repo has EXACTLY ONE subject for this helper: `NIGHTLY_NO_SANDCASTLE` (plugin `nightly`,
// feature `sandcastle`). `NIGHTLY_SANDCASTLE_NO_MERGE` looks similar and is NOT one — it is
// job-prefixed, not plugin+feature, and it is a SAF-02 shadow mode ("commit inside the worktree,
// never move the base branch"), never a switch that stops the pass outright. Do not widen
// `killSwitch`/`isKilled` to cover it; a one-subject helper generalised ahead of a second subject
// is the same D9 mistake KRN-04's five members refuse above.

import { envStr, type EnvSpec } from "./config.ts";
import type { Job } from "./ports/job.ts";
import type { ScheduleEntry } from "./ports/schedule.ts";

export type { EnvSpec };

/** KRN-04 — five members, and no more. See the module header for why the other four are absent
 *  rather than optional, and which roadmap row brings each back. */
export interface Plugin {
  readonly name: string;
  readonly kill: readonly EnvSpec[];
  readonly jobs: readonly Job[];
  readonly schedule: readonly ScheduleEntry[];
  readonly env: readonly EnvSpec[];
}

/** KRN-05 — identity, so a shape error at a plugin's own literal names the plugin, not whatever
 *  registry consumes it later. */
export function definePlugin(p: Plugin): Plugin {
  return p;
}

/** KRN-07 — one `<PLUGIN>_NO_<FEATURE>` row, `default: "0"`. `plugin`/`feature` are the bare,
 *  lowercase names; this uppercases them into the key. */
export function killSwitch(plugin: string, feature: string, why: string): EnvSpec {
  return {
    key: `${plugin.toUpperCase()}_NO_${feature.toUpperCase()}`,
    default: "0",
    why,
  };
}

/** KRN-07's safest-verdict read. See the module header: `"1"` kills, `"0"`/unset does not,
 *  anything else throws rather than guesses. */
export function isKilled(spec: EnvSpec): boolean {
  const v = envStr(spec);
  if (v === "1") return true;
  if (v === "0") return false;
  throw new Error(
    `${spec.key}: kill switch must read "0" or "1", got ${JSON.stringify(v)} — ` +
      `refusing to guess which one was meant (KRN-07)`,
  );
}
