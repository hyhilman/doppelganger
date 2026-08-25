# MVP loop — state of record

**Goal:** the MVP of `roadmap.md` = **N0 → N4**, 123 items, ending at "safe to leave alone".
N5 (the framework claim) is out of scope for this loop.

**Branch:** `dev`. Every step is a small, self-contained commit citing its feature ID.

## The per-phase cycle

Each phase runs the same four steps. The main loop only reads the output of each step
and decides whether to advance — it does not re-verify the work itself.

1. **PLAN** — one Opus agent reads `roadmap.md` §2 rows for the phase's IDs plus the
   xenith reference, and writes `plan/N<x>-uac.md`: one job per item, each with a
   detailed, testable acceptance criterion.
2. **GAP** — one Opus verifier reads the plan against the roadmap and reports what is
   missing, wrong, or untestable. Its findings are folded back into the plan.
3. **BUILD** — Sonnet agents work the plan job by job. Small change, `npm test`, commit,
   next. No agent bundles unrelated items into one commit.
4. **VERIFY** — one Opus verifier checks the finished phase against `plan/N<x>-uac.md`
   and the roadmap. Its findings become follow-up fix jobs, worked the same way.

Advance only when VERIFY comes back with nothing blocking.

## Phase state

| Phase | Items | Est. | Plan | Gap | Build | Verify |
|-------|-------|------|------|-----|-------|--------|
| N0 — Ground truth | 9 | 2 d | — | — | — | — |
| N1 — Kernel the loop needs | 26 | 1.5–2 wk | — | — | — | — |
| N2 — Supervisor + gate | 32 | 1 wk | — | — | — | — |
| N3 — Harness + skills + the pass | 34 | 1.5–2 wk | — | — | — | — |
| N4 — Safe to leave alone | 22 | 1 wk | — | — | — | — |

Legend: `—` not started · `▶` running · `✅` done · `⚠` done with open follow-ups.

## Standing rules for every agent in this loop

- `roadmap.md` is the spec of record. Cite the feature ID (`KRN-01`, `LSE-07`, …) in the
  commit message, the test name, and any comment that needs one.
- Read the reference at `/home/hyhilman/projects/xenith/` (`engine/**`,
  `compose-data/docker-compose.yml`) rather than guessing at behaviour. It is the
  acceptance criterion, not something to copy verbatim.
- `CLAUDE.md` layering law, working rules, and the invariants (INV-1…12) are not
  negotiable.
- One small change per commit. Run `npm test` before each commit once a suite exists.
- Never hand-edit `.claude/skills/` — it is rendered.

## Open items the loop must not silently skip

- **§5 Q0** (N0) — symlink vs render for `.claude/skills/`. Needs a human to run `ln -s`
  and restart the CLI. Decides SKL-04/10 and TST-23. Flag it, do not guess.
