// J2.16 (SUP-08 impure half, SAF-01, SAF-05) — render/sync/check driven end to end, but NEVER
// against a real crontab. See the module header in cli/crontab.ts for layer 0's full reasoning.
//
// FOUR LAYERS make this safe: (0) readCrontab/install refuse a non-absolute command — closed here
// by tests 0a/0b; (1) CRONTAB_CMD is a knob; (2) readCrontab/install take the command as a required
// argument, never a module global; (3) a FAKE crontab binary that RECORDS every call, one per-test
// WRAPPER script naming its own log/state paths in argv (never `process.env`, since node:test may
// have more than one test in flight in this one process) — see `makeFakeCrontab`.
//
// SCHEDULE is empty at N2 (host/schedule.ts's own decision), so most of these tests build their own
// one-entry `deps.schedule` via `bootstrapFixtureEntry()` — otherwise there is no rendered command
// line for a "foreign line duplicates a rendered command" scenario to be ABOUT. `withProgram` adds
// a matching PROGRAMS row for the duration of one test, the same technique cli/crontab.test.ts
// uses, for the same reason: PROGRAMS is empty at N2 and render()/validate() need a row for every
// entry they see, and neither function takes one through an argument.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  run,
  render,
  splice,
  installedBlock,
  markers,
  readCrontab,
  install,
  type CrontabDeps,
} from "./crontab.ts";
import { PROGRAMS, programOf, commandOf, type ScheduleEntry, type Program } from "../host/schedule.ts";
import { projectPath } from "../kernel/paths.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const FAKE_CRONTAB_SH = `#!/usr/bin/env bash
# argv: <log-path> <state-path> <crontab-args...>
log="$1"; state="$2"; shift 2
echo "$*" >> "$log"
case "$1" in
  -l) [ -s "$state" ] && cat "$state" || exit 1 ;;
  -)  cat > "$state" ;;
  *)  exit 2 ;;
esac
`;

let wrapperSeq = 0;

/** Writes the shared fake once per `dir`, then a fresh per-call WRAPPER whose own argv carries the
 *  log/state paths — never a `process.env` variable a second test in flight could clobber. `opts
 *  .statePath` lets two wrappers (two "instances", or two calls in one test) share one crontab
 *  state file while keeping independent call logs. */
function makeFakeCrontab(
  dir: string,
  opts: { statePath?: string } = {},
): { cmd: string; logPath: string; statePath: string; calls: () => string[] } {
  const fakePath = join(dir, "fake-crontab.sh");
  if (!existsSync(fakePath)) {
    writeFileSync(fakePath, FAKE_CRONTAB_SH);
    chmodSync(fakePath, 0o755);
  }
  wrapperSeq++;
  const logPath = join(dir, `fake-${wrapperSeq}.log`);
  const statePath = opts.statePath ?? join(dir, `fake-${wrapperSeq}.state`);
  const wrapperPath = join(dir, `fake-${wrapperSeq}.sh`);
  writeFileSync(logPath, "");
  writeFileSync(wrapperPath, `#!/usr/bin/env bash\nexec "${fakePath}" "${logPath}" "${statePath}" "$@"\n`);
  chmodSync(wrapperPath, 0o755);
  return {
    cmd: wrapperPath,
    logPath,
    statePath,
    calls: () => readFileSync(logPath, "utf8").split("\n").filter((l) => l.length > 0),
  };
}

// AC10: `ls /tmp | grep -c crontab` must be unchanged by a test run — `mkdtempSync` directories are
// never cleaned up on their own, so every one this file creates is tracked here and removed once,
// on exit, the same `process.on("exit", ...)` precedent host/validate.test.ts already uses.
const tmpDirs: string[] = [];
process.on("exit", () => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "dg-crontab-cli-"));
  tmpDirs.push(d);
  return d;
}

/** The one bootstrap entry every DO-list test needs to have a real rendered command line to test
 *  against — `script: "package.json"` passes validate()'s existence check against the real ROOT,
 *  the same trick cli/crontab.test.ts uses. */
function bootstrapFixtureEntry(over: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    name: "watch-crontab-cli-fixture",
    cron: "*/5 * * * *",
    log: projectPath(".doppelganger/logs/crontab-cli-fixture.log"),
    script: "package.json",
    supervised: false,
    why: "fixture bootstrap entry for cli/crontab-cli.test.ts",
    ...over,
  };
}

