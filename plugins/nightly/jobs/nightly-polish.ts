// nightly-polish (JOB-C14): one small docs improvement per pass, on this checkout's own Markdown.
//
// The pass rotates through four goals. The agent edits inside a worktree. The job, not the agent,
// decides what ships: the diff must pass a doc gate, and it reaches the base branch only by
// `merge --ff-only`. The commit IS the release — there is no PR step.
//
// This file lives under plugins/, so it may import only kernel/ports/* and kernel/plugin.ts
// (TST-03). Every runtime capability — git, the database, the log, env values, worktrees, the
// runner — comes in through `PolishDeps`. Its member names match the host's job context, so the
// host hands that context in as it is.
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { killSwitch, isKilled, type EnvSpec } from "../../../kernel/plugin.ts";
import { DEFAULTS, defineJob, type Job } from "../../../kernel/ports/job.ts";
import type { Runner, RunResult } from "../../../kernel/ports/runner.ts";

export const JOB_NAME = "nightly-polish";

// ---------------------------------------------------------------------------------------------
// Knobs (KRN-06). The SAF surface mirrors nightly-sandcastle's.
// ---------------------------------------------------------------------------------------------

export const NIGHTLY_NO_POLISH_ENV: EnvSpec = killSwitch(
  "nightly",
  "polish",
  "KRN-07 kill switch: the polish pass logs killed and returns before reading anything",
);
export const NIGHTLY_POLISH_BASE_ENV: EnvSpec = {
  key: "NIGHTLY_POLISH_BASE",
  default: "main",
  why: "the branch a polish pass lands on; a checkout on any other branch skips (not-on-base)",
};
export const NIGHTLY_POLISH_DRY_RUN_ENV: EnvSpec = {
  key: "NIGHTLY_POLISH_DRY_RUN",
  default: "0",
  why: "SAF-01: run the agent and the doc gate for real, write nothing — no commit, no merge, no state, no issue. Costs one agent pass (SAF-07); *_MAX=0 is the free one",
};
export const NIGHTLY_POLISH_NO_MERGE_ENV: EnvSpec = {
  key: "NIGHTLY_POLISH_NO_MERGE",
  default: "0",
  why: "SAF-02 shadow mode: commit inside the worktree, never move the base branch",
};
export const NIGHTLY_POLISH_MAX_ENV: EnvSpec = {
  key: "NIGHTLY_POLISH_MAX",
  default: "1",
  why: "SAF-03/04: 1 runs one real pass per tick. 0 is the free smoke test — everything but the agent",
};
export const NIGHTLY_POLISH_ONLY_ENV: EnvSpec = {
  key: "NIGHTLY_POLISH_ONLY",
  why: "SAF-06: force one goal key instead of the rotation, to debug one brief end to end",
};
export const NIGHTLY_POLISH_MODEL_ENV: EnvSpec = {
  key: "NIGHTLY_POLISH_MODEL",
  why: "override the model one polish pass spends on without a code change; runJob checks it is pinned (HRN-11)",
};
export const NIGHTLY_POLISH_TRACKER_ENV: EnvSpec = {
  key: "NIGHTLY_POLISH_TRACKER",
  why: "owner/repo that gets one issue per pass, created and closed in the same pass. Unset (the default) means no issue and no gh call",
};

export const ENV: readonly EnvSpec[] = [
  NIGHTLY_POLISH_BASE_ENV,
  NIGHTLY_POLISH_DRY_RUN_ENV,
  NIGHTLY_POLISH_NO_MERGE_ENV,
  NIGHTLY_POLISH_MAX_ENV,
  NIGHTLY_POLISH_ONLY_ENV,
  NIGHTLY_POLISH_MODEL_ENV,
  NIGHTLY_POLISH_TRACKER_ENV,
];

// ---------------------------------------------------------------------------------------------
// Goals.
// ---------------------------------------------------------------------------------------------

export interface Goal {
  readonly key: string;
  readonly title: string;
  readonly brief: string;
}

