/**
 * Agent Error Taxonomy
 *
 * Classifies errors into retryable vs non-retryable categories
 * to ensure consistent retry policies for LLM and tool execution.
 */

import {
  APICallError,
  EmptyResponseBodyError,
  InvalidArgumentError,
  InvalidPromptError,
  InvalidResponseDataError,
  InvalidToolInputError,
  JSONParseError,
  LoadAPIKeyError,
  LoadSettingError,
  NoContentGeneratedError,
  NoSuchModelError,
  NoSuchToolError,
  RetryError,
  TooManyEmbeddingValuesForCallError,
  TypeValidationError,
  UnsupportedFunctionalityError,
} from "ai";
import { RuntimeError } from "../../common/error.ts";
import {
  getErrorFixes,
  HLVMErrorCode,
  parseErrorCodeFromMessage,
  stripErrorCodeFromMessage,
  type UnifiedErrorCode,
} from "../../common/error-codes.ts";
import { TimeoutError } from "../../common/timeout-utils.ts";
import { LINE_SPLIT_REGEX, getErrorMessage, truncate } from "../../common/utils.ts";
import { DEFAULT_OLLAMA_HOST } from "../../common/hosts.ts";
import {
  isAuthStatus,
  isRateLimited,
  isServerError,
} from "../../common/http-status.ts";

/** Precise abort check for error taxonomy — only checks error.name, not message substring */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export const ERROR_CLASS = Object.freeze({
  ABORT: "abort",
  TIMEOUT: "timeout",
  RATE_LIMIT: "rate_limit",
  CONTEXT_OVERFLOW: "context_overflow",
  TRANSIENT: "transient",
  PERMANENT: "permanent",
  UNKNOWN: "unknown",
} as const);

export type ErrorClass = typeof ERROR_CLASS[keyof typeof ERROR_CLASS];

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

