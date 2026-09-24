// host/notify.ts: the log report's ntfy POST. A fake fetch every time — nothing here reaches the
// network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DELIVERY_STAMPS } from "../kernel/runtime/delivery.ts";
import { ntfyPost, NOT_CONFIGURED, LOG_REPORT_STAMP, type NtfyDeps } from "./notify.ts";

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function harness(overrides: Partial<NtfyDeps> = {}, answer: () => Promise<Response> = async () => new Response("", { status: 200 })) {
  const calls: Call[] = [];
  const stamps: { ok: boolean; detail?: string }[] = [];
  const post = ntfyPost({
    url: "https://ntfy.example/",
    topic: "doppelganger",
    token: "tk_test",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return answer();
    },
    stamp: (ok, detail) => stamps.push({ ok, detail }),
    timeoutMs: 1_000,
    ...overrides,
  });
  return { post, calls, stamps };
}

test("1. a 2xx POSTs the body to <url>/<topic> with the bearer token, and clears the stamp", async () => {
  const h = harness();
  const r = await h.post("logs — 1 error line(s)");
  assert.deepEqual(r, { ok: true, detail: "http=200" });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0]!.url, "https://ntfy.example/doppelganger", "a trailing slash on the url must not double");
  assert.equal(h.calls[0]!.init.method, "POST");
  assert.equal(h.calls[0]!.init.body, "logs — 1 error line(s)");
  assert.equal((h.calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer tk_test");
  assert.ok(h.calls[0]!.init.signal, "every POST carries a timeout");
  assert.deepEqual(h.stamps, [{ ok: true, detail: "http=200" }]);
});

test("2. a non-2xx is a failed send: ok false, the status in detail, the stamp written", async () => {
  const h = harness({}, async () => new Response("", { status: 403 }));
  const r = await h.post("x");
  assert.deepEqual(r, { ok: false, detail: "http=403" });
  assert.deepEqual(h.stamps, [{ ok: false, detail: "http=403" }]);
});

test("3. a fetch that throws (refused, timeout) is a failed send, never a throw", async () => {
  const h = harness({}, async () => {
    throw new Error("connect ECONNREFUSED");
  });
  const r = await h.post("x");
  assert.deepEqual(r, { ok: false, detail: "connect ECONNREFUSED" });
  assert.deepEqual(h.stamps, [{ ok: false, detail: "connect ECONNREFUSED" }]);
});

test("4. unset url, topic or token: not configured, no network, no stamp", async () => {
  for (const unset of ["url", "topic", "token"] as const) {
    const h = harness({ [unset]: undefined });
    const r = await h.post("x");
    assert.deepEqual(r, { ok: false, detail: NOT_CONFIGURED }, `${unset} unset`);
    assert.equal(h.calls.length, 0, `${unset} unset must not reach fetch`);
    assert.equal(h.stamps.length, 0, `${unset} unset declines a send, it does not fail one`);
  }
});

test("5. the log report owns its own DELIVERY_STAMPS row, apart from the watchdog's", () => {
  const mine = DELIVERY_STAMPS.find((r) => r.name === LOG_REPORT_STAMP);
  const watchdog = DELIVERY_STAMPS.find((r) => r.name === "ntfy-send");
  assert.ok(mine, `no DELIVERY_STAMPS row named ${LOG_REPORT_STAMP}`);
  assert.ok(watchdog);
  assert.notEqual(mine.path, watchdog.path, "one stamp for two writers lets one writer's success clear the other's failure");
  assert.match(mine.writer, /^host\/notify\.ts /);
});
