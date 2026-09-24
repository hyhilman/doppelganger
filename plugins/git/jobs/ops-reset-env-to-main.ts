// JOB-G09/10/11/12 — weekly, force origin's env branches back to `origin/main`, pushing a dated
// backup first. THIS JOB WRITES THE REMOTE.
//
// The backup is the only way back, so it is pushed BEFORE the re-cut, and a failed backup push
// stops that branch (JOB-G10). The re-cut push carries a lease pinned to the head we snapshotted:
// if someone pushed to the branch since our fetch, origin refuses and the backup still stands.
// The job never touches `main` itself, and makes no local branch or worktree.
//
// JOB-G11: `main` or `master` in RECUT_BRANCHES would re-cut the branch the others derive from,
// so the job refuses to run at all, before any fetch.
//
// JOB-G12: the count is "commit(s) not on main", never "discarded". A squash merge leaves the
// original commits off main even though their change is there, so the count overstates loss.
//
// Backups are named `backup/<b>-pre-reset-<date>`: while `refs/heads/staging` exists,
// `refs/heads/staging/…` cannot.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { killSwitch, type EnvSpec } from "../../../kernel/plugin.ts";
import { type Git, type GitLog, type Say, isRepoRoot, short, tryGit } from "../git.ts";
import { type GitScope, parseFlag, scopeFrom, scopeProblems } from "../scope.ts";

const TAG = "[reset-env-to-main]";

export const GIT_NO_RECUT_ENV: EnvSpec = killSwitch(
  "git",
  "recut",
  "1 stops reset-env-to-main before it fetches or pushes anything; the weekly re-cut of env branches is skipped (JOB-G09)",
);
export const RECUT_DRY_RUN_ENV: EnvSpec = {
  key: "RECUT_DRY_RUN",
  default: "0",
  why: "1 still fetches and prints each backup and re-cut it would push, and pushes nothing (SAF-01)",
};
export const RECUT_FORCE_ENV: EnvSpec = {
  key: "RECUT_FORCE",
  default: "0",
  why: "1 re-cuts even when today's backup exists at another commit, saving the new head as a second backup beside it (JOB-G10)",
};
export const RECUT_DATE_ENV: EnvSpec = {
  key: "RECUT_DATE",
  default: "",
  why: "YYYY-MM-DD stamp in the backup branch name; empty means today in UTC (JOB-G10)",
};

export const RESET_ENV_TO_MAIN_ENV: readonly EnvSpec[] = [RECUT_DRY_RUN_ENV, RECUT_FORCE_ENV, RECUT_DATE_ENV];

export interface ResetEnvToMainKnobs {
  readonly scope: GitScope;
  readonly killed: boolean;
  readonly dryRun: boolean;
  readonly force: boolean;
  /** "" means today in UTC. */
  readonly date: string;
}

export interface ResetEnvToMainDeps {
  /** Absolute project root; every scope entry resolves inside it. */
  readonly root: string;
  readonly git: Git;
  readonly say: Say;
  readonly log: GitLog;
  readonly now: () => Date;
  readonly knobs: ResetEnvToMainKnobs;
}

export interface ResetEnvToMainResult {
  readonly current: number;
  readonly recut: number;
  readonly skipped: number;
  readonly failed: number;
  readonly exitCode: 0 | 1;
}

/** Resolve the knobs through the host's env reader. The kill switch reads with the same 0/1
 *  rule as `isKilled`. */
export function resetEnvToMainKnobs(read: (spec: EnvSpec) => string): ResetEnvToMainKnobs {
  return {
    scope: scopeFrom(read),
    killed: parseFlag(GIT_NO_RECUT_ENV, read(GIT_NO_RECUT_ENV)),
    dryRun: parseFlag(RECUT_DRY_RUN_ENV, read(RECUT_DRY_RUN_ENV)),
    force: parseFlag(RECUT_FORCE_ENV, read(RECUT_FORCE_ENV)),
    date: read(RECUT_DATE_ENV).trim(),
  };
}

