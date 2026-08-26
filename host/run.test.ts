// J3.14 (HRN-02, SKL-05, D10, SUP-03, §1) — ruling 3's fix: host/run.ts is the ONE argv block a
// scheduled job reaches.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectPath } from "../kernel/paths.ts";
import { closeAll } from "../kernel/runtime/db.ts";
import { read as readLease } from "../kernel/runtime/lease.ts";
import { SUPERVISOR_MAX_RUN_MIN, SUPERVISOR_KILL_GRACE_MS } from "./supervisor.ts";
import type { Job } from "../kernel/ports/job.ts";
import type { Runner, RunRequest, RunResult } from "../kernel/ports/runner.ts";
import { JOBS } from "./jobs/index.ts";
import { resolveJob, jobListing, runNamed } from "./run.ts";
import type { PassDeps } from "./jobs/nightly-sandcastle.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// LSE-04 lands runNamed on the lease store — every test in this file that calls runNamed now
// claims an hourly key, so LEASE_DB is redirected the same way kernel/runtime/lease.test.ts does.
let leaseDir: string;

before(() => {
  leaseDir = mkdtempSync(join(tmpdir(), "run-lease-"));
  process.env.LEASE_DB = join(leaseDir, "lease.db");
});

after(() => {
  closeAll();
  delete process.env.LEASE_DB;
  rmSync(leaseDir, { recursive: true, force: true });
});

let jobCounter = 0;
/** A fresh job name per call, so two runNamed calls in the same test (or two tests in the same
 *  UTC hour) never collide on the same lease key — LSE-04's own subject, not a test-isolation
 *  workaround this file needs to hide. */
function freshName(): string {
  jobCounter++;
  return `probe-${jobCounter}`;
}

test("1. resolveJob(undefined, JOBS) names the usage line", () => {
  const result = resolveJob(undefined, JOBS);
  assert.ok("error" in result);
  assert.match((result as { error: string }).error, /usage: npm run job <name>/);
});

test("2. resolveJob(\"nope\", JOBS) names the unknown job plus the available list", () => {
  const result = resolveJob("nope", JOBS);
  assert.ok("error" in result);
  assert.match((result as { error: string }).error, /unknown job "nope"/);
  assert.match((result as { error: string }).error, /nightly-sandcastle/);
});

test("3. resolveJob(\"nightly-sandcastle\", JOBS) is strictEqual to the registry's object", () => {
  const result = resolveJob("nightly-sandcastle", JOBS);
  assert.strictEqual(result, JOBS.find((j) => j.name === "nightly-sandcastle"));
});

test("4. jobListing(JOBS) groups under the nightly stage heading and names the job", () => {
  const listing = jobListing(JOBS);
  assert.match(listing, /-- nightly --/);
  assert.match(listing, /nightly-sandcastle/);
});

function fakeJob(overrides: Partial<Job> = {}): Job {
  const name = freshName();
  return { name, description: "d", plugin: "nightly", skill: name, permissionMode: "bypassPermissions", local: true, ...overrides };
}

function fakePassDeps(overrides: Partial<PassDeps> = {}): PassDeps {
  return {
    root: mkdtempSync(join(tmpdir(), "run-deps-")),
    runner: (async () => {
      throw new Error("this runner must not be called");
    }) as Runner,
    git: () => "",
    now: () => new Date(),
    db: undefined as unknown as PassDeps["db"], // unused by these tests — never accessed
    log: { debug() {}, info() {}, warn() {}, error() {}, raw() {} },
    worktreeRoot: mkdtempSync(join(tmpdir(), "run-wt-")),
    runLogPath: (name: string) => join(mkdtempSync(join(tmpdir(), "run-log-")), `${name}.log`),
    runIn: () => ({ ok: true, out: "" }),
    scratchRoot: mkdtempSync(join(tmpdir(), "run-scratch-")),
    jobs: [],
    ...overrides,
  };
}

test("5. runNamed with an exec job calls exec once, returns 0, and never calls the fake runner", async () => {
  let execCalls = 0;
  const job = fakeJob({
    skill: undefined,
    exec: (async (deps: PassDeps) => {
      execCalls++;
      void deps;
    }) as unknown as Job["exec"],
  });
  const code = await runNamed(job, fakePassDeps());
  assert.equal(execCalls, 1);
  assert.equal(code, 0);
});

test("6. runNamed with a skill-only job calls the runner once and returns 0; a rejecting runner REJECTS — the rejection propagates to the argv block, never a silent 0", async () => {
  const calls: RunRequest[] = [];
  const runner: Runner = async (req: RunRequest): Promise<RunResult> => {
    calls.push(req);
    return { stdout: "", completionSignal: null, iterations: 1, commits: [], branch: "main", logPath: null };
  };
  const job = fakeJob();
  const code = await runNamed(job, fakePassDeps({ runner }));
  assert.equal(calls.length, 1);
  assert.equal(code, 0);

  // A rejecting runner: the rejection must propagate (never be swallowed into a silent 0). A
  // DIFFERENT job — the one above already settled its hourly key "done", and a same-key retry
  // would be refused by the lease before the runner is ever reached, which is a different
  // property (test 9 below) from the one this test proves.
  const rejectingJob = fakeJob();
  const rejecting: Runner = async () => {
    throw new Error("boom");
  };
  await assert.rejects(() => runNamed(rejectingJob, fakePassDeps({ runner: rejecting })), /boom/);
});

