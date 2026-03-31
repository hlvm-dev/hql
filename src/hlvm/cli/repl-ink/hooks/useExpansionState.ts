/**
 * useExpansionState - Shared expansion state for conversation panels.
 *
 * Consolidates the 5 Sets + isXExpanded callbacks + toggleTarget logic
 * duplicated across ConversationPanel, PendingTurnPanel, and TranscriptHistory.
 */

import React, { useCallback, useEffect, useState } from "react";
import type { ToggleTarget } from "../components/TimelineItemRenderer.tsx";

// ============================================================================
// Types
// ============================================================================

export interface ExpansionCallbacks {
  isToolExpanded: (id: string) => boolean;
  isThinkingExpanded: (id: string) => boolean;
  isDelegateExpanded: (id: string) => boolean;
  isDelegateGroupExpanded: (id: string) => boolean;
  isMemoryExpanded: (id: string) => boolean;
  toggleTarget: (target: ToggleTarget) => void;
}

interface UseExpansionStateOptions {
  /**
   * When true, all items are treated as expanded (used in TranscriptHistory
   * for the "expand all" mode). Individual expansions still toggle on top.
   */
  expandAll?: boolean;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Manages expansion state for tool, thinking, delegate, delegateGroup,
 * and memory timeline items.
 *
 * @param resetSignal - When this value changes to 0 (empty items),
 *   all expansion state is cleared.
 * @param options - Optional configuration.
 */
export function useExpansionState(
  resetSignal: number,
  options: UseExpansionStateOptions = {},
): ExpansionCallbacks {
  const { expandAll = false } = options;

  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedDelegateIds, setExpandedDelegateIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedDelegateGroupIds, setExpandedDelegateGroupIds] = useState<
    Set<string>
  >(() => new Set());
  const [expandedMemoryIds, setExpandedMemoryIds] = useState<Set<string>>(
    () => new Set(),
  );

  // Reset all expansion state when items are cleared
  useEffect(() => {
    if (resetSignal === 0) {
      setExpandedToolIds(new Set());
      setExpandedThinkingIds(new Set());
      setExpandedDelegateIds(new Set());
      setExpandedDelegateGroupIds(new Set());
      setExpandedMemoryIds(new Set());
    }
  }, [resetSignal]);

  const isToolExpanded = useCallback(
    (id: string): boolean => expandAll || expandedToolIds.has(id),
    [expandAll, expandedToolIds],
  );
  const isThinkingExpanded = useCallback(
    (id: string): boolean => expandAll || expandedThinkingIds.has(id),
    [expandAll, expandedThinkingIds],
  );
  const isDelegateExpanded = useCallback(
    (id: string): boolean => expandAll || expandedDelegateIds.has(id),
    [expandAll, expandedDelegateIds],
  );
  const isDelegateGroupExpanded = useCallback(
    (id: string): boolean => expandAll || expandedDelegateGroupIds.has(id),
    [expandAll, expandedDelegateGroupIds],
  );
  const isMemoryExpanded = useCallback(
    (id: string): boolean => expandAll || expandedMemoryIds.has(id),
    [expandAll, expandedMemoryIds],
  );

  const toggleTarget = useCallback((target: ToggleTarget): void => {
    const toggle = (
      setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    ) => {
      setter((prev: Set<string>) => {
        const next = new Set(prev);
        if (next.has(target.id)) next.delete(target.id);
        else next.add(target.id);
        return next;
      });
    };
    if (target.kind === "tool") return toggle(setExpandedToolIds);
    if (target.kind === "delegate") return toggle(setExpandedDelegateIds);
    if (target.kind === "delegate_group") {
      return toggle(setExpandedDelegateGroupIds);
    }
    if (target.kind === "memory") return toggle(setExpandedMemoryIds);
    toggle(setExpandedThinkingIds);
  }, []);

  return {
    isToolExpanded,
    isThinkingExpanded,
    isDelegateExpanded,
    isDelegateGroupExpanded,
    isMemoryExpanded,
    toggleTarget,
  };
}
