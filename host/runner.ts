// The ONLY file that imports @ai-hero/sandcastle. `kernel/` imports no plugin, no host, no
// sandcastle (D1); `kernel/ports/runner.ts` stays pure types, and this file is the one adapter
// that turns a `RunRequest` into a real agent run. M11 (D3) swaps this file for an own library,
// "every job file unchanged".
//
// The agent has two escape routes out of the worktree, both closed here, measured:
//
// ROUTE ONE: `~/.gitconfig`. sandcastle's `run()` unconditionally executes, on the host under
// `noSandbox` (there is no container to isolate it in):
//   git config --global --add safe.directory "<repoDir>"
//   git config --global user.name  "<the host repo's user.name>"
//   git config --global user.email "<the host repo's user.email>"
// Measured on this machine: `~/.gitconfig` is 4,529 lines carrying 4,523 `safe.directory` entries,
// 4,448 of them the same duplicate line — every `git` invocation on the host parses it, and it grows
// one line per run, forever. Closed by `noSandbox({ env: { GIT_CONFIG_GLOBAL: deps.gitConfigGlobal } })`
// — measured to leave `~/.gitconfig` byte-identical and to put the three entries in a project-
// relative file instead. Three further measurements shape the design (see RunnerDeps below): the
// agent child INHERITS the redirected value, which is what lets it commit inside a worktree it did
// not create · the parent directory of `deps.gitConfigGlobal` must exist or `run()` rejects with
// `could not lock config file …: No such file or directory` (the fresh-clone case) · the key must go
// on exactly one provider, or `run()` throws `Overlapping env keys`.
//
// ROUTE TWO: `origin`, over SSH, invisible to a porcelain-based escape check. `GIT_CONFIG_GLOBAL`
// strips a credential helper but not `~/.ssh`, and a `git push` leaves the working tree CLEAN — so
// the check `exec()` (kernel/runtime) runs after the pass (`git status --porcelain`) cannot see it.
// Measured with a fake `claude` running `git ls-remote origin` inside a real run:
// `REMOTE_REACHABLE=yes` with no `GIT_SSH_COMMAND` set, `no` with `GIT_SSH_COMMAND=/bin/false`.
// Closed by setting it in the same `noSandbox({ env })` object — the detector half (comparing
// `git rev-parse origin/<base>` before and after) lives in the job, because a gate one env var from
// deletion needs one.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { run, claudeCode, type AgentProvider } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import type { RunRequest, RunResult, Runner } from "../kernel/ports/runner.ts";

export interface RunnerDeps {
  /** Project-relative, absolute. Required, no default — a default that is a real path is a real
   *  file someone forgets to redirect. Its parent directory need not exist yet; `sandcastleRunner`
   *  creates it (see below). */
  readonly gitConfigGlobal: string;
  /** Required, no default — a default of `""` here is a silently open remote. `"/bin/false"` in the
   *  real argv block (host/run.ts). */
  readonly gitSshCommand: string;
}

/**
 * The pure half: builds the `AgentProvider` from a `RunRequest`, nothing else. Exported so a test
 * can assert the exact command `buildPrintCommand` renders without spending a real run — and so a
 * test that rebuilt the provider itself would not be testing its own copy of the configuration.
 */
export function buildAgent(req: RunRequest): AgentProvider {
  return claudeCode(req.model, { effort: req.effort, permissionMode: req.permissionMode });
}

/**
 * The M11 seam's one implementation. `deps`'s two fields are ruling 6's env vars — required, so a
 * caller cannot reach `run()` without deciding both.
 *
 * `promptArgs`/`promptFile` are never passed to `run()` — `RunRequest.prompt` is already fully
 * substituted (kernel/runtime/runjob.ts's `substitute`), and `promptFile`'s missing-key path is the
 * only place sandcastle's `clack.text`/`clack.isCancel`/`clack.cancel` calls live, which is what
 * would block an unattended run on stdin.
 */
export function sandcastleRunner(deps: RunnerDeps): Runner {
  return async (req: RunRequest): Promise<RunResult> => {
    // Measured: run() rejects with `could not lock config file …: No such file or directory` when
    // GIT_CONFIG_GLOBAL's parent directory does not exist — the fresh-clone case.
    mkdirSync(dirname(deps.gitConfigGlobal), { recursive: true });

    const result = await run({
      agent: buildAgent(req),
      sandbox: noSandbox({
        env: {
          GIT_CONFIG_GLOBAL: deps.gitConfigGlobal,
          GIT_SSH_COMMAND: deps.gitSshCommand,
          ...req.env,
        },
      }),
      cwd: req.cwd,
      name: req.name,
      prompt: req.prompt,
      maxIterations: req.maxIterations,
      completionSignal: req.completionSignal,
      branchStrategy: { type: "head" },
      logging: { type: "file", path: req.logPath },
      signal: AbortSignal.timeout(req.deadlineMs),
    });

    return {
      stdout: result.stdout,
      completionSignal: result.completionSignal ?? null,
      iterations: result.iterations.length,
      commits: result.commits.map((c) => c.sha),
      branch: result.branch,
      logPath: result.logFilePath ?? null,
    };
  };
}
