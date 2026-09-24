// barrel for logging: the one surface a package consumer will take as `log` (ADO-03). Code in this
// repo never imports it — it names the file it needs by path (TST-04, test/barrels.test.ts).
//
// Five files, split by role rather than by topic:
//
//   emit.ts   the writer — logger(job) -> .debug/.info/.warn/.error. Paired with the root log.sh,
//             which is the bash half of the same line shape and MUST stay identical.
//   parse.ts  the reader's parser — parseLine returns null for anything not ours, so agent stdout
//             and node warnings are skipped rather than reported as malformed.
//   route.ts  the routing rule — which level goes where, as a pure function of the level alone.
//   cause.ts  the bridge — distils a dead child's stderr, which parse.ts skips by design, into the
//             one line job-failed carries.
//   tail.ts   incremental read across both log roots, (inode, offset) cursors, and rotation.
//
// Importing this barrel loads node:sqlite (through tail.ts -> db.ts); import ./emit.ts directly if
// all you do is log. emit.ts must never import this barrel or db.ts.
export * from "./cause.ts";
export * from "./emit.ts";
export * from "./parse.ts";
export * from "./route.ts";
export * from "./tail.ts";
