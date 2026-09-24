// JOB-G04/05 — scope parsing and the rules that keep a reset away from the wrong repo.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnvSpec } from "../../kernel/plugin.ts";
import {
  SCOPE_ENV,
  splitList,
  scopeFrom,
  scopeProblems,
  pathProblem,
  branchProblem,
  repoSlug,
  parseFlag,
  isCheckoutItself,
  RESET_REPOS_ENV,
  type GitScope,
} from "./scope.ts";

const ROOT = "/srv/proj";

/** A reader over a plain map, falling back to each row's default — the shape of the host's envStr. */
const reader = (env: Record<string, string>) => ({ env: { str: (spec: EnvSpec): string => env[spec.key] ?? spec.default ?? "" } });

const scope = (env: Record<string, string> = {}): GitScope => scopeFrom(reader(env));

test("1. JOB-G04: the default scope is EMPTY and valid, so an installed plugin touches nothing", () => {
  const s = scope();
  assert.deepEqual(s.repos, []);
  assert.deepEqual(s.recutRepos, []);
  assert.deepEqual(scopeProblems(ROOT, s), []);
});

test("2. JOB-G05: the default branch lists keep the reference's shape", () => {
  const s = scope();
  assert.deepEqual(s.branches, ["main", "staging", "development", "dev"]);
  assert.deepEqual(s.worktreeBranches, ["staging", "development", "dev"]);
  assert.deepEqual(s.recutBranches, ["staging", "development"]);
});

test("3. JOB-G04: lists split on spaces and commas, and entries are normalized", () => {
  assert.deepEqual(splitList(" a, b  c,,d "), ["a", "b", "c", "d"]);
  assert.deepEqual(scope({ RESET_REPOS: "./api/, web//app ." }).repos, ["api", "web/app", "."]);
});

test("4. JOB-G04: an absolute path, a '..' or a glob is refused, not resolved", () => {
  for (const bad of ["/abs/repo", "~/repo", "a/../b", "..", "repos/*", "api?", "a[bc]", "{a,b}", "C:\\x", "-rf"]) {
    assert.notEqual(pathProblem(bad), null, bad);
  }
  for (const good of ["api", "repos/api", ".", "a.b-c_d"]) assert.equal(pathProblem(good), null, good);
  const problems = scopeProblems(ROOT, scope({ RESET_REPOS: "api /etc repos/*" }));
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.ok(problems.every((p) => p.startsWith("RESET_REPOS:")));
});

test("5. JOB-G05: a branch name that is not plain is refused (never read as a git option)", () => {
  for (const bad of ["-D", "a..b", "a b", "x/", "x.lock", "*"]) assert.notEqual(branchProblem(bad), null, bad);
  for (const good of ["main", "release/1.2", "XEN-1_fix"]) assert.equal(branchProblem(good), null, good);
});

test("6. JOB-G05: worktree and re-cut branches are subsets of RESET_BRANCHES and never main or master", () => {
  const p = scopeProblems(ROOT, scope({ ENV_WORKTREE_BRANCHES: "staging qa main", RECUT_BRANCHES: "master staging" }));
  assert.ok(p.some((l) => l.includes("ENV_WORKTREE_BRANCHES: 'qa' is not in RESET_BRANCHES")), p.join("\n"));
  assert.ok(p.some((l) => l.includes("ENV_WORKTREE_BRANCHES: 'main' may not be listed")), p.join("\n"));
  assert.ok(p.some((l) => l.includes("RECUT_BRANCHES: 'master' may not be listed")), p.join("\n"));
  assert.equal(p.length, 3, p.join("\n"));
});

test("7. JOB-G04: RECUT_REPOS is a subset of RESET_REPOS", () => {
  assert.deepEqual(scopeProblems(ROOT, scope({ RESET_REPOS: "api web", RECUT_REPOS: "api" })), []);
  assert.deepEqual(scopeProblems(ROOT, scope({ RESET_REPOS: "api", RECUT_REPOS: "web" })), [
    "RECUT_REPOS: 'web' is not in RESET_REPOS",
  ]);
});

test("8. JOB-G04: a duplicate entry, or two repos sharing one worktree name, is refused", () => {
  const p = scopeProblems(ROOT, scope({ RESET_REPOS: "api ./api a/b a-b" }));
  assert.ok(p.includes("RESET_REPOS: 'api' is listed twice"), p.join("\n"));
  assert.ok(p.some((l) => l.includes("share the worktree name 'a-b'")), p.join("\n"));
});

test("9. the worktree dir is project-relative and below the root", () => {
  assert.deepEqual(scopeProblems(ROOT, scope({ GIT_WORKTREE_DIR: "/tmp/wt" })).length, 1);
  assert.deepEqual(scopeProblems(ROOT, scope({ GIT_WORKTREE_DIR: "." })).length, 1);
  assert.equal(scope().worktreeDir, ".doppelganger/worktree");
});

test("10. repoSlug: a nested path joins with '-', '.' takes the root's own name", () => {
  assert.equal(repoSlug(ROOT, "repos/api"), "repos-api");
  assert.equal(repoSlug(ROOT, "."), "proj");
});

test("11. parseFlag: 0 and 1 only; anything else throws naming the key", () => {
  assert.equal(parseFlag(RESET_REPOS_ENV, "1"), true);
  assert.equal(parseFlag(RESET_REPOS_ENV, "0"), false);
  assert.throws(() => parseFlag(RESET_REPOS_ENV, "true"), /RESET_REPOS: must read "0" or "1", got "true"/);
});

test("12. every scope row has a one-line why and a default", () => {
  for (const row of SCOPE_ENV) {
    assert.ok(row.why.length > 0 && !row.why.includes("\n"), row.key);
    assert.notEqual(row.default, undefined, row.key);
  }
});

test("13. JOB-G04: a repo entry that is this checkout itself is refused, in both repo lists", () => {
  for (const self of [".", "./", "./.", ".//"]) {
    const p = scopeProblems(ROOT, scope({ RESET_REPOS: `api ${self}`, RECUT_REPOS: self }));
    assert.ok(p.includes("RESET_REPOS: '.' is this checkout itself; its own branches are never synced or re-cut"), `${self}: ${p.join("\n")}`);
    assert.ok(p.includes("RECUT_REPOS: '.' is this checkout itself; its own branches are never synced or re-cut"), `${self}: ${p.join("\n")}`);
  }
  assert.deepEqual(scopeProblems(ROOT, scope({ RESET_REPOS: "api" })), [], "a real sub-repo is still fine");
});

const tmp = mkdtempSync(join(tmpdir(), "git-scope-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("14. JOB-G04: a link inside the root that points back at the root is the checkout itself too", () => {
  const root = join(tmp, "proj");
  mkdirSync(join(root, "api"), { recursive: true });
  symlinkSync(root, join(root, "self"));
  assert.equal(isCheckoutItself(root, "self"), true);
  assert.equal(isCheckoutItself(root, "api"), false);
  assert.equal(isCheckoutItself(root, "missing"), false, "a missing path is a missing repo, reported by the job");
  assert.deepEqual(scopeProblems(root, scope({ RESET_REPOS: "api self" })), [
    "RESET_REPOS: 'self' is this checkout itself; its own branches are never synced or re-cut",
  ]);
});
