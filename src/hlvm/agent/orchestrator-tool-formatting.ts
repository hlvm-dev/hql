/**
 * Tool result formatting, deduplication, and display helpers.
 * Extracted from orchestrator.ts for modularity.
 */

import { getTool, hasTool } from "./registry.ts";
import { TOOL_RESULT_LIMITS } from "./constants.ts";
import { isObjectValue, truncate } from "../../common/utils.ts";
import { safeStringify } from "../../common/safe-stringify.ts";
import { getRecoveryHint } from "./error-taxonomy.ts";
import type { ToolCall } from "./tool-call.ts";
import type {
  OrchestratorConfig,
  ToolEventMeta,
  WebSearchToolEventMeta,
} from "./orchestrator.ts";
import {
  effectiveAllowlist,
  effectiveDenylist,
  type ToolExecutionResult,
} from "./orchestrator-state.ts";
import type { FormattedToolResult } from "./registry.ts";
import type { SearchResult } from "./tools/web/search-provider.ts";
import { hasStructuredEvidence } from "./tools/web/web-utils.ts";
import { summarizeToolResult } from "./tool-result-summary.ts";
import { parseShellCommand } from "../../common/shell-parser.ts";
import { getPlatform } from "../../platform/platform.ts";

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
    // Smart per-tool compression BEFORE the blunt truncateMiddle safety net.
    const rawLlmContent = formatted.llmContent ?? returnDisplay;
    const compressed = compressForLLM(toolName, rawLlmContent);
    const llmContent = config.context.truncateResult(compressed);
    return { llmContent, summaryDisplay, returnDisplay };
  }

  const returnDisplay = stringifyToolResult(result);
  const summaryDisplay = summarizeToolResult(toolName, result, returnDisplay);
  const compressed = compressForLLM(toolName, returnDisplay);
  const llmContent = config.context.truncateResult(compressed);
  return { llmContent, summaryDisplay, returnDisplay };
}

// ============================================================
// Smart per-tool compression — keeps signal, drops noise.
// truncateResult() remains the safety net after this.
// ============================================================

/** Smart per-tool compression. Small results pass through unchanged. */
export function compressForLLM(toolName: string, result: string): string {
  if (result.length <= 4000) return result;

  switch (toolName) {
    case "read_file":
      return compressFileContent(result);
    case "shell_exec":
    case "shell_script":
      return compressShellOutput(result);
    case "git_diff":
      return compressDiffOutput(result);
    default:
      return result; // let truncateResult handle it
  }
}

/** read_file: keep first 80 + last 30 lines — head+tail is more useful than blind truncation. */
function compressFileContent(result: string): string {
  const lines = result.split("\n");
  if (lines.length <= 120) return result;
  const head = lines.slice(0, 80);
  const tail = lines.slice(-30);
  const omitted = lines.length - 110;
  return [...head, `\n... (${omitted} lines omitted) ...\n`, ...tail].join(
    "\n",
  );
}

/** shell_exec: keep head (command context), error/warning lines, and tail (result). */
function compressShellOutput(result: string): string {
  const lines = result.split("\n");
  if (lines.length <= 40) return result;
  const head = lines.slice(0, 10);
  const important = lines.filter((l) =>
    /error|warn|fail|exception|panic/i.test(l)
  );
  const tail = lines.slice(-20);
  // Deduplicate while preserving order
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const l of [...head, ...important, ...tail]) {
    if (!seen.has(l)) {
      seen.add(l);
      kept.push(l);
    }
  }
  const omitted = lines.length - kept.length;
  if (omitted > 0) {
    kept.splice(head.length, 0, `\n... (${omitted} lines omitted) ...\n`);
  }
  return kept.join("\n");
}

/** git_diff: keep diff/hunk headers and changed lines, limit context to 2 lines. */
function compressDiffOutput(result: string): string {
  const lines = result.split("\n");
  if (lines.length <= 80) return result;
  const compressed: string[] = [];
  let contextCount = 0;
  for (const line of lines) {
    if (/^(diff |---|\+\+\+|@@)/.test(line)) {
      compressed.push(line);
      contextCount = 0;
    } else if (line.startsWith("+") || line.startsWith("-")) {
      compressed.push(line);
      contextCount = 0;
    } else {
      contextCount++;
      if (contextCount <= 2) compressed.push(line);
    }
  }
  return compressed.join("\n");
}

/** Check if tool result content indicates failure despite no exception.
 *  Only matches small, explicit {success: false, error: "..."} payloads. */
