// ops-retention (JOB-O06) against the REAL stores. leaseDb() and logDb() build the tables with
// their own migrations, the rows are written by the real lease API, and the registered job runs
// through the real buildContext. The plugin's own test builds its tables by hand (a plugin cannot
// reach kernel/runtime, TST-03), so a column renamed in a migration would pass there and fail here.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAll } from "../kernel/runtime/db.ts";
import { leaseDb, acquire, release, read as readLease } from "../kernel/runtime/lease.ts";
import { logDb } from "../kernel/runtime/log/tail.ts";
import { JOBS } from "./jobs/index.ts";
import { buildContext } from "./run.ts";

const DIR = mkdtempSync(join(tmpdir(), "ops-retention-host-"));

after(() => {
  closeAll();
  delete process.env.LEASE_DB;
  delete process.env.LOG_DB;
});

/** Claims `key` through the real API, settles it as `status` (or leaves it held), then backdates
 *  `updated_at` so the row is old. */
function seedLease(key: string, status: "done" | "failed" | "held", updatedAt: string): void {
  const got = acquire("job", key);
  assert.ok(got.ok, `seed: could not claim ${key}`);
  if (status !== "held") release(got.lease, status);
  leaseDb().handle().prepare("UPDATE lease_claim SET updated_at = ? WHERE scope = 'job' AND key = ?").run(updatedAt, key);
}

test("1. the registered job, run through buildContext, sweeps the real lease and log stores", async () => {
  process.env.LEASE_DB = join(DIR, "lease.db");
  process.env.LOG_DB = join(DIR, "log.db");

  seedLease("old-done@2026-01-01T00", "done", "2026-01-01T00:00:00Z");
  seedLease("old-failed@2026-01-01T00", "failed", "2026-01-01T00:00:00Z");
  seedLease("old-held@2026-01-01T00", "held", "2026-01-01T00:00:00Z");
  seedLease("new-done@2026-09-24T03", "done", new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));

  const live = join(DIR, "live.log");
  writeFileSync(live, "");
  const gone = join(DIR, "renamed-job.log");
  const put = logDb().handle().prepare("INSERT INTO logtail_cursor (path, inode, offset, updated_at) VALUES (?, ?, ?, ?)");
  put.run(live, "1", 0, "2026-01-01T00:00:00Z");
  put.run(gone, "2", 0, "2026-09-24T00:00:00Z");

  const job = JOBS.find((j) => j.name === "ops-retention");
  assert.ok(job?.exec, "ops-retention is registered with an exec");
  await job.exec(buildContext(job));

  assert.equal(readLease("job", "old-done@2026-01-01T00"), null, "an old done lease is deleted");
  assert.equal(readLease("job", "old-failed@2026-01-01T00"), null, "an old failed lease is deleted");
  assert.ok(readLease("job", "old-held@2026-01-01T00"), "a held lease is never deleted, at any age");
  assert.ok(readLease("job", "new-done@2026-09-24T03"), "a recent done lease is kept");

  const cursors = (logDb().handle().prepare("SELECT path FROM logtail_cursor ORDER BY path").all() as { path: string }[]).map((r) => r.path);
  assert.deepEqual(cursors, [live], "only the cursor whose file is gone is deleted, whatever its age");
});
