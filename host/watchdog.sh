#!/usr/bin/env bash
# JOB-O10 — the liveness path that does NOT run through the
# toolchain it watches. bash plus system binaries only: no npm, nothing under node_modules/, no
# model call, no network — the one program on the real crontab, so it must still speak when
# everything else is wedged.
#
# `set -uo pipefail`, deliberately NOT `set -e`: each probe is EXPECTED to fail sometimes — that
# is the signal, not an error. A watchdog that exits on its first failed probe reports nothing,
# which is precisely the failure it exists to catch.
#
# THREE CHANNELS, and `exit 1` is STILL not one of them: no
# sendmail/mail/mailx/postfix/exim4/ssmtp/msmtp, /var/mail is empty, and
# `strings /usr/sbin/cron` (3.0pl1-184ubuntu2) contains the line
# "No MTA installed, discarding output" — cron writes that to syslog and THROWS THE FAULT TEXT
# AWAY. `exit 1` is kept as a STATUS a process manager, a future MTA or a human running the script
# by hand can read — never assumed to deliver anything.
#
# So the three real channels are: the breach file (.doppelganger/watchdog.breach — presence is the
# alarm), the log, and ONE ntfy POST.
#
# THE POST IS WHY THIS HEADER NO LONGER SAYS "no network". That line was true and the alarm was
# still silent: a file nobody opens and a log nobody tails are both pull channels, so
# every fault this script raised waited for someone to come looking — and the whole point of probe
# 3 is the case where nobody is at the machine. ntfy is the cheapest thing that fixes it: one
# `curl`, no model, no CLI, no npm, nothing under node_modules, so the property that actually
# mattered survives intact — the alarm still shares NOTHING with the toolchain it watches.
# Deliberately NOT the hub xenith's own watchdog posts to: that is another checkout's
# infrastructure, and two instances never coordinate.
#
# THE POST CAN NEVER FAIL THIS SCRIPT. Both places that attempt it (probe 0 below, and the main
# fault path's own `notify()`) send only after their own breach file write is already on disk, and
# a send failure is recorded as a delivery stamp (probe 5) rather than raised — a reporting path
# that exits on its own failure reports nothing, which is the exact fault probe 0 exists to catch.
#
# No Slack, no hub, no `claude -p` fallback, no cooldown, each still off for its own reason so the
# next reader does not think it was forgotten. No cooldown is a DECISION, not an omission: this
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
REPORTSTAMP="$ROOT/.doppelganger/log-report.fail"
mkdir -p "$ROOT/.doppelganger" 2>/dev/null || true

# CRON'S PATH IS NOT A LOGIN SHELL'S. Cron hands this script
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

# The log channel, attempted here — before the notify state below is resolved — so a warning that
# resolution raises (the WATCHDOG_NO_NOTIFY typo check, further down) goes through the same
# log_info/log_error lines as everything else, whenever the channel actually works. PROBE 0
# (below) is still what DECIDES a broken channel is itself a fault and REPORTS it — this line only
# makes the attempt and, if it worked, names the job. `set -uo pipefail` does not exit on a failed
# `.`, so a missing or broken log.sh just leaves log_init/log_error undefined here, caught by
# PROBE 0 below.
. "$ROOT/kernel/runtime/log/log.sh" 2>/dev/null || true
declare -F log_init >/dev/null 2>&1 && log_init ops-watchdog

# --- the ntfy path, resolved ONCE here — before probe 0, so probe 0 can push its own fault too,
# and before the lock, since none of this touches disk. Probe 5 and every stamp write read this one
# answer, so they can never disagree about whether a stamp can still be cleared.

