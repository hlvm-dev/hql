/**
 * Tool result formatting, deduplication, and display helpers.
 * Extracted from orchestrator.ts for modularity.
 */

import { getTool, hasTool } from "./registry.ts";
import { truncate } from "../../common/utils.ts";
import { safeStringify } from "../../common/safe-stringify.ts";
import { getRecoveryHint } from "./error-taxonomy.ts";
import type { ToolCall } from "./tool-call.ts";
import type { OrchestratorConfig } from "./orchestrator.ts";
import type { ToolExecutionResult } from "./orchestrator-state.ts";

export function stringifyToolResult(result: unknown): string {
  return safeStringify(result, 2);
}

export function buildToolResultOutputs(
  toolName: string,
  result: unknown,
  config: OrchestratorConfig,
): { llmContent: string; returnDisplay: string } {
  let formatted: { returnDisplay: string; llmContent?: string } | null = null;
  try {
    const tool = hasTool(toolName, config.toolOwnerId)
      ? getTool(toolName, config.toolOwnerId)
      : null;
    formatted = tool?.formatResult ? tool.formatResult(result) : null;
  } catch {
    formatted = null;
  }

  if (formatted && formatted.returnDisplay) {
    const returnDisplay = formatted.returnDisplay;
    const llmContent = formatted.llmContent ??
      config.context.truncateResult(returnDisplay);
    return { llmContent, returnDisplay };
  }

  const returnDisplay = stringifyToolResult(result);
  const llmContent = config.context.truncateResult(returnDisplay);
  return { llmContent, returnDisplay };
}

/** Check if tool result content indicates failure despite no exception.
 *  Only matches small, explicit {success: false, error: "..."} payloads. */
export function isToolResultFailure(content: string): boolean {
  if (!content.startsWith("{") || content.length > 500) return false;
  try {
    const parsed = JSON.parse(content);
    if (
      parsed && typeof parsed === "object" &&
      parsed.success === false &&
      typeof parsed.error === "string" &&
      parsed.error.length > 0
    ) return true;
  } catch { /* not JSON */ }
  return false;
}

export function buildToolObservation(
  toolCall: ToolCall,
  toolResult: ToolExecutionResult,
): { observation: string; resultText: string; toolName: string } {
  if (toolResult.success) {
    const resultText = toolResult.llmContent ??
      stringifyToolResult(toolResult.result);
    // Detect tools that return error-as-data (success but content says failure)
    if (isToolResultFailure(resultText)) {
      const hint = getRecoveryHint(resultText);
      const observation = hint ? `${resultText}\nHint: ${hint}` : resultText;
      return { observation, resultText, toolName: toolCall.toolName };
    }
    return { observation: resultText, resultText, toolName: toolCall.toolName };
  }

  const errorText = toolResult.error ?? "Unknown error";
  const hint = getRecoveryHint(errorText);
  const observation = hint
    ? `Error: ${errorText}\nHint: ${hint}`
    : `Error: ${errorText}`;

  return {
    observation,
    resultText: `ERROR: ${errorText}`,
    toolName: toolCall.toolName,
  };
}

