/**
 * ConversationPanel Component
 *
 * Renders a list of ConversationItems by dispatching to appropriate
 * message components. Used during agent mode in the REPL.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { truncate } from "../../../../common/utils.ts";
import {
  isStructuredTeamInfoItem,
  type AssistantCitation,
  type ConversationItem,
  type StreamingState,
  StreamingState as ConversationStreamingState,
  type ThinkingItem,
  type ToolCallDisplay,
} from "../types.ts";
import type { Plan, PlanningPhase } from "../../../agent/planning.ts";
import type { TodoState } from "../../../agent/todo-state.ts";
import type {
  InteractionRequestEvent,
  InteractionResponse,
} from "../../../agent/registry.ts";
import { findCurrentTurnStartIndex } from "../../agent-transcript-state.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import {
  estimateInteractionDialogRows,
  isPickerInteractionRequest,
} from "./conversation/interaction-dialog-layout.ts";
import {
  clampConversationScrollOffset,
  computeConversationViewport,
  getConversationVisibleCount,
} from "../utils/conversation-viewport.ts";
import {
  executeHandler,
  HandlerIds,
  inspectHandlerKeybinding,
  registerHandler,
  unregisterHandler,
} from "../keybindings/index.ts";
import {
  AssistantMessage,
  ConfirmationDialog,
  DelegateItem,
  ErrorMessage,
  InfoMessage,
  QuestionDialog,
  ThinkingIndicator,
  ToolGroup,
  TurnStats,
  UserMessage,
} from "./conversation/index.ts";
import { useSemanticColors } from "../../theme/index.ts";
import { RenderErrorBoundary } from "./ErrorBoundary.tsx";

const CONVERSATION_KEYBINDING_CATEGORIES = ["Conversation"] as const;

const SHELL_COMMAND_LABELS: ReadonlyArray<[RegExp, string]> = [
  [/^mkdir\b/i, "Creating directories"],
  [/^mv\b/i, "Moving files"],
  [/^cp\b/i, "Copying files"],
  [/^rm\b/i, "Removing files"],
];

interface ConversationPanelProps {
  items: ConversationItem[];
  width: number;
  streamingState?: StreamingState;
  activePlan?: Plan;
  planningPhase?: PlanningPhase;
  todoState?: TodoState;
  pendingPlanReview?: { plan: Plan };
  /** Whether section toggle hotkeys should be active (avoid conflicts with input editing) */
  allowToggleHotkeys?: boolean;
  /** Pending interaction request (permission or question) */
  interactionRequest?: InteractionRequestEvent;
  /** Number of queued interactions (permission/question) */
  interactionQueueLength?: number;
  /** Additional rows to reserve in viewport (e.g. queue preview bar) */
  extraReservedRows?: number;
  /** Callback to respond to interaction request */
  onInteractionResponse?: (
    requestId: string,
    response: InteractionResponse,
  ) => void;
  /** Interrupt the current question flow entirely (Esc on clarification picker) */
  onQuestionInterrupt?: () => void;
}

type ToggleTarget =
  | { kind: "tool"; id: string }
  | { kind: "thinking"; id: string }
  | { kind: "delegate"; id: string };

function estimateWrappedRows(text: string, width: number): number {
  if (text.length === 0) return 0;
  const usableWidth = Math.max(1, width);
  return text.split("\n").reduce((rows: number, line: string) => {
    return rows + Math.max(1, Math.ceil(Array.from(line).length / usableWidth));
  }, 0);
}

function shouldRenderConversationItem(item: ConversationItem): boolean {
  return !(
    isStructuredTeamInfoItem(item) &&
    item.teamEventType === "team_runtime_snapshot"
  );
}

function getToggleTargets(items: ConversationItem[]): ToggleTarget[] {
  const targets: ToggleTarget[] = [];
  for (const item of items) {
    if (item.type === "thinking") {
      const lines = item.summary.split("\n");
      if (lines.length > 1) {
        targets.push({ kind: "thinking", id: item.id });
      }
      continue;
    }
    if (item.type === "tool_group") {
      for (const tool of item.tools) {
        if (tool.resultText) {
          targets.push({ kind: "tool", id: tool.id });
        }
      }
    }
    if (item.type === "delegate" && item.snapshot?.events.length) {
      targets.push({ kind: "delegate", id: item.id });
    }
  }
  return targets;
}

