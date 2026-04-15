/**
 * Chrome Extension Bridge — Backend Resolution & Communication
 *
 * Pattern copied from computer-use/bridge.ts:
 * - Socket-based backend resolution (instead of HTTP port probe)
 * - Cached resolution with invalidation on fresh lock
 * - Request/response dispatch through Unix socket
 *
 * ── SSOT compliance ─────────────────────────────────────────────────
 * Uses getPlatform().fs, getAgentLogger() — never raw Deno.* or console.*
 */

import { getPlatform } from "../../../platform/platform.ts";
import { getAgentLogger } from "../logger.ts";
import type {
  ChromeExtBackendResolution,
  ChromeExtRequest,
  ChromeExtResponse,
} from "./types.ts";
import { getAllSocketPaths, MAX_MESSAGE_SIZE } from "./common.ts";

// ── Cached Resolution ───────────────────────────────────────────────

let _backendResolution: ChromeExtBackendResolution | undefined;

export function invalidateChromeExtResolution(): void {
  _backendResolution = undefined;
}

export function getResolvedChromeExtBackend(): ChromeExtBackendResolution | undefined {
  return _backendResolution;
}

/**
 * Resolve the Chrome extension backend by checking for active native host sockets.
 *
 * Unlike CU bridge (HTTP probe), this checks for Unix socket existence and
 * validates with a ping message.
 */
export async function resolveChromeExtBackend(): Promise<ChromeExtBackendResolution> {
  if (_backendResolution) return _backendResolution;

  const log = getAgentLogger();
  const platform = getPlatform();

  // Check for env override
  const envSocket = platform.env.get("HLVM_CHROME_EXT_SOCKET");
  if (envSocket) {
    try {
      const info = await platform.fs.stat(envSocket);
      if (info) {
        log.debug(`Chrome extension socket from env: ${envSocket}`);
        _backendResolution = { backend: "extension", socketPath: envSocket };
        return _backendResolution;
      }
    } catch {
      // Socket doesn't exist
    }
  }

  // Scan for active sockets
  const socketPaths = await getAllSocketPaths();
  for (const socketPath of socketPaths) {
    try {
      const info = await platform.fs.stat(socketPath);
      if (!info) continue;

      // Validate socket is alive with a ping
      const alive = await probeChromeExtSocket(socketPath);
      if (alive) {
        log.info(`Chrome extension backend resolved: ${socketPath}`);
        _backendResolution = { backend: "extension", socketPath };
        return _backendResolution;
      }

      // Dead socket, clean up
      log.debug(`Removing dead Chrome extension socket: ${socketPath}`);
      try {
        await platform.fs.remove(socketPath);
      } catch {
        // Ignore
      }
    } catch {
      // Socket doesn't exist
    }
  }

  _backendResolution = {
    backend: "unavailable",
    reason:
      "No active Chrome extension bridge found. Install the HLVM Chrome Extension and run 'hlvm chrome-ext setup'.",
  };
  return _backendResolution;
}

// ── Socket Communication ────────────────────────────────────────────

let _requestIdCounter = 0;

function nextRequestId(): string {
  return `req_${++_requestIdCounter}_${Date.now()}`;
}

/** Default timeout for chrome extension requests (30 seconds). */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Send a request to the Chrome extension via the native host socket.
 * Uses the same 4-byte LE length-prefix protocol as the native host.
 */
export async function chromeExtRequest<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const resolution = await resolveChromeExtBackend();
  if (resolution.backend !== "extension") {
    throw new Error(resolution.reason);
  }

  const id = nextRequestId();
  const request: ChromeExtRequest = { id, method, params };

  const conn = await Deno.connect({
    transport: "unix",
    path: resolution.socketPath,
  });

  try {
    // Send request with length prefix
    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(JSON.stringify(request));
    const lengthBuffer = new Uint8Array(4);
    new DataView(lengthBuffer.buffer).setUint32(0, jsonBytes.length, true);

    await conn.write(lengthBuffer);
    await conn.write(jsonBytes);

    // Read response (length prefix + body) with timeout
    const deadline = Date.now() + REQUEST_TIMEOUT_MS;

    const responseLengthBuf = new Uint8Array(4);
    let headerRead = 0;
    while (headerRead < 4) {
      if (Date.now() > deadline) {
        throw new Error(
          `Chrome extension request timed out after ${REQUEST_TIMEOUT_MS}ms (method: ${method})`,
        );
      }
      const n = await conn.read(responseLengthBuf.subarray(headerRead));
      if (n === null) {
        throw new Error("Chrome extension bridge disconnected");
      }
      headerRead += n;
    }

    const responseLength = new DataView(
      responseLengthBuf.buffer,
    ).getUint32(0, true);

    if (responseLength === 0 || responseLength > MAX_MESSAGE_SIZE) {
      throw new Error(
        `Invalid response length from Chrome extension: ${responseLength}`,
      );
    }

    const responseBytes = new Uint8Array(responseLength);
    let totalRead = 0;
    while (totalRead < responseLength) {
      if (Date.now() > deadline) {
        throw new Error(
          `Chrome extension request timed out after ${REQUEST_TIMEOUT_MS}ms (method: ${method})`,
        );
      }
      const n = await conn.read(responseBytes.subarray(totalRead));
      if (n === null) break;
      totalRead += n;
    }

    const response: ChromeExtResponse = JSON.parse(
      new TextDecoder().decode(responseBytes.subarray(0, totalRead)),
    );

    if (response.error) {
      throw new Error(`Chrome extension error: ${response.error}`);
    }

    return response.result as T;
  } finally {
    conn.close();
  }
}

/**
 * Probe a socket to check if the native host is alive.
 * Connects, sends a ping, checks we get any response within 2s.
 */
async function probeChromeExtSocket(socketPath: string): Promise<boolean> {
  try {
    const conn = await Deno.connect({
      transport: "unix",
      path: socketPath,
    });

    try {
      // Send ping with length prefix
      const encoder = new TextEncoder();
      const pingPayload = encoder.encode(
        JSON.stringify({ id: "probe", method: "ping" }),
      );
      const frame = new Uint8Array(4 + pingPayload.length);
      new DataView(frame.buffer).setUint32(0, pingPayload.length, true);
      frame.set(pingPayload, 4);
      await conn.write(frame);

      // Read response length prefix (4 bytes) with timeout
      const buf = new Uint8Array(4);
      let totalRead = 0;
      const deadline = Date.now() + 2000;

      while (totalRead < 4 && Date.now() < deadline) {
        const n = await conn.read(buf.subarray(totalRead));
        if (n === null) return false;
        totalRead += n;
      }

      return totalRead === 4; // Got a response header = alive
    } finally {
      conn.close();
    }
  } catch {
    return false;
  }
}
