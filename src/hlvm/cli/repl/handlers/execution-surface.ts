import { resolveExecutionSurfaceState } from "../../../agent/execution-surface-runtime.ts";
import { loadPersistedAgentSessionMetadata } from "../../../agent/persisted-transcript.ts";
import { resolveRuntimeMode } from "../../../agent/runtime-mode.ts";
import { getActiveConversationSessionId } from "../../../store/active-conversation.ts";
import type { RuntimeExecutionSurfaceResponse } from "../../../runtime/chat-protocol.ts";

export async function handleGetActiveConversationExecutionSurface(): Promise<
  Response
> {
  const sessionId = getActiveConversationSessionId();
  const metadata = loadPersistedAgentSessionMetadata(sessionId);
  const runtimeMode = resolveRuntimeMode(metadata.runtimeMode);
  const { executionSurface } = await resolveExecutionSurfaceState({
    runtimeMode,
    routingConstraints: metadata.lastAppliedRoutingConstraints,
    taskCapabilityContext: metadata.lastAppliedTaskCapabilityContext,
    responseShapeContext: metadata.lastAppliedResponseShapeContext,
    turnContext: metadata.lastAppliedTurnContext,
    fallbackState: metadata.lastAppliedExecutionFallbackState,
  });

  return Response.json({
    session_id: sessionId,
    runtime_mode: executionSurface.runtimeMode,
    active_model_id: executionSurface.activeModelId,
    pinned_provider_name: executionSurface.pinnedProviderName,
    strategy: executionSurface.strategy,
    signature: executionSurface.signature,
    constraints: executionSurface.constraints,
    task_capability_context: executionSurface.taskCapabilityContext,
    response_shape_context: executionSurface.responseShapeContext,
    turn_context: executionSurface.turnContext,
    fallback_state: executionSurface.fallbackState,
    providers: executionSurface.providers,
    local_model_summary: executionSurface.localModelSummary,
    mcp_servers: executionSurface.mcpServers,
    capabilities: executionSurface.capabilities,
  } satisfies RuntimeExecutionSurfaceResponse);
}
