// ops-hello — a read-only smoke test of the agent path (JOB-O01). It runs one agent pass on the
// host and checks the pass comes back. The skill asks for one line and nothing else. It is not
// scheduled: run it by hand with `npm run job ops-hello`.
//
// This file imports only kernel/ports/* (TST-03).
import { DEFAULTS, defineJob, type Job } from "../../../kernel/ports/job.ts";

const opsHelloJob: Job = defineJob({
  name: "ops-hello",
  description: "Read-only smoke test of the agent path: the agent prints one line and changes nothing (JOB-O01).",
  plugin: "ops",
  // Spelled out, not left to default: a job with neither `skill` nor `exec` is refused (D10).
  skill: "ops-hello",
  // A smoke test should use the model an unconfigured job gets, so it inherits DEFAULTS.model.
  model: DEFAULTS.model,
  // "auto", not bypass: the run is read-only and needs no permission bypass (HRN-14).
  permissionMode: "auto",
  // One pass. The skill prints its line and stops, so a second pass would only repeat it.
  maxIterations: 1,
});

export default opsHelloJob;
