// J3 — the drift gate for the root README.md. Four claims, each derivable from the source and
// checked against it (TST-06/07). Every check works over BACKTICKED spans only — the README's
// narrative prose (why the watchdog is on the host, why never both at once) is never scanned; a
// gate that pins prose to prose pins nothing (J3's own "Not gated, on purpose" note).
//
// ASSERTION 2's HEURISTIC IS THE INTERESTING HALF. A naive "backticked token containing a slash"
// rule fires on three shapes that are NOT a path into this repo:
//   1. an absolute or home-relative path used as an ILLUSTRATION (`/tmp/x.db`, `~/.claude`) —
//      excluded by refusing anything starting with "/" or "~" (the plan's own risk note).
//   2. a multi-word shell command that happens to contain a slash (`set -a; . ./.env; set +a`) —
//      excluded by refusing anything containing whitespace. A real repo path is one token; a
//      command line is several.
//   3. a `KEY=value` example whose value looks like a path (`<NAME>_DB=/tmp/x.db`) — excluded by
//      refusing anything containing "=". The thing being documented there is the KNOB, not a path,
//      and knobs.test.ts assertion 9 is what checks it.
// What is left after all three exclusions is a single token, no "=", no whitespace, containing
// "/", not starting with "/" or "~" — that is what "looks like a repo path" means here, and it is
// the set this file resolves against ROOT and requires to exist on disk.
//
// A slash-only rule still misses a ROOT FILE, which has no slash: `.env.example` and `.nvmrc` are
// both load-bearing in README.md and both would go unchecked. `looksLikeBareRepoFile` below closes
// that half; its own doc comment carries the rule.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SCHEDULE, bootstrapEntries } from "../host/schedule.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const README_PATH = join(ROOT, "README.md");

function readme(): string {
  return readFileSync(README_PATH, "utf8");
}

/** Every backticked inline-code span's inner text, in order. */
function backtickSpans(text: string): string[] {
  const out: string[] = [];
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) out.push(m[1]!);
  return out;
}

test("1. every `npm run <x>` / `npm test` named in README.md is a real package.json script", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const scripts = new Set(Object.keys(pkg.scripts));

  const named = new Set<string>();
  for (const span of backtickSpans(readme())) {
    for (const m of span.matchAll(/\bnpm run (\S+)/g)) {
      named.add(m[1]!.replace(/[.,;:]+$/, ""));
    }
    if (/\bnpm test\b/.test(span)) named.add("test");
  }
  assert.ok(named.size > 0, "README.md names no npm command at all — nothing for this assertion to check");
  for (const name of named) {
    assert.ok(
      scripts.has(name),
      `README.md runs \`npm run ${name}\`, which is not a script in package.json (scripts: ${[...scripts].sort().join(", ")})`,
    );
  }
});

/** See the file header: a repo path is one whitespace-free, "="-free token containing "/" that
 *  does not start with "/" or "~". */
function looksLikeRepoPath(token: string): boolean {
  if (/\s/.test(token)) return false;
  if (token.includes("=")) return false;
  if (!token.includes("/")) return false;
  if (/^[/~]/.test(token)) return false;
  return true;
}

/**
 * The gap `looksLikeRepoPath` leaves: a root file named with NO slash. `.env.example` is the one
 * the reader is told to copy and `.nvmrc` is where the image's Node version comes from — a typo in
 * either is a real dead end, and a slash-only rule never looks at them.
 *
 * "Shaped like a filename" is: no whitespace, no "=", no ":" (which is what keeps compose's
 * `env_file:` out — a mapping key, not a file), no "/" or "~" (already the other rule's job), and
 * then either a leading dot (`.env`, `.nvmrc`) or a lowercase extension (`package.json`). A bare
 * word with no dot — `main`, `crontab`, `ops-watchdog`, `nightly-sandcastle` — is a branch, a
 * binary or an entry name, and is left alone.
 */
function looksLikeBareRepoFile(token: string): boolean {
  if (/\s/.test(token)) return false;
  if (/[=:/~]/.test(token)) return false;
  return /^\.[A-Za-z0-9]/.test(token) || /^[A-Za-z0-9][A-Za-z0-9._-]*\.[a-z]{2,6}$/.test(token);
}

/**
 * Paths this repo deliberately does not ship, read from the file that OWNS that fact.
 *
 * CI caught this and the local run could not: `.env` is the first thing README.md tells a reader
 * to make, and it is gitignored, so it exists on every developer's box and on none of the runners.
 * Requiring it turned "green here, red on the runner" into a real build break (run 33558575543).
 *
 * The fix reads `.gitignore` rather than hard-coding an exception, so the two can never disagree:
 * a token this repo ignores is not required to exist, and everything else still is. It stays tight
 * because git's own semantics are tight — the `.env` line does NOT match `.env.example`, so the
 * file the reader actually copies is still checked, and a typo like `.nvmcr` or `.env.exampl`
 * matches no ignore rule and still fails.
 */
function gitIgnored(): ReadonlySet<string> {
  const lines = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n");
  const out = new Set<string>();
  for (const line of lines) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    out.add(t.replace(/\/$/, ""));
  }
  return out;
}

test("2. every backticked repo path or root file in README.md exists on disk, unless .gitignore says it should not", () => {
  const ignored = gitIgnored();
  const named = backtickSpans(readme()).filter((t) => looksLikeRepoPath(t) || looksLikeBareRepoFile(t));
  assert.ok(named.length > 0, "README.md names no repo path at all — nothing for this assertion to check");

  const checked = named.filter((t) => !ignored.has(t));
  assert.ok(
    checked.length > 0,
    "every path README.md names is gitignored — this assertion would pass over an empty set, which checks nothing",
  );
  for (const p of checked) {
    assert.ok(existsSync(join(ROOT, p)), `README.md names \`${p}\`, which does not exist on disk`);
  }
});

test("3. the Node version names no literal number; .nvmrc is named instead", () => {
  const text = readme();
  const nvmrc = readFileSync(join(ROOT, ".nvmrc"), "utf8").trim();
  assert.ok(!text.includes(nvmrc), `README.md must not hardcode the .nvmrc version "${nvmrc}"`);
  assert.ok(!/\bnode(?:\.js)?\s*v?\d/i.test(text), "README.md must not name a literal Node version");
  assert.ok(text.includes(".nvmrc"), "README.md must name .nvmrc as the source of the Node version");
});

test("4. the watchdog crontab entry named in README.md is the real bootstrap entry: in SCHEDULE, supervised === false, with a script", () => {
  const entries = bootstrapEntries(SCHEDULE);
  assert.equal(
    entries.length,
    1,
    `expected exactly one supervised: false entry in host/schedule.ts's SCHEDULE, found ${entries.length}`,
  );
  const entry = entries[0]!;
  assert.equal(entry.supervised, false, `entry "${entry.name}" is not supervised: false`);
  assert.ok(entry.script !== undefined, `entry "${entry.name}" has supervised: false but no script`);

  assert.ok(
    backtickSpans(readme()).includes(entry.name),
    `README.md must name the real watchdog entry \`${entry.name}\` in backticks`,
  );
});
