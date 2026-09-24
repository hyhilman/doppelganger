// HRN-17 — every skill name a prompt reaches for is a registered skill.
//
// A prompt names a skill as `/<name>`. If no registered job owns that skill, the agent finds no
// skill by that name. It guesses or does something else, and nothing fails. This file holds the
// names in the prompts to the registry: host/jobs/index.ts's JOBS.
//
// SKL-06 (test/skills.test.ts) is the registry half: every job's skill has a directory, and every
// skill directory has a job. This file is the other half: the names written INSIDE the prompts.
//
// A prompt here is text an agent reads, never a source comment:
//   - buildPrompt()'s output for every registered skill job, with the job's own promptArgs. It
//     carries OPUS_GUIDANCE and the `/<skill>` line.
//   - OPUS_GUIDANCE on its own, so a name in it is seen even with no skill job registered.
//   - every plugins/*/skills/*/SKILL.md, frontmatter included. Its `name:` counts too.
//
// A skill name always carries a stage prefix and so a `-` (SUP-20). A slash word with no `-` or `:`
// (`/tmp`, `/review`) is therefore not read as one. There is no agent registry yet, so a
// plugin-qualified name (`/<plugin>:<name>`) resolves to nothing and fails until one exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { OPUS_GUIDANCE } from "../kernel/ports/job.ts";
import { buildPrompt } from "../kernel/runtime/runjob.ts";
import { JOBS } from "../host/jobs/index.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** `/<name>` as an invocation: not the middle of a path or URL, and not followed by more path. */
const INVOCATION = /(?<![\w./:<>-])\/([a-z][a-z0-9]*(?:[-:][a-z0-9]+)+)(?![\w/-]|\.\w)/g;

function invoked(text: string): string[] {
  return [...text.matchAll(INVOCATION)].map((m) => m[1]!);
}

/** The `name:` line of a SKILL.md frontmatter, if it has one. */
function frontmatterName(text: string): string | undefined {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  return /^name:\s*(\S+)\s*$/m.exec(fm)?.[1];
}

/** Every skill a registered job declares. An exec job declares none, so `/<exec job>` fails. */
const SKILLS: ReadonlySet<string> = new Set(JOBS.flatMap((j) => (j.skill === undefined ? [] : [j.skill])));

/** Every prompt an agent reads, labelled by where it came from. */
function prompts(): { readonly where: string; readonly text: string }[] {
  const out: { where: string; text: string }[] = [{ where: "OPUS_GUIDANCE", text: OPUS_GUIDANCE }];
  for (const job of JOBS) {
    if (job.skill === undefined) continue;
    out.push({ where: `buildPrompt(${job.name})`, text: buildPrompt(job, job.promptArgs ?? {}) });
  }
  const plugins = join(ROOT, "plugins");
  for (const plugin of readdirSync(plugins)) {
    const skills = join(plugins, plugin, "skills");
    if (!existsSync(skills)) continue;
    for (const skill of readdirSync(skills)) {
      const file = join(skills, skill, "SKILL.md");
      if (existsSync(file)) out.push({ where: `plugins/${plugin}/skills/${skill}/SKILL.md`, text: readFileSync(file, "utf8") });
    }
  }
  return out;
}

test("INVOCATION reads a slash command and skips a path, a URL and a closing tag (HRN-17)", () => {
  const rows: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["and by a human at /nightly-sandcastle to see what a pass would do.", ["nightly-sandcastle"]],
    ["run `/nightly-sandcastle` now", ["nightly-sandcastle"]],
    ["call /engineering:code-review first", ["engineering:code-review"]],
    ["<!-- managed:doppelganger-skills v=1 src=plugins/nightly/skills/nightly-sandcastle -->", []],
    ["see plugins/nightly/skills/nightly-sandcastle/SKILL.md", []],
    ["a path /nightly-sandcastle/SKILL.md is not a call", []],
    ["a file /tmp/nightly-x.db is not a call", []],
    ["post to https://ntfy.sh/ops-alerts", []],
    ['completionSignal "<promise>COMPLETE</promise>"', []],
    ["a builtin /review has no stage prefix", []],
  ];
  for (const [text, want] of rows) assert.deepEqual(invoked(text), want, JSON.stringify(text));
});

test("every skill name a prompt reaches for is a registered skill (HRN-17)", () => {
  const offenders: string[] = [];
  let seen = 0;
  for (const { where, text } of prompts()) {
    const names = invoked(text);
    const fm = where.endsWith("SKILL.md") ? frontmatterName(text) : undefined;
    if (fm !== undefined) names.push(fm);
    seen += names.length;
    for (const name of names) {
      if (!SKILLS.has(name)) offenders.push(`${where} names ${JSON.stringify(name)}, which no registered job declares as its skill`);
    }
  }
  assert.ok(seen > 0, "the prompts name no skill at all — the scan itself broke");
  assert.deepEqual(offenders, [], `${offenders.length} unregistered skill name(s):\n  ${offenders.join("\n  ")}`);
});

test("buildPrompt names each skill job's own skill, so the scan above sees it (HRN-17)", () => {
  for (const job of JOBS) {
    if (job.skill === undefined) continue;
    assert.ok(
      invoked(buildPrompt(job, job.promptArgs ?? {})).includes(job.skill),
      `buildPrompt(${job.name}) does not invoke /${job.skill}`,
    );
  }
});
