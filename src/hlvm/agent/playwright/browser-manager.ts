/**
 * Playwright Browser Manager — Browser state scoped by agent session
 *
 * Manages a single Chromium browser instance launched from HLVM's
 * bundled Chromium directory (~/.hlvm/.runtime/chromium/).
 *
 * HEADLESS-FIRST: Browser starts headless (invisible). If the LLM needs
 * CU visual interaction (CAPTCHA, native dialog), it calls pw_promote
 * to make the browser visible. Most tasks complete without promoting.
 *
 * 3-layer escalation:
 *   Layer 1: pw_* headless     → fast, invisible, 80% of tasks
 *   Layer 2: pw_* + cu_* headed → pw_promote makes window visible
 *   Layer 3: cu_* only          → native desktop, no browser
 */

import { log } from "../../api/log.ts";
import {
  resolveChromiumExecutablePath,
} from "../../runtime/chromium-runtime.ts";

// Playwright types — imported dynamically to avoid loading when unused
type Browser = import("playwright-core").Browser;
type Page = import("playwright-core").Page;
type BrowserContext = import("playwright-core").BrowserContext;
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

interface BrowserSessionState {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  isHeaded: boolean;
  launching?: Promise<Page>;
}

const DEFAULT_BROWSER_SESSION_KEY = "__default__";
const browserSessions = new Map<string, BrowserSessionState>();

function resolveSessionKey(sessionId?: string | null): string {
  const trimmed = typeof sessionId === "string" ? sessionId.trim() : "";
  return trimmed || DEFAULT_BROWSER_SESSION_KEY;
}

function ensureBrowserSessionState(
  sessionId?: string | null,
): { sessionKey: string; state: BrowserSessionState } {
  const sessionKey = resolveSessionKey(sessionId);
  let state = browserSessions.get(sessionKey);
  if (!state) {
    state = { isHeaded: false };
    browserSessions.set(sessionKey, state);
  }
  return { sessionKey, state };
}

function getBrowserSessionState(
  sessionId?: string | null,
): BrowserSessionState | undefined {
  return browserSessions.get(resolveSessionKey(sessionId));
}

function clearBrowserSessionState(sessionKey: string): void {
  browserSessions.delete(sessionKey);
}

function hasConnectedBrowser(state?: BrowserSessionState): boolean {
  return !!state?.browser?.isConnected();
}

/** Clear stale refs when browser crashes or is killed externally. */
function _onDisconnected(sessionKey: string): void {
  log.info?.(`Browser disconnected — clearing refs for session ${sessionKey}`);
  const state = browserSessions.get(sessionKey);
  if (!state) return;
  state.browser = undefined;
  state.context = undefined;
  state.page = undefined;
  state.launching = undefined;
  state.isHeaded = false;
  clearBrowserSessionState(sessionKey);
}

/**
 * Get or create the shared browser page.
 * First call launches Chromium in headless mode.
 * Subsequent calls reuse the same page.
 * Concurrent calls wait for the first launch to complete (no double-launch).
 * Throws if Chromium is not installed.
 */
export async function getOrCreatePage(
  sessionId?: string | null,
): Promise<Page> {
  const { sessionKey, state } = ensureBrowserSessionState(sessionId);
  if (state.page && !state.page.isClosed() && hasConnectedBrowser(state)) {
    return state.page;
  }

  // Race guard: if another call is already launching, wait for it
  if (state.launching) return state.launching;

  state.launching = _launchOrRecover(sessionKey, state);
  try {
    return await state.launching;
  } finally {
    if (browserSessions.get(sessionKey) === state) {
      state.launching = undefined;
      if (
        !state.browser && !state.context && !state.page && !state.isHeaded
      ) {
        clearBrowserSessionState(sessionKey);
      }
    }
  }
}

/** Return the active page only when a connected browser/page already exists. */
export function getExistingPage(sessionId?: string | null): Page | undefined {
  const state = getBrowserSessionState(sessionId);
  if (state?.page && !state.page.isClosed() && hasConnectedBrowser(state)) {
    return state.page;
  }
  return undefined;
}

async function _launchOrRecover(
  sessionKey: string,
  state: BrowserSessionState,
): Promise<Page> {
  // Browser connected but page closed — create new page
  if (hasConnectedBrowser(state) && state.browser) {
    state.context = state.context ?? state.browser.contexts()[0] ??
      await state.browser.newContext();
    const existingPage = state.context.pages().find((p) => !p.isClosed());
    state.page = existingPage ?? await state.context.newPage();
    return state.page;
  }

  // Clean stale refs
  state.browser = undefined;
  state.context = undefined;
  state.page = undefined;

  const chromiumPath = await resolveChromiumExecutablePath();
  if (!chromiumPath) {
    throw new Error(
      "Chromium not available. Run `hlvm bootstrap` to install it.",
    );
  }

  const { chromium } = await import("playwright-core");

  state.browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
    ],
  });

  state.context = await state.browser.newContext({
    viewport: { width: 1280, height: 720 },
    acceptDownloads: true,
  });
  state.page = await state.context.newPage();
  state.isHeaded = false;
  state.browser.on("disconnected", () => _onDisconnected(sessionKey));

  log.info?.(
    `Browser launched (headless, 1280x720) for session ${sessionKey}: ${chromiumPath}`,
  );
  return state.page;
}

