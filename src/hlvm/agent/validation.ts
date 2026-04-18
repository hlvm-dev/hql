/**
 * Agent Validation Utilities
 *
 * SSOT helpers for validating tool argument shapes.
 */

import { ValidationError } from "../../common/error.ts";
import { isObjectValue, tryParseJson } from "../../common/utils.ts";
import { getAgentLogger } from "./logger.ts";

/**
 * Check if a value is a valid tool args object.
 * Tool args must be a plain object (not null, not array).
 */
export function isToolArgsObject(
  value: unknown,
): value is Record<string, unknown> {
  return isObjectValue(value) && !Array.isArray(value);
}

/**
 * Require args to be a valid object, throwing ValidationError otherwise.
 */
export function requireArgsRecord(
  args: unknown,
  toolName: string,
): Record<string, unknown> {
  if (!isToolArgsObject(args)) {
    throw new ValidationError("args must be an object", toolName);
  }
  return args;
}

/**
 * Require a non-empty string value. Throws ValidationError if the value
 * is not a string or is empty/whitespace-only. Returns the trimmed value.
 *
 * This is the SSOT for the pattern:
 *   `if (typeof x !== "string" || x.trim() === "") throw ...`
 */
export function requireNonEmptyString(
  value: unknown,
  label: string,
  toolName: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${label} must be a non-empty string`, toolName);
  }
  return value.trim();
}

function unwrapArgsObject(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const directWrapperKeys = ["parameters", "arguments", "input", "args"];
  for (const key of directWrapperKeys) {
    const wrapped = input[key];
    if (isToolArgsObject(wrapped)) {
      return wrapped;
    }
    if (typeof wrapped === "string") {
      const parsed = tryParseJson(wrapped);
      if (isToolArgsObject(parsed)) return parsed;
    }
  }

  const fnWrapper = input.function;
  if (isToolArgsObject(fnWrapper)) {
    const candidate = fnWrapper.arguments ?? fnWrapper.parameters ??
      fnWrapper.args;
    if (isToolArgsObject(candidate)) return candidate;
    if (typeof candidate === "string") {
      const parsed = tryParseJson(candidate);
      if (isToolArgsObject(parsed)) return parsed;
    }
  }

  return input;
}

export function normalizeToolArgs(
  value: unknown,
): Record<string, unknown> {
  if (!value) return {};
  if (isToolArgsObject(value)) {
    return unwrapArgsObject(value);
  }
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (isToolArgsObject(parsed)) {
      return unwrapArgsObject(parsed);
    }
  }
  // Warn for unexpected arg types (number, boolean, array, etc.)
  if (value !== null && value !== undefined) {
    getAgentLogger().debug(`normalizeToolArgs: unexpected type ${typeof value}, coercing to {}`);
  }
  return {};
}
