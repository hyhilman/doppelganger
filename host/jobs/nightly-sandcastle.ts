// J3.8 (JOB-C15, SKL-02, SKL-05, SKL-07, TST-19, HRN-10) — nightly-sandcastle's pure decisions: the
// verdict vocabulary, the blocked paths, the goal rotation, and the import smoke. `exec` (the pass
// itself — prep, run, gate, land) arrives at J3.11/J3.12; this file's `defineJob` literal names
// `skill` only until then, which is valid (D10: `exec` is optional, and the literal has `skill`).
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { extractBlock, extractFields } from "../../kernel/runtime/payload.ts";
import { DEFAULTS, defineJob, type Job } from "../../kernel/ports/job.ts";

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

const HEAD_MAX_CHARS = 400;
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
// The registered job. `exec` arrives at J3.11/J3.12.
// ---------------------------------------------------------------------------------------------

export default defineJob({
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
}) satisfies Job;
