/**
 * Reasoning Model/Provider Auto-Selection
 *
 * In auto mode, selects a more capable model/provider at turn start when
 * the pinned path cannot satisfy the task's requirements.
 *
 * Design constraints:
 * - configured-first: always try the pinned model first
 * - Only switch when pinned path provably cannot satisfy requested capabilities
 * - Choose once at turn start — no mid-turn switching
 * - Auto-mode only — manual mode never triggers selection
 */

import type { ProviderCapability } from "../providers/types.ts";
import { getProviderCapabilities, listRegisteredProviders } from "../providers/registry.ts";
import type { ExecutionSurface, CapabilityRoutingDecision, RoutedCapabilityId } from "./execution-surface.ts";
import type { ExecutionTurnContext } from "./turn-context.ts";
import { hasVisionRelevantTurnContext, hasAudioRelevantTurnContext } from "./turn-context.ts";

/** Result of reasoning path selection at turn start */
export interface ReasoningSelectionResult {
  /** The model ID selected for this turn */
  selectedModelId: string;
  /** The provider name for the selected model */
  selectedProviderName: string;
  /** Human-readable reason for the selection */
  reason: string;
  /** Whether the selection differs from the pinned model */
  switchedFromPinned: boolean;
  /** Which capabilities were unsatisfied by the pinned path */
  unsatisfiedCapabilities: RoutedCapabilityId[];
}

/** Provider capability profile for selection decisions */
export interface ProviderProfile {
  providerName: string;
  capabilities: ProviderCapability[];
  /** A representative model ID to switch to (first available) */
  representativeModelId: string;
}

/**
 * Representative model IDs per provider — needed for the switching
 * recommendation since the registry doesn't track specific model IDs.
 * Order determines cost preference: Google (cheapest) > OpenAI > Anthropic.
 */
const REPRESENTATIVE_MODELS: Record<string, string> = {
  google: "google/gemini-2.0-flash",
  openai: "openai/gpt-4o",
  anthropic: "anthropic/claude-sonnet-4-5-20250929",
  "claude-code": "anthropic/claude-sonnet-4-5-20250929",
};

/** Cost-preference order: cheapest first */
const COST_PREFERENCE_ORDER = ["google", "openai", "anthropic", "claude-code"];

/**
 * Build provider profiles dynamically from the registry.
 * Falls back gracefully for providers without registered capabilities.
 */
