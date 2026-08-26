// J1.9 (TST-18, LOG-01) — the two emitters produce the same bytes.
//
// "Byte-identical" excludes exactly two fields, each for a stated reason: `ts=` (two processes read
// two clocks) and `src=` (the one field the two are SUPPOSED to disagree on). Everything else —
// everything from `event=` onward — is compared as raw Buffer bytes.
//
// The child that runs the TS side imports ./emit.ts directly, never the barrel (log/index.ts does
// not exist until J1.13 — see the note at the bottom of this file).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { Level } from "./emit.ts";
import { parseLine } from "./parse.ts";
import { VALUE_MATRIX } from "./values.fixture.ts";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const LOG_SH = new URL("./log.sh", import.meta.url).pathname;
const LEVELS: readonly Level[] = ["debug", "info", "warn", "error"];

// ---------------------------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------------------------

/** The TS emitter, in a child process — never the barrel, and env is BUILT, never inherited. */
function tsLine(
  job: string,
  level: Level,
  event: string,
  fields: Record<string, unknown>,
  env: { LOG_LEVEL?: string; TZ?: string } = {},
): Buffer {
  const code =
    `import('./kernel/runtime/log/emit.ts').then(m => ` +
    `m.logger(${JSON.stringify(job)}).${level}(${JSON.stringify(event)}, ${JSON.stringify(fields)}));`;
  const r = spawnSync(process.execPath, ["-e", code], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", TZ: env.TZ ?? "UTC", LOG_LEVEL: env.LOG_LEVEL ?? "debug" },
  });
  return r.stderr;
}

/** The bash emitter, in a child process. `pairs` are `k=v` argv words, passed verbatim (no shell
 *  re-interpretation — node hands them to execve as one argv array each). */
function bashRaw(
  job: string,
  level: Level,
  event: string,
  pairs: string[],
  env: { LOG_LEVEL?: string; TZ?: string; LC_ALL?: string },
  mergeStderr: boolean,
): { stdout: Buffer; stderr: Buffer } {
  const script = mergeStderr
    ? 'exec 2>&1; . "$1"; log_init "$2"; lvl=$3; ev=$4; shift 4; "log_$lvl" "$ev" "$@"'
    : '. "$1"; log_init "$2"; lvl=$3; ev=$4; shift 4; "log_$lvl" "$ev" "$@"';
  const r = spawnSync("bash", ["-c", script, "bash", LOG_SH, job, level, event, ...pairs], {
    env: {
      PATH: process.env.PATH ?? "",
      LC_ALL: env.LC_ALL ?? "C",
      TZ: env.TZ ?? "UTC",
      LOG_LEVEL: env.LOG_LEVEL ?? "debug",
    },
  });
  return { stdout: r.stdout, stderr: r.stderr };
}

/** A locale that bash cannot set prints `setlocale: cannot change locale...` on stderr (measured),
 *  which lands on the merged stream ahead of the real line. Strip it — byte-preserving, since
 *  latin1 is a 1:1 byte<->codeunit mapping and \n (0x0A) never appears inside a UTF-8 continuation
 *  byte (always >= 0x80). */
function stripLocaleWarning(buf: Buffer): Buffer {
  const text = buf.toString("latin1");
  const lines = text.split("\n").filter((l) => !l.startsWith("bash: warning:"));
  return Buffer.from(lines.join("\n"), "latin1");
}

function bashLine(
  job: string,
  level: Level,
  event: string,
  pairs: string[],
  env: { LOG_LEVEL?: string; TZ?: string; LC_ALL?: string } = {},
): Buffer {
  return stripLocaleWarning(bashRaw(job, level, event, pairs, env, true).stdout);
}

function fieldsToPairs(fields: Record<string, unknown>): string[] {
  return Object.entries(fields).map(([k, v]) => `${k}=${v}`);
}

const EVENT_MARK = Buffer.from(" event=");

