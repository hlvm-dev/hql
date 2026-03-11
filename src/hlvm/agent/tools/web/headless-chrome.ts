/**
 * Headless Chrome Fallback for SPA Page Rendering
 *
 * When web_fetch returns thin/empty HTML (React/Next.js SPAs, Cloudflare-protected sites),
 * silently retries using system Chrome headless via CDP (Chrome DevTools Protocol).
 *
 * - Silent: No prompts, no downloads, no config. Chrome found → use it. Not found → skip.
 * - Singleton: Launch Chrome once, reuse for all fetches, kill on session cleanup.
 * - Zero deps: Native WebSocket + CDP JSON-RPC only.
 * - SSOT compliant: getPlatform() for process, fs, env, build.
 */

import { delay } from "@std/async";
import { getPlatform } from "../../../../platform/platform.ts";
import { withTimeout } from "../../../../common/timeout-utils.ts";
import { getAgentLogger } from "../../logger.ts";
import { getErrorMessage } from "../../../../common/utils.ts";
import type { PlatformCommandProcess } from "../../../../platform/types.ts";

// ============================================================
// Chrome Detection
// ============================================================

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ],
  windows: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

/**
 * Find system Chrome binary. Returns path or null if not found.
 */
export async function findSystemChrome(): Promise<string | null> {
  const platform = getPlatform();

  // Check CHROME_PATH env var first
  const envPath = platform.env.get("CHROME_PATH");
  if (envPath) {
    if (await platform.fs.exists(envPath)) return envPath;
  }

  // Check OS-specific paths
  const candidates = CHROME_PATHS[platform.build.os] ?? [];
  for (const candidate of candidates) {
    if (await platform.fs.exists(candidate)) return candidate;
  }

  return null;
}

// ============================================================
// Minimal CDP Client
// ============================================================

interface CdpPending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

class CdpClient {
  private ws: WebSocket;
  private msgId = 0;
  private pending = new Map<number, CdpPending>();
  private events = new Map<string, Set<(params: unknown) => void>>();
  private closed = false;

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (typeof msg.id === "number") {
          const handler = this.pending.get(msg.id);
          if (handler) {
            this.pending.delete(msg.id);
            if (msg.error) {
              handler.reject(new Error(msg.error.message ?? "CDP error"));
            } else {
              handler.resolve(msg.result);
            }
          }
        } else if (typeof msg.method === "string") {
          const handlers = this.events.get(msg.method);
          if (handlers) {
            for (const fn of handlers) fn(msg.params);
          }
        }
      } catch (e) {
        getAgentLogger().debug?.(`CDP: malformed message ignored: ${e}`);
      }
    };
    this.ws.onerror = () => {
      this.rejectAll("WebSocket error");
    };
    this.ws.onclose = () => {
      this.closed = true;
      this.rejectAll("WebSocket closed");
    };
  }

  async waitOpen(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", () => reject(new Error("WebSocket connect failed")), { once: true });
    });
  }

  send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T> {
    return withTimeout(
      () => {
        const id = ++this.msgId;
        const envelope: Record<string, unknown> = { id, method, params: params ?? {} };
        if (sessionId) envelope.sessionId = sessionId;
        return new Promise<T>((resolve, reject) => {
          if (this.closed) {
            reject(new Error("WebSocket closed"));
            return;
          }
          this.pending.set(id, {
            resolve: resolve as (value: unknown) => void,
            reject,
          });
          this.ws.send(JSON.stringify(envelope));
        });
      },
      { timeoutMs: 10_000, label: `CDP ${method}` },
    );
  }

  on(event: string, handler: (params: unknown) => void): void {
    let set = this.events.get(event);
    if (!set) {
      set = new Set();
      this.events.set(event, set);
    }
    set.add(handler);
  }

  off(event: string, handler: (params: unknown) => void): void {
    this.events.get(event)?.delete(handler);
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      try { this.ws.close(); } catch { /* best-effort */ }
    }
    this.rejectAll("Client closed");
  }

  private rejectAll(reason: string): void {
    for (const [, handler] of this.pending) {
      handler.reject(new Error(reason));
    }
    this.pending.clear();
  }
}

// ============================================================
// Singleton Browser Manager
// ============================================================

let chromeProcess: PlatformCommandProcess | null = null;
let browserWsUrl: string | null = null;
let launchPromise: Promise<string | null> | null = null;
let activeRenders = 0;

