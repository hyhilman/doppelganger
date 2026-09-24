// host/watchdog.sh: two drift gates (the knobs, the paths) over
// the script's own source text, then real bash execution against fixture roots.
//
// The log.sh <-> emit.ts precedent, one directory over: nothing here re-implements the
// script, it PARSES it — a knob or a path the script grows must show up here or the build fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, utimesSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import {
  WATCHDOG_SUPERVISOR_STALE_M_ENV,
  WATCHDOG_DRY_RUN_ENV,
  NTFY_URL_ENV,
  NTFY_TOPIC_ENV,
  NTFY_TOKEN_ENV,
  WATCHDOG_NO_NOTIFY_ENV,
} from "./config.ts";
import { INSTANCE_ENV } from "../kernel/instance.ts";
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

const ROWS = [
  WATCHDOG_SUPERVISOR_STALE_M_ENV,
  WATCHDOG_DRY_RUN_ENV,
  NTFY_URL_ENV,
  NTFY_TOPIC_ENV,
  NTFY_TOKEN_ENV,
  WATCHDOG_NO_NOTIFY_ENV,
  // The topic falls back to INSTANCE before it falls back to the checkout's own directory name
  // (INS-01), so the script now reads it too. Its row lives in kernel/instance.ts, not
  // host/config.ts, but this gate only cares that every read has SOME matching row.
  INSTANCE_ENV,
];

/** Signed list of knobs whose default is COMPUTED, so no string on the EnvSpec row can express it
 *  and `default` is legitimately absent. Same shape and same discipline as EXCLUDED_READS above:
 *  the value here is the script's own default TEXT, asserted exactly, so the escape hatch cannot
 *  be used to hide a row that simply forgot its default.
 *
 *  `kernel/instance.ts`'s INSTANCE_ENV is the precedent and states the rule in its own comment:
 *  "No `default`: the fallback is the project directory's basename, which is *computed* and no
 *  string can express it. A row claiming a default it does not have would be a lie this drift
 *  gate could not catch." */
const COMPUTED_DEFAULTS: Record<string, string> = {
  NTFY_URL: "$(dotenv_get NTFY_URL)",
  NTFY_TOKEN: "$(dotenv_get NTFY_TOKEN)",
  NTFY_TOPIC: "$(dotenv_get NTFY_TOPIC)",
  // The topic's own middle fallback: NTFY_TOPIC unset falls back to INSTANCE (env then .env)
  // before it falls back to basename(ROOT) below.
  INSTANCE: "$(dotenv_get INSTANCE)",
};

/** The LAST resort under both computed defaults above: with none of NTFY_TOPIC, the environment's
 *  INSTANCE or `.env`'s INSTANCE naming a topic, the checkout's own directory name is it (INS-01).
 *  Signed separately because `extractDefault` only ever sees the FIRST `:-` form, so this line
 *  would otherwise be invisible to test 1 — and it is the line the whole per-repo derivation rests
 *  on. */
