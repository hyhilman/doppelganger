#!/usr/bin/env bash
# JOB-O10 — the liveness path that does NOT run through the
# toolchain it watches. bash plus system binaries only: no npm, nothing under node_modules/, no
# model call, no network — the one program on the real crontab, so it must still speak when
# everything else is wedged.
#
# `set -uo pipefail`, deliberately NOT `set -e`: each probe is EXPECTED to fail sometimes — that
# is the signal, not an error. A watchdog that exits on its first failed probe reports nothing,
# which is precisely the failure it exists to catch (AC5 pins this).
#
# THREE CHANNELS, and `exit 1` is STILL not one of them (measured on this host, 2026-08-26): no
# sendmail/mail/mailx/postfix/exim4/ssmtp/msmtp, /var/mail is empty, and
# `strings /usr/sbin/cron` (3.0pl1-184ubuntu2) contains the line
# "No MTA installed, discarding output" — cron writes that to syslog and THROWS THE FAULT TEXT
# AWAY. `exit 1` is kept as a STATUS a process manager, a future MTA or a human running the script
# by hand can read — never assumed to deliver anything.
#
# So the three real channels are: the breach file (.doppelganger/watchdog.breach — presence is the
# alarm), the log (JOB-O02, N5, reads it), and ONE ntfy POST (2026-09-16).
#
# THE POST IS WHY THIS HEADER NO LONGER SAYS "no network". That line was true and the alarm was
# still silent: a file nobody opens and a log nobody tails are both pull channels, so until today
# every fault this script raised waited for someone to come looking — and the whole point of probe
# 3 is the case where nobody is at the machine. ntfy is the cheapest thing that fixes it: one
# `curl`, no model, no CLI, no npm, nothing under node_modules, so the property that actually
# mattered survives intact — the alarm still shares NOTHING with the toolchain it watches.
# Deliberately NOT the hub xenith's own watchdog posts to: that is another checkout's
# infrastructure, and D12 says two instances never coordinate.
#
# THE POST CAN NEVER FAIL THIS SCRIPT. It is last, after the breach file is already written, and
# its failure is recorded as a delivery stamp (probe 5) rather than raised — a reporting path that
# exits on its own failure reports nothing, which is the exact fault probe 0 exists to catch.
#
# No Slack, no hub, no `claude -p` fallback, no cooldown. Declined with the phase each arrives in
# (JOB-O02/N5 for the reporter-freshness probe and the Slack/Jira stamps, v1 for
# WATCHDOG_STALE_M/WATCHDOG_COOLDOWN_M/the claude -p fallback) so the next reader does not think
# they were forgotten (roadmap.md Gaps item 4). No cooldown is a DECISION, not an omission: this
# script only posts on a tick that already breached, breaches are not rate-limited by anything
# else, and a cooldown stamp would be a fourth file to reason about for a fault that should be
# rare. If a wedged host ever pages every 15 minutes, that is the alarm working.
set -uo pipefail

ROOT="${ENGINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BREACH="$ROOT/.doppelganger/watchdog.breach"
LOCK="$ROOT/.doppelganger/watchdog.lock"
HEARTBEAT="$ROOT/.doppelganger/supervisor.heartbeat"
STAMP="$ROOT/.doppelganger/heartbeat.fail"
NTFYSTAMP="$ROOT/.doppelganger/ntfy.fail"
mkdir -p "$ROOT/.doppelganger" 2>/dev/null || true

