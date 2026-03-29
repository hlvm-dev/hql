import { assertEquals } from "jsr:@std/assert";
import {
  appendExecutionFallbackSuppression,
  buildExecutionSurface,
  EMPTY_EXECUTION_FALLBACK_STATE,
  executionSurfaceUsesMcp,
  getExecutionSurfaceSignature,
  resolveRoutedCapabilityForToolName,
} from "../../../src/hlvm/agent/execution-surface.ts";
import { resolveProviderExecutionPlan } from "../../../src/hlvm/agent/tool-capabilities.ts";

Deno.test("execution surface: auto mode prefers provider-native web search when available", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "openai/gpt-5",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
  });

  assertEquals(
    surface.capabilities["web.search"].selectedBackendKind,
    "provider-native",
  );
  assertEquals(
    surface.capabilities["web.search"].selectedToolName,
    "web_search",
  );
  assertEquals(
    resolveRoutedCapabilityForToolName(surface, "web_search")?.summary,
    "Auto route web.search -> provider-native (openai)",
  );
});

Deno.test("execution surface: auto mode falls back to HLVM local web search when native search is unavailable", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "ollama/llama3.1",
    pinnedProviderName: "ollama",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "ollama",
      nativeCapabilities: {
        webSearch: false,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
  });

  assertEquals(
    surface.capabilities["web.search"].selectedBackendKind,
    "hlvm-local",
  );
  assertEquals(
    surface.capabilities["web.search"].selectedToolName,
    "search_web",
  );
  assertEquals(
    surface.capabilities["web.search"].fallbackReason,
    "provider-native unavailable; no participating MCP route",
  );
  assertEquals(
    surface.capabilities["web.search"].candidates.find((candidate) =>
      candidate.backendKind === "mcp"
    )?.reachable,
    false,
  );
  assertEquals(
    resolveRoutedCapabilityForToolName(surface, "search_web")?.summary,
    "Auto route web.search -> HLVM local (provider-native unavailable; no participating MCP route)",
  );
});

Deno.test("execution surface: auto mode selects MCP web search when native search is unavailable and a tagged MCP route exists", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "anthropic/claude-sonnet-4",
    pinnedProviderName: "anthropic",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "anthropic",
      nativeCapabilities: {
        webSearch: false,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    mcpCandidates: {
      "web.search": [{
        capabilityId: "web.search",
        serverName: "brave",
        toolName: "mcp_brave_search",
        label: "MCP web search via brave",
      }],
    },
  });

  assertEquals(surface.capabilities["web.search"].selectedBackendKind, "mcp");
  assertEquals(surface.capabilities["web.search"].selectedToolName, "mcp_brave_search");
  assertEquals(surface.capabilities["web.search"].selectedServerName, "brave");
  assertEquals(surface.capabilities["web.search"].fallbackReason, "provider-native unavailable");
  assertEquals(executionSurfaceUsesMcp(surface), true);
  assertEquals(
    resolveRoutedCapabilityForToolName(surface, "mcp_brave_search")?.summary,
    "Auto route web.search -> MCP (brave) (provider-native unavailable)",
  );
});

Deno.test("execution surface: local-only constraint forces web routing to HLVM local", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "openai/gpt-5",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    mcpCandidates: {
      "web.search": [{
        capabilityId: "web.search",
        serverName: "brave",
        toolName: "mcp_brave_search",
        label: "MCP web search via brave",
      }],
    },
    constraints: {
      hardConstraints: ["local-only"],
      preferenceConflict: false,
      source: "task-text",
    },
  });

  assertEquals(surface.capabilities["web.search"].selectedBackendKind, "hlvm-local");
  assertEquals(surface.capabilities["web.search"].selectedToolName, "search_web");
  assertEquals(
    surface.capabilities["web.search"].fallbackReason,
    "task constraints local-only",
  );
  assertEquals(
    surface.capabilities["web.search"].candidates.find((candidate) =>
      candidate.backendKind === "provider-native"
    )?.blockedReasons,
    ["blocked by task constraint local-only"],
  );
});

