// J2.15 (SUP-08 pure half, INS-03, TST-16) — the crontab managed block's pure transforms.
//
// `BLOCK`-shaped fixtures stand in for `render()`'s real output wherever the mechanics under test
// (markers, splice, collisions, adopt) never read the block's CONTENT, only its shape (a begin
// line, a body, an end line) — the same simplification the reference uses. `render()` itself is
// only exercised directly in tests 14-16, which need real ScheduleEntry fixtures instead.
//
// PROGRAMS is empty at N2 (host/schedule.ts's own decision — no job exists to register until N3),
// but `render()` calls the real, no-opts `validate(entries)`, which needs a PROGRAMS row for every
// entry. `withPrograms` mutates the real (exported, not runtime-frozen) PROGRAMS object for the
// duration of one test and restores it after — the only way to drive render()'s real validate()
// call from a unit test at N2, given render()'s own 2-argument signature has no opts to inject
// through. node:test runs one file per process (this repo's own precedent, host/supervisor.test.ts
// and kernel/runtime/gate.test.ts), so this mutation never reaches another test file.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  markers,
  legacyRange,
  installedBlock,
  splice,
  collisions,
  adopt,
  render,
  diff,
  comment,
} from "./crontab.ts";
import { PROGRAMS, programOf, commandOf, type ScheduleEntry, type Program } from "../host/schedule.ts";
import { projectPath, ROOT } from "../kernel/paths.ts";

const j = (lines: readonly string[]): string => lines.join("\n") + "\n";

/** A fake managed block: real begin/end marker lines for `instance`, a comment line, and whatever
 *  command lines the test needs — the mechanics under test never read past the shape. */
function fakeBlock(instance: string, commands: readonly string[] = ["*/5 * * * * cmd-a"]): string[] {
  const { begin, end } = markers(instance);
  return [begin, "# a fixture comment", ...commands, end];
}

const LEGACY_BEGIN_LINE = "# >>> doppelganger managed block (npm run crontab sync) >>>";
const LEGACY_END_LINE = "# <<< doppelganger managed block <<<";

/** Adds `rows` to the real PROGRAMS object for the duration of `fn`, then removes only the keys
 *  it added — the same "never touch a foreign one" rule SKL-10 applies to a rendered skill. */
function withPrograms<T>(rows: Readonly<Record<string, Program>>, fn: () => T): T {
  const mutable = PROGRAMS as Record<string, Program>;
  const added: string[] = [];
  for (const [name, p] of Object.entries(rows)) {
    if (!(name in mutable)) added.push(name);
    mutable[name] = p;
  }
  try {
    return fn();
  } finally {
    for (const name of added) delete mutable[name];
  }
}

/** A ScheduleEntry that passes the REAL validate()'s checks with no opts: an absolute log path
 *  under a real LOG_ROOT, and a script that genuinely exists at the real ROOT (validate() only
 *  checks existence, not that it is runnable — package.json is a stable, always-present file). */
function validEntry(over: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    name: "watch-probe",
    cron: "* * * * *",
    log: projectPath(".doppelganger/logs/crontab-test-probe.log"),
    script: "package.json",
    why: "fixture entry for cli/crontab.test.ts",
    ...over,
  };
}

const program = (over: Partial<Program> = {}): Program => ({ self: true, gate: "excl", dotenv: false, ...over });

test("1. installedBlock reads back exactly what splice wrote", () => {
  const block = fakeBlock("alpha");
  const result = splice("", block, "alpha");
  assert.deepEqual(installedBlock(result, "alpha"), block);
});

test("2. installedBlock returns null on a half-written pair, an inverted pair, and another instance's pair", () => {
  const { begin, end } = markers("alpha");
  const half = j([begin, "* * * * * x"]); // no end at all
  assert.equal(installedBlock(half, "alpha"), null);

  const inverted = j([end, "* * * * * x", begin]); // end appears before begin
  assert.equal(installedBlock(inverted, "alpha"), null);

  const foreign = j(fakeBlock("beta"));
  assert.equal(installedBlock(foreign, "alpha"), null);
});

