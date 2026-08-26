// J3.6 (HRN-02, HRN-12, HRN-13, HRN-16, SKL-08) — runJob: build the prompt from the skill NAME and
// the args, substitute every placeholder, run, return one RunResult. It does not create or destroy
// a worktree (ruling 4) — the caller that owns the pass owns the tree; `{{WORKTREE}}` is substituted
// here, from an arg the caller supplies (typically `worktreePromptLines` joined), never prepared.
import { DEFAULTS, OPUS_GUIDANCE, assertPinned, skillOf, type Job } from "../ports/job.ts";
import { runTimeoutMs, type Runner, type RunResult } from "../ports/runner.ts";
import { shedModel, type ShedDecision } from "./shed.ts";

export interface RunJobDeps {
  readonly runner: Runner;
  /** Where the agent runs. The CALLER owns this directory — runJob never prepares or removes it. */
  readonly cwd: string;
  /** The run log, one file per run. */
  readonly logPath: string;
  readonly env?: Readonly<Record<string, string>>;
  /** QTA-08's downshift half. REQUIRED, no default (N2 ruling 2: a default a caller can silently
   *  inherit is the failure mode) — the caller (host/run.ts's `runNamed`,
   *  host/jobs/nightly-sandcastle.ts's `execPass`) computes it once and hands it in. */
  readonly shed: ShedDecision;
}

/**
 * HRN-16 and SKL-08 in full, and it is PURE: no path into a skill's own directory, no environment
 * read, no inline prompt text. The skill is named; its payload stays in the markdown a human edits.
 *
 *   <OPUS_GUIDANCE>
 *
 *   /<skillOf(job)>
 *
 *   <key>=<value>     (one line per args entry, sorted — two builds are byte-identical)
 */
export function buildPrompt(job: Job, args: Readonly<Record<string, string>>): string {
  const argLines = Object.keys(args)
    .sort()
    .map((k) => `${k}=${args[k]}`);
  // The skill-invocation slash — a COMMAND prefix, not a path. Signed in test/writes.test.ts's
  // DOOR1_EXCEPTIONS (N3 F2); door 1 decodes escapes now, so no spelling hides from it.
  const skillLine = `/${skillOf(job)}`;
  return [OPUS_GUIDANCE, "", skillLine, "", ...argLines].join("\n");
}

/**
 * Replaces every `{{KEY}}` placeholder `args` names; returns the KEYS it could not resolve rather
 * than throwing, so `runJob` can throw ONCE naming every one of them (the `boot()` shape, KRN-08,
 * one layer down) instead of failing on the first.
 */
export function substitute(
  text: string,
  args: Readonly<Record<string, string>>,
): { readonly out: string; readonly missing: readonly string[] } {
  const missing: string[] = [];
  const seen = new Set<string>();
  const out = text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole: string, key: string) => {
    if (Object.hasOwn(args, key)) return args[key]!;
    if (!seen.has(key)) {
      seen.add(key);
      missing.push(key);
    }
    return whole;
  });
  return { out, missing };
}

/**
 * Five steps, and no worktree among them (ruling 4):
 *   1. D10's two shapes — `job.skill` and `job.exec` both set, or neither, throws.
 *   2. `args = job.promptArgs`; build the prompt from the skill's NAME.
 *   3. substitute every `{{KEY}}`; any left unresolved throws once, naming all.
 *   4. resolve the model (`job.model ?? DEFAULTS.model`), apply QTA-08's `shedModel` CEILING, THEN
 *      `assertPinned` the result — order matters: a downshift target is held to HRN-11 too, and
 *      `assertPinned` is the runtime half of HRN-11 a source-text scan (test/model.test.ts,
 *      J3.10) cannot reach: an env-supplied model never appears as a literal for the scan to find.
 *   5. dispatch to `deps.runner`.
 */
export async function runJob(job: Job, deps: RunJobDeps): Promise<RunResult> {
  const hasSkill = job.skill !== undefined;
  const hasExec = job.exec !== undefined;
  if (hasSkill === hasExec) {
    throw new Error(
      `runJob for ${job.name}: exactly one of job.skill or job.exec must be set (D10: there is no third shape) — skill=${hasSkill}, exec=${hasExec}`,
    );
  }

  const args = job.promptArgs ?? {};
  const prompt = buildPrompt(job, args);
  const { out, missing } = substitute(prompt, args);
  if (missing.length > 0) {
    throw new Error(`runJob for ${job.name}: unresolved prompt placeholder(s): ${missing.join(", ")}`);
  }

  const model = shedModel(job.model ?? DEFAULTS.model, deps.shed);
  assertPinned(model);

  return deps.runner({
    name: job.name,
    prompt: out,
    cwd: deps.cwd,
    model,
    effort: job.effort ?? DEFAULTS.effort,
    permissionMode: job.permissionMode,
    maxIterations: job.maxIterations ?? 20,
    completionSignal: job.completionSignal ?? "<promise>COMPLETE</promise>",
    logPath: deps.logPath,
    deadlineMs: runTimeoutMs(job),
    env: deps.env ?? {},
  });
}
