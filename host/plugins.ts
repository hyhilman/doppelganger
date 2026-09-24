// host/plugins.ts — ADO-04: the manifests this app registers, and the real graph `boot()` walks
// inside `npm test` (KRN-11) and at every supervisor boot.
//
// Each plugin's manifest lives at `plugins/<name>/plugin.ts` and is imported here. The host has
// one manifest of its own, `host`, for the jobs and scripts only the app can own: `ops-cron-check`
// needs `cli/crontab.ts` and `host/schedule.ts`, which a plugin may not import (TST-03).
//
// THE OWNERSHIP RULE — how `schedule:` is SELECTED from `host/schedule.ts`'s `SCHEDULE`, never
// duplicated. A plugin's own manifest ships `schedule: []`; `PLUGINS` below fills it in. `SCHEDULE` stays the live list `host/supervisor.ts` reads — the host owns its own
// schedule — this file only PICKS which of its entries each manifest below answers for, so
// `boot()` validates the entries that actually fire, and there is exactly one place a tick is
// read from either way.
//
// A STAGE PREFIX IS NOT AN OWNER, AND THE NEXT JOB FAMILY IN THIS PHASE PROVES IT. The obvious
// rule is `ownerOf(entry) = stageOf(entry.name)` (`kernel/stages.ts`, SUP-20): every entry name
// carries a known stage — `host/schedule.ts`'s `validate()` rule 2 refuses one that does not — and
// it needs no lookup, so it claims a `job:` entry and a `script:` entry the same way. It also
// passes today, because this repo's two v0 plugins happen to be named identically to the one stage
// each owns. That is a coincidence, not a law, and N5 breaks it: `plugins/git` contributes
// JOB-G01…14, whose jobs are named `ops-reset-branches`, `ops-ensure-env-worktrees` and
// `ops-reset-env-to-main` — stage `ops`, plugin `git`. Under the stage rule the `ops` manifest
// would claim `git`'s schedule entries, and a partition that is wrong is worse than none, because
// `boot()` would then validate every entry against the wrong plugin's jobs.
//
// So ownership is DECLARED, never inferred from a name. A `job:` entry belongs to the plugin its
// job's own `plugin` field names — the same single field `jobsFor` reads below, so a plugin's
// `jobs` and its `schedule` cannot disagree about who owns what. A `script:` entry has no job to
// ask, so its owner is written down once in `SCRIPT_OWNERS`; there is exactly one such entry
// (`ops-watchdog`, JOB-O10, owned by `host`) and a second one that nobody claims fails the
// partition assertion rather than being silently dropped.
//
// `ownerOf` is exported, and takes its job list as a parameter, so `test/boot.test.ts` can assert
// the partition directly AND pin the divergence case above with a synthetic job — the rule must
// keep working when stage and plugin differ, which no real data can show until `plugins/git`
// lands.
//
// DO NOT ADD CRONTAB_CMD TO ANY MANIFEST'S `env`. It is the one `required: true` env
// row in this repo with no default, `npm test` runs with it deliberately unset, and it belongs to
// `cli/crontab.ts`, an operator CLI — never to a plugin. `kernel/boot.ts`'s header names the same
// trap for check 6; `test/boot.test.ts` asserts the exclusion here directly, with the reason in
// the assertion message, so the next person reaching for it sees why before the suite does.
//
import type { Plugin } from "../kernel/plugin.ts";
import { definePlugin } from "../kernel/plugin.ts";
import type { Job } from "../kernel/ports/job.ts";
import { SCHEDULE, type ScheduleEntry } from "./schedule.ts";
import nightly from "../plugins/nightly/plugin.ts";
import ops from "../plugins/ops/plugin.ts";
import git from "../plugins/git/plugin.ts";
import opsCronCheck from "./jobs/ops-cron-check.ts";
import {
  WATCHDOG_SUPERVISOR_STALE_M_ENV,
  WATCHDOG_DRY_RUN_ENV,
  NTFY_URL_ENV,
  NTFY_TOPIC_ENV,
  NTFY_TOKEN_ENV,
  WATCHDOG_NO_NOTIFY_ENV,
} from "./config.ts";

/** The app's own manifest: jobs and scripts that need the app itself (see the header). It owns
 *  `ops-watchdog` (SCRIPT_OWNERS below), so the watchdog's knobs are its rows (KRN-06). */
export const HOST: Plugin = definePlugin({
  name: "host",
  kill: [WATCHDOG_NO_NOTIFY_ENV],
  jobs: [opsCronCheck],
  schedule: [],
  // CRONTAB_CMD, which ops-cron-check reads, stays off: see the header.
  env: [
    WATCHDOG_SUPERVISOR_STALE_M_ENV,
    WATCHDOG_DRY_RUN_ENV,
    NTFY_URL_ENV,
    NTFY_TOPIC_ENV,
    NTFY_TOKEN_ENV,
  ],
});

/** Every manifest this app registers, in registration order, before the host binds each one's
 *  schedule. `host/jobs/index.ts` builds `JOBS` from exactly this list. */
export const MANIFESTS: readonly Plugin[] = [nightly, ops, git, HOST];

/** The owner of every `script:` entry, written down once because a script has no job to ask. One
 *  member today: `ops-watchdog` (JOB-O10). A script entry missing from here is `UNCLAIMED`, which
 *  fails `test/boot.test.ts`'s partition assertion rather than disappearing quietly. */
const SCRIPT_OWNERS: Readonly<Record<string, string>> = {
  "host/watchdog.sh": "host",
};

/** What `ownerOf` returns for an entry no plugin owns. Deliberately not a plugin name, so the
 *  partition assertion reports it instead of handing the entry to whoever sorts first. */
export const UNCLAIMED = "unclaimed";

/** Every job every manifest lists. Read here, not from `JOBS`, because `host/jobs/index.ts`
 *  imports this file. */
const ALL_JOBS: readonly Job[] = MANIFESTS.flatMap((p) => p.jobs);

/** The ownership rule stated above: a `job:` entry belongs to the plugin its job DECLARES, and a
 *  `script:` entry to the one `SCRIPT_OWNERS` names. `jobs` is a parameter only so a test can pin
 *  the case where a job's stage and its plugin differ. */
export const ownerOf = (entry: ScheduleEntry, jobs: readonly Job[] = ALL_JOBS): string => {
  if (entry.job !== undefined) {
    return jobs.find((j) => j.name === entry.job)?.plugin ?? UNCLAIMED;
  }
  return SCRIPT_OWNERS[entry.script ?? ""] ?? UNCLAIMED;
};

/** Every `SCHEDULE` entry `ownerOf` assigns to `pluginName` — never a second copy of `SCHEDULE`
 *  itself, only a filtered view of it. */
const scheduleFor = (pluginName: string): readonly ScheduleEntry[] =>
  SCHEDULE.filter((e) => ownerOf(e) === pluginName);

/** The manifests with their schedule bound. `boot(PLUGINS)` runs over this exact graph inside
 *  `npm test` (test/boot.test.ts, KRN-11) and in `host/supervisor.ts`'s boot. */
export const PLUGINS: readonly Plugin[] = MANIFESTS.map((p) => ({ ...p, schedule: scheduleFor(p.name) }));
