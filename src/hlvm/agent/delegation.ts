/**
 * Delegation - run specialist sub-agents
 */

import { ContextManager } from "./context.ts";
import { generateSystemPrompt } from "./llm-integration.ts";
import {
  type AgentUIEvent,
  type LLMFunction,
  type OrchestratorConfig,
  runReActLoop,
} from "./orchestrator.ts";
import { getAgentProfile, listAgentProfiles } from "./agent-registry.ts";
import { DEFAULT_MAX_TOOL_CALLS, isGroundingMode } from "./constants.ts";
import { ValidationError } from "../../common/error.ts";
import { hasTool } from "./registry.ts";
import { createTodoState } from "./todo-state.ts";
import {
  type DelegateTranscriptEvent,
  type DelegateTranscriptSnapshot,
  withDelegateTranscriptSnapshot,
} from "./delegate-transcript.ts";
import {
  appendPersistedAgentToolResult,
  completePersistedAgentTurn,
  createPersistedAgentChildSession,
  persistAgentTodos,
  type PersistedAgentTurn,
} from "./persisted-transcript.ts";

function buildAgentSystemNote(profileName: string, tools: string[]): string {
  return [
    `Specialist agent: ${profileName}`,
    `Allowed tools: ${tools.join(", ") || "none"}`,
    "Do not call delegate_agent.",
    "Return a concise, factual result that a supervisor can use directly.",
  ].join("\n");
}

function resolveAllowedTools(
  profileName: string,
  toolOwnerId?: string,
): string[] {
  const profile = getAgentProfile(profileName);
  if (!profile) return [];
  return profile.tools.filter((tool) => hasTool(tool, toolOwnerId));
}

