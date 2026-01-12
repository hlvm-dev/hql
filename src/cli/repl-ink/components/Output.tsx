/**
 * HQL Ink REPL - Output (value display + streaming)
 *
 * Uses shared formatter from src/cli/repl/formatter.ts (Single Source of Truth)
 */

import React from "npm:react@18";
import { Text, Box, useInput } from "npm:ink@5";
import type { EvalResult } from "../types.ts";
import { renderMarkdown, hasMarkdown } from "../../repl/markdown.ts";
import { useStreaming } from "../hooks/useStreaming.ts";
import { StreamingStatus } from "./StreamingStatus.tsx";
import { formatValue } from "../../repl/formatter.ts";  // Single Source of Truth
import { useTheme } from "../../theme/index.ts";

export function Output({ result }: { result: EvalResult }): React.ReactElement | null {
  const { color } = useTheme();

  // Streaming (async iterator)
  if (result.value && typeof result.value === "object" && Symbol.asyncIterator in (result.value as object)) {
    return <StreamingOutput iterator={result.value as AsyncIterableIterator<string>} />;
  }

  if (result.suppressOutput) return null;

  // Error
  if (!result.success && result.error) {
    return <Text color={color("error")}>{result.error.name}: {result.error.message}</Text>;
  }

  // Command output - display as plain text (no quoting/escaping)
  if (result.isCommandOutput && typeof result.value === "string") {
    return <Text>{result.value}</Text>;
  }

  // Value - use shared formatter
  const formatted = formatValue(result.value);
  if (!formatted) return null;

  // Apply markdown rendering for AI string responses
  if (typeof result.value === "string" && hasMarkdown(result.value)) {
    return <Text>{renderMarkdown(result.value)}</Text>;
  }

  return <Text>{formatted}</Text>;
}

interface StreamingOutputProps {
  iterator: AsyncIterableIterator<string>;
}

function StreamingOutput({ iterator }: StreamingOutputProps): React.ReactElement {
  const { color } = useTheme();

  // Higher throttle (100ms) = fewer re-renders = smoother streaming
  // Markdown is only applied at end to avoid structural jumps
  const { displayText, isDone, isStreaming, startTime, cancel, error } = useStreaming(iterator, { renderInterval: 100 });

  // Handle escape key to cancel streaming
  useInput((_char, key) => {
    if (key.escape && isStreaming) {
      cancel();
    }
  });

  // Show error if streaming failed (but preserve any partial content)
  if (error) {
    return (
      <Box flexDirection="column">
        {displayText && <Text>{displayText}</Text>}
        <Text color={color("error")}>Error: {error.message}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {isStreaming && (
        <StreamingStatus
          isStreaming={isStreaming}
          startTime={startTime}
        />
      )}
      {displayText && (
        <Text>
          {isDone && hasMarkdown(displayText) ? renderMarkdown(displayText) : displayText}
        </Text>
      )}
      {isStreaming && !displayText && <Text color={color("muted")}>▋</Text>}
    </Box>
  );
}
