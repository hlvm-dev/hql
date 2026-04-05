import { truncate } from "../../../../../common/utils.ts";
import type { PlanningPhase } from "../../../../agent/planning.ts";
import type { TodoState } from "../../../../agent/todo-state.ts";
import type {
  AgentConversationItem,
  ConversationItem,
  DelegateItem,
  ErrorItem,
  InfoItem,
  MemoryActivityItem,
  ThinkingItem,
  ToolCallDisplay,
} from "../../types.ts";
import {
  normalizeActivityText,
  SHELL_COMMAND_LABELS,
  summarizeActivityArgs,
} from "./activity-labels.ts";

const PLAN_SURFACE_HIDDEN_TOOL_NAMES = new Set([
  "ask_user",
  "plan_review",
  "todo_read",
  "todo_write",
]);

export interface PlanTodoSummary {
  completed: number;
  inProgress: number;
  pending: number;
  total: number;
}

export interface PlanSurfaceState<T extends ConversationItem> {
  active: boolean;
  phaseLabel: string;
  phaseTone: "active" | "success" | "warning";
  progressLabel?: string;
  currentStep?: string;
  currentActivity?: string;
  recentActivities: string[];
  visibleItems: T[];
}

export interface PlanFlowActivityOptions {
  includeThinking?: boolean;
  includeAssistant?: boolean;
  includeInfo?: boolean;
  includeErrors?: boolean;
  includeMemory?: boolean;
  includeDelegates?: boolean;
}

export function summarizePlanTodoState(
  todoState: TodoState | undefined,
): PlanTodoSummary {
  const summary: PlanTodoSummary = {
    completed: 0,
    inProgress: 0,
    pending: 0,
    total: 0,
  };
  for (const item of todoState?.items ?? []) {
    summary.total += 1;
    if (item.status === "completed") {
      summary.completed += 1;
    } else if (item.status === "in_progress") {
      summary.inProgress += 1;
    } else {
      summary.pending += 1;
    }
  }
  return summary;
}

export function getPlanPhaseLabel(phase: PlanningPhase | undefined): string {
  switch (phase) {
    case "researching":
      return "Plan research";
    case "drafting":
      return "Plan drafting";
    case "reviewing":
      return "Plan review";
    case "executing":
      return "Plan executing";
    case "done":
      return "Plan complete";
    default:
      return "Plan mode";
  }
}

export function getPlanPhaseTone(
  phase: PlanningPhase | undefined,
): "active" | "success" | "warning" {
  if (phase === "done") return "success";
  if (phase === "reviewing") return "warning";
  return "active";
}

export function isPlanSurfaceActive(
  planningPhase: PlanningPhase | undefined,
  todoState: TodoState | undefined,
): boolean {
  return Boolean(planningPhase || todoState?.items.length);
}

export function getPlanProgressLabel(
  todoState: TodoState | undefined,
): string | undefined {
  const summary = summarizePlanTodoState(todoState);
  if (summary.total === 0) return undefined;
  return `${summary.completed}/${summary.total} completed`;
}

export function getPlanCurrentStep(
  todoState: TodoState | undefined,
): string | undefined {
  const activeItem = todoState?.items.find((item) =>
    item.status === "in_progress"
  );
  if (activeItem) return activeItem.content;
  const nextPendingItem = todoState?.items.find((item) =>
    item.status === "pending"
  );
  if (nextPendingItem) return nextPendingItem.content;
  const items = todoState?.items ?? [];
  return items.length > 0 ? items[items.length - 1]?.content : undefined;
}

export function getPlanPhasePlaceholder(
  phase: PlanningPhase | undefined,
): string | undefined {
  switch (phase) {
    case "researching":
      return "Gathering the first planning step";
    case "drafting":
      return "Assembling the implementation plan";
    case "reviewing":
      return "Waiting for plan review";
    case "executing":
      return "Starting implementation";
    default:
      return undefined;
  }
}

function summarizeThinkingActivity(item: ThinkingItem): string {
  const firstLine =
    item.summary.split("\n").find((line) => line.trim().length > 0)
      ?.trim() ?? "";
  return truncate(firstLine, 84, "…");
}

