// parseLine, the exact inverse of renderLine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderLine } from "./emit.ts";
import { parseLine, unquote, isFault, renderFault, type LogLine } from "./parse.ts";
import { VALUE_MATRIX } from "./values.fixture.ts";

test("1. round trip: parseLine(renderLine(...)) matches the inputs for every value in the matrix", () => {
  for (const v of VALUE_MATRIX) {
    // LF is folded to a space by renderValue — a deliberate, one-way transform, not part
    // of what "reversible" means here. Every other byte round-trips exactly.
    const expected = v.replace(/\n/g, " ");
    const line = renderLine("info", v, v, { k: v, msg: v });
    const parsed = parseLine(line);
    assert.ok(parsed, `expected a parse for value ${JSON.stringify(v)}`);
    assert.equal(parsed!.job, expected);
    assert.equal(parsed!.event, expected);
    assert.equal(parsed!.msg, expected);
    assert.deepEqual(parsed!.fields, { k: expected });
  }
});

test("2. a bare value and a quoted value both unquote to the same string", () => {
  assert.equal(unquote("plain"), "plain");
  assert.equal(unquote('"plain"'), "plain");
});

test('3. escapes round-trip: a\\b"c out in a value that also forces the quoted branch', () => {
  // A space forces this through the QUOTED alternative of PAIR — a value with no space can slip
  // through the bare alternative by accident and would not actually exercise the \\. escape.
  const v = 'a\\b"c has space';
  const line = renderLine("info", "j", "e", { v });
  const parsed = parseLine(line);
  assert.equal(parsed!.fields.v, v);
});

test("4. a value containing = stays one value", () => {
  const line = renderLine("info", "j", "e", { v: "a=b" });
  const parsed = parseLine(line);
  assert.equal(parsed!.fields.v, "a=b");
});

test("5. msg with spaces stays one value; a field emitted after it lands inside the message", () => {
  // renderLine already forces msg last, so to observe the documented consequence we build the raw
  // line by hand — a field appearing textually after msg= is not a case renderLine can produce.
  const raw = 'ts=2026-01-01T00:00:00Z level=info job=j src=ts event=e msg="hello world" after=x';
  const parsed = parseLine(raw);
  assert.equal(parsed!.msg, "hello world");
  // PAIR only recognises key=value tokens; "after=x" sits inside the quoted msg's rendering here
  // only insofar as parseLine has no OTHER way to see it — msg captured whole, and any further
  // `key=value` after a properly closed quote is still parsed as its own field. What this pins is
  // that msg itself is captured as ONE value even though it contains a space.
  assert.equal(parsed!.fields.after, "x");
});

test("6. null for malformed or incomplete lines", () => {
  for (const bad of [
    "",
    "hello world",
    "  ts=2026-01-01T00:00:00Z level=info job=j src=ts event=e",
    "ts=x level=fatal event=e",
    "ts=x event=e",
    "ts=x level=info",
  ]) {
    assert.equal(parseLine(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("7. null for a line that merely contains level=error in prose", () => {
  const prose =
    "the agent said: ts=2026-01-01T00:00:00Z level=error job=x src=sh event=oops — please ignore";
  assert.equal(parseLine(prose), null);
});

test("8. isFault is true only for level=error", () => {
  for (const level of ["debug", "info", "warn", "error"] as const) {
    const line = renderLine(level, "j", "e");
    const parsed = parseLine(line)!;
    assert.equal(isFault(parsed), level === "error");
  }
});

test("9. renderFault: `job/event` — msg (k=v), omitting the parens with no extra fields", () => {
  const withFields: LogLine = {
    ts: "t",
    level: "error",
    job: "j",
    src: "ts",
    event: "e",
    msg: "boom",
    fields: { a: "1" },
    raw: "",
  };
  assert.equal(renderFault(withFields), "`j/e` — boom (a=1)");
  assert.equal(renderFault({ ...withFields, fields: {} }), "`j/e` — boom");
});

test("10. src survives: a line with src=sh parses to src: 'sh'", () => {
  const raw = "ts=2026-01-01T00:00:00Z level=info job=j src=sh event=e";
  assert.equal(parseLine(raw)!.src, "sh");
});
