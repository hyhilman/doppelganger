// JOB-G01/02/03/06 — fetch, then force-sync each LOCAL long-lived branch to `origin/<b>`, in each
// repo in scope. Never pushes.
//
// The `fetch --prune --force` is the real fix (JOB-G01). Agents read `origin/main` as the truth,
// and a stale ref gives an answer that is complete and wrong. The local sync is the second half:
// a person or agent who reads `main` or opens the staging worktree sees what origin has.
//
// Three refusals stand between an hourly `reset --hard` and work that is gone for good (JOB-G02):
//   - unpushed commits that are MINE (author or committer is this repo's user.email). An unknown
//     identity counts as mine, so a repo with no user.email is never discarded.
//   - a checked-out tree with uncommitted changes (untracked files count).
//   - a status that cannot be read; it is never judged clean.
// Unpushed commits that are NOT mine are an upstream force-push (a rewritten deploy branch), and
// refusing them would pin the branch to a dead commit forever — so they are discarded, and said so.
//
// A branch checked out in some tree is reset IN THAT TREE; any other branch moves by `update-ref`
// with the old value, so a branch that moved under us is not overwritten. JOB-G03: a primary
// checkout parked on a feature branch is moved back to main when clean. JOB-G06: skips and
// refusals are not failures; only a failure sets exit 1.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EnvSpec } from "../../../kernel/plugin.ts";
import { type Git, type GitLog, type Say, isRepoRoot, short, tryGit, worktreesByBranch } from "../git.ts";
import { type GitScope, parseFlag, scopeFrom, scopeProblems } from "../scope.ts";
import { runEnsureEnvWorktrees } from "./ops-ensure-env-worktrees.ts";

const TAG = "[reset-branches]";

export const RESET_FORCE_DIRTY_ENV: EnvSpec = {
  key: "RESET_FORCE_DIRTY",
  default: "0",
  why: "1 lets reset-branches reset a dirty checked-out tree (the changes are lost) and switch a dirty parked checkout (JOB-G02)",
};
export const RESET_FORCE_AHEAD_ENV: EnvSpec = {
  key: "RESET_FORCE_AHEAD",
  default: "0",
  why: "1 lets reset-branches discard YOUR commits that are not on origin; they are lost (JOB-G02)",
};
export const RESET_CHECKOUT_MAIN_ENV: EnvSpec = {
  key: "RESET_CHECKOUT_MAIN",
  default: "1",
  why: "1 moves a clean primary checkout parked on a feature branch back to main; 0 only warns (JOB-G03)",
};
export const RESET_DRY_RUN_ENV: EnvSpec = {
  key: "RESET_DRY_RUN",
  default: "0",
  why: "1 still fetches but writes no ref, resets no tree and switches no checkout (SAF-01)",
};
export const RESET_ENSURE_WORKTREES_ENV: EnvSpec = {
  key: "RESET_ENSURE_WORKTREES",
  default: "1",
  why: "1 runs ensure-env-worktrees quietly before the sync, so every env branch has a tree to reset (JOB-G07)",
};

export const RESET_BRANCHES_JOB_ENV: readonly EnvSpec[] = [
  RESET_FORCE_DIRTY_ENV,
  RESET_FORCE_AHEAD_ENV,
  RESET_CHECKOUT_MAIN_ENV,
  RESET_DRY_RUN_ENV,
  RESET_ENSURE_WORKTREES_ENV,
];

export interface ResetBranchesKnobs {
  readonly scope: GitScope;
  readonly forceDirty: boolean;
  readonly forceAhead: boolean;
  readonly checkoutMain: boolean;
  readonly dryRun: boolean;
  readonly ensureWorktrees: boolean;
}

export interface ResetBranchesDeps {
  /** Absolute project root; every scope entry resolves inside it. */
  readonly root: string;
  readonly git: Git;
  readonly say: Say;
  readonly log: GitLog;
  readonly now: () => Date;
  readonly knobs: ResetBranchesKnobs;
}

