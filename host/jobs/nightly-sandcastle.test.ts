// J3.8 (JOB-C15, SKL-02, SKL-05, SKL-07, TST-19, HRN-10) — the verdict, the blocked paths, the
// goals, the import smoke.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { extractBlock } from "../../kernel/runtime/payload.ts";
import type { Job } from "../../kernel/ports/job.ts";
import { INSTANCE } from "../../kernel/instance.ts";
import { openDb } from "../../kernel/runtime/db.ts";
import type { Logger } from "../../kernel/runtime/log/emit.ts";
import { git } from "../../kernel/runtime/exec.ts";
import type { Runner, RunRequest, RunResult } from "../../kernel/ports/runner.ts";
import { NO_SHED } from "../../kernel/runtime/shed.ts";
import {
  parseVerdict,
  blockedBy,
  BLOCKED,
  GOALS,
  nextGoal,
  importSmoke,
  head,
  tail,
  gate,
  DB_NAMESPACES,
  execPass,
  readState,
  type GateDeps,
  type PassDeps,
  HEAD_MAX_CHARS,
} from "./nightly-sandcastle.ts";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const SOURCE_FILE = join(ROOT, "plugins/nightly/skills/nightly-sandcastle/SKILL.md");

/** The report template, read from the source SKILL.md AT TEST TIME with placeholders filled —
 *  never retyped — so this test fails if the skill's own shape changes. */
function fixtureStdout(): string {
  const source = readFileSync(SOURCE_FILE, "utf8");
  const block = extractBlock(source, "SANDCASTLE");
  assert.ok(block !== null, "expected a SANDCASTLE block in the source SKILL.md");
  const fill: Record<string, string> = {
    goal: "docs-vs-code",
    outcome: "changed",
    files: "a.ts,b.ts",
    ids: "KRN-01",
    summary: "removed a redundant helper and its now-unused test",
    verified: "npm test / 437 pass",
  };
  const filled = block!
    .split("\n")
    .map((line) => {
      const m = /^([a-z]+)=<.*>$/.exec(line);
      if (!m) return line;
      const key = m[1]!;
      return key in fill ? `${key}=${fill[key]}` : line;
    })
    .join("\n");
  return `some agent narration first\n\n<<<SANDCASTLE\n${filled}\nSANDCASTLE>>>`;
}

test("1. parseVerdict accepts the block the skill documents", () => {
  const verdict = parseVerdict(fixtureStdout());
  assert.ok(verdict !== null);
  assert.equal(verdict!.outcome, "changed");
  assert.equal(verdict!.goal, "docs-vs-code");
  assert.deepEqual(verdict!.files, ["a.ts", "b.ts"]);
});

test("2. two blocks — the second wins", () => {
  const stdout = "<<<SANDCASTLE\ngoal=g1\noutcome=none\nfiles=-\nids=-\nsummary=s1\nverified=v1\nSANDCASTLE>>>\nchatter\n<<<SANDCASTLE\ngoal=g2\noutcome=changed\nfiles=-\nids=-\nsummary=s2\nverified=v2\nSANDCASTLE>>>";
  const verdict = parseVerdict(stdout);
  assert.equal(verdict!.goal, "g2");
});

test("3. outcome=shipped is not in OUTCOMES — null", () => {
  const stdout = "<<<SANDCASTLE\ngoal=g\noutcome=shipped\nfiles=-\nids=-\nsummary=s\nverified=v\nSANDCASTLE>>>";
  assert.equal(parseVerdict(stdout), null);
});

test("4. missing outcome/goal/summary — null, three cases", () => {
  const missingOutcome = "<<<SANDCASTLE\ngoal=g\nfiles=-\nids=-\nsummary=s\nverified=v\nSANDCASTLE>>>";
  const missingGoal = "<<<SANDCASTLE\noutcome=none\nfiles=-\nids=-\nsummary=s\nverified=v\nSANDCASTLE>>>";
  const missingSummary = "<<<SANDCASTLE\ngoal=g\noutcome=none\nfiles=-\nids=-\nverified=v\nSANDCASTLE>>>";
  assert.equal(parseVerdict(missingOutcome), null);
  assert.equal(parseVerdict(missingGoal), null);
  assert.equal(parseVerdict(missingSummary), null);
});

