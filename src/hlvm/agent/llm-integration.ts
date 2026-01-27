/**
 * LLM Integration - Bridge between agent and LLM providers
 *
 * Provides integration layer between:
 * - Agent infrastructure (orchestrator, context, tools)
 * - LLM providers (Ollama, Anthropic, etc.)
 *
 * Features:
 * - Message type conversion (agent → provider format)
 * - Stream collection (AsyncGenerator → Promise<string>)
 * - System prompt generation from tool registry
 * - Factory function for creating LLM functions
 *
 * SSOT-compliant: Uses existing ai API and platform abstraction
 */

import { getAllTools } from "./registry.ts";
import type { Message as AgentMessage } from "./context.ts";
import type { Message as ProviderMessage } from "../providers/types.ts";

// Re-export for convenience
export type { AgentMessage, ProviderMessage };

// ============================================================
// Message Type Conversion
// ============================================================

/**
 * Convert agent messages to provider-compatible format
 *
 * Agent messages support 4 roles: system, user, assistant, tool
 * Provider messages support 3 roles: system, user, assistant
 *
 * Strategy: Convert "tool" role to "assistant" with observation prefix
 *
 * @param agentMessages Messages from context manager
 * @returns Messages compatible with provider API
 *
 * @example
 * ```ts
 * const agentMsgs = [
 *   { role: "user", content: "Hello" },
 *   { role: "assistant", content: "Let me search..." },
 *   { role: "tool", content: "Result: found 5 files" }
 * ];
 *
 * const providerMsgs = convertAgentMessagesToProvider(agentMsgs);
 * // [
 * //   { role: "user", content: "Hello" },
 * //   { role: "assistant", content: "Let me search..." },
 * //   { role: "assistant", content: "[Tool Result]\nResult: found 5 files" }
 * // ]
 * ```
 */
export function convertAgentMessagesToProvider(
  agentMessages: AgentMessage[],
): ProviderMessage[] {
  return agentMessages.map((msg) => {
    // Convert "tool" role to "user" (observation in ReAct pattern)
    // Tool results are observations that should come from outside (user role)
    if (msg.role === "tool") {
      return {
        role: "user" as const,
        content: `[Tool Result]\n${msg.content}`,
      };
    }

    // Pass through other roles
    return {
      role: msg.role as "system" | "user" | "assistant",
      content: msg.content,
    };
  });
}

/**
 * Convert provider messages back to agent format
 *
 * Useful for testing or converting external message histories.
 *
 * @param providerMessages Provider-format messages
 * @returns Agent-format messages
 */
export function convertProviderMessagesToAgent(
  providerMessages: ProviderMessage[],
): AgentMessage[] {
  return providerMessages.map((msg) => {
    // Check if this is a converted tool result (now in user messages)
    if (
      msg.role === "user" &&
      msg.content.startsWith("[Tool Result]\n")
    ) {
      return {
        role: "tool" as const,
        content: msg.content.replace("[Tool Result]\n", ""),
      };
    }

    // Pass through other messages
    return {
      role: msg.role,
      content: msg.content,
    };
  });
}

// ============================================================
// Stream Collection
// ============================================================

/**
 * Collect async generator stream into single string
 *
 * LLM providers return AsyncGenerator<string> for streaming.
 * Orchestrator expects Promise<string>.
 *
 * This function collects all chunks into a single response.
 *
 * @param stream Async generator from LLM
 * @returns Complete response string
 *
 * @example
 * ```ts
 * const stream = ai.chat(messages);
 * const fullResponse = await collectStream(stream);
 * ```
 */
export async function collectStream(
  stream: AsyncGenerator<string, void, unknown>,
): Promise<string> {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks.join("");
}

// ============================================================
// System Prompt Generation
// ============================================================

