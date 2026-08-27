// ONE `INSTANCE` name per checkout, so N2's crontab markers and N4's lease owner
// have something to be discriminated by.
//
// `ROOT` lands in J1.4, and this file does not wait on it: the supervisor spawns every child with
// `cwd = ROOT`, so `cwd` IS the root for every job by construction, and `paths.ts` resolves
// `ROOT` the same way. Reading `process.cwd()` here keeps the dependency one-directional — instance
// resolution never imports paths.ts.
import { basename } from "node:path";
import { envOptional, type EnvSpec } from "./config.ts";

export const INSTANCE_ENV: EnvSpec = {
  key: "INSTANCE",
  // No `default`: the fallback is the project directory's basename, which is *computed* and no
  // string can express it. A row claiming a default it does not have would be a lie J1.18 could
  // not catch.
  why: "names this checkout; discriminates every host-global write (INS-01)",
};

// The intersection of three surfaces INSTANCE is interpolated into: a Docker object name
// (DKR-05/06), a shell word that needs no quoting (INS-03's crontab markers), and a token with no
// `:` so LSE-06's `<instance>:<host>:<pidns>:<pid>:<uuid8>` stays splittable on `:`.
//
// Deliberately NOT DBS-03's `^[a-z][a-z0-9_]*$` — that one guards a value interpolated into DDL, and
// INSTANCE never reaches DDL. If INSTANCE is ever used as a `ns`, it is re-validated at that call
// site, because a hyphen is legal here and illegal there.
const NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;

const suggest = (value: string): string => {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "");
  return s === "" ? "instance" : s;
};

/**
 * Pure: `raw?.trim()` when non-empty, else `basename(root)`. Validates the result and returns it, or
 * throws an instruction naming where the bad value came from and how to fix it.
 */
export function resolveInstance(raw: string | undefined, root: string): string {
  const trimmed = raw?.trim();
  const fromEnv = trimmed != null && trimmed !== "";
  const value = fromEnv ? trimmed : basename(root);
  if (NAME_RE.test(value)) return value;

  const source = fromEnv
    ? "it came from the INSTANCE environment variable"
    : `it came from the project directory name: ${root}`;
  throw new Error(
    `INSTANCE: ${JSON.stringify(value)} is not a bare identifier (INS-01)\n` +
      `  ${source}\n` +
      `  fix: export INSTANCE=${suggest(value)}`,
  );
}

/** The resolved value for this process, computed once at import. */
export const INSTANCE: string = resolveInstance(envOptional(INSTANCE_ENV), process.cwd());