export const GOALS: readonly Goal[] = [
  {
    key: "text-walls",
    title: "make one dense doc scannable",
    brief:
      "Pick one dense Markdown doc and reshape it so a reader can scan it: headings, short lists, a table where rows really repeat, a first line that answers the question the doc exists for. Move and reshape text; never delete information.",
  },
  {
    key: "plain-english",
    title: "rewrite one section in plain English",
    brief:
      "Pick one section and rewrite it in plain English: short common words, short sentences, one idea per sentence, active voice. Keep a hard technical term when it is needed, and add a short plain meaning in parentheses the first time it appears. Never change what the text means.",
  },
  {
    key: "doc-vs-code",
    title: "fix one doc claim that drifted from the code",
    brief:
      "Pick one claim in a doc — a file path, a command, a count, a function or knob name — check it against the code, and fix the doc if it drifted. Read the code, not another doc. If you add a count, only do it when a test already pins it.",
  },
  {
    key: "structure",
    title: "fix one structure problem",
    brief:
      "Fix one navigation problem: a broken link, a missing index entry, or a section that sits in the wrong doc or the wrong place in its doc. Keep it to one small diff; if the fix needs more, change nothing and leave it as a suggestion.",
  },
];

/** Rotates by `state.index`, wrapping. `only` forces one key and does not advance the index;
 *  an unknown key throws. */
export function nextGoal(
  state: { readonly index: number },
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

/** How many recent targets the rotation keeps. */
export const RECENT_MAX = 12;

/** Newest first, no duplicates, at most `RECENT_MAX`. */
export function pushRecent(recent: readonly string[], touched: readonly string[]): string[] {
  return [...new Set([...touched, ...recent])].slice(0, RECENT_MAX);
}

/** The promptArg that steers the agent off a file it just touched. `-` when there is none. */
export function recentLine(recent: readonly string[]): string {
  if (recent.length === 0) return "-";
  return `RECENTLY TOUCHED — pick a different file unless the goal really points back here: ${recent.join(", ")}`;
}

// ---------------------------------------------------------------------------------------------
// The report — the skill's `<<<POLISH … POLISH>>>` block. The last block wins: an agent often
// echoes the template first. Fields are `name: value` lines; a missing field reads `-`.
// ---------------------------------------------------------------------------------------------

export interface Report {
  readonly target: string;
  readonly summary: string;
  readonly suggestion: string;
}

export function parseReport(stdout: string): Report | null {
  const text = stdout.replace(/\r\n?/g, "\n");
  const re = /<<<POLISH([\s\S]*?)POLISH>>>/g;
  let block: string | null = null;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) block = m[1] ?? "";
  if (block === null) return null;
  const field = (name: string): string => {
    const hit = new RegExp(`^\\s*${name}:[ \\t]*(.*)$`, "m").exec(block!);
    const v = hit?.[1]?.trim() ?? "";
    return v === "" ? "-" : v;
  };
  return { target: field("target"), summary: field("summary"), suggestion: field("suggestion") };
}

// ---------------------------------------------------------------------------------------------
// The doc gate. Tier 1 (free): every changed path is an edit to an existing Markdown file outside
// the off-limits trees. Tier 2: `npm test` in the worktree — README claims are gated there.
// ---------------------------------------------------------------------------------------------

/** One line of `git status --porcelain`: the two-letter code and the path. */
export interface Change {
  readonly code: string;
  readonly path: string;
}

