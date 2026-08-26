// J2.11 (SUP-03, SUP-04, SUP-11, SUP-13, SUP-16, GAT-08, GAT-09) — runEntry, end to end.
//
// Every test builds `deps` from `makeHarness(overrides, onChild)`. `spawnStaggerMs: 0` is
// load-bearing (matches gate.test.ts's own precedent): `spawnChain` in kernel/runtime/pool.ts is
// module-global and never resets, and `node --test` runs one file in one process, so every
// runEntry call in THIS file joins the same chain. At the 2000ms production default this file's
// tests would serialise into over a minute. Group 7, which is about the stagger, is the only test
// that sets a non-zero value (30ms).
//
// Fixtures (`entry`, `program`) are built locally, not imported from host/schedule.test.ts — the
// same reason as J2.9/J2.10: importing a .test.ts file re-runs every test() it registers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn as realSpawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEntry, type SupervisorDeps, type SpawnedChild, type SpawnFn, type Sink } from "./supervisor.ts";
import { createGate, type Gate, type Mode } from "../kernel/runtime/gate.ts";
import type { ScheduleEntry, Program } from "./schedule.ts";
import { parseLine, type LogLine } from "../kernel/runtime/log/parse.ts";

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
 *  (SUP-13), an `error` event, or scripted stdout/stderr. */
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

test("3. SUP-16: quota-shed", async () => {
  const h = makeHarness(undefined, () => {});
  const { lines } = await withLog(() =>
    runEntry(entry(), { ...h.deps, shouldShed: () => ({ skip: true, class: "chore" }) }),
  );
  assert.equal(h.spawnCalls.length, 0);
  const shed = lines.filter((l) => l.event === "quota-shed");
  assert.equal(shed.length, 1);
  assert.equal(shed[0]!.level, "info");
  assert.equal(shed[0]!.fields.class, "chore");
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
    // synchronous; the gate enqueue inside acquire() is synchronous too, per J2.4/J2.5).
    await Promise.resolve();
    await Promise.resolve();

    const { lines } = await withLog(() => runEntry(eA, { ...h.deps, programs: { probe: program({ gate: "excl", resources: ["a"] }) } }));
    const lockHeld = lines.filter((l) => l.event === "lock-held" && l.fields.mode === "self");
    assert.equal(lockHeld.length, 1);

    heldResource.release();
    await pA;
    other();
  }
});

test("6. GAT-08: the derived wait", async () => {
  // with gateWait: true, the waitMs handed to acquire is gateWait(cron) * 1000, and the resulting
  // lock-held line carries waited (in seconds).
  {
    // A FULLY FAKE gate here, not a spy wrapping the real one: the real gate would genuinely wait
    // out the derived 600_000ms budget before returning null, which is J2.5's own concern (already
    // exhaustively tested there). This test's concern is narrower — what runEntry HANDS the gate,
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
  // a script: entry uses <root>/<script>.
  {
    const h = makeHarness();
    const e = entry({ job: undefined, script: "scripts/probe.sh", log: join(h.root, "s.log") });
    await runEntry(e, { ...h.deps, programs: { "scripts/probe.sh": program() } });
    const call = h.spawnCalls[0]!;
    assert.equal(call.cmd, join(h.root, "scripts/probe.sh"));
    assert.deepEqual(call.args, []);
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

test("11. SUP-13: the runtime bound", async () => {
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

test("12. one terminal line, never two", async () => {
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
