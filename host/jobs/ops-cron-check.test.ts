// J4.12 (JOB-O09, SUP-01, SUP-02, GAT-07) — check()/runCheck(), deps-injected end to end. The real
// binary is never called here — belt-and-braces with layer 0 (cli/crontab.ts) and CRONTAB_CMD being
// unset in the suite, which would make the real exec wrapper throw before ever reaching it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { render } from "../../cli/crontab.ts";
import { PROGRAMS, programOf, type ScheduleEntry, type Program } from "../schedule.ts";
import { projectPath } from "../../kernel/paths.ts";
import type { Logger } from "../../kernel/runtime/log/emit.ts";
import { check, runCheck, type CronCheckDeps } from "./ops-cron-check.ts";

interface LogEntry {
  readonly level: string;
  readonly event: string;
  readonly fields: Record<string, unknown>;
}

function recordingLog(): { readonly log: Logger; readonly entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const at = (level: string) => (event: string, fields: Record<string, unknown> = {}) => {
    entries.push({ level, event, fields });
  };
  return { log: { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error"), raw: () => {} }, entries };
}

/** One `supervised: false` entry, so `render()` actually emits a command line to test against —
 *  the real SCHEDULE has none (N4's two entries are both supervised). `check()` calls `render()`,
 *  which calls the REAL `validate()`, which needs a real PROGRAMS row for this fixture's program
 *  — added once for the whole file below (`before`/`after`), the same technique
 *  cli/crontab.test.ts and cli/crontab-cli.test.ts use per-test. */
function fixtureSchedule(over: Partial<ScheduleEntry> = {}): readonly ScheduleEntry[] {
  return [
    {
      name: "ops-cron-check-fixture",
      cron: "*/5 * * * *",
      log: projectPath(".doppelganger/logs/ops-cron-check-fixture.log"),
      script: "kernel/paths.ts",
      supervised: false,
      why: "fixture bootstrap entry for host/jobs/ops-cron-check.test.ts",
      ...over,
    },
  ];
}

const FIXTURE_PROGRAM = programOf(fixtureSchedule()[0]!);
let addedProgramRow = false;

before(() => {
  const mutable = PROGRAMS as Record<string, Program>;
  if (!(FIXTURE_PROGRAM in mutable)) {
    mutable[FIXTURE_PROGRAM] = { self: true, gate: "excl", dotenv: false };
    addedProgramRow = true;
  }
});

after(() => {
  if (addedProgramRow) delete (PROGRAMS as Record<string, Program>)[FIXTURE_PROGRAM];
});

function baseDeps(over: Partial<CronCheckDeps> = {}): CronCheckDeps {
  const schedule = fixtureSchedule();
  return {
    log: recordingLog().log,
    crontabCmd: "/bin/true",
    readCrontab: () => "",
    schedule,
    instance: "alpha",
    ...over,
  };
}

test("1. in sync — drift: [], bootstrap counted off the block itself, one info line, no error", async () => {
  const schedule = fixtureSchedule();
  const block = render(schedule, "alpha");
  const raw = `${block.join("\n")}\n`;
  const { log, entries } = recordingLog();
  const deps: CronCheckDeps = { log, crontabCmd: "/bin/true", readCrontab: () => raw, schedule, instance: "alpha" };

  const result = check(deps);
  assert.deepEqual(result.drift, []);
  assert.equal(result.bootstrap, 1, "one rendered command line in the fixture block");

  await runCheck(deps);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.level, "info");
  assert.equal(entries[0]!.event, "cron-check");
  assert.deepEqual(entries[0]!.fields, { drift: 0, bootstrap: 1 });
});

test("2. drift — the diff lines, one error line carrying the first differing line, and it throws (exit code set)", async () => {
  // "Installed" is a render of the fixture at its default cron; the deps handed to check() render
  // a DIFFERENT cron, so check()'s own fresh render disagrees with what is "installed" — real
  // drift, not a hand-built diff.
  const installed = render(fixtureSchedule(), "alpha");
  const raw = `${installed.join("\n")}\n`;
  const { log, entries } = recordingLog();
  const deps: CronCheckDeps = {
    log,
    crontabCmd: "/bin/true",
    readCrontab: () => raw,
    schedule: fixtureSchedule({ cron: "0 0 * * *" }),
    instance: "alpha",
  };

  const result = check(deps);
  assert.ok(result.drift.length > 0, "expected at least one diff line");

  await assert.rejects(() => runCheck(deps), new RegExp(result.drift[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.level, "error");
  assert.equal(entries[0]!.event, "cron-drift");
  assert.equal(entries[0]!.fields.msg, result.drift[0]);
});

test("3. no managed block at all → one error naming crontab sync, distinct from drift", async () => {
  const { log, entries } = recordingLog();
  const deps = baseDeps({ log, readCrontab: () => "" });
  const result = check(deps);
  assert.deepEqual(result.drift, ["no managed block installed — run `npm run crontab sync`"]);

  await assert.rejects(() => runCheck(deps), /no managed block installed/);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.level, "error");
  assert.equal(entries[0]!.event, "cron-drift");
});

test("4. an unnamed (legacy) block → a THIRD, distinct message naming sync --adopt (INS-03)", () => {
  const legacy = [
    "# >>> doppelganger managed block (npm run crontab sync) >>>",
    "* * * * * echo legacy",
    "# <<< doppelganger managed block <<<",
  ].join("\n");
  const deps = baseDeps({ readCrontab: () => `${legacy}\n` });
  const result = check(deps);
  assert.equal(result.drift.length, 1);
  assert.match(result.drift[0]!, /an unnamed managed block is installed/);
  assert.match(result.drift[0]!, /sync -- --adopt/);
  assert.notDeepEqual(result.drift, ["no managed block installed — run `npm run crontab sync`"]);
});

test("5. readCrontab throwing — one error, exit non-zero, and no info line", async () => {
  const { log, entries } = recordingLog();
  const deps = baseDeps({
    log,
    readCrontab: () => {
      throw new Error("crontab: command not found");
    },
  });
  await assert.rejects(() => runCheck(deps), /command not found/);
  assert.deepEqual(entries, [], "a job that cannot read must not report anything, least of all in sync");
});

test("6. the real binary is never called — deps.readCrontab is the only path to a crontab", () => {
  // Every test above hands check()/runCheck() its own fake readCrontab; none names a real binary.
  // Belt-and-braces: CRONTAB_CMD is unset in this suite, so the real exec wrapper (which resolves
  // it via envStr(CRONTAB_CMD_ENV), required: true, no default — N2 F1) would throw before ever
  // reaching the real readCrontab, even if something else in this file forgot to inject a fake.
  assert.equal(process.env.CRONTAB_CMD, undefined);
});

// 7. "ops-cron-check is registered, its file exists, its name carries the ops- prefix" is
// deliberately NOT a test here — it comes free from test/jobs.test.ts 1/2/3/5 once the registry
// entry lands (host/jobs/index.ts, host/schedule.ts). AC1/AC5 name that suite directly rather
// than this file re-asserting something it does not own.
