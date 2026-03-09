/**
 * Tool result formatting, deduplication, and display helpers.
 * Extracted from orchestrator.ts for modularity.
 */

import { getTool, hasTool } from "./registry.ts";
import { isObjectValue, truncate } from "../../common/utils.ts";
import { safeStringify } from "../../common/safe-stringify.ts";
import { getRecoveryHint } from "./error-taxonomy.ts";
import type { ModelTier } from "./constants.ts";
import type { ToolCall } from "./tool-call.ts";
import type { OrchestratorConfig, ToolEventMeta, WebSearchToolEventMeta } from "./orchestrator.ts";
import type { ToolExecutionResult } from "./orchestrator-state.ts";
import type { FormattedToolResult } from "./registry.ts";
import type {
  DeterministicAnswerDraft,
  DeterministicAnswerSource,
} from "./tools/web/answer-from-evidence.ts";
import type { SearchResult } from "./tools/web/search-provider.ts";
import { hasStructuredEvidence } from "./tools/web/web-utils.ts";
import { summarizeToolResult } from "./tool-result-summary.ts";

export function stringifyToolResult(result: unknown): string {
  return safeStringify(result, 2);
}

export function buildToolResultOutputs(
  toolName: string,
  result: unknown,
  config: OrchestratorConfig,
): { llmContent: string; summaryDisplay: string; returnDisplay: string } {
  let formatted: FormattedToolResult | null = null;
  try {
    const tool = hasTool(toolName, config.toolOwnerId)
      ? getTool(toolName, config.toolOwnerId)
      : null;
    formatted = tool?.formatResult ? tool.formatResult(result) : null;
  } catch {
    formatted = null;
  }

  if (formatted && formatted.returnDisplay) {
    const summaryDisplay = formatted.summaryDisplay ??
      summarizeToolResult(toolName, result, formatted.returnDisplay);
    const returnDisplay = formatted.returnDisplay;
    const llmContent = formatted.llmContent ??
      config.context.truncateResult(returnDisplay);
    return { llmContent, summaryDisplay, returnDisplay };
  }

  const returnDisplay = stringifyToolResult(result);
  const summaryDisplay = summarizeToolResult(toolName, result, returnDisplay);
  const llmContent = config.context.truncateResult(returnDisplay);
  return { llmContent, summaryDisplay, returnDisplay };
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

/**
 * Preserve same-turn tool calls exactly as produced by the model.
 *
 * Duplicate collapsing is unsafe for side-effectful tools and can silently drop
 * legitimate work (`write_file`, memory mutations, shell actions).
 */
export function deduplicateToolCalls(calls: ToolCall[]): ToolCall[] {
  return calls;
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
      return `'${truncate(String(a.pattern ?? a.query ?? ""), 40)}'${
        a.path ? ` in ${a.path}` : ""
      }`;
    case "find_symbol":
      return `'${truncate(String(a.name ?? ""), 40)}'${
        a.path ? ` in ${a.path}` : ""
      }`;
    case "get_structure":
      return typeof a.path === "string" ? truncate(a.path, 80) : "";
    case "edit_file":
    case "write_file":
      return typeof a.path === "string" ? truncate(a.path, 80) : "";
    case "compute":
      return typeof a.expression === "string"
        ? truncate(a.expression, 80)
        : "";
    case "search_web":
      return typeof a.query === "string" ? truncate(a.query, 80) : "";
    case "web_fetch":
    case "fetch_url":
      return typeof a.url === "string" ? truncate(a.url, 80) : "";
    case "memory_search":
      return typeof a.query === "string" ? truncate(a.query, 80) : "";
    case "memory_write":
      return typeof a.content === "string" ? truncate(a.content, 80) : "";
    case "memory_edit":
      return typeof a.action === "string" ? truncate(a.action, 80) : "";
    case "todo_read":
      return "current session";
    case "todo_write": {
      const items = Array.isArray(a.items) ? a.items.length : 0;
      return `${items} todo${items === 1 ? "" : "s"}`;
    }
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
  toolCallId?: string,
): ToolExecutionResult {
  const result: ToolExecutionResult = {
    success: false,
    error,
    llmContent: error,
    summaryDisplay: error,
    returnDisplay: error,
  };

  config.onTrace?.({
    type: "tool_result",
    toolName,
    toolCallId,
    success: false,
    error,
    display: error,
  });
  config.onAgentEvent?.({
    type: "tool_end",
    name: toolName,
    success: false,
    content: error,
    summary: error,
    durationMs: Date.now() - startedAt,
    argsSummary: "",
  });

  return result;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toSearchResults(value: unknown): SearchResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SearchResult => isObjectValue(item));
}

function toTrustLevel(
  lowConfidence: boolean | undefined,
  fetchedEvidenceCount: number,
  selectedFetchCount: number,
  resultCount: number,
): "high" | "medium" | "low" {
  if (lowConfidence) return "low";
  if (resultCount === 0) return "medium";
  if (fetchedEvidenceCount > 0) return "high";
  if (selectedFetchCount > 0) return "medium";
  return "medium";
}