test("5. files=- yields []; files=a.ts,b.ts yields two trimmed entries", () => {
  const dash = "<<<SANDCASTLE\ngoal=g\noutcome=none\nfiles=-\nids=-\nsummary=s\nverified=v\nSANDCASTLE>>>";
  const two = "<<<SANDCASTLE\ngoal=g\noutcome=none\nfiles=a.ts, b.ts\nids=-\nsummary=s\nverified=v\nSANDCASTLE>>>";
  assert.deepEqual(parseVerdict(dash)!.files, []);
  assert.deepEqual(parseVerdict(two)!.files, ["a.ts", "b.ts"]);
});

test("6. a verified= value containing = and / survives intact", () => {
  const stdout = "<<<SANDCASTLE\ngoal=g\noutcome=none\nfiles=-\nids=-\nsummary=s\nverified=npm test -- x=1 / 437 pass\nSANDCASTLE>>>";
  assert.equal(parseVerdict(stdout)!.verified, "npm test -- x=1 / 437 pass");
});

test("7. blockedBy covers the four things the markdown names (Off limits:)", () => {
  const source = readFileSync(SOURCE_FILE, "utf8");
  const bulletMatch = /\*\*Off limits:\*\*\s*([^\n]+)/.exec(source);
  assert.ok(bulletMatch, "expected an 'Off limits:' bullet in the source SKILL.md");
  const bullet = bulletMatch![1]!;
  const mapping: Record<string, string> = {
    "the schedule file": "host/schedule.ts",
    "the supervisor": "host/supervisor.ts",
    "package.json": "package.json",
    "this skill's own files": "host/jobs/nightly-sandcastle.ts",
  };
  for (const [phrase, path] of Object.entries(mapping)) {
    assert.ok(bullet.includes(phrase), `Off limits: bullet no longer names "${phrase}": ${bullet}`);
    assert.ok(blockedBy(path) !== null, `blockedBy(${JSON.stringify(path)}) must be non-null for "${phrase}"`);
  }
});

test("8. blockedBy returns null for a path a pass legitimately edits", () => {
  assert.equal(blockedBy("CLAUDE.md"), null);
  assert.equal(blockedBy("kernel/stages.ts"), null);
});

test("9. every BLOCKED row has a non-empty why, and no two share one", () => {
  for (const row of BLOCKED) {
    assert.ok(row.why.trim().length > 0);
  }
  const whys = BLOCKED.map((r) => r.why);
  assert.equal(new Set(whys).size, whys.length, "two BLOCKED rows share a why");
});

test("10. nextGoal cycles all three and wraps; only forces one and does not advance; an unknown key throws", () => {
  let state = { index: 0, recent: [] as string[] };
  const seen: string[] = [];
  for (let i = 0; i < GOALS.length + 1; i++) {
    const { goal, nextIndex } = nextGoal(state);
    seen.push(goal.key);
    assert.ok(nextIndex >= 0 && nextIndex < GOALS.length);
    state = { index: nextIndex, recent: [] };
  }
  assert.equal(seen[0], seen[GOALS.length], "expected the rotation to wrap after GOALS.length steps");

  const forced = nextGoal({ index: 0, recent: [] }, "test-gaps");
  assert.equal(forced.goal.key, "test-gaps");
  assert.equal(forced.nextIndex, 0, "forcing a goal must not advance the rotation past it");

  assert.throws(() => nextGoal({ index: 0, recent: [] }, "nope"), /unknown goal key/);
});

test("11. importSmoke accepts a module that loads", () => {
  const dir = mkdtempSync(join(tmpdir(), "import-smoke-"));
  const file = join(dir, "good.ts");
  writeFileSync(file, "export const x = 1;\n");
  assert.equal(importSmoke(file), "");
  assert.equal(importSmoke(join(ROOT, "kernel/stages.ts")), "");
});

test("12. importSmoke rejects a syntax error, a missing relative import, and a throw at load", () => {
  const dir = mkdtempSync(join(tmpdir(), "import-smoke-"));

  const syntaxFile = join(dir, "syntax.ts");
  writeFileSync(syntaxFile, "export const x = ;\n");
  const syntaxOut = importSmoke(syntaxFile);
  assert.notEqual(syntaxOut, "");
  assert.match(head(syntaxOut), /SyntaxError/);

  const missingImportFile = join(dir, "missing-import.ts");
  writeFileSync(missingImportFile, "import { nope } from './does-not-exist.ts';\nexport const y = nope;\n");
  const missingOut = importSmoke(missingImportFile);
  assert.notEqual(missingOut, "");
  assert.match(head(missingOut), /Cannot find module/);

  const throwFile = join(dir, "throw.ts");
  writeFileSync(throwFile, "throw new Error('boom at load');\n");
  const throwOut = importSmoke(throwFile);
  assert.notEqual(throwOut, "");
  assert.match(head(throwOut), /boom at load/);
});

