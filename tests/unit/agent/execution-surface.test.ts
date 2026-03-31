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
        computerUse: true,
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
      audioEligibleAttachmentCount: 0,
      audioEligibleKinds: [],
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
      audioEligibleAttachmentCount: 0,
      audioEligibleKinds: [],
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
      audioEligibleAttachmentCount: 0,
      audioEligibleKinds: [],
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
    localCodeExecAvailable: true,
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
    localCodeExecAvailable: true,
  });

  assertEquals(surface.capabilities["code.exec"].selectedBackendKind, undefined);
  assertEquals(
    surface.capabilities["code.exec"].fallbackReason,
    "code.exec not requested by current task",
  );
});

Deno.test("execution surface: code.exec falls back to hlvm-local when the pinned provider lacks native remote code execution", () => {
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
    localCodeExecAvailable: true,
  });

  assertEquals(surface.capabilities["code.exec"].selectedBackendKind, "hlvm-local");
  assertEquals(
    surface.capabilities["code.exec"].selectedToolName,
    "local_code_execute",
  );
  assertEquals(
    surface.capabilities["code.exec"].fallbackReason,
    "provider-native unavailable; no participating MCP route",
  );
  assertEquals(
    surface.capabilities["code.exec"].candidates.find((candidate) =>
      candidate.backendKind === "mcp"
    )?.reason,
    "no participating MCP route",
  );
});

Deno.test("execution surface: code.exec stays unavailable when the local fallback is disabled for the session", () => {
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
    localCodeExecAvailable: false,
  });

  assertEquals(surface.capabilities["code.exec"].selectedBackendKind, undefined);
  assertEquals(
    surface.capabilities["code.exec"].fallbackReason,
    "pinned model/provider lacks native remote code execution or the tool is unavailable for this session",
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

Deno.test("execution surface: structured.output falls back to hlvm-local when provider-native structured output is unsupported and no MCP route exists", () => {
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
    "hlvm-local",
  );
  assertEquals(
    surface.capabilities["structured.output"].fallbackReason,
    "provider-native unavailable; no participating MCP route",
  );
  assertEquals(
    surface.capabilities["structured.output"].candidates.find((candidate) =>
      candidate.backendKind === "provider-native"
    )?.reason,
    "pinned model/provider lacks provider-native structured output for this turn",
  );
});

Deno.test("execution surface: structured.output prefers MCP over hlvm-local when provider-native structured output is unsupported", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "ollama",
      nativeCapabilities: {
        webSearch: false,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    responseShapeContext: {
      requested: true,
      source: "request",
      schemaSignature: "sig-structured-mcp",
      topLevelKeys: ["name"],
    },
    providerNativeStructuredOutputAvailable: false,
    mcpCandidates: {
      "structured.output": [{
        capabilityId: "structured.output",
        serverName: "structured-proxy",
        toolName: "mcp_structured_generate",
        label: "MCP structured output via structured-proxy",
      }],
    },
  });

  assertEquals(
    surface.capabilities["structured.output"].selectedBackendKind,
    "mcp",
  );
  assertEquals(
    surface.capabilities["structured.output"].selectedToolName,
    "mcp_structured_generate",
  );
  assertEquals(
    surface.capabilities["structured.output"].selectedServerName,
    "structured-proxy",
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
        computerUse: true,
      },
    }),
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["image"],
      visionEligibleAttachmentCount: 1,
      visionEligibleKinds: ["image"],
      audioEligibleAttachmentCount: 0,
      audioEligibleKinds: [],
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
        computerUse: true,
      },
    }),
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["image"],
      visionEligibleAttachmentCount: 1,
      visionEligibleKinds: ["image"],
      audioEligibleAttachmentCount: 0,
      audioEligibleKinds: [],
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

Deno.test("execution surface: code.exec provider-native failure falls back to hlvm-local for the turn", () => {
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
    localCodeExecAvailable: true,
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

  assertEquals(surface.capabilities["code.exec"].selectedBackendKind, "hlvm-local");
  assertEquals(
    surface.capabilities["code.exec"].selectedToolName,
    "local_code_execute",
  );
  assertEquals(
    surface.capabilities["code.exec"].fallbackReason,
    "provider-native (google) via remote_code_execute failed during current turn",
  );
});

