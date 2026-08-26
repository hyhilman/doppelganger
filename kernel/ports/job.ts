// J3.2 (HRN-01, HRN-02, HRN-07, HRN-13, HRN-15, SKL-01, PRT-08) — the shape a job declares: what a
// job IS, and DEFAULTS in ONE place.
//
// PRT-05 lists `permissionMode` as an optional Job field; this file makes it REQUIRED — a
// deliberate deviation, flagged in roadmap.md's Gaps. HRN-07 says an unattended job hangs on the
// first tool prompt without a permission mode, which is the one omission that is a 3am hang rather
// than a wrong default, so a compile error is the right enforcement (job.test.ts test 8 is the
// suppressed-directive check that makes it one).
//
// PERMISSION_MODES is a two-member allowlist THIS REPO owns, not sandcastle's six-member
// ClaudeCodeOptions.permissionMode union ("default" | "acceptEdits" | "plan" | "auto" | "dontAsk" |
// "bypassPermissions") and not the claude CLI's own advertised list — measured (plan/N3-uac.md
// ruling 1), all three disagree. `plan`/`acceptEdits`/`default` are supervised-only or simply not
// used here; job.test.ts asserts the exclusion so a future edit cannot silently widen it.
//
// DEFAULTS.permissionMode is "bypassPermissions" — the value the one real job (nightly-sandcastle)
// uses — not "auto": nothing at N3 exercises "auto", and "auto does not hang" is unmeasurable
// without a real run that reaches a tool prompt. A default nothing exercises guards nothing.
// Required-plus-real beats optional-plus-aspirational (see the commit body / roadmap Gaps for the
// three reasons).

/** Reasoning effort, matching @ai-hero/sandcastle's ClaudeCodeOptions — kernel/ never imports the
 *  package itself (D1), so the union is restated here rather than imported. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** This repo's own allowlist — see the module header for why it is narrower than either
 *  sandcastle's type union or the claude CLI's advertised list. */
export const PERMISSION_MODES = ["auto", "bypassPermissions"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** HRN-01: ONE place. `model` is a pinned version, never a floating alias (HRN-11) — test/model.ts
 *  (J3.10) scans the whole repo for every OTHER model literal, so this is the one that is allowed
 *  to exist. */
export const DEFAULTS: { readonly model: string; readonly effort: Effort; readonly permissionMode: PermissionMode } = {
  model: "claude-opus-5",
  effort: "high",
  permissionMode: "bypassPermissions",
};

/**
 * PRT-05, with `permissionMode` made required (see the module header) and `worktree`/`session`
 * dropped at N3 (ruling 4 / HRN-06 — session runners are M11's). `skill` and `exec` are D10's two
 * shapes and there is no third: exactly one must be set, enforced at runtime by
 * `kernel/runtime/runjob.ts` (J3.6), because the type alone cannot express "exactly one of".
 */
export interface Job {
  /** SUP-20 prefix; SKL-01 — it IS the skill name. */
  readonly name: string;
  readonly description: string;
  /** Owns the skill file: plugins/<plugin>/skills/<name>/SKILL.md (SKL-03). */
  readonly plugin: string;
  /** Defaults to `name` (skillOf). Absent means `exec` must be set (D10). */
  readonly skill?: string;
  /** The deterministic shape. `never` on purpose: a `Job` in a registry must not be callable by
   *  anyone who does not know the job's own deps shape — the job file re-declares `exec` with its
   *  real type, and `host/run.ts` casts exactly once. */
  readonly exec?: (deps: never) => Promise<void>;
  /** Absent means DEFAULTS.model (HRN-01). */
  readonly model?: string;
  readonly effort?: Effort;
  /** REQUIRED — see the module header. */
  readonly permissionMode: PermissionMode;
  readonly maxIterations?: number;
  readonly completionSignal?: string;
  readonly promptArgs?: Readonly<Record<string, string>>;
  /** HRN-13: declared at the call site that knows the work is implementation-shaped — feeds
   *  `runTimeoutMs` (kernel/ports/runner.ts). */
  readonly taskClass?: "impl";
  /** HRN-14: pins a shared-master writer to one node. A PLACEMENT field, not an authorization
   *  precondition — see kernel/ports/runner.ts's neighbour test/model.test.ts (J3.10) for the
   *  companion scan this distinction requires. */
  readonly local?: boolean;
}

/**
 * "Pinned" (HRN-11, J3.10): names a generation and cannot silently become a different one. Current
 * Anthropic model IDs carry no date suffix and are complete as written (DEFAULTS.model above is
 * one); a dated snapshot is ALSO pinned — this regex accepts both shapes and pins no exact value,
 * because pinning something outside this repo is exactly the thing that rots.
 */
export const PINNED = /^claude-[a-z][a-z0-9]*(?:-\d+)+$/;

/** The belt: spellings PINNED alone might one day be loosened to admit by accident. Every model
 *  literal in this repo must fail every one of these. */
export const ALIASES: readonly RegExp[] = [
  /(^|-)latest$/,
  /^(opus|sonnet|haiku|fable|mythos|default|opusplan)$/,
  /^claude$/,
];

/**
 * The runtime half of HRN-11 — J3.10's static scan cannot see a model an environment variable
 * supplies (`NIGHTLY_SANDCASTLE_MODEL=opus` in `.env` is exactly the floating alias the build gate
 * bans), so this runs at the one place `RunRequest.model` is actually built
 * (`kernel/runtime/runjob.ts`'s `runJob`, J3.6) — the SAME predicate the static scan imports, so the
 * two can never disagree.
 */
export function assertPinned(model: string): void {
  const isAlias = ALIASES.some((re) => re.test(model));
  if (!PINNED.test(model) || isAlias) {
    throw new Error(
      `model ${JSON.stringify(model)} is not pinned (HRN-11): a pinned model names a generation and cannot silently become a different one — got a floating alias or an unrecognised shape`,
    );
  }
}

/** HRN-02: identity. Its only job is to make a job-literal's type inferred as `Job`. */
export const defineJob = (job: Job): Job => job;

/** SKL-01: the skill name IS the job name unless overridden. */
export const skillOf = (job: Job): string => job.skill ?? job.name;

/**
 * HRN-15: the shared agent-discipline preamble prepended to every skill invocation
 * (kernel/runtime/runjob.ts's buildPrompt). Names no path into a skill's own files and no
 * environment variable — SKL-08/HRN-16's rule applies to guidance text as much as to the skill
 * markdown itself, and job.test.ts asserts it directly.
 */
export const OPUS_GUIDANCE: string = [
  "You are running unattended. Nobody is watching this session and nobody will answer a question",
  "you ask, so do not ask one — decide, act, and report what you decided.",
  "",
  "- Delegate only for a wide, genuinely independent sweep. A single focused change is not that.",
  "- Never spawn a subagent to check your own work — a reviewer that shares your blind spots is not",
  "  a review.",
  "- If the work you are given names a skill with its own fan-out (a batch, a rotation, a list of",
  "  items), count what you actually did against what you were asked to do, and say so in your",
  "  report.",
  "- Verify your own claim before you make it. A report that says a suite passed and did not run it",
  "  is worse than no report.",
].join("\n");
