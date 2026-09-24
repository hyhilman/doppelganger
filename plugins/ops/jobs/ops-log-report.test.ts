// ops-log-report (JOB-O02), every capability faked: the tail, the meta store, the send, the clock.
// The tail itself (cursors, rotation) is tested where it lives, kernel/runtime/log/tail.test.ts.
//
// The error lines below are real ones: each event and message is what an emitter in this repo
// writes today (cli/crontab.ts via ops-cron-check, host/supervisor.ts, host/watchdog.sh).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EnvSpec } from "../../../kernel/plugin.ts";
import {
  reportLogs,
  LAST_OK_KEY,
  LOG_REPORT_DRY_RUN_ENV,
  LOG_REPORT_MAX_KEYS_ENV,
  type Fields,
  type LogReportDeps,
  type TailBatch,
  type TailLine,
} from "./ops-log-report.ts";

const line = (level: string, job: string, event: string, msg = "", fields: Record<string, string> = {}): TailLine => ({
  level,
  job,
  event,
  msg,
  fields,
});

const DRIFT = line("error", "ops-cron-check", "cron-drift", "no managed block installed — run `npm run crontab sync`");
const KILLED = line(
  "error",
  "supervisor",
  "job-failed",
  'Error: NIGHTLY_NO_SANDCASTLE: kill switch must read "0" or "1", got "true"',
  { entry: "nightly-sandcastle", exit: "1" },
);
const NOTIFY = line("error", "ops-watchdog", "notify-failed", "ntfy POST did not return 2xx — this alarm was not delivered", {
  topic: "doppelganger",
  http: "000",
});
const WARN = line("warn", "supervisor", "lease-reap-failed", "database is locked");
const INFO = line("info", "ops-lease-reap", "swept", "", { reaped: "0" });

const batch = (lines: TailLine[], over: Partial<TailBatch> = {}): TailBatch => ({ lines, reset: [], rotated: [], skipped: 0, ...over });

interface Rec {
  readonly level: string;
  readonly event: string;
  readonly fields: Fields;
}

interface Harness {
  readonly deps: LogReportDeps;
  readonly logs: Rec[];
  readonly meta: Map<string, string>;
  readonly metaWrites: string[];
  readonly posts: string[];
  readonly printed: string[];
  readonly advances: boolean[];
  /** Moves the fake clock forward. */
  readonly tick: (minutes: number) => void;
  /** Meta as the send saw it, one snapshot per post. */
  readonly metaAtSend: Map<string, string>[];
}

function harness(
  batches: TailBatch[],
  opts: { env?: Record<string, string>; post?: (body: string) => Promise<{ ok: boolean; detail: string }> } = {},
): Harness {
  const logs: Rec[] = [];
  const meta = new Map<string, string>();
  const metaWrites: string[] = [];
  const posts: string[] = [];
  const printed: string[] = [];
  const advances: boolean[] = [];
  const metaAtSend: Map<string, string>[] = [];
  let clock = Date.parse("2026-09-24T08:00:00Z");
  const at = (level: string) => (event: string, fields: Fields = {}) => {
    logs.push({ level, event, fields });
  };
  const envOf = (spec: EnvSpec): string => opts.env?.[spec.key] ?? spec.default!;
  const deps: LogReportDeps = {
    log: { info: at("info"), warn: at("warn"), error: at("error") },
    env: { str: envOf, num: (spec) => Number(envOf(spec)) },
    now: () => new Date(clock),
    tail: ({ advance }) => {
      advances.push(advance);
      const b = batches.shift();
      assert.ok(b, "the test ran more ticks than it gave batches");
      return b;
    },
    meta: {
      get: (k) => meta.get(k) ?? null,
      set: (k, v) => {
        metaWrites.push(k);
        meta.set(k, v);
      },
    },
    post: async (body) => {
      posts.push(body);
      metaAtSend.push(new Map(meta));
      return opts.post ? opts.post(body) : { ok: true, detail: "http=200" };
    },
    print: (text) => {
      printed.push(text);
    },
  };
  return {
    deps,
    logs,
    meta,
    metaWrites,
    posts,
    printed,
    advances,
    metaAtSend,
    tick: (m) => {
      clock += m * 60_000;
    },
  };
}

const events = (h: Harness): string[] => h.logs.map((r) => `${r.level} ${r.event}`);

