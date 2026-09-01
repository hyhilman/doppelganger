# doppelganger

## What this is

This repo runs unattended jobs. A job wakes up on a schedule, reads the repo, does one small
piece of work, and reports what it did. Today there is one real job group (a "plugin" — one
integration's worth of jobs and knobs): `nightly-sandcastle`. The seam that lets a second plugin
plug in is still being built. So call this an unattended job runner with a plugin-shaped seam —
not a framework, not yet.

Check the checkout is healthy first:

`npm test`

## Run it, two ways

Pick ONE way. Never run both at once. One checkout is one instance, and both ways open that one
instance's lease database (a lease is a timed claim on a job, so only one run owns it). Start a
second loop and every tick it takes refuses at the self-lock — the lock a job takes on itself —
and does no work.

### Bare metal

1. `set -a; . ./.env; set +a`
2. `node host/supervisor.ts`

The loop is `host/supervisor.ts`. It does not restart itself. Put it under whatever already
restarts things on this box — systemd, pm2, a plain restart loop. This repo does not pick one for
you.

To read the schedule without starting anything, run `node host/supervisor.ts --list`.

### Container, the supported way

Everything goes through `fleet/fleet.sh`, the fleet CLI. Make `.env` first (next section) —
`build` refuses without it.

- `fleet/fleet.sh build` — build the image. Its Node version comes from `.nvmrc`, never a number
  typed here.
- `fleet/fleet.sh up` — start it, restarting unless you stop it.
- `fleet/fleet.sh logs -f` — follow its output.
- `fleet/fleet.sh status` — the host facts it uses, plus what is running.
- `fleet/fleet.sh shell` — a shell inside the running container.
- `fleet/fleet.sh down` — stop it.
- `fleet/fleet.sh token` — one agent login, run inside the container.

`up` and `token` also need `~/.claude` and `~/.claude.json` to exist on the host. Both are
bind-mounted in, and the agent CLI keeps its login there. Run `claude` once on the host first, or
these two stop with an error.

## `.env`

Copy `.env.example` to `.env` and edit it.

There is no dotenv package here, on purpose. Two things read `.env` for you:

- The supervisor reads it and hands it to each job it spawns.
- The container reads it through compose's `env_file:` entry.

Neither one puts it in your own shell. So source it yourself before you start the supervisor by
hand. Do the same before any job you run by hand. That is step 1 above.

Every knob works without you setting it, except one: `CRONTAB_CMD`, the absolute path to the
`crontab` binary. Leave it out and every crontab command throws, instead of guessing which
`crontab` you meant.

## The watchdog

The watchdog is a HOST crontab entry, in both setups — never inside the container. A liveness
check is a probe that answers one question: is it still up? Put that probe inside the container
and it shares the fate of the thing it checks. Then it goes quiet in the one case that matters —
the case where everything is down.

See what would change, then install it:

1. `npm run crontab check`
2. `npm run crontab sync`

On a box with nothing installed yet, `check` prints `no managed block installed` and exits 1. That
is the "not installed yet" answer, not a fault. Once the block is in, it exits 0.

The entry it installs is `ops-watchdog`, and that is the only entry it installs. Every other job
on the schedule runs under the supervisor itself.

## First run, safely

Start with the free smoke test. It calls no agent and costs nothing:

`NIGHTLY_SANDCASTLE_MAX=0 npm run job nightly-sandcastle`

On a checkout that is not on the base branch (`NIGHTLY_SANDCASTLE_BASE`, default `main`) it logs
`event=skip reason=not-on-base` and exits 0. That is what you want to see off the base branch: no
work was due, and the wiring still ran end to end.

Run it again inside the same hour and the message changes to `event=lease-held reason=done`. One
run owns the job for the hour, and the first run already took it. Nothing is broken. To go again,
release the hour with the `npm run lease-clear` line the log prints for you.

Then climb the ladder, one rung at a time:

- `NIGHTLY_SANDCASTLE_DRY_RUN=1` — run the real agent and the real gate, write nothing.
- `NIGHTLY_SANDCASTLE_MAX=1` — let one real pass through.
- `<NAME>_DB=/tmp/x.db` — point one integration's database at a throwaway file.