Deno.test("execution surface: cheap preference prefers local over native when both are allowed", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "openai/gpt-5",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    mcpCandidates: {
      "web.search": [{
        capabilityId: "web.search",
        serverName: "brave",
        toolName: "mcp_brave_search",
        label: "MCP web search via brave",
      }],
    },
    constraints: {
      hardConstraints: [],
      preference: "cheap",
      preferenceConflict: false,
      source: "task-text",
    },
  });

  assertEquals(surface.capabilities["web.search"].selectedBackendKind, "hlvm-local");
  assertEquals(
    surface.capabilities["web.search"].fallbackReason,
    "task preference cheap",
  );
});

Deno.test("execution surface: quality preference keeps provider-native ahead of local when both are allowed", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "openai/gpt-5",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    constraints: {
      hardConstraints: [],
      preference: "quality",
      preferenceConflict: false,
      source: "task-text",
    },
  });

  assertEquals(surface.capabilities["web.search"].selectedBackendKind, "provider-native");
  assertEquals(surface.capabilities["web.search"].fallbackReason, undefined);
});

Deno.test("execution surface: impossible constraints leave no selected backend", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "openai/gpt-5",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      allowlist: ["web_search"],
      denylist: ["search_web", "web_search"],
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    constraints: {
      hardConstraints: ["local-only"],
      preferenceConflict: false,
      source: "task-text",
    },
  });

  assertEquals(surface.capabilities["web.search"].selectedBackendKind, undefined);
  assertEquals(
    surface.capabilities["web.search"].fallbackReason,
    "task impossible under current constraints",
  );
});

Deno.test("execution surface: signature changes when routing constraints change", () => {
  const baseOptions = {
    runtimeMode: "auto" as const,
    activeModelId: "openai/gpt-5",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
  };
  const unconstrained = buildExecutionSurface(baseOptions);
  const constrained = buildExecutionSurface({
    ...baseOptions,
    constraints: {
      hardConstraints: ["local-only"],
      preferenceConflict: false,
      source: "task-text",
    },
  });

  assertEquals(
    unconstrained.signature === getExecutionSurfaceSignature(constrained),
    false,
  );
});

Deno.test("execution surface: vision.analyze selects provider-native when auto mode has image attachments", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "anthropic/claude-sonnet-4-5-20250929",
    pinnedProviderName: "anthropic",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "anthropic",
      nativeCapabilities: {
        webSearch: false,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["image"],
      visionEligibleAttachmentCount: 1,
      visionEligibleKinds: ["image"],
    },
    directVisionKinds: ["image"],
  });

  assertEquals(
    surface.capabilities["vision.analyze"].selectedBackendKind,
    "provider-native",
  );
  assertEquals(
    surface.capabilities["vision.analyze"].fallbackReason,
    undefined,
  );
});

Deno.test("execution surface: vision.analyze stays unavailable without eligible attachments", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "openai/gpt-4.1",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["text"],
      visionEligibleAttachmentCount: 0,
      visionEligibleKinds: [],
    },
    directVisionKinds: ["image", "pdf"],
  });

  assertEquals(
    surface.capabilities["vision.analyze"].selectedBackendKind,
    undefined,
  );
  assertEquals(
    surface.capabilities["vision.analyze"].fallbackReason,
    "no vision-eligible attachments on the current turn",
  );
});

Deno.test("execution surface: vision.analyze requires direct binary PDF support for PDF activation", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "openai/gpt-4.1",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["pdf"],
      visionEligibleAttachmentCount: 1,
      visionEligibleKinds: ["pdf"],
    },
    directVisionKinds: [],
  });

  assertEquals(
    surface.capabilities["vision.analyze"].selectedBackendKind,
    undefined,
  );
  assertEquals(
    surface.capabilities["vision.analyze"].fallbackReason,
    "pinned model/provider lacks direct visual input support",
  );
});

