/**
 * Computer Use — Cleanup (CC clone)
 *
 * CC original: utils/computerUse/cleanup.ts (86 lines)
 *
 * ── Bridge changes from CC ────────────────────────────────────────────────
 * - `ToolUseContext` → simplified interface (HLVM doesn't have CC's context)
 * - `withResolvers` → inline Promise.withResolvers equivalent
 * - Dynamic import path: `./executor.js` → `./executor.ts`
 * - `ctx.sendOSNotification` → `getAgentLogger().info()` (no OS notification API)
 *
 * ALL TS logic (unhide timeout, esc unregister, lock release sequence) is
 * IDENTICAL to CC.
 */

import { getAgentLogger } from "../logger.ts";
import { isLockHeldLocally, releaseComputerUseLock } from "./lock.ts";
import { unregisterEscHotkey } from "./esc-hotkey.ts";
import { takeHiddenComputerUseApps } from "./session-state.ts";

// CC: cu.apps.unhide timeout — generous because unhide should be ~instant
const UNHIDE_TIMEOUT_MS = 5000;

/**
 * Simplified context interface for HLVM.
 * CC uses `ToolUseContext` with `getAppState/setAppState/sendOSNotification`.
 */
export interface CleanupContext {
  /** Get the set of app bundle IDs hidden during this turn. */
  getHiddenApps?: () => Set<string> | undefined;
  /** Clear the hidden apps set after unhide. */
  clearHiddenApps?: () => void;
}

/** Helper: Promise.withResolvers equivalent. */
function withResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Turn-end cleanup for computer-use: auto-unhide apps that
 * `prepareForAction` hid, then release the file-based lock.
 *
 * Called from three sites: natural turn end, abort during streaming,
 * abort during tool execution. All three reach this via dynamic import.
 *
 * No-ops cheaply on non-CU turns: both gate checks are zero-syscall.
 */
export async function cleanupComputerUseAfterTurn(
  ctx?: CleanupContext,
): Promise<void> {
  const log = getAgentLogger();

  const hiddenFromContext = ctx?.getHiddenApps?.();
  const hiddenBundleIds = hiddenFromContext
    ? [...hiddenFromContext]
    : takeHiddenComputerUseApps();
  if (hiddenBundleIds.length > 0) {
    const { unhideComputerUseApps } = await import("./executor.ts");
    const unhide = unhideComputerUseApps(hiddenBundleIds).catch((err) =>
      log.debug(
        `[Computer Use MCP] auto-unhide failed: ${errorMessage(err)}`,
      ),
    );
    const timeout = withResolvers<void>();
    const timer = setTimeout(timeout.resolve, UNHIDE_TIMEOUT_MS);
    await Promise.race([unhide, timeout.promise]).finally(() =>
      clearTimeout(timer),
    );
    if (hiddenFromContext) {
      ctx?.clearHiddenApps?.();
    }
  }

  // Zero-syscall pre-check so non-CU turns don't touch disk.
  if (!isLockHeldLocally()) return;

  // Unregister before lock release so the pump-retain drops as soon as the
  // CU session ends. Swallow throws so an unregister error never prevents
  // lock release.
  try {
    unregisterEscHotkey();
  } catch (err) {
    log.debug(
      `[Computer Use MCP] unregisterEscHotkey failed: ${errorMessage(err)}`,
    );
  }

  if (await releaseComputerUseLock()) {
    // CC sends OS notification: "Claude is done using your computer"
    // HLVM bridge: log instead (no OS notification API)
    log.info("Computer use session ended — released lock");
  }

  // Close Playwright browser if active (zero-cost no-op if no browser was launched)
  try {
    const { closeBrowser, isBrowserActive } = await import("../playwright/mod.ts");
    if (isBrowserActive()) {
      await closeBrowser();
      log.info("Browser session closed");
    }
  } catch { /* playwright module not loaded — nothing to clean up */ }
}

// ── Legacy API (backward compat with existing code) ──────────────────────

export async function cleanupComputerUse(): Promise<void> {
  await cleanupComputerUseAfterTurn();
}