/** Deduplicate identical tool calls (same name + same args) within a single turn */
export function deduplicateToolCalls(calls: ToolCall[]): ToolCall[] {
  if (calls.length <= 1) return calls;
  const seen = new Set<string>();
  return calls.filter((call) => {
    const key = `${call.toolName}:${stableStringifyArgs(call.args, false)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Canonicalize arbitrary values for stable JSON signatures.
 * Sorts object keys recursively while preserving array order.
 */
export function canonicalizeForSignature(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalizeForSignature);
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      out[key] = canonicalizeForSignature(input[key]);
    }
    return out;
  }
  return value;
}

/**
 * Stable stringify for tool-call dedup/loop signatures.
 * Optionally lowercases string values for case-insensitive matching.
 */
export function stableStringifyArgs(
  args: unknown,
  lowercaseStringValues: boolean,
): string {
  const canonical = canonicalizeForSignature(args);
  return JSON.stringify(
    canonical,
    (_key, value) =>
      lowercaseStringValues && typeof value === "string"
        ? value.toLowerCase()
        : value,
  ) ?? "null";
}

export function sanitizeArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const entries = Object.entries(args).filter(([, value]) =>
    value !== undefined
  );
  return Object.fromEntries(entries);
}

/** Summarize tool args into a short human-readable string for UI display */
export function generateArgsSummary(
  toolName: string,
  args: unknown,
): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  switch (toolName) {
    case "read_file":
    case "list_files":
      return typeof a.path === "string" ? truncate(a.path, 80) : "";
    case "shell_exec":
      return typeof a.command === "string" ? truncate(a.command, 80) : "";
    case "search_code":
      return `'${truncate(String(a.query ?? ""), 40)}'${
        a.path ? ` in ${a.path}` : ""
      }`;
    case "edit_file":
    case "write_file":
      return typeof a.path === "string" ? truncate(a.path, 80) : "";
    case "compute":
      return typeof a.expression === "string"
        ? truncate(a.expression, 80)
        : "";
    case "web_search":
      return typeof a.query === "string" ? truncate(a.query, 80) : "";
    case "web_browse":
      return typeof a.url === "string" ? truncate(a.url, 80) : "";
    default: {
      try {
        return truncate(JSON.stringify(a), 80);
      } catch {
        return "";
      }
    }
  }
}

export function buildToolErrorResult(
  toolName: string,
  error: string,
  startedAt: number,
  config: OrchestratorConfig,
): ToolExecutionResult {
  const result: ToolExecutionResult = {
    success: false,
    error,
    llmContent: error,
    returnDisplay: error,
  };

  config.onTrace?.({
    type: "tool_result",
    toolName,
    success: false,
    error,
    display: error,
  });
  config.onAgentEvent?.({
    type: "tool_end",
    name: toolName,
    success: false,
    content: error,
    durationMs: Date.now() - startedAt,
    argsSummary: "",
  });

  return result;
}

/** Build a simple tool-allowed predicate from allow/deny lists */
export function buildIsToolAllowed(
  config: OrchestratorConfig,
): (name: string) => boolean {
  const allowlist = config.toolFilterState?.allowlist ?? config.toolAllowlist;
  const denylist = config.toolFilterState?.denylist ?? config.toolDenylist;
  const allowSet = allowlist?.length
    ? new Set(allowlist)
    : null;
  const denySet = denylist?.length
    ? new Set(denylist)
    : null;
  return (name: string) => {
    if (allowSet && !allowSet.has(name)) return false;
    if (denySet && denySet.has(name)) return false;
    return true;
  };
}

export function isRenderToolName(toolName: string): boolean {
  return toolName === "render_url" || toolName.endsWith("_render_url");
}

/** Fix 22: Case-insensitive loop detection for string values */
export function buildToolSignature(calls: ToolCall[]): string {
  if (calls.length === 0) return "";
  return calls
    .map((call) => {
      const args = stableStringifyArgs(call.args, true);
      return `${call.toolName.toLowerCase()}:${args}`;
    })
    .sort()
    .join("|");
}

export function buildToolRequiredMessage(allowlist?: string[]): string {
  const tools = allowlist && allowlist.length > 0
    ? allowlist.join(", ")
    : "the available tools";
  return [
    "Tool use is required to complete this request.",
    `Use one of: ${tools}.`,
    "Call the appropriate tool using native function calling.",
  ].join("\n");
}

/** Combined trace + metric + tool display for successful tool results (DRY helper) */
export function emitToolSuccess(
  config: OrchestratorConfig,
  toolName: string,
  llmContent: string,
  returnDisplay: string,
  startedAt: number,
  args?: unknown,
): void {
  config.onTrace?.({
    type: "tool_result",
    toolName,
    success: true,
    result: llmContent,
    display: returnDisplay,
  });
  config.onAgentEvent?.({
    type: "tool_end",
    name: toolName,
    success: true,
    content: returnDisplay,
    durationMs: Date.now() - startedAt,
    argsSummary: generateArgsSummary(toolName, args),
  });
}
