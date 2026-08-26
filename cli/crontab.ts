// J2.15 (SUP-08 pure half, INS-03, TST-16) — the crontab managed block: per-instance markers and
// the pure string transforms that read/write it.
//
// J2.16 (SUP-08 impure half, SAF-01, SAF-05) adds the side effects: `readCrontab`/`install`
// (both go through `run()`, kernel/runtime/exec.ts's one execFileSync call site, HRN-19) and the
// `render`/`sync`/`check` command dispatcher the argv block calls.
//
// LAYER 0, READ THIS FIRST: `readCrontab` and `install` refuse a command name that is not an
// absolute path. `execFileSync` with a bare name does a PATH lookup, and the thing PATH finds is
// the user's REAL crontab — so a test, a mutation, or a future caller that ever passes a bare
// `"crontab"` is unreachable, not merely discouraged. This is the guard that makes every RED
// mutation this job's ACs describe safe to perform: without it, a mutated `sync` reaching
// `install` would overwrite the developer's own crontab, which is exactly the failure the plan's
// own first draft had.
//
// LAYER 0 DOES NOT COVER A CALLER WHO PASSES NOTHING AT ALL — that is `CRONTAB_CMD_ENV`'s job, one
// level up: the row is `required: true` with NO `default`, so `envStr(CRONTAB_CMD_ENV)` THROWS
// naming the key rather than silently resolving to some absolute path nobody chose. Follow-up F1
// (N2 VERIFY) found the row's old default WAS `"/usr/bin/crontab"` — a real, absolute path on most
// hosts — so a caller who forgot to pass `CRONTAB_CMD` sailed straight past layer 0 and reached the
// developer's real crontab read-only. The two layers are independent on purpose: layer 0 stops a
// PATH lookup, the required row stops a silent default; together they cover "wrong" and "missing".
//
// `cli/` is `private: true` (cli/package.json) — this is an app-internal path, not a published
// import, so reaching into `host/schedule.ts` for `validate`/`bootstrapEntries`/`commandOf`/
// `SCHEDULE` is fine at N2. Whether `cli` publishes at all is still open (ADO-01, plan/N0-uac.md's
// Gaps item 1) — that decision belongs there, not here.
//
// INS-03: the crontab is the one resource two checkouts on the same host cannot avoid sharing, so
// its markers carry the instance name and every transform here operates on ONE instance's region,
// leaving every other line — including a foreign instance's whole block — byte-identical.
//
// THE MARKER TEXT IS NOT PINNED OUTSIDE THIS REPO. If this repo is ever renamed, a block written
// by an older version reads as foreign under the new text and gets APPENDED beside, never
// overwritten. That is the correct behaviour for a marker change, and it is the reason
// `sync --adopt` exists: it re-adopts what the old markers left behind.
import { isAbsolute } from "node:path";
import { validate, bootstrapEntries, supervisedEntries, commandOf, SCHEDULE, type ScheduleEntry } from "../host/schedule.ts";
import { INSTANCE } from "../kernel/instance.ts";
import { run as execCmd, BASE } from "../kernel/runtime/exec.ts";
import { envStr, type EnvSpec } from "../kernel/config.ts";

/** A half-open-by-name, closed-by-index line range: `[start, end]`, both inclusive, into a
 *  `lines` array — the begin marker at `start`, the end marker at `end`. */
export interface Range {
  readonly start: number;
  readonly end: number;
}

/** `# `-prefixed comment lines wrap at this width (columns), matching the reference. */
const COMMENT_WIDTH = 98;

/** The identifier class a marker's `:instance` suffix accepts — kernel/instance.ts's own
 *  `NAME_RE`, restated here rather than imported: that one guards `INSTANCE` at resolution time,
 *  this one is a text-matching detail of a marker LINE, and the two must not become the same
 *  import just because they happen to agree today. */
const INSTANCE_NAME = "[a-z][a-z0-9_-]{0,63}";

