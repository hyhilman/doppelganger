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
import { withLease } from "../kernel/runtime/lease.ts";
import { isLimitError, limitClass, isPaused, pausedUntil, pause, QUOTA_SCOPE } from "../kernel/runtime/quota.ts";
import { projectPath, ROOT, dbPath } from "../kernel/paths.ts";
import { byStage } from "../kernel/stages.ts";
import { parentEnv, errText } from "../kernel/config.ts";
import type { Job } from "../kernel/ports/job.ts";
import { sandcastleRunner } from "./runner.ts";
import { JOBS } from "./jobs/index.ts";
import { GATE_TIMEOUT_MS, type PassDeps } from "./jobs/nightly-sandcastle.ts";
import { SUPERVISOR_MAX_RUN_MIN, SUPERVISOR_KILL_GRACE_MS } from "./supervisor.ts";

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
 * D10's two shapes, no third: `job.exec` -> call it with the assembled deps; otherwise the skill
 * runner path -> report `iterations`, `commits.length` and `completionSignal ?? "none"` on STDERR
 * (LOG-06: stdout stays free for the payload).
 *
 * The cast on `job.exec` is the ONE cast this repo performs to call a job's own deps-typed `exec`
 * from a registry that only knows `(deps: never) => Promise<void>` (kernel/ports/job.ts) — every
 * job at N3 shares `PassDeps`' shape, so there is exactly one shape to cast to today.
 *
 * LSE-04 — every registered job claims its hour before it runs, GENERIC, not special-cased: the
 * key is `${job.name}@<UTC hour>`, the clock versioning it for a reason wholly unrelated to
 * whether the pass worked (ruling 3, plan/N4-uac.md). `done` terminal is then exactly right —
 * that hour's run happened once — and it excludes what the gate (per-process) cannot: a hand-run
 * beside a scheduled tick, or a second checkout (INS-05). The TTL is DERIVED from SUP-13's own
 * bound (`SUPERVISOR_MAX_RUN_MIN` — past which the supervisor has already SIGKILLed the child)
 * plus the kill grace, never chosen. A refusal is a skipped tick, exit 0, logged at `info` with
 * the exact `lease-clear` command an operator needs (the same shape as `quota-paused` below, and
 * for the same reason — INV-10's spirit: a refusal costs the work nothing). The lease wrapper is
 * NOT gated on `job.exec` — a double-run is a hazard for every job shape, model or not.
 *
 * QTA-01/05 — the producer and the consumer of the account breaker, BOTH gated on
 * `job.skill !== undefined`, NEVER on `job.exec === undefined`: `nightly-sandcastle` carries BOTH
 * fields (skill for SKL-01/render, exec for D10's own dispatch above), and its `exec`
 * (`execPass`) calls `runJob` internally — it is the one job in this repo that spawns a model, and
 * an `exec`-keyed gate would exempt it from the very breaker it exists to protect. `skill` is what
 * actually says "this job's run reaches an agent," in EITHER dispatch shape. A job with no skill
 * at all (a purely deterministic `exec:` job, e.g. `ops-cron-check`) spawns no model, so it can
 * neither hit a plan wall nor legitimately open one — ungated, it would be SKIPPED by a wall it
 * could not have caused, and its own unrelated failure could OPEN one and park every job on the
 * host (the reference's 2026-08-07 incident). The consumer refuses BEFORE the lease is even
 * attempted — a wall costs the tick nothing, not even a claimed hour.
 */
export async function runNamed(job: Job, deps: PassDeps): Promise<number> {
  const spawnsAgent = job.skill !== undefined;

  if (spawnsAgent && isPaused(QUOTA_SCOPE)) {
    deps.log.info("quota-paused", { until: pausedUntil(QUOTA_SCOPE) ?? "" });
    return 0; // a wall is a skipped tick, never a failure (INV-10)
  }

  const hour = deps.now().toISOString().slice(0, 13); // "2026-08-26T22"
  const key = `${job.name}@${hour}`;
  try {
    const got = await withLease(
      "job",
      key,
      async () => {
        if (job.exec !== undefined) {
          await (job.exec as unknown as (deps: PassDeps) => Promise<void>)(deps);
          return;
        }
        const result = await runJob(job, { runner: deps.runner, cwd: deps.root, logPath: deps.runLogPath(job.name) });
        process.stderr.write(
          `iterations=${result.iterations} commits=${result.commits.length} completionSignal=${result.completionSignal ?? "none"}\n`,
        );
      },
      { ttlMs: SUPERVISOR_MAX_RUN_MIN * 60_000 + SUPERVISOR_KILL_GRACE_MS, maxAttempts: 3 },
    );
    if (!got.ran) {
      deps.log.info("lease-held", {
        key,
        reason: got.reason,
        msg: `another run of ${job.name} owns this hour — \`npm run lease-clear -- job ${key}\` to release it`,
      });
      return 0;
    }
    return 0;
  } catch (e) {
    const msg = errText(e);
    if (!spawnsAgent || !isLimitError(msg)) throw e;
    const until = pause(QUOTA_SCOPE, msg);
    deps.log.warn("quota-parked", { until, class: limitClass(msg) });
    return 0;
  }
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
        // The push gate (N3): a COMMAND, not a write path. Signed in test/writes.test.ts's
        // DOOR1_EXCEPTIONS (N3 F2); door 1 decodes escapes now, so no spelling hides from it.
        gitSshCommand: "/bin/false",
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
