import { getConfiguredModel } from "../../common/config/selectors.ts";
import { ValidationError } from "../../common/error.ts";
import { ai } from "../api/ai.ts";
import { config } from "../api/config.ts";
import { extractProviderName, extractModelSuffix } from "./constants.ts";
import {
  buildExecutionSurface,
  LOCAL_CODE_EXECUTE_TOOL_NAME,
  type ExecutionSurface,
  type ExecutionFallbackState,
  type ExecutionSurfaceLocalModelSummary,
  type ExecutionSurfaceMcpServerSummary,
  type ExecutionSurfaceProviderSummary,
  type McpExecutionPathCandidate,
} from "./execution-surface.ts";
import { resolveSdkModelSpec, toSdkRuntimeModelSpec } from "./engine-sdk.ts";
import { inspectMcpServersForCapabilities } from "./mcp/tools.ts";
import type { RoutingConstraintSet } from "./routing-constraints.ts";
import { resolveProviderExecutionPlan, type ResolvedProviderExecutionPlan } from "./tool-capabilities.ts";
import type { RuntimeMode } from "./runtime-mode.ts";
import { listRegisteredProviders } from "../providers/registry.ts";
import { preflightProviderExecutionCapabilities } from "../providers/sdk-runtime.ts";
import type { SemanticCapabilityId } from "./semantic-capabilities.ts";
import type { ExecutionTaskCapabilityContext } from "./task-capability-context.ts";
import type { ExecutionResponseShapeContext } from "./response-shape-context.ts";
import type { ModelInfo, ProviderStatus } from "../providers/types.ts";
import {
  resolveSupportedAttachmentKindsForModel,
} from "../cli/attachment-policy.ts";
import type {
  AudioEligibleAttachmentKind,
  ExecutionTurnContext,
  VisionEligibleAttachmentKind,
} from "./turn-context.ts";
import { selectReasoningPathForTurn } from "./reasoning-selector.ts";

export interface ExecutionSurfaceResolution {
  providerExecutionPlan: ResolvedProviderExecutionPlan;
  executionSurface: ExecutionSurface;
}

function collectProviderNames(pinnedProviderName: string): string[] {
  const names = new Set(listRegisteredProviders());
  if (pinnedProviderName.trim()) {
    names.add(pinnedProviderName);
  }
  return [...names].sort();
}

async function getProviderStatuses(
  pinnedProviderName: string,
): Promise<ExecutionSurfaceProviderSummary[]> {
  const providerNames = collectProviderNames(pinnedProviderName);
  const results = await Promise.allSettled(
    providerNames.map((name) => ai.status(name)),
  );

  return providerNames.map((providerName, index) => {
    const result = results[index];
    const status: ProviderStatus = result?.status === "fulfilled"
      ? result.value
      : { available: false, error: "Failed to check status" };
    return {
      providerName,
      available: status.available === true,
      isPinned: providerName === pinnedProviderName,
      error: status.error,
    };
  });
}

async function listInstalledModels(
  provider = "ollama",
): Promise<ModelInfo[]> {
  try {
    return await ai.models.list(provider);
  } catch {
    return [];
  }
}

async function getLocalModelSummary(
  activeModelId?: string,
): Promise<ExecutionSurfaceLocalModelSummary> {
  const activeProvider = extractProviderName(activeModelId);
  const activeModelName = activeProvider === "ollama"
    ? extractModelSuffix(activeModelId)
    : undefined;
  const [providerStatus, models] = await Promise.all([
    ai.status("ollama").catch((): ProviderStatus => ({
      available: false,
      error: "Failed to check status",
    })),
    listInstalledModels("ollama"),
  ]);

  return {
    providerName: "ollama",
    available: providerStatus.available === true,
    installedModelCount: models.length,
    activeModelName,
    activeModelInstalled: activeModelName
      ? models.some((model) => model.name === activeModelName)
      : false,
    error: providerStatus.error,
  };
}

async function tryGetModelInfo(
  activeModelId: string | undefined,
): Promise<ModelInfo | null> {
  if (!activeModelId) return null;
  const providerName = extractProviderName(activeModelId);
  const modelName = extractModelSuffix(activeModelId);
  if (!providerName || !modelName) return null;
  try {
    return await ai.models.get(modelName, providerName) ?? null;
  } catch {
    return null;
  }
}

async function resolveDirectVisionKinds(options: {
  activeModelId?: string;
  modelInfo: ModelInfo | null;
}): Promise<VisionEligibleAttachmentKind[]> {
  if (!options.activeModelId) return [];
  const supportedKinds = await resolveSupportedAttachmentKindsForModel(
    options.activeModelId,
    options.modelInfo,
  );
  return supportedKinds.filter((kind): kind is VisionEligibleAttachmentKind =>
    kind === "image" || kind === "pdf"
  );
}

