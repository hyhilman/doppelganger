// crontab drift, on a cadence, logged every run.
//
// `crontab check` (cli/crontab.ts, since N2) already computes the diff; this job adds the four
// things it does not, none of them the diff itself:
//   1. A CADENCE — drift is invisible between the change and the next restart, and the change
//      that causes it is a merge, not a deployment. One entry a day fixes that.
//   2. A LOG LINE EVERY RUN, at info — `crontab check` writes prose for a person; this job writes
//      ONE logfmt line (`event=cron-check drift=0 bootstrap=N`), so silent-because-healthy and
//      silent-because-not-running stop looking alike, which is this job's own failure mode. On
//      drift it writes `level=error event=cron-drift` naming the first differing line — LOG-04
//      does the routing from there, only reaching the report tick once JOB-O02 (N5) exists.
//   3. A PROGRAMS ROW THAT STATES AN EXEMPTION — `gate: "none"` with a real `whyNoGate` (GAT-07,
//      host/schedule.ts): the check reads `crontab -l` and renders, racing nothing the gate
//      protects, and it is most useful exactly when a writer is holding the gate and jobs are
//      backing up — queueing it would blind the check in the one case it exists for.
//   4. IT IS COVERED BY THE CONFIG IT VERIFIES — its own entry lives in host/schedule.ts, so the
//      checker appears in the block it checks.
//
// `host/` importing `cli/` is the MIRROR of the one coupling N2 already settled (`cli/crontab.ts`
// importing `host/schedule.ts`) — not a new direction in spirit, but it does make `cli/` a
// runtime dependency of a job rather than only an operator surface (flagged, Gaps item 7).
//
// `check()` calls cli/crontab.ts's OWN `render`/`installedBlock`/`legacyRange`/`diff` — never a
// second copy of any of them, and its three drift MESSAGES are copied verbatim from `cmdCheck`
// (cli/crontab.ts) so an operator sees the same words from either surface. The one thing this file
// computes on its own is `bootstrap` — a one-line count of non-blank, non-comment lines in the
// rendered block — because `cli/crontab.ts`'s own `isCommand`/`tally` are module-private and this
// is not worth widening its exported surface for.
import { render, installedBlock, legacyRange, diff, readCrontab, CRONTAB_CMD_ENV } from "../../cli/crontab.ts";
import { envStr } from "../../kernel/config.ts";
import { INSTANCE } from "../../kernel/instance.ts";
import type { Logger } from "../../kernel/runtime/log/emit.ts";
import { defineJob } from "../../kernel/ports/job.ts";
import { SCHEDULE, type ScheduleEntry } from "../schedule.ts";
import type { PassDeps } from "./nightly-sandcastle.ts";

export interface CronCheckDeps {
  readonly log: Logger;
  readonly crontabCmd: string;
  /** The seam — NEVER the real binary in a test (host/jobs/ops-cron-check.test.ts test 6, and
   *  belt-and-braces: `CRONTAB_CMD` is unset in the suite, so the real exec wrapper below would
   *  throw before ever calling this anyway). */
  readonly readCrontab: (cmd: string) => string;
  readonly schedule: readonly ScheduleEntry[];
  readonly instance: string;
}

const isRenderedCommand = (line: string): boolean => line.trim() !== "" && !line.trimStart().startsWith("#");

/**
 * The check itself, pure over its own deps. Three shapes of drift, copied verbatim from
 * `cli/crontab.ts`'s `cmdCheck` so the two surfaces never disagree in wording: no block at all, an
 * unnamed (legacy) block, or a real line-level diff. `bootstrap` is read off the freshly
 * RENDERED block, never `deps.schedule.length` — the same rule `tally()` (cli/crontab.ts) follows,
 * for the same reason: this job's own entry sits in `deps.schedule` too, and `deps.schedule.length`
 * would count entries `render` never turns into a crontab line at all.
 */
export function check(deps: CronCheckDeps): { readonly drift: readonly string[]; readonly bootstrap: number } {
  const block = render(deps.schedule, deps.instance);
  const bootstrap = block.filter(isRenderedCommand).length;
  const raw = deps.readCrontab(deps.crontabCmd);
  const installed = installedBlock(raw, deps.instance);

  if (installed === null) {
    if (legacyRange(raw.split("\n")) !== null) {
      return {
        drift: [
          `an unnamed managed block is installed — run \`npm run crontab sync -- --adopt\` to claim it for instance ${JSON.stringify(deps.instance)}`,
        ],
        bootstrap,
      };
    }
    return { drift: ["no managed block installed — run `npm run crontab sync`"], bootstrap };
  }

  const inSync = installed.length === block.length && installed.every((l, i) => l === block[i]);
  if (inSync) return { drift: [], bootstrap };
  return { drift: diff(block, installed), bootstrap };
}

/**
 * The whole job, deps-injected and directly testable: `check()`'s result, then EXACTLY one log
 * line either way. In sync — `info event=cron-check drift=0 bootstrap=N`, and returns. Any drift —
 * `error event=cron-drift` naming the FIRST differing line (`result.drift` can hold several; the
 * log line is deliberately terse), THEN throws that same line so the process exits non-zero
 * (host/run.ts's `runNamed` re-throws an `exec:` job's own error unconditionally) — a job that
 * found drift and said nothing about it in its exit code would be exactly as silent as one that
 * never ran at all.
 */
export async function runCheck(deps: CronCheckDeps): Promise<void> {
  const result = check(deps);
  if (result.drift.length === 0) {
    deps.log.info("cron-check", { drift: 0, bootstrap: result.bootstrap });
    return;
  }
  deps.log.error("cron-drift", { msg: result.drift[0]! });
  throw new Error(result.drift[0]!);
}

/**
 * `permissionMode: "auto"` is UNREACHABLE — this `exec:` job never runs an agent (D10's
 * deterministic shape), so the field is inert; `"auto"` is used rather than `bypassPermissions`
 * because `test/model.test.ts` test 7's companion scan reads a `bypassPermissions` literal as a
 * claim that needs `local: true`, and this job would be claiming something untrue.
 *
 * `CRONTAB_CMD` is resolved HERE, at run time, never defaulted — a caller who forgets to set it in
 * `.env` (the entry's `dotenv: true` layer) fails loudly with the row's own `why`, which is
 * correct (N2 F1's whole lesson) and is why the entry's own `why` names the one thing an operator
 * must do to turn this job on. `deps: PassDeps` only ever contributes `.log` — every other real
 * value (`crontabCmd`, `readCrontab`, `schedule`, `instance`) is resolved independently, exactly
 * as `host/run.ts`'s own argv block resolves `PassDeps`' real values today; `PassDeps` is imported
 * only because it is the one shape `host/run.ts` currently casts every `exec:` job's deps to
 * (Gaps item 7 — a second real shape is what eventually forces that cast open).
 */
export default defineJob({
  name: "ops-cron-check",
  description: "Diff the installed crontab managed block against a fresh render of host/schedule.ts, once a day (JOB-O09).",
  plugin: "ops",
  permissionMode: "auto",
  exec: (deps: PassDeps): Promise<void> =>
    runCheck({
      log: deps.log,
      crontabCmd: envStr(CRONTAB_CMD_ENV),
      readCrontab,
      schedule: SCHEDULE,
      instance: INSTANCE,
    }),
});
