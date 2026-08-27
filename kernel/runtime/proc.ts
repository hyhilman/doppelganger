// Pid liveness in the CALLER's namespace, every branch failing toward "alive" (LSE-11): a boolean
// cannot express the difference between "I read a live process", "I read positive evidence of
// absence" and "I could not read at all" — and the middle one is the only one that may ever delete
// somebody's lock. `Liveness` is a three-member union so `reapDead` (kernel/runtime/lease.ts) can
// act on exactly one of them: "dead" is the ONLY verdict that authorises a reap.
//
// THE REFERENCE FAILS TOWARD DEAD IN THREE BRANCHES, MEASURED: its
// `bootTimeSec()` returns `null` on an unreadable `/proc/stat` and its `processStartedAt()` then
// returns `null` too, which its `isOwnerAlive()` reads as `false` — dead. `pidNamespace()` reads
// `/proc/self/ns/pid`; `bootTimeSec()` reads `/proc/stat` — different files with different
// permissions, so a `/proc` that answers the first and refuses the second is reachable
// (`hidepid=2`, a restricted bind mount, a seccomp profile), and in that state the reference's
// reaper would judge every owner dead and force-delete every live claim on the host. Every arm here
// that is not `ENOENT`, a demonstrably-later start, or a zombie (below) returns `"unknown"`, never
// `"dead"`.
//
// A ZOMBIE (`/proc/<pid>/stat` state `Z`, field 3) IS DECIDED "dead", DELIBERATELY — the one other
// positive arm. Left unhandled, `reapDead` would hold a zombie-owned key `held` until its TTL
// (SUP-13's derived bound, ~3h) even though the process can never do another tick of work. Unlike
// `ENOENT`, a zombie's state is read directly from THIS pid's own stat line inside THIS namespace —
// no cross-namespace ambiguity, so no `hidepid` downgrade applies here. And the pid cannot be
// recycled while it stays zombie, so there is no recycled-pid risk either.
//
// AND `ENOENT` IS POSITIVE EVIDENCE ONLY ON AN UNRESTRICTED `/proc`. Under `hidepid=1|2` or
// `subset=pid`, another user's LIVE `/proc/<pid>` raises `ENOENT`, not `EACCES` — so guard 8 in
// `reapDead` would read a running process as dead. Two checkouts owned by different users whose
// directory basenames match share `INSTANCE`, host and pid-namespace, so a naive reaper's other
// guards would all pass and a LIVE claim would be force-deleted. `procIsRestricted()` reads
// `/proc/self/mountinfo` LAZILY, once per `ENOENT` it is asked to judge (`ownerLiveness` calls it
// only from that one catch branch) — not once per sweep: a sweep with N dead-candidate rows reads
// it N times, not once. When the `/proc` mount's own options carry `hidepid` or `subset=`, EVERY
// `ENOENT` from `readProcStat` is downgraded from `"dead"` to `"unknown"` — the reaper then reaps
// nothing at all, which is exactly what LSE-07 requires. A `readMountInfo` that itself fails
// returns `true` (restricted): "I could not tell" must also stop the reap.
//
// Measured on this host, 2026-08-26, Linux 6.8.0-136-generic: `/proc/self/ns/pid` ->
// `pid:[4026531836]` · `/proc/stat` -> `btime 1785088352` · absent pid -> `ENOENT` ·
// `/proc/1/environ` -> `EACCES` · `/proc` mount options -> `rw,nosuid,nodev,noexec,relatime` (no
// `hidepid`, no `subset=`, so `procIsRestricted()` is `false` here and the reaper works).
import { readFileSync, readlinkSync } from "node:fs";

export type Liveness = "alive" | "dead" | "unknown";

export interface ProcReaders {
  /** `/proc/self/ns/pid` -> "pid:[4026531836]". Throws or returns junk on a hardened /proc. */
  readonly readNsLink: () => string;
  /** `/proc/stat`, for the `btime <seconds>` line. */
  readonly readBootStat: () => string;
  /** `/proc/<pid>/stat`. ENOENT means absent IN THIS NAMESPACE — see the module header. */
  readonly readProcStat: (pid: number) => string;
  /** `/proc/self/mountinfo`, for the /proc mount's own options — the hidepid downgrade. */
  readonly readMountInfo: () => string;
}

export const realReaders: ProcReaders = {
  readNsLink: () => readlinkSync("/proc/self/ns/pid"),
  readBootStat: () => readFileSync("/proc/stat", "utf8"),
  readProcStat: (pid: number) => readFileSync(`/proc/${pid}/stat`, "utf8"),
  readMountInfo: () => readFileSync("/proc/self/mountinfo", "utf8"),
};

/** The `/proc` interface's fixed unit on every Linux architecture — NOT the kernel's `CONFIG_HZ`.
 *  Shelling out to `getconf CLK_TCK` would be a subprocess per reaped row to read a constant. */
const USER_HZ = 100;

