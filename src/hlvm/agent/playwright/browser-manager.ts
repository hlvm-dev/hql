/**
 * Playwright Browser Manager — Singleton per session
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

let _browser: Browser | undefined;
let _context: BrowserContext | undefined;
let _page: Page | undefined;
let _isHeaded = false;
let _launching: Promise<Page> | undefined; // race condition guard

/**
 * Get or create the shared browser page.
 * First call launches Chromium in headless mode.
 * Subsequent calls reuse the same page.
 * Concurrent calls wait for the first launch to complete (no double-launch).
 * Throws if Chromium is not installed.
 */
export async function getOrCreatePage(): Promise<Page> {
  // Fix: check BOTH page open AND browser connected (stale page after crash)
  if (_page && !_page.isClosed() && _browser?.isConnected()) return _page;

  // Race guard: if another call is already launching, wait for it
  if (_launching) return _launching;

  _launching = _launchOrRecover();
  try {
    return await _launching;
  } finally {
    _launching = undefined;
  }
}

async function _launchOrRecover(): Promise<Page> {
  // Browser connected but page closed — create new page
  if (_browser?.isConnected()) {
    _context = _context ?? _browser.contexts()[0] ?? await _browser.newContext();
    const existingPage = _context.pages().find((p) => !p.isClosed());
    _page = existingPage ?? await _context.newPage();
    return _page;
  }

  // Clean stale refs
  _browser = undefined;
  _context = undefined;
  _page = undefined;

  const chromiumPath = await resolveChromiumExecutablePath();
  if (!chromiumPath) {
    throw new Error(
      "Chromium not available. Run `hlvm bootstrap` to install it.",
    );
  }

  const { chromium } = await import("playwright-core");

  _browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
    ],
  });

  _context = await _browser.newContext();
  _page = await _context.newPage();
  _isHeaded = false;

  log.info?.(`Browser launched (headless): ${chromiumPath}`);
  return _page;
}

/**
 * Promote the browser from headless to headed (visible window).
 *
 * Called explicitly by pw_promote when the LLM needs CU visual interaction.
 * Current page URL is preserved, but in-memory state (SPA, forms, WebSocket
 * connections) will be lost — the LLM should re-navigate if needed.
 *
 * If browser is already headed, returns the current page.
 * If no browser is running, launches headed directly.
 */
export async function promoteToHeaded(): Promise<Page> {
  if (_isHeaded && _page && !_page.isClosed() && _browser?.isConnected()) {
    return _page;
  }

  const currentUrl = _page?.url() ?? "about:blank";

  // Close headless browser if active
  if (_browser?.isConnected()) {
    log.info?.(`Promoting browser to headed mode (current URL: ${currentUrl})`);
    try { await _browser.close(); } catch { /* best-effort */ }
  }
  _browser = undefined;
  _context = undefined;
  _page = undefined;

  // Relaunch as headed
  const chromiumPath = await resolveChromiumExecutablePath();
  if (!chromiumPath) {
    throw new Error("Chromium not available. Run `hlvm bootstrap` to install it.");
  }

  const { chromium } = await import("playwright-core");

  _browser = await chromium.launch({
    headless: false,
    executablePath: chromiumPath,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
    ],
  });

  _context = await _browser.newContext();
  _page = await _context.newPage();
  _isHeaded = true;

  // Restore URL (best-effort — state will be lost)
  if (currentUrl !== "about:blank") {
    try {
      await _page.goto(currentUrl, { waitUntil: "domcontentloaded" });
    } catch (err) {
      log.debug?.(
        `URL restore after promote failed (${currentUrl}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  log.info?.(`Browser promoted to headed mode: ${chromiumPath}`);
  return _page;
}

/** Close the browser and clean up all references. */
export async function closeBrowser(): Promise<void> {
  try {
    await _browser?.close();
  } catch (err) {
    log.debug?.(
      `Browser close failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  _browser = undefined;
  _context = undefined;
  _page = undefined;
  _isHeaded = false;
  _launching = undefined;
}

/** Whether a browser is currently active and connected. */
export function isBrowserActive(): boolean {
  return !!_browser?.isConnected();
}

/** Whether the browser is in headed (visible) mode. */
export function isHeaded(): boolean {
  return _isHeaded;
}