function createBrowserContextOptions(storageState?: StorageState): {
  viewport: { width: number; height: number };
  acceptDownloads: boolean;
  storageState?: StorageState;
} {
  return {
    viewport: { width: 1280, height: 720 },
    acceptDownloads: true,
    ...(storageState ? { storageState } : {}),
  };
}

/**
 * Promote the browser from headless to headed (visible window).
 *
 * Called explicitly by pw_promote when the LLM needs CU visual interaction.
 * Current page URL plus storage-backed session state are restored best-effort,
 * but transient in-memory state is not guaranteed.
 *
 * If browser is already headed, returns the current page.
 * If no browser is running, launches headed directly.
 */
export async function promoteToHeaded(
  sessionId?: string | null,
): Promise<Page> {
  const { sessionKey, state } = ensureBrowserSessionState(sessionId);
  if (
    state.isHeaded && state.page && !state.page.isClosed() &&
    hasConnectedBrowser(state)
  ) {
    return state.page;
  }

  const currentUrl = state.page?.url() ?? "about:blank";
  const storageState = state.context
    ? await state.context.storageState().catch((err) => {
      log.debug?.(
        `Storage-state capture before promote failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    })
    : undefined;

  // Close headless browser if active
  if (hasConnectedBrowser(state)) {
    log.info?.(
      `Promoting browser to headed mode for session ${sessionKey} (current URL: ${currentUrl})`,
    );
    try {
      await state.browser?.close();
    } catch { /* best-effort */ }
  }
  state.browser = undefined;
  state.context = undefined;
  state.page = undefined;
  state.launching = undefined;

  // Relaunch as headed
  const chromiumPath = await resolveChromiumExecutablePath();
  if (!chromiumPath) {
    throw new Error(
      "Chromium not available. Run `hlvm bootstrap` to install it.",
    );
  }

  const { chromium } = await import("playwright-core");

  state.browser = await chromium.launch({
    headless: false,
    executablePath: chromiumPath,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
    ],
  });

  state.context = await state.browser.newContext(
    createBrowserContextOptions(storageState),
  );
  state.page = await state.context.newPage();
  state.isHeaded = true;
  state.browser.on("disconnected", () => _onDisconnected(sessionKey));

  // Restore URL after recreating the context with storage-backed session state.
  if (currentUrl !== "about:blank") {
    try {
      await state.page.goto(currentUrl, { waitUntil: "domcontentloaded" });
    } catch (err) {
      log.debug?.(
        `URL restore after promote failed (${currentUrl}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  log.info?.(
    `Browser promoted to headed mode for session ${sessionKey}: ${chromiumPath}`,
  );
  return state.page;
}

/** Close the browser and clean up all references. */
async function closeBrowserSession(
  sessionKey: string,
  state: BrowserSessionState,
): Promise<void> {
  try {
    await state.browser?.close();
  } catch (err) {
    log.debug?.(
      `Browser close failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  state.browser = undefined;
  state.context = undefined;
  state.page = undefined;
  state.isHeaded = false;
  state.launching = undefined;
  clearBrowserSessionState(sessionKey);
}

export async function closeBrowser(sessionId?: string | null): Promise<void> {
  if (typeof sessionId === "string" && sessionId.trim().length > 0) {
    const sessionKey = resolveSessionKey(sessionId);
    const state = browserSessions.get(sessionKey);
    if (!state) return;
    await closeBrowserSession(sessionKey, state);
    return;
  }
  const entries = [...browserSessions.entries()];
  await Promise.allSettled(
    entries.map(([sessionKey, state]) =>
      closeBrowserSession(sessionKey, state)
    ),
  );
}

/** Whether a browser is currently active and connected. */
export function isBrowserActive(sessionId?: string | null): boolean {
  if (typeof sessionId === "string" && sessionId.trim().length > 0) {
    return hasConnectedBrowser(getBrowserSessionState(sessionId));
  }
  return [...browserSessions.values()].some((state) =>
    hasConnectedBrowser(state)
  );
}

/** Whether the browser is in headed (visible) mode. */
export function isHeaded(sessionId?: string | null): boolean {
  if (typeof sessionId === "string" && sessionId.trim().length > 0) {
    return getBrowserSessionState(sessionId)?.isHeaded === true;
  }
  return [...browserSessions.values()].some((state) => state.isHeaded);
}

// Kill Chromium on process exit (Ctrl+C, SIGTERM) to prevent orphans
try {
  globalThis.addEventListener("unload", () => {
    for (const state of browserSessions.values()) {
      state.browser?.close().catch(() => {});
    }
  });
} catch { /* globalThis.addEventListener not available */ }

/** Reset module state for tests. */
export function _resetBrowserStateForTests(): void {
  browserSessions.clear();
}

export const _testOnly = {
  createBrowserContextOptions,
  getBrowserSessionKeysForTests: (): string[] =>
    [...browserSessions.keys()].sort(),
  primeBrowserSessionForTests: (
    sessionId: string,
    options: { headed?: boolean; connected?: boolean; pageClosed?: boolean } =
      {},
  ): void => {
    const { sessionKey } = ensureBrowserSessionState(sessionId);
    let connected = options.connected !== false;
    let pageClosed = options.pageClosed === true;
    browserSessions.set(sessionKey, {
      browser: {
        isConnected: () => connected,
        close: async () => {
          connected = false;
        },
      } as Browser,
      page: {
        isClosed: () => pageClosed,
      } as Page,
      isHeaded: options.headed === true,
    });
  },
  resolveSessionKey,
};
