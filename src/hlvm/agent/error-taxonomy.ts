/**
 * Agent Error Taxonomy
 *
 * Classifies errors into retryable vs non-retryable categories
 * to ensure consistent retry policies for LLM and tool execution.
 */

import { TimeoutError } from "../../common/timeout-utils.ts";
import { getErrorMessage } from "../../common/utils.ts";

type ErrorClass =
  | "abort"
  | "timeout"
  | "rate_limit"
  | "transient"
  | "permanent"
  | "unknown";

interface ClassifiedError {
  class: ErrorClass;
  retryable: boolean;
  message: string;
}

function isAbortError(err: unknown): boolean {
  return Boolean((err as { name?: string })?.name === "AbortError");
}

function isTimeoutError(err: unknown, message: string): boolean {
  return err instanceof TimeoutError || message.includes("timeout");
}

function isRateLimitError(message: string): boolean {
  return message.includes("rate limit") || message.includes("too many requests") ||
    message.includes("429");
}

function isTransientNetworkError(message: string): boolean {
  return message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("enetunreach") ||
    message.includes("enotfound") ||
    message.includes("etimedout");
}

function isAuthError(message: string): boolean {
  return message.includes("api key not configured") ||
    message.includes("api key not valid") ||
    message.includes("incorrect api key") ||
    message.includes("invalid api key") ||
    message.includes("invalid x-api-key") ||
    message.includes("authentication_error") ||
    message.includes("exceeded your current quota") ||
    message.includes("insufficient_quota");
}

function isPermanentError(message: string): boolean {
  return message.includes("invalid") ||
    message.includes("bad request") ||
    message.includes("not allowed") ||
    message.includes("permission denied") ||
    message.includes("denied by user");
}

export function classifyError(err: unknown): ClassifiedError {
  const message = getErrorMessage(err).toLowerCase();

  if (isAbortError(err)) {
    return { class: "abort", retryable: false, message };
  }

  if (isTimeoutError(err, message)) {
    return { class: "timeout", retryable: true, message };
  }

  if (isAuthError(message)) {
    return { class: "permanent", retryable: false, message };
  }

  if (isRateLimitError(message)) {
    return { class: "rate_limit", retryable: true, message };
  }

  if (isPermanentError(message)) {
    return { class: "permanent", retryable: false, message };
  }

  if (isTransientNetworkError(message)) {
    return { class: "transient", retryable: true, message };
  }

  return { class: "unknown", retryable: true, message };
}
