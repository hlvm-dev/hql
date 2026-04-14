/**
 * Bundled Skill: commit
 *
 * Reviews staged/unstaged changes and creates a descriptive commit.
 */

import type { SkillDefinition } from "../types.ts";

export const COMMIT_SKILL: SkillDefinition = {
  name: "commit",
  source: "bundled",
  sourceKind: "bundled",
  frontmatter: {
    description: "Review changes and create a descriptive git commit",
    when_to_use:
      "When the user wants to commit staged or unstaged changes with a well-crafted message",
    allowed_tools: [
      "shell_exec",
      "read_file",
      "search_code",
      "git_status",
      "git_diff",
      "git_log",
    ],
    user_invocable: true,
    model_invocable: true,
    manual_only: false,
    context: "inline",
    diagnostics: [],
  },
  body: `Review the current repository state and create a commit.

## Steps
1. Run git status to see staged and unstaged changes.
2. Run git diff --cached to review what is staged. If nothing is staged, run git diff to review unstaged changes.
3. Run git log --oneline -5 to see recent commit style.
4. Decide which files to stage (if not already staged). Prefer staging related changes together.
5. Write a concise, descriptive commit message that explains WHY the change was made, not just WHAT changed.
6. Create the commit.
7. Report the result.

## Commit Message Guidelines
- First line: imperative mood, under 72 characters (e.g., "Fix null check in session validation")
- Optional body: separated by blank line, explains motivation and context
- Follow the repository's existing commit message conventions if visible from git log

$ARGUMENTS`,
};
