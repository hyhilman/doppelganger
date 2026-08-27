// J4.8 (QTA-01, QTA-05/06/07, TST-19) — the quota classifier's corpus, lifted from REAL data,
// never invented. Two tiers only.
//
// Tier 1 — recorded first-hand on THIS machine, 2026-08-26:
// xenith/engine/.sandcastle/state/quota.db, every `note:`/`since:` pair the store held, read via
// `node:sqlite` directly (no sqlite3 CLI on this host). `class:` is recorded on the three worker
// rows only — `claude`'s row predates the `class:` key, which is exactly the row `inspect`'s
// fallback (classify the raw `note:`) exists for.
//
// Tier 2 — the reference's own test corpus, xenith/engine/src/lib/quota.test.ts, read verbatim.
// Only the three *spend* positives carry a dated incident comment there (two from 2026-08-10 —
// cps#1820's review and #649's triage — and one from the 2026-08-18 outage); the six period
// wordings and all six negatives are bare list entries with no date at all. Writing a plausible
// date onto an undated row would be invention by another route, so `recordedAt` is `string | null`
// and is populated ONLY where the source actually names one.
//
// No first-hand row spells the BARE "You've hit your ... spend limit" wording — every one carries
// a wrapper prefix ("task 502 failed: ...", or "claude-code exited with code 1:\n..."). The bare
// spelling exists only in tier 2, marked `via: "reference-corpus"`. A row spelling it and marked
// `first-hand` would be exactly the TST-19 violation this file exists to avoid making twice.
//
// Tier 1's `recordedAt` is a CAPTURE-TIME SNAPSHOT of the store's own `since:` value, not a
// live-pinned truth — the store moves independently (a re-park writes a fresh `since:`), so this
// value WILL drift and is expected to. Measured directly: `worker-nexus-ashton`'s `since:` read
// `2026-08-26T06:40:42Z` when this fixture was captured and `2026-08-26T21:38:10Z` a day later —
// an external mutable value copied into the repo, exactly what LOOP.md's "never pin an exact
// value of something outside this repo" warns against. Kept anyway, because it answers a
// different question than "is this still the live value": it is provenance — when THIS evidence
// was captured — not a claim the store still says so. `quota.test.ts` test 14's
// `QUOTA_FIXTURE_RECHECK` therefore re-verifies the tier-1 rows' MESSAGES (the actual classifier
// input) against the live store, but deliberately never `recordedAt` against it.
import type { LimitClass } from "./quota.ts";

export interface LimitFixture {
  readonly message: string;
  readonly expect: { readonly isLimit: boolean; readonly class: LimitClass };
  /** Where the bytes came from. */
  readonly source: string;
  /** When, if the source names one — `null` is legal and means it does not. */
  readonly recordedAt: string | null;
  readonly via: "first-hand" | "reference-corpus";
}

