// one name, four consumers: the registry, the job
// directories (host/jobs/ for the app's own jobs, plugins/<name>/jobs/ for a plugin's), the
// schedule, and (via test/skills.test.ts, checked separately) the skill tree. This file is the
// registry/directory/schedule three; test/skills.test.ts already owns the fourth.
//
// says the LIST is what exists and the directory is only ever CHECKED against it — so
// assertion 2 below always reads `JOBS` as truth and the directory as the thing being verified,
// and the failure message says which side is which ("add the file" and "register the job" are
// different fixes).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { projectPath } from "../kernel/paths.ts";
import { stageOf, MISC, STAGES } from "../kernel/stages.ts";
import type { Job } from "../kernel/ports/job.ts";
import { JOBS } from "../host/jobs/index.ts";
import { SCHEDULE } from "../host/schedule.ts";

/** Every job directory: host/jobs/ and each plugins/<name>/jobs/ that exists. Repo-relative. */
function jobDirs(): string[] {
  const dirs = ["host/jobs"];
  for (const p of readdirSync(projectPath("plugins")).sort()) {
    if (existsSync(projectPath("plugins", p, "jobs"))) dirs.push(`plugins/${p}/jobs`);
  }
  return dirs;
}

/** Every job-directory `*.ts` file that is a JOB module — never `*.test.ts`, never
 *  `host/jobs/index.ts` (the registry itself). Repo-relative paths. */
function jobFilesOnDisk(): string[] {
  const out: string[] = [];
  for (const dir of jobDirs()) {
    for (const f of readdirSync(projectPath(dir))) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      if (dir === "host/jobs" && f === "index.ts") continue;
      out.push(`${dir}/${f}`);
    }
  }
  return out.sort();
}

/** Where a registered job's file must live: the app's own jobs (plugin `host`) in host/jobs/,
 *  every other in its own plugin's jobs/ directory. */
const expectedFile = (j: Job): string =>
  j.plugin === "host" ? `host/jobs/${j.name}.ts` : `plugins/${j.plugin}/jobs/${j.name}.ts`;

test("1. every registered job's name carries a known SUP-20 stage prefix", () => {
  const offenders = JOBS.filter((j) => stageOf(j.name) === MISC).map((j) => j.name);
  assert.deepEqual(
    offenders,
    [],
    `job name(s) with no known stage prefix: ${offenders.join(", ")} — expected one of ${STAGES.join(", ")}`,
  );
});

test("2. the registry and the job directories agree, both ways (SKL-05: the list is what exists)", () => {
  const registered = JOBS.map(expectedFile).sort();
  const onDisk = jobFilesOnDisk();

  const registeredNotOnDisk = registered.filter((f) => !onDisk.includes(f));
  assert.deepEqual(
    registeredNotOnDisk,
    [],
    `registered job(s) with no file where their plugin says — add the file: ${registeredNotOnDisk.join(", ")}`,
  );

  const onDiskNotRegistered = onDisk.filter((f) => !registered.includes(f));
  assert.deepEqual(
    onDiskNotRegistered,
    [],
    `job file(s) with no matching entry in JOBS — list the job in its manifest: ${onDiskNotRegistered.join(", ")}`,
  );
});

test("3. every registered job is default-exported by its own file, and the default export's name matches the filename", async () => {
  for (const file of jobFilesOnDisk()) {
    const base = file.slice(file.lastIndexOf("/") + 1, -".ts".length);
    const mod = (await import(join(projectPath(), file))) as { default?: { name?: string } };
    assert.ok(mod.default, `${file}: expected a default export`);
    assert.equal(
      mod.default!.name,
      base,
      `${file}: default export's name is ${JSON.stringify(mod.default!.name)}, expected ${JSON.stringify(base)} — a mismatch runs under the wrong log, the wrong gate and the wrong skill`,
    );
  }
});

test("4. every schedule entry naming a job names a registered one, and every registered job appears at most once in SCHEDULE", () => {
  const registeredNames = new Set(JOBS.map((j) => j.name));
  const unregistered = SCHEDULE.filter((e) => e.job !== undefined && !registeredNames.has(e.job)).map((e) => `${e.name} -> job ${JSON.stringify(e.job)}`);
  assert.deepEqual(unregistered, [], `schedule entry names an unregistered job: ${unregistered.join(", ")}`);

  const jobCounts = new Map<string, number>();
  for (const e of SCHEDULE) {
    if (e.job === undefined) continue;
    jobCounts.set(e.job, (jobCounts.get(e.job) ?? 0) + 1);
  }
  const duplicated = [...jobCounts.entries()].filter(([, n]) => n > 1).map(([name, n]) => `${name} (${n}x)`);
  assert.deepEqual(duplicated, [], `job(s) scheduled more than once: ${duplicated.join(", ")}`);
});

test("5. every schedule entry's own name carries a known SUP-20 stage prefix (validate() rule 2, over the real SCHEDULE)", () => {
  const offenders = SCHEDULE.filter((e) => stageOf(e.name) === MISC).map((e) => e.name);
  assert.deepEqual(
    offenders,
    [],
    `schedule entry name(s) with no known stage prefix: ${offenders.join(", ")} — expected one of ${STAGES.join(", ")}`,
  );
});
