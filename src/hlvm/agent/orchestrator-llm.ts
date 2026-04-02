/**
 * LLM call wrappers: timeout and retry with exponential backoff.
 * Extracted from orchestrator.ts for modularity.
 */

import { type ContextManager } from "./context.ts";
import type { Message } from "./context.ts";
import {
  createAbortError,
  throwIfAborted,
  withTimeout,
} from "../../common/timeout-utils.ts";
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

async function sleepWithAbort(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (delayMs <= 0) return;
  throwIfAborted(signal, "LLM retry aborted");

  await new Promise<void>((resolve, reject) => {
    if (!signal) {
      setTimeout(() => resolve(), delayMs);
      return;
    }

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError("LLM retry aborted"));
    };

    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

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
 * Call LLM with retry and exponential backoff
 *
 * Retries LLM call on failure with exponential backoff.
 * Backoff schedule: 1s, 2s, 4s, 8s, ...
 */
export async function callLLMWithRetry(
  llmFn: LLMFunction,
  initialMessages: Message[],
  config: {
    timeout: number;
    maxRetries: number;
    signal?: AbortSignal;
    callOptions?: LLMCallOptions;
    onContextOverflowRetry?: () => void;
  },
  onTrace?: (event: TraceEvent) => void,
  overflowContext?: ContextManager,
): Promise<LLMResponse> {
  let lastError: Error | null = null;
  let overflowRetried = false;
  let messages = initialMessages;

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await callLLMWithTimeout(
        llmFn,
        messages,
        config.timeout,
        config.signal,
        config.callOptions,
      );
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

      // Handle context overflow: run one reactive compaction pass, then retry.
      if (classified.class === "context_overflow") {
        if (overflowContext && !overflowRetried) {
          overflowRetried = true;
          const currentBudget = overflowContext.getMaxTokens();
          overflowContext.requestCompaction();
          await overflowContext.compactIfNeeded();
          if (overflowContext.needsTrimming()) {
            overflowContext.trimToFit();
          }
          messages = overflowContext.getMessages();
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
          continue;
        }
        // Already retried or no context — throw immediately
        throw lastError;
      }

      if (!classified.retryable) {
        // Non-retryable: throw immediately with the original error message
        throw lastError;
      }

      // Don't retry on last attempt
      if (attempt === config.maxRetries - 1) break;

      // Honor Retry-After header from provider error messages
      const retryAfterMatch = classified.message.match(/retry-after: (\d+)s/);
      const retryAfterMs = retryAfterMatch
        ? parseInt(retryAfterMatch[1]) * 1000
        : null;
      // Exponential backoff: 1s, 2s, 4s, 8s — or provider's Retry-After
      const delay = retryAfterMs ??
        Math.min(Math.pow(2, attempt) * 1000, 30000);
      await sleepWithAbort(delay, config.signal);
    }
  }

  throw lastError ?? new RuntimeError(
    `LLM failed after ${config.maxRetries} retries with no error captured`,
  );
}
