import {
  PERMISSION_MODES,
  type PermissionMode,
} from "../../common/config/types.ts";
import type { PlanningMode } from "./planning.ts";

export type AgentExecutionMode = PermissionMode;

const EXECUTION_MODE_META: Record<AgentExecutionMode, { label: string }> = {
  "default": { label: "Default mode" },
  "acceptEdits": { label: "Accept edits" },
  "plan": { label: "Plan mode" },
  "bypassPermissions": { label: "Bypass permissions" },
  "dontAsk": { label: "Non-interactive" },
};

export function toAgentExecutionMode(
  permissionMode?: PermissionMode,
): AgentExecutionMode {
  return permissionMode ?? "default";
}

export function cycleReplAgentExecutionMode(
  current: AgentExecutionMode,
): PermissionMode {
  const currentIndex = PERMISSION_MODES.indexOf(current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  return PERMISSION_MODES[(safeIndex + 1) % PERMISSION_MODES.length];
}

export function getAgentExecutionModeChangeMessage(
  mode: AgentExecutionMode,
): string {
  if (mode === "default") {
    return EXECUTION_MODE_META[mode]?.label ?? mode;
  }
  return `${EXECUTION_MODE_META[mode]?.label ?? mode} (shift+tab to cycle)`;
}

export function getPersistentAgentExecutionModeLabel(
  mode: AgentExecutionMode,
): string {
  return `${EXECUTION_MODE_META[mode]?.label ?? mode} (shift+tab to cycle)`;
}

export function getPlanningModeForExecutionMode(
  mode?: AgentExecutionMode,
): PlanningMode {
  return mode === "plan" ? "always" : "off";
}

export function isPlanExecutionMode(
  mode?: AgentExecutionMode,
): mode is "plan" {
  return mode === "plan";
}
