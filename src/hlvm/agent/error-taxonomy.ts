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
import { RuntimeError } from "../../common/error.ts";
import {
  getErrorFixes,
  parseErrorCodeFromMessage,
  stripErrorCodeFromMessage,
  type UnifiedErrorCode,
} from "../../common/error-codes.ts";
import { TimeoutError } from "../../common/timeout-utils.ts";
import { LINE_SPLIT_REGEX, getErrorMessage, truncate } from "../../common/utils.ts";

/** Precise abort check for error taxonomy — only checks error.name, not message substring */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

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

export interface EditFileRecovery {
  kind: "edit_file_target_not_found";
  path: string;
  requestedFind: string;
  excerpt: string;
  closestCurrentLine?: string;
}

function isTimeoutError(err: unknown, message: string): boolean {
  return err instanceof TimeoutError || message.includes("timeout");
}

// Compiled regex patterns for error classification (module-level, created once).
// Each entry maps a regex to {class, retryable} — used both in classifyError()
// for SDK-level checks (e.g. context_overflow inside APICallError) and for the
// string-matching fallback path.
const ERROR_PATTERNS: ReadonlyArray<
  { re: RegExp; class: ErrorClass; retryable: boolean }
> = [
  {
    re: /api key not configured|api key not valid|api key is missing|incorrect api key|invalid api key|invalid x-api-key|authentication_error|exceeded your current quota|insufficient_quota|http 40[13]/,
    class: "permanent",
    retryable: false,
  },
  {
    re: /rate limit|too many requests|429/,
    class: "rate_limit",
    retryable: true,
  },
  {
    re: /context length|maximum context|token limit|too many tokens|exceeds the model|prompt is too long/,
    class: "context_overflow",
    retryable: true,
  },
  {
    re: /invalid request|invalid model|invalid parameter|bad request|http 400|http 422|http 501|not allowed|permission denied|denied by user/,
    class: "permanent",
    retryable: false,
  },
  {
    re: /econnreset|econnrefused|enetunreach|enotfound|etimedout|epipe|econnaborted|error reading a body|connection.*closed|socket hang up|network error|http 50[023]/,
    class: "transient",
    retryable: true,
  },
];

function matchErrorPattern(
  message: string,
): { class: ErrorClass; retryable: boolean } | null {
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.re.test(message)) return pattern;
  }
  return null;
}

function isContextOverflowError(message: string): boolean {
  return ERROR_PATTERNS[2].re.test(message);
}

function isTransientNetworkError(message: string): boolean {
  return ERROR_PATTERNS[4].re.test(message);
}

const EDIT_FILE_TARGET_NOT_FOUND_PATTERNS = [
  "pattern not found",
  "search string not found",
  "not found in file",
];

function isEditFileTargetMiss(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  return EDIT_FILE_TARGET_NOT_FOUND_PATTERNS.some((pattern) =>
    lower.includes(pattern)
  );
}

function findBestExcerpt(content: string, requestedFind: string): string {
  const compactContent = content.trim();
  if (compactContent.length <= 900) return compactContent;

  const candidates = requestedFind
    .split(LINE_SPLIT_REGEX)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .sort((a, b) => b.length - a.length);

  for (const candidate of candidates) {
    const matchIndex = content.indexOf(candidate);
    if (matchIndex >= 0) {
      const start = Math.max(0, matchIndex - 350);
      const end = Math.min(content.length, matchIndex + candidate.length + 350);
      return `${start > 0 ? "...\n" : ""}${content.slice(start, end).trim()}${
        end < content.length ? "\n..." : ""
      }`;
    }
  }

  const head = content.slice(0, 500).trim();
  const tail = content.slice(-250).trim();
  return `${head}\n...\n${tail}`;
}

function extractRecoveryTokens(text: string): Set<string> {
  return new Set(
    (text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])
      .map((token) => token.toLowerCase())
      .filter((token) => token.length >= 3),
  );
}

function findClosestCurrentLine(
  content: string,
  requestedFind: string,
): string | undefined {
  const requestTokens = extractRecoveryTokens(requestedFind);
  const requestHasAssignment = requestedFind.includes("=");
  const requestHasExport = /\bexport\b/.test(requestedFind);
  let bestLine: string | undefined;
  let bestScore = 0;

  for (const rawLine of content.split(LINE_SPLIT_REGEX)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const lineTokens = extractRecoveryTokens(line);
    let score = 0;
    for (const token of lineTokens) {
      if (requestTokens.has(token)) score += 3;
    }
    if (requestHasAssignment && line.includes("=")) score += 2;
    if (requestHasExport && /\bexport\b/.test(line)) score += 2;
    if (line.endsWith(";")) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }

  return bestScore >= 3 ? bestLine : undefined;
}

export function buildEditFileRecovery(
  args: { path?: string; find?: string },
  errorMessage: string,
  fileContent: string,
): EditFileRecovery | null {
  if (!isEditFileTargetMiss(errorMessage)) return null;
  if (!args.path || !args.find) return null;

  return {
    kind: "edit_file_target_not_found",
    path: args.path,
    requestedFind: args.find,
    excerpt: findBestExcerpt(fileContent, args.find),
    closestCurrentLine: findClosestCurrentLine(fileContent, args.find),
  };
}

