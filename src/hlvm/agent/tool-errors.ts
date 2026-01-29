/**
 * Tool Error Helpers
 *
 * SSOT for tool error message formatting.
 */

import { getErrorMessage } from "../../common/utils.ts";

export interface ToolErrorInfo {
  message: string;
  error: string;
}

/**
 * Build a consistent tool error message and raw error string.
 */
export function formatToolError(
  prefix: string,
  error: unknown,
): ToolErrorInfo {
  const errorMsg = getErrorMessage(error);
  return {
    message: `${prefix}: ${errorMsg}`,
    error: errorMsg,
  };
}
