// the registered job list, built from the manifests (host/plugins.ts's MANIFESTS). NO DIRECTORY
// SCAN — SKL-05's whole content, and a deliberate deviation from the reference's `run.ts`
// (`readdirSync(JOBS_DIR)`). The LIST is what exists; the directories (test/jobs.test.ts) are only
// ever CHECKED against it.
//
// KRN-03: this is kernel/registry.ts's first consumer, and KRN-01's duplicate-throws happens here:
// two manifests listing one job name fail at import time.
import { registry } from "../../kernel/registry.ts";
import type { Job } from "../../kernel/ports/job.ts";
import { MANIFESTS } from "../plugins.ts";

const jobs = registry<Job>("job");

for (const manifest of MANIFESTS) {
  for (const job of manifest.jobs) jobs.register(job);
}

export const JOBS: readonly Job[] = jobs.all();
