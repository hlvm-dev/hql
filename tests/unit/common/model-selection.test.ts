import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  buildSelectedModelConfigUpdates,
  buildSelectedModelConfigUpdatesPreservingAgentMode,
  createModelSelectionState,
  formatSelectedModelLabel,
  isModelSelectionStateEqual,
  isSelectedModelActive,
  persistSelectedModelConfig,
  resolveAgentModeForModel,
} from "../../../src/common/config/model-selection.ts";

Deno.test("resolveAgentModeForModel returns claude-code-agent for :agent models", () => {
  assertEquals(
    resolveAgentModeForModel("claude-code/claude-sonnet-4-5-20250929:agent"),
    "claude-code-agent",
  );
});

Deno.test("resolveAgentModeForModel returns hlvm for non-agent models", () => {
  assertEquals(
    resolveAgentModeForModel("ollama/llama3.2:latest"),
    "hlvm",
  );
  assertEquals(
    resolveAgentModeForModel("claude-code/claude-sonnet-4-5-20250929"),
    "hlvm",
  );
});

Deno.test("persistSelectedModelConfig uses patch when available", async () => {
  const patches: Array<Record<string, unknown>> = [];

  const normalized = await persistSelectedModelConfig({
    patch: async (updates) => {
      patches.push(updates as Record<string, unknown>);
    },
  }, "claude-code/claude-sonnet-4-5-20250929:agent");

  assertEquals(normalized, "claude-code/claude-sonnet-4-5-20250929:agent");
  assertEquals(patches.length, 1);
  assertEquals(patches[0].model, normalized);
  assertEquals(patches[0].modelConfigured, true);
  assertEquals(patches[0].agentMode, "claude-code-agent");
});

Deno.test("buildSelectedModelConfigUpdates normalizes model and derives state", () => {
  assertEquals(
    buildSelectedModelConfigUpdates("llama3.2:latest"),
    {
      model: "ollama/llama3.2:latest",
      modelConfigured: true,
      agentMode: "hlvm",
    },
  );
  assertEquals(
    buildSelectedModelConfigUpdates(
      "claude-code/claude-sonnet-4-5-20250929:agent",
    ),
    {
      model: "claude-code/claude-sonnet-4-5-20250929:agent",
      modelConfigured: true,
      agentMode: "claude-code-agent",
    },
  );
});

Deno.test("buildSelectedModelConfigUpdatesPreservingAgentMode omits agent mode while normalizing model", () => {
  assertEquals(
    buildSelectedModelConfigUpdatesPreservingAgentMode(
      "claude-code/claude-sonnet-4-5-20250929",
    ),
    {
      model: "claude-code/claude-sonnet-4-5-20250929",
      modelConfigured: true,
    },
  );
});

Deno.test("formatSelectedModelLabel preserves the normalized provider/model id", () => {
  assertEquals(
    formatSelectedModelLabel("ollama/llama3.2:latest"),
    "ollama/llama3.2:latest",
  );
  assertEquals(
    formatSelectedModelLabel("claude-code/claude-sonnet-4-6"),
    "claude-code/claude-sonnet-4-6",
  );
  assertEquals(
    formatSelectedModelLabel("llama3.2:latest"),
    "ollama/llama3.2:latest",
  );
  assertEquals(formatSelectedModelLabel(undefined), "");
});

Deno.test("createModelSelectionState keeps configured and active model ids in sync", () => {
  assertEquals(
    createModelSelectionState({
      model: "claude-code/claude-sonnet-4-6",
      modelConfigured: true,
    }),
    {
      configuredModelId: "claude-code/claude-sonnet-4-6",
      activeModelId: "claude-code/claude-sonnet-4-6",
      displayLabel: "claude-code/claude-sonnet-4-6",
      modelConfigured: true,
    },
  );

  assertEquals(
    createModelSelectionState(
      {
        model: "claude-code/claude-sonnet-4-6",
        modelConfigured: true,
      },
      "ollama/llama3.2:3b",
    ),
    {
      configuredModelId: "claude-code/claude-sonnet-4-6",
      activeModelId: "ollama/llama3.2:3b",
      displayLabel: "ollama/llama3.2:3b",
      modelConfigured: true,
    },
  );
});

Deno.test("isModelSelectionStateEqual detects meaningful model banner changes", () => {
  const baseline = createModelSelectionState({
    model: "claude-code/claude-sonnet-4-6",
    modelConfigured: true,
  });

  assertEquals(
    isModelSelectionStateEqual(
      baseline,
      createModelSelectionState({
        model: "claude-code/claude-sonnet-4-6",
        modelConfigured: true,
      }),
    ),
    true,
  );
  assertEquals(
    isModelSelectionStateEqual(
      baseline,
      createModelSelectionState(
        {
          model: "claude-code/claude-sonnet-4-6",
          modelConfigured: true,
        },
        "ollama/llama3.2:3b",
      ),
    ),
    false,
  );
});

Deno.test("isSelectedModelActive matches normalized ollama model ids", () => {
  assertEquals(
    isSelectedModelActive("llama3.2:latest", "ollama/llama3.2:latest"),
    true,
  );
  assertEquals(
    isSelectedModelActive("openai/gpt-4o", "openai/gpt-4o"),
    true,
  );
});

Deno.test("persistSelectedModelConfig falls back to sequential set and normalizes bare model names", async () => {
  const writes: Array<[string, unknown]> = [];

  const normalized = await persistSelectedModelConfig({
    set: async (key, value) => {
      writes.push([key, value]);
    },
  }, "llama3.2:latest");

  assertEquals(normalized, "ollama/llama3.2:latest");
  assertEquals(writes, [
    ["model", "ollama/llama3.2:latest"],
    ["modelConfigured", true],
    ["agentMode", "hlvm"],
  ]);
});

Deno.test("persistSelectedModelConfig throws when config API is unavailable", async () => {
  await assertRejects(
    () => persistSelectedModelConfig(undefined, "ollama/llama3.2:latest"),
    Error,
    "Configuration API not initialized",
  );
});