function getLatestCitation(
  items: ConversationItem[],
): AssistantCitation | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type !== "assistant") continue;
    const citations = Array.isArray(item.citations) ? item.citations : [];
    if (citations.length === 0) continue;
    return citations[0];
  }
  return undefined;
}

export function getActiveThinkingId(
  items: ConversationItem[],
  streamingState: StreamingState | undefined,
): string | undefined {
  if (streamingState !== ConversationStreamingState.Responding) {
    return undefined;
  }
  const turnStartIdx = findCurrentTurnStartIndex(items);
  for (let i = items.length - 1; i > turnStartIdx; i--) {
    const item = items[i];
    if (item?.type === "thinking") return item.id;
  }
  return undefined;
}

function shouldCompactPlanTranscript(
  _planningPhase: PlanningPhase | undefined,
  _activePlan: Plan | undefined,
  _pendingPlanReview: { plan: Plan } | undefined,
): boolean {
  // Disabled: compact mode hid conversation history and flushed the screen.
  // All items now render normally during plan mode.
  return false;
}

export function shouldHideConversationTextInCompactPlanFlow(
  compactPlanTranscript: boolean,
  planningPhase: PlanningPhase | undefined,
  streamingState: StreamingState | undefined,
  hasInteractionRequest: boolean,
): boolean {
  if (!compactPlanTranscript) return false;
  if (planningPhase === "done") return false;
  return streamingState !== ConversationStreamingState.Idle ||
    hasInteractionRequest;
}

export function getConversationDisplayItems(
  items: ConversationItem[],
  options?: {
    compactPlanTranscript?: boolean;
    suppressCurrentTurnPrompt?: boolean;
    hideConversationText?: boolean;
  },
): ConversationItem[] {
  // Only compute turn index for picker suppression, NOT for history hiding
  const currentTurnStartIndex =
    options?.compactPlanTranscript && options?.suppressCurrentTurnPrompt
    ? findCurrentTurnStartIndex(items)
    : -1;
  return items.filter((item, itemIndex) => {
    if (!shouldRenderConversationItem(item)) {
      return false;
    }
    // Picker prompt suppression (unchanged)
    if (
      currentTurnStartIndex >= 0 &&
      itemIndex >= currentTurnStartIndex &&
      (item.type === "user" || item.type === "assistant")
    ) {
      return false;
    }
    // Hide conversation text during active compact plan flow (unchanged)
    if (
      options?.hideConversationText &&
      (item.type === "user" || item.type === "assistant")
    ) {
      return false;
    }
    if (!options?.compactPlanTranscript) {
      return true;
    }
    // During plan mode: hide thinking and stats (noise), SHOW everything else
    if (item.type === "thinking" || item.type === "turn_stats") {
      return false;
    }
    return true;
  });
}

function summarizeThinkingActivity(item: ThinkingItem): string {
  const firstLine = item.summary.split("\n").find((line) => line.trim().length > 0)
    ?.trim() ?? "";
  return truncate(firstLine, 84, "…");
}

function summarizeToolActivity(tool: ToolCallDisplay): string {
  const args = truncate(tool.argsSummary.replace(/\s+/g, " ").trim(), 72, "…");
  const shellCommand = tool.name === "shell_exec"
    ? tool.argsSummary.replace(/\s+/g, " ").trim()
    : "";
  switch (tool.name) {
    case "read_file":
      return args ? `Reading ${args}` : "Reading the target file";
    case "search_code":
      return args ? `Searching ${args}` : "Searching the codebase";
    case "list_files":
      return args ? `Listing ${args}` : "Inspecting the target directory";
    case "edit_file":
      return args ? `Editing ${args}` : "Editing the target file";
    case "todo_write":
      return "Updating the checklist";
    case "ask_user":
      return "Waiting on a clarification";
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

export function getPlanFlowActivities(
  items: ConversationItem[],
  mode: "latest" | "recent",
  limit = 3,
): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (mode === "latest" && item?.type === "thinking") {
      const summary = summarizeThinkingActivity(item);
      if (summary.length > 0) return [summary];
      continue;
    }
    if (item?.type === "tool_group") {
      if (mode === "latest") {
        const latestTool = [...item.tools].reverse().find((tool) =>
          tool.status === "running"
        ) ?? item.tools[item.tools.length - 1];
        if (latestTool) return [summarizeToolActivity(latestTool)];
      } else {
        for (const tool of [...item.tools].reverse()) {
          const summary = summarizeToolActivity(tool).trim();
          if (!summary || seen.has(summary)) continue;
          seen.add(summary);
          results.push(summary);
          if (results.length >= limit) return results;
        }
      }
    }
  }
  return results;
}

