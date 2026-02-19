import { assertEquals } from "jsr:@std/assert";
import {
  autoConfigureInitialClaudeCodeModel,
  selectPreferredClaudeCodeModel,
} from "../../../src/common/ai-default-model.ts";
import { DEFAULT_MODEL_ID } from "../../../src/common/config/types.ts";
import type { ModelInfo } from "../../../src/hlvm/providers/types.ts";

let fakeNow = 0;
function nextNow(): number {
  fakeNow += 100_000;
  return fakeNow;
}

Deno.test("selectPreferredClaudeCodeModel prefers latest Sonnet before Opus/Haiku", () => {
  const models: ModelInfo[] = [
    { name: "claude-haiku-3-5-20241022" },
    { name: "claude-opus-4-1-20251101" },
    { name: "claude-sonnet-4-5-20250929" },
    { name: "claude-sonnet-4-5-20251015" },
  ];

  const selected = selectPreferredClaudeCodeModel(models);
  assertEquals(selected, "claude-sonnet-4-5-20251015");
});

Deno.test("selectPreferredClaudeCodeModel ignores :agent variants and provider-prefixed names", () => {
  const models: ModelInfo[] = [
    { name: "claude-code/claude-sonnet-4-5-20250929:agent" },
    { name: "claude-code/claude-opus-4-1-20251101" },
  ];

  const selected = selectPreferredClaudeCodeModel(models);
  assertEquals(selected, "claude-opus-4-1-20251101");
});

Deno.test("autoConfigureInitialClaudeCodeModel sets claude default for first-use users", async () => {
  const updates: Array<Record<string, unknown>> = [];
  let statusCalls = 0;
  let listCalls = 0;

  const result = await autoConfigureInitialClaudeCodeModel({
    getSnapshot: () => ({
      model: DEFAULT_MODEL_ID,
      modelConfigured: false,
      agentMode: undefined,
    }),
    getStatus: async () => {
      statusCalls++;
      return { available: true };
    },
    listModels: async () => {
      listCalls++;
      return [
        { name: "claude-sonnet-4-5-20251015" },
        { name: "claude-opus-4-1-20251101" },
      ];
    },
    patchConfig: async (patch) => {
      updates.push(patch as Record<string, unknown>);
    },
    now: () => nextNow(),
  });

  assertEquals(result, "claude-code/claude-sonnet-4-5-20251015");
  assertEquals(statusCalls, 1);
  assertEquals(listCalls, 1);
  assertEquals(updates.length, 1);
  assertEquals(updates[0].model, "claude-code/claude-sonnet-4-5-20251015");
  assertEquals(updates[0].modelConfigured, true);
  assertEquals(updates[0].agentMode, "hlvm");
});

Deno.test("autoConfigureInitialClaudeCodeModel preserves existing agentMode", async () => {
  const updates: Array<Record<string, unknown>> = [];

  await autoConfigureInitialClaudeCodeModel({
    getSnapshot: () => ({
      model: DEFAULT_MODEL_ID,
      modelConfigured: false,
      agentMode: "claude-code-agent",
    }),
    getStatus: async () => ({ available: true }),
    listModels: async () => [{ name: "claude-sonnet-4-5-20251015" }],
    patchConfig: async (patch) => {
      updates.push(patch as Record<string, unknown>);
    },
    now: () => nextNow(),
  });

  assertEquals(updates.length, 1);
  assertEquals("agentMode" in updates[0], false);
});

Deno.test("autoConfigureInitialClaudeCodeModel does nothing when model is already configured", async () => {
  let statusCalls = 0;
  let listCalls = 0;
  let patchCalls = 0;

  const result = await autoConfigureInitialClaudeCodeModel({
    getSnapshot: () => ({
      model: "ollama/llama3.1:8b",
      modelConfigured: true,
      agentMode: undefined,
    }),
    getStatus: async () => {
      statusCalls++;
      return { available: true };
    },
    listModels: async () => {
      listCalls++;
      return [];
    },
    patchConfig: async () => {
      patchCalls++;
    },
    now: () => nextNow(),
  });

  assertEquals(result, null);
  assertEquals(statusCalls, 0);
  assertEquals(listCalls, 0);
  assertEquals(patchCalls, 0);
});

Deno.test("autoConfigureInitialClaudeCodeModel does nothing when claude-code is unavailable", async () => {
  let statusCalls = 0;
  let listCalls = 0;
  let patchCalls = 0;

  const result = await autoConfigureInitialClaudeCodeModel({
    getSnapshot: () => ({
      model: DEFAULT_MODEL_ID,
      modelConfigured: false,
      agentMode: undefined,
    }),
    getStatus: async () => {
      statusCalls++;
      return { available: false };
    },
    listModels: async () => {
      listCalls++;
      return [{ name: "claude-sonnet-4-5-20251015" }];
    },
    patchConfig: async () => {
      patchCalls++;
    },
    now: () => nextNow(),
  });

  assertEquals(result, null);
  assertEquals(statusCalls, 1);
  assertEquals(listCalls, 0);
  assertEquals(patchCalls, 0);
});