/** Split a rendered line at " event=". The head is asserted to be exactly four `k=v` pairs BEFORE
 *  anything else is asserted about it, so a crafted job value containing " event=" cannot move the
 *  split silently. */
function splitHead(buf: Buffer): { head: Record<string, string>; tail: Buffer } {
  const idx = buf.indexOf(EVENT_MARK);
  assert.ok(idx > 0, `expected " event=" in ${JSON.stringify(buf.toString("utf8"))}`);
  const headStr = buf.subarray(0, idx).toString("utf8");
  const parts = headStr.split(" ");
  assert.equal(parts.length, 4, `head must be exactly 4 fields, got: ${JSON.stringify(headStr)}`);
  const head: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    head[p.slice(0, eq)] = p.slice(eq + 1);
  }
  return { head, tail: buf.subarray(idx) };
}

function assertHeadsAgree(tsHead: Record<string, string>, bashHead: Record<string, string>, job: string, level: Level, before: number): void {
  for (const head of [tsHead, bashHead]) {
    assert.match(head.ts!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(head.ts!.length, 20);
    assert.ok(Math.abs(Date.parse(head.ts!) - before) < 5000, `ts drifted: ${head.ts}`);
  }
  assert.equal(tsHead.level, level);
  assert.equal(bashHead.level, level);
  assert.equal(tsHead.job, bashHead.job, `job field disagrees: ts=${tsHead.job} bash=${bashHead.job}`);
  assert.equal(tsHead.src, "ts");
  assert.equal(bashHead.src, "sh");
}

function assertTailsIdentical(tsTail: Buffer, bashTail: Buffer, label: string): void {
  assert.deepEqual(
    tsTail,
    bashTail,
    `tails diverge for ${label}\n  ts:   ${tsTail.toString("hex")}\n  bash: ${bashTail.toString("hex")}`,
  );
}

// ---------------------------------------------------------------------------------------------
// (a) field-shape cases, this repo's own job names
// ---------------------------------------------------------------------------------------------

const CASES: readonly [Level, string, string, Record<string, unknown>][] = [
  ["info", "ops-hello", "tick-start", {}],
  ["warn", "nightly-sandcastle", "dirty-tree", { repo: "doppelganger" }],
  ["error", "ops-log-report", "adapter-failed", { source: "notion", msg: "no payload in agent output" }],
  ["error", "watchdog", "job-failed", { exit: 3, msg: "node kernel/x.ts exited non-zero" }],
  ["warn", "todo-triage", "labels-unreadable", { issue: 288, msg: 'gh said "Not Found" — keeping the session' }],
];

test("1. head fields agree over case group (a)", () => {
  for (const [level, job, event, fields] of CASES) {
    const before = Date.now();
    const ts = tsLine(job, level, event, fields);
    const bash = bashLine(job, level, event, fieldsToPairs(fields));
    const { head: tsHead } = splitHead(ts);
    const { head: bashHead } = splitHead(bash);
    assertHeadsAgree(tsHead, bashHead, job, level, before);
  }
});

test("2. tails are byte-identical over case group (a)", () => {
  for (const [level, job, event, fields] of CASES) {
    const ts = tsLine(job, level, event, fields);
    const bash = bashLine(job, level, event, fieldsToPairs(fields));
    const { tail: tsTail } = splitHead(ts);
    const { tail: bashTail } = splitHead(bash);
    assertTailsIdentical(tsTail, bashTail, `${job}/${event}`);
  }
});

// ---------------------------------------------------------------------------------------------
// (b) the value matrix
// ---------------------------------------------------------------------------------------------

function compareValueMatrix(locale: string): void {
  for (const v of VALUE_MATRIX) {
    const ts = tsLine("j", "info", "e", { v });
    const bash = bashLine("j", "info", "e", [`v=${v}`], { LC_ALL: locale });
    const { tail: tsTail } = splitHead(ts);
    const { tail: bashTail } = splitHead(bash);
    assertTailsIdentical(tsTail, bashTail, `value ${JSON.stringify(v)} under LC_ALL=${locale}`);
  }
}

test("3. tails are byte-identical over the value matrix under LC_ALL=C", () => {
  compareValueMatrix("C");
});

test("4. tails are byte-identical over the value matrix under every locale the machine reports", () => {
  let locales: string[];
  try {
    locales = spawnSync("locale", ["-a"], { encoding: "utf8" })
      .stdout.split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    locales = [];
  }
  if (locales.length === 0) locales = ["C"]; // a minimal image without locale -a; the static gate
  // (J1.7 assertion 11) still covers the property there.
  for (const locale of locales) compareValueMatrix(locale);
});

// ---------------------------------------------------------------------------------------------
// (c)/(d) msg hold-back and the empty-msg agreement
// ---------------------------------------------------------------------------------------------

test("5. msg hold-back agrees: msg last, after stays a field", () => {
  const fields = { msg: "hello there", after: "x" };
  const ts = tsLine("j", "info", "e", fields);
  const bash = bashLine("j", "info", "e", fieldsToPairs(fields));
  const { tail: tsTail } = splitHead(ts);
  const { tail: bashTail } = splitHead(bash);
  assertTailsIdentical(tsTail, bashTail, "msg hold-back");
  assert.ok(tsTail.toString("utf8").trimEnd().endsWith('after=x msg="hello there"'));
});

test("6. an empty msg renders msg=\"\" on both sides", () => {
  const fields = { msg: "" };
  const ts = tsLine("j", "info", "e", fields);
  const bash = bashLine("j", "info", "e", fieldsToPairs(fields));
  const { tail: tsTail } = splitHead(ts);
  const { tail: bashTail } = splitHead(bash);
  assertTailsIdentical(tsTail, bashTail, "empty msg");
  assert.ok(tsTail.toString("utf8").trimEnd().endsWith('msg=""'));
});

// ---------------------------------------------------------------------------------------------
// (e) LOG-10 gating
// ---------------------------------------------------------------------------------------------

test("7. LOG_LEVEL gating agrees over all 16 (level x LOG_LEVEL) pairs", () => {
  for (const logLevel of LEVELS) {
    for (const level of LEVELS) {
      const ts = tsLine("j", level, "e", {}, { LOG_LEVEL: logLevel });
      const bash = bashLine("j", level, "e", [], { LOG_LEVEL: logLevel });
      const tsEmpty = ts.length === 0;
      const bashEmpty = bash.length === 0;
      assert.equal(
        tsEmpty,
        bashEmpty,
        `LOG_LEVEL=${logLevel} level=${level}: ts empty=${tsEmpty} bash empty=${bashEmpty}`,
      );
      if (!tsEmpty) {
        const { tail: tsTail } = splitHead(ts);
        const { tail: bashTail } = splitHead(bash);
        assertTailsIdentical(tsTail, bashTail, `LOG_LEVEL=${logLevel} level=${level}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// The bash-only shape assertions
// ---------------------------------------------------------------------------------------------

test("8. every bash line ends with exactly one 0x0a and contains no 0x0d", () => {
  for (const [level, job, event, fields] of CASES) {
    const bash = bashLine(job, level, event, fieldsToPairs(fields));
    assert.equal(bash[bash.length - 1], 0x0a, "expected a trailing LF");
    assert.equal(bash.indexOf(0x0d), -1, "expected no CR anywhere");
    // Exactly one LF: strip it and confirm none remain.
    assert.equal(bash.subarray(0, -1).indexOf(0x0a), -1, "expected exactly one LF");
  }
});

test("9. every bash line parses, and src === 'sh'", () => {
  for (const [level, job, event, fields] of CASES) {
    const bash = bashLine(job, level, event, fieldsToPairs(fields));
    const parsed = parseLine(bash.toString("utf8").replace(/\n$/, ""));
    assert.ok(parsed, `expected a parse for ${bash.toString("utf8")}`);
    assert.equal(parsed!.src, "sh");
  }
});

test("10. the bash child writes nothing to stdout when stderr is not redirected", () => {
  const r = bashRaw("j", "info", "e", [], {}, false);
  assert.equal(r.stdout.length, 0);
  assert.ok(r.stderr.length > 0);
});

// ---------------------------------------------------------------------------------------------
// log_run — cause.ts's only consumer (LOG-09), untested in the reference
// ---------------------------------------------------------------------------------------------

function runLogRun(cmd: string): { stderr: Buffer; status: number | null } {
  const r = spawnSync("bash", ["-c", '. "$1"; log_init j; log_run "$2"', "bash", LOG_SH, cmd], {
    env: { PATH: process.env.PATH ?? "" },
  });
  return { stderr: r.stderr, status: r.status };
}

test("11. log_run succeeds: one line, level=info event=job-ok, exit 0", () => {
  const { stderr, status } = runLogRun("true");
  const text = stderr.toString("utf8");
  assert.equal(text.split("\n").filter(Boolean).length, 1);
  assert.match(text, /level=info /);
  assert.match(text, /event=job-ok/);
  assert.equal(status, 0);
});

test("12. log_run fails: one line, level=error event=job-failed exit=1, non-empty msg, returns 1", () => {
  const { stderr, status } = runLogRun("false");
  const text = stderr.toString("utf8");
  assert.equal(text.split("\n").filter(Boolean).length, 1);
  assert.match(text, /level=error /);
  assert.match(text, /event=job-failed/);
  assert.match(text, /exit=1/);
  const parsed = parseLine(text.trim())!;
  assert.ok(parsed.msg.length > 0);
  assert.equal(status, 1);
});

// ---------------------------------------------------------------------------------------------
// LOG-02 — logfmt, not JSONL
// ---------------------------------------------------------------------------------------------

test("13. LOG-02: every line is logfmt, not JSON", () => {
  const lines: string[] = [];
  for (const [level, job, event, fields] of CASES) {
    lines.push(tsLine(job, level, event, fields).toString("utf8").trim());
    lines.push(bashLine(job, level, event, fieldsToPairs(fields)).toString("utf8").trim());
  }
  for (const line of lines) {
    assert.throws(() => JSON.parse(line), `line parsed as JSON: ${line}`);
    const upToMsg = line.includes(" msg=") ? line.slice(0, line.indexOf(" msg=")) : line;
    for (const token of upToMsg.split(" ")) {
      const eq = token.indexOf("=");
      assert.ok(eq > 0, `token has no '=': ${token}`);
      const key = token.slice(0, eq);
      assert.match(key, /^[A-Za-z_][\w.-]*$/, `key does not match the shape: ${key}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// raw() — the deliberate asymmetry
// ---------------------------------------------------------------------------------------------

test("14. raw() writes verbatim with one LF, parses to null; log.sh defines no log_raw", () => {
  const r = spawnSync(
    process.execPath,
    ["-e", "import('./kernel/runtime/log/emit.ts').then(m => m.logger('j').raw('hello there'))"],
    { cwd: ROOT, env: { PATH: process.env.PATH ?? "" } },
  );
  assert.equal(r.stderr.toString("utf8"), "hello there\n");
  assert.equal(parseLine("hello there"), null);

  const src = spawnSync("cat", [LOG_SH], { encoding: "utf8" }).stdout;
  assert.doesNotMatch(src, /\blog_raw\b/);
});

// Not an AC here, deliberately — a forward reference. The obvious mutation for "the LOG-10 child
// must not import the barrel" is to point tsLine at ../log/index.ts. log/index.ts does not exist
// until J1.13, four commits later, so that mutation cannot be performed at this commit. The
// property is gated at J1.13 AC2, where the barrel lives.
