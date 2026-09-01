# SUP-19 — the process manager. The supervisor is a long-running process and nothing on the
# crontab starts it (SUP-09: the watchdog is THE ONLY ENTRY on the real crontab). A container with
# a restart policy is what keeps it up, replacing the reference's `engine.service` +
# `enable-linger`. The pinned-node-path gotcha that unit file carried disappears here, because the
# image owns the node.
#
# THE STANDALONE ROLE ONLY (DKR-01). `scheduler` and `worker` need the queue (QUE), which is v1 —
# there is one process here, it opens its own SQLite files, and nothing is distributed.
#
# WHAT IS AND IS NOT IN THIS IMAGE. The image carries the TOOLCHAIN — node, git, the agent CLI, gh,
# ripgrep. It carries NO application code and NO node_modules: the checkout is bind-mounted at the
# same absolute path it has on the host (DKR-04, DKR-06), so the code the container runs and the
# code you edit are the same bytes, and `sha256(config)` is equal by construction rather than by a
# sync step. This is also why the build context copies nothing — `.dockerignore` is unnecessary
# because there is nothing to ignore.
#
# UID ALIGNMENT (DKR-05) AND THE PATH (DKR-06) ARE BUILD ARGS WITH NO DEFAULT. A default here is a
# guess about the host, and a wrong guess means every file the agent writes into the mounted tree is
# owned by the wrong user — discovered days later, as a permission error at 3am. `fleet/fleet.sh`
# resolves all four from the host it runs on and passes them in; compose refuses to build without
# them.

ARG NODE_VERSION
FROM node:${NODE_VERSION}-bookworm-slim

# DKR-02 — one image, one agent CLI. The tools a pass actually reaches for: git (worktrees, commits,
# the ff-only merge), gh (JOB-P/JOB-J in v1; harmless and expected now), ripgrep (the agent's search),
# ca-certificates (the model API is HTTPS), procps (LSE-11 reads /proc), curl and less (the CLI's own
# helpers). `--no-install-recommends` keeps the image to the named set.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gh \
    less \
    procps \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

# The agent CLI. NOT pinned to an exact version by default: pinning a version of something outside
# this repo rots, and DKR-19's `hello` handshake is the real backstop for a process running old
# code. `fleet.sh build --claude <version>` pins it for a reproducible rebuild when you need one.
ARG CLAUDE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_VERSION} \
  && npm cache clean --force

# DKR-05 + DKR-06. The `node` user the base image ships already holds uid 1000 on most hosts, so it
# is removed rather than reused — reusing it would leave the container's idea of `$HOME` and the
# host's disagreeing, and DKR-06's whole point is that NO path is ever translated.
ARG HOST_USER
ARG HOST_UID
ARG HOST_GID
ARG HOST_HOME
RUN userdel -r node \
  && groupadd -g ${HOST_GID} ${HOST_USER} \
  && useradd -u ${HOST_UID} -g ${HOST_GID} -d ${HOST_HOME} -m -s /bin/bash ${HOST_USER}

USER ${HOST_UID}:${HOST_GID}
ENV HOME=${HOST_HOME}

# No CMD. `fleet/compose.yml` names the command, so the one place that says what this container runs
# is the same place that says how it restarts.