# CRON'S PATH IS NOT A LOGIN SHELL'S. Measured on this host 2026-09-16: cron hands this script
# `/usr/bin:/bin`, where `node` is v18.19.1 — old enough that it cannot strip types, so probe 2
# below would fault on EVERY tick and page about a toolchain that is fine. `/usr/local/bin` is
# where this host's 22.23.1 lives (the version .nvmrc pins), and it is the FHS location for a
# locally installed binary rather than a guess at one person's setup.
#
# PREPENDED, not replaced: everything else this script runs (date, find, flock, head, sed, curl)
# must still resolve normally. Written as an assignment then an export, not `export PATH=…`,
# because host/watchdog.test.ts decides what is a KNOB by "read but never assigned at line start"
# — and PATH is emphatically not one of this script's knobs.
#
# This is the xenith watchdog's own fix (engine/watchdog.sh line 75, `~/.local/bin` for the
# `claude` CLI), applied to the one binary THIS script needs. Probe 2 stays the honest backstop: a
# host where none of these directories holds a modern node still gets told so.
PATH="/usr/local/bin:$PATH"
export PATH

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

# Its own lock, deliberately NOT the gate — this is the one job that must run precisely
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

# PROBE 3 — the supervisor's 60s heartbeat. THE probe that matters: a dead supervisor
# means NOTHING is scheduled. Checked by mtime, never by `systemctl is-active` — cron hands this
# script a bare environment with no XDG_RUNTIME_DIR and no session bus.
STALE_M="${WATCHDOG_SUPERVISOR_STALE_M:-5}"
if [ ! -f "$HEARTBEAT" ]; then
  fault "heartbeat missing — the scheduler has never started"
elif [ -n "$(find "$HEARTBEAT" -mmin "+$STALE_M" -print -quit)" ]; then
  fault "heartbeat stale — older than ${STALE_M} minute(s)"
fi

# PROBE 4 — the delivery stamp. PRESENCE is the fault. Ordered LAST here and read FIRST
# in the report — when the stamp is present, its line is printed above probe 3's, because it is
# the CORRECTION to it: the supervisor is alive and ticking (probe 3 would otherwise fault) but
# cannot write its own liveness stamp.
if [ -f "$STAMP" ]; then
  fault_first "the supervisor is ALIVE but cannot write its heartbeat since $(head -c 40 "$STAMP") — probe 3 above is a false alarm"
fi

# PROBE 5 — the ntfy delivery stamp. PRESENCE is the fault, the same rule probe 4 follows, and
# this probe exists because kernel/runtime/delivery.ts grew an `ntfy-send` row: the drift gate in
# host/watchdog.test.ts turns a row there into a mandatory probe here, so this was not optional.
#
# It is deliberately circular and that is FINE. A tick that faults here will try to post — through
# the very channel the fault says is broken. When the channel is still down the post fails again,
# the stamp is rewritten and nothing is delivered (the breach file and the log still have it, as
# always). When the channel has RECOVERED, the post goes out carrying this fault, so the first
# thing the phone hears after an outage is that the alarm channel was down and for how long. The
# alternative — staying quiet about a broken alarm — is how xenith lost 185 sends over three days
# (engine/watchdog.sh, 2026-08-07..09) with every health probe green throughout.
if [ -f "$NTFYSTAMP" ]; then
  fault "ntfy delivery failing since $(head -c 40 "$NTFYSTAMP") — alarms raised since then were LOST"
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

# PATH 3 — the ntfy POST. LAST, and deliberately after the breach file is already on disk: the two
# pull channels must be complete before the push is attempted, so a hang here can only delay the
# alarm, never lose it.
#
# Every failure mode ends in `stamp_ntfy 1` and NEVER in a non-zero exit from this function — a
# reporting path that fails its caller over its own bookkeeping is the fault probe 0 exists for.
# `|| true` on the call itself is the belt to that braces.
stamp_ntfy() {            # $1: 1 = failed (write the stamp), 0 = delivered (remove it)
  if [ "$1" = "0" ]; then
    rm -f "$NTFYSTAMP"
  else
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${2:-unknown}" > "$NTFYSTAMP"
  fi
}