Deno.test("execution surface: code.exec selects provider-native when requested and remote code support exists", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "google/gemini-2.5-pro",
    pinnedProviderName: "google",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "google",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: true,
        remoteCodeExecution: true,
      },
      autoRequestedRemoteCodeExecution: true,
    }),
    taskCapabilityContext: {
      requestedCapabilities: ["code.exec"],
      source: "task-text",
      matchedCueLabels: ["calculate", "base64"],
    },
  });

  assertEquals(surface.capabilities["code.exec"].selectedBackendKind, "provider-native");
  assertEquals(
    surface.capabilities["code.exec"].selectedToolName,
    "remote_code_execute",
  );
  assertEquals(
    resolveRoutedCapabilityForToolName(surface, "remote_code_execute")?.summary,
    "Auto route code.exec -> provider-native (google)",
  );
});

Deno.test("execution surface: code.exec is unavailable when not requested by the current task", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "google/gemini-2.5-pro",
    pinnedProviderName: "google",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "google",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: true,
        remoteCodeExecution: true,
      },
    }),
  });

  assertEquals(surface.capabilities["code.exec"].selectedBackendKind, undefined);
  assertEquals(
    surface.capabilities["code.exec"].fallbackReason,
    "code.exec not requested by current task",
  );
});

Deno.test("execution surface: code.exec is unavailable when the pinned provider lacks native remote code execution", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "openai/gpt-5",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
      autoRequestedRemoteCodeExecution: true,
    }),
    taskCapabilityContext: {
      requestedCapabilities: ["code.exec"],
      source: "task-text",
      matchedCueLabels: ["compute"],
    },
  });

  assertEquals(surface.capabilities["code.exec"].selectedBackendKind, undefined);
  assertEquals(
    surface.capabilities["code.exec"].fallbackReason,
    "pinned model/provider lacks native remote code execution or the tool is unavailable for this session",
  );
  assertEquals(
    surface.capabilities["code.exec"].candidates.find((candidate) =>
      candidate.backendKind === "mcp"
    )?.reason,
    "not implemented for code.exec in this phase",
  );
});

Deno.test("execution surface: structured.output selects provider-native when explicitly requested and supported", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "openai/gpt-5",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    responseShapeContext: {
      requested: true,
      source: "request",
      schemaSignature: "sig-1",
      topLevelKeys: ["answer", "confidence"],
    },
    providerNativeStructuredOutputAvailable: true,
  });

  assertEquals(
    surface.capabilities["structured.output"].selectedBackendKind,
    "provider-native",
  );
  assertEquals(
    surface.capabilities["structured.output"].fallbackReason,
    undefined,
  );
});

Deno.test("execution surface: structured.output is unavailable when no response schema is requested", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "openai/gpt-5",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    providerNativeStructuredOutputAvailable: true,
  });

  assertEquals(
    surface.capabilities["structured.output"].selectedBackendKind,
    undefined,
  );
  assertEquals(
    surface.capabilities["structured.output"].fallbackReason,
    "structured.output not requested by current turn",
  );
});

Deno.test("execution surface: structured.output is unavailable when provider-native structured output is unsupported", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "test-chat/plain",
    pinnedProviderName: "test-chat",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "test-chat",
      nativeCapabilities: {
        webSearch: false,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    responseShapeContext: {
      requested: true,
      source: "request",
      schemaSignature: "sig-2",
      topLevelKeys: ["items"],
    },
    providerNativeStructuredOutputAvailable: false,
  });

  assertEquals(
    surface.capabilities["structured.output"].selectedBackendKind,
    undefined,
  );
  assertEquals(
    surface.capabilities["structured.output"].fallbackReason,
    "pinned model/provider lacks provider-native structured output for this turn",
  );
  assertEquals(
    surface.capabilities["structured.output"].candidates.find((candidate) =>
      candidate.backendKind === "mcp"
    )?.reason,
    "not implemented for structured.output in this phase",
  );
});

Deno.test("execution surface: familyId is correct for web, vision, code, and structured decisions", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "anthropic/claude-sonnet-4-5-20250929",
    pinnedProviderName: "anthropic",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "anthropic",
      nativeCapabilities: {
        webSearch: false,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["image"],
      visionEligibleAttachmentCount: 1,
      visionEligibleKinds: ["image"],
    },
    directVisionKinds: ["image"],
  });

  assertEquals(surface.capabilities["web.search"].familyId, "web");
  assertEquals(surface.capabilities["web.read"].familyId, "web");
  assertEquals(surface.capabilities["vision.analyze"].familyId, "vision");
  assertEquals(surface.capabilities["code.exec"].familyId, "code");
  assertEquals(surface.capabilities["structured.output"].familyId, "structured");
});