test("3. splice replaces the block and leaves every foreign line untouched, before and after, in order", () => {
  const before = ["# foreign comment", "0 3 * * * foreign-cmd"];
  const oldBlock = fakeBlock("alpha", ["*/5 * * * * old-cmd"]);
  const after = ["# another foreign line"];
  const crontab = j([...before, ...oldBlock, ...after]);

  const newBlock = fakeBlock("alpha", ["*/10 * * * * new-cmd"]);
  const result = splice(crontab, newBlock, "alpha");
  const lines = result.split("\n").slice(0, -1); // drop the trailing "" from the final \n

  assert.deepEqual(lines.slice(0, before.length), before);
  assert.deepEqual(lines.slice(before.length, before.length + newBlock.length), newBlock);
  assert.deepEqual(lines.slice(before.length + newBlock.length), after);
});

test("4. splice appends when no block is installed, and a host with no crontab at all gets the block alone", () => {
  const block = fakeBlock("alpha");
  const appended = splice("0 3 * * * foreign-cmd\n", block, "alpha");
  assert.equal(appended, j(["0 3 * * * foreign-cmd", ...block]));

  const alone = splice("", block, "alpha");
  assert.equal(alone, j(block));
});

test("5. splice is idempotent — a second sync writes the same bytes, not a second block", () => {
  const block = fakeBlock("alpha");
  const once = splice("0 3 * * * foreign\n", block, "alpha");
  const twice = splice(once, block, "alpha");
  assert.equal(twice, once);
  assert.equal((twice.match(/managed block \(npm run crontab sync\)/g) ?? []).length, 1);
});

test("6. two instances splice side by side", () => {
  const alphaBlock = fakeBlock("alpha", ["*/5 * * * * a-cmd"]);
  const start = j(["# foreign 1", ...alphaBlock, "# foreign 2"]);

  const betaBlock = fakeBlock("beta", ["*/5 * * * * b-cmd"]);
  const withBeta = splice(start, betaBlock, "beta");

  assert.deepEqual(installedBlock(withBeta, "alpha"), alphaBlock);
  assert.deepEqual(installedBlock(withBeta, "beta"), betaBlock);
  const lines = withBeta.split("\n");
  const i1 = lines.indexOf("# foreign 1");
  const i2 = lines.indexOf("# foreign 2");
  assert.ok(i1 !== -1 && i2 !== -1 && i1 < i2, "both foreign lines survive, in order");

  const alphaBlock2 = fakeBlock("alpha", ["*/15 * * * * a-cmd-2"]);
  const resplicedAlpha = splice(withBeta, alphaBlock2, "alpha");
  assert.deepEqual(installedBlock(resplicedAlpha, "beta"), betaBlock, "beta's block is untouched by an alpha splice");
  assert.deepEqual(installedBlock(resplicedAlpha, "alpha"), alphaBlock2);
});

test("7. collisions finds an unmanaged line duplicating a rendered entry", () => {
  const cmd = "*/5 * * * * dup-cmd";
  const block = fakeBlock("alpha", [cmd]);
  const crontab = j([cmd, "0 3 * * * other-cmd"]);
  assert.deepEqual(collisions(crontab, block, "alpha"), [cmd]);
});

test("8. collisions does not count the block's own copy of the line", () => {
  const block = fakeBlock("alpha", ["*/5 * * * * dup-cmd"]);
  const crontab = j(block);
  assert.deepEqual(collisions(crontab, block, "alpha"), []);
});

test("9. collisions does not count another instance's block's copy either", () => {
  const cmd = "*/5 * * * * dup-cmd";
  const crontab = j(fakeBlock("beta", [cmd]));
  const newBlock = fakeBlock("alpha", [cmd]);
  assert.deepEqual(collisions(crontab, newBlock, "alpha"), []);
});

