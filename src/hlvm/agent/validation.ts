/**
 * Agent Validation Utilities
 *
 * SSOT helpers for validating tool argument shapes.
 */

import { isObjectValue } from "../../common/utils.ts";

/**
 * Check if a value is a valid tool args object.
 * Tool args must be a plain object (not null, not array).
 */
export function isToolArgsObject(
  value: unknown,
): value is Record<string, unknown> {
  return isObjectValue(value) && !Array.isArray(value);
}

function parseJsonArgs(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function unwrapArgsObject(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const directWrapperKeys = ["parameters", "input", "args"];
  for (const key of directWrapperKeys) {
    const wrapped = input[key];
    if (isToolArgsObject(wrapped)) {
      return wrapped;
    }
    if (typeof wrapped === "string") {
      const parsed = parseJsonArgs(wrapped);
      if (isToolArgsObject(parsed)) return parsed;
    }
  }

  const fnWrapper = input.function;
  if (isToolArgsObject(fnWrapper)) {
    const candidate = fnWrapper.arguments ?? fnWrapper.parameters ??
      fnWrapper.args;
    if (isToolArgsObject(candidate)) return candidate;
    if (typeof candidate === "string") {
      const parsed = parseJsonArgs(candidate);
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
    const parsed = parseJsonArgs(value);
    if (isToolArgsObject(parsed)) {
      return unwrapArgsObject(parsed);
    }
  }
  return {};
}
