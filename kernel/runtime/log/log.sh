#!/usr/bin/env bash
# the bash half of the one log line shape.
# kernel/runtime/log/emit.ts is the TypeScript half and MUST stay identical — cron redirects both
# into the same file, so a format only one side can produce is not a format. J1.9 proves the two
# agree byte for byte.
#
# Sourced, never executed: `. "$DIR/log.sh"` then `log_init <job>`. Mode 644, no executable bit —
# a shell file meant to be sourced is a bug waiting to happen the moment someone runs it directly.
#
#   log_info  tick-start
#   log_warn  lock-held      holder=switch
#   log_error adapter-failed source=notion msg="no payload in agent output"
#
# Writes to STDERR, matching the TS side — cron redirects `>> <log> 2>&1` and stdout stays free for
# whatever the script actually prints.

# shellcheck shell=bash

LOG_JOB="${LOG_JOB:-unknown}"
LOG_LEVEL="${LOG_LEVEL:-info}"

log_init() { LOG_JOB="$1"; }

_log_rank() {
  case "$1" in
    debug) printf '10' ;;
    info)  printf '20' ;;
    warn)  printf '30' ;;
    error) printf '40' ;;
    *)     printf '20' ;;
  esac
}

# Bare when it cannot be confused with the delimiter, quoted otherwise. Same predicate as the TS
# side — a value that renders bare there must render bare here, or one parser sees two vocabularies.
#
# The class is ENUMERATED, never a bracket-expression RANGE (no "letter THROUGH letter" shorthand).
# A range is resolved through the shell's current LC_COLLATE, and glibc's en_US.UTF-8 collation
# places roughly 135 codepoints between Latin-1 Supplement and Latin Extended-A inside such a range —
# so the same byte renders BARE under one locale and QUOTED under another, while the TypeScript side
# always says QUOTED. Enumerating every character is collation-proof by construction: no range,
# nothing for LC_COLLATE to reinterpret.
_log_val() {
  case "$1" in
    ''|*[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_./:@#+-]*)
      local v=$1
      v=${v//\\/\\\\}
      v=${v//\"/\\\"}
      v=${v//$'\n'/ }
      printf '"%s"' "$v"
      ;;
    *) printf '%s' "$1" ;;
  esac
}

# `msg` is held back and emitted last regardless of argument order: it is the only field allowed to
# contain spaces, so a parser takes everything from `msg=` as one value. A field emitted after it
# would silently land inside the message.
_log_emit() {
  local level=$1 event=$2
  shift 2
  # `if`, not `[ … ] && return` — every wrapper runs `set -e`, and an AND-list whose last command
  # never runs exits non-zero, which would kill the caller on a merely-filtered debug line.
  if [ "$(_log_rank "$level")" -lt "$(_log_rank "$LOG_LEVEL")" ]; then return 0; fi

  local line msg="" msg_set=0 kv key val
  line="ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) level=${level} job=$(_log_val "$LOG_JOB") src=sh"
  line="${line} event=$(_log_val "$event")"

  for kv in "$@"; do
    key=${kv%%=*}
    val=${kv#*=}
    if [ "$key" = "msg" ]; then msg=$val; msg_set=1; else line="${line} ${key}=$(_log_val "$val")"; fi
  done
  # An explicitly-supplied EMPTY msg still renders msg="" — msg_set is what decides whether the pair
  # was supplied at all, never whether the value happens to be empty. The reference tests
  # `[ -n "$msg" ]` here, which drops an empty msg in bash while TypeScript still writes msg="" —
  # one carve-out in an otherwise byte-identical contract. This is the fix.
  if [ "$msg_set" -eq 1 ]; then line="${line} msg=$(_log_val "$msg")"; fi

  printf '%s\n' "$line" >&2
}

log_debug() { _log_emit debug "$@"; }
log_info()  { _log_emit info  "$@"; }
log_warn()  { _log_emit warn  "$@"; }
log_error() { _log_emit error "$@"; }

# Run the job and classify how it ended.
#
# Deliberately NOT `exec`. Replacing the shell hands the exit code straight to cron, which mails it
# nowhere and writes no line — so a wrapper dying of a bad PATH or a tsx error looked exactly like a
# healthy quiet run. One extra process is the price of that failure being visible.
#
# Returns the job's code, and callers put this last so the script's own exit code is unchanged.
log_run() {
  local rc=0
  "$@" || rc=$?
  if [ "$rc" -eq 0 ]; then
    log_info job-ok
  else
    log_error job-failed exit="$rc" msg="$1 exited non-zero"
  fi
  return "$rc"
}
