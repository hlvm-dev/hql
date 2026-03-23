/**
 * Runtime Initialization Progress Tracking
 * Provides phase-by-phase progress events for UI feedback
 */

import { globalLogger } from "../logger.ts";

export type InitPhase =
  | "helpers"
  | "config"
  | "context"
  | "stdlib"
  | "cache"
  | "ai"
  | "complete";

export interface InitProgressEvent {
  phase: InitPhase;
  label: string;
  step: number;
  total: number;
}

type ProgressCallback = (event: InitProgressEvent) => void;

class RuntimeProgressTracker {
  private listeners: Set<ProgressCallback> = new Set();

  subscribe(callback: ProgressCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(phase: InitPhase, label: string, step: number, total: number): void {
    const event: InitProgressEvent = { phase, label, step, total };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        globalLogger.error?.("Progress listener error:", error);
      }
    }
  }

  reset(): void {
    this.listeners.clear();
  }
}

export const runtimeProgress = new RuntimeProgressTracker();