/** Adds a PROGRAMS row for `bootstrapFixtureEntry()`'s program for the duration of `fn`, removing
 *  it after — only if THIS call added it, so nested/sequential uses never double-delete. */
function withProgram<T>(fn: () => T): T {
  const mutable = PROGRAMS as Record<string, Program>;
  const name = programOf(bootstrapFixtureEntry());
  const already = name in mutable;
  if (!already) mutable[name] = { self: true, gate: "excl", dotenv: false };
  try {
    return fn();
  } finally {
    if (!already) delete mutable[name];
  }
}

test("0a. layer 0: readCrontab and install both refuse a non-absolute command", () => {
  assert.throws(() => readCrontab("crontab"), /crontab command must be an absolute path/);
  assert.throws(() => install("crontab", "x"), /crontab command must be an absolute path/);
});

test("0b. layer 0: an absolute command is not refused by layer 0 (it fails downstream instead)", () => {
  const abs = "/nonexistent/crontab-DOES-NOT-EXIST";
  assert.throws(() => readCrontab(abs), (e: unknown) => e instanceof Error && !/absolute path/.test(e.message));
  assert.throws(() => install(abs, "x"), (e: unknown) => e instanceof Error && !/absolute path/.test(e.message));
});

test("1. a fresh host", () => {
  withProgram(() => {
    const dir = tmpDir();
    const fake = makeFakeCrontab(dir);
    const entry = bootstrapFixtureEntry();
    const deps: CrontabDeps = { cmd: fake.cmd, instance: "alpha", schedule: [entry], dryRun: false };

    const result = run(["sync"], deps);

    assert.equal(result.code, 0);
    assert.deepEqual(fake.calls(), ["-l", "-"]);
    assert.equal(readFileSync(fake.statePath, "utf8"), `${render([entry], "alpha").join("\n")}\n`);
    assert.match(result.out, /appended/);
  });
});

test("2. idempotence end to end", () => {
  withProgram(() => {
    const dir = tmpDir();
    const entry = bootstrapFixtureEntry();
    const fake1 = makeFakeCrontab(dir);
    const deps1: CrontabDeps = { cmd: fake1.cmd, instance: "alpha", schedule: [entry], dryRun: false };
    const first = run(["sync"], deps1);
    assert.equal(first.code, 0);

    const fake2 = makeFakeCrontab(dir, { statePath: fake1.statePath });
    const deps2: CrontabDeps = { ...deps1, cmd: fake2.cmd };
    const second = run(["sync"], deps2);

    assert.equal(second.code, 0);
    assert.deepEqual(fake2.calls(), ["-l"]); // nothing installed on the second call
    assert.match(second.out, /already in sync/);
  });
});

test("3. foreign lines survive", () => {
  withProgram(() => {
    const dir = tmpDir();
    const entry = bootstrapFixtureEntry();
    const oldBlock = render([bootstrapFixtureEntry({ cron: "0 0 * * *" })], "alpha");
    const seeded = ["# foreign comment", "0 3 * * * foreign-cmd", ...oldBlock, "# another foreign line"].join("\n") + "\n";

    const fake = makeFakeCrontab(dir);
    writeFileSync(fake.statePath, seeded);
    const deps: CrontabDeps = { cmd: fake.cmd, instance: "alpha", schedule: [entry], dryRun: false };

    const result = run(["sync"], deps);
    assert.equal(result.code, 0);

    const installed = readFileSync(fake.statePath, "utf8");
    assert.ok(installed.includes("# foreign comment"));
    assert.ok(installed.includes("0 3 * * * foreign-cmd"));
    assert.ok(installed.includes("# another foreign line"));
    assert.ok(installed.includes(render([entry], "alpha").join("\n")));
  });
});

test("4. collision refusal", () => {
  withProgram(() => {
    const dir = tmpDir();
    const entry = bootstrapFixtureEntry();
    const line = `${entry.cron} ${commandOf(entry)}`;
    const seeded = `${line}\n`;

    const fake = makeFakeCrontab(dir);
    writeFileSync(fake.statePath, seeded);
    const deps: CrontabDeps = { cmd: fake.cmd, instance: "alpha", schedule: [entry], dryRun: false };

    const result = run(["sync"], deps);

    assert.equal(result.code, 1);
    assert.ok(result.err.includes(line), "names the offending line");
    assert.match(result.err, /--adopt/);
    assert.deepEqual(fake.calls(), ["-l"], "nothing was written");
    assert.equal(readFileSync(fake.statePath, "utf8"), seeded);
  });
});