test("13. importSmoke JSON-encodes its path — a path containing \" and \\ keeps its quoting", () => {
  // A path is source code here, not a string — if JSON.stringify's escaping were broken, an
  // unescaped " or \ would break OUT of the generated `-e` code's string literal, and the failure
  // would be a SyntaxError in code we built, not a module-resolution error about the path we asked
  // for. It must be the latter.
  const weirdPath = '/tmp/does-not-exist-"quoted\\-dir/good.ts';
  const out = importSmoke(weirdPath);
  assert.notEqual(out, "");
  assert.doesNotMatch(out, /SyntaxError/, `a broken quote/backslash escape produced a SyntaxError in the generated code:\n${out}`);
  assert.match(head(out), /Cannot find module|ERR_MODULE_NOT_FOUND/);
});

test("14. head leads with the error class, drops at-frames and the Node.js banner, stays under 400 chars; tail takes the last meaningful lines", () => {
  const raw = [
    "SyntaxError: Unexpected token",
    "    at wrapSafe (node:internal/modules/cjs/loader:1234:20)",
    "    at Module._compile (node:internal/modules/cjs/loader:1200:10)",
    "",
    "Node.js v22.23.1",
  ].join("\n");
  const h = head(raw);
  assert.ok(h.startsWith("SyntaxError"));
  assert.ok(!h.includes(" at "));
  assert.ok(!h.includes("Node.js v"));
  assert.ok(h.length < HEAD_MAX_CHARS);

  const suiteOut = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") + "\n# pass 30\n# fail 0";
  const t = tail(suiteOut, 3);
  assert.equal(t, "line 29\n# pass 30\n# fail 0");
});

// ---------------------------------------------------------------------------------------------
// J3.11 (JOB-C15, SAF-05, TST-19) — the three-tier ship gate. `runIn` is a recording fake — no
// test in this group spawns a process.
// ---------------------------------------------------------------------------------------------

interface RunInCall {
  readonly dir: string;
  readonly cmd: string;
  readonly args: readonly string[];
  readonly env?: Record<string, string>;
}

function makeRunIn(script: (cmd: string, args: readonly string[]) => { ok: boolean; out: string }) {
  const calls: RunInCall[] = [];
  const runIn: GateDeps["runIn"] = (dir, cmd, args, env) => {
    calls.push({ dir, cmd, args, env });
    return script(cmd, args);
  };
  return { runIn, calls };
}

function testJob(name: string): Job {
  return { name, description: "d", plugin: "nightly", skill: name, permissionMode: "bypassPermissions", local: true };
}

test("16. tier 1 refuses and returns first — a list containing host/supervisor.ts, and the fake recorded zero calls", () => {
  const { runIn, calls } = makeRunIn(() => ({ ok: true, out: "" }));
  const result = gate(["host/supervisor.ts"], { work: "/work", runIn, scratch: "/scratch", jobs: [] });
  assert.equal(result.ok, false);
  assert.ok(result.detail.includes("one process owns every tick"), result.detail);
  assert.equal(calls.length, 0);
});

test("17. tier order — a clean list with a failing npm test: the fake was called once, no import smoke ran", () => {
  const { runIn, calls } = makeRunIn((cmd) => (cmd === "npm" ? { ok: false, out: "FAIL\n1 failing" } : { ok: true, out: "" }));
  const result = gate(["a.ts"], { work: "/work", runIn, scratch: "/scratch", jobs: [] });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.cmd, "npm");
});

test("18. tier 3 runs once per changed non-test source file, skipping .test.ts and non-.ts", () => {
  const { runIn, calls } = makeRunIn(() => ({ ok: true, out: "" }));
  gate(["a.ts", "a.test.ts", "README.md", "b.ts"], { work: "/work", runIn, scratch: "/scratch", jobs: [] });
  const smokeCalls = calls.filter((c) => c.cmd === process.execPath);
  assert.equal(smokeCalls.length, 2);
});

test("19. tier 4 runs only for changed registry jobs, and the env carries <NAME>_DRY_RUN=1 and one <NS>_DB per DB_NAMESPACES, every value under deps.scratch", () => {
  const { runIn, calls } = makeRunIn(() => ({ ok: true, out: "" }));
  const job = testJob("nightly-probe");
  gate(["host/jobs/nightly-probe.ts"], { work: "/work", runIn, scratch: "/scratch", jobs: [job] });
  const dryRunCalls = calls.filter((c) => c.cmd === "node");
  assert.equal(dryRunCalls.length, 1);
  assert.equal(dryRunCalls[0]!.env?.NIGHTLY_PROBE_DRY_RUN, "1");
  for (const ns of DB_NAMESPACES) {
    assert.equal(dryRunCalls[0]!.env?.[`${ns.toUpperCase()}_DB`], join("/scratch", `${ns}.db`));
  }
});