test("a healthy tick: tick line with its counts, no-report, no post, and the liveness stamp", async () => {
  const h = harness([batch([INFO, INFO])]);
  await reportLogs(h.deps);
  assert.deepEqual(h.logs, [
    { level: "info", event: "tick", fields: { parsed: 2, errors: 0, warns: 0, rotated: 0, reset: 0 } },
    { level: "info", event: "no-report", fields: { suppressed: 0 } },
  ]);
  assert.deepEqual(h.posts, []);
  assert.equal(h.meta.get(LAST_OK_KEY), "2026-09-24T08:00:00Z");
  assert.deepEqual(h.advances, [true]);
});

test("errors are grouped by job/event, never by msg, most frequent first; warns are one bare count", async () => {
  // Two drift lines with DIFFERENT messages are still one fault.
  const drift2 = { ...DRIFT, msg: "an unnamed managed block is installed" };
  const h = harness([batch([KILLED, DRIFT, WARN, drift2, INFO, DRIFT, WARN])]);
  await reportLogs(h.deps);

  assert.deepEqual(h.logs[0], {
    level: "info",
    event: "tick",
    fields: { parsed: 7, errors: 4, warns: 2, rotated: 0, reset: 0 },
  });
  assert.equal(h.posts.length, 1);
  assert.equal(
    h.posts[0],
    [
      "logs — 4 error line(s) across 2 fault(s).",
      "• `ops-cron-check/cron-drift` — no managed block installed — run `npm run crontab sync` ×3",
      '• `supervisor/job-failed` — Error: NIGHTLY_NO_SANDCASTLE: kill switch must read "0" or "1", got "true" (entry=nightly-sandcastle exit=1)',
      "2 warning(s) this window, not shown.",
    ].join("\n"),
  );
  assert.deepEqual(events(h), ["info tick", "info posted"]);
});

test("severity is the level field alone: an info line that talks about errors is not a fault (LOG-05)", async () => {
  const noisy = line("info", "nightly-sandcastle", "error", "ERROR: level=error in the agent's own words");
  const h = harness([batch([noisy])]);
  await reportLogs(h.deps);
  assert.deepEqual(h.posts, []);
  assert.deepEqual(h.logs[0]!.fields, { parsed: 1, errors: 0, warns: 0, rotated: 0, reset: 0 });
});

test("post stamps are written before the send, and last_report_ok_at after it", async () => {
  const h = harness([batch([DRIFT, KILLED])]);
  await reportLogs(h.deps);
  const seen = h.metaAtSend[0]!;
  assert.equal(seen.get("post:ops-cron-check/cron-drift"), "2026-09-24T08:00:00Z");
  assert.equal(seen.get("post:supervisor/job-failed"), "2026-09-24T08:00:00Z");
  assert.equal(seen.has(LAST_OK_KEY), false, "the liveness stamp must not exist before the send");
  assert.equal(h.metaWrites.at(-1), LAST_OK_KEY, "the liveness stamp is the last write");
});

test("cooldown: a repeated key waits, a NEW key in the same tick is posted at once, and the old key returns after the cooldown", async () => {
  const h = harness([batch([DRIFT]), batch([DRIFT, NOTIFY]), batch([DRIFT]), batch([DRIFT])]);

  await reportLogs(h.deps); // 08:00 — drift posted
  h.tick(10);
  await reportLogs(h.deps); // 08:10 — drift cooling, notify is new
  assert.equal(h.posts.length, 2);
  assert.match(h.posts[1]!, /ops-watchdog\/notify-failed/);
  assert.doesNotMatch(h.posts[1]!, /cron-drift/, "a key in cooldown is not re-posted beside a new one");

  h.tick(10);
  h.logs.length = 0;
  await reportLogs(h.deps); // 08:20 — drift still cooling
  assert.equal(h.posts.length, 2);
  assert.deepEqual(h.logs.at(-1), { level: "info", event: "no-report", fields: { suppressed: 1 } });

  h.tick(10);
  await reportLogs(h.deps); // 08:30 — 30 minutes since 08:00: posted again
  assert.equal(h.posts.length, 3);
  assert.match(h.posts[2]!, /cron-drift/);
});

test("the cooldown is LOG_REPORT_COOLDOWN_M", async () => {
  const h = harness([batch([DRIFT]), batch([DRIFT])], { env: { LOG_REPORT_COOLDOWN_M: "5" } });
  await reportLogs(h.deps);
  h.tick(5);
  await reportLogs(h.deps);
  assert.equal(h.posts.length, 2);
});

