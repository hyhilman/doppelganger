// Fixture for KRN-01: proves duplicate-throws happens AT IMPORT TIME, not on first call.
// Registers the same name twice at MODULE TOP LEVEL, so the throw fires while this module is
// still loading. kernel/registry.test.ts imports this module dynamically and asserts the import
// itself rejects (`await assert.rejects(import(...))`) — never calls a function directly, since
// that would only prove the throw happens on demand, not on import.
//
// `*.fixture.ts` is excluded from test/layout.test.ts's `realFiles()` (no §1 row needed) and from
// test/model.test.ts's walker (`allNonTestTsFiles`) — both confirmed by reading each function
// before this file was written, not assumed from the naming convention alone.
import { registry, type Named } from "./registry.ts";

interface FixtureItem extends Named {
  readonly name: string;
}

const fixtureRegistry = registry<FixtureItem>("fixture");
fixtureRegistry.register({ name: "dup" });
fixtureRegistry.register({ name: "dup" });
