// J4.9 (QTA-08, QTA-09) — decideShed's decision table, pinned as one grid, plus shedModel and the
// purity claim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { decideShed, shedModel, NO_SHED, type JobClass, type ShedDecision } from "./shed.ts";
import { LIMIT_CLASSES } from "./quota.ts";
import { DEFAULTS } from "../ports/job.ts";

const JOB_CLASSES: readonly JobClass[] = ["chore", "watch", "review"];

const NOW = new Date("2026-08-26T12:00:00Z");
const WINDOW_MS = 2 * 60 * 60 * 1000; // an arbitrary FIXED window, independent of the env default

/** The four `since` shapes `decideShed`'s type can hold, for the grid and for test 7's sweep. */
function sinceStates(now: Date, windowMs: number): { readonly label: string; readonly since: string | null }[] {
  return [
    { label: "null", since: null },
    { label: "recent", since: new Date(now.getTime() - windowMs / 2).toISOString() },
    { label: "old", since: new Date(now.getTime() - windowMs * 2).toISOString() },
    { label: "unparseable", since: "garbage" },
  ];
}

test("1. the whole table as one grid — 7 limit classes x 3 job classes x 4 since states = 84 cells", () => {
  const states = sinceStates(NOW, WINDOW_MS);
  assert.equal(LIMIT_CLASSES.length * JOB_CLASSES.length * states.length, 84);

  let cells = 0;
  for (const limit of LIMIT_CLASSES) {
    for (const cls of JOB_CLASSES) {
      for (const s of states) {
        cells++;
        const snapshot = { limit, since: s.since };
        // The two rules, computed independently of shed.ts's own implementation.
        const recent = limit === "spend" && s.since != null && NOW.getTime() - Date.parse(s.since) <= WINDOW_MS;
        const expected: ShedDecision = recent ? { skip: cls === "chore", downshift: cls !== "review" } : NO_SHED;
        assert.deepEqual(
          decideShed(snapshot, cls, NOW, WINDOW_MS),
          expected,
          `limit=${limit} cls=${cls} since=${s.label}`,
        );
      }
    }
  }
  assert.equal(cells, 84);
});

test("2. a recent spend wall — chore {true,true}, watch {false,true}, review {false,false}", () => {
  const since = new Date(NOW.getTime() - WINDOW_MS / 2).toISOString();
  const snapshot = { limit: "spend" as const, since };
  assert.deepEqual(decideShed(snapshot, "chore", NOW, WINDOW_MS), { skip: true, downshift: true });
  assert.deepEqual(decideShed(snapshot, "watch", NOW, WINDOW_MS), { skip: false, downshift: true });
  assert.deepEqual(decideShed(snapshot, "review", NOW, WINDOW_MS), { skip: false, downshift: false });
});

test("3. a wall older than the window sheds nothing, for any class", () => {
  const since = new Date(NOW.getTime() - WINDOW_MS * 2).toISOString();
  const snapshot = { limit: "spend" as const, since };
  for (const cls of JOB_CLASSES) {
    assert.deepEqual(decideShed(snapshot, cls, NOW, WINDOW_MS), NO_SHED, cls);
  }
});

test("4. a scope never paused sheds nothing, and neither does an unparseable since", () => {
  for (const since of [null, "garbage"] as const) {
    const snapshot = { limit: "spend" as const, since };
    for (const cls of JOB_CLASSES) {
      assert.deepEqual(decideShed(snapshot, cls, NOW, WINDOW_MS), NO_SHED, `since=${since} cls=${cls}`);
    }
  }
});

test("5. an explicit windowMs beats the env default — 90 minutes ago is outside a 1h window and inside a 2h one", () => {
  const since = new Date(NOW.getTime() - 90 * 60 * 1000).toISOString();
  const snapshot = { limit: "spend" as const, since };
  assert.deepEqual(decideShed(snapshot, "chore", NOW, 60 * 60 * 1000), NO_SHED);
  assert.deepEqual(decideShed(snapshot, "chore", NOW, 2 * 60 * 60 * 1000), { skip: true, downshift: true });
});

test("6. shedModel downshifts opus, leaves sonnet and haiku alone, and leaves opus alone when not asked", () => {
  const shed: ShedDecision = { skip: false, downshift: true };
  assert.equal(shedModel(DEFAULTS.model, shed), DEFAULTS.shedModel);
  assert.equal(shedModel("claude-opus-4-8", shed), DEFAULTS.shedModel);
  assert.equal(shedModel("claude-sonnet-5", shed), "claude-sonnet-5");
  assert.equal(shedModel("claude-haiku-4-5", shed), "claude-haiku-4-5");
  assert.equal(shedModel(DEFAULTS.model, NO_SHED), DEFAULTS.model);
});

test("7. decideShed touches nothing — QUOTA_DB points nowhere and no file appears (purity as an observation, not a promise)", () => {
  const missing = join("/tmp", `shed-purity-${process.pid}-${Date.now()}.db`);
  assert.ok(!existsSync(missing), "precondition: nothing already there");
  const prevQuotaDb = process.env.QUOTA_DB;
  process.env.QUOTA_DB = missing;
  try {
    for (const limit of LIMIT_CLASSES) {
      for (const cls of JOB_CLASSES) {
        for (const s of sinceStates(NOW, WINDOW_MS)) {
          decideShed({ limit, since: s.since }, cls, NOW, WINDOW_MS);
        }
      }
    }
  } finally {
    if (prevQuotaDb === undefined) delete process.env.QUOTA_DB;
    else process.env.QUOTA_DB = prevQuotaDb;
  }
  assert.ok(!existsSync(missing), "decideShed must never open a database — no DB read, no env lookup inside it");
});