/**
 * Generate system prompt from tool registry
 *
 * Creates comprehensive system prompt that:
 * 1. Explains agent role
 * 2. Lists all available tools
 * 3. Describes tool call envelope format
 * 4. Provides examples
 * 5. Explains ReAct loop
 *
 * Dynamically generated from tool registry for accuracy.
 *
 * @returns System prompt string
 *
 * @example
 * ```ts
 * const systemPrompt = generateSystemPrompt();
 * context.addMessage({ role: "system", content: systemPrompt });
 * ```
 */
export function generateSystemPrompt(): string {
  const tools = getAllTools();

  // Generate tool documentation
  const toolDocs = Object.entries(tools)
    .map(([name, meta]) => {
      const argsList = Object.entries(meta.args)
        .map(([argName, argDesc]) => `  - ${argName}: ${argDesc}`)
        .join("\n");

      return `
### ${name}
${meta.description}

**Arguments:**
${argsList}

**Safety Level:** ${meta.safetyLevel || meta.safety || "L2"}
`.trim();
    })
    .join("\n\n");

  return `You are an AI coding agent with access to tools for file operations, code analysis, and shell execution.

# Your Role
- Help users with coding tasks by using available tools
- Think step-by-step and explain your reasoning
- Use tools to gather information before making decisions
- Always verify your assumptions with tool calls

# CRITICAL RULES FOR FINAL ANSWERS

When providing your final answer to the user:

1. **CITE TOOL RESULTS:** Your answer MUST cite which tool gave you the information
   - Format: "Based on [tool_name], [answer]"
   - Example: "Based on list_files, there are 8 test files in tests/unit/"

2. **DO NOT MAKE UP INFORMATION:** Never provide information not in tool results
   - If a tool didn't return data, say so explicitly
   - Don't fill in gaps with your knowledge

3. **TRUST THE TOOL:** If tool result contradicts your knowledge, TRUST THE TOOL
   - Tool results reflect the actual state of the codebase
   - Your knowledge may be outdated or incorrect for this specific project

4. **BAD EXAMPLE (VIOLATION):**
   User: "How many test files?"
   Tool result: "Found 8 test files"
   ❌ WRONG: "There are 5 test files." (ignores tool data)
   ❌ WRONG: "There are test files." (vague, doesn't cite tool)

5. **GOOD EXAMPLE (CORRECT):**
   User: "How many test files?"
   Tool result: "Found 8 test files"
   ✅ CORRECT: "Based on list_files, there are 8 test files in tests/unit/."

# Available Tools

${toolDocs}

# Tool Call Format

To use a tool, output the following envelope format:

\`\`\`
TOOL_CALL
{"toolName": "tool_name", "args": {"arg1": "value1", "arg2": "value2"}}
END_TOOL_CALL
\`\`\`

**IMPORTANT:**
- Use EXACT format: TOOL_CALL on its own line, then JSON, then END_TOOL_CALL on its own line
- JSON must be valid and properly formatted
- You can make multiple tool calls in one response
- After tool execution, you'll receive results as [Tool Result]

# Examples

**Example 1: Reading a file**
\`\`\`
Let me read that file to see its contents.

TOOL_CALL
{"toolName": "read_file", "args": {"path": "src/main.ts"}}
END_TOOL_CALL
\`\`\`

**Example 2: Searching code**
\`\`\`
I'll search for all TODO comments in the codebase.

TOOL_CALL
{"toolName": "search_code", "args": {"pattern": "TODO", "path": "src"}}
END_TOOL_CALL
\`\`\`

**Example 3: Multiple tools**
\`\`\`
Let me first list the files, then read the main file.

TOOL_CALL
{"toolName": "list_files", "args": {"path": "src"}}
END_TOOL_CALL

TOOL_CALL
{"toolName": "read_file", "args": {"path": "src/main.ts"}}
END_TOOL_CALL
\`\`\`

# ReAct Loop

You operate in a Thought-Action-Observation loop:
1. **Thought:** Analyze the user's request and plan your approach
2. **Action:** Call tools to gather information or make changes
3. **Observation:** You'll receive tool results marked as [Tool Result]
4. **Response:** After receiving tool results, ALWAYS provide a response that:
   - Analyzes what you learned from the tool results
   - Answers the user's question based on the information
   - Makes additional tool calls if more information is needed

**IMPORTANT:** After you receive [Tool Result], you MUST either:
- Make more tool calls if you need additional information, OR
- Provide a final answer to the user (without any tool calls)

Never return an empty response after receiving tool results.

# Guidelines

- **Be thorough:** Verify assumptions with tools before proceeding
- **Be safe:** Read files before modifying them
- **Be clear:** Explain what you're doing and why
- **Be efficient:** Use appropriate tools for each task
- **Be accurate:** Double-check critical information

Now, assist the user with their request.`;
}