export const HINTS = Object.freeze({
  FILE_NOT_FOUND:
    "Verify the path exists. Use list_files to check the directory first.",
  PERMISSION_DENIED:
    "Permission denied. Try a different path or ask the user for access.",
  FILE_EXISTS:
    "File already exists. Read it first or use edit_file to modify it.",
  IS_DIRECTORY:
    "Expected a file but got a directory. Specify the full file path.",
  NOT_DIRECTORY:
    "Part of the path is not a directory. Check the path components.",
  DISK_FULL:
    "Disk is full. Free up space and retry; model pulls need ~5 GB.",
  PORT_IN_USE:
    "Port is already in use. Stop the conflicting process or let HLVM pick a new port.",
  CONNECTION_REFUSED:
    "Connection refused. Verify the target process is running and reachable.",
  CONNECTION_CLOSED: "Connection was closed. Retry the request.",
  DNS_FAILED: "DNS resolution failed. Check network connectivity and retry.",
  DNS_TEMP: "DNS lookup is temporarily unavailable. Retry in a moment.",
  TIMEOUT:
    "Operation timed out. Retry; consider breaking the task into smaller steps.",
  TIMEOUT_TOOL:
    "Operation timed out. Try a simpler query or break the task into smaller steps.",
  NETWORK_UNREACHABLE: "Network is unreachable. Check connectivity and retry.",
  BAD_RESOURCE: "Resource was closed before the operation completed. Retry.",
  INTERRUPTED: "Operation was interrupted.",
  COMMAND_NOT_FOUND:
    "Command not available. Check spelling or try an alternative command.",
  CMD_EXIT_FAILED:
    "Command failed. Check the error output for details and fix the command.",
  MISSING_REQUIRED_ARG:
    "Missing required argument. Check the tool schema and provide all required fields.",
  INVALID_ARG_VALUE:
    "Invalid argument value. Check the expected type and format in the tool schema.",
  INVALID_SCHEMA:
    "Tool schema rejected by provider. Check tool definitions for invalid types.",
  USER_DENIED:
    "User denied this action. Try an alternative approach or ask the user what they prefer.",
  AUTH_FAILED_API_KEY:
    "Authentication failed. Check your API key configuration.",
  AUTH_FAILED_PROVIDER:
    "Authentication failed. Check your API key configuration for this provider.",
  RATE_LIMIT: "Rate limit hit. Wait a moment before retrying this operation.",
  PROVIDER_RATE_LIMIT: "Provider rate limit hit. Wait a moment before retrying.",
  USAGE_QUOTA:
    "Usage quota exceeded. Check your provider account or billing settings.",
  PROVIDER_QUOTA:
    "Provider quota exceeded. Check your billing or plan settings.",
  CONTEXT_OVERFLOW:
    "Prompt exceeded the model's context window. Trim context or pick a larger-context model.",
  PROVIDER_NOT_FOUND:
    "Resource not found at the provider. Verify the model ID and your account's access.",
  PROVIDER_OVERLOADED:
    "Provider reports service unavailable or overloaded. Retry shortly.",
  PROVIDER_INVALID_REQUEST:
    "Provider rejected the request. Check model, tool schemas, and argument types.",
  SIGNIN_REQUIRED:
    "Sign in to the provider (e.g. `hlvm ollama signin`) and retry.",
  TOKEN_EXPIRED:
    "Auth token has expired. Re-authenticate with the provider and retry.",
  MODEL_NOT_INSTALLED:
    "Model is not available. Run `hlvm pull <model>` or choose an installed model.",
  AI_RUNTIME_NOT_READY:
    "Local AI runtime is not ready. Run `hlvm bootstrap` to install the required engine and fallback model, then retry.",
  MODEL_NOT_IN_REGISTRY:
    "Model is not available in the registry. Check spelling or pick another model.",
  MANIFEST_MISMATCH:
    "Run `hlvm bootstrap --repair` to refresh the model manifest.",
  UV_MISSING:
    "Managed Python sidecar prerequisite missing. Run `hlvm bootstrap --repair`.",
  PYTHON_MISSING:
    "Managed Python sidecar is not installed. Run `hlvm bootstrap --repair`.",
  OLLAMA_SIGNIN_REQUIRED:
    "Ollama registry requires authentication. Run `hlvm ollama signin`.",
  MCP_UNAUTHORIZED:
    "MCP server requires authentication. Run `hlvm mcp login <server>`.",
  MCP_METHOD_NOT_FOUND:
    "MCP server does not expose this method. Check the server's tool list.",
  MCP_INVALID_PARAMS:
    "MCP server rejected the arguments. Check the tool's input schema.",
  MCP_MALFORMED:
    "MCP request was malformed. Report this if it happens in normal use.",
  MCP_INTERNAL:
    "MCP server raised an internal error. Retry; if it persists, check the server's logs.",
  BOOTSTRAP_ENGINE_DOWNLOAD:
    "Check network connectivity and available disk space (~200 MB), then retry.",
  BOOTSTRAP_ENGINE_START:
    `AI engine failed to start. Check runtime logs and ensure no stale process owns ${DEFAULT_OLLAMA_HOST}.`,
  BOOTSTRAP_MODEL_PULL:
    "Model pull failed. Verify network, disk space (~5 GB for the fallback model), and retry.",
  BOOTSTRAP_MANIFEST_REPAIR:
    "Run `hlvm bootstrap --repair` to refresh the model manifest and re-verify.",
  LAST_RESORT:
    "Unexpected error. Re-run with --verbose for the full chain; if it persists, file an issue with the exact command and this message.",
  INTERNAL_HLVM_BUG:
    "This looks like an HLVM bug, not a bad command. Retry once; if it persists, keep the exact command and error text.",
  TOOL_EXECUTION_GENERIC:
    "Check the tool result for a tool-specific hint before retrying.",
} as const);

export type HintKey = keyof typeof HINTS;

// Compiled regex patterns for error classification (module-level, created once).
// Each entry maps a regex to {class, retryable} — used both in classifyError()
// for SDK-level checks (e.g. context_overflow inside APICallError) and for the
// string-matching fallback path.
const ERROR_PATTERNS: ReadonlyArray<
  { re: RegExp; class: ErrorClass; retryable: boolean }
