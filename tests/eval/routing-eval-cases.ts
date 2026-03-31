/**
 * Routing Eval Cases — 40 cases across 7 dimensions
 *
 * Dimensions: privacy, locality, capability-fit, quality, cost, availability, mcp-fallback
 */

import type { RoutingEvalCase } from "../../src/hlvm/agent/routing-eval.ts";
import type { RoutingConstraintSet } from "../../src/hlvm/agent/routing-constraints.ts";

// ============================================================================
// Constraint presets
// ============================================================================

const NO_CONSTRAINTS: RoutingConstraintSet = {
  hardConstraints: [],
  preferenceConflict: false,
  source: "none",
};

const LOCAL_ONLY: RoutingConstraintSet = {
  hardConstraints: ["local-only"],
  preferenceConflict: false,
  source: "task-text",
};

const NO_UPLOAD: RoutingConstraintSet = {
  hardConstraints: ["no-upload"],
  preferenceConflict: false,
  source: "task-text",
};

const PREFER_CHEAP: RoutingConstraintSet = {
  hardConstraints: [],
  preference: "cheap",
  preferenceConflict: false,
  source: "task-text",
};

const PREFER_QUALITY: RoutingConstraintSet = {
  hardConstraints: [],
  preference: "quality",
  preferenceConflict: false,
  source: "task-text",
};

const CONFLICTING_PREFS: RoutingConstraintSet = {
  hardConstraints: [],
  preference: "cheap",
  preferenceConflict: true,
  source: "task-text",
};

// ============================================================================
// Privacy dimension (4 cases)
// ============================================================================

const privacyCases: RoutingEvalCase[] = [
  {
    id: "privacy-1",
    name: "local-only routes web to hlvm-local (DuckDuckGo)",
    dimension: "privacy",
    scenario: "User says 'analyze my private document locally' → local-only constraint",
    constraints: LOCAL_ONLY,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    expectations: [
      {
        capabilityId: "web.search",
        expectedBackendKind: "hlvm-local",
        dimension: "privacy",
        description: "web.search routes to hlvm-local (DuckDuckGo) under local-only",
      },
      {
        capabilityId: "web.read",
        expectedBackendKind: "hlvm-local",
        dimension: "privacy",
        description: "web.read routes to hlvm-local (Readability) under local-only",
      },
    ],
  },
  {
    id: "privacy-2",
    name: "local-only keeps code.exec on hlvm-local",
    dimension: "privacy",
    scenario: "User says 'keep everything local' → local-only constraint, code.exec requested",
    constraints: LOCAL_ONLY,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    requestedCapabilities: ["code.exec"],
    expectations: [
      {
        capabilityId: "code.exec",
        expectedBackendKind: "hlvm-local",
        dimension: "privacy",
        description: "code.exec should stay on hlvm-local under local-only",
      },
    ],
  },
  {
    id: "privacy-3",
    name: "no-upload prevents vision upload to cloud",
    dimension: "privacy",
    scenario: "User says 'don't upload my files' with image attachment",
    constraints: NO_UPLOAD,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    visionAttachmentCount: 1,
    expectations: [
      {
        capabilityId: "vision.analyze",
        expectFallback: true,
        dimension: "privacy",
        description: "vision.analyze should not route when no-upload is active (local models lack vision)",
      },
    ],
  },
  {
    id: "privacy-4",
    name: "no-upload with cloud provider still blocks",
    dimension: "privacy",
    scenario: "User says 'don't upload' while pinned to Google with vision",
    constraints: NO_UPLOAD,
    pinnedModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    runtimeMode: "auto",
    visionAttachmentCount: 1,
    expectations: [
      {
        capabilityId: "vision.analyze",
        expectFallback: true,
        dimension: "privacy",
        description: "vision.analyze should not route when no-upload blocks attachment sending",
      },
    ],
  },
];

// ============================================================================
// Locality dimension (4 cases)
// ============================================================================

