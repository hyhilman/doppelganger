// bounded concurrency for jobs that spawn headless agents, plus the start-up
// stagger that makes a pool of them survivable.
//
// The stagger encodes a measured failure: twelve agents starting on one tick raced the
// `~/.gitconfig` lock and two died with `could not lock config file: File exists`, each burning a
// lease attempt on a failure that had nothing to do with the work.

/**
 * Bounded worker pool. `limit` run at once; each pulls the next index as it frees up, so a slow
 * item delays only itself rather than a whole batch (which a chunked `Promise.all` would).
 *
 * `fn` MUST NEVER REJECT. A rejection here abandons every other in-flight worker with whatever
 * claim it holds still held until TTL, and the caller sees one error instead of N results. Every
 * caller swallows its own failures and returns a sentinel.
 *
 * `limit` is floored at 1: zero workers leaves every slot in the returned array unwritten rather
 * than doing the work serially.
 */
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const workers = Math.max(1, limit);
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i] as T, i);
      }
    }),
  );
  return out;
}

/** `pool.ts` reads no env at all — HRN-18 spells the knob `*_SPAWN_STAGGER_MS`, a per-job family,
 *  and at N1 there is no job to own one. A job at N3 declares its own `TODO_TRIAGE_SPAWN_STAGGER_MS`
 *  row defaulting to this constant. Keeping this file leaf-only is what keeps J1.18's one-file rule
 *  for the env object true, and avoids designing a knob with no owner. */
export const DEFAULT_SPAWN_STAGGER_MS = 2000;

/**
 * Serialises the FIRST MOMENT of every worker spawn. Everything after start-up runs concurrently.
 *
 * A stagger rather than a retry, because the race is in start-up before any work: spacing the
 * spawns removes it instead of recovering from it. Each caller awaits the previous caller's slot,
 * so the chain self-clears — a spawn arriving after a quiet gap waits on an already-resolved
 * promise and starts immediately.
 *
 * The chain is module-global on purpose: it guards one `~/.gitconfig`, not one pool, so two pools
 * in a single process must share it.
 */
let spawnChain: Promise<void> = Promise.resolve();
export function spawnSlot(staggerMs: number): Promise<void> {
  const prior = spawnChain;
  spawnChain = prior.then(() => new Promise<void>((r) => setTimeout(r, staggerMs)));
  return prior;
}
