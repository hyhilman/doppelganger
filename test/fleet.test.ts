// J2 — the drift gate for fleet/. Three files (Dockerfile, compose.yml, fleet.sh) keep the
// standalone container's supervisor loop alive; this file is what stops them from silently
// drifting apart from the code they run and from each other.
//
// THIS IS A LINE SCAN, NEVER A YAML PARSER, AND NEVER A `docker compose config` CALL (ruling 4).
// CI has no docker, and `npm test` must stay hermetic — a job that needs a daemon cannot be part
// of the suite everyone runs on every commit. The cost of that choice is real and stated rather
// than hidden: a line scan parses compose.yml the way a careful reader does, not the way the
// daemon does, so this gate CAN be green on a file docker itself would reject (a duplicate key,
// a tab where YAML wants a space, anything the indentation-based helpers below don't model).
// The compensation is AC4's real `fleet/fleet.sh build && up && status && down` — host-only,
// needs docker, not part of `npm test`, and recorded in the commit body instead.
//
// TWO PARSING TRAPS, BOTH MEASURED AGAINST THE REAL FILE, BOTH HANDLED BELOW (ruling 5):
//
// Trap 1 — a bind mount's `${HOST_ROOT:?}:${HOST_ROOT:?}` cannot be split on ":" as-is: the
// `:?` inside each `${...}` reference is itself a colon. A naive `line.split(":")` yields four
// fields, and a naive "pick the var-name prefixes" comparison (`parts[0]` vs `parts[2]`) reports
// them equal ("${HOST_ROOT" === "${HOST_ROOT") NO MATTER what the rest of the destination says —
// so it stays green even when the destination is mutated to `${HOST_ROOT:?}/workspace`, a mount
// that no longer satisfies DKR-06's "same absolute path". Measured directly (see the commit body
// for the exact transcript): the naive parts[0]-vs-parts[2] check reports `eq: true` on BOTH the
// real file and that mutation. `normalizeVarRefs` collapses `${NAME:?msg}` and `${NAME:-default}`
// to `${NAME}` FIRST, so there is no surviving ":" except the real src/dst separator, and only
// then is the line split.
//
// Trap 2 — compose.yml's own header comment contains the literal text `${VAR:?}` as prose
// ("EVERY `${VAR:?}` BELOW IS DELIBERATE"). Harvesting `${...:?...}` references from the whole
// file therefore yields a phantom seventh required variable, "VAR", that no code anywhere
// exports. Measured directly against the real file: harvesting without stripping comments
// produces {HOST_GID, HOST_HOME, HOST_ROOT, HOST_UID, HOST_USER, NODE_VERSION, VAR} — seven
// entries — which does NOT equal fleet.sh's six-name export set, so the comparison fails on the
// UNMUTATED file. `stripComments` removes every line whose first non-space character is "#"
// before any harvesting happens.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const FLEET_DIR = join(ROOT, "fleet");

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}
const dockerfile = (): string => read("fleet/Dockerfile");
const compose = (): string => read("fleet/compose.yml");
const fleetSh = (): string => read("fleet/fleet.sh");

// ---------------------------------------------------------------------------------------------
// shared line-scan helpers
// ---------------------------------------------------------------------------------------------

/** Lines whose first non-space character is "#" are comments. Strip them before harvesting
 *  anything out of compose.yml (ruling 5, trap 2). */
function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

/** `${NAME:?msg}` and `${NAME:-default}` both carry a colon INSIDE the reference. Collapse both
 *  forms (and the bare `${NAME}` form) to `${NAME}` before any ":"-based splitting (ruling 5,
 *  trap 1) — otherwise a bind mount's own `:?` looks like the src:dst separator. */
function normalizeVarRefs(text: string): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:[?-][^}]*)?\}/g, "${$1}");
}

/** Every `${NAME:?...}` (required, no default) reference, from non-comment lines only. */
function harvestRequiredVars(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of stripComments(text).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*):\?/g)) out.add(m[1]);
  return out;
}

function setEquals(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/** The scalar value of the first `key: value` line found at any indentation. */
function scalarValue(text: string, key: string): string | undefined {
  const m = text.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, "m"));
  return m?.[1];
}

/** The `- item` children of a `key:` block, one indentation level down. Comments among them
 *  (indented at the same level, but not starting with "-") are skipped by construction. */
