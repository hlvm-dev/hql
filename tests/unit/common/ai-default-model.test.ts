import { assertEquals } from "jsr:@std/assert";
import {
  autoConfigureInitialClaudeCodeModel,
  ensureInitialModelConfigured,
  reconcileConfiguredClaudeCodeModel,
  resolveCompatibleClaudeCodeModel,
  selectPreferredClaudeCodeModel,
} from "../../../src/common/ai-default-model.ts";
import { AUTO_MODEL_ID, DEFAULT_MODEL_ID } from "../../../src/common/config/types.ts";
import type { ConfigKey } from "../../../src/common/config/types.ts";
import type { ModelInfo } from "../../../src/hlvm/providers/types.ts";

let fakeNow = 0;
function nextNow(): number {
  fakeNow += 100_000;
  return fakeNow;
}

Deno.test("ai default model: selection prefers newest supported Sonnet and skips unusable aliases", () => {
  const ranked: ModelInfo[] = [
    { name: "claude-haiku-3-5-20241022" },
    { name: "claude-opus-4-1-20251101" },
    { name: "claude-sonnet-4-5-20250929" },
    { name: "claude-sonnet-4-5-20251015" },
  ];
  const filtered: ModelInfo[] = [
    { name: "claude-code/claude-sonnet-4-5-20250929:agent" },
    { name: "claude-code/claude-opus-4-1-20251101" },
  ];
  const dottedOnly: ModelInfo[] = [
    { name: "claude-sonnet-4.5" },
    { name: "claude-opus-4.6" },
  ];

  assertEquals(
    selectPreferredClaudeCodeModel(ranked),
    "claude-sonnet-4-5-20251015",
  );
  assertEquals(
    selectPreferredClaudeCodeModel(filtered),
    "claude-opus-4-1-20251101",
  );
  assertEquals(selectPreferredClaudeCodeModel(dottedOnly), null);
});

Deno.test("ai default model: first-use auto-configuration sets a Claude default and preserves explicit agent mode", async () => {
  const firstUseUpdates: Array<Record<string, unknown>> = [];
  const preservedModeUpdates: Array<Record<string, unknown>> = [];

  const firstUse = await autoConfigureInitialClaudeCodeModel({
    getSnapshot: () => ({
      model: DEFAULT_MODEL_ID,
      modelConfigured: false,
      agentMode: undefined,
    }),
    getStatus: () => Promise.resolve({ available: true }),
    listModels: () =>
      Promise.resolve([
        { name: "claude-sonnet-4-5-20251015" },
        { name: "claude-opus-4-1-20251101" },
      ]),
    patchConfig: (patch) => {
      firstUseUpdates.push(patch as Record<string, unknown>);
      return Promise.resolve();
    },
    now: () => nextNow(),
  });

  await autoConfigureInitialClaudeCodeModel({
    getSnapshot: () => ({
      model: DEFAULT_MODEL_ID,
      modelConfigured: false,
      agentMode: "claude-code-agent",
    }),
    getStatus: () => Promise.resolve({ available: true }),
    listModels: () => Promise.resolve([{ name: "claude-sonnet-4-5-20251015" }]),
    patchConfig: (patch) => {
      preservedModeUpdates.push(patch as Record<string, unknown>);
      return Promise.resolve();
    },
    now: () => nextNow(),
  });

  assertEquals(firstUse, "claude-code/claude-sonnet-4-5-20251015");
  assertEquals(firstUseUpdates.length, 1);
  assertEquals(
    firstUseUpdates[0].model,
    "claude-code/claude-sonnet-4-5-20251015",
  );
  assertEquals(firstUseUpdates[0].modelConfigured, true);
  assertEquals(firstUseUpdates[0].agentMode, "hlvm");
  assertEquals(preservedModeUpdates.length, 1);
  assertEquals("agentMode" in preservedModeUpdates[0], false);
});

