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

import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

type ChromiumChildProcess = ChildProcessByStdio<null, Readable, Readable>;
import { log } from "../../api/log.ts";
import {
  resolveChromiumExecutablePath,
} from "../../runtime/chromium-runtime.ts";
import { getPlatform } from "../../../platform/platform.ts";
import type { PlaywrightSnapshotRef } from "./snapshot-refs.ts";
import { ToolError } from "../error-taxonomy.ts";

// Playwright types — imported dynamically to avoid loading when unused
type Browser = import("playwright-core").Browser;
type Page = import("playwright-core").Page;
type BrowserContext = import("playwright-core").BrowserContext;
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

interface BrowserTraceState {
  active: boolean;
  path: string;
  reason: string;
}

interface BrowserSessionState {
  browser?: Browser;
  browserProcess?: ChromiumChildProcess;
  context?: BrowserContext;
  page?: Page;
  isHeaded: boolean;
  launching?: Promise<Page>;
  snapshotRefs: Map<string, PlaywrightSnapshotRef>;
  activeTrace?: BrowserTraceState;
}

const DEFAULT_BROWSER_SESSION_KEY = "__default__";
const browserSessions = new Map<string, BrowserSessionState>();
const observedPages = new WeakSet<Page>();

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
    state = { isHeaded: false, snapshotRefs: new Map() };
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

function clearSnapshotRefs(state?: BrowserSessionState): void {
  state?.snapshotRefs.clear();
}

function hasConnectedBrowser(state?: BrowserSessionState): boolean {
  return !!state?.browser?.isConnected();
}

function sanitizeTraceReason(reason: string): string {
  const trimmed = reason.trim().toLowerCase();
  return trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
    "recovery";
}

function createTracePath(sessionKey: string, reason: string): string {
  const platform = getPlatform();
  const tempRoot = platform.env.get("TMPDIR") ?? "/tmp";
  return platform.path.join(
    tempRoot,
    "hlvm-playwright-traces",
    sessionKey,
    `recovery-${sanitizeTraceReason(reason)}.zip`,
  );
}

function observePageLifecycle(
  sessionKey: string,
  state: BrowserSessionState,
  page: Page,
): void {
  if (observedPages.has(page)) return;
  observedPages.add(page);

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      clearSnapshotRefs(state);
    }
  });
  page.on("close", () => {
    clearSnapshotRefs(state);
    if (state.page === page) {
      state.page = undefined;
    }
    log.debug?.(
      `Browser page closed — invalidated snapshot refs for session ${sessionKey}`,
    );
  });
}

/** Clear stale refs when browser crashes or is killed externally. */
function _onDisconnected(sessionKey: string): void {
  log.info?.(`Browser disconnected — clearing refs for session ${sessionKey}`);
  const state = browserSessions.get(sessionKey);
  if (!state) return;
  clearSnapshotRefs(state);
  state.activeTrace = undefined;
  state.browser = undefined;
  if (state.browserProcess) {
    try {
      state.browserProcess.kill("SIGTERM");
    } catch { /* already dead */ }
    state.browserProcess = undefined;
  }
  state.context = undefined;
  state.page = undefined;
  state.launching = undefined;
  state.isHeaded = false;
  clearBrowserSessionState(sessionKey);
}

/**
 * Launch Chromium ourselves and attach via `chromium.connectOverCDP()` instead
 * of `chromium.launch()`. Playwright's default pipe transport (stdio FDs 3+4)
 * deadlocks in Deno's `node:child_process` — the CDP response stream fires
 * "data" events only after the pipe is closed, so the browser launch times out
 * even though Chromium is running and responding. The WebSocket-based CDP
 * transport does not have that problem.
 */
