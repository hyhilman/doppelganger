// the argv block, driven as a real child process (ruling 1: the argv block
// itself is UNTESTED BY CONSTRUCTION; these two are smoke checks, not tests).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

test("26. the argv block parses and dispatches — check on a temp tree with a registered job and no rendered file exits 1 naming missing", () => {
  // ENGINE_ROOT redirects kernel/paths.ts's ROOT, so the argv block's real tree
  // (projectPath(".claude/skills")/projectPath("plugins")) resolves under the temp root instead
  // of the real checkout — a smoke check, not a test of `run`/`check` themselves (cli/skills.test.ts
  // already covers those directly).
  const root = mkdtempSync(join(tmpdir(), "skills-cli-"));
  mkdirSync(join(root, "plugins", "nightly", "skills", "nightly-sandcastle"), { recursive: true });
  writeFileSync(
    join(root, "plugins", "nightly", "skills", "nightly-sandcastle", "SKILL.md"),
    "---\nname: nightly-sandcastle\ndescription: d\n---\n\nbody\n",
  );
  mkdirSync(join(root, ".claude", "skills"), { recursive: true });
  mkdirSync(join(root, "host", "jobs"), { recursive: true });

  const r = spawnSync(process.execPath, [join(ROOT, "cli/skills.ts"), "check"], {
    cwd: ROOT,
    env: { ...process.env, ENGINE_ROOT: root },
    encoding: "utf8",
  });
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}. stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stderr, /missing/);
});

test("27. check against the REAL tree exits 0 — TST-23 as a build gate, run the way an operator runs it", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "cli/skills.ts"), "check"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}. stdout=${r.stdout} stderr=${r.stderr}`);
});