async function resolveDirectAudioKinds(options: {
  activeModelId?: string;
  modelInfo: ModelInfo | null;
}): Promise<AudioEligibleAttachmentKind[]> {
  if (!options.activeModelId) return [];
  const supportedKinds = await resolveSupportedAttachmentKindsForModel(
    options.activeModelId,
    options.modelInfo,
  );
  return supportedKinds.filter((kind): kind is AudioEligibleAttachmentKind =>
    kind === "audio"
  );
}

function supportsProviderNativeStructuredOutput(
  activeModelId: string | undefined,
  fixturePath: string | undefined,
): boolean {
  if (!activeModelId || fixturePath) return false;
  try {
    resolveSdkModelSpec(activeModelId);
    return true;
  } catch (error) {
    if (error instanceof ValidationError) {
      return false;
    }
    throw error;
  }
}

async function getLocalVisionModelId(): Promise<string | null> {
  try {
    const installed = await listInstalledModels();
    const visionModel = installed.find((m) =>
      m.capabilities?.includes("vision")
    );
    return visionModel ? `ollama/${visionModel.name}` : null;
  } catch {
    return null;
  }
}

function isLocalCodeExecAvailable(options: {
  toolAllowlist?: string[];
  toolDenylist?: string[];
}): boolean {
  if (options.toolDenylist?.includes(LOCAL_CODE_EXECUTE_TOOL_NAME)) {
    return false;
  }
  if (options.toolAllowlist?.length) {
    return options.toolAllowlist.includes(LOCAL_CODE_EXECUTE_TOOL_NAME);
  }
  return true;
}

function buildMcpServerSummaries(
  servers: Awaited<ReturnType<typeof inspectMcpServersForCapabilities>>,
): ExecutionSurfaceMcpServerSummary[] {
  return servers.map((server) => ({
    name: server.name,
    scope: server.scope,
    scopeLabel: server.scopeLabel,
    transport: server.transport,
    target: server.target,
    reachable: server.reachable,
    toolCount: server.toolCount,
    contributingCapabilities: [
      ...new Set(server.contributingTools.flatMap((tool) => tool.semanticCapabilities)),
    ].sort(),
    contributingTools: server.contributingTools.map((tool) =>
      tool.registeredToolName
    ).sort(),
    reason: server.reason,
  }));
}

/** Check whether an MCP server runs locally (stdio or localhost HTTP). */
function isLocalMcpTransport(
  server: { transport: "http" | "stdio"; target: string },
): boolean {
  if (server.transport === "stdio") return true;
  if (server.transport === "http") {
    try {
      const url = new URL(server.target);
      const host = url.hostname;
      return host === "localhost" || host === "127.0.0.1" || host === "::1";
    } catch {
      return false;
    }
  }
  return false;
}

function buildMcpExecutionCandidates(
  servers: Awaited<ReturnType<typeof inspectMcpServersForCapabilities>>,
): Partial<Record<SemanticCapabilityId, McpExecutionPathCandidate[]>> {
  const MCP_LABEL_PREFIX: Record<string, string> = {
    "web.search": "MCP web search",
    "web.read": "MCP page read",
    "code.exec": "MCP code execution",
    "vision.analyze": "MCP vision analysis",
    "audio.analyze": "MCP audio analysis",
    "computer.use": "MCP computer use",
    "structured.output": "MCP structured output",
  };
  const grouped: Partial<Record<SemanticCapabilityId, McpExecutionPathCandidate[]>> = {};
  for (const server of servers) {
    if (!server.reachable) continue;
    const serverIsLocal = isLocalMcpTransport(server);
    for (const tool of server.contributingTools) {
      for (const capabilityId of tool.semanticCapabilities) {
        const prefix = MCP_LABEL_PREFIX[capabilityId] ?? `MCP ${capabilityId}`;
        const entry: McpExecutionPathCandidate = {
          capabilityId,
          serverName: server.name,
          toolName: tool.registeredToolName,
          label: `${prefix} via ${server.name}`,
          isLocal: serverIsLocal,
        };
        const bucket = grouped[capabilityId] ?? [];
        bucket.push(entry);
        grouped[capabilityId] = bucket;
      }
    }
  }
  return grouped;
}

