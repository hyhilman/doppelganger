// JOB-G01/02/03/06 — the reset-branches guards, driven against REAL git in throwaway workspaces.
//
// Each guard is a plain check, and every way of breaking one is silent: the job still exits 0,
// still prints a tidy `done` line, and the loss shows up as a file someone wrote yesterday that is
// not there today. So each refusal runs against real git, and each has a partner showing the same
// fixture going through when it should — a guard that refuses everything is its own fault.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupWorkspaces, git, head, recorder, subject, workspace } from "../repo.fixture.ts";
import { scopeFrom } from "../scope.ts";
import type { EnvSpec } from "../../../kernel/plugin.ts";
import { runResetBranches, resetBranchesKnobs, type ResetBranchesKnobs } from "./ops-reset-branches.ts";

after(cleanupWorkspaces);

const reader = (env: Record<string, string>) => ({ env: { str: (spec: EnvSpec): string => env[spec.key] ?? spec.default ?? "" } });

/** One run over `root`, with the reference test's settings: only `main`, no worktree step. */
function run(root: string, env: Record<string, string> = {}) {
  const rec = recorder();
  const knobs: ResetBranchesKnobs = resetBranchesKnobs(
    reader({ RESET_REPOS: "api web", RESET_BRANCHES: "main", ENV_WORKTREE_BRANCHES: "", RECUT_BRANCHES: "", RESET_ENSURE_WORKTREES: "0", ...env }),
  );
  const result = runResetBranches({ root, git, say: rec.say, log: rec.log, now: () => new Date("2026-09-24T10:45:00Z"), knobs });
  return { ...rec, result };
}

test("1. JOB-G02: a checked-out tree with uncommitted changes is skipped, and the work is left exactly where it was", () => {
  const ws = workspace();
  const repo = ws.repo("api");
  writeFileSync(join(repo, "f.txt"), "an hour of work nobody pushed\n");
  const r = run(ws.root);
  assert.equal(r.result.exitCode, 0, "a skip is not a failure");
  assert.match(r.out(), /uncommitted changes, skipped/);
  assert.equal(subject(repo), "first", "the branch was not moved");
  assert.equal(readFileSync(join(repo, "f.txt"), "utf8"), "an hour of work nobody pushed\n");
  assert.equal(subject(ws.repo("web")), "second", "the guard refused ONE tree, not the whole sweep");
});

test("2. JOB-G02: the same tree is reset once RESET_FORCE_DIRTY=1 consents", () => {
  const ws = workspace();
  const repo = ws.repo("api");
  writeFileSync(join(repo, "f.txt"), "discard me\n");
  const r = run(ws.root, { RESET_FORCE_DIRTY: "1" });
  assert.equal(r.result.exitCode, 0);
  assert.match(r.out(), /reset --hard/);
  assert.equal(subject(repo), "second");
  assert.equal(readFileSync(join(repo, "f.txt"), "utf8"), "second\n");
});