function isToolResultFailure(content: string): boolean {
  if (
    !content.startsWith("{") ||
    content.length > TOOL_RESULT_LIMITS.failurePayloadMaxBytes
  ) return false;
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
function stableStringifyArgs(
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

function readStringField(
  args: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

/** Tool name → primary arg field for single-field summary */
const SUMMARY_FIELD = new Map<string, string>([
  ["read_file", "path"],
  ["list_files", "path"],
  ["get_structure", "path"],
  ["edit_file", "path"],
  ["write_file", "path"],
  ["shell_exec", "command"],
  ["compute", "expression"],
  ["search_web", "query"],
  ["memory_search", "query"],
  ["web_fetch", "url"],
  ["fetch_url", "url"],
  ["memory_write", "content"],
  ["memory_edit", "action"],
]);

/** Summarize tool args into a short human-readable string for UI display */
export function generateArgsSummary(
  toolName: string,
  args: unknown,
): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;

  // Data-driven: tools whose summary is just a single truncated field
  const field = SUMMARY_FIELD.get(toolName);
  if (field) {
    return typeof a[field] === "string" ? truncate(a[field] as string, 80) : "";
  }

  switch (toolName) {
    case "search_code":
      return `'${truncate(String(a.pattern ?? a.query ?? ""), 40)}'${
        a.path ? ` in ${a.path}` : ""
      }`;
    case "find_symbol":
      return `'${truncate(String(a.name ?? ""), 40)}'${
        a.path ? ` in ${a.path}` : ""
      }`;
    case "todo_read":
      return "current session";
    case "todo_write": {
      const items = Array.isArray(a.items) ? a.items.length : 0;
      return `${items} todo${items === 1 ? "" : "s"}`;
    }
    case "Teammate": {
      const operation = readStringField(a, "operation");
      const teamName = readStringField(a, "team_name", "teamName");
      const name = readStringField(a, "name");
      const agentType = readStringField(a, "agent_type", "agentType");
      switch (operation) {
        case "spawnTeam":
          return teamName ? `spawn team ${truncate(teamName, 48)}` : "spawn team";
        case "spawnAgent":
          return name
            ? `spawn ${truncate(name, 40)}${
              agentType ? ` (${truncate(agentType, 20)})` : ""
            }`
            : "spawn teammate";
        case "cleanup":
          return teamName
            ? `cleanup ${truncate(teamName, 48)}`
            : "cleanup team";
        default:
          return truncate(
            [operation, name ?? teamName].filter(Boolean).join(" "),
            80,
          );
      }
    }
    case "TaskCreate":
      return truncate(readStringField(a, "subject") ?? "", 80);
    case "TaskGet": {
      const taskId = readStringField(a, "taskId", "task_id");
      return taskId ? `task ${truncate(taskId, 24)}` : "";
    }
    case "TaskUpdate": {
      const taskId = readStringField(a, "taskId", "task_id");
      const status = readStringField(a, "status");
      const owner = readStringField(a, "owner");
      const parts = [
        taskId ? `task ${truncate(taskId, 24)}` : undefined,
        status,
        owner ? `owner ${truncate(owner, 24)}` : undefined,
      ].filter((part): part is string => Boolean(part));
      return truncate(parts.join(" · "), 80);
    }
    case "TaskList":
      return "team tasks";
    case "SendMessage": {
      const type = readStringField(a, "type");
      const recipient = readStringField(a, "recipient");
      const taskId = readStringField(a, "task_id", "taskId");
      const content = readStringField(a, "summary", "content");
      const label = type === "broadcast"
        ? "broadcast"
        : type === "submit_plan"
        ? "submit plan"
        : type?.replaceAll("_", " ");
      const parts = [
        label,
        recipient ? `to ${truncate(recipient, 24)}` : undefined,
        taskId ? `task ${truncate(taskId, 24)}` : undefined,
        content ? truncate(content, 36) : undefined,
      ].filter((part): part is string => Boolean(part));
      return truncate(parts.join(" · "), 80);
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
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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

function extractWebSearchEventMeta(
  result: unknown,
): WebSearchToolEventMeta | undefined {
  if (!isObjectValue(result)) return undefined;

  const diagnostics = isObjectValue(result.diagnostics)
    ? result.diagnostics
    : null;
  const deep = diagnostics && isObjectValue(diagnostics.deep)
    ? diagnostics.deep
    : null;
  const score = diagnostics && isObjectValue(diagnostics.score)
    ? diagnostics.score
    : null;
  const retrieval = diagnostics && isObjectValue(diagnostics.retrieval)
    ? diagnostics.retrieval
    : null;
  const results = toSearchResults(result.results);
  const resultCount = toFiniteNumber(result.count) ?? results.length;
  const citationsCount = Array.isArray(result.citations)
    ? result.citations.length
    : undefined;
  const selectedFetchCount =
    results.filter((entry) => entry.selectedForFetch === true).length;
  const fetchedEvidenceCount = toFiniteNumber(retrieval?.fetchEvidenceCount) ??
    results.filter((entry) =>
      entry.selectedForFetch === true && hasStructuredEvidence(entry)
    ).length;

  const deepMeta = deep
    ? {
      autoTriggered: deep.autoTriggered === true,
      rounds: toFiniteNumber(deep.rounds) ?? 1,
      triggerReason: typeof deep.triggerReason === "string"
        ? deep.triggerReason
        : "none",
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

  if (
    !deepMeta && !scoreMeta && citationsCount === undefined && resultCount === 0
  ) {
    return undefined;
  }
  return {
    deep: deepMeta,
    score: scoreMeta,
    sourceGuard,
    citationsCount,
  };
}

function extractToolEventMeta(
  toolName: string,
  result: unknown,
): ToolEventMeta | undefined {
  if (!(toolName === "search_web" || toolName.endsWith("_search_web"))) {
    return undefined;
  }
  const webSearch = extractWebSearchEventMeta(result);
  if (!webSearch) return undefined;
  return { webSearch };
}

/** Build a simple tool-allowed predicate from allow/deny lists */
export function buildIsToolAllowed(
  config: OrchestratorConfig,
): (name: string) => boolean {
  const allowlist = effectiveAllowlist(config);
  const denylist = effectiveDenylist(config);
  const allowSet = allowlist?.length ? new Set(allowlist) : null;
  const denySet = denylist?.length ? new Set(denylist) : null;
  return (name: string) => {
    if (allowSet && !allowSet.has(name)) return false;
    if (denySet && denySet.has(name)) return false;
    return true;
  };
}

export function isRenderToolName(toolName: string): boolean {
  return toolName === "render_url" || toolName.endsWith("_render_url");
}

/** Case-insensitive loop detection for string values */
export function buildToolSignature(calls: ToolCall[]): string {
  if (calls.length === 0) return "";
  return calls
    .map(buildSingleToolSignature)
    .sort()
    .join("|");
}

function buildSingleToolSignature(call: ToolCall): string {
  const openIntent = extractOpenIntentTarget(call);
  if (openIntent) {
    return `open:${normalizeIntentPath(openIntent)}`;
  }
  const args = stableStringifyArgs(call.args, true);
  return `${call.toolName.toLowerCase()}:${args}`;
}

function extractOpenIntentTarget(call: ToolCall): string | null {
  if (call.toolName === "open_path") {
    return typeof call.args.path === "string" ? call.args.path : null;
  }
  if (call.toolName !== "shell_exec") {
    return null;
  }
  const command = typeof call.args.command === "string"
    ? call.args.command
    : "";
  if (!command.trim()) return null;
  try {
    const parsed = parseShellCommand(command);
    if (parsed.hasChaining || parsed.hasPipes || parsed.hasRedirects) {
      return null;
    }
    const program = parsed.program.toLowerCase();
    if (program === "open" || program === "xdg-open") {
      for (let index = parsed.args.length - 1; index >= 0; index--) {
        const candidate = parsed.args[index];
        if (candidate && !candidate.startsWith("-")) {
          return candidate;
        }
      }
    }
    if (
      program === "cmd.exe" &&
      parsed.args.length >= 3 &&
      parsed.args[0]?.toLowerCase() === "/c" &&
      parsed.args[1]?.toLowerCase() === "start"
    ) {
      return parsed.args[parsed.args.length - 1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeIntentPath(value: string): string {
  let normalized = value.trim();
  if (!normalized) return normalized;

  if (normalized.startsWith("file://")) {
    normalized = normalized.slice("file://".length);
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Keep the raw path if decoding fails.
    }
  }

  const home = getPlatform().env.get("HOME");
  if (home) {
    const normalizedHome = home.replaceAll("\\", "/");
    const homePrefixes = [normalizedHome, normalizedHome.toLowerCase()];
    for (const prefix of homePrefixes) {
      if (
        normalized === prefix ||
        normalized.startsWith(`${prefix}/`)
      ) {
        normalized = `~${normalized.slice(prefix.length)}`;
        break;
      }
    }
  }

  normalized = normalized.replace(/^\$HOME(?=\/|\\|$)/i, "~");
  normalized = normalized.replaceAll("\\", "/");
  normalized = normalized.replace(/\/{2,}/g, "/");
  return normalized.toLowerCase();
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
