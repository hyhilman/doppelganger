// J1.8 (LOG-07) — the reader half, the exact inverse of renderLine.
//
// It parses a LINE, not a file. Everything about where lines come from (which roots, which cursor,
// when to rotate) lives in tail.ts, so the format and the transport can be tested apart.
//
// Unrecognised lines are not an error. Two thirds of every log file is still agent stdout, node
// warnings and framing; a parser that treats those as malformed input would report a fault on every
// healthy run. parseLine returns null and the caller skips.
import type { Level } from "./emit.ts";

const LEVELS = new Set<Level>(["debug", "info", "warn", "error"]);

/** `key=value`, value either quoted-with-escapes or bare. Mirrors renderValue's two shapes. */
const PAIR = /([A-Za-z_][\w.-]*)=("(?:[^"\\]|\\.)*"|[^\s]*)/g;

export interface LogLine {
  ts: string;
  level: Level;
  job: string;
  /** `ts` (TypeScript) or `sh` (bash) — which emitter wrote it. */
  src: string;
  event: string;
  msg: string;
  /** Everything beyond the five fixed fields, verbatim. */
  fields: Record<string, string>;
  raw: string;
}

export const unquote = (v: string): string =>
  v.startsWith('"') && v.endsWith('"') && v.length >= 2
    ? v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    : v;

/**
 * Parse one line, or null if it is not one of ours.
 *
 * The `ts=` prefix check is the cheap gate: it runs on every line of every file on a tick, and the
 * regex is the expensive part. It also means a line merely CONTAINING `level=error` in prose (an
 * agent quoting a log line back at us) cannot be mistaken for an emitted one.
 */
export function parseLine(raw: string): LogLine | null {
  if (!raw.startsWith("ts=")) return null;

  const fields: Record<string, string> = {};
  PAIR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PAIR.exec(raw)) != null) fields[m[1]!] = unquote(m[2]!);

  const level = fields.level as Level | undefined;
  if (level == null || !LEVELS.has(level)) return null;
  if (fields.ts == null || fields.event == null) return null;

  const { ts, job = "unknown", src = "?", event, msg = "", ...rest } = fields;
  delete rest.level;
  return { ts, level, job, src, event, msg, fields: rest, raw };
}

export const isFault = (l: LogLine): boolean => l.level === "error";

/** One compact line per fault. `job/event` reads as a path, which is how it is grepped back out of
 *  the file afterwards. */
export const renderFault = (l: LogLine): string =>
  `\`${l.job}/${l.event}\`` +
  (l.msg ? ` — ${l.msg}` : "") +
  (Object.keys(l.fields).length
    ? ` (${Object.entries(l.fields)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")})`
    : "");
