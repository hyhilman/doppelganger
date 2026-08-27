// Every test builds `deps` from `makeHarness(overrides, onChild)`. `spawnStaggerMs: 0` is
// load-bearing (matches gate.test.ts's own precedent): `spawnChain` in kernel/runtime/pool.ts is
// module-global and never resets, and `node --test` runs one file in one process, so every
// runEntry call in THIS file joins the same chain. At the 2000ms production default this file's
// tests would serialise into over a minute. Group 7, which is about the stagger, is the only test
// that sets a non-zero value (30ms).
//
// Fixtures (`entry`, `program`) are built locally, not imported from host/schedule.test.ts —
// importing a .test.ts file re-runs every test() it registers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn as realSpawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join, dirname } from "node:path";
import {
  runEntry,
  main,
  bootOrDie,
  list,
  realReapOnBoot,
  realShouldShed,
  type SupervisorDeps,
  type BootDeps,
  type SpawnedChild,
  type SpawnFn,
  type Sink,
  type ListOpts,
} from "./supervisor.ts";
import { createGate, type Gate, type Mode } from "../kernel/runtime/gate.ts";
import { pause } from "../kernel/runtime/quota.ts";
import { spawnSlot } from "../kernel/runtime/pool.ts";
import { scriptCommandOf, SCHEDULE, PROGRAMS, supervisedEntries, bootstrapEntries, type ScheduleEntry, type Program } from "./schedule.ts";
import { RESOURCE_NAMES } from "./config.ts";
import { parseLine, type LogLine } from "../kernel/runtime/log/parse.ts";
import { INSTANCE } from "../kernel/instance.ts";
import { pidNamespace } from "../kernel/runtime/proc.ts";
import { leaseDb } from "../kernel/runtime/lease.ts";
import type { Db } from "../kernel/runtime/db.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

function entry(over: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    name: "watch-probe",
    cron: "* * * * *",
    log: join(tmpdir(), "dg-supervisor-unused.log"),
    job: "probe",
    why: "fixture entry for runEntry tests",
    ...over,
  };
}

function program(over: Partial<Program> = {}): Program {
  return { self: true, gate: "excl", dotenv: false, ...over };
}

class FakeChild extends EventEmitter implements SpawnedChild {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killCalls: (NodeJS.Signals | undefined)[] = [];
  kill(signal?: NodeJS.Signals): boolean {
    this.killCalls.push(signal);
    return true;
  }
}

interface SpawnCall {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly opts: { cwd: string; env: NodeJS.ProcessEnv; stdio: readonly ["ignore", "pipe", "pipe"] };
}

interface Harness {
  readonly deps: SupervisorDeps;
  readonly spawnCalls: SpawnCall[];
  readonly children: FakeChild[];
  readonly openSinkCalls: string[];
  readonly sinkContents: Map<string, string>;
  readonly root: string;
}

/** Default child behaviour: exit 0 shortly after being spawned. Override `onChild` for a hang
 *, an `error` event, or scripted stdout/stderr. */
function makeHarness(
  overrides: Partial<SupervisorDeps> = {},
  onChild: (child: FakeChild) => void = (c) => setImmediate(() => c.emit("close", 0, null)),
): Harness {
  const root = mkdtempSync(join(tmpdir(), "dg-supervisor-root-"));
  const spawnCalls: SpawnCall[] = [];
  const children: FakeChild[] = [];
  const openSinkCalls: string[] = [];
  const sinkContents = new Map<string, string>();

  const spawn: SpawnFn = (cmd, args, opts) => {
    spawnCalls.push({ cmd, args, opts });
    const child = new FakeChild();
    children.push(child);
    onChild(child);
    return child;
  };

  const openSink = (path: string): Sink => {
    openSinkCalls.push(path);
    if (!sinkContents.has(path)) sinkContents.set(path, "");
    return {
      write: (chunk: string | Buffer) => {
        sinkContents.set(path, (sinkContents.get(path) ?? "") + String(chunk));
      },
    };
  };

  const gate = createGate(["a", "b", "c"]);

  const deps: SupervisorDeps = {
    root,
    gate,
    programs: { probe: program() },
    refreshWindow: null,
    spawn,
    openSink,
    dotenvPath: join(root, ".env-not-present"),
    now: () => new Date(),
    shouldShed: () => ({ skip: false }),
    maxRunMin: () => 180,
    killGraceMs: 20,
    spawnStaggerMs: 0,
    jobRunner: (job) => [process.execPath, ["-e", `void ${JSON.stringify(job)}`]],
    ...overrides,
  };

  return { deps, spawnCalls, children, openSinkCalls, sinkContents, root };
}

/** Creates an empty stub job file for each name, under `<root>/host/jobs/` — validate() (called by
 *  main(), rule 10) refuses a `job:` entry whose file does not exist. */
function stubJobFiles(root: string, jobs: readonly string[]): void {
  const dir = join(root, "host/jobs");
  mkdirSync(dir, { recursive: true });
  for (const job of jobs) writeFileSync(join(dir, `${job}.ts`), "export {};\n");
}

/** a real, dead-owner `held` claim, written directly (bypassing acquire()'s own owner
 *  generation, the same shape kernel/runtime/lease-reap.test.ts's own seed() uses) so
 *  `realReapOnBoot`'s real `reapDead()` sweep has something genuine to find. `LEASE_DB` must
 *  already be redirected before this is called. */
function seedDeadLease(scope: string, key: string): number {
  const r = spawnSync("/bin/sh", ["-c", "echo $$"], { encoding: "utf8" });
  const pid = Number(r.stdout.trim());
  const ns = pidNamespace() ?? "0";
  const owner = `${INSTANCE}:${hostname()}:${ns}:${pid}:aaaaaaaa`;
  const claimedAt = new Date(Date.now() - 35_000).toISOString(); // older than REAP_GRACE_MS (30s)
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const db: Db = leaseDb();
  db.handle()
    .prepare(
      `INSERT INTO lease_claim (scope, key, owner, status, claimed_at, expires_at, attempts, max_attempts, note, updated_at)
       VALUES (?, ?, ?, 'held', ?, ?, 1, 3, NULL, ?)`,
    )
    .run(scope, key, owner, claimedAt, expiresAt, claimedAt);
  return pid;
}

/** A schedule-entry fixture whose `log` sits under one of main()'s own logRoots for `root`
 *  (`<root>/.doppelganger/logs`), so a boot test's schedule validates without extra plumbing. */
function bootEntry(root: string, over: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    name: "watch-probe",
    cron: "* * * * *",
    log: join(root, ".doppelganger/logs/probe.log"),
    job: "probe",
    why: "fixture entry for main()/bootOrDie() tests",
    ...over,
  };
}

interface FakeTimer {
  readonly entry: ScheduleEntry;
  readonly fn: () => void;
  stopped: boolean;
}

interface BootHarness extends Harness {
  readonly deps: BootDeps;
  readonly newTimerCalls: FakeTimer[];
  readonly exitCalls: number[];
}

/** Builds on makeHarness for spawn/openSink/gate, adding the BootDeps-only fields. `newTimer` is
 *  faked so a test can invoke a tick's callback directly (test 11) instead of waiting on croner. */
function makeBootHarness(
  overrides: Partial<BootDeps> = {},
  onChild: (child: FakeChild) => void = (c) => setImmediate(() => c.emit("close", 0, null)),
): BootHarness {
  const h = makeHarness(undefined, onChild);
  const newTimerCalls: FakeTimer[] = [];
  const exitCalls: number[] = [];
  const newTimer = (e: ScheduleEntry, fn: () => void): { stop(): void } => {
    const timer: FakeTimer = { entry: e, fn, stopped: false };
    newTimerCalls.push(timer);
    return {
      stop: () => {
        timer.stopped = true;
      },
    };
  };
  const deps: BootDeps = {
    ...h.deps,
    programs: {},
    newTimer,
    reapOnBoot: () => [],
    heartbeatPath: join(h.root, ".doppelganger/supervisor.heartbeat"),
    statusPath: join(h.root, ".doppelganger/supervisor.status.json"),
    heartbeatFailPath: join(h.root, ".doppelganger/heartbeat.fail"),
    bootLog: join(h.root, ".doppelganger/logs/supervisor.log"),
    drainMs: 30,
    exit: (code: number) => {
      exitCalls.push(code);
    },
    ...overrides,
  };
  return { ...h, deps, newTimerCalls, exitCalls };
}

/** Captures every line written to stderr (where kernel/runtime/log/emit.ts's logger writes)
 *  during `fn`, parsed with parseLine. Node's test runner runs sibling top-level tests one at a
 *  time by default, so this monkey-patch never overlaps across tests. */
async function withLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: LogLine[] }> {
  const raw: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Buffer): boolean => {
    raw.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = await fn();
    const lines = raw
      .join("")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => parseLine(l))
      .filter((l): l is LogLine => l !== null);
    return { result, lines };
  } finally {
    process.stderr.write = original;
  }
}

function spy(gate: Gate): Gate & {
  acquireCalls: { mode: Mode; resources: readonly string[]; waitMs: number | undefined }[];
  acquireSelfCalls: string[];
} {
  const acquireCalls: { mode: Mode; resources: readonly string[]; waitMs: number | undefined }[] = [];
  const acquireSelfCalls: string[] = [];
  return {
    resources: gate.resources,
    acquire: (mode, resources = [], waitMs) => {
      acquireCalls.push({ mode, resources, waitMs });
      return gate.acquire(mode, resources, waitMs);
    },
    acquireSelf: (key) => {
      acquireSelfCalls.push(key);
      return gate.acquireSelf(key);
    },
    selfHeld: (key) => gate.selfHeld(key),
    state: () => gate.state(),
    acquireCalls,
    acquireSelfCalls,
  };
}

