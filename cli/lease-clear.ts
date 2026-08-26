// J4.7 (LSE-10) — the supported form of the one-off DELETE. `acquire` refuses on
// `status <> 'done'`, so waiting out the TTL does nothing at any horizon: this is how an operator
// removes a claim by hand.
//
// The `cli/crontab.ts` shape exactly: a pure `run(argv, deps)` returning `{ out, err, code }` so
// every command is assertable without capturing a stream, plus an argv block that writes the two
// streams itself and is untested by construction.
import { envStr, type EnvSpec } from "../kernel/config.ts";
import { read, list, clear } from "../kernel/runtime/lease.ts";

export const LEASE_CLEAR_DRY_RUN_ENV: EnvSpec = {
  key: "LEASE_CLEAR_DRY_RUN",
  default: "0",
  why: "prints what it would delete and calls nothing (SAF-01, for a tool)",
};

export interface LeaseClearDeps {
  readonly dryRun: boolean;
}

const USAGE = [
  "usage:",
  "  npm run lease-clear -- <scope>                # list the scope's claims",
  "  npm run lease-clear -- <scope> <key>           # delete it, if it is not held",
  "  npm run lease-clear -- <scope> <key> --force   # even if it is",
].join("\n");

interface Result {
  readonly out: string;
  readonly err: string;
  readonly code: number;
}

/**
 * No key is the DISCOVERY path, not an error — a key is `repo#7@abc1234`-shaped and nobody types
 * it from memory. The listing goes to STDOUT (LOG-06: stdout is the payload); the count line to
 * stderr.
 *
 * A refused `held` claim names its OWNER and its EXPIRY, so the choice to force is made against a
 * real process rather than a guess — INS-04's instance leads, so an operator can tell which
 * checkout owns it.
 *
 * A missing claim is exit 0 with `no claim <scope>/<key> — nothing to clear`. Idempotent by
 * design: running it twice must not start looking like a failure.
 */
export function run(argv: readonly string[], deps: LeaseClearDeps): Result {
  const [scope, key, ...rest] = argv;

  if (scope === undefined) {
    return { out: "", err: USAGE, code: 1 };
  }

  if (key === undefined) {
    const rows = list(scope);
    const lines = rows.map((r) => `${r.status} attempts=${r.attempts} updated=${r.updatedAt} ${r.key}`);
    return {
      out: lines.length > 0 ? `${lines.join("\n")}\n` : "",
      err: `${rows.length} claim(s) in scope \`${scope}\`\n`,
      code: 0,
    };
  }

  const force = rest.includes("--force");
  const row = read(scope, key);
  if (!row) {
    return { out: "", err: `no claim ${scope}/${key} — nothing to clear\n`, code: 0 };
  }

  // `--force` is where the guard-4 (INS-04) escape hatch lives: a stale claim from a deleted
  // checkout is never reaped by a sweep (kernel/runtime/lease.ts's reapDead), and this is the
  // supported way to remove it.
  if (row.status === "held" && !force) {
    return {
      out: "",
      err: `refused: ${scope}/${key} is held by ${row.owner}, expires ${row.expiresAt} — pass --force to override\n`,
      code: 1,
    };
  }

  if (deps.dryRun) {
    return {
      out: "",
      err: `dry run: would delete ${scope}/${key} (status=${row.status}${force ? ", forced" : ""})\n`,
      code: 0,
    };
  }

  const deleted = clear(scope, key, { force });
  if (deleted === 0) {
    return { out: "", err: `no claim ${scope}/${key} — nothing to clear\n`, code: 0 };
  }
  return { out: "", err: `deleted ${scope}/${key}\n`, code: 0 };
}

// ---------------------------------------------------------------------------------------------
// The argv block. UNTESTED BY CONSTRUCTION (ruling 1) — no test imports this file in a way that
// reaches it. Resolves the one knob (ruling 2: only here, never at module scope), dispatches to
// `run`, and writes the two streams itself.
// ---------------------------------------------------------------------------------------------
if (import.meta.filename === process.argv[1]) {
  const deps: LeaseClearDeps = {
    dryRun: envStr(LEASE_CLEAR_DRY_RUN_ENV) === "1",
  };
  const result = run(process.argv.slice(2), deps);
  if (result.out) process.stdout.write(result.out);
  if (result.err) process.stderr.write(result.err.endsWith("\n") ? result.err : `${result.err}\n`);
  process.exitCode = result.code;
}
