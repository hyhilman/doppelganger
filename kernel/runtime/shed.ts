// J4.9 (QTA-08, QTA-09) — the account breaker (kernel/runtime/quota.ts) detects a wall and PAUSES;
// it never DEGRADES, because a chore-class nightly and a PR review burn the exact same wall and the
// breaker cannot tell them apart. `decideShed` is the missing half.
//
// QTA-09 — pure: a snapshot, a class, an instant, a window. No DB read, no `Date.now()`, no env
// lookup INSIDE this function — the two call sites (`host/supervisor.ts`'s `realShouldShed`,
// `host/run.ts`'s `runNamed`) do the impure half (reading `quota.db`, reading the clock) and hand
// the result in. That is what lets every branch below be pinned without touching `quota.db`.
//
// The split D1 forces: `chore`/`watch`/`review` is the HOST's own vocabulary (which jobs are which
// value class) — a kernel module naming `nightly-sandcastle` would import the host's vocabulary,
// which D1 forbids. This module knows only the three class NAMES, never a job name; `host/classes.ts`
// is the one place that assigns a real job to one.
import { envNum, type EnvSpec } from "../config.ts";
import { DEFAULTS } from "../ports/job.ts";
import type { PauseInfo } from "./quota.ts";

export type JobClass = "chore" | "watch" | "review";

export interface ShedDecision {
  readonly skip: boolean;
  readonly downshift: boolean;
}

export const NO_SHED: ShedDecision = { skip: false, downshift: false };

export const QUOTA_SHED_WINDOW_MS_ENV: EnvSpec = {
  key: "QUOTA_SHED_WINDOW_MS",
  default: "86400000", // 24 hours
  why: "how long after a spend wall opens a chore/watch job still sheds load for it (QTA-08), read per call like every other quota knob",
};

export const SHED_WINDOW_MS = (): number => envNum(QUOTA_SHED_WINDOW_MS_ENV);

/**
 * The whole function is two rules:
 *
 *   recent = snapshot.limit === "spend" && snapshot.since != null
 *            && now - Date.parse(snapshot.since) <= windowMs
 *   result = recent ? { skip: cls === "chore", downshift: cls !== "review" } : NO_SHED
 *
 * Only a SPEND wall sheds — every other class already recovers inside its own QTA-06 window, so
 * widening this to every class would shed load for a wall that has probably lifted.
 *
 * It reads `since`, never `until`/`active`: the pause WINDOW is short (spend is 4x
 * `QUOTA_PAUSE_MS`, about two hours) and keying on it would stop shedding the moment the LAST park
 * expired, even though the account re-parks on its next real task. `since` survives exactly that
 * re-park (QTA-07), so it is what "recently" has to mean here too.
 *
 * An unparseable `since` (an operator's hand-edit with `sqlite3` — `clearPause`'s sibling key
 * writes `""` for exactly this reason) is not a case handled specially — it is the first rule
 * falling out correctly. `Date.parse("garbage")` is `NaN`, and `NaN <= windowMs` is `false`, so
 * `recent` is `false` and nothing sheds. That is the SAFE direction (shed less, spend more).
 *
 * `review` is never skipped and never downshifted — at N4 `REVIEW` (host/classes.ts) is empty
 * because nothing in this repo has a human waiting on it yet, but the rule holds regardless.
 */
export function decideShed(
  snapshot: Pick<PauseInfo, "limit" | "since">,
  cls: JobClass,
  now: Date,
  windowMs: number = SHED_WINDOW_MS(),
): ShedDecision {
  const recent =
    snapshot.limit === "spend" && snapshot.since != null && now.getTime() - Date.parse(snapshot.since) <= windowMs;
  return recent ? { skip: cls === "chore", downshift: cls !== "review" } : NO_SHED;
}

/**
 * A CEILING, never a floor: only an opus-named model is ever moved, and only when `d.downshift`
 * asks for it — a job that already names sonnet or haiku is left exactly alone. Ruling 8:
 * `DEFAULTS.shedModel` lives in `kernel/ports/job.ts` (HRN-01's "one place"); this file only ever
 * IMPORTS that value and names no model id of its own, so `test/model.test.ts` test 6's one-file
 * rule still holds with `shed.ts` in the picture.
 */
export function shedModel(model: string, d: ShedDecision): string {
  return d.downshift && /opus/i.test(model) ? DEFAULTS.shedModel : model;
}
