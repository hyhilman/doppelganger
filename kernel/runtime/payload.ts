// J3.4 (HRN-10) — the sentinel payload parser: last `<<<TAG … TAG>>>` block wins (agents echo the
// template first, so the first block is the instruction, not the answer), and a malformed payload
// writes nothing. Neither function here knows any vocabulary — the vocabulary (what `outcome=`
// means, what values it may hold) is the job's own (SKL-07), read by host/jobs/nightly-sandcastle.ts
// (J3.8)'s `parseVerdict`, never by this file.

/**
 * Extracts the LAST closed `<<<TAG … TAG>>>` block from `stdout`, trimmed. `\r\n` (and a lone `\r`)
 * are normalised to `\n` first, so a Windows-shaped agent transcript reads the same as a Unix one.
 * `null` when no closed block exists — an unclosed block and no block at all are the same verdict
 * to a caller: nothing to parse.
 *
 * The CLOSING delimiter requires the exact escaped `tag` text immediately before `>>>`, which is
 * what keeps a shorter tag that is a PREFIX of a longer one in the text from cross-matching:
 * scanning for `SAND` over a real `<<<SANDCASTLE … SANDCASTLE>>>` block, the opening `<<<SAND`
 * substring is found, but the text ahead never contains the literal `SAND>>>` (only `...CASTLE>>>`),
 * so the closing half never matches and the whole attempt fails — no lookahead needed on the
 * opening side, and none is used, so the closing pattern is load-bearing on its own.
 */
export function extractBlock(stdout: string, tag: string): string | null {
  const normalised = stdout.replace(/\r\n?/g, "\n");
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<<<${escaped}([\\s\\S]*?)${escaped}>>>`, "g");

  let last: string | null = null;
  for (let m = re.exec(normalised); m !== null; m = re.exec(normalised)) {
    last = m[1] ?? "";
  }
  return last === null ? null : last.trim();
}

/**
 * `key=value` lines, one per line, split at the FIRST `=` so a value containing `=` survives whole
 * (`verified=npm test / 375 pass` keeps its `/` and spaces). A line with no `=`, or an empty key
 * (`=value`), is skipped rather than throwing — HRN-10's "malformed payload writes nothing" reaches
 * down to the single line: an unparsable line is simply absent from the result, never a partial or
 * a thrown error. Unknown keys are carried through unchanged; this function has no vocabulary of its
 * own to check them against.
 *
 * Takes the BLOCK (already extracted), not raw stdout — a deliberate split from the reference, whose
 * own `extractFields` scans stdout for a one-line `TAG k=v` shape. This repo's skill emits a
 * multi-line block, so the two functions compose instead: `extractFields(extractBlock(out, tag) ?? "")`.
 */
export function extractFields(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue; // no '=' (eq === -1) or an empty key (eq === 0) — both skipped
    const key = line.slice(0, eq).trim();
    if (key.length === 0) continue;
    out[key] = line.slice(eq + 1);
  }
  return out;
}
