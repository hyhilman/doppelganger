// The git plugin's manifest (KRN-04): its three jobs, its kill switch and its knobs. `schedule`
// is empty on purpose: the host owns SCHEDULE and binds each manifest's entries to it
// (host/plugins.ts).
import { definePlugin } from "../../kernel/plugin.ts";
import { SCOPE_ENV } from "./scope.ts";
import opsEnsureEnvWorktrees, { ENSURE_ENV_WORKTREES_ENV } from "./jobs/ops-ensure-env-worktrees.ts";
import opsResetBranches, { RESET_BRANCHES_JOB_ENV } from "./jobs/ops-reset-branches.ts";
import opsResetEnvToMain, { GIT_NO_RECUT_ENV, RESET_ENV_TO_MAIN_ENV } from "./jobs/ops-reset-env-to-main.ts";

export default definePlugin({
  name: "git",
  kill: [GIT_NO_RECUT_ENV],
  jobs: [opsResetBranches, opsEnsureEnvWorktrees, opsResetEnvToMain],
  schedule: [],
  env: [...SCOPE_ENV, ...RESET_BRANCHES_JOB_ENV, ...ENSURE_ENV_WORKTREES_ENV, ...RESET_ENV_TO_MAIN_ENV],
});
