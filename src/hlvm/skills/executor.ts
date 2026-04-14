/**
 * Skill Executor
 *
 * Prepares skill execution by rendering CC-style argument placeholders and
 * returning a system message + optional tool allowlist.
 */

import type { SkillDefinition } from "./types.ts";

/** Result of preparing an inline skill for injection into the agent session. */
export interface InlineSkillResult {
  systemMessage: string;
  allowedTools?: string[];
}

const ARG_INDEX_REGEX = /\$(?:ARGUMENTS\[(\d+)\]|(\d+))/g;

function splitSkillArguments(args: string): string[] {
  const parts: string[] = [];
  const trimmed = args.trim();
  if (!trimmed) return parts;

  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (quote) {
      if (char === "\\" && i + 1 < trimmed.length) {
        i++;
        current += trimmed[i];
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) parts.push(current);
  return parts;
}

export function renderSkillBody(
  skill: SkillDefinition,
  args?: string,
): string {
  let content = skill.body;
  const rawArgs = args?.trim() ?? "";
  if (!rawArgs) return content;

  const splitArgs = splitSkillArguments(rawArgs);
  const hasArgumentPlaceholder = content.includes("$ARGUMENTS") ||
    content.includes("${ARGS}") ||
    /\$(\d+)/.test(content);

  content = content.replace(ARG_INDEX_REGEX, (_match, longIndex, shortIndex) => {
    const index = Number(longIndex ?? shortIndex);
    return splitArgs[index] ?? "";
  });
  content = content.replaceAll("$ARGUMENTS", rawArgs);
  content = content.replaceAll("${ARGS}", rawArgs);

  if (!hasArgumentPlaceholder) {
    content = `${content.trimEnd()}\n\nARGUMENTS: ${rawArgs}`;
  }

  return content;
}

/**
 * Prepare an inline skill for execution.
 *
 * Renders CC-style argument placeholders in the skill body, then returns a
 * system message and optional tool allowlist.
 */
export function executeInlineSkill(
  skill: SkillDefinition,
  args?: string,
): InlineSkillResult {
  const content = renderSkillBody(skill, args);
  return {
    systemMessage: `# Skill: ${skill.name}\n${content}`,
    allowedTools: skill.frontmatter.allowed_tools,
  };
}
