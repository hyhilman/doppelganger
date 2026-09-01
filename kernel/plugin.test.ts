// KRN-04/05/07 — kernel/plugin.ts's own tests: definePlugin's identity, killSwitch's key shape,
// and isKilled's safest-verdict read.
//
// This file lives under kernel/, so it is itself bound by TST-03 rule 1 (a file under kernel/ may
// name only kernel/) — the real subject, NIGHTLY_NO_SANDCASTLE_ENV, is NOT imported here for that
// reason; it is exercised over host/jobs/nightly-sandcastle.ts instead (that file's own test 24,
// and test/knobs.test.ts assertions 1/2/8). This file builds its own fixture rows with
// killSwitch() itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assertSpecShape } from "./config.ts";
import { definePlugin, killSwitch, isKilled, type Plugin, type EnvSpec } from "./plugin.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

test("1. definePlugin is identity, over a manifest carrying exactly its five members", () => {
  const p: Plugin = {
    name: "x",
    kill: [],
    jobs: [],
    schedule: [],
    env: [],
  };
  assert.strictEqual(definePlugin(p), p);
});

test("2. killSwitch: key is <PLUGIN>_NO_<FEATURE>, default \"0\", and the row passes assertSpecShape (KRN-07)", () => {
  const spec: EnvSpec = killSwitch(
    "nightly",
    "sandcastle",
    "the pass logs killed and returns before reading anything",
  );
  assert.equal(spec.key, "NIGHTLY_NO_SANDCASTLE");
  assert.equal(spec.default, "0");
  assert.equal(spec.required, undefined, "required and default must never both be set");
  assert.doesNotThrow(() => assertSpecShape([spec]));
});

test("3. isKilled: \"1\" kills, \"0\" and unset do not (in-process, env restored after)", () => {
  const spec = killSwitch("plugin3", "feature3", "test-only row, never a real subject");
  const prev = process.env[spec.key];
  try {
    delete process.env[spec.key];
    assert.equal(isKilled(spec), false, "unset falls to the row's own default (\"0\") — not killed");

    process.env[spec.key] = "0";
    assert.equal(isKilled(spec), false);

    process.env[spec.key] = "1";
    assert.equal(isKilled(spec), true);
  } finally {
    if (prev === undefined) delete process.env[spec.key];
    else process.env[spec.key] = prev;
  }
});

/** The test/knobs.test.ts assertion 5 pattern, copied rather than reinvented: a scrubbed child
 *  (PATH only, plus the vars this call supplies) so the throw is proven across a real process
 *  boundary, not merely against whatever this test file happens to leave in process.env. */
function scrubbedChild(code: string, env: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["-e", code], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

test("4. isKilled refuses to guess: an unrecognised value THROWS, naming the key and the value seen (KRN-07, scrubbed child)", () => {
  const spec = killSwitch("plugin4", "feature4", "test-only row, never a real subject");
  const code =
    `import(${JSON.stringify("./kernel/plugin.ts")}).then(m => { ` +
    `try { m.isKilled(${JSON.stringify(spec)}); console.log("NO_THROW"); } ` +
    `catch (e) { console.log("THROW:" + e.message); } });`;

  const result = scrubbedChild(code, { [spec.key]: "true" });
  assert.equal(result.status, 0, `child process itself failed to run: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^THROW:/,
    `isKilled("true") must throw rather than read as "not killed" — got: ${result.stdout}`,
  );
  assert.ok(result.stdout.includes(spec.key), `thrown message must name the key ${spec.key}: ${result.stdout}`);
  assert.ok(result.stdout.includes("true"), `thrown message must name the value seen ("true"): ${result.stdout}`);
});

test("5. isKilled: \"\" (empty) counts as unset, same as the EnvSpec default-resolution rule", () => {
  const spec = killSwitch("plugin5", "feature5", "test-only row, never a real subject");
  const prev = process.env[spec.key];
  try {
    process.env[spec.key] = "";
    assert.equal(isKilled(spec), false, "an empty value is unset (kernel/config.ts's readRaw), not an unrecognised value");
  } finally {
    if (prev === undefined) delete process.env[spec.key];
    else process.env[spec.key] = prev;
  }
});