async function launchChromiumViaCdp(
  chromiumPath: string,
  options: {
    headless: boolean;
    extraArgs?: readonly string[];
    readyTimeoutMs?: number;
  },
): Promise<{ browser: Browser; process: ChromiumChildProcess }> {
  const userDataDir = await getPlatform().fs.makeTempDir({
    prefix: "hlvm-chromium-",
  });

  // Mirror Playwright's own default Chromium switches so behaviour (hover/
  // pointer semantics, sandbox posture, disabled crash features, etc.) matches
  // what pw_* code expects — e.g. the `elementFromPoint`-based actionability
  // check in src/hlvm/agent/playwright/actionability.ts relies on the hover/
  // pointer blink-settings below.
  const args = [
    "--disable-field-trial-config",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-back-forward-cache",
    "--disable-breakpad",
    "--disable-client-side-phishing-detection",
    "--disable-component-extensions-with-background-pages",
    "--disable-component-update",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints",
    "--enable-features=CDPScreenshotNewSurface",
    "--allow-pre-commit-input",
    "--disable-hang-monitor",
    "--disable-ipc-flooding-protection",
    "--disable-popup-blocking",
    "--disable-prompt-on-repost",
    "--disable-renderer-backgrounding",
    "--force-color-profile=srgb",
    "--metrics-recording-only",
    "--no-first-run",
    "--password-store=basic",
    "--use-mock-keychain",
    "--no-service-autorun",
    "--export-tagged-pdf",
    "--disable-search-engine-choice-screen",
    "--unsafely-disable-devtools-self-xss-warnings",
    "--edge-skip-compat-layer-relaunch",
    "--enable-automation",
    "--disable-infobars",
    "--disable-sync",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    ...(options.headless
      ? [
        "--headless",
        "--hide-scrollbars",
        "--mute-audio",
        "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4",
      ]
      : []),
    ...(options.extraArgs ?? []),
  ];

  const child = spawn(chromiumPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
  let wsEndpoint: string;
  try {
    wsEndpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `Chromium did not report a DevTools endpoint within ${readyTimeoutMs}ms`,
          ),
        );
      }, readyTimeoutMs);

      let stderrBuf = "";
      child.stderr?.on("data", (data: Uint8Array) => {
        stderrBuf += new TextDecoder().decode(data);
        const match = stderrBuf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(
          new Error(
            `Chromium exited before DevTools ready (code=${code}, signal=${signal}). Stderr: ${
              stderrBuf.slice(0, 500)
            }`,
          ),
        );
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  } catch (error) {
    try {
      child.kill("SIGKILL");
    } catch { /* best-effort */ }
    throw error;
  }

  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(wsEndpoint);
  browser.on("disconnected", () => {
    try {
      child.kill("SIGTERM");
    } catch { /* already dead */ }
  });
  return { browser, process: child };
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
    clearSnapshotRefs(state);
    observePageLifecycle(sessionKey, state, state.page);
    return state.page;
  }

  // Clean stale refs
  clearSnapshotRefs(state);
  state.activeTrace = undefined;
  state.browser = undefined;
  state.context = undefined;
  state.page = undefined;

  const chromiumPath = await resolveChromiumExecutablePath();
  if (!chromiumPath) {
    throw new ToolError(
      "Chromium not available. Run `hlvm bootstrap` to install it.",
      "playwright",
      "internal",
    );
  }

  const { browser, process } = await launchChromiumViaCdp(chromiumPath, {
    headless: true,
  });
  state.browser = browser;
  state.browserProcess = process;

  state.context = await state.browser.newContext({
    viewport: { width: 1280, height: 720 },
    acceptDownloads: true,
  });
  state.page = await state.context.newPage();
  observePageLifecycle(sessionKey, state, state.page);
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

  if (state.activeTrace?.active) {
    await stopPlaywrightTraceCapture(sessionId).catch(() => {});
  }
  clearSnapshotRefs(state);

  // Close headless browser if active
  if (hasConnectedBrowser(state)) {
    log.info?.(
      `Promoting browser to headed mode for session ${sessionKey} (current URL: ${currentUrl})`,
    );
    try {
      await state.browser?.close();
    } catch { /* best-effort */ }
  }
  if (state.browserProcess) {
    try {
      state.browserProcess.kill("SIGTERM");
    } catch { /* already dead */ }
    state.browserProcess = undefined;
  }
  state.browser = undefined;
  state.context = undefined;
  state.page = undefined;
  state.launching = undefined;

  // Relaunch as headed
  const chromiumPath = await resolveChromiumExecutablePath();
  if (!chromiumPath) {
    throw new ToolError(
      "Chromium not available. Run `hlvm bootstrap` to install it.",
      "playwright",
      "internal",
    );
  }

  const promoted = await launchChromiumViaCdp(chromiumPath, {
    headless: false,
  });
  state.browser = promoted.browser;
  state.browserProcess = promoted.process;

  state.context = await state.browser.newContext(
    createBrowserContextOptions(storageState),
  );
  state.page = await state.context.newPage();
  observePageLifecycle(sessionKey, state, state.page);
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

