// J3.8/J3.11/J3.12 (JOB-C15, SKL-02, SKL-05, SKL-07, TST-19, HRN-10, SAF-01…07, INS-06, KRN-07,
// INV-1) — nightly-sandcastle: the verdict vocabulary, the blocked paths, the goal rotation, the
// import smoke, the three-tier ship gate, and the pass itself.
//
// A free-smoke run (NIGHTLY_SANDCASTLE_MAX=0) leaves the `nightly/<INSTANCE>` branch behind after
// teardown — deliberate: prepWorktree is idempotent and reuses it, so deleting it would only cost
// the next pass a re-create. A reviewer running `git branch --list 'nightly/*'` after a smoke will
// see one branch a zero-cost run created; that is this line's warrant, not a leak.
import { spawnSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { envStr, envNum, envOptional, type EnvSpec } from "../../kernel/config.ts";
import { INSTANCE } from "../../kernel/instance.ts";
import type { Db } from "../../kernel/runtime/db.ts";
import type { Logger } from "../../kernel/runtime/log/emit.ts";
import { extractBlock, extractFields } from "../../kernel/runtime/payload.ts";
import { runJob } from "../../kernel/runtime/runjob.ts";
import { prepWorktree, teardownWorktree, reapWorktrees, worktreePromptLines, type Worktree } from "../../kernel/runtime/worktree.ts";
import { DEFAULTS, defineJob, type Job } from "../../kernel/ports/job.ts";
import type { Runner } from "../../kernel/ports/runner.ts";

// ---------------------------------------------------------------------------------------------
// The verdict — reproduces plugins/nightly/skills/nightly-sandcastle/SKILL.md's report block and
// NOTHING ELSE (SKL-07: the vocabulary a run may report is a list in code; a skill emitting
// something outside it produces `null`, never a widened outcome).
// ---------------------------------------------------------------------------------------------

export const OUTCOMES = ["changed", "none", "too-large", "suite-failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface Verdict {
  readonly goal: string;
  readonly outcome: Outcome;
  readonly files: readonly string[];
  readonly ids: readonly string[];
  readonly summary: string;
  readonly verified: string;
}

const isOutcome = (v: string): v is Outcome => (OUTCOMES as readonly string[]).includes(v);

const splitListField = (v: string | undefined): readonly string[] =>
  v === undefined || v === "-" ? [] : v.split(",").map((s) => s.trim());

/**
 * `null` — never a partial verdict — when there is no `<<<SANDCASTLE` block, `outcome` is absent
 * or not in `OUTCOMES`, or `goal` or `summary` is absent. HRN-10's "malformed payload writes
 * nothing", as a return value.
 */
export function parseVerdict(stdout: string): Verdict | null {
  const block = extractBlock(stdout, "SANDCASTLE");
  if (block === null) return null;
  const fields = extractFields(block);

  const outcome = fields.outcome;
  if (outcome === undefined || !isOutcome(outcome)) return null;
  if (fields.goal === undefined || fields.summary === undefined) return null;

  return {
    goal: fields.goal,
    outcome,
    files: splitListField(fields.files),
    ids: splitListField(fields.ids),
    summary: fields.summary,
    verified: fields.verified ?? "",
  };
}

// ---------------------------------------------------------------------------------------------
// The blocked paths — SKL-07's line made mechanical: the skill may DESCRIBE a rule ("Off limits:
// the schedule file, the supervisor, package.json, and this skill's own files"), and code must
// ENFORCE one at least as strong.
// ---------------------------------------------------------------------------------------------

export interface BlockedRow {
  readonly re: RegExp;
  readonly why: string;
}

export const BLOCKED: readonly BlockedRow[] = [
  {
    re: /^host\/schedule\.ts$/,
    why: "the crontab is generated from it and npm test says nothing about whether a job still fires",
  },
  {
    re: /^host\/supervisor\.ts$/,
    why: "one process owns every tick",
  },
  {
    re: /^host\/jobs\/nightly-sandcastle\.ts$/,
    why: "a job that can rewrite its own kill switch does not have one",
  },
  {
    re: /^package(-lock)?\.json$/,
    why: "a dependency change is not reviewable from a diff stat at 3am",
  },
  {
    re: /^plugins\/[^/]+\/skills\//,
    why: "a pass rewriting the instructions the next pass reads is unbounded",
  },
  {
    re: /^\.claude\/skills\//,
    why: "rendered, never hand-edited (SKL-04)",
  },
  {
    re: /^\.github\//,
    why: "a green suite says nothing about whether CI still runs it",
  },
];

/** The reason a path is off-limits, or `null` — a refusal says WHY, not which regex index. */
export function blockedBy(file: string): string | null {
  const row = BLOCKED.find((r) => r.re.test(file));
  return row ? row.why : null;
}

// ---------------------------------------------------------------------------------------------
// Goal rotation.
// ---------------------------------------------------------------------------------------------

export interface Goal {
  readonly key: string;
  readonly title: string;
  readonly brief: string;
}

export const GOALS: readonly Goal[] = [
  {
    key: "docs-vs-code",
    title: "a claim checked against the source",
    brief:
      "Find one claim in CLAUDE.md or roadmap.md that is derivable from the source (a count, a list, a module map) and is not wired to a test that pins it. Wire the test that pins it.",
  },
  {
    key: "test-gaps",
    title: "a behaviour with no test that goes red when deleted",
    brief:
      "Find one piece of behaviour in this repo with no test proving it. Delete the line, confirm nothing fails, then add the test that would have caught it. Revert the deletion once the test is in place.",
  },
  {
    key: "dead-weight",
    title: "remove a thing rather than add one",
    brief:
      "Find one thing this repo does not need — an unused export, a helper with one caller that could inline, a comment describing code that changed since it was written — and remove it. The suite must stay green.",
  },
];

/** Rotates by `state.index`, wrapping. `only` FORCES one key (SAF-06) rather than rotating, and
 *  does not advance `nextIndex` past it — throws on an unknown key rather than silently rotating. */
export function nextGoal(
  state: { readonly index: number; readonly recent: readonly string[] },
  only?: string,
): { readonly goal: Goal; readonly nextIndex: number } {
  if (only !== undefined) {
    const goal = GOALS.find((g) => g.key === only);
    if (!goal) {
      throw new Error(`nextGoal: unknown goal key ${JSON.stringify(only)} — one of ${GOALS.map((g) => g.key).join(", ")}`);
    }
    return { goal, nextIndex: state.index };
  }
  const idx = ((state.index % GOALS.length) + GOALS.length) % GOALS.length;
  return { goal: GOALS[idx]!, nextIndex: (idx + 1) % GOALS.length };
}

// ---------------------------------------------------------------------------------------------
// DB_NAMESPACES names the FILE argument every kernel/paths.ts path-builder call site passes,
// never a DBS-02 table namespace — J3.13 assertion 11 derives the required set from every such
// real call site and asserts this constant is a superset, which is the gate that would have
// caught the pairing ["nightly","logtail"] (a table namespace mistaken for a file:
// kernel/runtime/log/tail.ts opens the store named "log", not one named "logtail").
// ---------------------------------------------------------------------------------------------

export const DB_NAMESPACES = ["nightly", "log"] as const;

// ---------------------------------------------------------------------------------------------
// The import smoke — this repo has no `tsx`; Node strips types natively. Measured on Node
// 22.23.1: dynamically importing an absolute .ts path in a `node -e` child exits 0 for a good
// module, 1 with a SyntaxError for a syntax error, 1 with the thrown message for a throw at load.
// `path` is JSON-encoded — it is source code, not a string.
// ---------------------------------------------------------------------------------------------

const IMPORT_SMOKE_TIMEOUT_MS = 30_000;

/** The command a smoke of `path` runs — shared by `importSmoke` (a real `spawnSync`) and the ship
 *  gate's tier 3 (through `deps.runIn`, so a test never spawns a process for it). */
function smokeCommand(path: string): { readonly cmd: string; readonly args: readonly string[] } {
  const code = `import(${JSON.stringify(path)}).then(()=>{process.exitCode=0},e=>{console.error(e);process.exitCode=1})`;
  return { cmd: process.execPath, args: ["-e", code] };
}

/** Empty string on success (nothing is printed on the happy path); the combined stdout+stderr,
 *  non-empty, on any failure — a syntax error, a missing import, or a throw at module load. */
export function importSmoke(path: string): string {
  const { cmd, args } = smokeCommand(path);
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: IMPORT_SMOKE_TIMEOUT_MS });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

