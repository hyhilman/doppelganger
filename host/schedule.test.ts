// J2.7 (SUP-01, SUP-02, SUP-04, SUP-09, GAT-07) — the schedule shapes and the empty registries.
//
// `entry()` and `program()` are the fixture builders every later N2 test (J2.9, J2.11, J2.13,
// J2.14, J2.17) imports from THIS file rather than from host/schedule.ts — a fixture builder in a
// production module is a shape nothing ships using.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCHEDULE,
  PROGRAMS,
  programOf,
  supervisedEntries,
  bootstrapEntries,
  commandOf,
  type ScheduleEntry,
  type Program,
} from "./schedule.ts";

export function entry(over: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    name: "probe",
    cron: "* * * * *",
    log: "log/probe.log",
    job: "probe",
    why: "fixture entry for tests",
    ...over,
  };
}

export function program(over: Partial<Program> = {}): Program {
  return {
    self: true,
    gate: "excl",
    dotenv: false,
    ...over,
  };
}

test("1. the schedule is empty at N2 by decision — the first entry needs a job (N3) or the watchdog script (N4)", () => {
  assert.deepEqual(SCHEDULE, []);
  assert.deepEqual(PROGRAMS, {});
});

test("2. programOf prefers job, then script, then name", () => {
  assert.equal(programOf(entry({ job: "j1", script: undefined })), "j1");
  assert.equal(programOf(entry({ job: undefined, script: "s1.sh" })), "s1.sh");
  assert.equal(programOf(entry({ job: undefined, script: undefined, name: "bare" })), "bare");
  // Both set: programOf returns job. validate() (J2.9) refuses the entry separately — this test
  // says which layer owns which.
  assert.equal(programOf(entry({ job: "j1", script: "s1.sh" })), "j1");
});

test("3. supervisedEntries / bootstrapEntries partition a five-entry fixture", () => {
  const fixture = [
    entry({ name: "a" }),
    entry({ name: "b", supervised: false }),
    entry({ name: "c" }),
    entry({ name: "d", supervised: false }),
    entry({ name: "e" }),
  ];
  const supervised = supervisedEntries(fixture);
  const bootstrap = bootstrapEntries(fixture);
  assert.deepEqual(supervised.map((e) => e.name), ["a", "c", "e"]);
  assert.deepEqual(bootstrap.map((e) => e.name), ["b", "d"]);
  assert.equal(supervised.length + bootstrap.length, fixture.length);
});

test("4. the fixture builders are deterministic", () => {
  assert.deepEqual(entry(), entry());
  assert.deepEqual(program(), program());
});

test("5. commandOf for a job: entry names host/run.ts, not host/jobs/<job>.ts (J3.14 ruling 3)", () => {
  const cmd = commandOf(entry({ job: "probe", script: undefined }));
  assert.match(cmd, /\bhost\/run\.ts probe\b/);
  assert.ok(!cmd.includes("host/jobs/probe.ts"));
});

test("6. commandOf for a script: entry is unchanged", () => {
  const cmd = commandOf(entry({ job: undefined, script: "host/ops-probe.sh" }));
  assert.match(cmd, /\bhost\/ops-probe\.sh\b/);
  assert.ok(!cmd.includes("host/run.ts"));
});
