import { assertEquals } from "jsr:@std/assert";
import { evaluateDelegationSignal } from "../../../src/hlvm/agent/delegation-heuristics.ts";

Deno.test("delegation heuristics: multi-file request -> fan-out", () => {
  const signal = evaluateDelegationSignal(
    "Refactor the authentication logic across src/auth.ts, src/login.ts, src/session.ts, " +
    "src/middleware.ts, and src/tokens.ts to use the new JWT library. Each file should " +
    "import from the new package and update its verification calls accordingly. " +
    "Make sure to update any related test files and ensure that the existing behavior " +
    "is preserved. Run the full test suite after completing the changes to confirm " +
    "nothing is broken by the migration to the new library.",
  );
  assertEquals(signal.shouldDelegate, true);
  assertEquals(signal.suggestedPattern, "fan-out");
  assertEquals(signal.estimatedSubtasks! >= 3, true);
});

Deno.test("delegation heuristics: parallel cue -> fan-out", () => {
  const signal = evaluateDelegationSignal(
    "Process each of these files in parallel: update the imports, fix the type errors, " +
    "and run the linter. Make sure auth.ts and login.ts are both updated concurrently " +
    "to avoid blocking the CI pipeline.",
  );
  assertEquals(signal.shouldDelegate, true);
  assertEquals(signal.suggestedPattern, "fan-out");
});

Deno.test("delegation heuristics: batch cue -> batch", () => {
  const signal = evaluateDelegationSignal(
    "Update the copyright header across all files in the src directory. Every module " +
    "should have the 2026 copyright notice at the top. Check each component and make " +
    "sure the header matches the template provided in CONTRIBUTING.md. This is important " +
    "for legal compliance and must be done before the next release. Please verify that " +
    "no files are missed and that the formatting is consistent throughout the project.",
  );
  assertEquals(signal.shouldDelegate, true);
  assertEquals(signal.suggestedPattern, "batch");
});

Deno.test("delegation heuristics: small task -> no delegation", () => {
  const signal = evaluateDelegationSignal("fix typo in README");
  assertEquals(signal.shouldDelegate, false);
  assertEquals(signal.suggestedPattern, "none");
});

Deno.test("delegation heuristics: short request with parallel cue -> fan-out", () => {
  const signal = evaluateDelegationSignal(
    "refactor auth.ts and login.ts concurrently",
  );
  assertEquals(signal.shouldDelegate, true);
  assertEquals(signal.suggestedPattern, "fan-out");
});

Deno.test("delegation heuristics: no strong signal -> no delegation", () => {
  const signal = evaluateDelegationSignal(
    "Please implement a new feature for the user profile page that allows users to " +
    "upload their avatar image and crop it before saving. The feature should include " +
    "validation for file size and format.",
  );
  assertEquals(signal.shouldDelegate, false);
  assertEquals(signal.suggestedPattern, "none");
});
