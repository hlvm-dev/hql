/**
 * Shared validation helpers for HLVM API modules.
 */

import { ValidationError } from "../../common/error.ts";

export function assertString(
  value: unknown,
  context: string,
  message: string
): asserts value is string {
  if (!value || typeof value !== "string") {
    throw new ValidationError(message, context);
  }
}
