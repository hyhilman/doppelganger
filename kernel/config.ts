// J1.2 (KRN-06) — EnvSpec: the row shape that IS a knob's definition, plus the readers that take a
// row instead of a key. `process.env` is named here and nowhere else under kernel/ (J1.18 gates it),
// so there is no way to read a knob that has no row.

/** One knob's whole definition. `why` is one line and there is no second place a knob is described. */
export interface EnvSpec {
  readonly key: string;
  readonly required?: boolean;
  readonly default?: string;
  /** One line. This IS the knob doc — there is no second place a knob is described. */
  readonly why: string;
}

/** `""` counts as unset — a `.env` line with nothing after the `=` arrives that way. */
function readRaw(key: string): string | undefined {
  const v = process.env[key];
  return v != null && v !== "" ? v : undefined;
}

/**
 * Resolve a spec to a string: the env value, else `spec.default`, else throw. The throw names
 * `spec.key` and `spec.why` either way, because a knob with neither a value nor a default is
 * unreadable and the message should say why, not just that.
 */
export function envStr(spec: EnvSpec): string {
  const v = readRaw(spec.key);
  if (v !== undefined) return v;
  if (spec.default !== undefined) return spec.default;
  if (spec.required) {
    throw new Error(`${spec.key}: required and not set — ${spec.why}`);
  }
  throw new Error(`${spec.key}: no value and no default — ${spec.why}`);
}

/**
 * The same read, but returns `undefined` rather than falling back to `spec.default` or throwing.
 *
 * Two knobs need it and both are in this phase: `INSTANCE` and `ENGINE_ROOT` have defaults that are
 * *computed* (a directory basename, `cwd`) and no string can express them, so their rows carry no
 * `default` and the caller supplies the fallback.
 */
export function envOptional(spec: EnvSpec): string | undefined {
  return readRaw(spec.key);
}

/**
 * The one read taking a raw key rather than a spec, for the `<NAME>_DB` family (DBS-07) — a family
 * has no single key an `EnvSpec` row can name (roadmap.md Gaps item 4). This is the one dynamic
 * read; J1.18 gates that it has exactly one call site.
 */
export function envDynamic(key: string): string | undefined {
  return readRaw(key);
}

/**
 * Resolve a spec to a number: the same resolution as `envStr`, then `Number(...)`.
 *
 * A value that is not a finite number `>= 0` THROWS naming the key and the value seen — a deliberate
 * difference from the reference, which silently falls back to the default on a garbage value.
 * `LOG_MAX_BYTES=8MB` silently becoming the default is the class of failure found at 3am, not at
 * boot.
 */
export function envNum(spec: EnvSpec): number {
  const raw = envStr(spec);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(
      `${spec.key}: not a non-negative number: ${JSON.stringify(raw)} — ${spec.why}`,
    );
  }
  return n;
}

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `FOO_BAR`. */
const KEY_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * A knob FAMILY row — no single key a reader can resolve directly, so the row's own `key` carries
 * exactly one `<PLACEHOLDER>` marking where the variable part goes: `<NAME>_DB` (DBS-07),
 * `LOCK_STARVE_N_<JOB>` (GAT-10). Generalised from the first family (J2.12) rather than
 * special-cased per family — KRN-06 (roadmap.md Gaps item 4) still cannot express a family as a
 * single readable key; this is the shape check's half of the workaround.
 */
const FAMILY_KEY_RE = /^[A-Z0-9_]*<[A-Z]+>[A-Z0-9_]*$/;

/**
 * The rule every real `EnvSpec` row must satisfy: key shape, a one-line non-empty `why`, and never
 * both `required` and `default`. Exported so J1.18 can run it over the whole real set; this file's
 * own test runs it over a fixture of good and bad rows.
 */
export function assertSpecShape(rows: readonly EnvSpec[]): void {
  for (const row of rows) {
    if (!KEY_RE.test(row.key) && !FAMILY_KEY_RE.test(row.key)) {
      throw new Error(`EnvSpec ${row.key}: key must match ${KEY_RE} or a <PLACEHOLDER> family form`);
    }
    if (row.why.length === 0 || row.why.includes("\n")) {
      throw new Error(`EnvSpec ${row.key}: why must be one non-empty line`);
    }
    if (row.required && row.default !== undefined) {
      throw new Error(`EnvSpec ${row.key}: required and default must never both be set`);
    }
  }
}

/**
 * J2.11 (SUP-04) — a copy of the whole process environment, so `host/` (and `cli/`) never name
 * `process.env` themselves. `childEnv`'s inherited-env layer calls this instead of spreading
 * `process.env` inline, which is what keeps `test/knobs.test.ts` assertion 3's one-file rule true
 * as it now covers `host/` and `cli/` too (J2.3) — a real improvement over the reference, which
 * spreads `process.env` inline in the supervisor.
 */
export function parentEnv(): Readonly<Record<string, string | undefined>> {
  return { ...process.env };
}
