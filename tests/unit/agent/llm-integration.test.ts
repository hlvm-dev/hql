/**
 * LLM Integration Tests
 *
 * Verifies message conversion, stream collection, and system prompt generation
 */

import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
import {
  convertAgentMessagesToProvider,
  convertProviderMessagesToAgent,
  collectStream,
  generateSystemPrompt,
  type AgentMessage,
  type ProviderMessage,
} from "../../../src/hlvm/agent/llm-integration.ts";

// ============================================================
// Message Conversion: Agent → Provider
// ============================================================

Deno.test({
  name: "LLM Integration: convertAgentMessagesToProvider - pass through basic roles",
  fn() {
    const agentMessages: AgentMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    const result = convertAgentMessagesToProvider(agentMessages);

    assertEquals(result.length, 3);
    assertEquals(result[0].role, "system");
    assertEquals(result[1].role, "user");
    assertEquals(result[2].role, "assistant");
  },
});

Deno.test({
  name: "LLM Integration: convertAgentMessagesToProvider - convert tool to user (observation)",
  fn() {
    const agentMessages: AgentMessage[] = [
      { role: "tool", content: "Found 5 files" },
    ];

    const result = convertAgentMessagesToProvider(agentMessages);

    assertEquals(result.length, 1);
    assertEquals(result[0].role, "tool"); // Tool results stay as "tool" role for native tool calling
    assertEquals(result[0].content, "Found 5 files");
  },
});

Deno.test({
  name: "LLM Integration: convertAgentMessagesToProvider - mixed message types",
  fn() {
    const agentMessages: AgentMessage[] = [
      { role: "system", content: "System prompt" },
      { role: "user", content: "Search for files" },
      { role: "assistant", content: "I'll search..." },
      { role: "tool", content: "Result: 10 files" },
      { role: "assistant", content: "Found 10 files" },
    ];

    const result = convertAgentMessagesToProvider(agentMessages);

    assertEquals(result.length, 5);
    assertEquals(result[0].role, "system");
    assertEquals(result[1].role, "user");
    assertEquals(result[2].role, "assistant");
    assertEquals(result[3].role, "tool"); // tool stays as "tool" for native tool calling
    assertEquals(result[3].content, "Result: 10 files");
    assertEquals(result[4].role, "assistant");
  },
});

Deno.test({
  name: "LLM Integration: convertAgentMessagesToProvider - preserve content",
  fn() {
    const agentMessages: AgentMessage[] = [
      { role: "user", content: "Special chars: \n\t\"quotes\"" },
    ];

    const result = convertAgentMessagesToProvider(agentMessages);

    assertEquals(result[0].content, "Special chars: \n\t\"quotes\"");
  },
});

Deno.test({
  name: "LLM Integration: convertAgentMessagesToProvider - empty array",
  fn() {
    const result = convertAgentMessagesToProvider([]);
    assertEquals(result.length, 0);
  },
});

// ============================================================
// Message Conversion: Provider → Agent
// ============================================================

Deno.test({
  name: "LLM Integration: convertProviderMessagesToAgent - pass through basic roles",
  fn() {
    const providerMessages: ProviderMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    const result = convertProviderMessagesToAgent(providerMessages);

    assertEquals(result.length, 3);
    assertEquals(result[0].role, "system");
    assertEquals(result[1].role, "user");
    assertEquals(result[2].role, "assistant");
  },
});

Deno.test({
  name: "LLM Integration: convertProviderMessagesToAgent - detect tool results",
  fn() {
    const providerMessages: ProviderMessage[] = [
      { role: "user", content: "[Tool Result]\nFound 5 files" }, // Tool results come as user messages
    ];

    const result = convertProviderMessagesToAgent(providerMessages);

    assertEquals(result.length, 1);
    assertEquals(result[0].role, "tool");
    assertEquals(result[0].content, "Found 5 files");
  },
});

Deno.test({
  name: "LLM Integration: convertProviderMessagesToAgent - round trip conversion",
  fn() {
    const original: AgentMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Let me help" },
      { role: "tool", content: "Result data" },
      { role: "assistant", content: "Based on results..." },
    ];

    // Convert to provider format and back
    const provider = convertAgentMessagesToProvider(original);
    const roundTrip = convertProviderMessagesToAgent(provider);

    // Should preserve structure (though tool messages have prefix)
    assertEquals(roundTrip.length, original.length);
    assertEquals(roundTrip[0].role, "user");
    assertEquals(roundTrip[1].role, "assistant");
    assertEquals(roundTrip[2].role, "tool");
    assertEquals(roundTrip[2].content, "Result data");
    assertEquals(roundTrip[3].role, "assistant");
  },
});

