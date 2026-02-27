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
export { COMPANION_CHANNEL } from "./loop.ts";
export { resolveApproval as resolveCompanionResponse } from "./approvals.ts";

import type { CompanionConfig } from "./types.ts";
import { DEFAULT_COMPANION_CONFIG } from "./types.ts";
import { ObservationBus } from "./bus.ts";
import { CompanionContext } from "./context.ts";
import { runCompanionLoop } from "./loop.ts";
import { clearAllPendingApprovals } from "./approvals.ts";
import { log } from "../api/log.ts";

// --- Module-level singleton state ---
let bus: ObservationBus | null = null;
let context: CompanionContext | null = null;
let abortController: AbortController | null = null;
let currentConfig: CompanionConfig = { ...DEFAULT_COMPANION_CONFIG };

export function startCompanion(config?: Partial<CompanionConfig>): void {
  if (bus) return; // already running
  currentConfig = { ...DEFAULT_COMPANION_CONFIG, ...config, enabled: true };
  bus = new ObservationBus(currentConfig.maxBufferSize);
  context = new CompanionContext();
  abortController = new AbortController();
  // Fire-and-forget — loop runs until abort or bus close
  runCompanionLoop(bus, currentConfig, context, abortController.signal).catch(
    (err) => log.error("[companion] loop error", err),
  );
  log.info("[companion] started");
}

export function stopCompanion(): void {
  clearAllPendingApprovals();
  abortController?.abort();
  bus?.close();
  bus = null;
  context = null;
  abortController = null;
  currentConfig = { ...DEFAULT_COMPANION_CONFIG };
  log.info("[companion] stopped");
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
