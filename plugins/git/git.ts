// The small shared shapes every git job takes: a git runner, a log, a line printer. Each job
// declares its own deps interface out of these, so a test drives real git with no mock layer.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

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
