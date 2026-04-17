/**
 * Chrome Extension Bridge — Backend Resolution & Communication
 *
 * Simplified: no socket probing (CC doesn't probe). Just scan for
 * sockets, try to connect, handle errors.
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
 * Resolve the Chrome extension backend by scanning for active sockets.
 * No probing — just check if socket files exist. Actual connectivity
 * is verified on first request (fail-fast, like CC).
 */
export async function resolveChromeExtBackend(): Promise<ChromeExtBackendResolution> {
  if (_backendResolution) return _backendResolution;

  const log = getAgentLogger();
  const platform = getPlatform();

  // Env override
  const envSocket = platform.env.get("HLVM_CHROME_EXT_SOCKET");
  if (envSocket) {
    try {
      await platform.fs.stat(envSocket);
      _backendResolution = { backend: "extension", socketPath: envSocket };
      return _backendResolution;
    } catch { /* doesn't exist */ }
  }

  // Scan for sockets
  const socketPaths = await getAllSocketPaths();
  for (const socketPath of socketPaths) {
    try {
      await platform.fs.stat(socketPath);
      log.info(`Chrome extension socket found: ${socketPath}`);
      _backendResolution = { backend: "extension", socketPath };
      return _backendResolution;
    } catch { /* doesn't exist */ }
  }

  _backendResolution = {
    backend: "unavailable",
    reason: "No Chrome extension bridge found. Install the extension and run 'hlvm chrome-ext setup'.",
  };
  return _backendResolution;
}

// ── Socket Communication ────────────────────────────────────────────

let _requestIdCounter = 0;

function nextRequestId(): string {
  return `req_${++_requestIdCounter}_${Date.now()}`;
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Send a request to the Chrome extension via the native host socket.
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

    // Read response with timeout
    const deadline = Date.now() + REQUEST_TIMEOUT_MS;

    // Read 4-byte header
    const hdr = new Uint8Array(4);
    let hdrRead = 0;
    while (hdrRead < 4) {
      if (Date.now() > deadline) {
        throw new Error(`Chrome extension request timed out (method: ${method})`);
      }
      const n = await conn.read(hdr.subarray(hdrRead));
      if (n === null) throw new Error("Chrome extension bridge disconnected");
      hdrRead += n;
    }

    const responseLength = new DataView(hdr.buffer).getUint32(0, true);
    if (responseLength === 0 || responseLength > MAX_MESSAGE_SIZE) {
      throw new Error(`Invalid response length: ${responseLength}`);
    }

    // Read body
    const body = new Uint8Array(responseLength);
    let bodyRead = 0;
    while (bodyRead < responseLength) {
      if (Date.now() > deadline) {
        throw new Error(`Chrome extension request timed out (method: ${method})`);
      }
      const n = await conn.read(body.subarray(bodyRead));
      if (n === null) break;
      bodyRead += n;
    }

    const response: ChromeExtResponse = JSON.parse(
      new TextDecoder().decode(body.subarray(0, bodyRead)),
    );

    if (response.error) {
      throw new Error(`Chrome extension error: ${response.error}`);
    }

    return response.result as T;
  } finally {
    conn.close();
  }
}
