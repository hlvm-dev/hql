import { truncate } from "../../../../../common/utils.ts";
import type { PlanningPhase } from "../../../../agent/planning.ts";
import type {
  AgentConversationItem,
  ConversationItem,
  StreamingState,
  ToolCallDisplay,
} from "../../types.ts";
import { StreamingState as ConversationStreamingState } from "../../types.ts";
import {
  normalizeActivityText,
  SHELL_COMMAND_LABELS,
  summarizePathLabel,
} from "./activity-labels.ts";
import {
  getPlanFlowActivities,
  getPlanFlowActivitySummary,
  getRecentPlanFlowActivitySummaries,
} from "./plan-flow.ts";

const PROMINENT_TOOL_NAMES = new Set([
  "write_file",
  "edit_file",
  "open_path",
  "shell_exec",
]);

const CLARIFICATION_PREFIX = "clarification needed:";

export interface LiveTurnStatus {
  label: string;
  tone: "active" | "warning";
  recentLabels: string[];
}

export function isProminentToolName(toolName: string): boolean {
  return PROMINENT_TOOL_NAMES.has(toolName);
}

function summarizeShellCommandOutcome(command: string): string | undefined {
  const normalized = normalizeActivityText(command);
  if (!normalized) return undefined;
  if (/^open\b/i.test(normalized)) {
    const target = normalizeActivityText(normalized.replace(/^open\s+/i, ""));
    return `Opened ${summarizePathLabel(target)}`;
  }
  const match = SHELL_COMMAND_LABELS.find(([re]) => re.test(normalized));
  if (match) return match[2]; // completedLabel
  return `Ran ${truncate(normalized, 48, "…")}`;
}

function summarizeCompletedToolOutcome(
  tool: ToolCallDisplay,
): string | undefined {
  const args = normalizeActivityText(tool.argsSummary);
  switch (tool.name) {
    case "write_file":
      return `Wrote ${summarizePathLabel(args)}`;
    case "edit_file":
      return `Edited ${summarizePathLabel(args)}`;
    case "open_path":
      return `Opened ${summarizePathLabel(args)}`;
    case "shell_exec":
      return summarizeShellCommandOutcome(args);
    default:
      return undefined;
  }
}

function resolveWaitingLabel(
  items: readonly AgentConversationItem[],
  planningPhase: PlanningPhase | undefined,
): string {
  if (planningPhase === "reviewing") return "Waiting for plan review";
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.type !== "info") continue;
    const text = normalizeActivityText(item.text).toLowerCase();
    if (text.startsWith(CLARIFICATION_PREFIX)) {
      return "Clarification needed";
    }
  }
  return "Waiting for approval";
}

function resolvePlanningFallbackLabel(
  planningPhase: PlanningPhase | undefined,
): string | undefined {
  switch (planningPhase) {
    case "researching":
      return "Planning the approach";
    case "drafting":
      return "Drafting the implementation plan";
    case "reviewing":
      return "Waiting for plan review";
    case "executing":
      return "Starting implementation";
    default:
      return undefined;
  }
}

function hasPendingAssistant(items: readonly AgentConversationItem[]): boolean {
  return items.some((item) =>
    item.type === "assistant" && item.isPending && item.text.trim().length === 0
  );
}

function isPassiveRecentActivity(label: string): boolean {
  const lower = normalizeActivityText(label).toLowerCase();
  return lower.startsWith(CLARIFICATION_PREFIX) ||
    lower === "waiting for approval" ||
    lower === "waiting for plan review";
}

export function deriveLiveTurnStatus(options: {
  items: readonly AgentConversationItem[];
  streamingState?: StreamingState;
  planningPhase?: PlanningPhase;
}): LiveTurnStatus | undefined {
  const { items, streamingState, planningPhase } = options;
  const recentLabels = getRecentPlanFlowActivitySummaries(items, 3).filter(
    (label) => !isPassiveRecentActivity(label),
  );

  if (streamingState === ConversationStreamingState.WaitingForConfirmation) {
    return {
      label: resolveWaitingLabel(items, planningPhase),
      tone: "warning",
      recentLabels,
    };
  }

  const currentActivity = getPlanFlowActivitySummary(items, {
    includeAssistant: false,
  });
  if (currentActivity) {
    return {
      label: currentActivity,
      tone: "active",
      recentLabels,
    };
  }

  const planningLabel = resolvePlanningFallbackLabel(planningPhase);
  if (planningLabel) {
    return {
      label: planningLabel,
      tone: planningPhase === "reviewing" ? "warning" : "active",
      recentLabels,
    };
  }

  if (hasPendingAssistant(items) && items.length <= 2) {
    return {
      label: "Starting response",
      tone: "active",
      recentLabels,
    };
  }

  return undefined;
}

export function getRecentLiveActivityLabels(
  items: readonly ConversationItem[],
  limit = 3,
): string[] {
  return getRecentPlanFlowActivitySummaries(items, limit).filter((label) =>
    !isPassiveRecentActivity(label)
  );
}

export function getRecentTurnActivityTrail(
  items: readonly ConversationItem[],
  limit = 2,
): string[] {
  return getPlanFlowActivities(items, "recent", limit, {
    includeAssistant: false,
    includeThinking: false,
  }).filter((label) => !isPassiveRecentActivity(label));
}

export function summarizeTurnCompletion(
  items: readonly ConversationItem[],
): string | undefined {
  const summaries: string[] = [];
  const seen = new Set<string>();

  for (let i = items.length - 1; i >= 0 && summaries.length < 2; i--) {
    const item = items[i];
    if (item?.type !== "tool_group") continue;
    for (
      let ti = item.tools.length - 1;
      ti >= 0 && summaries.length < 2;
      ti--
    ) {
      const tool = item.tools[ti];
      if (
        tool.status !== "success" || !isProminentToolName(tool.name)
      ) continue;
      const summary = summarizeCompletedToolOutcome(tool);
      if (!summary || seen.has(summary)) continue;
      seen.add(summary);
      summaries.push(summary);
    }
  }

  return summaries.length > 0 ? summaries.reverse().join(" · ") : undefined;
}