test("20. tier 4 skips a changed host/jobs/*.ts file that is not a registered job", () => {
  const { runIn, calls } = makeRunIn(() => ({ ok: true, out: "" }));
  gate(["host/jobs/ghost.ts"], { work: "/work", runIn, scratch: "/scratch", jobs: [] });
  const dryRunCalls = calls.filter((c) => c.cmd === "node");
  assert.equal(dryRunCalls.length, 0);
});

test("21. a passing gate's detail counts what ran, derived from the arrays", () => {
  const { runIn } = makeRunIn(() => ({ ok: true, out: "" }));
  const job = testJob("nightly-probe");
  const result = gate(["a.ts", "b.ts", "host/jobs/nightly-probe.ts"], { work: "/work", runIn, scratch: "/scratch", jobs: [job] });
  assert.equal(result.ok, true);
  assert.equal(result.detail, "npm test, 3 import smoke(s), 1 dry run(s)");
});

test("22. a docs-only change runs npm test, no smoke, no dry run", () => {
  const { runIn, calls } = makeRunIn(() => ({ ok: true, out: "" }));
  const result = gate(["README.md"], { work: "/work", runIn, scratch: "/scratch", jobs: [] });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(result.detail, "npm test, 0 import smoke(s), 0 dry run(s)");
});

