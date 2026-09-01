#!/usr/bin/env bash
# DKR-18 — the `fleet` CLI, at the subset the `standalone` role has verbs for.
#
# WHAT THIS SCRIPT IS FOR. `fleet/compose.yml` is written entirely in `${VAR:?}` placeholders on
# purpose (DKR-05, DKR-06): a default for the uid or the path would be a guess about the host, and a
# wrong guess is discovered as a permission error days later. This script is the one place those
# four facts are read from the host that is actually running, so nothing is guessed and nothing is
# typed twice.
#
# VERBS. `build` · `up` · `down` · `logs` · `shell` · `status` · `token`, plus `list` as an alias for
# `status` (DKR-18 names it). `add` · `serve` · `rm` are WORKER verbs — they need the queue and the
# broker socket, which are v1 (QUE), and a `standalone` container has nothing to add to.
#
# `set -euo pipefail`, unlike host/watchdog.sh, which deliberately does not: every command here is
# expected to succeed, and a half-applied compose action is worse than a refusal.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/fleet/compose.yml"
SERVICE=standalone

die() { printf 'fleet: %s\n' "$1" >&2; exit 1; }

# The four host facts compose refuses to start without, plus the node version. NODE_VERSION comes
# from .nvmrc rather than a literal for the same reason .github/workflows/test.yml takes it from
# there: one file owns the Node floor, and test/fleet.test.ts checks that this line still reads it.
resolve_host() {
  [ -f "$ROOT/.nvmrc" ] || die ".nvmrc is missing — it owns the Node version this image is built on"
  NODE_VERSION="$(tr -d ' \t\n\r' < "$ROOT/.nvmrc")"
  HOST_USER="$(id -un)"
  HOST_UID="$(id -u)"
  HOST_GID="$(id -g)"
  HOST_HOME="$HOME"
  HOST_ROOT="$ROOT"
  export NODE_VERSION HOST_USER HOST_UID HOST_GID HOST_HOME HOST_ROOT
}

# `.env` is not optional: CRONTAB_CMD is a required EnvSpec row with no default, so a container
# started without it throws on the first `crontab` command rather than at boot. Refusing here turns
# that into one line at the moment you asked for it.
require_env() {
  [ -f "$ROOT/.env" ] || die ".env is missing — copy .env.example to .env and edit it"
}

# The agent CLI keeps its credentials in ~/.claude and its per-project trust in ~/.claude.json
# (DKR-09, DKR-11). Both are bind-mounted, and DKR-06's identical path is what makes the trust
# carry over for free — the CLI keys trust on the absolute project path, which is the same string
# on both sides. Compose creates a DIRECTORY for a missing bind-mount source, and a directory where
# the CLI expects a JSON file is a confusing failure, so the file is required to exist first.
require_agent_state() {
  [ -d "$HOME/.claude" ] || die "$HOME/.claude does not exist — run \`claude\` once on the host first"
  [ -f "$HOME/.claude.json" ] || die "$HOME/.claude.json does not exist — run \`claude\` once on the host first"
}

compose() {
  resolve_host
  docker compose -f "$COMPOSE_FILE" "$@"
}

usage() {
  cat <<'EOF'
fleet — the standalone container that keeps the supervisor running (SUP-19)

  build [--claude <version>]  build the image; --claude pins the agent CLI (default: latest)
  up                          start the supervisor, restarting unless stopped
  down                        stop and remove it
  logs [-f]                   the container's stdout/stderr (the supervisor's own log lines)
  shell                       an interactive shell inside the running container
  status | list               what is running, and the four host facts it was built with
  token                       one interactive `claude` login inside the container (DKR-09)

The WATCHDOG is not in the container, on purpose (JOB-O10). Install it on the host crontab:
  npm run crontab check   # what would change
  npm run crontab sync    # install it
EOF
}

cmd="${1-}"
[ -n "$cmd" ] || { usage; exit 1; }
shift || true

case "$cmd" in
  build)
    claude_version=latest
    if [ "${1-}" = "--claude" ]; then
      [ -n "${2-}" ] || die "--claude needs a version"
      claude_version="$2"
      shift 2
    fi
    require_env
    CLAUDE_VERSION="$claude_version" compose build "$@"
    ;;

  up)
    require_env
    require_agent_state
    compose up -d "$@"
    ;;

  down)
    compose down "$@"
    ;;

  logs)
    compose logs "$@" "$SERVICE"
    ;;

  shell)
    compose exec "$SERVICE" bash
    ;;

  status|list)
    resolve_host
    printf 'root        %s\n' "$HOST_ROOT"
    printf 'user        %s (%s:%s)\n' "$HOST_USER" "$HOST_UID" "$HOST_GID"
    printf 'home        %s\n' "$HOST_HOME"
    printf 'node        %s (from .nvmrc)\n' "$NODE_VERSION"
    printf 'env         %s\n' "$([ -f "$ROOT/.env" ] && echo present || echo MISSING)"
    printf '\n'
    docker compose -f "$COMPOSE_FILE" ps
    ;;

  # DKR-09 — one manual login per container, not one per boot. It runs against the SAME
  # ~/.claude the host uses, so a host login already counts; this verb exists for the case where it
  # does not, and for re-authenticating without leaving the container.
  token)
    require_env
    require_agent_state
    compose run --rm -it "$SERVICE" claude
    ;;

  -h|--help|help)
    usage
    ;;

  *)
    die "unknown verb: $cmd (try: fleet.sh help)"
    ;;
esac
