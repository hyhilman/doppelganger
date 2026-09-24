// kernel/boot.ts — KRN-08, KRN-09: boot() walks a plugin graph, collects every problem it finds,
// then throws ONCE, with each line naming the plugin it came from.
//
// THE SHAPE (KRN-08). boot() builds a list of `{ plugin, check, detail }` problems as it goes,
// never throwing on the first one, so a boot that would otherwise report one fault per restart
// reports all of them at once. Problems are sorted by plugin, then check, then detail — three
// plain string comparisons, never localeCompare — so the same graph always prints in the same
// order regardless of OS locale.
//
// THE SIX CHECKS SHIPPED (KRN-09) — ship a check only once something real needs it:
//   1. duplicate names across registries — two plugins registering the same job name.
//   2. schedule entry names a registered job — an entry's `job` field must match a real job.
//   3. job declares a model — resolves through DEFAULTS.model, then assertPinned() (HRN-11's own
//      runtime check, reused here rather than repeated).
//   4. job names a skill that resolves to a directory on disk (SKL-06, direction one).
//   5. every skill directory on disk is named by a registered job (SKL-06, direction two).
//   6. required env unset with no default — fixture subject only, see CRONTAB_CMD below.
//
// WHAT IS NOT SHIPPED, AND WHY. A route needing a watcher, a watcher naming a registered job, and
// relay gating are ABSENT — not stubbed. No v0 plugin emits a source or a route yet (D9: a port
// designed before it has a real user gets designed wrong), so there is nothing for a check like
// that to read: the `Plugin` interface (KRN-04) has no `sources`/`routes`/`relays`/`lanes` member.
// Add the real check the day the first plugin ships one of those members. A writer naming an
// unknown gate resource is also absent, but for a different reason: `host/schedule.ts`'s
// `validate()` (SUP-05) already checks that, over the real `SCHEDULE` and `PROGRAMS`. boot() owns
// the six plugin-graph checks above; `host/schedule.ts` owns gate-resource validation.
//
// CHECK 1 IS REACHABLE even though kernel/registry.ts already throws on a duplicate AT IMPORT
// TIME — that guards `registry.register` calls only (today, the two in `host/jobs/index.ts`). A
// `Plugin` manifest's `jobs` member is a plain `readonly Job[]` that never goes through a
// registry, so no registry can see a name that two manifests both list; `host/plugins.ts` imports
// job objects straight from `host/jobs/*.ts`, so a copy-paste that lists one job in two manifests,
// or twice in one, is caught here and nowhere else.
//
// CHECK 4 IS WEAKER THAN `skills check`, ON PURPOSE, AND THAT IS SAFE ONLY BECAUSE OF WHERE THE
// STRONGER GATE LIVES. Both derive the same path — `<ROOT>/plugins/<job.plugin>/skills/<skillOf>`
// — but this one asks only that the DIRECTORY exist, while `cli/skills.ts` also needs a `SKILL.md`
// inside it. `test/skills.test.ts` owns that stronger read; boot() states the SKL-06 shape only.
//
// CRONTAB_CMD IS A TRAP FOR CHECK 6. It is the one `required: true` env row in this repo with no
// default (see `cli/crontab.ts`), and `npm test` runs with it deliberately unset. It belongs to
// `cli/crontab.ts`, an operator command, never to a plugin's `env` list — if a real manifest ever
// lists it, check 6 fails on every `npm test` run. DO NOT add it to a plugin's `env` to "cover"
// this check; only a fixture (kernel/boot.test.ts) should ever give it a subject.
//
// NO IMPORT OF cli/skills.ts. `cli/skills.ts` already computes the
// `plugins/<plugin>/skills/<name>/SKILL.md` path checks 4 and 5 need, but `test/imports.test.ts`'s
// TST-03 rule 1 forbids a file under `kernel/` from importing anything under `cli/`. So boot()
// takes its own small filesystem reader as `deps` — `skillDirExists` and `listSkillDirs` — with a
// real default here, and a test passes its own instead. This is not the directory-scan discovery
// SKL-05 bans: the job already declares its own skill name in code, and the filesystem read only
// checks that the declared name is real. Declaring stays in code; the disk is only ever checked.

import { existsSync, readdirSync, statSync } from "node:fs";
import { projectPath } from "./paths.ts";
import { assertPinned, DEFAULTS, skillOf, type Job } from "./ports/job.ts";
import type { Plugin } from "./plugin.ts";
import { envStr, errText } from "./config.ts";

/** One problem boot() found, always attributed to the plugin it came from (KRN-08). */
export interface Problem {
  readonly plugin: string;
  readonly check: string;
  readonly detail: string;
}

/**
 * The filesystem half of checks 4 and 5 — see "NO IMPORT OF cli/skills.ts" above. The real
 * default reads the disk under `plugins/<plugin>/skills/`; a test passes its own fake instead, so
 * no test in this repo touches a real directory to prove these checks work.
 */
export interface BootDeps {
  /** Does `plugins/<job.plugin>/skills/<name>/` exist as a real directory? */
  readonly skillDirExists: (job: Job) => boolean;
  /** The directory names directly under `plugins/<pluginName>/skills/` — `[]` if that path is not
   *  a directory at all. */
  readonly listSkillDirs: (pluginName: string) => readonly string[];
}

function defaultSkillDirExists(job: Job): boolean {
  const dir = projectPath("plugins", job.plugin, "skills", skillOf(job));
  return existsSync(dir) && statSync(dir).isDirectory();
}

