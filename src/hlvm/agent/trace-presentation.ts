import { truncate } from "../../common/utils.ts";
import type { TraceEvent } from "./orchestrator.ts";

export type TracePresentationTone = "muted" | "active" | "warning" | "error";

export interface TracePresentationLine {
  depth: number;
  text: string;
  tone: TracePresentationTone;
}

function previewText(
  value: string | null | undefined,
  max = 96,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? truncate(normalized, max) : undefined;
}

function previewValue(value: unknown, max = 96): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return previewText(value, max);
  if (
    typeof value === "number" || typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  try {
    return previewText(JSON.stringify(value), max);
  } catch {
    return undefined;
  }
}

function formatDuration(ms: number | undefined): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
    return undefined;
  }
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}

function formatCompactCount(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function withParts(...parts: Array<string | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim()))
    .join(" · ");
}

function makeLine(
  depth: number,
  text: string,
  tone: TracePresentationTone = "muted",
): TracePresentationLine {
  return { depth, text, tone };
}

export function presentTraceEvent(
  event: TraceEvent,
): TracePresentationLine[] {
  switch (event.type) {
    case "iteration":
      return [makeLine(0, `Iteration ${event.current}/${event.max}`, "active")];
    case "prompt_compiled":
      return [
        makeLine(
          1,
          withParts(
            `Prompt compiled`,
            `${event.mode}/${event.tier}`,
            `${event.sections.length} sections`,
            `${event.cacheSegments.length} cache segments`,
          ),
          "muted",
        ),
      ];
    case "routing_decision":
      return [
        makeLine(
          1,
          withParts(
            `Routing -> ${event.selectedModel}`,
            event.modelSource,
            `eager ${event.eagerToolCount}`,
            event.deferredToolCount > 0
              ? `deferred ${event.deferredToolCount}`
              : undefined,
            event.deniedToolCount > 0
              ? `denied ${event.deniedToolCount}`
              : undefined,
            event.discovery !== "none" ? event.discovery : undefined,
          ),
          "active",
        ),
      ];
    case "auto_select":
      return [
        makeLine(
          1,
          withParts(
            `Auto-selected ${event.model}`,
            previewText(event.reason, 80),
            event.fallbacks.length > 0
              ? `${event.fallbacks.length} fallbacks ready`
              : undefined,
          ),
          "active",
        ),
      ];
    case "auto_fallback":
      return [
        makeLine(
          1,
          withParts(
            `Fallback ${event.fromModel} -> ${event.toModel}`,
            previewText(event.reason, 80),
          ),
          "warning",
        ),
      ];
    case "llm_call":
      return [
        makeLine(
          1,
          `LLM call${
            event.messageCount > 0 ? ` (${event.messageCount} messages)` : ""
          }`,
          "active",
        ),
      ];
    case "thinking_profile":
      return [
        makeLine(
          2,
          withParts(
            `Thinking profile`,
            `phase=${event.phase}`,
            `tools=${event.recentToolCalls}`,
            `failures=${event.consecutiveFailures}`,
            `budget=${formatCompactCount(event.remainingContextBudget)}`,
          ),
          "muted",
        ),
      ];
    case "llm_response":
      return [
        makeLine(
          2,
          withParts(
            `LLM response`,
            event.toolCalls ? `${event.toolCalls} tool calls` : undefined,
            `${event.length} chars`,
            previewText(event.truncated, 84),
          ),
          "muted",
        ),
      ];
    case "tool_call":
      return [
        makeLine(
          2,
          withParts(
            `Tool ${event.toolName}`,
            previewValue(event.args, 84),
          ),
          "active",
        ),
      ];
    case "tool_result":
      return [
        makeLine(
          3,
          withParts(
            event.success ? `${event.toolName} ok` : `${event.toolName} failed`,
            previewText(event.display, 96) ?? previewValue(event.result, 96) ??
              previewText(event.error, 96),
          ),
          event.success ? "muted" : "error",
        ),
      ];
    case "llm_retry":
      return [
        makeLine(
          2,
          withParts(
            `LLM retry ${event.attempt}/${event.max}`,
            event.class,
            event.retryable ? undefined : "non-retryable",
            previewText(event.error, 84),
          ),
          event.retryable ? "warning" : "error",
        ),
      ];
    case "grounding_check":
      return [
        makeLine(
          1,
          withParts(
            `Grounding ${event.grounded ? "ok" : "warning"}`,
            event.mode,
            `${event.retry}/${event.maxRetry}`,
            event.warnings[0] ? previewText(event.warnings[0], 72) : undefined,
          ),
          event.grounded ? "muted" : "warning",
        ),
      ];
    case "rate_limit":
      return [
        makeLine(
          1,
          withParts(
            `Rate limit ${event.target}`,
            `${event.used}/${event.maxCalls}`,
            `reset ${formatDuration(event.resetMs)}`,
          ),
          "warning",
        ),
      ];
    case "resource_limit":
      return [
        makeLine(
          1,
          `Resource limit ${event.kind} (${event.used}/${event.limit})`,
          "warning",
        ),
      ];
    case "llm_usage":
      return [
        makeLine(
          2,
          withParts(
            `Usage`,
            formatCompactCount(event.usage.totalTokens)
              ? `${formatCompactCount(event.usage.totalTokens)} tokens`
              : undefined,
            event.usage.source,
          ),
          "muted",
        ),
      ];
    case "llm_performance":
      return [
        makeLine(
          2,
          withParts(
            `Performance ${event.providerName}/${event.modelId}`,
            `latency ${formatDuration(event.latencyMs)}`,
            event.firstTokenLatencyMs !== undefined
              ? `first token ${formatDuration(event.firstTokenLatencyMs)}`
              : undefined,
            event.inputTokens !== undefined || event.outputTokens !== undefined
              ? `tokens ${formatCompactCount(event.inputTokens) ?? "0"}/${
                formatCompactCount(event.outputTokens) ?? "0"
              }`
              : undefined,
          ),
          "muted",
        ),
      ];
    case "plan_created": {
      const planLines = event.plan.steps.slice(0, 6).map((step, index) =>
        makeLine(2, `${index + 1}. ${truncate(step.title, 88)}`, "muted")
      );
      if (event.plan.steps.length > 6) {
        planLines.push(
          makeLine(
            2,
            `... ${event.plan.steps.length - 6} more steps`,
            "muted",
          ),
        );
      }
      return [
        makeLine(
          1,
          withParts(
            `Plan created`,
            `${event.plan.steps.length} steps`,
            previewText(event.plan.goal, 72),
          ),
          "active",
        ),
        ...planLines,
      ];
    }
    case "plan_step":
      return [
        makeLine(
          1,
          `Plan step ${event.index + 1} complete${
            event.completed ? "" : " (pending)"
          }`,
          "active",
        ),
      ];
    case "context_overflow":
      return [
        makeLine(
          1,
          `Context overflow (${formatCompactCount(event.estimatedTokens)}/${
            formatCompactCount(event.maxTokens)
          } tokens)`,
          "warning",
        ),
      ];
    case "context_pressure":
      if (event.level === "normal") return [];
      return [
        makeLine(
          1,
          withParts(
            `Context pressure ${event.level}`,
            `${event.percent}%`,
            `${formatCompactCount(event.estimatedTokens)}/${
              formatCompactCount(event.maxTokens)
            } tokens`,
          ),
          "warning",
        ),
      ];
    case "loop_detected":
      return [
        makeLine(
          1,
          `Loop detected (${event.count} repeats)`,
          "warning",
        ),
      ];
    case "playwright_trace":
      return [
        makeLine(
          2,
          withParts(
            `Playwright trace ${event.status}`,
            previewText(event.reason, 72),
            previewText(event.path, 72),
          ),
          "muted",
        ),
      ];
    case "context_overflow_retry":
      return [
        makeLine(
          1,
          withParts(
            `Context retry`,
            `budget ${formatCompactCount(event.newBudget)}`,
            `attempt ${event.overflowRetryCount}`,
            event.reason,
          ),
          "warning",
        ),
      ];
    case "context_compaction":
      return [
        makeLine(
          1,
          withParts(
            `Context compacted`,
            `${formatCompactCount(event.estimatedTokensBefore)} -> ${
              formatCompactCount(event.estimatedTokensAfter)
            }`,
            event.reason,
          ),
          "warning",
        ),
      ];
    case "context_compaction_failed":
      return [
        makeLine(
          1,
          withParts(
            `Context compaction failed`,
            event.reason,
            previewText(event.error, 80),
          ),
          "error",
        ),
      ];
    case "response_continuation":
      return [
        makeLine(
          1,
          withParts(
            `Continuation ${event.status}`,
            `count ${event.continuationCount}`,
            event.reason,
          ),
          event.status === "completed" ? "muted" : "active",
        ),
      ];
    case "mcp_progress":
      return event.message
        ? [
          makeLine(
            3,
            withParts(`MCP`, previewText(event.message, 84)),
            "muted",
          ),
        ]
        : [];
    case "llm_error":
      return [
        makeLine(
          2,
          withParts(
            `LLM error`,
            event.class,
            event.retryable ? "retryable" : "fatal",
            previewText(event.error, 84),
          ),
          "error",
        ),
      ];
    case "transient_retry":
      return [
        makeLine(
          1,
          withParts(
            `Transient retry ${event.attempt}`,
            previewText(event.error, 84),
          ),
          "warning",
        ),
      ];
  }
}

export function formatTraceLineForTerminal(
  line: TracePresentationLine,
): string {
  const indent = "  ".repeat(Math.max(0, line.depth));
  const marker = line.depth > 0 ? "- " : "";
  return `${indent}${marker}${line.text}`;
}
