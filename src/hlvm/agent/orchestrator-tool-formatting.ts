/**
 * Tool result formatting, deduplication, and display helpers.
 * Extracted from orchestrator.ts for modularity.
 */

import {
  getTool,
  getToolPresentationKind,
  hasTool,
  type ToolPresentationKind,
} from "./registry.ts";
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
import {
  buildToolFailureMetadata,
  normalizeToolFailureText,
  type ToolFailureMetadata,
} from "./tool-results.ts";
import { persistToolResultSidecar } from "./tool-result-storage.ts";

export function stringifyToolResult(result: unknown): string {
  return safeStringify(result, 2);
}

export interface ToolResultOutputs {
  llmContent: string;
  summaryDisplay: string;
  returnDisplay: string;
  presentationKind: ToolPresentationKind;
  truncatedForLlm: boolean;
  truncatedForTranscript: boolean;
}

const TOOL_PRESENTATION_LIMITS: Record<
  ToolPresentationKind,
  { summaryChars: number; transcriptChars: number; llmChars: number }
> = {
  read: { summaryChars: 160, transcriptChars: 18_000, llmChars: 8_000 },
  search: { summaryChars: 180, transcriptChars: 16_000, llmChars: 7_000 },
  web: { summaryChars: 180, transcriptChars: 14_000, llmChars: 6_000 },
  shell: { summaryChars: 180, transcriptChars: 14_000, llmChars: 6_000 },
  edit: { summaryChars: 180, transcriptChars: 8_000, llmChars: 6_000 },
  diff: { summaryChars: 180, transcriptChars: 16_000, llmChars: 7_000 },
  meta: { summaryChars: 180, transcriptChars: 10_000, llmChars: 6_000 },
};

const PERSISTED_RESULT_PREVIEW_CHARS = 1_200;
const FAILURE_FACT_VALUE_MAX_CHARS = 160;

function isImageAttachmentResult(result: unknown): boolean {
  return isObjectValue(result) && "_imageAttachment" in result;
}

function isEffectivelyEmptyToolResult(result: unknown): boolean {
  if (!isObjectValue(result) || isImageAttachmentResult(result)) return false;
  return Object.entries(result).every(([key, value]) =>
    key === "success" || value === undefined
  );
}

function isBlankText(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

function stringifyFailureFactValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized
      ? truncate(normalized, FAILURE_FACT_VALUE_MAX_CHARS)
      : undefined;
  }
  if (
    typeof value === "number" || typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return truncate(
      safeStringify(value, 0).replace(/\s+/g, " ").trim(),
      FAILURE_FACT_VALUE_MAX_CHARS,
    );
  }
  if (isObjectValue(value)) {
    if (Object.keys(value).length === 0) return undefined;
    return truncate(
      safeStringify(value, 0).replace(/\s+/g, " ").trim(),
      FAILURE_FACT_VALUE_MAX_CHARS,
    );
  }
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized
    ? truncate(normalized, FAILURE_FACT_VALUE_MAX_CHARS)
    : undefined;
}

function renderFailureFacts(failure: ToolFailureMetadata): string | undefined {
  const entries: Array<[string, unknown]> = [];
  if (failure.code) {
    entries.push(["code", failure.code]);
  }
  if (failure.facts) {
    entries.push(...Object.entries(failure.facts));
  }
  const rendered = entries
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => {
      const renderedValue = stringifyFailureFactValue(value);
      return renderedValue ? [`${key}=${renderedValue}`] : [];
    });
  return rendered.length > 0 ? rendered.join("; ") : undefined;
}

async function buildFailureObservation(
  toolResult: ToolExecutionResult,
  errorText: string,
): Promise<{ observation: string; resultText: string }> {
  const failure = toolResult.failure ??
    buildToolFailureMetadata(errorText, { source: "tool" });
  const parts = [`Error kind: ${failure.kind}`];
  const facts = renderFailureFacts(failure);
  if (facts) {
    parts.push(`Key facts: ${facts}`);
  }
  parts.push(`Error: ${errorText}`);
  const hint = getRecoveryHint(errorText);
  if (hint) {
    parts.push(`Hint: ${hint}`);
  }
  if (
    typeof toolResult.diagnosticText === "string" &&
    toolResult.diagnosticText.trim()
  ) {
    parts.push(`Diagnostics:\n${toolResult.diagnosticText.trim()}`);
  }
  return {
    observation: parts.join("\n"),
    resultText: `ERROR: ${errorText}`,
  };
}