test("1. the happy path", async () => {
  const h = makeHarness();
  const e = entry({ log: join(h.root, "out.log") });
  const { lines } = await withLog(() => runEntry(e, h.deps));

  assert.deepEqual(h.deps.gate.state().resources, {
    a: { readers: 0, writer: false, queued: 0 },
    b: { readers: 0, writer: false, queued: 0 },
    c: { readers: 0, writer: false, queued: 0 },
  });
  assert.equal(h.deps.gate.selfHeld("probe"), false);
  assert.match(h.sinkContents.get(e.log) ?? "", /out\n|err\n|^$/); // no stdout/stderr configured, but the sink was opened
  const ok = lines.filter((l) => l.event === "job-ok");
  assert.equal(ok.length, 1);
  assert.equal(ok[0]!.job, "probe");
});

test("2. the order, proved by a recording gate", async () => {
  // a. a shed tick never touches the gate at all.
  {
    const h = makeHarness(undefined, () => {});
    const gate = spy(h.deps.gate);
    await runEntry(entry(), { ...h.deps, gate, shouldShed: () => ({ skip: true, class: "chore" }) });
    assert.equal(gate.acquireSelfCalls.length, 0);
    assert.equal(gate.acquireCalls.length, 0);
  }
  // b. an entry inside a clearsRefreshWindow window never touches the gate either.
  {
    const h = makeHarness(undefined, () => {});
    const gate = spy(h.deps.gate);
    const window = { opensDow: [0, 1, 2, 3, 4, 5, 6], opensAt: "00:00", lengthMin: 24 * 60, why: "always open" };
    await runEntry(entry({ clearsRefreshWindow: true }), { ...h.deps, gate, refreshWindow: window });
    assert.equal(gate.acquireSelfCalls.length, 0);
    assert.equal(gate.acquireCalls.length, 0);
  }
  // c. a held self-lock never reaches the resource gate.
  {
    const h = makeHarness(undefined, () => {});
    const gate = spy(h.deps.gate);
    const releaseSelf = gate.acquireSelf("probe");
    assert.ok(releaseSelf);
    await runEntry(entry(), { ...h.deps, gate });
    assert.equal(gate.acquireCalls.length, 0);
    releaseSelf();
  }
});

/** Redirects `QUOTA_DB` to a fresh temp file for the duration of `fn`, restoring the prior value
 *  afterwards — the LEASE_DB precedent (test 19/43) applied to quota.ts. */
async function withQuotaDb<T>(fn: () => Promise<T>): Promise<T> {
  const quotaDbPath = join(mkdtempSync(join(tmpdir(), "dg-supervisor-quota-")), "quota.db");
  const previous = process.env.QUOTA_DB;
  process.env.QUOTA_DB = quotaDbPath;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.QUOTA_DB;
    else process.env.QUOTA_DB = previous;
  }
}

test("3. SUP-16: quota-shed — the real predicate, over a real spend park (QTA-08)", async () => {
  await withQuotaDb(async () => {
    pause("claude", "You've hit your org's monthly spend limit · run /usage-credits to ask your admin for a higher limit");

    // nightly-sandcastle is CHORE (host/classes.ts) — skipped outright, never reaches the gate.
    // makeHarness's DEFAULT onChild (never test 3 through the file's own `() => {}` no-op), on
    // purpose: a mutation that stops the skip from firing must turn this test red, not hang it —
    // a fake child that never closes would do the latter (test 45's own first draft, AC5).
    const h = makeHarness();
    const { lines } = await withLog(() =>
      runEntry(entry({ name: "nightly-sandcastle", job: "nightly-sandcastle" }), {
        ...h.deps,
        programs: { "nightly-sandcastle": program() },
        shouldShed: realShouldShed,
      }),
    );
    assert.equal(h.spawnCalls.length, 0);
    const shed = lines.filter((l) => l.event === "quota-shed");
    assert.equal(shed.length, 1);
    assert.equal(shed[0]!.level, "info");
    assert.equal(shed[0]!.fields.class, "chore");
  });
});

test("45. SUP-16: a watch-class program under the SAME wall is NOT skipped — this is the assertion about the predicate, not merely the placement", async () => {
  await withQuotaDb(async () => {
    pause("claude", "You've hit your org's monthly spend limit · run /usage-credits to ask your admin for a higher limit");

    // "ops-cron-check" names no CHORE/REVIEW entry (host/classes.ts) — classOf() defaults it to
    // "watch", which decideShed never skips, so (unlike test 3) this run reaches the real gate
    // and spawn — makeHarness's DEFAULT onChild (a child that emits "close" on the next tick) is
    // what is needed here, not test 3's no-op override.
    const h = makeHarness();
    const { lines } = await withLog(() =>
      runEntry(entry({ name: "ops-cron-check", job: "ops-cron-check" }), {
        ...h.deps,
        programs: { "ops-cron-check": program() },
        shouldShed: realShouldShed,
      }),
    );
    assert.equal(lines.filter((l) => l.event === "quota-shed").length, 0);
    assert.equal(h.spawnCalls.length, 1);
  });
});

test("46. the argv block names the real shouldShed predicate, never an inline literal (J4.10, the realJobRunner/realReapOnBoot precedent)", async () => {
  // realShouldShed's OWN behaviour is proved by tests 3 and 45; the argv block that wires it is
  // untested by construction (N2 ruling 1), so this pins the source text the same way test 42
  // (realJobRunner) and test 43 (realReapOnBoot) already do.
  const { projectPath } = await import("../kernel/paths.ts");
  const src = readFileSync(projectPath("host/supervisor.ts"), "utf8");
  const assignments = src
    .split("\n")
    .filter((l) => l.includes("shouldShed:"))
    .filter((l) => !l.trimStart().startsWith("readonly ")) // the SupervisorDeps interface member
    .map((l) => l.trim());
  assert.deepEqual(
    assignments,
    ["shouldShed: realShouldShed,"],
    "main()'s deps must use the exported realShouldShed — an inline argv literal there is ungated by construction",
  );
});

test("4. SUP-10 / SUP-11: the refresh window", async () => {
  const window = { opensDow: [5, 6], opensAt: "22:50", lengthMin: 91, why: "fixture" };
  // inside the window: log debug refresh-window, no spawn. Run in a CHILD PROCESS with
  // LOG_LEVEL=debug: kernel/runtime/log/emit.ts reads LOG_LEVEL once at import time, so an
  // in-process test (this suite's own default is LOG_LEVEL=info) can never observe a debug-level
  // line — the same reason test/knobs.test.ts uses a scrubbed child for env-dependent defaults.
  {
    const script = `
      import { runEntry } from ${JSON.stringify(join(ROOT, "host/supervisor.ts"))};
      import { createGate } from ${JSON.stringify(join(ROOT, "kernel/runtime/gate.ts"))};
      const deps = {
        root: "/tmp",
        gate: createGate(["a"]),
        programs: { probe: { self: true, gate: "excl", dotenv: false } },
        refreshWindow: { opensDow: [5, 6], opensAt: "22:50", lengthMin: 91, why: "fixture" },
        spawn: () => { throw new Error("must not spawn"); },
        openSink: () => ({ write: () => {} }),
        dotenvPath: "/tmp/.env-not-present",
        now: () => new Date(Date.UTC(2026, 0, 2, 22, 55)),
        shouldShed: () => ({ skip: false }),
        maxRunMin: () => 180,
        killGraceMs: 20,
        spawnStaggerMs: 0,
        jobRunner: (job) => [process.execPath, ["-e", "1"]],
      };
      const e = { name: "watch-probe", cron: "* * * * *", log: "/tmp/x.log", job: "probe", why: "x", clearsRefreshWindow: true };
      await runEntry(e, deps);
    `;
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, LOG_LEVEL: "debug" },
    });
    assert.equal(r.status, 0, `child failed: ${r.stderr}`);
    assert.match(r.stderr, /level=debug job=probe src=ts event=refresh-window/);
  }
  // SUP-11: the flag bounds where a pass may START, never how long it runs — 22:47 (before the
  // window opens at 22:50) legitimately runs.
  {
    const h = makeHarness();
    const now = new Date(Date.UTC(2026, 0, 2, 22, 47));
    await withLog(() => runEntry(entry({ clearsRefreshWindow: true }), { ...h.deps, refreshWindow: window, now: () => now }));
    assert.equal(h.spawnCalls.length, 1);
  }
});

