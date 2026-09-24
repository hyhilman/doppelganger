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
import opsResetBranches from "../../plugins/git/jobs/ops-reset-branches.ts";
import opsEnsureEnvWorktrees from "../../plugins/git/jobs/ops-ensure-env-worktrees.ts";
import opsResetEnvToMain from "../../plugins/git/jobs/ops-reset-env-to-main.ts";

import opsLeaseReap from "../../plugins/ops/jobs/ops-lease-reap.ts";
import opsLogReport from "../../plugins/ops/jobs/ops-log-report.ts";
import opsRetention from "../../plugins/ops/jobs/ops-retention.ts";

test("1. JOBS lists the registered jobs in registration order", () => {
  assert.deepEqual(JOBS.map((j) => j.name), [
    "nightly-sandcastle",
    "nightly-polish",
    "ops-hello",
    "ops-lease-reap",
    "ops-log-report",
    "ops-retention",
    "ops-reset-branches",
    "ops-ensure-env-worktrees",
    "ops-reset-env-to-main",
    "ops-cron-check",
  ]);
});

test("2. JOBS holds the same job objects the job files export — registry() does not clone or wrap", () => {
  const byName = (name: string) => JOBS.find((j) => j.name === name);
  assert.strictEqual(byName("nightly-sandcastle"), nightlySandcastle);
  assert.strictEqual(byName("nightly-polish"), nightlyPolish);
  assert.strictEqual(byName("ops-hello"), opsHello);
  assert.strictEqual(byName("ops-cron-check"), opsCronCheck);
  assert.strictEqual(byName("ops-reset-branches"), opsResetBranches);
  assert.strictEqual(byName("ops-ensure-env-worktrees"), opsEnsureEnvWorktrees);
  assert.strictEqual(byName("ops-reset-env-to-main"), opsResetEnvToMain);
  assert.strictEqual(byName("ops-lease-reap"), opsLeaseReap);
  assert.strictEqual(byName("ops-log-report"), opsLogReport);
  assert.strictEqual(byName("ops-retention"), opsRetention);
});
