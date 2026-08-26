// J2.4 (GAT-01, GAT-02, GAT-03, GAT-04, GAT-06) / J2.5 (GAT-05) — the in-memory reader/writer gate.
//
// One supervisor process owns every tick, which is what makes an IN-MEMORY gate possible at all —
// no cross-process coordination, no file lock. A reader takes `shared` on ALL resources (GAT-02); a
// writer takes `excl` on only the resources it names, or on everything if it names none. Two writers
// on DISJOINT resources run concurrently (GAT-03) — that is the whole reason the gate is per-
// resource rather than one flag.
//
// THE ONE DESIGN DIVERGENCE FROM THE REFERENCE, AND WHY. The reference's rwlock.ts is a
// module-global singleton: a Map<Resource, ResourceLock> and a Set<string> at module scope, a
// hard-coded three-member Resource union, and an exported reset hook marked "Test seam: never
// called in production". This file ships a FACTORY, createGate(names), instead — three reasons:
//   - the resource names are workspace-specific (§5 Q1); a kernel module cannot hard-code
//     `factory | plugin | services` without importing the host's vocabulary, which D1 forbids;
//   - a factory needs no reset seam, so a production export that exists only for tests disappears;
//   - INS-05 becomes assertable — two gates over the same names exclude nothing from each other,
//     which a singleton could never even state.
//
// GAT-02, the normalisation, stated once and used everywhere:
//   want(mode, asked) = mode === "shared"
//     ? [...names]                                  // a reader ALWAYS takes all; `asked` is ignored
//     : asked.length === 0
//       ? [...names]                                // a writer naming nothing takes all (safe default)
//       : names.filter(n => asked.includes(n));     // GLOBAL order, whatever order the caller listed
//
// GAT-04, THE FIXED GLOBAL ORDER AND THE DEADLOCK ARGUMENT. `want()` filters the gate's own `names`
// array left to right, so acquisition order is a property of the GATE, not of the caller. A total
// order over resources means no two holders can each hold one resource and want another that sorts
// earlier in that order — the standard argument against circular wait.
//
// THE PREMISE THIS ARGUMENT RESTS ON, WHICH NOTHING HERE TESTS AND NOTHING HERE FORBIDS: NO HOLDER
// EVER ACQUIRES WHILE ALREADY HOLDING. A task that does `acquire(["c"])` and then, still holding it,
// `acquire(["a"])` breaks the total order — it holds a later resource and wants an earlier one,
// which is exactly the wait-for cycle the fixed order exists to make impossible, and its mirror
// deadlocks against it. `runEntry` (J2.11) takes the gate exactly once per tick and holds nothing
// across the call, which is what makes the premise true for the only caller N2 ships — it is NOT
// enforced by the gate itself. Enforcing it (an owner token, a re-entrancy check) is a design change
// with no second caller to argue with yet (D9).
//
// WHAT THE TEST PROVES, AND WHAT IT DOES NOT. A test cannot prove the absence of deadlock in
// general. What kernel/runtime/gate.test.ts's three levels give: the exclusion decision is exactly
// a pure model, over the WHOLE 256-pair request space (level 1) · the acquisition order is total and
// caller-independent, over every ordering a caller can produce (level 2) · two contending holders
// both always finish, over all 64 writer pairs (level 3). A total acquisition order extends that to
// three or more holders by the standard argument, with no further test needed — PROVIDED the premise
// above holds.
//
// GAT-06, per-PROGRAM self-exclusion. `acquireSelf(key)` is keyed on the program (J2.7's
// programOf), never the entry — two entries of the same program still exclude each other. The
// release closure is idempotent, same as GateHold.release.
//
// GAT-05 (J2.5), writer priority and the wait budget. A queued writer blocks a reader that arrives
// after it — `tryEnter` refuses ANY new arrival while the resource's queue is non-empty, whatever
// mode it asks in; without that refusal a stream of readers walks past a waiting writer, which is
// the `flock` starvation this gate replaces. The wait budget spans the WHOLE acquisition, not each
// resource in turn: `acquire` computes one deadline and passes the REMAINING budget to each
// resource, so a multi-resource writer never waits longer than its own `waitMs`. A multi-resource
// acquire that times out partway through releases what it already holds before returning null — the
// one failure that would otherwise strand the gate forever, with no owner left to release it.
//
// `ResourceInternal` (this file's per-resource state) is never exported; `state()` is the only view
// a caller gets, which is what makes the exhaustive tests a test of the CONTRACT rather than of the
// internals.
//
// GAT-10, lock-starve visibility, DECLINED IN PART. What is real at N2 is the LINE SHAPE the
// counter reads (`lock-held`, with `job=` carrying the PROGRAM — J2.11's own choice, restated
// here because it is what makes this row work at all: emitting the entry name would split one
// counter N ways) and the THRESHOLD it is compared against (`starveThreshold`, below). The counter
// itself — `lockloss:<job>` — is written by `ops-log-report` (JOB-O02, N5), which does not exist
// yet; declined here rather than built with no consumer to argue with (D9).
import { envDynamic, envNum, type EnvSpec } from "../config.ts";

