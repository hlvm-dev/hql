/**
 * Companion Agent — Main Pipeline Loop
 *
 * Drives: bus → debounce → redact → context → gate → decide → SSE emit.
 * ACT decisions are executed via the agent runner with SSE-based approval.
 * ASK_VISION requests screenshots via the observe pipeline.
 */

import type {
  CompanionConfig,
  CompanionDecision,
  CompanionEvent,
} from "./types.ts";
import type { ObservationBus } from "./bus.ts";
import type { CompanionContext } from "./context.ts";
import type { LLMFunction } from "../agent/orchestrator-llm.ts";
import type { InteractionRequestEvent, InteractionResponse } from "../agent/registry.ts";
import { debounceObservations } from "./debounce.ts";
import { redactObservation } from "./redact.ts";
import { gateObservations } from "./gate.ts";
import { makeDecision } from "./decide.ts";
import { getAgentEngine } from "../agent/engine.ts";
import { loadMemoryContext } from "../memory/mod.ts";
import { pushSSEEvent } from "../store/sse-store.ts";
import { waitForApproval, clearAllPendingApprovals } from "./approvals.ts";
import { runAgentQuery } from "../agent/agent-runner.ts";
import { classifyTool } from "../agent/security/safety.ts";
import { log } from "../api/log.ts";

export const COMPANION_CHANNEL = "__companion__";

let eventSeq = 0;

/** Tools the companion agent must never invoke. */
const COMPANION_TOOL_DENYLIST = [
  "delegate_agent",
  "complete_task",
  "ask_user",
];

/** Build a companion event with auto-incrementing ID and current timestamp. */
function makeEvent(
  type: CompanionEvent["type"],
  content: string,
  extra?: Partial<Pick<CompanionEvent, "actions" | "id">>,
): CompanionEvent {
  return {
    type,
    content,
    id: extra?.id ?? `comp-${++eventSeq}`,
    timestamp: new Date().toISOString(),
    actions: extra?.actions,
  };
}

/** Emit a companion event to the SSE channel. */
export function emitCompanionEvent(event: CompanionEvent): void {
  pushSSEEvent(COMPANION_CHANNEL, "companion_event", event);
}

/** Create an LLM function for companion use. Returns undefined on failure. */
function createCompanionLLM(
  model: string | undefined,
  options: { temperature: number; maxTokens: number },
): LLMFunction | undefined {
  if (!model) return undefined;
  try {
    return getAgentEngine().createLLM({
      model,
      options,
      toolDenylist: ["*"],
    });
  } catch (err) {
    log.error("[companion] failed to create LLM", err);
    return undefined;
  }
}

/**
 * Routes tool permission requests through SSE approval.
 * L0 (read-only) tools are auto-approved; L1+ always require user consent.
 */
export function companionOnInteraction(
  signal?: AbortSignal,
): (event: InteractionRequestEvent) => Promise<InteractionResponse> {
  return async (event) => {
    if (event.toolName) {
      const classification = classifyTool(
        event.toolName,
        event.toolArgs ? JSON.parse(event.toolArgs) : undefined,
      );
      if (classification.level === "L0") {
        return { approved: true };
      }
    }

    // L1+: route through SSE approval flow
    const permEventId = `comp-perm-${++eventSeq}`;
    emitCompanionEvent(makeEvent(
      "action_request",
      `Tool permission: ${event.toolName ?? "unknown"} — ${event.toolArgs ?? ""}`,
      { id: permEventId },
    ));

    try {
      const response = await waitForApproval(permEventId, signal);
      return { approved: response.approved ?? false };
    } catch {
      return { approved: false };
    }
  };
}

/** Execute an approved ACT decision via the agent runner. */
async function handleActFlow(
  event: CompanionEvent,
  decision: CompanionDecision,
  context: CompanionContext,
  config: CompanionConfig,
  signal: AbortSignal,
): Promise<void> {
  context.setState("acting");

  let approvalResponse;
  try {
    approvalResponse = await waitForApproval(event.id, signal);
  } catch {
    emitCompanionEvent(makeEvent("action_cancelled", "Action timed out or was cancelled."));
    return;
  }

  if (!approvalResponse.approved) {
    emitCompanionEvent(makeEvent("action_cancelled", "Action denied by user."));
    return;
  }

  // Find the approved action (by actionId, fallback to first)
  const action = decision.actions?.find((a) => a.id === approvalResponse.actionId)
    ?? decision.actions?.[0];
  if (!action) {
    emitCompanionEvent(makeEvent("action_cancelled", "No action found to execute."));
    return;
  }

  try {
    const result = await runAgentQuery({
      query: action.description,
      model: config.decisionModel,
      callbacks: {
        onInteraction: companionOnInteraction(signal),
      },
      permissionMode: "default",
      toolDenylist: COMPANION_TOOL_DENYLIST,
      noInput: true,
      skipSessionHistory: true,
      signal,
    });

    emitCompanionEvent(makeEvent("action_result", result.text));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (signal.aborted || message.includes("abort")) {
      emitCompanionEvent(makeEvent("action_cancelled", "Action was cancelled."));
    } else {
      emitCompanionEvent(makeEvent("action_result", `Error: ${message}`));
    }
  }
}