export const HEAD_MAX_CHARS = 400;
const AT_FRAME_RE = /^\s*at\s/;
const NODE_BANNER_RE = /^Node\.js v/;

/** A crashed child's class and message are its FIRST non-frame line — `tail` is useless here
 *  because every Node dump ends `}` / `Node.js v…`. Drops `at ` frames and the version banner,
 *  capped at 400 characters. */
export function head(out: string, n: number = HEAD_MAX_CHARS): string {
  const kept = out
    .split("\n")
    .filter((l) => !AT_FRAME_RE.test(l) && !NODE_BANNER_RE.test(l.trim()))
    .join("\n")
    .trim();
  return kept.length > n ? kept.slice(0, n) : kept;
}

/** A suite's verdict is its last lines. */
export function tail(out: string, n: number = 20): string {
  const lines = out.split("\n").filter((l) => l.trim().length > 0);
  return lines.slice(-n).join("\n");
}

// ---------------------------------------------------------------------------------------------
// J3.11 (JOB-C15, SAF-05, TST-19) — the three-tier ship gate. Cheapest first, each a real signal,
// returning on the first failure. `deps.runIn` is REQUIRED so a test never spawns `npm test`
// itself — every tier that would otherwise spawn a real process (2, 3, 4) goes through it.
// ---------------------------------------------------------------------------------------------