function detectSidecarFormat(
  result: unknown,
  rawBody: string,
  fallbackBody: string,
): "txt" | "json" {
  if (
    (Array.isArray(result) || isObjectValue(result)) && rawBody === fallbackBody
  ) {
    return "json";
  }
  const trimmed = rawBody.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return "json";
  }
  return "txt";
}

async function maybePersistOversizedToolResult(options: {
  toolName: string;
  toolCallId?: string;
  sessionId?: string;
  presentationKind: ToolPresentationKind;
  rawBody: string;
  rawLlmContent: string;
  fallbackBody: string;
  result: unknown;
  config: OrchestratorConfig;
}): Promise<Omit<ToolResultOutputs, "presentationKind"> | null> {
  const limits = TOOL_PRESENTATION_LIMITS[options.presentationKind];
  if (
    options.rawBody.length <= limits.transcriptChars &&
    options.rawLlmContent.length <= limits.llmChars
  ) {
    return null;
  }

  try {
    const format = detectSidecarFormat(
      options.result,
      options.rawBody,
      options.fallbackBody,
    );
    const sidecar = await persistToolResultSidecar({
      sessionId: options.sessionId,
      toolCallId: options.toolCallId,
      content: options.rawBody,
      format,
    });
    const previewSource = compressForLLM(
      options.presentationKind,
      options.rawLlmContent,
    );
    const preview = truncateWithNotice(
      previewSource,
      Math.min(PERSISTED_RESULT_PREVIEW_CHARS, limits.llmChars),
      options.presentationKind === "diff" || options.presentationKind === "read"
        ? "headtail"
        : "tail",
    ).text;
    const sizeLabel = `${sidecar.bytes.toLocaleString()} bytes`;
    const persistedBody = [
      `Full tool result was persisted to ${sidecar.path} (${sizeLabel}, ${sidecar.format.toUpperCase()}).`,
      "Preview:",
      preview,
    ].join("\n\n");
    return {
      llmContent: options.config.context.truncateResult(persistedBody),
      summaryDisplay: truncate(
        `Large result persisted to ${sidecar.path} (${sizeLabel}).`,
        limits.summaryChars,
      ),
      returnDisplay: persistedBody,
      truncatedForLlm: true,
      truncatedForTranscript: true,
    };
  } catch {
    return null;
  }
}

function truncateWithNotice(
  text: string,
  maxChars: number,
  strategy: "headtail" | "tail" = "tail",
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  if (maxChars <= 80) {
    return { text: truncate(text, maxChars), truncated: true };
  }
  if (strategy === "tail") {
    const notice = "\n\n... [output truncated] ...";
    return {
      text: text.slice(0, Math.max(0, maxChars - notice.length)) + notice,
      truncated: true,
    };
  }

  const notice = "\n\n... [middle omitted] ...\n\n";
  const available = Math.max(0, maxChars - notice.length);
  const head = Math.ceil(available * 0.65);
  const tail = Math.max(0, available - head);
  return {
    text: text.slice(0, head) + notice + text.slice(-tail),
    truncated: true,
  };
}

function keepHeadTailLines(
  text: string,
  headLines: number,
  tailLines: number,
): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= headLines + tailLines + 1) {
    return { text, truncated: false };
  }
  const omitted = lines.length - headLines - tailLines;
  return {
    text: [
      ...lines.slice(0, headLines),
      "",
      `... (${omitted} lines omitted) ...`,
      "",
      ...lines.slice(-tailLines),
    ].join("\n"),
    truncated: true,
  };
}

