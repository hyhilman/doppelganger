---
name: ops-hello
description: Read-only smoke test of the agent path (JOB-O01). Run by the ops-hello job, and by a human at /ops-hello to check that an agent run works.
---
<!-- managed:doppelganger-skills v=1 src=plugins/ops/skills/ops-hello -->
<!-- rendered by `skills render` — do not edit; edit the source and re-render (SKL-04) -->

# ops-hello

A smoke test. It only proves that an agent run starts and finishes.

1. Print exactly this one line, and nothing else:

   ```
   ops-hello: host agent run OK
   ```

2. Do not create, edit or delete any file. Do not run any command.
3. Stop.