export type Mode = "shared" | "excl";

export interface GateHold {
  readonly mode: Mode;
  readonly resources: readonly string[];
  /** Idempotent — safe to call from a `finally` even after an earlier explicit release. */
  release(): void;
}

export interface ResourceState {
  readonly readers: number;
  readonly writer: boolean;
  readonly queued: number;
}

export interface GateState {
  readonly resources: Record<string, ResourceState>;
  readonly self: readonly string[];
}

export interface Gate {
  /** The fixed global acquisition order (GAT-04) — the order `names` was given in. */
  readonly resources: readonly string[];
  /**
   * `mode = "shared"` always takes every resource (GAT-02); `asked` is ignored. `mode = "excl"`
   * with `asked = []` (the default) takes every resource too — a writer naming nothing is a safe
   * default, not a no-op. `waitMs <= 0` (the default) fails fast with no timer. Throws, naming the
   * unknown resource, if `asked` names something this gate does not have.
   */
  acquire(mode: Mode, resources?: readonly string[], waitMs?: number): Promise<GateHold | null>;
  /** GAT-06: per-program self-exclusion. `null` if `key` is already held. */
  acquireSelf(key: string): (() => void) | null;
  selfHeld(key: string): boolean;
  state(): GateState;
}

interface Waiter {
  readonly mode: Mode;
  readonly resolve: (ok: boolean) => void;
  timer?: ReturnType<typeof setTimeout>;
}

interface ResourceInternal {
  readers: number;
  writer: boolean;
  readonly queue: Waiter[];
}

/** A resource name is interpolated into a `lock-held` log line's `lock=` field (GAT-10) and into
 *  `--list`'s resources column (SUP-17), so it is checked for the same reason DBS-03 guards `ns`
 *  and INS-01 guards `INSTANCE`. */
const NAME_RE = /^[a-z][a-z0-9_-]*$/;

