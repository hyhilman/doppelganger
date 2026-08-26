// J1.3 (INS-01) — resolveInstance and the validated INSTANCE name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInstance, INSTANCE } from "./instance.ts";

test("1. env wins over the directory basename", () => {
  assert.equal(resolveInstance("nonprod", "/a/b/doppelganger"), "nonprod");
});

test("2. undefined falls back to the basename of root", () => {
  assert.equal(resolveInstance(undefined, "/a/b/doppelganger"), "doppelganger");
});

test("3. whitespace-only is treated as unset", () => {
  assert.equal(resolveInstance("  ", "/a/b/doppelganger"), "doppelganger");
});

test("4. accepts bare identifiers up to 64 characters", () => {
  for (const ok of ["a", "doppelganger", "nonprod", "x-1_2", "a".repeat(64)]) {
    assert.equal(resolveInstance(ok, "/a/b/root"), ok);
  }
});

test("5. rejects everything else, each message naming INS-01", () => {
  // Root's OWN basename ("My Project") is also not a bare identifier, so an empty/whitespace-only
  // `raw` — which falls back to the basename — rejects for the same reason as an explicit bad value,
  // rather than silently passing through the "unset" branch untested.
  const root = "/home/u/My Project";
  for (const bad of ["", "My-App", "1st", "a b", "a:b", "a/b", ".", "..", "-lead", "a".repeat(65)]) {
    assert.throws(
      () => resolveInstance(bad, root),
      (e: unknown) => (e as Error).message.includes("INS-01"),
      `expected resolveInstance(${JSON.stringify(bad)}, ...) to throw naming INS-01`,
    );
  }
});

test("6. this checkout's INSTANCE is a bare identifier (property, not a pinned value)", () => {
  assert.match(INSTANCE, /^[a-z][a-z0-9_-]{0,63}$/);
});
