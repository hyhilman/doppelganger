// JOB-G14 — the PR-head detached worktree: prep, refresh, teardown and the prompt lines, against a
// bare origin that carries a `refs/pull/<N>/head` ref the way GitHub does.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupWorkspaces, git, head, workspace, type Workspace } from "./repo.fixture.ts";
import { prepPrWorktree, prWorktreePromptLines, prWorktreeRunDir, teardownPrWorktrees, type PrWorktreeDeps } from "./pr-worktree.ts";

after(cleanupWorkspaces);

/** Push a commit off main to origin's `refs/pull/<pr>/head`, as GitHub publishes a PR. */
function publishPr(ws: Workspace, pr: number, body: string): string {
  git(ws.seed, "fetch", "-q", "origin");
  git(ws.seed, "checkout", "-q", "--detach", "origin/main");
  writeFileSync(join(ws.seed, "pr.txt"), body);
  git(ws.seed, "add", "-A");
  git(ws.seed, "commit", "-qm", `pr ${pr}`);
  git(ws.seed, "push", "-q", "--force", "origin", `HEAD:refs/pull/${pr}/head`);
  return head(ws.seed);
}

const depsFor = (ws: Workspace): PrWorktreeDeps => ({ root: ws.root, git, worktreeDir: ".doppelganger/worktrees/git" });

test("1. JOB-G14: prep makes a detached tree at the PR head and records it for the reaper", () => {
  const ws = workspace(["api"]);
  const sha = publishPr(ws, 7, "the change\n");
  const runDir = prWorktreeRunDir(join(ws.dir, "state"), ws.root, "api", 7);
  const wt = prepPrWorktree(depsFor(ws), "api", 7, "main", runDir);
  assert.equal(wt.notice, "");
  assert.equal(wt.path, join(ws.root, ".doppelganger", "worktrees", "git", "api-pr-7"));
  assert.equal(wt.headSha, sha);
  assert.equal(wt.base, "origin/main");
  assert.equal(wt.canDiffLocally, true);
  assert.equal(head(wt.path), sha);
  assert.equal(git(wt.path, "rev-parse", "--abbrev-ref", "HEAD").trim(), "HEAD", "detached, no branch to clean up");
  assert.equal(readFileSync(join(wt.path, "pr.txt"), "utf8"), "the change\n");
  assert.equal(git(ws.repo("api"), "rev-parse", "--abbrev-ref", "HEAD").trim(), "main", "the repo checkout is untouched");
  assert.equal(readFileSync(join(runDir, "worktrees.list"), "utf8"), `${wt.path}\n`);
});

test("2. JOB-G14: a second prep refreshes the same tree to the new head, and the list stays deduplicated", () => {
  const ws = workspace(["api"]);
  publishPr(ws, 7, "v1\n");
  const runDir = join(ws.dir, "state", "worktrees", "api-7");
  prepPrWorktree(depsFor(ws), "api", 7, "main", runDir);
  const sha2 = publishPr(ws, 7, "v2\n");
  const wt = prepPrWorktree(depsFor(ws), "api", 7, "main", runDir);
  assert.equal(wt.headSha, sha2);
  assert.equal(head(wt.path), sha2);
  assert.equal(readFileSync(join(wt.path, "pr.txt"), "utf8"), "v2\n");
  assert.equal(readFileSync(join(runDir, "worktrees.list"), "utf8"), `${wt.path}\n`);
});

test("3. JOB-G14: prep never throws — a missing repo or a missing PR ref is a notice and an empty path", () => {
  const ws = workspace(["api"]);
  const gone = prepPrWorktree(depsFor(ws), "gone", 7);
  assert.equal(gone.path, "");
  assert.match(gone.notice, /gone not cloned under/);
  const noPr = prepPrWorktree(depsFor(ws), "api", 99);
  assert.equal(noPr.path, "");
  assert.match(noPr.notice, /fetch pull\/99\/head failed for api/);
  const badRepo = prepPrWorktree(depsFor(ws), "../api", 7);
  assert.equal(badRepo.path, "");
  assert.match(badRepo.notice, /contains '\.\.'/);
});

test("4. JOB-G14: teardown removes every recorded tree, then is a no-op; no list means nothing to do", () => {
  const ws = workspace(["api"]);
  publishPr(ws, 7, "x\n");
  publishPr(ws, 8, "y\n");
  const runDir = join(ws.dir, "state", "worktrees", "api-7");
  const a = prepPrWorktree(depsFor(ws), "api", 7, "main", runDir);
  const b = prepPrWorktree(depsFor(ws), "api", 8, "main", runDir);
  teardownPrWorktrees(git, runDir);
  assert.ok(!existsSync(a.path) && !existsSync(b.path));
  const listed = git(ws.repo("api"), "worktree", "list", "--porcelain");
  assert.ok(!listed.includes("api-pr-"), listed);
  assert.ok(!existsSync(join(runDir, "worktrees.list")));
  teardownPrWorktrees(git, runDir);
  teardownPrWorktrees(git, join(ws.dir, "never-made"));
});

test("5. JOB-G14: the prompt lines name the tree and forbid the repo dir; with no tree they say so", () => {
  const ws = workspace(["api"]);
  publishPr(ws, 7, "x\n");
  const wt = prepPrWorktree(depsFor(ws), "api", 7);
  const lines = prWorktreePromptLines(wt, ws.repo("api")).join("\n");
  assert.ok(lines.includes(`READ THE CODE AT ${wt.path}`));
  assert.ok(lines.includes(wt.headSha.slice(0, 7)));
  assert.ok(lines.includes(`git -C ${wt.path} diff origin/main...HEAD`));
  assert.ok(lines.includes(`Do NOT read from ${ws.repo("api")}`));

  const shallow = prWorktreePromptLines({ ...wt, canDiffLocally: false }, ws.repo("api")).join("\n");
  assert.ok(shallow.includes("use `gh pr diff`"));

  const none = prWorktreePromptLines({ path: "", base: "origin/main", headSha: "", notice: "api not cloned", canDiffLocally: false }, ws.repo("api")).join("\n");
  assert.ok(none.startsWith("NOTE: no PR-head worktree is available (api not cloned)"));
  assert.ok(none.includes("`gh pr diff`"));
  assert.ok(none.includes("possibly NOT reflecting the PR head"));
});