/** Matches EITHER a named instance's begin/end line OR the legacy (unnamed) one — used by the
 *  generic block scanner (`allBlockRanges`, `stripAllBlocks`, `adopt`'s duplicate-removal half)
 *  that must find every doppelganger block regardless of whose instance it names. */
const BEGIN_RE = new RegExp(`^# >>> doppelganger(?::${INSTANCE_NAME})? managed block \\(npm run crontab sync\\) >>>$`);
const END_RE = new RegExp(`^# <<< doppelganger(?::${INSTANCE_NAME})? managed block <<<$`);

/** The unnamed pair's exact text — INS-03's own sentence: "the unnamed pair is an unmigrated
 *  block". Written by a version of this tool that predates per-instance markers. */
const LEGACY_BEGIN = "# >>> doppelganger managed block (npm run crontab sync) >>>";
const LEGACY_END = "# <<< doppelganger managed block <<<";

const isComment = (line: string): boolean => line.trimStart().startsWith("#");
const isCommand = (line: string): boolean => line.trim() !== "" && !isComment(line);

/** A crontab's text, split into lines with no trailing empty-string sentinel — the inverse of
 *  `fromLines`. `""` (truly empty, no crontab installed) splits to `[]`. */
function toLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The inverse of `toLines`: every crontab this file WRITES ends in exactly one trailing newline
 *  (the POSIX text-file convention), except the truly empty result, which is `""`. */
