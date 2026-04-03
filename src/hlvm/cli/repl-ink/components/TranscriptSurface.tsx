import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { PlanningPhase } from "../../../agent/planning.ts";
import type { TodoState } from "../../../agent/todo-state.ts";
import { getPlatform } from "../../../../platform/platform.ts";
import type {
  AgentConversationItem,
  ShellHistoryEntry,
  StreamingState,
} from "../types.ts";
import {
  executeHandler,
  HandlerIds,
  inspectHandlerKeybinding,
  normalizeKeyInput,
  registerHandler,
  unregisterHandler,
} from "../keybindings/index.ts";
import {
  filterDuplicateWaitingIndicators,
  getActiveThinkingId,
  getLatestCitation,
  getToggleTargets,
  TimelineItemRenderer,
} from "./TimelineItemRenderer.tsx";
import { useExpansionState } from "../hooks/useExpansionState.ts";
import { useTranscriptSearch } from "../hooks/useTranscriptSearch.ts";
import { PlanChecklistPanel } from "./conversation/PlanChecklistPanel.tsx";
import { compactPlanTranscriptItems, derivePlanSurfaceState } from "./conversation/plan-flow.ts";
import { shouldRenderTranscriptDividerBeforeIndex } from "../utils/layout-tokens.ts";
import { filterRenderableTimelineItems } from "../utils/timeline-visibility.ts";
import { ShortcutHint } from "./ShortcutHint.tsx";
import { HighlightedText } from "./HighlightedText.tsx";
import { ChromeChip } from "./ChromeChip.tsx";
import { useSemanticColors } from "../../theme/index.ts";
import { truncate } from "../../../../common/utils.ts";
import { STATUS_GLYPHS } from "../ui-constants.ts";
import { StreamingState as ConversationStreamingState } from "../types.ts";

const CONVERSATION_KEYBINDING_CATEGORIES = ["Conversation"] as const;

interface TranscriptSurfaceProps {
  historyItems?: ShellHistoryEntry[];
  liveItems?: AgentConversationItem[];
  width: number;
  reservedRows?: number;
  compactPlanTranscript?: boolean;
  compactSpacing?: boolean;
  interactive?: boolean;
  allowToggleHotkeys?: boolean;
  expandAll?: boolean;
  streamingState?: StreamingState;
  planningPhase?: PlanningPhase;
  todoState?: TodoState;
  showPlanChecklist?: boolean;
  showLeadingDivider?: boolean;
}

interface RowViewport {
  start: number;
  end: number;
  hiddenAboveItems: number;
  hiddenBelowItems: number;
}

function estimateWrappedRows(text: string, width: number): number {
  if (!text) return 0;
  const safeWidth = Math.max(1, width);
  return text.split("\n").reduce((rows, line) => {
    const chars = Math.max(1, Array.from(line).length);
    return rows + Math.max(1, Math.ceil(chars / safeWidth));
  }, 0);
}

function estimateItemRows(item: ShellHistoryEntry, width: number): number {
  const safeWidth = Math.max(12, width - 4);
  switch (item.type) {
    case "user":
      return Math.max(1, estimateWrappedRows(item.text, safeWidth)) +
        (item.attachments?.length ?? 0);
    case "assistant":
      return item.isPending && item.text.trim().length === 0
        ? 1
        : Math.max(1, estimateWrappedRows(item.text, safeWidth));
    case "thinking":
      return 1;
    case "tool_group":
      return Math.max(1, item.tools.reduce((total, tool) => {
        const detail = tool.status === "running"
          ? tool.progressText
          : tool.resultSummaryText ?? tool.resultDetailText ?? tool.resultText;
        return total + 1 + (detail ? estimateWrappedRows(detail, safeWidth - 4) : 0);
      }, 0));
    case "delegate":
      return 1 + (item.summary ? estimateWrappedRows(item.summary, safeWidth - 4) : 0);
    case "delegate_group":
      return Math.max(1, item.entries.length + 1);
    case "turn_stats":
      return 1;
    case "memory_activity":
      return 1 + Math.min(3, item.details.length);
    case "error":
    case "info":
      return Math.max(1, estimateWrappedRows(item.text, safeWidth));
    case "hql_eval":
      return 1 + Math.max(1, estimateWrappedRows(item.input, safeWidth));
  }
}