> = [
  {
    re: /api key not configured|api key not valid|api key is missing|incorrect api key|invalid api key|invalid x-api-key|authentication_error|exceeded your current quota|insufficient_quota|http 40[13]/,
    class: ERROR_CLASS.PERMANENT,
    retryable: false,
  },
  {
    re: /rate limit|too many requests|429/,
    class: ERROR_CLASS.RATE_LIMIT,
    retryable: true,
  },
  {
    re: /context length|maximum context|token limit|too many tokens|exceeds the model|prompt is too long/,
    class: ERROR_CLASS.CONTEXT_OVERFLOW,
    retryable: true,
  },
  {
    re: /invalid request|invalid model|invalid parameter|bad request|http 400|http 422|http 501|not allowed|permission denied|denied by user/,
    class: ERROR_CLASS.PERMANENT,
    retryable: false,
  },
  {
    re: /econnreset|econnrefused|enetunreach|enotfound|etimedout|epipe|econnaborted|error reading a body|connection.*(closed|refused|reset)|tcp connect error|socket hang up|network error|http 50[023]/,
    class: ERROR_CLASS.TRANSIENT,
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

function classifyFromMcpError(
  err: unknown,
): { class: ErrorClass; retryable: boolean; hint: string } | null {
  if (!err || typeof err !== "object") return null;
  const name = (err as Error).name;
  if (name === "UnauthorizedError") {
    return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.MCP_UNAUTHORIZED };
  }
  if (name !== "McpError") return null;
  const code = (err as { code?: number }).code;
  if (code === -32601) {
    return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.MCP_METHOD_NOT_FOUND };
  }
  if (code === -32602) {
    return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.MCP_INVALID_PARAMS };
  }
  if (code === -32600 || code === -32700) {
    return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.MCP_MALFORMED };
  }
  if (code === -32603) {
    return { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.MCP_INTERNAL };
  }
  return null;
}

export function classifyFromApiResponseBody(
  body: string | undefined | null,
): { class: ErrorClass; retryable: boolean; hint: string } | null {
  if (!body || typeof body !== "string") return null;
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const errorNode =
    (parsed as { error?: unknown }).error && typeof (parsed as { error: unknown }).error === "object"
      ? (parsed as { error: Record<string, unknown> }).error
      : (parsed as Record<string, unknown>);

  const type = typeof errorNode.type === "string" ? errorNode.type : undefined;
  const code = typeof errorNode.code === "string" ? errorNode.code : undefined;
  const status = typeof errorNode.status === "string" ? errorNode.status : undefined;

  const signal = (type ?? code ?? status ?? "").toLowerCase();
  if (!signal) return null;

  if (
    signal.includes("authentication") ||
    signal.includes("permission") ||
    signal.includes("invalid_api_key") ||
    signal.includes("unauthenticated") ||
    signal.includes("permission_denied")
  ) {
    return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.AUTH_FAILED_PROVIDER };
  }
  if (signal.includes("rate_limit") || signal.includes("rate-limited") || signal.includes("resource_exhausted")) {
    return { class: ERROR_CLASS.RATE_LIMIT, retryable: true, hint: HINTS.PROVIDER_RATE_LIMIT };
  }
  if (signal.includes("insufficient_quota") || signal.includes("billing")) {
    return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.PROVIDER_QUOTA };
  }
  if (signal.includes("context") || signal.includes("maximum_tokens")) {
    return { class: ERROR_CLASS.CONTEXT_OVERFLOW, retryable: true, hint: HINTS.CONTEXT_OVERFLOW };
  }
  if (signal.includes("not_found") || signal === "not found") {
    return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.PROVIDER_NOT_FOUND };
  }
  if (signal.includes("unavailable") || signal.includes("overloaded")) {
    return { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.PROVIDER_OVERLOADED };
  }
  if (signal.includes("invalid_request") || signal.includes("invalid-argument")) {
    return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.PROVIDER_INVALID_REQUEST };
  }
  return null;
}

const DENO_ERROR_NAME_MAP: Record<
  string,
  { class: ErrorClass; retryable: boolean; hint: string }
> = {
  NotFound: { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.FILE_NOT_FOUND },
  PermissionDenied: { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.PERMISSION_DENIED },
  AlreadyExists: { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.FILE_EXISTS },
  ConnectionRefused: { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.CONNECTION_REFUSED },
  ConnectionReset: { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.CONNECTION_CLOSED },
  ConnectionAborted: { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.CONNECTION_CLOSED },
  BrokenPipe: { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.CONNECTION_CLOSED },
  AddrInUse: { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.PORT_IN_USE },
  TimedOut: { class: ERROR_CLASS.TIMEOUT, retryable: true, hint: HINTS.TIMEOUT },
  Interrupted: { class: ERROR_CLASS.ABORT, retryable: false, hint: HINTS.INTERRUPTED },
  NetworkUnreachable: { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.NETWORK_UNREACHABLE },
  IsADirectory: { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.IS_DIRECTORY },
  NotADirectory: { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.NOT_DIRECTORY },
  BadResource: { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.BAD_RESOURCE },
  UnexpectedEof: { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.CONNECTION_CLOSED },
  WriteZero: { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.CONNECTION_CLOSED },
  Busy: { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.BAD_RESOURCE },
  Http: { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.CONNECTION_CLOSED },
  NotSupported: { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.INVALID_ARG_VALUE },
  FilesystemLoop: { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.FILE_NOT_FOUND },
};

