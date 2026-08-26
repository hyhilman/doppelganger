// J3.14 (HRN-02, SKL-05, D10, SUP-03, §1) — ruling 3's fix: host/run.ts is the ONE argv block a
// scheduled job reaches.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectPath } from "../kernel/paths.ts";
import type { Job } from "../kernel/ports/job.ts";
import type { Runner, RunRequest, RunResult } from "../kernel/ports/runner.ts";
import { JOBS } from "./jobs/index.ts";
import { resolveJob, jobListing, runNamed } from "./run.ts";
import type { PassDeps } from "./jobs/nightly-sandcastle.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

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
  return { name: "probe", description: "d", plugin: "nightly", skill: "probe", permissionMode: "bypassPermissions", local: true, ...overrides };
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

  // A rejecting runner: the rejection must propagate (never be swallowed into a silent 0).
  const rejecting: Runner = async () => {
    throw new Error("boom");
  };
  await assert.rejects(() => runNamed(job, fakePassDeps({ runner: rejecting })), /boom/);
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
