// routing is a property of the level, not the caller.
//
// The caller never names a route. routeOf takes a Level and nothing else — not a job, not an event,
// not a flag. That is LOG-04's sentence as a signature: a function that cannot see the caller cannot
// be steered by it.
import type { Level } from "./emit.ts";
import type { LogLine } from "./parse.ts";

export type Route = "report" | "count" | "file";

export const routeOf = (level: Level): Route =>
  level === "error" ? "report" : level === "warn" ? "count" : "file";

export interface TickSummary {
  /** Faults batched per `job/event` — the key IS the batch key. */
  faults: Map<string, number>;
  /** Warns are a bare count, and only on a tick that already had an error. */
  warns: number;
  /** True when the tick has anything to report at all. */
  report: boolean;
}

/**
 * The whole of LOG-04: `error` lines are batched per `job/event`; `warns` is the count of `warn`
 * lines, and it is reported ONLY when the tick already has a fault (`faults.size > 0`); `info` and
 * `debug` never appear.
 */
export function summarise(lines: readonly LogLine[]): TickSummary {
  const faults = new Map<string, number>();
  let warns = 0;
  for (const line of lines) {
    if (line.level === "error") {
      const key = `${line.job}/${line.event}`;
      faults.set(key, (faults.get(key) ?? 0) + 1);
    } else if (line.level === "warn") {
      warns++;
    }
  }
  const report = faults.size > 0;
  return { faults, warns: report ? warns : 0, report };
}
