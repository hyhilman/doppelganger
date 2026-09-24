// test/contracts.test.ts — ADO-17: this repo runs its own contract suite (TST-01) at the root,
// over the real graph, the same one call a host repo makes.

import { contractTests } from "../kernel/contracts/index.ts";
import { PLUGINS } from "../host/plugins.ts";
import { SCHEDULE, PROGRAMS, programOf } from "../host/schedule.ts";
import { RESOURCE_NAMES } from "../host/config.ts";

contractTests({
  plugins: PLUGINS,
  schedule: SCHEDULE,
  programs: PROGRAMS,
  programOf,
  resourceNames: RESOURCE_NAMES,
});