/** One tier's child budget — sized in J3.15's budget assertion against `maxRunMin`. */
export const GATE_TIMEOUT_MS = 300_000;

export interface GateDeps {
  /** The worktree the pass is running in. */
  readonly work: string;
  readonly runIn: (dir: string, cmd: string, args: readonly string[], env?: Record<string, string>) => { ok: boolean; out: string };
  /** Where tier 4's `<NS>_DB` redirects point — a throwaway directory, never the live store. */
  readonly scratch: string;
  readonly jobs: readonly Job[];
}

export interface GateResult {
  readonly ok: boolean;
  readonly detail: string;
}

/** `nightly-sandcastle` -> `NIGHTLY_SANDCASTLE` — the derived half of a job's dry-run knob name.
 *  Never used to derive a KILL SWITCH (`*_NO_<FEATURE>`, KRN-07): that shape is plugin+feature,
 *  not derivable from a job name, and this function must not be generalised to try. */
const envPrefixOf = (jobName: string): string => jobName.toUpperCase().replace(/-/g, "_");

/**
 * Tier order: blocked paths (free) · `npm test` in the worktree · an import smoke of every
 * changed non-test `.ts` file · a dry run of every changed REGISTERED job, DB redirected into
 * `deps.scratch`. `gate([])` returns `ok: true` without running anything — the caller (J3.12)
 * never calls it over an empty change set, but the function itself does not assume that.
 */