export function createDelegateHandler(
  llm: LLMFunction,
  baseConfig: Pick<OrchestratorConfig, "policy"> & {
    sessionId?: string | null;
    modelId?: string;
  },
): (args: unknown, config: OrchestratorConfig) => Promise<unknown> {
  return async (
    args: unknown,
    config: OrchestratorConfig,
  ): Promise<unknown> => {
    if (!args || typeof args !== "object") {
      throw new ValidationError(
        `delegate_agent requires { agent, task }. Got: ${typeof args}`,
        "delegate_agent",
      );
    }
    const record = args as Record<string, unknown>;
    const agent = typeof record.agent === "string" ? record.agent : "";
    const task = typeof record.task === "string" ? record.task : "";
    if (!agent || !task) {
      throw new ValidationError(
        `delegate_agent requires { agent, task }. Available agents: ${
          listAgentProfiles().map((p) => p.name).join(", ")
        }`,
        "delegate_agent",
      );
    }

    const profile = getAgentProfile(agent);
    if (!profile) {
      throw new ValidationError(
        `Unknown agent "${agent}". Available: ${
          listAgentProfiles().map((p) => p.name).join(", ")
        }`,
        "delegate_agent",
      );
    }

    const allowedTools = resolveAllowedTools(profile.name, config.toolOwnerId);
    // Use parent context's resolved budget instead of hardcoded default
    const parentCtxConfig = config.context.getConfig();
    const context = new ContextManager({
      ...parentCtxConfig,
      maxTokens: config.context.getMaxTokens(),
    });
    context.addMessage({
      role: "system",
      content: generateSystemPrompt({
        toolAllowlist: allowedTools,
        toolOwnerId: config.toolOwnerId,
      }),
    });
    context.addMessage({
      role: "system",
      content: buildAgentSystemNote(profile.name, allowedTools),
    });
    const childTodoState = createTodoState();

    const childEvents: DelegateTranscriptEvent[] = [];
    const childTurn: PersistedAgentTurn | null = baseConfig.sessionId
      ? createPersistedAgentChildSession({
        parentSessionId: baseConfig.sessionId,
        agent: profile.name,
        task,
      })
      : null;
    const startedAt = Date.now();
    const pushChildEvent = (event: AgentUIEvent): void => {
      const snapshotEvent = toDelegateTranscriptEvent(event);
      if (snapshotEvent) childEvents.push(snapshotEvent);
      if (childTurn && event.type === "tool_end") {
        appendPersistedAgentToolResult(
          childTurn,
          event.name,
          event.content ?? event.summary ?? "",
          {
            argsSummary: event.argsSummary,
            success: event.success,
          },
        );
      }
      if (childTurn && event.type === "todo_updated") {
        persistAgentTodos(
          childTurn.sessionId,
          event.todoState.items,
          event.source,
        );
      }
    };
    const buildSnapshot = (
      options: { success: boolean; finalResponse?: string; error?: string },
    ): DelegateTranscriptSnapshot => ({
      agent: profile.name,
      task,
      childSessionId: childTurn?.sessionId,
      success: options.success,
      durationMs: Date.now() - startedAt,
      toolCount:
        childEvents.filter((event) => event.type === "tool_end").length,
      finalResponse: options.finalResponse,
      error: options.error,
      events: [...childEvents],
    });

    try {
      const result = await runReActLoop(
        task,
        {
          workspace: config.workspace,
          context,
          permissionMode: config.permissionMode,
          // Fix 16: Clamp maxToolCalls to prevent resource exhaustion
          maxToolCalls: typeof record.maxToolCalls === "number"
            ? Math.min(
              record.maxToolCalls,
              config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
            )
            : config.maxToolCalls,
          // Fix 17: Validate groundingMode at runtime
          groundingMode: isGroundingMode(record.groundingMode)
            ? record.groundingMode
            : config.groundingMode,
          policy: baseConfig.policy ?? null,
          toolAllowlist: allowedTools,
          toolDenylist: ["delegate_agent"],
          l1Confirmations: new Map<string, boolean>(),
          toolOwnerId: config.toolOwnerId,
          onInteraction: config.onInteraction,
          onAgentEvent: pushChildEvent,
          planning: { mode: "off" },
          todoState: childTodoState,
        },
        llm,
      );

      if (childTurn) {
        persistAgentTodos(
          childTurn.sessionId,
          childTodoState.items.map((item) => ({ ...item })),
          "tool",
        );
        completePersistedAgentTurn(
          childTurn,
          baseConfig.modelId ?? "delegate_agent",
          result,
        );
      }

      return withDelegateTranscriptSnapshot({
        agent: profile.name,
        result,
        stats: context.getStats(),
        childSessionId: childTurn?.sessionId,
      }, buildSnapshot({ success: true, finalResponse: result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (childTurn) {
        persistAgentTodos(
          childTurn.sessionId,
          childTodoState.items.map((item) => ({ ...item })),
          "tool",
        );
        completePersistedAgentTurn(
          childTurn,
          baseConfig.modelId ?? "delegate_agent",
          `Delegation failed: ${message}`,
        );
      }
      throw withDelegateTranscriptSnapshot(
        error,
        buildSnapshot({
          success: false,
          error: message,
        }),
      );
    }
  };
}

function toDelegateTranscriptEvent(
  event: AgentUIEvent,
): DelegateTranscriptEvent | null {
  switch (event.type) {
    case "thinking":
      return { type: "thinking", iteration: event.iteration };
    case "thinking_update":
      return {
        type: "thinking",
        iteration: event.iteration,
        summary: event.summary,
      };
    case "plan_created":
      return { type: "plan_created", stepCount: event.plan.steps.length };
    case "plan_step":
      return {
        type: "plan_step",
        stepId: event.stepId,
        index: event.index,
        completed: event.completed,
      };
    case "tool_start":
      return {
        type: "tool_start",
        name: event.name,
        argsSummary: event.argsSummary,
        toolIndex: event.toolIndex,
        toolTotal: event.toolTotal,
      };
    case "tool_end":
      return {
        type: "tool_end",
        name: event.name,
        success: event.success,
        content: event.content,
        summary: event.summary,
        durationMs: event.durationMs,
        argsSummary: event.argsSummary,
      };
    case "turn_stats":
      return {
        type: "turn_stats",
        iteration: event.iteration,
        toolCount: event.toolCount,
        durationMs: event.durationMs,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      };
    case "delegate_start":
    case "delegate_end":
    case "todo_updated":
    case "interaction_request":
      return null;
  }
}
