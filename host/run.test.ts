// J3.14 (HRN-02, D10, §1) — ruling 3's fix: host/run.ts is the ONE argv block a
// scheduled job reaches.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { projectPath } from "../kernel/paths.ts";
import { closeAll } from "../kernel/runtime/db.ts";
import { read as readLease } from "../kernel/runtime/lease.ts";
import { isPaused as quotaIsPaused, QUOTA_SCOPE } from "../kernel/runtime/quota.ts";
import { NO_SHED } from "../kernel/runtime/shed.ts";
import { SUPERVISOR_MAX_RUN_MIN, SUPERVISOR_KILL_GRACE_MS } from "./supervisor.ts";
import type { Job } from "../kernel/ports/job.ts";
import type { Runner, RunRequest, RunResult } from "../kernel/ports/runner.ts";
import { JOBS } from "./jobs/index.ts";
import { resolveJob, jobListing, runNamed } from "./run.ts";
import type { PassDeps } from "./jobs/nightly-sandcastle.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// lands runNamed on the lease store, and QTA-01/05 land it on the quota store — every test
// in this file that calls runNamed now claims an hourly key and can trip the breaker, so both are
// redirected the same way their own test files do.
let leaseDir: string;
let quotaDir: string;

before(() => {
  leaseDir = mkdtempSync(join(tmpdir(), "run-lease-"));
  process.env.LEASE_DB = join(leaseDir, "lease.db");
  quotaDir = mkdtempSync(join(tmpdir(), "run-quota-"));
  process.env.QUOTA_DB = join(quotaDir, "quota.db");
});

