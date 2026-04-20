import { http } from "../../src/common/http-client.ts";
import { getRuntimeHostIdentity } from "../../src/hlvm/runtime/host-identity.ts";
import type { HostHealthResponse } from "../../src/hlvm/runtime/chat-protocol.ts";
import { getPlatform } from "../../src/platform/platform.ts";

const RUNTIME_HOST_SHUTDOWN_GRACE_MS = 250;
const RUNTIME_HOST_POLL_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createRuntimeHostHealthResponse(
  authToken: string,
  overrides: {
    activeRequests?: number;
    aiReady?: boolean;
    aiReadyReason?: string | null;
    aiReadyRetryable?: boolean;
    authToken?: string | null;
  } = {},
): Promise<Record<string, unknown>> {
  const identity = await getRuntimeHostIdentity();
  return {
    status: "ok",
    initialized: true,
    definitions: 0,
    activeRequests: overrides.activeRequests ?? 0,
    aiReady: overrides.aiReady ?? true,
    aiReadyReason: overrides.aiReadyReason ?? null,
    aiReadyRetryable: overrides.aiReadyRetryable ??
      (overrides.aiReady === false),
    version: identity.version,
    buildId: identity.buildId,
    authToken: overrides.authToken ?? authToken,
  };
}

async function readRuntimeHealth(
  baseUrl: string,
): Promise<HostHealthResponse | null> {
  let response: Response | null = null;
  try {
    response = await http.fetchRaw(`${baseUrl}/health`, { timeout: 500 });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return await response.json() as HostHealthResponse;
  } catch {
    await response?.body?.cancel().catch(() => {});
    return null;
  }
}

export async function waitForRuntimeHostShutdown(
  baseUrl: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await readRuntimeHealth(baseUrl);
    if (!health) return true;
    await sleep(RUNTIME_HOST_POLL_MS);
  }
  return (await readRuntimeHealth(baseUrl)) === null;
}

export interface RuntimeHostLifecycleDiagnostics {
  port: number;
  healthTransitions: string[];
  shutdownRequested: boolean;
  shutdownObserved: boolean;
  endedBeforeToolEnd: boolean;
  endedBeforeComplete: boolean;
}

export interface RuntimeHostLifecycleProbe {
  noteShutdownRequested(): void;
  noteShutdownObserved(): void;
  snapshot(outputText?: string): RuntimeHostLifecycleDiagnostics;
  stop(): Promise<void>;
}

function classifyOutputLifecycle(
  outputText: string,
): Pick<
  RuntimeHostLifecycleDiagnostics,
  "endedBeforeToolEnd" | "endedBeforeComplete"
> {
  const normalized = outputText.replace(/\r/g, "");
  const sawToolEnd = normalized.includes("[Tool Result]") ||
    normalized.includes("[Tool Error]");
  const sawComplete = normalized.includes("Result:\n") ||
    normalized.includes('"type":"complete"');
  return {
    endedBeforeToolEnd: !sawToolEnd,
    endedBeforeComplete: !sawComplete,
  };
}

export function createRuntimeHostLifecycleProbe(
  baseUrl: string,
  port: number,
): RuntimeHostLifecycleProbe {
  let shutdownRequested = false;
  let shutdownObserved = false;
  let stopped = false;
  let lastState: "up" | "down" | null = null;
  const healthTransitions = [`port:${port}`];

  const loop = (async () => {
    while (!stopped) {
      const state = (await readRuntimeHealth(baseUrl)) ? "up" : "down";
      if (state !== lastState) {
        healthTransitions.push(`health:${state}`);
        lastState = state;
      }
      await sleep(RUNTIME_HOST_POLL_MS);
    }
  })();

  return {
    noteShutdownRequested(): void {
      shutdownRequested = true;
      healthTransitions.push("shutdown:requested");
    },
    noteShutdownObserved(): void {
      shutdownObserved = true;
      healthTransitions.push("shutdown:observed");
    },
    snapshot(outputText = ""): RuntimeHostLifecycleDiagnostics {
      return {
        port,
        healthTransitions: [...healthTransitions],
        shutdownRequested,
        shutdownObserved,
        ...classifyOutputLifecycle(outputText),
      };
    },
    async stop(): Promise<void> {
      stopped = true;
      await loop.catch(() => undefined);
    },
  };
}

export function formatRuntimeHostLifecycleDiagnostics(
  diagnostics: RuntimeHostLifecycleDiagnostics,
): string {
  return [
    "[Runtime Host Diagnostics]",
    `port=${diagnostics.port}`,
    `health=${diagnostics.healthTransitions.join(" -> ")}`,
    `shutdown_requested=${diagnostics.shutdownRequested}`,
    `shutdown_observed=${diagnostics.shutdownObserved}`,
    `ended_before_tool_end=${diagnostics.endedBeforeToolEnd}`,
    `ended_before_complete=${diagnostics.endedBeforeComplete}`,
  ].join("\n");
}

export function createMonotonicPortAllocator(): () => Promise<number> {
  const platform = getPlatform();
  let nextPort: number | null = null;

  async function canBindPort(port: number): Promise<boolean> {
    if (!platform.http.serveWithHandle) {
      return true;
    }
    try {
      const handle = platform.http.serveWithHandle(
        () => new Response("ok"),
        {
          hostname: "127.0.0.1",
          port,
          onListen: () => {},
        },
      );
      await handle.shutdown();
      await handle.finished;
      return true;
    } catch {
      return false;
    }
  }

  return async (): Promise<number> => {
    let candidate = nextPort ?? await platform.http.findFreePort();
    while (!(await canBindPort(candidate))) {
      candidate += 1;
    }
    nextPort = candidate + 1;
    return candidate;
  };
}

export async function shutdownRuntimeHostIfPresent(
  baseUrl: string,
  options: {
    probe?: RuntimeHostLifecycleProbe;
    graceMs?: number;
  } = {},
): Promise<void> {
  const { probe, graceMs = RUNTIME_HOST_SHUTDOWN_GRACE_MS } = options;
  const health = await readRuntimeHealth(baseUrl);
  if (!health?.authToken) return;
  probe?.noteShutdownRequested();

  try {
    const response = await http.fetchRaw(`${baseUrl}/api/runtime/shutdown`, {
      method: "POST",
      timeout: 5_000,
      headers: {
        Authorization: `Bearer ${health.authToken}`,
      },
    });
    await response.body?.cancel().catch(() => {});
  } catch {
    // Best-effort cleanup for spawned local hosts.
  }

  const observedShutdown = await waitForRuntimeHostShutdown(baseUrl);
  if (observedShutdown) {
    probe?.noteShutdownObserved();
    if (graceMs > 0) {
      await sleep(graceMs);
    }
  }
}