export function gate(files: readonly string[], deps: GateDeps): GateResult {
  if (files.length === 0) {
    return { ok: true, detail: "no changed files — nothing to gate" };
  }

  // Tier 1 — blocked paths. Free, and it must be first: a pass that touched a blocked file
  // should not spend three minutes on a suite before being refused.
  for (const f of files) {
    const why = blockedBy(f);
    if (why !== null) {
      return { ok: false, detail: `blocked: ${f} — ${why}` };
    }
  }

  // Tier 2 — the full suite. A suite's verdict is its last lines.
  const suite = deps.runIn(deps.work, "npm", ["test"]);
  if (!suite.ok) {
    return { ok: false, detail: `npm test failed:\n${tail(suite.out)}` };
  }

  // Tier 3 — an import smoke of every changed non-test .ts file. Catches what a green suite does
  // not: a file with no test that no longer parses or throws at module load.
  const smokeTargets = files.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  let smokeCount = 0;
  for (const f of smokeTargets) {
    const { cmd, args } = smokeCommand(join(deps.work, f));
    const result = deps.runIn(deps.work, cmd, args);
    smokeCount++;
    if (!result.ok) {
      return { ok: false, detail: `import smoke failed for ${f}:\n${head(result.out)}` };
    }
  }

  // Tier 4 — a dry run of every changed REGISTERED job (SKL-05: an unregistered file is not a
  // job). Dormant at N3 by construction: BLOCKED forbids a pass touching the only registry job,
  // so no pass can ever produce a changed job file for this loop to find — it becomes live the
  // day a second job lands (N5's ops builtins). The DB redirect is the load-bearing half: a
  // dry-run flag is the job's own promise about itself, and this gate exists because tonight's
  // pass may have just edited the code that keeps that promise.
  const changedJobFiles = files.filter((f) => /^host\/jobs\/[^/]+\.ts$/.test(f) && f !== "host/jobs/index.ts");
  let dryRunCount = 0;
  for (const f of changedJobFiles) {
    const jobName = f.slice("host/jobs/".length, -".ts".length);
    const job = deps.jobs.find((j) => j.name === jobName);
    if (!job) continue; // not a registered job — running it would be discovery through the back door
    const env: Record<string, string> = { [`${envPrefixOf(jobName)}_DRY_RUN`]: "1" };
    for (const ns of DB_NAMESPACES) {
      env[`${ns.toUpperCase()}_DB`] = join(deps.scratch, `${ns}.db`);
    }
    const result = deps.runIn(deps.work, "node", ["host/run.ts", jobName], env);
    dryRunCount++;
    if (!result.ok) {
      return { ok: false, detail: `dry run failed for ${jobName}:\n${tail(result.out)}` };
    }
  }

  return { ok: true, detail: `npm test, ${smokeCount} import smoke(s), ${dryRunCount} dry run(s)` };
}

// ---------------------------------------------------------------------------------------------
// J3.12 (JOB-C15, SAF-01…07, INS-06, KRN-07, INV-1) — the pass: rotate, refuse, prep, run, check
// both escape routes, gate, land or discard, report — every write path env-gated (the whole
// safe-run surface is these seven knobs).
// ---------------------------------------------------------------------------------------------

export const NIGHTLY_NO_SANDCASTLE_ENV: EnvSpec = {
  key: "NIGHTLY_NO_SANDCASTLE",
  default: "0",
  why: "KRN-07 kill switch: the pass logs killed and returns before reading anything",
};
export const NIGHTLY_SANDCASTLE_BASE_ENV: EnvSpec = {
  key: "NIGHTLY_SANDCASTLE_BASE",
  default: "main",
  why: "the branch a pass lands on; a checkout on any other branch refuses (not-on-base)",
};
export const NIGHTLY_SANDCASTLE_DRY_RUN_ENV: EnvSpec = {
  key: "NIGHTLY_SANDCASTLE_DRY_RUN",
  default: "0",
  why: "SAF-01: run the agent and the gate for real, write nothing — no commit, no merge, no state. This dry run COSTS one agent pass (SAF-07); *_MAX=0 is the free one",
};
export const NIGHTLY_SANDCASTLE_NO_MERGE_ENV: EnvSpec = {
  key: "NIGHTLY_SANDCASTLE_NO_MERGE",
  default: "0",
  why: "SAF-02 shadow mode: commit inside the worktree, never move the base branch",
};
export const NIGHTLY_SANDCASTLE_MAX_ENV: EnvSpec = {
  key: "NIGHTLY_SANDCASTLE_MAX",
  default: "1",
  why: "SAF-03/04: passes per tick. 0 is the free smoke test — everything but the agent — and it is free",
};
export const NIGHTLY_SANDCASTLE_ONLY_ENV: EnvSpec = {
  key: "NIGHTLY_SANDCASTLE_ONLY",
  why: "SAF-06: force one goal key instead of the rotation, for debugging one brief end to end",
};
export const NIGHTLY_SANDCASTLE_MODEL_ENV: EnvSpec = {
  key: "NIGHTLY_SANDCASTLE_MODEL",
  why: "override the model tier one pass spends on without a code change; the value is checked against PINNED at the one place RunRequest.model is built (HRN-11)",
};

