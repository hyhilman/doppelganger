// ops-lease-reap (JOB-O03), with the reaper faked. The guards themselves are tested where they
// live (kernel/runtime/lease-reap.test.ts); this file tests only what the job writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reapLeases, type Fields, type LeaseReapDeps } from "./ops-lease-reap.ts";

interface Line {
  readonly level: string;
  readonly event: string;
  readonly fields: Fields;
}

function recorder(): { readonly log: LeaseReapDeps["log"]; readonly lines: Line[] } {
  const lines: Line[] = [];
  const at = (level: string) => (event: string, fields: Fields = {}) => {
    lines.push({ level, event, fields });
  };
  return { log: { info: at("info"), error: at("error") }, lines };
}

// The shape `realReapOnBoot` logs today: a `job` lease keyed `<job>@<UTC hour>` (host/run.ts).
const ROW = {
  scope: "job",
  key: "nightly-sandcastle@2026-09-01T16",
  owner: "default:box:4026531836:41277:9f2c1a0b",
  pid: 41277,
  claimedAt: "2026-09-01T16:38:02Z",
  ttlLeftMin: 97,
};

test("one info reaped line per row, then info swept with the count", () => {
  const { log, lines } = recorder();
  const n = reapLeases({ log, reapDead: () => [ROW, { ...ROW, key: "ops-cron-check@2026-09-01T16", pid: 41301, ttlLeftMin: 12 }] });
  assert.equal(n, 2);
  assert.deepEqual(lines, [
    {
      level: "info",
      event: "reaped",
      fields: { scope: "job", key: "nightly-sandcastle@2026-09-01T16", pid: 41277, claimed: "2026-09-01T16:38:02Z", ttlLeftMin: 97 },
    },
    {
      level: "info",
      event: "reaped",
      fields: { scope: "job", key: "ops-cron-check@2026-09-01T16", pid: 41301, claimed: "2026-09-01T16:38:02Z", ttlLeftMin: 12 },
    },
    { level: "info", event: "swept", fields: { reaped: 2 } },
  ]);
});

test("nothing to reap still writes swept reaped=0, so an idle sweep and a dead one differ", () => {
  const { log, lines } = recorder();
  assert.equal(reapLeases({ log, reapDead: () => [] }), 0);
  assert.deepEqual(lines, [{ level: "info", event: "swept", fields: { reaped: 0 } }]);
});

test("a reaper that throws: one error job-failed, no swept line, and the run fails", () => {
  const { log, lines } = recorder();
  assert.throws(
    () =>
      reapLeases({
        log,
        reapDead: () => {
          throw new Error("database is locked: /x/lease.db waited=5003ms");
        },
      }),
    /database is locked/,
  );
  assert.deepEqual(lines, [{ level: "error", event: "job-failed", fields: { msg: "database is locked: /x/lease.db waited=5003ms" } }]);
});
