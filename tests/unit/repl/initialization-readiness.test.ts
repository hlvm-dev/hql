import { assertEquals } from "jsr:@std/assert@1";
import { resolveInitializationReadinessState } from "../../../src/hlvm/cli/repl-ink/hooks/useInitialization.ts";
import type { ConfiguredModelReadiness } from "../../../src/hlvm/runtime/configured-model-readiness.ts";

const setupRequiredReadiness = {
  modelId: "ollama/llama3.2:3b",
  modelName: "llama3.2:3b",
  providerName: "ollama",
  supportsLocalInstall: true,
  providerAvailable: true,
  modelAvailable: false,
  requiresLocalInstall: true,
  state: "setup_required",
} satisfies ConfiguredModelReadiness;

Deno.test("resolveInitializationReadinessState preserves setup-required models when AI helpers are loaded", () => {
  assertEquals(
    resolveInitializationReadinessState(setupRequiredReadiness, true),
    {
      aiReadiness: "setup_required",
      needsModelSetup: true,
      modelToSetup: "llama3.2:3b",
    },
  );
});

Deno.test("resolveInitializationReadinessState downgrades readiness when AI helpers are unavailable", () => {
  assertEquals(
    resolveInitializationReadinessState(setupRequiredReadiness, false),
    {
      aiReadiness: "unavailable",
      needsModelSetup: true,
      modelToSetup: "llama3.2:3b",
    },
  );
  assertEquals(
    resolveInitializationReadinessState({
      ...setupRequiredReadiness,
      modelAvailable: true,
      requiresLocalInstall: false,
      state: "available",
    }, true),
    {
      aiReadiness: "available",
      needsModelSetup: false,
      modelToSetup: "",
    },
  );
});