function extractWebSearchEventMeta(result: unknown): WebSearchToolEventMeta | undefined {
  if (!isObjectValue(result)) return undefined;

  const diagnostics = isObjectValue(result.diagnostics) ? result.diagnostics : null;
  const deep = diagnostics && isObjectValue(diagnostics.deep) ? diagnostics.deep : null;
  const score = diagnostics && isObjectValue(diagnostics.score) ? diagnostics.score : null;
  const retrieval = diagnostics && isObjectValue(diagnostics.retrieval)
    ? diagnostics.retrieval
    : null;
  const results = toSearchResults(result.results);
  const resultCount = toFiniteNumber(result.count) ?? results.length;
  const citationsCount = Array.isArray(result.citations) ? result.citations.length : undefined;
  const selectedFetchCount = results.filter((entry) => entry.selectedForFetch === true).length;
  const fetchedEvidenceCount = toFiniteNumber(retrieval?.fetchEvidenceCount) ??
    results.filter((entry) =>
      entry.selectedForFetch === true && hasStructuredEvidence(entry)
    ).length;

  const deepMeta = deep
    ? {
      autoTriggered: deep.autoTriggered === true,
      rounds: toFiniteNumber(deep.rounds) ?? 1,
      triggerReason: typeof deep.triggerReason === "string" ? deep.triggerReason : "none",
      queryTrail: Array.isArray(deep.queryTrail)
        ? deep.queryTrail.filter((v): v is string => typeof v === "string")
        : [],
      recovered: deep.recovered === true,
    }
    : undefined;

  const scoreMeta = score
    ? {
      lowConfidence: typeof score.lowConfidence === "boolean"
        ? score.lowConfidence
        : undefined,
      confidenceReason: typeof score.confidenceReason === "string"
        ? score.confidenceReason
        : undefined,
      avgScore: toFiniteNumber(score.avgScore),
      hostDiversity: toFiniteNumber(score.hostDiversity),
      queryCoverage: toFiniteNumber(score.queryCoverage),
    }
    : undefined;

  const lowConfidence = scoreMeta?.lowConfidence;
  const trustLevel = toTrustLevel(
    lowConfidence,
    fetchedEvidenceCount,
    selectedFetchCount,
    Math.max(1, resultCount),
  );
  const sourceGuard = {
    warning: Boolean(lowConfidence) || fetchedEvidenceCount === 0,
    trustLevel,
    fetchedEvidenceCount,
    selectedFetchCount,
    resultCount,
  };

  if (!deepMeta && !scoreMeta && citationsCount === undefined && resultCount === 0) {
    return undefined;
  }
  return {
    deep: deepMeta,
    score: scoreMeta,
    sourceGuard,
    citationsCount,
  };
}

function extractToolEventMeta(toolName: string, result: unknown): ToolEventMeta | undefined {
  if (!(toolName === "search_web" || toolName.endsWith("_search_web"))) return undefined;
  const webSearch = extractWebSearchEventMeta(result);
  if (!webSearch) return undefined;
  return { webSearch };
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
  toolCallId: string | undefined,
  llmContent: string,
  summaryDisplay: string,
  returnDisplay: string,
  startedAt: number,
  args?: unknown,
  rawResult?: unknown,
): void {
  const meta = extractToolEventMeta(toolName, rawResult);
  config.onTrace?.({
    type: "tool_result",
    toolName,
    toolCallId,
    success: true,
    result: llmContent,
    display: returnDisplay,
  });
  config.onAgentEvent?.({
    type: "tool_end",
    name: toolName,
    success: true,
    content: returnDisplay,
    summary: summaryDisplay,
    durationMs: Date.now() - startedAt,
    argsSummary: generateArgsSummary(toolName, args),
    meta,
  });
}

export interface TerminalToolResponse {
  finalResponse: string;
  reason: "weak_search_web_deterministic";
}

function isTerminalSearchWebTool(toolName: string): boolean {
  return toolName === "search_web" || toolName.endsWith("_search_web");
}

function extractDeterministicAnswerDraft(
  result: unknown,
): DeterministicAnswerDraft | undefined {
  if (!isObjectValue(result) || !isObjectValue(result.answerDraft)) {
    return undefined;
  }
  const draft = result.answerDraft as Record<string, unknown>;
  if (typeof draft.text !== "string" || draft.text.trim().length === 0) {
    return undefined;
  }
  if (draft.confidence !== "high") return undefined;
  if (draft.strategy !== "deterministic") return undefined;
  if (
    draft.mode !== "direct" &&
    draft.mode !== "comparison" &&
    draft.mode !== "recency" &&
    draft.mode !== "insufficient_evidence"
  ) {
    return undefined;
  }
  if (!Array.isArray(draft.sources)) {
    return undefined;
  }

  const sources = draft.sources
    .filter(isObjectValue)
    .map((source): DeterministicAnswerSource => {
      const evidenceStrength: DeterministicAnswerSource["evidenceStrength"] =
        source.evidenceStrength === "high" ||
          source.evidenceStrength === "medium" ||
          source.evidenceStrength === "low"
        ? source.evidenceStrength
        : undefined;
      return {
        url: typeof source.url === "string" ? source.url : "",
        title: typeof source.title === "string" ? source.title : "",
        ...(evidenceStrength ? { evidenceStrength } : {}),
        ...(typeof source.publishedDate === "string"
          ? { publishedDate: source.publishedDate }
          : {}),
      };
    })
    .filter((source) => source.url.length > 0 && source.title.length > 0);

  return {
    text: draft.text,
    confidence: "high",
    mode: draft.mode,
    strategy: "deterministic",
    sources,
  };
}

export function extractTerminalToolResponse(
  toolName: string,
  result: unknown,
  modelTier: ModelTier | undefined,
): TerminalToolResponse | undefined {
  if (modelTier !== "weak") return undefined;
  if (!isTerminalSearchWebTool(toolName)) return undefined;

  const answerDraft = extractDeterministicAnswerDraft(result);
  if (!answerDraft) return undefined;

  if (
    isObjectValue(result) &&
    isObjectValue(result.guidance) &&
    result.guidance.answerAvailable === false
  ) {
    return undefined;
  }

  return {
    finalResponse: answerDraft.text.trim(),
    reason: "weak_search_web_deterministic",
  };
}