// ============================================================
// LLM Function Factory
// ============================================================

/**
 * Configuration for agent LLM
 */
export interface AgentLLMConfig {
  /** Model to use (e.g., "ollama/llama3.2") */
  model?: string;
  /** Additional options for generation */
  options?: {
    temperature?: number;
    maxTokens?: number;
  };
}

/**
 * Create LLM function for agent orchestrator
 *
 * Returns a function compatible with runReActLoop that:
 * 1. Converts agent messages to provider format
 * 2. Calls LLM via ai.chat()
 * 3. Collects streaming response
 * 4. Returns complete string
 *
 * @param config Configuration options
 * @returns Function compatible with orchestrator
 *
 * @example
 * ```ts
 * import { createAgentLLM } from "./llm-integration.ts";
 * import { runReActLoop } from "./orchestrator.ts";
 * import { ContextManager } from "./context.ts";
 *
 * const llm = createAgentLLM({ model: "ollama/llama3.2" });
 * const context = new ContextManager();
 *
 * // Add system prompt
 * context.addMessage({
 *   role: "system",
 *   content: generateSystemPrompt()
 * });
 *
 * // Run agent
 * const result = await runReActLoop(
 *   "Count TypeScript files in src/",
 *   { workspace: "/path/to/workspace", context, autoApprove: true },
 *   llm
 * );
 * ```
 */
export function createAgentLLM(
  config?: AgentLLMConfig,
): (messages: AgentMessage[]) => Promise<string> {
  return async (messages: AgentMessage[]): Promise<string> => {
    // Lazy import to avoid circular dependencies and allow tree-shaking
    const { ai } = await import("../api/ai.ts");

    if (!ai || typeof ai !== "object" || !("chat" in ai)) {
      throw new Error(
        "AI API not available. Ensure HLVM is properly initialized.",
      );
    }

    // Convert messages to provider format
    const providerMessages = convertAgentMessagesToProvider(messages);

    // Call LLM with streaming
    const stream = (ai as {
      chat: (
        messages: ProviderMessage[],
        options?: { model?: string },
      ) => AsyncGenerator<string>;
    }).chat(providerMessages, {
      model: config?.model,
    });

    // Collect stream into complete response
    const response = await collectStream(stream);

    return response;
  };
}

/**
 * Create agent LLM with system prompt pre-configured
 *
 * Convenience function that creates both LLM function and initial context
 * with system prompt.
 *
 * @param config Configuration options
 * @returns Object with llm function and initialized context
 *
 * @example
 * ```ts
 * const { llm, context } = createAgentWithSystemPrompt({
 *   model: "ollama/llama3.2"
 * });
 *
 * const result = await runReActLoop(
 *   "Your task here",
 *   { workspace: "/path/to/workspace", context, autoApprove: true },
 *   llm
 * );
 * ```
 */
export function createAgentWithSystemPrompt(config?: AgentLLMConfig): {
  llm: (messages: AgentMessage[]) => Promise<string>;
  getSystemPrompt: () => string;
} {
  const llm = createAgentLLM(config);
  const systemPrompt = generateSystemPrompt();

  return {
    llm,
    getSystemPrompt: () => systemPrompt,
  };
}
