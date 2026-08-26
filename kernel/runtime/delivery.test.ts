// J4.13 (JOB-O11, SUP-14) — deliveryStamp's own contract, and DELIVERY_STAMPS as a checked
// register.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { ROOT, projectPath } from "../paths.ts";
import { deliveryStamp, DELIVERY_STAMPS, stampPath } from "./delivery.ts";

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), "delivery-")), "x.fail");
}

test("1. (false, detail) creates the file — first line is nowIso()'s own shape, then the detail", () => {
  const p = tmpPath();
  const stamp = deliveryStamp(p);
  stamp(false, "boom");
  assert.ok(existsSync(p));
  const line = readFileSync(p, "utf8").split("\n")[0]!;
  assert.match(line, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ boom$/);
});

test("2. (true) removes it, and (true) again on an absent file is a no-op, not a throw", () => {
  const p = tmpPath();
  const stamp = deliveryStamp(p);
  stamp(false, "boom");
  assert.ok(existsSync(p));
  stamp(true);
  assert.ok(!existsSync(p));
  assert.doesNotThrow(() => stamp(true));
  assert.ok(!existsSync(p));
});

test("3. (false) with no detail writes unknown", () => {
  const p = tmpPath();
  const stamp = deliveryStamp(p);
  stamp(false);
  const line = readFileSync(p, "utf8").split("\n")[0]!;
  assert.match(line, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ unknown$/);
});

test("4. a path that cannot be written swallows the error — no throw, no file", () => {
  const fileNotDir = join(mkdtempSync(join(tmpdir(), "delivery-")), "not-a-dir");
  writeFileSync(fileNotDir, "x");
  const p = join(fileNotDir, "x.fail"); // ENOTDIR — a parent segment is a plain file
  const stamp = deliveryStamp(p);
  assert.doesNotThrow(() => stamp(false, "boom"));
  assert.ok(!existsSync(p));
});

test("5. DELIVERY_STAMPS paths are ROOT-relative, never absolute, and every row's fields are non-empty", () => {
  for (const row of DELIVERY_STAMPS) {
    assert.ok(!isAbsolute(row.path), `${row.name}: path ${JSON.stringify(row.path)} must be ROOT-relative, not absolute`);
    assert.ok(row.name.length > 0, `${row.name || "(unnamed)"}: name must be non-empty`);
    assert.ok(row.path.length > 0, `${row.name}: path must be non-empty`);
    assert.ok(row.writer.length > 0, `${row.name}: writer must be non-empty`);
    assert.ok(row.why.length > 0, `${row.name}: why must be non-empty`);
  }
});

test("6. every row's path resolves inside ROOT", () => {
  for (const row of DELIVERY_STAMPS) {
    assert.doesNotThrow(
      () => projectPath(row.path),
      `${row.name}: path ${JSON.stringify(row.path)} must resolve inside ROOT (INS-02)`,
    );
    assert.ok(stampPath(row).startsWith(ROOT), `${row.name}: resolved path must start with ROOT`);
  }
});
