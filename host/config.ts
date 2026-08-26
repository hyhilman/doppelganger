// J2.6 (SUP-10, INS-05, §5 Q1) — the gate's named resources and the refresh window, each stated
// once as data. See roadmap.md §5 Q1 for the decision this file makes mechanical.
//
// §5 Q1, settled: the HOST names the resources, not the kernel. INS-05 (declared non-goal: two
// instances never coordinate) is what turns that leaning into a rule with a test — no named
// resource may be machine-wide, because the gate cannot exclude across instances. `path` is
// ROOT-relative and never absolute, so resolving `r.path` against ROOT (kernel/paths.ts's
// projectPath) landing inside it is the mechanical form of "this resource lives inside its own
// checkout" (host/config.test.ts test 3).
//
// No module-scope `projectPath` call here (J2.3 door 6): RESOURCES carries ROOT-relative strings
// and nothing resolves them at this file's load time.
import type { EnvSpec } from "../kernel/config.ts";

/**
 * J4.14 (JOB-O10, KRN-06) — the watchdog's two knobs. `readers: []` in test/knobs.test.ts's ROWS,
 * the `<NAME>_DB` precedent (kernel/paths.ts): the row is a TypeScript value nothing in TypeScript
 * ever reads — host/watchdog.sh reads `${WATCHDOG_SUPERVISOR_STALE_M:-5}` and
 * `${WATCHDOG_DRY_RUN:-0}` directly from its own environment. The row is not a lie because
 * host/watchdog.test.ts's drift gate BINDS it to the script: every knob the script reads must
 * have a matching row here, and every row's default must match the script's own, checked from
 * both sides (the log.sh <-> emit.ts precedent, TST-18, one directory over).
 */
export const WATCHDOG_SUPERVISOR_STALE_M_ENV: EnvSpec = {
  key: "WATCHDOG_SUPERVISOR_STALE_M",
  default: "5",
  why: "how many missed 60s supervisor heartbeats (SUP-14) count as a dead scheduler; read by host/watchdog.sh, never by TypeScript",
};

export const WATCHDOG_DRY_RUN_ENV: EnvSpec = {
  key: "WATCHDOG_DRY_RUN",
  default: "0",
  why: "the watchdog logs and prints its faults, writes no breach file and exits 0 (SAF-01, for a tool)",
};

export interface GateResource {
  /** What a `lock=` field (GAT-10) and `--list` (SUP-17) print. Must match the gate's own name
   *  rule, `^[a-z][a-z0-9_-]*$` — re-stated in host/config.test.ts rather than imported, because
   *  kernel/runtime/gate.ts does not export it. */
  readonly name: string;
  /** ROOT-relative. Never absolute — that is what makes INS-05 checkable. */
  readonly path: string;
  /** One line. This IS the resource's doc. */
  readonly why: string;
}

/** Two resources, not three and not one. One resource makes GAT-03 ("two writers on disjoint
 *  resources run concurrently") unexerciseable against the real list; three would be a guess. Both
 *  of these have a named writer already in the roadmap; a third arrives with the job that needs
 *  it. */
export const RESOURCES: readonly GateResource[] = [
  {
    name: "repo",
    path: ".",
    why: "the checkout itself — its refs, its worktrees, its working tree. Every job that commits or resets holds excl on it; every job that only reads the tree holds shared.",
  },
  {
    name: "skills",
    path: ".claude/skills",
    why: "the rendered skill tree. skills render/sync (SKL-04, N3) writes it; every spawned agent reads its skills mid-run, so a render under a live agent is the reference's plugin resource with the names changed.",
  },
];

export const RESOURCE_NAMES: readonly string[] = RESOURCES.map((r) => r.name);

export interface RefreshWindow {
  /** 0 = Sunday, UTC. */
  readonly opensDow: readonly number[];
  /** "HH:MM", UTC. */
  readonly opensAt: string;
  /** Half-open: [open, open + lengthMin). */
  readonly lengthMin: number;
  readonly why: string;
}

/**
 * `null` at N2. The window exists to keep readers off a corpus refresh; there is no corpus job
 * until v1 and no job at all until N3, so declaring bounds now would be a guess dressed as
 * configuration. `validate()` (J2.9) refuses `clearsRefreshWindow: true` while this is null, so
 * nobody can flag an entry against a window that protects nothing. The mechanism below is fully
 * real and fully tested against a fixture window regardless.
 */
export const REFRESH_WINDOW: RefreshWindow | null = null;

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

function minuteOfWeek(at: Date): number {
  return at.getUTCDay() * MINUTES_PER_DAY + at.getUTCHours() * 60 + at.getUTCMinutes();
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Half-open `[open, open + lengthMin)`, computed on a minute-of-week so a window crossing Sunday
 * midnight needs no second clause — the reference spells this window as a two-clause predicate
 * with an off-by-one at the tail bound; this is the same rule stated once, as data.
 */
export function inRefreshWindow(at: Date, w: RefreshWindow | null = REFRESH_WINDOW): boolean {
  if (w === null) return false;
  const minute = minuteOfWeek(at);
  const openMinuteOfDay = parseHHMM(w.opensAt);
  for (const dow of w.opensDow) {
    const openStart = dow * MINUTES_PER_DAY + openMinuteOfDay;
    const delta = ((minute - openStart) % MINUTES_PER_WEEK + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
    if (delta < w.lengthMin) return true;
  }
  return false;
}
