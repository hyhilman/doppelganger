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
// Door 2 — every _DB/_DIR/_ROOT default resolves inside a probe ENGINE_ROOT
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

test("2. door 2 — every _DB/_DIR/_ROOT default resolves inside a probe ENGINE_ROOT", () => {
  const root = "/tmp/probe-root-writes";

  const stateDir = scrubbedChild("import('./kernel/paths.ts').then(m=>console.log(m.STATE_DIR))", {
    ENGINE_ROOT: root,
  });
  assert.ok(stateDir.startsWith(root), `STATE_DIR ${stateDir} does not start with ${root}`);

  // <NAME>_DB has no key a child can set directly — resolve it through its one real entry point.
  const dbP = scrubbedChild("import('./kernel/paths.ts').then(m=>console.log(m.dbPath('probe')))", {
    ENGINE_ROOT: root,
  });
  assert.ok(dbP.startsWith(root), `dbPath('probe') ${dbP} does not start with ${root}`);

  // ENGINE_ROOT itself IS the probe — asserting it starts with itself is a tautology. The
  // meaningful check (setting it moves STATE_DIR and dbPath together) is J1.4's own assertion 6.
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
