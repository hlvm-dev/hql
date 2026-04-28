import { useCallback, useMemo, useState } from "react";
import type { ShellHistoryEntry } from "../types.ts";
import { truncate } from "../../../../common/utils.ts";

export interface TranscriptSearchMatch {
  itemIndex: number;
  preview: string;
  matchIndices: readonly number[];
  score: number;
}

export interface TranscriptSearchState {
  isSearching: boolean;
  query: string;
  matches: readonly TranscriptSearchMatch[];
  selectedIndex: number;
  selectedMatch: TranscriptSearchMatch | null;
}

interface TranscriptSearchActions {
  startSearch: () => void;
  cancelSearch: () => void;
  setQuery: (query: string) => void;
  appendToQuery: (char: string) => void;
  backspace: () => void;
  selectNext: () => void;
  selectPrev: () => void;
  closeSearch: () => void;
}

interface SearchableTranscriptItem {
  itemIndex: number;
  haystack: string;
  preview: string;
}

const PREVIEW_LIMIT = 140;

function removeLastCharacter(value: string): string {
  const chars = Array.from(value);
  chars.pop();
  return chars.join("");
}

function extractTranscriptSearchText(item: ShellHistoryEntry): string {
  switch (item.type) {
    case "user":
      return item.text;
    case "assistant":
      return item.text;
    case "thinking":
      return `${item.kind} ${item.summary}`;
    case "tool_group":
      return item.tools.map((tool) =>
        [
          tool.displayName ?? tool.name,
          tool.argsSummary,
          tool.progressText,
          tool.resultSummaryText,
          tool.resultDetailText,
          tool.resultText,
        ].filter(Boolean).join(" ")
      ).join("\n");
    case "turn_stats":
      return [
        item.summary,
        ...(item.activityTrail ?? []),
      ].filter(Boolean).join(" ");
    case "memory_updated":
      return `Memory updated in ${item.path}`;
    case "error":
    case "info":
      return item.text;
    case "hql_eval":
      return `${item.input}\n${item.result.success ? String(item.result.value ?? "") : item.result.error?.message ?? ""}`;
    default:
      return "";
  }
}

function buildPreview(
  haystack: string,
  matchIndex: number,
  queryLength: number,
): { preview: string; matchIndices: readonly number[] } {
  const previewStart = Math.max(0, matchIndex - 36);
  const previewEnd = Math.min(
    haystack.length,
    Math.max(matchIndex + queryLength + 36, previewStart + PREVIEW_LIMIT),
  );
  const previewSource = haystack.slice(previewStart, previewEnd);
  const preview = truncate(previewSource.replaceAll(/\s+/g, " "), PREVIEW_LIMIT);
  const safeEnd = Math.min(preview.length, matchIndex - previewStart + queryLength);
  const safeStart = Math.max(0, Math.min(preview.length, matchIndex - previewStart));
  const matchIndices = Array.from(
    { length: Math.max(0, safeEnd - safeStart) },
    (_, index) => safeStart + index,
  );
  return { preview, matchIndices };
}

function buildSearchableTranscript(
  items: readonly ShellHistoryEntry[],
): SearchableTranscriptItem[] {
  return items.flatMap((item, itemIndex) => {
    const haystack = extractTranscriptSearchText(item).trim();
    if (!haystack) return [];
    return [{
      itemIndex,
      haystack,
      preview: truncate(haystack.replaceAll(/\s+/g, " "), PREVIEW_LIMIT),
    }];
  });
}

export function useTranscriptSearch(
  items: readonly ShellHistoryEntry[],
): { state: TranscriptSearchState; actions: TranscriptSearchActions } {
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQueryState] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const searchableItems = useMemo(
    () => buildSearchableTranscript(items),
    [items],
  );

  const matches = useMemo(() => {
    if (!isSearching || query.trim().length === 0) return [];
    const normalizedQuery = query.toLowerCase();
    return searchableItems.flatMap((item: SearchableTranscriptItem): TranscriptSearchMatch[] => {
      const normalizedHaystack = item.haystack.toLowerCase();
      const matchIndex = normalizedHaystack.indexOf(normalizedQuery);
      if (matchIndex < 0) return [];
      const { preview, matchIndices } = buildPreview(
        item.haystack,
        matchIndex,
        normalizedQuery.length,
      );
      return [{
        itemIndex: item.itemIndex,
        preview,
        matchIndices,
        score: matchIndex,
      }];
    }).sort((a: TranscriptSearchMatch, b: TranscriptSearchMatch) =>
      a.score - b.score || a.itemIndex - b.itemIndex
    );
  }, [isSearching, query, searchableItems]);

  const selectedMatch = matches[selectedIndex] ?? null;

  const startSearch = useCallback(() => {
    setIsSearching(true);
    setQueryState("");
    setSelectedIndex(0);
  }, []);

  const cancelSearch = useCallback(() => {
    setIsSearching(false);
    setQueryState("");
    setSelectedIndex(0);
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearching(false);
    setSelectedIndex(0);
  }, []);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setSelectedIndex(0);
  }, []);

  const appendToQuery = useCallback((char: string) => {
    setQueryState((current: string) => current + char);
    setSelectedIndex(0);
  }, []);

  const backspace = useCallback(() => {
    setQueryState((current: string) => removeLastCharacter(current));
    setSelectedIndex(0);
  }, []);

  const selectNext = useCallback(() => {
    setSelectedIndex((current: number) =>
      matches.length > 0 ? (current + 1) % matches.length : 0
    );
  }, [matches.length]);

  const selectPrev = useCallback(() => {
    setSelectedIndex((current: number) =>
      matches.length > 0 ? (current - 1 + matches.length) % matches.length : 0
    );
  }, [matches.length]);

  return {
    state: {
      isSearching,
      query,
      matches,
      selectedIndex,
      selectedMatch,
    },
    actions: {
      startSearch,
      cancelSearch,
      setQuery,
      appendToQuery,
      backspace,
      selectNext,
      selectPrev,
      closeSearch,
    },
  };
}
