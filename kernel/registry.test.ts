// KRN-01/02/03 — kernel/registry.ts's own tests.
//
// The duplicate-name test used to live in host/jobs/index.test.ts as a hand-rolled
// `assertNoDuplicateNames`. KRN-03 collapses that check onto this file's `registry()`, so its
// test moves here too (test 2) — this is where the behaviour now lives; host/jobs/index.test.ts
// tests only that JOBS still lists the right jobs in the right order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registry, type Named } from "./registry.ts";

interface Item extends Named {
  readonly name: string;
}

test("1. register/get/tryGet/has round-trip a registered item", () => {
  const r = registry<Item>("thing");
  const a: Item = { name: "a" };
  assert.strictEqual(r.register(a), a, "register returns the item it was given");
  assert.strictEqual(r.get("a"), a);
  assert.strictEqual(r.tryGet("a"), a);
  assert.equal(r.has("a"), true);
  assert.equal(r.has("nope"), false);
  assert.equal(r.tryGet("nope"), undefined, "tryGet is the one lookup shape allowed to come back empty");
});

test("2. register throws on a duplicate name, naming the registry's kind and the name (KRN-01)", () => {
  const r = registry<Item>("job");
  r.register({ name: "dup" });
  assert.throws(() => r.register({ name: "dup" }), /registry\("job"\): duplicate job name "dup"/);
});

test("3. get NEVER returns undefined (KRN-02) — a miss throws, naming the miss and every registered name", () => {
  const r = registry<Item>("thing");
  r.register({ name: "a" });
  r.register({ name: "b" });
  assert.throws(() => r.get("nope"), /registry\("thing"\): no thing named "nope" — known thing names: a, b/);
});

test("4. get on an empty registry says so rather than listing nothing", () => {
  const r = registry<Item>("thing");
  assert.throws(() => r.get("nope"), /\(none registered\)/);
});

test("5. all() and names() are registration order, and the order is stable across repeated calls", () => {
  // Deliberately NOT alphabetical (c, a, b) — a registry that quietly sorted by name would pass a
  // same-order-as-alphabetical fixture by accident. This one only passes if REGISTRATION order,
  // not name order, is what all()/names() return.
  const r = registry<Item>("thing");
  const c: Item = { name: "c" };
  const a: Item = { name: "a" };
  const b: Item = { name: "b" };
  r.register(c);
  r.register(a);
  r.register(b);
  assert.deepEqual(r.names(), ["c", "a", "b"]);
  assert.deepEqual(r.all(), [c, a, b]);
  // Called again — not incidental. A registry that recomputed order from a Map's iteration would
  // still be stable in V8 today, but that is a Map implementation detail, not this file's
  // contract; this asserts the CONTRACT (registration order), calling twice to rule out a
  // sneaky "order changes after the first read" implementation.
  assert.deepEqual(r.names(), ["c", "a", "b"]);
  assert.deepEqual(r.all(), [c, a, b]);
});

test("6. all() returns a fresh array each call — mutating what it returned cannot mutate the registry", () => {
  const r = registry<Item>("thing");
  r.register({ name: "a" });
  const first = r.all() as Item[];
  first.push({ name: "intruder" });
  assert.deepEqual(r.names(), ["a"]);
});

test("7. KRN-01 — duplicate-throws AT IMPORT TIME: kernel/registry.dup.fixture.ts registers the same name twice at module top level, so importing it (not calling anything in it) rejects", async () => {
  await assert.rejects(
    () => import("./registry.dup.fixture.ts"),
    /registry\("fixture"\): duplicate fixture name "dup"/,
  );
});

test("8. KRN-02 is a property of this file: kernel/registry.ts names no filesystem read and no dynamic import at all — a directory scan is what makes 'missing' and 'broken' identical", () => {
  const src = readFileSync(fileURLToPath(new URL("./registry.ts", import.meta.url)), "utf8");
  assert.ok(!/from\s+["']node:fs["']/.test(src), "kernel/registry.ts must not import node:fs");
  assert.ok(
    !/\breaddirSync\b|\breadFileSync\b|\bexistsSync\b|\bstatSync\b/.test(src),
    "kernel/registry.ts must not name a filesystem read",
  );
  assert.ok(!/\bimport\s*\(/.test(src), "kernel/registry.ts must not perform a dynamic import");

  // The three clauses above scan THIS FILE'S TEXT ONLY, so on their own they are foolable one hop
  // away: measured 2026-09-01, giving registry.ts a real directory scan through an already-existing
  // kernel module kept all three green and the whole suite green. A smarter text scan is not the
  // answer — this is. registry.ts imports NOTHING, so there is no module it can reach a filesystem
  // read through, and with no dynamic import either there is no late edge to add one. Comments are
  // stripped first so the check reads code, not prose (clauses 1-3 do not strip, which is why
  // wording a header around `readdirSync` or a quoted specifier turns them red on prose alone).
  // A type-only import trips this too, deliberately: this is a leaf primitive, and a new edge out
  // of it is worth an argument rather than a silent pass.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/\bimport\b|\bfrom\s+["']/.test(code),
    "kernel/registry.ts must import nothing at all — a filesystem read reached through a helper defeats a scan of this file's text",
  );
});
