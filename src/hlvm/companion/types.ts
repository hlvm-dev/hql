/**
 * Companion Agent — Type Definitions
 *
 * Pure types, zero runtime imports.
 */

// --- Observation pipeline ---

export type ObservationKind =
  | "app.switch"
  | "ui.window.title.changed"
  | "ui.window.focused"
  | "ui.selection.changed"
  | "clipboard.changed"
  | "fs.changed"
  | "check.failed"
  | "check.passed"
  | "terminal.result"
  | "screen.captured"
  | "custom";

export interface Observation {
  kind: ObservationKind;
  timestamp: string;
  source: string;
  scope?: string;
  data: Record<string, unknown>;
}

// --- Events (SSE to client) ---

export type CompanionEventType =
  | "message"
  | "action_request"
  | "action_result"
  | "action_cancelled"
  | "vision_request"
  | "capture_request"
  | "status_change";

export interface CompanionEvent {
  type: CompanionEventType;
  content: string;
  timestamp: string;
  id: string;
}

export interface CompanionResponse {
  eventId: string;
  actionId?: string;
  approved?: boolean;
  reply?: string;
  visionRequestId?: string;
}

// --- Signal classification (SSOT for debounce triage + loop emission) ---

/** Observations worth preserving during batch overflow triage. */
export const TRIAGE_PRIORITY_KINDS: ReadonlySet<ObservationKind> = new Set([
  "check.failed",
  "check.passed",
  "terminal.result",
  "screen.captured",
  "app.switch",
]);

/** Observations that warrant emitting a prompt to the user (interrupt-worthy). */
export const EMISSION_SIGNAL_KINDS: ReadonlySet<ObservationKind> = new Set([
  "check.failed",
  "terminal.result",
  "screen.captured",
]);

// --- Lifecycle ---

export type CompanionState =
  | "idle"
  | "observing"
  | "paused";

export interface CompanionConfig {
  enabled: boolean;
  debounceWindowMs: number;
  maxBufferSize: number;
  quietWhileTypingMs: number;
  maxNotifyPerMinute: number;
  debugAlwaysReact?: boolean;
}

export const DEFAULT_COMPANION_CONFIG: CompanionConfig = {
  enabled: false,
  debounceWindowMs: 3000,
  maxBufferSize: 100,
  quietWhileTypingMs: 5000,
  maxNotifyPerMinute: 3,
  debugAlwaysReact: false,
};
