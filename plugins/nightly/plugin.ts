// The nightly plugin's manifest (KRN-04): its one job, its kill switch and its knobs. `schedule`
// is empty on purpose: the host owns SCHEDULE and binds each manifest's entries to it
// (host/plugins.ts).
import { definePlugin } from "../../kernel/plugin.ts";
import nightlySandcastle, {
  NIGHTLY_NO_SANDCASTLE_ENV,
  NIGHTLY_SANDCASTLE_BASE_ENV,
  NIGHTLY_SANDCASTLE_DRY_RUN_ENV,
  NIGHTLY_SANDCASTLE_NO_MERGE_ENV,
  NIGHTLY_SANDCASTLE_MAX_ENV,
  NIGHTLY_SANDCASTLE_ONLY_ENV,
  NIGHTLY_SANDCASTLE_MODEL_ENV,
} from "./jobs/nightly-sandcastle.ts";

export default definePlugin({
  name: "nightly",
  kill: [NIGHTLY_NO_SANDCASTLE_ENV],
  jobs: [nightlySandcastle],
  schedule: [],
  env: [
    NIGHTLY_SANDCASTLE_BASE_ENV,
    NIGHTLY_SANDCASTLE_DRY_RUN_ENV,
    NIGHTLY_SANDCASTLE_NO_MERGE_ENV,
    NIGHTLY_SANDCASTLE_MAX_ENV,
    NIGHTLY_SANDCASTLE_ONLY_ENV,
    NIGHTLY_SANDCASTLE_MODEL_ENV,
  ],
});