test("5. GAT-06 / GAT-09", async () => {
  // a. two ticks of the same program: the second logs warn lock-held mode=self, no spawn.
  {
    const h = makeHarness(undefined, () => {});
    const releaseSelf = h.deps.gate.acquireSelf("probe");
    assert.ok(releaseSelf);
    const { lines } = await withLog(() => runEntry(entry(), h.deps));
    assert.equal(h.spawnCalls.length, 0);
    const lockHeld = lines.filter((l) => l.event === "lock-held");
    assert.equal(lockHeld.length, 1);
    assert.equal(lockHeld[0]!.level, "warn");
    assert.equal(lockHeld[0]!.fields.mode, "self");
    releaseSelf();
  }
  // b. GAT-09: entry A blocks at the gate with a long gateWait, unawaited; a second tick of A
  // (same program) returns immediately with mode=self — the ticks it waits through are the ticks
  // it forces to skip.
  {
    const h = makeHarness(); // default onChild: exits promptly, so pA can complete once unblocked
    const other = h.deps.gate.acquireSelf("holder");
    assert.ok(other);
    // Take the resource A's writer wants, from a DIFFERENT program's self-lock, so A's acquireSelf
    // succeeds but its gate.acquire() parks.
    const heldResource = await h.deps.gate.acquire("excl", ["a"], 0);
    assert.ok(heldResource);

    const eA = entry({ name: "watch-a", job: "probe", gateWait: true, cron: "*/10 15-21 * * *" });
    const pA = runEntry(eA, { ...h.deps, programs: { probe: program({ gate: "excl", resources: ["a"] }) } }); // NOT awaited
    // give the synchronous acquireSelf + acquire enqueue a chance to run (acquireSelf is
    // synchronous; the gate enqueue inside acquire() is synchronous too).
    await Promise.resolve();
    await Promise.resolve();

    const { lines } = await withLog(() => runEntry(eA, { ...h.deps, programs: { probe: program({ gate: "excl", resources: ["a"] }) } }));
    const lockHeld = lines.filter((l) => l.event === "lock-held" && l.fields.mode === "self");
    assert.equal(lockHeld.length, 1);

    heldResource.release();
    await pA;
    other();
  }
  // c. Step 5's failure path — gate.acquire refuses — releases the self-lock it already holds
  // from step 4. The `finally` in runEntry does this, and a mutation that deletes the
  // `releaseSelf()` call must turn this red. Without the release, this program's self-lock is
  // held for the life of the process and no later tick of it ever runs again — worse than the
  // tick just failing once.
  {
    const h = makeHarness(undefined, () => {});
    const held = await h.deps.gate.acquire("excl", ["a"], 0); // takes what "probe" wants, no wait
    assert.ok(held);
    await runEntry(entry(), { ...h.deps, programs: { probe: program({ gate: "excl", resources: ["a"] }) } });
    assert.equal(
      h.deps.gate.selfHeld("probe"),
      false,
      "GAT-06: the self-lock must release when step 5's gate.acquire refuses",
    );
    held.release();
  }
});

test("6. GAT-08: the derived wait", async () => {
  // with gateWait: true, the waitMs handed to acquire is gateWait(cron) * 1000, and the resulting
  // lock-held line carries waited (in seconds).
  {
    // A FULLY FAKE gate here, not a spy wrapping the real one: the real gate would genuinely wait
    // out the derived 600_000ms budget before returning null — already exhaustively tested in
    // gate.test.ts. This test's concern is narrower — what runEntry HANDS the gate,
    // and what it LOGS when the gate refuses — so the fake refuses immediately while recording the
    // call.
    const h = makeHarness(undefined, () => {});
    const acquireCalls: { mode: Mode; resources: readonly string[]; waitMs: number | undefined }[] = [];
    const gate: Gate = {
      resources: h.deps.gate.resources,
      acquire: async (mode, resources = [], waitMs) => {
        acquireCalls.push({ mode, resources, waitMs });
        return null;
      },
      acquireSelf: (key) => h.deps.gate.acquireSelf(key),
      selfHeld: (key) => h.deps.gate.selfHeld(key),
      state: () => h.deps.gate.state(),
    };
    const e = entry({ gateWait: true, cron: "*/10 15-21 * * *" });
    const { lines } = await withLog(() =>
      runEntry(e, { ...h.deps, gate, programs: { probe: program({ gate: "excl", resources: ["a"] }) } }),
    );
    assert.equal(acquireCalls[0]!.waitMs, 600_000);
    const lockHeld = lines.filter((l) => l.event === "lock-held");
    assert.equal(lockHeld.length, 1);
    assert.equal(lockHeld[0]!.fields.waited, "600");
  }
  // without the flag: waitMs is 0, and no waited field.
  {
    const h = makeHarness(undefined, () => {});
    const held = await h.deps.gate.acquire("excl", ["a"], 0);
    assert.ok(held);
    const gate = spy(h.deps.gate);
    const { lines } = await withLog(() =>
      runEntry(entry(), { ...h.deps, gate, programs: { probe: program({ gate: "excl", resources: ["a"] }) } }),
    );
    assert.equal(gate.acquireCalls[0]!.waitMs, 0);
    const lockHeld = lines.filter((l) => l.event === "lock-held");
    assert.equal(lockHeld.length, 1);
    assert.equal("waited" in lockHeld[0]!.fields, false);
    held.release();
  }
});

test("7. HRN-18's stagger, cross-entry, and the gate it holds", async () => {
  const h = makeHarness(undefined, () => {});
  const started: number[] = [];
  const spawn: SpawnFn = (cmd, args, opts) => {
    started.push(Date.now());
    const child = new FakeChild();
    setImmediate(() => child.emit("close", 0, null));
    return child;
  };
  const eA = entry({ name: "watch-a", job: "watch-a" });
  const eB = entry({ name: "watch-b", job: "watch-b" });
  const deps: SupervisorDeps = {
    ...h.deps,
    spawn,
    spawnStaggerMs: 30,
    programs: { "watch-a": program({ resources: ["a"] }), "watch-b": program({ resources: ["b"] }) },
  };

  const pA = runEntry(eA, deps);
  const pB = runEntry(eB, deps);
  // While B is parked in spawnSlot (behind A's 30ms stagger), it must already hold its gate
  // resource — that is the whole point of placing the stagger after the gate.
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(deps.gate.state().resources.b!.writer, true, "B must hold its resource while parked in the stagger");

  await Promise.all([pA, pB]);
  assert.ok(started.length === 2);
  assert.ok(started[1]! - started[0]! >= 20, `expected >= 20ms between spawns, got ${started[1]! - started[0]!}ms`);
});

test("8. SUP-03: the recorded spawn options", async () => {
  // a job: entry uses jobRunner.
  {
    const h = makeHarness();
    const e = entry({ job: "probe", log: join(h.root, "j.log") });
    await runEntry(e, h.deps);
    assert.equal(h.spawnCalls.length, 1);
    const call = h.spawnCalls[0]!;
    assert.equal(call.opts.cwd, h.root);
    assert.deepEqual(call.opts.stdio, ["ignore", "pipe", "pipe"]);
    assert.deepEqual([call.cmd, call.args], h.deps.jobRunner("probe"));
  }
  // a script: entry uses <root>/<script> — pinned against scriptCommandOf itself (R3),
  // the same shape as the job: branch's deepEqual against jobRunner above, so the two consumers
  // (this spawn and commandOf's crontab line) cannot drift apart silently.
  {
    const h = makeHarness();
    const e = entry({ job: undefined, script: "scripts/probe.sh", log: join(h.root, "s.log") });
    await runEntry(e, { ...h.deps, programs: { "scripts/probe.sh": program() } });
    const call = h.spawnCalls[0]!;
    assert.equal(call.cmd, join(h.root, "scripts/probe.sh"));
    assert.deepEqual(call.args, []);
    assert.deepEqual([call.cmd, call.args], scriptCommandOf(h.root, "scripts/probe.sh"));
  }
  // A .ts script: entry ALSO goes through scriptCommandOf, not an inline reimplementation that
  // only happens to agree with it on the .sh arm — this is what actually discriminates
  // spawnChild's own script dispatch from a hand-inlined `[join(root, script), []]`, which the
  // .sh case above cannot: both shapes render identically for a .sh script.
  {
    const h = makeHarness();
    const e = entry({ job: undefined, script: "scripts/probe.ts", log: join(h.root, "t.log") });
    await runEntry(e, { ...h.deps, programs: { "scripts/probe.ts": program() } });
    const call = h.spawnCalls[0]!;
    assert.deepEqual([call.cmd, call.args], scriptCommandOf(h.root, "scripts/probe.ts"));
    assert.equal(call.cmd, process.execPath);
  }
});

test("9. SUP-04: all three env layers", async () => {
  const root = mkdtempSync(join(tmpdir(), "dg-supervisor-env-"));
  const dotenvPath = join(root, ".env");
  writeFileSync(dotenvPath, "A=dotenv\nONLY_IN_DOTENV=leak-if-broken\n");
  const e = entry({ log: join(root, "out.log"), env: { A: "entry", B: "entry" } });

  // dotenv: true — A=entry (entry wins), B=entry, C present (inherited), ONLY_IN_DOTENV present.
  {
    const h = makeHarness();
    process.env.DG_PROBE_C = "inherited";
    try {
      await runEntry(e, { ...h.deps, root, dotenvPath, programs: { probe: program({ dotenv: true }) } });
    } finally {
      delete process.env.DG_PROBE_C;
    }
    const call = h.spawnCalls[0]!;
    assert.equal(call.opts.env.A, "entry");
    assert.equal(call.opts.env.B, "entry");
    assert.equal(call.opts.env.ONLY_IN_DOTENV, "leak-if-broken");
  }
  // dotenv: false — A=entry still, but ONLY_IN_DOTENV is ABSENT (SUP-04's load-bearing claim).
  {
    const h = makeHarness();
    await runEntry(e, { ...h.deps, root, dotenvPath, programs: { probe: program({ dotenv: false }) } });
    const call = h.spawnCalls[0]!;
    assert.equal(call.opts.env.A, "entry");
    assert.equal("ONLY_IN_DOTENV" in call.opts.env, false, "a key set only in .env must be absent when dotenv: false");
  }
});

test("10. one sink per distinct path", async () => {
  const h = makeHarness();
  const sharedLog = join(h.root, "shared.log");
  const eA = entry({ name: "watch-a", job: "probe", log: sharedLog });
  const eB = entry({ name: "watch-b", job: "probe", log: sharedLog });
  await runEntry(eA, h.deps);
  await runEntry(eB, h.deps);
  assert.equal(h.openSinkCalls.filter((p) => p === sharedLog).length, 1);
});

