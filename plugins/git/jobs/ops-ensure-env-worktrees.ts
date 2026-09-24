// JOB-G07/08 — one worktree per env branch, at `<worktreeDir>/<repo>-<branch>`.
//
// This gives reset-branches a tree to `reset --hard`, so "what is on staging" is a file read, not
// a checkout. `main` gets no tree: the repo directory IS main. Idempotent: a second run finds
// every tree in place and changes nothing. It never fetches; it works from the origin refs the
// last fetch left.
//
// JOB-G08: these trees are disposable. Nobody edits in them — reset-branches force-syncs them
// every hour, and it only spares a dirty tree by refusing to touch it.
//
// Not scheduled on its own. reset-branches runs it first, quietly; a human can run it by hand.
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EnvSpec } from "../../../kernel/plugin.ts";
import { type Git, type GitLog, type Say, isRepoRoot, lastLine, tryGit, worktreesByBranch } from "../git.ts";
import { type GitScope, parseFlag, repoSlug, scopeFrom, scopeProblems } from "../scope.ts";

const TAG = "[env-worktrees]";

export const ENV_WORKTREE_DRY_RUN_ENV: EnvSpec = {
  key: "ENV_WORKTREE_DRY_RUN",
  default: "0",
  why: "1 prints what ensure-env-worktrees would create and writes nothing, not even the worktree directory (SAF-01)",
};
export const ENV_WORKTREE_QUIET_ENV: EnvSpec = {
  key: "ENV_WORKTREE_QUIET",
  default: "0",
  why: "1 drops the banner, the already-there lines and an empty done line, so a clean run prints nothing (JOB-G07)",
};

export const ENSURE_ENV_WORKTREES_ENV: readonly EnvSpec[] = [ENV_WORKTREE_DRY_RUN_ENV, ENV_WORKTREE_QUIET_ENV];

export interface EnsureEnvWorktreesKnobs {
  readonly scope: GitScope;
  readonly dryRun: boolean;
  readonly quiet: boolean;
}

export interface EnsureEnvWorktreesDeps {
  /** Absolute project root; every scope entry resolves inside it. */
  readonly root: string;
  readonly git: Git;
  readonly say: Say;
  readonly log: GitLog;
  readonly knobs: EnsureEnvWorktreesKnobs;
}

export interface EnsureEnvWorktreesResult {
  readonly created: number;
  readonly existing: number;
  readonly skipped: number;
  readonly failed: number;
  readonly exitCode: 0 | 1;
}

/** Resolve the knobs through the host's env reader. */
export function ensureEnvWorktreesKnobs(read: (spec: EnvSpec) => string): EnsureEnvWorktreesKnobs {
  return {
    scope: scopeFrom(read),
    dryRun: parseFlag(ENV_WORKTREE_DRY_RUN_ENV, read(ENV_WORKTREE_DRY_RUN_ENV)),
    quiet: parseFlag(ENV_WORKTREE_QUIET_ENV, read(ENV_WORKTREE_QUIET_ENV)),
  };
}

const samePath = (a: string, b: string): boolean => {
  if (resolve(a) === resolve(b)) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
};

export function runEnsureEnvWorktrees(deps: EnsureEnvWorktreesDeps): EnsureEnvWorktreesResult {
  const { root, git, log, knobs } = deps;
  const { scope, dryRun, quiet } = knobs;
  const say = (line: string): void => deps.say(`${TAG} ${line}`);
  const vsay = (line: string): void => {
    if (!quiet) say(line);
  };
  let created = 0;
  let existing = 0;
  let skipped = 0;
  let failed = 0;
  const result = (): EnsureEnvWorktreesResult => ({ created, existing, skipped, failed, exitCode: failed > 0 ? 1 : 0 });

  const problems = scopeProblems(root, scope);
  if (problems.length > 0) {
    for (const p of problems) say(`✗  refusing to run: ${p}`);
    log.error("bad-config", { job: "ops-ensure-env-worktrees", msg: problems[0] });
    failed = problems.length;
    return result();
  }
  if (scope.repos.length === 0) {
    log.info("no-scope", { job: "ops-ensure-env-worktrees", knob: "RESET_REPOS" });
    return result();
  }

  const wtRoot = join(root, scope.worktreeDir);
  if (!dryRun) {
    try {
      mkdirSync(wtRoot, { recursive: true });
    } catch (e) {
      say(`✗  cannot create ${wtRoot}: ${lastLine(e)}`);
      failed++;
      return result();
    }
  }

  if (dryRun) vsay("DRY RUN — no worktrees will be created");
  vsay(`start — ${scope.repos.length} repos, branches: ${scope.worktreeBranches.join(" ")}`);

  for (const repo of scope.repos) {
    const src = join(root, repo);
    if (!existsSync(src) || !isRepoRoot(git, src)) {
      say(`✗  ${repo} — not a git repo, skipped`);
      failed++;
      continue;
    }
    // Clears a registration whose directory was deleted by hand. A write, so never in a dry run.
    if (!dryRun) tryGit(git, src, "worktree", "prune");
    const at = worktreesByBranch(git, src);

    for (const b of scope.worktreeBranches) {
      if (tryGit(git, src, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${b}`) === null) continue;
      const path = join(wtRoot, `${repoSlug(root, repo)}-${b}`);
      const where = at.get(b);
      if (where !== undefined && samePath(where, path)) {
        vsay(`=  ${repo}:${b} — already at ${path}`);
        existing++;
        continue;
      }
      if (where !== undefined) {
        say(`⚠  ${repo}:${b} — already checked out at ${where}, not reprovisioned`);
        skipped++;
        continue;
      }
      if (existsSync(path)) {
        say(`⚠  ${repo}:${b} — ${path} exists but is not a registered worktree, left alone`);
        skipped++;
        continue;
      }
      if (dryRun) {
        say(`·  ${repo}:${b} — would create ${path}`);
        continue;
      }
      const hasLocal = tryGit(git, src, "rev-parse", "--verify", "--quiet", `refs/heads/${b}`) !== null;
      let err = "";
      try {
        if (hasLocal) git(src, "worktree", "add", "--quiet", path, b);
        else git(src, "worktree", "add", "--quiet", "-b", b, path, `origin/${b}`);
      } catch (e) {
        err = lastLine(e);
      }
      if (err === "" && existsSync(join(path, ".git"))) {
        say(`✓  ${repo}:${b} — created ${path}`);
        created++;
      } else {
        say(`✗  ${repo}:${b} — worktree add failed: ${err}`);
        failed++;
      }
    }
  }

  if (!quiet || created + skipped + failed > 0) {
    say(`done — ${created} created, ${existing} existing, ${skipped} skipped, ${failed} failed`);
  }
  if (failed > 0) log.error("env-worktrees-failed", { created, existing, skipped, failed });
  return result();
}
