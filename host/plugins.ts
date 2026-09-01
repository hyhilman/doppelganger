// host/plugins.ts — ADO-04, ruling 6: the two manifests this app registers, and the real graph
// `boot()` walks inside `npm test` (KRN-11).
//
// WHY HERE, NOT plugins/<x>/plugin.ts (ruling 6). §1 and CLAUDE.md put a plugin's manifest at
// `plugins/<name>/plugin.ts`. Not reachable tonight, for a structural reason: both real jobs are
// files under `host/jobs/`, and `plugins/ops/` does not exist at all. A `plugins/nightly/plugin.ts`
// importing `../../host/jobs/nightly-sandcastle.ts` would be a plugin naming the app — the exact
// edge `test/imports.test.ts`'s TST-03 rule 4 exists to refuse, landing the same night TST-03
// landed. This file is not a workaround: ADO-04 names it exactly ("`host/plugins.ts` carrying real
// imports and a real `boot([...])`"). Tonight ships the manifest *shape* in `kernel/` and the
// *first registration file* in the app that is supposed to have one. `plugins/<x>/plugin.ts`
// arrives with the job-file move (follow-up F2, plan's "What tonight is NOT doing").
//
// THE OWNERSHIP RULE — how `schedule:` is SELECTED from `host/schedule.ts`'s `SCHEDULE`, never
// duplicated. `SCHEDULE` stays the live list `host/supervisor.ts` reads (§1: the host owns its own
// schedule) — this file only PICKS which of its entries each manifest below answers for, so
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
// (`ops-watchdog`, JOB-O10) and a second one that nobody claims fails the partition assertion
// rather than being silently dropped.
//
// `ownerOf` is exported, and takes its job list as a parameter, so `test/boot.test.ts` can assert
// the partition directly AND pin the divergence case above with a synthetic job — the rule must
// keep working when stage and plugin differ, which no real data can show until `plugins/git`
// lands.
//
// DO NOT ADD CRONTAB_CMD TO EITHER MANIFEST'S `env` (ruling 7). It is the one `required: true` env
// row in this repo with no default, `npm test` runs with it deliberately unset, and it belongs to
// `cli/crontab.ts`, an operator CLI — never to a plugin. `kernel/boot.ts`'s header names the same
// trap for check 6; `test/boot.test.ts` asserts the exclusion here directly, with the reason in
// the assertion message, so the next person reaching for it sees why before the suite does.
//
// WHY `jobs:` IS BUILT FROM `JOBS` (`host/jobs/index.ts`'s registry), NOT A SECOND DIRECT IMPORT
// OF EACH JOB FILE — measured, not assumed, against AC2: a manifest whose `jobs:` array names a
// job file directly (`jobs: [nightlySandcastle]`, imported straight from
// `./jobs/nightly-sandcastle.ts`) is UNAFFECTED by deleting that job's `jobs.register(...)` call
// in `host/jobs/index.ts` — the array still holds the object, `boot()` still finds it, and the
// commit's whole point (a schedule entry that outlives its job's registration must fail LOUD, at
// commit time) goes unproved. Filtering the real `JOBS` list by `job.plugin === name` closes that
// gap: delete the registration and the object drops out of `JOBS`, drops out of `jobsFor(...)`,
// and `SCHEDULE`'s still-live "nightly-sandcastle" entry becomes exactly what check 2 exists to
// catch — an entry naming a job no plugin passed to `boot()` registers. `host/jobs/index.test.ts`
// test 2 already pins that `JOBS` holds the SAME objects the job files export, unwrapped and
// uncloned (`JOBS[0] === nightlySandcastle`), so this costs no identity: check 1 (KRN-08's header,
// "a Plugin manifest's jobs member … never goes through a registry at all") stays just as live —
// nothing in `kernel/registry.ts` can see a name two *manifests* both list, because a job's own
// `plugin` field can only ever satisfy one `jobsFor` filter; the collision that check 1 exists for
// is still reachable only the way `test/boot.test.ts` reaches it, by handing `boot()` a second,
// independently-built manifest that repeats a real registered job on purpose.
//
// FOLLOW-UP F1 — NOT WIRED TONIGHT. `host/supervisor.ts`'s `main()` does not call `boot()`.
// KRN-11 ships its `npm test` half here: a real fault (an unregistered job's schedule entry, a
// duplicate job across manifests, an orphan or missing skill directory) is now caught at commit
// time, in this file's own test, before it ever reaches a running supervisor. The supervisor half
// is deliberately not this commit — editing the live scheduler's boot sequence the same night the
// container went up trades a known-good loop for a marginal gain. F1 is one later commit: call
// `boot(PLUGINS)` after SUP-15's `reapOnBoot` and before the first timer registers.

