import { assertEquals } from "jsr:@std/assert";
import { evaluateDelegationSignal } from "../../../src/hlvm/agent/delegation-heuristics.ts";

Deno.test("delegation heuristics: multi-file request -> fan-out", async () => {
  const signal = await evaluateDelegationSignal(
    "Refactor the authentication logic across src/auth.ts, src/login.ts, src/session.ts, " +
      "src/middleware.ts, and src/tokens.ts to use the new JWT library. Each file should " +
      "import from the new package and update its verification calls accordingly. " +
      "Make sure to update any related test files and ensure that the existing behavior " +
      "is preserved. Run the full test suite after completing the changes to confirm " +
      "nothing is broken by the migration to the new library.",
  );
  assertEquals(signal.shouldDelegate, true);
  assertEquals(signal.suggestedPattern, "fan-out");
  assertEquals(signal.taskDomain, "general");
  assertEquals(signal.estimatedSubtasks! >= 3, true);
});

Deno.test("delegation heuristics: parallel cue -> fan-out", async () => {
  const signal = await evaluateDelegationSignal(
    "Process each of these files in parallel: update the imports, fix the type errors, " +
      "and run the linter. Make sure auth.ts and login.ts are both updated concurrently " +
      "to avoid blocking the CI pipeline.",
  );
  assertEquals(signal.shouldDelegate, true);
  assertEquals(signal.suggestedPattern, "fan-out");
  assertEquals(signal.taskDomain, "general");
});

Deno.test("delegation heuristics: batch cue -> delegation", async () => {
  const signal = await evaluateDelegationSignal(
    "Update the copyright header across all files in the src directory. Every module " +
      "should have the 2026 copyright notice at the top. Check each component and make " +
      "sure the header matches the template provided in CONTRIBUTING.md. This is important " +
      "for legal compliance and must be done before the next release. Please verify that " +
      "no files are missed and that the formatting is consistent throughout the project.",
  );
  assertEquals(signal.shouldDelegate, true);
  // Local LLM may classify as "batch" or "fan-out" — both are valid delegation patterns
  assertEquals(signal.suggestedPattern !== "none", true);
  assertEquals(signal.taskDomain, "general");
});

Deno.test("delegation heuristics: small task -> no delegation", async () => {
  const signal = await evaluateDelegationSignal("fix typo in README");
  assertEquals(signal.shouldDelegate, false);
  assertEquals(signal.suggestedPattern, "none");
  assertEquals(signal.taskDomain, "general");
});

Deno.test("delegation heuristics: short request with parallel cue -> fan-out", async () => {
  const signal = await evaluateDelegationSignal(
    "refactor auth.ts and login.ts concurrently",
  );
  assertEquals(signal.shouldDelegate, true);
  assertEquals(signal.suggestedPattern, "fan-out");
  assertEquals(signal.taskDomain, "general");
});

Deno.test("delegation heuristics: no strong signal -> no delegation", async () => {
  const signal = await evaluateDelegationSignal(
    "fix the typo in the error message on line 42 of utils.ts",
  );
  assertEquals(signal.shouldDelegate, false);
  assertEquals(signal.suggestedPattern, "none");
  assertEquals(signal.taskDomain, "general");
});

Deno.test("delegation heuristics: browser interaction task -> no delegation", async () => {
  const signal = await evaluateDelegationSignal(
    "Go to https://github.com/denoland/deno, open the Issues tab, and tell me the issue count.",
  );
  assertEquals(signal.shouldDelegate, false);
  assertEquals(signal.suggestedPattern, "none");
  assertEquals(signal.taskDomain, "browser");
});

Deno.test("delegation heuristics: pw-guided download task -> no delegation", async () => {
  const signal = await evaluateDelegationSignal(
    "Download the latest stable Python macOS installer. Use pw_* first and save it to ~/Downloads.",
  );
  assertEquals(signal.shouldDelegate, false);
  assertEquals(signal.suggestedPattern, "none");
  assertEquals(signal.taskDomain, "browser");
});