export function renderEditFileRecoveryPrompt(
  recovery: EditFileRecovery,
): string {
  const requestedFind = truncate(
    recovery.requestedFind.replace(/\s+/g, " ").trim(),
    240,
  );
  return [
    `The previous edit_file call could not find its target in ${recovery.path}.`,
    "The file likely changed or the prior edit target was wrong.",
    `Requested find text: "${requestedFind}"`,
    ...(recovery.closestCurrentLine
      ? [
        "Closest current line in the file:",
        "```text",
        recovery.closestCurrentLine,
        "```",
      ]
      : []),
    "Fresh file context:",
    "```text",
    recovery.excerpt,
    "```",
    "Use the fresh context above instead of guessing or repeating the same edit unchanged.",
    "If the closest current line matches the code you intend to change, use that exact line as your next find string.",
  ].join("\n");
}

export async function classifyError(err: unknown): Promise<ClassifiedError> {
  const message = getErrorMessage(err).toLowerCase();

  if (isTimeoutError(err, message)) {
    return { class: "timeout", retryable: true, message };
  }

  if (isAbortError(err)) {
    return { class: "abort", retryable: false, message };
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
    // Connection-level errors are always transient regardless of SDK flag.
    // The SDK sets isRetryable: false for errors without HTTP status codes
    // (e.g. "error reading a body from connection"), but these ARE retryable.
    if (isTransientNetworkError(message)) {
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

  const matched = matchErrorPattern(message);
  if (matched) return { ...matched, message };

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
 * Recovery hint rules: [keywords, hint].
 * All keywords in a rule must match (AND). Order matters -- first match wins.
 * "command not found" must precede "not found" to avoid false match on file errors.
 */
const RECOVERY_HINT_RULES: readonly [string[], string][] = [
  [["command not found"], "Command not available. Check spelling or try an alternative command."],
  [["not recognized"], "Command not available. Check spelling or try an alternative command."],
  [["enoent"], "Verify the path exists. Use list_files to check the directory contents first."],
  [["no such file"], "Verify the path exists. Use list_files to check the directory contents first."],
  [["not found"], "Verify the path exists. Use list_files to check the directory contents first."],
  [["eacces"], "Permission denied. Try a different path or ask the user for access."],
  [["permission denied"], "Permission denied. Try a different path or ask the user for access."],
  [["eisdir"], "Expected a file but got a directory. Specify the full file path."],
  [["is a directory"], "Expected a file but got a directory. Specify the full file path."],
  [["enotdir"], "Part of the path is not a directory. Check the path components."],
  [["not a directory"], "Part of the path is not a directory. Check the path components."],
  [["eexist"], "File already exists. Read it first or use edit_file to modify it."],
  [["already exists"], "File already exists. Read it first or use edit_file to modify it."],
  [["required", "missing"], "Missing required argument. Check the tool schema and provide all required fields."],
  [["invalid", "argument"], "Invalid argument value. Check the expected type and format in the tool schema."],
  [["invalid", "parameter"], "Invalid argument value. Check the expected type and format in the tool schema."],
  [["denied by user"], "User denied this action. Try an alternative approach or ask the user what they prefer."],
  [["timeout"], "Operation timed out. Try a simpler query or break the task into smaller steps."],
  [["timed out"], "Operation timed out. Try a simpler query or break the task into smaller steps."],
  [["etimedout"], "Operation timed out. Try a simpler query or break the task into smaller steps."],
  [["rate limit"], "Rate limit hit. Wait a moment before retrying this operation."],
  [["429"], "Rate limit hit. Wait a moment before retrying this operation."],
  [["too many requests"], "Rate limit hit. Wait a moment before retrying this operation."],
  [["invalid", "schema"], "Tool schema rejected by provider. Check tool definitions for invalid types."],
  [["http 401"], "Authentication failed. Check your API key configuration."],
  [["http 403"], "Authentication failed. Check your API key configuration."],
  [["exit code"], "Command failed. Check the error output for details and fix the command."],
];

/** Static rule matching for recovery hints (fast path). */
function matchStaticRecoveryRule(errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();
  for (const [keywords, hint] of RECOVERY_HINT_RULES) {
    if (keywords.every((kw) => msg.includes(kw))) return hint;
  }
  return null;
}

/**
 * Get an actionable recovery hint for a tool error message.
 * Helps the model self-correct instead of blindly retrying.
 */
export function getRecoveryHint(errorMessage: string): string | null {
  // Fast path: static rules
  const staticHint = matchStaticRecoveryRule(errorMessage);
  if (staticHint) return staticHint;
  return null;
}

function extractStructuredErrorCode(
  err: unknown,
  rawMessage: string,
): UnifiedErrorCode | null {
  if (err instanceof RuntimeError) {
    return err.code ?? null;
  }
  return parseErrorCodeFromMessage(rawMessage);
}

export interface DisplayableError {
  message: string;
  hint: string | null;
  class: ErrorClass;
  retryable: boolean;
}

export async function describeErrorForDisplay(err: unknown): Promise<DisplayableError> {
  const rawMessage = getErrorMessage(err);
  const classified = await classifyError(err);
  const code = extractStructuredErrorCode(err, rawMessage);
  const message = stripErrorCodeFromMessage(rawMessage).trim() ||
    rawMessage.trim() ||
    "Unknown error";
  const hint = getRecoveryHint(message) ??
    (code != null ? getErrorFixes(code)[0] ?? null : null);

  return {
    message,
    hint,
    class: classified.class,
    retryable: classified.retryable,
  };
}