test("7. the argv smoke check — no argument exits non-zero naming usage; an unknown job exits non-zero naming it", () => {
  const runPath = projectPath("host/run.ts");
  const noArg = spawnSync(process.execPath, [runPath], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(noArg.status, 0);
  assert.match(noArg.stderr, /usage/);

  const unknown = spawnSync(process.execPath, [runPath, "nope"], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /unknown job/);
});

// ---------------------------------------------------------------------------------------------
// J4.4 (LSE-04) — every job claims its hour before it runs.
// ---------------------------------------------------------------------------------------------

interface LoggedCall {
  readonly level: string;
  readonly event: string;
  readonly fields: Record<string, unknown>;
}

function capturingLog(): { log: PassDeps["log"]; calls: LoggedCall[] } {
  const calls: LoggedCall[] = [];
  const at = (level: string) => (event: string, fields: Record<string, unknown> = {}) => {
    calls.push({ level, event, fields });
  };
  return { log: { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error"), raw: () => {} }, calls };
}

test("8. the key is the job name and the UTC hour", async () => {
  const job = fakeJob();
  const frozen = new Date("2026-08-26T22:15:00Z");
  const runner: Runner = async () => ({ stdout: "", completionSignal: null, iterations: 1, commits: [], branch: "main", logPath: null });
  await runNamed(job, fakePassDeps({ runner, now: () => frozen }));
  const row = readLease("job", `${job.name}@2026-08-26T22`);
  assert.ok(row, `expected a lease row at job/${job.name}@2026-08-26T22`);
});

test("9. a second run in the same hour is refused, exit 0, one lease-held line naming the lease-clear command — and fn never ran", async () => {
  const job = fakeJob();
  // Two DISTINCT minutes inside the SAME hour — this is what makes the test discriminate
  // hour-granularity from minute-granularity: two calls at the identical instant would collide
  // under either slice width and prove nothing about which width is in effect.
  const firstAt = new Date("2026-08-26T22:15:00Z");
  const secondAt = new Date("2026-08-26T22:45:00Z");
  let runnerCalls = 0;
  const runner: Runner = async () => {
    runnerCalls++;
    return { stdout: "", completionSignal: null, iterations: 1, commits: [], branch: "main", logPath: null };
  };
  const first = await runNamed(job, fakePassDeps({ runner, now: () => firstAt }));
  assert.equal(first, 0);
  assert.equal(runnerCalls, 1);

  const { log, calls } = capturingLog();
  const second = await runNamed(job, fakePassDeps({ runner, now: () => secondAt, log }));
  assert.equal(second, 0);
  assert.equal(runnerCalls, 1, "the runner must not be called a second time");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.event, "lease-held");
  const msg = String(calls[0]!.fields.msg ?? "");
  assert.match(msg, new RegExp(`npm run lease-clear -- job ${job.name}@2026-08-26T22`));
});

test("10. a run in the NEXT hour succeeds — the version moved, so the key moved (LSE-04)", async () => {
  const job = fakeJob();
  const hour1 = new Date("2026-08-26T22:15:00Z");
  const hour2 = new Date("2026-08-26T23:01:00Z");
  let runnerCalls = 0;
  const runner: Runner = async () => {
    runnerCalls++;
    return { stdout: "", completionSignal: null, iterations: 1, commits: [], branch: "main", logPath: null };
  };
  await runNamed(job, fakePassDeps({ runner, now: () => hour1 }));
  await runNamed(job, fakePassDeps({ runner, now: () => hour2 }));
  assert.equal(runnerCalls, 2);
});

test("11. the TTL is the derived one — SUPERVISOR_MAX_RUN_MIN's bound plus the kill grace", async () => {
  const job = fakeJob();
  const frozen = new Date("2026-08-26T22:15:00Z");
  const runner: Runner = async () => ({ stdout: "", completionSignal: null, iterations: 1, commits: [], branch: "main", logPath: null });
  await runNamed(job, fakePassDeps({ runner, now: () => frozen }));
  const row = readLease("job", `${job.name}@2026-08-26T22`)!;
  const ttlMs = new Date(row.expiresAt).getTime() - new Date(row.claimedAt).getTime();
  const derived = SUPERVISOR_MAX_RUN_MIN * 60_000 + SUPERVISOR_KILL_GRACE_MS;
  assert.ok(Math.abs(ttlMs - derived) < 1_000, `ttlMs=${ttlMs} not within 1s of derived=${derived}`);
});
