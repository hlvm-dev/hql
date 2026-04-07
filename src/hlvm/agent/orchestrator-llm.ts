/**
 * LLM call wrappers: single-attempt with timeout.
 *
 * No retry loop. On failure, the error propagates to `withFallbackChain`
 * (local-fallback.ts) which handles model switching. The only exception is
 * context_overflow — that gets one compaction recovery (modifies the input,
 * not a blind retry).
 */

import { type ContextManager } from "./context.ts";
import type { Message } from "./context.ts";
import { withTimeout } from "../../common/timeout-utils.ts";
import { RuntimeError } from "../../common/error.ts";
import { classifyError } from "./error-taxonomy.ts";
import { getAgentLogger } from "./logger.ts";
import type { LLMResponse } from "./tool-call.ts";
import type { TraceEvent } from "./orchestrator.ts";

export interface LLMCallOptions {
  onToken?: (text: string) => void;
  disableTools?: boolean;
}

/** LLM function signature used by orchestrator */
export type LLMFunction = (
  messages: Message[],
  signal?: AbortSignal,
  options?: LLMCallOptions,
) => Promise<LLMResponse>;

/**
 * Call LLM with timeout
 */
async function callLLMWithTimeout(
  llmFn: LLMFunction,
  messages: Message[],
  timeout: number,
  parentSignal?: AbortSignal,
  callOptions?: LLMCallOptions,
): Promise<LLMResponse> {
  return await withTimeout(
    async (signal) => {
      const response = await llmFn(messages, signal, callOptions);
      if (signal.aborted) {
        throw new RuntimeError("LLM call aborted");
      }
      return response;
    },
    { timeoutMs: timeout, label: "LLM call", signal: parentSignal },
  );
}

/**
 * Call LLM once. On failure, throw immediately for `withFallbackChain` to handle.
 *
 * The only special case is context_overflow: compact the context and retry once.
 * This is recovery (modifies input), not a blind retry of the same request.
 */
export async function callLLMWithRetry(
  llmFn: LLMFunction,
  initialMessages: Message[],
  config: {
    timeout: number;
    signal?: AbortSignal;
    callOptions?: LLMCallOptions;
    onContextOverflowRetry?: () => void;
  },
  onTrace?: (event: TraceEvent) => void,
  overflowContext?: ContextManager,
): Promise<LLMResponse> {
  try {
    return await callLLMWithTimeout(
      llmFn,
      initialMessages,
      config.timeout,
      config.signal,
      config.callOptions,
    );
  } catch (error) {
    const classified = await classifyError(error);
    onTrace?.({
      type: "llm_error",
      class: classified.class,
      retryable: classified.retryable,
      error: classified.message,
    });

    // Context overflow recovery: compact context and retry once.
    if (classified.class === "context_overflow" && overflowContext) {
      const currentBudget = overflowContext.getMaxTokens();
      overflowContext.requestCompaction();
      await overflowContext.compactIfNeeded();
      if (overflowContext.needsTrimming()) {
        overflowContext.trimToFit();
      }
      const messages = overflowContext.getMessages();
      getAgentLogger().debug?.(
        `Context overflow: compacted and retried within ${currentBudget} token budget`,
      );
      onTrace?.({
        type: "context_overflow_retry",
        newBudget: currentBudget,
        overflowRetryCount: 1,
        reason: "overflow_retry",
      } as TraceEvent);
      config.onContextOverflowRetry?.();
      return await callLLMWithTimeout(
        llmFn,
        messages,
        config.timeout,
        config.signal,
        config.callOptions,
      );
    }

    throw error;
  }
}
