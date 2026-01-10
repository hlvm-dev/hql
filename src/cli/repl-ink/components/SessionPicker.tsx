/**
 * Session Picker Component
 * Interactive session selector (Claude Code / Gemini CLI style)
 */

import React, { useState, useEffect } from "npm:react@18";
import { Box, Text, useInput } from "npm:ink@5";
import type { SessionMeta } from "../../repl/session/types.ts";

interface SessionPickerProps {
  sessions: SessionMeta[];
  currentSessionId?: string;
  onSelect: (session: SessionMeta) => void;
  onCancel: () => void;
}

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

export function SessionPicker({
  sessions,
  currentSessionId,
  onSelect,
  onCancel,
}: SessionPickerProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selection when sessions change (prevents out-of-bounds)
  useEffect(() => {
    setSelectedIndex(0);
  }, [sessions]);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i: number) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i: number) => Math.min(sessions.length - 1, i + 1));
    }
    if (key.return && sessions[selectedIndex]) {
      onSelect(sessions[selectedIndex]);
    }
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold> Sessions </Text>
      <Text> </Text>
      {sessions.map((s, i) => {
        const isCurrent = s.id === currentSessionId;
        const isSelected = i === selectedIndex;
        const marker = isCurrent ? "\u25cf" : " ";
        const age = formatAge(s.updatedAt);
        const title = s.title.length > 25 ? s.title.slice(0, 22) + "..." : s.title.padEnd(25);

        return (
          <Box key={s.id}>
            <Text inverse={isSelected}>
              {marker} {title} {String(s.messageCount).padStart(3)} msgs  {age.padStart(4)}
            </Text>
          </Box>
        );
      })}
      <Text> </Text>
      <Text dimColor>  \u2191\u2193 Navigate   Enter Select   Esc Cancel</Text>
    </Box>
  );
}
