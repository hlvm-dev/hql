/**
 * Agent Error Taxonomy
 *
 * Classifies errors into retryable vs non-retryable categories
 * to ensure consistent retry policies for LLM and tool execution.
 */

import {
  APICallError,
  EmptyResponseBodyError,
  InvalidPromptError,
  LoadAPIKeyError,
  NoContentGeneratedError,
  NoSuchModelError,
  RetryError,
  UnsupportedFunctionalityError,
} from "ai";
import { TimeoutError } from "../../common/timeout-utils.ts";
import { getErrorMessage } from "../../common/utils.ts";

type ErrorClass =
  | "abort"
  | "timeout"
  | "rate_limit"
  | "context_overflow"
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

// Compiled regex patterns for error classification (module-level, created once)
const RE_RATE_LIMIT = /rate limit|too many requests|429/;
const RE_TRANSIENT_NETWORK = /econnreset|econnrefused|enetunreach|enotfound|etimedout|http 50[023]/;
const RE_AUTH = /api key not configured|api key not valid|incorrect api key|invalid api key|invalid x-api-key|authentication_error|exceeded your current quota|insufficient_quota|http 40[13]/;
const RE_CONTEXT_OVERFLOW = /context length|maximum context|token limit|too many tokens|exceeds the model|prompt is too long/;
const RE_PERMANENT = /invalid request|invalid model|invalid parameter|bad request|http 400|http 422|http 501|not allowed|permission denied|denied by user/;

function isRateLimitError(message: string): boolean {
  return RE_RATE_LIMIT.test(message);
}

function isTransientNetworkError(message: string): boolean {
  return RE_TRANSIENT_NETWORK.test(message);
}

function isAuthError(message: string): boolean {
  return RE_AUTH.test(message);
}

function isContextOverflowError(message: string): boolean {
  return RE_CONTEXT_OVERFLOW.test(message);
}

function isPermanentError(message: string): boolean {
  return RE_PERMANENT.test(message);
}

export function classifyError(err: unknown): ClassifiedError {
  const message = getErrorMessage(err).toLowerCase();

  if (isAbortError(err)) {
    return { class: "abort", retryable: false, message };
  }

  if (isTimeoutError(err, message)) {
    return { class: "timeout", retryable: true, message };
  }

  // ── SDK structured error checks (before string matching) ──

  // RetryError wraps the real error — classify its lastError instead
  if (RetryError.isInstance(err)) {
    const inner = (err as { lastError?: unknown }).lastError;
    if (inner) return classifyError(inner);
    return { class: "transient", retryable: true, message };
  }

  // APICallError carries a structured status code
  if (APICallError.isInstance(err)) {
    const apiErr = err as { statusCode?: number; isRetryable?: boolean };
    const code = apiErr.statusCode;
    if (code === 429) return { class: "rate_limit", retryable: true, message };
    if (code === 401 || code === 403) {
      return { class: "permanent", retryable: false, message };
    }
    // Check for context overflow in message even on API errors
    if (isContextOverflowError(message)) {
      return { class: "context_overflow", retryable: true, message };
    }
    if (code && code >= 500 && code < 600) {
      return { class: "transient", retryable: true, message };
    }
    // Fall back to SDK's own retryable flag
    if (apiErr.isRetryable === true) {
      return { class: "transient", retryable: true, message };
    }
    if (apiErr.isRetryable === false) {
      return { class: "permanent", retryable: false, message };
    }
  }

  // Auth/key errors — permanent
  if (LoadAPIKeyError.isInstance(err)) {
    return { class: "permanent", retryable: false, message };
  }

  // Model/prompt configuration errors — permanent
  if (
    NoSuchModelError.isInstance(err) ||
    InvalidPromptError.isInstance(err) ||
    UnsupportedFunctionalityError.isInstance(err)
  ) {
    return { class: "permanent", retryable: false, message };
  }

  // Empty/no content — transient (retry may produce output)
  if (
    NoContentGeneratedError.isInstance(err) ||
    EmptyResponseBodyError.isInstance(err)
  ) {
    return { class: "transient", retryable: true, message };
  }

  // ── String-matching fallback (non-SDK errors, tool errors, legacy) ──

  if (isAuthError(message)) {
    return { class: "permanent", retryable: false, message };
  }

  if (isRateLimitError(message)) {
    return { class: "rate_limit", retryable: true, message };
  }

  // Context overflow is retryable (handled by orchestrator's callLLMWithRetry)
  if (isContextOverflowError(message)) {
    return { class: "context_overflow", retryable: true, message };
  }

  if (isPermanentError(message)) {
    return { class: "permanent", retryable: false, message };
  }

  if (isTransientNetworkError(message)) {
    return { class: "transient", retryable: true, message };
  }

  // Programming errors are permanent — don't waste retries
  if (
    err instanceof TypeError ||
    err instanceof ReferenceError ||
    err instanceof SyntaxError
  ) {
    return { class: "permanent", retryable: false, message };
  }

  return { class: "unknown", retryable: true, message };
}

/**
 * Get an actionable recovery hint for a tool error message.
 * Helps the model self-correct instead of blindly retrying.
 */
export function getRecoveryHint(errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();

  // Shell errors (check before file errors — "command not found" contains "not found")
  if (msg.includes("command not found") || msg.includes("not recognized")) {
    return "Command not available. Check spelling or try an alternative command.";
  }

  // File system errors
  if (msg.includes("enoent") || msg.includes("no such file") || msg.includes("not found")) {
    return "Verify the path exists. Use list_files to check the directory contents first.";
  }
  if (msg.includes("eacces") || msg.includes("permission denied")) {
    return "Permission denied. Try a different path or ask the user for access.";
  }
  if (msg.includes("eisdir") || msg.includes("is a directory")) {
    return "Expected a file but got a directory. Specify the full file path.";
  }
  if (msg.includes("enotdir") || msg.includes("not a directory")) {
    return "Part of the path is not a directory. Check the path components.";
  }
  if (msg.includes("eexist") || msg.includes("already exists")) {
    return "File already exists. Read it first or use edit_file to modify it.";
  }

  // Tool usage errors
  if (msg.includes("required") && msg.includes("missing")) {
    return "Missing required argument. Check the tool schema and provide all required fields.";
  }
  if (msg.includes("invalid") && (msg.includes("argument") || msg.includes("parameter"))) {
    return "Invalid argument value. Check the expected type and format in the tool schema.";
  }
  if (msg.includes("denied by user")) {
    return "User denied this action. Try an alternative approach or ask the user what they prefer.";
  }

  // Network/API errors
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout")) {
    return "Operation timed out. Try a simpler query or break the task into smaller steps.";
  }
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
    return "Rate limit hit. Wait a moment before retrying this operation.";
  }

  // Schema errors
  if (msg.includes("invalid") && msg.includes("schema")) {
    return "Tool schema rejected by provider. Check tool definitions for invalid types.";
  }

  // Auth errors (HTTP status)
  if (msg.includes("http 401") || msg.includes("http 403")) {
    return "Authentication failed. Check your API key configuration.";
  }

  // Shell exit codes
  if (msg.includes("exit code")) {
    return "Command failed. Check the error output for details and fix the command.";
  }

  return null;
}
