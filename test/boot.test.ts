// test/boot.test.ts — KRN-11: `boot()` runs over the REAL graph — the real two manifests
// `host/plugins.ts` registers, and the REAL skill-tree reader (`DEFAULT_BOOT_DEPS`, never a fake)
// — inside `npm test`. `kernel/boot.test.ts` proves boot()'s LOGIC against fixtures small enough
// to read in one screen; this file is the one place that logic meets production data. A
// validation that only ran inside the supervisor would move a fault from commit time to 3am —
// that move is the whole point of this file existing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boot } from "../kernel/boot.ts";
import { definePlugin, type Plugin } from "../kernel/plugin.ts";
import { SCHEDULE } from "../host/schedule.ts";
import { PLUGINS, ownerOf, UNCLAIMED } from "../host/plugins.ts";
import { JOBS } from "../host/jobs/index.ts";
import type { Job } from "../kernel/ports/job.ts";
import type { ScheduleEntry } from "../kernel/ports/schedule.ts";
import { stageOf } from "../kernel/stages.ts";

test("1. AC1 — boot(PLUGINS) does not throw over the real graph, with the real skill-tree reader", () => {
  assert.doesNotThrow(() => boot(PLUGINS));
});

test("2. every SCHEDULE entry is claimed by exactly one plugin's schedule array (the ownership rule's partition)", () => {
  // Two independent views of the same claim, and both must agree with SCHEDULE itself:
  //   (a) ownerOf(entry) names one of PLUGINS' own names — no entry is left UNCLAIMED.
  //   (b) that plugin's `schedule` array is exactly the entries `ownerOf` assigns it — neither a
  //       stray entry claimed twice, nor one silently dropped.
  const pluginNames = new Set(PLUGINS.map((p) => p.name));

  for (const entry of SCHEDULE) {
    const owner = ownerOf(entry);
    assert.ok(
      pluginNames.has(owner),
      `schedule entry ${JSON.stringify(entry.name)} is owned by ${JSON.stringify(owner)}, ` +
        `which names no plugin in host/plugins.ts's PLUGINS — an unclaimed entry is an entry boot() never validates`,
    );
  }

  // The partition, the other direction: every plugin's own `schedule` array holds exactly the
  // SCHEDULE entries ownerOf assigns it, no more and no less, and every entry appears in exactly
  // one plugin's array across the whole graph.
  const claimedBy = new Map<string, string>(); // entry name -> plugin name that claimed it
  for (const plugin of PLUGINS) {
    for (const entry of plugin.schedule) {
      assert.equal(
        ownerOf(entry),
        plugin.name,
        `plugin ${JSON.stringify(plugin.name)}'s schedule lists ${JSON.stringify(entry.name)}, ` +
          `whose owner is ${JSON.stringify(ownerOf(entry))} — schedule must be SELECTED by ownership, never hand-listed`,
      );
      assert.ok(
        !claimedBy.has(entry.name),
        `schedule entry ${JSON.stringify(entry.name)} is claimed by both ${JSON.stringify(claimedBy.get(entry.name))} ` +
          `and ${JSON.stringify(plugin.name)} — exactly one plugin must own each entry`,
      );
      claimedBy.set(entry.name, plugin.name);
    }
  }

  assert.deepEqual(
    [...claimedBy.keys()].sort(),
    SCHEDULE.map((e) => e.name).sort(),
    "every entry in host/schedule.ts's SCHEDULE must be claimed by exactly one plugin's schedule array",
  );
});

test("3. ops-watchdog — the entry with no job field at all — is claimed through SCRIPT_OWNERS, not through a job", () => {
  const watchdog = SCHEDULE.find((e) => e.name === "ops-watchdog");
  assert.ok(watchdog !== undefined, "fixture assumption: host/schedule.ts still names ops-watchdog");
  assert.equal(watchdog!.job, undefined, "fixture assumption: ops-watchdog is still a script: entry with no job field");
  assert.equal(ownerOf(watchdog!), "ops");
  assert.ok(
    PLUGINS.find((p) => p.name === "ops")!.schedule.some((e) => e.name === "ops-watchdog"),
    "the ops plugin's schedule array must include ops-watchdog even though it has no job field",
  );
});

