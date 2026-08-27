// prep, teardown, reap. Every test builds a real git repo under mkdtempSync.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepWorktree, teardownWorktree, reapWorktrees, worktreePromptLines } from "./worktree.ts";

function sh(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
}

/** A fresh repo with one commit on `main`. */
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "wt-repo-"));
  sh(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "hello\n");
  sh(repo, "add", "-A");
  sh(repo, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "init");
  return repo;
}

function headSha(dir: string): string {
  return sh(dir, "rev-parse", "HEAD").trim();
}

test("1. prepWorktree creates and registers the directory, checks out the branch, head equals the base's SHA", () => {
  const repo = makeRepo();
  const path = join(mkdtempSync(join(tmpdir(), "wt-parent-")), "wt1");
  const wt = prepWorktree(repo, { branch: "nightly/probe", base: "main" }, path);
  assert.equal(wt.head, headSha(repo));
  assert.ok(existsSync(join(wt.path, "README.md")));
  assert.ok(sh(repo, "worktree", "list").includes(wt.path));
});

test("2. idempotent — prepping twice, git worktree list still shows exactly one entry for it", () => {
  const repo = makeRepo();
  const path = join(mkdtempSync(join(tmpdir(), "wt-parent-")), "wt2");
  prepWorktree(repo, { branch: "nightly/probe", base: "main" }, path);
  prepWorktree(repo, { branch: "nightly/probe", base: "main" }, path);
  const count = sh(repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((l) => l === `worktree ${path}`).length;
  assert.equal(count, 1);
});

test("3. the crash case — an uncommitted file inside is gone after a re-prep", () => {
  const repo = makeRepo();
  const path = join(mkdtempSync(join(tmpdir(), "wt-parent-")), "wt3");
  const wt = prepWorktree(repo, { branch: "nightly/probe", base: "main" }, path);
  writeFileSync(join(wt.path, "half-edit.txt"), "leftover");
  prepWorktree(repo, { branch: "nightly/probe", base: "main" }, path);
  const status = sh(wt.path, "status", "--porcelain");
  assert.equal(status.trim(), "");
  assert.equal(existsSync(join(wt.path, "half-edit.txt")), false);
});

test("4. node_modules survives a re-prep (-e node_modules)", () => {
  const repo = makeRepo();
  const path = join(mkdtempSync(join(tmpdir(), "wt-parent-")), "wt4");
  const wt = prepWorktree(repo, { branch: "nightly/probe", base: "main" }, path);
  const nmTarget = mkdtempSync(join(tmpdir(), "wt-nm-target-"));
  symlinkSync(nmTarget, join(wt.path, "node_modules"));
  prepWorktree(repo, { branch: "nightly/probe", base: "main" }, path);
  assert.ok(existsSync(join(wt.path, "node_modules")), "node_modules symlink must survive a re-prep");
});

test("5. reset onto a moved base — advancing main and re-prepping moves head to the new SHA", () => {
  const repo = makeRepo();
  const path = join(mkdtempSync(join(tmpdir(), "wt-parent-")), "wt5");
  prepWorktree(repo, { branch: "nightly/probe", base: "main" }, path);
  writeFileSync(join(repo, "second.txt"), "more\n");
  sh(repo, "add", "-A");
  sh(repo, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "second");
  const wt2 = prepWorktree(repo, { branch: "nightly/probe", base: "main" }, path);
  assert.equal(wt2.head, headSha(repo));
});

test("6. teardownWorktree removes and deregisters; twice does not throw", () => {
  const repo = makeRepo();
  const path = join(mkdtempSync(join(tmpdir(), "wt-parent-")), "wt6");
  prepWorktree(repo, { branch: "nightly/probe", base: "main" }, path);
  teardownWorktree(repo, path);
  assert.ok(!sh(repo, "worktree", "list").includes(path));
  assert.doesNotThrow(() => teardownWorktree(repo, path));
});

test("7. reapWorktrees removes a stranded sibling and keeps the live one, naming exactly the stranded one", () => {
  const repo = makeRepo();
  const under = mkdtempSync(join(tmpdir(), "wt-under-"));
  const live = prepWorktree(repo, { branch: "nightly/live", base: "main" }, join(under, "live"));
  const stray = prepWorktree(repo, { branch: "nightly/stray", base: "main" }, join(under, "stray"));
  const removed = reapWorktrees(repo, under, live.path);
  assert.deepEqual(removed, [stray.path]);
  assert.ok(sh(repo, "worktree", "list").includes(live.path));
  assert.ok(!sh(repo, "worktree", "list").includes(stray.path));
});

test("8. reapWorktrees never touches a worktree outside `under`", () => {
  const repo = makeRepo();
  const under = mkdtempSync(join(tmpdir(), "wt-under-"));
  const outside = mkdtempSync(join(tmpdir(), "wt-outside-"));
  const live = prepWorktree(repo, { branch: "nightly/live", base: "main" }, join(under, "live"));
  const sibling = prepWorktree(repo, { branch: "nightly/sibling", base: "main" }, join(outside, "sibling"));
  const removed = reapWorktrees(repo, under, live.path);
  assert.ok(!removed.includes(sibling.path));
  assert.ok(sh(repo, "worktree", "list").includes(sibling.path));
});

test("9. prune-first — an rm -rf'd registered worktree is cleared and reap does not throw", () => {
  const repo = makeRepo();
  const under = mkdtempSync(join(tmpdir(), "wt-under-"));
  const live = prepWorktree(repo, { branch: "nightly/live", base: "main" }, join(under, "live"));
  const gone = prepWorktree(repo, { branch: "nightly/gone", base: "main" }, join(under, "gone"));
  rmSync(gone.path, { recursive: true, force: true });
  assert.doesNotThrow(() => reapWorktrees(repo, under, live.path));
  assert.ok(!sh(repo, "worktree", "list").includes(gone.path));
});

test("10. worktreePromptLines names the path, the base ref and the short head SHA, and no plugins//.claude/ path", () => {
  const repo = makeRepo();
  const path = join(mkdtempSync(join(tmpdir(), "wt-parent-")), "wt10");
  const wt = prepWorktree(repo, { branch: "nightly/probe", base: "main" }, path);
  const lines = worktreePromptLines(wt).join("\n");
  assert.ok(lines.includes(wt.path));
  assert.ok(lines.includes("main"));
  assert.ok(lines.includes(wt.head.slice(0, 7)));
  assert.ok(!lines.includes("plugins/"));
  assert.ok(!lines.includes(".claude/"));
});
