import { getPlatform } from "../../platform/platform.ts";
import { getServerInfoPath, type ServerInfo } from "../../common/paths.ts";

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

/**
 * Read the server info port file written by `hlvm serve`.
 * Returns the port if the file exists and contains valid JSON.
 * Stale files (from dead servers) are harmless — the health check
 * in host-client.ts will fail fast and the file will be overwritten
 * on next server start.
 */
export function readPortFromServerInfo(): number | undefined {
  const platform = getPlatform();
  try {
    const raw = platform.fs.readTextFileSync(getServerInfoPath());
    const info = JSON.parse(raw) as Partial<ServerInfo>;
    if (
      typeof info.port !== "number" || info.port < 1 || info.port > 65535
    ) {
      return undefined;
    }
    return info.port;
  } catch {
    return undefined;
  }
}

export function resolveHlvmRuntimePort(): number {
  const testOverride = getTestRuntimePortOverride();
  if (testOverride) return testOverride;

  const platform = getPlatform();
  const portOverride = platform.env.get("HLVM_REPL_PORT");
  if (portOverride) {
    const parsed = parseInt(portOverride, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 65535) {
      return parsed;
    }
  }

  // Check port file — may contain a non-default port from port-0 fallback
  const portFromFile = readPortFromServerInfo();
  if (portFromFile !== undefined) return portFromFile;

  return HLVM_RUNTIME_DEFAULT_PORT;
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
