import { assertEquals } from "jsr:@std/assert";
import {
  getExecutionModeModelForMode,
  resolveExecutionModeModels,
} from "../../../src/hlvm/agent/execution-mode-models.ts";
import type { RuntimeModelDiscoveryResponse } from "../../../src/hlvm/runtime/model-protocol.ts";

function makeDiscovery(
  cloudModels: RuntimeModelDiscoveryResponse["cloudModels"],
): RuntimeModelDiscoveryResponse {
  return {
    installedModels: [],
    remoteModels: [],
    cloudModels,
    failed: false,
  };
}

Deno.test("execution mode models: all modes keep the configured model by default", () => {
  const discovery = makeDiscovery([
    {
      name: "gpt-5.4",
      displayName: "GPT-5.4",
      family: "openai",
      capabilities: ["chat", "tools", "vision"],
      contextWindow: 1_050_000,
      metadata: { provider: "openai", apiKeyConfigured: true },
    },
    {
      name: "gpt-5.4-pro",
      displayName: "GPT-5.4 Pro",
      family: "openai",
      capabilities: ["chat", "tools", "vision"],
      contextWindow: 1_050_000,
      metadata: { provider: "openai", apiKeyConfigured: true },
    },
  ]);

  const resolved = resolveExecutionModeModels(
    "openai/gpt-5.4-pro",
    discovery,
  );

  assertEquals(resolved.byMode.default?.id, "openai/gpt-5.4-pro");
  assertEquals(resolved.byMode["auto-edit"]?.id, "openai/gpt-5.4-pro");
  assertEquals(resolved.byMode.plan?.id, "openai/gpt-5.4-pro");
  assertEquals(resolved.byMode.yolo?.id, "openai/gpt-5.4-pro");
  assertEquals(resolved.byMode.default?.parameterSize, undefined);
});

Deno.test("execution mode models: claude agent selections also stay stable by default", () => {
  const discovery = makeDiscovery([
    {
      name: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      family: "claude",
      capabilities: ["chat", "tools", "vision"],
      contextWindow: 1_000_000,
      metadata: { provider: "claude-code", apiKeyConfigured: true },
    },
    {
      name: "claude-sonnet-4-6:agent",
      displayName: "Claude Sonnet 4.6 (Agent)",
      family: "claude",
      capabilities: ["chat", "tools", "vision"],
      contextWindow: 1_000_000,
      metadata: { provider: "claude-code", apiKeyConfigured: true },
    },
    {
      name: "claude-opus-4-6",
      displayName: "Claude Opus 4.6",
      family: "claude",
      capabilities: ["chat", "tools", "vision"],
      contextWindow: 1_000_000,
      metadata: { provider: "claude-code", apiKeyConfigured: true },
    },
  ]);

  const resolved = resolveExecutionModeModels(
    "claude-code/claude-sonnet-4-6:agent",
    discovery,
  );

  assertEquals(
    resolved.byMode.default?.id,
    "claude-code/claude-sonnet-4-6:agent",
  );
  assertEquals(
    resolved.byMode.plan?.id,
    "claude-code/claude-sonnet-4-6:agent",
  );
  assertEquals(
    resolved.byMode.yolo?.id,
    "claude-code/claude-sonnet-4-6:agent",
  );
});

Deno.test("execution mode models: preserve parameter size for local routing decisions", () => {
  const discovery: RuntimeModelDiscoveryResponse = {
    installedModels: [{
      name: "llama3.2:1b",
      displayName: "Llama 3.2 1B",
      parameterSize: "1.2B",
      capabilities: ["chat", "tools"],
      metadata: { provider: "ollama" },
    }],
    remoteModels: [],
    cloudModels: [],
    failed: false,
  };

  const resolved = resolveExecutionModeModels(
    "ollama/llama3.2:1b",
    discovery,
  );

  assertEquals(resolved.byMode.default?.parameterSize, "1.2B");
  assertEquals(resolved.byMode.plan?.parameterSize, "1.2B");
});

Deno.test("execution mode models: explicit per-mode overrides still win", () => {
  const discovery = makeDiscovery([
    {
      name: "llama3.2:1b",
      displayName: "Llama 3.2 1B",
      capabilities: ["chat", "tools"],
      metadata: { provider: "ollama" },
    },
    {
      name: "mistral-large:latest",
      displayName: "Mistral Large",
      capabilities: ["chat", "tools"],
      metadata: { provider: "ollama" },
    },
  ]);

  const resolved = resolveExecutionModeModels(
    "ollama/llama3.2:1b",
    discovery,
    { yolo: "ollama/mistral-large:latest" },
  );

  assertEquals(resolved.byMode.default?.id, "ollama/llama3.2:1b");
  assertEquals(resolved.byMode.yolo?.id, "ollama/mistral-large:latest");
});

Deno.test("execution mode models: single-mode lookup falls back to the configured model", () => {
  assertEquals(
    getExecutionModeModelForMode(
      "plan",
      { byMode: {} },
      "ollama/llama3.2:1b",
      8192,
    ),
    {
      id: "ollama/llama3.2:1b",
      displayName: "llama3.2:1b",
      contextWindow: 8192,
    },
  );
});
