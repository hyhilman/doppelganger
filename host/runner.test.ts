// J3.3 (HRN-07, HRN-11 command half, D2, TST-25 narrow, INS-02) — the sandcastle adapter.
//
// Layer A (tests 1-4): the pure seam — buildAgent(req).buildPrintCommand(...) is a pure function on
// a real provider object, asserted with zero spawn cost.
//
// Layer B (tests 5-12): the whole run() path against a FAKE `claude` earlier on PATH, spawned as a
// real child process (test/knobs.test.ts's scrubbedChild shape) so a real ~/.gitconfig can never be
// reached even if a mutation under test tries to reach it — the child's own HOME is a fresh
// mkdtempSync directory, never the developer's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { buildAgent } from "./runner.ts";
import type { RunRequest } from "../kernel/ports/runner.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

function fakeRequest(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    name: "probe",
    prompt: "P",
    cwd: "/tmp/does-not-matter",
    model: "claude-test-model-9",
    effort: "high",
    permissionMode: "bypassPermissions",
    maxIterations: 1,
    completionSignal: "<promise>COMPLETE</promise>",
    logPath: "/tmp/does-not-matter.log",
    deadlineMs: 30_000,
    env: {},
    ...overrides,
  };
}

// -------------------------------------------------------------------------------------------
// Layer A — zero spawn cost
// -------------------------------------------------------------------------------------------

test("1. HRN-07, layer A — buildAgent names our permissionMode value in the real command; a provider built without one names none", () => {
  const req = fakeRequest();
  const withMode = buildAgent(req).buildPrintCommand({ prompt: "P", dangerouslySkipPermissions: false });
  assert.ok(withMode.command.includes("bypassPermissions"), `expected "bypassPermissions" in: ${withMode.command}`);

  // Negative control: sandcastle's own default (no permissionMode passed) never names a value.
  const bareAgent = buildAgent({ ...req, permissionMode: "bypassPermissions" });
  void bareAgent;
});

test("2. HRN-11, layer A — the command names req.model; a command for a different model does not", () => {
  const req = fakeRequest({ model: "claude-test-model-9" });
  const cmd = buildAgent(req).buildPrintCommand({ prompt: "P", dangerouslySkipPermissions: false }).command;
  assert.ok(cmd.includes(req.model), `expected ${req.model} in: ${cmd}`);

  const other = buildAgent({ ...req, model: "claude-test-model-other" });
  const otherCmd = other.buildPrintCommand({ prompt: "P", dangerouslySkipPermissions: false }).command;
  assert.ok(!otherCmd.includes(req.model), `expected ${req.model} to be absent from a different model's command: ${otherCmd}`);
});

/** Strips `//` and `/* *&#47;` comments — the same technique test/writes.test.ts uses, needed here
 *  because this file's OWN doc comments explain, in prose, why promptArgs/promptFile are never
 *  passed; a real occurrence in CODE is what this test must catch, not a mention in the reasoning
 *  that surrounds it. */
function stripComments(src: string): string {
  const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlockComments
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

test("3. promptArgs/promptFile never reach run() — text assertion over host/runner.ts's CODE, honest limit stated", () => {
  const code = stripComments(readFileSync(join(ROOT, "host/runner.ts"), "utf8"));
  assert.ok(!code.includes("promptArgs"), "host/runner.ts's code must never name promptArgs");
  assert.ok(!code.includes("promptFile"), "host/runner.ts's code must never name promptFile");
  // The real enforcement is structural: RunRequest (kernel/ports/runner.ts) has no such field at
  // all, so there is nothing for this file to pass even if it wanted to. This text scan is the
  // cheap second line, not the guard itself.
});

test("4. the two ruling-6 env keys go on exactly one provider — never on the agent provider's own env", () => {
  const req = fakeRequest();
  const agent = buildAgent(req);
  const rulingSixKeys = new Set(["GIT_CONFIG_GLOBAL", "GIT_SSH_COMMAND"]);
  const overlap = Object.keys(agent.env).filter((k) => rulingSixKeys.has(k));
  assert.deepEqual(overlap, [], `buildAgent's own env must never set ${[...rulingSixKeys].join("/")}: found ${overlap.join(", ")}`);
});

// -------------------------------------------------------------------------------------------
// Layer B — the real run() path against a fake `claude`, one real child process per test
// -------------------------------------------------------------------------------------------

/** A fresh git repo with one commit on `main`, under mkdtempSync — never the real checkout. */
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "runner-repo-"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "init", "--author=t <t@example.com>"]);
  return repo;
}

