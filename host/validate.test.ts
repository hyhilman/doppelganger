// J2.9 (SUP-05, SUP-18, SUP-09, GAT-07) — validate(), the boot gate: every fault in one throw.
//
// Every rule is exercised against a BASELINE fixture entry with exactly one field broken, the
// reference's own cron/validate.test.ts shape — so the rule set is fully covered on a day when
// SCHEDULE is empty. Fixtures are built locally, not imported from host/schedule.test.ts: that
// file's `entry()`/`program()` are exported for J2.11/J2.13/J2.14/J2.17 (J2.7's own list), and
// importing a .test.ts file re-runs every test() it registers as an import side effect — measured
// at J2.8, where it inflated host/cron.test.ts's own count from 12 to 16.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate, type ValidateOpts } from "./schedule.ts";
import type { ScheduleEntry, Program } from "./schedule.ts";

const jobsDir = mkdtempSync(join(tmpdir(), "dg-jobs-"));
const root = mkdtempSync(join(tmpdir(), "dg-root-"));
writeFileSync(join(jobsDir, "probe.ts"), "export {};\n");
writeFileSync(join(jobsDir, "orphan.ts"), "export {};\n");
mkdirSync(join(root, "scripts"), { recursive: true });
writeFileSync(join(root, "scripts", "probe.sh"), "#!/bin/sh\n");

// J4.11 (SUP-03, SUP-05, SUP-08 fix) — rules 12a/12b's own fixtures, five shapes covering the
// grid: extension x (executable, shebang).
writeFileSync(join(root, "scripts", "probe.py"), "print('hi')\n");
writeFileSync(join(root, "scripts", "noexec.sh"), "#!/bin/sh\necho hi\n");
chmodSync(join(root, "scripts", "noexec.sh"), 0o644); // shebang, NOT executable
writeFileSync(join(root, "scripts", "noshebang.sh"), "echo hi\n");
chmodSync(join(root, "scripts", "noshebang.sh"), 0o755); // executable, NO shebang
writeFileSync(join(root, "scripts", "good.sh"), "#!/bin/sh\necho hi\n");
chmodSync(join(root, "scripts", "good.sh"), 0o755); // both — accepted
writeFileSync(join(root, "scripts", "good.ts"), "export {};\n");
// good.ts is deliberately left at the writeFileSync default mode (not executable, no shebang) —
// 12b applies to .sh only, so this must still be ACCEPTED.

const LOG_ROOT = join(tmpdir(), "dg-logs");

function baseEntry(over: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    name: "watch-probe",
    cron: "* * * * *",
    log: join(LOG_ROOT, "probe.log"),
    job: "probe",
    why: "fixture entry for validate() tests",
    ...over,
  };
}

function baseProgram(over: Partial<Program> = {}): Program {
  return { self: true, gate: "excl", dotenv: false, ...over };
}

function baseOpts(over: Partial<ValidateOpts> = {}): ValidateOpts {
  return {
    programs: { probe: baseProgram() },
    resourceNames: ["repo", "skills"],
    refreshWindow: null,
    logRoots: [LOG_ROOT],
    jobsDir,
    root,
    ...over,
  };
}

test("0. an empty schedule is valid by decision — the first entry needs a job (N3) or the watchdog script (N4)", () => {
  assert.doesNotThrow(() => validate([]));
});

test("1. the baseline (supervised) fixture entry validates cleanly", () => {
  assert.doesNotThrow(() => validate([baseEntry()], baseOpts()));
});

test("2. the baseline bootstrap (supervised: false) fixture entry validates cleanly", () => {
  const e = baseEntry({ name: "ops-probe", supervised: false });
  assert.doesNotThrow(() => validate([e], baseOpts()));
});

test("rule 1: duplicate name", () => {
  assert.throws(
    () => validate([baseEntry(), baseEntry()], baseOpts()),
    /entry "watch-probe": duplicate name/,
  );
});

test("rule 2: name carries no known stage prefix (SUP-20)", () => {
  assert.throws(
    () => validate([baseEntry({ name: "nostage" })], baseOpts()),
    /entry "nostage": name carries no known stage prefix/,
  );
});

test("rule 3: cron is not exactly 5 fields", () => {
  assert.throws(
    () => validate([baseEntry({ cron: "* * * *" })], baseOpts()),
    /entry "watch-probe": cron must be exactly 5 whitespace-separated fields/,
  );
});

test("rule 4: cron fails parseFive", () => {
  assert.throws(
    () => validate([baseEntry({ cron: "60 * * * *" })], baseOpts()),
    /entry "watch-probe": cron: minute: .* out of range/,
  );
});

