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
import { normalizeToolArgs } from "./validation.ts";
import type { Message as AgentMessage } from "./context.ts";
import type {
  ProviderMessage,
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
    // Preserve "tool" role for native tool calling conversation flow
    if (msg.role === "tool") {
      return {
        role: "tool" as const,
        content: msg.content,
        ...(msg.toolName ? { tool_name: msg.toolName } : {}),
        ...(msg.toolCallId ? { tool_call_id: msg.toolCallId } : {}),
      };
    }

    // Pass through assistant messages with tool_calls metadata
    if (msg.role === "assistant" && msg.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: msg.content,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
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
    // Handle tool role messages
    if (msg.role === "tool") {
      return {
        role: "tool" as const,
        content: msg.content,
        ...(msg.tool_name ? { toolName: msg.tool_name } : {}),
      };
    }

    // Legacy: check if this is an old-format converted tool result
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
      role: msg.role as "system" | "user" | "assistant",
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

/** Cached tool definitions keyed by serialized options */
let _toolDefCache: { key: string; defs: ToolDefinition[] } | null = null;

/** Clear cached tool definitions (call when registry changes or at session start) */
export function clearToolDefCache(): void {
  _toolDefCache = null;
}

function buildToolDefinitions(
  options?: { allowlist?: string[]; denylist?: string[] },
): ToolDefinition[] {
  const cacheKey = JSON.stringify([
    options?.allowlist ?? null,
    options?.denylist ?? null,
  ]);
  if (_toolDefCache && _toolDefCache.key === cacheKey) {
    return _toolDefCache.defs;
  }

  const tools = resolveTools(options);
  const defs: ToolDefinition[] = Object.entries(tools).map(([name, meta]) => {
    const parameters = meta.skipValidation
      ? { type: "object", properties: {}, additionalProperties: true }
      : buildToolJsonSchema(meta);

    return {
      type: "function" as const,
      function: {
        name,
        description: meta.description,
        parameters: parameters as Record<string, unknown>,
      },
    };
  });
  _toolDefCache = { key: cacheKey, defs };
  return defs;
}

function convertProviderToolCalls(
  calls: ProviderToolCall[] | undefined,
): ToolCall[] {
  if (!calls || calls.length === 0) return [];
  return calls
    .map((call): ToolCall | null => {
      const name = call.function?.name ?? "";
      if (!name) return null;
      const args = normalizeToolArgs(call.function?.arguments ?? "");
      return { ...(call.id ? { id: call.id } : {}), toolName: name, args };
    })
    .filter((call): call is ToolCall => call !== null);
}

// ============================================================
// System Prompt Generation
// ============================================================

/**
 * Generate system prompt from tool registry
 *
 * Creates comprehensive system prompt that:
 * Minimal system prompt: role, instructions, tool names, tips.
 * Tool schemas are sent via native function calling API (not in prompt text).
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

export function generateSystemPrompt(
  options: SystemPromptOptions = {},
): string {
  const tools = resolveTools({
    allowlist: options.toolAllowlist,
    denylist: options.toolDenylist,
  });

  // Tool names only — full schemas are sent via native tool calling API
  const toolNames = Object.keys(tools);

  // Only include delegation section if delegate_agent is visible
  const hasDelegation = "delegate_agent" in tools;
  let delegationSection = "";
  if (hasDelegation) {
    const agents = listAgentProfiles();
    const agentList = agents.map((agent) =>
      `${agent.name}: ${agent.description}`
    ).join("\n");
    delegationSection =
      `\n# Delegation\nUse delegate_agent for subtasks requiring specialized expertise.\nAvailable agents: ${agentList}\n`;
  }

  return `You are an AI coding agent. You have tools for file operations, code analysis, web research, and shell execution.

# Instructions
- Use tools when you need information from files, the web, or command execution
- For greetings, simple math, or general questions, respond directly without tools
- Trust tool results over your own knowledge
- Never fabricate tool results
- If a tool call fails, read the error hint and try a different approach — do not retry the same action unchanged
- Be concise and targeted — prefer specific queries over broad reads
${delegationSection}
# Tools
Available: ${toolNames.join(", ")}
Tool schemas are provided via function calling. Do NOT output tool call JSON in text.

# Tips
- For user folders use list_files with paths like ~/Downloads, ~/Desktop, ~/Documents
- For counts/totals/max/min, use aggregate_entries on prior tool results
- For media files, use mimePrefix (e.g., "video/", "image/")`;
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
  /** Optional callback for streaming tokens to the terminal */
  onToken?: (text: string) => void;
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
        options?: {
          model?: string;
          signal?: AbortSignal;
          tools?: ToolDefinition[];
          temperature?: number;
          onToken?: (text: string) => void;
        },
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
      temperature: config?.options?.temperature ?? 0.0,
      onToken: config?.onToken,
    });
    return {
      content: response.content ?? "",
      toolCalls: convertProviderToolCalls(response.toolCalls),
    };
  };
}

// ============================================================
// Summarization Function Factory
// ============================================================

/**
 * Create a summarization function for context compaction.
 * Uses the same ai.chat() with a compact summarization prompt.
 *
 * @param model Model to use for summarization
 * @returns Async function that summarizes an array of messages into 2-3 sentences
 */
export function createSummarizationFn(
  model?: string,
): (messages: AgentMessage[]) => Promise<string> {
  return async (messages: AgentMessage[]): Promise<string> => {
    const { ai } = await import("../api/ai.ts");

    if (!ai || typeof ai !== "object" || !("chat" in ai)) {
      throw new RuntimeError(
        "AI API not available for summarization.",
      );
    }

    const formatted = messages
      .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
      .join("\n");

    const prompt =
      `Summarize this conversation in 2-3 sentences. Focus on: what was asked, what tools were used, what results were found. Be concise.\n\nConversation:\n${formatted}`;

    const chatFn = (ai as {
      chat: (
        messages: ProviderMessage[],
        options?: { model?: string; temperature?: number },
      ) => AsyncGenerator<string, void, unknown>;
    }).chat;
    const stream = chatFn(
      [{ role: "user", content: prompt }],
      { model, temperature: 0.0 },
    );

    return (await collectStream(stream)).trim();
  };
}