/**
 * Handle ASK_VISION: request screenshot consent, then emit capture_request.
 * The screenshot arrives as a screen.captured Observation through the bus —
 * the next loop iteration picks it up naturally.
 */
async function handleVisionFlow(
  event: CompanionEvent,
  context: CompanionContext,
  signal: AbortSignal,
): Promise<void> {
  context.setState("acting");

  let approvalResponse;
  try {
    approvalResponse = await waitForApproval(event.id, signal);
  } catch {
    emitCompanionEvent(makeEvent("action_cancelled", "Vision request timed out or was cancelled."));
    return;
  }

  if (!approvalResponse.approved) {
    emitCompanionEvent(makeEvent("action_cancelled", "Vision request denied by user."));
    return;
  }

  // Tell the GUI to capture now
  emitCompanionEvent(makeEvent("capture_request", "Capture screenshot"));
}

/** Main pipeline loop — runs until signal is aborted or bus is closed. */
export async function runCompanionLoop(
  bus: ObservationBus,
  config: CompanionConfig,
  context: CompanionContext,
  signal: AbortSignal,
): Promise<void> {
  context.setState("observing");
  log.debug("[companion] loop started");

  const gateLLM = createCompanionLLM(config.gateModel, {
    temperature: 0,
    maxTokens: 100,
  });
  const decisionLLM = createCompanionLLM(config.decisionModel, {
    temperature: 0.3,
    maxTokens: 1000,
  });

  const notifyTimestamps: number[] = [];

  try {
    for await (const batch of debounceObservations(
      bus,
      config.debounceWindowMs,
      config.maxBufferSize,
    )) {
      if (signal.aborted) break;

      // PII filter
      const redacted = batch.map(redactObservation);

      // DND: skip if user is actively typing (check BEFORE addBatch
      // so we measure the gap since the previous batch, not the current one)
      const isActive = context.isUserActive(config.quietWhileTypingMs);

      // Update rolling context
      context.addBatch(redacted);

      if (isActive) {
        log.debug("[companion] skipping — user active");
        continue;
      }

      // Gate
      context.setState("thinking");
      const gate = await gateObservations(redacted, context, gateLLM, signal);
      if (gate.decision === "SILENT") {
        context.setState("observing");
        continue;
      }

      // Decide
      let memoryContext: string | undefined;
      if (decisionLLM) {
        try {
          memoryContext = await loadMemoryContext(4000);
        } catch { /* non-fatal */ }
      }
      const decision = await makeDecision(
        redacted, context, gate.reason, decisionLLM, memoryContext, signal,
      );
      if (decision.type === "SILENT") {
        context.setState("observing");
        continue;
      }

      // Rate limit
      const now = Date.now();
      while (
        notifyTimestamps.length > 0 &&
        now - notifyTimestamps[0] > 60_000
      ) {
        notifyTimestamps.shift();
      }
      if (notifyTimestamps.length >= config.maxNotifyPerMinute) {
        log.debug("[companion] rate limited");
        context.setState("observing");
        continue;
      }
      notifyTimestamps.push(now);

      // Emit — branch by decision type
      if (decision.type === "ACT") {
        const event = makeEvent("action_request", decision.message ?? "", {
          actions: decision.actions,
        });
        emitCompanionEvent(event);
        await handleActFlow(event, decision, context, config, signal);
      } else if (decision.type === "ASK_VISION") {
        const event = makeEvent("vision_request", decision.message ?? "");
        emitCompanionEvent(event);
        await handleVisionFlow(event, context, signal);
      } else {
        // CHAT / SUGGEST
        const type = decision.type === "SUGGEST" ? "suggestion" : "message";
        emitCompanionEvent(makeEvent(type, decision.message ?? "", {
          actions: decision.actions,
        }));
      }

      context.setState("observing");
    }
  } finally {
    clearAllPendingApprovals();
    context.setState("idle");
    log.debug("[companion] loop stopped");
  }
}
