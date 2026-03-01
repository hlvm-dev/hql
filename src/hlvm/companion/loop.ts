/**
 * Companion Agent — Main Pipeline Loop
 *
 * Pure data pipe: bus → debounce → redact → context → format → SSE emit.
 * Zero LLM calls. The main agent receives raw observations and decides everything.
 */

import type {
  CompanionConfig,
  CompanionEvent,
} from "./types.ts";
import { EMISSION_SIGNAL_KINDS } from "./types.ts";
import type { ObservationBus } from "./bus.ts";
import type { CompanionContext } from "./context.ts";
import type { InteractionRequestEvent, InteractionResponse } from "../agent/registry.ts";
import { debounceObservations } from "./debounce.ts";
import { redactObservation } from "./redact.ts";
import { formatObservationPrompt } from "./format.ts";
import { pushSSEEvent } from "../store/sse-store.ts";
import { waitForApproval, clearAllPendingApprovals } from "./approvals.ts";
import { classifyTool } from "../agent/security/safety.ts";
import { log } from "../api/log.ts";
import { traceCompanion } from "./trace.ts";

export const COMPANION_CHANNEL = "__companion__";


let eventSeq = 0;

/** Reset event sequence counter. Called on companion stop. */
export function resetEventSequence(): void {
  eventSeq = 0;
}

/** Build a companion event with auto-incrementing ID and current timestamp. */
function makeEvent(
  type: CompanionEvent["type"],
  content: string,
  extra?: Partial<Pick<CompanionEvent, "id">>,
): CompanionEvent {
  return {
    type,
    content,
    id: extra?.id ?? `comp-${++eventSeq}`,
    timestamp: new Date().toISOString(),
  };
}

/** Emit a companion event to the SSE channel. */
export function emitCompanionEvent(event: CompanionEvent): void {
  pushSSEEvent(COMPANION_CHANNEL, "companion_event", event);
}

/** Parse tool args defensively; malformed JSON falls back to undefined. */
function parseToolArgsSafely(toolArgs: string | undefined): unknown {
  if (!toolArgs) return undefined;
  try {
    return JSON.parse(toolArgs);
  } catch (err) {
    log.warn("[companion] invalid toolArgs JSON; using undefined", err);
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
        parseToolArgsSafely(event.toolArgs),
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

/** Main pipeline loop — runs until signal is aborted or bus is closed. */
export async function runCompanionLoop(
  bus: ObservationBus,
  config: CompanionConfig,
  context: CompanionContext,
  signal: AbortSignal,
): Promise<void> {
  context.setState("observing");
  log.debug("[companion] loop started");
  traceCompanion("loop.started");

  const notifyTimestamps: number[] = [];
  let lastTypingActivityTs = 0;

  try {
    for await (const batch of debounceObservations(
      bus,
      config.debounceWindowMs,
      config.maxBufferSize,
    )) {
      if (signal.aborted) break;

      // PII filter
      const redacted = batch.map(redactObservation);
      const kinds = redacted.map((obs) => obs.kind);
      traceCompanion("loop.batch.received", {
        count: redacted.length,
        kinds,
      });

      // DND: skip only on explicit typing-like signals.
      // Poll-based observation traffic (window/app/clipboard) should not keep companion muted.
      const hasTypingSignal = redacted.some((obs) =>
        obs.kind === "ui.selection.changed"
      );
      if (hasTypingSignal) {
        lastTypingActivityTs = Date.now();
      }
      const isActive = Date.now() - lastTypingActivityTs < config.quietWhileTypingMs;

      // Update rolling context
      context.addBatch(redacted);

      // Debug mode: emit one visible message for every batch to validate end-to-end flow.
      // Intentionally bypasses DND/rate-limit so users can verify connectivity.
      if (config.debugAlwaysReact) {
        emitCompanionEvent(makeEvent("message", `[debug] observed: ${kinds.join(", ")}`));
        traceCompanion("loop.debug_always_react");
        continue;
      }

      if (isActive) {
        log.debug("[companion] skipping — user active");
        traceCompanion("loop.skipped.dnd_active", {
          quietWhileTypingMs: config.quietWhileTypingMs,
          hasTypingSignal,
        });
        continue;
      }

      // Signal filter: only emit when batch has high-signal observations.
      // Low-signal events (app.switch, window title, etc.) are still accumulated
      // in context but don't warrant interrupting the user.
      const hasHighSignal = redacted.some((obs) => EMISSION_SIGNAL_KINDS.has(obs.kind));
      if (!hasHighSignal) {
        log.debug("[companion] skipping — no high-signal observations");
        traceCompanion("loop.skipped.low_signal", { kinds });
        continue;
      }

      // Rate limit (only checked for high-signal batches)
      const now = Date.now();
      while (
        notifyTimestamps.length > 0 &&
        now - notifyTimestamps[0] > 60_000
      ) {
        notifyTimestamps.shift();
      }
      if (notifyTimestamps.length >= config.maxNotifyPerMinute) {
        log.debug("[companion] rate limited");
        traceCompanion("loop.skipped.rate_limited", {
          maxNotifyPerMinute: config.maxNotifyPerMinute,
        });
        continue;
      }
      notifyTimestamps.push(now);

      // Format and emit observation prompt
      const prompt = formatObservationPrompt(redacted, context);
      const event = makeEvent("message", prompt);
      emitCompanionEvent(event);
      traceCompanion("loop.emit.observation_prompt", {
        eventId: event.id,
        observationCount: redacted.length,
      });
    }
  } finally {
    clearAllPendingApprovals();
    context.setState("idle");
    log.debug("[companion] loop stopped");
    traceCompanion("loop.stopped");
  }
}
