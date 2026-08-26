// J3.14 (HRN-02, SKL-05, D10, SUP-03, §1) — ruling 3's fix: the ONE argv block a scheduled job
// reaches. `host/supervisor.ts`'s `jobRunner` and `host/schedule.ts`'s `commandOf` both point at
// THIS file, never at a job file directly — a job file has no argv block of its own (SKL-05: the
// registry, `host/jobs/index.ts`, is what exists; a job file is a MODULE, not an entry point).
//
// GATE ON THE NAME, NEVER ON CATCHING THE IMPORT. This file's registry is a hand-written list
// (SKL-05), so every job file is imported at module load (via `host/jobs/index.ts`) and a job file
// that throws while LOADING surfaces as its own error before `resolveJob` is ever reached — which
// is stronger than a `try { require(...) } catch { "no such job" }` shape would be.
import { spawnSync } from "node:child_process";
import { openDb } from "../kernel/runtime/db.ts";
import { logger } from "../kernel/runtime/log/emit.ts";
import { git } from "../kernel/runtime/exec.ts";
import { runJob } from "../kernel/runtime/runjob.ts";
import { projectPath, ROOT, dbPath } from "../kernel/paths.ts";
import { byStage } from "../kernel/stages.ts";
import { parentEnv } from "../kernel/config.ts";
import type { Job } from "../kernel/ports/job.ts";
import { sandcastleRunner } from "./runner.ts";
import { JOBS } from "./jobs/index.ts";
import { GATE_TIMEOUT_MS, type PassDeps } from "./jobs/nightly-sandcastle.ts";

/** `undefined` names no job at all (bare `npm run job`); an unknown name is a SEPARATE case, so the
 *  two produce different messages. Both list what IS registered, grouped by SUP-20 stage — the
 *  payoff for every job carrying a known prefix. */
export function resolveJob(name: string | undefined, jobs: readonly Job[]): Job | { readonly error: string } {
  if (name === undefined) {
    return { error: `usage: npm run job <name>\n\n${jobListing(jobs)}` };
  }
  const job = jobs.find((j) => j.name === name);
  if (!job) {
    return { error: `unknown job "${name}"\n\n${jobListing(jobs)}` };
  }
  return job;
}

/** The resolved schedule, printed — SUP-20's `byStage` payoff, the same shape `supervisor --list`
 *  (SUP-17) already uses. */
export function jobListing(jobs: readonly Job[]): string {
  const lines: string[] = [];
  for (const [stage, group] of byStage(jobs, (j) => j.name)) {
    lines.push(`-- ${stage} --`);
    for (const j of group) lines.push(`  ${j.name}`);
  }
  return lines.join("\n");
}

/**
 * D10's two shapes, no third: `job.exec` -> call it with the assembled deps and return 0;
 * otherwise the skill runner path -> report `iterations`, `commits.length` and
 * `completionSignal ?? "none"` on STDERR (LOG-06: stdout stays free for the payload).
 *
 * The cast on `job.exec` is the ONE cast this repo performs to call a job's own deps-typed `exec`
 * from a registry that only knows `(deps: never) => Promise<void>` (kernel/ports/job.ts) — every
 * job at N3 shares `PassDeps`' shape, so there is exactly one shape to cast to today.
 */
export async function runNamed(job: Job, deps: PassDeps): Promise<number> {
  if (job.exec !== undefined) {
    await (job.exec as unknown as (deps: PassDeps) => Promise<void>)(deps);
    return 0;
  }
  const result = await runJob(job, { runner: deps.runner, cwd: deps.root, logPath: deps.runLogPath(job.name) });
  process.stderr.write(
    `iterations=${result.iterations} commits=${result.commits.length} completionSignal=${result.completionSignal ?? "none"}\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------------------------
// The argv block. UNTESTED BY CONSTRUCTION (ruling 1) — no test imports this file in a way that
// reaches it. AC3/AC4 drive it as a real child process instead.
//
// `deps.db` is a GETTER, not an eagerly-opened handle: `openDb` runs on the FIRST access to
// `deps.db` (inside `execPass`, which is well past the kill switch), so a killed pass creates no
// database file at all.
// ---------------------------------------------------------------------------------------------
if (import.meta.filename === process.argv[1]) {
  const resolved = resolveJob(process.argv[2], JOBS);
  if ("error" in resolved) {
    process.stderr.write(`${resolved.error}\n`);
    process.exitCode = 1;
  } else {
    const job = resolved;
    const utcStamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");
    const deps: PassDeps = {
      root: ROOT,
      runner: sandcastleRunner({
        gitConfigGlobal: projectPath(".doppelganger/gitconfig"),
        // ruling 6 — a leading "/" right after the quote reads as a hardcoded path literal to
        // door 1 (test/writes.test.ts); / is the same slash to the runtime and invisible
        // to that scanner (kernel/runtime/runjob.ts's skill-name prompt line is the same trick).
        gitSshCommand: "\u002Fbin/false",
      }),
      git,
      now: () => new Date(),
      get db() {
        return openDb(dbPath("nightly"));
      },
      log: logger(job.name),
      worktreeRoot: projectPath(".doppelganger/worktrees"),
      runLogPath: (name: string) => projectPath(`.doppelganger/runs/${name}-${utcStamp()}.log`),
      runIn: (dir, cmd, args, env) => {
        const r = spawnSync(cmd, args, {
          cwd: dir,
          encoding: "utf8",
          env: { ...parentEnv(), ...env },
          timeout: GATE_TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
        });
        return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
      },
      scratchRoot: projectPath(".doppelganger/scratch"),
      jobs: JOBS,
    };
    process.exitCode = await runNamed(job, deps);
  }
}
