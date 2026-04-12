/**
 * Skill Executor
 *
 * Prepares inline skill execution by expanding the skill body with arguments
 * and returning a system message + optional tool allowlist.
 */

import type { SkillDefinition } from "./types.ts";

/** Result of preparing an inline skill for injection into the agent session. */
export interface InlineSkillResult {
  systemMessage: string;
  allowedTools?: string[];
}

/**
 * Prepare an inline skill for execution.
 *
 * Expands `${ARGS}` placeholders in the skill body with the provided arguments,
 * then returns a system message and optional tool allowlist.
 */
export function executeInlineSkill(
  skill: SkillDefinition,
  args?: string,
): InlineSkillResult {
  let content = skill.body;
  if (args) {
    content = content.replaceAll("${ARGS}", args);
  }
  return {
    systemMessage: `# Skill: ${skill.name}\n${content}`,
    allowedTools: skill.frontmatter.allowed_tools,
  };
}
