// every default path the kernel computes, so INS-02's project-relative
// category is mechanical rather than promised.
//
// ROOT comes from `cwd`, not from self-location. The reference walks three levels up from its own
// file, which is right for a checkout and wrong for a published framework: at N5 kernel/ sits under
// node_modules/@doppelganger/kernel/dist/, and three levels up is not the host repo. SUP-03 already
// spawns every child with `cwd = ROOT`, so `cwd` is the root by construction, and `ENGINE_ROOT` is
// the explicit override for anything the supervisor did not start. This is a deliberate,
// one-way divergence from the reference.
import { join, resolve, sep } from "node:path";
import { envStr, envOptional, envDynamic, type EnvSpec } from "./config.ts";

export const ENGINE_ROOT_ENV: EnvSpec = {
  key: "ENGINE_ROOT",
  // No `default`: the fallback is `process.cwd()`, which is computed and no string can express it.
  why: "the checkout every project-relative write resolves inside (INS-02)",
};

export const ROOT: string = resolve(envOptional(ENGINE_ROOT_ENV) ?? process.cwd());

/**
 * Resolve one or more segments inside `ROOT`, and throw if the result would escape it — a
 * `projectPath("../../etc/x")` is a third-category write wearing the first category's name.
 */
export function projectPath(...segs: string[]): string {
  const p = resolve(ROOT, ...segs);
  if (p !== ROOT && !p.startsWith(ROOT + sep)) {
    throw new Error(
      `projectPath(${segs.map((s) => JSON.stringify(s)).join(", ")}): escapes ROOT (INS-02): ${p}`,
    );
  }
  return p;
}

export const STATE_DIR_ENV: EnvSpec = {
  key: "ENGINE_STATE_DIR",
  // ROOT-relative, not absolute — projectPath is what makes it absolute, so INS-02's
  // project-relative category is expressed once, not repeated in every default.
  default: ".doppelganger/state",
  why: "where every integration's database lives, resolved inside the checkout (DBS-01, INS-02)",
};

export const STATE_DIR: string = projectPath(envStr(STATE_DIR_ENV));

/** The knob FAMILY row — no single `key` a reader can resolve, but the doc gate (J1.18)
 *  needs a row to match §2.27's `<NAME>_DB` token against. */
export const NAME_DB_ENV: EnvSpec = {
  key: "<NAME>_DB",
  why: "redirect one integration's database to a throwaway file for a safe run (DBS-07, SAF-05)",
};

/** Path for one integration's database, e.g. `dbPath("lease")`. `<NAME>_DB` overrides it, so a
 *  verification run can point at a throwaway file instead of the live one. */
export function dbPath(name: string): string {
  return envDynamic(`${name.toUpperCase()}_DB`) ?? join(STATE_DIR, `${name}.db`);
}