function defaultListSkillDirs(pluginName: string): readonly string[] {
  const dir = projectPath("plugins", pluginName, "skills");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/** The real reader. Every plugin boots with this by default; a test passes its own `BootDeps`
 *  instead — kernel/boot.test.ts does, for every fixture in that file. */
export const DEFAULT_BOOT_DEPS: BootDeps = {
  skillDirExists: defaultSkillDirExists,
  listSkillDirs: defaultListSkillDirs,
};

/** Plain string compare — never localeCompare, so the sort order cannot change with the OS
 *  locale. This is what makes KRN-08's "stable across runs" claim true. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * KRN-08/09. Walks every plugin, runs the six checks named in the header, and throws ONCE if
 * anything is wrong — never on the first problem found. `deps` defaults to the real filesystem
 * reader; pass your own for a test.
 */
export function boot(plugins: readonly Plugin[], deps: BootDeps = DEFAULT_BOOT_DEPS): void {
  const problems: Problem[] = [];
  const report = (plugin: string, check: string, detail: string): void => {
    problems.push({ plugin, check, detail });
  };

  // 1. duplicate names across registries (jobs only — KRN-03: no other registry has a member at
  // v0, so there is nothing else here to check for a duplicate against).
  const jobsByName = new Map<string, { readonly job: Job; readonly plugin: string }>();
  for (const plugin of plugins) {
    for (const job of plugin.jobs) {
      const already = jobsByName.get(job.name);
      if (already !== undefined) {
        report(
          plugin.name,
          "duplicate names across registries",
          `job name ${JSON.stringify(job.name)} is already registered by plugin ${JSON.stringify(already.plugin)}`,
        );
        continue; // keep the first registration as the one every other check below looks up
      }
      jobsByName.set(job.name, { job, plugin: plugin.name });
    }
  }

  // 2. schedule entry names a registered job.
  for (const plugin of plugins) {
    for (const entry of plugin.schedule) {
      if (entry.job !== undefined && !jobsByName.has(entry.job)) {
        report(
          plugin.name,
          "schedule entry names a registered job",
          `schedule entry ${JSON.stringify(entry.name)} names job ${JSON.stringify(entry.job)}, which no plugin passed to boot() registers`,
        );
      }
    }
  }

  // 3. job declares a model — resolves through DEFAULTS.model, then assertPinned (HRN-11's own
  // runtime check). Reads the de-duplicated map from check 1, so a job listed under two manifests
  // (or twice in one) gets one line here, attributed to the plugin that registered it first.
  for (const { job, plugin } of jobsByName.values()) {
    const model = job.model ?? DEFAULTS.model;
    try {
      assertPinned(model);
    } catch (e) {
      report(plugin, "job declares a model", `job ${JSON.stringify(job.name)}: ${errText(e)}`);
    }
  }

  // 4. job names a skill that resolves to a directory on disk (SKL-06, direction one). Same
  // de-duplicated map as check 3, same reason.
  for (const { job, plugin } of jobsByName.values()) {
    if (job.skill === undefined) continue; // an exec-only job names no skill, by construction
    if (!deps.skillDirExists(job)) {
      report(
        plugin,
        "job names a skill that resolves to a directory on disk",
        `job ${JSON.stringify(job.name)} names skill ${JSON.stringify(job.skill)}, which has no directory at plugins/${job.plugin}/skills/${skillOf(job)}`,
      );
    }
  }

  // 5. every skill directory on disk is named by a registered job (SKL-06, direction two).
  // "Named by" means job.plugin — the same field that picks the skill's real path in check 4 —
  // not which manifest happens to list the job: a manifest can list a job whose own `plugin` field
  // names a different plugin. So the expected set for directory plugins/<P>/skills is every
  // de-duplicated job (from every manifest passed to boot()) whose `job.plugin === P`, not just
  // the jobs the manifest named P happens to list.
  const skillsByJobPlugin = new Map<string, Set<string>>();
  for (const { job } of jobsByName.values()) {
    if (job.skill === undefined) continue;
    const set = skillsByJobPlugin.get(job.plugin) ?? new Set<string>();
    set.add(skillOf(job));
    skillsByJobPlugin.set(job.plugin, set);
  }
  for (const plugin of plugins) {
    const expected = skillsByJobPlugin.get(plugin.name) ?? new Set<string>();
    for (const dirName of deps.listSkillDirs(plugin.name)) {
      if (!expected.has(dirName)) {
        report(
          plugin.name,
          "every skill directory on disk is named by a registered job",
          `plugins/${plugin.name}/skills/${dirName} exists on disk, but no job registered by plugin ${JSON.stringify(plugin.name)} names skill ${JSON.stringify(dirName)}`,
        );
      }
    }
  }

  // 6. required env unset with no default — fixture subject only. No real plugin manifest should
  // ever carry a row shaped like this; if one does, this is the line that catches it.
  for (const plugin of plugins) {
    for (const row of plugin.env) {
      if (row.required === true && row.default === undefined) {
        try {
          envStr(row);
        } catch (e) {
          report(plugin.name, "required env unset with no default", errText(e));
        }
      }
    }
  }

  if (problems.length === 0) return;

  problems.sort((a, b) => cmp(a.plugin, b.plugin) || cmp(a.check, b.check) || cmp(a.detail, b.detail));
  const lines = problems.map((p) => `plugin ${JSON.stringify(p.plugin)} [${p.check}]: ${p.detail}`);
  throw new Error(
    `boot() found ${problems.length} problem(s) (KRN-08 — one throw, one line each):\n  - ${lines.join("\n  - ")}`,
  );
}
