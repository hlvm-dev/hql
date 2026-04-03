import type { TraceEvent } from "./orchestrator.ts";

export type PromptCacheProfilingScenarioName =
  | "cold_baseline"
  | "warm_stable_repeat"
  | "turn_only_change"
  | "session_stable_change";

export interface PromptCacheProfilingScenarioRun {
  scenario: PromptCacheProfilingScenarioName;
  title: string;
  responsePreview: string;
  querySource: string | null;
  promptSignatureHash: string | null;
  stableCacheSignatureHash: string | null;
  stableSegmentCount: number | null;
  providerName: string | null;
  modelId: string | null;
  toolSchemaSignature: string | null;
  eagerToolCount: number | null;
  discoveredDeferredToolCount: number | null;
  latencyMs: number | null;
  firstTokenLatencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
}

export interface PromptCacheProfilingComparisons {
  warmStableMatchesCold: boolean | null;
  turnOnlyMatchesWarmStable: boolean | null;
  sessionChangeDiffersFromWarmStable: boolean | null;
}

export interface PromptCacheProfilingReport {
  generatedAt: string;
  providerName: string | null;
  modelId: string | null;
  runs: PromptCacheProfilingScenarioRun[];
  comparisons: PromptCacheProfilingComparisons;
}

function lastTraceOfType<TType extends TraceEvent["type"]>(
  traces: readonly TraceEvent[],
  type: TType,
): Extract<TraceEvent, { type: TType }> | null {
  for (let index = traces.length - 1; index >= 0; index--) {
    const event = traces[index];
    if (event.type === type) {
      return event as Extract<TraceEvent, { type: TType }>;
    }
  }
  return null;
}

function truncatePreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 160) return normalized;
  return `${normalized.slice(0, 157)}...`;
}

export function summarizePromptCacheProfilingRun(input: {
  scenario: PromptCacheProfilingScenarioName;
  title: string;
  traces: readonly TraceEvent[];
  responseText: string;
}): PromptCacheProfilingScenarioRun {
  const compiled = lastTraceOfType(input.traces, "prompt_compiled");
  const performance = lastTraceOfType(input.traces, "llm_performance");

  return {
    scenario: input.scenario,
    title: input.title,
    responsePreview: truncatePreview(input.responseText),
    querySource: performance?.querySource ?? compiled?.querySource ?? null,
    promptSignatureHash: compiled?.signatureHash ?? performance?.promptSignatureHash ?? null,
    stableCacheSignatureHash: performance?.stableCacheSignatureHash ??
      compiled?.stableCacheProfile.stableSignatureHash ?? null,
    stableSegmentCount: performance?.stableSegmentCount ??
      compiled?.stableCacheProfile.stableSegmentCount ?? null,
    providerName: performance?.providerName ?? null,
    modelId: performance?.modelId ?? null,
    toolSchemaSignature: performance?.toolSchemaSignature ?? null,
    eagerToolCount: performance?.eagerToolCount ?? null,
    discoveredDeferredToolCount: performance?.discoveredDeferredToolCount ?? null,
    latencyMs: performance?.latencyMs ?? null,
    firstTokenLatencyMs: performance?.firstTokenLatencyMs ?? null,
    inputTokens: performance?.inputTokens ?? null,
    outputTokens: performance?.outputTokens ?? null,
    cacheReadInputTokens: performance?.cacheReadInputTokens ?? null,
    cacheCreationInputTokens: performance?.cacheCreationInputTokens ?? null,
  };
}

function compareStableSignatures(
  left: PromptCacheProfilingScenarioRun | undefined,
  right: PromptCacheProfilingScenarioRun | undefined,
  mode: "same" | "different",
): boolean | null {
  if (!left?.stableCacheSignatureHash || !right?.stableCacheSignatureHash) {
    return null;
  }
  return mode === "same"
    ? left.stableCacheSignatureHash === right.stableCacheSignatureHash
    : left.stableCacheSignatureHash !== right.stableCacheSignatureHash;
}

export function buildPromptCacheProfilingReport(
  runs: readonly PromptCacheProfilingScenarioRun[],
  generatedAt: string,
): PromptCacheProfilingReport {
  const byScenario = new Map(runs.map((run) => [run.scenario, run]));
  const first = runs[0];
  return {
    generatedAt,
    providerName: first?.providerName ?? null,
    modelId: first?.modelId ?? null,
    runs: [...runs],
    comparisons: {
      warmStableMatchesCold: compareStableSignatures(
        byScenario.get("cold_baseline"),
        byScenario.get("warm_stable_repeat"),
        "same",
      ),
      turnOnlyMatchesWarmStable: compareStableSignatures(
        byScenario.get("warm_stable_repeat"),
        byScenario.get("turn_only_change"),
        "same",
      ),
      sessionChangeDiffersFromWarmStable: compareStableSignatures(
        byScenario.get("warm_stable_repeat"),
        byScenario.get("session_stable_change"),
        "different",
      ),
    },
  };
}

function formatMetric(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function formatComparison(value: boolean | null): string {
  if (value === null) return "n/a";
  return value ? "yes" : "no";
}

export function renderPromptCacheProfilingMarkdown(
  report: PromptCacheProfilingReport,
): string {
  const lines = [
    "# Prompt Cache Profiling Evidence",
    "",
    `Generated: ${report.generatedAt}`,
    report.modelId ? `Model: ${report.modelId}` : "Model: n/a",
    report.providerName ? `Provider: ${report.providerName}` : "Provider: n/a",
    "",
    "## Scenario Results",
    "",
    "| Scenario | Stable Cache Signature | Stable Segments | Latency (ms) | First Token (ms) | Input Tokens | Output Tokens | Cache Read Input Tokens | Cache Creation Input Tokens |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.runs.map((run) =>
      `| ${run.title} | ${run.stableCacheSignatureHash ?? "n/a"} | ${
        formatMetric(run.stableSegmentCount)
      } | ${formatMetric(run.latencyMs)} | ${
        formatMetric(run.firstTokenLatencyMs)
      } | ${formatMetric(run.inputTokens)} | ${formatMetric(run.outputTokens)} | ${
        formatMetric(run.cacheReadInputTokens)
      } | ${formatMetric(run.cacheCreationInputTokens)} |`
    ),
    "",
    "## Cache Signature Checks",
    "",
    `- Warm stable repeat reuses cold stable signature: ${formatComparison(report.comparisons.warmStableMatchesCold)}`,
    `- Turn-only change preserves warm stable signature: ${formatComparison(report.comparisons.turnOnlyMatchesWarmStable)}`,
    `- Session-stable change churns warm stable signature: ${formatComparison(report.comparisons.sessionChangeDiffersFromWarmStable)}`,
    "",
    "## Response Previews",
    "",
    ...report.runs.map((run) => `- ${run.title}: ${run.responsePreview || "(empty response)"}`),
    "",
  ];
  return lines.join("\n");
}