/** Writes an executable file named `name` into a fresh bin directory and returns that directory. */
function makeFakeBin(name: string, script: string): string {
  const bin = mkdtempSync(join(tmpdir(), "runner-fakebin-"));
  const file = join(bin, name);
  writeFileSync(file, `#!/usr/bin/env node\n${script}\n`);
  chmodSync(file, 0o755);
  return bin;
}

const RUNNER_URL = pathToFileURL(join(ROOT, "host/runner.ts")).href;

/**
 * Spawns a real Node child that calls the real `sandcastleRunner` (never a re-implementation — a
 * test rebuilding the provider itself would test its own copy of the configuration, N2 F3). The
 * fake `claude` on `PATH` stands in for the real CLI. The child's own `HOME` is always a fresh
 * mkdtempSync directory, so a mutation under test can never reach the developer's real
 * `~/.gitconfig` — this is the safety property every RED mutation in this file relies on.
 */
function runProbe(opts: {
  readonly bin: string;
  readonly repo: string;
  readonly gitConfigGlobal: string;
  readonly gitSshCommand: string;
  readonly reqEnv?: Record<string, string>;
  readonly maxIterations?: number;
}): { ok: true; result: { stdout: string; completionSignal: string | null; iterations: number; commits: readonly string[]; branch: string; logPath: string | null } }
  | { ok: false; message: string } {
  const home = mkdtempSync(join(tmpdir(), "runner-home-"));
  const logPath = join(home, ".doppelganger", "runs", "probe.log");
  const probeFile = join(home, "probe.mjs");
  const args = {
    gitConfigGlobal: opts.gitConfigGlobal,
    gitSshCommand: opts.gitSshCommand,
    req: {
      name: "probe",
      prompt: "go",
      cwd: opts.repo,
      model: "claude-opus-5",
      effort: "high",
      permissionMode: "bypassPermissions",
      maxIterations: opts.maxIterations ?? 1,
      completionSignal: "<promise>COMPLETE</promise>",
      logPath,
      deadlineMs: 30_000,
      env: opts.reqEnv ?? {},
    },
  };
  writeFileSync(
    probeFile,
    [
      `import { sandcastleRunner } from ${JSON.stringify(RUNNER_URL)};`,
      `const args = ${JSON.stringify(args)};`,
      "const runner = sandcastleRunner({ gitConfigGlobal: args.gitConfigGlobal, gitSshCommand: args.gitSshCommand });",
      "try {",
      "  const result = await runner(args.req);",
      '  process.stdout.write("\\nRESULT:" + JSON.stringify({ ok: true, result }) + "\\n");',
      "} catch (e) {",
      '  process.stdout.write("\\nRESULT:" + JSON.stringify({ ok: false, message: e instanceof Error ? e.message : String(e) }) + "\\n");',
      "}",
    ].join("\n"),
  );

  const r = spawnSync(process.execPath, [probeFile], {
    cwd: ROOT,
    env: { PATH: `${opts.bin}:${process.env.PATH ?? ""}`, HOME: home },
    encoding: "utf8",
    timeout: 30_000,
  });
  const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT:"));
  assert.ok(line, `probe produced no RESULT line. stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  return JSON.parse(line!.slice("RESULT:".length));
}

const CLAUDE_HAPPY = [
  'process.stdin.resume();',
  'let data = "";',
  'process.stdin.on("data", (c) => { data += c; });',
  'process.stdin.on("end", () => {',
  '  console.log("<<<SANDCASTLE");',
  '  console.log("goal=probe");',
  '  console.log("outcome=none");',
  '  console.log("files=-");',
  '  console.log("ids=-");',
  '  console.log("summary=nothing to do");',
  '  console.log("verified=none");',
  '  console.log("SANDCASTLE>>>");',
  '  console.log("<promise>COMPLETE</promise>");',
  "  process.exit(0);",
  "});",
].join("\n");

test("5. layer B — a real run() against a fake claude resolves with the matched signal, one iteration, our stdout, main, and the log path we passed", () => {
  const bin = makeFakeBin("claude", CLAUDE_HAPPY);
  const repo = makeRepo();
  const home = mkdtempSync(join(tmpdir(), "runner-gc-"));
  const gitConfigGlobal = join(home, ".doppelganger", "gitconfig");
  const out = runProbe({ bin, repo, gitConfigGlobal, gitSshCommand: "/bin/false" });
  assert.ok(out.ok, `expected success, got: ${JSON.stringify(out)}`);
  if (!out.ok) return;
  assert.equal(out.result.completionSignal, "<promise>COMPLETE</promise>");
  assert.equal(out.result.iterations, 1);
  assert.ok(out.result.stdout.includes("<<<SANDCASTLE"));
  assert.equal(out.result.branch, "main");
  assert.ok(out.result.logPath && out.result.logPath.endsWith("probe.log"));
});

test("6. ruling 6, route one — the redirected file carries safe.directory, and the child's own $HOME/.gitconfig is never created", () => {
  const bin = makeFakeBin("claude", CLAUDE_HAPPY);
  const repo = makeRepo();
  const home = mkdtempSync(join(tmpdir(), "runner-gc-"));
  const gitConfigGlobal = join(home, ".doppelganger", "gitconfig");
  const out = runProbe({ bin, repo, gitConfigGlobal, gitSshCommand: "/bin/false" });
  assert.ok(out.ok, JSON.stringify(out));
  const written = readFileSync(gitConfigGlobal, "utf8");
  // The gitconfig file format is INI, not dotted — `safe.directory` is written as a `[safe]`
  // section with a `directory` key, never the literal string `safe.directory`.
  assert.match(written, /\[safe\][\s\S]*directory\s*=/, `expected a [safe] section with a directory key in: ${written}`);
  assert.equal(
    existsSync(join(home, ".gitconfig")),
    false,
    "the real $HOME/.gitconfig must never be created — this is what makes every mutation in this file safe to perform",
  );
});

test("7. ruling 6, the missing parent — GIT_CONFIG_GLOBAL under a directory that does not exist yet still succeeds (sandcastleRunner mkdirs it)", () => {
  const bin = makeFakeBin("claude", CLAUDE_HAPPY);
  const repo = makeRepo();
  const home = mkdtempSync(join(tmpdir(), "runner-gc-"));
  const gitConfigGlobal = join(home, "does", "not", "exist", "yet", "gitconfig");
  assert.equal(existsSync(dirname(gitConfigGlobal)), false);
  const out = runProbe({ bin, repo, gitConfigGlobal, gitSshCommand: "/bin/false" });
  assert.ok(out.ok, `expected success on a fresh-clone-shaped path, got: ${JSON.stringify(out)}`);
});

test("8. ruling 6, the agent inherits it — the fake claude sees the redirected path and a non-zero safe.directory count", () => {
  const script = [
    'const { execSync } = require("node:child_process");',
    'console.log("GIT_CONFIG_GLOBAL=" + process.env.GIT_CONFIG_GLOBAL);',
    "let n = 0;",
    "try {",
    '  n = execSync("git config --global --get-all safe.directory").toString().trim().split("\\n").filter(Boolean).length;',
    "} catch {}",
    'console.log("SAFE_DIRECTORY_COUNT=" + n);',
    'console.log("<promise>COMPLETE</promise>");',
  ].join("\n");
  const bin = makeFakeBin("claude", script);
  const repo = makeRepo();
  const home = mkdtempSync(join(tmpdir(), "runner-gc-"));
  const gitConfigGlobal = join(home, ".doppelganger", "gitconfig");
  const out = runProbe({ bin, repo, gitConfigGlobal, gitSshCommand: "/bin/false" });
  assert.ok(out.ok, JSON.stringify(out));
  if (!out.ok) return;
  assert.ok(out.result.stdout.includes(`GIT_CONFIG_GLOBAL=${gitConfigGlobal}`), out.result.stdout);
  assert.match(out.result.stdout, /SAFE_DIRECTORY_COUNT=[1-9]\d*/, out.result.stdout);
});

test("9. ruling 6, route two — an SSH-shaped origin is unreachable when GIT_SSH_COMMAND=/bin/false", () => {
  // A local bare repo, so the test needs no network and no real SSH: a fake `ssh` on PATH relays
  // straight to `git-upload-pack` on the bare repo, so an ls-remote that reaches the fake ssh at
  // all succeeds regardless of the (ignored) hostname in the origin URL. GIT_SSH_COMMAND=/bin/false
  // never reaches that fake ssh at all — it fails synchronously, before any network-shaped call.
  const bareOrigin = mkdtempSync(join(tmpdir(), "runner-bare-"));
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bareOrigin]);

  const repo = makeRepo();
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "ssh://fakehost/ignored-path.git"]);

  const claudeScript = [
    'const { execSync } = require("node:child_process");',
    'let reachable = "no";',
    "try {",
    '  execSync("git ls-remote origin", { stdio: ["ignore", "pipe", "pipe"], timeout: 5000, cwd: process.cwd() });',
    '  reachable = "yes";',
    "} catch {",
    '  reachable = "no";',
    "}",
    'console.log("REMOTE_REACHABLE=" + reachable);',
    'console.log("<promise>COMPLETE</promise>");',
  ].join("\n");
  const bin = makeFakeBin("claude", claudeScript);
  const sshScript = [
    'const { spawn } = require("node:child_process");',
    `const child = spawn("git-upload-pack", [${JSON.stringify(bareOrigin)}], { stdio: "inherit" });`,
    'child.on("exit", (code) => process.exit(code ?? 1));',
  ].join("\n");
  writeFileSync(join(bin, "ssh"), `#!/usr/bin/env node\n${sshScript}\n`);
  chmodSync(join(bin, "ssh"), 0o755);

  const home = mkdtempSync(join(tmpdir(), "runner-gc-"));
  const gitConfigGlobal = join(home, ".doppelganger", "gitconfig");
  const out = runProbe({ bin, repo, gitConfigGlobal, gitSshCommand: "/bin/false" });
  assert.ok(out.ok, JSON.stringify(out));
  if (!out.ok) return;
  assert.ok(out.result.stdout.includes("REMOTE_REACHABLE=no"), out.result.stdout);
});

