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

import { resolveTools } from "./registry.ts";
import { listAgentProfiles } from "./agent-registry.ts";
import { RuntimeError } from "../../common/error.ts";
import { collectStream } from "../../common/async-stream.ts";
import { buildToolJsonSchema } from "./tool-schema.ts";
import { type LLMResponse, type ToolCall } from "./tool-call.ts";
import { isToolArgsObject } from "./validation.ts";
import type { Message as AgentMessage } from "./context.ts";
import type {
  Message as ProviderMessage,
  ProviderToolCall,
  ToolDefinition,
} from "../providers/types.ts";

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
export { collectStream };

// ============================================================
// Tool Schema + Native Tool Calling
// ============================================================

function buildToolDefinitions(
  options?: { allowlist?: string[]; denylist?: string[] },
): ToolDefinition[] {
  const tools = resolveTools(options);
  return Object.entries(tools).map(([name, meta]) => {
    const parameters = meta.skipValidation
      ? { type: "object", properties: {}, additionalProperties: true }
      : buildToolJsonSchema(meta);

    return {
      type: "function",
      function: {
        name,
        description: meta.description,
        parameters: parameters as Record<string, unknown>,
      },
    };
  });
}

function parseProviderToolArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (isToolArgsObject(raw)) return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return isToolArgsObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function convertProviderToolCalls(calls: ProviderToolCall[] | undefined): ToolCall[] {
  if (!calls || calls.length === 0) return [];
  return calls
    .map((call) => {
      const name = call.function?.name ?? "";
      if (!name) return null;
      const args = parseProviderToolArgs(call.function?.arguments ?? "");
      return { toolName: name, args };
    })
    .filter((call): call is ToolCall => Boolean(call));
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
 * 3. Describes native tool calling expectations
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
export interface SystemPromptOptions {
  toolAllowlist?: string[];
  toolDenylist?: string[];
}

export function generateSystemPrompt(options: SystemPromptOptions = {}): string {
  const tools = resolveTools({
    allowlist: options.toolAllowlist,
    denylist: options.toolDenylist,
  });

  // Generate tool documentation
  const toolDocs = Object.entries(tools)
    .map(([name, meta]) => {
      const argsList = Object.entries(meta.args)
        .map(([argName, argDesc]) => `  - ${argName}: ${argDesc}`)
        .join("\n");
      const returnsList = meta.returns
        ? Object.entries(meta.returns)
          .map(([field, desc]) => `  - ${field}: ${desc}`)
          .join("\n")
        : "";
      const returnsBlock = meta.returns
        ? `\n**Returns:**\n${returnsList}\n`
        : "\n";

      return `
### ${name}
${meta.description}

**Arguments:**
${argsList}
${returnsBlock}**Safety Level:** ${meta.safetyLevel || meta.safety || "L2"}
`.trim();
    })
    .join("\n\n");

  const agents = listAgentProfiles();
  const agentList = agents.map((agent) => `${agent.name}: ${agent.description}`).join("\n");

  return `You are an AI coding agent with access to tools for file operations, code analysis, web research, and shell execution.

# Your Role
- Help users with coding tasks by using available tools
- Use tools when you need information from the workspace, the web, or command output
- If a request is a greeting, simple question, or clarification that doesn't require tools, respond directly
- Think step-by-step and explain your reasoning
- Verify assumptions with tools only when the answer depends on project state

# When to Use Tools vs Direct Response
- Use tools for: files, code search, command execution, web research, or project state checks
- Direct response is OK for: greetings, simple math, clarifying questions, or general conversation
- Use ONLY the tools listed below. Do NOT invent tools.

# Delegation (Multi-Agent)
- You may delegate a subtask using the delegate_agent tool when specialized expertise is helpful.
- Prefer delegation for focused tasks (web research, code analysis, shell work, memory lookup).
- Available agents:
${agentList}

# CRITICAL RULES FOR FINAL ANSWERS

SCOPE: These rules apply when your answer is based on tool results. If you did not use tools, respond naturally and do not cite tools.

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

4. **NEVER FABRICATE TOOL RESULTS:** Do NOT make up tool results or write "Tool:" headers yourself
   - You CANNOT see tool results until the system provides them
   - Do NOT write "Tool: tool_name\\nResult: ..." in your own responses
   - Wait for the system to execute your tool call and provide the actual result
   - If you fabricate a tool result, it will be WRONG and mislead the user
   - Example of FORBIDDEN behavior:
     ❌ "Tool: list_files\\nResult: Found 8 files" (fabricated result!)
   - Correct behavior:
     ✅ Call the appropriate tool via function calling, then WAIT for the system to provide results

6. **BAD EXAMPLE (VIOLATION):**
   User: "How many test files?"
   Tool result: "Found 8 test files"
   ❌ WRONG: "There are 5 test files." (ignores tool data)
   ❌ WRONG: "There are test files." (vague, doesn't cite tool)

7. **GOOD EXAMPLE (CORRECT):**
   User: "How many test files?"
   Tool result: "Found 8 test files"
   ✅ CORRECT: "Based on list_files, there are 8 test files in tests/unit/."

# Available Tools

${toolDocs}

# Tool Use (Native Function Calling)

Tools are invoked via native function calling. Do NOT output tool call JSON
or any TOOL_CALL/END_TOOL_CALL markers in your response.
When you need a tool, call it through the tool-calling mechanism.
After tool execution, you'll receive results from the system.

# Examples

**Example 0: Greeting (no tools needed)**
User: "hello"
Assistant: "Hello! How can I help you today?"

**Example 0b: Simple question (no tools needed)**
User: "what is 2+2"
Assistant: "4."

# ReAct Loop

You operate in a Thought-Action-Observation loop:
1. **Thought:** Analyze the user's request and plan your approach
2. **Action:** Call tools to gather information or make changes
3. **Observation:** You'll receive tool results marked as "Tool: <tool_name>" with a Result or Error
4. **Response:** After receiving tool results, ALWAYS provide a response that:
   - Analyzes what you learned from the tool results
   - Answers the user's question based on the information
   - Makes additional tool calls if more information is needed

If no tool calls are needed, provide a direct response without tool citations.

**IMPORTANT:** After you receive tool results, you MUST either:
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
interface AgentLLMConfig {
  /** Model to use (e.g., "ollama/llama3.2") */
  model?: string;
  /** Additional options for generation */
  options?: {
    temperature?: number;
    maxTokens?: number;
  };
  /** Optional tool allowlist */
  toolAllowlist?: string[];
  /** Optional tool denylist */
  toolDenylist?: string[];
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
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<LLMResponse> {
  return async (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ): Promise<LLMResponse> => {
    // Lazy import to avoid circular dependencies and allow tree-shaking
    const { ai } = await import("../api/ai.ts");

    if (!ai || typeof ai !== "object" || !("chatStructured" in ai)) {
      throw new RuntimeError(
        "AI API not available. Ensure HLVM is properly initialized.",
      );
    }

    // Convert messages to provider format
    const providerMessages = convertAgentMessagesToProvider(messages);

    const api = ai as {
      chatStructured: (
        messages: ProviderMessage[],
        options?: { model?: string; signal?: AbortSignal; tools?: ToolDefinition[] },
      ) => Promise<{ content: string; toolCalls?: ProviderToolCall[] }>;
    };

    const tools = buildToolDefinitions({
      allowlist: config?.toolAllowlist,
      denylist: config?.toolDenylist,
    });

    const response = await api.chatStructured(providerMessages, {
      model: config?.model,
      signal,
      tools,
    });
    return {
      content: response.content ?? "",
      toolCalls: convertProviderToolCalls(response.toolCalls),
    };
  };
}
