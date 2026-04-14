/**
 * Shared Agent tool spec helpers.
 *
 * Kept separate from registry.ts and agent-tool.ts to avoid circular imports
 * while allowing both eager registration and test access to share one source
 * of truth for the Agent tool description/args.
 */

const AGENT_TOOL_FALLBACK_DESCRIPTION = `Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
- general-purpose: General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. (Tools: *)
- Explore: Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions. (Tools: All tools except Agent, edit_file, write_file)
- Plan: Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs. (Tools: All tools except Agent, edit_file, write_file)

Custom agents defined in .hlvm/agents/*.md may also be available. Specify subagent_type to use an agent by name.`;

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
} as const;

export function getAgentToolFallbackDescription(): string {
  return AGENT_TOOL_FALLBACK_DESCRIPTION;
}

export async function resolveAgentToolDescription(
  workspace?: string,
): Promise<string> {
  if (!workspace) {
    return AGENT_TOOL_FALLBACK_DESCRIPTION;
  }

  try {
    const [{ loadAgentDefinitions }, { getAgentToolPrompt }] = await Promise
      .all([
        import("./agent-definitions.ts"),
        import("./agent-prompt.ts"),
      ]);
    const { activeAgents } = await loadAgentDefinitions(workspace);
    return getAgentToolPrompt(activeAgents);
  } catch {
    return AGENT_TOOL_FALLBACK_DESCRIPTION;
  }
}