export function getProviderProfiles(): ProviderProfile[] {
  const registered = listRegisteredProviders();
  const profiles: ProviderProfile[] = [];

  // Sort by cost preference order, then append any unknown providers
  const ordered = [...registered].sort((a, b) => {
    const aIdx = COST_PREFERENCE_ORDER.indexOf(a);
    const bIdx = COST_PREFERENCE_ORDER.indexOf(b);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  for (const name of ordered) {
    const capabilities = getProviderCapabilities(name);
    const modelId = REPRESENTATIVE_MODELS[name];
    // Skip providers without capabilities or representative models
    // (e.g. ollama — local models don't participate in cloud switching)
    if (!capabilities || !modelId) continue;
    profiles.push({ providerName: name, capabilities, representativeModelId: modelId });
  }

  return profiles;
}

/**
 * Determine which capabilities the current turn requires based on
 * the execution surface routing decisions and turn context.
 */
export function deriveRequiredCapabilities(
  surface: ExecutionSurface,
  turnContext?: ExecutionTurnContext,
  computerUseRequested?: boolean,
): ProviderCapability[] {
  // NOTE: We deliberately do NOT derive required capabilities from the surface
  // capability fallback reasons. The surface always populates fallback reasons
  // for ALL capabilities (even those not needed for this turn), which would
  // cause false positives. Instead, we only consider turn-specific signals
  // below (audio/vision attachments, computerUseRequested).
  const required: ProviderCapability[] = ["chat"];

  if (turnContext && hasVisionRelevantTurnContext(turnContext)) {
    required.push("vision");
  }
  if (turnContext && hasAudioRelevantTurnContext(turnContext)) {
    required.push("media.audioInput");
  }
  if (computerUseRequested) {
    required.push("hosted.computerUse");
  }

  return required;
}

/**
 * Check if a provider profile can satisfy all required capabilities.
 */
function canSatisfy(
  profile: ProviderProfile,
  required: ProviderCapability[],
): boolean {
  const available = new Set(profile.capabilities);
  return required.every((cap) => available.has(cap));
}

/**
 * Select the reasoning path for the current turn.
 *
 * Returns null if the pinned model satisfies all requirements (no switch needed).
 * Returns a ReasoningSelectionResult if a switch is recommended.
 *
 * @param pinnedModelId - The user's configured/pinned model
 * @param pinnedProviderName - Provider name extracted from pinned model
 * @param surface - The resolved execution surface for this turn
 * @param availableProviders - Provider names that are currently available
 * @param turnContext - Current turn's attachment/context info
 * @param computerUseRequested - Whether computer.use was explicitly requested
 */
export function selectReasoningPathForTurn(options: {
  pinnedModelId: string;
  pinnedProviderName: string;
  surface: ExecutionSurface;
  availableProviders: string[];
  turnContext?: ExecutionTurnContext;
  computerUseRequested?: boolean;
  localVisionModelId?: string;
}): ReasoningSelectionResult | null {
  const {
    pinnedModelId,
    pinnedProviderName,
    surface,
    availableProviders,
    turnContext,
    computerUseRequested,
    localVisionModelId,
  } = options;

  // Manual mode never triggers selection
  if (surface.runtimeMode !== "auto") return null;

  // Derive what this turn needs
  const required = deriveRequiredCapabilities(surface, turnContext, computerUseRequested);

  // Build profiles dynamically from the registry
  const profiles = getProviderProfiles();

  // Find the pinned provider's profile
  const pinnedProfile = profiles.find(
    (p) => p.providerName === pinnedProviderName,
  );

  // If pinned provider satisfies everything, no switch needed
  if (pinnedProfile && canSatisfy(pinnedProfile, required)) {
    return null;
  }

  // For local/ollama models with no profile, check if any special capabilities are needed
  if (!pinnedProfile) {
    // Local models only have chat + tools + maybe vision
    // If only chat is required, no switch needed
    if (required.length === 1 && required[0] === "chat") {
      return null;
    }
  }

  // Find unsatisfied capabilities
  const unsatisfied = required.filter((cap) => {
    if (cap === "chat") return false; // All providers have chat
    return !pinnedProfile?.capabilities.includes(cap);
  });

  if (unsatisfied.length === 0) return null;

  // If pinned provider is local (ollama) and vision is needed, prefer switching
  // to a local vision model over cloud — respects the user's intent to stay local.
  if (
    localVisionModelId &&
    unsatisfied.includes("vision") &&
    !pinnedProfile // Ollama has no profile in REPRESENTATIVE_MODELS
  ) {
    return {
      selectedModelId: localVisionModelId,
      selectedProviderName: "ollama",
      reason: `Pinned model ${pinnedModelId} lacks vision. ` +
        `Switching to local vision model ${localVisionModelId} for this turn.`,
      switchedFromPinned: true,
      unsatisfiedCapabilities: unsatisfied.flatMap((cap): RoutedCapabilityId[] => {
        switch (cap) {
          case "vision": return ["vision.analyze"];
          case "hosted.webSearch": return ["web.search"];
          case "hosted.codeExecution": return ["code.exec"];
          case "media.audioInput": return ["audio.analyze"];
          case "hosted.computerUse": return ["computer.use"];
          default: return [];
        }
      }),
    };
  }

  // Find the cheapest available alternative that satisfies all requirements
  // Priority: keep cost low — prefer Google > OpenAI > Anthropic for general tasks
  const candidates = profiles
    .filter((p) => p.providerName !== pinnedProviderName)
    .filter((p) => availableProviders.includes(p.providerName))
    .filter((p) => canSatisfy(p, required));

  if (candidates.length === 0) {
    // No available provider can satisfy — stay with pinned
    return null;
  }

  const selected = candidates[0]; // First match (ordered by cost preference)

  // Map unsatisfied ProviderCapability back to RoutedCapabilityId for reporting
  const unsatisfiedCapabilities: RoutedCapabilityId[] = [];
  for (const cap of unsatisfied) {
    switch (cap) {
      case "hosted.webSearch":
        unsatisfiedCapabilities.push("web.search");
        break;
      case "hosted.codeExecution":
        unsatisfiedCapabilities.push("code.exec");
        break;
      case "media.audioInput":
        unsatisfiedCapabilities.push("audio.analyze");
        break;
      case "hosted.computerUse":
        unsatisfiedCapabilities.push("computer.use");
        break;
    }
  }

  return {
    selectedModelId: selected.representativeModelId,
    selectedProviderName: selected.providerName,
    reason: `Pinned model ${pinnedModelId} lacks: ${unsatisfied.join(", ")}. ` +
      `Switching to ${selected.providerName} for this turn.`,
    switchedFromPinned: true,
    unsatisfiedCapabilities,
  };
}
