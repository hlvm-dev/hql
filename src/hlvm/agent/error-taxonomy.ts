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

function isContextOverflowError(message: string): boolean {
  return message.includes("context length") ||
    message.includes("maximum context") ||
    message.includes("token limit") ||
    message.includes("too many tokens") ||
    message.includes("exceeds the model") ||
    message.includes("prompt is too long");
}

function isPermanentError(message: string): boolean {
  return message.includes("invalid request") ||
    message.includes("invalid model") ||
    message.includes("invalid parameter") ||
    message.includes("bad request") ||
    // Fix 10/11: Detect HTTP status codes from throwOnHttpError
    message.includes("http 400") ||
    message.includes("http 422") ||
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

  // Fix 15: Programming errors are permanent — don't waste retries
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

  // Shell exit codes
  if (msg.includes("exit code")) {
    return "Command failed. Check the error output for details and fix the command.";
  }

  return null;
}
