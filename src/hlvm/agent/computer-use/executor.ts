/**
 * Computer Use — Executor (CC clone)
 *
 * CC original: utils/computerUse/executor.ts (658 lines)
 * CLI `ComputerExecutor` implementation.
 *
 * ── Bridge changes from CC ────────────────────────────────────────────────
 *
 * - `@ant/computer-use-input` (Rust enigo) → `./bridge.ts` (osascript CGEvent)
 * - `@ant/computer-use-swift` (Swift)       → `./bridge.ts` (osascript + screencapture)
 * - `logForDebugging` → `getAgentLogger().debug()`
 * - `errorMessage()` → local helper
 * - `execFileNoThrow` → `./bridge.ts`
 * - `sleep` → local helper
 * - `drainRunLoop` → `./drain-run-loop.ts` (no-op passthrough)
 * - `notifyExpectedEscape` → `./esc-hotkey.ts` (no-op)
 * - `getFrontmostAppInfo()` → async (CC: sync Rust; HLVM: async osascript)
 *
 * ALL TS logic (withModifiers, releasePressed, animatedMove, typeViaClipboard,
 * moveAndSettle, isBareEscape, computeTargetDims, etc.) is IDENTICAL to CC.
 */

import type {
  ComputerExecutor,
  ComputerUsePermissionState,
  ComputerUseInputAPI,
  DesktopObservation,
  DisplaySelectionReason,
  DisplayGeometry,
  FrontmostApp,
  InstalledApp,
  ObservationTarget,
  ResolvePrepareCaptureResult,
  RunningApp,
  ScreenshotResult,
  WindowInfo,
} from "./types.ts";

import { API_RESIZE_PARAMS, targetImageSize } from "./types.ts";
import { getAgentLogger } from "../logger.ts";
import { ensureDisplayCache, ensureRunningAppsCache, execFileNoThrow, requireComputerUseInput, requireComputerUseSwift } from "./bridge.ts";
import {
  CLI_CU_CAPABILITIES,
  CLI_HOST_BUNDLE_ID,
  assertValidBundleId,
  getTerminalBundleId,
} from "./common.ts";
import { drainRunLoop } from "./drain-run-loop.ts";
import { notifyExpectedEscape } from "./esc-hotkey.ts";

// ── Helpers (CC originals) ───────────────────────────────────────────────

/** Bridge: replaces CC's `import { sleep } from '../sleep.js'` */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bridge: replaces CC's `import { errorMessage } from '../errors.js'` */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Bridge: replaces CC's `import { logForDebugging } from '../debug.js'` */
function logForDebugging(msg: string, _opts?: { level?: string }): void {
  getAgentLogger().debug(msg);
}

const SCREENSHOT_JPEG_QUALITY = 0.75;

/** Logical → physical → API target dims. See `targetImageSize` + COORDINATES.md. */
function computeTargetDims(
  logicalW: number,
  logicalH: number,
  scaleFactor: number,
): [number, number] {
  const physW = Math.round(logicalW * scaleFactor);
  const physH = Math.round(logicalH * scaleFactor);
  return targetImageSize(physW, physH, API_RESIZE_PARAMS);
}

function buildObservationTargets(
  observationId: string,
  windows: readonly WindowInfo[],
): ObservationTarget[] {
  return windows
    .filter((window) => !!window.bundleId)
    .slice(0, 12)
    .map((window) => ({
      targetId: `${observationId}:window:${window.windowId}`,
      kind: "window" as const,
      label: window.title
        ? `${window.displayName} — ${window.title}`
        : window.displayName,
      role: "window" as const,
      bounds: window.bounds,
      bundleId: window.bundleId!,
      confidence: window.layer === 0 ? 0.9 : 0.7,
      windowId: window.windowId,
    }));
}

async function readClipboardViaPbpaste(): Promise<string> {
  const { stdout, code } = await execFileNoThrow("pbpaste", [], {
    useCwd: false,
  });
  if (code !== 0) {
    throw new Error(`pbpaste exited with code ${code}`);
  }
  return stdout;
}

async function writeClipboardViaPbcopy(text: string): Promise<void> {
  const { code } = await execFileNoThrow("pbcopy", [], {
    input: text,
    useCwd: false,
  });
  if (code !== 0) {
    throw new Error(`pbcopy exited with code ${code}`);
  }
}

/**
 * Single-element key sequence matching "escape" or "esc" (case-insensitive).
 * Used to hole-punch the CGEventTap abort for model-synthesized Escape — enigo
 * accepts both spellings, so the tap must too.
 */
