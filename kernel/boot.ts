// kernel/boot.ts — KRN-08, KRN-09: boot() walks a plugin graph, collects every problem it finds,
// then throws ONCE, with each line naming the plugin it came from.
//
// THE SHAPE (KRN-08). boot() builds a list of `{ plugin, check, detail }` problems as it goes. It
// never throws on the first one — it keeps checking everything, then throws one error with one
// line per problem. A boot that reports one fault per restart costs one restart per fault; that
// is the whole reason this row exists. Before the throw, problems are sorted by plugin, then by
// check, then by detail — three plain string comparisons, never localeCompare — so two runs over
// the same graph always print the same message in the same order.
//
// THE SIX CHECKS SHIPPED (KRN-09). roadmap.md §2.1 lists more checks than v0 has a real subject
// for. KRN-09's rule: ship a check only once something real needs it. These six do:
//   1. duplicate names across registries — two plugins registering the same job name.
//   2. schedule entry names a registered job — an entry's `job` field must match a real job.
//   3. job declares a model — resolves through DEFAULTS.model, then assertPinned() (HRN-11's own
//      runtime check, reused here rather than repeated).
//   4. job names a skill that resolves to a directory on disk (SKL-06, direction one).
//   5. every skill directory on disk is named by a registered job (SKL-06, direction two).
//   6. required env unset with no default — FIXTURE SUBJECT ONLY. See "ruling 7, trap one" below.
//
// WHAT IS NOT SHIPPED, AND WHY. A route needing a watcher, a watcher naming a registered job, and
// relay gating are ABSENT from this file — not stubbed, not a check that quietly always passes. No
// v0 plugin emits a source or a route yet (D9: a port designed before it has a real user gets
// designed wrong), so there is nothing for a check like that to look at. Do not add a stub for
// these; add the real check the day the first plugin ships a `sources`/`routes`/`relays` member.
// kernel/boot.test.ts test 12 gates the absence by reading this file's own bytes, and states its
// own limit: it sees THIS file only, so the same work moved one hop into a kernel module boot()
// imports would leave it green. What really holds the property is KRN-04 — the `Plugin` interface
// has no `sources`/`routes`/`relays`/`lanes` member, so no check anywhere has anything to read.
// A writer naming an unknown gate resource is also absent, but for a different reason: this is
// already checked, by `host/schedule.ts`'s `validate()` (SUP-05), over the real `SCHEDULE` and the
// real `PROGRAMS` table. boot() does not repeat that check. Split of ownership, stated plainly:
// `host/schedule.ts` owns gate-resource validation for schedule entries; `kernel/boot.ts` owns the
// six plugin-graph checks listed above.
//
// CHECK 1 IS REACHABLE, and here is the path, because the obvious objection is that
// kernel/registry.ts already throws on a duplicate AT IMPORT TIME. It does — for names passed to
// `registry.register`, which today means the two calls in `host/jobs/index.ts`. A `Plugin`
// manifest's `jobs` member is a plain `readonly Job[]` and never goes through a registry at all,
// so no registry can see a name that two manifests both list. Measured on this tree (2026-09-01):
// importing the real `host/jobs/index.ts` succeeds — the graph loads, both jobs register once —
// and boot() then reports the duplicate. The live subject arrives with `host/plugins.ts` (J10),
// which imports job objects straight from `host/jobs/*.ts`: listing one job in two manifests, or
// twice in one, is caught here and nowhere else.
//
// CHECK 4 IS WEAKER THAN `skills check`, ON PURPOSE, AND THAT IS SAFE ONLY BECAUSE OF WHERE THE
// STRONGER GATE LIVES. Both derive the same path — `<ROOT>/plugins/<job.plugin>/skills/<skillOf>`
// — but this one asks only that the DIRECTORY exist, while `cli/skills.ts` also needs a
// `SKILL.md` inside it. So an empty skill directory boots green here and fails `skills check`.
// `test/skills.test.ts` runs `check(JOBS, TREE)` over the real tree in `npm test` and owns that
// stronger read; boot() states the SKL-06 shape, and does not duplicate it.
//
// RULING 7, TRAP ONE — CRONTAB_CMD. `CRONTAB_CMD` is the one `required: true` env row in this repo
// with no default (see `cli/crontab.ts`), and `npm test` runs with it deliberately unset. It
// belongs to `cli/crontab.ts`, an operator command, never to a plugin's `env` list. If a real
// plugin manifest ever lists it, check 6 above fails on every `npm test` run. DO NOT add
// `CRONTAB_CMD` to any plugin's `env` member to "cover" this check — that is the exact mistake this
// comment exists to stop. Check 6 is real code, but at v0 only a fixture (kernel/boot.test.ts) ever
// exercises it; no real manifest should ever give it a subject.
//
// RULING 7, TRAP TWO — no import of cli/skills.ts. `cli/skills.ts` already computes the
// `plugins/<plugin>/skills/<name>/SKILL.md` path that checks 4 and 5 need, but
// `test/imports.test.ts`'s TST-03 rule 1 forbids a file under `kernel/` from importing anything
// under `cli/`. So boot() takes its own small filesystem reader as `deps` — `skillDirExists` and
// `listSkillDirs` — with a real default defined right here, and a caller (a test) can pass its own
// instead. This is NOT the directory-scan discovery SKL-05 bans. SKL-05 bans using the filesystem
// to find out WHAT to register. Here, the job already declares its own skill name in code; the
// filesystem read only CHECKS that the declared name is real. Declaring stays in code — the disk
// is only ever checked against it, never scanned to build a list.

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
 * The filesystem half of checks 4 and 5 (ruling 7, trap two — see the header above). The real
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

/** The real reader (ruling 7, trap two). Every plugin boots with this by default; a test passes
 *  its own `BootDeps` instead — kernel/boot.test.ts does, for every fixture in that file. */
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
  // runtime check).
  for (const plugin of plugins) {
    for (const job of plugin.jobs) {
      const model = job.model ?? DEFAULTS.model;
      try {
        assertPinned(model);
      } catch (e) {
        report(plugin.name, "job declares a model", `job ${JSON.stringify(job.name)}: ${errText(e)}`);
      }
    }
  }

  // 4. job names a skill that resolves to a directory on disk (SKL-06, direction one).
  for (const plugin of plugins) {
    for (const job of plugin.jobs) {
      if (job.skill === undefined) continue; // an exec-only job names no skill, by construction
      if (!deps.skillDirExists(job)) {
        report(
          plugin.name,
          "job names a skill that resolves to a directory on disk",
          `job ${JSON.stringify(job.name)} names skill ${JSON.stringify(job.skill)}, which has no directory at plugins/${job.plugin}/skills/${skillOf(job)}`,
        );
      }
    }
  }

  // 5. every skill directory on disk is named by a registered job (SKL-06, direction two).
  for (const plugin of plugins) {
    const expected = new Set(plugin.jobs.filter((j) => j.skill !== undefined).map((j) => skillOf(j)));
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

  // 6. required env unset with no default — FIXTURE SUBJECT ONLY (ruling 7, trap one). No real
  // plugin manifest should ever carry a row shaped like this; if one does, this is the line that
  // catches it.
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