test("10. collisions ignores comments and blank lines", () => {
  const block = fakeBlock("alpha", ["*/5 * * * * dup-cmd"]);
  const crontab = j(["# */5 * * * * dup-cmd", "", "   "]);
  assert.deepEqual(collisions(crontab, block, "alpha"), []);
});

test("11. adopt + splice together drop the duplicate with its comment run, keep every other line, and leave collisions empty", () => {
  const cmd = "*/5 * * * * dup-cmd";
  const crontab = j([
    "# keep this comment",
    "0 1 * * * keep-cmd",
    "# a comment run",
    "# right above the duplicate",
    cmd,
    "0 2 * * * keep-cmd-2",
  ]);
  const block = fakeBlock("alpha", [cmd]);
  const spliced = splice(adopt(crontab, block, "alpha"), block, "alpha");
  const lines = spliced.split("\n");

  // The duplicate now appears exactly ONCE — as part of the managed block splice() appended,
  // never as the stray unmanaged line it started as.
  assert.equal(lines.filter((l) => l === cmd).length, 1);
  assert.ok(!lines.includes("# a comment run"), "its comment run is gone");
  assert.ok(!lines.includes("# right above the duplicate"), "its comment run is gone");
  assert.ok(lines.includes("# keep this comment"));
  assert.ok(lines.includes("0 1 * * * keep-cmd"));
  assert.ok(lines.includes("0 2 * * * keep-cmd-2"));
  assert.deepEqual(collisions(spliced, block, "alpha"), []);
});

test("12. adopt leaves the marker pair standing, so the splice after it replaces rather than appends", () => {
  const cmd = "*/5 * * * * dup-cmd";
  const oldBlock = fakeBlock("alpha", ["*/5 * * * * old-cmd"]);
  const crontab = j([...oldBlock, "# stray comment", cmd]);
  const newBlock = fakeBlock("alpha", [cmd]);

  const spliced = splice(adopt(crontab, newBlock, "alpha"), newBlock, "alpha");
  const beginCount = spliced.split("\n").filter((l) => l.startsWith("# >>> doppelganger")).length;
  assert.equal(beginCount, 1, "adopt must not delete the existing pair and let splice append a second one");
});

test("13. the unnamed (legacy) block: legacyRange finds it, installedBlock(instance) returns null, and adopt+splice migrate it to exactly one named pair, none unnamed", () => {
  const legacyBlock = [LEGACY_BEGIN_LINE, "# old comment", "*/5 * * * * old-cmd", LEGACY_END_LINE];
  const crontab = j(legacyBlock);

  assert.notEqual(legacyRange(crontab.split("\n").slice(0, -1)), null);
  assert.equal(installedBlock(crontab, "alpha"), null, "not ours until adopted");

  // F10 (N2 VERIFY): a LITERAL, not `fakeBlock("alpha", ...)` — `fakeBlock` calls `markers()`
  // internally, the exact function `installedBlock` (via `blockRange`) also calls to find the
  // block below. If `markers()` ever collapsed to the same text for every instance, BOTH sides of
  // the closing `assert.deepEqual` would agree on that same wrong text and this test would not
  // notice. Written out by hand so the marker text is independent of the function under test.
  const newBlock = [
    "# >>> doppelganger:alpha managed block (npm run crontab sync) >>>",
    "# a fixture comment",
    "*/10 * * * * new-cmd",
    "# <<< doppelganger:alpha managed block <<<",
  ];
  const spliced = splice(adopt(crontab, newBlock, "alpha"), newBlock, "alpha");
  const lines = spliced.split("\n");

  assert.equal(lines.filter((l) => l.startsWith("# >>> doppelganger")).length, 1);
  assert.equal(lines.includes(LEGACY_BEGIN_LINE), false, "no unnamed pair remains");
  assert.deepEqual(installedBlock(spliced, "alpha"), newBlock);
});