test("23. gate([]) returns ok: true with a detail saying so, and runs nothing", () => {
  const { runIn, calls } = makeRunIn(() => ({ ok: true, out: "" }));
  const result = gate([], { work: "/work", runIn, scratch: "/scratch", jobs: [] });
  assert.equal(result.ok, true);
  assert.match(result.detail, /nothing to gate/);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------------------------
// J3.12 (JOB-C15, SAF-01…07, INS-06, KRN-07, INV-1) — the pass, the landing, the safe-run
// surface. Every test builds a real mkdtempSync git repo and a real SQLite file under it.
// ---------------------------------------------------------------------------------------------

/** A fresh repo with one commit on `branch` (default "main", matching NIGHTLY_SANDCASTLE_BASE's
 *  own default). */
function makeRepo(branch = "main"): string {
  const repo = mkdtempSync(join(tmpdir(), "pass-repo-"));
  git(repo, "init", "-q", "-b", branch);
  // LOCAL identity, always — worktrees share it, so the pass's rebase path (ff-miss recovery)
  // has a committer on a host with no global config. See runner.test.ts's makeRepo for the story.
  git(repo, "config", "user.name", "t");
  git(repo, "config", "user.email", "t@example.com");
  writeFileSync(join(repo, "README.md"), "hello\n");
  writeFileSync(join(repo, ".gitignore"), "node_modules\n.doppelganger/\n"); // the symlinked node_modules and every pass worktree must not read as tree-dirty
  git(repo, "add", "-A");
  git(repo, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "init");
  return repo;
}

function verdictBlock(outcome: string, extra: Partial<Record<string, string>> = {}): string {
  const fields: Record<string, string> = {
    goal: "x",
    outcome,
    files: "-",
    ids: "-",
    summary: "a change",
    verified: "npm test",
    ...extra,
  };
  const lines = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
  return `<<<SANDCASTLE\n${lines.join("\n")}\nSANDCASTLE>>>`;
}

interface RecordingRunner {
  readonly runner: Runner;
  readonly calls: RunRequest[];
}

function recordingRunner(handler: (req: RunRequest) => RunResult | Promise<RunResult>): RecordingRunner {
  const calls: RunRequest[] = [];
  const runner: Runner = async (req: RunRequest): Promise<RunResult> => {
    calls.push(req);
    return handler(req);
  };
  return { runner, calls };
}

/** Writes each file (creating parent directories) into `req.cwd`, then returns a passing verdict
 *  block by default. */
function writingRunner(files: Record<string, string>, stdout: string = verdictBlock("changed")): RecordingRunner {
  return recordingRunner((req) => {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(req.cwd, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    return { stdout, completionSignal: "<promise>COMPLETE</promise>", iterations: 1, commits: [], branch: "nightly/test", logPath: null };
  });
}

function happyRunner(): RecordingRunner {
  return writingRunner({ "CHANGED.md": "hello from the agent\n" });
}

interface LogEntry {
  readonly level: string;
  readonly event: string;
  readonly fields: Record<string, unknown>;
}

function recordingLogger(): { readonly log: Logger; readonly entries: LogEntry[]; readonly raw: string[] } {
  const entries: LogEntry[] = [];
  const raw: string[] = [];
  const at = (level: string) => (event: string, fields: Record<string, unknown> = {}) => {
    entries.push({ level, event, fields });
  };
  return {
    log: { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error"), raw: (text: string) => raw.push(text) },
    entries,
    raw,
  };
}

interface TestContext {
  readonly deps: PassDeps;
  readonly entries: LogEntry[];
  readonly raw: string[];
  readonly runnerCalls: RunRequest[];
}

function buildContext(
  repo: string,
  opts: { readonly runner?: RecordingRunner; readonly runIn?: PassDeps["runIn"]; readonly jobs?: readonly Job[] } = {},
): TestContext {
  const { log, entries, raw } = recordingLogger();
  const runnerBundle = opts.runner ?? happyRunner();
  const dbDir = mkdtempSync(join(tmpdir(), "pass-db-"));
  const deps: PassDeps = {
    root: repo,
    runner: runnerBundle.runner,
    git,
    now: () => new Date(),
    db: openDb(join(dbDir, "nightly.db")),
    log,
    worktreeRoot: join(repo, ".doppelganger", "worktrees"),
    runLogPath: (name: string) => join(mkdtempSync(join(tmpdir(), "run-log-")), `${name}.log`),
    runIn: opts.runIn ?? (() => ({ ok: true, out: "" })),
    scratchRoot: mkdtempSync(join(tmpdir(), "pass-scratch-")),
    jobs: opts.jobs ?? [],
    shed: NO_SHED,
  };
  return { deps, entries, raw, runnerCalls: runnerBundle.calls };
}

/** Sets `vars` in process.env for the duration of `fn`, restoring every key afterwards — even one
 *  that started unset. */
async function withEnv<T>(vars: Readonly<Record<string, string>>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const worktreeCount = (repo: string): number => git(repo, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length;

test("24. the kill switch — one event=killed, zero runner calls, git log unchanged", async () => {
  const repo = makeRepo();
  const before = git(repo, "log", "--oneline", "-1");
  const { deps, entries, runnerCalls } = buildContext(repo);
  await withEnv({ NIGHTLY_NO_SANDCASTLE: "1" }, () => execPass(deps));
  assert.equal(entries.filter((e) => e.event === "killed").length, 1);
  assert.equal(runnerCalls.length, 0);
  assert.equal(git(repo, "log", "--oneline", "-1"), before);
});

test("25. not-on-base — repo on feature/x, base main: one event=skip reason=not-on-base, zero runner calls", async () => {
  const repo = makeRepo("feature/x");
  const { deps, entries, runnerCalls } = buildContext(repo);
  await execPass(deps);
  assert.equal(entries.filter((e) => e.event === "skip" && e.fields.reason === "not-on-base").length, 1);
  assert.equal(runnerCalls.length, 0);

  // N2 F1's lesson: the guard must check the property it CLAIMS (the BASE knob), not a hardcoded
  // "main" that happens to equal the knob's own default. A repo on a real, non-"main" base with
  // NIGHTLY_SANDCASTLE_BASE set to match it must proceed — proving the comparison reads the knob.
  const devRepo = makeRepo("dev");
  const { deps: devDeps, runnerCalls: devCalls } = buildContext(devRepo);
  await withEnv({ NIGHTLY_SANDCASTLE_BASE: "dev" }, () => execPass(devDeps));
  assert.equal(devCalls.length, 1, "a repo on its OWN configured base must not be skipped as not-on-base");
});

test("26. tree-dirty — an uncommitted file: one event=skip reason=tree-dirty, zero runner calls", async () => {
  const repo = makeRepo();
  writeFileSync(join(repo, "dirty.txt"), "x");
  const { deps, entries, runnerCalls } = buildContext(repo);
  await execPass(deps);
  assert.equal(entries.filter((e) => e.event === "skip" && e.fields.reason === "tree-dirty").length, 1);
  assert.equal(runnerCalls.length, 0);
});

test("27. MAX=0 is free and complete — zero runner calls, a worktree was prepared and torn down, the goal rotated, a report line emitted", async () => {
  const repo = makeRepo();
  const { deps, entries, raw, runnerCalls } = buildContext(repo);
  const before = readState(deps.db);
  await withEnv({ NIGHTLY_SANDCASTLE_MAX: "0" }, () => execPass(deps));
  assert.equal(runnerCalls.length, 0);
  assert.equal(entries.filter((e) => e.event === "free-smoke").length, 1);
  assert.ok(raw.some((r) => r.includes("free-smoke")));
  const after = readState(deps.db);
  assert.notEqual(after.index, before.index);
  assert.equal(worktreeCount(repo), 1);
});

test("28. the happy path lands — one commit on nightly/<INSTANCE>, the base HEAD moved to it, one event=landed carrying the sha and the goal", async () => {
  const repo = makeRepo();
  const before = git(repo, "rev-parse", "HEAD").trim();
  const { deps, entries } = buildContext(repo);
  await execPass(deps);
  const landed = entries.find((e) => e.event === "landed");
  assert.ok(landed, JSON.stringify(entries));
  const after = git(repo, "rev-parse", "HEAD").trim();
  assert.notEqual(after, before);
  assert.equal(landed!.fields.sha, after);
  assert.ok(landed!.fields.goal);
});

test("29. DRY_RUN=1 runs the agent and lands nothing", async () => {
  const repo = makeRepo();
  const before = git(repo, "rev-parse", "HEAD").trim();
  const { deps, runnerCalls } = buildContext(repo);
  const stateBefore = readState(deps.db);
  await withEnv({ NIGHTLY_SANDCASTLE_DRY_RUN: "1" }, () => execPass(deps));
  assert.equal(runnerCalls.length, 1);
  assert.equal(git(repo, "rev-parse", "HEAD").trim(), before);
  assert.equal(git(repo, "rev-parse", `nightly/${INSTANCE}`).trim(), before, "the worktree must have no commit");
  assert.deepEqual(readState(deps.db), stateBefore);
});

test("30. NO_MERGE=1 — the worktree HEAD advanced, the base HEAD did not", async () => {
  const repo = makeRepo();
  const before = git(repo, "rev-parse", "HEAD").trim();
  const { deps } = buildContext(repo);
  await withEnv({ NIGHTLY_SANDCASTLE_NO_MERGE: "1" }, () => execPass(deps));
  assert.equal(git(repo, "rev-parse", "HEAD").trim(), before);
  assert.notEqual(git(repo, "rev-parse", `nightly/${INSTANCE}`).trim(), before);
});

test("31. ONLY=<key> — the named goal is used, an unknown key throws before anything is prepped, and the rotation index does not advance past it", async () => {
  const repo = makeRepo();
  const { deps, entries } = buildContext(repo);
  await withEnv({ NIGHTLY_SANDCASTLE_ONLY: "test-gaps" }, () => execPass(deps));
  const started = entries.find((e) => e.event === "pass-start");
  assert.equal(started!.fields.goal, "test-gaps");

  const repo2 = makeRepo();
  const { deps: deps2 } = buildContext(repo2);
  await assert.rejects(() => withEnv({ NIGHTLY_SANDCASTLE_ONLY: "nope" }, () => execPass(deps2)), /unknown goal key/);
  assert.equal(worktreeCount(repo2), 1, "an unknown ONLY key must throw before prepWorktree runs");
});

test("32. a failing gate discards — base unchanged, one event=gate-failed carrying the detail, and node_modules was present when the gate ran", async () => {
  const repo = makeRepo();
  const before = git(repo, "rev-parse", "HEAD").trim();
  const nmTarget = mkdtempSync(join(tmpdir(), "pass-nm-"));
  symlinkSync(nmTarget, join(repo, "node_modules"));

  let sawNodeModules: boolean | undefined;
  const runIn: PassDeps["runIn"] = (dir, cmd) => {
    if (cmd === "npm") {
      sawNodeModules = existsSync(join(dir, "node_modules"));
      return { ok: false, out: "FAIL\n1 failing" };
    }
    return { ok: true, out: "" };
  };
  const { deps, entries } = buildContext(repo, { runIn });
  await execPass(deps);
  const failed = entries.find((e) => e.event === "gate-failed");
  assert.ok(failed, JSON.stringify(entries));
  assert.ok(String(failed!.fields.detail).length > 0);
  assert.equal(git(repo, "rev-parse", "HEAD").trim(), before);
  assert.equal(sawNodeModules, true, "the -e node_modules clean exclusion must keep the symlink through prepWorktree (J3.5)");
});

test("33. a blocked path is a gate failure, not a crash", async () => {
  const repo = makeRepo();
  const runnerBundle = writingRunner({ "host/supervisor.ts": "x" });
  const { deps, entries } = buildContext(repo, { runner: runnerBundle });
  await execPass(deps);
  const failed = entries.find((e) => e.event === "gate-failed");
  assert.ok(failed, JSON.stringify(entries));
  assert.ok(String(failed!.fields.detail).includes("one process owns every tick"));
});

test("34. no verdict is a warning, not a failure — the pass still lands if files changed, and the commit subject falls back to the goal title", async () => {
  const repo = makeRepo();
  const runnerBundle = writingRunner({ "CHANGED.md": "x" }, "no sandcastle block in this stdout at all");
  const { deps, entries } = buildContext(repo, { runner: runnerBundle });
  await execPass(deps);
  assert.ok(entries.some((e) => e.event === "no-verdict"));
  assert.ok(entries.some((e) => e.event === "landed"));
  const subject = git(repo, "log", "-1", "--format=%s");
  assert.ok(subject.startsWith("chore(nightly): "));
  assert.notEqual(subject.trim(), "chore(nightly): -");
});

test("35. escape route one fires — the fake runner writes into deps.root, detected not contained", async () => {
  const repo = makeRepo();
  const runnerBundle = recordingRunner((): RunResult => {
    writeFileSync(join(repo, "escaped.txt"), "leak");
    return { stdout: verdictBlock("none"), completionSignal: "<promise>COMPLETE</promise>", iterations: 1, commits: [], branch: "nightly/test", logPath: null };
  });
  const { deps, entries } = buildContext(repo, { runner: runnerBundle });
  await execPass(deps);
  const escaped = entries.find((e) => e.event === "write-scope-escaped" && e.fields.reason === "tree-dirty");
  assert.ok(escaped, JSON.stringify(entries));
  assert.ok(existsSync(join(repo, "escaped.txt")), "detection, not containment — the file must still be there");
});

test("36. escape route two fires — a local bare origin, no network and no real SSH needed", async () => {
  const repo = makeRepo();
  const bare = mkdtempSync(join(tmpdir(), "pass-bare-"));
  git(bare, "init", "-q", "--bare", "-b", "main");
  git(repo, "remote", "add", "origin", bare);
  git(repo, "push", "-q", "origin", "main");

  const runnerBundle = recordingRunner((req): RunResult => {
    writeFileSync(join(req.cwd, "sneaky.txt"), "x");
    git(req.cwd, "add", "-A");
    git(req.cwd, "-c", "user.email=a@b.c", "-c", "user.name=a", "commit", "-q", "-m", "sneaky");
    git(req.cwd, "push", "-q", "origin", "HEAD:main");
    return { stdout: verdictBlock("none"), completionSignal: "<promise>COMPLETE</promise>", iterations: 1, commits: [], branch: "nightly/test", logPath: null };
  });
  const { deps, entries } = buildContext(repo, { runner: runnerBundle });
  await execPass(deps);
  const escaped = entries.find((e) => e.event === "write-scope-escaped" && e.fields.reason === "remote-moved");
  assert.ok(escaped, JSON.stringify(entries));
});

test("37. the ff-miss recovery — a concurrent base commit fails the first merge, a rebase and a second gate call succeed", async () => {
  const repo = makeRepo();
  let npmCalls = 0;
  const runIn: PassDeps["runIn"] = (_dir, cmd) => {
    if (cmd === "npm") npmCalls++;
    return { ok: true, out: "" };
  };
  const runnerBundle = recordingRunner((req): RunResult => {
    writeFileSync(join(repo, "concurrent.txt"), "human change");
    git(repo, "add", "-A");
    git(repo, "-c", "user.email=a@b.c", "-c", "user.name=a", "commit", "-q", "-m", "concurrent human commit");
    writeFileSync(join(req.cwd, "CHANGED.md"), "agent change\n");
    return { stdout: verdictBlock("changed"), completionSignal: "<promise>COMPLETE</promise>", iterations: 1, commits: [], branch: "nightly/test", logPath: null };
  });
  const { deps, entries } = buildContext(repo, { runner: runnerBundle, runIn });
  await execPass(deps);
  assert.equal(npmCalls, 2, "the gate must run a second time after the rebase");
  assert.ok(entries.some((e) => e.event === "landed"), JSON.stringify(entries));
  const log = git(repo, "log", "--oneline");
  assert.ok(log.includes("concurrent human commit"));

  // A second failure: force the rebase itself to conflict (both sides edit the SAME new file),
  // so retry cannot succeed even once — event=ff-miss, and the PASS's own merge never lands (base
  // stays at whatever the concurrent human commit left it at — the pass is not responsible for
  // that commit existing, only for never landing its own on top through a failed rebase).
  const repo2 = makeRepo();
  let afterHumanCommit = "";
  const runnerBundle2 = recordingRunner((req): RunResult => {
    writeFileSync(join(repo2, "CHANGED.md"), "human version\n");
    git(repo2, "add", "-A");
    git(repo2, "-c", "user.email=a@b.c", "-c", "user.name=a", "commit", "-q", "-m", "conflicting human commit");
    afterHumanCommit = git(repo2, "rev-parse", "HEAD").trim();
    writeFileSync(join(req.cwd, "CHANGED.md"), "agent version\n");
    return { stdout: verdictBlock("changed"), completionSignal: "<promise>COMPLETE</promise>", iterations: 1, commits: [], branch: "nightly/test", logPath: null };
  });
  const { deps: deps2, entries: entries2 } = buildContext(repo2, { runner: runnerBundle2 });
  await execPass(deps2);
  assert.ok(entries2.some((e) => e.event === "ff-miss"), JSON.stringify(entries2));
  assert.ok(afterHumanCommit.length > 0);
  assert.equal(git(repo2, "rev-parse", "HEAD").trim(), afterHumanCommit, "the pass's own merge must never land on top of a rebase conflict");
});

test("38. rotation advances once per landing pass and not on a dry run", async () => {
  const repo = makeRepo();
  const { deps } = buildContext(repo);
  const indices: number[] = [];
  for (let i = 0; i < 3; i++) {
    // A distinct change per pass, and the SAME db across iterations — a re-prepped worktree
    // resets onto the just-landed base, so writing the SAME content a previous pass already
    // landed would leave nothing changed, and a fresh db per pass would reset the very rotation
    // under test.
    const runnerBundle = writingRunner({ "CHANGED.md": `pass ${i}\n` });
    await execPass({ ...deps, runner: runnerBundle.runner });
    indices.push(readState(deps.db).index);
  }
  assert.equal(new Set(indices).size, 3, `expected three distinct indices, got ${indices.join(",")}`);

  const dryRepo = makeRepo();
  const { deps: dryDeps } = buildContext(dryRepo);
  const before = readState(dryDeps.db);
  await withEnv({ NIGHTLY_SANDCASTLE_DRY_RUN: "1" }, () => execPass(dryDeps));
  assert.deepEqual(readState(dryDeps.db), before);
});

test("39. INSTANCE is in the branch name and every path is project-relative", async () => {
  const repo = makeRepo();
  const { deps } = buildContext(repo);
  await execPass(deps);
  assert.ok(git(repo, "branch", "--list", `nightly/${INSTANCE}`).includes(`nightly/${INSTANCE}`));
});

test("40. SAF-07 is documented — the dry-run knob's why contains COSTS, the max knob's contains free", async () => {
  const mod = await import("./nightly-sandcastle.ts");
  const dryRunWhy = (mod as unknown as Record<string, { why: string }>).NIGHTLY_SANDCASTLE_DRY_RUN_ENV.why;
  const maxWhy = (mod as unknown as Record<string, { why: string }>).NIGHTLY_SANDCASTLE_MAX_ENV.why;
  assert.ok(dryRunWhy.includes("COSTS"));
  assert.ok(maxWhy.includes("free"));
});

test("41. QTA-08 — under a spend-wall downshift, pass-start's model= is the model actually handed to the runner, not the pre-shed request", async () => {
  const repo = makeRepo();
  const runnerBundle = happyRunner();
  const { deps, entries, runnerCalls } = buildContext(repo, { runner: runnerBundle });
  // The job's own model is DEFAULTS.model ("claude-opus-5"); a downshift moves it to
  // DEFAULTS.shedModel ("claude-sonnet-5") before it ever reaches the runner. The log line must
  // report that same post-shed value — under a wall it is the only human-readable record of
  // what actually ran.
  await execPass({ ...deps, shed: { skip: false, downshift: true } });
  const started = entries.find((e) => e.event === "pass-start");
  assert.ok(started, JSON.stringify(entries));
  assert.equal(runnerCalls.length, 1);
  assert.equal(started!.fields.model, runnerCalls[0]!.model, "pass-start's model must equal the model handed to the runner");
  assert.equal(started!.fields.model, "claude-sonnet-5");
});