const localityCases: RoutingEvalCase[] = [
  {
    id: "locality-1",
    name: "local-only with ollama: web routes to hlvm-local",
    dimension: "locality",
    scenario: "User pins local model with local-only constraint",
    constraints: LOCAL_ONLY,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    expectations: [
      {
        capabilityId: "web.search",
        expectedBackendKind: "hlvm-local",
        dimension: "locality",
        description: "web.search routes to hlvm-local under local-only + ollama",
      },
      {
        expectReasoningSwitch: false,
        dimension: "locality",
        description: "no reasoning switch under local-only (hard constraint blocks cloud)",
      },
    ],
  },
  {
    id: "locality-2",
    name: "local-only allows hlvm-local structured output",
    dimension: "locality",
    scenario: "local-only should not prevent use of HLVM's own local tools including prompt-based structured output",
    constraints: LOCAL_ONLY,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    responseShapeContext: { requested: true, source: "task-text", topLevelKeys: ["name"] },
    expectations: [
      {
        capabilityId: "structured.output",
        expectedBackendKind: "hlvm-local",
        dimension: "locality",
        description: "structured.output routes to hlvm-local prompt-based extraction under local-only",
      },
    ],
  },
  {
    id: "locality-3",
    name: "manual mode ignores constraints",
    dimension: "locality",
    scenario: "Manual mode should not apply auto-routing at all",
    constraints: LOCAL_ONLY,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "manual",
    expectations: [
      {
        expectReasoningSwitch: false,
        dimension: "locality",
        description: "manual mode never triggers reasoning selection",
      },
    ],
  },
  {
    id: "locality-4",
    name: "local-only blocks computer.use (requires cloud)",
    dimension: "locality",
    scenario: "computer.use needs Anthropic — blocked by local-only",
    constraints: LOCAL_ONLY,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    computerUseRequested: true,
    expectations: [
      {
        capabilityId: "computer.use",
        expectFallback: true,
        dimension: "locality",
        description: "computer.use should fail under local-only",
      },
    ],
  },
];

// ============================================================================
// Capability fit dimension (4 cases)
// ============================================================================

const capabilityFitCases: RoutingEvalCase[] = [
  {
    id: "capfit-1",
    name: "audio attachment routes to audio.analyze, not vision",
    dimension: "capability-fit",
    scenario: "Audio file attached — should activate audio.analyze, not vision.analyze",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    runtimeMode: "auto",
    audioAttachmentCount: 1,
    expectations: [
      {
        capabilityId: "audio.analyze",
        expectedBackendKind: "provider-native",
        dimension: "capability-fit",
        description: "audio attachment should activate audio.analyze provider-native",
      },
    ],
  },
  {
    id: "capfit-2",
    name: "vision attachment on vision-capable provider",
    dimension: "capability-fit",
    scenario: "Image attached with Google provider — should route to vision.analyze",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    runtimeMode: "auto",
    visionAttachmentCount: 1,
    expectations: [
      {
        capabilityId: "vision.analyze",
        expectedBackendKind: "provider-native",
        dimension: "capability-fit",
        description: "image attachment should activate vision.analyze provider-native",
      },
    ],
  },
  {
    id: "capfit-3",
    name: "computer.use only when explicitly requested",
    dimension: "capability-fit",
    scenario: "computer.use should NOT activate without explicit request",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "anthropic/claude-sonnet-4-5-20250929",
    pinnedProviderName: "anthropic",
    runtimeMode: "auto",
    computerUseRequested: false,
    expectations: [
      {
        capabilityId: "computer.use",
        expectFallback: true,
        dimension: "capability-fit",
        description: "computer.use should not activate without explicit request",
      },
    ],
  },
  {
    id: "capfit-4",
    name: "computer.use activates when explicitly requested",
    dimension: "capability-fit",
    scenario: "computer.use should activate when ChatRequest.computer_use=true",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "anthropic/claude-sonnet-4-5-20250929",
    pinnedProviderName: "anthropic",
    runtimeMode: "auto",
    computerUseRequested: true,
    expectations: [
      {
        capabilityId: "computer.use",
        expectedBackendKind: "provider-native",
        dimension: "capability-fit",
        description: "computer.use should activate with explicit request on Anthropic",
      },
    ],
  },
  {
    id: "capfit-5",
    name: "OpenAI pinned + audio → reasoning switch to Google",
    dimension: "capability-fit",
    scenario: "OpenAI cannot handle audio; reasoning selector should switch to Google",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "openai/gpt-4.1-mini",
    pinnedProviderName: "openai",
    runtimeMode: "auto",
    audioAttachmentCount: 1,
    expectations: [
      {
        expectReasoningSwitch: true,
        dimension: "capability-fit",
        description: "OpenAI cannot handle audio; reasoning selector should switch to Google",
      },
    ],
  },
  {
    id: "capfit-6",
    name: "Google pinned + computer.use → reasoning switch to Anthropic",
    dimension: "capability-fit",
    scenario: "Google cannot do computer.use; reasoning selector should switch to Anthropic",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    runtimeMode: "auto",
    computerUseRequested: true,
    expectations: [
      {
        expectReasoningSwitch: true,
        dimension: "capability-fit",
        description: "Google cannot do computer.use; reasoning selector should switch to Anthropic",
      },
    ],
  },
  {
    id: "capfit-7",
    name: "Ollama pinned + vision → reasoning switch",
    dimension: "capability-fit",
    scenario: "Ollama lacks vision; reasoning selector should switch to a cloud provider",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    visionAttachmentCount: 1,
    expectations: [
      {
        expectReasoningSwitch: true,
        dimension: "capability-fit",
        description: "Ollama lacks vision; reasoning selector should switch",
      },
    ],
  },
  {
    id: "capfit-8",
    name: "Ollama non-vision + local vision model installed → hlvm-local reachable",
    dimension: "capability-fit",
    scenario: "Ollama non-vision model pinned, vision attachment, local vision model installed → hlvm-local reachable",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    visionAttachmentCount: 1,
    localVisionAvailable: true,
    expectations: [
      {
        capabilityId: "vision.analyze",
        expectedBackendKind: "hlvm-local",
        dimension: "capability-fit",
        description: "vision.analyze routes to hlvm-local when local vision model installed",
      },
    ],
  },
  {
    id: "capfit-9",
    name: "Ollama non-vision + local vision model → reasoning switch to local vision",
    dimension: "capability-fit",
    scenario: "User pins ollama/llama3.1:8b (non-vision), has llava installed, sends image",
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    visionAttachmentCount: 1,
    localVisionAvailable: true,
    localVisionModelId: "ollama/llava:latest",
    constraints: NO_CONSTRAINTS,
    expectations: [
      {
        dimension: "capability-fit",
        description: "reasoning selector switches to local Ollama vision model (not cloud)",
        expectReasoningSwitch: true,
      },
    ],
  },
];

