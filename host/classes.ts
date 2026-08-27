// the host's own value-class vocabulary. `kernel/runtime/shed.ts`'s `decideShed`
// is pure and knows only the three class NAMES; this file is the one place that says which real
// job is which class, because a kernel module naming "nightly-sandcastle" would import the host's
// vocabulary, which D1 forbids — the same call §5 Q1 already made for gate resources: the host
// names its own things.
import type { JobClass } from "../kernel/runtime/shed.ts";

/** A job whose failure to run tonight costs nothing but a delay — SKIPPED outright under a recent
 *  spend wall. A value-class decision, not a refactor: host/classes.test.ts pins this
 *  exact list, so widening it is a deliberate edit, never a drive-by. */
export const CHORE: readonly string[] = ["nightly-sandcastle"];

/** A job with a human waiting on its output — NEVER skipped, NEVER downshifted. Empty at N4:
 *  nothing in this repo has a human waiting on it yet. The empty list is a CHECKED claim
 *  (host/classes.test.ts test 9), not a placeholder — the first review-class job forces an
 *  explicit choice here, the same call host/config.ts made for `REFRESH_WINDOW = null`. */
export const REVIEW: readonly string[] = [];

/** Everything else — downshifted under a recent spend wall, never skipped. `ops-cron-check`
 *  (J4.12) is the first entry; `"host/watchdog.sh"` (J4.14) is the second — pinned here first,
 *  before either entry existed, so the three-way split's SHAPE (host/classes.test.ts test 9) was
 *  fixed in advance. Neither runs an agent, so "downshifted" is inert for both — they simply are
 *  not CHORE (skippable) or REVIEW (a human is waiting), the safe default for a deterministic job.
 *
 *  `"host/watchdog.sh"`, not the short `"watchdog.sh"` the plan's own prose uses: `programOf(e)`
 *  for a `script:` entry IS `e.script` verbatim, and the watchdog's own schedule entry (J4.14) sets
 *  `script: "host/watchdog.sh"` — the project-relative path `scriptCommandOf` needs to find the
 *  real file. See host/schedule.ts's own PROGRAMS row comment for the full deviation record. */
export const WATCH: readonly string[] = ["ops-cron-check", "host/watchdog.sh"];

/** An unlisted name defaults to `"watch"` — the safe default: never skipped, downshifted like
 *  every other job not explicitly waiting on a human. Called from two places that must agree only
 *  by convention (host/classes.test.ts test 11): `host/supervisor.ts`'s `realShouldShed` (J4.10)
 *  hands it `programOf(e)`, `host/run.ts`'s `runNamed` (J4.10) hands it `job.name` directly. */
export function classOf(name: string): JobClass {
  if (CHORE.includes(name)) return "chore";
  if (REVIEW.includes(name)) return "review";
  return "watch";
}