# CRON HANDS THIS SCRIPT A BARE ENVIRONMENT. The entry is `supervised: false` (SUP-09), so it
# never gets the supervisor's dotenv injection, and its PROGRAMS row is `dotenv: false` anyway.
# Without this fallback the knobs below are empty on every real tick, and the POST that exists for
# the unattended case only ever works when a human runs the script by hand — the exact inversion
# of the point. xenith's watchdog solved the same problem by sourcing its own `hub.env`; this
# reads `.env` instead, so an operator has ONE file to edit.
#
# READ, never SOURCED, and that distinction is load-bearing: `.` on `.env` executes whatever is in
# it, inside the one script that has to keep working when everything else is broken. This takes
# the last assignment of ONE named key, strips optional surrounding quotes, and can execute
# nothing. A commented-out line cannot match because `^` anchors the key.
dotenv_get() {
  [ -f "$ROOT/.env" ] || return 0
  sed -n "s/^$1=//p" "$ROOT/.env" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# Logs through log_info/log_error when log.sh loaded, a bare printf to stderr when it did not — the
# ntfy path has to report itself even on the one tick where the channel it would otherwise use is
# the exact thing that is down (probe 0's own push, below).
logline() {
  local level="$1"
  shift
  if declare -F log_error >/dev/null 2>&1; then
    if [ "$level" = "error" ]; then log_error "$@"; else log_info "$@"; fi
  else
    printf '%s watchdog: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
  fi
}

# $1: 1 = failed (write the stamp), 0 = delivered (remove it). Its own presence/absence is what
# probe 5 (below) checks.
stamp_ntfy() {
  if [ "$1" = "0" ]; then
    rm -f "$NTFYSTAMP"
  else
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${2:-unknown}" > "$NTFYSTAMP"
  fi
}

# The one place curl is invoked — probe 0 and the main fault path's `notify()` (below) both call
# this, so they send through the same code and land on the same stamp. $1: request body, $2: fault
# count for the Title. Always returns 0: a reporting path that fails its caller over its own
# bookkeeping is the fault probe 0 exists to catch.
#
# The bearer token never touches curl's own argv — any local user can read another process's argv
# from `ps` or /proc/<pid>/cmdline for as long as the call is in flight. `-H @<path>` makes curl
# read that one header from a file instead of a command-line argument (curl 7.55+), and `<(...)`
# is an anonymous pipe, not a file on disk that outlives this call — there is nothing left to clean
# up once curl exits.
#
# ONE flat topic, segmented by Title and Tags rather than by the topic name: ntfy topics have no
# hierarchy, and a topic per stage means a NEW stage publishes somewhere nobody is subscribed yet,
# so its first alarm is silent. Headers are kept ASCII — ntfy does not promise UTF-8 header
# handling. The body is the fault text verbatim, sent as the raw request body, so nothing has to be
# JSON-escaped — an escaper is code that runs only when the fleet is already broken and is
# therefore the least-exercised line in the alarm path.
ntfy_post() {
  local body="$1" count="$2"
  if ! command -v curl >/dev/null 2>&1; then
    logline error notify-failed msg="curl is not on PATH"
    stamp_ntfy 1 "curl is not on PATH"
    return 0
  fi
  local http
  http="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' \
    -H @<(printf 'Authorization: Bearer %s\n' "$token") \
    -H "Title: $topic watchdog: ${count} fault(s)" \
    -H "Tags: rotating_light,ops" \
    -H "Priority: 4" \
    --data-binary "$body" \
    "${url%/}/$topic" 2>/dev/null)" || http="000"

  case "$http" in
    2??) logline info notify-sent topic="$topic" faults="$count" http="$http"
         stamp_ntfy 0 ;;
    # 000 is curl's own failure (DNS, TLS, timeout, refused) — kept distinct from a real HTTP
    # status because "the server said 403" and "there was no server" are different repairs.
    *)   logline error notify-failed topic="$topic" http="$http" msg="ntfy POST did not return 2xx — this alarm was not delivered"
         stamp_ntfy 1 "http=$http" ;;
  esac
  return 0
}

# WATCHDOG_NO_NOTIFY (KRN-07's kill switch): "1" disables, "0"/unset/"" leaves it on. Anything else
# is a typo, and a typo must not silently disable an alarm switch — so it stays ON (an alarm path
# fails toward delivering) and logs once, naming the key and the value seen, rather than reading a
# mistyped value as "off".
NOTIFY_STATE="ready" # ready | unconfigured | disabled
no_notify="${WATCHDOG_NO_NOTIFY:-0}"
case "$no_notify" in
  1) NOTIFY_STATE="disabled" ;;
  0) ;;
  *) logline error notify-config-typo key=WATCHDOG_NO_NOTIFY value="$no_notify" msg="expected 0 or 1 - notify stays ON" ;;
esac

url="${NTFY_URL:-$(dotenv_get NTFY_URL)}"
token="${NTFY_TOKEN:-$(dotenv_get NTFY_TOKEN)}"
# INS-01: NTFY_TOPIC, then INSTANCE (env then .env, the same order and the same value
# kernel/instance.ts resolves for every other host-global write), then the checkout's own
# directory name — so two checkouts that happen to share a directory name but are given different
# INSTANCE values still land on different topics, which `basename $ROOT` alone could not tell
# apart.
topic="${NTFY_TOPIC:-$(dotenv_get NTFY_TOPIC)}"
[ -n "$topic" ] || topic="${INSTANCE:-$(dotenv_get INSTANCE)}"
[ -n "$topic" ] || topic="$(basename "$ROOT")"

