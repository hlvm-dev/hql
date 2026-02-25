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

export interface GateResult {
  decision: "SILENT" | "NOTIFY";
  reason: string;
}

// --- Decision engine ---

export type CompanionDecisionType =
  | "SILENT"
  | "CHAT"
  | "SUGGEST"
  | "ACT"
  | "ASK_VISION";

export interface CompanionDecision {
  type: CompanionDecisionType;
  message?: string;
  actions?: CompanionAction[];
}

export interface CompanionAction {
  id: string;
  label: string;
  description: string;
  requiresApproval: boolean;
}

// --- Events (SSE to client) ---

export type CompanionEventType =
  | "message"
  | "suggestion"
  | "action_request"
  | "vision_request"
  | "capture_request"
  | "action_result"
  | "action_cancelled"
  | "status_change";

export interface CompanionEvent {
  type: CompanionEventType;
  content: string;
  actions?: CompanionAction[];
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

// --- Lifecycle ---

export type CompanionState =
  | "idle"
  | "observing"
  | "thinking"
  | "acting"
  | "paused";

export interface CompanionConfig {
  enabled: boolean;
  debounceWindowMs: number;
  maxBufferSize: number;
  quietWhileTypingMs: number;
  maxNotifyPerMinute: number;
  gateModel?: string;
  decisionModel?: string;
}

export const DEFAULT_COMPANION_CONFIG: CompanionConfig = {
  enabled: false,
  debounceWindowMs: 3000,
  maxBufferSize: 100,
  quietWhileTypingMs: 5000,
  maxNotifyPerMinute: 3,
};
