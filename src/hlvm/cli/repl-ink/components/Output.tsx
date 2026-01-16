/**
 * HLVM Ink REPL - Output (value display + streaming)
 *
 * Uses shared formatter from src/hlvm/cli/repl/formatter.ts (Single Source of Truth)
 */

import React from "npm:react@18";
import { Text, Box } from "npm:ink@5";
import type { EvalResult } from "../types.ts";
import { renderMarkdown, hasMarkdown } from "../../repl/markdown.ts";
import { useStreaming } from "../hooks/useStreaming.ts";
import { StreamingStatus } from "./StreamingStatus.tsx";
import { formatValue } from "../../repl/formatter.ts";  // Single Source of Truth
import { useTheme } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import type { EvalTask } from "../../repl/task-manager/types.ts";

export function Output({ result }: { result: EvalResult }): React.ReactElement | null {
  const { color } = useTheme();

  if (result.suppressOutput) return null;

  if (result.streamTaskId) {
    return <StreamingTaskOutput taskId={result.streamTaskId} />;
  }

  // Streaming (async iterator)
  if (result.value && typeof result.value === "object" && Symbol.asyncIterator in (result.value as object)) {
    return <StreamingOutput iterator={result.value as AsyncIterableIterator<string>} />;
  }

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

function StreamingTaskOutput({ taskId }: { taskId: string }): React.ReactElement | null {
  const { color } = useTheme();
  const { tasks } = useTaskManager();

  const task = tasks.find((t) => t.id === taskId && t.type === "eval") as EvalTask | undefined;
  if (!task) return null;

  const output = task.output ?? (typeof task.result === "string" ? task.result : "");
  const isStreaming = task.status === "running";
  const isDone = task.status === "completed" || task.status === "failed" || task.status === "cancelled";
  const startTime = task.progress?.startedAt ?? task.startedAt ?? Date.now();
  const showOutput = output.length > 0;

  return (
    <Box flexDirection="column">
      {isStreaming && (
        <StreamingStatus
          isStreaming={isStreaming}
          startTime={startTime}
        />
      )}
      {showOutput && (
        <Text>
          {isDone && hasMarkdown(output) ? renderMarkdown(output) : output}
        </Text>
      )}
      {isStreaming && !showOutput && <Text color={color("muted")}>▋</Text>}
      {task.status === "failed" && task.error && (
        <Text color={color("error")}>Error: {task.error.message}</Text>
      )}
      {task.status === "cancelled" && (
        <Text color={color("muted")}>[Cancelled]</Text>
      )}
    </Box>
  );
}

interface StreamingOutputProps {
  iterator: AsyncIterableIterator<string>;
}

function StreamingOutput({ iterator }: StreamingOutputProps): React.ReactElement {
  const { color } = useTheme();

  // Higher throttle (100ms) = fewer re-renders = smoother streaming
  // Markdown is only applied at end to avoid structural jumps
  const { displayText, isDone, isStreaming, startTime, error } = useStreaming(iterator, { renderInterval: 100 });

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
