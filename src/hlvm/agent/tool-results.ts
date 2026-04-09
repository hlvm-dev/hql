/**
 * Tool Result Helpers
 *
 * SSOT for success/failure result shapes and error formatting.
 */

import { ValidationError } from "../../common/error.ts";
import {
  getErrorMessage,
  isObjectValue,
  truncateMiddle,
} from "../../common/utils.ts";

const MAX_NORMALIZED_FAILURE_CHARS = 10_000;

export type ToolFailureSource =
  | "validation"
  | "tool"
  | "runtime"
  | "permission"
  | "orchestrator";

export type ToolFailureKind =
  | "invalid_args"
  | "timeout"
  | "not_found"
  | "permission_denied"
  | "interrupted"
  | "unknown_tool"
  | "busy"
  | "unsupported"
  | "network"
  | "conflict"
  | "invalid_state"
  | "execution_failed"
  | "unknown";

export interface ToolFailureMetadata {
  source: ToolFailureSource;
  kind: ToolFailureKind;
  retryable: boolean;
  code?: string;
  facts?: Record<string, unknown>;
}

export interface NormalizedToolError {
  message: string;
  error: string;
  failure: ToolFailureMetadata;
}

type ToolSuccess<T extends Record<string, unknown>> = T & {
  success: true;
};

type ToolFailure<T extends Record<string, unknown> = Record<string, never>> =
  & T
  & {
    success: false;
    message: string;
    failure?: ToolFailureMetadata;
  };

export function okTool<T extends Record<string, unknown>>(
  data: T,
): ToolSuccess<T> {
  return { ...data, success: true };
}

export function failTool<
  T extends Record<string, unknown> = Record<string, never>,
>(
  message: string,
  extra?: T,
): ToolFailure<T> {
  const stderr = isObjectValue(extra) && typeof extra.stderr === "string"
    ? extra.stderr
    : undefined;
  const stdout = isObjectValue(extra) && typeof extra.stdout === "string"
    ? extra.stdout
    : undefined;
  return {
    ...(extra ?? {}),
    success: false,
    message: normalizeToolFailureText({ message, stderr, stdout }),
  } as ToolFailure<T>;
}

/**
 * Build a consistent tool error message and raw error string.
 */
export function formatToolError(
  prefix: string,
  error: unknown,
  overrides: Partial<ToolFailureMetadata> = {},
): NormalizedToolError {
  const errorMsg = normalizePrimaryErrorMessage(error);
  const normalizedMessage = normalizeToolFailureText({
    message: `${prefix}: ${errorMsg}`,
    stderr: readErrorField(error, "stderr"),
    stdout: readErrorField(error, "stdout"),
  });
  return {
    message: normalizedMessage,
    error: errorMsg,
    failure: buildToolFailureMetadata(normalizedMessage, overrides),
  };
}

export function failToolDetailed<
  T extends Record<string, unknown> = Record<string, never>,
>(
  message: string,
  failure: Partial<ToolFailureMetadata>,
  extra?: T,
): ToolFailure<T & { failure: ToolFailureMetadata }> {
  const normalizedMessage = normalizeToolFailureText({
    message,
    stderr: isObjectValue(extra) && typeof extra.stderr === "string"
      ? extra.stderr
      : undefined,
    stdout: isObjectValue(extra) && typeof extra.stdout === "string"
      ? extra.stdout
      : undefined,
  });
  return failTool(
    normalizedMessage,
    {
      ...(extra ?? {}),
      failure: buildToolFailureMetadata(normalizedMessage, failure),
    } as T & { failure: ToolFailureMetadata },
  );
}

export function normalizeToolFailureText(input: {
  message?: string;
  stderr?: string;
  stdout?: string;
}): string {
  const sections: string[] = [];
  const message = typeof input.message === "string" ? input.message.trim() : "";
  const stderr = typeof input.stderr === "string" ? input.stderr.trim() : "";
  const stdout = typeof input.stdout === "string" ? input.stdout.trim() : "";

  if (message.length > 0) {
    sections.push(message);
  }
  if (stderr.length > 0 && !message.includes(stderr)) {
    sections.push(`stderr:\n${stderr}`);
  }
  if (stdout.length > 0 && !message.includes(stdout)) {
    sections.push(`stdout:\n${stdout}`);
  }

  const combined = sections.join("\n\n") || "Unknown tool failure";
  return combined.length > MAX_NORMALIZED_FAILURE_CHARS
    ? truncateMiddle(combined, MAX_NORMALIZED_FAILURE_CHARS)
    : combined;
}

