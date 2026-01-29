/**
 * Agent Validation Utilities
 *
 * SSOT helpers for validating tool argument shapes.
 */

import { isObjectValue } from "../../common/utils.ts";
import { ValidationError } from "../../common/error.ts";

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
 * Assert a value is a valid tool args object.
 * Throws a user-friendly error when invalid.
 */
export function assertToolArgsObject(
  value: unknown,
  context = "Arguments",
): asserts value is Record<string, unknown> {
  if (!isToolArgsObject(value)) {
    throw new ValidationError(`${context} must be a plain object`, context);
  }
}