export function createGate(names: readonly string[]): Gate {
  if (names.length === 0) {
    throw new Error("createGate: names must not be empty");
  }
  const seen = new Set<string>();
  for (const n of names) {
    if (!NAME_RE.test(n)) {
      throw new Error(`createGate: bad resource name ${JSON.stringify(n)} — must match ${NAME_RE}`);
    }
    if (seen.has(n)) {
      throw new Error(`createGate: duplicate resource name ${JSON.stringify(n)}`);
    }
    seen.add(n);
  }
  const order: readonly string[] = [...names];
  const resourceMap = new Map<string, ResourceInternal>(
    order.map((n) => [n, { readers: 0, writer: false, queue: [] }]),
  );
  const selfSet = new Set<string>();

  function want(mode: Mode, asked: readonly string[]): string[] {
    if (mode === "shared") return [...order];
    if (asked.length === 0) return [...order];
    const unknown = asked.find((a) => !resourceMap.has(a));
    if (unknown !== undefined) {
      throw new Error(
        `acquire: unknown resource ${JSON.stringify(unknown)} — this gate has [${order.join(", ")}]`,
      );
    }
    return order.filter((n) => asked.includes(n));
  }

  function admissible(mode: Mode, r: ResourceInternal): boolean {
    if (mode === "shared") return !r.writer;
    return r.readers === 0 && !r.writer;
  }

  // GAT-05: a queued writer blocks a reader that arrives after it — refuse ANY new arrival while
  // anyone is queued, whatever mode it asks in. `drain()` below does not call this: it grants the
  // queue's own head in FIFO order regardless of what arrives later, which is what lets a run of
  // queued readers behind a released writer drain together.
  function tryEnter(mode: Mode, r: ResourceInternal): boolean {
    return admissible(mode, r) && r.queue.length === 0;
  }

  function commit(mode: Mode, r: ResourceInternal): void {
    if (mode === "shared") r.readers++;
    else r.writer = true;
  }

  function drain(name: string): void {
    const r = resourceMap.get(name)!;
    while (r.queue.length > 0) {
      const head = r.queue[0]!;
      if (!admissible(head.mode, r)) break;
      r.queue.shift();
      if (head.timer !== undefined) clearTimeout(head.timer);
      commit(head.mode, r);
      head.resolve(true);
    }
  }

  function releaseOne(name: string, mode: Mode): void {
    const r = resourceMap.get(name)!;
    if (mode === "shared") r.readers = Math.max(0, r.readers - 1);
    else r.writer = false;
    drain(name);
  }

  function acquireOne(name: string, mode: Mode, waitMs: number): Promise<boolean> {
    const r = resourceMap.get(name)!;
    if (tryEnter(mode, r)) {
      commit(mode, r);
      return Promise.resolve(true);
    }
    if (waitMs <= 0) return Promise.resolve(false);
    // SYNCHRONOUS enqueue: this executor runs synchronously, so `r.queue.push` has already
    // happened by the time `acquire()` returns to a caller who does not await it (GAT-05).
    return new Promise<boolean>((resolve) => {
      const waiter: Waiter = { mode, resolve };
      r.queue.push(waiter);
      // The timer is NOT unref'ed: a pass parked at the gate is real pending work, and an
      // unref'd timer would let the loop drain out from under it, so the promise never settles
      // and the caller hangs forever instead of skipping its tick.
      waiter.timer = setTimeout(() => {
        const idx = r.queue.indexOf(waiter);
        if (idx !== -1) r.queue.splice(idx, 1);
        resolve(false);
        // Removing a waiter can unblock the ones behind it — nothing else would notice until
        // the current holder happens to release.
        drain(name);
      }, waitMs);
    });
  }

  async function acquire(
    mode: Mode,
    resources: readonly string[] = [],
    waitMs = 0,
  ): Promise<GateHold | null> {
    const wanted = want(mode, resources);
    // GAT-05: the wait budget spans the WHOLE acquisition, not each resource in turn — one
    // deadline, and the REMAINING budget passed to each resource. A per-resource budget would let
    // a multi-resource writer wait up to `waitMs` on EVERY resource it names, multiplying the
    // bound the caller actually asked for.
    //
    // The loop does NOT short-circuit on the first failure: it attempts every resource in
    // `wanted` in turn, each against whatever budget remains, and only decides the overall
    // verdict once every resource has settled. A resource that fails does not stop a LATER one
    // from still spending (and being bound by) its own share of the remaining budget — which is
    // exactly what makes the budget's "whole acquisition, not per resource" property observable at
    // all: a request whose first resource times out and whose second resource is ALSO contested
    // still has to attempt the second, and the amount of budget the second gets to wait is what
    // this file's own test proves is the remainder, not a fresh `waitMs`.
    const deadline = Date.now() + waitMs;
    const held: string[] = [];
    let allOk = true;
    for (const name of wanted) {
      const remaining = Math.max(0, deadline - Date.now());
      const ok = await acquireOne(name, mode, remaining);
      if (ok) held.push(name);
      else allOk = false;
    }
    if (!allOk) {
      // Partial acquisition is never stranded (GAT-04's premise depends on this): release
      // whatever succeeded, in reverse, before reporting failure.
      for (let i = held.length - 1; i >= 0; i--) releaseOne(held[i]!, mode);
      return null;
    }
    let released = false;
    return {
      mode,
      resources: wanted,
      release: () => {
        if (released) return;
        released = true;
        for (let i = wanted.length - 1; i >= 0; i--) releaseOne(wanted[i]!, mode);
      },
    };
  }

  function acquireSelf(key: string): (() => void) | null {
    if (selfSet.has(key)) return null;
    selfSet.add(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      selfSet.delete(key);
    };
  }

  function state(): GateState {
    const resources: Record<string, ResourceState> = {};
    for (const n of order) {
      const r = resourceMap.get(n)!;
      resources[n] = { readers: r.readers, writer: r.writer, queued: r.queue.length };
    }
    return { resources, self: [...selfSet] };
  }

  return {
    resources: order,
    acquire,
    acquireSelf,
    selfHeld: (key: string) => selfSet.has(key),
    state,
  };
}

export const LOCK_STARVE_N_ENV: EnvSpec = {
  key: "LOCK_STARVE_N",
  default: "6",
  why: "consecutive lock-held skips before a job counts as starved at the gate (GAT-10)",
};

export const LOCK_STARVE_FAMILY_ENV: EnvSpec = {
  key: "LOCK_STARVE_N_<JOB>",
  why: "raise the starve threshold for one job whose cadence makes 6 skips normal (GAT-10)",
};

/**
 * The per-job lock-starve threshold: `LOCK_STARVE_N_<JOB>` (the job's name, uppercased, hyphens to
 * underscores) if set, else the base `LOCK_STARVE_N` (default 6). A non-numeric override throws
 * naming the key and the value — a silent fallback here is exactly the 3am class N1 rejected.
 */
export function starveThreshold(job: string): number {
  const familyKey = `LOCK_STARVE_N_${job.toUpperCase().replace(/-/g, "_")}`;
  const raw = envDynamic(familyKey);
  if (raw === undefined) return envNum(LOCK_STARVE_N_ENV);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(
      `${familyKey}: not a non-negative number: ${JSON.stringify(raw)} — ${LOCK_STARVE_FAMILY_ENV.why}`,
    );
  }
  return n;
}
