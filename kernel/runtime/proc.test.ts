// J4.2 (LSE-11) — proc.ts: the grid of every branch failing toward alive, plus real /proc probes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pidNamespace,
  procIsRestricted,
  ownerLiveness,
  isOwnerAlive,
  realReaders,
  type ProcReaders,
} from "./proc.ts";

const STARTS_BEFORE_NOW = "0"; // ticks -> starttime near epoch, always well before any real claim

function errWithCode(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

const enoent = (): NodeJS.ErrnoException => errWithCode("ENOENT");
const eacces = (): NodeJS.ErrnoException => errWithCode("EACCES");
const eperm = (): NodeJS.ErrnoException => errWithCode("EPERM");

/** A well-formed `/proc/<pid>/stat` line, `comm` unquoted so the last-`)` anchor has something
 *  ordinary to find. `startTicks` lands at field 22 (tail[19]). */
function fakeStat(pid: number, comm: string, startTicks: string): string {
  return `${pid} (${comm}) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 20 0 1 0 0 ${startTicks}`;
}

const OK_BOOT = "btime 1000\n";
const UNRESTRICTED_MOUNTINFO =
  "25 29 0:23 / /proc rw,nosuid,nodev,noexec,relatime shared:12 - proc proc rw\n";
const HIDEPID_MOUNTINFO =
  "25 29 0:23 / /proc rw,nosuid,nodev,noexec,relatime,hidepid=2 shared:12 - proc proc rw\n";
const SUBSET_MOUNTINFO =
  "25 29 0:23 / /proc rw,nosuid,nodev,noexec,relatime shared:12 - proc proc rw,subset=pid\n";

function readers(over: Partial<ProcReaders>): ProcReaders {
  return {
    readNsLink: () => "pid:[4026531836]",
    readBootStat: () => OK_BOOT,
    readProcStat: () => fakeStat(1, "x", STARTS_BEFORE_NOW),
    readMountInfo: () => UNRESTRICTED_MOUNTINFO,
    ...over,
  };
}

// ---------------------------------------------------------------------------------------------
// 1. The grid — one deepEqual over every branch of the verdict table.
// ---------------------------------------------------------------------------------------------

test("1. the grid — every branch of the verdict table, as one deepEqual", () => {
  const claimedAt = 10_000_000; // well after epoch, well after STARTS_BEFORE_NOW's starttime
  const cases: Record<string, ProcReaders> = {
    ok_alive: readers({}),
    enoent_unrestricted_dead: readers({
      readProcStat: () => {
        throw enoent();
      },
      readMountInfo: () => UNRESTRICTED_MOUNTINFO,
    }),
    enoent_restricted_hidepid_unknown: readers({
      readProcStat: () => {
        throw enoent();
      },
      readMountInfo: () => HIDEPID_MOUNTINFO,
    }),
    enoent_restricted_subset_unknown: readers({
      readProcStat: () => {
        throw enoent();
      },
      readMountInfo: () => SUBSET_MOUNTINFO,
    }),
    eacces_unknown: readers({
      readProcStat: () => {
        throw eacces();
      },
    }),
    eperm_unknown: readers({
      readProcStat: () => {
        throw eperm();
      },
    }),
    no_close_paren_unknown: readers({ readProcStat: () => "junk with no paren at all" }),
    ticks_not_a_number_unknown: readers({ readProcStat: () => fakeStat(1, "x", "notanumber") }),
    too_few_fields_unknown: readers({ readProcStat: () => "1 (x) S 1 1" }),
    bootstat_throws_unknown: readers({
      readBootStat: () => {
        throw enoent();
      },
    }),
    bootstat_no_btime_line_unknown: readers({ readBootStat: () => "some other line\n" }),
    bootstat_btime_not_a_number_unknown: readers({ readBootStat: () => "btime notanumber\n" }),
    recycled_pid_dead: readers({ readProcStat: () => fakeStat(1, "x", String(claimedAt * 100)) }),
  };
  const expected: Record<string, string> = {
    ok_alive: "alive",
    enoent_unrestricted_dead: "dead",
    enoent_restricted_hidepid_unknown: "unknown",
    enoent_restricted_subset_unknown: "unknown",
    eacces_unknown: "unknown",
    eperm_unknown: "unknown",
    no_close_paren_unknown: "unknown",
    ticks_not_a_number_unknown: "unknown",
    too_few_fields_unknown: "unknown",
    bootstat_throws_unknown: "unknown",
    bootstat_no_btime_line_unknown: "unknown",
    bootstat_btime_not_a_number_unknown: "unknown",
    recycled_pid_dead: "dead",
  };
  const actual: Record<string, string> = {};
  for (const [name, r] of Object.entries(cases)) {
    actual[name] = ownerLiveness(1, claimedAt, r);
  }
  assert.deepEqual(actual, expected);
});

// ---------------------------------------------------------------------------------------------
// 2. pidNamespace against the real /proc — recorded, never pinned.
// ---------------------------------------------------------------------------------------------

test("2. pidNamespace against the real /proc is a bare digit string", () => {
  const ns = pidNamespace();
  assert.match(String(ns), /^\d+$/, `recorded on this host: ${ns}`);
});

// ---------------------------------------------------------------------------------------------
// 3. A real dead pid reads "dead".
// ---------------------------------------------------------------------------------------------

test('3. a real dead pid reads "dead"', () => {
  const r = spawnSync("/bin/sh", ["-c", "echo $$"], { encoding: "utf8" });
  const deadPid = Number(r.stdout.trim());
  assert.ok(Number.isInteger(deadPid) && deadPid > 0, `expected a real pid, got ${r.stdout}`);
  assert.equal(ownerLiveness(deadPid, Date.now()), "dead");
});

// ---------------------------------------------------------------------------------------------
// 4. This process reads "alive" against its own start time.
// ---------------------------------------------------------------------------------------------

test('4. this process reads "alive"', () => {
  assert.equal(ownerLiveness(process.pid, Date.now()), "alive");
  assert.equal(isOwnerAlive(process.pid, Date.now()), true);
});

// ---------------------------------------------------------------------------------------------
// 5. A pid that started AFTER the claim reads "dead".
// ---------------------------------------------------------------------------------------------

test('5. a pid that started after the claim reads "dead"', () => {
  // This process began long after epoch 0, so a claim dated then cannot be ours.
  assert.equal(ownerLiveness(process.pid, 0), "dead");
});

// ---------------------------------------------------------------------------------------------
// 6. The comm-with-parens fixture — the parse anchors at the LAST ')'.
// ---------------------------------------------------------------------------------------------

test("6. comm-with-parens fixture — the parse anchors at the last ')'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proc-comm-"));
  const weirdPath = join(dir, "n (o d) (e)");
  symlinkSync(process.execPath, weirdPath);
  const before = Date.now();
  const child = spawn(weirdPath, ["-e", "process.stdout.write('ready\\n'); setInterval(()=>{}, 1000)"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.stdout!.once("data", () => resolve());
    });
    const after = Date.now();
    const raw = readFileSync(`/proc/${child.pid}/stat`, "utf8");
    const closeParen = raw.lastIndexOf(")");
    const comm = raw.slice(raw.indexOf("(") + 1, closeParen);
    // The fixture has teeth: prove the symlink trick actually produced a comm with the hazard
    // character class this test exists to cover, rather than silently testing an ordinary name.
    assert.match(comm, /[ )]/, `expected comm to contain a space or paren, got ${JSON.stringify(comm)}`);

    const tail = raw.slice(closeParen + 2).split(" ");
    const startTicks = Number(tail[19]);
    const bootStat = readFileSync("/proc/stat", "utf8");
    const btimeMatch = /^btime (\d+)$/m.exec(bootStat);
    assert.ok(btimeMatch);
    const startedAtMs = (Number(btimeMatch![1]) + startTicks / 100) * 1000;
    // Bounded, never equated: btime is whole seconds and /proc counts in 10ms ticks, but a
    // mis-indexed field misses by hours, not milliseconds.
    assert.ok(
      startedAtMs >= before - 2000 && startedAtMs <= after + 2000,
      `startedAtMs ${startedAtMs} not within [${before - 2000}, ${after + 2000}]`,
    );

    assert.equal(ownerLiveness(child.pid!, before), "alive");

    // A second, more surgical check on the SAME frozen stat line: pin claimedAtMs to just after
    // boot — a claim this recently-spawned pid could never have made under correct parsing, since
    // its real starttime is ~now, weeks after boot. A mis-indexed field that happens to land on a
    // small number (coincidentally still reading "alive" against the near-now claim above) cannot
    // also fake this one: the anchor bug on THIS host's real field layout reads ticks as 0, which
    // computes to exactly boot time — placing it INSIDE the boot-relative window instead of weeks
    // past it, flipping "dead" to "alive".
    const claimedJustAfterBoot = Number(btimeMatch![1]) * 1000 + 1000;
    assert.equal(
      ownerLiveness(child.pid!, claimedJustAfterBoot, { ...realReaders, readProcStat: () => raw }),
      "dead",
      "a claim made just after boot cannot belong to a process that started weeks later",
    );
  } finally {
    child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// 7. /proc/stat unreadable does not make a live pid dead — the branch the reference gets wrong.
// ---------------------------------------------------------------------------------------------

test("7. /proc/stat unreadable does not make a live pid dead (the reference's own bug)", () => {
  const r = readers({
    readProcStat: () => fakeStat(process.pid, "node", STARTS_BEFORE_NOW),
    readBootStat: () => {
      throw enoent();
    },
  });
  assert.equal(ownerLiveness(process.pid, Date.now(), r), "unknown");
  assert.equal(isOwnerAlive(process.pid, Date.now(), r), true);
});

// ---------------------------------------------------------------------------------------------
// 8. EACCES is not ENOENT.
// ---------------------------------------------------------------------------------------------

test("8. EACCES is not ENOENT — never positive evidence of absence", () => {
  // Measured reachable on this host: /proc/1/environ raises EACCES.
  const r = readers({
    readProcStat: () => {
      throw eacces();
    },
  });
  assert.equal(ownerLiveness(1, Date.now(), r), "unknown");
});

// ---------------------------------------------------------------------------------------------
// 9. realReaders is what production uses.
// ---------------------------------------------------------------------------------------------

test("9. realReaders is what production uses — the default parameter is exercised", () => {
  assert.equal(ownerLiveness(process.pid, Date.now()), "alive");
  assert.deepEqual(realReaders, {
    readNsLink: realReaders.readNsLink,
    readBootStat: realReaders.readBootStat,
    readProcStat: realReaders.readProcStat,
    readMountInfo: realReaders.readMountInfo,
  });
});

// ---------------------------------------------------------------------------------------------
// 10. procIsRestricted — real host, then fixture texts, then a throwing reader.
// ---------------------------------------------------------------------------------------------

test("10. procIsRestricted", () => {
  // Recorded, never pinned: this host answered false on 2026-08-26 with options
  // rw,nosuid,nodev,noexec,relatime.
  const real = procIsRestricted();
  assert.equal(typeof real, "boolean");

  assert.equal(procIsRestricted(readers({ readMountInfo: () => HIDEPID_MOUNTINFO })), true);
  assert.equal(procIsRestricted(readers({ readMountInfo: () => SUBSET_MOUNTINFO })), true);
  assert.equal(procIsRestricted(readers({ readMountInfo: () => UNRESTRICTED_MOUNTINFO })), false);
  assert.equal(
    procIsRestricted(
      readers({
        readMountInfo: () => {
          throw enoent();
        },
      }),
    ),
    true,
  );
});

// ---------------------------------------------------------------------------------------------
// 11. A restricted /proc makes the reaper a no-op — the cell that says a live claim cannot be
//     force-deleted.
// ---------------------------------------------------------------------------------------------

test("11. a restricted /proc downgrades a genuinely-dead ENOENT to unknown", () => {
  const r = readers({
    readMountInfo: () => HIDEPID_MOUNTINFO,
    readProcStat: () => {
      throw enoent();
    },
  });
  assert.equal(ownerLiveness(999999, Date.now(), r), "unknown");
});

// ---------------------------------------------------------------------------------------------
// 12. procIsRestricted — readable mountinfo, but NO line names the /proc mount at all. Fails
//     toward restricted (true), same as a read failure — "I could not tell" must also stop the
//     reap. Distinct from test 10's throw case: this is a CLEAN read that finds nothing.
// ---------------------------------------------------------------------------------------------

test("12. procIsRestricted fails toward restricted (true) when mountinfo has no /proc line at all", () => {
  assert.equal(
    procIsRestricted(readers({ readMountInfo: () => "0 1 0:1 / / rw shared:1 - ext4 /dev/sda1 rw\n" })),
    true,
    "a mountinfo with real content but no /proc mount entry must still read as restricted, never false",
  );
  assert.equal(procIsRestricted(readers({ readMountInfo: () => "" })), true, "an empty mountinfo must also read as restricted");
});

// ---------------------------------------------------------------------------------------------
// 13. pidNamespace — a non-throwing but malformed readNsLink() must return null, never the junk.
// ---------------------------------------------------------------------------------------------

test("13. pidNamespace returns null, never the raw text, when readNsLink's output does not match pid:[N]", () => {
  assert.equal(pidNamespace(readers({ readNsLink: () => "not a valid ns link" })), null);
  assert.equal(pidNamespace(readers({ readNsLink: () => "" })), null);
});