test("11. SUP-13: the runtime bound", { timeout: 5000 }, async () => {
  const h = makeHarness(undefined, () => {}); // the child never exits on its own
  const e = entry({ maxRunMin: 0.005 }); // 0.3s
  const { lines } = await withLog(() => runEntry(e, { ...h.deps, maxRunMin: () => 0.005, killGraceMs: 20 }));

  const failed = lines.filter((l) => l.event === "job-failed");
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.fields.exit, "-1");
  assert.equal(failed[0]!.fields.signal, "SIGTERM");
  assert.equal(failed[0]!.fields.limitMin, "0.005");

  const child = h.children[0]!;
  assert.deepEqual(child.killCalls, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(h.deps.gate.state().resources, {
    a: { readers: 0, writer: false, queued: 0 },
    b: { readers: 0, writer: false, queued: 0 },
    c: { readers: 0, writer: false, queued: 0 },
  });
});

test("12. one terminal line, never two", { timeout: 5000 }, async () => {
  let child!: FakeChild;
  const h = makeHarness(undefined, (c) => {
    child = c;
  });
  const { lines } = await withLog(async () => {
    await runEntry(entry(), { ...h.deps, maxRunMin: () => 0.005, killGraceMs: 20 });
    // the capped child then (late) emits close, still inside the capture window — must not add a
    // second terminal line.
    child.emit("close", 0, null);
    await new Promise((r) => setImmediate(r));
  });

  const failed = lines.filter((l) => l.event === "job-failed");
  const ok = lines.filter((l) => l.event === "job-ok");
  assert.equal(failed.length, 1);
  assert.equal(ok.length, 0);
});

test("13. spawn failure", async () => {
  const h = makeHarness(undefined, (c) => setImmediate(() => c.emit("error", new Error("ENOENT"))));
  const { lines } = await withLog(() => runEntry(entry(), h.deps));
  const failed = lines.filter((l) => l.event === "job-failed");
  assert.equal(failed.length, 1);
  assert.match(failed[0]!.msg, /spawn failed:/);
  assert.deepEqual(h.deps.gate.state().resources, {
    a: { readers: 0, writer: false, queued: 0 },
    b: { readers: 0, writer: false, queued: 0 },
    c: { readers: 0, writer: false, queued: 0 },
  });
});

test("14. the cause is attached", async () => {
  const h = makeHarness(undefined, (c) => {
    c.stderr.write("first line\nTypeError: boom\n    at somewhere.js:1:1\n");
    setImmediate(() => setImmediate(() => c.emit("close", 3, null)));
  });
  const e = entry({ log: join(h.root, "cause.log") });
  const { lines } = await withLog(() => runEntry(e, h.deps));
  const failed = lines.filter((l) => l.event === "job-failed");
  assert.equal(failed.length, 1);
  assert.match(failed[0]!.msg, /TypeError: boom/);
  assert.equal(failed[0]!.fields.exit, "3");
  assert.equal(failed[0]!.fields.log, e.log);
});

test("15. a real child, once", async () => {
  const root = mkdtempSync(join(tmpdir(), "dg-supervisor-real-"));
  writeFileSync(join(root, "probe.sh"), "#!/usr/bin/env bash\necho hi\necho bad >&2\n");
  chmodSync(join(root, "probe.sh"), 0o755);
  const h = makeHarness();
  const e = entry({ job: undefined, script: "probe.sh", log: join(root, "x.log") });
  // A real sink too, not the in-memory fake: the point of this one test is meeting the REAL API
  // end to end. Synchronous (appendFileSync), not a WriteStream — a stream's internal buffer can
  // still be unflushed when this test reads the file back right after runEntry() resolves, since
  // this sink is never .end()ed (it is cached per path, across entries).
  const openSink = (path: string): Sink => ({
    write: (chunk: string | Buffer) => {
      appendFileSync(path, chunk);
    },
  });
  const { lines } = await withLog(() =>
    runEntry(e, {
      ...h.deps,
      root,
      spawn: realSpawn as unknown as SpawnFn,
      openSink,
      programs: { "probe.sh": program() },
    }),
  );
  const ok = lines.filter((l) => l.event === "job-ok");
  assert.equal(ok.length, 1);
  const content = readFileSync(e.log, "utf8");
  assert.match(content, /hi/);
  assert.match(content, /bad/);
});

test("16. GAT-10: job= is the PROGRAM, not the entry — splitting the counter would disarm the alarm", async () => {
  const h = makeHarness(undefined, () => {});
  const releaseSelf = h.deps.gate.acquireSelf("todo-triage");
  assert.ok(releaseSelf);
  const eWeekday = entry({ name: "todo-triage-weekday", job: "todo-triage" });
  const eWeekend = entry({ name: "todo-triage-weekend", job: "todo-triage" });
  const deps = { ...h.deps, programs: { "todo-triage": program() } };
  const { lines } = await withLog(async () => {
    await runEntry(eWeekday, deps);
    await runEntry(eWeekend, deps);
  });
  const lockHeld = lines.filter((l) => l.event === "lock-held" && l.fields.mode === "self");
  assert.equal(lockHeld.length, 2, "both entries must lose the self-lock");
  assert.equal(lockHeld[0]!.job, "todo-triage");
  assert.equal(lockHeld[1]!.job, "todo-triage");
  releaseSelf();
});

// -------------------------------------------------------------------------------------------
// main(): boot, timers, heartbeat, drain, the loud refusal.
// -------------------------------------------------------------------------------------------

test("17. one newTimer per supervised entry", async () => {
  // SUP-09 (validate() rule 22) refuses more than one entry with supervised: false — a
  // five-entry fixture with two would never pass validate() at all. Four supervised, one
  // bootstrap still proves the same point: newTimer fires for the supervised ones and never for
  // the bootstrap one.
  const h = makeBootHarness();
  stubJobFiles(h.root, ["watch-a", "watch-b", "watch-c", "ops-a"]);
  const schedule = [
    bootEntry(h.root, { name: "watch-a", job: "watch-a" }),
    bootEntry(h.root, { name: "watch-b", job: "watch-b" }),
    bootEntry(h.root, { name: "watch-c", job: "watch-c" }),
    bootEntry(h.root, { name: "ops-a", job: "ops-a", supervised: false }),
  ];
  const programs = Object.fromEntries(schedule.map((e) => [e.job as string, program()]));
  const deps = { ...h.deps, programs };
  const sup = await main(schedule, deps);
  try {
    assert.equal(h.newTimerCalls.length, 3, "newTimer must be called once per SUPERVISED entry");
    const names = h.newTimerCalls.map((c) => c.entry.name).sort();
    assert.deepEqual(names, ["watch-a", "watch-b", "watch-c"]);
    for (const c of h.newTimerCalls) assert.equal(c.entry.cron, "* * * * *");
  } finally {
    await sup.stop("SIGTERM");
  }
});

test("18. validate runs before any timer", async () => {
  const h = makeBootHarness();
  const broken = [bootEntry(h.root, { cron: "not a cron" })];
  await assert.rejects(() => main(broken, { ...h.deps, programs: { probe: program() } }));
  assert.equal(h.newTimerCalls.length, 0, "validate must throw before a single timer registers");
});

test("19. SUP-15's ordering: reapOnBoot runs, and before the first newTimer call — the REAL sweep, not a fake", async () => {
  const h = makeBootHarness();
  stubJobFiles(h.root, ["probe"]);
  const leaseDbPath = join(h.root, "lease.db");
  const previousLeaseDb = process.env.LEASE_DB;
  process.env.LEASE_DB = leaseDbPath;
  try {
    seedDeadLease("job", "probe@2026-08-26T00");
    seedDeadLease("job", "probe@2026-08-26T01");

    const callOrder: string[] = [];
    const reapOnBoot = (): Iterable<Record<string, string | number>> => {
      callOrder.push("reap");
      return realReapOnBoot();
    };
    const newTimer = (e: ScheduleEntry, fn: () => void): { stop(): void } => {
      callOrder.push("newTimer");
      return h.deps.newTimer(e, fn);
    };
    const schedule = [bootEntry(h.root)];
    const { lines } = await withLog(async () => {
      const sup = await main(schedule, { ...h.deps, programs: { probe: program() }, reapOnBoot, newTimer });
      await sup.stop("SIGTERM");
    });
    const reapIndex = callOrder.indexOf("reap");
    const timerIndex = callOrder.indexOf("newTimer");
    assert.ok(reapIndex >= 0 && timerIndex >= 0 && reapIndex < timerIndex, `reap (${reapIndex}) must come before newTimer (${timerIndex})`);
    // The count now comes from rows the real sweep really deleted — both seeded claims.
    const reaped = lines.filter((l) => l.event === "lease-reaped");
    assert.equal(reaped.length, 2);
  } finally {
    if (previousLeaseDb === undefined) delete process.env.LEASE_DB;
    else process.env.LEASE_DB = previousLeaseDb;
  }
});

test("20. a throwing reaper does not stop the boot", async () => {
  const h = makeBootHarness();
  stubJobFiles(h.root, ["probe"]);
  const reapOnBoot = (): Iterable<Record<string, string | number>> => {
    throw new Error("lease db busy");
  };
  const schedule = [bootEntry(h.root)];
  const { lines } = await withLog(async () => {
    const sup = await main(schedule, { ...h.deps, programs: { probe: program() }, reapOnBoot });
    await sup.stop("SIGTERM");
  });
  const failed = lines.filter((l) => l.event === "lease-reap-failed");
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.level, "warn");
  assert.equal(h.newTimerCalls.length, 1, "the timers must still be registered after a reap failure");
});

test("21. SUP-06: bootOrDie sets process.exitCode and writes one stderr line per problem", async () => {
  const h = makeBootHarness();
  stubJobFiles(h.root, ["probe"]);
  const broken = [
    bootEntry(h.root, { name: "nostage" }), // rule 2
    bootEntry(h.root, { name: "watch-other", why: "  " }), // rule 7
  ];
  const prevExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const { lines } = await withLog(() => bootOrDie(broken, { ...h.deps, programs: { probe: program() } }));
    assert.equal(process.exitCode, 1);
    const failed = lines.filter((l) => l.event === "boot-failed");
    assert.equal(failed.length, 2, "one stderr line per broken field");
    assert.ok(failed.some((l) => l.msg.includes('entry "nostage"')));
    assert.ok(failed.some((l) => l.msg.includes('entry "watch-other"')));
  } finally {
    process.exitCode = prevExitCode;
  }
});

