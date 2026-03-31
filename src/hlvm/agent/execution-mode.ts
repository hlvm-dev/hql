import {
  PERMISSION_MODES,
  PERMISSION_MODES_INDEX,
  type PermissionMode,
} from "../../common/config/types.ts";
import type { PlanningMode } from "./planning.ts";

export type AgentExecutionMode = PermissionMode;

const EXECUTION_MODE_LABELS: Record<AgentExecutionMode, string> = {
  "default": "Default mode",
  "acceptEdits": "Accept edits",
  "plan": "Plan mode",
  "bypassPermissions": "Full auto",
  "dontAsk": "Non-interactive",
};

export function toAgentExecutionMode(
  permissionMode?: PermissionMode,
): AgentExecutionMode {
  return permissionMode ?? "default";
}

export function cycleReplAgentExecutionMode(
  current: AgentExecutionMode,
): PermissionMode {
  const currentIndex = PERMISSION_MODES_INDEX.get(current) ?? -1;
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  return PERMISSION_MODES[(safeIndex + 1) % PERMISSION_MODES.length];
}

export function getPersistentAgentExecutionModeLabel(
  mode: AgentExecutionMode,
): string {
  return `${EXECUTION_MODE_LABELS[mode] ?? mode} (shift+tab to cycle)`;
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
