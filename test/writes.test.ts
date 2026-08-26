// J1.19 (INS-02, §1) — "there is no third category" made testable: three doors, each shutting off
// one way a hidden write path could exist, plus the two-word vocabulary the register accepts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const KERNEL = join(ROOT, "kernel");

function walkTsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkTsFiles(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
}

// ---------------------------------------------------------------------------------------------
// Door 1 — no hardcoded path, no homedir()/tmpdir() in the kernel
// ---------------------------------------------------------------------------------------------
//
// Matches a STRING literal (never a regex literal) whose first character is "/" or "~". The
// lookbehind requires the opening quote to sit in a value position (after =([{,: or whitespace) —
// without it, a regex literal like /"/g or /\\"/g reads as a quote-then-slash and false-positives
// on kernel/runtime/log/{emit,parse}.ts's own escaping code. Nothing needed an allowlist entry once
// the lookbehind was added — measured, this repo has none today.
const HARDCODED_PATH = /(?<=[=(\[{,:\s])(["'])[/~]/;

test("1. door 1 — no hardcoded path literal, no homedir()/tmpdir() in the kernel", () => {
  const files: string[] = [];
  walkTsFiles(KERNEL, files);
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (HARDCODED_PATH.test(src) || /\bhomedir\(|\bos\.homedir\b|\btmpdir\(|\bos\.tmpdir\b/.test(src)) {
      offenders.push(f.slice(ROOT.length + 1));
    }
  }
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------------------------
// Door 2 — every EnvSpec row whose key ends _DB/_DIR/_ROOT resolves inside a probe ENGINE_ROOT
// ---------------------------------------------------------------------------------------------

function scrubbedChild(code: string, env: Record<string, string> = {}): string {
  const r = spawnSync(process.execPath, ["-e", code], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `child failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** Every `: EnvSpec = { ... }` row's `key`, found by TEXT scan rather than a curated list — the
 *  same technique test/knobs.test.ts's assertion 2 uses, kept as an independent copy on purpose: a
 *  bug in one file's scanner must not silently blind the other's. */
function findEnvSpecRowKeys(): string[] {
  const files: string[] = [];
  walkTsFiles(KERNEL, files);
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

/** For each row this door checks directly, the command that prints its resolved value in a
 *  scrubbed child under a probe `ENGINE_ROOT`. A row whose key ends `_DB`/`_DIR`/`_ROOT` and is
 *  neither here nor in `SKIPPED` fails the test by name — the same "the register cannot decide"
 *  shape as door 3, so a future row cannot go unchecked in silence. */
const RESOLVERS: Record<string, string> = {
  ENGINE_STATE_DIR: "import('./kernel/paths.ts').then(m=>console.log(m.STATE_DIR))",
};

/** Rows ending `_DB`/`_DIR`/`_ROOT` that this door deliberately does not probe directly, each with
 *  its reason — a skip nobody wrote down is a hole. */
const SKIPPED: Record<string, string> = {
  "<NAME>_DB":
    "the knob FAMILY row — no single key a child can set; dbPath('probe') is checked below instead",
  ENGINE_ROOT:
    "IS the probe — asserting it starts with itself is a tautology; J1.4 assertion 6 checks it moves STATE_DIR/dbPath together",
};

test("2. door 2 — every EnvSpec row ending _DB/_DIR/_ROOT resolves inside a probe ENGINE_ROOT", () => {
  const root = "/tmp/probe-root-writes";
  const keys = findEnvSpecRowKeys();
  const suffixed = keys.filter((k) => k.endsWith("_DB") || k.endsWith("_DIR") || k.endsWith("_ROOT"));

  for (const key of suffixed) {
    if (key in SKIPPED) continue;
    const code = RESOLVERS[key];
    assert.ok(
      code,
      `EnvSpec row ${key} ends _DB/_DIR/_ROOT but is neither in RESOLVERS nor SKIPPED in this test — a new row must say which`,
    );
    const value = scrubbedChild(code!, { ENGINE_ROOT: root });
    assert.ok(value.startsWith(root), `${key} resolved to ${value}, which does not start with ${root}`);
  }

  // <NAME>_DB has no key a child can set directly — resolve it through its one real entry point.
  const dbP = scrubbedChild("import('./kernel/paths.ts').then(m=>console.log(m.dbPath('probe')))", {
    ENGINE_ROOT: root,
  });
  assert.ok(dbP.startsWith(root), `dbPath('probe') ${dbP} does not start with ${root}`);
});

// ---------------------------------------------------------------------------------------------
// Door 3 — a new write path signs the register; the register accepts exactly two category words
// ---------------------------------------------------------------------------------------------

const WRITE_MEMBERS = new Set([
  "writeFileSync",
  "appendFileSync",
  "mkdirSync",
  "truncateSync",
  "rmSync",
  "renameSync",
  "openSync",
  "createWriteStream",
  // promise forms — createWriteStream has none
  "writeFile",
  "appendFile",
  "mkdir",
  "truncate",
  "rm",
  "rename",
  "open",
]);

interface RegisterEntry {
  /** Deliberately `string`, not a narrow union — a bad category word must fail at RUNTIME, in this
   *  test, not be caught by TypeScript before the assertion ever runs. */
  category: string;
  reason: string;
}

const REGISTER: Record<string, RegisterEntry> = {
  "kernel/runtime/db.ts": {
    category: "project-relative",
    reason: "mkdirSync for the database's own directory (DBS-01)",
  },
  "kernel/runtime/log/tail.ts": {
    category: "project-relative",
    reason: "copy-then-truncate rotation under LOG_ROOTS (LOG-08)",
  },
};

// Shapes that reach node:fs / node:fs/promises WITHOUT naming a member: a namespace import, a
// default import used as a namespace (`import fs from …` then `fs.writeFileSync(...)`), the named
// `promises` binding used the same way (`import { promises } from "node:fs"` then
// `promises.writeFile(...)`), and a dynamic `import(...)` (static or `await`-ed). None of these
// name which member is called at the import site, so the register cannot decide their category —
// every one of them is an automatic offender, whatever it turns out to call.
const NAMESPACE_SHAPES: readonly RegExp[] = [
  /import\s*\*\s*as\s+\w+\s+from\s+["']node:fs(\/promises)?["']/, // import * as fs from "node:fs"
  /import\s+[A-Za-z_$][\w$]*\s*(,\s*\{[^}]*\})?\s*from\s+["']node:fs(\/promises)?["']/, // default import
  /import\s*\{[^}]*\bpromises\b[^}]*\}\s*from\s+["']node:fs["']/, // named `promises`, used as a namespace
  /\bimport\(\s*["']node:fs(\/promises)?["']\s*\)/, // await import("node:fs") / import("node:fs/promises")
];

function findFsWriters(): string[] {
  const files: string[] = [];
  walkTsFiles(KERNEL, files);
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (NAMESPACE_SHAPES.some((re) => re.test(src))) {
      offenders.push(f);
      continue;
    }
    const importRe = /import\s*\{([^}]*)\}\s*from\s*["']node:fs(\/promises)?["']/g;
    let m: RegExpExecArray | null;
    let hit = false;
    while ((m = importRe.exec(src)) != null) {
      const names = m[1]!.split(",").map((s) => s.trim().split(/\s+as\s+/)[0]!.trim());
      if (names.some((n) => WRITE_MEMBERS.has(n))) hit = true;
    }
    if (hit) offenders.push(f);
  }
  return offenders.map((f) => f.slice(ROOT.length + 1)).sort();
}

test("3. door 3 — every fs-writing file under kernel/ signs the register", () => {
  const found = findFsWriters();
  const registered = Object.keys(REGISTER).sort();
  assert.deepEqual(
    found,
    registered,
    `fs-writing files drifted from the register.\nfound: ${found.join(", ")}\nregistered: ${registered.join(", ")}`,
  );
});

test("4. the register's category column accepts exactly two words", () => {
  for (const [file, entry] of Object.entries(REGISTER)) {
    assert.ok(
      entry.category === "project-relative" || entry.category === "INSTANCE-discriminated",
      `${file}: category must be "project-relative" or "INSTANCE-discriminated", got ${JSON.stringify(entry.category)}`,
    );
  }
});