const TOPIC_LAST_RESORT = '[ -n "$topic" ] || topic="$(basename "$ROOT")"';

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

  // The computed-default list is exact too — every name in it is a real ROW that really does omit
  // `default`, so a row that merely forgot one cannot be parked here.
  for (const [key, text] of Object.entries(COMPUTED_DEFAULTS)) {
    const row = ROWS.find((r) => r.key === key);
    assert.ok(row, `COMPUTED_DEFAULTS names ${key}, which is not a ROW at all`);
    assert.equal(row.default, undefined, `${key} is in COMPUTED_DEFAULTS but its row DOES carry a literal default — drop one or the other`);
    assert.equal(extractDefault(SCRIPT_SRC, key), text, `${key}: the script's computed default drifted from the text signed here`);
  }
  assert.ok(SCRIPT_SRC.includes(TOPIC_LAST_RESORT), "the topic's INSTANCE last-resort line is gone — every breach would post to an empty topic");

  for (const row of ROWS) {
    if (row.key in COMPUTED_DEFAULTS) continue; // asserted above, against its own signed text
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

/** Real `node` INVOCATIONS in `line`, never text MENTIONS: double-quoted string contents (the
 *  fault messages' own prose, which says "node" too) are blanked out first, so what is left is
 *  only what bash would actually treat as command text. Counts every occurrence, not just
 *  whether the line has one — two invocations on the SAME line must both be counted, which a
 *  per-LINE match (one match per line, however many times "node" appears in it) cannot do. */
function nodeInvocationsIn(line: string): number {
  const withoutQuoted = line.replace(/"[^"]*"/g, '""');
  return (withoutQuoted.match(/\bnode\b/g) ?? []).length;
}

test("3. the script names no node, no npm and nothing under node_modules — except probe 2's two signed node calls", () => {
  assert.equal((CODE.match(/\bnpm\s/g) ?? []).length, 0, "no npm invocation");
  assert.equal((CODE.match(/node_modules\//g) ?? []).length, 0, "no path INTO node_modules — only its own existence is checked");
  assert.equal((CODE.match(/\btsx\b/g) ?? []).length, 0, "no tsx");
  assert.equal((CODE.match(/\bsqlite3\b/g) ?? []).length, 0, "no sqlite3");
  const nodeLines: string[] = [];
  for (const line of CODE.split("\n")) {
    if (line.includes("node_modules")) continue;
    for (let i = 0; i < nodeInvocationsIn(line); i++) nodeLines.push(line);
  }
  assert.equal(nodeLines.length, 2, `expected exactly 2 node invocations (probe 2), got ${nodeLines.length}:\n${nodeLines.join("\n")}`);
  assert.ok(nodeLines[0]!.includes("node --version"));
  assert.ok(nodeLines[1]!.includes("watchdog.probe.ts"));
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
  readonly ntfyStamp: string;
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
    ntfyStamp: join(root, ".doppelganger/ntfy.fail"),
    breach: join(root, ".doppelganger/watchdog.breach"),
  };
}

/** Only the fault lines. Every breaching run now also emits ONE notify-* line (the third channel),
 *  and a test about probes should not have to count it. */
const breachLines = (stderr: string): string[] =>
  stderr.trim().split("\n").filter((l) => l.includes("event=breach"));

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
  const lines = breachLines(r.stderr);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /level=error/);
  assert.match(lines[0]!, /event=breach/);
  assert.match(lines[0]!, /heartbeat/);
  assert.ok(existsSync(f.breach));
  // The fixture sets no NTFY_URL, so the third channel stands down QUIETLY — and, crucially,
  // leaves no stamp: declining to send is not a delivery failure.
  assert.match(r.stderr, /event=notify-unconfigured/);
  assert.ok(!existsSync(f.ntfyStamp));
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
  const lines = breachLines(r.stderr);
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
  // No sendmail/mail/mailx/postfix/exim4/ssmtp/msmtp on this host, /var/mail
  // empty, and `strings /usr/sbin/cron` (3.0pl1-184ubuntu2) contains the line
  // "No MTA installed, discarding output" — cron writes that to syslog and throws the fault text
  // away. So this test asserts the EXIT CODE and asserts NOTHING about mail, on purpose — a future
  // reader must not add a mail assertion for a channel that does not exist on this host.
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const r = run(f.root);
  assert.equal(r.status, 1);
});


// ---------------------------------------------------------------------------------------------
// Tests 13-17: the third channel, driven through a `curl` SHIM on PATH.
// ---------------------------------------------------------------------------------------------
//
// A shim, not a real socket, and the reason is not convenience. What can actually break in this
// path is the ARGV the script builds — a header spelled wrong, the topic pasted onto the URL
// without its separator, the body passed as a flag instead of data. The shim captures that argv
// verbatim, which is the thing under test; a real listener would additionally assert curl's own
// HTTP behaviour, which is not this repo's code. It also keeps `npm test` free of a bound port and
// of any network at all, which matters for a suite CI runs on every push.

/** Writes a `curl` onto PATH that records its argv NUL-separated and prints `code` on stdout —
 *  exactly what `-w '%{http_code}'` would have printed. Returns two capture paths and the PATH the
 *  script must run with.
 *
 *  `rawCapture` is argv exactly as the real curl process would have received it — the thing test
 *  26 checks the bearer token is absent from. `capture` decodes any `-H @path` argument into the
 *  header text that path pointed at before recording it, so every OTHER test's header assertions
 *  (`Authorization: Bearer …` etc., tests 13/14/15/18/19) read the same as before Fix4 moved the
 *  token off the command line — the shim resolves the indirection so the tests do not have to. */
function curlShim(root: string, code: string): { capture: string; rawCapture: string; path: string } {
  const bin = join(root, "shimbin");
  mkdirSync(bin, { recursive: true });
  const capture = join(root, "curl.argv");
  const rawCapture = join(root, "curl.argv.raw");
  // The values are BAKED IN rather than read from the environment: the shim must not be steerable
  // by the very env the script under test is handed, or a knob leaking into it would read as a
  // passing test.
  const script = [
    "#!/usr/bin/env bash",
    `printf '%s\\0' "$@" >> ${JSON.stringify(rawCapture)}`,
    'prev=""',
    "args=()",
    'for a in "$@"; do',
    '  cur="$a"',
    '  if [ "$prev" = "-H" ]; then',
    '    case "$cur" in',
    '      @*) cur="$(cat "${cur#@}" 2>/dev/null)" ;;',
    "    esac",
    "  fi",
    '  args+=("$cur")',
    '  prev="$a"',
    "done",
    `printf '%s\\0' "\${args[@]}" >> ${JSON.stringify(capture)}`,
    `printf '%s' ${JSON.stringify(code)}`,
    "",
  ].join("\n");
  writeFileSync(join(bin, "curl"), script, { mode: 0o755 });
  return { capture, rawCapture, path: `${bin}:${process.env.PATH ?? ""}` };
}

/** The shim's capture as a flat argv array; `[]` when curl was never called. */
function argv(capture: string): string[] {
  if (!existsSync(capture)) return [];
  return readFileSync(capture, "utf8").split("\0").filter((s) => s.length > 0);
}

/** The value following `flag` in an argv array — how the header assertions read below. */
function after(args: string[], flag: string): string[] {
  return args.filter((_, i) => i > 0 && args[i - 1] === flag);
}

test("13. a breach is POSTed: the topic is the checkout's own basename, and the faults are the body", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const shim = curlShim(f.root, "200");
  const r = run(f.root, { NTFY_URL: "https://ntfy.example/", NTFY_TOKEN: "tk_test", PATH: shim.path });
  const args = argv(shim.capture);

  assert.equal(r.status, 1, "the POST does not change the exit status — it is still PATH 2");
  assert.ok(args.length > 0, "curl was invoked exactly once on a breaching tick");

  // INS-01, end to end: nothing told the script its topic, it derived one from the root it was
  // pointed at. This is the assertion that fails if the INSTANCE derivation is ever dropped. The
  // trailing slash on NTFY_URL above is deliberate — `${url%/}` must not produce a double slash.
  assert.equal(args.at(-1), `https://ntfy.example/${basename(f.root)}`);

  const headers = after(args, "-H");
  assert.ok(headers.includes("Authorization: Bearer tk_test"), `headers were ${JSON.stringify(headers)}`);
  assert.ok(headers.includes("Priority: 4"));
  assert.ok(headers.some((h) => /^Title: .*watchdog: 1 fault\(s\)$/.test(h)));
  assert.match(after(args, "--data-binary")[0]!, /heartbeat stale/);

  assert.match(r.stderr, /event=notify-sent/);
  assert.ok(!existsSync(f.ntfyStamp), "a delivered alarm leaves no delivery stamp");
});

