import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  buildPromptCacheProfilingReport,
  renderPromptCacheProfilingMarkdown,
  summarizePromptCacheProfilingRun,
} from "../../../src/hlvm/agent/prompt-cache-profiling.ts";
import type { TraceEvent } from "../../../src/hlvm/agent/orchestrator.ts";

function makeTraces(input: {
  promptSignatureHash: string;
  stableCacheSignatureHash: string;
  latencyMs: number;
  firstTokenLatencyMs?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}): TraceEvent[] {
  return [
    {
      type: "prompt_compiled",
      mode: "agent",
      tier: "enhanced",
      sections: [],
      cacheSegments: [],
      stableCacheProfile: {
        stableSegmentCount: 2,
        stableSegmentHashes: ["s1", "s2"],
        stableSignatureHash: input.stableCacheSignatureHash,
      },
      signatureHash: input.promptSignatureHash,
    },
    {
      type: "llm_performance",
      providerName: "claude-code",
      modelId: "claude-code/claude-haiku-4-5-20251001",
      latencyMs: input.latencyMs,
      ...(input.firstTokenLatencyMs !== undefined
        ? { firstTokenLatencyMs: input.firstTokenLatencyMs }
        : {}),
      promptSignatureHash: input.promptSignatureHash,
      stableCacheSignatureHash: input.stableCacheSignatureHash,
      stableSegmentCount: 2,
      inputTokens: 100,
      outputTokens: 10,
      ...(input.cacheReadInputTokens !== undefined
        ? { cacheReadInputTokens: input.cacheReadInputTokens }
        : {}),
      ...(input.cacheCreationInputTokens !== undefined
        ? { cacheCreationInputTokens: input.cacheCreationInputTokens }
        : {}),
    },
  ];
}

Deno.test("prompt cache profiling summarizes trace-derived metrics", () => {
  const run = summarizePromptCacheProfilingRun({
    scenario: "cold_baseline",
    title: "Cold baseline",
    traces: makeTraces({
      promptSignatureHash: "prompt-a",
      stableCacheSignatureHash: "stable-a",
      latencyMs: 420,
      firstTokenLatencyMs: 150,
      cacheCreationInputTokens: 3200,
    }),
    responseText: "CACHE-PROFILE-BASELINE-OK",
  });

  assertEquals(run.promptSignatureHash, "prompt-a");
  assertEquals(run.stableCacheSignatureHash, "stable-a");
  assertEquals(run.stableSegmentCount, 2);
  assertEquals(run.latencyMs, 420);
  assertEquals(run.firstTokenLatencyMs, 150);
  assertEquals(run.cacheCreationInputTokens, 3200);
  assertEquals(run.cacheReadInputTokens, null);
});

Deno.test("prompt cache profiling report compares stable signatures across scenarios", () => {
  const report = buildPromptCacheProfilingReport([
    summarizePromptCacheProfilingRun({
      scenario: "cold_baseline",
      title: "Cold baseline",
      traces: makeTraces({
        promptSignatureHash: "prompt-a",
        stableCacheSignatureHash: "stable-a",
        latencyMs: 600,
        cacheCreationInputTokens: 3200,
      }),
      responseText: "ok",
    }),
    summarizePromptCacheProfilingRun({
      scenario: "warm_stable_repeat",
      title: "Warm stable repeat",
      traces: makeTraces({
        promptSignatureHash: "prompt-a",
        stableCacheSignatureHash: "stable-a",
        latencyMs: 300,
        cacheReadInputTokens: 3000,
      }),
      responseText: "ok",
    }),
    summarizePromptCacheProfilingRun({
      scenario: "turn_only_change",
      title: "Turn-only change",
      traces: makeTraces({
        promptSignatureHash: "prompt-b",
        stableCacheSignatureHash: "stable-a",
        latencyMs: 310,
        cacheReadInputTokens: 3000,
      }),
      responseText: "{\"status\":\"ok\"}",
    }),
    summarizePromptCacheProfilingRun({
      scenario: "session_stable_change",
      title: "Session-stable change",
      traces: makeTraces({
        promptSignatureHash: "prompt-c",
        stableCacheSignatureHash: "stable-c",
        latencyMs: 630,
        cacheCreationInputTokens: 3300,
      }),
      responseText: "ok",
    }),
  ], "2026-04-02T00:00:00.000Z");

  assertEquals(report.comparisons.warmStableMatchesCold, true);
  assertEquals(report.comparisons.turnOnlyMatchesWarmStable, true);
  assertEquals(report.comparisons.sessionChangeDiffersFromWarmStable, true);
});

Deno.test("prompt cache profiling markdown renders when cache counters are absent", () => {
  const report = buildPromptCacheProfilingReport([
    summarizePromptCacheProfilingRun({
      scenario: "cold_baseline",
      title: "Cold baseline",
      traces: makeTraces({
        promptSignatureHash: "prompt-a",
        stableCacheSignatureHash: "stable-a",
        latencyMs: 500,
      }),
      responseText: "CACHE-PROFILE-BASELINE-OK",
    }),
  ], "2026-04-02T00:00:00.000Z");

  const markdown = renderPromptCacheProfilingMarkdown(report);
  assertStringIncludes(markdown, "Prompt Cache Profiling Evidence");
  assertStringIncludes(markdown, "Cache Creation Input Tokens");
  assertStringIncludes(markdown, "n/a");
});
