// the Node capability gate.
//
// This file is also the proof that type stripping works: it is a .ts file with type
// annotations, run directly by `node --test`. If stripping were off, the suite would
// not even start.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// Minimal semver check. This repo names Node floors only as ">=x.y.z" — nothing else.
// Do not reach for the `semver` package: this is ~15 lines, not a dependency.
function satisfiesFloor(version: string, range: string): boolean {
  const match = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!match) {
    throw new Error(`satisfiesFloor only understands ">=x.y.z", got: ${range}`);
  }
  const [, floorMajor, floorMinor, floorPatch] = match.map(Number) as unknown as [
    number,
    number,
    number,
    number,
  ];
  const [major, minor, patch] = version.split(".").map(Number);
  if (major !== floorMajor) return major > floorMajor;
  if (minor !== floorMinor) return minor > floorMinor;
  return patch >= floorPatch;
}

test("node:sqlite resolves and runs a CREATE TABLE", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  db.close();
});

test("the running Node satisfies engines.node from package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const running = process.versions.node;
  assert.ok(
    satisfiesFloor(running, pkg.engines.node),
    `running Node ${running} does not satisfy engines.node ${pkg.engines.node} (package.json)`,
  );
});

test(".nvmrc's version also satisfies engines.node — the two pins may never disagree", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const nvmrc = readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim();
  assert.ok(
    satisfiesFloor(nvmrc, pkg.engines.node),
    `.nvmrc ${nvmrc} does not satisfy engines.node ${pkg.engines.node} (package.json)`,
  );
});
