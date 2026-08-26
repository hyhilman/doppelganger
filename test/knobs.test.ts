// J1.18 (KRN-06, TST-07) — one place a knob is defined, and one file that reads the env.
//
// This test imports every module that owns an EnvSpec row and builds the full row list itself —
// config.ts cannot: importing db.ts (or tail.ts, which imports db.ts) from config.ts would be a
// cycle, since db.ts already imports config.ts for envNum. Keeping config.ts a leaf means the test
// is the thing that has to know every module, which is exactly what it is for.
//
// At N5 kernelEnv() is replaced by each Plugin's own `env` member (KRN-04) and these rows move onto
// plugins UNCHANGED — the row shape here is already what KRN-04 will carry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assertSpecShape, type EnvSpec } from "../kernel/config.ts";
import { INSTANCE_ENV } from "../kernel/instance.ts";
import { ENGINE_ROOT_ENV, STATE_DIR_ENV, NAME_DB_ENV } from "../kernel/paths.ts";
import { BUSY_TIMEOUT_ENV } from "../kernel/runtime/db.ts";
import { LOCK_STARVE_N_ENV, LOCK_STARVE_FAMILY_ENV } from "../kernel/runtime/gate.ts";
import { LOG_LEVEL_ENV } from "../kernel/runtime/log/emit.ts";
import { LOG_MAX_BYTES_ENV, LOG_MAX_READ_BYTES_ENV } from "../kernel/runtime/log/tail.ts";
import { EXEC_TIMEOUT_MS_ENV } from "../kernel/runtime/exec.ts";
import { GATE_WAIT_CAP_S_ENV } from "../host/cron.ts";
import {
  SUPERVISOR_MAX_RUN_MIN_ENV,
  SUPERVISOR_KILL_GRACE_MS_ENV,
  SUPERVISOR_SPAWN_STAGGER_MS_ENV,
  SUPERVISOR_DRAIN_MS_ENV,
} from "../host/supervisor.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// J2.3 (INS-02, KRN-06) — every N2 file lands outside kernel/, so this file's three scans must
// learn about host/ and cli/ before the first such file exists. plugins/ stays out: it holds no
// .ts file until N5.
const SCANNED_DIRS = ["kernel", "host", "cli"];

/** Every non-test .ts file under kernel/, host/ and cli/ — tolerating a root that does not exist
 *  yet (host/ and cli/ have no .ts file at N2's first commits). */
function allNonTestTsFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
    }
  };
  for (const d of SCANNED_DIRS) {
    const abs = join(ROOT, d);
    if (existsSync(abs)) walk(abs);
  }
  return out;
}

interface RowMeta {
  spec: EnvSpec;
  file: string; // repo-relative
  constName: string;
  /** Reader function(s) whose call, together with constName, counts as "read". Empty for the
   *  <NAME>_DB family row, which has no single key a reader can take directly. */
  readers: string[];
}

const ROWS: readonly RowMeta[] = [
  { spec: INSTANCE_ENV, file: "kernel/instance.ts", constName: "INSTANCE_ENV", readers: ["envOptional"] },
  { spec: ENGINE_ROOT_ENV, file: "kernel/paths.ts", constName: "ENGINE_ROOT_ENV", readers: ["envOptional"] },
  { spec: STATE_DIR_ENV, file: "kernel/paths.ts", constName: "STATE_DIR_ENV", readers: ["envStr"] },
  { spec: NAME_DB_ENV, file: "kernel/paths.ts", constName: "NAME_DB_ENV", readers: [] },
  { spec: BUSY_TIMEOUT_ENV, file: "kernel/runtime/db.ts", constName: "BUSY_TIMEOUT_ENV", readers: ["envNum"] },
  {
    spec: LOCK_STARVE_N_ENV,
    file: "kernel/runtime/gate.ts",
    constName: "LOCK_STARVE_N_ENV",
    readers: ["envNum"],
  },
  {
    spec: LOCK_STARVE_FAMILY_ENV,
    file: "kernel/runtime/gate.ts",
    constName: "LOCK_STARVE_FAMILY_ENV",
    readers: [],
  },
  { spec: LOG_LEVEL_ENV, file: "kernel/runtime/log/emit.ts", constName: "LOG_LEVEL_ENV", readers: ["envStr"] },
  {
    spec: LOG_MAX_BYTES_ENV,
    file: "kernel/runtime/log/tail.ts",
    constName: "LOG_MAX_BYTES_ENV",
    readers: ["envNum"],
  },
  {
    spec: LOG_MAX_READ_BYTES_ENV,
    file: "kernel/runtime/log/tail.ts",
    constName: "LOG_MAX_READ_BYTES_ENV",
    readers: ["envNum"],
  },
  {
    spec: GATE_WAIT_CAP_S_ENV,
    file: "host/cron.ts",
    constName: "GATE_WAIT_CAP_S_ENV",
    readers: ["envNum"],
  },
  {
    spec: SUPERVISOR_MAX_RUN_MIN_ENV,
    file: "host/supervisor.ts",
    constName: "SUPERVISOR_MAX_RUN_MIN_ENV",
    readers: ["envNum"],
  },
  {
    spec: SUPERVISOR_KILL_GRACE_MS_ENV,
    file: "host/supervisor.ts",
    constName: "SUPERVISOR_KILL_GRACE_MS_ENV",
    readers: ["envNum"],
  },
  {
    spec: SUPERVISOR_SPAWN_STAGGER_MS_ENV,
    file: "host/supervisor.ts",
    constName: "SUPERVISOR_SPAWN_STAGGER_MS_ENV",
    readers: ["envNum"],
  },
  {
    spec: SUPERVISOR_DRAIN_MS_ENV,
    file: "host/supervisor.ts",
    constName: "SUPERVISOR_DRAIN_MS_ENV",
    readers: ["envNum"],
  },
  {
    spec: EXEC_TIMEOUT_MS_ENV,
    file: "kernel/runtime/exec.ts",
    constName: "EXEC_TIMEOUT_MS_ENV",
    readers: ["envNum"],
  },
];

