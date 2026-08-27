// J4.14 (JOB-O10, SUP-09, KRN-06) — host/watchdog.sh: two drift gates (the knobs, the paths) over
// the script's own source text, then real bash execution against fixture roots.
//
// The log.sh <-> emit.ts precedent (TST-18), one directory over: nothing here re-implements the
// script, it PARSES it — a knob or a path the script grows must show up here or the build fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, utimesSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WATCHDOG_SUPERVISOR_STALE_M_ENV, WATCHDOG_DRY_RUN_ENV } from "./config.ts";
import { DELIVERY_STAMPS } from "../kernel/runtime/delivery.ts";
import { parseLine } from "../kernel/runtime/log/parse.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SCRIPT_PATH = join(ROOT, "host/watchdog.sh");
const SCRIPT_SRC = readFileSync(SCRIPT_PATH, "utf8");
const REAL_LOG_SH = join(ROOT, "kernel/runtime/log/log.sh");
const REAL_PROBE_TS = join(ROOT, "host/watchdog.probe.ts");

// ---------------------------------------------------------------------------------------------
// Tests 1-4: static drift gates over the script's own source text — no execution.
// ---------------------------------------------------------------------------------------------

/** Every uppercase NAME the script READS: `$NAME` or `${NAME...}`, one pattern that stops at the
 *  name and so catches all seven expansion forms (`${N:-d}`, `${N-d}`, `${N:=d}`, `${N=d}`,
 *  `${N:?m}`, `: "${N:=d}"`, a bare `$N`) — none of them special-cased. */
function readNames(src: string): Set<string> {
  const out = new Set<string>();
  const re = /\$\{?([A-Z][A-Z0-9_]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) != null) out.add(m[1]!);
  return out;
}

/** Every uppercase NAME the script ASSIGNS: `NAME=` at line-start, or `local NAME=` / `declare
 *  NAME=`. Whatever is read but never assigned is the knob set — ROOT, BREACH, HEARTBEAT, LOCK,
 *  STAMP, STALE_M, DRY and every other local drop out BY CONSTRUCTION. */
function assignedNames(src: string): Set<string> {
  const out = new Set<string>();
  const re = /^\s*(?:local\s+|declare\s+)?([A-Z][A-Z0-9_]*)=/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) != null) out.add(m[1]!);
  return out;
}

/** Signed exclusion list — names the script READS but never ASSIGNS that are not ITS knobs. Each
 *  has a one-line reason; asserted exactly (test 1) so it cannot grow silently. */
const EXCLUDED_READS: Record<string, string> = {
  BASH_SOURCE: "bash's own array, used for self-location, not a knob",
  ENGINE_ROOT: "INS-02's own override, already an EnvSpec row in kernel/paths.ts — not a NEW knob this script introduces",
};

/** Try every default-bearing expansion form for `name`, first match wins; `null` if none (a bare
 *  `$NAME` reference has no default text to compare). */
function extractDefault(src: string, name: string): string | null {
  const forms = [
    new RegExp(`\\$\\{${name}:-([^}]*)\\}`),
    new RegExp(`\\$\\{${name}-([^}]*)\\}`),
    new RegExp(`\\$\\{${name}:=([^}]*)\\}`),
    new RegExp(`\\$\\{${name}=([^}]*)\\}`),
  ];
  for (const re of forms) {
    const m = re.exec(src);
    if (m) return m[1]!;
  }
  return null;
}

const ROWS = [WATCHDOG_SUPERVISOR_STALE_M_ENV, WATCHDOG_DRY_RUN_ENV];

test("1. every knob in the script has a matching EnvSpec row, and the defaults agree — membership decided by reads-never-assigns, not by a spelling", () => {
  const reads = readNames(SCRIPT_SRC);
  const assigned = assignedNames(SCRIPT_SRC);
  const excluded = new Set(Object.keys(EXCLUDED_READS));

  // The exclusion list itself is exact — every excluded name really is read-but-not-assigned, and
  // nothing in it is stale.
  for (const name of excluded) {
    assert.ok(reads.has(name), `EXCLUDED_READS names ${name}, which the script does not read at all`);
  }

  const knobs = [...reads].filter((n) => !assigned.has(n) && !excluded.has(n));
  const rowKeys = new Set(ROWS.map((r) => r.key));
  assert.deepEqual(knobs.sort(), [...rowKeys].sort(), "the script's own knob set and host/config.ts's WATCHDOG_* rows must be exactly the same set");

  for (const row of ROWS) {
    const found = extractDefault(SCRIPT_SRC, row.key);
    assert.equal(found, row.default, `${row.key}: script default ${JSON.stringify(found)} must equal the row's default ${JSON.stringify(row.default)}`);
  }
});

/** `NAME="$ROOT/.doppelganger/SUFFIX"`-shaped assignments, resolved BEFORE the `.doppelganger/…`
 *  extraction below — the script's own body defeats a scan for `.doppelganger/…` literals alone:
 *  BREACH/LOCK/HEARTBEAT/STAMP are built by assignment and used as `"$BREACH"` etc., never spelled
 *  inline a second time. */
