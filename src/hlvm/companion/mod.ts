/**
 * Companion Agent — Barrel + Lifecycle
 *
 * Re-exports all types and provides start/stop lifecycle management.
 */

export type {
  Observation,
  CompanionResponse,
  CompanionConfig,
} from "./types.ts";
export { resolveApproval as resolveCompanionResponse } from "./approvals.ts";

import type { CompanionConfig } from "./types.ts";
import { DEFAULT_COMPANION_CONFIG } from "./types.ts";
import { ObservationBus } from "./bus.ts";
import { CompanionContext } from "./context.ts";
import { runCompanionLoop, resetEventSequence, COMPANION_CHANNEL } from "./loop.ts";
export { COMPANION_CHANNEL };
import { clearAllPendingApprovals } from "./approvals.ts";
import { clearSessionBuffer } from "../store/sse-store.ts";
import { log } from "../api/log.ts";
import { config } from "../api/config.ts";
import { traceCompanion, getCompanionTracePath } from "./trace.ts";

// --- Module-level singleton state ---
let bus: ObservationBus | null = null;
let context: CompanionContext | null = null;
let abortController: AbortController | null = null;
let currentConfig: CompanionConfig = { ...DEFAULT_COMPANION_CONFIG };

function resolveCompanionModelFromConfig(): string | undefined {
  const configuredModel = config.snapshot.model;
  if (typeof configuredModel !== "string") return undefined;
  const trimmed = configuredModel.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function startCompanion(configUpdate?: Partial<CompanionConfig>): void {
  if (bus) return; // already running
  const fallbackModel = resolveCompanionModelFromConfig();
  const mergedConfig: CompanionConfig = {
    ...DEFAULT_COMPANION_CONFIG,
    enabled: true,
    ...configUpdate,
    gateModel: configUpdate?.gateModel ?? fallbackModel,
    decisionModel: configUpdate?.decisionModel ?? fallbackModel,
  };
  currentConfig = mergedConfig;
  traceCompanion("start.requested", {
    gateModel: currentConfig.gateModel,
    decisionModel: currentConfig.decisionModel,
    debugAlwaysReact: currentConfig.debugAlwaysReact,
    quietWhileTypingMs: currentConfig.quietWhileTypingMs,
    debounceWindowMs: currentConfig.debounceWindowMs,
    tracePath: getCompanionTracePath(),
  });
  if (!currentConfig.enabled) {
    log.info("[companion] start skipped — enabled=false");
    traceCompanion("start.skipped.disabled");
    return;
  }
  bus = new ObservationBus(currentConfig.maxBufferSize);
  context = new CompanionContext();
  abortController = new AbortController();
  // Fire-and-forget — loop runs until abort or bus close
  runCompanionLoop(bus, currentConfig, context, abortController.signal).catch(
    (err) => log.error("[companion] loop error", err),
  );
  log.info("[companion] started");
  traceCompanion("start.completed");
}

export function stopCompanion(): void {
  traceCompanion("stop.requested");
  clearAllPendingApprovals();
  abortController?.abort();
  bus?.close();
  bus = null;
  context = null;
  abortController = null;
  currentConfig = { ...DEFAULT_COMPANION_CONFIG };
  resetEventSequence();
  clearSessionBuffer(COMPANION_CHANNEL);
  log.info("[companion] stopped");
  traceCompanion("stop.completed");
}

export function getCompanionBus(): ObservationBus | null {
  return bus;
}

export function isCompanionRunning(): boolean {
  return bus !== null;
}

export function getCompanionState(): string {
  return context?.getState() ?? "idle";
}

export function getCompanionConfig(): CompanionConfig {
  return { ...currentConfig };
}
