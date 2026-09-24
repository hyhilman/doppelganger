// Report `level=error` lines from both log roots, every few minutes (JOB-O02).
//
// A heartbeat proves one job's transport works and says nothing about the others. A reader over the
// shared log format sees every emitter, the bash ones too, and needs nothing from a job beyond
// writing its lines through the logger.
//
// SILENT WHEN HEALTHY, on purpose: an all-clear every few minutes is noise that trains you to ignore
// the channel. So the `tick` line is written on EVERY run instead — that line is how a quiet healthy
// reader and a dead one stop looking alike.
//
// Routing is LOG-04: `error` lines are reported, grouped per `job/event`; `warn` lines are only a
// bare count, and only on a tick that posts; `info` and `debug` never show. Severity is read from
// the `level` field and nothing else (LOG-05).
//
// No LLM: parsing is a regex over bytes already on disk, so this is cheap to run through an outage.
import type { EnvSpec } from "../../../kernel/plugin.ts";
import type { JobContext, NotifyResult } from "../../../kernel/ports/context.ts";
import { defineJob } from "../../../kernel/ports/job.ts";

export const LOG_REPORT_COOLDOWN_M_ENV: EnvSpec = {
  key: "LOG_REPORT_COOLDOWN_M",
  default: "30",
  why: "minutes before the same job/event fault is posted again; a new fault is never delayed (JOB-O02)",
};
export const LOG_REPORT_MAX_KEYS_ENV: EnvSpec = {
  key: "LOG_REPORT_MAX_KEYS",
  default: "8",
  why: "fault keys shown in one report; the rest become one '…and N more' line (JOB-O02)",
};
export const LOG_REPORT_DRY_RUN_ENV: EnvSpec = {
  key: "LOG_REPORT_DRY_RUN",
  default: "0",
  why: "1 = print the report to stdout; post nothing, stamp nothing, move no log cursor (SAF-01)",
};

export const LOG_REPORT_ENV: readonly EnvSpec[] = [LOG_REPORT_COOLDOWN_M_ENV, LOG_REPORT_MAX_KEYS_ENV, LOG_REPORT_DRY_RUN_ENV];

/** Log fields, the same shape the kernel logger takes. */
export type Fields = Record<string, string | number | boolean | null | undefined>;

/** One parsed log line — the parts this job reads. */
export interface TailLine {
  readonly level: string;
  readonly job: string;
  readonly event: string;
  readonly msg: string;
  readonly fields: Readonly<Record<string, string>>;
}

/** What one read of both log roots returned. */
export interface TailBatch {
  readonly lines: readonly TailLine[];
  /** Files whose cursor was reset because they were replaced or truncated under the reader. */
  readonly reset: readonly string[];
  /** Files this read rotated. */
  readonly rotated: readonly string[];
  /** Bytes skipped because one file grew past the read cap. */
  readonly skipped: number;
}

export interface LogReportDeps {
  readonly log: {
    info(event: string, fields?: Fields): void;
    warn(event: string, fields?: Fields): void;
    error(event: string, fields?: Fields): void;
  };
  /** Reads this job's own `EnvSpec` rows. */
  readonly env: {
    str(spec: EnvSpec): string;
    num(spec: EnvSpec): number;
  };
  readonly now: () => Date;
  /** Reads both log roots forward from their cursors. With `advance: false` it must move no
   *  cursor and rotate nothing. */
  readonly tail: (opts: { readonly advance: boolean }) => TailBatch;
  /** This job's small key/value store: the per-key post stamps and `last_report_ok_at`. */
  readonly meta: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
  /** Sends the report. Never expected to throw; if it does, it counts as a failed send.
   *  `configured: false` means there is no channel to send on, which is not a failure. */
  readonly post: (body: string) => Promise<NotifyResult>;
  /** Writes to stdout. Only a dry run uses it. */
  readonly print: (text: string) => void;
}

