import { assertEquals } from "jsr:@std/assert";
import {
  selectReasoningPathForTurn,
  getProviderProfiles,
  deriveRequiredCapabilities,
} from "../../../src/hlvm/agent/reasoning-selector.ts";
import { buildExecutionSurface } from "../../../src/hlvm/agent/execution-surface.ts";
import { resolveProviderExecutionPlan } from "../../../src/hlvm/agent/tool-capabilities.ts";

// Ensure providers are registered (side-effect import)
import "../../../src/hlvm/providers/index.ts";

/** Helper to build a minimal execution surface for selector tests */
function buildSurfaceForSelector(options: {
  pinnedProviderName: string;
  runtimeMode: "auto" | "manual";
  audioAttachment?: boolean;
  computerUseRequested?: boolean;
  hasNativeCodeExec?: boolean;
  requestedCapabilities?: string[];
}) {
  const hasWeb = ["google", "anthropic", "openai", "claude-code"].includes(options.pinnedProviderName);
  const hasCode = options.hasNativeCodeExec ?? false;

  return buildExecutionSurface({
    runtimeMode: options.runtimeMode,
    activeModelId: `${options.pinnedProviderName}/test-model`,
    pinnedProviderName: options.pinnedProviderName,
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: options.pinnedProviderName,
      nativeCapabilities: {
        webSearch: hasWeb,
        webPageRead: hasWeb,
        remoteCodeExecution: hasCode,
      },
      autoRequestedRemoteCodeExecution: hasCode,
    }),
    turnContext: options.audioAttachment
      ? {
          attachmentCount: 1,
          attachmentKinds: ["audio"],
          visionEligibleAttachmentCount: 0,
          visionEligibleKinds: [],
          audioEligibleAttachmentCount: 1,
          audioEligibleKinds: ["audio"],
        }
      : undefined,
    directAudioKinds: options.audioAttachment ? ["audio" as const] : [],
    computerUseRequested: options.computerUseRequested,
    taskCapabilityContext: options.requestedCapabilities
      ? {
          requestedCapabilities: options.requestedCapabilities as import("../../../src/hlvm/agent/semantic-capabilities.ts").SemanticCapabilityId[],
          source: "task-text" as const,
          matchedCueLabels: [],
        }
      : undefined,
  });
}

Deno.test("reasoning selector: returns null when pinned provider satisfies all capabilities", () => {
  const surface = buildSurfaceForSelector({
    pinnedProviderName: "google",
    runtimeMode: "auto",
  });

  const result = selectReasoningPathForTurn({
    pinnedModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    surface,
    availableProviders: ["google", "anthropic", "openai"],
  });

  assertEquals(result, null);
});

Deno.test("reasoning selector: switches to Google when audio needed and pinned is OpenAI", () => {
  const surface = buildSurfaceForSelector({
    pinnedProviderName: "openai",
    runtimeMode: "auto",
    audioAttachment: true,
  });

  const result = selectReasoningPathForTurn({
    pinnedModelId: "openai/gpt-4o",
    pinnedProviderName: "openai",
    surface,
    availableProviders: ["google", "anthropic", "openai"],
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["audio"],
      visionEligibleAttachmentCount: 0,
      visionEligibleKinds: [],
      audioEligibleAttachmentCount: 1,
      audioEligibleKinds: ["audio"],
    },
  });

  assertEquals(result?.selectedProviderName, "google");
  assertEquals(result?.switchedFromPinned, true);
});

Deno.test("reasoning selector: switches to Anthropic when computer.use needed and pinned is Google", () => {
  const surface = buildSurfaceForSelector({
    pinnedProviderName: "google",
    runtimeMode: "auto",
    computerUseRequested: true,
  });

  const result = selectReasoningPathForTurn({
    pinnedModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    surface,
    availableProviders: ["google", "anthropic", "openai"],
    computerUseRequested: true,
  });

  assertEquals(result?.selectedProviderName, "anthropic");
  assertEquals(result?.switchedFromPinned, true);
  assertEquals(result?.unsatisfiedCapabilities.includes("computer.use"), true);
});

Deno.test("reasoning selector: returns null in manual mode regardless of gaps", () => {
  const surface = buildSurfaceForSelector({
    pinnedProviderName: "ollama",
    runtimeMode: "manual",
    audioAttachment: true,
  });

  const result = selectReasoningPathForTurn({
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    surface,
    availableProviders: ["ollama", "google", "anthropic"],
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["audio"],
      visionEligibleAttachmentCount: 0,
      visionEligibleKinds: [],
      audioEligibleAttachmentCount: 1,
      audioEligibleKinds: ["audio"],
    },
  });

  assertEquals(result, null);
});

Deno.test("reasoning selector: returns null for local models when only basic chat needed", () => {
  const surface = buildSurfaceForSelector({
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
  });

  const result = selectReasoningPathForTurn({
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    surface,
    availableProviders: ["ollama", "google"],
  });

  assertEquals(result, null);
});

Deno.test("reasoning selector: getProviderProfiles reads capabilities from registry", () => {
  const profiles = getProviderProfiles();

  // Should have at least the cloud providers (google, anthropic, openai, claude-code)
  // Ollama is excluded because it has no representative model in REPRESENTATIVE_MODELS
  assertEquals(profiles.length >= 3, true);

  // Google should be first (cheapest)
  const google = profiles.find((p) => p.providerName === "google");
  assertEquals(google !== undefined, true);
  assertEquals(google!.capabilities.includes("media.audioInput"), true);

  // Anthropic should have computer.use
  const anthropic = profiles.find((p) => p.providerName === "anthropic");
  assertEquals(anthropic !== undefined, true);
  assertEquals(anthropic!.capabilities.includes("hosted.computerUse"), true);
});
