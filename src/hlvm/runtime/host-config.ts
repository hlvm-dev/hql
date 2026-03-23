import { getPlatform } from "../../platform/platform.ts";

export const HLVM_RUNTIME_DEFAULT_PORT = 11435;
const TEST_RUNTIME_PORT_OVERRIDE_KEY = "__HLVM_RUNTIME_PORT_OVERRIDE__";

type RuntimeHostConfigGlobal = typeof globalThis & {
  [TEST_RUNTIME_PORT_OVERRIDE_KEY]?: number;
};

function getTestRuntimePortOverride(): number | undefined {
  const override = (globalThis as RuntimeHostConfigGlobal)[TEST_RUNTIME_PORT_OVERRIDE_KEY];
  return typeof override === "number" && Number.isInteger(override) && override > 0
    ? override
    : undefined;
}

export function resolveHlvmRuntimePort(): number {
  const testOverride = getTestRuntimePortOverride();
  if (testOverride) return testOverride;

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

export async function withRuntimePortOverrideForTests<T>(
  port: number,
  fn: () => Promise<T>,
): Promise<T> {
  const globals = globalThis as RuntimeHostConfigGlobal;
  const previous = globals[TEST_RUNTIME_PORT_OVERRIDE_KEY];
  globals[TEST_RUNTIME_PORT_OVERRIDE_KEY] = port;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete globals[TEST_RUNTIME_PORT_OVERRIDE_KEY];
    } else {
      globals[TEST_RUNTIME_PORT_OVERRIDE_KEY] = previous;
    }
  }
}
