// kernel/boot.ts's own tests — KRN-08 (collect all, throw once, attributed) and KRN-09 (the six
// checks that have a real subject at v0).
//
// FIXTURES for boot()'s logic; the REAL TREE for the real reader. Every graph below is a fixture
// and every `BootDeps` passed to boot() is a fake, so boot()'s own logic is proved over graphs
// small enough to read in one screen. The one exception is deliberate and named: test 13 runs
// `DEFAULT_BOOT_DEPS` against the real `plugins/` tree, because that reader is the one production
// uses and a fake can never catch a typo in its path. Measured: with no such test, changing the
// default reader's `"plugins"` segment to `"plugin"` left all 13 tests green. The real graph (the
// two manifests this app registers) boots inside `npm test` starting at J10 (`test/boot.test.ts`).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boot, DEFAULT_BOOT_DEPS, type BootDeps } from "./boot.ts";
import type { Plugin, EnvSpec } from "./plugin.ts";
import type { Job } from "./ports/job.ts";
import type { ScheduleEntry } from "./ports/schedule.ts";

// ---------------------------------------------------------------------------------------------
// Fixture builders — every field boot() does not look at gets a harmless default, so each test
// states only the field its own check cares about.
// ---------------------------------------------------------------------------------------------

function job(over: Partial<Job> & Pick<Job, "name" | "plugin">): Job {
  return {
    description: "fixture job",
    permissionMode: "auto",
    ...over,
  };
}

function entry(over: Partial<ScheduleEntry> & Pick<ScheduleEntry, "name">): ScheduleEntry {
  return {
    cron: "0 0 * * *",
    log: "/tmp/fixture.log",
    why: "fixture entry",
    ...over,
  };
}

function plugin(over: Partial<Plugin> & Pick<Plugin, "name">): Plugin {
  return {
    kill: [],
    jobs: [],
    schedule: [],
    env: [],
    ...over,
  };
}

/** Never touches a real directory: every job "has" its skill, no directory is ever "found" on
 *  disk. The default for tests that are not exercising checks 4/5 at all. */
const NOOP_DEPS: BootDeps = {
  skillDirExists: () => true,
  listSkillDirs: () => [],
};

function captureThrow(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  assert.fail("expected boot() to throw and it did not");
}

