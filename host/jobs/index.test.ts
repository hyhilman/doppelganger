// the hand-registered list throws on a duplicate name.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Job } from "../../kernel/ports/job.ts";
import { assertNoDuplicateNames, JOBS } from "./index.ts";

function fakeJob(name: string): Job {
  return { name, description: "d", plugin: "nightly", skill: name, permissionMode: "bypassPermissions", local: true };
}

test("1. host/jobs/index.ts throws on a duplicate name", () => {
  assert.doesNotThrow(() => assertNoDuplicateNames(JOBS));
  assert.throws(() => assertNoDuplicateNames([fakeJob("dup"), fakeJob("dup")]), /duplicate job name/);
});
