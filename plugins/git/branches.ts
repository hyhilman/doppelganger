// JOB-G13 — the branch names an unattended pass may never commit on, and the checks that read
// them.
//
// One list, read by both the prompt and the parser. A safety list stated in N prompts is N
// copies, and copies drift. So the set the prompt names and the set the parser refuses must be
// this one object.
//
// This DETECTS a violation; it cannot PREVENT one. A caller reads what a worker reports after the
// push already happened. What the check buys: a bad push is never settled and never reported as
// done.

export const PROTECTED_BRANCHES = ["main", "master", "development", "staging", "dev"] as const;

const PROTECTED = new Set<string>(PROTECTED_BRANCHES);

/** False for a protected branch AND for a blank name. An unnamed branch never gets through. */
export function branchAllowed(branch: string): boolean {
  const b = branch.trim();
  return b !== "" && !PROTECTED.has(b);
}

/** The set as prompt prose ("`main`, `master`, …"), so a worker is told exactly the names the
 *  parser will refuse. */
export function protectedList(): string {
  return PROTECTED_BRANCHES.map((b) => `\`${b}\``).join(", ");
}

/** Every reported branch that is protected. Blank entries are dropped, not refused: "reported no
 *  branch" and "reported a protected branch" are different facts, and only the second is a
 *  violation. */
export function protectedHits(branches: readonly string[]): string[] {
  return branches.map((b) => b.trim()).filter((b) => b !== "" && PROTECTED.has(b));
}