// ============================================================================
// Quality dimension (4 cases)
// ============================================================================

const qualityCases: RoutingEvalCase[] = [
  {
    id: "quality-1",
    name: "quality preference keeps provider-native when available",
    dimension: "quality",
    scenario: "User prefers quality → provider-native should be selected when available",
    constraints: PREFER_QUALITY,
    pinnedModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    runtimeMode: "auto",
    expectations: [
      {
        capabilityId: "web.search",
        expectedBackendKind: "provider-native",
        dimension: "quality",
        description: "quality preference should keep provider-native web search",
      },
    ],
  },
  {
    id: "quality-2",
    name: "quality preference + local-only routes to hlvm-local",
    dimension: "quality",
    scenario: "quality + local-only → hard constraint wins, hlvm-local available",
    constraints: {
      hardConstraints: ["local-only"],
      preference: "quality",
      preferenceConflict: false,
      source: "task-text",
    },
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    expectations: [
      {
        capabilityId: "web.search",
        expectedBackendKind: "hlvm-local",
        dimension: "quality",
        description: "local-only hard constraint → hlvm-local wins (DuckDuckGo is local)",
      },
    ],
  },
  {
    id: "quality-3",
    name: "conflicting preferences are handled gracefully",
    dimension: "quality",
    scenario: "Both cheap and quality detected → preferenceConflict=true, cheap wins as tie-breaker",
    constraints: CONFLICTING_PREFS,
    pinnedModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    runtimeMode: "auto",
    expectations: [
      {
        capabilityId: "web.search",
        expectedBackendKind: "hlvm-local",
        dimension: "quality",
        description: "conflicting preferences resolve to cheap (tie-breaker), so hlvm-local is preferred",
      },
    ],
  },
  {
    id: "quality-4",
    name: "manual mode ignores quality preference",
    dimension: "quality",
    scenario: "Manual mode should not trigger routing based on preferences",
    constraints: PREFER_QUALITY,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "manual",
    expectations: [
      {
        expectReasoningSwitch: false,
        dimension: "quality",
        description: "manual mode never triggers reasoning selection regardless of preference",
      },
    ],
  },
];

