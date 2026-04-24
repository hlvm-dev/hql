/**
 * Shared Agent tool spec helpers.
 *
 * Kept separate from registry.ts and agent-tool.ts to avoid circular imports
 * while allowing both eager registration and test access to share one source
 * of truth for the Agent tool description/args.
 *
 * The fallback description is computed once at module load from the built-in
 * agent registry. resolveAgentToolDescription() recomputes from built-ins plus
 * global user agents in ~/.hlvm/agents.
 */

import { getAgentToolPrompt } from "./agent-prompt.ts";
import { getBuiltInAgents } from "./built-in-agents.ts";

const AGENT_TOOL_FALLBACK_DESCRIPTION = getAgentToolPrompt(getBuiltInAgents());

export const AGENT_TOOL_ARGS = {
  description: "string - A short (3-5 word) description of the task",
  prompt: "string - The task for the agent to perform",
  subagent_type:
    "string (optional) - The type of specialized agent to use (e.g., 'Explore', 'Plan', 'general-purpose'). Defaults to 'general-purpose' if omitted.",
  model:
    "string (optional) - Optional model override (e.g., 'sonnet', 'opus', 'haiku')",
  run_in_background:
    "boolean (optional) - Set to true to run this agent in the background. You will be notified when it completes.",
  isolation:
    'string (optional) - Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo.',
  cwd:
    'string (optional) - Absolute path to run the agent in. Overrides the working directory for filesystem and shell operations. Mutually exclusive with isolation: "worktree".',
} as const;

export function getAgentToolFallbackDescription(): string {
  return AGENT_TOOL_FALLBACK_DESCRIPTION;
}

export async function resolveAgentToolDescription(
  _runtimeTarget?: string,
): Promise<string> {
  try {
    const { loadAgentDefinitions } = await import("./agent-definitions.ts");
    const { activeAgents } = await loadAgentDefinitions();
    return getAgentToolPrompt(activeAgents);
  } catch {
    return AGENT_TOOL_FALLBACK_DESCRIPTION;
  }
}
