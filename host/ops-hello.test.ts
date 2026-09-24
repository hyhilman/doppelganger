// ops-hello (JOB-O01): a read-only smoke test of the agent path. These tests pin its shape and
// the one request it sends. The test lives in host/ because it needs kernel/runtime, which a
// plugin may not import (TST-03).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULTS } from "../kernel/ports/job.ts";
import type { RunRequest, RunResult, Runner } from "../kernel/ports/runner.ts";
import { runJob } from "../kernel/runtime/runjob.ts";
import { NO_SHED } from "../kernel/runtime/shed.ts";
import opsHello from "../plugins/ops/jobs/ops-hello.ts";
import ops from "../plugins/ops/plugin.ts";
import { SCHEDULE } from "./schedule.ts";

test("1. ops-hello is a skill job in the ops plugin, with no exec", () => {
  assert.equal(opsHello.name, "ops-hello");
  assert.equal(opsHello.plugin, "ops");
  assert.equal(opsHello.skill, "ops-hello");
  assert.equal(opsHello.exec, undefined);
  assert.equal(opsHello.model, DEFAULTS.model);
  assert.equal(opsHello.permissionMode, "auto");
  assert.equal(opsHello.maxIterations, 1);
  assert.ok(ops.jobs.includes(opsHello), "the ops manifest lists ops-hello");
});

test("2. it is run by hand only — no SCHEDULE entry names it", () => {
  assert.deepEqual(SCHEDULE.filter((e) => e.job === "ops-hello"), []);
});

test("3. one run sends one request: the /ops-hello skill, auto mode, one pass", async () => {
  const calls: RunRequest[] = [];
  const runner: Runner = async (req: RunRequest): Promise<RunResult> => {
    calls.push(req);
    return { stdout: "ops-hello: host agent run OK", completionSignal: null, iterations: 1, commits: [], branch: "main", logPath: null };
  };
  const cwd = mkdtempSync(join(tmpdir(), "ops-hello-"));
  await runJob(opsHello, { runner, cwd, logPath: join(cwd, "run.log"), shed: NO_SHED });

  assert.equal(calls.length, 1);
  const req = calls[0]!;
  assert.equal((req.prompt.match(/\/ops-hello/g) ?? []).length, 1);
  assert.equal(req.permissionMode, "auto");
  assert.equal(req.maxIterations, 1);
  assert.equal(req.model, DEFAULTS.model);
});

test("4. the skill asks for the one line and forbids every change", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "plugins", "ops", "skills", "ops-hello", "SKILL.md"), "utf8");
  assert.ok(src.includes("ops-hello: host agent run OK"));
  assert.ok(src.includes("Do not create, edit or delete any file. Do not run any command."));
});
