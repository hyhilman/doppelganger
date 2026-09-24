// The git plugin's manifest (KRN-04). No job yet: its jobs arrive in plugins/git/jobs/ and are
// listed here. `schedule` stays empty: the host binds entries from its own SCHEDULE.
import { definePlugin } from "../../kernel/plugin.ts";

export default definePlugin({
  name: "git",
  kill: [],
  jobs: [],
  schedule: [],
  env: [],
});
