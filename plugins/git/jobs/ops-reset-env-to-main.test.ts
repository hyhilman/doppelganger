// JOB-G09/10/11/12 — reset-env-to-main against a real bare origin. This job writes the remote, so
// every test reads origin's refs directly rather than trusting the job's own report.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupWorkspaces, git, head, recorder, workspace, type Workspace } from "../repo.fixture.ts";
import { scopeFrom, type GitScope } from "../scope.ts";
import type { EnvSpec } from "../../../kernel/plugin.ts";
import type { Git } from "../git.ts";
import { runResetEnvToMain, resetEnvToMainKnobs, GIT_NO_RECUT_ENV, type ResetEnvToMainKnobs } from "./ops-reset-env-to-main.ts";

after(cleanupWorkspaces);

const reader = (env: Record<string, string>) => ({ env: { str: (spec: EnvSpec): string => env[spec.key] ?? spec.default ?? "" } });
const NOW = new Date("2026-09-26T00:40:00Z");
const BACKUP = "backup/staging-pre-reset-2026-09-26";

function scope(over: Partial<GitScope> = {}): GitScope {
  return { ...scopeFrom(reader({})), repos: ["api"], recutRepos: ["api"], ...over };
}

function run(root: string, knobs: Partial<ResetEnvToMainKnobs> = {}, g: Git = git) {
  const rec = recorder();
  const result = runResetEnvToMain({
    root,
    git: g,
    say: rec.say,
    log: rec.log,
    now: () => NOW,
    knobs: { scope: scope(), killed: false, dryRun: false, force: false, date: "", ...knobs },
  });
  return { ...rec, result };
}

/** origin: main at "second", staging one commit off the old main, development at the old main. */
function envWorkspace(): Workspace & { stagingHead: string } {
  const ws = workspace(["api"], ["staging", "development"]);
  const stagingHead = ws.upstream("staging", "s.txt", "staging only\n", "staging only");
  return { ...ws, stagingHead };
}

const originRef = (ws: Workspace, ref: string): string | null => {
  try {
    return head(ws.origin, `refs/heads/${ref}`);
  } catch {
    return null;
  }
};
const originRefs = (ws: Workspace): string => git(ws.origin, "for-each-ref", "--format=%(refname) %(objectname)");

test("1. JOB-G11: main or master in RECUT_BRANCHES refuses the whole run before any fetch", () => {
  for (const bad of ["main", "master"]) {
    const ws = envWorkspace();
    const stale = head(ws.repo("api"), "refs/remotes/origin/main");
    const r = run(ws.root, { scope: scope({ recutBranches: ["staging", bad] }) });
    assert.equal(r.result.exitCode, 1);
    assert.deepEqual(r.lines, [`[reset-env-to-main] ✗  refusing to run: '${bad}' is a re-cut TARGET in RECUT_BRANCHES`]);
    assert.deepEqual(r.logs.map((l) => [l.level, l.event, l.fields.branch]), [["error", "bad-config", bad]]);
    assert.equal(head(ws.repo("api"), "refs/remotes/origin/main"), stale, "no fetch ran");
    assert.equal(originRef(ws, "staging"), ws.stagingHead, "origin untouched");
  }
});

test("2. JOB-G09/G10/G12: backs up first, then re-cuts every env branch to main", () => {
  const ws = envWorkspace();
  const main = originRef(ws, "main")!;
  const r = run(ws.root);
  assert.equal(r.result.exitCode, 0, r.out());
  assert.equal(r.result.recut, 2, r.out());
  assert.equal(originRef(ws, "staging"), main);
  assert.equal(originRef(ws, "development"), main);
  assert.equal(originRef(ws, BACKUP), ws.stagingHead, "the only way back is on origin");
  assert.ok(originRef(ws, "backup/development-pre-reset-2026-09-26") !== null);
  assert.match(r.out(), /✓  api:staging — [0-9a-f]{8} → main [0-9a-f]{8} \(1 commit\(s\) not on main, saved at backup\/staging-pre-reset-2026-09-26\)/);
  assert.equal(originRef(ws, "master"), null);

  const again = run(ws.root);
  assert.equal(again.result.current, 2);
  assert.match(again.out(), /=  api:staging — already at main /);
});

test("3. JOB-G10: today's backup already at head is a resumed run — no second backup, the re-cut proceeds", () => {
  const ws = envWorkspace();
  git(ws.seed, "push", "-q", "origin", `${ws.stagingHead}:refs/heads/${BACKUP}`);
  const r = run(ws.root, { scope: scope({ recutBranches: ["staging"] }) });
  assert.equal(r.result.recut, 1, r.out());
  assert.equal(originRef(ws, "staging"), originRef(ws, "main"));
  assert.equal(originRef(ws, BACKUP), ws.stagingHead);
});

