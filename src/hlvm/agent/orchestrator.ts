/**
 * ReAct Orchestrator - Main AI agent loop
 *
 * Implements ReAct (Reasoning + Acting) pattern:
 * 1. Agent generates reasoning (Thought)
 * 2. Agent calls tool (Action)
 * 3. Tool returns result (Observation)
 * 4. Repeat until task complete
 *
 * Features:
 * - Native tool calling execution
 * - Safety checks before execution
 * - Context management
 * - Error handling with retry
 * - SSOT-compliant (uses all previous components)
 */

import { getAllTools, getTool, hasTool, validateToolArgs, type ToolFunction } from "./registry.ts";
import { checkToolSafety } from "./security/safety.ts";
import { ContextManager, ContextOverflowError, type Message } from "./context.ts";
import {
  DEFAULT_TIMEOUTS,
  DEFAULT_MAX_TOOL_CALLS,
  MAX_ITERATIONS,
  MAX_RETRIES,
  RATE_LIMITS,
  RESOURCE_LIMITS,
} from "./constants.ts";
import { withTimeout } from "../../common/timeout-utils.ts";
import {
  RateLimitError,
  SlidingWindowRateLimiter,
  type RateLimitConfig,
} from "../../common/rate-limiter.ts";
import { assertMaxBytes } from "../../common/limits.ts";
import { getErrorMessage, isObjectValue } from "../../common/utils.ts";
import { RuntimeError, ValidationError } from "../../common/error.ts";
import { checkGrounding, type ToolUse } from "./grounding.ts";
import { classifyError } from "./error-taxonomy.ts";
import type { AgentPolicy } from "./policy.ts";
import { loadWebConfig } from "./web-config.ts";
import { UsageTracker, estimateUsage, type TokenUsage } from "./usage.ts";
import type { MetricsSink } from "./metrics.ts";
import { isToolArgsObject } from "./validation.ts";
import { type LLMResponse, type ToolCall } from "./tool-call.ts";
import {
  applyRequestHintsToToolArgs,
  inferRequestHints,
  type RequestHints,
} from "./request-hints.ts";

export type { LLMResponse, ToolCall } from "./tool-call.ts";
import { getPlatform } from "../../platform/platform.ts";
import { log } from "../api/log.ts";
import { getAgentProfile, listAgentProfiles } from "./agent-registry.ts";
import {
  advancePlanState,
  createPlanState,
  extractStepDoneId,
  formatPlanForContext,
  requestPlan,
  stripStepMarkers,
  type Plan,
  type PlanState,
  type PlanningConfig,
  shouldPlanRequest,
} from "./planning.ts";

// ============================================================
// Types
// ============================================================

/** Result of tool execution */
interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  llmContent?: string;
  returnDisplay?: string;
  error?: string;
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result ?? "");
  }
}

