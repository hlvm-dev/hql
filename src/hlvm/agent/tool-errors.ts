/**
 * Tool Error Helpers
 *
 * SSOT for tool error message formatting.
 */

import { getErrorMessage } from "../../common/utils.ts";

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