test("22. SUP-06 in a real child, so the exit code is real", () => {
  const script = `
    import { bootOrDie } from ${JSON.stringify(join(ROOT, "host/supervisor.ts"))};
    import { createGate } from ${JSON.stringify(join(ROOT, "kernel/runtime/gate.ts"))};
    const deps = {
      root: "/tmp",
      gate: createGate(["a"]),
      programs: {},
      refreshWindow: null,
      spawn: () => { throw new Error("must not spawn"); },
      openSink: () => ({ write: () => {} }),
      dotenvPath: "/tmp/.env-not-present",
      now: () => new Date(),
      shouldShed: () => ({ skip: false }),
      maxRunMin: () => 180,
      killGraceMs: 20,
      spawnStaggerMs: 0,
      jobRunner: (job) => [process.execPath, ["-e", "1"]],
      newTimer: () => ({ stop() {} }),
      heartbeatPath: "/tmp/dg-boot-probe.heartbeat",
      statusPath: "/tmp/dg-boot-probe.status.json",
      bootLog: "/tmp/dg-boot-probe.log",
      drainMs: 30,
      exit: (c) => process.exit(c),
    };
    await bootOrDie([{ name: "ops-x", cron: "bad", log: "/tmp/x.log", why: "w", script: "nope.sh" }], deps);
  `;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "-e", script], { encoding: "utf8" });
  assert.notEqual(r.status, 0, `expected a non-zero exit; stderr: ${r.stderr}`);
  // logfmt escapes the quotes around the entry name inside msg="..." (kernel/runtime/log/emit.ts's
  // renderValue), so the raw (unparsed) stderr text carries \"ops-x\", not "ops-x" — check for the
  // bare name instead of re-deriving the escaping rule here.
  assert.match(r.stderr, /ops-x/);
});

test("23. SUP-14: beat() writes both files, and the stamp changes across calls", async () => {
  const h = makeBootHarness();
  let now = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  const deps = { ...h.deps, now: () => now };

  const { beat } = await import("./supervisor.ts");
  beat(deps);
  const heartbeat1 = readFileSync(deps.heartbeatPath, "utf8");
  assert.match(heartbeat1, /^\d+\n$/);
  const status1 = JSON.parse(readFileSync(deps.statusPath, "utf8"));
  assert.equal(status1.pid, process.pid);
  assert.equal(typeof status1.at, "number");
  assert.ok(status1.gate);
  assert.equal(typeof status1.children, "number");

  now = new Date(Date.UTC(2026, 0, 1, 0, 1, 0));
  beat(deps);
  const heartbeat2 = readFileSync(deps.heartbeatPath, "utf8");
  assert.notEqual(heartbeat1, heartbeat2, "the stamp must change across calls with a different now()");
});

test("24. a failing beat is not fatal, and a failing HEARTBEAT write stamps (J4.13)", async () => {
  const h = makeBootHarness();
  // heartbeatPath points INSIDE a file, so mkdirSync(dirname(...)) fails.
  const blocker = join(h.root, "not-a-dir");
  writeFileSync(blocker, "x");
  const deps = { ...h.deps, heartbeatPath: join(blocker, "sub", "heartbeat") };

  const { beat } = await import("./supervisor.ts");
  const { lines } = await withLog(async () => {
    assert.doesNotThrow(() => beat(deps));
  });
  const failed = lines.filter((l) => l.event === "heartbeat-failed");
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.level, "warn");
  assert.ok(existsSync(deps.heartbeatFailPath), "a failing heartbeat write must stamp heartbeatFailPath (JOB-O11)");
});

test("24b. a SUCCEEDING heartbeat write removes a pre-existing stamp", async () => {
  const h = makeBootHarness();
  mkdirSync(dirname(h.deps.heartbeatFailPath), { recursive: true });
  writeFileSync(h.deps.heartbeatFailPath, "2026-01-01T00:00:00Z stale\n");

  const { beat } = await import("./supervisor.ts");
  beat(h.deps);
  assert.ok(!existsSync(h.deps.heartbeatFailPath), "a successful beat() must remove a stale stamp");
});

test("24c. a failing status.json write does NOT stamp — this is the test the first draft's design would have failed (J4.13 ruling 7)", async () => {
  const h = makeBootHarness();
  const blocker = join(h.root, "not-a-dir-2");
  writeFileSync(blocker, "x");
  const deps = { ...h.deps, statusPath: join(blocker, "sub", "status.json") };

  const { beat } = await import("./supervisor.ts");
  const { lines } = await withLog(async () => {
    beat(deps);
  });
  // The heartbeat write itself must have succeeded — fresh, not stale.
  assert.ok(existsSync(deps.heartbeatPath));
  assert.match(readFileSync(deps.heartbeatPath, "utf8"), /^\d+\n$/);
  const statusFailed = lines.filter((l) => l.event === "status-failed");
  assert.equal(statusFailed.length, 1);
  assert.equal(statusFailed[0]!.level, "warn");
  const heartbeatFailed = lines.filter((l) => l.event === "heartbeat-failed");
  assert.equal(heartbeatFailed.length, 0, "a status.json failure must never be logged as heartbeat-failed");
  assert.ok(
    !existsSync(deps.heartbeatFailPath),
    "a status.json failure alone must NOT stamp — probe 4 would otherwise correct a probe (3) that never fired",
  );
});

test("24d. beat() never throws even when the STAMP path itself is unwritable, and main() still boots", async () => {
  const h = makeBootHarness();
  stubJobFiles(h.root, []);
  // heartbeatFailPath points at a DIRECTORY, so deliveryStamp's own writeFileSync would ENOTDIR —
  // its protection is entirely internal (kernel/runtime/delivery.ts's own try/catch), never
  // beat()'s, because beat() calls stamp() OUTSIDE both of its own try blocks.
  const stampDir = join(h.root, "heartbeat-fail-is-a-dir");
  mkdirSync(stampDir, { recursive: true });
  const deps = { ...h.deps, heartbeatFailPath: stampDir };

  const { beat, main } = await import("./supervisor.ts");
  assert.doesNotThrow(() => beat(deps));

  const { lines } = await withLog(async () => {
    const sup = await main([], deps);
    await sup.stop("SIGTERM");
  });
  assert.ok(lines.some((l) => l.event === "supervisor-up"), "main() must still boot when the stamp path itself is unwritable");
});

test("25. supervisor-up names entries, unsupervised, heartbeat and pid", async () => {
  const h = makeBootHarness();
  stubJobFiles(h.root, ["watch-a", "ops-a"]);
  const schedule = [
    bootEntry(h.root, { name: "watch-a", job: "watch-a" }),
    bootEntry(h.root, { name: "ops-a", job: "ops-a", supervised: false }),
  ];
  const programs = { "watch-a": program(), "ops-a": program() };
  const { lines } = await withLog(async () => {
    const sup = await main(schedule, { ...h.deps, programs });
    await sup.stop("SIGTERM");
  });
  const up = lines.filter((l) => l.event === "supervisor-up");
  assert.equal(up.length, 1);
  assert.equal(up[0]!.fields.entries, "1");
  assert.equal(up[0]!.fields.unsupervised, "1");
  assert.equal(up[0]!.fields.heartbeat, h.deps.heartbeatPath);
  assert.equal(up[0]!.fields.pid, String(process.pid));
  assert.equal(Number(up[0]!.fields.entries) + Number(up[0]!.fields.unsupervised), schedule.length);
});

test("26. drain: SIGTERM every live child, then SIGKILL the stragglers after drainMs", async () => {
  // Children never exit ON THEIR OWN — but a SIGKILL always terminates a REAL process, which
  // fires "close" and is what lets spawnChild()'s own promise resolve (and liveChildren delete
  // the entry). A "dumb" fake whose kill() only records the call, with nothing ever emitting
  // "close", would leave stop()'s poll loop (liveChildren.size === 0) waiting forever — so this
  // fake's kill() simulates that one real consequence.
  const h = makeBootHarness(undefined, (c) => {
    const rawKill = c.kill.bind(c);
    c.kill = (signal?: NodeJS.Signals): boolean => {
      const ok = rawKill(signal);
      if (signal === "SIGKILL") setImmediate(() => c.emit("close", null, "SIGKILL"));
      return ok;
    };
  });
  stubJobFiles(h.root, ["watch-a", "watch-b"]);
  const schedule = [
    bootEntry(h.root, { name: "watch-a", job: "watch-a" }),
    bootEntry(h.root, { name: "watch-b", job: "watch-b" }),
  ];
  const programs = { "watch-a": program({ resources: ["a"] }), "watch-b": program({ resources: ["b"] }) };
  const { lines } = await withLog(async () => {
    const sup = await main(schedule, { ...h.deps, programs, drainMs: 30 });
    // fire both ticks directly, so both entries have a real child in flight. A real (small) delay,
    // not a bare setImmediate: kernel/runtime/pool.ts's spawnSlot chains through a real
    // setTimeout(..., spawnStaggerMs) even at spawnStaggerMs = 0, which is not guaranteed to have
    // settled for BOTH entries within a single setImmediate tick.
    for (const c of h.newTimerCalls) c.fn();
    await new Promise((r) => setTimeout(r, 10));
    await sup.stop("SIGTERM");
  });
  assert.equal(h.children.length, 2);
  for (const c of h.children) {
    assert.deepEqual(c.killCalls, ["SIGTERM", "SIGKILL"]);
  }
  const draining = lines.filter((l) => l.event === "supervisor-draining");
  assert.equal(draining.length, 1);
  assert.equal(draining[0]!.fields.signal, "SIGTERM");
  assert.equal(draining[0]!.fields.children, "2");
  assert.deepEqual(h.exitCalls, [0]);
});