function extractStructuredBody(
  kind: ToolPresentationKind,
  result: unknown,
): string | undefined {
  if (!isObjectValue(result)) return undefined;

  if (kind === "diff" && typeof result.diff === "string") {
    return result.diff;
  }

  if (kind === "edit") {
    const parts: string[] = [];
    const message = typeof result.message === "string" && result.message.trim()
      ? result.message.trim()
      : undefined;
    const preview = typeof result.preview === "string" && result.preview.trim()
      ? result.preview.trim()
      : undefined;
    const verificationDiagnostics = isObjectValue(result.verification) &&
        typeof result.verification.diagnostics === "string" &&
        result.verification.diagnostics.trim()
      ? result.verification.diagnostics.trim()
      : undefined;

    if (message) parts.push(message);
    if (preview && preview !== message) parts.push(preview);
    if (verificationDiagnostics) parts.push(verificationDiagnostics);
    if (parts.length > 0) {
      return parts.join("\n\n");
    }
  }

  if (
    kind === "shell" &&
    typeof result.stdout === "string" &&
    typeof result.stderr === "string" &&
    typeof result.exitCode === "number"
  ) {
    const parts: string[] = [`exit ${result.exitCode}`];
    if (result.stdout.trim()) {
      parts.push(`stdout:\n${result.stdout.trimEnd()}`);
    }
    if (result.stderr.trim()) {
      parts.push(`stderr:\n${result.stderr.trimEnd()}`);
    }
    return parts.join("\n\n");
  }

  if (typeof result.message === "string" && result.message.trim()) {
    return result.message.trim();
  }

  return undefined;
}