export function buildToolFailureMetadata(
  message: string,
  overrides: Partial<ToolFailureMetadata> = {},
): ToolFailureMetadata {
  const source = overrides.source ?? inferFailureSource(message);
  const kind = overrides.kind ?? inferFailureKind(message, source);
  return {
    source,
    kind,
    retryable: overrides.retryable ?? defaultRetryable(kind),
    ...(typeof overrides.code === "string" ? { code: overrides.code } : {}),
    ...(overrides.facts ? { facts: overrides.facts } : {}),
  };
}

export function isToolFailureMetadata(
  value: unknown,
): value is ToolFailureMetadata {
  return isObjectValue(value) &&
    typeof value.source === "string" &&
    typeof value.kind === "string" &&
    typeof value.retryable === "boolean";
}

function readErrorField(
  error: unknown,
  field: "stderr" | "stdout",
): string | undefined {
  if (!isObjectValue(error)) return undefined;
  const value = error[field];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function normalizePrimaryErrorMessage(error: unknown): string {
  if (error instanceof ValidationError) {
    return error.message;
  }
  if (isAbortLikeError(error)) {
    return "Operation interrupted";
  }
  const message = getErrorMessage(error).trim();
  return message.length > 0 ? message : "Unknown error";
}

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("aborted") ||
    message.includes("interrupted") ||
    message.includes("cancelled") ||
    message.includes("canceled");
}

function inferFailureSource(message: string): ToolFailureSource {
  const lower = message.toLowerCase();
  if (
    lower.includes("invalid arguments") ||
    lower.includes("missing required argument") ||
    lower.includes("unexpected argument") ||
    lower.includes("must be an object") ||
    lower.includes("expected ") && lower.includes("received ")
  ) {
    return "validation";
  }
  if (
    lower.includes("permission denied") ||
    lower.includes("denied by policy") ||
    lower.includes("not allowed")
  ) {
    return "permission";
  }
  if (
    lower.includes("tool not available") ||
    lower.includes("unknown tool:") ||
    lower.includes("tool '") && lower.includes("not found")
  ) {
    return "validation";
  }
  return "tool";
}

function inferFailureKind(
  message: string,
  source: ToolFailureSource,
): ToolFailureKind {
  const lower = message.toLowerCase();
  if (source === "validation") {
    if (
      lower.includes("tool not available") ||
      lower.includes("unknown tool:") ||
      lower.includes("tool '")
    ) {
      return "unknown_tool";
    }
    return "invalid_args";
  }
  if (source === "permission") return "permission_denied";
  if (
    lower.includes("timed out") ||
    lower.includes("timeout")
  ) {
    return "timeout";
  }
  if (
    lower.includes("aborted") ||
    lower.includes("interrupted") ||
    lower.includes("cancelled") ||
    lower.includes("canceled")
  ) {
    return "interrupted";
  }
  if (
    lower.includes("permission denied") ||
    lower.includes("denied by policy") ||
    lower.includes("not allowed")
  ) {
    return "permission_denied";
  }
  if (
    lower.includes("not found") ||
    lower.includes("no such file") ||
    lower.includes("enoent")
  ) {
    return "not_found";
  }
  if (
    lower.includes("already in use") ||
    lower.includes("busy")
  ) {
    return "busy";
  }
  if (
    lower.includes("not supported") ||
    lower.includes("unsupported")
  ) {
    return "unsupported";
  }
  if (
    lower.includes("network") ||
    lower.includes("connection") ||
    lower.includes("dns") ||
    lower.includes("econn")
  ) {
    return "network";
  }
  if (
    lower.includes("conflict") ||
    lower.includes("changed. re-read")
  ) {
    return "conflict";
  }
  if (
    lower.includes("instead of") ||
    lower.includes("invalid state")
  ) {
    return "invalid_state";
  }
  return source === "orchestrator" ? "unknown" : "execution_failed";
}

function defaultRetryable(kind: ToolFailureKind): boolean {
  switch (kind) {
    case "permission_denied":
    case "unsupported":
      return false;
    default:
      return true;
  }
}