test("27. a tick that throws is caught, and no other timer is affected", async () => {
  const h = makeBootHarness();
  stubJobFiles(h.root, ["watch-a", "watch-b"]);
  const schedule = [
    bootEntry(h.root, { name: "watch-a", job: "watch-a" }),
    bootEntry(h.root, { name: "watch-b", job: "watch-b" }),
  ];
  const programs = { "watch-a": program(), "watch-b": program() };
  const shouldShed = (p: string): { skip: boolean } => {
    if (p === "watch-a") throw new Error("boom");
    return { skip: false };
  };
  const { lines } = await withLog(async () => {
    const sup = await main(schedule, { ...h.deps, programs, shouldShed });
    for (const c of h.newTimerCalls) c.fn();
    await new Promise((r) => setTimeout(r, 10)); // see test 26's comment on spawnSlot's real timer
    await sup.stop("SIGTERM");
  });
  const crashed = lines.filter((l) => l.event === "tick-crashed");
  assert.equal(crashed.length, 1);
  assert.equal(crashed[0]!.level, "error");
  const ok = lines.filter((l) => l.event === "job-ok");
  assert.equal(ok.length, 1, "the OTHER timer's tick must still have run to completion");
});

test("28. the empty schedule boots", async () => {
  const h = makeBootHarness();
  const { lines } = await withLog(async () => {
    const sup = await main([], { ...h.deps, programs: {} });
    assert.equal(h.newTimerCalls.length, 0);
    await sup.stop("SIGTERM");
  });
  const up = lines.filter((l) => l.event === "supervisor-up");
  assert.equal(up.length, 1);
  assert.equal(up[0]!.fields.entries, "0");
  assert.equal(up[0]!.fields.unsupervised, "0");
});

test("29. the argv guard exists", () => {
  const src = readFileSync(join(ROOT, "host/supervisor.ts"), "utf8");
  assert.match(src, /import\.meta\.filename === process\.argv\[1\]/);
  // every test above this one already imported host/supervisor.ts without running a command —
  // structural proof by the fact that this whole file's earlier tests never spawned a real
  // supervisor process as a side effect of the import itself.
});

// -------------------------------------------------------------------------------------------
// list(): a pure function, so these tests call it directly with a local
// six-entry fixture and pin the whole string. `resourceNames` is a local ["a","b","c"], not
// host/config.ts's real RESOURCE_NAMES — the same reasoning as gate.test.ts's own NAMES fixture:
// these tests must not go red because an unrelated plugin adds a resource.
// -------------------------------------------------------------------------------------------

const LIST_RESOURCE_NAMES = ["a", "b", "c"];

test("30. the resolved schedule, printed — one exact string over six entries", () => {
  const eSource = entry({ name: "source-x", job: "source-x", why: "source probe" });
  const eWatch = entry({ name: "watch-a", job: "watch-a", why: "watch probe" });
  const eTodoB = entry({ name: "todo-b", job: "todo-b", why: "todo b probe" });
  const eTodoA = entry({ name: "todo-a", job: "todo-a", why: "todo a probe" });
  const eNightly = entry({
    name: "nightly-sandcastle",
    job: "nightly-sandcastle",
    supervised: false,
    gateWait: true,
    cron: "*/10 15-21 * * *",
    why: "nightly probe",
  });
  const eMisc = entry({ name: "zzz-random", job: "zzz-random", why: "misc probe" });

  // Deliberately NOT in stage order — proves list() regroups regardless of the input array's order.
  const schedule = [eTodoB, eSource, eNightly, eTodoA, eMisc, eWatch];
  const programs: Record<string, Program> = {
    "source-x": program({ gate: "none", self: false, whyNoGate: "no state to protect" }),
    "watch-a": program({ gate: "shared", self: true, dotenv: true }),
    "todo-b": program({ gate: "excl", self: true, resources: ["c", "a"] }),
    "todo-a": program({ gate: "excl", self: false, resources: [] }),
    "nightly-sandcastle": program({ gate: "excl", self: true, resources: ["a"] }),
    "zzz-random": program({ gate: "excl", self: false }),
  };
  const opts: ListOpts = { programs, resourceNames: LIST_RESOURCE_NAMES };

  const expected = [
    "by    entry               cron              program             gate         resources  wait  dotenv",
    "----  ------------------  ----------------  ------------------  -----------  ---------  ----  ------",
    "-- source --",
    "sup   source-x            * * * * *         source-x            none         -          -     -",
    "-- watch --",
    "sup   watch-a             * * * * *         watch-a             shared+self  all        -     env",
    "-- todo --",
    "sup   todo-b              * * * * *         todo-b              excl+self    a+c        -     -",
    "sup   todo-a              * * * * *         todo-a              excl         all        -     -",
    "-- nightly --",
    "cron  nightly-sandcastle  */10 15-21 * * *  nightly-sandcastle  excl+self    a          600s  -",
    "-- misc --",
    "sup   zzz-random          * * * * *         zzz-random          excl         all        -     -",
    "5 supervised, 1 on the real crontab",
  ].join("\n");

  assert.equal(list(schedule, opts), expected);
});

test("31. grouping: stage headers follow STAGES order, and a group's own entries keep fixture order", () => {
  const eNightly = entry({ name: "nightly-x", job: "nightly-x", why: "x" });
  const eSource = entry({ name: "source-y", job: "source-y", why: "y" });
  const eTodoZ = entry({ name: "todo-z", job: "todo-z", why: "z" });
  const eTodoA = entry({ name: "todo-a", job: "todo-a", why: "a" });
  // Input order is nightly, source, todo-z, todo-a — the opposite of STAGES order, and "z" before
  // "a" within todo, which alphabetical order would reverse.
  const schedule = [eNightly, eSource, eTodoZ, eTodoA];
  const programs: Record<string, Program> = {
    "nightly-x": program(),
    "source-y": program(),
    "todo-z": program(),
    "todo-a": program(),
  };
  const out = list(schedule, { programs, resourceNames: LIST_RESOURCE_NAMES });
  const headerLines = out.split("\n").filter((l) => l.startsWith("-- "));
  assert.deepEqual(headerLines, ["-- source --", "-- todo --", "-- nightly --"]);
  const todoBlock = out.split("-- todo --\n")[1]!.split("-- nightly --")[0]!.trim().split("\n");
  assert.equal(todoBlock.length, 2);
  assert.match(todoBlock[0]!, /^sup {2}todo-z /);
  assert.match(todoBlock[1]!, /^sup {2}todo-a /);
});

test("47. J4.15 (TST-17, SUP-17): list(SCHEDULE, ...) over the real, three-entry schedule — two stage groups, both by-columns, both resource shapes, and a DERIVED tally", () => {
  const out = list(SCHEDULE, { programs: PROGRAMS, resourceNames: RESOURCE_NAMES });
  const headerLines = out.split("\n").filter((l) => l.startsWith("-- "));
  assert.deepEqual(headerLines, ["-- nightly --", "-- ops --"]);
  assert.match(out, /\bsup\b/, "at least one supervised entry (by=sup)");
  assert.match(out, /\bcron\b/, "at least one bootstrap entry (by=cron) — ops-watchdog");
  assert.match(out, /\brepo\b/, "nightly-sandcastle's own resource");
  assert.match(out, /\bnone\b/, "the gate: \"none\" programs' own column reading");
  const lastLine = out.trim().split("\n").at(-1)!;
  // Derived from the SAME functions list() itself calls internally — never the literal numbers
  // written a second time here, which is the whole point (AC6: a literal assertion stays green
  // after a fourth entry silently changes the real counts; a derived one does not).
  const expectedTally = `${supervisedEntries(SCHEDULE).length} supervised, ${bootstrapEntries(SCHEDULE).length} on the real crontab`;
  assert.equal(lastLine, expectedTally);
});

test("32. resources: a reader prints \"all\" even when its program names some, a writer prints its own list in the gate's order", () => {
  const eReader = entry({ name: "watch-reader", job: "watch-reader", why: "reader" });
  const eWriter = entry({ name: "watch-writer", job: "watch-writer", why: "writer" });
  const programs: Record<string, Program> = {
    "watch-reader": program({ gate: "shared", resources: ["a"] }),
    "watch-writer": program({ gate: "excl", resources: ["c", "a"] }),
  };
  const out = list([eReader, eWriter], { programs, resourceNames: LIST_RESOURCE_NAMES });
  const lines = out.split("\n").filter((l) => l.startsWith("sup"));
  assert.match(lines[0]!, /\ball\b/, "a reader shows \"all\" even though its program names one resource");
  assert.match(lines[1]!, /\ba\+c\b/, "a writer's own list, reordered into the gate's global a,b,c order");
});

test("33. wait: gateWait:true derives <n>s from the cron; without the flag it is \"-\"", () => {
  const eWait = entry({
    name: "watch-wait",
    job: "watch-wait",
    gateWait: true,
    cron: "*/10 15-21 * * *",
    why: "wait",
  });
  const eNoWait = entry({ name: "watch-nowait", job: "watch-nowait", why: "nowait" });
  const programs: Record<string, Program> = { "watch-wait": program(), "watch-nowait": program() };
  const out = list([eWait, eNoWait], { programs, resourceNames: LIST_RESOURCE_NAMES });
  const lines = out.split("\n").filter((l) => l.startsWith("sup"));
  const waitCol = (line: string): string => line.trim().split(/\s{2,}/)[6]!;
  assert.equal(waitCol(lines[0]!), "600s");
  assert.equal(waitCol(lines[1]!), "-");
});