test("14. a non-2xx answer stamps the delivery failure and still exits 1 with the breach file written", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const shim = curlShim(f.root, "403");
  const r = run(f.root, { NTFY_URL: "https://ntfy.example", NTFY_TOKEN: "tk_wrong", PATH: shim.path });

  assert.equal(r.status, 1);
  assert.ok(existsSync(f.breach), "the pull channels are written BEFORE the push is attempted");
  assert.match(r.stderr, /event=notify-failed/);
  assert.match(r.stderr, /http=403/);
  assert.match(readFileSync(f.ntfyStamp, "utf8"), /http=403/);
});

test("15. probe 5 — a present ntfy.fail is itself a fault, so a broken alarm channel is reported once it recovers", () => {
  const f = makeFixture();                                  // heartbeat FRESH: nothing else is wrong
  writeFileSync(f.ntfyStamp, "2026-09-16T10:00:00Z http=000\n");
  const shim = curlShim(f.root, "200");
  const r = run(f.root, { NTFY_URL: "https://ntfy.example", NTFY_TOKEN: "tk_test", PATH: shim.path });

  const lines = breachLines(r.stderr);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /ntfy delivery failing since/);
  // The recovery case, which is the whole point of the circularity: the send now works, so the
  // first thing the phone hears after an outage is that the alarm channel had been down.
  assert.match(after(argv(shim.capture), "--data-binary")[0]!, /alarms raised since then were LOST/);
  assert.ok(!existsSync(f.ntfyStamp), "a delivered alarm clears the stamp, so the next tick is quiet");
});

