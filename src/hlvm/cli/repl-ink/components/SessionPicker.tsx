/**
 * Session Picker Component
 * Interactive searchable session selector.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { truncate } from "../../../../common/utils.ts";
import { useTheme } from "../../theme/index.ts";
import { calculateScrollWindow } from "../completion/navigation.ts";
import type { SessionMeta } from "../../repl/session/types.ts";
import { ListSearchField } from "./ListSearchField.tsx";
import { getListSearchSeed } from "../utils/list-search.ts";
import { handleTextEditingKey } from "../utils/text-editing.ts";
import {
  DEFAULT_TERMINAL_WIDTH,
  MIN_PANEL_WIDTH,
  PANEL_PADDING,
  SESSION_PICKER_MAX_WIDTH,
} from "../ui-constants.ts";

interface SessionPickerProps {
  sessions: SessionMeta[];
  currentSessionId?: string;
  onSelect: (session: SessionMeta) => void;
  onCancel: () => void;
}

interface SelectionState {
  index: number;
  id: string | null;
}

const SESSION_PICKER_RESERVED_KEYS = ["/", " ", "j", "k"];
const MAX_VISIBLE_SESSIONS = 8;

function formatAge(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHr < 24) return `${diffHr}h`;
  return `${diffDays}d`;
}

function matchesSessionSearch(session: SessionMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    session.title.toLowerCase().includes(q) ||
    session.projectPath.toLowerCase().includes(q) ||
    session.id.toLowerCase().includes(q)
  );
}

export function SessionPicker({
  sessions,
  currentSessionId,
  onSelect,
  onCancel,
}: SessionPickerProps): React.ReactElement {
  const { color } = useTheme();
  const { stdout } = useStdout();
  const availableWidth = Math.max(
    MIN_PANEL_WIDTH,
    (stdout?.columns ?? DEFAULT_TERMINAL_WIDTH) - PANEL_PADDING,
  );
  const panelWidth = Math.min(SESSION_PICKER_MAX_WIDTH, availableWidth);
  const contentWidth = panelWidth - 4;

  const [selection, setSelection] = useState<SelectionState>({
    index: 0,
    id: null,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCursor, setSearchCursor] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  const filteredSessions = useMemo(
    () =>
      sessions.filter((session) => matchesSessionSearch(session, searchQuery)),
    [sessions, searchQuery],
  );

  useEffect(() => {
    setSelection((current: SelectionState) => {
      if (filteredSessions.length === 0) return { index: 0, id: null };

      if (current.id) {
        const index = filteredSessions.findIndex((session: SessionMeta) =>
          session.id === current.id
        );
        if (index >= 0) return { index, id: current.id };
      }

      return { index: 0, id: filteredSessions[0]?.id ?? null };
    });
  }, [filteredSessions]);

  const moveSelection = (delta: number) => {
    if (filteredSessions.length === 0) return;
    setSelection((current: SelectionState) => {
      const nextIndex = Math.max(
        0,
        Math.min(filteredSessions.length - 1, current.index + delta),
      );
      return {
        index: nextIndex,
        id: filteredSessions[nextIndex]?.id ?? null,
      };
    });
  };

  useInput((input, key) => {
    if (isSearching) {
      if (key.escape) {
        setIsSearching(false);
        setSearchQuery("");
        setSearchCursor(0);
        return;
      }

      if (key.return) {
        setIsSearching(false);
        const selected = filteredSessions[selection.index] ??
          filteredSessions[0];
        if (selected) onSelect(selected);
        return;
      }

      if (key.upArrow) {
        moveSelection(-1);
        return;
      }

      if (key.downArrow) {
        moveSelection(1);
        return;
      }

      const result = handleTextEditingKey(
        input,
        key,
        searchQuery,
        searchCursor,
      );
      if (result) {
        setSearchQuery(result.value);
        setSearchCursor(result.cursor);
      }
      return;
    }

    const searchSeed = getListSearchSeed(input, key, {
      reservedSingleKeys: SESSION_PICKER_RESERVED_KEYS,
    });
    if (searchSeed) {
      const nextQuery = searchQuery + searchSeed;
      setIsSearching(true);
      setSearchQuery(nextQuery);
      setSearchCursor(nextQuery.length);
      return;
    }

    if (key.upArrow || input === "k") {
      moveSelection(-1);
      return;
    }

    if (key.downArrow || input === "j") {
      moveSelection(1);
      return;
    }

    if (input === "/") {
      setIsSearching(true);
      setSearchCursor(searchQuery.length);
      return;
    }

    if (key.return) {
      const selected = filteredSessions[selection.index] ?? filteredSessions[0];
      if (selected) onSelect(selected);
      return;
    }

    if (key.escape) {
      onCancel();
    }
  });

  const window = calculateScrollWindow(
    selection.index,
    filteredSessions.length,
    MAX_VISIBLE_SESSIONS,
  );
  const visibleSessions = filteredSessions.slice(window.start, window.end);
  const selectedSession = filteredSessions[selection.index] ??
    filteredSessions[0] ?? null;
  const titleWidth = Math.max(18, contentWidth - 21);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      width={panelWidth}
    >
      <Box justifyContent="space-between">
        <Text bold color={color("primary")} wrap="truncate-end">
          Sessions {searchQuery
            ? `(${filteredSessions.length}/${sessions.length})`
            : `(${sessions.length})`}
        </Text>
        <Text dimColor wrap="truncate-end">
          {currentSessionId
            ? `Current: ${truncate(currentSessionId, 12, "…")}`
            : "Current: none"}
        </Text>
      </Box>

      <ListSearchField
        query={searchQuery}
        cursor={searchCursor}
        width={contentWidth}
        placeholder="Filter by title, path, or session ID"
      />

      <Box>
        <Text dimColor>Selected:</Text>
        {selectedSession
          ? (
            <>
              <Text wrap="truncate-end">
                {truncate(
                  selectedSession.title,
                  Math.max(0, contentWidth - 20),
                  "…",
                )}
              </Text>
              <Text dimColor>· {formatAge(selectedSession.updatedAt)}</Text>
            </>
          )
          : <Text dimColor>None</Text>}
      </Box>

      {filteredSessions.length === 0
        ? (
          <Text dimColor wrap="truncate-end">
            No sessions match the current search
          </Text>
        )
        : (
          visibleSessions.map((session: SessionMeta, index: number) => {
            const actualIndex = window.start + index;
            const isCurrent = session.id === currentSessionId;
            const isSelected = actualIndex === selection.index;
            const title = truncate(session.title, titleWidth, "…").padEnd(
              titleWidth,
            );
            const meta = `${String(session.messageCount).padStart(3)} msgs  ${
              formatAge(session.updatedAt).padStart(4)
            }`;

            return (
              <Box key={session.id}>
                <Text inverse={isSelected} wrap="truncate-end">
                  <Text color={isCurrent ? color("success") : color("muted")}>
                    {isCurrent ? "● " : "○ "}
                  </Text>
                  <Text>{title}</Text>
                  <Text dimColor>{meta}</Text>
                </Text>
              </Box>
            );
          })
        )}

      {window.start > 0 && (
        <Text dimColor wrap="truncate-end">... {window.start} earlier</Text>
      )}
      {window.end < filteredSessions.length && (
        <Text dimColor wrap="truncate-end">
          {"  ... "}
          {filteredSessions.length - window.end}
          {" more"}
        </Text>
      )}

      <Text dimColor wrap="truncate-end">
        ↑↓ nav type/ search ↵ resume Esc back
      </Text>
    </Box>
  );
}
