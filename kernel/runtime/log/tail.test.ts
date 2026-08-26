// J1.12 (LOG-08) — tail.ts: the incremental reader.
//
// One mkdtempSync directory for this file. Each test gets its own log root (a fresh subdirectory)
// AND its own database (LOG_DB, DBS-07's override) — never a path another test in this file used,
// per the discipline J1.17 turns into a gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { closeAll } from "../db.ts";
import { tail, logFiles } from "./tail.ts";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const BASE = mkdtempSync(join(tmpdir(), "dg-tail-"));
let n = 0;

function freshRoot(): string {
  const dir = join(BASE, `root-${n++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function freshDbPath(): string {
  return join(BASE, `log-${n++}.db`);
}

function withLogDb<T>(dbPath: string, fn: () => T): T {
  const prev = process.env.LOG_DB;
  process.env.LOG_DB = dbPath;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.LOG_DB;
    else process.env.LOG_DB = prev;
  }
}

const line = (event: string): string => `ts=2026-01-01T00:00:00Z level=info job=j src=sh event=${event}\n`;

test("1. a first sight of a file starts at its END", () => {
  const root = freshRoot();
  const dbPath = freshDbPath();
  const logPath = join(root, "a.log");
  writeFileSync(logPath, line("old"));
  const result = withLogDb(dbPath, () => tail([root]));
  assert.equal(result.lines.length, 0);
  closeAll();
});

test("2. lines appended after the first tick are returned on the second", () => {
  const root = freshRoot();
  const dbPath = freshDbPath();
  const logPath = join(root, "a.log");
  writeFileSync(logPath, line("old"));
  withLogDb(dbPath, () => tail([root]));
  appendFileSync(logPath, line("new"));
  const result = withLogDb(dbPath, () => tail([root]));
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0]!.event, "new");
  closeAll();
});

test("3. a trailing partial line is held for the next tick", () => {
  const root = freshRoot();
  const dbPath = freshDbPath();
  const logPath = join(root, "a.log");
  writeFileSync(logPath, "");
  withLogDb(dbPath, () => tail([root]));
  writeFileSync(logPath, "ts=2026-01-01T00:00:00Z level=info job=j src=sh event=partial"); // no LF
  let result = withLogDb(dbPath, () => tail([root]));
  assert.equal(result.lines.length, 0);
  appendFileSync(logPath, "\n");
  result = withLogDb(dbPath, () => tail([root]));
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0]!.event, "partial");
  closeAll();
});

test("4. truncation in place resets the cursor to zero and reports the path", () => {
  const root = freshRoot();
  const dbPath = freshDbPath();
  const logPath = join(root, "a.log");
  writeFileSync(logPath, line("a") + line("b") + line("c"));
  withLogDb(dbPath, () => tail([root])); // first sight — baseline at END
  writeFileSync(logPath, "x\n"); // same inode (writeFileSync truncates in place), smaller size
  const result = withLogDb(dbPath, () => tail([root]));
  assert.ok(result.reset.includes(logPath));
  closeAll();
});

test("5. replacement (a new inode at the same path) resets and reports", () => {
  const root = freshRoot();
  const dbPath = freshDbPath();
  const logPath = join(root, "a.log");
  writeFileSync(logPath, line("old"));
  withLogDb(dbPath, () => tail([root]));
  const swap = join(root, "a.log.new");
  writeFileSync(swap, line("new"));
  renameSync(swap, logPath); // a new inode lands at logPath
  const result = withLogDb(dbPath, () => tail([root]));
  assert.ok(result.reset.includes(logPath));
  closeAll();
});

// Tests 6 and 7 need small MAX_READ/MAX_BYTES, which tail.ts reads once at module load — so they
// run in a fresh child process with the env overrides in place before the module is ever imported.
function runChild(code: string): string {
  return execFileSync(process.execPath, ["-e", code], { cwd: ROOT, encoding: "utf8" }).trim();
}

test("6. LOG_MAX_READ_BYTES skips the excess and reports the skipped byte count", () => {
  const root = freshRoot();
  const dbPath = freshDbPath();
  const logPath = join(root, "a.log");
  writeFileSync(logPath, "");
  const code = `
    process.env.LOG_MAX_READ_BYTES = "100";
    process.env.LOG_DB = ${JSON.stringify(dbPath)};
    import('./kernel/runtime/log/tail.ts').then(m => {
      m.tail([${JSON.stringify(root)}]); // baseline at END=0 (empty file)
      const fs = require('node:fs');
      const one = 'ts=2026-01-01T00:00:00Z level=info job=j src=sh event=e\\n';
      fs.appendFileSync(${JSON.stringify(logPath)}, one.repeat(10)); // well over 100 bytes
      const before = fs.statSync(${JSON.stringify(logPath)}).size;
      const r = m.tail([${JSON.stringify(root)}]);
      console.log(JSON.stringify({ skipped: r.skipped, lines: r.lines.length, size: before }));
    });
  `;
  const { skipped, size } = JSON.parse(runChild(code)) as {
    skipped: number;
    lines: number;
    size: number;
  };
  assert.ok(skipped > 0);
  assert.equal(skipped, size - 100);
});

test("7. a file above LOG_MAX_BYTES is rotated after its content is read", () => {
  const root = freshRoot();
  const dbPath = freshDbPath();
  const logPath = join(root, "a.log");
  writeFileSync(logPath, "");
  const code = `
    process.env.LOG_MAX_BYTES = "50";
    process.env.LOG_DB = ${JSON.stringify(dbPath)};
    import('./kernel/runtime/log/tail.ts').then(m => {
      m.tail([${JSON.stringify(root)}]); // baseline at END=0
      const fs = require('node:fs');
      const one = 'ts=2026-01-01T00:00:00Z level=info job=j src=sh event=e\\n';
      fs.appendFileSync(${JSON.stringify(logPath)}, one.repeat(3)); // > 50 bytes
      const r = m.tail([${JSON.stringify(root)}]);
      console.log(JSON.stringify({
        lines: r.lines.length,
        rotated: r.rotated,
        liveSize: fs.statSync(${JSON.stringify(logPath)}).size,
        oldExists: fs.existsSync(${JSON.stringify(logPath)} + '.1'),
        oldSize: fs.statSync(${JSON.stringify(logPath)} + '.1').size,
      }));
    });
  `;
  const out = JSON.parse(runChild(code)) as {
    lines: number;
    rotated: string[];
    liveSize: number;
    oldExists: boolean;
    oldSize: number;
  };
  assert.equal(out.lines, 3); // every line was read before rotation moved it
  assert.ok(out.rotated.includes(logPath));
  assert.equal(out.liveSize, 0);
  assert.ok(out.oldExists);
  assert.ok(out.oldSize > 50);
});

test("8. non-ts= lines are skipped without error — a real file is two thirds agent stdout", () => {
  const root = freshRoot();
  const dbPath = freshDbPath();
  const logPath = join(root, "a.log");
  writeFileSync(logPath, "");
  withLogDb(dbPath, () => tail([root]));
  appendFileSync(logPath, "some agent stdout\n" + line("real") + "another stray line\n");
  const result = withLogDb(dbPath, () => tail([root]));
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0]!.event, "real");
  closeAll();
});

test("9. both roots are read; a root that does not exist is skipped silently", () => {
  const rootA = freshRoot();
  const rootB = join(BASE, `missing-${n++}`); // never created
  const dbPath = freshDbPath();
  writeFileSync(join(rootA, "a.log"), "");
  appendFileSync(join(rootA, "a.log"), line("from-a"));
  withLogDb(dbPath, () => tail([rootA, rootB])); // baseline
  appendFileSync(join(rootA, "a.log"), line("second"));
  const result = withLogDb(dbPath, () => tail([rootA, rootB]));
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0]!.event, "second");
  closeAll();
});

test("10. the cursor survives a closeAll() and a reopen: two tail() calls return disjoint lines", () => {
  const root = freshRoot();
  const dbPath = freshDbPath();
  const logPath = join(root, "a.log");
  writeFileSync(logPath, "");
  withLogDb(dbPath, () => tail([root])); // baseline
  closeAll();
  appendFileSync(logPath, line("after-close"));
  const result = withLogDb(dbPath, () => tail([root]));
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0]!.event, "after-close");
  closeAll();
});

test("11. logFiles returns only *.log, sorted", () => {
  const root = freshRoot();
  writeFileSync(join(root, "b.log"), "");
  writeFileSync(join(root, "a.log"), "");
  writeFileSync(join(root, "notes.txt"), "");
  const files = logFiles([root]);
  assert.deepEqual(files, [join(root, "a.log"), join(root, "b.log")]);
});
