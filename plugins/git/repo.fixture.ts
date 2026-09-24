// Real-git workspaces for the git plugin's tests: a bare origin, a seed clone that plays
// "upstream", and one clone per repo name under a project root. Never imported by shipped code.
//
// The git env is built from scratch, not copied: GIT_CONFIG_GLOBAL/SYSTEM point at /dev/null so
// the run does not depend on who runs the suite (the jobs read `user.email` to decide whose
// commits they would discard), and no inherited GIT_DIR from a hook can redirect a command.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeGit, type Git, type GitLog } from "./git.ts";

export const GIT_ENV: Readonly<Record<string, string>> = {
  PATH: process.env.PATH ?? "",
  LANG: "C",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

export const git: Git = makeGit(GIT_ENV);

export interface Workspace {
  readonly dir: string;
  /** The project root the jobs run over; each repo is `<root>/<name>`. */
  readonly root: string;
  readonly origin: string;
  /** A non-bare clone that plays upstream: commit here, then `push` to move origin. */
  readonly seed: string;
  repo(name: string): string;
  /** Commit one file change on `branch` in the seed and push it to origin. Returns the new SHA. */
  upstream(branch: string, file: string, body: string, msg: string): string;
}

const made: string[] = [];

/** Remove every workspace this file made. Call from each test file's `after`. */
export function cleanupWorkspaces(): void {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}

/**
 * origin has `main` at "first", plus any `branches` cut from it. Each clone in `names` is taken,
 * then origin's `main` gains "second" — so every clone is one commit behind and a job has real
 * work to do in all of them.
 */
export function workspace(names: readonly string[] = ["api", "web"], branches: readonly string[] = []): Workspace {
  const dir = mkdtempSync(join(tmpdir(), "git-plugin-"));
  made.push(dir);
  const origin = join(dir, "origin.git");
  const seed = join(dir, "seed");
  const root = join(dir, "root");
  mkdirSync(root);
  mkdirSync(seed);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: GIT_ENV });
  git(seed, "init", "-q", "-b", "main");
  git(seed, "config", "user.email", "upstream@test");
  git(seed, "config", "user.name", "upstream");
  git(seed, "remote", "add", "origin", origin);
  writeFileSync(join(seed, "f.txt"), "first\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "first");
  git(seed, "push", "-q", "origin", "main");
  for (const b of branches) git(seed, "push", "-q", "origin", `main:refs/heads/${b}`);

  for (const name of names) {
    const r = join(root, name);
    execFileSync("git", ["clone", "-q", origin, r], { env: GIT_ENV });
    git(r, "config", "user.email", "me@test");
    git(r, "config", "user.name", "me");
  }

  const upstream = (branch: string, file: string, body: string, msg: string): string => {
    git(seed, "fetch", "-q", "origin");
    git(seed, "checkout", "-q", "-B", branch, `origin/${branch}`);
    writeFileSync(join(seed, file), body);
    git(seed, "add", "-A");
    git(seed, "commit", "-qm", msg);
    git(seed, "push", "-q", "origin", branch);
    return git(seed, "rev-parse", "HEAD").trim();
  };
  upstream("main", "f.txt", "second\n", "second");

  return { dir, root, origin, seed, repo: (name) => join(root, name), upstream };
}

export interface Recorded {
  readonly lines: string[];
  readonly logs: { level: string; event: string; fields: Record<string, unknown> }[];
  readonly say: (line: string) => void;
  readonly log: GitLog;
  readonly out: () => string;
}

export function recorder(): Recorded {
  const lines: string[] = [];
  const logs: Recorded["logs"] = [];
  const at = (level: string) => (event: string, fields: Record<string, unknown> = {}) => {
    logs.push({ level, event, fields });
  };
  return {
    lines,
    logs,
    say: (line) => lines.push(line),
    log: { info: at("info"), warn: at("warn"), error: at("error") },
    out: () => lines.join("\n"),
  };
}

/**
 * Turn clone `root` into a project root with a linked worktree of ITSELF at `<root>/<rel>`,
 * detached at HEAD. First `root`'s `main` gains a landing by a bot identity that origin lacks.
 * `rel` and each path in `ignore` go in the root's info/exclude, so the root's own tree stays
 * clean and no dirty-tree guard can stand in for a missing refusal. Returns the worktree's path.
 */
export function selfWorktree(root: string, rel: string, ignore: readonly string[] = []): string {
  writeFileSync(join(root, "landed.txt"), "a nightly landing nobody pushed\n");
  git(root, "add", "-A");
  git(root, "-c", "user.email=bot@nightly", "-c", "user.name=bot", "commit", "-qm", "nightly: landed");
  mkdirSync(join(root, ".git", "info"), { recursive: true });
  appendFileSync(join(root, ".git", "info", "exclude"), [rel, ...ignore].map((p) => `/${p}\n`).join(""));
  const path = join(root, rel);
  git(root, "worktree", "add", "-q", "--detach", path);
  return path;
}

/** Every ref in `repo` with its SHA, one per line: equal before and after means nothing moved. */
export const refs = (repo: string): string => git(repo, "for-each-ref", "--format=%(refname) %(objectname)");

export const subject = (repo: string, ref = "HEAD"): string => git(repo, "log", "-1", "--format=%s", ref).trim();
export const head = (repo: string, ref = "HEAD"): string => git(repo, "rev-parse", ref).trim();
