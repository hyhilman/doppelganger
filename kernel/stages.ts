// J1.16 (SUP-20) — the stage-prefix vocabulary, and the one function that reads it.
//
// WHY A PREFIX AND NOT A `stage:` FIELD. A field is a second place to say the same thing, and the
// two drift the moment somebody adds a job and fills in the wrong one — silently, because nothing
// can check a declaration against a name. A prefix cannot disagree with itself: the name IS the
// grouping, so this file's own test only has to assert that every name HAS a known one.
//
// This repo's order is the one both `roadmap.md` SUP-20 and `CLAUDE.md`'s "Stage prefixes" bullet
// already use — the reference lists the same nine in a different order (`ops` before `corpus`), and
// the doc gate below pins this repo's own choice, not the reference's.
export const STAGES = [
  "source",
  "triage",
  "backlog",
  "watch",
  "todo",
  "corpus",
  "nightly",
  "retro",
  "ops",
] as const;

export type Stage = (typeof STAGES)[number];

/** Jobs and entries whose name carries no known prefix. Kept so the listing never silently drops
 *  one. */
export const MISC = "misc";

/** `STAGES` sorted longest-first — exported so the test can assert `stageOf` actually matches in
 *  this order, rather than merely asserting an outcome no real data can distinguish. */
export const matchOrder = (): readonly Stage[] => [...STAGES].sort((a, b) => b.length - a.length);

/**
 * The stage a job or schedule-entry name belongs to.
 *
 * Matched longest-first so a future prefix cannot be shadowed by a shorter sibling, and anchored on
 * a following `-` so `todo-exec` matches `todo` while a hypothetical `todoist` does not.
 */
export function stageOf(name: string): Stage | typeof MISC {
  for (const s of matchOrder()) {
    if (name === s || name.startsWith(`${s}-`)) return s;
  }
  return MISC;
}

/** Group names by stage, in `STAGES` order, dropping empty groups. `misc` sorts last when
 *  non-empty. */
export function byStage<T>(items: readonly T[], nameOf: (x: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const s = stageOf(nameOf(item));
    (groups.get(s) ?? groups.set(s, []).get(s)!).push(item);
  }
  const order = [...STAGES, MISC] as readonly string[];
  return order.filter((s) => groups.has(s)).map((s) => [s, groups.get(s)!] as [string, T[]]);
}