test("14. SUP-01: render over a five-entry fixture with one supervised:false entry emits exactly its command line, and none of the four supervised ones", () => {
  // DEVIATION from plan/N2-uac.md J2.15's DO item 14, which describes "two supervised: false"
  // entries: validate()'s rule 22 (host/schedule.ts, J2.9) enforces SUP-09's actual, already-
  // reworded form — "at most one" (roadmap.md's own SUP-09 row: "'exactly one' would refuse the
  // state N2 ships in") — and throws "more than one entry sets supervised: false" on a second one.
  // render() calls that same validate() first, so a two-bootstrap fixture cannot reach the
  // rendering step at all; confirmed by running it and reading the real error text before making
  // this change. This test keeps the DO item's INTENT — render emits exactly the bootstrap
  // entries' command lines and none of the supervised ones — with a fixture SUP-09 actually
  // allows: one bootstrap entry among five.
  // Each entry needs its OWN log path — commandOf(e) embeds `log`, and validEntry()'s default is
  // shared, so without this every entry would render the identical command line and the "none of
  // the four supervised ones" half of this test could not tell them apart.
  const withLog = (name: string, over: Partial<ScheduleEntry> = {}): ScheduleEntry =>
    validEntry({ name, log: projectPath(`.doppelganger/logs/crontab-test-${name}.log`), ...over });
  const fixture = [
    withLog("watch-a"),
    withLog("watch-b", { supervised: false }),
    withLog("watch-c"),
    withLog("watch-d"),
    withLog("watch-e"),
  ];
  withPrograms(Object.fromEntries(fixture.map((e) => [programOf(e), program()])), () => {
    const out = render(fixture, "alpha");
    for (const e of fixture) {
      const line = `${e.cron} ${commandOf(e)}`;
      assert.equal(out.includes(line), e.supervised === false, `entry ${e.name}`);
    }
  });
});

test("15. render validates every entry, not just the rendered subset: a broken SUPERVISED entry still throws", () => {
  const fixture = [
    validEntry({ name: "watch-a", supervised: false }),
    validEntry({ name: "watch-b", why: "" }), // broken (empty why) and SUPERVISED, not bootstrap
  ];
  withPrograms(Object.fromEntries(fixture.map((e) => [programOf(e), program()])), () => {
    assert.throws(() => render(fixture, "alpha"), /watch-b/);
  });
});

test("16. render is deterministic: two calls over the same entries produce identical bytes", () => {
  const fixture = [validEntry({ name: "watch-a" }), validEntry({ name: "watch-b", supervised: false })];
  withPrograms(Object.fromEntries(fixture.map((e) => [programOf(e), program()])), () => {
    assert.deepEqual(render(fixture, "alpha"), render(fixture, "alpha"));
  });
});

test("17. diff names the changed line, with installed: and expected: prefixes, for a one-line change in the middle of a five-line block", () => {
  const want = ["line1", "line2", "line3-OLD", "line4", "line5"];
  const got = ["line1", "line2", "line3-NEW", "line4", "line5"];
  const out = diff(want, got).join("\n");
  assert.match(out, /expected:/);
  assert.match(out, /installed:/);
  assert.match(out, /line3-OLD/);
  assert.match(out, /line3-NEW/);
});

// F9 (N2 VERIFY) — diff()'s two untested arms: a pure insertion (a line installed has no
// counterpart wanted at all) and a pure deletion (a line wanted is missing from installed
// entirely), each reported alone rather than paired into a "differs" entry.

test("18. diff: a pure insertion — an installed line with no wanted counterpart — is reported alone", () => {
  const want = ["line1", "line2"];
  const got = ["line1", "line2", "line3-EXTRA"];
  const out = diff(want, got);
  assert.deepEqual(out, ["line 3 installed but not expected:", '  installed: "line3-EXTRA"']);
  // A pure insertion never carries an `  expected: ` VALUE line — only "differs" (substitution)
  // does. Matched with the two-space indent so this does not false-positive on the word "expected"
  // inside the "not expected:" header line above.
  assert.doesNotMatch(out.join("\n"), /^ {2}expected: /m, "a pure insertion names no expected: value — there is nothing it was substituted for");
});