test("3. JOB-G02: a branch carrying MY unpushed commit is refused, and the commit survives", () => {
  const ws = workspace();
  const repo = ws.repo("api");
  writeFileSync(join(repo, "mine.txt"), "local work\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "wip: mine");
  const r = run(ws.root);
  assert.equal(r.result.exitCode, 0);
  assert.match(r.out(), /unpushed commit\(s\).*1 yours, refused/);
  assert.equal(subject(repo), "wip: mine");
});

test("4. JOB-G02: unpushed commits that are NOT mine are an upstream rewrite, and are discarded", () => {
  const ws = workspace();
  const repo = ws.repo("api");
  writeFileSync(join(repo, "bot.txt"), "ci\n");
  git(repo, "add", "-A");
  git(repo, "-c", "user.email=bot@ci", "-c", "user.name=bot", "commit", "-qm", "feat: dev deployment");
  const r = run(ws.root);
  assert.equal(r.result.exitCode, 0);
  assert.match(r.out(), /rewritten away upstream, none yours/);
  assert.equal(subject(repo), "second");
});

test("5. JOB-G02: an unknown identity counts as MINE, so a repo with no user.email is never discarded", () => {
  const ws = workspace();
  const repo = ws.repo("api");
  git(repo, "config", "--unset", "user.email");
  writeFileSync(join(repo, "x.txt"), "who wrote this\n");
  git(repo, "add", "-A");
  git(repo, "-c", "user.email=bot@ci", "-c", "user.name=bot", "commit", "-qm", "unattributable");
  const r = run(ws.root);
  assert.match(r.out(), /unpushed commit\(s\).*refused/);
  assert.equal(subject(repo), "unattributable");
});

test("6. JOB-G03: a parked checkout with uncommitted changes is not switched back to main", () => {
  const ws = workspace();
  const repo = ws.repo("api");
  git(repo, "checkout", "-q", "-b", "XEN-1234-feature");
  writeFileSync(join(repo, "wip.txt"), "half a fix\n");
  const r = run(ws.root);
  assert.equal(r.result.exitCode, 0);
  assert.match(r.out(), /uncommitted changes, not switched/);
  assert.equal(git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim(), "XEN-1234-feature");
  assert.equal(readFileSync(join(repo, "wip.txt"), "utf8"), "half a fix\n");
});

test("7. JOB-G03: a CLEAN parked checkout is moved back to main", () => {
  const ws = workspace();
  const repo = ws.repo("api");
  git(repo, "checkout", "-q", "-b", "XEN-1234-feature");
  const r = run(ws.root);
  assert.equal(r.result.exitCode, 0);
  assert.match(r.out(), /checkout moved 'XEN-1234-feature' → main/);
  assert.equal(git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim(), "main");
  assert.equal(subject(repo), "second", "main was synced before the switch");
});

test("8. JOB-G01: a branch not checked out moves by update-ref, a missing one is created, a current one is left", () => {
  const ws = workspace(["api"], ["staging", "dev"]);
  const repo = ws.repo("api");
  git(repo, "branch", "-q", "staging", "origin/staging");
  const stagingTip = ws.upstream("staging", "s.txt", "s\n", "staging work");
  const r = run(ws.root, { RESET_REPOS: "api", RESET_BRANCHES: "main staging dev development" });
  assert.equal(r.result.exitCode, 0, r.out());
  assert.equal(head(repo, "refs/heads/staging"), stagingTip);
  assert.match(r.out(), /✓  api:staging — [0-9a-f]{8} → [0-9a-f]{8}/);
  assert.match(r.out(), /✓  api:dev — created at [0-9a-f]{8}/);
  assert.ok(!r.out().includes("api:development"), "a branch origin lacks is skipped in silence");
  assert.match(r.out(), /done — 0 already-current, 2 reset, 1 created, 0 skipped, 0 failed/);

  const again = run(ws.root, { RESET_REPOS: "api", RESET_BRANCHES: "main staging dev" });
  assert.equal(again.result.current, 3);
  assert.equal(again.result.reset + again.result.created, 0);
});

test("9. JOB-G07 + G01: with the worktree step on, the env tree is created and then reset in place", () => {
  const ws = workspace(["api"], ["staging"]);
  run(ws.root, { RESET_REPOS: "api", RESET_BRANCHES: "main staging", ENV_WORKTREE_BRANCHES: "staging", RESET_ENSURE_WORKTREES: "1" });
  const tree = join(ws.root, ".doppelganger", "worktree", "api-staging");
  const tip = ws.upstream("staging", "s.txt", "new\n", "staging moved");
  const r = run(ws.root, { RESET_REPOS: "api", RESET_BRANCHES: "main staging", ENV_WORKTREE_BRANCHES: "staging", RESET_ENSURE_WORKTREES: "1" });
  assert.match(r.out(), /✓  api:staging — reset --hard .* \(checked out\)/, r.out());
  assert.equal(head(tree), tip);
  assert.equal(readFileSync(join(tree, "s.txt"), "utf8"), "new\n");
});

test("10. SAF-01: a dry run fetches, still prints the refusals, and writes no ref", () => {
  const ws = workspace();
  const api = ws.repo("api");
  const web = ws.repo("web");
  writeFileSync(join(api, "f.txt"), "dirty\n");
  const before = head(web);
  git(web, "checkout", "-q", "-b", "parked");
  const r = run(ws.root, { RESET_DRY_RUN: "1" });
  assert.match(r.out(), /DRY RUN — no refs will be written/);
  assert.match(r.out(), /api:main — checked out at .* with uncommitted changes, skipped/);
  assert.match(r.out(), /·  web:main — would set [0-9a-f]{8} → [0-9a-f]{8}/);
  assert.match(r.out(), /·  web — would move checkout 'parked' → main/);
  assert.equal(head(web, "refs/heads/main"), before, "no ref moved");
  assert.equal(git(web, "rev-parse", "--abbrev-ref", "HEAD").trim(), "parked");
  assert.notEqual(head(web, "refs/remotes/origin/main"), before, "but the fetch did run");
});

test("11. JOB-G06: a missing repo is a failure (exit 1); a missing branch is not", () => {
  const ws = workspace(["api"]);
  const r = run(ws.root, { RESET_REPOS: "api gone" });
  assert.equal(r.result.exitCode, 1);
  assert.match(r.out(), /✗  gone — not a git repo, skipped/);
  assert.equal(subject(ws.repo("api")), "second", "the other repo is still synced");
  assert.equal(r.logs.at(-1)!.event, "reset-branches-failed");
});

test("12. JOB-G04: an empty scope logs one line and touches nothing", () => {
  const ws = workspace(["api"]);
  const r = run(ws.root, { RESET_REPOS: "" });
  assert.deepEqual(r.lines, []);
  assert.deepEqual(r.logs.map((l) => l.event), ["no-scope"]);
  assert.equal(subject(ws.repo("api")), "first");
  assert.deepEqual(scopeFrom(reader({})).repos, [], "and empty is the default");
});

test("13. JOB-G04: the checkout itself is refused before any fetch, so a bot's unpushed landing on main survives", () => {
  // The project root IS a clone here, one commit behind origin, with a landing by another identity
  // on top. Unrefused, the sync reads that commit as an upstream rewrite and throws it away.
  const ws = workspace(["api"]);
  const root = ws.repo("api");
  writeFileSync(join(root, "landed.txt"), "a nightly landing nobody pushed\n");
  git(root, "add", "-A");
  git(root, "-c", "user.email=bot@nightly", "-c", "user.name=bot", "commit", "-qm", "nightly: landed");
  const before = head(root);
  for (const self of [".", "./"]) {
    const r = run(root, { RESET_REPOS: self });
    assert.equal(r.result.exitCode, 1, "a refusal of the whole scope is a failure to look at");
    assert.match(r.out(), /is this checkout itself/);
    assert.equal(head(root), before, "main did not move");
    assert.equal(subject(root), "nightly: landed");
  }
});
