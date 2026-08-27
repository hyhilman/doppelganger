// pool.ts: bounded concurrency and the spawn stagger.
//
// Timing assertions are LOWER bounds only — a loaded host makes a wait longer, never shorter — with
// two deliberate exceptions (assertion 6's first-spawn check), named as such rather than hidden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pool, spawnSlot } from "./pool.ts";

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((r) => setTimeout(() => r(value), ms));
}

test("1. peak concurrency never exceeds limit, whatever the completion order", async () => {
  let active = 0;
  let peak = 0;
  const items = [40, 5, 30, 5, 20, 5, 10, 5];
  await pool(items, 3, async (ms) => {
    active++;
    peak = Math.max(peak, active);
    await delay(ms, undefined);
    active--;
    return ms;
  });
  assert.ok(peak <= 3, `peak was ${peak}`);
  assert.ok(peak > 0);
});

test("2. results are indexed, not appended: a slow item 0 still lands at index 0", async () => {
  const items = [30, 5, 5];
  const out = await pool(items, 3, async (ms, i) => {
    await delay(ms, undefined);
    return i;
  });
  assert.deepEqual(out, [0, 1, 2]);
});

test("3. a worker frees the moment its item lands: the fast lane drains the tail while item 0 runs", async () => {
  const order: number[] = [];
  const items = [50, 5, 5, 5];
  await pool(items, 2, async (ms, i) => {
    await delay(ms, undefined);
    order.push(i);
  });
  // item 0 is the slowest by far; every other item must finish before it.
  assert.equal(order[order.length - 1], 0);
  assert.deepEqual(new Set(order.slice(0, 3)), new Set([1, 2, 3]));
});

test("4. more workers than items runs each item exactly once and leaves no slot unwritten", async () => {
  const items = ["a", "b", "c"];
  const calls: string[] = [];
  const out = await pool(items, 10, async (item) => {
    calls.push(item);
    return item.toUpperCase();
  });
  assert.deepEqual(calls.sort(), ["a", "b", "c"]);
  assert.deepEqual(out, ["A", "B", "C"]);
});

test("5. limit of 0 is floored to 1 and the work still happens", async () => {
  const items = [1, 2, 3];
  const out = await pool(items, 0, async (n) => n * 2);
  assert.deepEqual(out, [2, 4, 6]);
});

test("6. spawnSlot lets the first spawn start at once, and holds each one after it a stagger apart", async () => {
  const STAGGER = 50;
  const start = Date.now();
  await spawnSlot(STAGGER);
  const t0 = Date.now() - start;
  await spawnSlot(STAGGER);
  const t1 = Date.now() - start;
  await spawnSlot(STAGGER);
  const t2 = Date.now() - start;

  // Exception, named: the first spawn resolving an EMPTY chain pays no stagger — a shape check
  // with headroom, not a race (measured near-0 on every run).
  assert.ok(t0 < STAGGER, `first spawn waited ${t0}ms, expected < ${STAGGER}ms`);
  assert.ok(t1 >= STAGGER - 5, `second spawn only waited ${t1}ms`);
  assert.ok(t2 >= STAGGER * 2 - 5, `third spawn only waited ${t2}ms`);
});

test("7. a spawn arriving after the chain has drained starts immediately", async () => {
  // A third, unadmitted upper bound: the plan's exceptions table names only two (db 19,
  // pool assertion 6). This one had 20ms of headroom on a 60ms drain, the tightest in the suite,
  // and would flake on a loaded CI box running 26 test files in parallel. Raised in the same ratio
  // as assertion 6's STAGGER/headroom (50ms), with the drain scaled up to match.
  const STAGGER = 50;
  await spawnSlot(STAGGER);
  await delay(150, undefined); // let the chain fully resolve and go quiet
  const start = Date.now();
  await spawnSlot(STAGGER);
  const waited = Date.now() - start;
  assert.ok(waited < STAGGER, `expected an immediate start, waited ${waited}ms`);
});
