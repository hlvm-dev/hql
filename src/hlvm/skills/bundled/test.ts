/**
 * Bundled Skill: test
 *
 * Finds and runs project tests, reports results.
 */

import type { SkillDefinition } from "../types.ts";

export const TEST_SKILL: SkillDefinition = {
  name: "test",
  source: "bundled",
  sourceKind: "bundled",
  frontmatter: {
    description: "Find and run project tests, report results",
    when_to_use:
      "When the user wants to run tests for the current project or a specific test file",
    allowed_tools: ["shell_exec", "read_file", "search_code"],
    user_invocable: true,
    model_invocable: true,
    manual_only: false,
    context: "inline",
    diagnostics: [],
  },
  body: `Find and run the project's tests.

## Steps
1. Detect the project's test framework by inspecting package.json, deno.json, Makefile, or similar config files.
2. If $ARGUMENTS specifies a file or pattern, scope the test run to that target.
3. Run the appropriate test command.
4. Parse the output and report:
   - Total tests, passed, failed, skipped
   - For failures: file, test name, and error summary
5. If all tests pass, confirm success. If tests fail, summarize the failures clearly.

$ARGUMENTS`,
};
