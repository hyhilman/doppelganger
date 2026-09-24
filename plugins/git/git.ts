// The small shared shapes every git job takes: a git runner, a log, a line printer. Each job
// declares its own deps interface out of these, so a test drives real git with no mock layer.
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

/** Run `git -C <dir> <args…>` and return stdout. Throws on a non-zero exit; the error message is
 *  git's own stderr, so a caller can quote its last line. */
export type Git = (dir: string, ...args: string[]) => string;

/** A logfmt-shaped logger: one event name plus fields. The host passes its real logger. */
export interface GitLog {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/** Prints one human line to stdout. */
export type Say = (line: string) => void;

/** The real runner. `env` is passed through as-is when given; otherwise the child inherits. */
export function makeGit(env?: Readonly<Record<string, string | undefined>>): Git {
  return (dir, ...args) => {
    try {
      return execFileSync("git", ["-C", dir, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...(env ? { env } : {}),
      });
    } catch (e) {
      const err = e as { stderr?: string; message?: string };
      const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
      throw new Error(stderr !== "" ? stderr : (err.message ?? `git ${args.join(" ")} failed`));
    }
  };
}

/** `git(…)` trimmed, or null when git exits non-zero. For reads where "absent" is an answer. */
export function tryGit(git: Git, dir: string, ...args: string[]): string | null {
  try {
    return git(dir, ...args).trim();
  } catch {
    return null;
  }
}

/** The last non-blank line of an error, for a one-line failure notice. */
export function lastLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const lines = msg.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  return lines[lines.length - 1] ?? "";
}

export const short = (sha: string): string => sha.slice(0, 8);

/** True only when `dir` is itself the top of a git checkout. A plain directory INSIDE some other
 *  checkout is not a repo here: `git -C` would walk up and act on the parent, which is the wrong
 *  repo to reset. */
export function isRepoRoot(git: Git, dir: string): boolean {
  const top = tryGit(git, dir, "rev-parse", "--show-toplevel");
  if (top === null) return false;
  try {
    return realpathSync(top) === realpathSync(dir);
  } catch {
    return false;
  }
}

/** The real path of the git dir that holds `dir`'s branches. Every linked worktree of one repo
 *  gives the same answer. Null when git cannot say. */
export function commonGitDir(git: Git, dir: string): string | null {
  const out = tryGit(git, dir, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (out === null || out === "") return null;
  try {
    return realpathSync(out);
  } catch {
    return out;
  }
}

/** Why the scoped repo at `dir` must not be written, or null when it is safe. A repo that shares
 *  the root checkout's git dir (a linked worktree of it) shares its branches too, so a sync there
 *  would move the checkout's own `main`. That `main` holds unpushed landings by a bot identity,
 *  and the "yours" guard does not spare them. A read that fails counts as shared. A root with no
 *  `.git` at all is not a checkout, so it shares nothing. */
export function sharedRefsProblem(git: Git, root: string, dir: string): string | null {
  const theirs = commonGitDir(git, dir);
  if (theirs === null) return "cannot read its git dir to rule out sharing this checkout's branches, refused";
  const ours = commonGitDir(git, root);
  if (ours === null) return existsSync(join(root, ".git")) ? "cannot read this checkout's git dir to compare, refused" : null;
  return theirs === ours ?"shares this checkout's branches (a linked worktree of it), refused" : null;
}

/** `git worktree list --porcelain`, as branch name -> worktree path. The primary checkout counts;
 *  a detached tree has no branch and is left out. */
export function worktreesByBranch(git: Git, repo: string): Map<string, string> {
  const map = new Map<string, string>();
  let path = "";
  for (const line of git(repo, "worktree", "list", "--porcelain").split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line.startsWith("branch refs/heads/")) map.set(line.slice("branch refs/heads/".length), path);
  }
  return map;
}

/** Every registered worktree path of `repo`, primary included. */
export function worktreePaths(git: Git, repo: string): string[] {
  return git(repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length));
}
