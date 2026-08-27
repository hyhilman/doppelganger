// the host's own value-class vocabulary: pinned assignment, the three-way split
// over PROGRAMS, the safe default, and the two-call-site coupling J4.10 will wire up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHORE, REVIEW, WATCH, classOf } from "./classes.ts";
import { PROGRAMS, SCHEDULE, programOf } from "./schedule.ts";
import { JOBS } from "./jobs/index.ts";

test("8. CHORE and REVIEW are pinned to the assignment table this feature shipped with", () => {
  assert.deepEqual(
    [...CHORE],
    ["nightly-sandcastle"],
    "a change here is a value-class decision, not a refactor — CHORE moved away from the table J4.9 shipped with",
  );
  assert.deepEqual(
    [...REVIEW],
    [],
    "a change here is a value-class decision, not a refactor — REVIEW is empty at N4 because nothing has a human waiting on it yet",
  );
});

test("9. every PROGRAMS key is chore, review, or in the pinned WATCH set — a new program must choose", () => {
  assert.deepEqual(
    Object.keys(PROGRAMS).sort(),
    [...CHORE, ...REVIEW, ...WATCH].sort(),
    "a program with no home in CHORE/REVIEW/WATCH would silently classOf() to \"watch\" — this assertion forces an explicit choice instead",
  );
});

test("10. classOf defaults an unknown name to watch", () => {
  assert.equal(classOf("some-job-nobody-assigned-yet"), "watch");
  assert.equal(classOf(""), "watch");
});

test("11. classOf's two call sites are handed two different strings, and they agree only by convention", () => {
  // The supervisor will ask classOf(programOf(e)) (J4.10); host/run.ts's runNamed will ask
  // classOf(job.name) directly (J4.10). For every schedule entry naming a job, programOf(e) IS
  // e.job, and test/jobs.test.ts test 3 already pins that a registered job's declared name equals
  // its filename — so this test cites that coupling by name (rather than re-scanning the
  // filesystem) and asserts the two call sites' inputs classify identically for every job entry
  // in the real schedule today. Break the coupling and half the shedding goes quiet: the
  // supervisor still skips (it read the filename) while runNamed falls through to "watch" and
  // stops downshifting.
  const jobEntries = SCHEDULE.filter((e) => e.job !== undefined);
  assert.ok(jobEntries.length > 0, "precondition: at least one job-carrying schedule entry exists");
  for (const e of jobEntries) {
    const job = JOBS.find((j) => j.name === e.job);
    assert.ok(job, `schedule entry ${e.name} names unregistered job ${e.job}`);
    assert.equal(
      classOf(programOf(e)),
      classOf(job!.name),
      `entry ${e.name}: classOf(programOf(e))=${classOf(programOf(e))} must equal classOf(job.name)=${classOf(job!.name)}`,
    );
  }
});