function isBareEscape(parts: readonly string[]): boolean {
  if (parts.length !== 1) return false;
  const lower = parts[0]!.toLowerCase();
  return lower === "escape" || lower === "esc";
}

/**
 * Instant move, then 50ms — an input→HID→AppKit→NSEvent round-trip before the
 * caller reads `NSEvent.mouseLocation` or dispatches a click. Used for click,
 * scroll, and drag-from; `animatedMove` is reserved for drag-to only.
 */
const MOVE_SETTLE_MS = 50;

async function moveAndSettle(
  input: ComputerUseInputAPI,
  x: number,
  y: number,
): Promise<void> {
  await input.moveMouse(x, y, false);
  await sleep(MOVE_SETTLE_MS);
}

/**
 * Release `pressed` in reverse (last pressed = first released). Errors are
 * swallowed so a release failure never masks the real error.
 */
async function releasePressed(
  input: ComputerUseInputAPI,
  pressed: string[],
): Promise<void> {
  let k: string | undefined;
  while ((k = pressed.pop()) !== undefined) {
    try {
      await input.key(k, "release");
    } catch {
      // Swallow — best-effort release.
    }
  }
}

/**
 * Bracket `fn()` with modifier press/release. `pressed` tracks which presses
 * actually landed, so a mid-press throw only releases what was pressed — no
 * stuck modifiers. The finally covers both press-phase and fn() throws.
 */
async function withModifiers<T>(
  input: ComputerUseInputAPI,
  mods: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const pressed: string[] = [];
  try {
    for (const m of mods) {
      await input.key(m, "press");
      pressed.push(m);
    }
    return await fn();
  } finally {
    await releasePressed(input, pressed);
  }
}

/**
 * Port of Cowork's `typeViaClipboard`. Sequence:
 *   1. Save the user's clipboard.
 *   2. Write our text.
 *   3. READ-BACK VERIFY — clipboard writes can silently fail.
 *   4. Cmd+V via keys().
 *   5. Sleep 100ms — battle-tested threshold for paste-effect vs restore race.
 *   6. Restore — in a `finally`, never leaves clipboard clobbered.
 */
async function typeViaClipboard(
  input: ComputerUseInputAPI,
  text: string,
): Promise<void> {
  let saved: string | undefined;
  try {
    saved = await readClipboardViaPbpaste();
  } catch {
    logForDebugging(
      "[computer-use] pbpaste before paste failed; proceeding without restore",
    );
  }

  try {
    await writeClipboardViaPbcopy(text);
    if ((await readClipboardViaPbpaste()) !== text) {
      throw new Error("Clipboard write did not round-trip.");
    }
    await input.keys(["command", "v"]);
    await sleep(100);
  } finally {
    if (typeof saved === "string") {
      try {
        await writeClipboardViaPbcopy(saved);
      } catch {
        logForDebugging("[computer-use] clipboard restore after paste failed");
      }
    }
  }
}

/**
 * Port of Cowork's `animateMouseMovement` + `animatedMove`. Ease-out-cubic at
 * 60fps; distance-proportional duration at 2000 px/sec, capped at 0.5s.
 */
async function animatedMove(
  input: ComputerUseInputAPI,
  targetX: number,
  targetY: number,
  mouseAnimationEnabled: boolean,
): Promise<void> {
  if (!mouseAnimationEnabled) {
    await moveAndSettle(input, targetX, targetY);
    return;
  }
  const start = await input.mouseLocation();
  const deltaX = targetX - start.x;
  const deltaY = targetY - start.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < 1) return;
  const durationSec = Math.min(distance / 2000, 0.5);
  if (durationSec < 0.03) {
    await moveAndSettle(input, targetX, targetY);
    return;
  }
  const frameRate = 60;
  const frameIntervalMs = 1000 / frameRate;
  const totalFrames = Math.floor(durationSec * frameRate);
  for (let frame = 1; frame <= totalFrames; frame++) {
    const t = frame / totalFrames;
    const eased = 1 - Math.pow(1 - t, 3);
    await input.moveMouse(
      Math.round(start.x + deltaX * eased),
      Math.round(start.y + deltaY * eased),
      false,
    );
    if (frame < totalFrames) {
      await sleep(frameIntervalMs);
    }
  }
  await sleep(MOVE_SETTLE_MS);
}

