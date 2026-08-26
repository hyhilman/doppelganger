// J0.5 (§1, ADO-14) — the §1 layout gate.
//
// This is the drift gate for the repo's own shape: what must exist, what the
// workspaces list must mean in both directions, what must NOT exist, and the half
// of tsconfig.json that describes the layout rather than the toolchain.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { matchesGlob, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

function readJson(relPath: string): any {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf8"));
}

// tsconfig.json carries whole-line `//` comments (JSONC), which JSON.parse rejects.
// Strip only whole-line comments — no JSON5 dependency (TST-22); this repo never
// puts a trailing comment after real content on the same line.
function readJsonc(relPath: string): any {
  const raw = readFileSync(join(ROOT, relPath), "utf8");
  const stripped = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  return JSON.parse(stripped);
}

// Walk the repo, skipping .git and node_modules, collecting every directory's
// POSIX-relative path (from the repo root) and whether it is empty.
function walkDirs(): { relPath: string; entries: string[] }[] {
  const out: { relPath: string; entries: string[] }[] = [];
  function walk(absDir: string, relDir: string) {
    const entries = readdirSync(absDir, { withFileTypes: true });
    out.push({ relPath: relDir, entries: entries.map((e) => e.name) });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (relDir === "" && (entry.name === ".git" || entry.name === "node_modules")) continue;
      const nextRel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      walk(join(absDir, entry.name), nextRel);
    }
  }
  walk(ROOT, "");
  return out;
}

function packageJsonDirs(dirs: { relPath: string; entries: string[] }[]): string[] {
  return dirs
    .filter((d) => d.relPath !== "" && d.entries.includes("package.json"))
    .map((d) => d.relPath);
}

test("1. kernel/, plugins/, plugins/nightly/, cli/, .claude/skills/, test/ are directories", () => {
  for (const dir of ["kernel", "plugins", "plugins/nightly", "cli", ".claude/skills", "test"]) {
    assert.ok(statSync(join(ROOT, dir)).isDirectory(), `${dir} must be a directory`);
  }
});

test("2. kernel/package.json, cli/package.json, plugins/nightly/package.json exist", () => {
  for (const p of ["kernel/package.json", "cli/package.json", "plugins/nightly/package.json"]) {
    assert.ok(statSync(join(ROOT, p)).isFile(), `${p} must be a real file`);
  }
});

test("3. every workspaces entry expands to at least one directory with a package.json (ADO-14)", () => {
  const pkg = readJson("package.json");
  const dirs = packageJsonDirs(walkDirs()).filter((d) => !d.startsWith("node_modules"));
  for (const entry of pkg.workspaces as string[]) {
    const matched = dirs.filter((d) => matchesGlob(d, entry));
    assert.ok(matched.length > 0, `workspaces entry "${entry}" (ADO-14) matches no directory with a package.json`);
  }
});

test("4. every package.json outside node_modules is claimed by exactly one workspaces entry, or is the root", () => {
  const pkg = readJson("package.json");
  const dirs = packageJsonDirs(walkDirs()).filter((d) => !d.startsWith("node_modules"));
  for (const dir of dirs) {
    const claims = (pkg.workspaces as string[]).filter((entry) => matchesGlob(dir, entry));
    assert.equal(
      claims.length,
      1,
      `${dir}/package.json is claimed by ${claims.length} workspaces entries (expected exactly 1): [${claims.join(", ")}]`,
    );
  }
});

test("5. every workspace package.json has version === root version and type === module (ADO-01)", () => {
  const pkg = readJson("package.json");
  const dirs = packageJsonDirs(walkDirs()).filter((d) => !d.startsWith("node_modules"));
  const memberDirs = dirs.filter((d) => (pkg.workspaces as string[]).some((entry) => matchesGlob(d, entry)));
  assert.ok(memberDirs.length > 0, "expected at least one workspace member");
  for (const dir of memberDirs) {
    const member = readJson(`${dir}/package.json`);
    assert.equal(member.version, pkg.version, `${dir}/package.json version must equal root version (ADO-01)`);
    assert.equal(member.type, "module", `${dir}/package.json must set "type": "module"`);
  }
});

test("6. host/package.json does not exist — host/ is deliberately not a workspace (ADO-14)", () => {
  assert.equal(existsSync(join(ROOT, "host/package.json")), false, "host/package.json must not exist (ADO-14)");
});

test("7. no packages/ directory at the repo root (ADO-14)", () => {
  assert.equal(existsSync(join(ROOT, "packages")), false, "no packages/ directory (ADO-14)");
});

test("8. no src/ directory at the repo root", () => {
  assert.equal(existsSync(join(ROOT, "src")), false, "no src/ directory at the repo root");
});

test("9. no empty directory outside .git/ and node_modules/, and no .gitkeep file anywhere", () => {
  const dirs = walkDirs().filter((d) => d.relPath !== "" && !d.relPath.startsWith("node_modules"));
  for (const d of dirs) {
    assert.notEqual(
      d.entries.length,
      0,
      `${d.relPath}/ is empty — a §1 directory must be absent or real, never a placeholder`,
    );
    assert.ok(!d.entries.includes(".gitkeep"), `${d.relPath}/.gitkeep must not exist`);
  }
});

