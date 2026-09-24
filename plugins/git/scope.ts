// JOB-G04/05 — which repos and branches the git jobs may touch.
//
// The repo list is EXPLICIT and never globbed. A glob also matches the repos where people and
// agents write (a plugin checkout, the tracker) and those hold uncommitted work; an hourly
// `reset --hard` there cannot be undone. Each entry is a directory path RELATIVE to the project
// root (INS-02: every write is project-relative), so an absolute path, a `..` or a glob character
// is refused, not resolved.
//
// The branch list is ONE union tried in every repo. A name the remote lacks is skipped in
// silence, which covers repos that name their branches differently. A missing repo DIRECTORY is
// a failure; only a missing BRANCH is silent.
//
// The default scope is EMPTY. A job with nothing in scope logs one line and does nothing, so
// installing the plugin never resets anything by surprise.
import { basename, join, posix } from "node:path";
import type { EnvSpec } from "../../kernel/plugin.ts";

export const RESET_REPOS_ENV: EnvSpec = {
  key: "RESET_REPOS",
  default: "",
  why: "project-relative repo directories the git jobs sweep, space- or comma-separated; explicit, never globbed, empty means do nothing (JOB-G04)",
};
export const RESET_BRANCHES_ENV: EnvSpec = {
  key: "RESET_BRANCHES",
  default: "main staging development dev",
  why: "long-lived branches reset-branches syncs to origin, tried in every repo; a name the remote lacks is skipped (JOB-G05)",
};
export const ENV_WORKTREE_BRANCHES_ENV: EnvSpec = {
  key: "ENV_WORKTREE_BRANCHES",
  default: "staging development dev",
  why: "branches that get their own read-only worktree; a subset of RESET_BRANCHES, never main or master (JOB-G07)",
};
export const RECUT_REPOS_ENV: EnvSpec = {
  key: "RECUT_REPOS",
  default: "",
  why: "repos whose env branches reset-env-to-main force back to main on origin; a subset of RESET_REPOS, empty means do nothing (JOB-G09)",
};
export const RECUT_BRANCHES_ENV: EnvSpec = {
  key: "RECUT_BRANCHES",
  default: "staging development",
  why: "env branches reset-env-to-main re-cuts from main; a subset of RESET_BRANCHES, never main or master (JOB-G11)",
};
export const GIT_WORKTREE_DIR_ENV: EnvSpec = {
  key: "GIT_WORKTREE_DIR",
  default: ".doppelganger/worktree",
  why: "project-relative directory for the env and PR-head worktrees; kept under a gitignored path so a tree there never dirties the checkout (INS-02)",
};

export const SCOPE_ENV: readonly EnvSpec[] = [
  RESET_REPOS_ENV,
  RESET_BRANCHES_ENV,
  ENV_WORKTREE_BRANCHES_ENV,
  RECUT_REPOS_ENV,
  RECUT_BRANCHES_ENV,
  GIT_WORKTREE_DIR_ENV,
];

/** The whole scope, as lists. Every git job validates ALL of it, so one bad value stops every
 *  git job at once rather than only the job that happens to read it. */
export interface GitScope {
  readonly repos: readonly string[];
  readonly branches: readonly string[];
  readonly worktreeBranches: readonly string[];
  readonly recutRepos: readonly string[];
  readonly recutBranches: readonly string[];
  /** Project-relative, like a repo entry. */
  readonly worktreeDir: string;
}

/** Split an env string on spaces and commas; blanks dropped. */
export function splitList(raw: string): string[] {
  return raw.split(/[\s,]+/).filter((s) => s !== "");
}

/** The one env reader the git jobs need. The job context is one; a test passes a map. */
export interface EnvReader {
  readonly env: { readonly str: (spec: EnvSpec) => string };
}

/** Read the scope through the job context's env reader. Only splits; `scopeProblems` judges. */
export function scopeFrom(ctx: EnvReader): GitScope {
  return {
    repos: splitList(ctx.env.str(RESET_REPOS_ENV)).map(normalizeEntry),
    branches: splitList(ctx.env.str(RESET_BRANCHES_ENV)),
    worktreeBranches: splitList(ctx.env.str(ENV_WORKTREE_BRANCHES_ENV)),
    recutRepos: splitList(ctx.env.str(RECUT_REPOS_ENV)).map(normalizeEntry),
    recutBranches: splitList(ctx.env.str(RECUT_BRANCHES_ENV)),
    worktreeDir: normalizeEntry(ctx.env.str(GIT_WORKTREE_DIR_ENV).trim()),
  };
}

/** The absolute directory the env and PR-head worktrees go in. */
export const worktreeRoot = (root: string, s: GitScope): string => join(root, s.worktreeDir);

