// EnvSpec, the spec-taking env readers, and assertSpecShape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { envStr, envOptional, envDynamic, envNum, assertSpecShape, type EnvSpec } from "./config.ts";

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const prev = process.env[key];
  try {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    fn();
  } finally {
    if (had) process.env[key] = prev as string;
    else delete process.env[key];
  }
}

test("1. envStr returns the env value when set", () => {
  withEnv("DOPPELGANGER_TEST_X", "hello", () => {
    assert.equal(envStr({ key: "DOPPELGANGER_TEST_X", default: "d", why: "test knob" }), "hello");
  });
});

test('2. envStr treats "" as unset and returns the default', () => {
  withEnv("DOPPELGANGER_TEST_X", "", () => {
    assert.equal(envStr({ key: "DOPPELGANGER_TEST_X", default: "d", why: "test knob" }), "d");
  });
});

test("3. envStr on a required spec with nothing set throws naming the key and the why", () => {
  withEnv("DOPPELGANGER_TEST_REQ", undefined, () => {
    assert.throws(
      () => envStr({ key: "DOPPELGANGER_TEST_REQ", required: true, why: "the test reason" }),
      (e: unknown) => {
        const msg = (e as Error).message;
        return msg.includes("DOPPELGANGER_TEST_REQ") && msg.includes("the test reason");
      },
    );
  });
});

test("4. envNum parses an integer, and throws naming the key and the value on garbage", () => {
  withEnv("DOPPELGANGER_TEST_NUM", "42", () => {
    assert.equal(envNum({ key: "DOPPELGANGER_TEST_NUM", default: "0", why: "test knob" }), 42);
  });
  withEnv("DOPPELGANGER_TEST_NUM", "8MB", () => {
    assert.throws(
      () => envNum({ key: "DOPPELGANGER_TEST_NUM", default: "0", why: "test knob" }),
      (e: unknown) => {
        const msg = (e as Error).message;
        return msg.includes("DOPPELGANGER_TEST_NUM") && msg.includes("8MB");
      },
    );
  });
});

test("5. envNum rejects negative; envOptional never falls back; envDynamic reads a raw key", () => {
  withEnv("DOPPELGANGER_TEST_NEG", "-1", () => {
    assert.throws(() => envNum({ key: "DOPPELGANGER_TEST_NEG", default: "0", why: "test knob" }));
  });
  withEnv("DOPPELGANGER_TEST_OPT", undefined, () => {
    assert.equal(
      envOptional({ key: "DOPPELGANGER_TEST_OPT", default: "d", why: "test knob" } as EnvSpec),
      undefined,
    );
  });
  withEnv("NOPE_DB", undefined, () => {
    assert.equal(envDynamic("NOPE_DB"), undefined);
  });
});

test("6. EnvSpec shape rules: key, why, required/default never both set", () => {
  const good: EnvSpec[] = [
    { key: "FOO_BAR", why: "a fine knob" },
    { key: "<NAME>_DB", why: "the documented family row" },
  ];
  assert.doesNotThrow(() => assertSpecShape(good));

  assert.throws(() => assertSpecShape([{ key: "foo_bar", why: "lowercase key" }]));
  assert.throws(() => assertSpecShape([{ key: "FOO", why: "" }]));
  assert.throws(() => assertSpecShape([{ key: "FOO", why: "line one\nline two" }]));
  assert.throws(() =>
    assertSpecShape([{ key: "FOO", required: true, default: "x", why: "both set" }]),
  );
});
