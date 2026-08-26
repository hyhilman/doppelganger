// J1.11 (LOG-09, TST-19) — the one line worth reporting out of a child's dying output, which
// parse.ts skips by design (it reads only `ts=` lines — two thirds of every file is agent stdout).
//
// The pick is by SHAPE, not by position. A tail-N reports the runtime's version banner: a Node
// uncaught exception ends `}`, a blank line, then `Node.js v22.23.1`, and the line worth carrying
// sits several lines above that. So Node's uncaught-exception header is tried FIRST, then the last
// weak-signal line (a child that dies without a JS exception — a shell, `gh`, a killed process),
// then the last non-noise line as a fallback.
//
// job-failed is cause.ts's only reachable caller (see log.sh's log_run) — an untested log_run makes
// this module one with no reachable caller, which is why J1.9 tests log_run's two outcomes directly.

/** Lines that are never a cause: framing, blank space, the caret, and our own emitted events —
 *  including the node:sqlite ExperimentalWarning every process that opens a database now prints
 *  (J1.13 links this explicitly). */
const NOISE: RegExp[] = [
  /^\s*$/,
  /^ts=/, // already a parsed event — the reporter has it
  /^\s*[\^}\])]+,?\s*$/, // the caret pointer and the tail of a dumped object
  /^\s*at\s/, // a stack frame; the message above it is the cause
  /^Node\.js v\d/,
  /ExperimentalWarning|^\(Use `node --trace-warnings/,
];

/** A Node uncaught-exception header: `TypeError: x`, `Error [ERR_MODULE_NOT_FOUND]: Cannot find …`. */
const HEADER = /^\s*(?:[A-Z][\w$]*Error|Error)\b[^:]*:/;

/** Weaker shapes, for a child that dies without a JS exception — a shell, `gh`, a killed process. */
const SIGNAL =
  /(?:error|fatal|panic):|Cannot find\b|E(?:ACCES|NOENT|NOSPC)\b|command not found|Permission denied|Killed/i;

const MAX = 300;

const clip = (s: string): string => {
  const t = s.trim();
  return t.length > MAX ? `${t.slice(0, MAX - 1)}…` : t;
};

/**
 * The one line worth reporting out of a child's dying output, or undefined if it said nothing.
 *
 * The header is taken FIRST — with a missing-module error the same token appears on the `throw`
 * site above it and the `code:` echo below, and both are less use than the message between them.
 */
export function causeOf(lines: readonly string[]): string | undefined {
  const said = lines.filter((l) => !NOISE.some((re) => re.test(l)));
  return (
    clip(said.find((l) => HEADER.test(l)) ?? said.findLast((l) => SIGNAL.test(l)) ?? said.at(-1) ?? "") ||
    undefined
  );
}

export interface StderrTail {
  /** Feed a raw chunk. Partial lines are carried until their newline arrives. */
  push(chunk: Buffer | string): void;
  /** The distilled cause, or undefined. */
  cause(): string | undefined;
}

/**
 * A bounded ring over a child's stderr.
 *
 * Bounded because a long-running watcher's stderr is unbounded over its lifetime; `keep` lines is
 * enough to hold a header plus its frames and costs nothing to carry for a job that never fails.
 */
export function stderrTail(keep = 60): StderrTail {
  const ring: string[] = [];
  let partial = "";
  return {
    push(chunk: Buffer | string): void {
      const parts = (partial + String(chunk)).split("\n");
      partial = parts.pop() ?? "";
      for (const line of parts) {
        ring.push(line);
        if (ring.length > keep) ring.shift();
      }
    },
    cause(): string | undefined {
      // A child killed mid-line leaves its last words unterminated, and that is exactly the run
      // whose cause is worth having.
      return causeOf(partial ? [...ring, partial] : ring);
    },
  };
}