test("15b. probe 6 — a present log-report.fail is a fault, and a delivered watchdog POST leaves it in place", () => {
  const f = makeFixture();                                  // heartbeat FRESH: nothing else is wrong
  const reportStamp = join(f.root, ".doppelganger/log-report.fail");
  writeFileSync(reportStamp, "2026-09-24T03:00:00Z http=500\n");
  const shim = curlShim(f.root, "200");
  const r = run(f.root, { NTFY_URL: "https://ntfy.example", NTFY_TOKEN: "tk_test", PATH: shim.path });

  const lines = breachLines(r.stderr);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /log report delivery failing since 2026-09-24T03:00:00Z/);
  // Its writer is host/notify.ts. The watchdog's own send working says nothing about that one.
  assert.ok(existsSync(reportStamp), "the watchdog's POST must not clear another writer's stamp");
});

test("16. WATCHDOG_NO_NOTIFY=1 skips the POST and leaves the stamp alone — standing down is not a delivery failure", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const shim = curlShim(f.root, "200");
  const r = run(f.root, {
    NTFY_URL: "https://ntfy.example",
    NTFY_TOKEN: "tk_test",
    WATCHDOG_NO_NOTIFY: "1",
    PATH: shim.path,
  });

  assert.equal(r.status, 1);
  assert.deepEqual(argv(shim.capture), [], "the kill switch means curl is never invoked at all");
  assert.match(r.stderr, /event=notify-disabled/);
  assert.ok(existsSync(f.breach), "the other two channels are untouched by the kill switch");
  assert.ok(!existsSync(f.ntfyStamp));
});

test("17. WATCHDOG_DRY_RUN=1 posts nothing — SAF-01 stays fully inert now that a network path exists", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const shim = curlShim(f.root, "200");
  const r = run(f.root, {
    NTFY_URL: "https://ntfy.example",
    NTFY_TOKEN: "tk_test",
    WATCHDOG_DRY_RUN: "1",
    PATH: shim.path,
  });

  assert.equal(r.status, 0);
  assert.deepEqual(argv(shim.capture), [], "a dry run that pages someone is not a dry run");
  assert.ok(!existsSync(f.breach));
  assert.ok(!existsSync(f.ntfyStamp));
});