// ============================================================================
// Cost dimension (4 cases)
// ============================================================================

const costCases: RoutingEvalCase[] = [
  {
    id: "cost-1",
    name: "cheap preference reverses candidate order",
    dimension: "cost",
    scenario: "User says 'quick cheap answer' → cheap preference, hlvm-local preferred",
    constraints: PREFER_CHEAP,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    expectations: [
      {
        expectReasoningSwitch: false,
        dimension: "cost",
        description: "cheap preference on local model should not trigger cloud switch",
      },
    ],
  },
  {
    id: "cost-2",
    name: "cheap preference reverses cascade on cloud",
    dimension: "cost",
    scenario: "User says 'quick cheap' while pinned to Google → hlvm-local preferred over provider-native",
    constraints: PREFER_CHEAP,
    pinnedModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    runtimeMode: "auto",
    expectations: [
      {
        capabilityId: "web.search",
        expectedBackendKind: "hlvm-local",
        dimension: "cost",
        description: "cheap preference reverses cascade: hlvm-local first, then provider-native",
      },
    ],
  },
  {
    id: "cost-3",
    name: "cheap + local-only routes to hlvm-local",
    dimension: "cost",
    scenario: "cheap preference + local-only → hlvm-local (both local and cheap)",
    constraints: {
      hardConstraints: ["local-only"],
      preference: "cheap",
      preferenceConflict: false,
      source: "task-text",
    },
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    expectations: [
      {
        capabilityId: "web.search",
        expectedBackendKind: "hlvm-local",
        dimension: "cost",
        description: "local-only + cheap → hlvm-local (DuckDuckGo is both local and cheap)",
      },
      {
        expectReasoningSwitch: false,
        dimension: "cost",
        description: "no switch when local-only active",
      },
    ],
  },
  {
    id: "cost-4",
    name: "no unnecessary reasoning switch for basic chat",
    dimension: "cost",
    scenario: "Simple chat with no special capabilities → no switch",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    expectations: [
      {
        expectReasoningSwitch: false,
        dimension: "cost",
        description: "basic chat should not trigger reasoning switch",
      },
    ],
  },
];

// ============================================================================
// Availability dimension (4 cases)
// ============================================================================

const availabilityCases: RoutingEvalCase[] = [
  {
    id: "avail-1",
    name: "pinned provider unavailable does not crash",
    dimension: "availability",
    scenario: "Pinned provider reports unavailable — surface should still build",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    runtimeMode: "auto",
    expectations: [
      {
        capabilityId: "web.search",
        // We test that the surface builds at all — the test runner validates this
        dimension: "availability",
        description: "surface should build even if provider is down",
        expectedBackendKind: "provider-native",
      },
    ],
  },
  {
    id: "avail-2",
    name: "auto mode with ollama routes web to hlvm-local",
    dimension: "availability",
    scenario: "Only local Ollama available, no cloud providers configured",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    expectations: [
      {
        capabilityId: "web.search",
        expectedBackendKind: "hlvm-local",
        dimension: "availability",
        description: "web.search routes to hlvm-local on Ollama (custom impl available)",
      },
    ],
  },
  {
    id: "avail-3",
    name: "structured.output requires provider-native support",
    dimension: "availability",
    scenario: "structured.output on a model that supports it",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    runtimeMode: "auto",
    requestedCapabilities: [],
    expectations: [
      {
        capabilityId: "structured.output",
        // structured.output is request-driven, so without explicit request it should be fallback
        expectFallback: true,
        dimension: "availability",
        description: "structured.output should not activate without explicit request",
      },
    ],
  },
  {
    id: "avail-4",
    name: "multiple capability families active simultaneously",
    dimension: "availability",
    scenario: "Turn with vision + web search on Google provider",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    runtimeMode: "auto",
    visionAttachmentCount: 1,
    expectations: [
      {
        capabilityId: "web.search",
        expectedBackendKind: "provider-native",
        dimension: "availability",
        description: "web.search should be active alongside vision",
      },
      {
        capabilityId: "vision.analyze",
        expectedBackendKind: "provider-native",
        dimension: "availability",
        description: "vision.analyze should be active alongside web.search",
      },
    ],
  },
  {
    id: "avail-5",
    name: "vision.analyze unavailable when no local vision model and no provider-native",
    dimension: "availability",
    scenario: "Ollama non-vision pinned, no local vision model installed, vision attachment → no route",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    visionAttachmentCount: 1,
    localVisionAvailable: false,
    expectations: [
      {
        capabilityId: "vision.analyze",
        expectFallback: true,
        dimension: "availability",
        description: "vision.analyze should not route when no local vision model and no provider-native",
      },
    ],
  },
];

