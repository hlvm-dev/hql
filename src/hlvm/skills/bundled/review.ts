/**
 * Bundled Skill: review
 *
 * Reviews code changes for bugs, style issues, and improvements.
 */

import type { SkillDefinition } from "../types.ts";

export const REVIEW_SKILL: SkillDefinition = {
  name: "review",
  source: "bundled",
  frontmatter: {
    description: "Review code changes for bugs, style issues, and improvements",
    when_to_use:
      "When the user wants a code review of recent changes or a specific file",
    allowed_tools: ["read_file", "search_code", "find_symbol", "get_structure"],
    user_invocable: true,
    context: "fork",
  },
  body: `Review code changes thoroughly.

## Steps
1. Identify the changes to review. If \${ARGS} specifies files or a diff range, scope to that. Otherwise, review recent uncommitted changes.
2. Read each changed file and understand the surrounding context.
3. Check for:
   - **Bugs**: null/undefined risks, off-by-one errors, race conditions, missing error handling
   - **Style**: naming conventions, code organization, consistency with the codebase
   - **Performance**: unnecessary allocations, O(n^2) patterns, missing caching opportunities
   - **Security**: injection risks, sensitive data exposure, missing input validation
   - **Maintainability**: dead code, duplicated logic, missing types or documentation
4. Report findings grouped by severity (critical, warning, suggestion).
5. For each finding, include the file, line range, and a concrete fix recommendation.

\${ARGS}`,
};