// ── Factory (CC original) ────────────────────────────────────────────────

export function createCliExecutor(opts: {
  getMouseAnimationEnabled: () => boolean;
  getHideBeforeActionEnabled: () => boolean;
}): ComputerExecutor {
  if (getPlatformOs() !== "darwin") {
    throw new Error(
      `createCliExecutor called on ${getPlatformOs()}. Computer control is macOS-only.`,
    );
  }

  const cu = requireComputerUseSwift();

  const { getMouseAnimationEnabled, getHideBeforeActionEnabled } = opts;
  const terminalBundleId = getTerminalBundleId();
  const surrogateHost = terminalBundleId ?? CLI_HOST_BUNDLE_ID;
  const withoutTerminal = (allowed: readonly string[]): string[] =>
    terminalBundleId === null
      ? [...allowed]
      : allowed.filter((id) => id !== terminalBundleId);

  logForDebugging(
    terminalBundleId
      ? `[computer-use] terminal ${terminalBundleId} → surrogate host (hide-exempt, activate-skip, screenshot-excluded)`
      : "[computer-use] terminal not detected; falling back to sentinel host",
  );

  return {
    capabilities: {
      ...CLI_CU_CAPABILITIES,
      hostBundleId: CLI_HOST_BUNDLE_ID,
    },

    // ── Pre-action sequence (hide + defocus) ────────────────────────────

    async prepareForAction(
      allowlistBundleIds: string[],
      displayId?: number,
    ): Promise<string[]> {
      if (!getHideBeforeActionEnabled()) {
        return [];
      }
      return drainRunLoop(async () => {
        try {
          const result = await cu.apps.prepareDisplay(
            allowlistBundleIds,
            surrogateHost,
            displayId,
          );
          if (result.activated) {
            logForDebugging(
              `[computer-use] prepareForAction: activated ${result.activated}`,
            );
          }
          return result.hidden;
        } catch (err) {
          logForDebugging(
            `[computer-use] prepareForAction failed; continuing to action: ${errorMessage(err)}`,
            { level: "warn" },
          );
          return [];
        }
      });
    },

    async previewHideSet(
      allowlistBundleIds: string[],
      displayId?: number,
    ): Promise<Array<{ bundleId: string; displayName: string }>> {
      return cu.apps.previewHideSet(
        [...allowlistBundleIds, surrogateHost],
        displayId,
      );
    },

    // ── Display ──────────────────────────────────────────────────────────

    async getDisplaySize(displayId?: number): Promise<DisplayGeometry> {
      await ensureDisplayCache();
      return cu.display.getSize(displayId);
    },

    async listDisplays(): Promise<DisplayGeometry[]> {
      await ensureDisplayCache();
      return cu.display.listAll();
    },

    async findWindowDisplays(
      bundleIds: string[],
    ): Promise<Array<{ bundleId: string; displayIds: number[] }>> {
      return cu.apps.findWindowDisplays(bundleIds);
    },

    async listVisibleWindows(displayId?: number): Promise<WindowInfo[]> {
      await ensureDisplayCache();
      return await cu.apps.listVisibleWindows(displayId);
    },

    async resolvePrepareCapture(opts2: {
      allowedBundleIds: string[];
      preferredDisplayId?: number;
      autoResolve: boolean;
      doHide?: boolean;
    }): Promise<ResolvePrepareCaptureResult> {
      await ensureDisplayCache();
      const d = cu.display.getSize(opts2.preferredDisplayId);
      const [targetW, targetH] = computeTargetDims(
        d.width,
        d.height,
        d.scaleFactor,
      );
      return drainRunLoop(() =>
        cu.resolvePrepareCapture(
          withoutTerminal(opts2.allowedBundleIds),
          surrogateHost,
          SCREENSHOT_JPEG_QUALITY,
          targetW,
          targetH,
          opts2.preferredDisplayId,
          opts2.autoResolve,
          opts2.doHide,
        ),
      );
    },

    /**
     * Pre-size to `targetImageSize` output so the API transcoder's early-return
     * fires — no server-side resize, `scaleCoord` stays coherent.
     */
    async screenshot(opts2: {
      allowedBundleIds: string[];
      displayId?: number;
    }): Promise<ScreenshotResult> {
      await ensureDisplayCache();
      const d = cu.display.getSize(opts2.displayId);
      const [targetW, targetH] = computeTargetDims(
        d.width,
        d.height,
        d.scaleFactor,
      );
      return drainRunLoop(() =>
        cu.screenshot.captureExcluding(
          withoutTerminal(opts2.allowedBundleIds),
          SCREENSHOT_JPEG_QUALITY,
          targetW,
          targetH,
          opts2.displayId,
        ),
      );
    },

    async zoom(
      regionLogical: { x: number; y: number; w: number; h: number },
      allowedBundleIds: string[],
      displayId?: number,
    ): Promise<{ base64: string; width: number; height: number }> {
      await ensureDisplayCache();
      const d = cu.display.getSize(displayId);
      const [outW, outH] = computeTargetDims(
        regionLogical.w,
        regionLogical.h,
        d.scaleFactor,
      );
      return drainRunLoop(() =>
        cu.screenshot.captureRegion(
          withoutTerminal(allowedBundleIds),
          regionLogical.x,
          regionLogical.y,
          regionLogical.w,
          regionLogical.h,
          outW,
          outH,
          SCREENSHOT_JPEG_QUALITY,
          displayId,
        ),
      );
    },

    async observe(opts2: {
      allowedBundleIds: string[];
      preferredDisplayId?: number;
      displaySelectionReason?: DisplaySelectionReason;
      resolvedTargetBundleId?: string;
      resolvedTargetWindowId?: number;
    }): Promise<DesktopObservation> {
      await ensureDisplayCache();
      await ensureRunningAppsCache();
      const display = cu.display.getSize(opts2.preferredDisplayId);
      const [targetW, targetH] = computeTargetDims(
        display.width,
        display.height,
        display.scaleFactor,
      );
      const [frontmostInfo, screenshot, windows, permissions] = await Promise
        .all([
          requireComputerUseInput().getFrontmostAppInfo(),
          drainRunLoop(() =>
            cu.screenshot.captureExcluding(
              withoutTerminal(opts2.allowedBundleIds),
              SCREENSHOT_JPEG_QUALITY,
              targetW,
              targetH,
              opts2.preferredDisplayId,
            )
          ),
          cu.apps.listVisibleWindows(opts2.preferredDisplayId),
          cu.permissions.getState(),
        ]);
      const frontmostApp = frontmostInfo?.bundleId
        ? {
          bundleId: frontmostInfo.bundleId,
          displayName: frontmostInfo.appName,
        }
        : null;
      const observationId = crypto.randomUUID();
      return {
        observationId,
        createdAt: Date.now(),
        display,
        displaySelectionReason: opts2.displaySelectionReason ?? "default",
        screenshot,
        frontmostApp,
        runningApps: cu.apps.listRunning(),
        windows,
        targets: buildObservationTargets(observationId, windows),
        permissions,
        resolvedTargetBundleId: opts2.resolvedTargetBundleId,
        resolvedTargetWindowId: opts2.resolvedTargetWindowId,
      };
    },

    // ── Keyboard ─────────────────────────────────────────────────────────

    /**
     * xdotool-style sequence e.g. "ctrl+shift+a" → split on '+' and pass to
     * keys(). 8ms between iterations — 125Hz USB polling cadence.
     */
    async key(keySequence: string, repeat?: number): Promise<void> {
      const input = requireComputerUseInput();
      const parts = keySequence.split("+").filter((p) => p.length > 0);
      if (parts.length === 0) {
        throw new Error("Empty key sequence");
      }
      const isEsc = isBareEscape(parts);
      const n = repeat ?? 1;
      await drainRunLoop(async () => {
        for (let i = 0; i < n; i++) {
          if (i > 0) {
            await sleep(8);
          }
          if (isEsc) {
            notifyExpectedEscape();
          }
          await input.keys(parts);
        }
      });
    },

    async holdKey(keyNames: string[], durationMs: number): Promise<void> {
      const input = requireComputerUseInput();
      const pressed: string[] = [];
      let orphaned = false;
      try {
        await drainRunLoop(async () => {
          for (const k of keyNames) {
            if (orphaned) return;
            if (isBareEscape([k])) {
              notifyExpectedEscape();
            }
            await input.key(k, "press");
            pressed.push(k);
          }
        });
        await sleep(durationMs);
      } finally {
        orphaned = true;
        await drainRunLoop(() => releasePressed(input, pressed));
      }
    },

    async type(text: string, opts2: { viaClipboard: boolean }): Promise<void> {
      const input = requireComputerUseInput();
      if (opts2.viaClipboard) {
        await drainRunLoop(() => typeViaClipboard(input, text));
        return;
      }
      await input.typeText(text);
    },

    readClipboard: readClipboardViaPbpaste,

    writeClipboard: writeClipboardViaPbcopy,

    // ── Mouse ────────────────────────────────────────────────────────────

    async moveMouse(x: number, y: number): Promise<void> {
      await moveAndSettle(requireComputerUseInput(), x, y);
    },

    /**
     * Move, then click. Modifiers are press/release bracketed via withModifiers.
     */
    async click(
      x: number,
      y: number,
      button: "left" | "right" | "middle",
      count: 1 | 2 | 3,
      modifiers?: string[],
    ): Promise<void> {
      const input = requireComputerUseInput();
      await moveAndSettle(input, x, y);
      if (modifiers && modifiers.length > 0) {
        await drainRunLoop(() =>
          withModifiers(input, modifiers, () =>
            input.mouseButton(button, "click", count),
          ),
        );
      } else {
        await input.mouseButton(button, "click", count);
      }
    },

    async mouseDown(): Promise<void> {
      await requireComputerUseInput().mouseButton("left", "press");
    },

    async mouseUp(): Promise<void> {
      await requireComputerUseInput().mouseButton("left", "release");
    },

    async getCursorPosition(): Promise<{ x: number; y: number }> {
      return requireComputerUseInput().mouseLocation();
    },

    /**
     * `from === undefined` → drag from current cursor. Inner `finally`: the
     * button is ALWAYS released even if the move throws — otherwise the
     * user's left button is stuck-pressed until they physically click.
     */
    async drag(
      from: { x: number; y: number } | undefined,
      to: { x: number; y: number },
    ): Promise<void> {
      const input = requireComputerUseInput();
      if (from !== undefined) {
        await moveAndSettle(input, from.x, from.y);
      }
      await input.mouseButton("left", "press");
      await sleep(MOVE_SETTLE_MS);
      try {
        await animatedMove(input, to.x, to.y, getMouseAnimationEnabled());
      } finally {
        await input.mouseButton("left", "release");
      }
    },

    /**
     * Move first, then scroll each axis. Vertical-first — it's the common
     * axis; a horizontal failure shouldn't lose the vertical.
     */
    async scroll(
      x: number,
      y: number,
      dx: number,
      dy: number,
    ): Promise<void> {
      const input = requireComputerUseInput();
      await moveAndSettle(input, x, y);
      if (dy !== 0) {
        await input.mouseScroll(dy, "vertical");
      }
      if (dx !== 0) {
        await input.mouseScroll(dx, "horizontal");
      }
    },

    // ── App management ───────────────────────────────────────────────────

    // Bridge note: CC's getFrontmostAppInfo() is sync (Rust native module).
    // HLVM's bridge is async (osascript). This is the one logic deviation.
    async getFrontmostApp(): Promise<FrontmostApp | null> {
      const info = await requireComputerUseInput().getFrontmostAppInfo();
      if (!info || !info.bundleId) return null;
      return { bundleId: info.bundleId, displayName: info.appName };
    },

    async appUnderPoint(
      x: number,
      y: number,
    ): Promise<{ bundleId: string; displayName: string } | null> {
      return cu.apps.appUnderPoint(x, y);
    },

    async listInstalledApps(): Promise<InstalledApp[]> {
      return drainRunLoop(() => cu.apps.listInstalled());
    },

    async getAppIcon(path: string): Promise<string | undefined> {
      return cu.apps.iconDataUrl(path) ?? undefined;
    },

    async listRunningApps(): Promise<RunningApp[]> {
      await ensureRunningAppsCache();
      return cu.apps.listRunning();
    },

    async openApp(bundleId: string): Promise<void> {
      assertValidBundleId(bundleId);
      await cu.apps.open(bundleId);
    },

    async getPermissionState(): Promise<ComputerUsePermissionState> {
      return await cu.permissions.getState();
    },
  };
}

/**
 * Module-level export — called at turn-end from cleanup, outside the executor
 * lifecycle. Fire-and-forget at the call site.
 */
export async function unhideComputerUseApps(
  bundleIds: readonly string[],
): Promise<void> {
  if (bundleIds.length === 0) return;
  const cu = requireComputerUseSwift();
  await cu.apps.unhide([...bundleIds]);
}

// ── Bridge: platform helper ──────────────────────────────────────────────

import { getPlatform } from "../../../platform/platform.ts";

function getPlatformOs(): string {
  return getPlatform().build.os;
}
