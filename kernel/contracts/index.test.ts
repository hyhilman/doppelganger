// kernel/contracts's own tests (TST-01). Each contract check runs here as a plain function over
// a fixture, so a bad input shows up as a returned problem, not as a red test in the suite.
//
// The fixtures copy the real host values (host/schedule.ts, host/config.ts) by hand, because a
// kernel/ file may not import host/ (D1). test/contracts.test.ts runs the same checks over the
// real values themselves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { graphBootProblems, scheduleResourceProblems, type ContractProgram } from "./index.ts";
import type { BootDeps } from "../boot.ts";
import type { Plugin } from "../plugin.ts";
import type { ScheduleEntry } from "../ports/schedule.ts";

// ---------------------------------------------------------------------------------------------
// Fixtures, copied from the real host values
// ---------------------------------------------------------------------------------------------

const NIGHTLY: ScheduleEntry = {
  name: "nightly-sandcastle",
  cron: "38 16-21 * * *",
  job: "nightly-sandcastle",
  log: ".doppelganger/logs/nightly-sandcastle.log",
  maxRunMin: 90,
  why: "hourly overnight: one small, verified improvement to this repo (JOB-C15)",
};

const WATCHDOG: ScheduleEntry = {
  name: "ops-watchdog",
  cron: "3,18,33,48 * * * *",
  script: "host/watchdog.sh",
  supervised: false,
  log: ".doppelganger/logs/ops-watchdog.log",
  why: "runtime liveness every 15 min, round the clock (JOB-O10)",
};

const PROGRAMS: Readonly<Record<string, ContractProgram>> = {
  "nightly-sandcastle": { resources: ["repo"] },
  "host/watchdog.sh": {}, // gate "none": names no resource
};

const RESOURCE_NAMES = ["repo", "skills"];

const programOf = (e: ScheduleEntry): string => e.job ?? e.script ?? e.name;

const GOOD = { schedule: [NIGHTLY, WATCHDOG], programs: PROGRAMS, programOf, resourceNames: RESOURCE_NAMES };

/** No disk read: every job "has" its skill, and no skill directory is "found". */
const NOOP_DEPS: BootDeps = { skillDirExists: () => true, listSkillDirs: () => [] };

function plugin(over: Partial<Plugin> & Pick<Plugin, "name">): Plugin {
  return { kill: [], jobs: [], schedule: [], env: [], ...over };
}

// ---------------------------------------------------------------------------------------------
// Contract 3 — every scheduled entry's gate resources exist
// ---------------------------------------------------------------------------------------------

test("1. schedule resources: the real-shaped schedule has no problem", () => {
  assert.deepEqual(scheduleResourceProblems(GOOD), []);
});

test("2. schedule resources: a program naming an unknown resource goes red, naming the entry and the resource", () => {
  const problems = scheduleResourceProblems({
    ...GOOD,
    programs: { ...PROGRAMS, "nightly-sandcastle": { resources: ["repos"] } },
  });
  assert.deepEqual(problems, [
    'entry "nightly-sandcastle": program "nightly-sandcastle" names unknown gate resource "repos"',
  ]);
});

test("3. schedule resources: an entry with no program row goes red", () => {
  const { "host/watchdog.sh": _dropped, ...rest } = PROGRAMS;
  assert.deepEqual(scheduleResourceProblems({ ...GOOD, programs: rest }), [
    'entry "ops-watchdog": no program row for "host/watchdog.sh"',
  ]);
});

test("4. schedule resources: a program name that is only an Object.prototype key is still missing", () => {
  const entry: ScheduleEntry = { ...NIGHTLY, name: "toString", job: "toString" };
  assert.deepEqual(scheduleResourceProblems({ ...GOOD, schedule: [entry] }), [
    'entry "toString": no program row for "toString"',
  ]);
});

test("5. schedule resources: every problem is reported, not just the first", () => {
  const problems = scheduleResourceProblems({ ...GOOD, resourceNames: [] });
  assert.deepEqual(problems, [
    'entry "nightly-sandcastle": program "nightly-sandcastle" names unknown gate resource "repo"',
  ]);
  const both = scheduleResourceProblems({
    ...GOOD,
    programs: { "nightly-sandcastle": { resources: ["repo", "state"] } },
  });
  assert.equal(both.length, 2, both.join("\n"));
});

// ---------------------------------------------------------------------------------------------
// Contract 1 — the graph boots
// ---------------------------------------------------------------------------------------------

test("6. graph boots: a graph boot() accepts has no problem", () => {
  assert.deepEqual(graphBootProblems([], NOOP_DEPS), []);
  assert.deepEqual(graphBootProblems([plugin({ name: "nightly" })], NOOP_DEPS), []);
});

test("7. graph boots: a graph boot() rejects goes red, with boot()'s own attributed message", () => {
  // The real nightly entry, in a manifest that no longer lists its job.
  const problems = graphBootProblems([plugin({ name: "nightly", schedule: [NIGHTLY] })], NOOP_DEPS);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /plugin "nightly" \[schedule entry names a registered job\]/);
  assert.match(problems[0]!, /"nightly-sandcastle"/);
});
