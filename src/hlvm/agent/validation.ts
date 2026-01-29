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

// Intentionally minimal: keep only the shared predicate to avoid unused exports.