export interface Group {
  readonly key: string;
  readonly n: number;
  readonly first: TailLine;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const iso = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** The meta key that holds when `key` was last posted. */
export const postKey = (key: string): string => `post:${key}`;
export const LAST_OK_KEY = "last_report_ok_at";

/**
 * Group error lines by `job/event`, never by `msg`: the message carries the detail that changes
 * (which PR, which id), so grouping on it turns one recurring fault into N single ones. Most
 * frequent first; a tie keeps the order the lines came in.
 */
export function group(lines: readonly TailLine[]): Group[] {
  const out = new Map<string, { key: string; n: number; first: TailLine }>();
  for (const l of lines) {
    if (l.level !== "error") continue;
    const key = `${l.job}/${l.event}`;
    const g = out.get(key);
    if (g) g.n++;
    else out.set(key, { key, n: 1, first: l });
  }
  return [...out.values()].sort((a, b) => b.n - a.n);
}

/** One compact line per fault: `` `job/event` — msg (k=v …) ×n ``. */
function renderGroup(g: Group): string {
  const l = g.first;
  const extra = Object.entries(l.fields);
  return (
    `• \`${g.key}\`` +
    (l.msg ? ` — ${l.msg}` : "") +
    (extra.length ? ` (${extra.map(([k, v]) => `${k}=${v}`).join(" ")})` : "") +
    (g.n > 1 ? ` ×${g.n}` : "")
  );
}

/** The report body. `groups` is already the fresh set, most frequent first. */
export function render(groups: readonly Group[], warns: number, maxKeys: number, note: readonly string[]): string {
  const shown = groups.slice(0, maxKeys);
  const hidden = groups.length - shown.length;
  const total = groups.reduce((n, g) => n + g.n, 0);
  const lines = [`logs — ${total} error line(s) across ${groups.length} fault(s).`, ...shown.map(renderGroup)];
  if (hidden > 0) lines.push(`…and ${hidden} more fault(s) — see the logs.`);
  if (warns > 0) lines.push(`${warns} warning(s) this window, not shown.`);
  if (note.length) lines.push(note.join(" · "));
  return lines.join("\n");
}

/**
 * One tick. The order matters:
 *   1. read, then write the `tick` line — every run, healthy or not;
 *   2. keep only keys out of cooldown; a key with no stamp is new and is never delayed;
 *   3. nothing fresh -> `no-report`, stamp `last_report_ok_at`, done — no post;
 *   4. write the post stamps BEFORE the send, so a run that dies mid-send cannot re-post the same
 *      keys every tick;
 *   5. send; a failed send is an `error` line, never a throw (its own delivery stamp, JOB-O11,
 *      tells the watchdog). No channel set up is an `info` line instead: an error line there
 *      would be reported itself on the next tick, again every cooldown, with nowhere to go;
 *   6. stamp `last_report_ok_at` LAST. It means "the reader finished a tick" (JOB-B12), so a
 *      failed send still stamps it, and a crash never does.
 *
 * A dry run reads without moving any cursor and without rotating (it asks the tail for
 * `advance: false`), prints the body to stdout, and writes no stamp of any kind. So the next real
 * tick still sees and reports the same lines.
 *
 * Any other failure writes `error job-failed` and throws, so the run exits non-zero.
 */
export async function reportLogs(deps: LogReportDeps): Promise<void> {
  try {
    await tick(deps);
  } catch (e) {
    deps.log.error("job-failed", { msg: errText(e) });
    throw e;
  }
}

async function tick(deps: LogReportDeps): Promise<void> {
  const dryRun = deps.env.str(LOG_REPORT_DRY_RUN_ENV) === "1";
  const cooldownMs = deps.env.num(LOG_REPORT_COOLDOWN_M_ENV) * 60_000;
  const maxKeys = deps.env.num(LOG_REPORT_MAX_KEYS_ENV);

  const t = deps.tail({ advance: !dryRun });
  const groups = group(t.lines);
  const errors = groups.reduce((n, g) => n + g.n, 0);
  const warns = t.lines.filter((l) => l.level === "warn").length;

  deps.log.info("tick", { parsed: t.lines.length, errors, warns, rotated: t.rotated.length, reset: t.reset.length });
  // A reset means a window of lines nobody read. A silent gap in a fault reporter is the failure
  // this job exists to remove, so it is said out loud.
  for (const p of t.reset) deps.log.warn("cursor-reset", { path: p });
  for (const p of t.rotated) deps.log.info("rotated", { path: p });
  if (t.skipped > 0) deps.log.warn("read-capped", { skippedBytes: t.skipped });

  const now = deps.now();
  const fresh = groups.filter((g) => {
    const last = deps.meta.get(postKey(g.key));
    if (last === null) return true;
    const at = Date.parse(last);
    // A stamp we cannot read is treated as no stamp: fail toward reporting.
    return !Number.isFinite(at) || now.getTime() - at >= cooldownMs;
  });

  if (fresh.length === 0) {
    deps.log.info("no-report", { suppressed: groups.length });
    if (!dryRun) deps.meta.set(LAST_OK_KEY, iso(now));
    return;
  }

  const note: string[] = [];
  if (t.skipped > 0) note.push(`${(t.skipped / 1024 / 1024).toFixed(1)} MB skipped (read cap)`);
  if (t.rotated.length) note.push(`${t.rotated.length} log(s) rotated`);
  const body = render(fresh, warns, maxKeys, note);

  if (dryRun) {
    deps.log.info("dry-run", { keys: fresh.length });
    deps.print(body);
    return;
  }

  for (const g of fresh) deps.meta.set(postKey(g.key), iso(now));
  let res: NotifyResult;
  try {
    res = await deps.post(body);
  } catch (e) {
    res = { ok: false, configured: true, detail: errText(e) };
  }
  if (res.ok) deps.log.info("posted", { keys: fresh.length, detail: res.detail });
  else if (!res.configured) deps.log.info("report-skipped", { keys: fresh.length, reason: "no-channel" });
  else deps.log.error("report-send-failed", { keys: fresh.length, msg: res.detail });

  deps.meta.set(LAST_OK_KEY, iso(deps.now()));
}

/** Every five minutes, so its run lease is keyed on the minute: an hourly key would refuse 11 of
 *  every 12 ticks. */
export default defineJob({
  name: "ops-log-report",
  description: "Report level=error lines from both log roots, grouped per job/event, every five minutes (JOB-O02).",
  plugin: "ops",
  permissionMode: "auto",
  leaseWindow: "minute",
  exec: (ctx: JobContext): Promise<void> =>
    reportLogs({
      log: ctx.log,
      env: ctx.env,
      now: ctx.now,
      tail: ctx.tailLogs,
      meta: ctx.logMeta,
      post: ctx.notify,
      print: ctx.print,
    }),
});