test("1. assertSpecShape passes over every real row", () => {
  assert.doesNotThrow(() => assertSpecShape(ROWS.map((r) => r.spec)));
});

/**
 * Every `: EnvSpec = { ... }` object literal under kernel/ (non-test files), found by TEXT scan
 * rather than the curated ROWS list above — so a stray row added anywhere, not just one this file
 * remembered to import, is still caught. This is what makes assertion 2 a real gate: the curated
 * list can only ever prove the rows it already knows about agree with each other.
 */
function findEnvSpecKeys(): string[] {
  const files = allNonTestTsFiles();

  const keys: string[] = [];
  const declRe = /:\s*EnvSpec\s*=\s*\{/g;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    let m: RegExpExecArray | null;
    declRe.lastIndex = 0;
    while ((m = declRe.exec(src)) != null) {
      const braceStart = m.index + m[0].length - 1;
      let depth = 1;
      let i = braceStart + 1;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
      }
      const block = src.slice(braceStart, i);
      const keyMatch = /key:\s*"([^"]+)"/.exec(block);
      if (keyMatch) keys.push(keyMatch[1]!);
    }
  }
  return keys;
}

test("2. every scanned EnvSpec row is in ROWS, and every ROWS key is scanned — no duplicates either way", () => {
  const keys = findEnvSpecKeys();
  // `>=` only ever caught extra rows if they happened to duplicate an existing key (assertion 2's
  // second half). A brand-new key with no matching ROWS entry — a knob that exists with no roadmap
  // row, no test coverage, nothing — passed `>=` outright. `deepEqual` closes that: the scanned set
  // and the curated set must be the SAME set, not merely the same size or a superset. The <NAME>_DB
  // family exception still works here because ROWS already carries a `NAME_DB_ENV` entry whose
  // `spec.key` is the literal `"<NAME>_DB"`, and the scanner finds that same literal in paths.ts —
  // there is nothing special-cased about it in this assertion.
  assert.deepEqual(
    keys.slice().sort(),
    ROWS.map((r) => r.spec.key).sort(),
    `scanned EnvSpec keys and the curated ROWS list disagree.\nscanned: ${keys.slice().sort().join(", ")}\nROWS:    ${ROWS.map((r) => r.spec.key).slice().sort().join(", ")}`,
  );
  assert.equal(new Set(keys).size, keys.length, `duplicate keys among: ${keys.join(", ")}`);
});

test("3. process.env is named in exactly one non-test file under kernel/, host/, cli/: kernel/config.ts", () => {
  const files = allNonTestTsFiles();

  const named = files
    .filter((f) => readFileSync(f, "utf8").includes("process.env"))
    .map((f) => f.slice(ROOT.length + 1))
    .sort();
  assert.deepEqual(named, ["kernel/config.ts"]);
});

