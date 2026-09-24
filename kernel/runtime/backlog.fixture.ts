// Real backlog rows, lifted from the reference store (xenith engine/.sandcastle/state/backlog.db,
// read 2026-09-24). Text is cut short; ids, conv keys, links and times are verbatim (TST-19).
import type { BacklogItem } from "./backlog.ts";

const slack = (
  ts: string,
  author: string,
  text: string,
  parent: { author: string; text: string } | null,
  occurredAt: string,
): BacklogItem => ({
  id: `slack:C0C1DUU1YTV:${ts}`,
  source: "slack",
  externalId: `C0C1DUU1YTV:${ts}`,
  container: "#3_bug-regenerating-webhook-secret-from-merchant-dash-shouldnot-update-in-mpcs",
  author,
  text,
  parentAuthor: parent?.author ?? null,
  parentText: parent?.text ?? null,
  convKey: "slack:C0C1DUU1YTV:1789971761.489389",
  link: `https://xenith-int.slack.com/archives/C0C1DUU1YTV/p${ts.replace(".", "")}?thread_ts=1789971761.489389&cid=C0C1DUU1YTV`,
  occurredAt,
  raw: JSON.stringify({ ts, thread_ts: "1789971761.489389" }),
});

const ROOT_ASK = { author: "Viky Ardiansyah", text: "Hi <@U0BSK3WFASD|Erikson Matondang> look" };

/** One real Slack thread: an ask, then two replies. The reference routed them `question`, `fyi`,
 *  `fyi` — one conversation whose route is the ask's. */
export const THREAD: readonly BacklogItem[] = [
  slack("1789971761.489389", "Viky Ardiansyah", "Hi <@U0BSK3WFASD|Erikson Matondang> look like I fo", null, "2026-09-21T06:22:41Z"),
  slack("1789977055.512419", "Erikson Matondang", "the audit log for webhook secret regenartion will ", ROOT_ASK, "2026-09-21T07:50:55Z"),
  slack("1789977404.215999", "Alfian Wira", "yeah, don't need to care about the actor for now, ", ROOT_ASK, "2026-09-21T07:56:44Z"),
];

const jira = (key: string, stamp: string, occurredAt: string): BacklogItem => ({
  id: `jira:${key}:${stamp}`,
  source: "jira",
  externalId: `${key}:${stamp}`,
  container: "XEN",
  author: null,
  text: `${key} changed`,
  parentAuthor: null,
  parentText: null,
  convKey: `jira:${key}`,
  link: `https://xenith.atlassian.net/browse/${key}`,
  occurredAt,
  raw: "{}",
});

/** Two real Jira rows, each its own conversation (`jira:<KEY>`). Only the id, conv key and time are
 *  lifted; the other fields are fillers no test reads. */
export const JIRA: readonly BacklogItem[] = [
  jira("XEN-8986", "2026-09-23T16:12:05.964+0700", "2026-09-23T09:12:05Z"),
  jira("XEN-8987", "2026-09-23T16:12:12.888+0700", "2026-09-23T09:12:12Z"),
];

/** One real receipt per PIP-04 shape, from the same store. */
export const REAL_REFS = {
  link: "https://github.com/hyhilman/xenith-factory/issues/2242",
  terminal: "terminal:fyi",
  skip: "skip:no-pr-link",
  eod: "resolved:eod",
  picked: "picked:https://github.com/hyhilman/xenith-factory/issues/2059",
  read: "read:2026-09-24",
  dlq: "dlq:brief@8",
} as const;

/** Real receipts the store holds that PIP-04 does not name. */
export const OTHER_REAL_REFS = ["lane:cleared", "moot:answered", "discard:Ready to Release"] as const;
