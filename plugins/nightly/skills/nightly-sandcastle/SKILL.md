---
name: nightly-sandcastle
description: Make one small, verified improvement to the engine repo in a single unattended pass (JOB-C15). Run by the nightly-sandcastle job, and by a human at /nightly-sandcastle to see what a pass would do.
---

# nightly-sandcastle

One pass, one improvement, on the engine repo itself.

You are given a **goal** and a **worktree** in your arguments. Every edit you make happens inside
that worktree. You decide *what* the change is; the job decides whether it ships. Do not try to
ship it yourself.

## The pass

1. **Read before you write.** Find the code the goal actually names. If the goal is already
   satisfied, say so and change nothing — a pass that reports `none` is a successful pass.
2. **Pick exactly one improvement.** Not a list, not a theme. One change a reviewer could hold in
   their head. Prefer the one that removes a thing over the one that adds a thing.
3. **Make the smallest change that fully lands it.** Half a refactor is worse than none: the next
   pass reads it as finished work. If the change cannot be completed in this pass, report it as
   `too-large` with what you found, and change nothing.
4. **Verify it yourself.** Run the suite. If the suite does not pass, you have not made an
   improvement — revert your edit and report the failure rather than reporting the change.
5. **Report** in the block below. The report is the only thing read; a change you do not name in it
   is a change nobody will find.

## Constraints on the change

- **Off limits:** the schedule file, the supervisor, `package.json`, and this skill's own files. A
  pass that needs one of them reports the need and edits nothing.
- **Every claim in a doc must be checked against the source.** If you write a count, wire the test
  that pins it (the `TST` convention); if you cannot, do not write the count.
- **Do not add a dependency.** Not a linter, not a bundler, not a test runner.
- **Do not widen a permission,** change a kill switch's default, or move a gate. Those live in code
  on purpose and are not a docs improvement.
- **Cite the feature ID** (`KRN-01`, `PIP-04`, …) that the code you touch is reproducing. If the
  code you are changing has no ID, that is itself worth reporting.

## Report

Emit exactly this block, last, once:

```
<<<SANDCASTLE
goal=<the goal you were given>
outcome=<changed|none|too-large|suite-failed>
files=<comma-separated paths, relative to the worktree, or ->
ids=<comma-separated feature IDs the change reproduces, or ->
summary=<one line: what changed and why it is better>
verified=<the exact command you ran, and its result>
SANDCASTLE>>>
```