function listSection(text: string, key: string): string[] {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => new RegExp(`^\\s*${key}:\\s*$`).test(l));
  if (idx === -1) return [];
  const keyIndent = lines[idx].match(/^(\s*)/)![1].length;
  const items: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.match(/^(\s*)/)![1].length;
    if (indent <= keyIndent) break;
    const m = line.match(/^\s*-\s*(.+)$/);
    if (m) items.push(m[1].trim());
  }
  return items;
}

/** The mapping keys directly one level under a `key:` block (e.g. service names under
 *  `services:`), skipping blank lines, comments and any grandchild lines at a deeper indent. */
function mappingKeys(text: string, key: string): string[] {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => new RegExp(`^\\s*${key}:\\s*$`).test(l));
  if (idx === -1) return [];
  const keyIndent = lines[idx].match(/^(\s*)/)![1].length;
  const out: string[] = [];
  let childIndent: number | null = null;
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const indent = line.match(/^(\s*)/)![1].length;
    if (indent <= keyIndent) break;
    if (childIndent === null) childIndent = indent;
    if (indent !== childIndent) continue;
    const m = line.trim().match(/^([A-Za-z0-9_-]+):/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** compose's `command:` value, parsed as the JSON array literal it is written as. */
function commandArray(): string[] {
  const raw = scalarValue(compose(), "command");
  assert.ok(raw, "compose.yml must set command:");
  return JSON.parse(raw);
}

/** The repo-relative path compose's `command` names, resolved and checked to exist. */
function commandFilePath(): string {
  const arr = commandArray();
  assert.equal(arr[0], "node", `command must start with "node", got ${JSON.stringify(arr)}`);
  const rel = arr[1];
  assert.ok(rel, `command must name a script path, got ${JSON.stringify(arr)}`);
  assert.ok(existsSync(join(ROOT, rel)), `command names "${rel}", which does not exist on disk`);
  return rel;
}

/** "45s" / "500ms" -> milliseconds. compose's own default duration unit is seconds. */
function parseDurationMs(raw: string): number {
  const m = raw.match(/^(\d+)(ms|s|m|h)?$/);
  assert.ok(m, `cannot parse duration "${raw}"`);
  const n = Number(m[1]);
  const unit = m[2] ?? "s";
  const mults: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  return n * mults[unit];
}

const DRAIN_MS_DECL_RE = /export const SUPERVISOR_DRAIN_MS_ENV[^=]*=\s*\{([^}]*)\}/;

/** The numeric `.default` of `SUPERVISOR_DRAIN_MS_ENV`, parsed out of the source that declares
 *  it — never hardcoded here, so a knob change on either side of the inequality is caught. */
function parseDrainMsDefault(source: string): number {
  const m = source.match(DRAIN_MS_DECL_RE);
  assert.ok(m, "expected `export const SUPERVISOR_DRAIN_MS_ENV = {...}` in the file compose's command names");
  const defMatch = m[1].match(/default:\s*"(\d+)"/);
  assert.ok(defMatch, "SUPERVISOR_DRAIN_MS_ENV must have a numeric string default");
  return Number(defMatch[1]);
}

/** The verb tokens listed in fleet.sh's usage() heredoc — the block between the first two blank
 *  lines INSIDE the heredoc, which excludes the trailing "npm run crontab ..." suggestions. */
function usageVerbs(text: string): Set<string> {
  const heredoc = text.match(/cat <<'EOF'\n([\s\S]*?)\nEOF/);
  assert.ok(heredoc, "fleet.sh's usage() must print a `cat <<'EOF' ... EOF` heredoc");
  const lines = heredoc[1].split("\n");
  const first = lines.findIndex((l) => l.trim() === "");
  const second = lines.findIndex((l, i) => i > first && l.trim() === "");
  const out = new Set<string>();
  for (const line of lines.slice(first + 1, second)) {
    if (line.trim() === "") continue;
    const cluster = line.trim().split(/\s{2,}/)[0];
    for (const tok of cluster.split("|")) {
      out.add(tok.trim().split(/\s+/)[0]);
    }
  }
  return out;
}

/** The verbs fleet.sh's `case "$cmd" in ... esac` actually dispatches, excluding the help arm
 *  and the wildcard (neither is a "verb"). */
