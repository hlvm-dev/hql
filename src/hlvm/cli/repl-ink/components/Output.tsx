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

export const Output = React.memo(function Output({ result }: { result: EvalResult }): React.ReactElement | null {
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
});

// ============================================================
// Shared Streaming Content
// ============================================================

interface StreamingContentProps {
  text: string;
  isStreaming: boolean;
  width: number;
  error?: { message: string } | null;
  taskStatus?: string;
}

const StreamingContent = React.memo(function StreamingContent({
  text,
  isStreaming,
  width,
  error,
  taskStatus,
}: StreamingContentProps): React.ReactElement {
  const { color } = useTheme();
  const showOutput = text.length > 0;

  return (
    <Box flexDirection="column">
      {isStreaming && (
        <StreamingStatus
          isStreaming={isStreaming}
        />
      )}
      {showOutput && (
        hasMarkdown(text)
          ? <MarkdownDisplay text={text} width={width} />
          : <Text>{text}</Text>
      )}
      {isStreaming && !showOutput && <Text color={color("muted")}>·</Text>}
      {error && (
        <Text color={color("error")}>Error: {error.message}</Text>
      )}
      {taskStatus === "cancelled" && (
        <Text color={color("muted")}>[Cancelled]</Text>
      )}
    </Box>
  );
});

// ============================================================
// Streaming Variants
// ============================================================

const StreamingTaskOutput = React.memo(function StreamingTaskOutput({ taskId, width }: { taskId: string; width: number }): React.ReactElement | null {
  const { tasks } = useTaskManager();

  const task = tasks.find((t) => t.id === taskId && t.type === "eval") as EvalTask | undefined;
  if (!task) return null;

  const output = task.output ?? (typeof task.result === "string" ? task.result : "");
  const isStreaming = task.status === "running";

  return (
    <StreamingContent
      text={output}
      isStreaming={isStreaming}
      width={width}
      error={task.status === "failed" ? task.error : null}
      taskStatus={task.status}
    />
  );
});

const StreamingOutput = React.memo(function StreamingOutput({ iterator, width }: { iterator: AsyncIterableIterator<string>; width: number }): React.ReactElement {
  const { color } = useTheme();
  const { displayText, isStreaming, error } = useStreaming(iterator, { renderInterval: 100 });

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
    <StreamingContent
      text={displayText}
      isStreaming={isStreaming}
      width={width}
    />
  );
});
