// nightly-polish's rotation state over the REAL store (JOB-C14, INV-1). The job file sits under
// plugins/ and cannot import kernel/runtime/db.ts, so this half of its test lives here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../kernel/runtime/db.ts";
import { readState, writeState, type PolishDb } from "../plugins/nightly/jobs/nightly-polish.ts";

const DIR = mkdtempSync(join(tmpdir(), "nightly-polish-state-"));

test("a fresh store reads index 0 and no recent files; a write reads back", () => {
  // The annotation is the check: the real Db must fit the slice the job declares.
  const db: PolishDb = openDb(join(DIR, "fresh.db"));
  assert.deepEqual(readState(db), { index: 0, recent: [] });
  writeState(db, { index: 3, recent: ["README.md", "CLAUDE.md"] });
  assert.deepEqual(readState(db), { index: 3, recent: ["README.md", "CLAUDE.md"] });
  writeState(db, { index: 0, recent: [] });
  assert.deepEqual(readState(db), { index: 0, recent: [] });
});

test("the polish namespace does not collide with nightly-sandcastle's in the same nightly.db", () => {
  // Migrations are versioned per namespace. Had polish reused "nightly", sandcastle's step 1
  // would read as polish's step 1 already applied, and its table would never be created.
  const db = openDb(join(DIR, "shared.db"));
  db.migrate("nightly", [
    "CREATE TABLE nightly_rotation (id INTEGER PRIMARY KEY CHECK (id = 1), goal_index INTEGER NOT NULL, recent TEXT NOT NULL)",
  ]);
  writeState(db, { index: 2, recent: ["docs.md"] });
  assert.deepEqual(readState(db), { index: 2, recent: ["docs.md"] });
  const tables = (db.handle().prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );
  assert.deepEqual(tables, ["nightly_meta", "nightly_polish_meta", "nightly_polish_rotation", "nightly_rotation"]);
});