# Unconfigured is SILENCE, not a fault: a host that never set this up has not lost an alarm, it
# declined one. Checked after the kill switch so a disabled watchdog is never relabeled
# "unconfigured" over knobs nobody is going to read anyway — and, either way, nothing below ever
# touches NTFYSTAMP while NOTIFY_STATE is not "ready", so a stale stamp from a past working config
# is left exactly as it was until notify comes back.
if [ "$NOTIFY_STATE" != "disabled" ] && { [ -z "$url" ] || [ -z "$token" ]; }; then
  NOTIFY_STATE="unconfigured"
fi

# PROBE 0 — the log channel itself. `set -uo pipefail` does NOT exit on a failed `.`, so a missing
# log.sh leaves log_init/log_error undefined, every fault line becomes `command not found` on
# stderr, and a healthy-looking `exit 0` follows: EVERY FAULT SILENTLY LOST from the one channel
# that remains. `declare -F log_error`, not the load attempt's own exit status (already made,
# above, before the notify state), is what decides — a present-but-empty log.sh sources CLEANLY
# (status 0) and still defines nothing. Reported here with a bare printf, and the script stops
# before it can pretend to be healthy.
#
# This is the one fault the log channel can never carry on its own, so it is pushed through ntfy
# directly too: ntfy_post logs through `logline` (above), not log_error, so it works whether or
# not log.sh loaded.
if ! declare -F log_error >/dev/null 2>&1; then
  msg="$(date -u +%Y-%m-%dT%H:%M:%SZ) watchdog: log.sh missing or broken at $ROOT/kernel/runtime/log/log.sh — the log channel is DOWN"
  printf '%s\n' "$msg" >&2
  # SAF-01: a dry run writes NOTHING, not even here — checked before the write, matching the same
  # rule the faults loop below follows. `>` not `>>`: one tick's report replaces the last, so the
  # file never grows unbounded while log.sh stays broken across many ticks.
  if [ "$DRY" != "1" ]; then
    printf '%s\n' "$msg" > "$BREACH"
    [ "$NOTIFY_STATE" = "ready" ] && ntfy_post "$msg" 1
  fi
  exit 1
fi

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

# PROBE 1 — node_modules is a real directory. A symlink here IS the reference's real
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
# Gated on NOTIFY_STATE == ready: while notify is disabled or unconfigured nothing in this script
# ever clears the stamp (notify(), below, returns before it gets the chance), so faulting on it
# unconditionally would pin an otherwise healthy host in breach forever, with no tick able to clear
# it. The stamp is left in place, so the first tick after notify comes back still reports the gap.
#
# It is deliberately circular and that is FINE. A tick that faults here will try to post — through
# the very channel the fault says is broken. When the channel is still down the post fails again,
# the stamp is rewritten and nothing is delivered (the breach file and the log still have it, as
# always). When the channel has RECOVERED, the post goes out carrying this fault, so the first
# thing the phone hears after an outage is that the alarm channel was down and for how long. The
# alternative — staying quiet about a broken alarm — is how xenith lost 185 sends over three days
# (engine/watchdog.sh) with every health probe green throughout.
if [ "$NOTIFY_STATE" = "ready" ] && [ -f "$NTFYSTAMP" ]; then
  fault "ntfy delivery failing since $(head -c 40 "$NTFYSTAMP") — alarms raised since then were LOST"
fi

# PROBE 6 — the log report's own delivery stamp (host/notify.ts). Same rule as probes 4 and 5:
# PRESENCE is the fault. It is a separate file from probe 5's on purpose, so a watchdog POST that
# works never clears a log report that cannot send, and the other way round. This script only
# reads it; the log report is its one writer.
if [ -f "$REPORTSTAMP" ]; then
  fault "log report delivery failing since $(head -c 40 "$REPORTSTAMP") — error lines since then reached the log but no phone"
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
# The kill switch, "unconfigured", and the actual send are already resolved above (NOTIFY_STATE,
# url, token, topic — before probe 0), so this only ever dispatches on that one answer, and
# probe 0's own push and this one always agree.
notify() {
  case "$NOTIFY_STATE" in
    disabled)
      logline info notify-disabled faults="${#faults[@]}"
      return 0 ;;
    unconfigured)
      logline info notify-unconfigured msg="NTFY_URL or NTFY_TOKEN is empty — no POST attempted"
      return 0 ;;
  esac
  local body
  body="$(printf '%s\n' "${faults[@]}")"
  ntfy_post "$body" "${#faults[@]}"
}
notify || true

exit 1                                                # PATH 2 — a status, never a delivery (see header)