test("4. JOB-G10: today's backup at a DIFFERENT commit refuses; RECUT_FORCE=1 snapshots the new head beside it", () => {
  const ws = envWorkspace();
  const old = git(ws.seed, "rev-parse", "origin/main~1").trim();
  git(ws.seed, "push", "-q", "origin", `${old}:refs/heads/${BACKUP}`);

  const refused = run(ws.root, { scope: scope({ recutBranches: ["staging"] }) });
  assert.equal(refused.result.skipped, 1);
  assert.equal(refused.result.exitCode, 0, "a refusal is not a failure");
  assert.match(refused.out(), /exists at [0-9a-f]{8}, head moved to [0-9a-f]{8}, refused \(RECUT_FORCE=1 to snapshot both\)/);
  assert.equal(originRef(ws, "staging"), ws.stagingHead);

  const forced = run(ws.root, { scope: scope({ recutBranches: ["staging"] }), force: true });
  assert.equal(forced.result.recut, 1, forced.out());
  assert.equal(originRef(ws, BACKUP), old, "the first backup is kept");
  assert.equal(originRef(ws, `${BACKUP}-${ws.stagingHead.slice(0, 8)}`), ws.stagingHead);
  assert.equal(originRef(ws, "staging"), originRef(ws, "main"));
});

test("5. SAF-01: a dry run fetches and pushes nothing", () => {
  const ws = envWorkspace();
  const before = originRefs(ws);
  const r = run(ws.root, { dryRun: true });
  assert.match(r.out(), /DRY RUN — no refs will be pushed/);
  assert.match(r.out(), /·  api:staging — would back up [0-9a-f]{8} → backup\/staging-pre-reset-2026-09-26, then re-cut to main [0-9a-f]{8} \(1 commit\(s\) not on main\)/);
  assert.equal(r.result.recut, 0, "a dry run counts nothing as re-cut");
  assert.equal(originRefs(ws), before);
});

test("6. JOB-G10: the lease — origin moving after the snapshot rejects the re-cut, and the backup stands", () => {
  const ws = envWorkspace();
  let moved = "";
  const racing: Git = (dir, ...args) => {
    if (args.some((a) => a.startsWith("--force-with-lease=refs/heads/staging:"))) {
      moved = ws.upstream("staging", "race.txt", "pushed meanwhile\n", "someone pushed");
    }
    return git(dir, ...args);
  };
  const r = run(ws.root, { scope: scope({ recutBranches: ["staging"] }) }, racing);
  assert.equal(r.result.exitCode, 1);
  assert.match(r.out(), /re-cut push rejected \(origin moved, or no push access\); backup at backup\/staging-pre-reset-2026-09-26 stands/);
  assert.equal(originRef(ws, "staging"), moved, "the concurrent push survives");
  assert.equal(originRef(ws, BACKUP), ws.stagingHead);
  assert.equal(r.logs.at(-1)!.event, "recut-failed");
});

test("7. the kill switch stops the job before anything; an empty scope does nothing", () => {
  const ws = envWorkspace();
  const before = originRefs(ws);
  const killed = run(ws.root, { killed: true });
  assert.deepEqual(killed.lines, []);
  assert.deepEqual(killed.logs.map((l) => l.event), ["killed"]);
  const empty = run(ws.root, { scope: scope({ recutRepos: [] }) });
  assert.deepEqual(empty.logs.map((l) => l.event), ["no-scope"]);
  assert.equal(originRefs(ws), before);

  assert.equal(GIT_NO_RECUT_ENV.key, "GIT_NO_RECUT");
  assert.equal(resetEnvToMainKnobs(reader({ GIT_NO_RECUT: "1" })).killed, true);
  assert.throws(() => resetEnvToMainKnobs(reader({ GIT_NO_RECUT: "true" })), /GIT_NO_RECUT/);
  assert.deepEqual(scopeFrom(reader({})).recutRepos, [], "and empty is the default");
});

test("8. a bad RECUT_DATE refuses before any fetch", () => {
  const ws = envWorkspace();
  const r = run(ws.root, { date: "26/09/2026" });
  assert.equal(r.result.exitCode, 1);
  assert.match(r.out(), /refusing to run: RECUT_DATE '26\/09\/2026' is not YYYY-MM-DD/);
});