test("18. the bare cron environment still sends: NTFY_URL and NTFY_TOKEN are read from .env, never sourced from it", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const shim = curlShim(f.root, "200");
  // A realistic .env: comments, a commented-out copy of the very key being read, quoting, and a
  // line that would DELETE this fixture if the file were ever `.`-sourced instead of parsed.
  writeFileSync(
    join(f.root, ".env"),
    [
      "# NTFY_URL=https://decoy.example",
      "NTFY_URL=https://ntfy.example",
      `NTFY_TOKEN="tk_from_dotenv"`,
      "NTFY_TOPIC=from-dotenv",
      `rm -rf ${JSON.stringify(f.root)}`,
      "",
    ].join("\n"),
  );

  // env deliberately carries NOTHING but PATH and ENGINE_ROOT — exactly what cron hands it.
  const r = run(f.root, { PATH: shim.path });
  const args = argv(shim.capture);

  assert.ok(existsSync(f.heartbeat), "the .env line was EXECUTED — it must only ever be read");
  assert.match(r.stderr, /event=notify-sent/);
  assert.equal(args.at(-1), "https://ntfy.example/from-dotenv", "commented-out decoy won, or the topic was not read");
  assert.ok(after(args, "-H").includes("Authorization: Bearer tk_from_dotenv"), "the surrounding quotes were not stripped");
});

test("19. an environment value BEATS .env — the operator file is a fallback, not an override", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const shim = curlShim(f.root, "200");
  writeFileSync(join(f.root, ".env"), "NTFY_URL=https://dotenv.example\nNTFY_TOKEN=tk_dotenv\n");

  const r = run(f.root, { NTFY_URL: "https://env.example", NTFY_TOKEN: "tk_env", PATH: shim.path });
  const args = argv(shim.capture);

  assert.match(r.stderr, /event=notify-sent/);
  assert.equal(args.at(-1), `https://env.example/${basename(f.root)}`);
  assert.ok(after(args, "-H").includes("Authorization: Bearer tk_env"));
});

// ---------------------------------------------------------------------------------------------
// Tests 20-26: a stale ntfy.fail must not pin a healthy host in breach forever, the topic falls
// back through INSTANCE before the checkout's basename, probe 0 pushes too, a WATCHDOG_NO_NOTIFY
// typo fails toward delivering, and the bearer token never lands on curl's own argv.
// ---------------------------------------------------------------------------------------------

test("20. a stale ntfy.fail does not breach a healthy host while the kill switch is on, and the stamp is left alone", () => {
  const f = makeFixture(); // heartbeat fresh: nothing else is wrong
  writeFileSync(f.ntfyStamp, "2026-09-16T10:00:00Z http=000\n");
  const r = run(f.root, { WATCHDOG_NO_NOTIFY: "1" });
  assert.equal(r.status, 0);
  assert.ok(!existsSync(f.breach), "disabled must not re-fault on the old ntfy.fail");
  assert.ok(existsSync(f.ntfyStamp), "the stamp is neither cleared nor rewritten while disabled");
});

test("21. a stale ntfy.fail does not breach a healthy host while ntfy is simply unconfigured, and the stamp is left alone", () => {
  const f = makeFixture(); // heartbeat fresh: nothing else is wrong
  writeFileSync(f.ntfyStamp, "2026-09-16T10:00:00Z http=000\n");
  const r = run(f.root); // no NTFY_URL / NTFY_TOKEN in the environment, no .env
  assert.equal(r.status, 0);
  assert.ok(!existsSync(f.breach), "unconfigured must not re-fault on the old ntfy.fail either");
  assert.ok(existsSync(f.ntfyStamp), "the stamp is neither cleared nor rewritten while unconfigured");
});

