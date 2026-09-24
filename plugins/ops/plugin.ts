// The ops plugin's manifest (KRN-04). Its jobs live in plugins/ops/jobs/ and are listed here.
// `schedule` stays empty: the host binds entries from its own SCHEDULE.
import { definePlugin } from "../../kernel/plugin.ts";
import opsHello from "./jobs/ops-hello.ts";
import opsLeaseReap from "./jobs/ops-lease-reap.ts";
import opsLogReport, { LOG_REPORT_ENV } from "./jobs/ops-log-report.ts";
import opsRetention, { RETENTION_ENV } from "./jobs/ops-retention.ts";

export default definePlugin({
  name: "ops",
  kill: [],
  jobs: [opsHello, opsLeaseReap, opsLogReport, opsRetention],
  schedule: [],
  env: [...LOG_REPORT_ENV, ...RETENTION_ENV],
});
