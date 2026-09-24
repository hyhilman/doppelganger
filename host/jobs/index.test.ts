// host/jobs/index.ts's registry-backed job list. The duplicate-throws behaviour (KRN-01) is
// kernel/registry.ts's now, and its test lives in kernel/registry.test.ts with it (KRN-03) — this
// file only tests that JOBS still names the right jobs, in the right order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { JOBS } from "./index.ts";
import nightlySandcastle from "../../plugins/nightly/jobs/nightly-sandcastle.ts";
import nightlyPolish from "../../plugins/nightly/jobs/nightly-polish.ts";
import opsHello from "../../plugins/ops/jobs/ops-hello.ts";
import opsCronCheck from "./ops-cron-check.ts";

test("1. JOBS lists the registered jobs in registration order", () => {
  assert.deepEqual(JOBS.map((j) => j.name), ["nightly-sandcastle", "nightly-polish", "ops-hello", "ops-cron-check"]);
});

test("2. JOBS holds the same job objects the job files export — registry() does not clone or wrap", () => {
  assert.strictEqual(JOBS[0], nightlySandcastle);
  assert.strictEqual(JOBS[1], nightlyPolish);
  assert.strictEqual(JOBS[2], opsHello);
  assert.strictEqual(JOBS[3], opsCronCheck);
});