/** INV-1: there is no local state file. Rotation lives in nightly.db, namespace nightly. */
function ensureRotationTable(db: Db): void {
  db.migrate("nightly", [
    "CREATE TABLE nightly_rotation (id INTEGER PRIMARY KEY CHECK (id = 1), goal_index INTEGER NOT NULL, recent TEXT NOT NULL)",
  ]);
}

export interface RotationState {
  readonly index: number;
  readonly recent: readonly string[];
}

export function readState(db: Db): RotationState {
  ensureRotationTable(db);
  const row = db.handle().prepare("SELECT goal_index, recent FROM nightly_rotation WHERE id = 1").get() as
    | { goal_index: number; recent: string }
    | undefined;
  if (!row) return { index: 0, recent: [] };
  return { index: row.goal_index, recent: JSON.parse(row.recent) as string[] };
}

export function writeState(db: Db, index: number, recent: readonly string[]): void {
  ensureRotationTable(db);
  db.handle()
    .prepare(
      `INSERT INTO nightly_rotation (id, goal_index, recent) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET goal_index = excluded.goal_index, recent = excluded.recent`,
    )
    .run(index, JSON.stringify(recent));
}

/** Every deps `exec` needs, assembled once in the real argv block (host/run.ts, J3.14) and built
 *  fresh per test here. `runner`/`git`/`now`/`db`/`log`/`runIn` are all required — ruling 2. */
export interface PassDeps {
  /** The checkout — read, never written by the agent. */
  readonly root: string;
  readonly runner: Runner;
  readonly git: (dir: string, ...args: string[]) => string;
  readonly now: () => Date;
  readonly db: Db;
  readonly log: Logger;
  /** Project-relative parent of every pass worktree. */
  readonly worktreeRoot: string;
  readonly runLogPath: (name: string) => string;
  readonly runIn: GateDeps["runIn"];
  readonly scratchRoot: string;
  readonly jobs: readonly Job[];
}

/** The uncommitted files the agent left behind inside the worktree — `git status --porcelain`,
 *  parsed. This is what the gate runs over, and what step 13 stages for the landing commit. */
function changedFiles(git: PassDeps["git"], wtPath: string): string[] {
  // `-uall`: a plain `git status --porcelain` collapses a brand-new untracked DIRECTORY into one
  // `?? dir/` line instead of listing the files inside it — which would make a new file under a
  // blocked directory (host/supervisor.ts, say) invisible to tier 1's per-file blockedBy check.
  const out = git(wtPath, "status", "--porcelain", "-uall");
  return out
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => l.slice(3).trim());
}

type LandOutcome =
  | { readonly kind: "no-op" }
  | { readonly kind: "gate-failed"; readonly detail: string }
  | { readonly kind: "dry-run"; readonly detail: string }
  | { readonly kind: "landed"; readonly sha: string }
  | { readonly kind: "ff-miss" };

/**
 * Step 13, and the ff-miss recovery. `--ff-only` is the guarantee: the base only moves forward
 * onto a commit made on top of it, so a concurrent human commit fails loudly. On a miss: rebase
 * the worktree onto `base` once, re-run `gate(files)` FROM SCRATCH (a rebased diff is a different
 * diff, and landing it on the strength of the pre-rebase gate is exactly what this gate exists to
 * prevent), retry once. A second failure discards.
 */
