// J1.19 (INS-02, §1) — "there is no third category" made testable: three doors, each shutting off
// one way a hidden write path could exist, plus the two-word vocabulary the register accepts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// J2.3 (INS-02, KRN-06) — every N2 file lands outside kernel/, so the three repo-wide registers
// must learn about host/ and cli/ before the first such file exists. plugins/ stays out: it holds
// no .ts file until N5, and scanning it now would be a scan with no subject.
const SCANNED_DIRS = ["kernel", "host", "cli"];

function walkTsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkTsFiles(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
}

/** Every non-test .ts file under kernel/, host/ and cli/ — tolerating a root that does not exist
 *  yet (host/ and cli/ have no .ts file at N2's first commits). */
function allTsFiles(): string[] {
  const out: string[] = [];
  for (const d of SCANNED_DIRS) {
    const abs = join(ROOT, d);
    if (existsSync(abs)) walkTsFiles(abs, out);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Door 1 — no hardcoded path, no homedir()/tmpdir() in the kernel
// ---------------------------------------------------------------------------------------------
//
// Matches a STRING literal (never a regex literal) whose first character is "/" or "~" — quoted
// with `"`, `'`, OR a template literal's backtick (F5, N2 VERIFY: the original two-quote-char
// class left a plain, no-interpolation backtick path like `` `/etc/passwd` `` invisible in EVERY
// scanned file, not only cli/crontab.ts). The lookbehind requires the opening quote to sit in a
// value position (after =([{,: or whitespace) — without it, a regex literal like /"/g or /\\"/g
// reads as a quote-then-slash and false-positives on kernel/runtime/log/{emit,parse}.ts's own
// escaping code.
//
// EXCEPTIONS ARE SIGNED, NEVER SPELLED AROUND (N3 F2): door 1 decodes \uXXXX escapes before it
// scans, because three N3 literals were spelled `\u002F…` so the scanner would not see them —
// and a review then planted a genuinely hardcoded path in the same spelling and the suite stayed
// green. A gate a file can opt out of by respelling is not a gate. A literal that legitimately
// starts with a slash but is NOT a path (a command, a command prefix, a separator) gets a row in
// DOOR1_EXCEPTIONS below: file, exact literal, expected count, and the reason. The count is
// asserted exactly, so a SECOND copy of a signed literal is an offender, not a free pass — the
// hole N2's own DOOR1_ALLOWED_LITERAL had.
//
// History (F1/F2, N2 VERIFY): `cli/crontab.ts`'s `CRONTAB_CMD_ENV` used to carry
// `default: "/usr/bin/crontab"` — a real, absolute crontab binary on most hosts, which meant a
// caller who forgot to set `CRONTAB_CMD` sailed past layer 0 (it only refuses a non-absolute
// command) and reached the developer's real crontab. F1 dropped the default and made the row
// `required: true`, so the literal no longer exists in that file at all — this door needed a
// scoped exception before and needs none now. If a hardcoded absolute path ever reappears in
// `cli/crontab.ts`, this door must trip on it like anywhere else.
const HARDCODED_PATH = /(?<=[=(\[{,:\s])(["'`])[/~]/;

/** N3 F2: decode \uXXXX and \xXX escapes so no respelling hides a literal from door 1. */
function decodeEscapes(src: string): string {
  return src
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** The signed door-1 exception table (N3 F2). One row per allowed slash-leading literal that is
 *  not a path. `count` is exact: a second copy of the same literal anywhere in the file is an
 *  offender, which is the hole N2's whole-file `split(allowed).join("")` had. */
const DOOR1_EXCEPTIONS: readonly { file: string; literal: string; count: number; why: string }[] = [
  { file: "host/run.ts", literal: '"/bin/false"', count: 1,
    why: "GIT_SSH_COMMAND push gate - a command the agent execs, not a write path (INS-02 does not reach it)" },
  { file: "kernel/runtime/runjob.ts", literal: "`/${skillOf(job)}`", count: 1,
    why: "the skill-invocation prefix /<name> - a command prefix, not a path" },
  { file: "cli/skills.ts", literal: '"/"', count: 1,
    why: "the POSIX separator - one character, not a path" },
];

/** Strips block and line comments before door 1 scans — needed ONLY because of the backtick arm
 *  above (F5): this repo's own prose writes an inline-code path like `` `~/.gitconfig` `` or
 *  `` `/S` `` constantly, in both `//` lines and `/** *\/` blocks, and every one of those is now a
 *  backtick immediately followed by `/` or `~` in a value position — a real false positive, not a
 *  real hardcoded path. A real path literal is never inside a comment, so stripping comments first
 *  can only remove false positives, never hide a true one. Naive on purpose (no lexer): a `//`
 *  inside a real string literal gets cut too, which is the same "honest limit" door 5 already
 *  states for its own text scan. */
function stripComments(src: string): string {
  const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlockComments
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

test("1. door 1 — no hardcoded path literal, no homedir()/tmpdir() in kernel/, host/, cli/", () => {
  const files = allTsFiles();
  const offenders: string[] = [];
  for (const f of files) {
    let code = decodeEscapes(stripComments(readFileSync(f, "utf8")));
    const rel = f.slice(ROOT.length + 1);
    for (const ex of DOOR1_EXCEPTIONS.filter((e) => e.file === rel)) {
      const hits = code.split(ex.literal).length - 1;
      if (hits !== ex.count) {
        offenders.push(`${rel} (signed literal ${ex.literal} appears ${hits}x, signed for ${ex.count})`);
      }
      // remove exactly the signed count, leaving any extra copy for the scan below
      for (let i = 0; i < ex.count; i++) code = code.replace(ex.literal, "");
    }
    if (HARDCODED_PATH.test(code) || /\bhomedir\(|\bos\.homedir\b|\btmpdir\(|\bos\.tmpdir\b/.test(code)) {
      offenders.push(rel);
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
  const files = allTsFiles();
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
  "symlinkSync",
  "createWriteStream",
  // promise forms — createWriteStream has none
  "writeFile",
  "appendFile",
  "mkdir",
  "truncate",
  "rm",
  "rename",
  "open",
  "symlink",
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
  "host/supervisor.ts": {
    category: "project-relative",
    reason: "log sinks, the heartbeat stamp and the gate snapshot, all under ROOT (SUP-03, SUP-14)",
  },
  "host/runner.ts": {
    category: "project-relative",
    reason: "mkdirSync for GIT_CONFIG_GLOBAL's parent directory — a fresh checkout must not die on 'could not lock config file' (ruling 6, J3.3)",
  },
  "cli/skills.ts": {
    category: "project-relative",
    reason: "sync writes/rewrites a rendered SKILL.md and prunes an orphan directory, all under .claude/skills (SKL-04, J3.9)",
  },
  "host/jobs/nightly-sandcastle.ts": {
    category: "project-relative",
    reason: "symlinks node_modules into the pass worktree, all under the project-relative worktree root (J3.12)",
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
  const files = allTsFiles();
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

test("3. door 3 — every fs-writing file under kernel/, host/, cli/ signs the register", () => {
  const found = findFsWriters();
  const registered = Object.keys(REGISTER).sort();
  assert.deepEqual(
    found,
    registered,
    `fs-writing files drifted from the register.\nfound: ${found.join(", ")}\nregistered: ${registered.join(", ")}`,
  );
});

test("4. the registers' category column accepts exactly two words", () => {
  for (const [file, entry] of Object.entries(REGISTER)) {
    assert.ok(
      entry.category === "project-relative" || entry.category === "INSTANCE-discriminated",
      `${file}: category must be "project-relative" or "INSTANCE-discriminated", got ${JSON.stringify(entry.category)}`,
    );
  }
  for (const [file, entry] of Object.entries(COMMAND_REGISTER)) {
    assert.ok(
      entry.category === "project-relative" || entry.category === "INSTANCE-discriminated",
      `${file}: COMMAND_REGISTER category must be "project-relative" or "INSTANCE-discriminated", got ${JSON.stringify(entry.category)}`,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// Door 5 — a write that leaves through a COMMAND, not through node:fs
// ---------------------------------------------------------------------------------------------
//
// The crontab is INS-02's first INSTANCE-discriminated write, and it is performed by `crontab -`
// (execFileSync), which door 3 cannot see — no node:fs member is ever named. This door scans for a
// QUOTED command-name literal against a small, deliberate set of externally-mutating commands.
//
// What it cannot see: a name built by concatenation ("cron" + "tab") or read from a variable set
// elsewhere. That is the honest limit (LOOP.md: "a gate that pattern-matches ONE spelling of an
// import is not a gate") — J2.16's isAbsolute guard is the real enforcement; this text scan is the
// cheap second line. `gh` and `git` are deliberately not in this set: kernel/runtime/exec.ts names
// both and they are read-mostly wrappers whose write paths are JOB-G's (N5) to register.
const EXTERNAL_COMMANDS = ["crontab", "systemctl", "docker", "at"];

interface CommandRegisterEntry {
  command: string;
  category: string;
  reason: string;
}

const COMMAND_REGISTER: Record<string, CommandRegisterEntry> = {
  "cli/crontab.ts": {
    command: "crontab",
    category: "INSTANCE-discriminated",
    reason: "the managed block, delimited by markers carrying INSTANCE (INS-03)",
  },
};

test("5. door 5 — every file naming an externally-mutating command signs COMMAND_REGISTER", () => {
  const files = allTsFiles();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const rel = f.slice(ROOT.length + 1);
    for (const cmd of EXTERNAL_COMMANDS) {
      if (new RegExp(`["']${cmd}["']`).test(src)) {
        assert.ok(
          rel in COMMAND_REGISTER,
          `${rel} names ${JSON.stringify(cmd)} and is not in COMMAND_REGISTER`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Door 6 — no module-scope side-effect path in host/ or cli/ (ruling 2)
// ---------------------------------------------------------------------------------------------
//
// Every path and every external command in host/ and cli/ arrives through a REQUIRED `deps`
// argument, resolved only inside the `if (import.meta.filename === process.argv[1])` block that no
// test ever reaches — never at module scope. This door refuses a TOP-LEVEL call to any of six
// path/write primitives in a non-test file under host/ or cli/. kernel/ is exempt:
// kernel/runtime/log/tail.ts's LOG_ROOTS is a module-scope projectPath on purpose — a kernel
// default, not a host one.
//
// "Top-level" = the call's line begins at column 0, or the call appears inside a top-level
// const/let/var initialiser on the SAME line. The member list here and in the pattern below are the
// SAME list — six members: projectPath, dbPath, mkdirSync, createWriteStream, readFileSync,
// writeFileSync.
//
// What it cannot see: a top-level call routed through a helper defined in the same file, or one
// spread across a multi-line top-level declaration's continuation lines. Accepted — the
// required-deps typing is the real enforcement; this door is the cheap second line.
//
// F4 (N2 VERIFY): this door used to match the SIX MEMBER NAMES themselves at the call site, so
// `import { readFileSync as rfs } from "node:fs"` plus a module-scope `rfs(...)` matched nothing —
// the call site never spells `readFileSync` at all. LOOP.md's standing rule ("one spelling is not
// a gate"), fifth occurrence. Fixed by resolving each file's own LOCAL name for each member FIRST
// (following `as`, the same alias syntax door 3 already strips in the other direction), then
// building that file's call/decl patterns from the LOCAL names actually in scope there, aliased or
// not — never from the fixed member-name list directly.
const MODULE_SCOPE_MEMBERS = "projectPath|dbPath|mkdirSync|createWriteStream|readFileSync|writeFileSync";
const MODULE_SCOPE_MEMBER_RE = new RegExp(`^(${MODULE_SCOPE_MEMBERS})$`);

/** Every LOCAL name one of `MODULE_SCOPE_MEMBERS` is bound to in `src`, via ANY `import { ... }
 *  from "..."` clause — `local -> original`. An unaliased import binds `local === original`. */
function moduleScopeLocalNames(src: string): Map<string, string> {
  const map = new Map<string, string>();
  const importRe = /import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src)) != null) {
    for (const raw of m[1]!.split(",")) {
      const item = raw.trim();
      if (item.length === 0) continue;
      const parts = item.split(/\s+as\s+/).map((s) => s.trim());
      const original = parts[0]!;
      const local = (parts[1] ?? parts[0])!;
      if (MODULE_SCOPE_MEMBER_RE.test(original)) map.set(local, original);
    }
  }
  return map;
}

function findModuleScopeOffenders(): string[] {
  const offenders: string[] = [];
  for (const d of ["host", "cli"]) {
    const abs = join(ROOT, d);
    if (!existsSync(abs)) continue;
    const files: string[] = [];
    walkTsFiles(abs, files);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const rel = f.slice(ROOT.length + 1);
      const localNames = moduleScopeLocalNames(src);
      if (localNames.size === 0) continue;
      const alt = [...localNames.keys()].join("|");
      const declRe = new RegExp(`^(export )?(const|let|var)\\b.*\\b(${alt})\\(`);
      const callRe = new RegExp(`\\b(${alt})\\(`);
      const describe = (local: string): string => {
        const original = localNames.get(local)!;
        return local === original ? `${rel}: module-scope ${original}(` : `${rel}: module-scope ${original}( via local alias "${local}"`;
      };
      for (const line of src.split("\n")) {
        const declMatch = declRe.exec(line);
        if (declMatch) {
          offenders.push(describe(declMatch[3]!));
          continue;
        }
        if (!/^\s/.test(line)) {
          const callMatch = callRe.exec(line);
          if (callMatch) offenders.push(describe(callMatch[1]!));
        }
      }
    }
  }
  return offenders;
}

test("6. door 6 — no module-scope path/write call in host/ or cli/ (ruling 2)", () => {
  const offenders = findModuleScopeOffenders();
  assert.deepEqual(offenders, [], `module-scope side effect(s) found:\n${offenders.join("\n")}`);
});