test("5. sync --adopt", () => {
  withProgram(() => {
    const dir = tmpDir();
    const entry = bootstrapFixtureEntry();
    const line = `${entry.cron} ${commandOf(entry)}`;
    const seeded = `# a manual comment\n${line}\n`;

    const fake = makeFakeCrontab(dir);
    writeFileSync(fake.statePath, seeded);
    const deps: CrontabDeps = { cmd: fake.cmd, instance: "alpha", schedule: [entry], dryRun: false };

    const result = run(["sync", "--adopt"], deps);
    assert.equal(result.code, 0);

    const installed = readFileSync(fake.statePath, "utf8");
    assert.ok(!installed.includes("# a manual comment"));
    const occurrences = installed.split(line).length - 1;
    assert.equal(occurrences, 1, "the duplicate is gone; the block's own copy remains, exactly once");

    const fake2 = makeFakeCrontab(dir, { statePath: fake.statePath });
    const check = run(["check"], { ...deps, cmd: fake2.cmd });
    assert.equal(check.code, 0);
  });
});

test("6. check drift", () => {
  withProgram(() => {
    const dir = tmpDir();
    const entry = bootstrapFixtureEntry();
    const seeded = `${render([bootstrapFixtureEntry({ cron: "0 0 * * *" })], "alpha").join("\n")}\n`;

    const fake = makeFakeCrontab(dir);
    writeFileSync(fake.statePath, seeded);
    const deps: CrontabDeps = { cmd: fake.cmd, instance: "alpha", schedule: [entry], dryRun: false };

    const result = run(["check"], deps);

    assert.equal(result.code, 1);
    assert.match(result.err, /installed:/);
    assert.match(result.err, /expected:/);
    assert.deepEqual(fake.calls(), ["-l"]);
  });
});

test("7. check missing", () => {
  withProgram(() => {
    const dir = tmpDir();
    const fake = makeFakeCrontab(dir);
    const deps: CrontabDeps = { cmd: fake.cmd, instance: "alpha", schedule: [bootstrapFixtureEntry()], dryRun: false };

    const result = run(["check"], deps);

    assert.equal(result.code, 1);
    assert.match(result.err, /no managed block installed/);
  });
});

test("8. check unnamed", () => {
  withProgram(() => {
    const dir = tmpDir();
    const seeded = [
      "# >>> doppelganger managed block (npm run crontab sync) >>>",
      "# old",
      "* * * * * old-cmd",
      "# <<< doppelganger managed block <<<",
    ].join("\n") + "\n";

    const fake = makeFakeCrontab(dir);
    writeFileSync(fake.statePath, seeded);
    const deps: CrontabDeps = { cmd: fake.cmd, instance: "alpha", schedule: [bootstrapFixtureEntry()], dryRun: false };

    const result = run(["check"], deps);

    assert.equal(result.code, 1);
    assert.match(result.err, /--adopt/);
    assert.equal(readFileSync(fake.statePath, "utf8"), seeded, "writes nothing");
  });
});

test("9. render writes nothing", () => {
  withProgram(() => {
    const dir = tmpDir();
    const fake = makeFakeCrontab(dir);
    const entry = bootstrapFixtureEntry();
    const deps: CrontabDeps = { cmd: fake.cmd, instance: "alpha", schedule: [entry], dryRun: false };

    const result = run(["render"], deps);

    assert.equal(result.code, 0);
    assert.deepEqual(fake.calls(), [], "-l is not even read");
    assert.equal(result.out, `${render([entry], "alpha").join("\n")}\n`);
  });
});

test("10. CRONTAB_DRY_RUN=1 sync on a host that would change", () => {
  withProgram(() => {
    const dir = tmpDir();
    const entry = bootstrapFixtureEntry();
    const seeded = `${render([bootstrapFixtureEntry({ cron: "0 0 * * *" })], "alpha").join("\n")}\n`;

    const fake = makeFakeCrontab(dir);
    writeFileSync(fake.statePath, seeded);
    const deps: CrontabDeps = { cmd: fake.cmd, instance: "alpha", schedule: [entry], dryRun: true };

    const result = run(["sync"], deps);

    assert.equal(result.code, 0);
    const wouldBe = splice(seeded, render([entry], "alpha"), "alpha");
    assert.equal(result.out, wouldBe, "stdout is the full would-be crontab, byte for byte");
    assert.deepEqual(fake.calls(), ["-l"], "read, never written");
    assert.equal(readFileSync(fake.statePath, "utf8"), seeded, "the crontab file's bytes are unchanged");
  });
});

