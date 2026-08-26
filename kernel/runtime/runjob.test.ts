// J3.6 (HRN-02, HRN-12, HRN-13, HRN-16, SKL-08) — runJob, buildPrompt, substitute.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPUS_GUIDANCE, type Job } from "../ports/job.ts";
import type { RunRequest, RunResult, Runner } from "../ports/runner.ts";
import { buildPrompt, substitute, runJob, type RunJobDeps } from "./runjob.ts";

function baseJob(overrides: Partial<Job> = {}): Job {
  return {
    name: "nightly-sandcastle",
    description: "d",
    plugin: "nightly",
    skill: "nightly-sandcastle",
    permissionMode: "bypassPermissions",
    local: true,
    ...overrides,
  };
}

/** A recording fake runner — captures the request it was called with. */
function recordingRunner(): { runner: Runner; calls: RunRequest[] } {
  const calls: RunRequest[] = [];
  const runner: Runner = async (req: RunRequest): Promise<RunResult> => {
    calls.push(req);
    return { stdout: "ok", completionSignal: null, iterations: 1, commits: [], branch: "main", logPath: null };
  };
  return { runner, calls };
}

function baseDeps(runner: Runner): RunJobDeps {
  return { runner, cwd: mkdtempSync(join(tmpdir(), "runjob-cwd-")), logPath: "/tmp/does-not-matter.log" };
}

test("1. the prompt names the skill and nothing else — OPUS_GUIDANCE, every arg key, no path into a skill's files", async () => {
  const { runner, calls } = recordingRunner();
  const job = baseJob({ promptArgs: { GOAL: "docs-vs-code", WORKTREE: "/tmp/wt" } });
  await runJob(job, baseDeps(runner));
  const prompt = calls[0]!.prompt;
  assert.equal((prompt.match(/\/nightly-sandcastle/g) ?? []).length, 1);
  assert.ok(prompt.includes(OPUS_GUIDANCE.split("\n")[0]!));
  assert.ok(prompt.includes("GOAL=docs-vs-code"));
  assert.ok(prompt.includes("WORKTREE=/tmp/wt"));
  assert.ok(!prompt.includes("plugins/"));
  assert.ok(!prompt.includes(".claude/"));
  assert.ok(!prompt.includes("SKILL.md"));
  assert.ok(!prompt.includes("process.env"));
});

test("2. deterministic — two calls with the same args are byte-identical", () => {
  const job = baseJob({ promptArgs: { B: "2", A: "1" } });
  const p1 = buildPrompt(job, job.promptArgs!);
  const p2 = buildPrompt(job, job.promptArgs!);
  assert.equal(p1, p2);
  // sorted: A before B regardless of insertion order
  assert.ok(p1.indexOf("A=1") < p1.indexOf("B=2"));
});

test("3. {{WORKTREE}} is substituted from the caller's arg — the request's prompt carries the path and no {{ survives", async () => {
  const { runner, calls } = recordingRunner();
  // The caller (kernel/runtime/worktree.ts's worktreePromptLines joined) supplies WORKTREE as a
  // promptArgs entry — buildPrompt's own template has no {{...}} of its own, so the value simply
  // appears listed. substitute() (test 4) is the general-purpose piece this composes with, ready
  // for a future template that DOES carry a literal {{KEY}}.
  const job = baseJob({ promptArgs: { WORKTREE: "path: /tmp/wt base: main head: abc1234" } });
  await runJob(job, baseDeps(runner));
  const prompt = calls[0]!.prompt;
  assert.ok(prompt.includes("/tmp/wt"));
  assert.ok(!prompt.includes("{{"));
});

test("4. missing keys throw once, naming all of them", () => {
  const { missing } = substitute("{{A}} and {{B}} and {{A}} again", {});
  assert.deepEqual(missing, ["A", "B"]);
});

test("5. cwd is what the caller passed, always — runjob.ts names neither prepWorktree nor teardownWorktree", async () => {
  const { runner, calls } = recordingRunner();
  const deps = baseDeps(runner);
  const job = baseJob();
  await runJob(job, deps);
  assert.equal(calls[0]!.cwd, deps.cwd);

  const src = readFileSync(new URL("./runjob.ts", import.meta.url), "utf8");
  assert.ok(!src.includes("prepWorktree"), "runjob.ts must never name prepWorktree (ruling 4)");
  assert.ok(!src.includes("teardownWorktree"), "runjob.ts must never name teardownWorktree (ruling 4)");
});

test("6. D10's two shapes — both skill and exec throws; neither throws; the message names D10", async () => {
  const { runner } = recordingRunner();
  const both = baseJob({ exec: (async () => {}) as unknown as Job["exec"] });
  await assert.rejects(() => runJob(both, baseDeps(runner)), /D10/);

  const neither = baseJob({ skill: undefined });
  await assert.rejects(() => runJob(neither, baseDeps(runner)), /D10/);
});

test("7. HRN-13 reaches the request — deadlineMs for taskClass: impl is strictly greater", async () => {
  const { runner, calls } = recordingRunner();
  await runJob(baseJob(), baseDeps(runner));
  await runJob(baseJob({ taskClass: "impl" }), baseDeps(runner));
  assert.ok(calls[1]!.deadlineMs > calls[0]!.deadlineMs);
});

test("8. defaults flow — a job naming no model/effort produces a request carrying DEFAULTS' values", async () => {
  const { runner, calls } = recordingRunner();
  await runJob(baseJob(), baseDeps(runner));
  assert.equal(calls[0]!.model, "claude-opus-5");
  assert.equal(calls[0]!.effort, "high");
});

test("9. assertPinned fires on an env-supplied alias — the gate a source scan cannot reach", async () => {
  const { runner } = recordingRunner();
  await assert.rejects(() => runJob(baseJob({ model: "opus" }), baseDeps(runner)), /not pinned/);
  await assert.rejects(() => runJob(baseJob({ model: "claude-opus-latest" }), baseDeps(runner)), /not pinned/);
  const { runner: r2, calls } = recordingRunner();
  await runJob(baseJob({ model: "claude-opus-5" }), baseDeps(r2));
  assert.equal(calls[0]!.model, "claude-opus-5");
});
