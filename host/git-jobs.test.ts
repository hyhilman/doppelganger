// The git plugin's jobs, wired end to end through the host (JOB-G01, JOB-G07, JOB-G09, PRT-05).
// Each registered git job's exec runs through the real `buildContext` in a child with a scrubbed
// environment, so the scope is the shipped default: empty. The proof is that the wiring holds
// (the registry, the context, ctx.env.str, ctx.log) and that an empty scope does nothing. No
// network, no repo, no write.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOBS } from "./jobs/index.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const probe = mkdtempSync(join(tmpdir(), "git-jobs-smoke-"));
after(() => rmSync(probe, { recursive: true, force: true }));

const GIT_JOBS = JOBS.filter((j) => j.plugin === "git").map((j) => j.name);

/** Run one job's exec through the real context, in a child that sees only PATH and a probe root. */
function runExec(name: string) {
  const code = [
    "const { buildContext } = await import('./host/run.ts');",
    "const { JOBS } = await import('./host/jobs/index.ts');",
    `const job = JOBS.find((j) => j.name === ${JSON.stringify(name)});`,
    "await job.exec(buildContext(job));",
  ].join("\n");
  return spawnSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", code], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", ENGINE_ROOT: probe },
    encoding: "utf8",
  });
}

test("1. the git plugin registers exactly its three jobs", () => {
  assert.deepEqual(GIT_JOBS.slice().sort(), ["ops-ensure-env-worktrees", "ops-reset-branches", "ops-reset-env-to-main"]);
});

for (const name of GIT_JOBS) {
  test(`2. ${name}: with an empty scope, exec logs one no-scope line and exits 0`, () => {
    const r = runExec(name);
    assert.equal(r.status, 0, `exit ${r.status}\nstderr:\n${r.stderr}`);
    const lines = r.stderr.split("\n").filter((l) => l !== "");
    assert.equal(lines.length, 1, `expected one log line, got:\n${r.stderr}`);
    assert.match(lines[0]!, /\blevel=info\b/);
    assert.match(lines[0]!, /\bevent=no-scope\b/);
    assert.match(lines[0]!, new RegExp(`\\bjob=${name}\\b`));
    assert.equal(r.stdout, "", "no human line either: nothing ran");
  });
}

test("3. the empty-scope runs wrote nothing under the probe root", () => {
  assert.deepEqual(readdirSync(probe), []);
});
