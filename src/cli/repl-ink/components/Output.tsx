/**
 * HQL Ink REPL - Output (value display + streaming)
 */

import React from "npm:react@18";
import { Text, Box } from "npm:ink@5";
import type { EvalResult } from "../types.ts";
import { renderMarkdown, hasMarkdown } from "../../repl/markdown.ts";
import { useStreaming } from "../hooks/useStreaming.ts";

// SICP Theme colors
const C = { CYAN: "\x1b[36m", YELLOW: "\x1b[33m", RED: "\x1b[31m", DIM: "\x1b[90m", RESET: "\x1b[0m" };

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

  // Value
  const formatted = formatValue(result.value);
  return formatted ? <Text>{formatted}</Text> : null;
}

function StreamingOutput({ iterator }: { iterator: AsyncIterableIterator<string> }): React.ReactElement {
  // Higher throttle (100ms) = fewer re-renders = smoother streaming
  // Markdown is only applied at end to avoid structural jumps
  const { displayText, isDone } = useStreaming(iterator, { renderInterval: 100 });

  return (
    <Box flexDirection="column">
      <Text>{displayText}</Text>
      {!isDone && <Text color="gray">▋</Text>}
    </Box>
  );
}

function formatValue(value: unknown, depth = 0): string {
  if (value === undefined) return "";
  if (value === null) return `${C.DIM}nil${C.RESET}`;
  if (typeof value === "string") {
    // Render markdown for string values that look like AI responses
    if (hasMarkdown(value)) {
      return renderMarkdown(value);
    }
    return `${C.RED}"${value.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"${C.RESET}`;
  }
  if (typeof value === "number") return `${C.CYAN}${value}${C.RESET}`;
  if (typeof value === "boolean") return `${C.YELLOW}${value}${C.RESET}`;
  if (typeof value === "function") return `${C.DIM}#<fn ${(value as {name?:string}).name || "anon"}>${C.RESET}`;
  if (typeof value === "symbol") return `${C.YELLOW}${value.toString()}${C.RESET}`;
  if (value instanceof Error) return `${C.RED}${value.name}: ${value.message}${C.RESET}`;
  if (value instanceof Promise) return `${C.DIM}#<Promise>${C.RESET}`;
  if (Array.isArray(value)) {
    if (depth > 2) return "[...]";
    return `[${value.slice(0, 10).map(v => formatValue(v, depth + 1)).join(" ")}${value.length > 10 ? " ..." : ""}]`;
  }
  if (typeof value === "object") {
    if (depth > 2) return "{...}";
    const entries = Object.entries(value).slice(0, 5);
    return `{${entries.map(([k, v]) => `:${k} ${formatValue(v, depth + 1)}`).join(", ")}${Object.keys(value).length > 5 ? " ..." : ""}}`;
  }
  return String(value);
}