export async function resolveProviderExecutionPlanForSession(options: {
  model?: string;
  fixturePath?: string;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  runtimeMode?: RuntimeMode;
  taskCapabilityContext?: ExecutionTaskCapabilityContext;
}): Promise<ResolvedProviderExecutionPlan> {
  const fallbackProviderName = extractProviderName(options.model) || "ollama";
  const autoRequestedRemoteCodeExecution = options.runtimeMode === "auto" &&
    options.taskCapabilityContext?.requestedCapabilities.includes("code.exec");
  if (!options.model || options.fixturePath) {
    return resolveProviderExecutionPlan({
      providerName: fallbackProviderName,
      allowlist: options.toolAllowlist,
      denylist: options.toolDenylist,
      autoRequestedRemoteCodeExecution,
    });
  }

  let spec;
  try {
    spec = resolveSdkModelSpec(options.model);
  } catch (error) {
    if (error instanceof ValidationError) {
      return resolveProviderExecutionPlan({
        providerName: fallbackProviderName,
        allowlist: options.toolAllowlist,
        denylist: options.toolDenylist,
      });
    }
    throw error;
  }

  const nativeCapabilities = await preflightProviderExecutionCapabilities(
    toSdkRuntimeModelSpec(spec),
  );

  return resolveProviderExecutionPlan({
    providerName: spec.providerName,
    allowlist: options.toolAllowlist,
    denylist: options.toolDenylist,
    nativeCapabilities,
    autoRequestedRemoteCodeExecution,
  });
}

export async function resolveExecutionSurfaceState(options: {
  model?: string;
  fixturePath?: string;
  runtimeMode: RuntimeMode;
  routingConstraints?: RoutingConstraintSet;
  taskCapabilityContext?: ExecutionTaskCapabilityContext;
  responseShapeContext?: ExecutionResponseShapeContext;
  turnContext?: ExecutionTurnContext;
  fallbackState?: ExecutionFallbackState;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  computerUseRequested?: boolean;
  skipReasoningSelection?: boolean;
}): Promise<ExecutionSurfaceResolution> {
  const activeModelId = options.model ??
    getConfiguredModel(config.snapshot);
  const pinnedProviderName = extractProviderName(activeModelId);
  const [providerExecutionPlan, providerStatuses, localModelSummary, mcpServers, modelInfo] =
    await Promise.all([
      resolveProviderExecutionPlanForSession({
        model: activeModelId,
        fixturePath: options.fixturePath,
        toolAllowlist: options.toolAllowlist,
        toolDenylist: options.toolDenylist,
        runtimeMode: options.runtimeMode,
        taskCapabilityContext: options.taskCapabilityContext,
      }),
      getProviderStatuses(pinnedProviderName),
      getLocalModelSummary(activeModelId),
      inspectMcpServersForCapabilities(),
      tryGetModelInfo(activeModelId),
    ]);
  const [directVisionKinds, directAudioKinds, localVisionModelId] = await Promise.all([
    resolveDirectVisionKinds({ activeModelId, modelInfo }),
    resolveDirectAudioKinds({ activeModelId, modelInfo }),
    getLocalVisionModelId(),
  ]);
  const localVisionAvailable = localVisionModelId !== null;
  const providerNativeStructuredOutputAvailable =
    supportsProviderNativeStructuredOutput(activeModelId, options.fixturePath);

  const executionSurface = buildExecutionSurface({
    runtimeMode: options.runtimeMode,
    activeModelId,
    pinnedProviderName,
    providerExecutionPlan,
    constraints: options.routingConstraints,
    taskCapabilityContext: options.taskCapabilityContext,
    responseShapeContext: options.responseShapeContext,
    turnContext: options.turnContext,
    fallbackState: options.fallbackState,
    providerNativeStructuredOutputAvailable,
    directVisionKinds,
    directAudioKinds,
    localCodeExecAvailable: isLocalCodeExecAvailable(options),
    localVisionAvailable,
    computerUseRequested: options.computerUseRequested,
    providers: providerStatuses,
    localModelSummary,
    mcpServers: buildMcpServerSummaries(mcpServers),
    mcpCandidates: buildMcpExecutionCandidates(mcpServers),
  });

  // Auto-mode reasoning selection: check if pinned model can satisfy all routed capabilities
  if (options.runtimeMode === "auto" && !options.skipReasoningSelection) {
    const availableProviders = providerStatuses
      .filter((p) => p.available)
      .map((p) => p.providerName);

    const selection = selectReasoningPathForTurn({
      pinnedModelId: activeModelId ?? "unknown",
      pinnedProviderName,
      surface: executionSurface,
      availableProviders,
      turnContext: options.turnContext,
      computerUseRequested: options.computerUseRequested,
      localVisionModelId: localVisionModelId ?? undefined,
    });

    if (selection) {
      executionSurface.reasoningSelection = selection;
    }
  }

  return { providerExecutionPlan, executionSurface };
}
