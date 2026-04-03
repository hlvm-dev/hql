/**
 * Companion Agent — Main Pipeline Loop
 *
 * Pure data pipe: bus → debounce → redact → context → format → SSE emit.
 * Zero LLM calls. The main agent receives raw observations and decides everything.
 */

import type {
  CompanionConfig,
  CompanionEvent,
  Observation,
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
function emitCompanionEvent(event: CompanionEvent): void {
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

interface BatchSignalClassification {
  shouldEmit: boolean;
  reasons: string[];
  mediumSignalCount: number;
}

const ERROR_OR_FAILURE_PATTERN =
  /\b(error|failed|failure|exception|panic|fatal|traceback|stack trace|segmentation fault|enoent|eacces|syntaxerror|typeerror|referenceerror)\b/i;

const CODE_OR_URL_PATTERN =
  /(```|https?:\/\/|^\s*at\s+\S+|\b(import|export|function|class|const|let|var|def|fn)\b)/im;

const WINDOW_ERROR_PATTERN =
  /\b(error|failed|failure|crash|exception|panic|fatal)\b/i;

const DEV_APP_NAMES = new Set([
  "xcode",
  "terminal",
  "iterm",
  "iterm2",
  "vscode",
  "visual studio code",
  "cursor",
  "intellij idea",
  "webstorm",
  "pycharm",
  "clion",
  "zed",
  "sublime text",
  "neovim",
  "vim",
  "emacs",
]);

function getStringData(obs: Observation, key: string): string | null {
  const value = obs.data[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function classifyBatchSignal(batch: Observation[]): BatchSignalClassification {
  const reasons: string[] = [];
  const mediumSignals = new Set<string>();

  for (const obs of batch) {
    if (EMISSION_SIGNAL_KINDS.has(obs.kind)) {
      reasons.push(`hard:${obs.kind}`);
      return { shouldEmit: true, reasons, mediumSignalCount: mediumSignals.size };
    }

    if (obs.kind === "clipboard.changed") {
      const text = getStringData(obs, "text");
      if (!text) continue;
      if (ERROR_OR_FAILURE_PATTERN.test(text)) {
        reasons.push("hard:clipboard.error_or_trace");
        return { shouldEmit: true, reasons, mediumSignalCount: mediumSignals.size };
      }
      if (text.length >= 24 && CODE_OR_URL_PATTERN.test(text)) {
        mediumSignals.add("medium:clipboard.code_or_url");
      }
      continue;
    }

    if (obs.kind === "ui.window.title.changed" || obs.kind === "ui.window.focused") {
      const title = getStringData(obs, "title");
      if (!title) continue;
      if (WINDOW_ERROR_PATTERN.test(title)) {
        reasons.push("hard:window.error_title");
        return { shouldEmit: true, reasons, mediumSignalCount: mediumSignals.size };
      }
      if (CODE_OR_URL_PATTERN.test(title)) {
        mediumSignals.add("medium:window.code_or_url_title");
      }
      continue;
    }

    if (obs.kind === "app.switch") {
      const appName = getStringData(obs, "appName");
      if (!appName) continue;
      if (DEV_APP_NAMES.has(appName.toLowerCase())) {
        mediumSignals.add("medium:app.dev_tool_switch");
      }
    }
  }

  if (mediumSignals.size >= 2) {
    reasons.push(...mediumSignals);
    reasons.push("decision:combined_medium_signals");
    return { shouldEmit: true, reasons, mediumSignalCount: mediumSignals.size };
  }

  return {
    shouldEmit: false,
    reasons: [...mediumSignals],
    mediumSignalCount: mediumSignals.size,
  };
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

      // DND: mute when user is rapidly active (burst of observations).
      // A single app.switch or clipboard change is fine, but 3+ observations
      // in one debounce window signals the user is actively working and
      // shouldn't be interrupted.
      const isBurst = redacted.length >= 3;
      const hasTypingSignal = isBurst || redacted.some((obs) =>
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

      const signalClassification = classifyBatchSignal(redacted);
      if (!signalClassification.shouldEmit) {
        log.debug("[companion] skipping — no high-signal observations");
        traceCompanion("loop.skipped.low_signal", {
          kinds,
          reasons: signalClassification.reasons,
          mediumSignalCount: signalClassification.mediumSignalCount,
        });
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
        signalReasons: signalClassification.reasons,
      });
    }
  } finally {
    clearAllPendingApprovals();
    context.setState("idle");
    log.debug("[companion] loop stopped");
    traceCompanion("loop.stopped");
  }
}