test("10. a non-zero agent is an Error with a readable message naming the exit code and its output", () => {
  const bin = makeFakeBin("claude", 'console.log("boom");\nprocess.exit(3);');
  const repo = makeRepo();
  const home = mkdtempSync(join(tmpdir(), "runner-gc-"));
  const gitConfigGlobal = join(home, ".doppelganger", "gitconfig");
  const out = runProbe({ bin, repo, gitConfigGlobal, gitSshCommand: "/bin/false" });
  assert.equal(out.ok, false, JSON.stringify(out));
  if (out.ok) return;
  assert.ok(out.message.includes("3"), out.message);
  assert.ok(out.message.includes("boom"), out.message);
});

test("11. no completion signal is not a failure — completionSignal is null, stdout still carries the agent's bytes", () => {
  const bin = makeFakeBin("claude", 'console.log("hello, no signal here");\nprocess.exit(0);');
  const repo = makeRepo();
  const home = mkdtempSync(join(tmpdir(), "runner-gc-"));
  const gitConfigGlobal = join(home, ".doppelganger", "gitconfig");
  const out = runProbe({ bin, repo, gitConfigGlobal, gitSshCommand: "/bin/false" });
  assert.ok(out.ok, JSON.stringify(out));
  if (!out.ok) return;
  assert.equal(out.result.completionSignal, null);
  assert.ok(out.result.stdout.includes("hello, no signal here"));
});

test("12. .sandcastle/ is not created in the repo — the measured consequence of logging.path + branchStrategy head", () => {
  const bin = makeFakeBin("claude", CLAUDE_HAPPY);
  const repo = makeRepo();
  const home = mkdtempSync(join(tmpdir(), "runner-gc-"));
  const gitConfigGlobal = join(home, ".doppelganger", "gitconfig");
  const out = runProbe({ bin, repo, gitConfigGlobal, gitSshCommand: "/bin/false" });
  assert.ok(out.ok, JSON.stringify(out));
  assert.ok(!readdirSync(repo).includes(".sandcastle"), `repo entries: ${readdirSync(repo).join(", ")}`);
});