test("rule 5: log is not absolute", () => {
  assert.throws(
    () => validate([baseEntry({ log: "relative/probe.log" })], baseOpts()),
    /entry "watch-probe": log must be an absolute path/,
  );
});

test("rule 6: log is not under a known log root (SUP-18)", () => {
  assert.throws(
    () => validate([baseEntry({ log: "/somewhere/else/probe.log" })], baseOpts()),
    /entry "watch-probe": log .* is not under a known log root/,
  );
});

test("rule 7: why is empty after trim", () => {
  assert.throws(
    () => validate([baseEntry({ why: "   " })], baseOpts()),
    /entry "watch-probe": why must be non-empty/,
  );
});

test("rule 8: both job and script are set", () => {
  assert.throws(
    () => validate([baseEntry({ script: "scripts/probe.sh" })], baseOpts()),
    /entry "watch-probe": both job and script are set/,
  );
});

test("rule 9: neither job nor script is set", () => {
  assert.throws(
    () => validate([baseEntry({ job: undefined })], baseOpts()),
    /entry "watch-probe": neither job nor script is set/,
  );
});

test("rule 10: job set but the job file does not exist", () => {
  assert.throws(
    () => validate([baseEntry({ job: "missing-job" })], baseOpts({ programs: { "missing-job": baseProgram() } })),
    /entry "watch-probe": job file does not exist/,
  );
});

test("rule 11: script set but the script does not exist", () => {
  const e = baseEntry({ job: undefined, script: "scripts/missing.sh" });
  assert.throws(
    () => validate([e], baseOpts({ programs: { "scripts/missing.sh": baseProgram() } })),
    /entry "watch-probe": script does not exist/,
  );
});

test("rule 12: script is absolute (INS-02)", () => {
  const e = baseEntry({ job: undefined, script: "/abs/script.sh" });
  assert.throws(
    () => validate([e], baseOpts({ programs: { "/abs/script.sh": baseProgram() } })),
    /entry "watch-probe": script must be project-relative, not absolute/,
  );
});

test("rule 12a: script must end in .ts or .sh", () => {
  const e = baseEntry({ job: undefined, script: "scripts/probe.py" });
  assert.throws(
    () => validate([e], baseOpts({ programs: { "scripts/probe.py": baseProgram() } })),
    /entry "watch-probe": script must end in \.ts or \.sh, got "scripts\/probe\.py"/,
  );
});

test("rule 12b: a .sh script that is not executable is refused", () => {
  const e = baseEntry({ job: undefined, script: "scripts/noexec.sh" });
  assert.throws(
    () => validate([e], baseOpts({ programs: { "scripts/noexec.sh": baseProgram() } })),
    /entry "watch-probe": script .*noexec\.sh is not executable — a chmod -x silently disables it \(SUP-05\)/,
  );
});

test("rule 12b: a .sh script with no shebang is refused", () => {
  const e = baseEntry({ job: undefined, script: "scripts/noshebang.sh" });
  assert.throws(
    () => validate([e], baseOpts({ programs: { "scripts/noshebang.sh": baseProgram() } })),
    /entry "watch-probe": script .*noshebang\.sh does not start with #! — it is rendered with no interpreter \(SUP-05\)/,
  );
});

test("rule 12b: a .sh script that is executable and starts with #! is accepted", () => {
  const e = baseEntry({ job: undefined, script: "scripts/good.sh" });
  assert.doesNotThrow(() => validate([e], baseOpts({ programs: { "scripts/good.sh": baseProgram() } })));
});

test("rule 12b does not over-reach: a .ts script needs no exec bit and no shebang", () => {
  const e = baseEntry({ job: undefined, script: "scripts/good.ts" });
  assert.doesNotThrow(() => validate([e], baseOpts({ programs: { "scripts/good.ts": baseProgram() } })));
});

test("rule 13: maxRunMin is present and not > 0", () => {
  assert.throws(
    () => validate([baseEntry({ maxRunMin: 0 })], baseOpts()),
    /entry "watch-probe": maxRunMin must be > 0/,
  );
});

test("rule 14: no PROGRAMS row for the entry's program", () => {
  const e = baseEntry({ job: "orphan" });
  assert.throws(
    () => validate([e], baseOpts()), // baseOpts().programs only has "probe"
    /entry "watch-probe": no PROGRAMS row for program "orphan"/,
  );
});

test("rule 15: the program's resources name something outside resourceNames", () => {
  const opts = baseOpts({ programs: { probe: baseProgram({ resources: ["nonexistent"] }) } });
  assert.throws(
    () => validate([baseEntry()], opts),
    /entry "watch-probe": program "probe" names unknown resource "nonexistent"/,
  );
});

