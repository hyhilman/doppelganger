// nightly-polish (JOB-C14). The pure parts are tested directly. The merge and the pass run against
// real git in throwaway repos: a rebase that leaves a half-applied state behind would wedge every
// later pass, and a mock cannot show that.
//
// This file sits under plugins/, so it imports only node: builtins, kernel/ports/* and the job
// itself. The deps are small fakes built here; the real database is tested from test/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Job } from "../../../kernel/ports/job.ts";
import type { RunResult } from "../../../kernel/ports/runner.ts";
import {
  GOALS,
  RECENT_MAX,
  gate,
  execPolish,
  mergeWithRetry,
  nextGoal,
  parsePorcelain,
  parseReport,
  pushRecent,
  recentLine,
  refusal,
  type PolishDb,
  type PolishDeps,
  type RunIn,
} from "./nightly-polish.ts";

const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const TMP = mkdtempSync(join(tmpdir(), "nightly-polish-test-"));
let seq = 0;
const fresh = (name: string): string => {
  const dir = join(TMP, `${seq++}-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// ---------------------------------------------------------------------------------------------
// The report.
// ---------------------------------------------------------------------------------------------

const block = (target: string, summary: string, suggestion: string): string =>
  `<<<POLISH\ntarget: ${target}\nsummary: ${summary}\nsuggestion: ${suggestion}\nPOLISH>>>`;

test("parseReport reads the block the skill documents (JOB-C14)", () => {
  assert.deepEqual(parseReport(`chatter\n${block("README.md", "split the setup wall", "-")}\n`), {
    target: "README.md",
    summary: "split the setup wall",
    suggestion: "-",
  });
});

test("parseReport: the last block wins, so an echoed template never counts", () => {
  const out = `${block("<path>", "<one line>", "<one line>")}\nwork...\n${block("CLAUDE.md", "fixed a link", "split roadmap")}`;
  assert.equal(parseReport(out)?.target, "CLAUDE.md");
  assert.equal(parseReport(out)?.suggestion, "split roadmap");
});

test("parseReport: no closed block is null; a missing or empty field reads -; CRLF reads the same", () => {
  assert.equal(parseReport("no block here"), null);
  assert.equal(parseReport("<<<POLISH\ntarget: x\n"), null);
  assert.deepEqual(parseReport("<<<POLISH\ntarget:\nPOLISH>>>"), { target: "-", summary: "-", suggestion: "-" });
  assert.equal(parseReport(block("a.md", "b", "c").replace(/\n/g, "\r\n"))?.summary, "b");
});

// ---------------------------------------------------------------------------------------------
// The doc gate.
// ---------------------------------------------------------------------------------------------

test("refusal: an edit to a tracked doc passes; code, off-limits trees, new, deleted and renamed files do not", () => {
  assert.equal(refusal({ code: " M", path: "README.md" }), null);
  assert.equal(refusal({ code: "M ", path: "docs/guide.md" }), null);
  const refused: [string, string][] = [
    [" M", "host/schedule.ts"],
    [" M", "package.json"],
    [" M", ".claude/skills/nightly-polish/SKILL.md"],
    [" M", "plugins/nightly/skills/nightly-polish/SKILL.md"],
    [" M", ".github/workflows/README.md"],
    ["??", "NEW.md"],
    [" D", "CLAUDE.md"],
    ["R ", "old.md -> new.md"],
  ];
  for (const [code, path] of refused) {
    assert.notEqual(refusal({ code, path }), null, `${code} ${path} should be refused`);
  }
});

test("parsePorcelain keeps the two-letter code and the path", () => {
  assert.deepEqual(parsePorcelain(" M README.md\n?? docs/new.md\n"), [
    { code: " M", path: "README.md" },
    { code: "??", path: "docs/new.md" },
  ]);
});

function recordingRunIn(result: { ok: boolean; out: string } = { ok: true, out: "" }): { runIn: RunIn; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    runIn: (_dir, cmd, args) => {
      calls.push([cmd, ...args]);
      return result;
    },
  };
}

test("gate: tier 1 refuses first and runs nothing", () => {
  const r = recordingRunIn();
  const out = gate([{ code: " M", path: "README.md" }, { code: " M", path: "host/run.ts" }], "/w", r.runIn);
  assert.equal(out.ok, false);
  assert.match(out.detail, /host\/run\.ts/);
  assert.equal(r.calls.length, 0);
});

test("gate: tier 2 is npm test in the worktree, and its failure carries the suite's last lines", () => {
  const green = recordingRunIn();
  assert.equal(gate([{ code: " M", path: "README.md" }], "/w", green.runIn).ok, true);
  assert.deepEqual(green.calls, [["npm", "test"]]);

  const red = recordingRunIn({ ok: false, out: "lots\nof\nnot ok 3 - README claims\n" });
  const out = gate([{ code: " M", path: "README.md" }], "/w", red.runIn);
  assert.equal(out.ok, false);
  assert.match(out.detail, /npm test failed:[\s\S]*README claims/);
});

test("gate over no changes is ok and runs nothing", () => {
  const r = recordingRunIn();
  assert.equal(gate([], "/w", r.runIn).ok, true);
  assert.equal(r.calls.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Rotation.
// ---------------------------------------------------------------------------------------------

test("nextGoal cycles all four goals and wraps; only forces one and does not advance; an unknown key throws", () => {
  assert.deepEqual(GOALS.map((g) => g.key), ["text-walls", "plain-english", "doc-vs-code", "structure"]);
  let index = 0;
  const seen: string[] = [];
  for (let i = 0; i < GOALS.length + 1; i++) {
    const { goal, nextIndex } = nextGoal({ index });
    seen.push(goal.key);
    index = nextIndex;
  }
  assert.deepEqual(seen, ["text-walls", "plain-english", "doc-vs-code", "structure", "text-walls"]);
  assert.deepEqual(nextGoal({ index: 2 }, "structure"), { goal: GOALS[3], nextIndex: 2 });
  assert.throws(() => nextGoal({ index: 0 }, "nope"), /unknown goal key "nope"/);
});

test("pushRecent keeps the newest first, drops duplicates, and caps at 12", () => {
  assert.equal(RECENT_MAX, 12);
  assert.deepEqual(pushRecent(["b.md", "a.md"], ["a.md"]), ["a.md", "b.md"]);
  const many = Array.from({ length: 20 }, (_, i) => `d${i}.md`);
  const out = pushRecent(many, ["new.md"]);
  assert.equal(out.length, 12);
  assert.equal(out[0], "new.md");
});

test("recentLine steers the agent off a file it just touched, and is - when there is none", () => {
  assert.equal(recentLine([]), "-");
  assert.match(recentLine(["README.md", "CLAUDE.md"]), /^RECENTLY TOUCHED — pick a different file.*README\.md, CLAUDE\.md$/);
});

// ---------------------------------------------------------------------------------------------
// mergeWithRetry over real git.
// ---------------------------------------------------------------------------------------------

function mergeFixture(): { root: string; work: string; branch: string } {
  const dir = fresh("merge");
  const root = join(dir, "root");
  const work = join(dir, "work");
  const branch = "nightly-polish/test";
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, "a.md"), "line one\n");
  writeFileSync(join(root, "b.md"), "untouched\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  git(root, "worktree", "add", "-q", "-B", branch, work, "main");
  return { root, work, branch };
}

const commitFile = (dir: string, file: string, text: string, msg: string): void => {
  writeFileSync(join(dir, file), text);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", msg);
};

const OK = () => ({ ok: true, detail: "ok" });

test("mergeWithRetry: a plain fast-forward when the base has not moved, and no re-gate", () => {
  const { root, work, branch } = mergeFixture();
  commitFile(work, "a.md", "line one, polished\n", "polish");
  let regates = 0;
  const out = mergeWithRetry(git, { root, work, branch, base: "main", regate: () => (regates++, OK()) });
  assert.equal(out.kind, "landed");
  assert.equal(git(root, "rev-parse", "main").trim(), git(work, "rev-parse", "HEAD").trim());
  assert.equal(regates, 0);
});

test("mergeWithRetry: the base moved on a disjoint file — rebase once, re-gate once, land both", () => {
  const { root, work, branch } = mergeFixture();
  commitFile(root, "b.md", "someone else's edit\n", "concurrent commit");
  commitFile(work, "a.md", "line one, polished\n", "polish");
  let regates = 0;
  const out = mergeWithRetry(git, { root, work, branch, base: "main", regate: () => (regates++, OK()) });
  assert.deepEqual(out.kind === "landed" && out.rebased, true);
  assert.equal(regates, 1);
  assert.equal(git(root, "rev-parse", "main").trim(), git(work, "rev-parse", "HEAD").trim());
  assert.match(git(root, "show", "main:b.md"), /someone else's edit/);
  assert.match(git(root, "show", "main:a.md"), /polished/);
});

test("mergeWithRetry: a real conflict aborts the rebase — worktree clean, branch at its own tip, base unmoved", () => {
  const { root, work, branch } = mergeFixture();
  commitFile(root, "a.md", "someone else's line one\n", "conflicting commit");
  const baseBefore = git(root, "rev-parse", "main").trim();
  commitFile(work, "a.md", "line one, polished\n", "polish");
  let regates = 0;
  const out = mergeWithRetry(git, { root, work, branch, base: "main", regate: () => (regates++, OK()) });
  assert.equal(out.kind, "ff-miss");
  assert.equal(regates, 0);
  assert.equal(git(work, "status", "--porcelain").trim(), "");
  assert.ok(!existsSync(git(work, "rev-parse", "--git-path", "rebase-merge").trim()), "no rebase left in progress");
  assert.equal(git(work, "rev-parse", "--abbrev-ref", "HEAD").trim(), branch);
  assert.equal(git(work, "log", "-1", "--format=%s").trim(), "polish");
  assert.equal(git(root, "rev-parse", "main").trim(), baseBefore);
});

test("mergeWithRetry: a red gate after the rebase discards — the base never moves", () => {
  const { root, work, branch } = mergeFixture();
  commitFile(root, "b.md", "someone else's edit\n", "concurrent commit");
  const baseBefore = git(root, "rev-parse", "main").trim();
  commitFile(work, "a.md", "line one, polished\n", "polish");
  const out = mergeWithRetry(git, { root, work, branch, base: "main", regate: () => ({ ok: false, detail: "npm test failed" }) });
  assert.equal(out.kind, "ff-miss");
  assert.match(out.kind === "ff-miss" ? out.detail : "", /gate failed after rebase/);
  assert.equal(git(root, "rev-parse", "main").trim(), baseBefore);
});

// ---------------------------------------------------------------------------------------------
// The pass, over a real repo with fake deps.
// ---------------------------------------------------------------------------------------------

function makeRepo(branch = "main"): string {
  const repo = fresh("repo");
  execFileSync("git", ["init", "-q", "-b", branch, repo]);
  git(repo, "config", "user.name", "t");
  git(repo, "config", "user.email", "t@example.com");
  writeFileSync(join(repo, "README.md"), "hello\n");
  writeFileSync(join(repo, "run.ts"), "export {};\n");
  // The real .gitignore, never an invented one: only the real file proves the symlinked
  // node_modules does not read as a changed path.
  copyFileSync(new URL("../../../.gitignore", import.meta.url), join(repo, ".gitignore"));
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  return repo;
}

/** A one-row stand-in for the rotation table. The real SQL is tested from test/. */
function fakeDb(): PolishDb & { row: { goal_index: number; recent: string } | undefined } {
  const db = {
    row: undefined as { goal_index: number; recent: string } | undefined,
    migrate: () => {},
    handle: () => ({
      prepare: (sql: string) => ({
        get: () => (sql.startsWith("SELECT") ? db.row : undefined),
        run: (...p: (string | number)[]) => {
          db.row = { goal_index: p[0] as number, recent: p[1] as string };
        },
      }),
    }),
  };
  return db;
}

interface Harness {
  readonly deps: PolishDeps;
  readonly db: ReturnType<typeof fakeDb>;
  readonly events: string[];
  readonly runs: Job[];
  readonly runInCalls: string[][];
}

function harness(
  repo: string,
  opts: {
    readonly env?: Record<string, string>;
    readonly agent?: (cwd: string) => string;
    readonly runIn?: RunIn;
    readonly db?: ReturnType<typeof fakeDb>;
  } = {},
): Harness {
  const events: string[] = [];
  const runs: Job[] = [];
  const runInCalls: string[][] = [];
  const env = opts.env ?? {};
  const db = opts.db ?? fakeDb();
  const at = (level: string) => (event: string, fields: Record<string, unknown> = {}) => {
    events.push(`${level}:${event}${"reason" in fields ? `:${String(fields.reason)}` : ""}`);
  };
  const agent = opts.agent ?? ((cwd: string) => {
    writeFileSync(join(cwd, "README.md"), "hello, polished\n");
    return block("README.md", "tidied the README lede", "-");
  });
  const deps: PolishDeps = {
    instance: "test",
    root: repo,
    now: () => new Date("2026-09-24T16:39:00Z"),
    log: { info: at("info"), warn: at("warn"), error: at("error"), raw: () => {} },
    env: {
      str: (s) => env[s.key] ?? s.default ?? "",
      num: (s) => Number(env[s.key] ?? s.default),
      optional: (s) => env[s.key],
    },
    db: () => db,
    git,
    runIn: (dir, cmd, args, e) => {
      runInCalls.push([cmd, ...args]);
      return (opts.runIn ?? (() => ({ ok: true, out: "" })))(dir, cmd, args, e);
    },
    runner: async () => {
      throw new Error("the pass must go through runJob");
    },
    shed: { skip: false, downshift: false },
    runLogPath: (name) => join(fresh("log"), `${name}.log`),
    runJob: async (job, d): Promise<RunResult> => {
      runs.push(job);
      return { stdout: agent(d.cwd), completionSignal: null, iterations: 1, commits: [], branch: "", logPath: null };
    },
    shedModel: (m) => m,
    worktree: {
      root: join(repo, ".doppelganger", "worktrees"),
      prep: (r, spec, path) => {
        git(r, "worktree", "add", "-q", "-B", spec.branch, path, spec.base);
        return { path, branch: spec.branch, base: spec.base, head: git(path, "rev-parse", "HEAD").trim() };
      },
      teardown: (r, path) => void git(r, "worktree", "remove", "--force", path),
      reap: () => [],
      promptLines: (wt) => [`worktree: ${wt.path}`],
    },
  };
  return { deps, db, events, runs, runInCalls };
}

const head = (repo: string): string => git(repo, "rev-parse", "main").trim();
const worktrees = (repo: string): number =>
  git(repo, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length;

async function withEnv(vars: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  Object.assign(process.env, vars);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("pass: the kill switch stops it before anything is read (KRN-07)", async () => {
  const repo = makeRepo();
  const h = harness(repo);
  await withEnv({ NIGHTLY_NO_POLISH: "1" }, () => execPolish(h.deps));
  assert.deepEqual(h.events, ["info:killed"]);
  assert.equal(h.runs.length, 0);
});

test("pass: not on the base branch, or a dirty checkout, skips before any worktree exists", async () => {
  const off = makeRepo("dev");
  const h1 = harness(off);
  await execPolish(h1.deps);
  assert.deepEqual(h1.events, ["warn:skip:not-on-base"]);

  const dirty = makeRepo();
  writeFileSync(join(dirty, "README.md"), "half-done human edit\n");
  const h2 = harness(dirty);
  await execPolish(h2.deps);
  assert.deepEqual(h2.events, ["warn:skip:tree-dirty"]);
  assert.equal(worktrees(dirty), 1);
});

test("pass: MAX=0 is the free smoke — no agent, the worktree comes and goes, the goal moves on (SAF-04)", async () => {
  const repo = makeRepo();
  const h = harness(repo, { env: { NIGHTLY_POLISH_MAX: "0" } });
  await execPolish(h.deps);
  assert.equal(h.runs.length, 0);
  assert.ok(h.events.includes("info:free-smoke"));
  assert.equal(worktrees(repo), 1);
  assert.equal(h.db.row?.goal_index, 1);
});

test("pass: the happy path lands one docs commit on main by fast-forward, and remembers the file", async () => {
  const repo = makeRepo();
  const before = head(repo);
  const h = harness(repo);
  await execPolish(h.deps);

  assert.ok(h.events.includes("info:landed"), h.events.join(" "));
  assert.notEqual(head(repo), before);
  assert.equal(git(repo, "rev-parse", "main~1").trim(), before, "exactly one commit, on top of the old base");
  assert.equal(git(repo, "log", "-1", "--format=%s").trim(), "docs(nightly): tidied the README lede");
  assert.equal(git(repo, "log", "-1", "--format=%an <%ae>").trim(), "nightly-polish <nightly-polish@test>");
  assert.match(git(repo, "show", "main:README.md"), /polished/);
  assert.deepEqual(h.runInCalls, [["npm", "test"]], "the gate ran; no gh call without a tracker");
  assert.ok(h.events.includes("info:issue-skipped"));
  assert.deepEqual(h.db.row, { goal_index: 1, recent: JSON.stringify(["README.md"]) });
  assert.equal(worktrees(repo), 1, "the worktree is torn down");

  // The next pass is told to pick a different file.
  const next = harness(repo, { db: h.db, agent: () => block("-", "nothing safe to change", "-") });
  await execPolish(next.deps);
  assert.match(next.runs[0]!.promptArgs!.RECENT!, /RECENTLY TOUCHED — pick a different file.*README\.md/);
  assert.equal(next.runs[0]!.promptArgs!.GOAL, "plain-english");
  assert.ok(next.events.includes("info:no-op"));
});

test("pass: an edit outside Markdown is refused by tier 1 — no suite run, base unmoved", async () => {
  const repo = makeRepo();
  const before = head(repo);
  const h = harness(repo, {
    agent: (cwd) => {
      writeFileSync(join(cwd, "run.ts"), "export const x = 1;\n");
      return block("run.ts", "changed code", "-");
    },
  });
  await execPolish(h.deps);
  assert.ok(h.events.includes("error:gate-failed"));
  assert.equal(h.runInCalls.length, 0);
  assert.equal(head(repo), before);
});

test("pass: a red npm test discards the change", async () => {
  const repo = makeRepo();
  const before = head(repo);
  const h = harness(repo, { runIn: () => ({ ok: false, out: "not ok 1 - README claims\n" }) });
  await execPolish(h.deps);
  assert.ok(h.events.includes("error:gate-failed"));
  assert.equal(head(repo), before);
  assert.deepEqual(h.db.row, { goal_index: 1, recent: "[]" }, "the goal moves on; nothing joins the recent list");
});

test("pass: an agent that commits by itself is refused — the gate never saw that commit", async () => {
  const repo = makeRepo();
  const before = head(repo);
  const h = harness(repo, {
    agent: (cwd) => {
      writeFileSync(join(cwd, "README.md"), "sneaky\n");
      git(cwd, "commit", "-q", "-am", "agent commit");
      return block("README.md", "x", "-");
    },
  });
  await execPolish(h.deps);
  assert.ok(h.events.includes("error:agent-committed"));
  assert.equal(head(repo), before);
});

test("pass: DRY_RUN runs the agent and the gate, then writes nothing — no commit, no state, no issue (SAF-01)", async () => {
  const repo = makeRepo();
  const before = head(repo);
  const h = harness(repo, { env: { NIGHTLY_POLISH_DRY_RUN: "1", NIGHTLY_POLISH_TRACKER: "o/r" } });
  await execPolish(h.deps);
  assert.equal(h.runs.length, 1);
  assert.ok(h.events.includes("info:dry-run-ok"));
  assert.equal(head(repo), before);
  assert.equal(h.db.row, undefined);
  assert.deepEqual(h.runInCalls, [["npm", "test"]]);
});

test("pass: NO_MERGE commits inside the worktree and never moves the base (SAF-02)", async () => {
  const repo = makeRepo();
  const before = head(repo);
  const h = harness(repo, { env: { NIGHTLY_POLISH_NO_MERGE: "1" } });
  await execPolish(h.deps);
  assert.ok(h.events.includes("info:committed-no-merge"));
  assert.equal(head(repo), before);
  assert.match(git(repo, "log", "-1", "--format=%s", "nightly-polish/test").trim(), /^docs\(nightly\): /);
});

test("pass: ONLY forces one goal (SAF-06); an unknown key throws before any worktree exists", async () => {
  const repo = makeRepo();
  const h = harness(repo, { env: { NIGHTLY_POLISH_ONLY: "structure" } });
  await execPolish(h.deps);
  assert.equal(h.runs[0]!.promptArgs!.GOAL, "structure");

  const bad = harness(makeRepo(), { env: { NIGHTLY_POLISH_ONLY: "nope" } });
  await assert.rejects(() => execPolish(bad.deps), /unknown goal key/);
});

test("pass: a tracker creates one issue and closes it in the same pass, through gh", async () => {
  const repo = makeRepo();
  const h = harness(repo, {
    env: { NIGHTLY_POLISH_TRACKER: "owner/repo" },
    runIn: (_d, cmd, args) =>
      cmd === "gh" && args[1] === "create" ? { ok: true, out: "https://github.com/owner/repo/issues/42\n" } : { ok: true, out: "" },
  });
  await execPolish(h.deps);
  const gh = h.runInCalls.filter((c) => c[0] === "gh");
  assert.equal(gh.length, 2);
  assert.deepEqual(gh[0]!.slice(0, 5), ["gh", "issue", "create", "--repo", "owner/repo"]);
  assert.deepEqual(gh[1], ["gh", "issue", "close", "42", "--repo", "owner/repo", "--reason", "completed"]);
  assert.ok(h.events.includes("info:issue-closed"));
});

test("pass: the model override reaches the run, and the skill job carries no exec (D10)", async () => {
  const repo = makeRepo();
  const h = harness(repo, { env: { NIGHTLY_POLISH_MODEL: "claude-sonnet-5" } });
  await execPolish(h.deps);
  assert.equal(h.runs[0]!.model, "claude-sonnet-5");
  assert.equal(h.runs[0]!.skill, "nightly-polish");
  assert.equal(h.runs[0]!.exec, undefined);
});