Deno.test("execution surface: vision.analyze selects hlvm-local when provider-native unavailable and local vision model installed", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "ollama",
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
      audioEligibleAttachmentCount: 0,
      audioEligibleKinds: [],
    },
    localVisionAvailable: true,
  });

  assertEquals(
    surface.capabilities["vision.analyze"].selectedBackendKind,
    "hlvm-local",
  );
  const localCandidate = surface.capabilities["vision.analyze"].candidates.find(
    (c) => c.backendKind === "hlvm-local",
  );
  assertEquals(localCandidate?.reachable, true);
  assertEquals(localCandidate?.allowed, true);
});

Deno.test("execution surface: vision.analyze unavailable when no local vision model and no provider-native", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "ollama",
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
      audioEligibleAttachmentCount: 0,
      audioEligibleKinds: [],
    },
    localVisionAvailable: false,
  });

  assertEquals(
    surface.capabilities["vision.analyze"].selectedBackendKind,
    undefined,
  );
  const localCandidate = surface.capabilities["vision.analyze"].candidates.find(
    (c) => c.backendKind === "hlvm-local",
  );
  assertEquals(localCandidate?.reachable, false);
  assertEquals(localCandidate?.reason, "no local vision-capable model installed");
});

Deno.test("execution surface: vision.analyze prefers provider-native over hlvm-local", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "ollama/llava:latest",
    pinnedProviderName: "ollama",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "ollama",
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
      audioEligibleAttachmentCount: 0,
      audioEligibleKinds: [],
    },
    directVisionKinds: ["image"],
    localVisionAvailable: true,
  });

  assertEquals(
    surface.capabilities["vision.analyze"].selectedBackendKind,
    "provider-native",
  );
  // hlvm-local should still be reachable but not selected
  const localCandidate = surface.capabilities["vision.analyze"].candidates.find(
    (c) => c.backendKind === "hlvm-local",
  );
  assertEquals(localCandidate?.reachable, true);
  assertEquals(localCandidate?.selected, false);
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
      audioEligibleAttachmentCount: 0,
      audioEligibleKinds: [],
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
      audioEligibleAttachmentCount: 0,
      audioEligibleKinds: [],
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

// ============================================================================
// Audio family tests
// ============================================================================

Deno.test("execution surface: audio.analyze selects provider-native when Google + audio attachment", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "google",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: true,
        remoteCodeExecution: false,
      },
    }),
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["audio"],
      visionEligibleAttachmentCount: 0,
      visionEligibleKinds: [],
      audioEligibleAttachmentCount: 1,
      audioEligibleKinds: ["audio"],
    },
    directAudioKinds: ["audio"],
  });

  assertEquals(surface.capabilities["audio.analyze"].selectedBackendKind, "provider-native");
  assertEquals(surface.capabilities["audio.analyze"].fallbackReason, undefined);
});

Deno.test("execution surface: audio.analyze unavailable without audio-eligible attachments", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "google",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: true,
        remoteCodeExecution: false,
      },
    }),
    directAudioKinds: ["audio"],
  });

  assertEquals(surface.capabilities["audio.analyze"].selectedBackendKind, undefined);
});

Deno.test("execution surface: audio.analyze blocked by local-only constraint", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "google",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: true,
        remoteCodeExecution: false,
      },
    }),
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["audio"],
      visionEligibleAttachmentCount: 0,
      visionEligibleKinds: [],
      audioEligibleAttachmentCount: 1,
      audioEligibleKinds: ["audio"],
    },
    directAudioKinds: ["audio"],
    constraints: {
      hardConstraints: ["local-only"],
      preferenceConflict: false,
      source: "task-text",
    },
  });

  assertEquals(surface.capabilities["audio.analyze"].selectedBackendKind, undefined);
  const nativeCandidate = surface.capabilities["audio.analyze"].candidates.find(
    (c) => c.backendKind === "provider-native",
  );
  assertEquals(
    nativeCandidate?.blockedReasons?.includes("blocked by task constraint local-only"),
    true,
  );
});