test("rule 16: gate is shared and resources is set — a reader takes all", () => {
  const opts = baseOpts({ programs: { probe: baseProgram({ gate: "shared", resources: ["repo"] }) } });
  assert.throws(
    () => validate([baseEntry()], opts),
    /entry "watch-probe": program "probe": gate "shared" must not set resources/,
  );
});

test("rule 17: gate is none with no non-empty whyNoGate (GAT-07)", () => {
  const opts = baseOpts({ programs: { probe: baseProgram({ gate: "none" }) } });
  assert.throws(
    () => validate([baseEntry()], opts),
    /entry "watch-probe": program "probe": gate "none" requires a non-empty whyNoGate/,
  );
});

test("rule 18: dotenv is not a boolean", () => {
  const badProgram = { ...baseProgram(), dotenv: "nope" } as unknown as Program;
  const opts = baseOpts({ programs: { probe: badProgram } });
  assert.throws(
    () => validate([baseEntry()], opts),
    /entry "watch-probe": program "probe": dotenv must be a boolean/,
  );
});

test("rule 19: gateWait is set on a program whose gate is none", () => {
  const opts = baseOpts({ programs: { probe: baseProgram({ gate: "none", whyNoGate: "probe" }) } });
  assert.throws(
    () => validate([baseEntry({ gateWait: true })], opts),
    /entry "watch-probe": gateWait is set but program "probe" has gate "none"/,
  );
});

test("rule 20: clearsRefreshWindow is set on a program whose gate is none", () => {
  const opts = baseOpts({ programs: { probe: baseProgram({ gate: "none", whyNoGate: "probe" }) } });
  assert.throws(
    () => validate([baseEntry({ clearsRefreshWindow: true })], opts),
    /entry "watch-probe": clearsRefreshWindow is set but program "probe" has gate "none"/,
  );
});

test("rule 21: clearsRefreshWindow is set while refreshWindow is null", () => {
  assert.throws(
    () => validate([baseEntry({ clearsRefreshWindow: true })], baseOpts({ refreshWindow: null })),
    /entry "watch-probe": clearsRefreshWindow is set but host\/config\.ts's REFRESH_WINDOW is null/,
  );
});

test("rule 22: more than one entry sets supervised: false (SUP-09)", () => {
  const a = baseEntry({ name: "ops-a", supervised: false });
  const b = baseEntry({ name: "ops-b", supervised: false });
  assert.throws(
    () => validate([a, b], baseOpts()),
    /entry "ops-b": more than one entry sets supervised: false/,
  );
});

test("rule 23: unescaped % in a bootstrap entry's rendered command (SUP-08)", () => {
  const e = baseEntry({ name: "ops-percent", supervised: false, log: join(LOG_ROOT, "50%off.log") });
  assert.throws(
    () => validate([e], baseOpts()),
    /entry "ops-percent": rendered bootstrap command contains an unescaped %/,
  );
});

test("every fault is reported, not just the first", () => {
  const a = baseEntry({ name: "nostage" }); // rule 2
  const b = baseEntry({ name: "watch-other", why: "  " }); // rule 7
  assert.throws(() => validate([a, b], baseOpts()), (e: unknown) => {
    const msg = (e as Error).message;
    assert.match(msg, /entry "nostage": name carries no known stage prefix/);
    assert.match(msg, /entry "watch-other": why must be non-empty/);
    return true;
  });
});

test("the % rule is scoped to bootstrap (supervised: false) entries", () => {
  // refused: unescaped %, supervised: false
  assert.throws(
    () => validate([baseEntry({ name: "ops-a", supervised: false, log: join(LOG_ROOT, "50%off.log") })], baseOpts()),
    /rendered bootstrap command contains an unescaped %/,
  );
  // accepted: escaped %, supervised: false
  assert.doesNotThrow(() =>
    validate([baseEntry({ name: "ops-b", supervised: false, log: join(LOG_ROOT, "50\\%off.log") })], baseOpts()),
  );
  // ignored: unescaped %, but NOT a bootstrap entry (supervised is not false)
  assert.doesNotThrow(() =>
    validate([baseEntry({ name: "watch-c", log: join(LOG_ROOT, "50%off.log") })], baseOpts()),
  );
});

// AC7's "no mkdtemp directory survives" is satisfied by removing the fixture roots at the end of
// this file's own run — node --test runs top-level code once per file, so this executes after
// every test() above has been registered and (by the time process exit is reached) run.
process.on("exit", () => {
  rmSync(jobsDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});