function fromLines(lines: readonly string[]): string {
  return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

/** This instance's begin/end marker LINES. Takes `instance` as an argument rather than reading
 *  `INSTANCE` itself, defaulting to it — so a two-instance test can run both instances in one
 *  process (`INSTANCE` is resolved once, at import, in `kernel/instance.ts`, and cannot be moved
 *  in-process) and so a function reading a module global never has to be spawned to be exercised. */
export function markers(instance: string = INSTANCE): { readonly begin: string; readonly end: string } {
  return {
    begin: `# >>> doppelganger:${instance} managed block (npm run crontab sync) >>>`,
    end: `# <<< doppelganger:${instance} managed block <<<`,
  };
}

/**
 * Finds ONLY this instance's begin/end pair. A lone END (no matching BEGIN before it in this
 * search), an inverted pair (END before BEGIN), a half-written pair (one marker missing), or
 * another instance's pair (different text entirely) all yield `null` — "a lone END is not the
 * start of a region" is the one failure that is unrecoverable rather than merely wrong: treating
 * it as a start would slice on it and eat every line above.
 */
export function blockRange(lines: readonly string[], instance: string): Range | null {
  const { begin, end } = markers(instance);
  const start = lines.indexOf(begin);
  if (start === -1) return null;
  const stop = lines.indexOf(end, start);
  if (stop === -1) return null;
  return { start, end: stop };
}

/** The unnamed (legacy) pair, same rules as `blockRange`, matched on the fixed unnamed text. */
export function legacyRange(lines: readonly string[]): Range | null {
  const start = lines.indexOf(LEGACY_BEGIN);
  if (start === -1) return null;
  const stop = lines.indexOf(LEGACY_END, start);
  if (stop === -1) return null;
  return { start, end: stop };
}

/** Every doppelganger block in `lines`, of ANY instance (named or legacy), in order. A BEGIN with
 *  no matching END is left as an ordinary line — the same "do not eat what you cannot close"
 *  rule `blockRange`/`legacyRange` apply to a lone END. */
function allBlockRanges(lines: readonly string[]): Range[] {
  const ranges: Range[] = [];
  let i = 0;
  while (i < lines.length) {
    if (BEGIN_RE.test(lines[i]!)) {
      let j = i + 1;
      while (j < lines.length && !END_RE.test(lines[j]!)) j++;
      if (j < lines.length) {
        ranges.push({ start: i, end: j });
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return ranges;
}

const inAnyRange = (idx: number, ranges: readonly Range[]): boolean => ranges.some((r) => idx >= r.start && idx <= r.end);

/** Reads back exactly what `splice` wrote for `instance`: the begin line through the end line,
 *  inclusive. `null` when this instance has no installed block (including: it is only a legacy,
 *  unnamed one — not ours until `adopt` claims it). */
export function installedBlock(crontab: string, instance: string): readonly string[] | null {
  const lines = toLines(crontab);
  const r = blockRange(lines, instance);
  return r ? lines.slice(r.start, r.end + 1) : null;
}

/**
 * Replaces this instance's region with `block` (the begin line through the end line — see
 * `render`), leaving every other line, including a foreign instance's whole block, byte-identical
 * and in order. Appends when there is none — including to an empty (`""`) crontab, which then
 * holds the block alone. Idempotent: a second `splice` with the same `block` finds the block it
 * just wrote and replaces it with itself, producing byte-identical output — `sync` (J2.16) relies
 * on this to know a no-op run must not rewrite the crontab.
 */
export function splice(crontab: string, block: readonly string[], instance: string): string {
  const lines = toLines(crontab);
  const r = blockRange(lines, instance);
  if (r) {
    return fromLines([...lines.slice(0, r.start), ...block, ...lines.slice(r.end + 1)]);
  }
  return fromLines([...lines, ...block]);
}

/** Every doppelganger block, of any instance, removed — the shared first step `collisions` and
 *  `adopt` both take before treating anything as "unmanaged". */
export function stripAllBlocks(crontab: string): string {
  const lines = toLines(crontab);
  const ranges = allBlockRanges(lines);
  return fromLines(lines.filter((_, i) => !inAnyRange(i, ranges)));
}

/**
 * Unmanaged lines in `crontab` that duplicate a command `block` is about to render. Strips EVERY
 * doppelganger block first (any instance) — the block's own copy of a line must never count as a
 * collision with itself, and neither must another instance's. Comments and blank lines are never
 * candidates. `instance` is accepted for a signature consistent with `blockRange`/`splice`/
 * `adopt`, but the strip step is instance-agnostic by design (INS-03: "of any instance"), so it is
 * unused here — kept anyway rather than dropped, so a caller never has to special-case this one
 * function's arity.
 */
export function collisions(crontab: string, block: readonly string[], instance: string): string[] {
  void instance;
  const stripped = toLines(stripAllBlocks(crontab));
  const commands = new Set(block.filter(isCommand).map((l) => l.trim()));
  return stripped.filter((l) => isCommand(l) && commands.has(l.trim()));
}

/**
 * Two things, both named "adopt" because the CLI runs them together (J2.16's `sync --adopt`):
 *
 * 1. If a legacy (unnamed) pair exists, its begin/end LINES are rewritten to carry `instance` —
 *    the body between them is left untouched. The pair stays standing so the `splice` that follows
 *    REPLACES its (now stale) body rather than appending a second block beside it.
 * 2. Any unmanaged line duplicating a command in `block`, plus the contiguous comment run directly
 *    above it (a blank line stops the run), is dropped. Nothing inside ANY doppelganger block
 *    (named or legacy, this instance's or another's) is ever a candidate — the same protection
 *    `collisions` gives via `stripAllBlocks`, computed here from `allBlockRanges` so step 1's
 *    freshly-renamed pair is protected too, in the same pass.
 */
export function adopt(crontab: string, block: readonly string[], instance: string): string {
  let lines = toLines(crontab);

  const legacy = legacyRange(lines);
  if (legacy) {
    const { begin, end } = markers(instance);
    lines = [...lines.slice(0, legacy.start), begin, ...lines.slice(legacy.start + 1, legacy.end), end, ...lines.slice(legacy.end + 1)];
  }

  const ranges = allBlockRanges(lines);
  const commands = new Set(block.filter(isCommand).map((l) => l.trim()));
  const drop = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (inAnyRange(i, ranges)) continue;
    if (!isCommand(lines[i]!) || !commands.has(lines[i]!.trim())) continue;
    drop.add(i);
    let j = i - 1;
    while (j >= 0 && !inAnyRange(j, ranges) && isComment(lines[j]!)) {
      drop.add(j);
      j--;
    }
  }
  return fromLines(lines.filter((_, i) => !drop.has(i)));
}

/** The `why` word-wrapper: one or more `#`-prefixed lines, each at most `COMMENT_WIDTH` columns
 *  (a single word longer than that overflows its own line rather than being split mid-word). */
export function comment(text: string): string[] {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return ["#"];
  const lines: string[] = [];
  let cur = "#";
  for (const w of words) {
    const next = cur === "#" ? `# ${w}` : `${cur} ${w}`;
    if (next.length > COMMENT_WIDTH && cur !== "#") {
      lines.push(cur);
      cur = `# ${w}`;
    } else {
      cur = next;
    }
  }
  lines.push(cur);
  return lines;
}

/**
 * SUP-01's crontab half: the rendered block for `instance`, holding ONLY what the supervisor
 * cannot schedule for itself — `bootstrapEntries(entries)` (`supervised === false`) — never a
 * compiled copy of the whole schedule. Calls `validate(entries)` over EVERY entry first,
 * supervised or not, so `crontab check` (J2.16) on a daily tick is the cheapest place a
 * boot-breaking schedule surfaces — well before the next restart finds out the hard way.
 * Deterministic: two calls over the same `entries` produce byte-identical lines, so `check` never
 * reports drift that a re-render itself introduced.
 */
export function render(entries: readonly ScheduleEntry[], instance: string = INSTANCE): string[] {
  validate(entries);
  const { begin, end } = markers(instance);
  const lines: string[] = [
    begin,
    "# Generated from host/schedule.ts — do not hand-edit. `npm run crontab check` diffs it.",
    "# BOOTSTRAP ONLY: everything else is scheduled by host/supervisor.ts.",
  ];
  for (const e of bootstrapEntries(entries)) {
    lines.push(...comment(e.why));
    lines.push(`${e.cron} ${commandOf(e)}`);
  }
  lines.push(end);
  return lines;
}

type DiffOp = { readonly kind: "same" | "removed" | "added"; readonly line: string };

/** Standard LCS line alignment — small inputs (one crontab block), so the O(n*m) table is fine. */
function lcsDiff(want: readonly string[], got: readonly string[]): DiffOp[] {
  const n = want.length;
  const m = got.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = want[i] === got[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (want[i] === got[j]) {
      ops.push({ kind: "same", line: want[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: "removed", line: want[i]! });
      i++;
    } else {
      ops.push({ kind: "added", line: got[j]! });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: "removed", line: want[i]! });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "added", line: got[j]! });
    j++;
  }
  return ops;
}

/**
 * A line-level diff between the freshly rendered block (`want`) and what is currently installed
 * (`got`), so `crontab check` (J2.16) can say WHAT drifted, not only THAT it did. A substitution
 * (one line replaced by another at the same position) is reported as one "differs" entry with
 * both an `expected:` and an `installed:` line; a pure insertion or deletion is reported alone.
 */
export function diff(want: readonly string[], got: readonly string[]): string[] {
  const ops = lcsDiff(want, got);
  const out: string[] = [];
  let line = 0;
  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.kind === "same") {
      line++;
      i++;
      continue;
    }
    line++;
    if (op.kind === "removed" && ops[i + 1]?.kind === "added") {
      out.push(`line ${line} differs:`);
      out.push(`  expected: ${JSON.stringify(op.line)}`);
      out.push(`  installed: ${JSON.stringify(ops[i + 1]!.line)}`);
      i += 2;
      continue;
    }
    if (op.kind === "removed") {
      out.push(`line ${line} expected but missing from installed:`);
      out.push(`  expected: ${JSON.stringify(op.line)}`);
      i++;
      continue;
    }
    out.push(`line ${line} installed but not expected:`);
    out.push(`  installed: ${JSON.stringify(op.line)}`);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// J2.16 — the impure half: readCrontab/install (layer 0 first), the safe-run knobs, and the
// render/sync/check dispatcher. See the module header for why layer 0 exists.
// ---------------------------------------------------------------------------------------------

/** Layer 0. The one line that makes a bare command name unreachable: `execFileSync` with a bare
 *  name does a PATH lookup, and the thing PATH finds is the user's real crontab. Called first, by
 *  BOTH `readCrontab` and `install`, before either touches a process. */
function assertAbsoluteCmd(cmd: string): void {
  if (!isAbsolute(cmd)) {
    throw new Error(
      `crontab command must be an absolute path, got ${cmd} — a bare name is a PATH lookup, and the thing PATH finds is the user's real crontab`,
    );
  }
}

export const CRONTAB_CMD_ENV: EnvSpec = {
  key: "CRONTAB_CMD",
  required: true,
  why: "the crontab binary this tool calls; must be absolute (layer 0) — a bare name is a PATH lookup. NO default on purpose (F1): a real, absolute default is itself a real crontab binary, so a caller who forgets to set this must throw, not silently read the developer's own crontab",
};

export const CRONTAB_DRY_RUN_ENV: EnvSpec = {
  key: "CRONTAB_DRY_RUN",
  default: "0",
  why: "sync prints the crontab it would install and calls nothing (SAF-01); it still reads, since the read is what makes the printed diff true",
};

/**
 * `crontab -l`, or `""` when the user has no crontab (a real, non-zero-status `crontab -l` exit —
 * distinct from the command failing to even START, e.g. ENOENT on a bad `cmd`, which re-throws:
 * a missing binary must fail loudly, never look like an empty crontab).
 */
export function readCrontab(cmd: string): string {
  assertAbsoluteCmd(cmd);
  try {
    return execCmd(cmd, ["-l"]);
  } catch (e) {
    const status = (e as { status?: number | null }).status;
    if (typeof status === "number") return ""; // crontab -l: no crontab installed for this user
    throw e; // the command itself never ran (ENOENT, EACCES, ...) — never silently "no crontab"
  }
}

/** `crontab -`, piping `text` in on stdin — the same `stdio`/`input` shape `ghIn` already uses. */
export function install(cmd: string, text: string): void {
  assertAbsoluteCmd(cmd);
  execCmd(cmd, ["-"], { ...BASE, stdio: ["pipe", "pipe", "pipe"], input: text });
}

export interface CrontabDeps {
  readonly cmd: string;
  readonly instance: string;
  readonly schedule: readonly ScheduleEntry[];
  readonly dryRun: boolean;
}

/** The line every success message ends with — "counts what is installed" (SUP-01): `bootstrap` is
 *  read off the block ITSELF (the lines that are actual crontab entries, not the schedule array),
 *  `supervised` off `deps.schedule` via `supervisedEntries` — never `deps.schedule.length`, which
 *  would count entries this tool never renders at all. */
function tally(block: readonly string[], deps: CrontabDeps): string {
  const bootstrapCount = block.filter(isCommand).length;
  const supervisedCount = supervisedEntries(deps.schedule).length;
  return `${bootstrapCount} bootstrap entries (${supervisedCount} more run under host/supervisor.ts)`;
}

function cmdRender(deps: CrontabDeps): { out: string; err: string; code: number } {
  const block = render(deps.schedule, deps.instance);
  return { out: `${block.join("\n")}\n`, err: "", code: 0 };
}

function cmdSync(deps: CrontabDeps, adoptFlag: boolean): { out: string; err: string; code: number } {
  const block = render(deps.schedule, deps.instance);
  const raw = readCrontab(deps.cmd);

  if (!adoptFlag) {
    const dupes = collisions(raw, block, deps.instance);
    if (dupes.length > 0) {
      const lines = dupes.map((l) => `  ${l}`).join("\n");
      return {
        out: "",
        err: `sync refused: ${dupes.length} unmanaged line(s) duplicate a rendered command:\n${lines}\nre-run as \`npm run crontab sync -- --adopt\``,
        code: 1,
      };
    }
  }

  const hadBlock = installedBlock(raw, deps.instance) !== null;
  const base = adoptFlag ? adopt(raw, block, deps.instance) : raw;
  const next = splice(base, block, deps.instance);

  if (next === raw) {
    return { out: "already in sync — nothing written\n", err: "", code: 0 };
  }

  if (deps.dryRun) {
    return { out: next, err: "", code: 0 };
  }

  install(deps.cmd, next);
  const verb = hadBlock ? "the managed block was updated" : "a new managed block was appended";
  return { out: `${verb} — ${tally(block, deps)}\n`, err: "", code: 0 };
}

function cmdCheck(deps: CrontabDeps): { out: string; err: string; code: number } {
  const block = render(deps.schedule, deps.instance);
  const raw = readCrontab(deps.cmd);
  const installed = installedBlock(raw, deps.instance);

  if (installed === null) {
    if (legacyRange(toLines(raw)) !== null) {
      return {
        out: "",
        err: `an unnamed managed block is installed — run \`npm run crontab sync -- --adopt\` to claim it for instance ${JSON.stringify(deps.instance)}`,
        code: 1,
      };
    }
    return { out: "", err: "no managed block installed — run `npm run crontab sync`", code: 1 };
  }

  const inSync = installed.length === block.length && installed.every((l, i) => l === block[i]);
  if (inSync) {
    return { out: `crontab check: in sync — ${tally(block, deps)}\n`, err: "", code: 0 };
  }

  const lines = diff(block, installed);
  return { out: "", err: ["crontab check: drift detected", ...lines].join("\n"), code: 1 };
}

/**
 * The command dispatcher: text in (argv), text and a code out — nothing here touches a stream, so
 * every command is assertable without capturing one. Every path through this function is caught,
 * so a thrown `validate()`/layer-0 refusal becomes `{ code: 1 }` rather than an uncaught rejection.
 */
export function run(argv: readonly string[], deps: CrontabDeps): { out: string; err: string; code: number } {
  try {
    const [name, ...rest] = argv;
    if (name === "render") return cmdRender(deps);
    if (name === "sync") return cmdSync(deps, rest.includes("--adopt"));
    if (name === "check") return cmdCheck(deps);
    return { out: "", err: `unknown command ${JSON.stringify(name ?? "")} — expected one of: render, sync, check`, code: 1 };
  } catch (e) {
    return { out: "", err: e instanceof Error ? e.message : String(e), code: 1 };
  }
}

// ---------------------------------------------------------------------------------------------
// The argv block. UNTESTED BY CONSTRUCTION (plan/N2-uac.md ruling 1) — no test imports this file
// in a way that reaches it. Resolves the knobs (ruling 2: only here, never at module scope),
// dispatches to `run`, and writes the two streams itself.
// ---------------------------------------------------------------------------------------------
if (import.meta.filename === process.argv[1]) {
  const deps: CrontabDeps = {
    cmd: envStr(CRONTAB_CMD_ENV),
    instance: INSTANCE,
    schedule: SCHEDULE,
    dryRun: envStr(CRONTAB_DRY_RUN_ENV) === "1",
  };
  const result = run(process.argv.slice(2), deps);
  if (result.out) process.stdout.write(result.out);
  if (result.err) process.stderr.write(result.err.endsWith("\n") ? result.err : `${result.err}\n`);
  process.exitCode = result.code;
}
