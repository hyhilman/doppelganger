// The ops plugin's manifest (KRN-04). Its jobs live in plugins/ops/jobs/ and are listed here.
// `schedule` stays empty: the host binds entries from its own SCHEDULE.
import { definePlugin } from "../../kernel/plugin.ts";
import opsHello from "./jobs/ops-hello.ts";

export default definePlugin({
  name: "ops",
  kill: [],
  jobs: [opsHello],
  schedule: [],
  env: [],
});
