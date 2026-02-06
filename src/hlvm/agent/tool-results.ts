/**
 * Tool Result Helpers
 *
 * SSOT for success/failure result shapes and error formatting.
 */

import { getErrorMessage } from "../../common/utils.ts";

type ToolSuccess<T extends Record<string, unknown>> = T & {
  success: true;
};

type ToolFailure<T extends Record<string, unknown> = Record<string, never>> = T & {
  success: false;
  message: string;
};

export function okTool<T extends Record<string, unknown>>(
  data: T,
): ToolSuccess<T> {
  return { ...data, success: true };
}

export function failTool<T extends Record<string, unknown> = Record<string, never>>(
  message: string,
  extra?: T,
): ToolFailure<T> {
  return { ...(extra ?? {}), success: false, message } as ToolFailure<T>;
}

/**
 * Build a consistent tool error message and raw error string.
 */
export function formatToolError(
  prefix: string,
  error: unknown,
): { message: string; error: string } {
  const errorMsg = getErrorMessage(error);
  return {
    message: `${prefix}: ${errorMsg}`,
    error: errorMsg,
  };
}
