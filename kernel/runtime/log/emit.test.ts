// the TypeScript emitter, and the static
// shape of log.sh. The cross-emitter byte comparison is J1.9.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { renderLine, renderValue, ORDER, logger } from "./emit.ts";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const LOG_SH = new URL("./log.sh", import.meta.url).pathname;

test("1. renderLine matches the five-field shape exactly", () => {
  assert.match(
    renderLine("info", "j", "e", {}),
    /^ts=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z level=info job=j src=ts event=e$/,
  );
});

test("2. msg is last even when passed first", () => {
  const line = renderLine("info", "j", "e", { msg: "hello there", after: "x" });
  assert.ok(line.endsWith('after=x msg="hello there"'), line);
});

test("3. null and undefined fields are dropped entirely", () => {
  const line = renderLine("info", "j", "e", { a: null, b: undefined, c: "1" });
  assert.doesNotMatch(line, /\ba=/);
  assert.doesNotMatch(line, /\bb=/);
  assert.match(line, /\bc=1\b/);
});

test("4. renderValue bare/quoted over the value matrix, against the written rule", () => {
  const bare = /^[A-Za-z0-9_./:@#+-]+$/;
  const cases = [
    "plain", "a-b_c.d/e:f@g#h+i", "", "has space", 'has "quote"', "back\\slash",
    "comma,list", "star*", "tilde~", "50%", "a=b", "café", "İ", "ā", "ŉ", "→", "😀", "3", "-", "_",
  ];
  for (const v of cases) {
    const rendered = renderValue(v);
    const expectBare = v !== "" && bare.test(v);
    if (expectBare) assert.equal(rendered, v, `expected ${JSON.stringify(v)} bare`);
    else assert.ok(rendered.startsWith('"') && rendered.endsWith('"'), `expected ${JSON.stringify(v)} quoted, got ${rendered}`);
  }
});

test('5. escaping order: a\\"b renders "a\\\\\\"b" — backslash first, then quote', () => {
  assert.equal(renderValue('a\\"b'), '"a\\\\\\"b"');
});

test("6. a value containing a newline renders on one line, the newline as a space", () => {
  assert.equal(renderValue("two\nlines"), '"two lines"');
});

test("7. LOG-06: writes to fd 2, and stdout is empty", () => {
  const r = spawnSync(
    process.execPath,
    ["-e", "import('./kernel/runtime/log/emit.ts').then(m => m.logger('j').info('e'))"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^ts=.*level=info job=j src=ts event=e\n$/);
});

test("8. LOG-10: LOG_LEVEL=warn drops debug/info and keeps warn/error", () => {
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      "import('./kernel/runtime/log/emit.ts').then(m => { const l = m.logger('j'); l.debug('d'); l.info('i'); l.warn('w'); l.error('er'); })",
    ],
    { cwd: ROOT, env: { ...process.env, LOG_LEVEL: "warn" }, encoding: "utf8" },
  );
  assert.equal(r.stderr.includes("event=d"), false);
  assert.equal(r.stderr.includes("event=i"), false);
  assert.ok(r.stderr.includes("event=w"));
  assert.ok(r.stderr.includes("event=er"));
});

test("9. LOG-05: severity is set by the emitter, never inferred from text", () => {
  // Through the real logger(), not renderLine() directly — the inference this guards against would
  // live in logger()'s dispatch, not in the pure line-shape function.
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      "import('./kernel/runtime/log/emit.ts').then(m => { const l = m.logger('j'); " +
        "l.info('e1', {msg: 'FATAL: everything is on fire'}); l.error('e2', {msg: 'all good'}); })",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.match(r.stderr, /level=info job=j src=ts event=e1/);
  assert.match(r.stderr, /level=error job=j src=ts event=e2/);
});

test("10. LOG-03: exactly four levels, no fatal", () => {
  assert.deepEqual(Object.keys(ORDER).sort(), ["debug", "error", "info", "warn"]);
  assert.equal("fatal" in logger("j"), false);
});

test("11. log.sh static: no bracket-expression range over A-Z/a-z/0-9", () => {
  const src = readFileSync(LOG_SH, "utf8");
  assert.doesNotMatch(src, /\[[^\]]*[A-Za-z0-9]-[A-Za-z0-9]/);
});

test("12. log.sh static: no external command other than date", () => {
  const src = readFileSync(LOG_SH, "utf8");
  for (const cmd of ["awk", "sed", "grep", "cut", "tr", "python", "perl", "jq", "expr"]) {
    assert.doesNotMatch(src, new RegExp(`\\b${cmd}\\b`), `log.sh must not name ${cmd}`);
  }
});

test("13. log.sh static: no log_fatal function is defined", () => {
  const src = readFileSync(LOG_SH, "utf8");
  assert.doesNotMatch(src, /\blog_fatal\b/);
});

test("14. log.sh is not executable", () => {
  const mode = statSync(LOG_SH).mode;
  assert.equal(mode & 0o111, 0);
});
