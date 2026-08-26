// J3.2 (HRN-01, HRN-02, HRN-07, HRN-15, SKL-01) — Job, DEFAULTS, the permission-mode allowlist and
// OPUS_GUIDANCE. Numbered to match plan/N3-uac.md's J3.2 "Do (tests)" list — tests 6/7 (Runner,
// runTimeoutMs) live in runner.test.ts, so this file's numbering skips them on purpose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULTS, PERMISSION_MODES, OPUS_GUIDANCE, defineJob, skillOf, type Job } from "./job.ts";

test("1. defineJob is identity", () => {
  const job: Job = {
    name: "nightly-x",
    description: "d",
    plugin: "nightly",
    skill: "nightly-x",
    permissionMode: "bypassPermissions",
    local: true,
  };
  assert.strictEqual(defineJob(job), job);
});

test("2. skillOf returns name when skill is absent, and skill when present", () => {
  const withSkill: Job = {
    name: "nightly-x",
    description: "d",
    plugin: "nightly",
    skill: "nightly-y",
    permissionMode: "bypassPermissions",
    local: true,
  };
  assert.equal(skillOf(withSkill), "nightly-y");

  const withoutSkill: Job = {
    name: "nightly-x",
    description: "d",
    plugin: "nightly",
    permissionMode: "bypassPermissions",
    local: true,
  };
  assert.equal(skillOf(withoutSkill), "nightly-x");
});

test("3. DEFAULTS.model is the file's only model literal, across every quote spelling", () => {
  const src = readFileSync(fileURLToPath(new URL("./job.ts", import.meta.url)), "utf8");
  const re = /(["'`])claude-[^"'`]*\1/g;
  const matches = [...src.matchAll(re)].map((m) => m[0]);
  assert.equal(
    matches.length,
    1,
    `expected exactly one model literal in job.ts, found ${matches.length}: ${matches.join(", ")}`,
  );
  assert.equal(matches[0], `"${DEFAULTS.model}"`);
});

test("4. DEFAULTS.permissionMode is a member of PERMISSION_MODES, which excludes plan/acceptEdits/default (HRN-07)", () => {
  assert.ok((PERMISSION_MODES as readonly string[]).includes(DEFAULTS.permissionMode));
  for (const excluded of ["plan", "acceptEdits", "default"]) {
    assert.ok(
      !(PERMISSION_MODES as readonly string[]).includes(excluded),
      `PERMISSION_MODES must not include ${excluded}`,
    );
  }
});

test("5. OPUS_GUIDANCE is non-empty, has no {{ placeholder, and names no path into a skill's own files (HRN-16)", () => {
  assert.ok(OPUS_GUIDANCE.length > 0);
  assert.ok(!OPUS_GUIDANCE.includes("{{"));
  for (const bad of ["plugins/", ".claude/", "SKILL.md"]) {
    assert.ok(!OPUS_GUIDANCE.includes(bad), `OPUS_GUIDANCE must not name ${bad}`);
  }
});

test("8. Job.permissionMode is required — type-level (HRN-07)", () => {
  // @ts-expect-error permissionMode omitted must fail to typecheck — this IS the enforcement.
  const bad: Job = defineJob({
    name: "nightly-x",
    description: "d",
    plugin: "nightly",
    skill: "nightly-x",
  });
  void bad;
  // The REAL gate is the @ts-expect-error above: it fails typecheck (TS2578) if the omission ever
  // compiles. This line only keeps the test body non-empty — do not read it as the assertion.
  assert.ok(true, "the @ts-expect-error above proves Job.permissionMode cannot be omitted");
});