after(() => {
  closeAll();
  delete process.env.LEASE_DB;
  delete process.env.QUOTA_DB;
  rmSync(leaseDir, { recursive: true, force: true });
  rmSync(quotaDir, { recursive: true, force: true });
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
    shed: NO_SHED,
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
// every job claims its hour before it runs.
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

// ---------------------------------------------------------------------------------------------
// the account breaker's producer and consumer, both gated on job.skill.
// ---------------------------------------------------------------------------------------------

function fakeExecJob(overrides: Partial<Job> = {}): Job {
  const name = freshName();
  return {
    name,
    description: "d",
    plugin: "nightly",
    permissionMode: "auto",
    exec: (async () => {}) as unknown as Job["exec"],
    ...overrides,
  };
}

test("12. an exec: job never reads the breaker — it runs even while the account is walled", async () => {
  const { pause, clearPause } = await import("../kernel/runtime/quota.ts");
  pause(QUOTA_SCOPE, "weekly limit reached");
  try {
    let calls = 0;
    const job = fakeExecJob({
      exec: (async () => {
        calls++;
      }) as unknown as Job["exec"],
    });
    const code = await runNamed(job, fakePassDeps());
    assert.equal(code, 0);
    assert.equal(calls, 1, "an exec: job must run even with the breaker open");
  } finally {
    clearPause(QUOTA_SCOPE);
  }
});

test("13. an exec: job never SETS the breaker — a matching message still re-throws, breaker stays closed", async () => {
  const job = fakeExecJob({
    exec: (async () => {
      throw new Error("usage limit reached");
    }) as unknown as Job["exec"],
  });
  await assert.rejects(() => runNamed(job, fakePassDeps()), /usage limit reached/);
  assert.equal(quotaIsPaused(QUOTA_SCOPE), false, "an exec: job's own failure must never open the breaker");
});

test("14. the reference's source scan, ported — every registered job with NO skill (a purely deterministic exec: job) imports neither quota.ts nor calls runJob(", () => {
  // Derived from JOBS, never a hand-typed name list — a new deterministic job is covered without
  // an edit. `job.skill !== undefined` is what runNamed itself gates on (not `job.exec ===
  // undefined`): nightly-sandcastle carries BOTH fields and its own exec calls runJob internally
  // — it is the one job that DOES spawn a model, so it is correctly EXCLUDED from this scan by
  // having a skill, not by name.
  for (const job of JOBS) {
    if (job.skill !== undefined) continue;
    assert.ok(job.exec !== undefined, `${job.name}: a job with no skill must set exec (D10)`);
    const file = projectPath(`host/jobs/${job.name}.ts`);
    const src = readFileSync(file, "utf8");
    assert.ok(!/from\s*["'][^"']*\/quota\.ts["']/.test(src), `${job.name}: a deterministic job must not import quota.ts`);
    assert.ok(!/\brunJob\s*\(/.test(src), `${job.name}: a deterministic job must not call runJob(`);
  }
});

test("14b. the real nightly-sandcastle registry object — which carries BOTH exec and skill — still refuses while walled; the gate is job.skill, not job.exec", async () => {
  const job = JOBS.find((j) => j.name === "nightly-sandcastle");
  assert.ok(job, "nightly-sandcastle must be registered");
  assert.ok(job!.exec !== undefined, "precondition: this job carries exec");
  assert.ok(job!.skill !== undefined, "precondition: this job carries skill");
  const { pause, clearPause } = await import("../kernel/runtime/quota.ts");
  pause(QUOTA_SCOPE, "weekly limit reached");
  try {
    const { log, calls } = capturingLog();
    // fakePassDeps' git() returns "" and NIGHTLY_SANDCASTLE_BASE defaults to "main", so if the
    // consumer wrongly let this dispatch through to job.exec (execPass), execPass would run its
    // own "not-on-base" skip and log a DIFFERENT event before returning — still exit 0, but for
    // the wrong reason, having reached the agent-spawning code path while the account is walled.
    const code = await runNamed(job!, fakePassDeps({ log }));
    assert.equal(code, 0);
    assert.equal(calls.length, 1, `expected exactly one log line, got: ${JSON.stringify(calls)}`);
    assert.equal(calls[0]!.event, "quota-paused", "runNamed must refuse before job.exec is ever reached");
  } finally {
    clearPause(QUOTA_SCOPE);
  }
});

// ---------------------------------------------------------------------------------------------
// the whole park loop, end to end, no model call. A fake `claude` on PATH stands in for
// the real CLI (N3's own layer B, measured ~100ms) — the REAL sandcastleRunner, the REAL run(),
// the REAL rejection, the REAL errText, in a real child process. HOME is always a fresh
// mkdtempSync directory, so nothing here can ever reach the developer's real ~/.gitconfig.
// ---------------------------------------------------------------------------------------------

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "run-park-repo-"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "config", "user.name", "t"]);
  execFileSync("git", ["-C", repo, "config", "user.email", "t@example.com"]);
  execFileSync("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "init"]);
  return repo;
}

/** Writes an executable file named `name` into a fresh bin directory and returns that directory —
 *  the runner.test.ts precedent, a local copy (never imported from a .test.ts file). */
function makeFakeBin(name: string, script: string): string {
  const bin = mkdtempSync(join(tmpdir(), "run-park-fakebin-"));
  const file = join(bin, name);
  writeFileSync(file, `#!/usr/bin/env node\n${script}\n`);
  chmodSync(file, 0o755);
  return bin;
}

const RUN_URL = pathToFileURL(join(ROOT, "host/run.ts")).href;
const RUNNER_URL = pathToFileURL(join(ROOT, "host/runner.ts")).href;
const QUOTA_URL = pathToFileURL(join(ROOT, "kernel/runtime/quota.ts")).href;

interface DriverOpts {
  readonly bin: string;
  readonly repo: string;
  readonly jobName: string;
  readonly leaseDb: string;
  readonly quotaDb: string;
  /** JS lines run inside the driver, before `runNamed` is called (e.g. seeding a pause()). */
  readonly extraSetup?: string;
}

/** Spawns a real Node child that calls the real `runNamed`, wired to the real `sandcastleRunner` —
 *  never a re-implementation (N2 F3). Prints one `RESULT:` JSON line the caller parses. */
function runDriver(opts: DriverOpts): { code: number | null; result: Record<string, unknown> | null; stdout: string; stderr: string } {
  const home = mkdtempSync(join(tmpdir(), "run-park-home-"));
  const scratch = mkdtempSync(join(tmpdir(), "run-park-scratch-"));
  const driverPath = join(scratch, "driver.mjs");
  writeFileSync(
    driverPath,
    [
      `import { runNamed } from ${JSON.stringify(RUN_URL)};`,
      `import { sandcastleRunner } from ${JSON.stringify(RUNNER_URL)};`,
      `import { isPaused, inspect, QUOTA_SCOPE } from ${JSON.stringify(QUOTA_URL)};`,
      `const job = { name: ${JSON.stringify(opts.jobName)}, description: "d", plugin: "nightly", skill: ${JSON.stringify(opts.jobName)}, permissionMode: "bypassPermissions", local: true, model: "claude-opus-5" };`,
      `const runner = sandcastleRunner({ gitConfigGlobal: ${JSON.stringify(join(scratch, "gitconfig"))}, gitSshCommand: "/bin/false" });`,
      `const deps = {`,
      `  root: ${JSON.stringify(opts.repo)},`,
      `  runner,`,
      `  git: () => "",`,
      `  now: () => new Date(),`,
      `  db: undefined,`,
      `  log: { debug(){}, info(){}, warn(){}, error(){}, raw(){} },`,
      `  worktreeRoot: ${JSON.stringify(join(scratch, "wt"))},`,
      `  runLogPath: () => ${JSON.stringify(join(scratch, "run.log"))},`,
      `  runIn: () => ({ ok: true, out: "" }),`,
      `  scratchRoot: ${JSON.stringify(join(scratch, "scratch2"))},`,
      `  jobs: [],`,
      `};`,
      opts.extraSetup ?? "",
      `let code = null, threw = null;`,
      `try { code = await runNamed(job, deps); } catch (e) { threw = e instanceof Error ? e.message : String(e); }`,
      `const result = { code, threw, isPaused: isPaused(QUOTA_SCOPE), limit: inspect(QUOTA_SCOPE).limit };`,
      `process.stdout.write("RESULT:" + JSON.stringify(result) + "\\n");`,
    ].join("\n"),
  );

  const r = spawnSync(process.execPath, [driverPath], {
    cwd: ROOT,
    env: { PATH: `${opts.bin}:${process.env.PATH ?? ""}`, HOME: home, LEASE_DB: opts.leaseDb, QUOTA_DB: opts.quotaDb },
    encoding: "utf8",
    timeout: 30_000,
  });
  const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT:"));
  return {
    code: r.status,
    result: line ? (JSON.parse(line.slice("RESULT:".length)) as Record<string, unknown>) : null,
    stdout: r.stdout,
    stderr: r.stderr,
  };
}

const CLAUDE_SPEND_LIMIT = [
  "process.stdin.resume();",
  'let data = "";',
  'process.stdin.on("data", (c) => { data += c; });',
  'process.stdin.on("end", () => {',
  '  process.stderr.write("You\'ve hit your org\'s monthly spend limit\\n");',
  "  process.exit(1);",
  "});",
].join("\n");

const CLAUDE_NON_LIMIT_FAILURE = [
  "process.stdin.resume();",
  'let data = "";',
  'process.stdin.on("data", (c) => { data += c; });',
  'process.stdin.on("end", () => {',
  '  process.stderr.write("worker blew up\\n");',
  "  process.exit(1);",
  "});",
].join("\n");

test("15. the whole park loop, no model call — a fake claude that walls with the tier-1 spend wording", () => {
  const repo = makeRepo();
  const bin = makeFakeBin("claude", CLAUDE_SPEND_LIMIT);
  const leaseDb = join(mkdtempSync(join(tmpdir(), "run-park-lease-")), "lease.db");
  const quotaDb = join(mkdtempSync(join(tmpdir(), "run-park-quota-")), "quota.db");

  const { code, result, stdout, stderr } = runDriver({ bin, repo, jobName: "probe-park", leaseDb, quotaDb });
  assert.equal(code, 0, `driver did not exit 0. stdout:\n${stdout}\nstderr:\n${stderr}`);
  assert.ok(result, `no RESULT line. stdout:\n${stdout}`);
  assert.equal(result!.code, 0, "runNamed must return 0 — a wall is a skipped tick, not a failure");
  assert.equal(result!.threw, null);
  assert.equal(result!.isPaused, true);
  assert.equal(result!.limit, "spend");
});

test("16. the consumer refuses before it spawns — QTA-05's next real task IS the probe, proved against a real spawn", () => {
  const repo = makeRepo();
  const markerFile = join(mkdtempSync(join(tmpdir(), "run-park-marker-")), "marker");
  const claudeHappy = [
    "process.stdin.resume();",
    'let data = "";',
    'process.stdin.on("data", (c) => { data += c; });',
    'process.stdin.on("end", () => {',
    `  require("node:fs").writeFileSync(${JSON.stringify(markerFile)}, "spawned");`,
    '  console.log("<<<SANDCASTLE");',
    '  console.log("goal=probe");',
    '  console.log("outcome=none");',
    '  console.log("files=-");',
    '  console.log("ids=-");',
    '  console.log("summary=nothing to do");',
    '  console.log("verified=none");',
    '  console.log("SANDCASTLE>>>");',
    '  console.log("<promise>COMPLETE</promise>");',
    "  process.exit(0);",
    "});",
  ].join("\n");
  const bin = makeFakeBin("claude", claudeHappy);
  const leaseDb = join(mkdtempSync(join(tmpdir(), "run-park-lease-")), "lease.db");
  const quotaDb = join(mkdtempSync(join(tmpdir(), "run-park-quota-")), "quota.db");

  // Breaker OPEN before the driver even starts: the fake claude must never be exec'd.
  const seed1 = runDriver({
    bin,
    repo,
    jobName: "probe-refuse",
    leaseDb,
    quotaDb,
    extraSetup: [
      `const qm0 = await import(${JSON.stringify(QUOTA_URL)});`,
      `qm0.pause(qm0.QUOTA_SCOPE, "weekly limit reached");`,
    ].join("\n"),
  });
  void seed1;
  assert.equal(existsSync(markerFile), false, "the fake claude must never have been exec'd while the breaker is open");

  // Now push the breaker's window into the past — QTA-05: the NEXT real task is the probe, no
  // separate prober.
  const after = runDriver({
    bin,
    repo,
    jobName: "probe-refuse-2",
    leaseDb,
    quotaDb,
    extraSetup: [
      `const m = await import(${JSON.stringify(QUOTA_URL)});`,
      `const d = (await import(${JSON.stringify(pathToFileURL(join(ROOT, "kernel/runtime/db.ts")).href)})).openDb((await import(${JSON.stringify(pathToFileURL(join(ROOT, "kernel/paths.ts")).href)})).dbPath("quota"));`,
      `d.metaSet("quota", "until:" + m.QUOTA_SCOPE, new Date(Date.now() - 60_000).toISOString());`,
    ].join("\n"),
  });
  assert.equal(after.result?.code, 0, `driver stdout:\n${after.stdout}\nstderr:\n${after.stderr}`);
  assert.equal(existsSync(markerFile), true, "IS executed once the window has lapsed — the real spawn happened");
});

test("17. a non-limit failure still throws — worker blew up rejects, and nothing is parked", () => {
  const repo = makeRepo();
  const bin = makeFakeBin("claude", CLAUDE_NON_LIMIT_FAILURE);
  const leaseDb = join(mkdtempSync(join(tmpdir(), "run-park-lease-")), "lease.db");
  const quotaDb = join(mkdtempSync(join(tmpdir(), "run-park-quota-")), "quota.db");

  const { result, stdout, stderr } = runDriver({ bin, repo, jobName: "probe-nonlimit", leaseDb, quotaDb });
  assert.ok(result, `no RESULT line. stdout:\n${stdout}\nstderr:\n${stderr}`);
  assert.equal(result!.code, null, "runNamed must reject, never resolve, on a non-limit failure");
  assert.match(String(result!.threw), /worker blew up/);
  assert.equal(result!.isPaused, false, "a non-limit failure must never open the breaker");
});
