// kernel/contracts — TST-01: the drift-gate suite a host repo gets by calling ONE function.
//
// A host test file calls `contractTests({...})` once, with the host's own real values. That
// registers one node:test test per contract. Each test only runs a pure check from this file and
// asserts it found nothing, so a unit test can run the same check over a bad fixture and watch it
// go red without a red test in the suite.
//
// ADO-17: the suite has two homes. A host repo calls it, and this repo calls it at its root
// (test/contracts.test.ts) over its own graph.
//
// This file imports only kernel/ and node: builtins. The host's schedule, program table and
// resource names come in through `opts`, so kernel/ never names host/ (D1).

import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, DEFAULT_BOOT_DEPS, type BootDeps } from "../boot.ts";
import { errText } from "../config.ts";
import type { Plugin } from "../plugin.ts";
import type { ScheduleEntry } from "../ports/schedule.ts";

/** The one part of a host's program row these checks read. A host's full row (gate, dotenv,
 *  and so on) fits this shape as it is. */
export interface ContractProgram {
  /** The gate resources a writer takes. Omitted means all of them, so nothing to check. */
  readonly resources?: readonly string[];
}

export interface ContractOpts {
  /** The host's whole plugin graph, the input to `boot()`. */
  readonly plugins: readonly Plugin[];
  /** The skill-tree reader `boot()` uses. Defaults to the real one. */
  readonly bootDeps?: BootDeps;
  /** Every entry the host schedules. */
  readonly schedule: readonly ScheduleEntry[];
  /** The host's program table, keyed by program name. */
  readonly programs: Readonly<Record<string, ContractProgram>>;
  /** Maps an entry to its program name, the key into `programs`. */
  readonly programOf: (entry: ScheduleEntry) => string;
  /** Every gate resource name the host declares. */
  readonly resourceNames: readonly string[];
}

/** Contract 1 — the graph boots (KRN-11). Returns boot()'s one message, or nothing. */
export function graphBootProblems(
  plugins: readonly Plugin[],
  deps: BootDeps = DEFAULT_BOOT_DEPS,
): readonly string[] {
  try {
    boot(plugins, deps);
    return [];
  } catch (e) {
    return [errText(e)];
  }
}

// Contract 2 — every route a source can emit is claimed. It has NO SUBJECT yet: the v0 Plugin
// manifest has five members and no `sources` or `routes` (KRN-04, D9), so there is nothing to
// walk, and a check here would always pass. The line below is a typecheck gate, not a test: it
// stops the build the day either member lands, so the real check gets written here with it.
type NoRouteSubject = Extract<keyof Plugin, "sources" | "routes"> extends never ? true : false;
true satisfies NoRouteSubject;

/** Contract 3 — every scheduled entry has a program row, and every gate resource that row names
 *  is one the host declares. */
export function scheduleResourceProblems(
  opts: Pick<ContractOpts, "schedule" | "programs" | "programOf" | "resourceNames">,
): readonly string[] {
  const problems: string[] = [];
  for (const entry of opts.schedule) {
    const name = opts.programOf(entry);
    // Own keys only: a plain lookup would find `toString` and friends on Object.prototype.
    if (!Object.hasOwn(opts.programs, name)) {
      problems.push(`entry ${JSON.stringify(entry.name)}: no program row for ${JSON.stringify(name)}`);
      continue;
    }
    for (const r of opts.programs[name]!.resources ?? []) {
      if (!opts.resourceNames.includes(r)) {
        problems.push(
          `entry ${JSON.stringify(entry.name)}: program ${JSON.stringify(name)} names unknown gate resource ${JSON.stringify(r)}`,
        );
      }
    }
  }
  return problems;
}

/**
 * TST-01. Registers the contract suite as node:test tests. Call it once, from a test file, with
 * the host's real values.
 */
export function contractTests(opts: ContractOpts): void {
  test("contracts: the plugin graph boots (TST-01, KRN-11)", () => {
    assert.deepEqual(graphBootProblems(opts.plugins, opts.bootDeps), []);
  });

  test("contracts: every scheduled entry's gate resources exist (TST-01)", () => {
    assert.deepEqual(scheduleResourceProblems(opts), []);
  });
}