import type { Plugin } from "../kernel/plugin.ts";
import { definePlugin } from "../kernel/plugin.ts";
import type { Job } from "../kernel/ports/job.ts";
import { SCHEDULE, type ScheduleEntry } from "./schedule.ts";
import { JOBS } from "./jobs/index.ts";
import {
  NIGHTLY_NO_SANDCASTLE_ENV,
  NIGHTLY_SANDCASTLE_BASE_ENV,
  NIGHTLY_SANDCASTLE_DRY_RUN_ENV,
  NIGHTLY_SANDCASTLE_NO_MERGE_ENV,
  NIGHTLY_SANDCASTLE_MAX_ENV,
  NIGHTLY_SANDCASTLE_ONLY_ENV,
  NIGHTLY_SANDCASTLE_MODEL_ENV,
} from "./jobs/nightly-sandcastle.ts";

/** The owner of every `script:` entry, written down once because a script has no job to ask. One
 *  member today: `ops-watchdog` (JOB-O10). A script entry missing from here is `UNCLAIMED`, which
 *  fails `test/boot.test.ts`'s partition assertion rather than disappearing quietly. */
const SCRIPT_OWNERS: Readonly<Record<string, string>> = {
  "host/watchdog.sh": "ops",
};

/** What `ownerOf` returns for an entry no plugin owns. Deliberately not a plugin name, so the
 *  partition assertion reports it instead of handing the entry to whoever sorts first. */
export const UNCLAIMED = "unclaimed";

/** The ownership rule stated above: a `job:` entry belongs to the plugin its job DECLARES, and a
 *  `script:` entry to the one `SCRIPT_OWNERS` names. `jobs` defaults to the real registry and is a
 *  parameter only so a test can pin the case where a job's stage and its plugin differ. */
export const ownerOf = (entry: ScheduleEntry, jobs: readonly Job[] = JOBS): string => {
  if (entry.job !== undefined) {
    return jobs.find((j) => j.name === entry.job)?.plugin ?? UNCLAIMED;
  }
  return SCRIPT_OWNERS[entry.script ?? ""] ?? UNCLAIMED;
};

/** Every `SCHEDULE` entry `ownerOf` assigns to `pluginName` — never a second copy of `SCHEDULE`
 *  itself, only a filtered view of it. */
const scheduleFor = (pluginName: string): readonly ScheduleEntry[] =>
  SCHEDULE.filter((e) => ownerOf(e) === pluginName);

/** Every real, registered `JOBS` entry (`host/jobs/index.ts`) whose own `plugin` field names
 *  `pluginName` — see the header for why this reads `JOBS`, never a second direct import of each
 *  job file. */
const jobsFor = (pluginName: string): readonly Job[] => JOBS.filter((j) => j.plugin === pluginName);

/** The two manifests this app registers (ADO-04). `boot(PLUGINS)` runs over this exact graph
 *  inside `npm test` — `test/boot.test.ts` (KRN-11). */
export const PLUGINS: readonly Plugin[] = [
  definePlugin({
    name: "nightly",
    kill: [NIGHTLY_NO_SANDCASTLE_ENV],
    jobs: jobsFor("nightly"),
    schedule: scheduleFor("nightly"),
    env: [
      NIGHTLY_SANDCASTLE_BASE_ENV,
      NIGHTLY_SANDCASTLE_DRY_RUN_ENV,
      NIGHTLY_SANDCASTLE_NO_MERGE_ENV,
      NIGHTLY_SANDCASTLE_MAX_ENV,
      NIGHTLY_SANDCASTLE_ONLY_ENV,
      NIGHTLY_SANDCASTLE_MODEL_ENV,
    ],
  }),
  definePlugin({
    name: "ops",
    kill: [],
    jobs: jobsFor("ops"),
    schedule: scheduleFor("ops"),
    env: [],
  }),
];
