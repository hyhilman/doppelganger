// J3.10 (HRN-11, HRN-14, TST-08) — every agent run names a pinned model, and a bypass run declares
// local. Ported in spirit from the reference's `model-declaration.test.ts` masker — 132 measured-
// correct lines whose failure mode is silent: a mis-read regex literal blanks the rest of a file
// and every call site in it stops existing, which reads as a pass. Test 2 (`lost === 0`) is the
// only guard against that, and the reference's own comment is carried here: NEVER spell `runJob(`
// or `defineJob(` inside a string literal in this repo.
//
// What this scan cannot see, stated once: a callee held in a variable and invoked indirectly
// (`const fn = defineJob; fn({...})`), and a model id built by string concatenation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PINNED, ALIASES, DEFAULTS } from "../kernel/ports/job.ts";
import { JOBS } from "../host/jobs/index.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SCANNED_DIRS = ["kernel", "host", "plugins", "cli"];

// P4 (plan/N4-uac.md) — measured 2026-08-26: kernel/runtime/quota.fixture.ts's tier-1 rows survive
// the model-literal scan (test 6) only because every recorded wording happens to contain an
// apostrophe ("You've") that ends the character class early — a coincidence one added row
// destroys ("claude-code exited with code 3: boom" matches outright). test/layout.test.ts's own
// realFiles() already excludes *.fixture.ts for exactly this reason (a fixture is not shipped
// behaviour); this walker now does too. Paid for below: no non-test file may import a
// *.fixture.ts, so a "claude-…" literal in a fixture can never reach production code.
function allNonTestTsFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".fixture.ts")) out.push(full);
    }
  };
  for (const d of SCANNED_DIRS) {
    const abs = join(ROOT, d);
    try {
      walk(abs);
    } catch {
      // directory does not exist, or has no .ts files yet — tolerated (plugins/ today)
    }
  }
  return out;
}

// -------------------------------------------------------------------------------------------
// The masker — blanks string and comment content, SAME LENGTH, so a scan built on the masked
// text can still index back into the ORIGINAL source at identical offsets. This is what makes
// `defineJob(`/`runJob(` spelled inside a string or a comment invisible to the call-site walk,
// without disturbing any position the walk reports.
// -------------------------------------------------------------------------------------------

function maskStringsAndComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      out += " ".repeat(j - i);
      i = j;
      continue;
    }
    if (c === "/" && c2 === "*") {
      let j = i + 2;
      while (j < n - 1 && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(j + 2, n);
      out += src
        .slice(i, j)
        .split("")
        .map((ch) => (ch === "\n" ? "\n" : " "))
        .join("");
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      out += src
        .slice(i, j)
        .split("")
        .map((ch) => (ch === "\n" ? "\n" : " "))
        .join("");
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every LOCAL name `defineJob`/`runJob` is bound to in `src`, via `import { ... } from "..."`,
 *  following `as` — the same alias-resolution shape test/writes.test.ts's door 6 uses (N2 F4). */
function localCalleeNames(src: string): string[] {
  const originals = ["defineJob", "runJob"];
  // The base names are always in scope for a text scan — a file need not import defineJob/runJob
  // to spell it (its own declaring module, kernel/ports/job.ts, never imports it either). Aliases
  // discovered below are ADDED, never substituted for the base names.
  const names = new Set<string>(originals);
  const importRe = /import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src)) != null) {
    for (const raw of m[1]!.split(",")) {
      const item = raw.trim();
      if (item.length === 0) continue;
      const parts = item.split(/\s+as\s+/).map((s) => s.trim());
      const original = parts[0]!;
      const local = (parts[1] ?? parts[0])!;
      if (originals.includes(original)) names.add(local);
    }
  }
  return [...names];
}

interface CallSite {
  readonly file: string;
  readonly keys: readonly string[];
  readonly modelValue: string | undefined; // the raw quoted literal, if `model:` is a string literal
}

/** Extracts the `{...}` argument starting at the `(` right after a call, balancing braces and
 *  skipping quoted content so a `}` inside a string never closes early. */
