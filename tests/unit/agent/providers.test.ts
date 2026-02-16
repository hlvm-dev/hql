/**
 * Provider Message Conversion Tests
 *
 * Tests the pure message conversion functions for OpenAI, Anthropic, and Google providers.
 * These are the most critical functions — they convert our internal message format
 * to each provider's wire format. Bugs here cause tool calling to silently fail.
 *
 * No network calls needed — all functions are pure transformations.
 */

import { assertEquals } from "jsr:@std/assert";

// ============================================================
// Shared: parseJsonArgs
// ============================================================

import { parseJsonArgs } from "../../../src/hlvm/providers/common.ts";

Deno.test({
  name: "parseJsonArgs: parses valid JSON string",
  fn() {
    const result = parseJsonArgs('{"path": "~/Downloads"}');
    assertEquals(result, { path: "~/Downloads" });
  },
});

Deno.test({
  name: "parseJsonArgs: returns object as-is",
  fn() {
    const obj = { path: "." };
    assertEquals(parseJsonArgs(obj), obj);
  },
});

Deno.test({
  name: "parseJsonArgs: returns {} for malformed JSON",
  fn() {
    assertEquals(parseJsonArgs("{invalid json}"), {});
  },
});

Deno.test({
  name: "parseJsonArgs: returns {} for null/undefined",
  fn() {
    assertEquals(parseJsonArgs(null), {});
    assertEquals(parseJsonArgs(undefined), {});
  },
});

Deno.test({
  name: "parseJsonArgs: returns {} for empty string",
  fn() {
    assertEquals(parseJsonArgs(""), {});
  },
});

// ============================================================
// End-to-End: tool_call_id propagation through agent pipeline
// ============================================================

import {
  convertAgentMessagesToProvider,
  type AgentMessage,
} from "../../../src/hlvm/agent/llm-integration.ts";

Deno.test({
  name: "E2E: tool_call_id propagates from agent message to provider message",
  fn() {
    const agentMessages: AgentMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "call_real_id",
          function: { name: "list_files", arguments: { path: "." } },
        }],
      },
      {
        role: "tool",
        content: "result",
        toolName: "list_files",
        toolCallId: "call_real_id",
      },
    ];

    const providerMessages = convertAgentMessagesToProvider(agentMessages);

    // Assistant message should have tool_call id
    assertEquals(providerMessages[0].tool_calls![0].id, "call_real_id");

    // Tool result should have tool_call_id
    assertEquals(providerMessages[1].tool_call_id, "call_real_id");
    assertEquals(providerMessages[1].tool_name, "list_files");
  },
});

Deno.test({
  name: "E2E: multi-tool calls have distinct tool_call_ids",
  fn() {
    const agentMessages: AgentMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call_A", function: { name: "list_files", arguments: {} } },
          { id: "call_B", function: { name: "shell_exec", arguments: {} } },
        ],
      },
      {
        role: "tool",
        content: "files result",
        toolName: "list_files",
        toolCallId: "call_A",
      },
      {
        role: "tool",
        content: "shell result",
        toolName: "shell_exec",
        toolCallId: "call_B",
      },
    ];

    const providerMessages = convertAgentMessagesToProvider(agentMessages);

    // Assistant tool_calls
    assertEquals(providerMessages[0].tool_calls![0].id, "call_A");
    assertEquals(providerMessages[0].tool_calls![1].id, "call_B");

    // Tool results correlate correctly
    assertEquals(providerMessages[1].tool_call_id, "call_A");
    assertEquals(providerMessages[1].tool_name, "list_files");
    assertEquals(providerMessages[2].tool_call_id, "call_B");
    assertEquals(providerMessages[2].tool_name, "shell_exec");
  },
});

Deno.test({
  name: "E2E: missing tool_call_id gracefully omitted (backward compat)",
  fn() {
    const agentMessages: AgentMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{
          function: { name: "list_files", arguments: {} },
        }],
      },
      {
        role: "tool",
        content: "result",
        toolName: "list_files",
      },
    ];

    const providerMessages = convertAgentMessagesToProvider(agentMessages);

    // No id/tool_call_id — should not crash, just omit
    assertEquals(providerMessages[0].tool_calls![0].id, undefined);
    assertEquals(providerMessages[1].tool_call_id, undefined);
    assertEquals(providerMessages[1].tool_name, "list_files");
  },
});

