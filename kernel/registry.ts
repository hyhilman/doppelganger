// KRN-01/02/03 — one typed, named, hand-registered registry, reused by every registry this repo
// has a member for.
//
// KRN-01: registration is HAND-WRITTEN (no directory scan, SKL-05's precedent) and
// duplicate-throws AT IMPORT TIME — the caller registers at module top level, so a second
// registration of the same name fails while the module is still loading, not on the first call
// that happens to hit it. kernel/registry.test.ts proves this against a real fixture module
// (kernel/registry.dup.fixture.ts) by asserting that DYNAMICALLY IMPORTING that module itself
// rejects, not by calling a function inside it directly — a rejected dynamic import IS what "at
// import time" means.
//
// KRN-02: `get` never returns `undefined`. Nothing at runtime may distinguish a missing member
// from a broken one — an `undefined` return hands that distinction to every call site instead of
// making it here, once. A missing name is loud (`get` throws, naming the miss and every name that
// IS registered); a caller that can tolerate a miss uses `tryGet` or `has` and says so.
//
// KRN-02 is also a property of THIS FILE, not just of `get`'s return type: kernel/registry.ts
// names no `node:fs` import, no call that reads a directory or a file off disk, and performs no
// dynamic module load anywhere in it. A directory scan is exactly what makes "missing" and
// "broken" look identical — a file that failed to load and a file that was never written both
// come back as "not in the listing" to a scanner, and only a scanner. kernel/registry.test.ts
// gates this directly by reading this file's own source and asserting neither shape appears —
// see that test's own comment for the exact function names this file must never call.
//
// That text scan alone is NOT enough, and this file says so rather than letting a reader assume
// otherwise. It reads only these bytes, so a read reached ONE HOP away — through another kernel
// module that already does it — slips past every clause. Measured 2026-09-01: wiring such a call
// in here left the scan green and the whole suite green. What actually holds the property is
// simpler than a cleverer scan. THIS FILE IMPORTS NOTHING. No edge out means no module to reach a
// filesystem read through, and no dynamic load means no edge can be added late. The test gates the
// zero-edge claim too. Keep it that way: if this file ever needs an edge, the gate fires and the
// argument happens then, in review, instead of never.
//
// KRN-03, the honest v0 statement: roadmap.md's registries row names five — programs/jobs, entry
// points, relays, watchers, retro lanes. Checked against this repo before writing this sentence:
// `host/jobs/index.ts` (programs/jobs) is the only one with a member at v0. Entry points, relays,
// watchers and retro lanes have none, because no plugin emits a source or a route yet (D9) — a
// port with no consumer gets designed wrong. One registry collapsed onto this file
// (`host/jobs/index.ts`), four with nothing to collapse yet.

/** The one thing `registry()` requires of an item: something to key it by. */
export interface Named {
  readonly name: string;
}

export interface Registry<T extends Named> {
  /** Throws on a duplicate `name`, naming the registry's `kind` and the name. Returns the item
   *  registered, so a call site can register and bind in one expression. */
  register(item: T): T;
  /** Never returns `undefined` (KRN-02) — throws naming the miss and listing every registered
   *  name, so the message alone is enough to fix the call site. */
  get(name: string): T;
  /** The one lookup shape allowed to come back empty. */
  tryGet(name: string): T | undefined;
  has(name: string): boolean;
  /** Registration order — the order callers registered in, not insertion-sorted, not alphabetised. */
  all(): readonly T[];
  names(): readonly string[];
}

/** `kind` names what this registry holds ("job", …) — it appears in every error this registry
 *  throws, so a duplicate or a miss is attributed to the right registry without the caller having
 *  to say so again. */
export function registry<T extends Named>(kind: string): Registry<T> {
  const byName = new Map<string, T>();
  const order: T[] = [];

  function names(): readonly string[] {
    return order.map((item) => item.name);
  }

  function all(): readonly T[] {
    return order.slice();
  }

  function register(item: T): T {
    if (byName.has(item.name)) {
      throw new Error(
        `registry(${JSON.stringify(kind)}): duplicate ${kind} name ${JSON.stringify(item.name)} — already registered`,
      );
    }
    byName.set(item.name, item);
    order.push(item);
    return item;
  }

  function tryGet(name: string): T | undefined {
    return byName.get(name);
  }

  function has(name: string): boolean {
    return byName.has(name);
  }

  function get(name: string): T {
    const found = byName.get(name);
    if (found !== undefined) return found;
    const known = names();
    throw new Error(
      `registry(${JSON.stringify(kind)}): no ${kind} named ${JSON.stringify(name)} — ` +
        `known ${kind} names: ${known.length > 0 ? known.join(", ") : "(none registered)"}`,
    );
  }

  return { register, get, tryGet, has, all, names };
}
