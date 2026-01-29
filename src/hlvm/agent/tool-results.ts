/**
 * Tool Result Helpers
 *
 * SSOT for success/failure result shapes.
 */

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
