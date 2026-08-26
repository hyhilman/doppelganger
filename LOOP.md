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
| N0 — Ground truth | 11 | 2 d | ✅ | ✅ | ✅ | ⚠ |
| N1 — Kernel the loop needs | 26 | 1.5–2 wk | ▶ | — | — | — |
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

## Settled questions

- **§5 Q0 — no symlinks.** Every skill is a **project skill**. `.claude/skills/<job>/SKILL.md`
  is a real file in the project tree: a rendered copy of `plugins/<x>/skills/<job>/SKILL.md`,
  not a link, and not delivered through the plugin-skill mechanism. Confirms SKL-04 as
  written and kills the symlink branch of TST-23. (Decided by the user, 2026-08-25.)

## Open items the loop must not silently skip

- **J0.13 AC4 — CI has never run.** `dev` is not pushed, so no GitHub Actions run exists and
  no run URL is recorded. The workflow content is correct and its shape was proved locally:
  a fresh clone + `npm ci` + `CORPUS_OVERRIDE=/nonexistent npm test` exits 0 and reports
  `# SKIP reference corpus absent`, which is what AC5 wanted to observe. Residual risk is
  low but the AC stays UNMET until someone pushes. **Waiting on the user.**
- **The corpus counts will keep drifting, by design.** xenith grew twice while N0 was being
  built — 251 → 252 → 254 files in one day. That is why the four figures are now stated as
  approximations and the recheck asserts rounding, not equality (N0 F4). If a future reader
  wants exact numbers, the answer is to measure, not to pin.

- **SKL-10 ownership — settled at N0 (J0.9).** The rendered file itself carries a managed
  marker in its body (two HTML comment lines, right after the frontmatter), so `sync` can
  decide ownership from the filesystem alone, no ledger. `check` reports five findings:
  missing, drift, orphan, collision, stray. A hand-edited rendered file fails the build and
  is never silently re-rendered. See `roadmap.md` §5 Q0 and §2.30 SKL-10.
- **§5 Q5 — settled at N0 (J0.7).** Measured on the target Node: this repo's own dev loop
  needs no build (a workspace link is a symlink, and Node strips types through it), but a
  real install still does (ADO-15 stays). This corrects ADO-16's old premise. See
  `roadmap.md` §5 Q5 and §2.32 ADO-16.
- **SKL-07 output-vocabulary boundary — drawn at N0 (J0.9).** A skill may emit an output
  vocabulary (a report format, like `nightly-sandcastle`'s `outcome=`) but never an
  authorization token (a value that widens what the run may do, like JOB-T03's `agent`).
  TST-24's third clause is reworded around this line. N3's real `parseVerdict` must
  reproduce the pinned vocabulary in `test/skills-example.test.ts`.