test("34. gate rendering: excl+self, shared+self, shared, and none all render; none prints resources \"-\"", () => {
  const e1 = entry({ name: "watch-1", job: "watch-1", why: "1" });
  const e2 = entry({ name: "watch-2", job: "watch-2", why: "2" });
  const e3 = entry({ name: "watch-3", job: "watch-3", why: "3" });
  const e4 = entry({ name: "watch-4", job: "watch-4", why: "4" });
  const programs: Record<string, Program> = {
    "watch-1": program({ gate: "excl", self: true }),
    "watch-2": program({ gate: "shared", self: true }),
    "watch-3": program({ gate: "shared", self: false }),
    "watch-4": program({ gate: "none", self: false, whyNoGate: "no state" }),
  };
  const out = list([e1, e2, e3, e4], { programs, resourceNames: LIST_RESOURCE_NAMES });
  const lines = out.split("\n").filter((l) => l.startsWith("sup"));
  assert.match(lines[0]!, /\bexcl\+self\b/);
  assert.match(lines[1]!, /\bshared\+self\b/);
  assert.match(lines[2]!, /\bshared\b(?!\+)/);
  assert.match(lines[3]!, /\bnone\b/);
  assert.match(lines[3]!, / none\s+-\s+-\s+-\s*$/, "none's resources column is \"-\"");
});

test("35. tally counts supervisedEntries/bootstrapEntries, not schedule.length", () => {
  const eSup1 = entry({ name: "watch-sup1", job: "watch-sup1", why: "s1" });
  const eSup2 = entry({ name: "watch-sup2", job: "watch-sup2", why: "s2" });
  const eBoot = entry({ name: "watch-boot", job: "watch-boot", supervised: false, why: "b" });
  const programs: Record<string, Program> = {
    "watch-sup1": program(),
    "watch-sup2": program(),
    "watch-boot": program(),
  };
  const out = list([eSup1, eSup2, eBoot], { programs, resourceNames: LIST_RESOURCE_NAMES });
  const tally = out.split("\n").at(-1);
  assert.equal(tally, "2 supervised, 1 on the real crontab");
});

test("36. an entry whose program has no PROGRAMS row prints \"??\", never throws", () => {
  const eMissing = entry({ name: "watch-missing", job: "watch-missing", why: "missing" });
  assert.doesNotThrow(() => list([eMissing], { programs: {}, resourceNames: LIST_RESOURCE_NAMES }));
  const out = list([eMissing], { programs: {}, resourceNames: LIST_RESOURCE_NAMES });
  const row = out.split("\n").find((l) => l.startsWith("sup"))!;
  assert.match(row, /\?\?/);
  assert.equal((row.match(/\?\?/g) ?? []).length, 3, "gate, resources and dotenv all print ??");
});

test("37. the empty schedule prints a header, a rule, and a 0/0 tally", () => {
  const out = list([], { programs: {}, resourceNames: LIST_RESOURCE_NAMES });
  const lines = out.split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /^by\s+entry\s+cron\s+program\s+gate\s+resources\s+wait\s+dotenv$/);
  assert.match(lines[1]!, /^-+(\s\s-+)+$/);
  assert.equal(lines[2], "0 supervised, 0 on the real crontab");
});

// ---------------------------------------------------------------------------------------------
// F7 (N2 VERIFY) — three named behaviours that never ran under `npm test`: runEntry's TWO
// drain-skipped pre-flight checks (steps 6 and 8), and main()'s onTerm/onInt/onUnhandled bodies.
// Appended here rather than interleaved with the runEntry/main() groups above, to avoid
// renumbering every test after them — these are new coverage, not a sub-block of an existing one.
// ---------------------------------------------------------------------------------------------

/** An `isDraining` that returns the Nth entry of `script` on its Nth call (1-indexed), and `true`
 *  (the safe default — never spawn) once `script` is exhausted. `.calls()` records how many times
 *  it fired — a documentation aid below, NOT the mutation discriminator: see test 38's own comment
 *  for why call-counting alone cannot tell step 6 apart from step 8. */
function scriptedIsDraining(script: readonly boolean[]): { fn: () => boolean; calls: () => number } {
  let n = 0;
  const fn = (): boolean => {
    const v = script[n] ?? true;
    n++;
    return v;
  };
  return { fn, calls: () => n };
}

test("38. step 6's drain-skipped fires between the gate and spawnSlot, never reaching spawn", { timeout: 5000 }, async () => {
  // WHY A spawnSlot PROBE, NOT JUST CALL-COUNTING: with a 2-element script, a DELETED step 6 does
  // not skip the drain-skipped log at all — it just shifts step 8 into consuming the same 2nd
  // `true` value, AFTER first really awaiting spawnSlot. spawnCalls stays 0 and drain-skipped
  // still logs once EITHER way, so neither assertion tells step 6 firing apart from step 8 firing
  // in its place.
  //
  // What a deleted step 6 cannot hide: `spawnSlot` (kernel/runtime/pool.ts) delays its NEXT
  // caller, not itself — `spawnSlot(300)` returns almost immediately but queues a real 300ms wait
  // for whoever calls `spawnSlot` after it. So probing with our OWN `spawnSlot(0)` call right
  // after `runEntry` returns tells us whether `runEntry` called `spawnSlot` at all: if step 6 fired
  // (never reached step 7), the probe resolves at once; if step 6 was skipped and step 7 really
  // ran, the probe inherits its queued 300ms wait. `maxRunMin` is dropped to a fraction of a
  // second too, so a mutation that DOES fall through to a real spawn (this harness's child never
  // closes on its own) fails in well under a second, not 180 minutes.
  await spawnSlot(0); // drain any pending stagger left by an earlier test, so the probe starts clean
  const h = makeHarness(undefined, () => {}); // spawn must never be called
  const script = scriptedIsDraining([false, true]); // 1 (pre-flight step 1): not draining · 2 (step 6): draining
  const deps: SupervisorDeps = { ...h.deps, spawnStaggerMs: 300, maxRunMin: () => 0.01 };
  const { lines } = await withLog(() => runEntry(entry(), deps, script.fn));
  assert.equal(h.spawnCalls.length, 0, "must never reach spawn");
  const drainSkipped = lines.filter((l) => l.event === "drain-skipped");
  assert.equal(drainSkipped.length, 1);
  assert.equal(drainSkipped[0]!.level, "info");
  assert.equal(script.calls(), 2, "isDraining fires exactly twice on the correct path");
  const t0 = Date.now();
  await spawnSlot(0);
  const probeElapsed = Date.now() - t0;
  assert.ok(
    probeElapsed < 150,
    `runEntry must never have called spawnSlot (step 6 must return first) — probe took ${probeElapsed}ms`,
  );
  assert.equal(h.deps.gate.selfHeld("probe"), false, "the self-lock and gate both release on this path too");
});

test("39. step 8's drain-skipped fires between spawnSlot and spawn, never reaching spawn", { timeout: 5000 }, async () => {
  // `maxRunMin` dropped for the same reason test 38's comment gives: a mutation that deletes step
  // 8 falls through to a real spawn, and this harness's child never closes on its own — without a
  // short runtime bound that is a 180-minute hang instead of a fast, clean RED.
  const h = makeHarness(undefined, () => {}); // spawn must never be called
  const script = scriptedIsDraining([false, false, true]); // step 1, step 6: not draining · step 8: draining
  const deps: SupervisorDeps = { ...h.deps, maxRunMin: () => 0.01 };
  const { lines } = await withLog(() => runEntry(entry(), deps, script.fn));
  assert.equal(h.spawnCalls.length, 0, "must never reach spawn — the direct proof step 8 fired, not a fallthrough");
  const drainSkipped = lines.filter((l) => l.event === "drain-skipped");
  assert.equal(drainSkipped.length, 1);
  assert.equal(drainSkipped[0]!.level, "info");
  assert.equal(script.calls(), 3, "isDraining fires exactly three times on the correct path");
  assert.equal(h.deps.gate.selfHeld("probe"), false);
});

test("40. SUP-06: onTerm and onInt are real process.on listeners, not just stop() called by hand", async () => {
  // a. SIGTERM. process.emit(...) invokes registered listeners synchronously — it never delivers
  // a real OS signal — so this is safe to run in this process. main() registers onTerm via
  // `process.on("SIGTERM", onTerm)`; onTerm's own body then drives the exact same stop() path
  // test 26 already covers by calling stop() directly. What THIS proves is the WIRING: that a real
  // "SIGTERM" event reaches it at all.
  {
    const h = makeBootHarness();
    const originalExit = h.deps.exit;
    let resolveExited!: () => void;
    const exited = new Promise<void>((res) => (resolveExited = res));
    const deps: BootDeps = { ...h.deps, exit: (code: number) => { originalExit(code); resolveExited(); } };
    const { lines } = await withLog(async () => {
      const sup = await main([], { ...deps, programs: {} });
      assert.equal(sup.draining(), false);
      process.emit("SIGTERM");
      await exited;
      assert.equal(sup.draining(), true);
    });
    assert.deepEqual(h.exitCalls, [0]);
    const draining = lines.filter((l) => l.event === "supervisor-draining");
    assert.equal(draining.length, 1);
    assert.equal(draining[0]!.fields.signal, "SIGTERM");
  }
  // b. SIGINT — the same wiring, the other signal.
  {
    const h = makeBootHarness();
    const originalExit = h.deps.exit;
    let resolveExited!: () => void;
    const exited = new Promise<void>((res) => (resolveExited = res));
    const deps: BootDeps = { ...h.deps, exit: (code: number) => { originalExit(code); resolveExited(); } };
    const { lines } = await withLog(async () => {
      const sup = await main([], { ...deps, programs: {} });
      process.emit("SIGINT");
      await exited;
      assert.equal(sup.draining(), true);
    });
    assert.deepEqual(h.exitCalls, [0]);
    const draining = lines.filter((l) => l.event === "supervisor-draining");
    assert.equal(draining.length, 1);
    assert.equal(draining[0]!.fields.signal, "SIGINT");
  }
});

