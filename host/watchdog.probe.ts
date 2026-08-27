// the ONLY file in this repo that exists to be run by bash: host/watchdog.sh's
// probe 2 runs `node host/watchdog.probe.ts` and checks the exit code. A type annotation with no
// runtime meaning is what proves `node` actually stripped types rather than merely existing —
// a dangling symlink is present, looks executable, and does not run.
const stripped: number = 0;
process.exit(stripped);
