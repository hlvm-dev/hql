// Compat domain: model / status-line adapter.
//
// Purpose: the status line and the banner both need the active model label
// and the current effort setting. Rather than threading those through React
// context from multiple sources, route every read through this adapter.
//
// STATUS: scaffold. Banner currently shows a static `"Local runtime ·
// HLVM-managed"` line; when a model-resolution hook lands, wire it through
// here and let the banner re-render dynamically.

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelStatus {
  readonly modelId?: string;
  readonly modelLabel?: string;
  readonly contextWindow?: number;
  readonly effort: EffortLevel;
}

export const INITIAL_MODEL_STATUS: ModelStatus = {
  effort: "medium",
};