export function classifyFromPlatformError(
  err: unknown,
): { class: ErrorClass; retryable: boolean; hint: string } | null {
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
    if (!current || typeof current !== "object" || seen.has(current)) {
      return null;
    }
    seen.add(current);

    if (current instanceof Error) {
      const byName = DENO_ERROR_NAME_MAP[current.name];
      if (byName) return byName;
    }

    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      const mapped = classifyNodeErrorCode(code);
      if (mapped) return mapped;
    }

    const cause = (current as { cause?: unknown }).cause;
    const original = current instanceof RuntimeError
      ? (current as unknown as { originalError?: unknown }).originalError
      : undefined;
    current = cause ?? original;
  }
  return null;
}

function classifyNodeErrorCode(
  code: string,
): { class: ErrorClass; retryable: boolean; hint: string } | null {
  switch (code) {
    case "ENOENT":
      return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.FILE_NOT_FOUND };
    case "EACCES":
    case "EPERM":
      return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.PERMISSION_DENIED };
    case "EEXIST":
      return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.FILE_EXISTS };
    case "EISDIR":
      return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.IS_DIRECTORY };
    case "ENOTDIR":
      return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.NOT_DIRECTORY };
    case "ENOSPC":
      return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.DISK_FULL };
    case "EADDRINUSE":
      return { class: ERROR_CLASS.PERMANENT, retryable: false, hint: HINTS.PORT_IN_USE };
    case "ECONNREFUSED":
      return { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.CONNECTION_REFUSED };
    case "ECONNRESET":
    case "ECONNABORTED":
    case "EPIPE":
      return { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.CONNECTION_CLOSED };
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.DNS_FAILED };
    case "ETIMEDOUT":
      return { class: ERROR_CLASS.TIMEOUT, retryable: true, hint: HINTS.TIMEOUT };
    case "ENETUNREACH":
      return { class: ERROR_CLASS.TRANSIENT, retryable: true, hint: HINTS.NETWORK_UNREACHABLE };
    default:
      return null;
  }
}

export async function classifyError(err: unknown): Promise<ClassifiedError> {
  const message = getErrorMessage(err).toLowerCase();

  if (isTimeoutError(err, message)) {
    return { class: ERROR_CLASS.TIMEOUT, retryable: true, message };
  }

  if (isAbortError(err)) {
    return { class: ERROR_CLASS.ABORT, retryable: false, message };
  }

  // ── SDK structured error checks (before string matching) ──

  // RetryError wraps the real error — classify its lastError instead
  if (RetryError.isInstance(err)) {
    const inner = (err as { lastError?: unknown }).lastError;
    if (inner) return classifyError(inner);
    return { class: ERROR_CLASS.TRANSIENT, retryable: true, message };
  }

  if (APICallError.isInstance(err)) {
    const apiErr = err as {
      statusCode?: number;
      isRetryable?: boolean;
      responseBody?: string;
    };
    const providerMapped = classifyFromApiResponseBody(apiErr.responseBody);
    if (providerMapped) {
      return { class: providerMapped.class, retryable: providerMapped.retryable, message };
    }
    const code = apiErr.statusCode;
    if (isRateLimited(code)) return { class: ERROR_CLASS.RATE_LIMIT, retryable: true, message };
    if (isAuthStatus(code)) {
      return { class: ERROR_CLASS.PERMANENT, retryable: false, message };
    }
    if (isContextOverflowError(message)) {
      return { class: ERROR_CLASS.CONTEXT_OVERFLOW, retryable: true, message };
    }
    if (isServerError(code)) {
      return { class: ERROR_CLASS.TRANSIENT, retryable: true, message };
    }
    if (isTransientNetworkError(message)) {
      return { class: ERROR_CLASS.TRANSIENT, retryable: true, message };
    }
    if (apiErr.isRetryable === true) {
      return { class: ERROR_CLASS.TRANSIENT, retryable: true, message };
    }
    if (apiErr.isRetryable === false) {
      return { class: ERROR_CLASS.PERMANENT, retryable: false, message };
    }
  }

  // Auth/key/settings errors — permanent
  if (
    LoadAPIKeyError.isInstance(err) ||
    LoadSettingError.isInstance(err)
  ) {
    return { class: ERROR_CLASS.PERMANENT, retryable: false, message };
  }

  // Model/prompt/tool configuration errors — permanent
  if (
    NoSuchModelError.isInstance(err) ||
    NoSuchToolError.isInstance(err) ||
    InvalidPromptError.isInstance(err) ||
    InvalidArgumentError.isInstance(err) ||
    InvalidToolInputError.isInstance(err) ||
    UnsupportedFunctionalityError.isInstance(err) ||
    TooManyEmbeddingValuesForCallError.isInstance(err)
  ) {
    return { class: ERROR_CLASS.PERMANENT, retryable: false, message };
  }

  // Response-shape errors — transient (retry may succeed)
  if (
    NoContentGeneratedError.isInstance(err) ||
    EmptyResponseBodyError.isInstance(err) ||
    InvalidResponseDataError.isInstance(err) ||
    JSONParseError.isInstance(err) ||
    TypeValidationError.isInstance(err)
  ) {
    return { class: ERROR_CLASS.TRANSIENT, retryable: true, message };
  }

  const mcp = classifyFromMcpError(err);
  if (mcp) {
    return { class: mcp.class, retryable: mcp.retryable, message };
  }

  const platform = classifyFromPlatformError(err);
  if (platform) {
    return { class: platform.class, retryable: platform.retryable, message };
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
    return { class: ERROR_CLASS.PERMANENT, retryable: false, message };
  }

  return { class: ERROR_CLASS.UNKNOWN, retryable: true, message };
}