export function getPlanFlowActivitySummary(
  items: ConversationItem[],
): string | undefined {
  return getPlanFlowActivities(items, "latest")[0];
}

export function getRecentPlanFlowActivitySummaries(
  items: ConversationItem[],
  limit = 3,
): string[] {
  return getPlanFlowActivities(items, "recent", limit);
}

function getPlanningPhaseTitle(
  phase: PlanningPhase | undefined,
  hasPendingPlanReview: boolean,
): string | undefined {
  switch (phase) {
    case "researching":
      return "Researching";
    case "drafting":
      return "Drafting plan";
    case "reviewing":
      return hasPendingPlanReview
        ? "Ready to code"
        : "Reviewing";
    case "executing":
      return "Executing";
    case "done":
      return "Plan complete";
    default:
      return undefined;
  }
}

function getPlanningPhaseSummary(
  phase: PlanningPhase | undefined,
  plan: Plan | undefined,
  hasPendingPlanReview: boolean,
): string | undefined {
  if (plan) {
    if (hasPendingPlanReview) {
      return plan.goal;
    }
    return plan.goal;
  }
  switch (phase) {
    case "researching":
      return "Read-only planning is active";
    case "drafting":
      return "Turning research into a concrete plan";
    case "reviewing":
      return "Review the plan before execution";
    default:
      return undefined;
  }
}

function estimateTodoRows(
  todoState: TodoState | undefined,
  width: number,
): number {
  if (!todoState || todoState.items.length === 0) return 0;
  const contentWidth = Math.max(12, width);
  return 1 +
    todoState.items.reduce(
      (total: number, item: TodoState["items"][number]) =>
        total + estimateWrappedRows(`[ ] ${item.content}`, contentWidth),
      0,
    );
}

function renderItem(
  item: ConversationItem,
  width: number,
  activeThinkingId: string | undefined,
  isToolExpanded: (toolId: string) => boolean,
  isThinkingExpanded: (thinkingId: string) => boolean,
  isDelegateExpanded: (delegateId: string) => boolean,
): React.ReactElement | null {
  if (!shouldRenderConversationItem(item)) {
    return null;
  }

  switch (item.type) {
    case "user":
      return (
        <UserMessage
          text={item.text}
          attachments={item.attachments}
          width={width}
        />
      );
    case "assistant":
      return (
        <AssistantMessage
          text={item.text}
          citations={item.citations}
          isPending={item.isPending}
          width={width}
        />
      );
    case "thinking":
      return (
        <ThinkingIndicator
          kind={item.kind}
          summary={item.summary}
          iteration={item.iteration}
          expanded={isThinkingExpanded(item.id)}
          isAnimating={item.id === activeThinkingId}
        />
      );
    case "tool_group":
      return (
        <ToolGroup
          tools={item.tools}
          width={width}
          isToolExpanded={isToolExpanded}
        />
      );
    case "delegate":
      return (
        <DelegateItem
          item={item}
          width={width}
          expanded={isDelegateExpanded(item.id)}
        />
      );
    case "turn_stats":
      return (
        <TurnStats
          toolCount={item.toolCount}
          durationMs={item.durationMs}
          inputTokens={item.inputTokens}
          outputTokens={item.outputTokens}
          modelId={item.modelId}
        />
      );
    case "error":
      return <ErrorMessage text={item.text} />;
    case "info":
      return <InfoMessage text={item.text} />;
    default:
      return null;
  }
}

