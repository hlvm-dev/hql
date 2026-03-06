/**
 * HLVM Ink REPL - Output (value display + streaming)
 *
 * Uses shared formatter from src/hlvm/cli/repl/formatter.ts (Single Source of Truth)
 */

import React from "react";
import { Text, Box, useStdout } from "ink";
import type { EvalResult } from "../types.ts";
import { hasMarkdown } from "../../repl/markdown.ts";
import { useStreaming } from "../hooks/useStreaming.ts";
import { StreamingStatus } from "./StreamingStatus.tsx";
import { formatValue } from "../../repl/formatter.ts";  // Single Source of Truth
import { useTheme } from "../../theme/index.ts";
import { useTaskManager } from "../hooks/useTaskManager.ts";
import type { EvalTask } from "../../repl/task-manager/types.ts";
import { MarkdownDisplay } from "./markdown/index.ts";
import { DEFAULT_TERMINAL_WIDTH, PANEL_PADDING } from "../ui-constants.ts";

export function Output({ result }: { result: EvalResult }): React.ReactElement | null {
  const { color } = useTheme();
  const { stdout } = useStdout();
  const markdownWidth = Math.max(20, (stdout?.columns ?? DEFAULT_TERMINAL_WIDTH) - PANEL_PADDING);

  if (result.suppressOutput) return null;

  if (result.streamTaskId) {
    return <StreamingTaskOutput taskId={result.streamTaskId} width={markdownWidth} />;
  }

  // Streaming (async iterator)
  if (result.value && typeof result.value === "object" && Symbol.asyncIterator in (result.value as object)) {
    return <StreamingOutput iterator={result.value as AsyncIterableIterator<string>} width={markdownWidth} />;
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
    return <MarkdownDisplay text={result.value} width={markdownWidth} />;
  }

  return <Text>{formatted}</Text>;
}

function StreamingTaskOutput({ taskId, width }: { taskId: string; width: number }): React.ReactElement | null {
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
        isDone && hasMarkdown(output)
          ? <MarkdownDisplay text={output} width={width} />
          : <Text>{output}</Text>
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
  width: number;
}

function StreamingOutput({ iterator, width }: StreamingOutputProps): React.ReactElement {
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
        isDone && hasMarkdown(displayText)
          ? <MarkdownDisplay text={displayText} width={width} />
          : <Text>{displayText}</Text>
      )}
      {isStreaming && !displayText && <Text color={color("muted")}>▋</Text>}
    </Box>
  );
}