test("4. every row is read: the key is named once and a real reader is called with the row", () => {
  for (const row of ROWS) {
    const src = readFileSync(join(ROOT, row.file), "utf8");
    const keyLiteral = `"${row.spec.key}"`;
    const count = src.split(keyLiteral).length - 1;
    assert.equal(count, 1, `${row.file}: expected ${keyLiteral} exactly once, found ${count}`);

    if (row.readers.length === 0) continue; // the <NAME>_DB family row — envDynamic checked in 7
    const readCalled = row.readers.some((fn) => src.includes(`${fn}(${row.constName}`));
    assert.ok(
      readCalled,
      `${row.file}: expected one of [${row.readers.join(", ")}] called with ${row.constName}`,
    );
  }
});

function scrubbedChild(code: string, env: Record<string, string> = {}): string {
  const r = spawnSync(process.execPath, ["-e", code], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `child failed: ${r.stderr}`);
  return r.stdout.trim();
}

test("5. every defaulted row's default is the value you get, resolved in a scrubbed child", () => {
  // ENGINE_STATE_DIR: root-relative, so a known ENGINE_ROOT pins the expected absolute value.
  const probeRoot = "/tmp/probe-root-knobs";
  assert.equal(
    scrubbedChild("import('./kernel/paths.ts').then(m=>console.log(m.STATE_DIR))", {
      ENGINE_ROOT: probeRoot,
    }),
    `${probeRoot}/.doppelganger/state`,
  );
  assert.equal(
    scrubbedChild("import('./kernel/runtime/db.ts').then(m=>console.log(m.BUSY_TIMEOUT_MS))"),
    "5000",
  );
  assert.equal(
    scrubbedChild("import('./kernel/runtime/log/emit.ts').then(m=>console.log(m.LOG_LEVEL))"),
    "info",
  );
  assert.equal(
    scrubbedChild("import('./kernel/runtime/log/tail.ts').then(m=>console.log(m.MAX_BYTES))"),
    String(8 * 1024 * 1024),
  );
  assert.equal(
    scrubbedChild("import('./kernel/runtime/log/tail.ts').then(m=>console.log(m.MAX_READ))"),
    String(4 * 1024 * 1024),
  );
  assert.equal(
    scrubbedChild("import('./kernel/runtime/exec.ts').then(m=>console.log(m.EXEC_TIMEOUT_MS))"),
    "180000",
  );
  assert.equal(
    scrubbedChild("import('./host/cron.ts').then(m=>console.log(m.GATE_WAIT_CAP_S))"),
    "1800",
  );
  assert.equal(
    scrubbedChild("import('./host/supervisor.ts').then(m=>console.log(m.SUPERVISOR_MAX_RUN_MIN))"),
    "180",
  );
  assert.equal(
    scrubbedChild("import('./host/supervisor.ts').then(m=>console.log(m.SUPERVISOR_KILL_GRACE_MS))"),
    "10000",
  );
  assert.equal(
    scrubbedChild("import('./host/supervisor.ts').then(m=>console.log(m.SUPERVISOR_SPAWN_STAGGER_MS))"),
    "2000",
  );
  assert.equal(
    scrubbedChild("import('./host/supervisor.ts').then(m=>console.log(m.SUPERVISOR_DRAIN_MS))"),
    "30000",
  );
  // INSTANCE, ENGINE_ROOT and <NAME>_DB carry no `default` — two have computed fallbacks (a
  // basename, cwd), one is a family with no single value — so they are skipped here by name.
});

test("6. every row appears in roadmap.md Section 2.27", () => {
  const roadmap = readFileSync(join(ROOT, "roadmap.md"), "utf8");
  const start = roadmap.indexOf("### 2.27");
  const end = roadmap.indexOf("### 2.28", start);
  const slice = roadmap.slice(start, end);
  const tokens = new Set<string>();
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) != null) tokens.add(m[1]!);

  for (const row of ROWS) {
    assert.ok(tokens.has(row.spec.key), `roadmap.md Section 2.27 is missing ${row.spec.key}`);
  }
});

test("7. envDynamic has exactly two call sites (paths.ts's <NAME>_DB, gate.ts's LOCK_STARVE_N_<JOB>)", () => {
  const files = allNonTestTsFiles();

  const callSites: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const occurrences = (src.match(/envDynamic\(/g) ?? []).length;
    // config.ts's own `export function envDynamic(` is the definition, not a call — subtract it.
    const calls = f.endsWith("kernel/config.ts") ? occurrences - 1 : occurrences;
    for (let i = 0; i < calls; i++) callSites.push(f.slice(ROOT.length + 1));
  }
  assert.deepEqual(callSites.sort(), ["kernel/runtime/gate.ts", "kernel/paths.ts"].sort());

  const configSrc = readFileSync(join(ROOT, "kernel/config.ts"), "utf8");
  assert.match(configSrc, /<NAME>_DB/); // the comment naming the family, beside the definition
});