// Conversation history is expensive to recompute; skip redraws while the
// composer draft changes but the transcript props stay referentially stable.
export const ConversationPanel = React.memo(function ConversationPanel({
  items,
  width,
  streamingState,
  activePlan,
  planningPhase,
  todoState,
  pendingPlanReview,
  allowToggleHotkeys = true,
  interactionRequest,
  interactionQueueLength = 0,
  onInteractionResponse,
  onQuestionInterrupt,
  extraReservedRows = 0,
}: ConversationPanelProps): React.ReactElement {
  const sc = useSemanticColors();
  const { stdout } = useStdout();
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedDelegateIds, setExpandedDelegateIds] = useState<Set<string>>(
    () => new Set(),
  );
  const activeThinkingId = useMemo(
    () => getActiveThinkingId(items, streamingState),
    [items, streamingState],
  );
  const [scrollOffsetFromBottom, setScrollOffsetFromBottom] = useState(0);
  const compactPlanTranscript = useMemo(
    () => shouldCompactPlanTranscript(planningPhase, activePlan, pendingPlanReview),
    [activePlan, pendingPlanReview, planningPhase],
  );
  const planFlowActive = streamingState !== ConversationStreamingState.Idle ||
    Boolean(interactionRequest);
  const pickerInteractionActive = useMemo(
    () => isPickerInteractionRequest(interactionRequest),
    [interactionRequest],
  );
  const hideTranscriptDuringPicker = false;
  const hidePlanChromeDuringReviewPicker = Boolean(
    pendingPlanReview && pickerInteractionActive,
  );
  const hideConversationText = false;
  const displayItems = useMemo(
    () =>
      getConversationDisplayItems(items, {
        compactPlanTranscript,
        suppressCurrentTurnPrompt: compactPlanTranscript &&
          pickerInteractionActive,
        hideConversationText,
      }),
    [compactPlanTranscript, hideConversationText, pickerInteractionActive, items],
  );

  useEffect(() => {
    if (displayItems.length === 0) {
      setExpandedToolIds(new Set());
      setExpandedThinkingIds(new Set());
      setExpandedDelegateIds(new Set());
      setScrollOffsetFromBottom(0);
    }
  }, [displayItems.length]);

  const terminalRows = stdout?.rows ?? 24;
  const contentWidth = Math.max(10, width - 6);
  // Derive plan checklist display state from active/pending plan and current planning phase
  // Plan checklist: shows pending-review plan if present, otherwise the active plan
  const planSummary = pendingPlanReview?.plan ?? activePlan;
  const phaseTitle = getPlanningPhaseTitle(
    planningPhase,
    Boolean(pendingPlanReview),
  );
  const phaseSummary = getPlanningPhaseSummary(
    planningPhase,
    planSummary,
    Boolean(pendingPlanReview),
  );
  const latestPlanActivity = useMemo(
    () =>
      compactPlanTranscript
        ? getPlanFlowActivitySummary(items)
        : undefined,
    [compactPlanTranscript, items],
  );
  const recentPlanActivities = useMemo(
    () =>
      compactPlanTranscript
        ? getRecentPlanFlowActivitySummaries(items, 3)
        : [],
    [compactPlanTranscript, items],
  );
  const activeTodoItem = compactPlanTranscript &&
      (planningPhase === "executing" || planningPhase === "done")
    ? todoState?.items.find((item) => item.status === "in_progress")
    : undefined;
  const todoSectionTitle = pendingPlanReview
    ? "Plan"
    : planningPhase === "executing" || planningPhase === "done"
    ? "Progress"
    : "Planning...";
  const interactionRows = estimateInteractionDialogRows(
    interactionRequest,
    width,
  );
  const headerRows = useMemo(() => {
    let total = 0;
    if (!hidePlanChromeDuringReviewPicker && (phaseTitle || phaseSummary)) {
      total += estimateWrappedRows(phaseTitle ?? "Researching", contentWidth);
      if (phaseSummary) {
        total += estimateWrappedRows(phaseSummary, contentWidth);
      }
      if (
        recentPlanActivities.length > 0 &&
        planFlowActive &&
        planningPhase !== "reviewing" &&
        planningPhase !== "done"
      ) {
        total += 1;
        total += recentPlanActivities.reduce(
          (rows: number, summary: string) =>
            rows + estimateWrappedRows(`• ${summary}`, contentWidth),
          0,
        );
      } else if (
        latestPlanActivity &&
        planFlowActive &&
        planningPhase !== "reviewing" &&
        planningPhase !== "done"
      ) {
        total += estimateWrappedRows(latestPlanActivity, contentWidth);
      }
      total += 1;
    }
    if (!hidePlanChromeDuringReviewPicker) {
      total += estimateTodoRows(todoState, contentWidth);
    }
    if (!hidePlanChromeDuringReviewPicker && activeTodoItem) {
      total += estimateWrappedRows(
        `Current: ${activeTodoItem.content}`,
        contentWidth,
      ) + 1;
    }
    return total;
  }, [
    activeTodoItem,
    contentWidth,
    latestPlanActivity,
    planFlowActive,
    recentPlanActivities,
    hidePlanChromeDuringReviewPicker,
    phaseSummary,
    phaseTitle,
    planningPhase,
    todoState,
  ]);
  const visibleCount = useMemo(
    () =>
      getConversationVisibleCount(terminalRows, {
        reservedRows: headerRows + extraReservedRows +
          (interactionRequest ? interactionRows + 2 : 8),
      }),
    [extraReservedRows, headerRows, interactionRows, interactionRequest, terminalRows],
  );
  const renderableDisplayItems = hideTranscriptDuringPicker ? [] : displayItems;
  const viewport = useMemo(
    () =>
      computeConversationViewport(
        renderableDisplayItems.length,
        visibleCount,
        scrollOffsetFromBottom,
      ),
    [renderableDisplayItems.length, scrollOffsetFromBottom, visibleCount],
  );
  const visibleItems = useMemo(
    () => renderableDisplayItems.slice(viewport.start, viewport.end),
    [renderableDisplayItems, viewport.end, viewport.start],
  );

  useEffect(() => {
    setScrollOffsetFromBottom((prev: number) => {
      if (prev === 0) return 0; // At bottom (auto-follow) — nothing to clamp
      return clampConversationScrollOffset(
        prev,
        renderableDisplayItems.length,
        visibleCount,
      );
    });
  }, [renderableDisplayItems.length, visibleCount]);

  // Toggle targets operate over the visible conversation so the latest
  // tool/thinking block can always be expanded without duplicating turns.
  const toggleTargets = useMemo(
    () => getToggleTargets(visibleItems),
    [visibleItems],
  );

  const isToolExpanded = useCallback(
    (toolId: string): boolean => expandedToolIds.has(toolId),
    [expandedToolIds],
  );
  const isThinkingExpanded = useCallback(
    (thinkingId: string): boolean => expandedThinkingIds.has(thinkingId),
    [expandedThinkingIds],
  );
  const isDelegateExpanded = useCallback(
    (delegateId: string): boolean => expandedDelegateIds.has(delegateId),
    [expandedDelegateIds],
  );

  const toggleTarget = useCallback((target: ToggleTarget): void => {
    const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
      setter((prev: Set<string>) => {
        const next = new Set(prev);
        if (next.has(target.id)) next.delete(target.id);
        else next.add(target.id);
        return next;
      });
    };
    if (target.kind === "tool") return toggle(setExpandedToolIds);
    if (target.kind === "delegate") return toggle(setExpandedDelegateIds);
    toggle(setExpandedThinkingIds);
  }, []);

  useEffect(() => {
    registerHandler(
      HandlerIds.CONVERSATION_TOGGLE_LATEST,
      () => {
        const target = toggleTargets[toggleTargets.length - 1];
        if (target) {
          toggleTarget(target);
        }
      },
      "ConversationPanel",
    );
    registerHandler(
      HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE,
      async () => {
        const citation = getLatestCitation(items);
        if (citation?.url) {
          await getPlatform().openUrl(citation.url).catch(() => {});
        }
      },
      "ConversationPanel",
    );
    return () => {
      unregisterHandler(HandlerIds.CONVERSATION_TOGGLE_LATEST);
      unregisterHandler(HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE);
    };
  }, [items, toggleTargets]);

  useInput((char, key) => {
    if (pickerInteractionActive) return;
    if (!displayItems.length) return;

    if (key.pageUp) {
      const pageSize = Math.max(1, visibleCount - 1);
      setScrollOffsetFromBottom((prev: number) =>
        clampConversationScrollOffset(
          prev + pageSize,
          displayItems.length,
          visibleCount,
        )
      );
      return;
    }
    if (key.pageDown) {
      const pageSize = Math.max(1, visibleCount - 1);
      setScrollOffsetFromBottom((prev: number) =>
        clampConversationScrollOffset(
          prev - pageSize,
          displayItems.length,
          visibleCount,
        )
      );
      return;
    }

    const conversationBinding = inspectHandlerKeybinding(char, key, {
      categories: CONVERSATION_KEYBINDING_CATEGORIES,
    });
    if (conversationBinding.kind === "handler") {
      if (interactionRequest?.mode === "question") return;
      if (!allowToggleHotkeys) return;
      void executeHandler(conversationBinding.id);
      return;
    }
    if (
      conversationBinding.kind === "disabled-default" ||
      conversationBinding.kind === "shadowed"
    ) {
      return;
    }
  });

  return (
    <Box flexDirection="column" width={width}>
      {displayItems.length === 0 &&
        streamingState !== ConversationStreamingState.Idle &&
        !phaseTitle &&
        !phaseSummary &&
        !todoState?.items.length &&
        !interactionRequest && (
        <Text color={sc.text.muted}>Conversation starting...</Text>
      )}

      {!hideTranscriptDuringPicker && viewport.hiddenAbove > 0 && (
        <Text color={sc.text.muted}>
          ↑ {viewport.hiddenAbove}{" "}
          earlier item{viewport.hiddenAbove === 1 ? "" : "s"}
        </Text>
      )}

      {visibleItems.map((item: ConversationItem) => (
        <Box key={item.id}>
          <RenderErrorBoundary>
            {renderItem(
              item,
              width,
              activeThinkingId,
              isToolExpanded,
              isThinkingExpanded,
              isDelegateExpanded,
            )}
          </RenderErrorBoundary>
        </Box>
      ))}

      {!hideTranscriptDuringPicker && viewport.hiddenBelow > 0 && (
        <Text color={sc.text.muted}>
          ↓ {viewport.hiddenBelow}{" "}
          newer item{viewport.hiddenBelow === 1 ? "" : "s"}
        </Text>
      )}

      {!hidePlanChromeDuringReviewPicker && (phaseTitle || phaseSummary) && (
        <Box
          marginTop={1}
          flexDirection="column"
        >
          <Text
            color={planningPhase === "done"
              ? sc.status.success
              : planningPhase === "reviewing"
              ? sc.status.warning
              : sc.text.primary}
            bold
          >
            {phaseTitle ?? "Researching"}
          </Text>
          {phaseSummary && (
            <Text color={sc.text.secondary}>
              {phaseSummary}
            </Text>
          )}
          {recentPlanActivities.length > 0 &&
            planFlowActive &&
            planningPhase !== "reviewing" &&
            planningPhase !== "done" && (
            <Box marginTop={1} flexDirection="column">
              <Text color={sc.text.muted}>Activity</Text>
              {recentPlanActivities.map((summary: string) => (
                <Box key={summary}>
                  <Text color={sc.text.muted}>
                    • {summary}
                  </Text>
                </Box>
              ))}
            </Box>
          )}
          {recentPlanActivities.length === 0 &&
            latestPlanActivity &&
            planFlowActive &&
            planningPhase !== "reviewing" &&
            planningPhase !== "done" && (
            <Text color={sc.text.muted}>
              {latestPlanActivity}
            </Text>
          )}
        </Box>
      )}

      {!hidePlanChromeDuringReviewPicker && activeTodoItem && (
        <Box
          marginTop={1}
          flexDirection="column"
        >
          <Text color={sc.border.active} bold>
            Current step
          </Text>
          <Text color={sc.text.primary}>{activeTodoItem.content}</Text>
        </Box>
      )}

      {!hidePlanChromeDuringReviewPicker && todoState &&
        todoState.items.length > 0 && (
        <Box
          marginTop={1}
          flexDirection="column"
        >
          <Text color={sc.status.warning} bold>
            {todoSectionTitle}
          </Text>
          <Box flexDirection="column">
            {todoState.items.map((item) => {
              const marker = item.status === "completed"
                ? "[✓]"
                : item.status === "in_progress"
                ? "[~]"
                : "[ ]";
              const markerColor = item.status === "completed"
                ? sc.status.success
                : item.status === "in_progress"
                ? sc.status.warning
                : sc.text.muted;
              const textColor = item.status === "pending"
                ? sc.text.muted
                : sc.text.primary;
              return (
                <Box key={item.id}>
                  <Text color={markerColor}>{marker} </Text>
                  <Text color={textColor}>{item.content}</Text>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {interactionRequest && onInteractionResponse && (
        <Box flexDirection="column" marginTop={1}>
          {interactionQueueLength > 1 && (
            <Text color={sc.status.warning}>
              {interactionQueueLength - 1}{" "}
              more interaction{interactionQueueLength - 1 === 1 ? "" : "s"}{" "}
              queued
            </Text>
          )}
          {interactionRequest.mode === "permission" && (
            <ConfirmationDialog
              requestId={interactionRequest.requestId}
              toolName={interactionRequest.toolName}
              toolArgs={interactionRequest.toolArgs}
              onResolve={onInteractionResponse}
            />
          )}
          {interactionRequest.mode === "question" && (
            <QuestionDialog
              requestId={interactionRequest.requestId}
              question={interactionRequest.question}
              options={interactionRequest.options}
              onResolve={onInteractionResponse}
              onInterrupt={onQuestionInterrupt}
            />
          )}
        </Box>
      )}
    </Box>
  );
});
