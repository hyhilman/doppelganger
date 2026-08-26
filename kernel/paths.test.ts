// J1.4 (DBS-07, INS-02) — ROOT, projectPath, dbPath.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ROOT, STATE_DIR, projectPath, dbPath } from "./paths.ts";

const REPO_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

function run(code: string, env: Record<string, string>): string {
  return execFileSync(process.execPath, ["-e", code], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  }).trim();
}

test("1. projectPath('a','b') starts with ROOT and ends '/a/b'", () => {
  const p = projectPath("a", "b");
  assert.ok(p.startsWith(ROOT));
  assert.ok(p.endsWith("/a/b"));
});

test("2. projectPath('../escape') throws naming INS-02", () => {
  assert.throws(() => projectPath("../escape"), /INS-02/);
});

test("3. projectPath() with no segments returns ROOT", () => {
  assert.equal(projectPath(), ROOT);
});

test("4. dbPath('lease') with no override is inside STATE_DIR and inside ROOT", () => {
  const p = dbPath("lease");
  assert.ok(p.startsWith(STATE_DIR));
  assert.ok(p.startsWith(ROOT));
});

test("5. LEASE_DB overrides dbPath('lease') — read in a child process", () => {
  const out = run(
    "import('./kernel/paths.ts').then(m => console.log(m.dbPath('lease')))",
    { LEASE_DB: "/tmp/x.db" },
  );
  assert.equal(out, "/tmp/x.db");
});

test("6. ENGINE_ROOT moves ROOT, STATE_DIR and dbPath together — one anchor, not three", () => {
  const out = run(
    "import('./kernel/paths.ts').then(m => console.log(JSON.stringify([m.ROOT, m.STATE_DIR, m.dbPath('lease')])))",
    { ENGINE_ROOT: "/tmp/fake-root" },
  );
  const [root, stateDir, lease] = JSON.parse(out) as [string, string, string];
  assert.equal(root, "/tmp/fake-root");
  assert.ok(stateDir.startsWith("/tmp/fake-root"));
  assert.ok(lease.startsWith("/tmp/fake-root"));
});
