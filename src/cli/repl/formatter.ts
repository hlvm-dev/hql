/**
 * HQL REPL Output Formatter
 * Pretty prints values like Clojure REPL
 */

import { ANSI_COLORS } from "../ansi.ts";

const { CYAN, GREEN, YELLOW, RED, DIM_GRAY, RESET } = ANSI_COLORS;

/** Format a value for display */
export function formatValue(value: unknown, depth = 0): string {
  if (value === undefined) return "";
  if (value === null) return `${DIM_GRAY}nil${RESET}`;

  if (typeof value === "string") {
    return `${GREEN}"${escapeString(value)}"${RESET}`;
  }

  if (typeof value === "number") {
    return `${CYAN}${value}${RESET}`;
  }

  if (typeof value === "boolean") {
    return `${YELLOW}${value}${RESET}`;
  }

  if (typeof value === "function") {
    const name = value.name || "anonymous";
    return `${DIM_GRAY}#<function ${name}>${RESET}`;
  }

  if (typeof value === "symbol") {
    return `${YELLOW}${value.toString()}${RESET}`;
  }

  if (value instanceof Error) {
    return formatError(value);
  }

  if (value instanceof Promise) {
    return `${DIM_GRAY}#<Promise>${RESET}`;
  }

  if (value instanceof Map) {
    if (depth > 3) return `${DIM_GRAY}{...}${RESET}`;
    const entries = Array.from(value.entries())
      .map(([k, v]) => `${formatValue(k, depth + 1)} ${formatValue(v, depth + 1)}`)
      .join(", ");
    return `{${entries}}`;
  }

  if (value instanceof Set) {
    if (depth > 3) return `${DIM_GRAY}#{...}${RESET}`;
    const items = Array.from(value)
      .map(v => formatValue(v, depth + 1))
      .join(" ");
    return `#{${items}}`;
  }

  if (Array.isArray(value)) {
    if (depth > 3) return `${DIM_GRAY}[...]${RESET}`;
    if (value.length === 0) return "[]";
    if (value.length > 20) {
      const first10 = value.slice(0, 10).map(v => formatValue(v, depth + 1)).join(" ");
      const last3 = value.slice(-3).map(v => formatValue(v, depth + 1)).join(" ");
      return `[${first10} ${DIM_GRAY}... ${value.length - 13} more ...${RESET} ${last3}]`;
    }
    const items = value.map(v => formatValue(v, depth + 1)).join(" ");
    return `[${items}]`;
  }

  if (typeof value === "object" && value !== null) {
    if (depth > 3) return `${DIM_GRAY}{...}${RESET}`;
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    if (entries.length > 10) {
      const first5 = entries.slice(0, 5)
        .map(([k, v]) => `:${k} ${formatValue(v, depth + 1)}`)
        .join(", ");
      return `{${first5}, ${DIM_GRAY}... ${entries.length - 5} more${RESET}}`;
    }
    const formatted = entries
      .map(([k, v]) => `:${k} ${formatValue(v, depth + 1)}`)
      .join(", ");
    return `{${formatted}}`;
  }

  return String(value);
}

/** Format an error for display */
export function formatError(error: Error): string {
  const name = error.name || "Error";
  const message = error.message || "Unknown error";

  let result = `${RED}${name}: ${message}${RESET}`;

  // Add simplified stack trace if available
  if (error.stack) {
    const stackLines = error.stack.split("\n").slice(1, 4);
    if (stackLines.length > 0) {
      const simplified = stackLines
        .map(line => line.trim())
        .filter(line => !line.includes("node_modules") && !line.includes("deno:"))
        .slice(0, 2);
      if (simplified.length > 0) {
        result += `\n${DIM_GRAY}${simplified.join("\n")}${RESET}`;
      }
    }
  }

  return result;
}

/** Escape special characters in strings */
function escapeString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/** Format timing information */
export function formatTiming(ms: number): string {
  if (ms < 1) {
    return `${DIM_GRAY}${(ms * 1000).toFixed(0)}μs${RESET}`;
  }
  if (ms < 1000) {
    return `${DIM_GRAY}${ms.toFixed(0)}ms${RESET}`;
  }
  return `${DIM_GRAY}${(ms / 1000).toFixed(2)}s${RESET}`;
}
