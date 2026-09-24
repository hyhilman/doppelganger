// The ops plugin's manifest (KRN-04). No job yet: its jobs arrive in plugins/ops/jobs/ and are
// listed here. `schedule` stays empty: the host binds entries from its own SCHEDULE.
import { definePlugin } from "../../kernel/plugin.ts";

export default definePlugin({
  name: "ops",
  kill: [],
  jobs: [],
  schedule: [],
  env: [],
});
