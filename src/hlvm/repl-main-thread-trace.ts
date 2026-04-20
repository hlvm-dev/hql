import { appendJsonLine } from "../common/jsonl.ts";
import { getReplMainThreadTracePath } from "../common/paths.ts";
import { getPlatform } from "../platform/platform.ts";
import type { TraceEvent } from "./agent/orchestrator.ts";
import { REPL_MAIN_THREAD_QUERY_SOURCE } from "./agent/query-tool-routing.ts";

function truncateText(value: string, max = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}

export function buildTraceTextPreview(
  value: string | null | undefined,
  max = 160,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const preview = truncateText(value, max);
  return preview.length > 0 ? preview : undefined;
}

export function isReplMainThreadTraceEnabled(
  querySource: string | null | undefined,
): boolean {
  return querySource === REPL_MAIN_THREAD_QUERY_SOURCE;
}

export function traceReplMainThread(
  stage: string,
  data: Record<string, unknown> = {},
): void {
  try {
    void appendJsonLine(getReplMainThreadTracePath(), {
      ts: new Date().toISOString(),
      pid: getPlatform().process.pid(),
      stage,
      ...data,
    }).catch(() => {});
  } catch {
    // Best-effort tracing only.
  }
}

export function traceReplMainThreadForSource(
  querySource: string | null | undefined,
  stage: string,
  data: Record<string, unknown> = {},
): void {
  if (!isReplMainThreadTraceEnabled(querySource)) return;
  traceReplMainThread(stage, data);
}

export function summarizeTraceEvent(
  event: TraceEvent,
): Record<string, unknown> {
  switch (event.type) {
    case "llm_call":
      return { type: event.type, messageCount: event.messageCount };
    case "llm_retry":
      return {
        type: event.type,
        attempt: event.attempt,
        max: event.max,
        class: event.class,
        retryable: event.retryable,
        error: event.error,
      };
    case "llm_usage":
      return {
        type: event.type,
        promptTokens: event.usage.promptTokens,
        completionTokens: event.usage.completionTokens,
        totalTokens: event.usage.totalTokens,
      };
    case "llm_performance":
      return { ...event };
    case "playwright_trace":
      return { ...event };
    case "prompt_compiled":
      return {
        type: event.type,
        mode: event.mode,
        capability: event.capability,
        querySource: event.querySource,
        signatureHash: event.signatureHash,
        sectionCount: event.sections.length,
        cacheSegmentCount: event.cacheSegments.length,
        stableSegmentCount: event.stableCacheProfile.stableSegmentCount,
      };
    case "context_pressure":
      return {
        type: event.type,
        level: event.level,
        percent: event.percent,
        estimatedTokens: event.estimatedTokens,
        maxTokens: event.maxTokens,
      };
    case "context_compaction":
      return { ...event };
    case "context_overflow_retry":
      return { ...event };
    case "llm_response":
      return {
        type: event.type,
        length: event.length,
        toolCalls: event.toolCalls,
        truncated: buildTraceTextPreview(event.truncated, 120),
      };
    case "thinking_profile":
      return {
        type: event.type,
        iteration: event.iteration,
        phase: event.phase,
        recentToolCalls: event.recentToolCalls,
        consecutiveFailures: event.consecutiveFailures,
        remainingContextBudget: event.remainingContextBudget,
        anthropicBudgetTokens: event.anthropicBudgetTokens,
        openaiReasoningEffort: event.openaiReasoningEffort,
        googleThinkingLevel: event.googleThinkingLevel,
      };
    case "auto_select":
      return { type: event.type, model: event.model, fallbacks: event.fallbacks, reason: event.reason };
    case "eval_log":
      return { type: event.type, detail: buildTraceTextPreview(event.detail, 120) };
    case "agent_downgrade":
      return { type: event.type, detail: buildTraceTextPreview(event.detail, 120) };
    case "auto_fallback":
      return { type: event.type, from: event.fromModel, to: event.toModel, reason: event.reason };
    default:
      return { type: event.type };
  }
}
