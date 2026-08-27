#!/usr/bin/env bash
# JOB-O10 (SUP-09, SUP-08, INS-03, KRN-06) — the liveness path that does NOT run through the
# toolchain it watches. bash plus system binaries only: no npm, nothing under node_modules/, no
# model call, no network — the one program on the real crontab, so it must still speak when
# everything else is wedged.
#
# `set -uo pipefail`, deliberately NOT `set -e`: each probe is EXPECTED to fail sometimes — that
# is the signal, not an error. A watchdog that exits on its first failed probe reports nothing,
# which is precisely the failure it exists to catch (AC5 pins this).
#
# TWO CHANNELS, and `exit 1` is not one of them (measured on this host, 2026-08-26): no
# sendmail/mail/mailx/postfix/exim4/ssmtp/msmtp, /var/mail is empty, and
# `strings /usr/sbin/cron` (3.0pl1-184ubuntu2) contains the line
# "No MTA installed, discarding output" — cron writes that to syslog and THROWS THE FAULT TEXT
# AWAY. So the two real channels are: the breach file (.doppelganger/watchdog.breach — presence is
# the alarm) and the log (JOB-O02, N5, reads it). `exit 1` is kept as a STATUS a process manager, a
# future MTA or a human running the script by hand can read — never assumed to deliver anything.
#
# No Slack, no hub, no `claude -p` fallback, no cooldown. Declined with the phase each arrives in
# (JOB-O02/N5 for the reporter-freshness probe and the Slack/Jira stamps, v1 for
# WATCHDOG_STALE_M/WATCHDOG_COOLDOWN_M/the claude -p fallback) so the next reader does not think
# they were forgotten (roadmap.md Gaps item 4).
set -uo pipefail

ROOT="${ENGINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BREACH="$ROOT/.doppelganger/watchdog.breach"
LOCK="$ROOT/.doppelganger/watchdog.lock"
HEARTBEAT="$ROOT/.doppelganger/supervisor.heartbeat"
STAMP="$ROOT/.doppelganger/heartbeat.fail"
mkdir -p "$ROOT/.doppelganger" 2>/dev/null || true

# SAF-01: read BEFORE probe 0, not after — a dry run must be fully inert (no writes) from its
# very first line, and probe 0 is the first place this script can write the breach file.
DRY="${WATCHDOG_DRY_RUN:-0}"

# PROBE 0 — the log channel itself. `set -uo pipefail` does NOT exit on a failed `.`, so a missing
# log.sh leaves log_init/log_error undefined, every fault line becomes `command not found` on
# stderr, and a healthy-looking `exit 0` follows: EVERY FAULT SILENTLY LOST from the one channel
# that remains. Detected here, reported with a bare printf, and the script stops before it can
# pretend to be healthy. `declare -F log_error`, not the `.`'s own exit status, is what decides —
# a present-but-empty log.sh sources CLEANLY (status 0) and still defines nothing.
if ! . "$ROOT/kernel/runtime/log/log.sh" 2>/dev/null || ! declare -F log_error >/dev/null 2>&1; then
  msg="$(date -u +%Y-%m-%dT%H:%M:%SZ) watchdog: log.sh missing or broken at $ROOT/kernel/runtime/log/log.sh — the log channel is DOWN"
  printf '%s\n' "$msg" >&2
  # SAF-01: a dry run writes NOTHING, not even here — checked before the write, matching the same
  # rule the faults loop below follows. `>` not `>>`: one tick's report replaces the last, so the
  # file never grows unbounded while log.sh stays broken across many ticks.
  if [ "$DRY" != "1" ]; then
    printf '%s\n' "$msg" > "$BREACH"
  fi
  exit 1
fi
log_init ops-watchdog

# Its own lock, deliberately NOT the gate (GAT-07) — this is the one job that must run precisely
# when everything else is wedged, including behind a writer holding the gate exclusively; gating
# it would let the failure it exists to catch silence it. The gate is in-memory inside the
# supervisor and this process is deliberately outside it, so a real `flock` is the only lock
# available. A held lock is not a fault — the PREVIOUS tick is still running, most likely because
# it is not wedged at all — so this ticks skips quietly rather than reporting.
exec 9>"$LOCK"
if ! flock -n 9; then
  log_info skipped-locked
  exit 0
fi

faults=()
fault() { faults+=("$1"); }
fault_first() { faults=("$1" "${faults[@]}"); }

# PROBE 1 — node_modules is a real directory. A symlink here IS the reference's 2026-07-30
# failure: a worktree's link reached master and the main checkout materialized it over its own
# tree. Two independent checks, not an if/elif: a symlink to a real directory still passes `-d`.
[ -L "$ROOT/node_modules" ] && fault "node_modules is a SYMLINK -> $(readlink "$ROOT/node_modules")"
[ ! -d "$ROOT/node_modules" ] && fault "node_modules is missing"

# PROBE 2 — node runs AND strips types. Checked by RUNNING it, not by testing for a file: a
# dangling symlink is present, looks executable, and does not run. The two node calls below are
# the only node/npm/node_modules-shaped things this script names — signed here, checked by name in
# host/watchdog.test.ts test 3.
node --version >/dev/null 2>&1 || fault "node does not execute — every job is failing"
node "$ROOT/host/watchdog.probe.ts" >/dev/null 2>&1 || fault "node cannot strip types — every job is failing"

# PROBE 3 — the supervisor's 60s heartbeat (SUP-14). THE probe that matters: a dead supervisor
# means NOTHING is scheduled. Checked by mtime, never by `systemctl is-active` — cron hands this
# script a bare environment with no XDG_RUNTIME_DIR and no session bus.
STALE_M="${WATCHDOG_SUPERVISOR_STALE_M:-5}"
if [ ! -f "$HEARTBEAT" ]; then
  fault "heartbeat missing — the scheduler has never started"
elif [ -n "$(find "$HEARTBEAT" -mmin "+$STALE_M" -print -quit)" ]; then
  fault "heartbeat stale — older than ${STALE_M} minute(s)"
fi

# PROBE 4 — the delivery stamp (JOB-O11). PRESENCE is the fault. Ordered LAST here and read FIRST
# in the report — when the stamp is present, its line is printed above probe 3's, because it is
# the CORRECTION to it: the supervisor is alive and ticking (probe 3 would otherwise fault) but
# cannot write its own liveness stamp.
if [ -f "$STAMP" ]; then
  fault_first "the supervisor is ALIVE but cannot write its heartbeat since $(head -c 40 "$STAMP") — probe 3 above is a false alarm"
fi

if [ ${#faults[@]} -eq 0 ]; then
  rm -f "$BREACH"                                    # PATH 1 cleared — the next good tick removes the alarm
  log_info healthy supervisor_stale_m="$STALE_M"
  exit 0
fi
for f in "${faults[@]}"; do log_error breach msg="$f"; done   # ALWAYS — one line per fault
# SAF-01: DRY_RUN is fully inert — no writes, same as every other job's dry-run knob in this repo.
# The faults are still logged (that IS the point of a dry run) but the breach file is never
# touched, which is CHECKED before the write, not after it — a write-then-undo would leave a
# window where the file briefly existed.
if [ "$DRY" = "1" ]; then
  log_info dry-run faults="${#faults[@]}"
  exit 0
fi
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${faults[@]}" > "$BREACH"   # PATH 1
exit 1                                                # PATH 2 — a status, never a delivery (see header)