function summarizeShellResult(result: unknown): string | undefined {
  if (!isObjectValue(result) || typeof result.exitCode !== "number") {
    return undefined;
  }
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const stdoutLines = stdout.trim() ? stdout.trim().split("\n").length : 0;
  const stderrLines = stderr.trim() ? stderr.trim().split("\n").length : 0;
  const parts = [`exit ${result.exitCode}`];
  if (stdoutLines > 0) {
    parts.push(`${stdoutLines} stdout line${stdoutLines === 1 ? "" : "s"}`);
  }
  if (stderrLines > 0) {
    parts.push(`${stderrLines} stderr line${stderrLines === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

function summarizeDiffBody(result: unknown, body: string): string | undefined {
  const fileCount =
    isObjectValue(result) && typeof result.fileCount === "number"
      ? result.fileCount
      : (body.match(/^diff --git /gm) ?? []).length;
  if (body.trim().length === 0) {
    return "No differences found";
  }
  const hunkCount = (body.match(/^@@ /gm) ?? []).length;
  const added = (body.match(/^\+(?!\+\+)/gm) ?? []).length;
  const removed = (body.match(/^-(?!---)/gm) ?? []).length;
  const parts = [`${fileCount || 1} file${fileCount === 1 ? "" : "s"} changed`];
  if (hunkCount > 0) {
    parts.push(`${hunkCount} hunk${hunkCount === 1 ? "" : "s"}`);
  }
  if (added > 0 || removed > 0) parts.push(`+${added} -${removed}`);
  return parts.join(" · ");
}

function buildStructuredSummary(
  kind: ToolPresentationKind,
  result: unknown,
  transcriptBody: string,
): string | undefined {
  if (!isObjectValue(result)) return undefined;
  if (kind === "shell") {
    return summarizeShellResult(result);
  }
  if (kind === "diff") {
    return summarizeDiffBody(result, transcriptBody);
  }
  if (typeof result.message === "string" && result.message.trim()) {
    return result.message.trim();
  }
  return undefined;
}

function shapeTranscriptBody(
  kind: ToolPresentationKind,
  body: string,
): { text: string; truncated: boolean } {
  switch (kind) {
    case "read":
      return keepHeadTailLines(body, 100, 40);
    case "search":
      return keepHeadTailLines(body, 80, 30);
    case "shell":
      return keepHeadTailLines(body, 30, 30);
    case "diff":
      return truncateWithNotice(
        body,
        TOOL_PRESENTATION_LIMITS[kind].transcriptChars,
        "headtail",
      );
    case "web":
    case "edit":
    case "meta":
    default:
      return truncateWithNotice(
        body,
        TOOL_PRESENTATION_LIMITS[kind].transcriptChars,
        "headtail",
      );
  }
}

export function compressForLLM(
  kind: ToolPresentationKind,
  result: string,
): string {
  switch (kind) {
    case "read":
      return compressFileContent(result);
    case "search":
      return keepHeadTailLines(result, 60, 20).text;
    case "shell":
      return compressShellOutput(result);
    case "diff":
      return compressDiffOutput(result);
    case "web":
      return truncateWithNotice(
        result,
        TOOL_PRESENTATION_LIMITS[kind].llmChars,
        "headtail",
      ).text;
    case "edit":
    case "meta":
    default:
      return result;
  }
}

export async function buildToolResultOutputs(
  toolName: string,
  result: unknown,
  config: OrchestratorConfig,
  toolCallId?: string,
): Promise<ToolResultOutputs> {
  const presentationKind = getToolPresentationKind(
    toolName,
    config.toolOwnerId,
  );
  let formatted: FormattedToolResult | null = null;
  try {
    const tool = hasTool(toolName, config.toolOwnerId)
      ? getTool(toolName, config.toolOwnerId)
      : null;
    formatted = tool?.formatResult ? tool.formatResult(result) : null;
  } catch {
    formatted = null;
  }

  const fallbackBody = stringifyToolResult(result);
  const fallbackMarker = `${toolName} completed with no output.`;
  const rawBodyCandidate = formatted?.returnDisplay ??
    extractStructuredBody(presentationKind, result) ??
    fallbackBody;
  const rawBody = !isImageAttachmentResult(result) &&
      (isBlankText(rawBodyCandidate) || isEffectivelyEmptyToolResult(result))
    ? fallbackMarker
    : rawBodyCandidate;
  const rawSummaryCandidate = formatted?.summaryDisplay ??
    buildStructuredSummary(presentationKind, result, rawBody) ??
    summarizeToolResult(toolName, result, rawBody);
  const rawSummary = isBlankText(rawSummaryCandidate)
    ? fallbackMarker
    : rawSummaryCandidate;
  const rawLlmContentCandidate = formatted?.llmContent ?? rawBody;
  const rawLlmContent = isBlankText(rawLlmContentCandidate)
    ? rawBody
    : rawLlmContentCandidate;

  const persisted = await maybePersistOversizedToolResult({
    toolName,
    toolCallId,
    sessionId: config.sessionId,
    presentationKind,
    rawBody,
    rawLlmContent,
    fallbackBody,
    result,
    config,
  });
  if (persisted) {
    return {
      ...persisted,
      presentationKind,
    };
  }

  const transcriptSummary = truncate(
    rawSummary,
    TOOL_PRESENTATION_LIMITS[presentationKind].summaryChars,
  );
  const transcriptBodyResult = shapeTranscriptBody(presentationKind, rawBody);
  const compressedLlm = compressForLLM(presentationKind, rawLlmContent);
  const llmContent = config.context.truncateResult(
    truncateWithNotice(
      compressedLlm,
      TOOL_PRESENTATION_LIMITS[presentationKind].llmChars,
      presentationKind === "diff" || presentationKind === "read"
        ? "headtail"
        : "tail",
    ).text,
  );

  return {
    llmContent,
    summaryDisplay: transcriptSummary,
    returnDisplay: transcriptBodyResult.text,
    presentationKind,
    truncatedForLlm: llmContent !== rawLlmContent,
    truncatedForTranscript: transcriptBodyResult.truncated ||
      transcriptSummary !== rawSummary,
  };
}

// ============================================================
// Smart per-tool compression — keeps signal, drops noise.
// truncateResult() remains the safety net after this.
// ============================================================

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

export async function buildToolObservation(
  toolCall: ToolCall,
  toolResult: ToolExecutionResult,
  requestedObservation?: string,
): Promise<{
  observation: string;
  resultText: string;
  toolName: string;
  usedRequestedObservation: boolean;
}> {
  if (toolResult.success) {
    const fullResultText = toolResult.llmContent ??
      stringifyToolResult(toolResult.result);
    if (isToolResultFailure(fullResultText)) {
      const hint = getRecoveryHint(fullResultText);
      const observation = hint
        ? `${fullResultText}\nHint: ${hint}`
        : fullResultText;
      return {
        observation,
        resultText: observation,
        toolName: toolCall.toolName,
        usedRequestedObservation: false,
      };
    }
    const observation = requestedObservation ?? fullResultText;
    return {
      observation,
      resultText: observation,
      toolName: toolCall.toolName,
      usedRequestedObservation: requestedObservation === undefined ||
        observation === requestedObservation,
    };
  }

  const errorText = toolResult.error ?? toolResult.llmContent ??
    "Unknown error";
  const failureObservation = await buildFailureObservation(
    toolResult,
    errorText,
  );

  return {
    observation: failureObservation.observation,
    resultText: failureObservation.resultText,
    toolName: toolCall.toolName,
    usedRequestedObservation: false,
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
  failure?: Partial<ToolFailureMetadata>,
): ToolExecutionResult {
  const normalizedError = normalizeToolFailureText({ message: error });
  const normalizedFailure = buildToolFailureMetadata(normalizedError, failure);
  const presentationKind = getToolPresentationKind(
    toolName,
    config.toolOwnerId,
  );
  const result: ToolExecutionResult = {
    success: false,
    error: normalizedError,
    failure: normalizedFailure,
    llmContent: normalizedError,
    summaryDisplay: normalizedError,
    returnDisplay: normalizedError,
    presentationKind,
    truncatedForLlm: false,
    truncatedForTranscript: false,
  };
  const meta: ToolEventMeta = {
    presentation: { kind: presentationKind },
    truncation: { llm: false, transcript: false },
  };

  config.onTrace?.({
    type: "tool_result",
    toolName,
    toolCallId,
    success: false,
    error: normalizedError,
    display: normalizedError,
  });
  config.onAgentEvent?.({
    type: "tool_end",
    name: toolName,
    toolCallId,
    success: false,
    content: normalizedError,
    summary: normalizedError,
    durationMs: Date.now() - startedAt,
    argsSummary: "",
    meta,
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

function extractWebFetchEventMeta(
  result: unknown,
): ToolEventMeta["webFetch"] | undefined {
  if (!isObjectValue(result)) return undefined;

  if (result.batch === true && Array.isArray(result.results)) {
    const count = toFiniteNumber(result.count) ?? result.results.length;
    const errors = toFiniteNumber(result.errors) ?? 0;
    return {
      batch: true,
      count,
      errors,
    };
  }

  const url = typeof result.url === "string" ? result.url : undefined;
  const status = toFiniteNumber(result.status);
  const bytes = toFiniteNumber(result.bytes);
  const contentType = typeof result.contentType === "string"
    ? result.contentType
    : undefined;

  if (
    url === undefined &&
    status === undefined &&
    bytes === undefined &&
    contentType === undefined
  ) {
    return undefined;
  }

  return {
    url,
    status,
    bytes,
    contentType,
    batch: false,
  };
}

function extractToolEventMeta(
  toolName: string,
  result: unknown,
  outputs: Pick<
    ToolResultOutputs,
    "presentationKind" | "truncatedForLlm" | "truncatedForTranscript"
  >,
): ToolEventMeta | undefined {
  const webSearch =
    (toolName === "search_web" || toolName.endsWith("_search_web"))
      ? extractWebSearchEventMeta(result)
      : undefined;
  const webFetch = (
      toolName === "web_fetch" ||
      toolName === "fetch_url" ||
      toolName.endsWith("_web_fetch") ||
      toolName.endsWith("_fetch_url")
    )
    ? extractWebFetchEventMeta(result)
    : undefined;
  return {
    presentation: { kind: outputs.presentationKind },
    truncation: {
      llm: outputs.truncatedForLlm,
      transcript: outputs.truncatedForTranscript,
    },
    ...(webSearch ? { webSearch } : {}),
    ...(webFetch ? { webFetch } : {}),
  };
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
  if (call.toolName === "open_path" || call.toolName === "reveal_path") {
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
    const home = getPlatform().env.get("HOME");
    const env: Record<string, string> = {};
    if (home) env.HOME = home;
    const parsed = parseShellCommand(command, env);
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
  outputs: ToolResultOutputs,
  startedAt: number,
  args?: unknown,
  rawResult?: unknown,
): void {
  const meta = extractToolEventMeta(toolName, rawResult, outputs);
  config.onTrace?.({
    type: "tool_result",
    toolName,
    toolCallId,
    success: true,
    result: outputs.llmContent,
    display: outputs.returnDisplay,
  });
  config.onAgentEvent?.({
    type: "tool_end",
    name: toolName,
    toolCallId,
    success: true,
    content: outputs.returnDisplay,
    summary: outputs.summaryDisplay,
    durationMs: Date.now() - startedAt,
    argsSummary: generateArgsSummary(toolName, args),
    meta,
  });
}