/** `nowIso()` is second-granular and `/proc` counts in 10ms ticks, so a process is only judged
 *  recycled when it started DEMONSTRABLY after the claim. */
const START_SLACK_MS = 2_000;

const isEnoent = (e: unknown): boolean => (e as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

/** `/proc/self/ns/pid` -> the bare digit string inside `pid:[...]`, or `null` when this `/proc`
 *  will not say — every caller treats `null` as "reap nothing", which is also the correct no-op on
 *  a non-Linux host. */
export function pidNamespace(readers: ProcReaders = realReaders): string | null {
  let link: string;
  try {
    link = readers.readNsLink();
  } catch {
    return null;
  }
  const m = /^pid:\[(\d+)\]$/.exec(link);
  return m ? m[1]! : null;
}

/**
 * True when this `/proc` hides other users' pids (`hidepid=1|2` or `subset=pid`), so `ENOENT` stops
 * being positive evidence of absence. Parses `/proc/self/mountinfo` for the line whose mount point
 * is `/proc` and whose filesystem type is `proc` — the mountinfo shape is
 * `ID PARENT MAJOR:MINOR ROOT MOUNTPOINT OPTIONS OPTFIELDS* - FSTYPE SOURCE SUPEROPTIONS`, so the
 * line is split on the ` - ` separator first. A read failure, or a `/proc` line this cannot find at
 * all, returns `true` — "I could not tell" must also stop the reap.
 */
export function procIsRestricted(readers: ProcReaders = realReaders): boolean {
  let text: string;
  try {
    text = readers.readMountInfo();
  } catch {
    return true;
  }
  for (const line of text.split("\n")) {
    const [pre, post] = line.split(" - ");
    if (pre === undefined || post === undefined) continue;
    const preFields = pre.split(" ");
    const postFields = post.split(" ");
    if (preFields[4] === "/proc" && postFields[0] === "proc") {
      return /hidepid|subset=/.test(line);
    }
  }
  return true;
}

/**
 * The verdict table (module header), as a property: every arm that is not `ENOENT` on an
 * unrestricted `/proc`, a zombie, or a demonstrably-later start, returns `"unknown"` — never
 * `"dead"`.
 *
 * The parse anchors at the LAST `)`: field 2 of `/proc/<pid>/stat` is the executable name,
 * unquoted, parenthesised, and free to contain spaces and parens (`(n (o d) (e))` is a legal
 * `comm`) — splitting the whole line on whitespace mis-indexes every field after it. `tail[0]` is
 * field 3 (state) — decided first, since a zombie (`Z`) is "dead" regardless of what the rest of
 * the line says — so `starttime` (field 22) is `tail[19]`.
 */
export function ownerLiveness(
  pid: number,
  claimedAtMs: number,
  readers: ProcReaders = realReaders,
): Liveness {
  let statText: string;
  try {
    statText = readers.readProcStat(pid);
  } catch (e) {
    if (isEnoent(e)) {
      return procIsRestricted(readers) ? "unknown" : "dead";
    }
    return "unknown"; // EACCES, EPERM, EIO, ... — never positive evidence of absence
  }

  const closeParen = statText.lastIndexOf(")");
  if (closeParen === -1) return "unknown";
  const tail = statText.slice(closeParen + 2).split(" ");

  // A zombie (state Z, field 3 -> tail[0]) has already exited; its parent just has not collected
  // the exit status yet. It will do no more work, EVER, and — unlike an ENOENT pid — this is
  // POSITIVE, LOCAL evidence read from THIS pid's own stat line inside THIS namespace, with none
  // of ENOENT's cross-namespace ambiguity (an absent pid can mean "never existed here" under
  // hidepid; a zombie's stat line is readable and says so directly). The pid cannot be recycled
  // while it stays zombie, so this is decided BEFORE the recycled-pid check below, not after.
  // Deliberately positive, the one addition to the "everything else reads unknown" rule.
  if (tail[0] === "Z") return "dead";

  const ticks = Number(tail[19]);
  if (!Number.isFinite(ticks)) return "unknown";

  let bootStat: string;
  try {
    bootStat = readers.readBootStat();
  } catch {
    return "unknown";
  }
  const btimeMatch = /^btime (\d+)$/m.exec(bootStat);
  if (!btimeMatch) return "unknown";
  const btimeSec = Number(btimeMatch[1]);
  if (!Number.isFinite(btimeSec)) return "unknown";

  const startedAtMs = (btimeSec + ticks / USER_HZ) * 1000;
  if (startedAtMs > claimedAtMs + START_SLACK_MS) return "dead"; // a recycled pid

  return "alive";
}

/** The boolean face — kept so LSE-07's callers and the row's own vocabulary still agree.
 *  `"unknown"` reads as alive: only a positively-`"dead"` verdict may ever authorise a reap. */
export const isOwnerAlive = (pid: number, claimedAtMs: number, readers: ProcReaders = realReaders): boolean =>
  ownerLiveness(pid, claimedAtMs, readers) !== "dead";