test("4. AC4 — no manifest lists CRONTAB_CMD (ruling 7): it belongs to cli/crontab.ts, an operator CLI, never a plugin", () => {
  for (const plugin of PLUGINS) {
    for (const row of plugin.env) {
      assert.notEqual(
        row.key,
        "CRONTAB_CMD",
        `plugin ${JSON.stringify(plugin.name)} lists CRONTAB_CMD in its env — it is required: true with no ` +
          `default and npm test runs with it deliberately unset (kernel/boot.ts check 6), so this fails every ` +
          `run; CRONTAB_CMD belongs to cli/crontab.ts, an operator CLI, and must never be a plugin's env row (ruling 7)`,
      );
    }
    for (const row of plugin.kill) {
      assert.notEqual(row.key, "CRONTAB_CMD", `plugin ${JSON.stringify(plugin.name)} lists CRONTAB_CMD as a kill switch — see above`);
    }
  }
});

test("5. check 1 (duplicate names across registries) is genuinely live: the SAME real job object, listed by two REAL manifests, is caught only by boot()", () => {
  // kernel/boot.ts's header names this as the first real subject check 1 has ever had: a
  // manifest's `jobs` array never passes through kernel/registry.ts's duplicate-throws-at-import
  // for the COLLISION this check exists to catch — no two real host/plugins.ts manifests can ever
  // list the same job today, since jobsFor() filters JOBS by a job's own single `plugin` field.
  // Prove it anyway with the REAL, registered nightlySandcastle object (JOBS[0], not a fixture
  // stand-in — host/jobs/index.test.ts test 2 pins JOBS[0] === the job file's own export), handed
  // to a second manifest built the way a copy-paste bug would build one.
  const nightlySandcastle = JOBS.find((j) => j.name === "nightly-sandcastle")!;
  assert.ok(nightlySandcastle !== undefined, "fixture assumption: JOBS still registers nightly-sandcastle");
  const nightlyAgain: Plugin = definePlugin({
    name: "nightly-again",
    kill: [],
    jobs: [nightlySandcastle],
    schedule: [],
    env: [],
  });

  let threw = false;
  try {
    boot([...PLUGINS, nightlyAgain]);
  } catch (e) {
    threw = true;
    const msg = e instanceof Error ? e.message : String(e);
    assert.ok(
      msg.includes(
        `plugin "nightly-again" [duplicate names across registries]: job name "nightly-sandcastle" is already registered by plugin "nightly"`,
      ),
      msg,
    );
  }
  assert.ok(threw, "boot() must throw when the real nightlySandcastle job object is listed by two real manifests");
});

test("6. ownership is DECLARED, not read off the stage prefix — the case plugins/git will make real", () => {
  // The regression pin for this file's headline decision. `stageOf("ops-reset-branches")` is
  // "ops", but JOB-G01 belongs to plugins/git — so a stage-based rule would hand git's entry to
  // the ops manifest. No real data can show this until plugins/git lands, so the job list is
  // synthetic and passed in; ownerOf's default argument is the only thing a test may vary here.
  const gitJob = { name: "ops-reset-branches", plugin: "git" } as unknown as Job;
  const entry = { name: "ops-reset-branches", job: "ops-reset-branches" } as unknown as ScheduleEntry;

  assert.equal(
    ownerOf(entry, [gitJob]),
    "git",
    "a job whose stage prefix is ops but whose plugin is git must be owned by git — ownership is declared, never inferred from the name",
  );
  assert.equal(stageOf(entry.name), "ops", "fixture assumption: this name's stage really is ops, so the two genuinely differ");

  // And an entry naming a job nothing registers is UNCLAIMED, never silently handed to a plugin.
  assert.equal(ownerOf(entry, []), UNCLAIMED);
});