function landOrDiscard(deps: PassDeps, wt: Worktree, base: string, branch: string, goal: Goal, verdict: Verdict | null, dryRun: boolean, noMerge: boolean): LandOutcome {
  const files = changedFiles(deps.git, wt.path);
  if (files.length === 0) return { kind: "no-op" };

  const gateOpts = { work: wt.path, runIn: deps.runIn, scratch: deps.scratchRoot, jobs: deps.jobs };
  const first = gate(files, gateOpts);
  if (!first.ok) return { kind: "gate-failed", detail: first.detail };
  if (dryRun) return { kind: "dry-run", detail: first.detail };

  const subject = verdict?.summary ? `chore(nightly): ${verdict.summary}` : `chore(nightly): ${goal.title}`;
  deps.git(wt.path, "add", "-A", "--", ...files);
  deps.git(wt.path, "commit", "-m", subject, "-m", `nightly sandcastle — goal: ${goal.key}`);

  if (noMerge) {
    return { kind: "landed", sha: deps.git(wt.path, "rev-parse", "HEAD").trim() };
  }

  const tryMerge = (): boolean => {
    try {
      deps.git(deps.root, "merge", "--ff-only", branch);
      return true;
    } catch {
      return false;
    }
  };

  if (tryMerge()) {
    return { kind: "landed", sha: deps.git(deps.root, "rev-parse", "HEAD").trim() };
  }

  try {
    deps.git(wt.path, "rebase", base);
  } catch {
    // A rebase conflict is a discard, same as any other ff-miss — the worktree is torn down
    // regardless (execPass's own `finally`), so there is nothing to clean up here.
    return { kind: "ff-miss" };
  }
  const second = gate(files, gateOpts);
  if (!second.ok) return { kind: "ff-miss" };
  if (tryMerge()) {
    return { kind: "landed", sha: deps.git(deps.root, "rev-parse", "HEAD").trim() };
  }
  return { kind: "ff-miss" };
}

/**
 * The pass, end to end. Every step is a place it can stop. Nothing here reaches the real
 * checkout except through `deps.root`'s own working tree state (steps 2-4, 12) — every WRITE
 * happens inside the worktree until step 13's `merge --ff-only`.
 */