/** `process.env[key]` scoped to one test — restores whatever was there before, even on failure. */
function withoutEnv<T>(key: string, fn: () => T): T {
  const prev = process.env[key];
  delete process.env[key];
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

// ---------------------------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------------------------

test("1. boot([]) does not throw — an empty graph is valid, if useless", () => {
  assert.doesNotThrow(() => boot([], NOOP_DEPS));
});

test("2. a clean two-plugin graph boots without throwing", () => {
  const alpha = plugin({
    name: "alpha",
    jobs: [job({ name: "alpha-job", plugin: "alpha", skill: "alpha-job" })],
    schedule: [entry({ name: "backlog-alpha-job", job: "alpha-job" })],
  });
  const beta = plugin({
    name: "beta",
    jobs: [job({ name: "beta-job", plugin: "beta" })], // exec-only: no skill field at all
  });
  const deps: BootDeps = {
    skillDirExists: (j) => j.name === "alpha-job",
    listSkillDirs: (pluginName) => (pluginName === "alpha" ? ["alpha-job"] : []),
  };
  assert.doesNotThrow(() => boot([alpha, beta], deps));
});

// ---------------------------------------------------------------------------------------------
// AC2 — KRN-08 is the whole point: collect every problem, throw once.
// ---------------------------------------------------------------------------------------------

test("3. AC2 — four distinct faults across two plugins produce ONE throw naming all four, each prefixed by its plugin (KRN-08)", () => {
  const alpha = plugin({
    name: "alpha",
    jobs: [job({ name: "alpha-job", plugin: "alpha", model: "opus" })], // fault: unpinned model
    schedule: [entry({ name: "backlog-alpha-ghost", job: "ghost-job" })], // fault: unregistered job
  });
  const beta = plugin({
    name: "beta",
    jobs: [job({ name: "beta-job", plugin: "beta", skill: "beta-job" })], // fault: skill dir missing
    env: [{ key: "BETA_FIXTURE_REQUIRED", required: true, why: "fixture-only, never a real row" } satisfies EnvSpec],
  });
  const deps: BootDeps = { skillDirExists: () => false, listSkillDirs: () => [] };

  const msg = withoutEnv("BETA_FIXTURE_REQUIRED", () => captureThrow(() => boot([alpha, beta], deps)));

  const problemLines = msg.split("\n").filter((l) => l.startsWith("  - "));
  assert.equal(problemLines.length, 4, `expected exactly 4 problem lines, got ${problemLines.length}:\n${msg}`);
  assert.ok(msg.includes('plugin "alpha"'), `must attribute at least one line to alpha:\n${msg}`);
  assert.ok(msg.includes('plugin "beta"'), `must attribute at least one line to beta:\n${msg}`);
  assert.ok(msg.includes("job declares a model"), msg);
  assert.ok(msg.includes("schedule entry names a registered job"), msg);
  assert.ok(msg.includes("job names a skill that resolves to a directory on disk"), msg);
  assert.ok(msg.includes("required env unset with no default"), msg);
});

test("4. sorting is real, not incidental: a check that runs LATER in code but sorts EARLIER by name prints first (KRN-08's 'stable across runs')", () => {
  // Code order runs the schedule check (2) before the required-env check (6). Alphabetically
  // "required env unset..." < "schedule entry names...", so a correct sort reorders them; an
  // unsorted (insertion-order) message would print them the other way round.
  const alpha = plugin({
    name: "alpha",
    schedule: [entry({ name: "backlog-alpha-ghost", job: "ghost-job" })],
    env: [{ key: "ALPHA_SORT_FIXTURE", required: true, why: "fixture-only, never a real row" } satisfies EnvSpec],
  });

  const msg = withoutEnv("ALPHA_SORT_FIXTURE", () => captureThrow(() => boot([alpha], NOOP_DEPS)));

  const requiredIdx = msg.indexOf("required env unset with no default");
  const scheduleIdx = msg.indexOf("schedule entry names a registered job");
  assert.ok(requiredIdx !== -1 && scheduleIdx !== -1, `both faults must be present:\n${msg}`);
  assert.ok(requiredIdx < scheduleIdx, `sorted by check name, "required env..." must print before "schedule entry...":\n${msg}`);

  // The PLUGIN key sorts first, ahead of the check name. Here "zulu" reports a check that sorts
  // early and "alpha" one that sorts late, so a sort that skipped the plugin key would print them
  // the other way round. Without this, sorting on the detail alone stayed green.
  const zulu = plugin({
    name: "zulu",
    env: [{ key: "ZULU_SORT_FIXTURE", required: true, why: "fixture-only, never a real row" } satisfies EnvSpec],
  });
  const late = plugin({
    name: "alpha",
    schedule: [entry({ name: "backlog-alpha-ghost", job: "ghost-job" })],
  });
  const two = withoutEnv("ZULU_SORT_FIXTURE", () => captureThrow(() => boot([zulu, late], NOOP_DEPS)));
  assert.ok(
    two.indexOf('plugin "alpha"') < two.indexOf('plugin "zulu"'),
    `the plugin name sorts before the check name:\n${two}`,
  );
});

// ---------------------------------------------------------------------------------------------
// AC3 — each of the six live checks gets its own fixture, its own fault, and a message assertion
// (not just "it threw").
// ---------------------------------------------------------------------------------------------

// WHY THIS CHECK IS REACHABLE, since kernel/registry.ts already throws on a duplicate AT IMPORT
// TIME. The registry guards `registry.register` calls — today, the two in `host/jobs/index.ts`. A
// `Plugin` manifest's `jobs` member is a plain `readonly Job[]` and never passes through a
// registry at all, so the registry cannot see a name that two manifests both list. Measured on
// this tree (2026-09-01): importing the real `host/jobs/index.ts` succeeds — the module graph
// finishes loading, both jobs register once — and boot() then reports the duplicate for all three
// shapes below. The one that will actually happen is shape (a): J10's `host/plugins.ts` imports
// job objects straight from `host/jobs/*.ts`, so a copy-paste that lists one job in two manifests
// is caught HERE and nowhere else.
test("5. AC3 — duplicate names across registries: the SAME job object listed by two manifests, and by one manifest twice", () => {
  // (a) the J10 path: one job object, two plugins. The registry registered it once and saw nothing.
  const shared = job({ name: "shared-job", plugin: "alpha" });
  const alpha = plugin({ name: "alpha", jobs: [shared] });
  const beta = plugin({ name: "beta", jobs: [shared] });

  const msg = captureThrow(() => boot([alpha, beta], NOOP_DEPS));
  assert.ok(
    msg.includes('plugin "beta" [duplicate names across registries]: job name "shared-job" is already registered by plugin "alpha"'),
    msg,
  );

  // (b) one manifest lists it twice — a copy-paste inside a single `jobs` array.
  const twice = plugin({ name: "alpha", jobs: [shared, shared] });
  const msgTwice = captureThrow(() => boot([twice], NOOP_DEPS));
  assert.ok(
    msgTwice.includes('plugin "alpha" [duplicate names across registries]: job name "shared-job" is already registered by plugin "alpha"'),
    msgTwice,
  );

  // (c) two DIFFERENT job objects that happen to share a name — the collision the type system
  // cannot see, since nothing makes a manifest's jobs unique by identity either.
  const gamma = plugin({ name: "gamma", jobs: [job({ name: "shared-job", plugin: "gamma" })] });
  const msgDistinct = captureThrow(() => boot([alpha, gamma], NOOP_DEPS));
  assert.ok(
    msgDistinct.includes('plugin "gamma" [duplicate names across registries]: job name "shared-job" is already registered by plugin "alpha"'),
    msgDistinct,
  );
});

// The entry's NAME is deliberately a registered job name here, and its `job` field is not. That
// pins the check to the field it is supposed to read: a version that looked up `entry.name`
// instead of `entry.job` would find a registered job and report nothing.
test("6. AC3 — schedule entry names a registered job: the check reads the entry's job field, not its name", () => {
  const alpha = plugin({
    name: "alpha",
    jobs: [job({ name: "alpha-job", plugin: "alpha" }), job({ name: "backlog-alpha-ghost", plugin: "alpha" })],
    schedule: [entry({ name: "backlog-alpha-ghost", job: "ghost-job" })],
  });

  const msg = captureThrow(() => boot([alpha], NOOP_DEPS));

  assert.ok(
    msg.includes(
      'plugin "alpha" [schedule entry names a registered job]: schedule entry "backlog-alpha-ghost" names job "ghost-job", which no plugin passed to boot() registers',
    ),
    msg,
  );
});

test("7. AC3 — job declares a model: resolves through DEFAULTS.model, then assertPinned (HRN-11)", () => {
  const alpha = plugin({ name: "alpha", jobs: [job({ name: "alpha-job", plugin: "alpha", model: "claude-latest" })] });

  const msg = captureThrow(() => boot([alpha], NOOP_DEPS));

  assert.ok(msg.includes('plugin "alpha" [job declares a model]: job "alpha-job":'), msg);
  assert.ok(msg.includes('model "claude-latest" is not pinned (HRN-11)'), msg);
});

// `skill` differs from `name` on purpose. SKL-01 makes them equal for every real job, which is
// exactly why a fixture that copies the name proves nothing: the path segment is `skillOf(job)`,
// and with `skill === name` a version that used `job.name` would print the same string.
test("8. AC3 — job names a skill that resolves to a directory on disk (SKL-06, direction one) — the path uses skillOf, not the job name", () => {
  const alpha = plugin({ name: "alpha", jobs: [job({ name: "alpha-job", plugin: "alpha", skill: "alpha-other" })] });
  const deps: BootDeps = { skillDirExists: () => false, listSkillDirs: () => [] };

  const msg = captureThrow(() => boot([alpha], deps));

  assert.ok(
    msg.includes(
      'plugin "alpha" [job names a skill that resolves to a directory on disk]: job "alpha-job" names skill "alpha-other", which has no directory at plugins/alpha/skills/alpha-other',
    ),
    msg,
  );
});

// The plugin carries an EXEC-ONLY job whose name matches the directory. `skillOf` falls back to
// `job.name`, so a version that built its expected set from `j.name` — or that dropped the
// `j.skill !== undefined` filter — would let that job "claim" the directory and report nothing.
// This is the same trap `cli/skills.ts` hit at J4.12 with `ops-cron-check`; the filter is what
// makes the exempt-an-exec-job claim true, so it needs a subject here rather than a comment.
test("9. AC3 — every skill directory on disk is named by a registered job (SKL-06, direction two) — an exec-only job does not claim a directory", () => {
  const alpha = plugin({
    name: "alpha",
    jobs: [job({ name: "orphan-dir", plugin: "alpha" })], // exec-only: no skill field at all
  });
  const deps: BootDeps = { skillDirExists: () => true, listSkillDirs: (p) => (p === "alpha" ? ["orphan-dir"] : []) };

  const msg = captureThrow(() => boot([alpha], deps));

  assert.ok(
    msg.includes(
      'plugin "alpha" [every skill directory on disk is named by a registered job]: plugins/alpha/skills/orphan-dir exists on disk, but no job registered by plugin "alpha" names skill "orphan-dir"',
    ),
    msg,
  );
});

test("10. AC3 — required env unset with no default (fixture subject only — ruling 7, trap one)", () => {
  const alpha = plugin({
    name: "alpha",
    env: [{ key: "ALPHA_FIXTURE_REQUIRED", required: true, why: "fixture-only row, never a real one" } satisfies EnvSpec],
  });

  const msg = withoutEnv("ALPHA_FIXTURE_REQUIRED", () => captureThrow(() => boot([alpha], NOOP_DEPS)));

  assert.ok(
    msg.includes('plugin "alpha" [required env unset with no default]: ALPHA_FIXTURE_REQUIRED: required and not set'),
    msg,
  );
});

// ---------------------------------------------------------------------------------------------
// AC5 — CRONTAB_CMD is proven to be the trap it is: added to a FIXTURE manifest's env, boot()
// reports it, exactly like any other required-and-unset row. No real manifest ever carries this
// row (see kernel/boot.ts's own header, "ruling 7, trap one").
// ---------------------------------------------------------------------------------------------

test("11. AC5 — CRONTAB_CMD in a fixture manifest's env is reported by boot(), same as any other required-and-unset row", () => {
  const alpha = plugin({
    name: "alpha",
    env: [
      {
        key: "CRONTAB_CMD",
        required: true,
        why: "the crontab binary this tool calls — cli/crontab.ts's own row, mirrored here as a fixture; no real plugin manifest carries it",
      } satisfies EnvSpec,
    ],
  });

  const msg = withoutEnv("CRONTAB_CMD", () => captureThrow(() => boot([alpha], NOOP_DEPS)));

  assert.ok(
    msg.includes('plugin "alpha" [required env unset with no default]: CRONTAB_CMD: required and not set'),
    msg,
  );
});

// ---------------------------------------------------------------------------------------------
// AC4 — the no-subject checks (route/relay/watcher, D9) are ABSENT from kernel/boot.ts, not
// stubbed. Reads this file's own source, the kernel/registry.test.ts test 8 precedent.
// ---------------------------------------------------------------------------------------------

// THE MATCH IS ON SUBSTRINGS, NOT WHOLE WORDS, AND THAT IS THE POINT. A `\broute\b` gate reads
// well and catches almost nothing: measured 2026-09-01, `plugin.routes`, `const routes = []`,
// `relays.forEach`, `watchers.map`, `routeOf(x)` and `reRoute(x)` ALL slipped past it, and those
// are the exact identifiers a route check would use — `routes`, `relays` are the manifest member
// names KRN-04 leaves out. Only the bare singular tripped it. So the gate matches any occurrence
// of the three stems. Today's kernel/boot.ts code is clean of all three, so the wider match costs
// nothing; if it ever fires on an innocent word, narrow it then, with the word in hand.
//
// THE LIMIT, stated rather than assumed. This reads kernel/boot.ts's OWN bytes. boot() imports
// four kernel modules (paths, ports/job, plugin, config), so route-like work moved into any of
// them and called from here would leave this gate green — the same one-hop hole J6 found in
// kernel/registry.ts's text gate. registry.ts could close it by importing nothing; boot() cannot,
// because it has to read a Job and an EnvSpec. What actually holds the property here is KRN-04:
// the `Plugin` interface has no `sources`/`routes`/`relays`/`lanes` member, so there is nothing
// for a route check anywhere in kernel/ to read. This test is the second lock, not the first.
test("12. AC4 — kernel/boot.ts contains no route/relay/watcher code path at all, and its header names D9 as why", () => {
  const src = readFileSync(fileURLToPath(new URL("./boot.ts", import.meta.url)), "utf8");
  assert.match(src, /D9/, "the header must name D9 as the reason route/relay/watcher checks are absent");

  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const stem of ["route", "relay", "watcher"]) {
    assert.ok(
      !new RegExp(stem, "i").test(code),
      `kernel/boot.ts must contain no ${JSON.stringify(stem)} code path outside a comment — ` +
        `this matches plurals and suffixed forms (routes, relays, watchers, routeOf) on purpose`,
    );
  }

  // KRN-08's "same message every run" also rests on the COMPARISON, and no assertion about output
  // order can see this one: swapping `cmp` for `localeCompare` leaves every ordering test green,
  // because these ASCII strings sort the same way under the test machine's locale. It is a
  // different machine's locale that would move them. So the ban is checked as text, on the same
  // comment-stripped source (the header says "never localeCompare" and must not trip its own gate).
  assert.ok(
    !/localeCompare/.test(code),
    "kernel/boot.ts must not sort with localeCompare — the order would depend on the OS locale (KRN-08)",
  );
});