function resolvedDoppelgangerPaths(src: string): Set<string> {
  const assignRe = /^([A-Z][A-Z0-9_]*)="\$ROOT(\/\.doppelganger\/[^"]+)"/gm;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = assignRe.exec(src)) != null) found.add(m[2]!.slice(1)); // drop the leading "/"
  // Belt-and-braces: any INLINE .doppelganger/… literal not reached through an assignment above.
  const inlineRe = /\.doppelganger\/[A-Za-z0-9._-]+/g;
  while ((m = inlineRe.exec(src)) != null) found.add(m[0]);
  return found;
}

test("2. every path the script stats is a DELIVERY_STAMPS row or a named constant — assignments resolved first", () => {
  const found = resolvedDoppelgangerPaths(SCRIPT_SRC);
  const expected = new Set([...DELIVERY_STAMPS.map((r) => r.path), ".doppelganger/watchdog.lock", ".doppelganger/watchdog.breach", ".doppelganger/supervisor.heartbeat"]);
  assert.deepEqual(found, expected, "the script's own .doppelganger/ path set and DELIVERY_STAMPS + the three named constants must be exactly the same set");
});

/** Strips `#`-to-end-of-line comments before a code scan — the header prose legitimately says
 *  "no npm", "nothing under node_modules/" etc. in plain English, and only a REAL code reference
 *  should trip tests 3/4. Naive on purpose (no shell lexer): a `#` inside a real string is never
 *  used in this script, so this can only remove false positives, never hide a true one. */
function stripComments(src: string): string {
  return src
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
}
const CODE = stripComments(SCRIPT_SRC);

test("3. the script names no node, no npm and nothing under node_modules — except probe 2's two signed node calls", () => {
  assert.equal((CODE.match(/\bnpm\s/g) ?? []).length, 0, "no npm invocation");
  assert.equal((CODE.match(/node_modules\//g) ?? []).length, 0, "no path INTO node_modules — only its own existence is checked");
  assert.equal((CODE.match(/\btsx\b/g) ?? []).length, 0, "no tsx");
  assert.equal((CODE.match(/\bsqlite3\b/g) ?? []).length, 0, "no sqlite3");
  const nodeCalls = [...CODE.matchAll(/^[^\n]*\bnode\b[^\n]*$/gm)].filter((l) => l[0].trim().length > 0 && !l[0].includes("node_modules"));
  assert.equal(nodeCalls.length, 2, `expected exactly 2 node-naming lines (probe 2), got ${nodeCalls.length}:\n${nodeCalls.map((l) => l[0]).join("\n")}`);
  assert.ok(nodeCalls[0]![0].includes("node --version"));
  assert.ok(nodeCalls[1]![0].includes("watchdog.probe.ts"));
});

test("4. set -e is absent and set -uo pipefail is present", () => {
  assert.ok(!/\bset\s+-e\b/.test(CODE.replace(/set\s+-uo\s+pipefail/, "")), "set -e must not appear anywhere in the script's own code");
  assert.match(CODE, /set\s+-uo\s+pipefail/);
});

// ---------------------------------------------------------------------------------------------
// Tests 5-12: real execution against fixture roots.
// ---------------------------------------------------------------------------------------------

interface Fixture {
  readonly root: string;
  readonly heartbeat: string;
  readonly stamp: string;
  readonly breach: string;
}

/** A full, healthy fixture root: a real node_modules/ directory, real copies of watchdog.probe.ts
 *  and log.sh at the same relative paths the script expects, and a fresh heartbeat. */
function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "watchdog-fixture-"));
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, "host"), { recursive: true });
  mkdirSync(join(root, "kernel/runtime/log"), { recursive: true });
  mkdirSync(join(root, ".doppelganger"), { recursive: true });
  copyFileSync(REAL_PROBE_TS, join(root, "host/watchdog.probe.ts"));
  copyFileSync(REAL_LOG_SH, join(root, "kernel/runtime/log/log.sh"));
  const heartbeat = join(root, ".doppelganger/supervisor.heartbeat");
  writeFileSync(heartbeat, `${Math.floor(Date.now() / 1000)}\n`);
  return {
    root,
    heartbeat,
    stamp: join(root, ".doppelganger/heartbeat.fail"),
    breach: join(root, ".doppelganger/watchdog.breach"),
  };
}

