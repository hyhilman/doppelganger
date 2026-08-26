// J4.7 (LSE-10) — list a scope, delete a key, force a held claim.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAll } from "../kernel/runtime/db.ts";
import { acquire, release, read } from "../kernel/runtime/lease.ts";
import { run } from "./lease-clear.ts";

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "lease-clear-test-"));
  process.env.LEASE_DB = join(dir, "lease.db");
});

after(() => {
  closeAll();
  delete process.env.LEASE_DB;
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function fresh(): { scope: string; key: string } {
  counter++;
  return { scope: `clear-scope-${counter}`, key: `k${counter}` };
}

test("1. bare argv → usage on stderr, code 1, nothing written", () => {
  const r = run([], { dryRun: false });
  assert.equal(r.code, 1);
  assert.match(r.err, /usage:/);
  assert.equal(r.out, "");
});

test("2. <scope> alone → every claim on stdout, one line each; the count on stderr; code 0", () => {
  const { scope, key } = fresh();
  const got = acquire(scope, key);
  assert.equal(got.ok, true);

  const r = run([scope], { dryRun: false });
  assert.equal(r.code, 0);
  assert.match(r.out, new RegExp(`^held attempts=1 updated=.+ ${key}\\n$`));
  assert.equal(r.err, `1 claim(s) in scope \`${scope}\`\n`);
});

test("3. <scope> with no claims → 0 claim(s), code 0, stdout empty", () => {
  const { scope } = fresh();
  const r = run([scope], { dryRun: false });
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
  assert.equal(r.err, `0 claim(s) in scope \`${scope}\`\n`);
});

test("4. a done claim is deleted without --force; a following acquire on that key succeeds", () => {
  const { scope, key } = fresh();
  const got = acquire(scope, key);
  assert.equal(got.ok, true);
  if (!got.ok) return;
  release(got.lease, "done");

  const r = run([scope, key], { dryRun: false });
  assert.equal(r.code, 0);
  assert.equal(r.err, `deleted ${scope}/${key}\n`);

  // The only retry path a terminal lease has.
  const reacquire = acquire(scope, key);
  assert.equal(reacquire.ok, true);
});

test("5. a held claim without --force → code 1, stderr names the owner and expires, the row survives", () => {
  const { scope, key } = fresh();
  const got = acquire(scope, key);
  assert.equal(got.ok, true);
  if (!got.ok) return;

  const r = run([scope, key], { dryRun: false });
  assert.equal(r.code, 1);
  assert.match(r.err, /refused:/);
  assert.match(r.err, new RegExp(got.lease.owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(r.err, new RegExp(got.lease.expiresAt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(read(scope, key)?.status, "held");
});

test("6. the same held claim with --force → code 0, the row is gone", () => {
  const { scope, key } = fresh();
  const got = acquire(scope, key);
  assert.equal(got.ok, true);

  const r = run([scope, key, "--force"], { dryRun: false });
  assert.equal(r.code, 0);
  assert.equal(read(scope, key), null);
});

test("7. an absent key → code 0, nothing to clear, and running it again gives byte-identical output", () => {
  const { scope, key } = fresh();
  const r1 = run([scope, key], { dryRun: false });
  assert.equal(r1.code, 0);
  assert.equal(r1.err, `no claim ${scope}/${key} — nothing to clear\n`);
  const r2 = run([scope, key], { dryRun: false });
  assert.deepEqual(r2, r1);
});

test("8. LEASE_CLEAR_DRY_RUN over a held claim with --force → prints the deletion, deletes nothing", () => {
  const { scope, key } = fresh();
  const got = acquire(scope, key);
  assert.equal(got.ok, true);

  const r = run([scope, key, "--force"], { dryRun: true });
  assert.equal(r.code, 0);
  assert.match(r.err, /dry run: would delete/);
  assert.equal(read(scope, key)?.status, "held", "dry run must delete nothing");
});

test("9. the five-field owner is printed whole in the held refusal", () => {
  const { scope, key } = fresh();
  const got = acquire(scope, key);
  assert.equal(got.ok, true);
  if (!got.ok) return;

  const r = run([scope, key], { dryRun: false });
  assert.match(r.err, new RegExp(got.lease.owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const parts = got.lease.owner.split(":");
  assert.equal(parts.length, 5, "INS-04's own shape — an operator can copy this into parseOwner's vocabulary");
});