test("19. diff: a pure deletion — a wanted line missing from installed entirely — is reported alone", () => {
  const want = ["line1", "line2", "line3-MISSING"];
  const got = ["line1", "line2"];
  const out = diff(want, got);
  assert.deepEqual(out, ["line 3 expected but missing from installed:", '  expected: "line3-MISSING"']);
  // Same indent-anchored check, the other direction: no `  installed: ` VALUE line, only the
  // header's own "missing from installed:" text, which is not that.
  assert.doesNotMatch(out.join("\n"), /^ {2}installed: /m, "a pure deletion names no installed: value — nothing replaced it");
});

// F9 — comment()'s wrap branch (COMMENT_WIDTH = 98 columns), never exercised: every render() call
// in the rest of this suite uses a `why` short enough to fit on one line.

test("20. comment() wraps a why long enough to exceed COMMENT_WIDTH into more than one # line", () => {
  const words = Array.from({ length: 30 }, (_, i) => `word${i}`); // "word0 word1 ... word29", 209 chars
  const text = words.join(" ");
  const lines = comment(text);
  assert.ok(lines.length > 1, `expected wrapping into multiple lines, got ${lines.length}`);
  for (const line of lines) {
    assert.ok(line.startsWith("# "), `every line must be a "# "-prefixed comment: ${JSON.stringify(line)}`);
    assert.ok(line.length <= 98, `every line must be <= 98 columns, got ${line.length}: ${JSON.stringify(line)}`);
  }
  // no word lost, none split, order preserved.
  const rebuilt = lines.join(" ").replace(/# /g, "").trim().split(/\s+/).join(" ");
  assert.equal(rebuilt, text);
});

// F10 (N2 VERIFY) — render()'s exact output, pinned as a LITERAL, not built by calling render()
// (or commandOf()) a second time. Tests 14-16 above never do this: 14 checks a SUBSET (one line
// present, the others absent), 15 checks validation, and 16 checks only that two calls of render()
// agree WITH EACH OTHER, never that either is right. Without a literal pin somewhere, a bug baked
// into render()'s own output (a wrong header line, a dropped comment, entries in the wrong order)
// would be invisible everywhere it is used as its own oracle — including cli/crontab-cli.test.ts's
// wiring tests 1, 3, 9 and 10, which build BOTH sides of their own equality by calling render()
// again. This test is what makes that pattern legitimate there: it is a real, independent check
// of render()'s content, so those four tests are free to treat render() as a trusted building
// block for asserting the WIRING (does sync/render really install/print what render() computed),
// which is what they are actually about. `ROOT` is imported directly rather than going through
// `commandOf()`, so the command line is built by hand here too, not through the function under
// indirect test.
test("21. render's exact output over a one-entry bootstrap fixture, pinned literally", () => {
  const e = validEntry({ name: "watch-fixture-21", supervised: false, why: "a short fixture reason" });
  withPrograms({ [programOf(e)]: program() }, () => {
    const out = render([e], "alpha");
    const expected = [
      "# >>> doppelganger:alpha managed block (npm run crontab sync) >>>",
      "# Generated from host/schedule.ts — do not hand-edit. `npm run crontab check` diffs it.",
      "# BOOTSTRAP ONLY: everything else is scheduled by host/supervisor.ts.",
      "# a short fixture reason",
      // R3 (SUP-03) fixed the disagreement between commandOf's script: branch and spawnChild:
      // a script is executed directly via its own shebang, never through a `node` prefix (`node`
      // cannot run a bash script). This hand-built line reflects that, independent of
      // scriptCommandOf itself — see the test's own header comment for why that independence
      // matters.
      `${e.cron} cd ${ROOT} && ${ROOT}/${e.script} >> ${e.log} 2>&1`,
      "# <<< doppelganger:alpha managed block <<<",
    ];
    assert.deepEqual(out, expected);
  });
});