Deno.test("execution surface: audio.analyze MCP candidate selected when provider-native unavailable", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "ollama",
      nativeCapabilities: {
        webSearch: false,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    turnContext: {
      attachmentCount: 1,
      attachmentKinds: ["audio"],
      visionEligibleAttachmentCount: 0,
      visionEligibleKinds: [],
      audioEligibleAttachmentCount: 1,
      audioEligibleKinds: ["audio"],
    },
    mcpCandidates: {
      "audio.analyze": [{
        capabilityId: "audio.analyze",
        serverName: "whisper",
        toolName: "mcp_whisper_transcribe",
        label: "MCP audio analysis via whisper",
      }],
    },
  });

  assertEquals(surface.capabilities["audio.analyze"].selectedBackendKind, "mcp");
  assertEquals(surface.capabilities["audio.analyze"].selectedServerName, "whisper");
  assertEquals(surface.capabilities["audio.analyze"].selectedToolName, "mcp_whisper_transcribe");
});

// ============================================================================
// Computer.use family tests
// ============================================================================

Deno.test("execution surface: computer.use selects provider-native on Anthropic when requested", () => {
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
        computerUse: true,
      },
    }),
    computerUseRequested: true,
  });

  assertEquals(surface.capabilities["computer.use"].selectedBackendKind, "provider-native");
  assertEquals(surface.capabilities["computer.use"].fallbackReason, undefined);
});

Deno.test("execution surface: computer.use unavailable without explicit computerUseRequested", () => {
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
    computerUseRequested: false,
  });

  assertEquals(surface.capabilities["computer.use"].selectedBackendKind, undefined);
});

Deno.test("execution surface: computer.use unavailable on non-Anthropic providers", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "google/gemini-2.0-flash",
    pinnedProviderName: "google",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "google",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: true,
        remoteCodeExecution: true,
      },
    }),
    computerUseRequested: true,
  });

  assertEquals(surface.capabilities["computer.use"].selectedBackendKind, undefined);
});

Deno.test("execution surface: computer.use MCP candidate selected when Anthropic unavailable", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "openai/gpt-4o",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    computerUseRequested: true,
    mcpCandidates: {
      "computer.use": [{
        capabilityId: "computer.use",
        serverName: "puppeteer",
        toolName: "mcp_puppeteer_interact",
        label: "MCP computer use via puppeteer",
      }],
    },
  });

  assertEquals(surface.capabilities["computer.use"].selectedBackendKind, "mcp");
  assertEquals(surface.capabilities["computer.use"].selectedServerName, "puppeteer");
  assertEquals(surface.capabilities["computer.use"].selectedToolName, "mcp_puppeteer_interact");
});

// ============================================================================
// Vision MCP candidate test
// ============================================================================

Deno.test("execution surface: vision.analyze MCP candidate selected when provider-native unavailable", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "ollama/llama3.1:8b",
    pinnedProviderName: "ollama",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "ollama",
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
      audioEligibleAttachmentCount: 0,
      audioEligibleKinds: [],
    },
    mcpCandidates: {
      "vision.analyze": [{
        capabilityId: "vision.analyze",
        serverName: "vision-server",
        toolName: "mcp_vision_analyze",
        label: "MCP vision analysis via vision-server",
      }],
    },
  });

  assertEquals(surface.capabilities["vision.analyze"].selectedBackendKind, "mcp");
  assertEquals(surface.capabilities["vision.analyze"].selectedServerName, "vision-server");
});

// ============================================================================
// Code.exec MCP candidate test
// ============================================================================

Deno.test("execution surface: code.exec MCP candidate selected when provider-native unavailable", () => {
  const surface = buildExecutionSurface({
    runtimeMode: "auto",
    activeModelId: "openai/gpt-4o",
    pinnedProviderName: "openai",
    providerExecutionPlan: resolveProviderExecutionPlan({
      providerName: "openai",
      nativeCapabilities: {
        webSearch: true,
        webPageRead: false,
        remoteCodeExecution: false,
      },
    }),
    taskCapabilityContext: {
      requestedCapabilities: ["code.exec"],
      source: "task-text",
      matchedCueLabels: ["calculate"],
    },
    localCodeExecAvailable: true,
    mcpCandidates: {
      "code.exec": [{
        capabilityId: "code.exec",
        serverName: "code-runner",
        toolName: "mcp_code_execute",
        label: "MCP code execution via code-runner",
      }],
    },
  });

  assertEquals(surface.capabilities["code.exec"].selectedBackendKind, "mcp");
  assertEquals(surface.capabilities["code.exec"].selectedServerName, "code-runner");
  assertEquals(surface.capabilities["code.exec"].selectedToolName, "mcp_code_execute");
});
