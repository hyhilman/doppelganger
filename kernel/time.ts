// J1.2 (LOG-01) — the ONE clock the log line's timestamp field reads, so both emitters agree on
// precision and suffix, not only on layout.
//
// Only what N1 consumes: `hoursSince`, `age`, `minutesSince` and `wibDate` are NOT ported from the
// reference — nothing in N1 calls them, and a helper with no caller gets its edge cases wrong in
// private.

/** ISO-8601, seconds precision, always `Z`. */
export const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** UTC calendar date, `YYYY-MM-DD`. */
export const today = (): string => nowIso().slice(0, 10);