async function launchChrome(): Promise<string | null> {
  const chromePath = await findSystemChrome();
  if (!chromePath) return null;

  const platform = getPlatform();
  const proc = platform.command.run({
    cmd: [
      chromePath,
      "--headless=new",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "about:blank",
    ],
    stdout: "null",
    stderr: "piped",
  });

  // Read stderr chunk-by-chunk until we find the ws:// URL.
  // Chrome's stderr stays open (long-running process), so we can't use readProcessStream
  // which reads to completion — instead read incrementally and stop as soon as we match.
  const wsUrl = await withTimeout(
    async () => {
      const stream = proc.stderr;
      if (!stream || typeof (stream as ReadableStream<Uint8Array>).getReader !== "function") {
        return null;
      }
      const reader = (stream as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) accumulated += decoder.decode(value, { stream: true });
          const match = accumulated.match(/ws:\/\/[^\s]+/);
          if (match) return match[0];
        }
      } finally {
        reader.releaseLock();
      }
      return null;
    },
    { timeoutMs: 10_000, label: "Chrome stderr read" },
  );

  if (!wsUrl) {
    proc.kill?.("SIGTERM");
    return null;
  }

  chromeProcess = proc;
  proc.unref?.();
  browserWsUrl = wsUrl;
  return browserWsUrl;
}

function ensureBrowser(): Promise<string | null> {
  if (browserWsUrl) return Promise.resolve(browserWsUrl);
  if (launchPromise) return launchPromise;

  launchPromise = launchChrome().finally(() => {
    launchPromise = null;
  });

  return launchPromise;
}

// ============================================================
// Public API
// ============================================================

/**
 * Render a URL using headless Chrome via CDP.
 * Returns the fully rendered HTML or null if Chrome unavailable or any error occurs.
 * Never throws — returns null on failure.
 */
export async function renderWithChrome(
  url: string,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const wsUrl = await ensureBrowser();
    if (!wsUrl) return null;

    activeRenders++;
    let cdp: CdpClient | undefined;
    let targetId: string | undefined;

    try {
      cdp = new CdpClient(wsUrl);
      await cdp.waitOpen();

      // Create new tab
      const target = await cdp.send<{ targetId: string }>(
        "Target.createTarget",
        { url: "about:blank" },
      );
      targetId = target.targetId;

      // Attach to target with flatten (required for sessionId routing)
      const attached = await cdp.send<{ sessionId: string }>(
        "Target.attachToTarget",
        { targetId, flatten: true },
      );
      const sessionId = attached.sessionId;

      // Enable page events
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send(
        "Page.setLifecycleEventsEnabled",
        { enabled: true },
        sessionId,
      );

      // Navigate
      await cdp.send("Page.navigate", { url }, sessionId);

      // Wait for network idle or load + grace period
      await withTimeout(
        () =>
          new Promise<void>((resolve) => {
            let loadFired = false;
            let graceTimer: number | undefined;

            const onLifecycle = (params: unknown): void => {
              const p = params as { name?: string };
              if (p.name === "networkIdle") {
                cleanup();
                resolve();
              }
            };

            const onLoad = (): void => {
              loadFired = true;
              graceTimer = setTimeout(() => {
                cleanup();
                resolve();
              }, 2000);
            };

            const cleanup = (): void => {
              cdp!.off("Page.lifecycleEvent", onLifecycle);
              cdp!.off("Page.loadEventFired", onLoad);
              if (graceTimer !== undefined) clearTimeout(graceTimer);
            };

            cdp!.on("Page.lifecycleEvent", onLifecycle);
            cdp!.on("Page.loadEventFired", onLoad);

            // If load already fired before we started listening, set grace
            if (loadFired && !graceTimer) {
              graceTimer = setTimeout(() => {
                cleanup();
                resolve();
              }, 2000);
            }
          }),
        { timeoutMs, label: "Chrome page render" },
      );

      // Extract rendered HTML
      const evalResult = await cdp.send<{ result: { value: string } }>(
        "Runtime.evaluate",
        {
          expression: "document.documentElement.outerHTML",
          returnByValue: true,
        },
        sessionId,
      );

      // Close tab (browser-level command, no sessionId)
      await cdp.send("Target.closeTarget", { targetId }).catch((e) => {
        getAgentLogger().debug?.(`CDP: closeTarget failed: ${e}`);
      });
      targetId = undefined;

      return evalResult?.result?.value ?? null;
    } finally {
      activeRenders--;
      if (targetId && cdp) {
        await cdp.send("Target.closeTarget", { targetId }).catch((e) => {
          getAgentLogger().debug?.(`CDP: cleanup closeTarget failed: ${e}`);
        });
      }
      cdp?.close();
    }
  } catch (error) {
    getAgentLogger().debug?.(
      `Chrome render failed for ${url}: ${getErrorMessage(error)}`,
    );
    return null;
  }
}

/**
 * Shut down the singleton Chrome browser process.
 * Safe to call multiple times or when no browser is running.
 */
export async function shutdownChromeBrowser(): Promise<void> {
  if (!chromeProcess) return;

  // Wait briefly for in-flight renders
  if (activeRenders > 0) {
    const deadline = Date.now() + 5000;
    while (activeRenders > 0 && Date.now() < deadline) {
      await delay(200);
    }
  }

  try {
    chromeProcess.kill?.("SIGTERM");
  } catch {
    // best-effort
  }

  chromeProcess = null;
  browserWsUrl = null;
  launchPromise = null;
  activeRenders = 0;
}
