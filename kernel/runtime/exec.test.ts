// J1.15 (HRN-19) — exec.ts: one process wrapper with a wall clock. Driven through bash so no gh or
// git binary is needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, gh, ghIn, git, BASE } from "./exec.ts";

test("1. a timed-out call is relabelled, naming the deadline and the command", () => {
  assert.throws(
    () => run("bash", ["-c", "sleep 30"], { ...BASE, timeout: 250 }),
    (e: unknown) => (e as Error).message === "bash timed out after 0.25s: bash -c sleep 30",
  );
});

test("2. a non-timeout failure passes through untouched", () => {
  assert.throws(
    () => run("bash", ["-c", "echo boom 1>&2; exit 3"]),
    (e: unknown) => {
      const err = e as { status?: number; stderr?: string };
      return err.status === 3 && (err.stderr ?? "").includes("boom");
    },
  );
});

test("3. success returns stdout", () => {
  assert.equal(run("bash", ["-c", "echo hi"]), "hi\n");
});

test("4. a command longer than 200 characters is clipped and ends with an ellipsis", () => {
  const longArg = "x".repeat(250);
  assert.throws(
    () => run("bash", ["-c", "sleep 30", longArg], { ...BASE, timeout: 100 }),
    (e: unknown) => {
      const msg = (e as Error).message;
      return msg.endsWith("…") && msg.length < 250;
    },
  );
});

test("5. BASE carries SIGKILL, utf8 encoding, and its own positive timeout", () => {
  assert.equal(BASE.killSignal, "SIGKILL");
  assert.equal(BASE.encoding, "utf8");
  // A caller that does not override the timeout still gets one — this is what makes assertion 1's
  // { ...BASE, timeout: 250 } spread meaningful rather than decorative: BASE itself must default to
  // a real, positive number, not undefined.
  assert.equal(typeof BASE.timeout, "number");
  assert.ok((BASE.timeout as number) > 0);
});

test("6. gh, ghIn and git all route through run and build the right argv", () => {
  // Scrub PATH so "git"/"gh" cannot be found even where they are installed (measured present on
  // this machine) — the shape is checked via the ENOENT error's own spawnargs, never by actually
  // running either binary. If a platform does not populate spawnargs, this needs a "git" stand-in
  // placed first on PATH instead — noted here rather than silently dropped.
  const savedPath = process.env.PATH;
  process.env.PATH = "";
  try {
    assert.throws(() => git("/tmp", "status"), (e: unknown) => {
      const err = e as { spawnargs?: string[] };
      return Array.isArray(err.spawnargs) && err.spawnargs.includes("/tmp") && err.spawnargs.includes("status");
    });
    assert.throws(() => gh("pr", "view"), (e: unknown) => {
      const err = e as { spawnargs?: string[] };
      return Array.isArray(err.spawnargs) && err.spawnargs.includes("pr") && err.spawnargs.includes("view");
    });
    assert.throws(() => ghIn("body text", "pr", "comment", "--body-file", "-"), (e: unknown) => {
      const err = e as { spawnargs?: string[] };
      return Array.isArray(err.spawnargs) && err.spawnargs.includes("--body-file");
    });
  } finally {
    process.env.PATH = savedPath;
  }
});
