// The ntfy POST a scheduled job's report goes out on (JOB-O02), in TypeScript. host/watchdog.sh
// keeps its own curl POST: the watchdog must not share the toolchain it watches.
//
// Same server, same three knobs (host/config.ts's NTFY_* rows), same rule for an unset one: no
// send at all. What is NOT shared is the delivery stamp. This path writes its own row in
// kernel/runtime/delivery.ts, so a watchdog POST that works can never clear a failure here, and
// the other way round.
//
// NEVER THROWS. A failed send returns `{ ok: false, detail }` and writes the stamp; the caller
// decides what a failed send means for its own run.
import { envOptional } from "../kernel/config.ts";
import { INSTANCE } from "../kernel/instance.ts";
import { DELIVERY_STAMPS, deliveryStamp, stampPath } from "../kernel/runtime/delivery.ts";
import { NTFY_URL_ENV, NTFY_TOPIC_ENV, NTFY_TOKEN_ENV } from "./config.ts";

export interface PostResult {
  readonly ok: boolean;
  readonly detail: string;
}

export interface NtfyDeps {
  readonly url: string | undefined;
  readonly topic: string | undefined;
  readonly token: string | undefined;
  /** The seam. A test passes a fake; nothing in the suite reaches the network. */
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** `stamp(true)` clears the delivery stamp, `stamp(false, detail)` writes it. */
  readonly stamp: (ok: boolean, detail?: string) => void;
  readonly timeoutMs: number;
}

/** The same bound the watchdog gives curl (`-m 10`): a hung server delays one report, never a run. */
export const NTFY_TIMEOUT_MS = 10_000;

export const NOT_CONFIGURED = "ntfy not configured";

/** The row this path owns. Looked up by name, so a renamed row fails here, loudly. */
export const LOG_REPORT_STAMP = "log-report-send";

/**
 * POST `body` to `<url>/<topic>`. Unset url, topic or token is `NOT_CONFIGURED`: no network, and no
 * stamp, because a host that never set ntfy up has not lost a report, it declined one. Any 2xx
 * clears the stamp; anything else (a status, a timeout, a refused connection) writes it.
 */
export function ntfyPost(deps: NtfyDeps): (body: string) => Promise<PostResult> {
  return async (body: string): Promise<PostResult> => {
    const { url, topic, token } = deps;
    if (!url || !topic || !token) return { ok: false, detail: NOT_CONFIGURED };
    let res: PostResult;
    try {
      const r = await deps.fetch(`${url.replace(/\/+$/, "")}/${topic}`, {
        method: "POST",
        body,
        // ASCII only: ntfy does not promise UTF-8 header handling.
        headers: { Authorization: `Bearer ${token}`, Title: `${topic} log report`, Tags: "warning,logs" },
        signal: AbortSignal.timeout(deps.timeoutMs),
      });
      res = r.ok ? { ok: true, detail: `http=${r.status}` } : { ok: false, detail: `http=${r.status}` };
    } catch (e) {
      res = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
    deps.stamp(res.ok, res.detail);
    return res;
  };
}

/** The real post: the knobs read at call time, the real `fetch`, and the log report's own stamp.
 *  The topic falls back to INSTANCE, the same fallback the watchdog uses (INS-01). */
export function realNtfyPost(): (body: string) => Promise<PostResult> {
  const row = DELIVERY_STAMPS.find((r) => r.name === LOG_REPORT_STAMP);
  if (row === undefined) throw new Error(`no DELIVERY_STAMPS row named ${LOG_REPORT_STAMP}`);
  return ntfyPost({
    url: envOptional(NTFY_URL_ENV),
    topic: envOptional(NTFY_TOPIC_ENV) ?? INSTANCE,
    token: envOptional(NTFY_TOKEN_ENV),
    fetch: (u, init) => fetch(u, init),
    stamp: deliveryStamp(stampPath(row)),
    timeoutMs: NTFY_TIMEOUT_MS,
  });
}
