// J3.8 (SKL-05) — the hand-registered job list. NO DIRECTORY SCAN — SKL-05's whole content, and a
// deliberate deviation from the reference's `run.ts` (`readdirSync(JOBS_DIR)`). The LIST is what
// exists; the directory (test/jobs.test.ts, J3.16) is only ever CHECKED against it.
import type { Job } from "../../kernel/ports/job.ts";
import nightlySandcastle from "./nightly-sandcastle.ts";
import opsCronCheck from "./ops-cron-check.ts";

/** KRN-01's shape, one phase early and one file wide: duplicate-throws, at import time. Exported so
 *  it is testable directly against a fabricated list, not only against the one real job. */
export function assertNoDuplicateNames(jobs: readonly Job[]): void {
  const seen = new Set<string>();
  for (const j of jobs) {
    if (seen.has(j.name)) {
      throw new Error(`host/jobs/index.ts: duplicate job name ${JSON.stringify(j.name)}`);
    }
    seen.add(j.name);
  }
}

export const JOBS: readonly Job[] = [nightlySandcastle, opsCronCheck];

assertNoDuplicateNames(JOBS);