function buildToolResultOutputs(
  toolName: string,
  result: unknown,
  config: OrchestratorConfig,
): { llmContent: string; returnDisplay: string } {
  let formatted: { returnDisplay: string; llmContent?: string } | null = null;
  try {
    const tool = hasTool(toolName) ? getTool(toolName) : null;
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

function buildToolObservation(
  toolCall: ToolCall,
  toolResult: ToolExecutionResult,
): { observation: string; resultText: string } {
  const resultText = toolResult.success
    ? toolResult.llmContent ?? stringifyToolResult(toolResult.result)
    : `ERROR: ${toolResult.error}`;

  const observation = toolResult.success
    ? `Tool: ${toolCall.toolName}\nResult: ${resultText}`
    : `Tool: ${toolCall.toolName}\nError: ${toolResult.error}`;

  return { observation, resultText };
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(args).filter(([, value]) =>
    value !== undefined
  );
  return Object.fromEntries(entries);
}

function buildToolErrorResult(
  toolName: string,
  error: string,
  startedAt: number,
  config: OrchestratorConfig,
): ToolExecutionResult {
  const display = error;
  const result = {
    success: false,
    error,
    llmContent: display,
    returnDisplay: display,
  };

  config.onTrace?.({
    type: "tool_result",
    toolName,
    success: false,
    error,
    display,
  });
  config.onToolDisplay?.({
    toolName,
    success: false,
    content: display,
  });
  emitMetric(config, "tool_result", {
    toolName,
    success: false,
    error,
    durationMs: Date.now() - startedAt,
  });

  return result;
}

function isToolAllowed(
  toolName: string,
  config: OrchestratorConfig,
): boolean {
  if (config.toolAllowlist && config.toolAllowlist.length > 0) {
    return config.toolAllowlist.includes(toolName);
  }
  if (config.toolDenylist && config.toolDenylist.length > 0) {
    return !config.toolDenylist.includes(toolName);
  }
  return true;
}

/** LLM function signature used by orchestrator */
export type LLMFunction = (
  messages: Message[],
  signal?: AbortSignal,
) => Promise<LLMResponse>;

/** Trace event for observability/debugging */
export type TraceEvent =
  | { type: "iteration"; current: number; max: number }
  | { type: "llm_call"; messageCount: number }
  | {
    type: "llm_response";
    length: number;
    truncated: string;
    content?: string;
    toolCalls?: number;
  }
  | { type: "tool_call"; toolName: string; args: unknown }
  | {
    type: "tool_result";
    toolName: string;
    success: boolean;
    result?: unknown;
    error?: string;
    display?: string;
  }
  | { type: "plan_created"; plan: Plan }
  | { type: "plan_step"; stepId: string; index: number; completed: boolean }
  | { type: "llm_retry"; attempt: number; max: number; class: string; retryable: boolean; error: string }
  | { type: "context_overflow"; maxTokens: number; estimatedTokens: number }
  | {
    type: "grounding_check";
    mode: "off" | "warn" | "strict";
    grounded: boolean;
    warnings: string[];
    retry: number;
    maxRetry: number;
  }
  | {
    type: "rate_limit";
    target: "llm" | "tool";
    maxCalls: number;
    windowMs: number;
    used: number;
    remaining: number;
    resetMs: number;
  }
  | {
    type: "resource_limit";
    kind: "tool_result_bytes";
    limit: number;
    used: number;
  }
  | {
    type: "llm_usage";
    usage: TokenUsage;
  }
  | { type: "loop_detected"; signature: string; count: number };

/** Tool output event for UI display */
export interface ToolDisplay {
  toolName: string;
  success: boolean;
  content: string;
}

/** Orchestrator configuration */
export interface OrchestratorConfig {
  /** Workspace directory for tool execution */
  workspace: string;
  /** Context manager for message history */
  context: ContextManager;
  /** Auto-approve all tool calls (for testing/automation) */
  autoApprove?: boolean;
  /** Maximum tool calls per turn (prevent infinite loops) */
  maxToolCalls?: number;
  /** Maximum consecutive denials before stopping (default: 3) */
  maxDenials?: number;
  /** Trace callback for observability (--trace mode) */
  onTrace?: (event: TraceEvent) => void;
  /** Tool output callback for UI display */
  onToolDisplay?: (display: ToolDisplay) => void;
  /** LLM timeout in milliseconds (default: 30000) */
  llmTimeout?: number;
  /** Tool timeout in milliseconds (default: 60000) */
  toolTimeout?: number;
  /** Maximum retries for LLM calls (default: 3) */
  maxRetries?: number;
  /** Maximum consecutive identical tool call batches before stopping */
  maxToolCallRepeat?: number;
  /** Continue executing remaining tool calls even if one fails (default: true) */
  continueOnError?: boolean;
  /** Grounding enforcement mode (default: "off") */
  groundingMode?: "off" | "warn" | "strict";
  /** Rate limit for LLM calls (per sliding window) */
  llmRateLimit?: RateLimitConfig;
  /** Rate limit for tool calls (per sliding window) */
  toolRateLimit?: RateLimitConfig;
  /** Max total tool result bytes per run */
  maxTotalToolResultBytes?: number;
  /** Internal prebuilt rate limiter (LLM) */
  llmRateLimiter?: SlidingWindowRateLimiter | null;
  /** Internal prebuilt rate limiter (tools) */
  toolRateLimiter?: SlidingWindowRateLimiter | null;
  /** Optional policy overrides (allow/deny/ask) */
  policy?: AgentPolicy | null;
  /** Auto-run web tools for URL-centric requests */
  autoWeb?: boolean;
  /** Internal: prevent repeated Playwright install prompts */
  playwrightInstallAttempted?: boolean;
  /** Optional usage tracker for LLM token accounting */
  usage?: UsageTracker;
  /** Optional metrics sink for structured events */
  metrics?: MetricsSink;
  /** Planning configuration (optional) */
  planning?: PlanningConfig;
  /** Optional delegate handler for multi-agent orchestration */
  delegate?: (
    args: unknown,
    config: OrchestratorConfig,
  ) => Promise<unknown>;
  /** Optional tool allowlist (restrict tools for this run) */
  toolAllowlist?: string[];
  /** Optional tool denylist (block tools for this run) */
  toolDenylist?: string[];
  /** Require at least one tool call before answering */
  requireToolCalls?: boolean;
  /** Max retries when tool calls are required */
  maxToolCallRetries?: number;
  /** No-input mode: do not ask the user questions */
  noInput?: boolean;
  /** Optional request hints inferred from user input */
  requestHints?: RequestHints;
}

/** Tool call envelope constants */

const URL_PATTERN = /https?:\/\/[^\s"'<>`)\]]+/i;
const BARE_DOMAIN_PATTERN = /\b([a-z0-9][a-z0-9.-]+\.[a-z]{2,})(\/[^\s"'<>`)\]]*)?/i;
const RENDER_KEYWORDS = [
  "landing page",
  "homepage",
  "home page",
  "front page",
  "main page",
  "videos",
  "video",
  "trending",
  "recommended",
  "feed",
  "latest",
  "current",
  "today",
  "what's on",
  "what is on",
  "top stories",
];
const SUMMARY_KEYWORDS = [
  "summarize",
  "summary",
  "extract",
  "list",
  "show",
  "what",
  "content",
  "contents",
  "headline",
  "headlines",
  "articles",
  "news",
];
const RESEARCH_KEYWORDS = [
  "news",
  "latest",
  "today",
  "headline",
  "headlines",
  "trending",
  "top stories",
  "search",
  "find",
  "look up",
  "research",
  "go to",
  "open",
  "website",
  "web",
  "online",
];
const AUTO_WEB_MIN_TEXT_CHARS = 200;
const AUTO_WEB_DRILLDOWN_LINKS = 3;
const LOCAL_SEARCH_URL_TEMPLATE = "https://duckduckgo.com/?q={{query}}&t=h_&ia=web";
const LOCAL_SEARCH_RENDER_DEFAULTS = {
  waitMs: 1500,
  maxTextLength: 6000,
  maxLinks: 40,
  textSelector: "a",
  textSelectorLimit: 40,
} as const;
const REASONING_KEYWORDS = [
  "pick",
  "choose",
  "best",
  "top",
  "funnest",
  "funniest",
  "recommend",
  "compare",
  "rank",
];
const CODEBASE_HINTS = [
  "src",
  "tests",
  "file",
  "files",
  "directory",
  "repo",
  "repository",
  "code",
  "function",
  "class",
  "method",
  ".ts",
  ".js",
  ".hql",
  "workspace",
  "project",
];
const RAW_KEYWORDS = ["raw", "html", "headers", "fetch"];
const VIDEO_LIST_KEYWORDS = [
  "video list",
  "videos",
  "video",
  "watch",
  "what's on",
  "what is on",
  "trending",
  "recommended",
  "feed",
];
const PLAYWRIGHT_ERROR_MARKERS = [
  "executable doesn't exist",
  "install chromium",
  "please run the following command to download new browsers",
];

function addContextMessage(
  config: OrchestratorConfig,
  message: Message,
): void {
  try {
    config.context.addMessage(message);
  } catch (error) {
    if (error instanceof ContextOverflowError) {
      config.onTrace?.({
        type: "context_overflow",
        maxTokens: error.maxTokens,
        estimatedTokens: error.estimatedTokens,
      });
      emitMetric(config, "context_overflow", {
        maxTokens: error.maxTokens,
        estimatedTokens: error.estimatedTokens,
      });
    }
    throw error;
  }
}

export function extractUrlFromText(input: string): string | null {
  const direct = input.match(URL_PATTERN);
  if (direct?.[0]) {
    return trimUrl(direct[0]);
  }

  const bare = input.match(BARE_DOMAIN_PATTERN);
  if (bare?.[0]) {
    return `https://${trimUrl(bare[0])}`;
  }

  return null;
}

function trimUrl(raw: string): string {
  return raw.replace(/[.,!?;:)\]]+$/g, "");
}

function hasKeyword(input: string, keywords: string[]): boolean {
  const lower = input.toLowerCase();
  return keywords.some((word) => lower.includes(word));
}

function responseAsksQuestion(response: string): boolean {
  if (!response) return false;
  return response.includes("?");
}

function requiresReasoning(input: string): boolean {
  return hasKeyword(input, REASONING_KEYWORDS);
}

export function shouldAutoResearchWebRequest(request: string): boolean {
  if (extractUrlFromText(request)) return false;
  if (hasKeyword(request, CODEBASE_HINTS)) return false;
  return hasKeyword(request, RESEARCH_KEYWORDS);
}

function hasSearchApiKey(search: {
  provider: string;
  brave?: { apiKey?: string };
  perplexity?: { apiKey?: string };
  openrouter?: { apiKey?: string };
}): boolean {
  const provider = search.provider?.toLowerCase?.() ?? "";
  if (provider === "brave") return Boolean(search.brave?.apiKey?.trim());
  if (provider === "perplexity") return Boolean(search.perplexity?.apiKey?.trim());
  if (provider === "openrouter") return Boolean(search.openrouter?.apiKey?.trim());
  return Boolean(
    search.brave?.apiKey?.trim() ||
      search.perplexity?.apiKey?.trim() ||
      search.openrouter?.apiKey?.trim(),
  );
}

function buildLocalSearchUrl(
  query: string,
): string {
  const template = LOCAL_SEARCH_URL_TEMPLATE;
  const encoded = encodeURIComponent(query.trim());
  if (!template.includes("{{query}}")) return template;
  return template.split("{{query}}").join(encoded);
}

function normalizeSearchHost(host: string): string {
  if (!host) return host;
  return host.startsWith("www.") ? host.slice(4) : host;
}

function buildSiteSearchQuery(request: string, host: string): string {
  const normalizedHost = normalizeSearchHost(host);
  const withoutUrl = request.replace(URL_PATTERN, " ");
  const cleaned = withoutUrl
    .replace(/\s+/g, " ")
    .trim();
  const core = cleaned || normalizedHost;
  return normalizedHost ? `site:${normalizedHost} ${core}`.trim() : core;
}

function buildLocalSearchToolCall(
  request: string,
): { toolName: string; args: Record<string, unknown> } | null {
  const url = buildLocalSearchUrl(request);
  const renderTool = findRenderToolName();
  if (renderTool) {
    const args: Record<string, unknown> = {
      url,
      waitMs: LOCAL_SEARCH_RENDER_DEFAULTS.waitMs,
      maxTextLength: LOCAL_SEARCH_RENDER_DEFAULTS.maxTextLength,
      maxLinks: LOCAL_SEARCH_RENDER_DEFAULTS.maxLinks,
    };
    if (LOCAL_SEARCH_RENDER_DEFAULTS.textSelector) {
      args.textSelector = LOCAL_SEARCH_RENDER_DEFAULTS.textSelector;
    }
    if (LOCAL_SEARCH_RENDER_DEFAULTS.textSelectorLimit) {
      args.textSelectorLimit = LOCAL_SEARCH_RENDER_DEFAULTS.textSelectorLimit;
    }
    return { toolName: renderTool, args };
  }
  if (hasTool("web_fetch")) {
    return { toolName: "web_fetch", args: { url } };
  }
  if (hasTool("fetch_url")) {
    return { toolName: "fetch_url", args: { url } };
  }
  return null;
}

function getHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

function findRenderToolName(): string | null {
  if (hasTool("mcp/playwright/render_url")) return "mcp/playwright/render_url";
  if (hasTool("render_url")) return "render_url";
  const tools = Object.keys(getAllTools());
  for (const name of tools) {
    if (name.endsWith("/render_url")) return name;
  }
  return null;
}

function normalizeSearchRedirect(link: string): string {
  try {
    const url = new URL(link);
    for (const value of url.searchParams.values()) {
      try {
        const decoded = decodeURIComponent(value);
        if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
          return decoded;
        }
      } catch {
        // ignore bad decode
      }
    }
  } catch {
    // ignore
  }
  return link;
}

function hasMeaningfulText(result: unknown, requestHost?: string): boolean {
  if (!result || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  if (requestHost) {
    const resultHost = typeof record.url === "string" ? getHost(record.url) : "";
    if (
      resultHost &&
      requestHost !== resultHost &&
      !requestHost.endsWith(`.${resultHost}`) &&
      !resultHost.endsWith(`.${requestHost}`)
    ) {
      return false;
    }
  }
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (text.length >= AUTO_WEB_MIN_TEXT_CHARS) return true;
  const content = typeof record.content === "string"
    ? record.content.trim()
    : "";
  if (content.length >= AUTO_WEB_MIN_TEXT_CHARS) return true;
  const matches = Array.isArray(record.textMatches)
    ? record.textMatches.filter((item) => typeof item === "string")
    : [];
  return matches.length >= 5;
}

function extractLinksFromResult(result: unknown, baseUrl?: string): string[] {
  if (!result || typeof result !== "object") return [];
  const record = result as Record<string, unknown>;
  const base = typeof record.url === "string"
    ? record.url
    : baseUrl;
  const links = Array.isArray(record.links)
    ? record.links.filter((item) => typeof item === "string")
    : [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const trimmed = link.trim();
    if (!trimmed) continue;
    let resolved = trimmed;
    if (trimmed.startsWith("//")) {
      resolved = `https:${trimmed}`;
    } else if (!trimmed.startsWith("http") && base) {
      try {
        resolved = new URL(trimmed, base).toString();
      } catch {
        continue;
      }
    }
    if (!resolved.startsWith("http")) continue;
    const normalized = normalizeSearchRedirect(resolved);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function isSameSite(link: string, host: string): boolean {
  if (!host) return false;
  try {
    const linkHost = new URL(link).host.toLowerCase();
    return linkHost === host || linkHost.endsWith(`.${host}`) ||
      host.endsWith(`.${linkHost}`);
  } catch {
    return false;
  }
}

function selectCandidateLinks(
  links: string[],
  host: string,
): string[] {
  if (links.length === 0) return [];
  const sameSite: string[] = [];
  const other: string[] = [];
  for (const link of links) {
    if (host && isSameSite(link, host)) {
      sameSite.push(link);
    } else {
      other.push(link);
    }
  }
  const ordered = sameSite.length > 0 ? sameSite : links;
  const output: string[] = [];
  for (const link of ordered) {
    if (output.length >= AUTO_WEB_DRILLDOWN_LINKS) break;
    output.push(link);
  }
  return output;
}

function buildAutoWebContentCall(url: string): ToolCall | null {
  const renderTool = findRenderToolName();
  if (renderTool) {
    return {
      toolName: renderTool,
      args: {
        url,
        waitMs: 1200,
        maxTextLength: 6000,
        maxLinks: 25,
      },
    };
  }
  if (hasTool("extract_url")) {
    return {
      toolName: "extract_url",
      args: {
        url,
        maxTextLength: 6000,
        maxLinks: 25,
      },
    };
  }
  if (hasTool("web_fetch")) {
    return {
      toolName: "web_fetch",
      args: {
        url,
        maxChars: 6000,
      },
    };
  }
  if (hasTool("fetch_url")) {
    return { toolName: "fetch_url", args: { url } };
  }
  return null;
}

async function runAutoWebDrilldown(
  request: string,
  baseResult: unknown,
  config: OrchestratorConfig,
  record: (call: ToolCall, result: ToolExecutionResult) => void,
): Promise<Array<{ call: ToolCall; result: ToolExecutionResult }>> {
  const url = extractUrlFromText(request);
  if (!url) return [];
  const host = getHost(url);
  let links = extractLinksFromResult(baseResult, url);
  if (links.length === 0) {
    const searchQuery = buildSiteSearchQuery(request, host);
    const searchCall = buildLocalSearchToolCall(searchQuery);
    if (searchCall) {
      const searchResult = await executeToolCall(searchCall, config);
      record(searchCall, searchResult);
      if (searchResult.success) {
        links = extractLinksFromResult(searchResult.result);
      }
    }
  }
  if (links.length === 0) return [];
  const candidates = selectCandidateLinks(links, host);
  if (candidates.length === 0) return [];

  const results: Array<{ call: ToolCall; result: ToolExecutionResult }> = [];
  for (const link of candidates) {
    const call = buildAutoWebContentCall(link);
    if (!call) continue;
    const toolResult = await executeToolCall(call, config);
    record(call, toolResult);
    results.push({ call, result: toolResult });
  }
  return results;
}

function pickBestAutoWebResult(
  primary: { call: ToolCall; result: ToolExecutionResult } | null,
  fallback: { call: ToolCall; result: ToolExecutionResult } | null,
  local: { call: ToolCall; result: ToolExecutionResult } | null,
  drilldown: Array<{ call: ToolCall; result: ToolExecutionResult }>,
  requestHost?: string,
): { call: ToolCall; result: ToolExecutionResult } | null {
  const candidates: Array<{ call: ToolCall; result: ToolExecutionResult }> = [];
  for (const entry of drilldown) {
    if (entry) candidates.push(entry);
  }
  if (primary) candidates.push(primary);
  if (fallback) candidates.push(fallback);
  if (local) candidates.push(local);

  for (const candidate of candidates) {
    if (
      candidate.result.success &&
      hasMeaningfulText(candidate.result.result, requestHost)
    ) {
      return candidate;
    }
  }
  for (const candidate of candidates) {
    if (candidate.result.success) return candidate;
  }
  return null;
}

export function chooseAutoWebTool(
  request: string,
): { toolName: string; args: Record<string, unknown> } | null {
  const url = extractUrlFromText(request);
  if (!url) return null;

  const wantsRaw = hasKeyword(request, RAW_KEYWORDS);
  const wantsSummary = hasKeyword(request, SUMMARY_KEYWORDS);
  const renderTool = findRenderToolName();
  const wantsRender = Boolean(renderTool) && !wantsRaw;

  if (wantsRender && renderTool) {
    const args: Record<string, unknown> = { url };
    return { toolName: renderTool, args };
  }

  if (wantsRaw && hasTool("fetch_url")) {
    return { toolName: "fetch_url", args: { url } };
  }

  if (hasTool("web_fetch") && (wantsSummary || !wantsRaw)) {
    return { toolName: "web_fetch", args: { url } };
  }

  if (hasTool("extract_url") && (wantsSummary || !wantsRaw)) {
    return { toolName: "extract_url", args: { url } };
  }

  if (hasTool("fetch_url")) {
    return { toolName: "fetch_url", args: { url } };
  }

  if (hasTool("web_fetch")) {
    return { toolName: "web_fetch", args: { url } };
  }

  return null;
}

function isRenderToolName(toolName: string): boolean {
  return toolName === "render_url" || toolName.endsWith("/render_url");
}

function isAutoWebToolName(toolName: string): boolean {
  return toolName === "search_web" ||
    toolName === "web_search" ||
    toolName === "research_web" ||
    toolName === "fetch_url" ||
    toolName === "web_fetch" ||
    toolName === "extract_url" ||
    toolName === "extract_html" ||
    isRenderToolName(toolName);
}

function isSearchToolName(toolName: string): boolean {
  return toolName === "search_web" ||
    toolName === "web_search" ||
    toolName === "research_web";
}

function isEmptySearchResult(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  const results = Array.isArray(record.results) ? record.results : [];
  const citations = Array.isArray(record.citations) ? record.citations : [];
  const answer = typeof record.answer === "string" ? record.answer.trim() : "";
  const count = typeof record.count === "number" ? record.count : results.length;
  return count === 0 && results.length === 0 && citations.length === 0 && !answer;
}

function buildEmptySearchWarning(toolName: string): string {
  return [
    `Tool: ${toolName}`,
    "Search returned no results.",
    "Ask the user to clarify the query, provide a URL, or retry with a different query.",
    "Do not call unrelated tools.",
  ].join("\n");
}

function buildToolSignature(calls: ToolCall[]): string {
  return calls.map((call) => {
    const args = JSON.stringify(call.args ?? {});
    return `${call.toolName}:${args}`;
  }).join("|");
}

function buildToolRequiredMessage(allowlist?: string[]): string {
  const tools = allowlist && allowlist.length > 0
    ? allowlist.join(", ")
    : "the available tools";
  return [
    "Tool use is required to complete this request.",
    `Use one of: ${tools}.`,
    "Call the appropriate tool using native function calling.",
  ].join("\n");
}

function parseToolCallJsonCandidate(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isToolCallShape(value: unknown): boolean {
  if (!isObjectValue(value)) return false;
  const record = value as Record<string, unknown>;
  const functionObj = isObjectValue(record.function)
    ? (record.function as Record<string, unknown>)
    : null;
  const toolName = typeof record.toolName === "string"
    ? record.toolName
    : typeof record.tool_name === "string"
    ? record.tool_name
    : typeof record.function_name === "string"
    ? record.function_name
    : typeof record.name === "string"
    ? record.name
    : functionObj && typeof functionObj.name === "string"
    ? functionObj.name
    : "";

  if (!toolName.trim()) return false;

  const hasArgs = "args" in record ||
    "parameters" in record ||
    "arguments" in record ||
    (functionObj
      ? ("arguments" in functionObj || "parameters" in functionObj)
      : false);

  return hasArgs;
}

function looksLikeToolCallJson(text: string): boolean {
  const parsed = parseToolCallJsonCandidate(text);
  if (!parsed) return false;
  if (Array.isArray(parsed)) {
    return parsed.some((entry) => isToolCallShape(entry));
  }
  return isToolCallShape(parsed);
}

function chooseAutoWebFallback(
  primaryTool: string,
  request: string,
): { toolName: string; args: Record<string, unknown> } | null {
  const url = extractUrlFromText(request);
  if (!url) return null;

  const candidates: string[] = [];
  if (primaryTool !== "web_fetch" && hasTool("web_fetch")) {
    candidates.push("web_fetch");
  }
  if (primaryTool !== "extract_url" && hasTool("extract_url")) {
    candidates.push("extract_url");
  }
  if (primaryTool !== "fetch_url" && hasTool("fetch_url")) {
    candidates.push("fetch_url");
  }

  if (candidates.length === 0) return null;
  return { toolName: candidates[0], args: { url } };
}

function formatAutoWebFailure(
  primaryTool: string,
  primaryError?: string,
  fallbackTool?: string,
  fallbackError?: string,
): string {
  const lines = [
    `Web tool failed (${primaryTool}): ${primaryError ?? "Unknown error"}`,
  ];
  if (fallbackTool) {
    lines.push(
      `Fallback failed (${fallbackTool}): ${fallbackError ?? "Unknown error"}`,
    );
  }
  return lines.join("\n");
}

export function shouldAutoAnswerWebRequest(request: string): boolean {
  const url = extractUrlFromText(request);
  if (!url) return false;
  if (requiresReasoning(request)) return false;
  return hasKeyword(request, SUMMARY_KEYWORDS) ||
    hasKeyword(request, VIDEO_LIST_KEYWORDS) ||
    hasKeyword(request, RENDER_KEYWORDS);
}

function isPlaywrightMissingError(message: string): boolean {
  const lower = message.toLowerCase();
  return PLAYWRIGHT_ERROR_MARKERS.some((marker) => lower.includes(marker));
}

async function promptPlaywrightInstall(
  config: OrchestratorConfig,
): Promise<boolean> {
  try {
    const tool = getTool("ask_user");
    const response = await tool.fn(
      {
        question:
          "Playwright Chromium is required to render this page. Install now? (y/n)",
      },
      config.workspace,
    );
    return String(response).trim().toLowerCase().startsWith("y");
  } catch (error) {
    log.warn(`Playwright install prompt failed: ${getErrorMessage(error)}`);
    return false;
  }
}

async function runPlaywrightInstall(): Promise<boolean> {
  const platform = getPlatform();
  try {
    const process = platform.command.run({
      cmd: ["npx", "playwright", "install", "chromium"],
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await process.status;
    if (!status.success) {
      log.error("Playwright install failed");
      return false;
    }
    return true;
  } catch (error) {
    log.error(`Playwright install failed: ${getErrorMessage(error)}`);
    return false;
  }
}

async function ensurePlaywrightChromium(
  config: OrchestratorConfig,
): Promise<boolean> {
  if (config.playwrightInstallAttempted) return false;
  config.playwrightInstallAttempted = true;

  if (config.autoWeb) {
    log.info("Installing Playwright Chromium (auto-web)...");
    return await runPlaywrightInstall();
  }

  const confirmed = await promptPlaywrightInstall(config);
  if (!confirmed) return false;

  log.info("Installing Playwright Chromium...");
  return await runPlaywrightInstall();
}

function emitMetric(
  config: OrchestratorConfig,
  type: string,
  data: Record<string, unknown>,
): void {
  if (!config.metrics) return;
  config.metrics.emit({
    ts: Date.now(),
    type,
    data,
  });
}

function createRateLimiter(
  config: RateLimitConfig | undefined,
): SlidingWindowRateLimiter | null {
  if (!config) return null;
  if (config.maxCalls <= 0 || config.windowMs <= 0) return null;
  return new SlidingWindowRateLimiter(config);
}

// ============================================================
// Tool Execution
// ============================================================

/**
 * Execute single tool call
 *
 * Performs:
 * 1. Tool validation (exists in registry)
 * 2. Safety check (with user confirmation if needed)
 * 3. Tool execution
 * 4. Result truncation (if needed)
 *
 * @param toolCall Tool call to execute
 * @param config Orchestrator configuration
 * @returns Execution result
 *
 * @example
 * ```ts
 * const result = await executeToolCall(
 *   { toolName: "read_file", args: { path: "src/main.ts" } },
 *   { workspace: "/project", context, autoApprove: true }
 * );
 *
 * if (result.success) {
 *   console.log("Result:", result.result);
 * }
 * ```
 */
export async function executeToolCall(
  toolCall: ToolCall,
  config: OrchestratorConfig,
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  const normalizedArgs = sanitizeArgs(toolCall.args);
  // Emit trace event: tool call
  config.onTrace?.({
    type: "tool_call",
    toolName: toolCall.toolName,
    args: normalizedArgs,
  });
  emitMetric(config, "tool_call", {
    toolName: toolCall.toolName,
  });

  try {
    // Validate tool exists
    if (!hasTool(toolCall.toolName)) {
      return buildToolErrorResult(
        toolCall.toolName,
        `Unknown tool: ${toolCall.toolName}`,
        startedAt,
        config,
      );
    }

    if (!isToolAllowed(toolCall.toolName, config)) {
      return buildToolErrorResult(
        toolCall.toolName,
        `Tool not allowed by orchestrator: ${toolCall.toolName}`,
        startedAt,
        config,
      );
    }

    const validation = validateToolArgs(toolCall.toolName, normalizedArgs);
    if (!validation.valid) {
      const details = (validation.errors ?? []).join("; ");
      return buildToolErrorResult(
        toolCall.toolName,
        `Invalid arguments for ${toolCall.toolName}: ${details}`,
        startedAt,
        config,
      );
    }

    // Check safety
    const autoApprove =
      (config.autoApprove ?? false) ||
      ((config.autoWeb ?? false) && isAutoWebToolName(toolCall.toolName));
    const approved = await checkToolSafety(
      toolCall.toolName,
      normalizedArgs,
      autoApprove,
      config.policy ?? null,
    );

    if (!approved) {
      return buildToolErrorResult(
        toolCall.toolName,
        `Tool execution denied by user: ${toolCall.toolName}`,
        startedAt,
        config,
      );
    }

    if (toolCall.toolName === "delegate_agent" && config.delegate) {
      const result = await config.delegate(normalizedArgs, config);
      const { llmContent, returnDisplay } = buildToolResultOutputs(
        toolCall.toolName,
        result,
        config,
      );
      config.onTrace?.({
        type: "tool_result",
        toolName: toolCall.toolName,
        success: true,
        result: llmContent,
        display: returnDisplay,
      });
      config.onToolDisplay?.({
        toolName: toolCall.toolName,
        success: true,
        content: returnDisplay,
      });
      emitMetric(config, "tool_result", {
        toolName: toolCall.toolName,
        success: true,
        durationMs: Date.now() - startedAt,
      });
      return {
        success: true,
        result,
        llmContent,
        returnDisplay,
      };
    }

    // Get tool and execute (with timeout)
    const tool = getTool(toolCall.toolName);
    const toolTimeout = config.toolTimeout ?? DEFAULT_TIMEOUTS.tool;
    let result: unknown;
    try {
      result = await executeToolWithTimeout(
        tool.fn,
        normalizedArgs,
        config.workspace,
        toolTimeout,
        config.policy ?? null,
      );
    } catch (error) {
      const message = getErrorMessage(error);
      if (
        config.autoWeb &&
        isRenderToolName(toolCall.toolName) &&
        isPlaywrightMissingError(message)
      ) {
        const installed = await ensurePlaywrightChromium(config);
        if (installed) {
          result = await executeToolWithTimeout(
            tool.fn,
            normalizedArgs,
            config.workspace,
            toolTimeout,
            config.policy ?? null,
          );
        } else {
          return buildToolErrorResult(
            toolCall.toolName,
            message,
            startedAt,
            config,
          );
        }
      } else {
        return buildToolErrorResult(
          toolCall.toolName,
          message,
          startedAt,
          config,
        );
      }
    }

    const { llmContent, returnDisplay } = buildToolResultOutputs(
      toolCall.toolName,
      result,
      config,
    );

    // Emit trace event: tool result (success)
    config.onTrace?.({
      type: "tool_result",
      toolName: toolCall.toolName,
      success: true,
      result: llmContent,
      display: returnDisplay,
    });
    config.onToolDisplay?.({
      toolName: toolCall.toolName,
      success: true,
      content: returnDisplay,
    });
    emitMetric(config, "tool_result", {
      toolName: toolCall.toolName,
      success: true,
      durationMs: Date.now() - startedAt,
    });

    return {
      success: true,
      result,
      llmContent,
      returnDisplay,
    };
  } catch (error) {
    return buildToolErrorResult(
      toolCall.toolName,
      getErrorMessage(error),
      startedAt,
      config,
    );
  }
}

/**
 * Execute multiple tool calls sequentially
 *
 * @param toolCalls Tool calls to execute
 * @param config Orchestrator configuration
 * @returns Array of execution results
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  config: OrchestratorConfig,
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];
  const continueOnError = config.continueOnError ?? true; // Default: continue
  const toolLimiter = config.toolRateLimiter ??
    createRateLimiter(config.toolRateLimit ?? RATE_LIMITS.toolCalls);
  config.toolRateLimiter = toolLimiter;

  for (const call of toolCalls) {
    if (toolLimiter) {
      const status = toolLimiter.consume(1);
      if (!status.allowed) {
        config.onTrace?.({
          type: "rate_limit",
          target: "tool",
          maxCalls: status.maxCalls,
          windowMs: status.windowMs,
          used: status.used,
          remaining: status.remaining,
          resetMs: status.resetMs,
        });
        emitMetric(config, "rate_limit", {
          target: "tool",
          maxCalls: status.maxCalls,
          windowMs: status.windowMs,
          used: status.used,
          remaining: status.remaining,
          resetMs: status.resetMs,
        });
        const error = new RateLimitError(
          `Tool rate limit exceeded (${status.used}/${status.maxCalls} per ${status.windowMs}ms)`,
          status.maxCalls,
          status.windowMs,
        );
        const result = { success: false, error: error.message };
        results.push(result);
        if (!continueOnError) {
          break;
        }
        continue;
      }
    }

    const result = await executeToolCall(call, config);
    results.push(result);

    // Stop on first error only if continueOnError is false
    if (!result.success && !continueOnError) {
      break;
    }
  }

  return results;
}

// ============================================================
// ReAct Loop
// ============================================================

/**
 * Process agent response and execute tool calls
 *
 * Main orchestration function:
 * 1. Add agent response to context
 * 2. Execute structured tool calls with safety checks
 * 3. Add tool results to context
 * 4. Return results for next agent turn
 *
 * @param agentResponse Agent's response (may contain tool calls)
 * @param config Orchestrator configuration
 * @returns Tool execution results and whether to continue
 *
 * @example
 * ```ts
 * // Agent generates response with tool call
 * const agentResponse = {
 *   content: "Let me read that file.",
 *   toolCalls: [{ toolName: "read_file", args: { path: "src/main.ts" } }],
 * };
 *
 * const result = await processAgentResponse(
 *   agentResponse,
 *   { workspace: "/project", context, autoApprove: true }
 * );
 *
 * if (result.toolCallsMade > 0) {
 *   // Continue conversation with tool results
 *   const observation = result.results[0];
 *   // Send observation back to agent...
 * }
 * ```
 */
export async function processAgentResponse(
  agentResponse: LLMResponse,
  config: OrchestratorConfig,
): Promise<{
  toolCallsMade: number;
  results: ToolExecutionResult[];
  toolCalls: ToolCall[]; // Added for per-tool denial tracking (Issue #6)
  toolUses: ToolUse[];
  toolBytes: number;
  shouldContinue: boolean;
  finalResponse?: string;
}> {
  const content = (agentResponse.content ?? "").trim();
  if (content) {
    addContextMessage(config, {
      role: "assistant",
      content,
    });
  }

  const maxCalls = config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const toolCalls = Array.isArray(agentResponse.toolCalls)
    ? agentResponse.toolCalls
    : [];

  if (toolCalls.length > maxCalls) {
    addContextMessage(config, {
      role: "tool",
      content:
        `Too many tool calls (${toolCalls.length}). Only the first ${maxCalls} will be executed.`,
    });
  }

  if (toolCalls.length === 0) {
    return {
      toolCallsMade: 0,
      results: [],
      toolCalls: [],
      toolUses: [],
      toolBytes: 0,
      shouldContinue: false,
      finalResponse: content,
    };
  }

  const limitedCalls = toolCalls.slice(0, maxCalls);
  const hintedCalls = limitedCalls.map((call) => {
    const baseArgs = isToolArgsObject(call.args) ? call.args : {};
    const nextArgs = applyRequestHintsToToolArgs(
      call.toolName,
      baseArgs,
      config.requestHints,
    );
    if (nextArgs === baseArgs) {
      return call;
    }
    return {
      ...call,
      args: nextArgs,
    };
  });

  // Execute tool calls
  const results = await executeToolCalls(hintedCalls, config);

  // Add tool results to context + gather tool uses
  const toolUses: ToolUse[] = [];
  let toolBytes = 0;
  const encoder = new TextEncoder();
  for (let i = 0; i < results.length; i++) {
    const call = hintedCalls[i];
    const result = results[i];
    const { observation, resultText } = buildToolObservation(call, result);

    addContextMessage(config, {
      role: "tool",
      content: observation,
    });
    toolUses.push({
      toolName: call.toolName,
      result: resultText ?? "",
    });
    toolBytes += encoder.encode(resultText ?? "").length;

    if (result.success && isSearchToolName(call.toolName) && isEmptySearchResult(result.result)) {
      addContextMessage(config, {
        role: "tool",
        content: buildEmptySearchWarning(call.toolName),
      });
    }
  }

  let finalResponse: string | undefined;
  const completeIndex = hintedCalls.findIndex((call) =>
    call.toolName === "complete_task"
  );
  if (completeIndex >= 0) {
    const completeResult = results[completeIndex];
    if (completeResult?.success) {
      finalResponse = completeResult.returnDisplay ??
        completeResult.llmContent ??
        stringifyToolResult(completeResult.result);
    } else if (completeResult?.error) {
      finalResponse = `complete_task failed: ${completeResult.error}`;
    }
  }

  return {
    toolCallsMade: results.length,
    results,
    toolCalls: hintedCalls, // Return executed tool calls for denial tracking
    toolUses,
    toolBytes,
    shouldContinue: completeIndex < 0,
    finalResponse,
  };
}

// ============================================================
// Timeout/Retry Logic (Week 3)
// ============================================================

/**
 * Call LLM with timeout
 *
 * Wraps LLM call with timeout to prevent hangs.
 *
 * ⚠️ KNOWN LIMITATION: Promise.race rejects on timeout, but LLM stream
 * continues consuming! This is a resource leak that needs architectural fix.
 * See: Issue #5 (LLM timeouts don't abort streaming)
 *
 * FUTURE FIX: Requires LLM provider API to support:
 * - AbortSignal/AbortController in ai.chat()
 * - Generator cleanup/cancellation
 * - Proper stream abortion
 *
 * @param llmFn LLM function to call
 * @param messages Messages to send
 * @param timeout Timeout in milliseconds
 * @returns LLM response
 * @throws Error if timeout exceeded
 */
async function callLLMWithTimeout(
  llmFn: LLMFunction,
  messages: Message[],
  timeout: number,
): Promise<LLMResponse> {
  // NOTE: If llmFn doesn't honor AbortSignal, underlying stream may continue.
  return await withTimeout(
    async (signal) => {
      const response = await llmFn(messages, signal);
      if (signal.aborted) {
        throw new RuntimeError("LLM call aborted");
      }
      return response;
    },
    { timeoutMs: timeout, label: "LLM call" },
  );
}

/**
 * Call LLM with retry and exponential backoff
 *
 * Retries LLM call on failure with exponential backoff.
 * Backoff schedule: 1s, 2s, 4s, 8s, ...
 *
 * @param llmFn LLM function to call
 * @param messages Messages to send
 * @param config Retry configuration
 * @returns LLM response
 * @throws Error if all retries exhausted
 */
async function callLLMWithRetry(
  llmFn: LLMFunction,
  messages: Message[],
  config: { timeout: number; maxRetries: number },
  onTrace?: (event: TraceEvent) => void,
): Promise<LLMResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await callLLMWithTimeout(llmFn, messages, config.timeout);
    } catch (error) {
      lastError = error as Error;

      const classified = classifyError(error);
      onTrace?.({
        type: "llm_retry",
        attempt: attempt + 1,
        max: config.maxRetries,
        class: classified.class,
        retryable: classified.retryable,
        error: classified.message,
      });
      if (!classified.retryable) {
        break;
      }

      // Don't retry on last attempt
      if (attempt === config.maxRetries - 1) break;

      // Exponential backoff: 1s, 2s, 4s, 8s
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new RuntimeError(
    `LLM failed after ${config.maxRetries} retries: ${lastError?.message}`,
  );
}

/**
 * Execute tool with timeout
 *
 * Wraps tool execution with timeout to prevent hangs.
 *
 * ⚠️ KNOWN LIMITATION: Promise.race rejects on timeout, but underlying process
 * continues running! This is a resource leak that needs architectural fix.
 * See: Issue #4 (Tool timeouts don't cancel processes)
 *
 * FUTURE FIX: Requires platform.command API to support:
 * - AbortSignal/AbortController
 * - Process kill on timeout
 * - Proper cleanup of file descriptors/handles
 *
 * @param toolFn Tool function to execute
 * @param args Tool arguments
 * @param workspace Workspace path
 * @param timeout Timeout in milliseconds
 * @returns Tool result
 * @throws Error if timeout exceeded
 */
async function executeToolWithTimeout(
  toolFn: ToolFunction,
  args: unknown,
  workspace: string,
  timeout: number,
  policy?: AgentPolicy | null,
): Promise<unknown> {
  // NOTE: If toolFn doesn't honor AbortSignal, underlying work may continue.
  return await withTimeout(
    async (signal) => {
      const result = await toolFn(args, workspace, { signal, policy });
      if (signal.aborted) {
        throw new RuntimeError("Tool execution aborted");
      }
      return result;
    },
    { timeoutMs: timeout, label: "Tool execution" },
  );
}

// ============================================================
// ReAct Loop
// ============================================================

/**
 * Run full ReAct loop
 *
 * Orchestrates complete conversation:
 * 1. Initialize context with system prompt
 * 2. Add user request
 * 3. Loop:
 *    a. Call LLM to get agent response
 *    b. Process response (execute tool calls)
 *    c. Continue until agent finishes
 *
 * Note: This is a simplified version. Real implementation would:
 * - Integrate with actual LLM API
 * - Handle streaming responses
 * - Implement timeout/retry logic
 * - Add more sophisticated error handling
 *
 * @param userRequest User's request/question
 * @param config Orchestrator configuration
 * @param llmFunction Function to call LLM (dependency injection for testing)
 * @returns Final agent response
 */
export async function runReActLoop(
  userRequest: string,
  config: OrchestratorConfig,
  llmFunction: LLMFunction,
): Promise<string> {
  // Add user request to context
  addContextMessage(config, {
    role: "user",
    content: userRequest,
  });

  // Initialize usage tracker if not provided
  const usageTracker = config.usage ?? new UsageTracker();
  config.usage = usageTracker;
  if (!config.requestHints) {
    config.requestHints = inferRequestHints(userRequest);
  }

  let iterations = 0;
  const maxIterations = MAX_ITERATIONS;

  // Denial tracking - per tool (Issue #6)
  const denialCountByTool = new Map<string, number>();
  const maxDenials = config.maxDenials ?? 3;

  // Timeout/retry configuration
  const llmTimeout = config.llmTimeout ?? DEFAULT_TIMEOUTS.llm;
  const maxRetries = config.maxRetries ?? MAX_RETRIES;
  const groundingMode = config.groundingMode ?? "off";
  const llmRateConfig = config.llmRateLimit ?? RATE_LIMITS.llmCalls;
  const toolRateConfig = config.toolRateLimit ?? RATE_LIMITS.toolCalls;
  const llmLimiter = config.llmRateLimiter ?? createRateLimiter(llmRateConfig);
  const toolLimiter = config.toolRateLimiter ?? createRateLimiter(toolRateConfig);
  config.llmRateLimiter = llmLimiter;
  config.toolRateLimiter = toolLimiter;

  const maxToolResultBytes = config.maxTotalToolResultBytes ??
    RESOURCE_LIMITS.maxTotalToolResultBytes;
  let totalToolResultBytes = 0;
  const encoder = new TextEncoder();

  const updateToolResultBytes = (delta: number): void => {
    totalToolResultBytes += delta;
    if (maxToolResultBytes > 0) {
      try {
        assertMaxBytes(
          "total tool result bytes",
          totalToolResultBytes,
          maxToolResultBytes,
        );
      } catch (error) {
        config.onTrace?.({
          type: "resource_limit",
          kind: "tool_result_bytes",
          limit: maxToolResultBytes,
          used: totalToolResultBytes,
        });
        emitMetric(config, "resource_limit", {
          kind: "tool_result_bytes",
          limit: maxToolResultBytes,
          used: totalToolResultBytes,
        });
        throw error;
      }
    }
  };

  const toolUses: ToolUse[] = [];
  let groundingRetries = 0;
  const maxGroundingRetries = groundingMode === "strict" ? 1 : 0;
  const autoWebEnabled = config.autoWeb ?? false;
  const autoWebAnswer = autoWebEnabled &&
    shouldAutoAnswerWebRequest(userRequest);
  const autoWebResearch = autoWebEnabled &&
    shouldAutoResearchWebRequest(userRequest);
  const requestUrl = extractUrlFromText(userRequest);
  const requestHost = requestUrl ? getHost(requestUrl) : "";
  const webConfig = autoWebEnabled ? await loadWebConfig() : null;
  const searchApiAvailable = webConfig ? hasSearchApiKey(webConfig.search) : false;
  let autoWebAttempted = false;
  let autoWebSucceeded = false;
  let autoWebFailure: string | null = null;
  const noInputEnabled = config.noInput ?? false;
  let noInputRetries = 0;
  const maxNoInputRetries = 1;
  const requireToolCalls = config.requireToolCalls ?? false;
  let toolCallRetries = 0;
  const maxToolCallRetries = config.maxToolCallRetries ?? 1;
  let toolFormatRetries = 0;
  const maxRepeatToolCalls = config.maxToolCallRepeat ?? 3;
  let lastToolSignature = "";
  let repeatToolCount = 0;

  const recordAutoWebResult = (
    toolCall: ToolCall,
    toolResult: ToolExecutionResult,
  ): void => {
    const { observation, resultText } = buildToolObservation(toolCall, toolResult);
    addContextMessage(config, { role: "tool", content: observation });
    toolUses.push({
      toolName: toolCall.toolName,
      result: resultText ?? "",
    });
    updateToolResultBytes(encoder.encode(resultText ?? "").length);
  };

  if (autoWebEnabled) {
    const autoCall = chooseAutoWebTool(userRequest);
    if (autoCall) {
      autoWebAttempted = true;
      const autoResult = await executeToolCall(autoCall, config);
      recordAutoWebResult(autoCall, autoResult);

      let fallbackCall: ToolCall | null = null;
      let fallbackResult: ToolExecutionResult | null = null;
      let localCall: ToolCall | null = null;
      let localResult: ToolExecutionResult | null = null;

      if (autoResult.success) {
        autoWebSucceeded = true;
      } else {
        fallbackCall = chooseAutoWebFallback(
          autoCall.toolName,
          userRequest,
        );
        if (fallbackCall) {
          fallbackResult = await executeToolCall(fallbackCall, config);
          recordAutoWebResult(fallbackCall, fallbackResult);
          if (fallbackResult.success) {
            autoWebSucceeded = true;
          }
        }

        if (!autoWebSucceeded && !searchApiAvailable) {
          localCall = buildLocalSearchToolCall(userRequest);
          if (localCall) {
            localResult = await executeToolCall(localCall, config);
            recordAutoWebResult(localCall, localResult);
            if (localResult.success) {
              autoWebSucceeded = true;
            }
          }
        }
      }

      if (autoWebAnswer) {
        const baseResult = autoResult.success
          ? autoResult.result
          : fallbackResult?.success
          ? fallbackResult.result
          : localResult?.success
          ? localResult.result
          : null;
        let drilldownResults: Array<{ call: ToolCall; result: ToolExecutionResult }> = [];
        if (baseResult && !hasMeaningfulText(baseResult, requestHost)) {
          drilldownResults = await runAutoWebDrilldown(
            userRequest,
            baseResult,
            config,
            recordAutoWebResult,
          );
        }

        const resolved = pickBestAutoWebResult(
          autoResult.success ? { call: autoCall, result: autoResult } : null,
          fallbackResult?.success && fallbackCall
            ? { call: fallbackCall, result: fallbackResult }
            : null,
          localResult?.success && localCall
            ? { call: localCall, result: localResult }
            : null,
          drilldownResults,
          requestHost,
        );

        if (resolved) {
          if (
            isSearchToolName(resolved.call.toolName) &&
            isEmptySearchResult(resolved.result.result)
          ) {
            return buildEmptySearchWarning(resolved.call.toolName);
          }
          return resolved.result.returnDisplay ??
            stringifyToolResult(resolved.result.result);
        }

        autoWebFailure = formatAutoWebFailure(
          autoCall.toolName,
          autoResult.error,
          fallbackCall?.toolName,
          fallbackResult?.error,
        );
        if (localCall && localResult && !localResult.success) {
          autoWebFailure +=
            `\nFallback failed (${localCall.toolName}): ${localResult.error}`;
        }
        return autoWebFailure;
      }

      const baseResult = autoResult.success
        ? autoResult.result
        : fallbackResult?.success
        ? fallbackResult.result
        : localResult?.success
        ? localResult.result
        : null;
      if (baseResult && !hasMeaningfulText(baseResult, requestHost)) {
        const drilldownResults = await runAutoWebDrilldown(
          userRequest,
          baseResult,
          config,
          recordAutoWebResult,
        );
        if (drilldownResults.some((entry) => entry.result.success)) {
          autoWebSucceeded = true;
        }
      }

      if (!autoWebSucceeded) {
        autoWebFailure = formatAutoWebFailure(
          autoCall.toolName,
          autoResult.error,
          fallbackCall?.toolName,
          fallbackResult?.error,
        );
        if (localCall && localResult && !localResult.success) {
          autoWebFailure +=
            `\nFallback failed (${localCall.toolName}): ${localResult.error}`;
        }
      }
    }

    if (!autoCall && autoWebResearch) {
      autoWebAttempted = true;
      let localCall: ToolCall | null = null;
      let localResult: ToolExecutionResult | null = null;

      if (!searchApiAvailable) {
        localCall = buildLocalSearchToolCall(userRequest);
        if (localCall) {
          localResult = await executeToolCall(localCall, config);
          recordAutoWebResult(localCall, localResult);
          if (localResult.success) {
            autoWebSucceeded = true;
          }
          if (autoWebAnswer && localResult.success) {
            if (
              isSearchToolName(localCall.toolName) &&
              isEmptySearchResult(localResult.result)
            ) {
              return buildEmptySearchWarning(localCall.toolName);
            }
            return localResult.returnDisplay ??
              stringifyToolResult(localResult.result);
          }
        }
      }

      let researchCall: ToolCall | null = null;
      let researchResult: ToolExecutionResult | null = null;
      if ((!localResult?.success) && hasTool("research_web")) {
        researchCall = {
          toolName: "research_web",
          args: {
            query: userRequest,
            maxSources: 3,
          },
        };
        researchResult = await executeToolCall(researchCall, config);
        recordAutoWebResult(researchCall, researchResult);
        if (researchResult.success) {
          autoWebSucceeded = true;
        }
        if (autoWebAnswer && researchResult.success) {
          if (
            isSearchToolName(researchCall.toolName) &&
            isEmptySearchResult(researchResult.result)
          ) {
            return buildEmptySearchWarning(researchCall.toolName);
          }
          return researchResult.returnDisplay ??
            stringifyToolResult(researchResult.result);
        }
      }

      if (!autoWebSucceeded) {
        if (researchCall && researchResult) {
          autoWebFailure = formatAutoWebFailure(
            researchCall.toolName,
            researchResult.error,
            localCall?.toolName,
            localResult?.error,
          );
        } else if (localCall && localResult) {
          autoWebFailure = formatAutoWebFailure(
            localCall.toolName,
            localResult.error,
          );
        }
      }
    }

    if (!autoWebAnswer && autoWebAttempted && !autoWebSucceeded && autoWebFailure) {
      return autoWebFailure;
    }
  }

  // Planning (optional)
  const planningConfig: PlanningConfig = config.planning ?? { mode: "off" };
  let planState: PlanState | null = null;
  if (
    planningConfig.mode !== "off" &&
    shouldPlanRequest(userRequest, planningConfig.mode ?? "off")
  ) {
    try {
      const agentNames = listAgentProfiles().map((agent) => agent.name);
      const plan = await requestPlan(
        llmFunction,
        config.context.getMessages(),
        userRequest,
        planningConfig,
        agentNames,
      );
      if (plan) {
        addContextMessage(config, {
          role: "system",
          content: formatPlanForContext(plan, planningConfig),
        });
        const trackPlan = (planningConfig.mode ?? "off") === "always";
        if (trackPlan) {
          planState = createPlanState(plan);
        }
        config.onTrace?.({ type: "plan_created", plan });
      }
    } catch (error) {
      log.warn(`Planning skipped: ${getErrorMessage(error)}`);
    }
  }

  while (iterations < maxIterations) {
    iterations++;

    // Emit trace event: iteration
    config.onTrace?.({
      type: "iteration",
      current: iterations,
      max: maxIterations,
    });

    if (planState) {
      const currentStep = planState.plan.steps[planState.currentIndex];
      if (
        currentStep?.agent &&
        !planState.delegatedIds.includes(currentStep.id) &&
        config.delegate
      ) {
        const profile = getAgentProfile(currentStep.agent);
        if (profile) {
          const delegateArgs: Record<string, unknown> = {
            agent: profile.name,
            task: currentStep.goal ?? currentStep.title,
          };
          if (typeof config.maxToolCalls === "number") {
            delegateArgs.maxToolCalls = config.maxToolCalls;
          }
          if (config.groundingMode) {
            delegateArgs.groundingMode = config.groundingMode;
          }
          const delegateCall: ToolCall = {
            toolName: "delegate_agent",
            args: delegateArgs,
          };
          const delegateResult = await executeToolCall(delegateCall, config);
          recordAutoWebResult(delegateCall, delegateResult);
          planState.delegatedIds.push(currentStep.id);
          // Give the main LLM a chance to synthesize and mark STEP_DONE.
          continue;
        }
      }
    }

    // Call LLM to get agent response (with retry)
    const messages = config.context.getMessages();

    // Emit trace event: LLM call
    config.onTrace?.({
      type: "llm_call",
      messageCount: messages.length,
    });
    emitMetric(config, "llm_call", {
      messageCount: messages.length,
    });

    if (llmLimiter) {
      const status = llmLimiter.consume(1);
      if (!status.allowed) {
        config.onTrace?.({
          type: "rate_limit",
          target: "llm",
          maxCalls: status.maxCalls,
          windowMs: status.windowMs,
          used: status.used,
          remaining: status.remaining,
          resetMs: status.resetMs,
        });
        emitMetric(config, "rate_limit", {
          target: "llm",
          maxCalls: status.maxCalls,
          windowMs: status.windowMs,
          used: status.used,
          remaining: status.remaining,
          resetMs: status.resetMs,
        });
        throw new RateLimitError(
          `LLM rate limit exceeded (${status.used}/${status.maxCalls} per ${status.windowMs}ms)`,
          status.maxCalls,
          status.windowMs,
        );
      }
    }

    const llmStart = Date.now();
    const agentResponse = await callLLMWithRetry(
      llmFunction,
      messages,
      { timeout: llmTimeout, maxRetries },
      config.onTrace,
    );
    const llmDuration = Date.now() - llmStart;

    // Record token usage (estimated by default)
    const responseText = agentResponse.content ?? "";
    const usage = estimateUsage(messages, responseText);
    usageTracker.record(usage);
    config.onTrace?.({
      type: "llm_usage",
      usage,
    });
    emitMetric(config, "llm_usage", { ...usage });

    // Emit trace event: LLM response
    config.onTrace?.({
      type: "llm_response",
      length: responseText.length,
      truncated: responseText.substring(0, 200),
      content: responseText,
      toolCalls: agentResponse.toolCalls?.length ?? 0,
    });
    emitMetric(config, "llm_response", {
      length: responseText.length,
      durationMs: llmDuration,
    });

    if (
      (agentResponse.toolCalls?.length ?? 0) === 0 &&
      looksLikeToolCallJson(responseText)
    ) {
      if (toolFormatRetries < maxToolCallRetries) {
        toolFormatRetries++;
        addContextMessage(config, {
          role: "tool",
          content:
            "Native tool calling required. Do not output tool call JSON in text. Retry using structured tool calls.",
        });
        continue;
      }
      throw new ValidationError(
        "Model returned tool call JSON instead of native tool calls.",
        "tool_call_format",
      );
    }

    // Process response and execute tools
    const result = await processAgentResponse(agentResponse, config);

    // If no tool calls, agent is done
    if (!result.shouldContinue) {
      if (
        requireToolCalls &&
        result.toolCallsMade === 0 &&
        toolUses.length === 0
      ) {
        toolCallRetries += 1;
        if (toolCallRetries > maxToolCallRetries) {
          return "Tool call required but none provided. Task incomplete.";
        }
        addContextMessage(config, {
          role: "tool",
          content: buildToolRequiredMessage(config.toolAllowlist),
        });
        continue;
      }

      let finalResponse = result.finalResponse ?? responseText;

      if (planState) {
        const stepDoneId = extractStepDoneId(responseText);
        const requireMarkers = planningConfig.requireStepMarkers ?? false;
        if (requireMarkers && !stepDoneId) {
          const currentStep = planState.plan.steps[planState.currentIndex];
          const id = currentStep?.id ?? "unknown";
          addContextMessage(config, {
            role: "tool",
            content:
              `Plan tracking required. End your response with STEP_DONE ${id} when the step is complete.`,
          });
          continue;
        }

        finalResponse = stripStepMarkers(responseText);

        const advance = advancePlanState(planState, stepDoneId);
        planState = advance.state;
        const completedIndex = planState.currentIndex - 1;
        const completedStep = planState.plan.steps[completedIndex];
        if (completedStep) {
          config.onTrace?.({
            type: "plan_step",
            stepId: completedStep.id,
            index: completedIndex,
            completed: true,
          });
        }

        if (!advance.finished && advance.nextStep) {
          addContextMessage(config, {
            role: "tool",
            content:
              `Plan step completed. Next step: [${advance.nextStep.id}] ${advance.nextStep.title}. Continue.`,
          });
          continue;
        }
      }

      if (
        noInputEnabled &&
        noInputRetries < maxNoInputRetries &&
        responseAsksQuestion(finalResponse)
      ) {
        noInputRetries++;
        addContextMessage(config, {
          role: "tool",
          content:
            "No-input mode: Do not ask questions. Provide a best-effort answer based on available tool results and reasonable assumptions.",
        });
        continue;
      }

      if (groundingMode !== "off" && toolUses.length > 0) {
        const grounding = checkGrounding(finalResponse, toolUses);
        config.onTrace?.({
          type: "grounding_check",
          mode: groundingMode,
          grounded: grounding.grounded,
          warnings: grounding.warnings,
          retry: groundingRetries,
          maxRetry: maxGroundingRetries,
        });
        emitMetric(config, "grounding_check", {
          mode: groundingMode,
          grounded: grounding.grounded,
          warnings: grounding.warnings,
          retry: groundingRetries,
          maxRetry: maxGroundingRetries,
        });

        if (!grounding.grounded) {
          if (groundingMode === "strict") {
            if (groundingRetries < maxGroundingRetries) {
              groundingRetries++;
              const warningText = `Grounding required. Revise your answer to cite tool results using tool names or "Based on ...".\n- ${
                grounding.warnings.join("\n- ")
              }`;
              addContextMessage(config, { role: "tool", content: warningText });
              continue;
            }
            throw new ValidationError(
              `Ungrounded response after ${groundingRetries} retry: ${grounding.warnings.join(" ")}`,
              "grounding",
            );
          }
          const warningText = `\n\n[Grounding warnings]\n- ${
            grounding.warnings.join("\n- ")
          }`;
          return `${finalResponse}${warningText}`;
        }
      }
      return finalResponse;
    }

    // Check for denied tool calls - per-tool tracking (Issue #6)
    let anyDeniedThisTurn = false;

    for (let i = 0; i < result.results.length; i++) {
      const toolName = result.toolCalls[i].toolName;
      const toolResult = result.results[i];

      if (!toolResult.success && toolResult.error?.includes("denied")) {
        anyDeniedThisTurn = true;
        const currentCount = denialCountByTool.get(toolName) || 0;
        denialCountByTool.set(toolName, currentCount + 1);

        // Check if this specific tool reached the limit
        if (denialCountByTool.get(toolName)! >= maxDenials) {
          addContextMessage(config, {
            role: "tool",
            content: `Maximum denials (${maxDenials}) reached for tool '${toolName}'. Consider using ask_user tool to clarify requirements or try a different approach.`,
          });
        }
      }
    }

    if (!anyDeniedThisTurn) {
      // Reset ALL denial counts if no denials this turn (matches old behavior)
      // This allows agent to recover after using non-denied tools
      denialCountByTool.clear();
    }

    // Check if ALL tools in this turn were denied AND at max denials
    const allToolsBlocked = result.toolCalls.every((call) => {
      const count = denialCountByTool.get(call.toolName) || 0;
      return count >= maxDenials;
    });

    if (anyDeniedThisTurn && allToolsBlocked && result.toolCalls.length > 0) {
      // Agent is stuck - all attempted tools are blocked
      // Give one final chance to use ask_user or different tool
      const finalResponse = await llmFunction(config.context.getMessages());
      return finalResponse.content ?? "";
    }

    if (!anyDeniedThisTurn && result.toolCallsMade > 0) {
      const signature = buildToolSignature(result.toolCalls);
      if (signature && signature === lastToolSignature) {
        repeatToolCount += 1;
      } else {
        repeatToolCount = 1;
        lastToolSignature = signature;
      }

      if (repeatToolCount >= maxRepeatToolCalls) {
        config.onTrace?.({
          type: "loop_detected",
          signature,
          count: repeatToolCount,
        });
        return [
          "Tool call loop detected.",
          "The same tool calls were repeated multiple times without progress.",
          "Please clarify the request or provide additional guidance.",
        ].join("\n");
      }
    } else {
      lastToolSignature = "";
      repeatToolCount = 0;
    }

    // Track tool uses for grounding checks
    if (result.toolUses.length > 0) {
      toolUses.push(...result.toolUses);
      if (result.toolBytes > 0) {
        updateToolResultBytes(result.toolBytes);
      }
    }
    if (result.toolCallsMade > 0) {
      groundingRetries = 0;
    }

    // If any tool failed, agent might want to retry or give up
    const anyFailed = result.results.some((r) => !r.success);
    if (anyFailed && iterations >= maxIterations / 2) {
      // Stop early if tools keep failing
      return responseText;
    }
  }

  // Hit max iterations
  return "Maximum iterations reached. Task incomplete.";
}
