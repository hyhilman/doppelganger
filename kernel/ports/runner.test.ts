// Numbered 6/7; tests 1-5/8 live in job.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runTimeoutMs, type Runner } from "./runner.ts";

test("6. runTimeoutMs: taskClass impl gets a strictly larger deadline, both finite and > 0", () => {
  const bare = runTimeoutMs({});
  const impl = runTimeoutMs({ taskClass: "impl" });
  assert.ok(Number.isFinite(bare) && bare > 0);
  assert.ok(Number.isFinite(impl) && impl > 0);
  assert.ok(impl > bare, `expected impl (${impl}) > bare (${bare})`);
});

test("7. a Runner must resolve every RunResult field — type-level", () => {
  // @ts-expect-error a RunResult missing branch/logPath must fail to typecheck.
  const bad: Runner = async () => {
    return { stdout: "", completionSignal: null, iterations: 1, commits: [] };
  };
  void bad;
  // The REAL gate is the @ts-expect-error above: it fails typecheck (TS2578) if the omission ever
  // compiles. This line only keeps the test body non-empty — do not read it as the assertion.
  assert.ok(true, "the @ts-expect-error above proves a Runner cannot omit a RunResult field");
});
