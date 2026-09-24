// KRN-04/05/07 — the Plugin manifest, definePlugin, and the kill switch helpers.
//
// KRN-04: the manifest ships EXACTLY FIVE members — `name`, `kill`, `jobs`, `schedule`, `env`.
// `sources`, `routes`, `relays` and `lanes` are ABSENT, not optional (D9): an optional member is
// a designed member with a `?` typed onto it, and a port designed against no consumer gets
// designed wrong. `sources`/`routes`/`relays` come back with the first plugin that declares a
// source and a route the switch can assign (`plugins/jira/`); `lanes` comes back with retro.
// Widening this interface ahead of either landing is the D9 failure mode this file exists to
// refuse.
//
// KRN-05: `definePlugin` is identity. Its only job is making a type error at a plugin's own
// literal name the plugin, not the registry that later consumes it — the same reason
// `kernel/ports/job.ts`'s `defineJob` exists.
//
// The `EnvSpec` RE-EXPORT below is not incidental. `test/imports.test.ts`'s TST-03 rule 3 lets a
// file under `plugins/` name `kernel/ports/*` and `kernel/plugin.ts`, and nothing else under
// `kernel/` — a manifest's `env` member is `EnvSpec[]`, defined one file PAST `ports/`, in
// `kernel/config.ts`. Widening the allowlist to `config.ts` directly would also hand a plugin
// `parentEnv()`, the one function in this repo that reads the process environment directly.
// Re-exporting the type only, from the file every plugin already imports, closes the gap without
// widening it.
//
// KRN-07: `killSwitch(plugin, feature, why)` builds one `EnvSpec` row, key `<PLUGIN>_NO_<FEATURE>`,
// `default: "0"`. `isKilled(spec)` reads it: `"1"` -> killed, `"0"` or unset or `""` (envStr's own
// fallback to `default`) -> not killed, and ANYTHING ELSE THROWS, naming the key and the value
// seen. That is a real behaviour change from the call site it replaces (`envStr(SPEC) === "1"`),
// which read `NIGHTLY_NO_SANDCASTLE=true` as *not killed*.
//
// WHY A THROW, AND NOT "ANY NON-`0` VALUE MEANS KILLED". KRN-07 says a kill switch degrades
// toward the safest verdict, but on the axis that rule cares about — does an unattended agent run
// when it must not — the two candidates agree on every value: `"1"` kills both ways, `"0"`/unset
// run both ways, and a garbage value runs under NEITHER. So "safest verdict" alone does not decide
// it. What decides it is the operator who typed the bad value: `.env.example` ships the line
// commented out as `NIGHTLY_NO_SANDCASTLE=0`, so someone who uncomments it and writes a WORD
// (`false`, `off`, a trailing space) is as likely to be turning the switch OFF as ON. Reading every
// non-`0` as killed would stop that person's nightly loop silently, at `level=info`; nothing else
// watches per-job delivery, so the loop would die quietly. The throw stops the same pass but says
// so at `level=error`, naming the key and the value.
//
// THE CONDITION THAT FLIPS THIS, so the next person can check it rather than re-argue it: if this
// repo ever gains a breaker that disables a job after N failures, or a manifest's `kill` rows are
// ever read at `boot()`, then one bad value costs more than one tick and "non-`0` is killed"
// becomes the safer read. Neither exists today.
//
// `isKilled` has two subjects, both in plugin `nightly`: `NIGHTLY_NO_SANDCASTLE` and
// `NIGHTLY_NO_POLISH`. Only `NIGHTLY_NO_POLISH` is built with `killSwitch`; the sandcastle row is
// still written out by hand. test/knobs.test.ts reads a killSwitch call (plugin and feature names)
// as the row's key, so a built row is scanned like a literal one. `WATCHDOG_NO_NOTIFY` is a kill
// switch too, but a bash-read one, so it cannot call `isKilled`. `NIGHTLY_SANDCASTLE_NO_MERGE`
// and `NIGHTLY_POLISH_NO_MERGE` look similar and are NOT subjects — they are SAF-02 shadow modes
// ("commit inside the worktree, never move the base branch"), never switches that stop a pass
// outright. Do not widen `killSwitch`/`isKilled` to cover them; that is the same D9 mistake
// KRN-04's five members refuse above.

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