export function resolveSnapshotRef(
  ref: string,
  sessionId?: string | null,
): PlaywrightSnapshotRef | undefined {
  return getBrowserSessionState(sessionId)?.snapshotRefs.get(ref);
}

export function replaceSnapshotRefs(
  refs: readonly PlaywrightSnapshotRef[],
  sessionId?: string | null,
): void {
  const { state } = ensureBrowserSessionState(sessionId);
  state.snapshotRefs = new Map(refs.map((item) => [item.ref, item]));
}

export function clearSnapshotRefsForSession(sessionId?: string | null): void {
  clearSnapshotRefs(getBrowserSessionState(sessionId));
}

async function currentTabs(
  sessionId?: string | null,
): Promise<{
  state: BrowserSessionState;
  pages: Page[];
}> {
  const page = await getOrCreatePage(sessionId);
  const { state } = ensureBrowserSessionState(sessionId);
  const pages = (state.context ?? page.context()).pages().filter((candidate) =>
    !candidate.isClosed()
  );
  return { state, pages };
}

export async function listBrowserTabs(
  sessionId?: string | null,
): Promise<Array<{ index: number; url: string; title: string; active: boolean }>> {
  const { state, pages } = await currentTabs(sessionId);
  return await Promise.all(
    pages.map(async (page, index) => ({
      index,
      url: page.url(),
      title: await page.title().catch(() => ""),
      active: page === state.page,
    })),
  );
}

export async function selectBrowserTab(
  index: number,
  sessionId?: string | null,
): Promise<Page> {
  const { sessionKey, state } = ensureBrowserSessionState(sessionId);
  const { pages } = await currentTabs(sessionId);
  if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
    throw new ToolError(
      `Invalid tab index: ${index}. Available range is 0-${Math.max(0, pages.length - 1)}.`,
      "playwright",
      "validation",
    );
  }
  const page = pages[index]!;
  state.page = page;
  clearSnapshotRefs(state);
  observePageLifecycle(sessionKey, state, page);
  await page.bringToFront().catch(() => {});
  return page;
}

export async function createBrowserTab(
  url: string | undefined,
  sessionId?: string | null,
): Promise<Page> {
  const { sessionKey, state } = ensureBrowserSessionState(sessionId);
  const current = await getOrCreatePage(sessionId);
  const context = state.context ?? current.context();
  const page = await context.newPage();
  observePageLifecycle(sessionKey, state, page);
  state.page = page;
  clearSnapshotRefs(state);
  if (url && url.trim().length > 0) {
    await page.goto(url.trim(), { waitUntil: "domcontentloaded" });
  }
  return page;
}

