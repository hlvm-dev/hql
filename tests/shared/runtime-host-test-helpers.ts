import { http } from "../../src/common/http-client.ts";
import { getRuntimeHostIdentity } from "../../src/hlvm/runtime/host-identity.ts";
import type { HostHealthResponse } from "../../src/hlvm/runtime/chat-protocol.ts";

export async function createRuntimeHostHealthResponse(
  authToken: string,
  overrides: {
    aiReady?: boolean;
    authToken?: string | null;
  } = {},
): Promise<Record<string, unknown>> {
  const identity = await getRuntimeHostIdentity();
  return {
    status: "ok",
    initialized: true,
    definitions: 0,
    aiReady: overrides.aiReady ?? true,
    version: identity.version,
    buildId: identity.buildId,
    authToken: overrides.authToken ?? authToken,
  };
}

export async function readRuntimeHealth(
  baseUrl: string,
): Promise<HostHealthResponse | null> {
  try {
    const response = await http.fetchRaw(`${baseUrl}/health`, { timeout: 500 });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return await response.json() as HostHealthResponse;
  } catch {
    return null;
  }
}

export async function shutdownRuntimeHostIfPresent(baseUrl: string): Promise<void> {
  const health = await readRuntimeHealth(baseUrl);
  if (!health?.authToken) return;

  try {
    await http.fetchRaw(`${baseUrl}/api/runtime/shutdown`, {
      method: "POST",
      timeout: 5_000,
      headers: {
        Authorization: `Bearer ${health.authToken}`,
      },
    });
  } catch {
    // Best-effort cleanup for spawned local hosts.
  }
}
