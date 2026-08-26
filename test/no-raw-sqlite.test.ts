// J1.6 (DBS-06) — nobody can reach the driver.
//
// The set of files under the repo (outside node_modules/, .git/) that import "node:sqlite" must
// equal this four-entry allowlist, each with its own reason. A new module importing the driver
// directly goes red here — it means a write path exists that `instrument`'s busy-context proxy
// cannot see.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const ALLOWED: Record<string, string> = {
  "kernel/runtime/db.ts": "the ONE module that opens node:sqlite and wraps it (DBS-01, DBS-06)",
  "kernel/runtime/db.test.ts": "needs a raw, unwrapped, contending second connection",
  "kernel/runtime/db-sharing.test.ts": "TST-20's trap-2 fixture holds a lock from a SEPARATE process",
  "test/node.test.ts": "N0's capability probe — proves type stripping runs at all",
  "kernel/runtime/quota.test.ts": "QUOTA_FIXTURE_RECHECK's opt-in read of the reference's own quota.db, read-only, never run by default (J4.8)",
};

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (dir === ROOT && (entry === "node_modules" || entry === ".git")) continue;
    // R2 (INS-02) — a pass worktree under .doppelganger/worktrees/ is a second full
    // checkout (its own node_modules, package.json, *.ts files) and is not this repo's source.
    if (dir === join(ROOT, ".doppelganger") && entry === "worktrees") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") || entry.endsWith(".sh")) out.push(full);
  }
}

test("node:sqlite is imported by exactly the allowlisted files", () => {
  const files: string[] = [];
  walk(ROOT, files);

  // Match an actual import/require of the module, never mere prose mentioning it — this file's own
  // comments say `"node:sqlite"` in quotes, which a bare substring search would catch on itself.
  // Covers the static form, `require(...)`, and a dynamic import — static or `await`-ed — of the
  // module: that last form reaches the driver just as directly and must not walk around the
  // allowlist. (Written here as "dynamic import(…of the module…)" rather than the literal call, or
  // this very sentence would match its own pattern.)
  const IMPORTS_SQLITE =
    /from\s+["']node:sqlite["']|require\(\s*["']node:sqlite["']\s*\)|import\(\s*["']node:sqlite["']\s*\)/;
  const importers = files
    .filter((f) => IMPORTS_SQLITE.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length + 1))
    .sort();

  const allowed = Object.keys(ALLOWED).sort();
  assert.deepEqual(
    importers,
    allowed,
    `node:sqlite importers drifted from the allowlist.\n  found: ${importers.join(", ")}\n  allowed: ${allowed.join(", ")}`,
  );
});
