import type { PermissionMode } from "../../common/config/types.ts";
import type { PlanningMode } from "./planning.ts";

export type AgentExecutionMode = PermissionMode | "plan";

type ReplAgentExecutionMode =
  | "default"
  | "auto-edit"
  | "plan"
  | "yolo";

const REPL_AGENT_EXECUTION_MODES: readonly ReplAgentExecutionMode[] = [
  "default",
  "auto-edit",
  "plan",
  "yolo",
];

const EXECUTION_MODE_BADGES: Partial<Record<AgentExecutionMode, string>> = {
  "auto-edit": "accept edits on (shift+tab to cycle)",
  "plan": "plan mode on (shift+tab to cycle)",
  "yolo": "full auto on (shift+tab to cycle)",
};

const EXECUTION_MODE_CHANGE_MESSAGES: Record<AgentExecutionMode, string> = {
  "default": "Default mode",
  "auto-edit": "Accept edits",
  "plan": "Plan mode",
  "yolo": "Full auto",
};

const EXECUTION_MODE_SELECTION_LABELS: Record<ReplAgentExecutionMode, string> =
  {
    "default": "default model",
    "auto-edit": "accept edits model",
    "plan": "plan mode model",
    "yolo": "full auto model",
  };

export function toAgentExecutionMode(
  permissionMode?: PermissionMode,
): AgentExecutionMode {
  return permissionMode ?? "default";
}

export function cycleReplAgentExecutionMode(
  current: AgentExecutionMode,
): ReplAgentExecutionMode {
  const currentIndex = REPL_AGENT_EXECUTION_MODES.indexOf(
    current as ReplAgentExecutionMode,
  );
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  return REPL_AGENT_EXECUTION_MODES[
    (safeIndex + 1) % REPL_AGENT_EXECUTION_MODES.length
  ];
}

export function getAgentExecutionModeBadge(
  mode?: AgentExecutionMode,
): string | undefined {
  return mode ? EXECUTION_MODE_BADGES[mode] : undefined;
}

export function getAgentExecutionModeChangeMessage(
  mode: AgentExecutionMode,
): string {
  return EXECUTION_MODE_CHANGE_MESSAGES[mode];
}

function getAgentExecutionModeSelectionLabel(
  mode: ReplAgentExecutionMode,
): string {
  return EXECUTION_MODE_SELECTION_LABELS[mode];
}

export function getPlanningModeForExecutionMode(
  mode?: AgentExecutionMode,
): PlanningMode {
  return mode === "plan" ? "always" : "auto";
}

export function isPlanExecutionMode(
  mode?: AgentExecutionMode,
): mode is "plan" {
  return mode === "plan";
}
