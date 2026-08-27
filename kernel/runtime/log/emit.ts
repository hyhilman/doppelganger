// the TypeScript half of the one log line
// shape. `log.sh` is the bash half and MUST stay identical — cron redirects both into the same file,
// so a format only one side can produce is not a format. J1.9 proves the two agree byte for byte.
//
// logfmt, not JSONL. Bash has no safe printf shape for nested-quoted JSON, and these files
// are read by eye; logfmt keeps both and parses in one regex.
//
// Writes to STDERR. Every cron entry redirects `>> <log> 2>&1`, and stdout stays free for
// the payload a job actually prints.
//
// This file must never load `node:sqlite` (see kernel/runtime/log/index.ts) — a process that only
// logs must not pay the experimental-warning stderr lines that importing the driver prints.
import { nowIso } from "../../time.ts";
import { envStr, type EnvSpec } from "../../config.ts";

export type Level = "debug" | "info" | "warn" | "error";

/** No `fatal`: four levels, and nothing here has a fifth member. */
export const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const LOG_LEVEL_ENV: EnvSpec = {
  key: "LOG_LEVEL",
  default: "info",
  why: "below this level a line is dropped by BOTH emitters (LOG-10)",
};

/** Read once at module load — an unreadable value must not silence the log, so it falls back to
 *  `info` rather than throwing. Exported beside the row (J1.18): the row and the value are one
 *  object, so a test can resolve the real default in a child rather than merely trusting the row. */
const rawLevel = envStr(LOG_LEVEL_ENV);
export const LOG_LEVEL: Level = (rawLevel in ORDER ? rawLevel : "info") as Level;
const MIN = ORDER[LOG_LEVEL];

export type Fields = Record<string, string | number | boolean | null | undefined>;

/**
 * Bare when it cannot be confused with the delimiter, quoted otherwise. `\w` is ECMA-defined as
 * `[A-Za-z0-9_]` with no locale dependency — unlike a bash bracket-expression range, this predicate
 * cannot drift under `LC_COLLATE` (see log.sh's `_log_val`, which enumerates the same 70 characters
 * for exactly that reason).
 */
export function renderValue(v: string | number | boolean): string {
  const s = String(v);
  if (s !== "" && /^[\w./:@#+-]+$/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

/**
 * `msg` is forced last regardless of insertion order.
 *
 * It is the only field allowed to contain spaces, so a parser can split the structured half on
 * whitespace and take everything from `msg=` as one value. A field emitted after it would silently
 * move inside the message.
 *
 * An explicitly-supplied EMPTY msg still renders `msg=""` — `msg != null` after the loop is what
 * decides whether the pair was supplied at all, not whether the value happens to be empty.
 */
export function renderLine(level: Level, job: string, event: string, fields: Fields = {}): string {
  const parts = [
    `ts=${nowIso()}`,
    `level=${level}`,
    `job=${renderValue(job)}`,
    "src=ts",
    `event=${renderValue(event)}`,
  ];
  let msg: string | undefined;
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue;
    if (k === "msg") {
      msg = String(v);
      continue;
    }
    parts.push(`${k}=${renderValue(v)}`);
  }
  if (msg != null) parts.push(`msg=${renderValue(msg)}`);
  return parts.join(" ");
}

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
  /** Free-form passthrough for output that is a payload, not an event — dry-run bodies, agent
   *  stdout. Never parsed by the reporter, deliberately: it is the one escape hatch. log.sh defines
   *  no equivalent — a bash job's payload already goes to stdout, which LOG-06 keeps free. */
  raw(text: string): void;
}

export function logger(job: string): Logger {
  // Severity is SET here: this file contains no regex or string test over `event` or
  // `msg` that would infer a level from text.
  const at = (level: Level) => (event: string, fields?: Fields) => {
    if (ORDER[level] < MIN) return;
    // process.stderr.write, never console.error(fmt, ...args): with a single argument
    // util.format leaves %s/%d/%% untouched, so console.error(line) is byte-safe TODAY — but it
    // stops being safe the moment a future edit adds a second argument. write() cannot become a
    // format call by accident.
    process.stderr.write(renderLine(level, job, event, fields) + "\n");
  };
  return {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    raw: (text: string) => process.stderr.write(text + "\n"),
  };
}