const OFF_LIMITS: readonly { readonly re: RegExp; readonly why: string }[] = [
  { re: /^\.claude\//, why: "rendered or tool-owned, never hand-edited (SKL-04)" },
  { re: /^plugins\/[^/]+\/skills\//, why: "a pass must not rewrite the instructions the next pass reads" },
  { re: /^\.github\//, why: "a green suite says nothing about whether CI still runs it" },
];

/** Why `c` may not ship, or `null` when it may. */
export function refusal(c: Change): string | null {
  if (!c.path.endsWith(".md")) return "only Markdown files may change";
  const row = OFF_LIMITS.find((r) => r.re.test(c.path));
  if (row) return row.why;
  // Only an edit to a tracked file: no new doc, no deleted doc, no rename.
  if (c.code.replace(/[ M]/g, "") !== "") return "a pass edits an existing doc; it never adds, deletes or renames one";
  return null;
}

/** Porcelain v1 lines, parsed. `-uall` lists every new file, never a collapsed directory. */
export function parsePorcelain(out: string): Change[] {
  return out
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => ({ code: l.slice(0, 2), path: l.slice(3).trim() }));
}

export interface GateResult {
  readonly ok: boolean;
  readonly detail: string;
}

export type RunIn = (dir: string, cmd: string, args: readonly string[], env?: Record<string, string>) => {
  ok: boolean;
  out: string;
};

/** A suite's verdict is its last lines. */
const tail = (out: string, n = 20): string =>
  out.split("\n").filter((l) => l.trim().length > 0).slice(-n).join("\n");

export function gate(changes: readonly Change[], work: string, runIn: RunIn): GateResult {
  if (changes.length === 0) return { ok: true, detail: "no changed files — nothing to gate" };
  for (const c of changes) {
    const why = refusal(c);
    if (why !== null) return { ok: false, detail: `refused: ${c.path} — ${why}` };
  }
  const suite = runIn(work, "npm", ["test"]);
  if (!suite.ok) return { ok: false, detail: `npm test failed:\n${tail(suite.out)}` };
  return { ok: true, detail: `${changes.length} doc(s), npm test green` };
}

// ---------------------------------------------------------------------------------------------
// Landing. `--ff-only` means the base only moves onto a commit made on top of it. When the base
// moved during the pass (a human commit, most often), rebase once, gate again from scratch — a
// rebased diff is a new diff — and try once more. A rebase conflict aborts, so the worktree is
// left clean and the base never moves.
// ---------------------------------------------------------------------------------------------

export type Git = (dir: string, ...args: string[]) => string;

export type MergeResult =
  | { readonly kind: "landed"; readonly sha: string; readonly rebased: boolean }
  | { readonly kind: "ff-miss"; readonly detail: string };

export function mergeWithRetry(
  git: Git,
  o: { readonly root: string; readonly work: string; readonly branch: string; readonly base: string; readonly regate: () => GateResult },
): MergeResult {
  const ff = (): boolean => {
    try {
      git(o.root, "merge", "--ff-only", o.branch);
      return true;
    } catch {
      return false;
    }
  };
  const head = (): string => git(o.root, "rev-parse", "HEAD").trim();

  if (ff()) return { kind: "landed", sha: head(), rebased: false };

  try {
    git(o.work, "rebase", o.base);
  } catch {
    try {
      git(o.work, "rebase", "--abort");
    } catch {
      // Nothing to abort: the rebase failed before it started.
    }
    return { kind: "ff-miss", detail: `rebase onto ${o.base} conflicted` };
  }
  const second = o.regate();
  if (!second.ok) return { kind: "ff-miss", detail: `gate failed after rebase: ${second.detail}` };
  if (ff()) return { kind: "landed", sha: head(), rebased: true };
  return { kind: "ff-miss", detail: `${o.base} moved again after the rebase` };
}

// ---------------------------------------------------------------------------------------------
// Rotation state — nightly.db, its own namespace and table (INV-1: no local state file).
// ---------------------------------------------------------------------------------------------

/** The slice of the host's `Db` this job uses. */
export interface PolishDb {
  migrate(ns: string, steps: string[]): void;
  handle(): {
    prepare(sql: string): {
      get(...params: (string | number)[]): unknown;
      run(...params: (string | number)[]): unknown;
    };
  };
}

export interface RotationState {
  readonly index: number;
  readonly recent: readonly string[];
}

const NS = "nightly_polish";

function ensureTable(db: PolishDb): void {
  db.migrate(NS, [
    "CREATE TABLE nightly_polish_rotation (id INTEGER PRIMARY KEY CHECK (id = 1), goal_index INTEGER NOT NULL, recent TEXT NOT NULL)",
  ]);
}

export function readState(db: PolishDb): RotationState {
  ensureTable(db);
  const row = db.handle().prepare("SELECT goal_index, recent FROM nightly_polish_rotation WHERE id = 1").get() as
    | { goal_index: number; recent: string }
    | undefined;
  if (!row) return { index: 0, recent: [] };
  return { index: row.goal_index, recent: JSON.parse(row.recent) as string[] };
}

export function writeState(db: PolishDb, s: RotationState): void {
  ensureTable(db);
  db.handle()
    .prepare(
      `INSERT INTO nightly_polish_rotation (id, goal_index, recent) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET goal_index = excluded.goal_index, recent = excluded.recent`,
    )
    .run(s.index, JSON.stringify(s.recent));
}

// ---------------------------------------------------------------------------------------------
// The deps. Names follow the host's job context; the types are the slices this job uses.
// ---------------------------------------------------------------------------------------------

type Fields = Record<string, string | number | boolean>;

export interface PolishLog {
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
  raw(text: string): void;
}

export interface Shed {
  readonly skip: boolean;
  readonly downshift: boolean;
}

export interface Worktree {
  readonly path: string;
  readonly branch: string;
  readonly base: string;
  readonly head: string;
}

export interface PolishDeps {
  /** INS-06: this checkout's name. */
  readonly instance: string;
  /** The checkout. Only `merge --ff-only` ever writes to it. */
  readonly root: string;
  readonly now: () => Date;
  readonly log: PolishLog;
  readonly env: {
    readonly str: (spec: EnvSpec) => string;
    readonly num: (spec: EnvSpec) => number;
    readonly optional: (spec: EnvSpec) => string | undefined;
  };
  readonly db: (name: string) => PolishDb;
  /** `git -C dir ...args`; throws on a non-zero exit. */
  readonly git: Git;
  /** Never throws: `ok` is the exit status. */
  readonly runIn: RunIn;
  readonly runner: Runner;
  readonly shed: Shed;
  readonly runLogPath: (name: string) => string;
  readonly runJob: (
    job: Job,
    deps: { readonly runner: Runner; readonly cwd: string; readonly logPath: string; readonly shed: Shed },
  ) => Promise<RunResult>;
  readonly shedModel: (model: string, shed: Shed) => string;
  readonly worktree: {
    readonly root: string;
    readonly prep: (repo: string, spec: { readonly branch: string; readonly base: string }, path: string) => Worktree;
    readonly teardown: (repo: string, path: string) => void;
    readonly reap: (repo: string, under: string, keep: string) => string[];
    readonly promptLines: (wt: Worktree) => string[];
  };
}

// ---------------------------------------------------------------------------------------------
// The tracker issue: outward-facing, so off unless NIGHTLY_POLISH_TRACKER is set.
// ---------------------------------------------------------------------------------------------

function fileIssue(deps: PolishDeps, repo: string, title: string, body: string): void {
  const created = deps.runIn(deps.root, "gh", ["issue", "create", "--repo", repo, "--title", title, "--body", body]);
  if (!created.ok) {
    deps.log.warn("issue-failed", { step: "create", msg: tail(created.out, 3) });
    return;
  }
  const url = created.out.trim().split("\n").pop() ?? "";
  const num = /\/issues\/(\d+)$/.exec(url)?.[1];
  if (num === undefined) {
    deps.log.warn("issue-failed", { step: "parse", msg: url });
    return;
  }
  const closed = deps.runIn(deps.root, "gh", ["issue", "close", num, "--repo", repo, "--reason", "completed"]);
  if (!closed.ok) {
    deps.log.warn("issue-failed", { step: "close", issue: Number(num), msg: tail(closed.out, 3) });
    return;
  }
  deps.log.info("issue-closed", { issue: Number(num) });
}

// ---------------------------------------------------------------------------------------------
// The pass.
// ---------------------------------------------------------------------------------------------

/** One line, no control characters, capped — it becomes a commit subject. */
const oneLine = (s: string, max = 100): string => s.replace(/\s+/g, " ").trim().slice(0, max);

export async function execPolish(deps: PolishDeps): Promise<void> {
  const log = deps.log;

  // 1. Kill switch, before anything is read.
  if (isKilled(NIGHTLY_NO_POLISH_ENV)) {
    log.info("killed", {});
    return;
  }

  const base = deps.env.str(NIGHTLY_POLISH_BASE_ENV);
  const dryRun = deps.env.str(NIGHTLY_POLISH_DRY_RUN_ENV) === "1";
  const noMerge = deps.env.str(NIGHTLY_POLISH_NO_MERGE_ENV) === "1";
  const max = deps.env.num(NIGHTLY_POLISH_MAX_ENV);
  const only = deps.env.optional(NIGHTLY_POLISH_ONLY_ENV);
  const modelOverride = deps.env.optional(NIGHTLY_POLISH_MODEL_ENV);
  const tracker = deps.env.optional(NIGHTLY_POLISH_TRACKER_ENV);

  // 2. The checkout must be on the base branch and clean: never land on top of a human's work.
  const onBranch = deps.git(deps.root, "rev-parse", "--abbrev-ref", "HEAD").trim();
  if (onBranch !== base) {
    log.warn("skip", { reason: "not-on-base" });
    return;
  }
  if (deps.git(deps.root, "status", "--porcelain").trim() !== "") {
    log.warn("skip", { reason: "tree-dirty" });
    return;
  }
  let originBefore = "";
  try {
    originBefore = deps.git(deps.root, "rev-parse", `origin/${base}`).trim();
  } catch {
    originBefore = ""; // no remote
  }

  // 3. Rotation. An unknown ONLY key throws here, before any worktree exists.
  const db = deps.db("nightly");
  const state = readState(db);
  const { goal, nextIndex } = nextGoal(state, only);

  // 4. The worktree. Its own parent directory, so the reap never touches another job's tree.
  const branch = `${JOB_NAME}/${deps.instance}`;
  const parent = join(deps.worktree.root, JOB_NAME);
  const wtPath = join(parent, "tree");
  deps.worktree.reap(deps.root, parent, wtPath);
  const wt = deps.worktree.prep(deps.root, { branch, base }, wtPath);

  try {
    // node_modules, so the gate's `npm test` needs no install.
    const nmTarget = join(deps.root, "node_modules");
    const nmLink = join(wt.path, "node_modules");
    if (existsSync(nmTarget) && !existsSync(nmLink)) {
      try {
        symlinkSync(nmTarget, nmLink);
      } catch (e) {
        log.warn("node-modules-symlink-failed", { msg: e instanceof Error ? e.message : String(e) });
      }
    }

    // 5. MAX=0: the free smoke — everything but the agent.
    if (max === 0) {
      log.info("free-smoke", { goal: goal.key });
      log.raw(`${JOB_NAME} report: goal=${goal.key} outcome=free-smoke`);
      writeState(db, { index: nextIndex, recent: state.recent });
      return;
    }

    // 6. Run the skill. The registered job sets both `skill` and `exec`; runJob refuses a job
    // with both (D10), so the run gets the job without `exec`.
    const { exec: _exec, ...skillJob } = nightlyPolishJob;
    void _exec;
    const jobForRun: Job = {
      ...skillJob,
      promptArgs: {
        GOAL: goal.key,
        BRIEF: goal.brief,
        RECENT: recentLine(state.recent),
        WORKTREE: deps.worktree.promptLines(wt).join("\n"),
      },
      ...(modelOverride !== undefined ? { model: modelOverride } : {}),
    };
    log.info("pass-start", { goal: goal.key, model: deps.shedModel(jobForRun.model ?? DEFAULTS.model, deps.shed) });
    const run = await deps.runJob(jobForRun, {
      runner: deps.runner,
      cwd: wt.path,
      logPath: deps.runLogPath(JOB_NAME),
      shed: deps.shed,
    });
    const report = parseReport(run.stdout);
    if (report === null) log.warn("no-report", { goal: goal.key });

    // 7. Escape checks — detection, not containment.
    const dirtyAfter = deps.git(deps.root, "status", "--porcelain").trim();
    if (dirtyAfter !== "") log.error("write-scope-escaped", { reason: "tree-dirty", detail: dirtyAfter });
    let originAfter = "";
    try {
      originAfter = deps.git(deps.root, "rev-parse", `origin/${base}`).trim();
    } catch {
      originAfter = "";
    }
    if (originAfter !== originBefore) log.error("write-scope-escaped", { reason: "remote-moved" });

    // 8. Gate, then land or discard.
    const outcome = land(deps, wt, branch, base, goal, report, dryRun, noMerge);
    if (outcome.kind === "landed") log.info("landed", { goal: goal.key, sha: outcome.sha, files: outcome.files.length });
    else if (outcome.kind === "committed") log.info("committed-no-merge", { goal: goal.key, sha: outcome.sha });
    else if (outcome.kind === "dry-run") log.info("dry-run-ok", { goal: goal.key, detail: outcome.detail });
    else if (outcome.kind === "no-op") log.info("no-op", { goal: goal.key });
    else log.error(outcome.kind, { goal: goal.key, detail: outcome.detail });

    log.raw(`${JOB_NAME} report: goal=${goal.key} outcome=${outcome.kind} target=${report?.target ?? "-"}`);

    // 9. A dry run writes nothing: no state, no issue.
    if (dryRun) return;

    // A real pass always moves the rotation on, so one goal with nothing to do cannot stall it.
    // Only a landed change joins the recent list.
    const recent = outcome.kind === "landed" ? pushRecent(state.recent, outcome.files) : state.recent;
    writeState(db, { index: nextIndex, recent });

    // 10. One issue per pass, created and closed in the same pass.
    if (tracker === undefined) {
      log.info("issue-skipped", {});
    } else {
      const sha = outcome.kind === "landed" || outcome.kind === "committed" ? outcome.sha.slice(0, 12) : "-";
      const title = `[nightly] ${deps.now().toISOString().slice(0, 16)}Z polish (${goal.key}) — ${outcome.kind}`;
      const body = [
        `goal: ${goal.key} — ${goal.title}`,
        `outcome: ${outcome.kind}`,
        `commit: ${sha}`,
        `target: ${report?.target ?? "-"}`,
        `summary: ${report?.summary ?? "-"}`,
        `suggestion: ${report?.suggestion ?? "-"}`,
        ...("detail" in outcome ? ["", outcome.detail] : []),
        "",
        "Generated surface: this pass created and closed this issue itself.",
      ].join("\n");
      fileIssue(deps, tracker, title, body);
    }
  } finally {
    deps.worktree.teardown(deps.root, wt.path);
  }
}

type LandOutcome =
  | { readonly kind: "no-op" }
  | { readonly kind: "agent-committed"; readonly detail: string }
  | { readonly kind: "gate-failed"; readonly detail: string }
  | { readonly kind: "dry-run"; readonly detail: string }
  | { readonly kind: "committed"; readonly sha: string }
  | { readonly kind: "landed"; readonly sha: string; readonly files: readonly string[] }
  | { readonly kind: "ff-miss"; readonly detail: string };

function land(
  deps: PolishDeps,
  wt: Worktree,
  branch: string,
  base: string,
  goal: Goal,
  report: Report | null,
  dryRun: boolean,
  noMerge: boolean,
): LandOutcome {
  // The job owns the commit. An agent commit would land without the gate ever seeing it.
  const headNow = deps.git(wt.path, "rev-parse", "HEAD").trim();
  if (headNow !== wt.head) return { kind: "agent-committed", detail: `worktree HEAD moved to ${headNow.slice(0, 12)}` };

  const changes = parsePorcelain(deps.git(wt.path, "status", "--porcelain", "-uall"));
  if (changes.length === 0) return { kind: "no-op" };

  const first = gate(changes, wt.path, deps.runIn);
  if (!first.ok) return { kind: "gate-failed", detail: first.detail };
  if (dryRun) return { kind: "dry-run", detail: first.detail };

  const files = changes.map((c) => c.path);
  const summary = report && report.summary !== "-" ? oneLine(report.summary) : goal.title;
  deps.git(wt.path, "add", "-A", "--", ...files);
  // The commit carries its own identity: an unattended host may have none configured.
  deps.git(
    wt.path,
    "-c", `user.name=${JOB_NAME}`,
    "-c", `user.email=${JOB_NAME}@${deps.instance}`,
    "commit", "-m", `docs(nightly): ${summary}`, "-m", `nightly polish — goal: ${goal.key}`,
  );

  if (noMerge) return { kind: "committed", sha: deps.git(wt.path, "rev-parse", "HEAD").trim() };

  const merged = mergeWithRetry(deps.git, {
    root: deps.root,
    work: wt.path,
    branch,
    base,
    regate: () => gate(changes, wt.path, deps.runIn),
  });
  if (merged.kind === "ff-miss") return merged;
  return { kind: "landed", sha: merged.sha, files };
}

// ---------------------------------------------------------------------------------------------
// The registered job.
// ---------------------------------------------------------------------------------------------

const nightlyPolishJob: Job = defineJob({
  name: JOB_NAME,
  description: "One small docs improvement to this repo's own Markdown per unattended pass (JOB-C14).",
  plugin: "nightly",
  skill: JOB_NAME,
  model: DEFAULTS.model,
  permissionMode: DEFAULTS.permissionMode,
  local: true,
  taskClass: "impl",
  // One pass, one report: without this, a run that never prints the default completion signal
  // keeps iterating.
  maxIterations: 1,
  exec: (ctx) => execPolish(ctx),
});

export default nightlyPolishJob;