notify() {
  # The kill switch is checked FIRST and leaves the stamp untouched: standing the POST down is not
  # a delivery failure, and flipping it must not make probe 5 fault on the next tick.
  if [ "${WATCHDOG_NO_NOTIFY:-0}" = "1" ]; then
    log_info notify-disabled faults="${#faults[@]}"
    return 0
  fi

  # CRON HANDS THIS SCRIPT A BARE ENVIRONMENT. The entry is `supervised: false` (SUP-09), so it
  # never gets the supervisor's dotenv injection, and its PROGRAMS row is `dotenv: false` anyway.
  # Without this fallback the three knobs below are empty on every real tick and the POST that
  # exists for the unattended case only ever works when a human runs the script by hand — the
  # exact inversion of the point. xenith's watchdog solved the same problem by sourcing its own
  # `hub.env`; this reads `.env` instead, so an operator has ONE file to edit.
  #
  # READ, never SOURCED, and that distinction is load-bearing: `.` on `.env` executes whatever is
  # in it, inside the one script that has to keep working when everything else is broken. This
  # takes the last assignment of ONE named key, strips optional surrounding quotes, and can
  # execute nothing. A commented-out line cannot match because `^` anchors the key.
  dotenv_get() {
    [ -f "$ROOT/.env" ] || return 0
    sed -n "s/^$1=//p" "$ROOT/.env" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
  }

  local url="${NTFY_URL:-$(dotenv_get NTFY_URL)}"
  local token="${NTFY_TOKEN:-$(dotenv_get NTFY_TOKEN)}"
  # INS-01: the topic IS the checkout's own name, so two checkouts on one host never share an
  # alarm channel and neither has to be told about the other. `basename $ROOT` is exactly what
  # kernel/instance.ts resolves INSTANCE to, and INSTANCE's charset is a strict subset of what an
  # ntfy topic accepts, so a valid instance name cannot produce an invalid topic.
  local topic="${NTFY_TOPIC:-$(dotenv_get NTFY_TOPIC)}"
  [ -n "$topic" ] || topic="$(basename "$ROOT")"

  # Unconfigured is SILENCE, not a fault: a host that never set this up has not lost an alarm, it
  # declined one, and stamping it would make probe 5 cry on every tick forever.
  if [ -z "$url" ] || [ -z "$token" ]; then
    log_info notify-unconfigured msg="NTFY_URL or NTFY_TOKEN is empty — no POST attempted"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    log_error notify-failed msg="curl is not on PATH"
    stamp_ntfy 1 "curl is not on PATH"
    return 0
  fi

  # ONE flat topic, segmented by Title and Tags rather than by the topic name: ntfy topics have no
  # hierarchy (measured against this server 2026-09-16 — `<topic>/ops` is 404 "page not found"),
  # and a topic per stage means a NEW stage publishes somewhere nobody is subscribed yet, so its
  # first alarm is silent. Headers are kept ASCII — ntfy does not promise UTF-8 header handling.
  #
  # The body is the fault list verbatim, sent as the raw request body, so nothing has to be JSON-
  # escaped. That is not a shortcut: an escaper is code that runs only when the fleet is already
  # broken and is therefore the least-exercised line in the alarm path.
  local body
  body="$(printf '%s\n' "${faults[@]}")"
  local http
  http="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $token" \
    -H "Title: $topic watchdog: ${#faults[@]} fault(s)" \
    -H "Tags: rotating_light,ops" \
    -H "Priority: 4" \
    --data-binary "$body" \
    "${url%/}/$topic" 2>/dev/null)" || http="000"

  case "$http" in
    2??) log_info notify-sent topic="$topic" faults="${#faults[@]}" http="$http"
         stamp_ntfy 0 ;;
    # 000 is curl's own failure (DNS, TLS, timeout, refused) — kept distinct from a real HTTP
    # status because "the server said 403" and "there was no server" are different repairs.
    *)   log_error notify-failed topic="$topic" http="$http" msg="ntfy POST did not return 2xx — this alarm was not delivered"
         stamp_ntfy 1 "http=$http" ;;
  esac
  return 0
}
notify || true

exit 1                                                # PATH 2 — a status, never a delivery (see header)
