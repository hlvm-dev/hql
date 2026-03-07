import { getPlatform } from "../../platform/platform.ts";

export const HLVM_RUNTIME_DEFAULT_PORT = 11435;

export function resolveHlvmRuntimePort(): number {
  const platform = getPlatform();
  const portOverride = platform.env.get("HLVM_REPL_PORT");
  if (!portOverride) return HLVM_RUNTIME_DEFAULT_PORT;

  const parsed = parseInt(portOverride, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
    return HLVM_RUNTIME_DEFAULT_PORT;
  }
  return parsed;
}

export function getHlvmRuntimeBaseUrl(): string {
  return `http://127.0.0.1:${resolveHlvmRuntimePort()}`;
}
