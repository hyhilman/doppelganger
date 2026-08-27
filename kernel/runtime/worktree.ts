// the worktree this repo creates, names, hands to an agent and removes. THIS FILE
// IS THE MACHINERY ONLY: it never decides when to prep or tear one down (ruling 4,
// kernel/runtime/runjob.ts, J3.6) — the caller that owns the pass owns the tree.
//
// Every git call goes through kernel/runtime/exec.ts's `git()` — HRN-19's wall-clock timeout, so an
// unbounded stalled git call cannot stall a pass forever.
import { resolve, sep } from "node:path";
import { git } from "./exec.ts";
import { logger } from "./log/emit.ts";

export interface Worktree {
  readonly path: string;
  readonly branch: string;
  readonly base: string;
  /** The worktree HEAD's full SHA, right after prep — the base's SHA on a fresh branch. */
  readonly head: string;
}

interface ListedWorktree {
  readonly path: string;
}

/** `git worktree list --porcelain`, parsed for just the `worktree <path>` lines — the only field
 *  this file needs. A future porcelain field this parser does not recognise is simply ignored,
 *  which is what keeps it robust against a porcelain format outside this repo's control. */
function listWorktrees(repo: string): ListedWorktree[] {
  const out = git(repo, "worktree", "list", "--porcelain");
  const entries: ListedWorktree[] = [];
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      entries.push({ path: line.slice("worktree ".length) });
    }
  }
  return entries;
}

/**
 * Idempotent and re-entrant: an existing registered worktree at `path` is hard-reset onto
 * `spec.base` rather than refused, so a killed pass's half-edited tree is reclaimed for free by the
 * next pass instead of blocking it. `clean -fd -e node_modules` is deliberate — `-e node_modules`
 * excludes the symlink the caller places into the tree (kernel/runtime/runjob.ts's caller, J3.12)
 * from a bare `clean -fd`, which would otherwise remove it for a reason unrelated to the diff.
 *
 * Otherwise: `git worktree add -B <spec.branch> <path> <spec.base>` — a fresh branch off `base`.
 */
export function prepWorktree(repo: string, spec: { readonly branch: string; readonly base: string }, path: string): Worktree {
  const absPath = resolve(path);
  const already = listWorktrees(repo).some((w) => resolve(w.path) === absPath);
  if (already) {
    git(absPath, "reset", "--hard", spec.base);
    git(absPath, "clean", "-fd", "-e", "node_modules");
  } else {
    git(repo, "worktree", "add", "-B", spec.branch, absPath, spec.base);
  }
  const head = git(absPath, "rev-parse", "HEAD").trim();
  return { path: absPath, branch: spec.branch, base: spec.base, head };
}

/** `git worktree remove --force`, wrapped so a failure LOGS and does not throw — a stranded
 *  worktree is disk, not correctness, and the caller's own teardown must never fail the pass it is
 *  cleaning up after. */
export function teardownWorktree(repo: string, path: string): void {
  try {
    git(repo, "worktree", "remove", "--force", path);
  } catch (e) {
    logger("worktree").warn("worktree-teardown-failed", {
      path,
      msg: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Removes every registered worktree under `under` that is not `keep`, and returns what it removed
 * (absolute paths). `git worktree prune` runs FIRST, clearing a deleted-directory-still-registered
 * entry (the `rm -rf`-outside-git case) before anything else looks at the list. Never touches a
 * worktree outside `under` — a reaper that removes a worktree it did not create is worse than one
 * that removes nothing.
 */
export function reapWorktrees(repo: string, under: string, keep: string): string[] {
  git(repo, "worktree", "prune");
  const absUnder = resolve(under) + sep;
  const absKeep = resolve(keep);
  const removed: string[] = [];
  for (const w of listWorktrees(repo)) {
    const absPath = resolve(w.path);
    if (!absPath.startsWith(absUnder)) continue;
    if (absPath === absKeep) continue;
    teardownWorktree(repo, absPath);
    removed.push(absPath);
  }
  return removed;
}

/**
 * `{{WORKTREE}}`'s substitution — where to read, the base to diff against, the head SHA,
 * and an explicit instruction not to fall back to the main checkout, which would silently answer
 * every read with the live tree instead of this pass's own. Names no path under `plugins/` or
 * `.claude/` — HRN-16/SKL-08's rule applies to every prompt fragment, not only the skill markdown.
 */
export function worktreePromptLines(wt: Worktree): string[] {
  return [
    `Your changes happen ONLY inside this worktree: ${wt.path}`,
    `Diff against base "${wt.base}"; the worktree HEAD is currently ${wt.head.slice(0, 12)}.`,
    "Do not fall back to the main checkout to read or write anything — this worktree IS the checkout for this pass.",
  ];
}