// ============================================================
// Stream Collection
// ============================================================

Deno.test({
  name: "LLM Integration: collectStream - collect single chunk",
  async fn() {
    async function* mockStream() {
      yield "Hello, world!";
    }

    const result = await collectStream(mockStream());
    assertEquals(result, "Hello, world!");
  },
});

Deno.test({
  name: "LLM Integration: collectStream - collect multiple chunks",
  async fn() {
    async function* mockStream() {
      yield "Hello";
      yield ", ";
      yield "world";
      yield "!";
    }

    const result = await collectStream(mockStream());
    assertEquals(result, "Hello, world!");
  },
});

Deno.test({
  name: "LLM Integration: collectStream - empty stream",
  async fn() {
    async function* mockStream() {
      // Yield nothing
    }

    const result = await collectStream(mockStream());
    assertEquals(result, "");
  },
});

Deno.test({
  name: "LLM Integration: collectStream - large stream",
  async fn() {
    async function* mockStream() {
      for (let i = 0; i < 1000; i++) {
        yield `chunk${i} `;
      }
    }

    const result = await collectStream(mockStream());
    assertEquals(result.includes("chunk0"), true);
    assertEquals(result.includes("chunk999"), true);
  },
});

Deno.test({
  name: "LLM Integration: collectStream - special characters",
  async fn() {
    async function* mockStream() {
      yield "Line 1\n";
      yield "Line 2\t";
      yield '"Quoted"';
    }

    const result = await collectStream(mockStream());
    assertEquals(result, 'Line 1\nLine 2\t"Quoted"');
  },
});

// ============================================================
// System Prompt Generation
// ============================================================

Deno.test({
  name: "LLM Integration: generateSystemPrompt - includes role description",
  fn() {
    const prompt = generateSystemPrompt();

    assertStringIncludes(prompt, "AI coding agent");
    assertStringIncludes(prompt, "tools");
  },
});

Deno.test({
  name: "LLM Integration: generateSystemPrompt - lists tool names",
  fn() {
    const prompt = generateSystemPrompt();

    // Tool names listed (schemas sent via API, not in prompt)
    assertStringIncludes(prompt, "read_file");
    assertStringIncludes(prompt, "write_file");
    assertStringIncludes(prompt, "list_files");
    assertStringIncludes(prompt, "search_code");
    assertStringIncludes(prompt, "shell_exec");
  },
});

Deno.test({
  name: "LLM Integration: generateSystemPrompt - includes tool calling instructions",
  fn() {
    const prompt = generateSystemPrompt();

    assertStringIncludes(prompt, "function calling");
    assertStringIncludes(prompt, "Do NOT output tool call JSON");
  },
});

Deno.test({
  name: "LLM Integration: generateSystemPrompt - no verbose tool docs (schemas via API)",
  fn() {
    const prompt = generateSystemPrompt();

    // Prompt should NOT contain verbose tool documentation
    // (tool schemas are sent via native function calling API)
    assertEquals(prompt.includes("**Arguments:**"), false);
    assertEquals(prompt.includes("**Returns:**"), false);
    assertEquals(prompt.includes("Safety Level"), false);
  },
});


// ============================================================
// Edge Cases
// ============================================================

Deno.test({
  name: "LLM Integration: message conversion - preserve timestamps",
  fn() {
    const timestamp = Date.now();
    const agentMessages: AgentMessage[] = [
      { role: "user", content: "Hello", timestamp },
    ];

    const provider = convertAgentMessagesToProvider(agentMessages);
    // Timestamps not in provider type, but shouldn't break

    assertEquals(provider.length, 1);
    assertEquals(provider[0].content, "Hello");
  },
});

Deno.test({
  name: "LLM Integration: tool result prefix - consistent format",
  fn() {
    const agentMessages: AgentMessage[] = [
      { role: "tool", content: "Result 1" },
      { role: "tool", content: "Result 2" },
    ];

    const result = convertAgentMessagesToProvider(agentMessages);

    // All tool results keep "tool" role for native tool calling
    assertEquals(result[0].role, "tool");
    assertEquals(result[0].content, "Result 1");
    assertEquals(result[1].role, "tool");
    assertEquals(result[1].content, "Result 2");
  },
});

Deno.test({
  name: "LLM Integration: stream collection - handles async errors gracefully",
  async fn() {
    async function* errorStream() {
      yield "chunk1";
      throw new Error("stream error");
    }

    await assertRejects(
      () => collectStream(errorStream()),
      Error,
      "stream error",
    );
  },
});