export const LIMITS: readonly LimitFixture[] = [
  // ---------------------------------------------------------------------------------------------
  // Tier 1 — first-hand, xenith/engine/.sandcastle/state/quota.db, 2026-08-26.
  // ---------------------------------------------------------------------------------------------
  {
    message:
      "task 502 failed: claude-code exited with code 1:\nYou've hit your org's monthly spend limit · run /usage-credits to ask your admin for a higher limit",
    expect: { isLimit: true, class: "spend" },
    source: "xenith/engine/.sandcastle/state/quota.db note:claude",
    recordedAt: "2026-08-12T03:04:13Z", // since:claude — this row predates the class: key
    via: "first-hand",
  },
  {
    message:
      "claude-code exited with code 1:\nYou've hit your org's monthly spend limit · run /usage-credits to ask your admin for a higher limit",
    expect: { isLimit: true, class: "spend" },
    source: "xenith/engine/.sandcastle/state/quota.db note:worker:worker-nexus-bennet",
    recordedAt: "2026-08-26T07:24:07Z", // since:worker:worker-nexus-bennet
    via: "first-hand",
  },
  {
    message:
      "claude-code exited with code 1:\nYou've hit your org's monthly spend limit · run /usage-credits to ask your admin for a higher limit",
    expect: { isLimit: true, class: "spend" },
    source: "xenith/engine/.sandcastle/state/quota.db note:worker:worker-nexus-keaton",
    recordedAt: "2026-08-26T05:39:07Z", // since:worker:worker-nexus-keaton
    via: "first-hand",
  },
  {
    message:
      "claude-code exited with code 1:\nYou've hit your org's monthly spend limit · run /usage-credits to ask your admin for a higher limit",
    expect: { isLimit: true, class: "spend" },
    source: "xenith/engine/.sandcastle/state/quota.db note:worker:worker-nexus-ashton",
    recordedAt: "2026-08-26T06:40:42Z", // since:worker:worker-nexus-ashton
    via: "first-hand",
  },

  // ---------------------------------------------------------------------------------------------
  // Tier 2 — reference corpus, xenith/engine/src/lib/quota.test.ts. Positives: the six bare period
  // wordings (undated), then the three spend wordings (two dated 2026-08-10, one 2026-08-18).
  // ---------------------------------------------------------------------------------------------
  {
    message: "You've hit your weekly limit · resets Aug 5, 4am (UTC)",
    expect: { isLimit: true, class: "weekly" },
    source: "xenith/engine/src/lib/quota.test.ts",
    recordedAt: null,
    via: "reference-corpus",
  },
  {
    message: "Claude AI usage limit reached",
    expect: { isLimit: true, class: "usage" },
    source: "xenith/engine/src/lib/quota.test.ts",
    recordedAt: null,
    via: "reference-corpus",
  },
  {
    message: "5-hour limit reached",
    expect: { isLimit: true, class: "unknown" },
    source: "xenith/engine/src/lib/quota.test.ts",
    recordedAt: null,
    via: "reference-corpus",
  },
  {
    message: "Monthly limit reached — upgrade to continue",
    expect: { isLimit: true, class: "monthly" },
    source: "xenith/engine/src/lib/quota.test.ts",
    recordedAt: null,
    via: "reference-corpus",
  },
  {
    message: "SESSION LIMIT reached",
    expect: { isLimit: true, class: "session" },
    source: "xenith/engine/src/lib/quota.test.ts",
    recordedAt: null,
    via: "reference-corpus",
  },
  {
    message: "daily limit reached",
    expect: { isLimit: true, class: "daily" },
    source: "xenith/engine/src/lib/quota.test.ts",
    recordedAt: null,
    via: "reference-corpus",
  },
  {
    message: "You've hit your org's monthly spend limit · run /usage-credits to ask your admin for a higher limit",
    expect: { isLimit: true, class: "spend" },
    source: "xenith/engine/src/lib/quota.test.ts — cps#1820's review, one of \"the two 08-10 ones\"",
    recordedAt: "2026-08-10",
    via: "reference-corpus",
  },
  {
    message: "You've hit your monthly spend limit · raise it at claude.ai/settings/usage?from=cc_cli_limit_message",
    expect: { isLimit: true, class: "spend" },
    source: "xenith/engine/src/lib/quota.test.ts — #649's triage, the other of \"the two 08-10 ones\"",
    recordedAt: "2026-08-10",
    via: "reference-corpus",
  },
  {
    message: "claude-code exited with code 1:\nYou've hit your org's monthly spend limit",
    expect: { isLimit: true, class: "spend" },
    source: "xenith/engine/src/lib/quota.test.ts — \"the 2026-08-18 outage\"",
    recordedAt: "2026-08-18",
    via: "reference-corpus",
  },

  // ---------------------------------------------------------------------------------------------
  // Tier 2 — negatives. The ones that matter more than the positives: every one contains the word
  // "limit" without being a plan wall.
  // ---------------------------------------------------------------------------------------------
  {
    message: "Validation Failed: body exceeds the 65536 character limit",
    expect: { isLimit: false, class: "unknown" },
    source: "xenith/engine/src/lib/quota.test.ts",
    recordedAt: null,
    via: "reference-corpus",
  },
  {
    message: "API rate limit exceeded for user ID 1234",
    expect: { isLimit: false, class: "unknown" },
    source: "xenith/engine/src/lib/quota.test.ts",
    recordedAt: null,
    via: "reference-corpus",
  },
  {
    message: "ENOENT: no such file or directory, open '.sandcastle/.env'",
    expect: { isLimit: false, class: "unknown" },
    source: "xenith/engine/src/lib/quota.test.ts",
    recordedAt: null,
    via: "reference-corpus",
  },
  {
    message: "gh: Not Found (HTTP 404)",
    expect: { isLimit: false, class: "unknown" },
    source: "xenith/engine/src/lib/quota.test.ts",
    recordedAt: null,
    via: "reference-corpus",
  },
  {
    message: "worker blew up",
    expect: { isLimit: false, class: "unknown" },
    source: "xenith/engine/src/lib/quota.test.ts",
    recordedAt: null,
    via: "reference-corpus",
  },
  {
    message: "",
    expect: { isLimit: false, class: "unknown" },
    source: "xenith/engine/src/lib/quota.test.ts",
    recordedAt: null,
    via: "reference-corpus",
  },
];
