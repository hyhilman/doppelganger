---
name: nightly-polish
description: Make one small improvement to this repo's Markdown docs in a single unattended pass (JOB-C14). Run by the nightly-polish job, and by a human at /nightly-polish to see what a pass would do.
---
<!-- managed:doppelganger-skills v=1 src=plugins/nightly/skills/nightly-polish -->
<!-- rendered by `skills render` — do not edit; edit the source and re-render (SKL-04) -->

# nightly-polish

One pass, one small docs improvement, on this repo's own Markdown.

Your arguments give you a **goal**, a **brief**, a list of **recent** files, and a **worktree**.
Every edit happens inside that worktree. You decide *what* to change; the job decides whether it
ships. Do not commit, merge or push — the job owns the commit.

## The pass

1. **Read the brief.** It names the kind of change this pass is for. Stay inside it.
2. **Pick one doc.** If the recent list names files, pick a different one unless the goal really
   points back there. A doc you touched last night does not need you again tonight.
3. **Make one small change.** One file, one idea. A reviewer should hold the whole diff in their
   head. Move and reshape text; never delete information.
4. **Check it.** Every claim you write must match the code. Run `npm test` from the worktree root —
   the README's claims are checked there. If the suite fails, undo your edit.
5. **Report** in the block below. If no safe, useful change exists, change nothing and say so.
   A clean no-op is a good pass; a cosmetic diff is not.

## Writing style

Write in plain, simple English. Short common words, short sentences, one idea per sentence,
active voice. When a hard technical term is needed, keep it and add a short plain meaning in
parentheses the first time it appears. Keep every feature ID (`KRN-01`, `JOB-C14`, …) as it is.

## What to leave alone

Change only Markdown docs. Leave code, the skill files, `CLAUDE.md`, the rendered `.claude/` tree
and the CI config alone. Do not add a new doc, and do not delete, rename or split one — if a doc
needs that, change nothing and write it as a suggestion.

## Report

Emit exactly this block, last, once:

```
<<<POLISH
target: <the doc you changed, relative to the worktree, or - for no change>
summary: <one line, past tense: what changed and why it reads better>
suggestion: <one line for a human, or ->
POLISH>>>
```
