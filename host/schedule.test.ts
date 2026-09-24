// the schedule shapes and the empty registries.
//
// `entry()` and `program()` are the fixture builders every later N2 test (J2.9, J2.11, J2.13,
// J2.14, J2.17) imports from THIS file rather than from host/schedule.ts — a fixture builder in a
// production module is a shape nothing ships using.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
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
import { GATE_TIMEOUT_MS } from "../plugins/nightly/jobs/nightly-sandcastle.ts";
import { JOBS } from "./jobs/index.ts";
import { createGate } from "../kernel/runtime/gate.ts";
import { RESOURCE_NAMES } from "./config.ts";
import { CRON_ANCHOR, firings } from "./cron.ts";

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

test("1. the schedule carries four entries, nightly-sandcastle first (J3.15's the first non-vacuous validate(SCHEDULE); JOB-C16 adds nightly-polish, J4.12 ops-cron-check, J4.14 ops-watchdog)", () => {
  assert.equal(SCHEDULE.length, 4);
  assert.equal(SCHEDULE[0]!.name, "nightly-sandcastle");
  assert.equal(SCHEDULE[1]!.name, "nightly-polish");
  assert.equal(SCHEDULE[2]!.name, "ops-cron-check");
  assert.equal(SCHEDULE[3]!.name, "ops-watchdog");
  assert.doesNotThrow(() => validate(SCHEDULE, { jobNames: JOBS.map((j) => j.name) }));

  for (const e of SCHEDULE) {
    const program = PROGRAMS[programOf(e)];
    assert.ok(program, `${e.name} must have a PROGRAMS row`);

    const log = e.log;
    assert.ok(
      LOG_ROOTS.some((r) => log === r || log.startsWith(`${r}/`)),
      `${log} must be under a known log root: [${LOG_ROOTS.join(", ")}]`,
    );
  }
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

// nightly-polish runs four capped children at most: npm test twice (the ff-miss path gates again),
// then gh issue create and gh issue close. Each goes through runIn, capped at GATE_TIMEOUT_MS.
test("2b. the budget: RUN_TIMEOUT_IMPL_MS + 4*GATE_TIMEOUT_MS stays under nightly-polish's maxRunMin (JOB-C14)", () => {
  const entry = SCHEDULE.find((e) => e.name === "nightly-polish");
  assert.ok(entry, "nightly-polish must be in SCHEDULE");
  const maxRunMs = entry!.maxRunMin! * 60_000;
  const budget = RUN_TIMEOUT_IMPL_MS + 4 * GATE_TIMEOUT_MS;
  assert.ok(
    budget < maxRunMs,
    `RUN_TIMEOUT_IMPL_MS (${RUN_TIMEOUT_IMPL_MS}) + 4*GATE_TIMEOUT_MS (${GATE_TIMEOUT_MS}) = ${budget}, ` +
      `must be < maxRunMin*60_000 (${maxRunMs})`,
  );
});

// JOB-C16: the two nightlies run side by side. The gate must let both hold excl at once, and their
// starts sit exactly one minute apart — two agent starts in one instant race on the git global
// config lock.
test("2c. JOB-C16 — the nightlies' resource sets are disjoint, the real gate lets both hold excl at once, and polish fires exactly one minute after sandcastle", async () => {
  const sand = PROGRAMS["nightly-sandcastle"]!;
  const polish = PROGRAMS["nightly-polish"]!;
  assert.equal(sand.gate, "excl");
  assert.equal(polish.gate, "excl");
  // An absent `resources` means every resource, which would overlap everything.
  assert.ok(sand.resources && sand.resources.length > 0, "nightly-sandcastle must name its resources");
  assert.ok(polish.resources && polish.resources.length > 0, "nightly-polish must name its resources");
  const shared = sand.resources.filter((r) => polish.resources!.includes(r));
  assert.deepEqual(shared, [], `the two nightlies share ${shared.join(", ")}`);

  const gate = createGate(RESOURCE_NAMES);
  const a = await gate.acquire("excl", sand.resources);
  assert.ok(a, "sandcastle could not take its excl hold on an idle gate");
  const b = await gate.acquire("excl", polish.resources);
  assert.ok(b, "polish could not take excl while sandcastle held its own — the sets must not contend");
  b!.release();
  a!.release();

  const byName = (n: string): ScheduleEntry => SCHEDULE.find((e) => e.name === n)!;
  const week = 7 * 86_400_000;
  const s = firings(byName("nightly-sandcastle").cron, CRON_ANCHOR, CRON_ANCHOR + week);
  const p = firings(byName("nightly-polish").cron, CRON_ANCHOR, CRON_ANCHOR + week);
  assert.ok(s.length > 0, "nightly-sandcastle never fires in a week");
  assert.equal(p.length, s.length, "the two nightlies fire a different number of times");
  assert.equal(p[0]! - s[0]!, 60_000, "the first firings are not exactly one minute apart");
  for (let i = 0; i < s.length; i++) {
    assert.equal(p[i]! - s[i]!, 60_000, `firing ${i}: polish is not exactly one minute after sandcastle`);
  }
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

test("9. a .ts script names its interpreter — process.execPath, then the absolute path (J4.11, SUP-03 fix)", () => {
  const [cmd, args] = scriptCommandOf(ROOT, "host/x.ts");
  assert.equal(cmd, process.execPath);
  assert.deepEqual([...args], [join(ROOT, "host/x.ts")]);
  // Never exec'd bare — a .ts has no shebang of its own.
  assert.notEqual(cmd, join(ROOT, "host/x.ts"));
});