Deno.test("ai default model: auto-configuration no-ops when model is already configured or Claude Code is unavailable", async () => {
  let configuredStatusCalls = 0;
  let configuredPatchCalls = 0;
  let unavailableListCalls = 0;
  let unavailablePatchCalls = 0;

  const configured = await autoConfigureInitialClaudeCodeModel({
    getSnapshot: () => ({
      model: "ollama/llama3.1:8b",
      modelConfigured: true,
      agentMode: undefined,
    }),
    getStatus: () => {
      configuredStatusCalls++;
      return Promise.resolve({ available: true });
    },
    listModels: () => Promise.resolve([]),
    patchConfig: () => {
      configuredPatchCalls++;
      return Promise.resolve();
    },
    now: () => nextNow(),
  });

  const unavailable = await autoConfigureInitialClaudeCodeModel({
    getSnapshot: () => ({
      model: DEFAULT_MODEL_ID,
      modelConfigured: false,
      agentMode: undefined,
    }),
    getStatus: () => Promise.resolve({ available: false }),
    listModels: () => {
      unavailableListCalls++;
      return Promise.resolve([{ name: "claude-sonnet-4-5-20251015" }]);
    },
    patchConfig: () => {
      unavailablePatchCalls++;
      return Promise.resolve();
    },
    now: () => nextNow(),
  });

  assertEquals(configured, null);
  assertEquals(configuredStatusCalls, 0);
  assertEquals(configuredPatchCalls, 0);
  assertEquals(unavailable, null);
  assertEquals(unavailableListCalls, 0);
  assertEquals(unavailablePatchCalls, 0);
});

Deno.test("ai default model: reconcile and resolve normalize dotted Claude aliases but leave valid non-Claude models unchanged", async () => {
  const updates: Array<Record<string, unknown>> = [];

  const reconciled = await reconcileConfiguredClaudeCodeModel({
    getSnapshot: () => ({ model: "claude-code/claude-sonnet-4.5" }),
    listModels: () =>
      Promise.resolve([
        { name: "claude-sonnet-4-6" },
        { name: "claude-sonnet-4-5-20250929" },
        { name: "claude-opus-4-6" },
      ]),
    patchConfig: (patch) => {
      updates.push(patch as Record<string, unknown>);
      return Promise.resolve();
    },
  });

  const noOp = await reconcileConfiguredClaudeCodeModel({
    getSnapshot: () => ({ model: "claude-code/claude-sonnet-4-6" }),
    listModels: () =>
      Promise.resolve([
        { name: "claude-sonnet-4-6" },
        { name: "claude-sonnet-4-5-20250929" },
      ]),
    patchConfig: () => Promise.resolve(),
  });

  const resolvedClaude = await resolveCompatibleClaudeCodeModel(
    "claude-code/claude-sonnet-4.5",
    {
      listModels: () =>
        Promise.resolve([
          { name: "claude-sonnet-4-6" },
          { name: "claude-sonnet-4-5-20250929" },
          { name: "claude-opus-4-6" },
        ]),
    },
  );
  const resolvedOther = await resolveCompatibleClaudeCodeModel("openai/gpt-5", {
    listModels: () => Promise.resolve([]),
  });

  assertEquals(reconciled, "claude-code/claude-sonnet-4-5-20250929");
  assertEquals(updates.length, 1);
  assertEquals(updates[0].model, "claude-code/claude-sonnet-4-5-20250929");
  assertEquals(noOp, null);
  assertEquals(resolvedClaude, "claude-code/claude-sonnet-4-5-20250929");
  assertEquals(resolvedOther, "openai/gpt-5");
});

Deno.test("ai default model: unified initial-model resolver runs first-time setup when Claude bootstrap is unavailable", async () => {
  let snapshot = {
    model: DEFAULT_MODEL_ID,
    modelConfigured: false,
    agentMode: undefined as "hlvm" | undefined,
  };
  let firstRunCalls = 0;

  const resolved = await ensureInitialModelConfigured(
    {
      allowFirstRunSetup: true,
      runFirstTimeSetup: async () => {
        firstRunCalls++;
        snapshot = {
          model: "ollama/deepseek-r1:70b-cloud",
          modelConfigured: true,
          agentMode: "hlvm",
        };
        return snapshot.model;
      },
    },
    {
      getSnapshot: () => snapshot,
      listModels: () => Promise.resolve([]),
      patchConfig: () => Promise.resolve(),
      syncSnapshot: () => Promise.resolve(snapshot),
    },
  );

  // patchConfig is a no-op so auto-upgrade doesn't persist → falls through to first-run setup
  assertEquals(firstRunCalls, 1);
  assertEquals(resolved.model, "ollama/deepseek-r1:70b-cloud");
  assertEquals(resolved.modelConfigured, true);
  assertEquals(resolved.firstRunConfigured, true);
  assertEquals(resolved.reconciledClaudeModel, false);
});