function extractObjectArg(src: string, openParenIdx: number): { body: string; end: number } | null {
  let i = openParenIdx + 1;
  while (i < src.length && /\s/.test(src[i]!)) i++;
  if (src[i] !== "{") return null;
  const braceStart = i;
  let depth = 1;
  i++;
  while (i < src.length && depth > 0) {
    const c = src[i]!;
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
    }
    i++;
  }
  return { body: src.slice(braceStart + 1, i - 1), end: i };
}

/** The object literal's TOP-LEVEL keys only — depth-tracked so a nested object's keys (e.g.
 *  `promptArgs: { WORKTREE: ... }`) are never mistaken for top-level ones. */
function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const c = body[i]!;
    if (c === "{" || c === "[" || c === "(") {
      depth++;
      i++;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      depth--;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < body.length && body[i] !== quote) {
        if (body[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (depth === 0) {
      const m = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(i));
      if (m) {
        keys.push(m[1]!);
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return keys;
}

/** The `model:` key's raw quoted value, at top level only, or `undefined`. */
function topLevelModelValue(body: string): string | undefined {
  const m = /(?:^|[,{])\s*model\s*:\s*(["'`])((?:\\.|(?!\1).)*)\1/.exec(body);
  return m ? m[2] : undefined;
}

/** `Job.local`'s raw boolean literal at top level, or `undefined` if not a literal `true`/`false`. */
function topLevelLocalValue(body: string): string | undefined {
  const m = /(?:^|[,{])\s*local\s*:\s*(true|false)\b/.exec(body);
  return m ? m[1] : undefined;
}

/** `Job.permissionMode`'s raw quoted value at top level, or `undefined`. */
function topLevelPermissionModeValue(body: string): string | undefined {
  const m = /(?:^|[,{])\s*permissionMode\s*:\s*(["'`])((?:\\.|(?!\1).)*)\1/.exec(body);
  return m ? m[2] : undefined;
}

interface Walked {
  readonly checked: number;
  readonly lost: Record<string, number>;
  readonly sites: readonly CallSite[];
}

function walk(): Walked {
  const files = allNonTestTsFiles();
  const sites: CallSite[] = [];
  const lost: Record<string, number> = {};
  let checked = 0;

  for (const f of files) {
    const rel = f.slice(ROOT.length + 1);
    const raw = readFileSync(f, "utf8");
    const masked = maskStringsAndComments(raw);
    const localNames = localCalleeNames(raw); // import aliasing is real code, not string/comment content
    if (localNames.length === 0) continue;

    const callRe = new RegExp(`\\b(${localNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*\\(`, "g");
    const maskedCallRe = new RegExp(callRe.source, "g");
    const rawCallRe = new RegExp(callRe.source, "g");

    const maskedCount = (masked.match(maskedCallRe) ?? []).length;
    const rawCount = (raw.match(rawCallRe) ?? []).length;
    if (rawCount !== maskedCount) lost[rel] = rawCount - maskedCount;

    let m: RegExpExecArray | null;
    maskedCallRe.lastIndex = 0;
    while ((m = maskedCallRe.exec(masked)) != null) {
      const openParenIdx = m.index + m[0].length - 1;
      const extracted = extractObjectArg(raw, openParenIdx); // indices agree: masking preserves length
      if (!extracted) continue;
      checked++;
      const keys = topLevelKeys(extracted.body);
      sites.push({ file: rel, keys, modelValue: topLevelModelValue(extracted.body) });
    }
  }
  return { checked, lost, sites };
}

test("1. every defineJob/runJob object literal names model unless the literal has exec — and the floor is derived from the registry (J3.16)", () => {
  const { checked, sites } = walk();

  // J3.10 shipped this as `checked >= 1` — a floor loose enough to survive a registry that did
  // not exist yet. J3.16 (TST-09) makes the registry the source of truth for the exact count.
  //
  // CORRECTED at J4.12: every registered job's OWN `defineJob({...})` call is exactly one
  // scanned site, regardless of whether that job needs to NAME model — `walk()` counts a site
  // the moment it finds a well-formed object literal, before it ever looks at the literal's own
  // keys. The floor was originally written as `JOBS.filter((j) => j.exec === undefined ||
  // j.model !== undefined).length` on the (until now untested) assumption that an `exec` job
  // with no `model` would somehow not be scanned at all — true only by accident, because
  // nightly-sandcastle (J3.10's one exec job) also happens to set `model` for HRN-11 reasons
  // unrelated to being scanned. `ops-cron-check` (J4.12) is the first exec job that genuinely
  // carries no model, and it IS scanned (checked=2, the old floor stayed at 1) — proving the
  // filter answered "must this job name model", not "does this job's own site get counted".
  // The "must name model unless exec" rule is enforced separately, correctly, by `offenders`
  // below, which already exempts a literal naming `exec`.
  //
  // `runJobLiteralSites` names the OTHER shape this file's scan can find: a `runJob(...)` call
  // in non-test source whose FIRST argument is an object literal (rather than a `Job` variable).
  // Every non-test `runJob(...)` call site today passes a variable first, so none is extracted —
  // 0 today, named so the day one appears this floor visibly moves instead of silently drifting
  // (AC6 proves the registry side of that with a fixture job).
  const runJobLiteralSites = 0;
  const floor = JOBS.length + runJobLiteralSites;
  assert.equal(checked, floor, `checked=${checked}, expected the registry-derived floor ${floor}`);

  const offenders = sites.filter((s) => !s.keys.includes("exec") && !s.keys.includes("model"));
  assert.deepEqual(
    offenders.map((s) => `${s.file}: keys=[${s.keys.join(",")}]`),
    [],
    "every job literal without exec must name model",
  );
});

test("2. the masker did not lose a call site — lost === 0 per file", () => {
  const { lost } = walk();
  const offenders = Object.entries(lost).map(([f, n]) => `${f}: masker lost ${n} call site(s)`);
  assert.deepEqual(offenders, []);
});

test("3. every model literal is PINNED, across every quote spelling — including DEFAULTS.model itself, the value every DEFAULTS.model reference resolves to", () => {
  const { sites } = walk();
  const offenders = sites.filter((s) => s.modelValue !== undefined && !PINNED.test(s.modelValue));
  assert.deepEqual(
    offenders.map((s) => `${s.file}: model=${JSON.stringify(s.modelValue)}`),
    [],
  );
  assert.ok(PINNED.test(DEFAULTS.model), `DEFAULTS.model itself must be PINNED, got ${JSON.stringify(DEFAULTS.model)}`);
  assert.ok(
    PINNED.test(DEFAULTS.shedModel),
    `DEFAULTS.shedModel itself must be PINNED (J4.9, ruling 8) — a downshift target held to a looser rule than model would defeat HRN-11, got ${JSON.stringify(DEFAULTS.shedModel)}`,
  );
});

test("4. no model literal is an ALIAS — including DEFAULTS.model itself", () => {
  const { sites } = walk();
  const offenders = sites.filter((s) => s.modelValue !== undefined && ALIASES.some((re) => re.test(s.modelValue!)));
  assert.deepEqual(
    offenders.map((s) => `${s.file}: model=${JSON.stringify(s.modelValue)} matches an alias pattern`),
    [],
  );
  assert.ok(
    !ALIASES.some((re) => re.test(DEFAULTS.model)),
    `DEFAULTS.model itself must not match an alias pattern, got ${JSON.stringify(DEFAULTS.model)}`,
  );
  assert.ok(
    !ALIASES.some((re) => re.test(DEFAULTS.shedModel)),
    `DEFAULTS.shedModel itself must not match an alias pattern (J4.9), got ${JSON.stringify(DEFAULTS.shedModel)}`,
  );
});

test("5. the predicate is exercised over a table — six accepted, six rejected", () => {
  const accepted = ["claude-opus-5", "claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5", "claude-fable-5", "claude-opus-4-5-20251101"];
  const rejected = ["claude-opus-latest", "opus", "sonnet", "claude", "claude-3-5-sonnet-latest", ""];
  for (const m of accepted) {
    assert.ok(PINNED.test(m) && !ALIASES.some((re) => re.test(m)), `expected ${JSON.stringify(m)} to be accepted`);
  }
  for (const m of rejected) {
    assert.ok(!PINNED.test(m) || ALIASES.some((re) => re.test(m)), `expected ${JSON.stringify(m)} to be rejected`);
  }
});

test("6. DEFAULTS.model is reachable from exactly one file", () => {
  const files = allNonTestTsFiles();
  // NO `/g` flag: `.test()` does not need one, and a `/g`-flagged RegExp object reused across
  // `.filter()`'s calls carries `lastIndex` from one file's search into the next. A match found
  // near the end of an early, long file advances `lastIndex` past the length of a later, SHORTER
  // file, and `.test()` on a string shorter than `lastIndex` returns false without ever looking —
  // a real claude-… literal in that later file would then read as absent. Latent, since this
  // repo's one real literal (kernel/ports/job.ts) happens to be found before any file short
  // enough to trip it, but the fix costs nothing and removes the hazard outright.
  const modelLiteralRe = /(["'`])claude-[^"'`]*\1/;
  const withLiteral = files
    .filter((f) => modelLiteralRe.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length + 1))
    .sort();
  assert.deepEqual(withLiteral, ["kernel/ports/job.ts"]);
  assert.equal(DEFAULTS.model, "claude-opus-5");
});

test("7. HRN-14's companion scan — a bypass run declares local: true", () => {
  // Re-walk with the permissionMode/local values this test needs — `walk()` above only extracts
  // `model`, kept narrow for tests 1-6. This test rebuilds call sites the same way rather than
  // widening CallSite for a scan only this one test needs.
  const files = allNonTestTsFiles();
  const bad: string[] = [];
  for (const f of files) {
    const rel = f.slice(ROOT.length + 1);
    const raw = readFileSync(f, "utf8");
    const masked = maskStringsAndComments(raw);
    const localNames = localCalleeNames(raw);
    if (localNames.length === 0) continue;
    const callRe = new RegExp(`\\b(${localNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(masked)) != null) {
      const openParenIdx = m.index + m[0].length - 1;
      const extracted = extractObjectArg(raw, openParenIdx);
      if (!extracted) continue;
      const pmValue = topLevelPermissionModeValue(extracted.body);
      // "resolves to bypassPermissions" — spelled as the literal, or as DEFAULTS.permissionMode,
      // since J3.2 made that the default value. permissionMode is REQUIRED on Job, so a real
      // literal always sets it one way or the other — there is no third, absent case to handle.
      const resolvesToBypass =
        pmValue === "bypassPermissions" ||
        (/permissionMode\s*:\s*DEFAULTS\.permissionMode\b/.test(extracted.body) && DEFAULTS.permissionMode === "bypassPermissions");
      if (!resolvesToBypass) continue;
      const localValue = topLevelLocalValue(extracted.body);
      if (localValue !== "true") bad.push(rel);
    }
  }
  assert.deepEqual(bad, [], "a job literal whose permissionMode resolves to bypassPermissions must also carry local: true (HRN-14)");
});

test("8. P4 — no non-test file imports a *.fixture.ts, which is what test 6's exclusion is paid for with", () => {
  const files = allNonTestTsFiles(); // already excludes *.fixture.ts and *.test.ts
  // Every spelling, per LOOP.md's standing rule ("a gate that pattern-matches ONE spelling of an
  // import is not a gate") — the test/no-raw-sqlite.test.ts precedent, one file over: a static
  // `from "…fixture.ts"`, a `require("…fixture.ts")`, and a dynamic `import("…fixture.ts")` all
  // make the fixture's literal reachable from production code, and the OLD regex here only ever
  // covered the first.
  const importRe =
    /from\s*["']([^"']*\.fixture\.ts)["']|require\(\s*["']([^"']*\.fixture\.ts)["']\s*\)|import\(\s*["']([^"']*\.fixture\.ts)["']\s*\)/;
  const offenders = files
    .filter((f) => importRe.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length + 1));
  assert.deepEqual(offenders, [], "a claude-… literal in a fixture must never be importable by production code");
});
