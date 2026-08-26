// J1.2 (LOG-01) — the clock every log line's ts= field reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { nowIso, today } from "./time.ts";

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

test("7. nowIso() matches the shape and is exactly 20 characters", () => {
  const s = nowIso();
  assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(s.length, 20);
});

test("8. nowIso() is unchanged by TZ — the assertion J1.9 leans on", () => {
  const before = Date.now();
  for (const tz of ["Asia/Jakarta", "UTC"]) {
    const out = execFileSync(
      process.execPath,
      ["-e", "import('./kernel/time.ts').then(m => console.log(m.nowIso()))"],
      { cwd: ROOT, env: { ...process.env, TZ: tz }, encoding: "utf8" },
    ).trim();
    const t = Date.parse(out);
    assert.ok(
      Math.abs(t - before) < 5000,
      `nowIso() under TZ=${tz} drifted more than 5s from the parent's clock: ${out}`,
    );
  }
});

test("9. today() is nowIso().slice(0, 10)", () => {
  assert.equal(today(), nowIso().slice(0, 10));
});