export async function execPass(deps: PassDeps): Promise<void> {
  const log = deps.log;

  // 1. KRN-07 kill switch.
  if (envStr(NIGHTLY_NO_SANDCASTLE_ENV) === "1") {
    log.info("killed", {});
    return;
  }

  const base = envStr(NIGHTLY_SANDCASTLE_BASE_ENV);
  const dryRun = envStr(NIGHTLY_SANDCASTLE_DRY_RUN_ENV) === "1";
  const noMerge = envStr(NIGHTLY_SANDCASTLE_NO_MERGE_ENV) === "1";
  const max = envNum(NIGHTLY_SANDCASTLE_MAX_ENV);
  const only = envOptional(NIGHTLY_SANDCASTLE_ONLY_ENV);
  const modelOverride = envOptional(NIGHTLY_SANDCASTLE_MODEL_ENV);

  // 2. not-on-base.
  const branch = deps.git(deps.root, "rev-parse", "--abbrev-ref", "HEAD").trim();
  if (branch !== base) {
    log.warn("skip", { reason: "not-on-base" });
    return;
  }

  // 3. tree-dirty.
  if (deps.git(deps.root, "status", "--porcelain").trim() !== "") {
    log.warn("skip", { reason: "tree-dirty" });
    return;
  }

  // 4. ruling 6, route two's baseline.
  let originBefore = "";
  try {
    originBefore = deps.git(deps.root, "rev-parse", `origin/${base}`).trim();
  } catch {
    originBefore = ""; // no remote configured — nothing to compare
  }

  const passBranch = `nightly/${INSTANCE}`; // INS-06
  const wtPath = join(deps.worktreeRoot, "nightly-sandcastle");

  // 5. reap a stranded sibling before touching our own path.
  reapWorktrees(deps.root, deps.worktreeRoot, wtPath);

  // 6. rotation. An unknown ONLY key throws HERE, before anything is prepped (SAF-06).
  const state = readState(deps.db);
  const { goal, nextIndex } = nextGoal(state, only);

  // 7. prep (idempotent — HRN-12).
  const wt = prepWorktree(deps.root, { branch: passBranch, base }, wtPath);

  try {
    // 8. node_modules, so tier 2's `npm test` needs no `npm ci`.
    const nmTarget = join(deps.root, "node_modules");
    const nmLink = join(wt.path, "node_modules");
    if (existsSync(nmTarget) && !existsSync(nmLink)) {
      try {
        symlinkSync(nmTarget, nmLink);
      } catch (e) {
        log.warn("node-modules-symlink-failed", { msg: e instanceof Error ? e.message : String(e) });
      }
    }

    // 9. MAX === 0 — SAF-04's free smoke: everything but the agent.
    if (max === 0) {
      log.info("free-smoke", { goal: goal.key });
      log.raw(`nightly-sandcastle report: goal=${goal.key} outcome=free-smoke`);
      writeState(deps.db, nextIndex, state.recent);
      return;
    }

    // 10. run.
    const runLogPath = deps.runLogPath("nightly-sandcastle");
    const promptArgs: Record<string, string> = {
      GOAL: goal.key,
      BRIEF: goal.brief,
      WORKTREE: worktreePromptLines(wt).join("\n"),
    };
    // D10: exactly one of skill/exec. The registered job carries BOTH (skill for SKL-01/render,
    // exec for host/run.ts's dispatch) — the skill invocation runJob makes here must drop exec,
    // or the D10 check inside runJob throws "both set".
    const { exec: _exec, ...jobWithoutExec } = nightlySandcastleJob;
    void _exec;
    const jobForRun: Job = {
      ...jobWithoutExec,
      promptArgs,
      ...(modelOverride !== undefined ? { model: modelOverride } : {}),
    };
    log.info("pass-start", { goal: goal.key, model: jobForRun.model ?? DEFAULTS.model });
    const run = await runJob(jobForRun, { runner: deps.runner, cwd: wt.path, logPath: runLogPath });

    // 11. verdict — HRN-10's "malformed payload writes nothing" as a warning, not a crash.
    const verdict = parseVerdict(run.stdout);
    if (verdict === null) {
      log.warn("no-verdict", { goal: goal.key });
    }

    // 12. escape checks, both routes (ruling 6) — detection, not containment.
    const porcelainAfter = deps.git(deps.root, "status", "--porcelain").trim();
    if (porcelainAfter !== "") {
      log.error("write-scope-escaped", { reason: "tree-dirty", detail: porcelainAfter });
    }
    let originAfter = "";
    try {
      originAfter = deps.git(deps.root, "rev-parse", `origin/${base}`).trim();
    } catch {
      originAfter = "";
    }
    if (originAfter !== originBefore) {
      log.error("write-scope-escaped", { reason: "remote-moved" });
    }

    // 13. land or discard.
    const outcome = landOrDiscard(deps, wt, base, passBranch, goal, verdict, dryRun, noMerge);
    if (outcome.kind === "no-op") {
      log.info("no-op", { goal: goal.key });
    } else if (outcome.kind === "gate-failed") {
      log.error("gate-failed", { goal: goal.key, detail: outcome.detail });
    } else if (outcome.kind === "dry-run") {
      log.info("dry-run-ok", { goal: goal.key, detail: outcome.detail });
    } else if (outcome.kind === "landed") {
      log.info("landed", { goal: goal.key, sha: outcome.sha });
    } else {
      log.error("ff-miss", { goal: goal.key });
    }

    // 14. report, then rotate — only a real landing pass advances the rotation (a gate failure or
    // a dry run leaves the same goal for the next tick).
    log.raw(
      `nightly-sandcastle report: goal=${goal.key} outcome=${outcome.kind} verdict=${verdict ? verdict.outcome : "none"}`,
    );
    if (!dryRun && outcome.kind === "landed") {
      writeState(deps.db, nextIndex, state.recent);
    }
  } finally {
    teardownWorktree(deps.root, wt.path);
  }
}

// ---------------------------------------------------------------------------------------------
// The registered job.
// ---------------------------------------------------------------------------------------------

const nightlySandcastleJob: Job = defineJob({
  name: "nightly-sandcastle",
  description: "Make one small, verified improvement to the engine repo in a single unattended pass (JOB-C15).",
  plugin: "nightly",
  skill: "nightly-sandcastle",
  // Inheriting DEFAULTS.model is spelled DEFAULTS.model (HRN-11) — never a re-typed literal, which
  // is what keeps the model version a one-line bump (test/model.test.ts test 6).
  model: DEFAULTS.model,
  permissionMode: DEFAULTS.permissionMode,
  local: true,
  taskClass: "impl",
  exec: execPass,
});

export default nightlySandcastleJob;
