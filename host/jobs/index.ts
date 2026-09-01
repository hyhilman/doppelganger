// the hand-registered job list. NO DIRECTORY SCAN — SKL-05's whole content, and a
// deliberate deviation from the reference's `run.ts` (`readdirSync(JOBS_DIR)`). The LIST is what
// exists; the directory (test/jobs.test.ts, J3.16) is only ever CHECKED against it.
//
// KRN-03: this is kernel/registry.ts's first consumer. Of the five registries roadmap.md's row
// names — programs/jobs, entry points, relays, watchers, retro lanes — only programs/jobs (this
// file) has a member at v0, checked against the repo before writing this sentence: entry points,
// relays, watchers and retro lanes have none, because no plugin emits a source or a route yet
// (D9) — a port with no consumer gets designed wrong. One registry collapsed here, four with
// nothing to collapse.
//
// The duplicate-throws behaviour itself (KRN-01) now lives in kernel/registry.ts, and its test
// moved to kernel/registry.test.ts with it — this file no longer hand-rolls
// `assertNoDuplicateNames`.
import { registry } from "../../kernel/registry.ts";
import type { Job } from "../../kernel/ports/job.ts";
import nightlySandcastle from "./nightly-sandcastle.ts";
import opsCronCheck from "./ops-cron-check.ts";

const jobs = registry<Job>("job");

jobs.register(nightlySandcastle);
jobs.register(opsCronCheck);

export const JOBS: readonly Job[] = jobs.all();