test("11. the fake was really used — a CRONTAB_CMD that does not exist fails loudly, no PATH fallback", () => {
  withProgram(() => {
    const deps: CrontabDeps = {
      cmd: "/nonexistent/crontab-DOES-NOT-EXIST",
      instance: "alpha",
      schedule: [bootstrapFixtureEntry()],
      dryRun: false,
    };
    const result = run(["sync"], deps);
    assert.equal(result.code, 1);
    assert.ok(result.err.length > 0);
  });
});

test("12. two instances, end to end", () => {
  const dir = tmpDir();
  const childEnv = (instance: string, cmd: string): NodeJS.ProcessEnv => ({
    PATH: process.env.PATH ?? "",
    INSTANCE: instance,
    CRONTAB_CMD: cmd,
  });
  const spawnCrontab = (args: string[], env: NodeJS.ProcessEnv): { status: number | null; stderr: string } => {
    const r = spawnSync(process.execPath, [join(ROOT, "cli/crontab.ts"), ...args], {
      cwd: ROOT,
      env,
      encoding: "utf8",
    });
    return { status: r.status, stderr: r.stderr };
  };

  const fakeAlpha = makeFakeCrontab(dir);
  const alphaSync = spawnCrontab(["sync"], childEnv("alpha", fakeAlpha.cmd));
  assert.equal(alphaSync.status, 0, alphaSync.stderr);
  assert.ok(fakeAlpha.calls().length > 0, "alpha's wrapper log is non-empty");

  const fakeBeta = makeFakeCrontab(dir, { statePath: fakeAlpha.statePath });
  const betaSync = spawnCrontab(["sync"], childEnv("beta", fakeBeta.cmd));
  assert.equal(betaSync.status, 0, betaSync.stderr);
  assert.ok(fakeBeta.calls().length > 0, "beta's wrapper log is non-empty");

  const afterBoth = readFileSync(fakeAlpha.statePath, "utf8");
  assert.ok(afterBoth.includes(markers("alpha").begin));
  assert.ok(afterBoth.includes(markers("beta").begin));
  // Structural, not just textual: TWO distinct begin lines, one per instance. With an empty
  // SCHEDULE (real, at N2) the two instances' rendered BODIES are otherwise identical, so a
  // markers() bug that collapses both instances onto the same marker text would still pass the
  // two `.includes` checks above (same string, found once) — this count is what actually catches
  // that collapse: a global pair means beta's sync finds alpha's block already installed and
  // REPLACES it in place, leaving exactly one begin line instead of two.
  const beginLines = afterBoth.split("\n").filter((l) => l.startsWith("# >>> doppelganger"));
  assert.equal(beginLines.length, 2, "one begin line per instance, not a collapsed pair");
  const betaBlockBefore = installedBlock(afterBoth, "beta");

  const fakeAlphaAgain = makeFakeCrontab(dir, { statePath: fakeAlpha.statePath });
  const alphaAgain = spawnCrontab(["sync"], childEnv("alpha", fakeAlphaAgain.cmd));
  assert.equal(alphaAgain.status, 0, alphaAgain.stderr);

  const afterAlphaAgain = readFileSync(fakeAlpha.statePath, "utf8");
  assert.deepEqual(installedBlock(afterAlphaAgain, "beta"), betaBlockBefore, "beta's block is byte-identical");

  const fakeCheckAlpha = makeFakeCrontab(dir, { statePath: fakeAlpha.statePath });
  const checkAlpha = spawnCrontab(["check"], childEnv("alpha", fakeCheckAlpha.cmd));
  assert.equal(checkAlpha.status, 0, checkAlpha.stderr);

  const fakeCheckBeta = makeFakeCrontab(dir, { statePath: fakeAlpha.statePath });
  const checkBeta = spawnCrontab(["check"], childEnv("beta", fakeCheckBeta.cmd));
  assert.equal(checkBeta.status, 0, checkBeta.stderr);
});

test("13. the argv guard exists", () => {
  const src = readFileSync(join(ROOT, "cli/crontab.ts"), "utf8");
  assert.match(src, /import\.meta\.filename === process\.argv\[1\]/);
  // every test above this one called `run()` directly or (test 12 only) spawned a real CHILD
  // process on purpose — none relied on importing this module to run a command as a side effect,
  // which the other eleven in-process tests demonstrate structurally: this whole file imports
  // cli/crontab.ts and none of them ever touched the fake before calling `run()` themselves.
});