test("41. SUP-06: onUnhandled logs unhandled-rejection at error level and does not exit", async () => {
  // NOT process.emit("unhandledRejection", ...): node:test installs its OWN process-level
  // unhandledRejection listener to detect a real test failure, and emitting the event invokes
  // every listener including that one — this test's own "boom" would fail ITSELF as an unhandled
  // rejection before ever reaching an assertion. Instead: diff `process.listeners(...)` before and
  // after main() to find the ONE new listener main() really registered via `process.on(...)`
  // (proving the wiring, not just calling a hand-picked function), and invoke only that one.
  const h = makeBootHarness();
  const { lines } = await withLog(async () => {
    const before = process.listeners("unhandledRejection");
    const sup = await main([], { ...h.deps, programs: {} });
    const after = process.listeners("unhandledRejection");
    const added = after.filter((l) => !before.includes(l));
    assert.equal(added.length, 1, "main() must register exactly one new unhandledRejection listener");
    (added[0] as (reason: unknown, promise: Promise<unknown>) => void)(new Error("boom"), Promise.resolve());
    assert.equal(sup.draining(), false, "an unhandled rejection must not start a drain");
    await sup.stop("SIGTERM"); // clean up this test's process.on listeners before the next test runs
  });
  const unhandled = lines.filter((l) => l.event === "unhandled-rejection");
  assert.equal(unhandled.length, 1);
  assert.equal(unhandled[0]!.level, "error");
  assert.match(unhandled[0]!.msg, /boom/);
  assert.deepEqual(h.exitCalls, [0], "only stop()'s own exit fires — the rejection itself never exits");
});

test("42. N3 F1: the real jobRunner spawns host/run.ts, and main() uses it (SUP-03)", async () => {
  const { realJobRunner } = await import("./supervisor.ts");
  const { projectPath } = await import("../kernel/paths.ts");
  // The value, pinned with the path spelled HERE — not read from JOB_ENTRYPOINT — so pointing the
  // constant (or realJobRunner) at the job file goes red, rather than a silent no-op passing with
  // the whole suite green.
  const [cmd, args] = realJobRunner("probe");
  assert.equal(cmd, process.execPath);
  assert.deepEqual([...args], [projectPath("host/run.ts"), "probe"]);
  // And the untestable argv block in main() must READ realJobRunner, not carry its own literal —
  // a source scan, doors-5/6 shape, because the deps literal itself can never run under the suite.
  const src = readFileSync(projectPath("host/supervisor.ts"), "utf8");
  const assignments = src.split("\n")
    .filter((l) => l.includes("jobRunner:"))
    .filter((l) => !l.trimStart().startsWith("readonly ")) // the SupervisorDeps interface member
    .map((l) => l.trim());
  assert.deepEqual(assignments, ["jobRunner: realJobRunner,"],
    "main()'s deps must use the exported realJobRunner — an inline argv literal there is ungated by construction");
});

test("43. J4.6: the argv block names the real reapOnBoot predicate, never an inline literal", async () => {
  const { projectPath } = await import("../kernel/paths.ts");
  // The child-driver test (44) proves main() + realReapOnBoot; it cannot reach the argv block,
  // which is untestable by construction. A source-text assertion pins the other half — the same
  // realJobRunner precedent as test 42 — because an inline arrow literal there could regress with
  // the whole suite green.
  const src = readFileSync(projectPath("host/supervisor.ts"), "utf8");
  const assignments = src
    .split("\n")
    .filter((l) => l.includes("reapOnBoot:"))
    .filter((l) => !l.trimStart().startsWith("readonly ")) // the BootDeps interface member
    .map((l) => l.trim());
  assert.deepEqual(
    assignments,
    ["reapOnBoot: realReapOnBoot,"],
    "main()'s deps must use the exported realReapOnBoot — an inline argv literal there is ungated by construction",
  );
});

test("44. J4.6: main() + realReapOnBoot in a real child process — this IS the phase gate", async () => {
  // Both faults are named rather than quietly fixed: (a) spawnSync on a supervisor that never
  // exits blocks forever — this uses `spawn` with a stderr reader and kills the child on the line
  // it is waiting for. (b) an
  // ENGINE_ROOT pointed at a fixture makes ROOT the fixture, so validate() looks for
  // <fixture>/host/jobs/nightly-sandcastle.ts, throws, and no lease-reaped line is ever emitted —
  // AND keeping ROOT real is not the answer either, because the real argv block imports the real
  // SCHEDULE and registers a real croner timer for nightly-sandcastle at 38 16-21 * * *, and a
  // test that happens to run at :38 in one of those hours would spawn a real, paid agent run.
  //
  // The resolution: the child is a three-line driver this test writes into its own temp
  // directory, importing `main` and `realReapOnBoot` from the REAL module and calling
  // `main([], { ...realDeps, reapOnBoot: realReapOnBoot })` — an EMPTY schedule, which
  // `validate([])` accepts by decision and which registers no timer at all. Everything else is
  // real: the real reapDead, the real parseOwner, the real /proc, the real openDb, the real
  // main() boot order. LEASE_DB is redirected to this test's own temp file; no other path is
  // redirected, so ROOT stays the checkout and nothing else moves.
  const driverDir = mkdtempSync(join(tmpdir(), "dg-supervisor-driver-"));
  const leaseDbPath = join(driverDir, "lease.db");
  const heartbeatPath = join(driverDir, "supervisor.heartbeat");
  const statusPath = join(driverDir, "supervisor.status.json");

  const previousLeaseDb = process.env.LEASE_DB;
  process.env.LEASE_DB = leaseDbPath;
  let seededPid: number;
  let seededKey = "";
  try {
    seededPid = seedDeadLease("job", "driver-probe@2026-08-26T00");
    seededKey = "driver-probe@2026-08-26T00";
  } finally {
    if (previousLeaseDb === undefined) delete process.env.LEASE_DB;
    else process.env.LEASE_DB = previousLeaseDb;
  }

  const supervisorPath = join(ROOT, "host/supervisor.ts");
  const driverPath = join(driverDir, "driver.mjs");
  writeFileSync(
    driverPath,
    [
      `import { main, realReapOnBoot } from ${JSON.stringify(supervisorPath)};`,
      `import { createGate } from ${JSON.stringify(join(ROOT, "kernel/runtime/gate.ts"))};`,
      `const deps = {`,
      `  root: ${JSON.stringify(ROOT)},`,
      `  gate: createGate(["repo", "skills"]),`,
      `  programs: {},`,
      `  refreshWindow: null,`,
      `  spawn: (await import("node:child_process")).spawn,`,
      `  openSink: () => ({ write: () => {} }),`,
      `  dotenvPath: ${JSON.stringify(join(driverDir, ".env-not-present"))},`,
      `  now: () => new Date(),`,
      `  shouldShed: () => ({ skip: false }),`,
      `  maxRunMin: () => 180,`,
      `  killGraceMs: 10,`,
      `  spawnStaggerMs: 0,`,
      `  jobRunner: (job) => [process.execPath, ["-e", "0"]],`,
      `  reapOnBoot: realReapOnBoot,`,
      `  newTimer: () => ({ stop() {} }),`,
      `  heartbeatPath: ${JSON.stringify(heartbeatPath)},`,
      `  statusPath: ${JSON.stringify(statusPath)},`,
      `  bootLog: ${JSON.stringify(join(driverDir, "supervisor.log"))},`,
      `  drainMs: 30,`,
      `  exit: (code) => process.exit(code),`,
      `};`,
      `await main([], deps);`,
    ].join("\n"),
  );

  // SUP-03: the real supervisor's own children always run with cwd = ROOT, never the directory
  // holding the driver script — matched here rather than only for convenience, because a random
  // mkdtempSync basename (mixed case) fails kernel/instance.ts's INSTANCE fallback validation and
  // crashes the child at import time, before it can print anything this test is waiting for.
  const child = realSpawn(process.execPath, [driverPath], {
    cwd: ROOT,
    env: { ...process.env, LEASE_DB: leaseDbPath },
    stdio: ["ignore", "ignore", "pipe"],
  });

  const stderrChunks: string[] = [];
  const seenUp = (): boolean => stderrChunks.join("").includes("event=supervisor-up");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for supervisor-up")), 10_000);
    child.stderr!.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
      if (seenUp()) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("error", reject);
  });

  const stderrAtStop = stderrChunks.join("");
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.on("close", () => resolve()));

  const reapedIdx = stderrAtStop.indexOf("event=lease-reaped");
  const upIdx = stderrAtStop.indexOf("event=supervisor-up");
  assert.ok(reapedIdx >= 0, `expected a lease-reaped line, got:\n${stderrAtStop}`);
  assert.ok(upIdx >= 0);
  assert.ok(reapedIdx < upIdx, "lease-reaped must appear before supervisor-up, by byte offset");
  assert.match(stderrAtStop, new RegExp(`key=${seededKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(stderrAtStop, /ttlLeftMin=\d/);

  process.env.LEASE_DB = leaseDbPath;
  try {
    const { read } = await import("../kernel/runtime/lease.ts");
    assert.equal(read("job", seededKey), null, "the seeded row must really be gone");
  } finally {
    if (previousLeaseDb === undefined) delete process.env.LEASE_DB;
    else process.env.LEASE_DB = previousLeaseDb;
  }

  void seededPid;
});
