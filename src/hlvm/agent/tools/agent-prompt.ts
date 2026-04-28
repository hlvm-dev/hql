import type { AgentDefinition } from "./agent-types.ts";

function formatAgentLine(agent: AgentDefinition): string {
  const toolsDescription = getToolsDescription(agent);
  return `- ${agent.agentType}: ${agent.whenToUse} (Tools: ${toolsDescription})`;
}

function getToolsDescription(agent: AgentDefinition): string {
  const { tools, disallowedTools } = agent;
  const hasAllowlist = tools !== undefined && tools.length > 0;
  const hasDenylist = disallowedTools !== undefined && disallowedTools.length > 0;

  if (hasAllowlist && hasDenylist) {
    const denySet = new Set(disallowedTools);
    const effectiveTools = tools!.filter((t) => !denySet.has(t));
    return effectiveTools.length === 0 ? "None" : effectiveTools.join(", ");
  }
  if (hasAllowlist) return tools!.join(", ");
  if (hasDenylist) return `All tools except ${disallowedTools!.join(", ")}`;
  return "All tools";
}

export function getAgentToolPrompt(agents: AgentDefinition[]): string {
  const agentLines = agents.map(formatAgentLine).join("\n");

  return `Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
${agentLines}

## When not to use

If the target is already known, use the direct tool: read_file for a known path, search_code for a specific symbol or string. Reserve this tool for open-ended questions that span the codebase, or tasks that require multiple steps.

## Usage notes

- Always include a short description summarizing what the agent will do
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.

## Writing the prompt

Brief the agent like a smart colleague who just walked into the room — it hasn't seen this conversation, doesn't know what you've tried, doesn't understand why this task matters.
- Explain what you're trying to accomplish and why.
- Describe what you've already learned or ruled out.
- Give enough context about the surrounding problem that the agent can make judgment calls rather than just following a narrow instruction.
- If you need a short response, say so ("report in under 200 words").
- Lookups: hand over the exact command. Investigations: hand over the question — prescribed steps become dead weight when the premise is wrong.

Terse command-style prompts produce shallow, generic work.

**Never delegate understanding.** Don't write "based on your findings, fix the bug" or "based on the research, implement it." Those phrases push synthesis onto the agent instead of doing it yourself. Write prompts that prove you understood: include file paths, line numbers, what specifically to change.`;
}