test("22. NTFY_TOPIC unset falls back to INSTANCE, not straight to the checkout's own basename", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const shim = curlShim(f.root, "200");
  const r = run(f.root, {
    NTFY_URL: "https://ntfy.example",
    NTFY_TOKEN: "tk_test",
    INSTANCE: "my-instance",
    PATH: shim.path,
  });
  assert.equal(r.status, 1);
  const args = argv(shim.capture);
  // basename(f.root) is a random tmp-dir name, never "my-instance" — this only passes if INSTANCE
  // actually won over it.
  assert.equal(args.at(-1), "https://ntfy.example/my-instance");
});

test("23. probe 0 pushes too: log.sh missing, ntfy configured — the POST carries the probe-0 message", () => {
  const f = makeFixture();
  rmSync(join(f.root, "kernel/runtime/log/log.sh"));
  const shim = curlShim(f.root, "200");
  const r = run(f.root, { NTFY_URL: "https://ntfy.example", NTFY_TOKEN: "tk_test", PATH: shim.path });
  assert.equal(r.status, 1);
  assert.ok(existsSync(f.breach));
  const args = argv(shim.capture);
  assert.ok(args.length > 0, "curl must be invoked even though log.sh is broken");
  assert.match(after(args, "--data-binary")[0]!, /log\.sh missing or broken/);
  assert.equal(args.at(-1), `https://ntfy.example/${basename(f.root)}`);
});

test("24. probe 0 stays inert under WATCHDOG_DRY_RUN even with ntfy configured — no POST, no breach file", () => {
  const f = makeFixture();
  rmSync(join(f.root, "kernel/runtime/log/log.sh"));
  const shim = curlShim(f.root, "200");
  const r = run(f.root, {
    NTFY_URL: "https://ntfy.example",
    NTFY_TOKEN: "tk_test",
    WATCHDOG_DRY_RUN: "1",
    PATH: shim.path,
  });
  assert.equal(r.status, 1);
  assert.ok(!existsSync(f.breach));
  assert.deepEqual(argv(shim.capture), [], "a dry run that pages someone is not a dry run, even from probe 0");
});

test("25. an unrecognised WATCHDOG_NO_NOTIFY value stays ON (fails toward delivering) and logs the typo once", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const shim = curlShim(f.root, "200");
  const r = run(f.root, {
    NTFY_URL: "https://ntfy.example",
    NTFY_TOKEN: "tk_test",
    WATCHDOG_NO_NOTIFY: "true", // not "0" or "1" — a plausible typo, not a recognised value
    PATH: shim.path,
  });
  assert.equal(r.status, 1);
  assert.ok(argv(shim.capture).length > 0, "a typo in the kill switch must not silently disable the alarm");
  assert.match(r.stderr, /level=error[^\n]*event=notify-config-typo[^\n]*key=WATCHDOG_NO_NOTIFY[^\n]*value=true/);
  assert.match(r.stderr, /event=notify-sent/);
  // The typo is logged, not raised as a fault of its own — only the pre-existing stale heartbeat
  // is a breach line.
  assert.equal(breachLines(r.stderr).length, 1);
});

test("26. the bearer token never appears as a literal curl argv entry", () => {
  const f = makeFixture();
  ageFile(f.heartbeat, 10);
  const shim = curlShim(f.root, "200");
  run(f.root, { NTFY_URL: "https://ntfy.example", NTFY_TOKEN: "tk_super_secret", PATH: shim.path });

  const raw = argv(shim.rawCapture);
  assert.ok(raw.length > 0, "curl was invoked");
  assert.ok(!raw.some((a) => a.includes("tk_super_secret")), "the token leaked onto curl's own argv");
  assert.ok(raw.some((a) => a.startsWith("@")), "the Authorization header must be passed via -H @<path>, not inline");

  // ...and the real header still reaches the server — Fix4 hides the token from argv, it does not
  // stop it being sent.
  const decoded = argv(shim.capture);
  assert.ok(after(decoded, "-H").includes("Authorization: Bearer tk_super_secret"));
});