export interface ResetBranchesResult {
  readonly current: number;
  readonly reset: number;
  readonly created: number;
  readonly skipped: number;
  readonly failed: number;
  readonly exitCode: 0 | 1;
}

/** Resolve the knobs through the host's env reader. */
export function resetBranchesKnobs(read: (spec: EnvSpec) => string): ResetBranchesKnobs {
  const flag = (spec: EnvSpec): boolean => parseFlag(spec, read(spec));
  return {
    scope: scopeFrom(read),
    forceDirty: flag(RESET_FORCE_DIRTY_ENV),
    forceAhead: flag(RESET_FORCE_AHEAD_ENV),
    checkoutMain: flag(RESET_CHECKOUT_MAIN_ENV),
    dryRun: flag(RESET_DRY_RUN_ENV),
    ensureWorktrees: flag(RESET_ENSURE_WORKTREES_ENV),
  };
}

const iso = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** Commits in `range` whose author OR committer is `me` — counted per commit, never per line. */
function countMine(git: Git, repo: string, range: string, me: string): number {
  const out = git(repo, "log", "--format=%ae%x09%ce", range);
  return out
    .split("\n")
    .filter((l) => l !== "")
    .filter((l) => l.split("\t").includes(me)).length;
}

export function runResetBranches(deps: ResetBranchesDeps): ResetBranchesResult {
  const { root, git, log, knobs } = deps;
  const { scope, dryRun } = knobs;
  const say = (line: string): void => deps.say(`${TAG} ${line}`);
  let current = 0;
  let reset = 0;
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const result = (): ResetBranchesResult => ({ current, reset, created, skipped, failed, exitCode: failed > 0 ? 1 : 0 });

  const problems = scopeProblems(root, scope);
  if (problems.length > 0) {
    for (const p of problems) say(`✗  refusing to run: ${p}`);
    log.error("bad-config", { job: "ops-reset-branches", msg: problems[0] });
    failed = problems.length;
    return result();
  }
  if (scope.repos.length === 0) {
    log.info("no-scope", { job: "ops-reset-branches", knob: "RESET_REPOS" });
    return result();
  }

  if (dryRun) say("DRY RUN — no refs will be written");
  say(`start ${iso(deps.now())} — ${scope.repos.length} repos, branches: ${scope.branches.join(" ")}`);

  if (knobs.ensureWorktrees) {
    const ensured = runEnsureEnvWorktrees({ root, git, say: deps.say, log, knobs: { scope, dryRun, quiet: true } });
    // The layout check is its own job's contract; its failure is reported, never counted here.
    if (ensured.exitCode !== 0) say("⚠  env-worktree layout check reported failures");
  }

  for (const repo of scope.repos) {
    const dir = join(root, repo);
    if (!existsSync(dir) || !isRepoRoot(git, dir)) {
      say(`✗  ${repo} — not a git repo, skipped`);
      failed++;
      continue;
    }
    if (tryGit(git, dir, "fetch", "origin", "--prune", "--force", "--quiet") === null) {
      say(`✗  ${repo} — fetch failed`);
      failed++;
      continue;
    }
    const me = tryGit(git, dir, "config", "user.email") ?? "";
    const trees = worktreesByBranch(git, dir);

    for (const b of scope.branches) {
      const label = `${repo}:${b}`;
      const target = tryGit(git, dir, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${b}`);
      if (target === null) continue;
      const local = tryGit(git, dir, "rev-parse", "--verify", "--quiet", `refs/heads/${b}`);
      const from = local === null ? "(new)" : short(local);
      if (local === target) {
        say(`=  ${label} — already at ${short(target)}`);
        current++;
        continue;
      }

      if (local !== null) {
        const range = `refs/remotes/origin/${b}..refs/heads/${b}`;
        const ahead = Number(tryGit(git, dir, "rev-list", "--count", range) ?? "0");
        if (ahead > 0) {
          const mine = me === "" ? ahead : countMine(git, dir, range, me);
          if (mine > 0 && !knobs.forceAhead) {
            say(`⚠  ${label} — ${ahead} unpushed commit(s) at ${from}, ${mine} yours, refused (RESET_FORCE_AHEAD=1 to discard)`);
            skipped++;
            continue;
          }
          if (mine > 0) say(`⚠  ${label} — discarding ${mine} of your commit(s) not on origin (${from})`);
          else say(`·  ${label} — ${ahead} commit(s) rewritten away upstream, none yours`);
        }
      }

      const tree = trees.get(b);
      if (tree !== undefined) {
        const status = tryGit(git, tree, "status", "--porcelain");
        if (status === null) {
          say(`⚠  ${label} — cannot read status at ${tree}, skipped (not judged clean)`);
          skipped++;
          continue;
        }
        if (status !== "" && !knobs.forceDirty) {
          say(`⚠  ${label} — checked out at ${tree} with uncommitted changes, skipped`);
          skipped++;
          continue;
        }
        if (dryRun) {
          say(`·  ${label} — would reset --hard ${from} → ${short(target)} (checked out)`);
          continue;
        }
        if (tryGit(git, tree, "reset", "--hard", "--quiet", target) !== null) {
          say(`✓  ${label} — reset --hard ${from} → ${short(target)} (checked out)`);
          reset++;
        } else {
          say(`✗  ${label} — reset --hard failed at ${tree}`);
          failed++;
        }
        continue;
      }

      if (dryRun) {
        say(`·  ${label} — would set ${from} → ${short(target)}`);
        continue;
      }
      // The old value makes the write conditional: if the branch moved since we read it, git
      // refuses, and that is a failure to look at rather than a silent overwrite.
      const old = local ?? "0".repeat(target.length);
      const moved = tryGit(git, dir, "update-ref", "-m", `reset-branches: force to origin/${b}`, `refs/heads/${b}`, target, old);
      if (moved === null) {
        say(`✗  ${label} — update-ref failed`);
        failed++;
      } else if (local === null) {
        say(`✓  ${label} — created at ${short(target)}`);
        created++;
      } else {
        say(`✓  ${label} — ${from} → ${short(target)}`);
        reset++;
      }
    }

    // JOB-G03: the primary checkout. On a long-lived branch it was handled above.
    const cur = tryGit(git, dir, "rev-parse", "--abbrev-ref", "HEAD") ?? "HEAD";
    if (scope.branches.includes(cur)) continue;
    if (!knobs.checkoutMain) {
      say(`⚠  ${repo} — checkout on '${cur}', not a long-lived branch (RESET_CHECKOUT_MAIN=1 to move it to main)`);
      continue;
    }
    const status = tryGit(git, dir, "status", "--porcelain");
    if (status === null) {
      say(`⚠  ${repo} — cannot read status, checkout left on '${cur}' (not judged clean)`);
      skipped++;
      continue;
    }
    if (status !== "" && !knobs.forceDirty) {
      say(`⚠  ${repo} — checkout on '${cur}' with uncommitted changes, not switched`);
      skipped++;
      continue;
    }
    if (dryRun) {
      say(`·  ${repo} — would move checkout '${cur}' → main`);
      continue;
    }
    // A plain checkout: with RESET_FORCE_DIRTY=1 a dirty file is carried along, or git refuses on
    // a conflict. It never throws the change away.
    if (tryGit(git, dir, "checkout", "--quiet", "main") !== null) {
      say(`✓  ${repo} — checkout moved '${cur}' → main`);
      reset++;
    } else {
      say(`✗  ${repo} — checkout switch '${cur}' → main failed`);
      failed++;
    }
  }

  say(`done — ${current} already-current, ${reset} reset, ${created} created, ${skipped} skipped, ${failed} failed`);
  const fields = { current, reset, created, skipped, failed };
  if (failed > 0) log.error("reset-branches-failed", fields);
  else log.info("reset-branches", fields);
  return result();
}
