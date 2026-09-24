// JOB-G14 — a detached worktree at a pull request's head, for a reviewer to read from.
//
// The repo directory is checked out at main and force-reset every hour, so it answers every read
// with code that is not the PR's — and nothing in the output would say so. A detached tree at the
// PR head is the only correct place to read the PR's files.
//
// `--detach` needs no branch, so it never hits "already checked out" and leaves no branch to
// delete. prep never throws: a missing tree costs read fidelity, and must not also cost the
// review, so every failure becomes an empty path plus a notice. teardown never throws either: a
// stranded worktree is disk, not correctness.
//
// No consumer yet; the PR-review family is the first.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Git, isRepoRoot, lastLine, tryGit, worktreePaths } from "./git.ts";
import { branchProblem, pathProblem, repoSlug } from "./scope.ts";

const LIST = "worktrees.list";

export interface PrWorktreeDeps {
  /** Absolute project root; `repo` resolves inside it. */
  readonly root: string;
  readonly git: Git;
  /** Project-relative directory the trees go in (the GIT_WORKTREE_DIR knob). */
  readonly worktreeDir: string;
}

export interface PrWorktree {
  /** Absolute path to the PR-head tree, or "" when preparation failed. */
  readonly path: string;
  /** `origin/<base>`, the diff base. */
  readonly base: string;
  /** The PR head SHA, or "" on failure. */
  readonly headSha: string;
  /** Why there is no tree, or why the diff must come from elsewhere. "" when all is well. */
  readonly notice: string;
  /** False on a shallow clone, where the PR head shares no ancestor with the base locally. */
  readonly canDiffLocally: boolean;
}

/** Where a PR's run records its trees. One definition, shared by the creator and the reaper: a
 *  reaper that computes its own path removes the wrong directory while the real one piles up. */
export function prWorktreeRunDir(stateDir: string, root: string, repo: string, pr: number): string {
  return join(stateDir, "worktrees", `${repoSlug(root, repo)}-${pr}`);
}

/** Prepare (or refresh) a detached tree at `repo`'s PR head, and record it under `runDir`. */
export function prepPrWorktree(deps: PrWorktreeDeps, repo: string, pr: number, base = "main", runDir = ""): PrWorktree {
  const { root, git } = deps;
  const fallback = (notice: string): PrWorktree => ({ path: "", base: `origin/${base}`, headSha: "", notice, canDiffLocally: false });
  if (!Number.isInteger(pr) || pr <= 0) return fallback(`bad PR number ${pr} → API diff (gh pr diff)`);
  const bad = pathProblem(repo) ?? pathProblem(deps.worktreeDir) ?? branchProblem(base);
  if (bad !== null) return fallback(`bad repo, worktree dir or base (${bad}) → API diff (gh pr diff)`);

  const repoDir = join(root, repo);
  if (!existsSync(repoDir) || !isRepoRoot(git, repoDir)) {
    return fallback(`${repo} not cloned under ${root} → API diff (gh pr diff); file reads may not reflect PR head`);
  }
  if (tryGit(git, repoDir, "fetch", "--quiet", "origin", `pull/${pr}/head`) === null) {
    return fallback(`fetch pull/${pr}/head failed for ${repo} → API diff; file reads may not reflect PR head`);
  }
  const sha = tryGit(git, repoDir, "rev-parse", "FETCH_HEAD");
  if (sha === null || sha === "") return fallback(`could not resolve PR head for ${repo}#${pr} → API diff`);
  tryGit(git, repoDir, "fetch", "--quiet", "origin", base);

  const path = join(root, deps.worktreeDir, `${repoSlug(root, repo)}-pr-${pr}`);
  const registered = worktreePaths(git, repoDir).includes(path);
  try {
    if (registered) git(path, "reset", "--hard", "--quiet", sha);
    else {
      mkdirSync(dirname(path), { recursive: true });
      git(repoDir, "worktree", "add", "--detach", "--quiet", path, sha);
    }
  } catch (e) {
    return fallback(`worktree ${registered ? "refresh" : "add"} failed for ${repo}#${pr}: ${lastLine(e)} → API diff`);
  }

  if (runDir !== "") {
    try {
      mkdirSync(runDir, { recursive: true });
      const listFile = join(runDir, LIST);
      const listed = existsSync(listFile) ? readFileSync(listFile, "utf8").split("\n") : [];
      if (!listed.includes(path)) writeFileSync(listFile, [...listed.filter((l) => l !== ""), path, ""].join("\n"));
    } catch {
      // The tree is still usable; only the reaper loses track of it.
    }
  }

  const canDiffLocally = tryGit(git, path, "merge-base", `origin/${base}`, "HEAD") !== null;
  const notice = canDiffLocally
    ? ""
    : `${repo} is a shallow clone → no merge base with origin/${base}; diff via \`gh pr diff\`, reads still from the worktree`;
  return { path, base: `origin/${base}`, headSha: sha, notice, canDiffLocally };
}

/** Remove every tree recorded under `runDir`. Idempotent; never throws. A tree that will not go
 *  stays in the list for the next pass. */
export function teardownPrWorktrees(git: Git, runDir: string): void {
  const listFile = join(runDir, LIST);
  let paths: string[];
  try {
    paths = readFileSync(listFile, "utf8").split("\n").filter((l) => l !== "");
  } catch {
    return;
  }
  const left: string[] = [];
  for (const path of paths) {
    const common = tryGit(git, path, "rev-parse", "--path-format=absolute", "--git-common-dir");
    if (common === null) continue; // already gone
    if (tryGit(git, dirname(common), "worktree", "remove", "--force", path) === null) left.push(path);
  }
  try {
    if (left.length === 0) rmSync(listFile, { force: true });
    else writeFileSync(listFile, [...left, ""].join("\n"));
  } catch {
    // Disk, not correctness.
  }
}

/** The prompt lines telling a reviewer where to read, and where NOT to. `repoDir` is the repo's
 *  own checkout, the one that must not be read from. */
export function prWorktreePromptLines(wt: PrWorktree, repoDir: string): string[] {
  if (wt.path === "") {
    return [
      `NOTE: no PR-head worktree is available (${wt.notice || "preparation failed"}). Review from`,
      "   `gh pr diff` and treat every file read as possibly NOT reflecting the PR head — say so in",
      "   the review rather than asserting a finding you could not check against the PR's own code.",
    ];
  }
  return [
    `READ THE CODE AT ${wt.path} — a detached worktree checked out at this PR's head`,
    `   (${wt.headSha.slice(0, 7)}). Every file read and grep runs THERE.`,
    "",
    wt.canDiffLocally
      ? `   For the diff: git -C ${wt.path} diff ${wt.base}...HEAD`
      : "   For the DIFF use `gh pr diff` — this clone is shallow, so a local `base...HEAD` diff would\n" +
        "   fail. The worktree is still the correct and only source for FILE CONTENT at the PR head.",
    "",
    `   Do NOT read from ${repoDir} — that directory is checked out at \`main\` and is`,
    "   force-reset hourly, so it answers every read with code that is not this PR's.",
  ];
}
