// JOB-G13 — the protected-branch set and its three readers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROTECTED_BRANCHES, branchAllowed, protectedList, protectedHits } from "./branches.ts";

const hits = (reported: string): string[] => protectedHits(reported.split(","));

test("1. JOB-G13: the set names at least the five long-lived branches", () => {
  assert.ok(PROTECTED_BRANCHES.length >= 5);
  for (const b of ["main", "master", "development", "staging", "dev"]) {
    assert.ok((PROTECTED_BRANCHES as readonly string[]).includes(b), b);
  }
});

test("2. JOB-G13: each protected name is a hit on its own, and is refused by branchAllowed", () => {
  for (const b of PROTECTED_BRANCHES) {
    assert.deepEqual(protectedHits([b]), [b]);
    assert.equal(branchAllowed(b), false, b);
  }
});

test("3. JOB-G13: entries are trimmed before they are judged", () => {
  assert.deepEqual(hits("XEN-1-fix, staging"), ["staging"]);
  assert.deepEqual(protectedHits([" main "]), ["main"]);
  assert.equal(branchAllowed(" main "), false);
});

test("4. JOB-G13: every hit is reported, not only the first", () => {
  assert.deepEqual(hits("main, XEN-2, development"), ["main", "development"]);
});

test("5. JOB-G13: a normal branch is no hit and is allowed", () => {
  for (const b of ["XEN-1-fix", "feature/main-menu", "mainline", "devops", "staging2"]) {
    assert.deepEqual(protectedHits([b]), [], b);
    assert.equal(branchAllowed(b), true, b);
  }
});

test("6. JOB-G13: a blank name is silence for protectedHits but a refusal for branchAllowed", () => {
  assert.deepEqual(protectedHits(["", "  "]), []);
  assert.deepEqual(hits("dev,"), ["dev"]);
  assert.equal(branchAllowed(""), false);
  assert.equal(branchAllowed("   "), false);
});

test("7. JOB-G13: protectedList names every member, backticked, and nothing else", () => {
  const listed = protectedList().split(", ");
  assert.deepEqual(listed, PROTECTED_BRANCHES.map((b) => `\`${b}\``));
});