export async function closeBrowserTab(
  index: number | undefined,
  sessionId?: string | null,
): Promise<Page> {
  const { sessionKey, state } = ensureBrowserSessionState(sessionId);
  const { pages } = await currentTabs(sessionId);
  if (pages.length === 0) {
    return await getOrCreatePage(sessionId);
  }
  const activeIndex = Math.max(0, pages.findIndex((page) => page === state.page));
  const targetIndex = index ?? activeIndex;
  if (
    !Number.isInteger(targetIndex) || targetIndex < 0 ||
    targetIndex >= pages.length
  ) {
    throw new ToolError(
      `Invalid tab index: ${targetIndex}. Available range is 0-${Math.max(0, pages.length - 1)}.`,
      "playwright",
      "validation",
    );
  }

  const target = pages[targetIndex]!;
  await target.close();
  const remaining = (state.context?.pages() ?? []).filter((page) =>
    !page.isClosed()
  );
  if (remaining.length === 0) {
    const currentPage = await getOrCreatePage(sessionId);
    const context = state.context ?? currentPage.context();
    const replacement = await context.newPage();
    observePageLifecycle(sessionKey, state, replacement);
    state.page = replacement;
    clearSnapshotRefs(state);
    return replacement;
  }

  const nextIndex = Math.min(targetIndex, remaining.length - 1);
  const nextPage = remaining[nextIndex]!;
  state.page = nextPage;
  clearSnapshotRefs(state);
  observePageLifecycle(sessionKey, state, nextPage);
  await nextPage.bringToFront().catch(() => {});
  return nextPage;
}

export async function startPlaywrightTraceCapture(
  reason: string,
  sessionId?: string | null,
): Promise<string | undefined> {
  const { sessionKey, state } = ensureBrowserSessionState(sessionId);
  if (state.activeTrace?.active) return state.activeTrace.path;
  const page = getExistingPage(sessionId);
  const context = state.context ?? page?.context();
  if (!context) return undefined;

  const platform = getPlatform();
  const path = createTracePath(sessionKey, reason);
  await platform.fs.mkdir(platform.path.dirname(path), { recursive: true });
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  state.activeTrace = { active: true, path, reason };
  log.debug?.(
    `Playwright trace capture started for session ${sessionKey}: ${path}`,
  );
  return path;
}

export async function stopPlaywrightTraceCapture(
  sessionId?: string | null,
): Promise<string | undefined> {
  const state = getBrowserSessionState(sessionId);
  const activeTrace = state?.activeTrace;
  if (!state || !activeTrace?.active || !state.context) return activeTrace?.path;

  try {
    await state.context.tracing.stop({ path: activeTrace.path });
    log.debug?.(
      `Playwright trace capture saved for session ${resolveSessionKey(sessionId)}: ${activeTrace.path}`,
    );
  } finally {
    state.activeTrace = undefined;
  }
  return activeTrace.path;
}

/** Close the browser and clean up all references. */
async function closeBrowserSession(
  sessionKey: string,
  state: BrowserSessionState,
): Promise<void> {
  await stopPlaywrightTraceCapture(sessionKey).catch(() => {});
  clearSnapshotRefs(state);
  try {
    await state.browser?.close();
  } catch (err) {
    log.debug?.(
      `Browser close failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (state.browserProcess) {
    try {
      state.browserProcess.kill("SIGTERM");
    } catch { /* already dead */ }
    state.browserProcess = undefined;
  }
  state.browser = undefined;
  state.context = undefined;
  state.page = undefined;
  state.isHeaded = false;
  state.launching = undefined;
  state.activeTrace = undefined;
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
      if (state.browserProcess) {
        try {
          state.browserProcess.kill("SIGKILL");
        } catch { /* already dead */ }
      }
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
      snapshotRefs: new Map(),
    });
  },
  getSnapshotRefsForTests: (sessionId?: string): PlaywrightSnapshotRef[] =>
    [...(getBrowserSessionState(sessionId)?.snapshotRefs.values() ?? [])],
  setSnapshotRefsForTests: (
    sessionId: string,
    refs: readonly PlaywrightSnapshotRef[],
  ): void => {
    const { state } = ensureBrowserSessionState(sessionId);
    state.snapshotRefs = new Map(refs.map((item) => [item.ref, item]));
  },
  getActiveTraceForTests: (
    sessionId?: string,
  ): BrowserTraceState | undefined => getBrowserSessionState(sessionId)?.activeTrace,
  resolveSessionKey,
};