function binarySearchCumulative(cumulative: readonly number[], row: number): number {
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (cumulative[mid + 1]! <= row) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function computeRowViewport(
  rowHeights: readonly number[],
  visibleRows: number,
  scrollRowsFromBottom: number,
): RowViewport {
  const totalRows = rowHeights.reduce((sum, height) => sum + height, 0);
  const boundedVisibleRows = Math.max(1, visibleRows);
  const maxScroll = Math.max(0, totalRows - boundedVisibleRows);
  const boundedScroll = Math.max(0, Math.min(scrollRowsFromBottom, maxScroll));
  const bottomExclusive = Math.max(0, totalRows - boundedScroll);
  const topInclusive = Math.max(0, bottomExclusive - boundedVisibleRows);

  const cumulative = [0];
  for (const height of rowHeights) {
    cumulative.push(cumulative[cumulative.length - 1]! + height);
  }

  const start = rowHeights.length === 0 ? 0 : binarySearchCumulative(cumulative, topInclusive);
  let end = start;
  while (end < rowHeights.length && cumulative[end]! < bottomExclusive) {
    end += 1;
  }

  return {
    start,
    end,
    hiddenAboveItems: start,
    hiddenBelowItems: Math.max(0, rowHeights.length - end),
  };
}

function estimateChecklistRows(
  planningPhase: PlanningPhase | undefined,
  todoState: TodoState | undefined,
): number {
  if (!planningPhase && !todoState?.items.length) return 0;
  return 4 + (todoState?.items.length ?? 0);
}

function buildStickyPromptLabel(items: readonly ShellHistoryEntry[]): string | undefined {
  const latestPrompt = [...items].reverse().find((item) =>
    item.type === "user" || item.type === "hql_eval"
  );
  if (!latestPrompt) return undefined;
  if (latestPrompt.type === "user") {
    return truncate(latestPrompt.submittedText ?? latestPrompt.text, 88, "…");
  }
  return truncate(latestPrompt.input, 88, "…");
}

export function TranscriptSurface(
  {
    historyItems = [],
    liveItems = [],
    width,
    reservedRows = 8,
    compactPlanTranscript = false,
    compactSpacing = true,
    interactive = true,
    allowToggleHotkeys = true,
    expandAll = false,
    streamingState,
    planningPhase,
    todoState,
    showPlanChecklist = false,
    showLeadingDivider = false,
  }: TranscriptSurfaceProps,
): React.ReactElement | null {
  const sc = useSemanticColors();
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;
  const checklistRows = estimateChecklistRows(planningPhase, todoState);
  const rowBudget = Math.max(6, terminalRows - reservedRows - checklistRows);
  const planSurface = useMemo(
    () => derivePlanSurfaceState({ items: liveItems, planningPhase, todoState }),
    [liveItems, planningPhase, todoState],
  );
  const historyDisplayItems = useMemo(
    () =>
      filterRenderableTimelineItems(
        compactPlanTranscript ? compactPlanTranscriptItems(historyItems) : historyItems,
      ),
    [compactPlanTranscript, historyItems],
  );
  const liveDisplayItems = useMemo(() => {
    const baseItems = filterRenderableTimelineItems(planSurface.visibleItems);
    const hidePassiveWaitingSignals = streamingState ===
      ConversationStreamingState.WaitingForConfirmation;
    return filterDuplicateWaitingIndicators(baseItems).filter((item) => {
      if (!hidePassiveWaitingSignals) return true;
      if (item.type === "thinking") return false;
      return !(item.type === "assistant" && item.isPending && item.text.trim().length === 0);
    });
  }, [planSurface.visibleItems, streamingState]);
  const items = useMemo(
    () => [...historyDisplayItems, ...liveDisplayItems],
    [historyDisplayItems, liveDisplayItems],
  );

  const [scrollRowsFromBottom, setScrollRowsFromBottom] = useState(0);
  const rowHeights = useMemo(
    () => items.map((item: ShellHistoryEntry) => estimateItemRows(item, width)),
    [items, width],
  );
  const totalRows = useMemo(
    () => rowHeights.reduce((sum: number, height: number) => sum + height, 0),
    [rowHeights],
  );
  const viewport = useMemo(
    () => computeRowViewport(rowHeights, rowBudget, scrollRowsFromBottom),
    [rowBudget, rowHeights, scrollRowsFromBottom],
  );
  const visibleItems = useMemo(
    () => items.slice(viewport.start, viewport.end),
    [items, viewport.end, viewport.start],
  );
  const activeThinkingId = useMemo(
    () => getActiveThinkingId(liveItems, streamingState),
    [liveItems, streamingState],
  );
  const expansion = useExpansionState(items.length, { expandAll });
  const toggleTargets = useMemo(() => getToggleTargets(items), [items]);
  const stickyPromptLabel = useMemo(() => buildStickyPromptLabel(items), [items]);
  const search = useTranscriptSearch(items);

  useEffect(() => {
    const maxScroll = Math.max(0, totalRows - rowBudget);
    setScrollRowsFromBottom((current: number) =>
      Math.max(0, Math.min(current, maxScroll))
    );
  }, [rowBudget, totalRows]);

  useEffect(() => {
    const match = search.state.selectedMatch;
    if (!search.state.isSearching || !match) return;
    const cumulative = [0];
    for (const height of rowHeights) {
      cumulative.push(cumulative[cumulative.length - 1]! + height);
    }
    const itemStart = cumulative[match.itemIndex] ?? 0;
    const targetTop = Math.max(0, itemStart - Math.floor(rowBudget / 3));
    const targetScroll = Math.max(0, totalRows - Math.min(totalRows, targetTop + rowBudget));
    setScrollRowsFromBottom(targetScroll);
  }, [rowBudget, rowHeights, search.state.isSearching, search.state.selectedMatch, totalRows]);

  const handleSearchStart = useCallback(() => {
    if (search.state.isSearching) {
      search.actions.selectNext();
      return;
    }
    search.actions.startSearch();
  }, [search.actions, search.state.isSearching]);

  useEffect(() => {
    if (!interactive || !allowToggleHotkeys) return;
    registerHandler(
      HandlerIds.CONVERSATION_TOGGLE_LATEST,
      () => {
        const target = toggleTargets[toggleTargets.length - 1];
        if (target) {
          expansion.toggleTarget(target);
        }
      },
      "TranscriptSurface",
    );
    registerHandler(
      HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE,
      async () => {
        const citation = getLatestCitation(items);
        if (citation?.url) {
          await getPlatform().openUrl(citation.url).catch(() => {});
        }
      },
      "TranscriptSurface",
    );
    registerHandler(
      HandlerIds.CONVERSATION_SEARCH,
      () => handleSearchStart(),
      "TranscriptSurface",
    );
    return () => {
      unregisterHandler(HandlerIds.CONVERSATION_TOGGLE_LATEST);
      unregisterHandler(HandlerIds.CONVERSATION_OPEN_LATEST_SOURCE);
      unregisterHandler(HandlerIds.CONVERSATION_SEARCH);
    };
  }, [allowToggleHotkeys, expansion, handleSearchStart, interactive, items, toggleTargets]);

  useInput((input, key) => {
    if (!interactive) return;
    const combo = normalizeKeyInput(input, key);

    if (search.state.isSearching) {
      if (combo === "ctrl+r") {
        search.actions.selectNext();
        return;
      }
      if (combo === "ctrl+s") {
        search.actions.selectPrev();
        return;
      }
      if (key.escape) {
        search.actions.cancelSearch();
        return;
      }
      if (key.return) {
        search.actions.closeSearch();
        return;
      }
      if (key.backspace || key.delete) {
        search.actions.backspace();
        return;
      }
      if (!key.ctrl && !key.meta && input.length > 0 && input !== "\r" && input !== "\n") {
        search.actions.appendToQuery(input);
      }
      return;
    }

    if (allowToggleHotkeys) {
      const binding = inspectHandlerKeybinding(input, key, {
        categories: CONVERSATION_KEYBINDING_CATEGORIES,
      });
      if (binding.kind === "handler") {
        void executeHandler(binding.id);
        return;
      }
    }

    if (items.length === 0) return;
    if (key.pageUp) {
      setScrollRowsFromBottom((current: number) =>
        current + Math.max(1, rowBudget - 2)
      );
      return;
    }
    if (key.pageDown) {
      setScrollRowsFromBottom((current: number) =>
        Math.max(0, current - Math.max(1, rowBudget - 2))
      );
      return;
    }
    if (key.upArrow) {
      setScrollRowsFromBottom((current: number) => current + 1);
      return;
    }
    if (key.downArrow) {
      setScrollRowsFromBottom((current: number) => Math.max(0, current - 1));
    }
  });

  if (items.length === 0 && !planSurface.active) {
    return null;
  }

  return (
    <Box flexDirection="column" width={width}>
      {showPlanChecklist && planSurface.active && (
        <PlanChecklistPanel
          planningPhase={planningPhase}
          todoState={todoState}
          items={liveItems}
        />
      )}
      {search.state.isSearching && (
        <Box marginBottom={1} flexDirection="column">
          <Box>
            <ChromeChip text="Transcript search" tone="active" />
            <Text color={search.state.query ? sc.shell.prompt : sc.text.muted}>
              {search.state.query ? ` ${search.state.query}` : " start typing"}
            </Text>
            <Text color={sc.text.muted}>
              {` · ${
                search.state.matches.length === 0
                  ? "no match"
                  : `${search.state.selectedIndex + 1}/${search.state.matches.length} matches`
              }`}
            </Text>
          </Box>
          <Box marginTop={0}>
            {search.state.selectedMatch
              ? (
                <HighlightedText
                  text={search.state.selectedMatch.preview}
                  matchIndices={search.state.selectedMatch.matchIndices}
                  highlightColor={sc.status.warning}
                  baseColor={sc.text.primary}
                />
              )
              : <Text color={sc.text.muted} italic>Type to search the transcript.</Text>}
          </Box>
          <Box>
            <ShortcutHint bindingId="conversation-search-next" tone="active" />
            <Text color={sc.text.muted}> · </Text>
            <ShortcutHint bindingId="conversation-search-prev" />
            <Text color={sc.text.muted}> · Enter keep focus · Esc cancel</Text>
          </Box>
        </Box>
      )}
      {viewport.hiddenAboveItems > 0 && (
        <Text color={sc.text.muted}>
          ↑ {viewport.hiddenAboveItems} earlier item{viewport.hiddenAboveItems === 1 ? "" : "s"}
        </Text>
      )}
      {scrollRowsFromBottom > 0 && stickyPromptLabel && (
        <Box marginBottom={1}>
          <Text color={sc.text.secondary}>{STATUS_GLYPHS.running} Current prompt · </Text>
          <Text color={sc.text.primary}>{stickyPromptLabel}</Text>
          <Text color={sc.text.muted}> · </Text>
          <ShortcutHint bindingId="pgup-pgdn" label="PgDn newest" />
        </Box>
      )}
      {visibleItems.map((item: ShellHistoryEntry, visibleIndex: number) => (
        <Box key={item.id}>
          <TimelineItemRenderer
            item={item}
            width={width}
            activeThinkingId={activeThinkingId}
            compactSpacing={compactSpacing}
            showDividerBefore={shouldRenderTranscriptDividerBeforeIndex(
              items,
              viewport.start + visibleIndex,
              showLeadingDivider && viewport.start === 0,
            )}
            isToolExpanded={expansion.isToolExpanded}
            isThinkingExpanded={expansion.isThinkingExpanded}
            isDelegateExpanded={expansion.isDelegateExpanded}
            isDelegateGroupExpanded={expansion.isDelegateGroupExpanded}
            isMemoryExpanded={expansion.isMemoryExpanded}
          />
        </Box>
      ))}
      {viewport.hiddenBelowItems > 0 && (
        <Text color={sc.text.muted}>
          ↓ {viewport.hiddenBelowItems} newer item{viewport.hiddenBelowItems === 1 ? "" : "s"}
        </Text>
      )}
    </Box>
  );
}
