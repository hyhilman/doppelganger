// J1.17 (TST-20, DBS-01) — the two shared-database traps that are real at N1, pinned as behaviour,
// plus the static discipline gate. See CLAUDE.md's Working rules for the rule this file gates.
//
// Assertion 5 from the first draft ("process.ppid !== process.pid") was deleted — it is true in
// every process that has ever run, a tautology wearing a gate's clothes. Assertions 3 and 4 already
// prove the whole of trap 2 by EFFECT: the file outlives the process, and a lock held across
// processes surfaces as DBS-04's message.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, closeAll } from "./db.ts";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

test("1. trap 1, proved: openDb(p) === openDb(p), and the second caller sees the first's migration", () => {
  const dir = mkdtempSync(join(tmpdir(), "dg-share-"));
  const p = join(dir, "a.db");
  const db1 = openDb(p);
  db1.migrate("app", ["CREATE TABLE app_x (id INTEGER)"]);
  const db2 = openDb(p);
  assert.equal(db1, db2);
  assert.equal(db2.metaGet("app", "schema_version"), "1");
  closeAll();
});

test("2. trap 1, the escape: two different paths are independent handles with independent versions", () => {
  const dir = mkdtempSync(join(tmpdir(), "dg-share-"));
  const p1 = join(dir, "a.db");
  const p2 = join(dir, "b.db");
  const db1 = openDb(p1);
  db1.migrate("app", ["CREATE TABLE app_x (id INTEGER)"]);
  const db2 = openDb(p2);
  assert.notEqual(db1, db2);
  db2.migrate("app", []); // creates app_meta with no schema_version, since the row shares no state
  assert.equal(db2.metaGet("app", "schema_version"), null);
  closeAll();
});

test("3. trap 2, proved: a child process writes a row and exits; the file outlives the process", () => {
  const dir = mkdtempSync(join(tmpdir(), "dg-share-"));
  const p = join(dir, "a.db");
  const code = `
    import('./kernel/runtime/db.ts').then(m => {
      const db = m.openDb(${JSON.stringify(p)});
      db.migrate("app", ["CREATE TABLE app_x (id INTEGER)"]);
      db.handle().prepare("INSERT INTO app_x (id) VALUES (1)").run();
      db.close();
    });
  `;
  execFileSync(process.execPath, ["-e", code], { cwd: ROOT });

  const db = openDb(p);
  const rows = db.handle().prepare("SELECT * FROM app_x").all();
  assert.equal(rows.length, 1);
  closeAll();
});

test("4. trap 2, the sharp end: a lock held across processes surfaces as DBS-04's message", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dg-share-"));
  const p = join(dir, "a.db");

  const seed = openDb(p);
  seed.handle().exec("CREATE TABLE app_y (id INTEGER)");
  seed.close();
  closeAll();

  const childCode = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(p)});
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO app_y (id) VALUES (1)').run();
    process.stdout.write('ready\\n');
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ["-e", childCode], { cwd: ROOT });

  try {
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("child never printed ready")), 5000);
      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        if (buf.includes("ready")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("error", reject);
    });

    const db = openDb(p);
    db.handle().exec("PRAGMA busy_timeout = 100"); // keep this test fast
    assert.throws(
      () => db.handle().prepare("INSERT INTO app_y (id) VALUES (2)").run(),
      (e: unknown) => {
        const msg = (e as Error).message;
        // The point of this assertion is the message: it names the file and the statement, which
        // is exactly what makes the test-LAYOUT fault diagnosable rather than mysterious.
        return msg.includes(p) && msg.includes("INSERT INTO app_y") && /waited=\d+ms/.test(msg);
      },
    );
    closeAll();
  } finally {
    child.kill("SIGKILL");
  }
});

test("6. the discipline gate: every openDb( caller uses mkdtempSync, never a bare literal or projectPath", () => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(ROOT);

  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!src.includes("openDb(")) continue;
    assert.ok(src.includes("mkdtempSync("), `${f} calls openDb( without mkdtempSync( anywhere in the file`);

    const callRe = /openDb\(\s*(["'`])((?:(?!\1).)*)\1/g;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(src)) != null) {
      const literal = m[2]!;
      assert.ok(
        !literal.startsWith(".") && !literal.startsWith("/"),
        `${f}: openDb() called with a path literal ${JSON.stringify(literal)}`,
      );
    }
    assert.ok(
      !/openDb\(\s*projectPath\(/.test(src),
      `${f}: openDb() called directly with projectPath(...) — that is real state, not a throwaway`,
    );
  }
});
