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

export function Output({ result }: { result: EvalResult }): React.ReactElement | null {
  // Streaming (async iterator)
  if (result.value && typeof result.value === "object" && Symbol.asyncIterator in (result.value as object)) {
    return <StreamingOutput iterator={result.value as AsyncIterableIterator<string>} />;
  }

  if (result.suppressOutput) return null;

  // Error
  if (!result.success && result.error) {
    return <Text color="red">{result.error.name}: {result.error.message}</Text>;
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

function StreamingOutput({ iterator }: { iterator: AsyncIterableIterator<string> }): React.ReactElement {
  // Higher throttle (100ms) = fewer re-renders = smoother streaming
  // Markdown is only applied at end to avoid structural jumps
  const { displayText, isDone, isStreaming, startTime, cancel } = useStreaming(iterator, { renderInterval: 100 });

  // Handle escape key to cancel streaming
  useInput((_char, key) => {
    if (key.escape && isStreaming) {
      cancel();
    }
  });

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
      {isStreaming && !displayText && <Text color="gray">▋</Text>}
    </Box>
  );
}