test("10. tsconfig.json has noEmit === true and no exclude key", () => {
  const tsconfig = readJsonc("tsconfig.json");
  assert.equal(tsconfig.compilerOptions.noEmit, true, "tsconfig.compilerOptions.noEmit must be true");
  assert.equal("exclude" in tsconfig, false, "tsconfig must not have an exclude key (TST-21: tests stay typechecked)");
});

test("11. tsconfig.json include names kernel, plugins, host, cli and test", () => {
  const tsconfig = readJsonc("tsconfig.json");
  const include: string[] = tsconfig.include;
  for (const name of ["kernel", "plugins", "host", "cli", "test"]) {
    assert.ok(
      include.some((glob) => glob.startsWith(`${name}/`)),
      `tsconfig include must name ${name}`,
    );
  }
});

// J1.19 (INS-02, §1) / J2.2 (§1, ADO-14) — the §1 module map. Reads what J1.1 and J2.1 wrote
// earlier, so no commit both writes the map and asserts it.

interface MapEntry {
  path: string; // relative to <dir>/
  tags: string[];
}

const PHASE_TAGS = ["N1", "N2", "N3", "N4", "N5"] as const;

/**
 * Phase state derived from WORK.md, which owns it (J2.2, ADO-14) — so this rule need not be
 * hand-edited every phase.
 *
 * A phase is SHIPPED when it has at least one `- [ ]`/`- [x]` bullet and every bullet is ticked.
 * The first phase with an unticked bullet is CURRENT; everything after it is FUTURE (named by
 * neither set). A phase's bullet run stops at the next line starting with `#` at ANY level, so the
 * `# ✅ MVP READY` banner between N4 and N5 closes N4's run instead of being read as more of it,
 * and a `<details>` block's strike-through rows carry no checkbox so they are never counted.
 */
