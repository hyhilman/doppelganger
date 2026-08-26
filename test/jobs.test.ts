// J3.16 (TST-09, SUP-20, SKL-01, SKL-05) — one name, four consumers: the registry, the
// host/jobs/ directory, the schedule, and (via test/skills.test.ts, checked separately) the
// skill tree. This file is the registry/directory/schedule three; test/skills.test.ts already
// owns the fourth.
//
// SKL-05 says the LIST is what exists and the directory is only ever CHECKED against it — so
// assertion 2 below always reads `JOBS` as truth and the directory as the thing being verified,
// and the failure message says which side is which ("add the file" and "register the job" are
// different fixes).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { projectPath } from "../kernel/paths.ts";
import { stageOf, MISC, STAGES } from "../kernel/stages.ts";
import { JOBS } from "../host/jobs/index.ts";
import { SCHEDULE } from "../host/schedule.ts";

const JOBS_DIR = projectPath("host/jobs");

/** Every `host/jobs/*.ts` file that is a JOB module — never `*.test.ts`, never `index.ts` (the
 *  registry itself), matching host/jobs/index.ts's own file-header description of what the
 *  directory holds. */
function jobFilesOnDisk(): string[] {
  return readdirSync(JOBS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts")
    .sort();
}

test("1. every registered job's name carries a known SUP-20 stage prefix", () => {
  const offenders = JOBS.filter((j) => stageOf(j.name) === MISC).map((j) => j.name);
  assert.deepEqual(
    offenders,
    [],
    `job name(s) with no known stage prefix: ${offenders.join(", ")} — expected one of ${STAGES.join(", ")}`,
  );
});

test("2. the registry and the host/jobs/ directory agree, both ways (SKL-05: the list is what exists)", () => {
  const registered = JOBS.map((j) => j.name).slice().sort();
  const onDisk = jobFilesOnDisk().map((f) => f.slice(0, -".ts".length));

  const registeredNotOnDisk = registered.filter((n) => !onDisk.includes(n));
  assert.deepEqual(
    registeredNotOnDisk,
    [],
    `registered job(s) with no host/jobs/<name>.ts file — add the file: ${registeredNotOnDisk.join(", ")}`,
  );

  const onDiskNotRegistered = onDisk.filter((n) => !registered.includes(n));
  assert.deepEqual(
    onDiskNotRegistered,
    [],
    `host/jobs/*.ts file(s) with no matching entry in JOBS — register the job: ${onDiskNotRegistered.join(", ")}`,
  );
});

test("3. every registered job is default-exported by its own file, and the default export's name matches the filename", async () => {
  for (const file of jobFilesOnDisk()) {
    const base = file.slice(0, -".ts".length);
    const mod = (await import(join(JOBS_DIR, file))) as { default?: { name?: string } };
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