// THE DEFAULT READER RUNS IN PRODUCTION, SO A FAKE CANNOT PROVE IT. This is the one test in this
// file that touches the real tree, and it is here because nothing else binds the default reader's
// path to the path `cli/skills.ts` renders and checks. Both derive
// `<ROOT>/plugins/<job.plugin>/skills/<skillOf(job)>`: cli/skills.ts as
// `join(tree.sourceRoot, job.plugin, "skills", skillOf(job))` with `sourceRoot =
// projectPath("plugins")`, kernel/boot.ts as `projectPath("plugins", job.plugin, "skills",
// skillOf(job))`. kernel/ may not import cli/ (TST-03 rule 1), so the two cannot share the line —
// this test pins BOTH segments against the one real skill directory instead. Measured: without
// it, changing the reader's `"plugins"` segment to `"plugin"` left every test green.
test("13. DEFAULT_BOOT_DEPS resolves the same plugins/<plugin>/skills/<skill> path cli/skills.ts uses", () => {
  const real = job({ name: "nightly-sandcastle", plugin: "nightly", skill: "nightly-sandcastle" });
  assert.equal(DEFAULT_BOOT_DEPS.skillDirExists(real), true, "the one real skill directory must resolve");

  // `skill`, not `name`, picks the last segment — a job named otherwise still finds it.
  const renamed = job({ name: "nightly-something-else", plugin: "nightly", skill: "nightly-sandcastle" });
  assert.equal(DEFAULT_BOOT_DEPS.skillDirExists(renamed), true, "the last segment must come from skillOf(job)");

  // `plugin`, not the job name, picks the plugin segment.
  assert.equal(
    DEFAULT_BOOT_DEPS.skillDirExists(job({ name: "nightly-sandcastle", plugin: "no-such-plugin", skill: "nightly-sandcastle" })),
    false,
    "the plugin segment must come from job.plugin",
  );
  assert.equal(
    DEFAULT_BOOT_DEPS.skillDirExists(job({ name: "nightly-sandcastle", plugin: "nightly", skill: "no-such-skill" })),
    false,
  );

  // A path that EXISTS but is a FILE is not a skill directory. The reader asks
  // `existsSync(dir) && statSync(dir).isDirectory()`, and without the second half this test is the
  // only thing that fails (measured). The one file at the right depth in this tree sits one level
  // below the skill directory, so the fixture reaches it through the skill segment — a skill name
  // no real job would carry, which is exactly why it can only be a fixture.
  assert.equal(
    DEFAULT_BOOT_DEPS.skillDirExists(job({ name: "x", plugin: "nightly", skill: "nightly-sandcastle/SKILL.md" })),
    false,
    "an existing FILE must not count as a skill directory",
  );

  assert.deepEqual([...DEFAULT_BOOT_DEPS.listSkillDirs("nightly")].sort(), ["nightly-sandcastle"]);
  assert.deepEqual(DEFAULT_BOOT_DEPS.listSkillDirs("no-such-plugin"), [], "a missing tree lists nothing, it does not throw");

  // ONE PART OF THE READER HAS NO SUBJECT HERE, stated rather than left to be assumed:
  // `listSkillDirs` filters to directories, and every entry under the real
  // `plugins/nightly/skills/` is one, so dropping that filter leaves this test green (measured).
  // The cost if it ever broke is a stray file (a `README.md`, a `.DS_Store`) reported as an orphan
  // skill directory — a LOUD false boot failure, not a silent pass. The filter gets a real subject
  // the day a plugin's skills tree holds a file, and pinning it earlier would mean either widening
  // BootDeps with a root argument or writing scratch into the checkout.
});