// ============================================================================
// MCP fallback dimension (6 cases)
// ============================================================================

const mcpFallbackCases: RoutingEvalCase[] = [
  {
    id: "mcp-fallback-1",
    name: "MCP brave-search as web fallback for Ollama",
    dimension: "mcp-fallback",
    scenario: "Ollama pinned (no native web), MCP brave-search available → MCP selected for web.search",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    mcpCandidates: {
      "web.search": [{
        capabilityId: "web.search",
        serverName: "brave",
        toolName: "mcp_brave_search",
        label: "MCP web search via brave",
      }],
    },
    expectations: [
      {
        capabilityId: "web.search",
        expectedBackendKind: "mcp",
        dimension: "mcp-fallback",
        description: "MCP brave-search selected when provider-native unavailable",
      },
    ],
  },
  {
    id: "mcp-fallback-2",
    name: "MCP code-runner as code.exec fallback for OpenAI",
    dimension: "mcp-fallback",
    scenario: "OpenAI pinned (no code exec), MCP code-runner available → MCP selected",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "openai/gpt-4o",
    pinnedProviderName: "openai",
    runtimeMode: "auto",
    requestedCapabilities: ["code.exec"],
    mcpCandidates: {
      "code.exec": [{
        capabilityId: "code.exec",
        serverName: "code-runner",
        toolName: "mcp_code_execute",
        label: "MCP code execution via code-runner",
      }],
    },
    expectations: [
      {
        capabilityId: "code.exec",
        expectedBackendKind: "mcp",
        dimension: "mcp-fallback",
        description: "MCP code-runner selected when OpenAI lacks native code exec",
      },
    ],
  },
  {
    id: "mcp-fallback-3",
    name: "MCP puppeteer as computer.use fallback for OpenAI",
    dimension: "mcp-fallback",
    scenario: "OpenAI pinned (no computer.use), MCP puppeteer available → MCP selected",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "openai/gpt-4o",
    pinnedProviderName: "openai",
    runtimeMode: "auto",
    computerUseRequested: true,
    mcpCandidates: {
      "computer.use": [{
        capabilityId: "computer.use",
        serverName: "puppeteer",
        toolName: "mcp_puppeteer_interact",
        label: "MCP computer use via puppeteer",
      }],
    },
    expectations: [
      {
        capabilityId: "computer.use",
        expectedBackendKind: "mcp",
        dimension: "mcp-fallback",
        description: "MCP puppeteer selected when OpenAI lacks computer.use",
      },
    ],
  },
  {
    id: "mcp-fallback-4",
    name: "MCP vision-server as vision fallback for Ollama",
    dimension: "mcp-fallback",
    scenario: "Ollama pinned (no vision), MCP vision server available → MCP selected",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    visionAttachmentCount: 1,
    mcpCandidates: {
      "vision.analyze": [{
        capabilityId: "vision.analyze",
        serverName: "vision-srv",
        toolName: "mcp_vision_analyze",
        label: "MCP vision analysis via vision-srv",
      }],
    },
    expectations: [
      {
        capabilityId: "vision.analyze",
        expectedBackendKind: "mcp",
        dimension: "mcp-fallback",
        description: "MCP vision-server selected when Ollama lacks vision",
      },
    ],
  },
  {
    id: "mcp-fallback-5",
    name: "MCP whisper-server as audio.analyze fallback for OpenAI",
    dimension: "mcp-fallback",
    scenario: "OpenAI pinned (no native audio), MCP whisper-server available → MCP selected",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "openai/gpt-4o",
    pinnedProviderName: "openai",
    runtimeMode: "auto",
    audioAttachmentCount: 1,
    mcpCandidates: {
      "audio.analyze": [{
        capabilityId: "audio.analyze",
        serverName: "whisper",
        toolName: "mcp_audio_transcribe",
        label: "MCP audio analysis via whisper",
      }],
    },
    expectations: [
      {
        capabilityId: "audio.analyze",
        expectedBackendKind: "mcp",
        dimension: "mcp-fallback",
        description: "MCP whisper-server selected when OpenAI lacks native audio analysis",
      },
    ],
  },
  {
    id: "mcp-cascade-1",
    name: "all tiers available, quality preference keeps provider-native",
    dimension: "mcp-fallback",
    scenario: "All tiers available, quality preference → provider-native over MCP",
    constraints: PREFER_QUALITY,
    pinnedModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    runtimeMode: "auto",
    mcpCandidates: {
      "web.search": [{
        capabilityId: "web.search",
        serverName: "brave",
        toolName: "mcp_brave_search",
        label: "MCP web search via brave",
      }],
    },
    expectations: [
      {
        capabilityId: "web.search",
        expectedBackendKind: "provider-native",
        dimension: "mcp-fallback",
        description: "quality preference keeps provider-native when all tiers available",
      },
    ],
  },
  {
    id: "mcp-cascade-2",
    name: "native unavailable, MCP selected over local",
    dimension: "mcp-fallback",
    scenario: "Provider-native unavailable, MCP available → MCP selected (not local)",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    mcpCandidates: {
      "web.search": [{
        capabilityId: "web.search",
        serverName: "brave",
        toolName: "mcp_brave_search",
        label: "MCP web search via brave",
      }],
    },
    expectations: [
      {
        capabilityId: "web.search",
        expectedBackendKind: "mcp",
        dimension: "mcp-fallback",
        description: "MCP selected over HLVM local when native unavailable",
      },
    ],
  },
  {
    id: "mcp-fallback-6",
    name: "MCP structured-proxy as structured.output fallback for Ollama",
    dimension: "mcp-fallback",
    scenario: "Ollama pinned (no native structured output), MCP structured-proxy available → MCP selected",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    responseShapeContext: { requested: true, source: "task-text", topLevelKeys: ["name", "age"] },
    providerNativeStructuredOutputAvailable: false,
    mcpCandidates: {
      "structured.output": [{
        capabilityId: "structured.output",
        serverName: "structured-proxy",
        toolName: "mcp_structured_generate",
        label: "MCP structured output via structured-proxy",
      }],
    },
    expectations: [
      {
        capabilityId: "structured.output",
        expectedBackendKind: "mcp",
        dimension: "mcp-fallback",
        description: "MCP structured-proxy selected when provider-native structured output unavailable",
      },
    ],
  },
  {
    id: "mcp-fallback-7",
    name: "hlvm-local structured output when no MCP and no native",
    dimension: "mcp-fallback",
    scenario: "Ollama pinned (no native structured output), no MCP → hlvm-local prompt-based extraction",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    runtimeMode: "auto",
    responseShapeContext: { requested: true, source: "task-text", topLevelKeys: ["name"] },
    providerNativeStructuredOutputAvailable: false,
    expectations: [
      {
        capabilityId: "structured.output",
        expectedBackendKind: "hlvm-local",
        dimension: "mcp-fallback",
        description: "hlvm-local prompt-based extraction selected when no native and no MCP",
      },
    ],
  },
  {
    id: "mcp-cascade-3",
    name: "provider-native structured output preferred over MCP when available",
    dimension: "mcp-fallback",
    scenario: "OpenAI pinned (native structured output available), MCP also available → provider-native wins",
    constraints: NO_CONSTRAINTS,
    pinnedModelId: "openai/gpt-4o",
    pinnedProviderName: "openai",
    runtimeMode: "auto",
    responseShapeContext: { requested: true, source: "task-text", topLevelKeys: ["result"] },
    providerNativeStructuredOutputAvailable: true,
    mcpCandidates: {
      "structured.output": [{
        capabilityId: "structured.output",
        serverName: "structured-proxy",
        toolName: "mcp_structured_generate",
        label: "MCP structured output via structured-proxy",
      }],
    },
    expectations: [
      {
        capabilityId: "structured.output",
        expectedBackendKind: "provider-native",
        dimension: "mcp-fallback",
        description: "provider-native structured output preferred when available despite MCP",
      },
    ],
  },
];

// ============================================================================
// Exported: all 40 eval cases
// ============================================================================

export const ROUTING_EVAL_CASES: RoutingEvalCase[] = [
  ...privacyCases,
  ...localityCases,
  ...capabilityFitCases,
  ...qualityCases,
  ...costCases,
  ...availabilityCases,
  ...mcpFallbackCases,
];