Deno.test("execution surface: local-only constraint blocks vision provider-native candidate", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "anthropic/claude-sonnet-4-5-20250929",
    pinnedProviderName: "anthropic",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "anthropic",
      nativeCapabilities: {
        webSearch: false,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["image"],
      visionEligibleAttachmentCount: 1,
      visionEligibleKinds: ["image"],
    },
    directVisionKinds: ["image"],
    constraints: {
      hardConstraints: ["local-only"],
      preferenceConflict: false,
      source: "task-text",
    },
  });

  assertEquals(surface.capabilities["vision.analyze"].selectedBackendKind, undefined);
  const nativeCandidate = surface.capabilities["vision.analyze"].candidates.find(
    (c) => c.backendKind === "provider-native",
  );
  assertEquals(
    nativeCandidate?.blockedReasons?.includes("blocked by task constraint local-only"),
    true,
  );
});

Deno.test("execution surface: provider-native web failure falls back to MCP before local", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "openai/gpt-5",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    mcpCandidates: {
      "web.search": [{
        capabilityId: "web.search",
        serverName: "brave",
        toolName: "mcp_brave_search",
        label: "MCP web search via brave",
      }],
    },
    fallbackState: appendExecutionFallbackSuppression(
      EMPTY_EXECUTION_FALLBACK_STATE,
      {
        capabilityId: "web.search",
        backendKind: "provider-native",
        toolName: "web_search",
        routePhase: "tool-start",
        failureReason: "native capability rejected",
      },
    ),
  });

  assertEquals(surface.capabilities["web.search"].selectedBackendKind, "mcp");
  assertEquals(surface.capabilities["web.search"].selectedServerName, "brave");
  assertEquals(
    surface.capabilities["web.search"].fallbackReason,
    "provider-native (openai) via web_search failed during current turn",
  );
});

Deno.test("execution surface: MCP web failure falls back to HLVM local", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "anthropic/claude-sonnet-4",
    pinnedProviderName: "anthropic",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "anthropic",
      nativeCapabilities: {
        webSearch: false,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    mcpCandidates: {
      "web.search": [{
        capabilityId: "web.search",
        serverName: "brave",
        toolName: "mcp_brave_search",
        label: "MCP web search via brave",
      }],
    },
    fallbackState: appendExecutionFallbackSuppression(
      EMPTY_EXECUTION_FALLBACK_STATE,
      {
        capabilityId: "web.search",
        backendKind: "mcp",
        toolName: "mcp_brave_search",
        serverName: "brave",
        routePhase: "tool-start",
        failureReason: "MCP tool failed",
      },
    ),
  });

  assertEquals(surface.capabilities["web.search"].selectedBackendKind, "hlvm-local");
  assertEquals(surface.capabilities["web.search"].selectedToolName, "search_web");
});

Deno.test("execution surface: last remaining web route failure leaves the capability unavailable for the turn", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "ollama/llama3.1",
    pinnedProviderName: "ollama",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "ollama",
      nativeCapabilities: {
        webSearch: false,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    constraints: {
      hardConstraints: ["local-only"],
      preferenceConflict: false,
      source: "task-text",
    },
    fallbackState: appendExecutionFallbackSuppression(
      EMPTY_EXECUTION_FALLBACK_STATE,
      {
        capabilityId: "web.search",
        backendKind: "hlvm-local",
        toolName: "search_web",
        routePhase: "tool-start",
        failureReason: "local search provider failed",
      },
    ),
  });

  assertEquals(surface.capabilities["web.search"].selectedBackendKind, undefined);
  assertEquals(
    surface.capabilities["web.search"].fallbackReason,
    "HLVM local via search_web failed during current turn; capability unavailable for remainder of turn",
  );
});