function shippedPhases(): { shipped: Set<string>; current: string | null } {
  const workMd = readFileSync(join(ROOT, "WORK.md"), "utf8");
  const PHASE_HEADING = /^##\s+(N\d+)\s+—/;
  const BULLET = /^- \[( |x)\]/;

  const phases: { name: string; ticked: number; total: number }[] = [];
  let cur: { name: string; ticked: number; total: number } | null = null;

  for (const line of workMd.split("\n")) {
    const heading = PHASE_HEADING.exec(line);
    if (heading) {
      if (cur) phases.push(cur);
      cur = { name: heading[1]!, ticked: 0, total: 0 };
      continue;
    }
    if (line.startsWith("#")) {
      if (cur) phases.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const bullet = BULLET.exec(line);
    if (bullet) {
      cur.total++;
      if (bullet[1] === "x") cur.ticked++;
    }
  }
  if (cur) phases.push(cur);

  const shipped = new Set<string>();
  let current: string | null = null;
  for (const p of phases) {
    if (current !== null) continue; // everything after the first CURRENT phase is FUTURE
    if (p.total > 0 && p.ticked === p.total) shipped.add(p.name);
    else current = p.name;
  }
  return { shipped, current };
}

/**
 * Whether a §1 row must exist, must be absent, or is exempt, given WORK.md's phase state:
 * - a row naming the CURRENT phase is exempt from both existence clauses (mid-phase it may or may
 *   not be there yet);
 * - a row naming a SHIPPED phase must exist;
 * - a row naming no phase at all (`v0`/`v1` alone) or only FUTURE phases must be absent.
 */
function classifyRow(
  tags: string[],
  shipped: ReadonlySet<string>,
  current: string | null,
): "must-exist" | "must-be-absent" | "exempt" {
  const phaseTags = tags.filter((t) => (PHASE_TAGS as readonly string[]).includes(t));
  if (current !== null && phaseTags.includes(current)) return "exempt";
  if (phaseTags.some((t) => shipped.has(t))) return "must-exist";
  return "must-be-absent";
}

const TAG_RE = /\b(N1|N2|N3|N4|N5|v0|v1)\b/g;

/** Parse §1's `<dir>/` block (from the fenced layout diagram) into one entry per named file, each
 *  carrying its milestone tag(s) (N1..N5, v0, v1 — a row can carry more than one, e.g. "v0 · N1").
 *  Directory-only lines (ports/, runtime/, contracts/, jobs/) update the current prefix and produce
 *  no entry of their own; a bare prose line (contracts/, jobs/) names no files at all. Generalised
 *  from J1.19's kernel-only parser (J2.2) so the same logic reads host/ and cli/ too — the anchor is
 *  the first line beginning `<dir>/`, and the block ends at the next line starting at indent 0. */
function parseBlock(dir: string): MapEntry[] {
  const roadmap = readFileSync(join(ROOT, "roadmap.md"), "utf8");
  const lines = roadmap.split("\n");
  const anchor = lines.findIndex((l) => l.startsWith(`${dir}/`));
  if (anchor === -1) return [];
  let end = lines.length;
  for (let i = anchor + 1; i < lines.length; i++) {
    if (lines[i]!.length > 0 && !/^\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  const block = lines.slice(anchor, end).join("\n");

  const entries: MapEntry[] = [];
  let currentDir = "";

  for (const line of block.split("\n").slice(1)) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const content = line.trim();

    if (indent === 2) {
      const dirOnly = /^([a-z]+)\/$/.exec(content);
      if (dirOnly) {
        currentDir = `${dirOnly[1]}/`;
        continue;
      }
      if (!/^\S+\.(?:ts|sh)\s/.test(content)) continue; // e.g. contracts/'s, jobs/'s bare prose line
      const [name] = content.split(/\s+/);
      const tags = [...content.matchAll(TAG_RE)].map((m) => m[1]!);
      entries.push({ path: name!, tags });
      continue;
    }

    if (indent === 4) {
      const tokens = content.split(/\s+/);
      let i = 0;
      let subPrefix = currentDir;
      if (tokens[0] === "log/") {
        subPrefix = `${currentDir}log/`;
        i = 1;
      }
      const files: string[] = [];
      while (i < tokens.length && /\.(?:ts|sh)$/.test(tokens[i]!)) {
        files.push(tokens[i]!);
        i++;
      }
      const tagText = tokens.slice(i).join(" ");
      const tags = [...tagText.matchAll(TAG_RE)].map((m) => m[1]!);
      for (const f of files) entries.push({ path: `${subPrefix}${f}`, tags });
    }
  }
  return entries;
}

/** Every real *.ts/*.sh file under `<dir>/`, excluding *.test.ts and fixtures (values.fixture.ts,
 *  and anything under a directory literally named fixtures/ — a fixture is not shipped behaviour).
 *  `[]` for a directory that does not exist yet — host/ has no .ts file at N2's first commits, and
 *  readdirSync on a missing path throws. */
function realFiles(dir: string): string[] {
  const top = join(ROOT, dir);
  if (!existsSync(top)) return [];
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    for (const entry of readdirSync(abs)) {
      if (entry === "fixtures") continue;
      const full = join(abs, entry);
      const nextRel = rel === "" ? entry : `${rel}/${entry}`;
      if (statSync(full).isDirectory()) {
        walk(full, nextRel);
      } else if (
        (entry.endsWith(".ts") || entry.endsWith(".sh")) &&
        !entry.endsWith(".test.ts") &&
        !entry.endsWith(".fixture.ts")
      ) {
        out.push(nextRel);
      }
    }
  };
  walk(top, "");
  return out;
}

test("12. every real kernel/, host/, cli/ file is named in §1, and every §1 row matches WORK.md's phase state", () => {
  const { shipped, current } = shippedPhases();

  for (const dir of ["kernel", "host", "cli"]) {
    const entries = parseBlock(dir);
    const named = new Set(entries.map((e) => e.path));
    const real = new Set(realFiles(dir));

    for (const path of real) {
      assert.ok(named.has(path), `${dir}/${path} exists on disk but is not named in §1's layout block`);
    }

    for (const entry of entries) {
      const cls = classifyRow(entry.tags, shipped, current);
      const exists = real.has(entry.path);
      const tagsStr = entry.tags.join(",");
      if (cls === "must-exist") {
        assert.ok(exists, `§1 names ${dir}/${entry.path} as ${tagsStr}, but it is absent from disk`);
      } else if (cls === "must-be-absent") {
        assert.ok(
          !exists,
          `§1 names ${dir}/${entry.path} as ${tagsStr} (not shipped, not current), but it exists on disk`,
        );
      }
      // "exempt": the CURRENT phase's row may or may not exist yet; clause 1 above still covers it
      // if it IS on disk.
    }
  }
});

// F4 — no TST- row said a test may not leave anything behind in the checkout, so `./leak.db`
// (J1.17 AC2's mutation residue) sat here unnoticed: it is gitignored, so `git status` stayed
// clean. Every real database this suite opens lives under mkdtempSync, outside the checkout
// (kernel/runtime/db-sharing.test.ts's own discipline gate, assertion 6, already proves that for
// every caller of the store's open function), and `.doppelganger/` (STATE_DIR's default) is
// excluded here because it is real, gitignored runtime state that no test in this suite writes —
// nothing today creates it.
test("13. no stray *.db*/*.db-wal/*.db-shm file anywhere in the checkout", () => {
  const dirs = walkDirs().filter(
    (d) => !d.relPath.startsWith("node_modules") && !d.relPath.startsWith(".doppelganger"),
  );
  const offenders: string[] = [];
  for (const d of dirs) {
    for (const entry of d.entries) {
      if (/\.db(-wal|-shm)?$/.test(entry)) {
        offenders.push(d.relPath === "" ? entry : `${d.relPath}/${entry}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `stray database file(s) in the checkout — a test (or a manual AC mutation) left residue behind: ${offenders.join(", ")}`,
  );
});