const NEVER_RECUT = ["main", "master"];
const iso = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export function runResetEnvToMain(deps: ResetEnvToMainDeps): ResetEnvToMainResult {
  const { root, git, log, knobs } = deps;
  const { scope, dryRun } = knobs;
  const say = (line: string): void => deps.say(`${TAG} ${line}`);
  let current = 0;
  let recut = 0;
  let skipped = 0;
  let failed = 0;
  const result = (): ResetEnvToMainResult => ({ current, recut, skipped, failed, exitCode: failed > 0 ? 1 : 0 });
  const refuse = (line: string, fields: Record<string, unknown>): ResetEnvToMainResult => {
    say(`✗  refusing to run: ${line}`);
    log.error("bad-config", { job: "ops-reset-env-to-main", ...fields });
    failed++;
    return result();
  };

  if (knobs.killed) {
    log.info("killed", { job: "ops-reset-env-to-main", knob: GIT_NO_RECUT_ENV.key });
    return result();
  }
  // JOB-G11 — first, before any fetch or any other check.
  for (const b of scope.recutBranches) {
    if (NEVER_RECUT.includes(b)) return refuse(`'${b}' is a re-cut TARGET in RECUT_BRANCHES`, { branch: b });
  }
  const problems = scopeProblems(root, scope);
  if (problems.length > 0) return refuse(problems[0]!, { msg: problems[0] });
  const stamp = knobs.date === "" ? deps.now().toISOString().slice(0, 10) : knobs.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return refuse(`RECUT_DATE '${stamp}' is not YYYY-MM-DD`, { msg: "bad RECUT_DATE" });
  if (scope.recutRepos.length === 0) {
    log.info("no-scope", { job: "ops-reset-env-to-main", knob: "RECUT_REPOS" });
    return result();
  }

  if (dryRun) say("DRY RUN — no refs will be pushed");
  say(`start ${iso(deps.now())} — ${scope.recutRepos.length} repos, branches: ${scope.recutBranches.join(" ")}, stamp: ${stamp}`);

  for (const repo of scope.recutRepos) {
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
    const main = tryGit(git, dir, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/main");
    if (main === null) {
      say(`✗  ${repo} — no origin/main to re-cut from`);
      failed++;
      continue;
    }

    for (const b of scope.recutBranches) {
      const label = `${repo}:${b}`;
      // The snapshot: every push below is judged against this head, never a later read.
      const head = tryGit(git, dir, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${b}`);
      if (head === null) continue;
      if (head === main) {
        say(`=  ${label} — already at main ${short(main)}`);
        current++;
        continue;
      }

      let backup = `backup/${b}-pre-reset-${stamp}`;
      let prior = tryGit(git, dir, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${backup}`);
      if (prior !== null && prior !== head) {
        if (!knobs.force) {
          say(`⚠  ${label} — ${backup} exists at ${short(prior)}, head moved to ${short(head)}, refused (RECUT_FORCE=1 to snapshot both)`);
          skipped++;
          continue;
        }
        backup = `${backup}-${short(head)}`;
        prior = tryGit(git, dir, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${backup}`);
        if (prior !== null && prior !== head) {
          say(`⚠  ${label} — ${backup} exists at ${short(prior)}, not ${short(head)}, refused`);
          skipped++;
          continue;
        }
      }
      // A backup already at head is a resumed run: the snapshot is safe, only the re-cut is left.
      const needBackup = prior === null;
      const behind = tryGit(git, dir, "rev-list", "--count", `${main}..${head}`) ?? "?";

      if (dryRun) {
        say(`·  ${label} — would back up ${short(head)} → ${backup}, then re-cut to main ${short(main)} (${behind} commit(s) not on main)`);
        continue;
      }
      if (needBackup && tryGit(git, dir, "push", "--quiet", "origin", `${head}:refs/heads/${backup}`) === null) {
        say(`✗  ${label} — backup push to ${backup} failed, NOT re-cut`);
        failed++;
        continue;
      }
      const pushed = tryGit(
        git,
        dir,
        "push",
        "--quiet",
        `--force-with-lease=refs/heads/${b}:${head}`,
        "origin",
        `${main}:refs/heads/${b}`,
      );
      if (pushed !== null) {
        say(`✓  ${label} — ${short(head)} → main ${short(main)} (${behind} commit(s) not on main, saved at ${backup})`);
        recut++;
      } else {
        say(`✗  ${label} — re-cut push rejected (origin moved, or no push access); backup at ${backup} stands`);
        failed++;
      }
    }
  }

  say(`done — ${current} already-current, ${recut} re-cut, ${skipped} skipped, ${failed} failed`);
  const fields = { current, recut, skipped, failed };
  if (failed > 0) log.error("recut-failed", fields);
  else log.info("reset-env-to-main", fields);
  return result();
}