Deno.test("ai default model: unified initial-model resolver upgrades legacy defaults to auto routing", async () => {
  let snapshot = {
    model: "ollama/llama3.1:8b",
    modelConfigured: false,
    agentMode: undefined as "hlvm" | undefined,
  };

  const resolved = await ensureInitialModelConfigured(
    {
      allowFirstRunSetup: true,
      runFirstTimeSetup: async () => {
        throw new Error("first-run setup should not be called after auto upgrade");
      },
    },
    {
      getSnapshot: () => snapshot,
      listModels: () => Promise.resolve([]),
      patchConfig: (patch) => {
        snapshot = {
          ...snapshot,
          ...(patch as Partial<Record<ConfigKey, unknown>>),
        } as typeof snapshot;
        return Promise.resolve();
      },
      syncSnapshot: () => Promise.resolve(snapshot),
    },
  );

  assertEquals(resolved.model, AUTO_MODEL_ID);
  assertEquals(resolved.modelConfigured, true);
  assertEquals(resolved.autoConfiguredLocalFallback, true);
  assertEquals(resolved.firstRunConfigured, false);
  assertEquals(resolved.reconciledClaudeModel, false);
});

Deno.test("ai default model: unified initial-model resolver upgrades gemma4 legacy default to auto without cloud override", async () => {
  let snapshot = {
    model: "ollama/gemma4:e4b",
    modelConfigured: false,
    agentMode: undefined as "hlvm" | undefined,
  };

  const resolved = await ensureInitialModelConfigured(
    {
      allowFirstRunSetup: false,
    },
    {
      getSnapshot: () => snapshot,
      listModels: () => Promise.resolve([]),
      patchConfig: (patch) => {
        snapshot = {
          ...snapshot,
          ...(patch as Partial<Record<ConfigKey, unknown>>),
        } as typeof snapshot;
        return Promise.resolve();
      },
      syncSnapshot: () => Promise.resolve(snapshot),
    },
  );

  assertEquals(resolved.model, AUTO_MODEL_ID);
  assertEquals(resolved.modelConfigured, true);
  assertEquals(resolved.autoConfiguredLocalFallback, true);
  assertEquals(resolved.firstRunConfigured, false);
  assertEquals(resolved.reconciledClaudeModel, false);
});

Deno.test("ai default model: unified initial-model resolver respects explicitly configured legacy model", async () => {
  const snapshot = {
    model: "ollama/gemma4:e4b",
    modelConfigured: true,
    agentMode: "hlvm" as const,
  };

  const resolved = await ensureInitialModelConfigured(
    {},
    {
      getSnapshot: () => snapshot,
      listModels: () => Promise.resolve([]),
      patchConfig: () => Promise.resolve(),
      syncSnapshot: () => Promise.resolve(snapshot),
    },
  );

  // modelConfigured: true means user explicitly chose this — never override
  assertEquals(resolved.model, "ollama/gemma4:e4b");
  assertEquals(resolved.modelConfigured, true);
  assertEquals(resolved.autoConfiguredLocalFallback, false);
  assertEquals(resolved.firstRunConfigured, false);
  assertEquals(resolved.reconciledClaudeModel, false);
});

Deno.test("ai default model: unified initial-model resolver repairs configured Claude aliases", async () => {
  let snapshot = {
    model: "claude-code/claude-sonnet-4.5",
    modelConfigured: true,
    agentMode: "hlvm" as const,
  };

  const resolved = await ensureInitialModelConfigured(
    {},
    {
      getSnapshot: () => snapshot,
      listModels: () =>
        Promise.resolve([
          { name: "claude-sonnet-4-6" },
          { name: "claude-sonnet-4-5-20250929" },
        ]),
      patchConfig: (patch) => {
        snapshot = {
          ...snapshot,
          ...(patch as Partial<Record<ConfigKey, unknown>>),
        } as typeof snapshot;
        return Promise.resolve();
      },
      syncSnapshot: () => Promise.resolve(snapshot),
    },
  );

  assertEquals(resolved.model, "claude-code/claude-sonnet-4-5-20250929");
  assertEquals(resolved.modelConfigured, true);
  assertEquals(resolved.firstRunConfigured, false);
  assertEquals(resolved.reconciledClaudeModel, true);
});
