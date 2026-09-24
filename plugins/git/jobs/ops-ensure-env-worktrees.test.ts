// JOB-G07/08 — ensure-env-worktrees over real git: create, idempotent second run, and the
// refusals that keep it from taking over a path it did not make.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupWorkspaces, git, head, recorder, workspace } from "../repo.fixture.ts";
import { scopeFrom, type GitScope } from "../scope.ts";
import type { EnvSpec } from "../../../kernel/plugin.ts";
import { runEnsureEnvWorktrees, ensureEnvWorktreesKnobs, type EnsureEnvWorktreesKnobs } from "./ops-ensure-env-worktrees.ts";

after(cleanupWorkspaces);

const reader = (env: Record<string, string>) => ({ env: { str: (spec: EnvSpec): string => env[spec.key] ?? spec.default ?? "" } });

function scope(over: Partial<GitScope> = {}): GitScope {
  return { ...scopeFrom(reader({})), repos: ["api"], worktreeDir: "worktree", ...over };
}

function run(root: string, knobs: Partial<EnsureEnvWorktreesKnobs> = {}) {
  const rec = recorder();
  const result = runEnsureEnvWorktrees({
    root,
    git,
    say: rec.say,
    log: rec.log,
    knobs: { scope: scope(), dryRun: false, quiet: false, ...knobs },
  });
  return { ...rec, result };
}

test("1. JOB-G07: creates one tree per env branch origin has, and skips a branch origin lacks in silence", () => {
  const ws = workspace(["api"], ["staging", "dev"]);
  const r = run(ws.root);
  assert.equal(r.result.exitCode, 0, r.out());
  assert.equal(r.result.created, 2, r.out());
  for (const b of ["staging", "dev"]) {
    const path = join(ws.root, "worktree", `api-${b}`);
    assert.ok(existsSync(join(path, ".git")), path);
    assert.equal(git(path, "rev-parse", "--abbrev-ref", "HEAD").trim(), b);
  }
  assert.ok(!r.out().includes("api:development"), "a branch origin lacks is skipped in silence");
  assert.match(r.out(), /\[env-worktrees\] done — 2 created, 0 existing, 0 skipped, 0 failed/);
});

test("2. JOB-G07: a second run is idempotent — every tree found, nothing created", () => {
  const ws = workspace(["api"], ["staging"]);
  run(ws.root);
  const r = run(ws.root);
  assert.equal(r.result.created, 0);
  assert.equal(r.result.existing, 1);
  assert.match(r.out(), /=  api:staging — already at /);
  const quiet = run(ws.root, { quiet: true });
  assert.deepEqual(quiet.lines, [], "a quiet clean run prints nothing");
});

test("3. JOB-G07: a path that exists but is not a registered worktree is left alone", () => {
  const ws = workspace(["api"], ["staging"]);
  const path = join(ws.root, "worktree", "api-staging");
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "notes.txt"), "someone's\n");
  const r = run(ws.root);
  assert.equal(r.result.skipped, 1);
  assert.equal(r.result.exitCode, 0, "a refusal is not a failure");
  assert.match(r.out(), /exists but is not a registered worktree, left alone/);
  assert.ok(!existsSync(join(path, ".git")));
});

test("4. JOB-G07: a branch checked out elsewhere is not reprovisioned", () => {
  const ws = workspace(["api"], ["staging"]);
  git(ws.repo("api"), "checkout", "-q", "staging");
  const r = run(ws.root);
  assert.equal(r.result.skipped, 1);
  assert.match(r.out(), /api:staging — already checked out at .*api, not reprovisioned/);
});

test("5. a missing repo directory is a failure; a dry run writes nothing", () => {
  const ws = workspace(["api"], ["staging"]);
  const missing = run(ws.root, { scope: scope({ repos: ["api", "gone"] }) });
  assert.equal(missing.result.failed, 1);
  assert.equal(missing.result.exitCode, 1);
  assert.match(missing.out(), /✗  gone — not a git repo, skipped/);

  const ws2 = workspace(["api"], ["staging"]);
  const before = head(ws2.repo("api"), "refs/remotes/origin/staging");
  const dry = run(ws2.root, { dryRun: true });
  assert.match(dry.out(), /·  api:staging — would create /);
  assert.ok(!existsSync(join(ws2.root, "worktree")), "not even the worktree directory");
  assert.equal(head(ws2.repo("api"), "refs/remotes/origin/staging"), before);
});

test("6. JOB-G04: an empty scope logs one line and does nothing; a bad scope refuses before any git", () => {
  const ws = workspace(["api"], ["staging"]);
  const empty = run(ws.root, { scope: scope({ repos: [] }) });
  assert.deepEqual(empty.lines, []);
  assert.equal(empty.logs.length, 1);
  assert.equal(empty.logs[0]!.event, "no-scope");

  const bad = run(ws.root, { scope: scope({ repos: ["../elsewhere"] }) });
  assert.equal(bad.result.exitCode, 1);
  assert.match(bad.out(), /refusing to run: RESET_REPOS: '..\/elsewhere' contains '..'/);
  assert.ok(!existsSync(join(ws.root, "worktree")));
});

test("7. the knobs read 0/1 flags and throw on anything else", () => {
  assert.equal(ensureEnvWorktreesKnobs(reader({ ENV_WORKTREE_QUIET: "1" })).quiet, true);
  assert.throws(() => ensureEnvWorktreesKnobs(reader({ ENV_WORKTREE_DRY_RUN: "yes" })), /ENV_WORKTREE_DRY_RUN/);
});