/**
 * Recovery hint rules: [keywords, hint].
 * All keywords in a rule must match (AND). Order matters -- first match wins.
 * "command not found" must precede "not found" to avoid false match on file errors.
 */
const RECOVERY_HINT_RULES: readonly [string[], string][] = [
  [["command not found"], HINTS.COMMAND_NOT_FOUND],
  [["not recognized"], HINTS.COMMAND_NOT_FOUND],
  [["enospc"], HINTS.DISK_FULL],
  [["no space left"], HINTS.DISK_FULL],
  [["eaddrinuse"], HINTS.PORT_IN_USE],
  [["address already in use"], HINTS.PORT_IN_USE],
  [["econnrefused"], HINTS.CONNECTION_REFUSED],
  [["connection refused"], HINTS.CONNECTION_REFUSED],
  [["enotfound"], HINTS.DNS_FAILED],
  [["eai_again"], HINTS.DNS_TEMP],
  [["cannot resolve"], HINTS.DNS_FAILED],
  [["enoent"], HINTS.FILE_NOT_FOUND],
  [["no such file"], HINTS.FILE_NOT_FOUND],
  [["not found"], HINTS.FILE_NOT_FOUND],
  [["eacces"], HINTS.PERMISSION_DENIED],
  [["permission denied"], HINTS.PERMISSION_DENIED],
  [["eisdir"], HINTS.IS_DIRECTORY],
  [["is a directory"], HINTS.IS_DIRECTORY],
  [["enotdir"], HINTS.NOT_DIRECTORY],
  [["not a directory"], HINTS.NOT_DIRECTORY],
  [["eexist"], HINTS.FILE_EXISTS],
  [["already exists"], HINTS.FILE_EXISTS],
  [["required", "missing"], HINTS.MISSING_REQUIRED_ARG],
  [["invalid", "argument"], HINTS.INVALID_ARG_VALUE],
  [["invalid", "parameter"], HINTS.INVALID_ARG_VALUE],
  [["denied by user"], HINTS.USER_DENIED],
  [["timeout"], HINTS.TIMEOUT_TOOL],
  [["timed out"], HINTS.TIMEOUT_TOOL],
  [["etimedout"], HINTS.TIMEOUT_TOOL],
  [["quota"], HINTS.USAGE_QUOTA],
  [["insufficient_quota"], HINTS.USAGE_QUOTA],
  [["rate limit"], HINTS.RATE_LIMIT],
  [["429"], HINTS.RATE_LIMIT],
  [["too many requests"], HINTS.RATE_LIMIT],
  [["invalid", "schema"], HINTS.INVALID_SCHEMA],
  [["http 401"], HINTS.AUTH_FAILED_API_KEY],
  [["http 403"], HINTS.AUTH_FAILED_API_KEY],
  [["signin required"], HINTS.SIGNIN_REQUIRED],
  [["sign in required"], HINTS.SIGNIN_REQUIRED],
  [["token expired"], HINTS.TOKEN_EXPIRED],
  [["model", "not found"], HINTS.MODEL_NOT_INSTALLED],
  [["not in the ai engine"], HINTS.AI_RUNTIME_NOT_READY],
  [["is not ready for ai requests"], HINTS.AI_RUNTIME_NOT_READY],
  [["manifest", "mismatch"], HINTS.MANIFEST_MISMATCH],
  [["uv is not installed"], HINTS.UV_MISSING],
  [["python not found"], HINTS.PYTHON_MISSING],
  [["exit code"], HINTS.CMD_EXIT_FAILED],
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

export function getRecoveryHintFromError(err: unknown): string | null {
  if (APICallError.isInstance(err)) {
    const apiErr = err as { responseBody?: string };
    const byBody = classifyFromApiResponseBody(apiErr.responseBody);
    if (byBody) return byBody.hint;
  }
  const mcp = classifyFromMcpError(err);
  if (mcp) return mcp.hint;
  const platform = classifyFromPlatformError(err);
  if (platform) return platform.hint;
  return getRecoveryHint(getErrorMessage(err));
}

function isUnexpectedInternalException(err: unknown): err is Error {
  if (!(err instanceof Error) || err instanceof RuntimeError) {
    return false;
  }
  return err.name === "TypeError" ||
    err.name === "ReferenceError" ||
    err.name === "SyntaxError";
}

export class AgentStreamError extends RuntimeError {
  readonly streamClass: ErrorClass;
  readonly streamRetryable: boolean;
  readonly streamHint: string | null;

  constructor(
    message: string,
    streamClass: ErrorClass,
    streamRetryable: boolean,
    streamHint: string | null,
  ) {
    const parsedCode = parseErrorCodeFromMessage(message);
    super(message, { code: parsedCode ?? HLVMErrorCode.REQUEST_FAILED });
    this.name = "AgentStreamError";
    this.streamClass = streamClass;
    this.streamRetryable = streamRetryable;
    this.streamHint = streamHint;
  }
}

export const BOOTSTRAP_PHASE = Object.freeze({
  ENGINE_DOWNLOAD: "engine_download",
  ENGINE_START: "engine_start",
  MODEL_PULL: "model_pull",
  MANIFEST_VERIFY: "manifest_verify",
} as const);

export type BootstrapPhase = typeof BOOTSTRAP_PHASE[keyof typeof BOOTSTRAP_PHASE];

export class BootstrapError extends RuntimeError {
  readonly phase: BootstrapPhase;
  readonly bootstrapHint: string;

  constructor(
    message: string,
    phase: BootstrapPhase,
    opts?: { code?: UnifiedErrorCode; originalError?: Error; hint?: string },
  ) {
    super(message, {
      code: opts?.code ?? defaultBootstrapCodeForPhase(phase),
      originalError: opts?.originalError,
    });
    this.name = "BootstrapError";
    this.phase = phase;
    this.bootstrapHint = opts?.hint ?? defaultBootstrapHintForPhase(phase);
  }
}

function defaultBootstrapCodeForPhase(phase: BootstrapPhase): UnifiedErrorCode {
  switch (phase) {
    case BOOTSTRAP_PHASE.ENGINE_DOWNLOAD:
    case BOOTSTRAP_PHASE.ENGINE_START:
      return HLVMErrorCode.AI_ENGINE_STARTUP_FAILED;
    case BOOTSTRAP_PHASE.MODEL_PULL:
      return HLVMErrorCode.BOOTSTRAP_MODEL_PULL_FAILED;
    case BOOTSTRAP_PHASE.MANIFEST_VERIFY:
      return HLVMErrorCode.BOOTSTRAP_VERIFICATION_FAILED;
  }
}

function defaultBootstrapHintForPhase(phase: BootstrapPhase): string {
  switch (phase) {
    case BOOTSTRAP_PHASE.ENGINE_DOWNLOAD:
      return HINTS.BOOTSTRAP_ENGINE_DOWNLOAD;
    case BOOTSTRAP_PHASE.ENGINE_START:
      return HINTS.BOOTSTRAP_ENGINE_START;
    case BOOTSTRAP_PHASE.MODEL_PULL:
      return HINTS.BOOTSTRAP_MODEL_PULL;
    case BOOTSTRAP_PHASE.MANIFEST_VERIFY:
      return HINTS.BOOTSTRAP_MANIFEST_REPAIR;
  }
}

export const TOOL_CATEGORY = Object.freeze({
  VALIDATION: "validation",
  FILE: "file",
  NETWORK: "network",
  PERMISSION: "permission",
  SCHEMA: "schema",
  TIMEOUT: "timeout",
  INTERNAL: "internal",
} as const);

export type ToolErrorCategory = typeof TOOL_CATEGORY[keyof typeof TOOL_CATEGORY];

const TOOL_CATEGORY_CLASS: Record<
  ToolErrorCategory,
  { class: ErrorClass; retryable: boolean }
> = {
  [TOOL_CATEGORY.VALIDATION]: { class: ERROR_CLASS.PERMANENT, retryable: false },
  [TOOL_CATEGORY.FILE]: { class: ERROR_CLASS.PERMANENT, retryable: false },
  [TOOL_CATEGORY.NETWORK]: { class: ERROR_CLASS.TRANSIENT, retryable: true },
  [TOOL_CATEGORY.PERMISSION]: { class: ERROR_CLASS.PERMANENT, retryable: false },
  [TOOL_CATEGORY.SCHEMA]: { class: ERROR_CLASS.PERMANENT, retryable: false },
  [TOOL_CATEGORY.TIMEOUT]: { class: ERROR_CLASS.TIMEOUT, retryable: true },
  [TOOL_CATEGORY.INTERNAL]: { class: ERROR_CLASS.UNKNOWN, retryable: false },
};

export class ToolError extends RuntimeError {
  readonly toolName: string;
  readonly category: ToolErrorCategory;
  readonly toolHint: string | null;

  constructor(
    message: string,
    toolName: string,
    category: ToolErrorCategory,
    opts?: {
      hint?: string | null;
      originalError?: Error;
      code?: UnifiedErrorCode;
    },
  ) {
    super(message, {
      code: opts?.code ?? HLVMErrorCode.TOOL_EXECUTION_FAILED,
      originalError: opts?.originalError,
    });
    this.name = "ToolError";
    this.toolName = toolName;
    this.category = category;
    this.toolHint = opts?.hint === undefined
      ? (opts?.originalError
        ? getRecoveryHintFromError(opts.originalError)
        : getRecoveryHint(message))
      : opts.hint;
  }
}

export class CancellationError extends RuntimeError {
  constructor(message = "Cancelled.") {
    super(message, { code: HLVMErrorCode.REQUEST_CANCELLED });
    this.name = "AbortError";
  }
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

export interface ErrorContext {
  command?: string;
  model?: string;
  sessionId?: string;
  lastToolName?: string;
  iteration?: number;
}

export interface ErrorChainEntry {
  name: string;
  message: string;
  code?: string | number;
}

export interface DisplayableError {
  message: string;
  hint: string | null;
  class: ErrorClass;
  retryable: boolean;
  chain?: ErrorChainEntry[];
  context?: ErrorContext;
}

const MAX_CHAIN_DEPTH = 5;

function pickErrorCode(err: Error): string | number | undefined {
  if (err instanceof RuntimeError && err.code !== undefined) {
    return err.code;
  }
  const raw = (err as { code?: unknown }).code;
  if (typeof raw === "string" || typeof raw === "number") return raw;
  return undefined;
}

export function buildErrorChain(err: unknown): ErrorChainEntry[] {
  const chain: ErrorChainEntry[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && chain.length < MAX_CHAIN_DEPTH && !seen.has(current)) {
    seen.add(current);
    if (!(current instanceof Error)) break;
    const stripped = stripErrorCodeFromMessage(current.message).trim();
    chain.push({
      name: current.name || "Error",
      message: stripped || current.message,
      code: pickErrorCode(current),
    });
    const cause = (current as { cause?: unknown }).cause;
    const original = current instanceof RuntimeError
      ? (current as unknown as { originalError?: unknown }).originalError
      : undefined;
    current = cause ?? original;
  }
  return chain;
}

export type RenderMode = "human" | "human_verbose" | "json";

export function renderDescribedError(
  described: DisplayableError,
  mode: RenderMode,
  opts?: { prefix?: string },
): string {
  if (mode === "json") {
    return JSON.stringify({
      type: "error",
      message: described.message,
      errorClass: described.class,
      retryable: described.retryable,
      hint: described.hint,
      context: described.context,
      chain: described.chain,
    });
  }

  const prefix = opts?.prefix ?? "Error";
  const header = `${prefix} (${described.class}): ${described.message}`;
  const lines: string[] = [header];
  if (described.hint) lines.push(`Hint: ${described.hint}`);

  if (mode === "human_verbose") {
    if (described.context) {
      const ctx = described.context;
      const parts: string[] = [];
      if (ctx.command) parts.push(`command=${ctx.command}`);
      if (ctx.model) parts.push(`model=${ctx.model}`);
      if (ctx.sessionId) parts.push(`session=${ctx.sessionId}`);
      if (ctx.lastToolName) parts.push(`last_tool=${ctx.lastToolName}`);
      if (ctx.iteration !== undefined) parts.push(`iteration=${ctx.iteration}`);
      if (parts.length > 0) lines.push(`Context: ${parts.join(" ")}`);
    }
    if (described.chain && described.chain.length > 1) {
      lines.push("Chain:");
      for (const entry of described.chain) {
        const codeStr = entry.code !== undefined ? ` [${entry.code}]` : "";
        lines.push(`  ${entry.name}${codeStr}: ${entry.message}`);
      }
    }
  }

  return lines.join("\n");
}

const LAST_RESORT_HINT = HINTS.LAST_RESORT;

export async function describeErrorForDisplay(
  err: unknown,
  ctx?: ErrorContext,
): Promise<DisplayableError> {
  const rawMessage = getErrorMessage(err);
  const chain = buildErrorChain(err);

  if (err instanceof AgentStreamError) {
    const message = stripErrorCodeFromMessage(rawMessage).trim() ||
      rawMessage.trim() ||
      "Unknown error";
    return {
      message,
      hint: err.streamHint,
      class: err.streamClass,
      retryable: err.streamRetryable,
      chain,
      context: ctx,
    };
  }

  if (err instanceof CancellationError) {
    return {
      message: stripErrorCodeFromMessage(rawMessage).trim() || "Cancelled.",
      hint: null,
      class: ERROR_CLASS.ABORT,
      retryable: false,
      chain,
      context: ctx,
    };
  }

  if (err instanceof BootstrapError) {
    const message = stripErrorCodeFromMessage(rawMessage).trim() ||
      rawMessage.trim() ||
      "Bootstrap failed.";
    const retryable = err.phase !== "manifest_verify";
    return {
      message,
      hint: err.bootstrapHint,
      class: retryable ? "transient" : "permanent",
      retryable,
      chain,
      context: ctx,
    };
  }

  if (err instanceof ToolError) {
    const message = stripErrorCodeFromMessage(rawMessage).trim() ||
      rawMessage.trim() ||
      "Tool failed.";
    const classification = TOOL_CATEGORY_CLASS[err.category];
    return {
      message,
      hint: err.toolHint,
      class: classification.class,
      retryable: classification.retryable,
      chain,
      context: ctx,
    };
  }

  const classified = await classifyError(err);
  const code = extractStructuredErrorCode(err, rawMessage);
  if (isUnexpectedInternalException(err) && code == null) {
    const message = stripErrorCodeFromMessage(rawMessage).trim() ||
      rawMessage.trim() ||
      "Unknown internal error";
    return {
      message: `Internal HLVM error while handling the request: ${message}`,
      hint: HINTS.INTERNAL_HLVM_BUG,
      class: ERROR_CLASS.UNKNOWN,
      retryable: false,
      chain,
      context: ctx,
    };
  }
  const message = stripErrorCodeFromMessage(rawMessage).trim() ||
    rawMessage.trim() ||
    "Unknown error";
  const explicitHint = getRecoveryHintFromError(err) ??
    (code != null ? getErrorFixes(code)[0] ?? null : null);

  const hint = explicitHint ??
    (classified.class === ERROR_CLASS.UNKNOWN ? LAST_RESORT_HINT : null);

  return {
    message,
    hint,
    class: classified.class,
    retryable: classified.retryable,
    chain,
    context: ctx,
  };
}
