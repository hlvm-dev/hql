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

const EXECUTION_MODE_META: Record<AgentExecutionMode, { label: string }> = {
  "default": { label: "Default mode" },
  "auto-edit": { label: "Accept edits" },
  "plan": { label: "Plan mode" },
  "yolo": { label: "Full auto" },
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

export function getAgentExecutionModeChangeMessage(
  mode: AgentExecutionMode,
): string {
  if (mode === "default") {
    return EXECUTION_MODE_META[mode]?.label ?? mode;
  }
  return `${EXECUTION_MODE_META[mode]?.label ?? mode} (shift+tab to cycle)`;
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