function summarizeToolActivity(tool: ToolCallDisplay): string {
  if (tool.status === "running" && tool.progressText?.trim()) {
    return truncate(tool.progressText.trim(), 84, "…");
  }
  const args = summarizeActivityArgs(tool.name, tool.argsSummary);
  const shellCommand = tool.name === "shell_exec"
    ? normalizeActivityText(tool.argsSummary)
    : "";
  switch (tool.name) {
    case "search_web":
      return args ? `Researching ${args}` : "Researching the request";
    case "web_fetch":
    case "fetch_url":
      return args ? `Fetching ${args}` : "Fetching the target";
    case "read_file":
      return args ? `Reading ${args}` : "Reading the target file";
    case "search_code":
      return args ? `Searching ${args}` : "Searching the codebase";
    case "list_files":
      return args ? `Listing ${args}` : "Inspecting the target directory";
    case "write_file":
      return args ? `Writing ${args}` : "Writing the target file";
    case "edit_file":
      return args ? `Editing ${args}` : "Editing the target file";
    case "open_path":
      return args ? `Opening ${args}` : "Opening the result";
    case "shell_exec": {
      const shellMatch = SHELL_COMMAND_LABELS.find(([re]) =>
        re.test(shellCommand)
      );
      if (shellMatch) {
        const label = shellMatch[1];
        return args ? `${label}: ${args}` : label;
      }
      return args ? `Running ${args}` : "Running a shell command";
    }
    default:
      return args ? `${tool.name} ${args}` : tool.name;
  }
}

function isPlanNoiseTool(tool: ToolCallDisplay): boolean {
  return PLAN_SURFACE_HIDDEN_TOOL_NAMES.has(tool.name);
}

function capitalizeStatus(status: string): string {
  if (!status) return "";
  return `${status[0]!.toUpperCase()}${status.slice(1)}`;
}

function summarizeDelegateActivity(item: DelegateItem): string {
  const agentLabel = item.nickname ?? item.agent;
  const taskLabel = truncate(item.task.trim(), 56, "…");
  if (item.summary?.trim()) {
    return truncate(item.summary.trim(), 84, "…");
  }
  switch (item.status) {
    case "running":
      return taskLabel
        ? `Delegating to ${agentLabel}: ${taskLabel}`
        : `Delegating to ${agentLabel}`;
    case "queued":
      return taskLabel
        ? `Queued ${agentLabel}: ${taskLabel}`
        : `Queued ${agentLabel}`;
    case "error":
      return item.error?.trim()
        ? `Delegate error: ${truncate(item.error.trim(), 60, "…")}`
        : `Delegate error from ${agentLabel}`;
    case "cancelled":
      return `Delegate cancelled: ${agentLabel}`;
    default:
      return `${capitalizeStatus(item.status)} delegate ${agentLabel}`;
  }
}

function summarizeInfoActivity(item: InfoItem): string | undefined {
  const text = normalizeActivityText(item.text);
  return text.length > 0 ? truncate(text, 84, "…") : undefined;
}

function summarizeErrorActivity(item: ErrorItem): string | undefined {
  const text = normalizeActivityText(item.text);
  return text.length > 0 ? truncate(text, 84, "…") : undefined;
}

function summarizeMemoryActivity(item: MemoryActivityItem): string {
  const parts: string[] = [];
  if (item.recalled > 0) parts.push(`${item.recalled} recalled`);
  if (item.written > 0) parts.push(`${item.written} written`);
  if (item.searched) parts.push(`${item.searched.count} searched`);
  return parts.length > 0 ? `Memory ${parts.join(" · ")}` : "Updating memory";
}

function summarizeAssistantActivity(text: string): string | undefined {
  const firstLine = text.split("\n").find((line) => line.trim().length > 0)
    ?.trim();
  return firstLine ? truncate(firstLine, 84, "…") : undefined;
}

function summarizeConversationItemActivity(
  item: ConversationItem,
  options: PlanFlowActivityOptions = {},
): string | undefined {
  switch (item.type) {
    case "thinking":
      if (options.includeThinking === false) return undefined;
      return summarizeThinkingActivity(item);
    case "delegate":
      if (options.includeDelegates === false) return undefined;
      return summarizeDelegateActivity(item);
    case "error":
      if (options.includeErrors === false) return undefined;
      return summarizeErrorActivity(item);
    case "info":
      if (options.includeInfo === false) return undefined;
      return summarizeInfoActivity(item);
    case "memory_activity":
      if (options.includeMemory === false) return undefined;
      return summarizeMemoryActivity(item);
    case "assistant":
      if (options.includeAssistant === false) return undefined;
      return summarizeAssistantActivity(item.text);
    default:
      return undefined;
  }
}