test("LOG_REPORT_MAX_KEYS keys are shown, the rest become one '…and N more' line", async () => {
  const lines = Array.from({ length: 5 }, (_, i) => line("error", `ops-job-${i}`, "job-failed", "boom"));
  const h = harness([batch(lines)], { env: { [LOG_REPORT_MAX_KEYS_ENV.key]: "3" } });
  await reportLogs(h.deps);
  const body = h.posts[0]!.split("\n");
  assert.equal(body.filter((l) => l.startsWith("• ")).length, 3);
  assert.ok(body.includes("…and 2 more fault(s) — see the logs."));
  // Every fresh key was stamped, shown or not: a hidden key was reported as a count.
  assert.equal([...h.meta.keys()].filter((k) => k.startsWith("post:")).length, 5);
});

test("warns alone never post, and warns beside errors that are all cooling never post either", async () => {
  const h = harness([batch([WARN, WARN]), batch([DRIFT]), batch([DRIFT, WARN])]);
  await reportLogs(h.deps);
  assert.deepEqual(h.posts, []);
  await reportLogs(h.deps);
  assert.equal(h.posts.length, 1);
  h.tick(1);
  await reportLogs(h.deps);
  assert.equal(h.posts.length, 1, "the only fault is cooling, so the warn count has no report to ride on");
});

test("a failed send is an error line, not a throw; the tick still stamps last_report_ok_at", async () => {
  const h = harness([batch([DRIFT])], { post: async () => ({ ok: false, detail: "http=000" }) });
  await reportLogs(h.deps);
  assert.deepEqual(h.logs.at(-1), { level: "error", event: "report-send-failed", fields: { keys: 1, msg: "http=000" } });
  assert.equal(h.meta.get(LAST_OK_KEY), "2026-09-24T08:00:00Z");
});

test("a send that throws counts as a failed send", async () => {
  const h = harness([batch([DRIFT])], {
    post: async () => {
      throw new Error("fetch failed");
    },
  });
  await reportLogs(h.deps);
  assert.deepEqual(h.logs.at(-1), { level: "error", event: "report-send-failed", fields: { keys: 1, msg: "fetch failed" } });
});

test("dry run: asks the tail not to advance, prints the body, posts nothing, writes no stamp", async () => {
  const env = { [LOG_REPORT_DRY_RUN_ENV.key]: "1" };
  const h = harness([batch([DRIFT, KILLED]), batch([INFO])], { env });
  await reportLogs(h.deps);
  await reportLogs(h.deps); // the healthy path too
  assert.deepEqual(h.advances, [false, false]);
  assert.deepEqual(h.posts, []);
  assert.deepEqual(h.metaWrites, [], "a dry run writes no post stamp and no liveness stamp");
  assert.equal(h.printed.length, 1);
  assert.match(h.printed[0]!, /^logs — 2 error line\(s\) across 2 fault\(s\)\./);
  assert.deepEqual(events(h), ["info tick", "info dry-run", "info tick", "info no-report"]);
});

test("reset, rotated and read-capped files are said out loud, and counted on the tick line", async () => {
  const h = harness([batch([INFO], { reset: ["/r/logs/a.log"], rotated: ["/r/logs/b.log"], skipped: 2048 })]);
  await reportLogs(h.deps);
  assert.deepEqual(h.logs.slice(0, 4), [
    { level: "info", event: "tick", fields: { parsed: 1, errors: 0, warns: 0, rotated: 1, reset: 1 } },
    { level: "warn", event: "cursor-reset", fields: { path: "/r/logs/a.log" } },
    { level: "info", event: "rotated", fields: { path: "/r/logs/b.log" } },
    { level: "warn", event: "read-capped", fields: { skippedBytes: 2048 } },
  ]);
});

test("a tail that throws: error job-failed, the run fails, and no liveness stamp", async () => {
  const h = harness([]);
  h.deps.meta.set("seed", "x");
  h.metaWrites.length = 0;
  const deps: LogReportDeps = {
    ...h.deps,
    tail: () => {
      throw new Error("database is locked: /x/log.db waited=5001ms");
    },
  };
  await assert.rejects(() => reportLogs(deps), /database is locked/);
  assert.deepEqual(h.logs, [{ level: "error", event: "job-failed", fields: { msg: "database is locked: /x/log.db waited=5001ms" } }]);
  assert.deepEqual(h.metaWrites, []);
});