/** `./a/b/` -> `a/b`. Leaves anything it cannot judge alone, so `pathProblem` sees it as typed. */
export function normalizeEntry(entry: string): string {
  if (entry === "" || entry.includes("..")) return entry;
  const n = posix.normalize(entry);
  return n.length > 1 && n.endsWith("/") ? n.slice(0, -1) : n;
}

const GLOB = /[*?[\]{}!]/;

/** Why a project-relative path entry is refused, or null when it is fine. */
export function pathProblem(entry: string): string | null {
  if (entry === "") return "is empty";
  if (entry.startsWith("/") || entry.startsWith("~") || /^[A-Za-z]:/.test(entry) || entry.includes("\\")) {
    return "is absolute; entries are project-relative";
  }
  if (entry.includes("..")) return "contains '..'";
  if (GLOB.test(entry)) return "contains a glob character; list each repo explicitly";
  if (entry.startsWith("-")) return "starts with '-'";
  return null;
}

// Conservative: what git accepts AND what is safe as a bare git argument (no leading '-').
const BRANCH = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

/** Why a branch name is refused, or null when it is fine. */
export function branchProblem(name: string): string | null {
  if (!BRANCH.test(name)) return "is not a plain branch name";
  if (name.includes("..") || name.includes("//") || name.endsWith("/") || name.endsWith(".") || name.endsWith(".lock")) {
    return "is not a valid branch name";
  }
  return null;
}

/** The worktree directory name part for a repo entry: `a/b` -> `a-b`, `.` -> the root's own
 *  name. */
export function repoSlug(root: string, repo: string): string {
  return repo === "." ? basename(root) : repo.split("/").join("-");
}

const NEVER_DERIVED = ["main", "master"];

/** Every problem with the scope, one line each; empty means valid. The rules: each entry is a
 *  safe project-relative path or a plain branch name; no duplicates; worktree and re-cut
 *  branches are subsets of RESET_BRANCHES and never main or master; RECUT_REPOS is a subset of
 *  RESET_REPOS. */
export function scopeProblems(root: string, s: GitScope): string[] {
  const out: string[] = [];
  const paths: [string, readonly string[]][] = [
    [RESET_REPOS_ENV.key, s.repos],
    [RECUT_REPOS_ENV.key, s.recutRepos],
  ];
  for (const [key, list] of paths) {
    for (const e of list) {
      const p = pathProblem(e);
      if (p) out.push(`${key}: '${e}' ${p}`);
    }
    for (const d of dupes(list)) out.push(`${key}: '${d}' is listed twice`);
  }
  const wd = pathProblem(s.worktreeDir);
  if (wd) out.push(`${GIT_WORKTREE_DIR_ENV.key}: '${s.worktreeDir}' ${wd}`);
  else if (s.worktreeDir === ".") out.push(`${GIT_WORKTREE_DIR_ENV.key}: must name a directory below the root, not the root`);

  const slugs = new Map<string, string>();
  for (const r of s.repos) {
    const slug = repoSlug(root, r);
    const prior = slugs.get(slug);
    if (prior !== undefined && prior !== r) out.push(`${RESET_REPOS_ENV.key}: '${prior}' and '${r}' share the worktree name '${slug}'`);
    slugs.set(slug, r);
  }

  const lists: [string, readonly string[]][] = [
    [RESET_BRANCHES_ENV.key, s.branches],
    [ENV_WORKTREE_BRANCHES_ENV.key, s.worktreeBranches],
    [RECUT_BRANCHES_ENV.key, s.recutBranches],
  ];
  for (const [key, list] of lists) {
    for (const b of list) {
      const p = branchProblem(b);
      if (p) out.push(`${key}: '${b}' ${p}`);
    }
    for (const d of dupes(list)) out.push(`${key}: '${d}' is listed twice`);
  }

  const daily = new Set(s.branches);
  for (const [key, list] of lists.slice(1)) {
    for (const b of list) {
      if (NEVER_DERIVED.includes(b)) out.push(`${key}: '${b}' may not be listed; it is the branch the others derive from`);
      else if (!daily.has(b)) out.push(`${key}: '${b}' is not in ${RESET_BRANCHES_ENV.key}`);
    }
  }
  const repos = new Set(s.repos);
  for (const r of s.recutRepos) {
    if (!repos.has(r)) out.push(`${RECUT_REPOS_ENV.key}: '${r}' is not in ${RESET_REPOS_ENV.key}`);
  }
  return out;
}

function dupes(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const x of list) (seen.has(x) ? out : seen).add(x);
  return [...out];
}

/** A 0/1 knob. Anything else throws, naming the key and the value, rather than guess which one
 *  was meant (the KRN-07 rule, applied to every flag here). */
export function parseFlag(spec: EnvSpec, raw: string): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  throw new Error(`${spec.key}: must read "0" or "1", got ${JSON.stringify(raw)}`);
}
