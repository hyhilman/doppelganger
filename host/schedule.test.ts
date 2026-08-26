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
  scriptCommandOf,
  validate,
  type ScheduleEntry,
  type Program,
} from "./schedule.ts";
import { ROOT } from "../kernel/paths.ts";
import { LOG_ROOTS } from "../kernel/runtime/log/tail.ts";
import { RUN_TIMEOUT_IMPL_MS } from "../kernel/ports/runner.ts";
import { GATE_TIMEOUT_MS } from "./jobs/nightly-sandcastle.ts";

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

test("1. the schedule carries one entry: nightly-sandcastle (J3.15) — the first non-vacuous validate(SCHEDULE) in the repo's life", () => {
  assert.equal(SCHEDULE.length, 1);
  assert.equal(SCHEDULE[0]!.name, "nightly-sandcastle");
  assert.doesNotThrow(() => validate());

  const program = PROGRAMS[programOf(SCHEDULE[0]!)];
  assert.ok(program, "nightly-sandcastle must have a PROGRAMS row");

  const log = SCHEDULE[0]!.log;
  assert.ok(
    LOG_ROOTS.some((r) => log === r || log.startsWith(`${r}/`)),
    `${log} must be under a known log root: [${LOG_ROOTS.join(", ")}]`,
  );
});

// N2 F1's exact shape, restated here so it cannot recur: the first draft asserted a WEAKER
// property than it claimed (`runTimeoutMs < maxRunMin*60_000`, true at 40 < 60 while the real
// budget is the SUM of the run timeout and the gate re-run on the ff-miss path). This assertion
// checks the sum, both operands named on failure — never a bare boolean.
test("2. the budget: RUN_TIMEOUT_IMPL_MS + 2*GATE_TIMEOUT_MS stays under nightly-sandcastle's maxRunMin (N2 F1's shape, not repeated)", () => {
  const entry = SCHEDULE.find((e) => e.name === "nightly-sandcastle");
  assert.ok(entry, "nightly-sandcastle must be in SCHEDULE");
  const maxRunMs = entry!.maxRunMin! * 60_000;
  const budget = RUN_TIMEOUT_IMPL_MS + 2 * GATE_TIMEOUT_MS;
  assert.ok(
    budget < maxRunMs,
    `RUN_TIMEOUT_IMPL_MS (${RUN_TIMEOUT_IMPL_MS}) + 2*GATE_TIMEOUT_MS (${GATE_TIMEOUT_MS}) = ${budget}, ` +
      `must be < maxRunMin*60_000 (${maxRunMs})`,
  );
});

test("3. programOf prefers job, then script, then name", () => {
  assert.equal(programOf(entry({ job: "j1", script: undefined })), "j1");
  assert.equal(programOf(entry({ job: undefined, script: "s1.sh" })), "s1.sh");
  assert.equal(programOf(entry({ job: undefined, script: undefined, name: "bare" })), "bare");
  // Both set: programOf returns job. validate() (J2.9) refuses the entry separately — this test
  // says which layer owns which.
  assert.equal(programOf(entry({ job: "j1", script: "s1.sh" })), "j1");
});

test("4. supervisedEntries / bootstrapEntries partition a five-entry fixture", () => {
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

test("5. the fixture builders are deterministic", () => {
  assert.deepEqual(entry(), entry());
  assert.deepEqual(program(), program());
});

test("6. commandOf for a job: entry names host/run.ts, not host/jobs/<job>.ts (J3.14 ruling 3)", () => {
  const cmd = commandOf(entry({ job: "probe", script: undefined }));
  assert.match(cmd, /\bhost\/run\.ts probe\b/);
  assert.ok(!cmd.includes("host/jobs/probe.ts"));
});

test("7. commandOf for a script: entry names the script directly — no node prefix (R3, SUP-03)", () => {
  const cmd = commandOf(entry({ job: undefined, script: "host/ops-probe.sh" }));
  assert.match(cmd, /\bhost\/ops-probe\.sh\b/);
  assert.ok(!cmd.includes("host/run.ts"));
  // `node` cannot run a bash script — the exact defect R3 fixes. Word-boundary, so this does not
  // also fire on a substring like "probe.sh" itself.
  assert.ok(!/\bnode\b/.test(cmd), `expected no "node" in a script: command, got: ${cmd}`);
});

test("8. commandOf and scriptCommandOf agree — one spelling, checked (R3, SUP-03, N3 F1's shape)", () => {
  const e = entry({ job: undefined, script: "host/ops-probe.sh" });
  const [cmd, args] = scriptCommandOf(ROOT, e.script as string);
  assert.ok(
    commandOf(e).includes([cmd, ...args].join(" ")),
    `commandOf's rendering must contain exactly what scriptCommandOf renders`,
  );
});