function caseArmVerbs(text: string): Set<string> {
  const block = text.match(/case\s+"\$cmd"\s+in([\s\S]*?)\nesac/);
  assert.ok(block, 'fleet.sh must have a `case "$cmd" in ... esac` dispatcher');
  const out = new Set<string>();
  for (const m of block[1].matchAll(/^\s*([A-Za-z0-9_|-]+)\)\s*$/gm)) {
    for (const tok of m[1].split("|")) {
      if (tok === "-h" || tok === "--help" || tok === "help") continue;
      out.add(tok);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// the twelve assertions
// ---------------------------------------------------------------------------------------------

test("1. fleet/ holds exactly Dockerfile, compose.yml, fleet.sh", () => {
  const entries = readdirSync(FLEET_DIR).sort();
  assert.deepEqual(entries, ["Dockerfile", "compose.yml", "fleet.sh"]);
});

test("2. stop_grace_period strictly exceeds SUPERVISOR_DRAIN_MS_ENV.default", () => {
  const graceRaw = scalarValue(compose(), "stop_grace_period");
  assert.ok(graceRaw, "compose.yml must set stop_grace_period");
  const graceMs = parseDurationMs(graceRaw);
  const source = readFileSync(join(ROOT, commandFilePath()), "utf8");
  const drainDefault = parseDrainMsDefault(source);
  assert.ok(
    graceMs > drainDefault,
    `stop_grace_period (${graceMs}ms) must strictly exceed SUPERVISOR_DRAIN_MS_ENV.default ` +
      `(${drainDefault}ms) — otherwise the daemon can SIGKILL a still-draining supervisor`,
  );
});

test("3. command names the file that declares SUPERVISOR_DRAIN_MS_ENV", () => {
  const rel = commandFilePath();
  const source = readFileSync(join(ROOT, rel), "utf8");
  assert.match(source, DRAIN_MS_DECL_RE, `command names "${rel}", which must declare SUPERVISOR_DRAIN_MS_ENV`);
});

test("4. the Node version comes from .nvmrc, nowhere hardcoded (DKR-02)", () => {
  const nvmrc = readFileSync(join(ROOT, ".nvmrc"), "utf8").trim();
  const files: Record<string, string> = { Dockerfile: dockerfile(), "compose.yml": compose(), "fleet.sh": fleetSh() };
  for (const [name, text] of Object.entries(files)) {
    assert.ok(!text.includes(nvmrc), `${name} must not hardcode the .nvmrc version "${nvmrc}"`);
    assert.ok(!/node:\s*\d/.test(text), `${name} must not name a literal node:<version> image`);
    assert.ok(!/NODE_VERSION(=|:-)\s*['"]?\d/.test(text), `${name} must not give NODE_VERSION a numeric default`);
  }

  const fnMatch = fleetSh().match(/resolve_host\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(fnMatch, "fleet.sh must define resolve_host()");
  const body = fnMatch[1];
  assert.match(body, /\.nvmrc/, "resolve_host() must read .nvmrc");
  assert.match(body, /NODE_VERSION=/, "resolve_host() must assign NODE_VERSION");
  assert.match(body, /export\b[^\n]*\bNODE_VERSION\b/, "resolve_host() must export NODE_VERSION");

  const df = dockerfile();
  const argIdx = df.search(/^ARG\s+NODE_VERSION\s*$/m);
  const fromIdx = df.search(/^FROM\s+node:\$\{NODE_VERSION\}/m);
  assert.ok(argIdx !== -1, "Dockerfile must declare `ARG NODE_VERSION` with no default, before FROM");
  assert.ok(fromIdx !== -1, "Dockerfile's FROM must name node:${NODE_VERSION}");
  assert.ok(argIdx < fromIdx, "ARG NODE_VERSION must come before FROM");
});

test("5. every volumes: entry has src === dst after ${NAME:?}/${NAME:-} normalisation (DKR-06)", () => {
  const items = listSection(compose(), "volumes");
  assert.ok(items.length >= 3, `expected at least 3 volume mounts, found ${items.length}`);
  for (const raw of items) {
    const parts = normalizeVarRefs(raw).split(":");
    assert.equal(parts.length, 2, `volume entry "${raw}" must be exactly src:dst after normalisation, got ${parts.length} field(s)`);
    assert.equal(parts[0], parts[1], `volume entry "${raw}" must mount at the SAME absolute path (DKR-06): src="${parts[0]}" dst="${parts[1]}"`);
  }
});

test("6. compose's :? required set (non-comment lines) equals fleet.sh's export set", () => {
  const required = harvestRequiredVars(compose());
  const exportLine = fleetSh().match(/^\s*export\s+([A-Za-z0-9_ \t]+)\s*$/m);
  assert.ok(exportLine, "fleet.sh must have an `export NAME NAME ...` line");
  const exported = new Set(exportLine[1].trim().split(/\s+/));
  assert.ok(
    setEquals(required, exported),
    `compose's required set {${[...required].sort()}} must equal fleet.sh's export set {${[...exported].sort()}}`,
  );
});

test("7. ARG HOST_USER/HOST_UID/HOST_GID/HOST_HOME carry no default (DKR-05)", () => {
  const df = dockerfile();
  for (const name of ["HOST_USER", "HOST_UID", "HOST_GID", "HOST_HOME"]) {
    assert.match(df, new RegExp(`^ARG ${name}$`, "m"), `Dockerfile's ARG ${name} must have no default — a guessed uid/path fails silently and late (DKR-05)`);
  }
});

test("8. the Dockerfile has no COPY/ADD, and the build context is the fleet directory (DKR-04)", () => {
  const df = dockerfile();
  assert.ok(!/^\s*(COPY|ADD)\b/m.test(df), "Dockerfile must not COPY or ADD anything — the checkout is bind-mounted, not baked in (DKR-04)");
  assert.equal(scalarValue(compose(), "context"), ".", "compose's build.context must be the fleet directory (`.`), not the repo root");
  assert.equal(scalarValue(compose(), "dockerfile"), "Dockerfile", "compose's build.dockerfile must be `Dockerfile`, relative to that context");
});

test("9. fleet.sh's dispatchable verbs equal its usage-heredoc verbs; add/serve/rm are in neither", () => {
  const dispatchable = caseArmVerbs(fleetSh());
  const documented = usageVerbs(fleetSh());
  assert.ok(
    setEquals(dispatchable, documented),
    `dispatchable {${[...dispatchable].sort()}} must equal documented {${[...documented].sort()}}`,
  );
  for (const workerVerb of ["add", "serve", "rm"]) {
    assert.ok(!dispatchable.has(workerVerb), `"${workerVerb}" is a WORKER verb (needs the queue, v1) and must not be dispatchable yet`);
    assert.ok(!documented.has(workerVerb), `"${workerVerb}" is a WORKER verb (needs the queue, v1) and must not be documented yet`);
  }
});

test("10. compose defines exactly one service, standalone; no fleet file names watchdog (JOB-O10)", () => {
  const services = mappingKeys(compose(), "services");
  assert.deepEqual(services, ["standalone"], "compose must define exactly one service, \"standalone\"");
  // "watchdog" appears legitimately in PROSE — comments and fleet.sh's own usage() heredoc both
  // explain why JOB-O10 keeps it off the container. Strip both before checking that no file
  // names it as actual CODE: a service key, a dispatchable verb, an ARG/ENV/RUN line.
  const files: Record<string, string> = { Dockerfile: dockerfile(), "compose.yml": compose(), "fleet.sh": fleetSh() };
  for (const [name, text] of Object.entries(files)) {
    const code = stripComments(text.replace(/<<'EOF'\n[\s\S]*?\nEOF/g, "<<'EOF'\nEOF"));
    assert.ok(!/watchdog/i.test(code), `${name} must not name "watchdog" as code — it stays a HOST crontab entry, sharing nothing with what it probes (JOB-O10)`);
  }
});

test("11. env_file resolves to <ROOT>/.env; .env is gitignored; .env.example exists", () => {
  const items = listSection(compose(), "env_file");
  assert.equal(items.length, 1, `expected exactly one env_file entry, found ${items.length}`);
  const resolved = join(FLEET_DIR, items[0]); // compose resolves env_file relative to the compose file's own directory
  assert.equal(resolved, join(ROOT, ".env"), `env_file "${items[0]}" must resolve to <ROOT>/.env, resolved to "${resolved}"`);
  const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
  assert.ok(gitignore.split("\n").some((l) => l.trim() === ".env"), ".gitignore must ignore .env");
  assert.ok(existsSync(join(ROOT, ".env.example")), ".env.example must exist as the template");
});

test("12. restart: unless-stopped and init: true", () => {
  assert.equal(
    scalarValue(compose(), "restart"),
    "unless-stopped",
    "compose's restart policy must be unless-stopped — `always` would restart a container stopped on purpose across a daemon restart",
  );
  assert.equal(scalarValue(compose(), "init"), "true", "compose must set init: true so the supervisor's spawned children get reaped (SUP-03)");
});