Deno.test("execution surface: code.exec provider-native failure makes the capability unavailable for the turn", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "google/gemini-2.5-pro",
    pinnedProviderName: "google",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "google",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: true,
        remoteCodeExecution: true,
      },
      autoRequestedRemoteCodeExecution: true,
    }),
    taskCapabilityContext: {
      requestedCapabilities: ["code.exec"],
      source: "task-text",
      matchedCueLabels: ["calculate"],
    },
    fallbackState: appendExecutionFallbackSuppression(
      EMPTY_EXECUTION_FALLBACK_STATE,
      {
        capabilityId: "code.exec",
        backendKind: "provider-native",
        toolName: "remote_code_execute",
        routePhase: "turn-start",
        failureReason: "provider sandbox unavailable",
      },
    ),
  });

  assertEquals(surface.capabilities["code.exec"].selectedBackendKind, undefined);
  assertEquals(
    surface.capabilities["code.exec"].fallbackReason,
    "provider-native (google) via remote_code_execute failed during current turn; capability unavailable for remainder of turn",
  );
});

Deno.test("execution surface: MCP and local vision candidates are explicitly unavailable this phase", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "anthropic/claude-sonnet-4-5-20250929",
    pinnedProviderName: "anthropic",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "anthropic",
      nativeCapabilities: {
        webSearch: false,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["image"],
      visionEligibleAttachmentCount: 1,
      visionEligibleKinds: ["image"],
    },
    directVisionKinds: ["image"],
  });

  const mcpCandidate = surface.capabilities["vision.analyze"].candidates.find(
    (c) => c.backendKind === "mcp",
  );
  const localCandidate = surface.capabilities["vision.analyze"].candidates.find(
    (c) => c.backendKind === "hlvm-local",
  );
  assertEquals(mcpCandidate?.reachable, false);
  assertEquals(localCandidate?.reachable, false);
});

Deno.test("execution surface: signature changes when turn attachment context changes", () => {
  const baseOptions = {
    runtimeMode: "auto" as const,
    activeModelId: "anthropic/claude-sonnet-4-5-20250929",
    pinnedProviderName: "anthropic",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "anthropic",
      nativeCapabilities: {
        webSearch: false,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    directVisionKinds: ["image"] as const,
  };
  const withoutAttachments = buildExecutionSurface(baseOptions);
  const withImageAttachment = buildExecutionSurface({
    ...baseOptions,
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["image"],
      visionEligibleAttachmentCount: 1,
      visionEligibleKinds: ["image"],
    },
  });

  assertEquals(
    withoutAttachments.signature ===
      getExecutionSurfaceSignature(withImageAttachment),
    false,
  );
});

Deno.test("execution surface: signature changes when task capability context changes", () => {
  const baseOptions = {
    runtimeMode: "auto" as const,
    activeModelId: "google/gemini-2.5-pro",
    pinnedProviderName: "google",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "google",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: true,
        remoteCodeExecution: true,
      },
    }),
  };
  const withoutCodeExec = buildExecutionSurface(baseOptions);
  const withCodeExec = buildExecutionSurface({
    ...baseOptions,
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "google",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: true,
        remoteCodeExecution: true,
      },
      autoRequestedRemoteCodeExecution: true,
    }),
    taskCapabilityContext: {
      requestedCapabilities: ["code.exec"],
      source: "task-text",
      matchedCueLabels: ["calculate"],
    },
  });

  assertEquals(
    withoutCodeExec.signature === getExecutionSurfaceSignature(withCodeExec),
    false,
  );
});

Deno.test("execution surface: signature changes when response shape context changes", () => {
  const baseOptions = {
    runtimeMode: "auto" as const,
    activeModelId: "openai/gpt-5",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    providerNativeStructuredOutputAvailable: true,
  };
  const withoutSchema = buildExecutionSurface(baseOptions);
  const withSchema = buildExecutionSurface({
    ...baseOptions,
    responseShapeContext: {
      requested: true,
      source: "request",
      schemaSignature: "sig-structured",
      topLevelKeys: ["answer"],
    },
  });

  assertEquals(
    withoutSchema.signature === getExecutionSurfaceSignature(withSchema),
    false,
  );
});
