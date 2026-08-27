// the delivery-stamp CONTRACT, shipped with the one producer that is
// real on this host: the supervisor's own heartbeat write.
//
// A stamp is PRESENCE, not staleness: a healthy system writes nothing (the file is absent, or was
// just removed), so "no write in N minutes" is the normal state and a staleness check would cry
// outage on a quiet week. The file exists EXACTLY while the one outbound path it names is broken.
//
// JOB-O11's own text says "written on a failed send" — N4 has no send. The supervisor's heartbeat
// write is a SIGNAL, not a send, and it is what stands in: a supervisor that is alive and
// scheduling but cannot write its liveness stamp is, from outside, identical to a dead one (the
// watchdog's probe 3, host/watchdog.sh, J4.14) — and this stamp is probe 4's correction. The
// circularity is real and stated once, here: a full disk kills the stamp write too, so this stamp
// catches every PER-FILE failure (a `chmod 400`, a root-owned file left by a stray `sudo` run, a
// read-only bind mount, an `ENOSPC` that clears between two writes) and none of the whole-disk
// ones. Two paths, two inodes; one filesystem. The reference states its own version of this same
// limit, and this row is honest about being weaker than the reference's because the reference has
// a send and N4 does not.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { projectPath } from "../paths.ts";
import { nowIso } from "../time.ts";

/** One stamp: a file that exists exactly while one outbound path is broken. */
export interface StampRow {
  readonly name: string;
  /** ROOT-relative. Never absolute — the same rule `host/config.ts`'s `GateResource` follows
   *  (kernel/runtime/delivery.test.ts tests 5/6). */
  readonly path: string;
  /** The module that writes it. */
  readonly writer: string;
  /** One line. This IS the stamp's doc. */
  readonly why: string;
}

/**
 * The v1 seam. One row at N4 — the supervisor's own heartbeat, the only real producer this phase
 * has. A `plugins/slack` send path adds a row here, and `host/watchdog.sh`'s own drift gate
 * (J4.14, TST-18's shape one directory over) then FORCES the script to grow the matching probe or
 * the build fails. No edit to the watchdog is needed for the MECHANISM, only for the new row.
 */
export const DELIVERY_STAMPS: readonly StampRow[] = [
  {
    name: "supervisor-heartbeat",
    path: ".doppelganger/heartbeat.fail",
    writer: "host/supervisor.ts beat()",
    why: "the supervisor is alive and scheduling but could not write its liveness stamp — without this, probe 3 reports a healthy scheduler as dead",
  },
];

/**
 * `deliveryStamp(path)` returns the ONE function a producer calls: `stamp(ok, detail?)`.
 * `ok: true` removes the file (a no-op on one already absent — `force: true`); `ok: false` writes
 * `"<iso> <detail>\n"`, `nowIso()`'s own shape, so the stamp and a log line about the same event
 * agree on precision (LOG-01's clock). NEVER THROWS: a reporting path must not fail its caller
 * over its own bookkeeping — both branches sit inside one `try {} catch {}`, deliberately covering
 * the read implicit in `rmSync`'s own existence check too, not only the write.
 */
export function deliveryStamp(path: string): (ok: boolean, detail?: string) => void {
  return (ok: boolean, detail?: string): void => {
    try {
      if (ok) {
        rmSync(path, { force: true });
      } else {
        // mkdir its own parent, the same convention every project-relative writer in this repo
        // follows (test/writes.test.ts's REGISTER) — inside the SAME try, so a directory that
        // cannot be created (e.g. a parent segment is a plain file, ENOTDIR) is swallowed exactly
        // like a write failure is.
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${nowIso()} ${detail ?? "unknown"}\n`);
      }
    } catch {
      // A stamp we cannot write is not worth losing the send/heartbeat outcome over.
    }
  };
}

/** Every row's `path`, resolved inside ROOT — INS-02's project-relative category made mechanical,
 *  the same shape `host/config.test.ts` test 3 already uses for `GateResource`. Exported so a
 *  producer (host/supervisor.ts's `beat()`) resolves the SAME absolute path this module would. */
export const stampPath = (row: StampRow): string => projectPath(row.path);