function ageFile(path: string, minutesAgo: number): void {
  const t = new Date(Date.now() - minutesAgo * 60_000);
  utimesSync(path, t, t);
}

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(root: string, env: Record<string, string> = {}): RunResult {
  const r = spawnSync("bash", [SCRIPT_PATH], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ENGINE_ROOT: root, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("5. it runs, healthy", () => {
  const f = makeFixture();
  const r = run(f.root);
  assert.equal(r.status, 0);
  const lines = r.stderr.trim().split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /level=info/);
  assert.match(lines[0]!, /event=healthy/);
  assert.ok(!existsSync(f.breach));
});

test("6. it runs, breaching — the heartbeat aged past the stale window", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const r = run(f.root);
  assert.equal(r.status, 1);
  const lines = r.stderr.trim().split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /level=error/);
  assert.match(lines[0]!, /event=breach/);
  assert.match(lines[0]!, /heartbeat/);
  assert.ok(existsSync(f.breach));
});

test("7. the next healthy tick removes the breach file", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  assert.equal(run(f.root).status, 1);
  assert.ok(existsSync(f.breach));
  writeFileSync(f.heartbeat, `${Math.floor(Date.now() / 1000)}\n`); // fresh again
  const r = run(f.root);
  assert.equal(r.status, 0);
  assert.ok(!existsSync(f.breach));
});

test("8. probe 4 corrects probe 3 — the alive-but-cannot-stamp line prints BEFORE the stale-heartbeat line", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  writeFileSync(f.stamp, "2026-08-26T20:00:00Z boom\n");
  const r = run(f.root);
  assert.equal(r.status, 1);
  const lines = r.stderr.trim().split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /ALIVE but cannot write its heartbeat/);
  assert.match(lines[1]!, /heartbeat stale/);
  const breachText = readFileSync(f.breach, "utf8");
  const firstFaultLine = breachText.split("\n")[1]!;
  assert.match(firstFaultLine, /ALIVE but cannot write its heartbeat/);
});

test("9. WATCHDOG_DRY_RUN=1 on the breaching fixture — exit 0, the faults printed, no breach file", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const r = run(f.root, { WATCHDOG_DRY_RUN: "1" });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /event=breach/);
  assert.match(r.stderr, /event=dry-run/);
  assert.ok(!existsSync(f.breach), "a dry run must never write the breach file");
});

test("10. the log lines are the ONE shape — every line parses (LOG-01/TST-18, the fifth bash emitter)", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const r = run(f.root);
  const lines = r.stderr.trim().split("\n").filter((l) => l.length > 0);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    const parsed = parseLine(line);
    assert.ok(parsed, `line did not parse: ${line}`);
    assert.equal(parsed!.src, "sh");
    assert.equal(parsed!.job, "ops-watchdog");
  }
});

test("11. probe 0 — a missing log.sh is reported, not swallowed, and neither is a present-but-empty one", () => {
  // Missing entirely.
  {
    const f = makeFixture();
    rmSync(join(f.root, "kernel/runtime/log/log.sh"));
    const r = run(f.root);
    assert.equal(r.status, 1);
    assert.ok(existsSync(f.breach));
    assert.match(readFileSync(f.breach, "utf8"), /log\.sh/);
    assert.match(r.stderr, /log\.sh missing or broken/);
    assert.ok(!/command not found/.test(r.stderr), "probe 0 must catch this before any command-not-found leaks");
  }
  // Present but empty — sources CLEANLY (status 0) and still defines nothing; declare -F is what
  // decides, not the `.`'s own exit status.
  {
    const f = makeFixture();
    writeFileSync(join(f.root, "kernel/runtime/log/log.sh"), "");
    const r = run(f.root);
    assert.equal(r.status, 1);
    assert.ok(existsSync(f.breach));
    assert.match(readFileSync(f.breach, "utf8"), /log\.sh/);
    assert.match(r.stderr, /log\.sh missing or broken/);
    assert.ok(!/command not found/.test(r.stderr));
  }
  // SAF-01 — WATCHDOG_DRY_RUN=1 must be inert even inside probe 0, which fires BEFORE the DRY
  // read that guards every other write in this script: a dry run must never write the breach
  // file, missing log.sh or not. The stderr report and exit 1 status stay — a dry run reports,
  // it never writes.
  {
    const f = makeFixture();
    rmSync(join(f.root, "kernel/runtime/log/log.sh"));
    const r = run(f.root, { WATCHDOG_DRY_RUN: "1" });
    assert.equal(r.status, 1);
    assert.ok(!existsSync(f.breach), "a dry run must never write the breach file, even from probe 0");
    assert.match(r.stderr, /log\.sh missing or broken/);
  }
});

test("12. exit 1 is asserted as a status, never as a delivery", () => {
  // Measured on this host, 2026-08-26: no sendmail/mail/mailx/postfix/exim4/ssmtp/msmtp, /var/mail
  // empty, and `strings /usr/sbin/cron` (3.0pl1-184ubuntu2) contains the line
  // "No MTA installed, discarding output" — cron writes that to syslog and throws the fault text
  // away. So this test asserts the EXIT CODE and asserts NOTHING about mail, on purpose — a future
  // reader must not add a mail assertion for a channel that does not exist on this host.
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const r = run(f.root);
  assert.equal(r.status, 1);
});
