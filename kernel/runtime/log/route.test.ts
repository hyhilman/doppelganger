// J1.10 (LOG-04) — routing is a property of the level, not the caller.

import { test } from "node:test";
import assert from "node:assert/strict";
import { routeOf, summarise } from "./route.ts";
import type { LogLine } from "./parse.ts";
import type { Level } from "./emit.ts";

function line(level: Level, job: string, event: string): LogLine {
  return { ts: "t", level, job, src: "ts", event, msg: "", fields: {}, raw: "" };
}

test("1. routeOf over all four levels", () => {
  assert.equal(routeOf("error"), "report");
  assert.equal(routeOf("warn"), "count");
  assert.equal(routeOf("info"), "file");
  assert.equal(routeOf("debug"), "file");
});

test("2. summarise([]) reports nothing", () => {
  const s = summarise([]);
  assert.equal(s.faults.size, 0);
  assert.equal(s.warns, 0);
  assert.equal(s.report, false);
});

test("3. two errors with the same job/event batch to one key with count 2", () => {
  const s = summarise([line("error", "j", "e"), line("error", "j", "e")]);
  assert.equal(s.faults.size, 1);
  assert.equal(s.faults.get("j/e"), 2);
});

test("4. two errors with different events are two keys", () => {
  const s = summarise([line("error", "j", "e1"), line("error", "j", "e2")]);
  assert.equal(s.faults.size, 2);
  assert.equal(s.faults.get("j/e1"), 1);
  assert.equal(s.faults.get("j/e2"), 1);
});

test("5. warns alone produce report:false and warns:0", () => {
  const s = summarise([line("warn", "j", "e"), line("warn", "j", "e")]);
  assert.equal(s.report, false);
  assert.equal(s.warns, 0);
});

test("6. warns alongside an error produce the bare count", () => {
  const s = summarise([line("warn", "j", "e1"), line("warn", "j", "e1"), line("error", "j", "e2")]);
  assert.equal(s.report, true);
  assert.equal(s.warns, 2);
  assert.equal(s.faults.get("j/e2"), 1);
});

test("7. info and debug never reach the summary, whatever their msg says", () => {
  const s = summarise([line("info", "j", "e"), line("debug", "j", "e")]);
  assert.equal(s.faults.size, 0);
  assert.equal(s.warns, 0);
  assert.equal(s.report, false);
});