export function getPlanSurfaceItems<T extends ConversationItem>(
  items: readonly T[],
): T[] {
  return items.flatMap((item) => {
    if (item.type === "thinking" || item.type === "turn_stats") {
      return [];
    }
    if (item.type !== "tool_group") {
      return [item];
    }

    const visibleTools = item.tools.filter((tool) => !isPlanNoiseTool(tool));
    if (visibleTools.length === 0) {
      return [];
    }
    if (visibleTools.length === item.tools.length) {
      return [item];
    }
    return [{ ...item, tools: visibleTools } as T];
  });
}

export function compactPlanTranscriptItems<T extends ConversationItem>(
  items: readonly T[],
): T[] {
  const lastUserIndex = items.findLastIndex((item) => item.type === "user");
  if (lastUserIndex < 0) {
    return getPlanSurfaceItems(items);
  }
  const activeTurnItems = items.slice(lastUserIndex + 1);
  const hasPlanSignals = activeTurnItems.some((item) => {
    if (item.type === "thinking") return true;
    if (item.type === "tool_group") {
      return item.tools.some((tool) => isPlanNoiseTool(tool));
    }
    return false;
  });
  if (!hasPlanSignals) {
    return [...items];
  }
  const historyPrefix = items.slice(0, lastUserIndex + 1);
  const activePlanSuffix = getPlanSurfaceItems(activeTurnItems);
  return [...historyPrefix, ...activePlanSuffix];
}

export function derivePlanSurfaceState<T extends ConversationItem>(
  options: {
    items: readonly T[];
    planningPhase?: PlanningPhase;
    todoState?: TodoState;
  },
): PlanSurfaceState<T> {
  const active = isPlanSurfaceActive(options.planningPhase, options.todoState);
  const visibleItems = active
    ? compactPlanTranscriptItems(options.items)
    : [...options.items];
  return {
    active,
    phaseLabel: getPlanPhaseLabel(options.planningPhase),
    phaseTone: getPlanPhaseTone(options.planningPhase),
    progressLabel: getPlanProgressLabel(options.todoState),
    currentStep: getPlanCurrentStep(options.todoState),
    currentActivity: getPlanFlowActivitySummary(options.items),
    recentActivities: getRecentPlanFlowActivitySummaries(options.items),
    visibleItems,
  };
}

export function getPlanFlowActivities(
  items: readonly ConversationItem[],
  mode: "latest" | "recent",
  limit = 3,
  options: PlanFlowActivityOptions = {},
): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item) {
      continue;
    }

    if (item.type === "tool_group") {
      const visibleTools = item.tools.filter((tool) => !isPlanNoiseTool(tool));
      if (visibleTools.length === 0) {
        continue;
      }

      if (mode === "latest") {
        const latestTool = visibleTools.findLast((tool) =>
          tool.status === "running"
        ) ?? visibleTools[visibleTools.length - 1];
        if (latestTool) {
          return [summarizeToolActivity(latestTool)];
        }
        continue;
      }

      for (let ti = visibleTools.length - 1; ti >= 0; ti--) {
        const summary = summarizeToolActivity(visibleTools[ti]).trim();
        if (!summary || seen.has(summary)) continue;
        seen.add(summary);
        results.push(summary);
        if (results.length >= limit) return results;
      }
      continue;
    }

    const summary = summarizeConversationItemActivity(item, options)?.trim();
    if (!summary) {
      continue;
    }
    if (mode === "latest") {
      return [summary];
    }
    if (seen.has(summary)) continue;
    seen.add(summary);
    results.push(summary);
    if (results.length >= limit) return results;
  }

  return results;
}

export function getPlanFlowActivitySummary(
  items: readonly ConversationItem[],
  options: PlanFlowActivityOptions = {},
): string | undefined {
  return getPlanFlowActivities(items, "latest", 1, options)[0];
}

export function getRecentPlanFlowActivitySummaries(
  items: readonly ConversationItem[],
  limit = 3,
  options: PlanFlowActivityOptions = {},
): string[] {
  return getPlanFlowActivities(items, "recent", limit, options);
}

export type AgentPlanSurfaceState = PlanSurfaceState<AgentConversationItem>;
