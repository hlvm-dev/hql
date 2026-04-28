/**
 * Computer Use — Bridge Layer
 *
 * Replaces CC's two proprietary native modules:
 *   - `@ant/computer-use-input` (Rust/enigo) → osascript CGEvent via JXA
 *   - `@ant/computer-use-swift` (Swift)       → screencapture + osascript NSScreen/NSWorkspace
 *
 * Provides `requireComputerUseInput()` and `requireComputerUseSwift()` with
 * the same API surface that CC's executor.ts calls. Also provides
 * `execFileNoThrow()` replacing CC's `../execFileNoThrow.js`.
 *
 * Bridge design: every method calls out to `osascript` or `screencapture`
 * subprocesses via `getPlatform().command.output()` (SSOT compliant).
 */

import { getPlatform } from "../../../platform/platform.ts";
import { DEFAULT_LOCALHOST } from "../../../common/config/types.ts";
import { sleep as bridgeSleep } from "../../../common/timeout-utils.ts";
import { http } from "../../../common/http-client.ts";
import { buildBearerHeader } from "../../../common/http/auth-headers.ts";
import { getAgentLogger } from "../logger.ts";
import { TOOL_CATEGORY, ToolError } from "../error-taxonomy.ts";
import { TOOL_NAMES } from "../tool-names.ts";

function cuBridgeError(
  message: string,
  category: "internal" | "validation" = TOOL_CATEGORY.INTERNAL,
): ToolError {
  return new ToolError(message, TOOL_NAMES.COMPUTER_USE, category);
}
import {
  assertValidBundleId,
  CLI_HOST_BUNDLE_ID,
  isValidBundleId,
} from "./common.ts";
import { parseKeySpec } from "./keycodes.ts";
import { getHlvmRuntimeBaseUrl } from "../../runtime/host-config.ts";
import type {
  BoundsRect,
  ComputerUseInputAPI,
  ComputerUsePermissionState,
  ComputerUseSwiftAPI,
  CUBackendResolution,
  CUExecutePlanRequest,
  CUExecutePlanResponse,
  CUNativeCapabilities,
  CUReadTargetRequest,
  CUReadTargetResponse,
  DisplayGeometry,
  HideCandidate,
  InstalledApp,
  ObservationTarget,
  PrepareForActionResult,
  ResolvePrepareCaptureResult,
  RunningApp,
  ScreenshotResult,
  WindowInfo,
} from "./types.ts";
import {
  NATIVE_GUI_CAPABILITIES_VERSION,
  NATIVE_GUI_FEATURES,
} from "./types.ts";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Default timeout for osascript/JXA subprocess calls (30 seconds). */
const SUBPROCESS_TIMEOUT_MS = 30_000;
const PERMISSION_CACHE_MS = 2_000;
const MIN_WINDOW_EDGE_PX = 40;

/** Run AppleScript and return trimmed stdout. */
async function osascript(
  script: string,
  timeout = SUBPROCESS_TIMEOUT_MS,
): Promise<string> {
  const result = await getPlatform().command.output({
    cmd: ["osascript", "-e", script],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    timeout,
  });
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw cuBridgeError(`osascript failed (exit ${result.code}): ${stderr}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

/** Run JXA (JavaScript for Automation with ObjC bridge). */
async function jxa(
  script: string,
  timeout = SUBPROCESS_TIMEOUT_MS,
): Promise<string> {
  const result = await getPlatform().command.output({
    cmd: ["osascript", "-l", "JavaScript", "-e", script],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    timeout,
  });
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw cuBridgeError(`JXA failed (exit ${result.code}): ${stderr}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

/** Validate that a numeric value is a finite number (guards against NaN/Infinity in JXA). */
function assertFiniteCoord(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw cuBridgeError(`Invalid ${name}: ${value} (must be a finite number)`);
  }
}

const DEFAULT_DISPLAY_GEOMETRY: DisplayGeometry = {
  width: 1920,
  height: 1080,
  scaleFactor: 2,
  displayId: 1,
  originX: 0,
  originY: 0,
};

function selectDisplayGeometry(displayId?: number): DisplayGeometry {
  if (_cachedDisplayList && _cachedDisplayList.length > 0) {
    if (displayId !== undefined) {
      const exact = _cachedDisplayList.find((display) =>
        display.displayId === displayId
      );
      if (exact) return exact;
    }
    return _cachedDisplaySize ?? _cachedDisplayList[0]!;
  }
  return {
    ...DEFAULT_DISPLAY_GEOMETRY,
    displayId: displayId ?? DEFAULT_DISPLAY_GEOMETRY.displayId,
  };
}

interface RawWindowRecord {
  kCGWindowNumber?: number;
  kCGWindowOwnerPID?: number;
  kCGWindowOwnerName?: string;
  kCGWindowName?: string;
  kCGWindowLayer?: number;
  kCGWindowAlpha?: number;
  kCGWindowIsOnscreen?: boolean;
  kCGWindowBounds?: {
    X?: number;
    Y?: number;
    Width?: number;
    Height?: number;
  };
  bundleId?: string | null;
  displayName?: string | null;
}

function normalizeBounds(raw: RawWindowRecord["kCGWindowBounds"]): BoundsRect {
  return {
    x: Number(raw?.X ?? 0),
    y: Number(raw?.Y ?? 0),
    width: Number(raw?.Width ?? 0),
    height: Number(raw?.Height ?? 0),
  };
}

function pointInBounds(
  x: number,
  y: number,
  bounds: BoundsRect,
): boolean {
  return (
    x >= bounds.x &&
    y >= bounds.y &&
    x <= bounds.x + bounds.width &&
    y <= bounds.y + bounds.height
  );
}

function resolveDisplayIdForBounds(bounds: BoundsRect): number | undefined {
  const displays = _cachedDisplayList ?? [selectDisplayGeometry()];
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const containing = displays.find((display) =>
    centerX >= (display.originX ?? 0) &&
    centerY >= (display.originY ?? 0) &&
    centerX <= (display.originX ?? 0) + display.width &&
    centerY <= (display.originY ?? 0) + display.height
  );
  return containing?.displayId;
}

function filterVisibleWindows(rawWindows: RawWindowRecord[]): WindowInfo[] {
  return rawWindows.flatMap((raw, index) => {
    const bounds = normalizeBounds(raw.kCGWindowBounds);
    const layer = Number(raw.kCGWindowLayer ?? 0);
    const alpha = Number(raw.kCGWindowAlpha ?? 1);
    const bundleId = raw.bundleId?.trim() || undefined;
    const displayName = raw.displayName?.trim() ||
      raw.kCGWindowOwnerName?.trim() ||
      bundleId;

    if (!raw.kCGWindowIsOnscreen) return [];
    if (!displayName) return [];
    if (!raw.kCGWindowNumber) return [];
    if (raw.kCGWindowOwnerName === "Window Server") return [];
    if (alpha <= 0) return [];
    if (
      bounds.width < MIN_WINDOW_EDGE_PX ||
      bounds.height < MIN_WINDOW_EDGE_PX
    ) {
      return [];
    }
    if (layer >= 1_000) return [];

    return [{
      windowId: Number(raw.kCGWindowNumber),
      bundleId,
      displayName,
      title: raw.kCGWindowName?.trim() || undefined,
      bounds,
      displayId: resolveDisplayIdForBounds(bounds),
      zIndex: index,
      layer,
      ownerPid: raw.kCGWindowOwnerPID
        ? Number(raw.kCGWindowOwnerPID)
        : undefined,
      isOnscreen: true,
    }];
  });
}

interface BridgePreparationPlan {
  selectedDisplayId?: number;
  selectedTargetBundleId?: string;
  selectedTargetWindowId?: number;
  resolutionReason: string;
  failureReason?: string;
  hideCandidates: HideCandidate[];
}

function sortWindowsForSelection(
  windows: readonly WindowInfo[],
): WindowInfo[] {
  return [...windows].sort((a, b) =>
    (a.layer - b.layer) ||
    (a.zIndex - b.zIndex) ||
    (a.windowId - b.windowId)
  );
}

function buildDisplayOrderMap(
  displays: readonly DisplayGeometry[],
): Map<number, number> {
  const order = new Map<number, number>();
  displays.forEach((display, index) => {
    order.set(display.displayId ?? index + 1, index);
  });
  return order;
}

function sortDisplayIdsByDisplayOrder(
  displayIds: readonly number[],
  displays: readonly DisplayGeometry[],
): number[] {
  const order = buildDisplayOrderMap(displays);
  return [...new Set(displayIds)].sort((a, b) =>
    (order.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b) ?? Number.MAX_SAFE_INTEGER) ||
    (a - b)
  );
}

function computeHideCandidates(
  windows: readonly WindowInfo[],
  runningApps: readonly RunningApp[],
  allowedBundleIds: readonly string[],
  hostBundleId: string,
  selectedDisplayId?: number,
  selectedTargetBundleId?: string,
): HideCandidate[] {
  const allowSet = new Set(
    allowedBundleIds.filter((bundleId) =>
      bundleId && bundleId !== hostBundleId
    ),
  );
  allowSet.add(hostBundleId);
  if (selectedTargetBundleId) {
    allowSet.add(selectedTargetBundleId);
  }

  const runningNameByBundle = new Map(
    runningApps.map((app) => [app.bundleId, app.displayName]),
  );
  const scopedWindows = sortWindowsForSelection(
    selectedDisplayId != null
      ? windows.filter((window) => window.displayId === selectedDisplayId)
      : windows,
  );
  const hideByBundle = new Map<string, HideCandidate>();
  for (const window of scopedWindows) {
    const bundleId = window.bundleId?.trim();
    if (!bundleId || allowSet.has(bundleId)) continue;
    if (hideByBundle.has(bundleId)) continue;
    hideByBundle.set(bundleId, {
      bundleId,
      displayName: window.displayName || runningNameByBundle.get(bundleId) ||
        bundleId,
    });
  }
  return [...hideByBundle.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName) ||
    a.bundleId.localeCompare(b.bundleId)
  );
}

function resolvePreparationPlan(
  params: {
    windows: readonly WindowInfo[];
    runningApps: readonly RunningApp[];
    allowedBundleIds: readonly string[];
    hostBundleId: string;
    displayId?: number;
  },
): BridgePreparationPlan {
  const allowedBundleIds = [
    ...new Set(
      params.allowedBundleIds.filter((bundleId) =>
        bundleId && bundleId !== params.hostBundleId &&
        isValidBundleId(bundleId)
      ),
    ),
  ];
  const orderedWindows = sortWindowsForSelection(
    params.windows.filter((window) => !!window.bundleId),
  );
  const runningAllowed = params.runningApps.filter((app) =>
    allowedBundleIds.includes(app.bundleId)
  );
  const windowsOnRequestedDisplay = params.displayId != null
    ? orderedWindows.filter((window) => window.displayId === params.displayId)
    : orderedWindows;
  const allowedWindowsOnRequestedDisplay = windowsOnRequestedDisplay.filter(
    (window) =>
      !!window.bundleId &&
      allowedBundleIds.includes(window.bundleId),
  );

  if (allowedBundleIds.length === 0) {
    return {
      selectedDisplayId: params.displayId,
      resolutionReason: params.displayId != null
        ? "explicit_display_no_allowlist"
        : "no_allowlist",
      hideCandidates: [],
    };
  }

  if (allowedWindowsOnRequestedDisplay.length > 0) {
    const targetWindow = allowedWindowsOnRequestedDisplay[0]!;
    const selectedDisplayId = targetWindow.displayId ?? params.displayId;
    return {
      selectedDisplayId,
      selectedTargetBundleId: targetWindow.bundleId,
      selectedTargetWindowId: targetWindow.windowId,
      resolutionReason: params.displayId != null
        ? "requested_display_window"
        : "allowed_window",
      hideCandidates: computeHideCandidates(
        params.windows,
        params.runningApps,
        allowedBundleIds,
        params.hostBundleId,
        selectedDisplayId,
        targetWindow.bundleId,
      ),
    };
  }

  if (params.displayId != null) {
    if (runningAllowed.length === 1) {
      return {
        selectedDisplayId: params.displayId,
        selectedTargetBundleId: runningAllowed[0]!.bundleId,
        resolutionReason: "requested_display_running_app",
        hideCandidates: computeHideCandidates(
          params.windows,
          params.runningApps,
          allowedBundleIds,
          params.hostBundleId,
          params.displayId,
          runningAllowed[0]!.bundleId,
        ),
      };
    }
    return {
      selectedDisplayId: params.displayId,
      resolutionReason: "requested_display_unresolved",
      failureReason: runningAllowed.length > 1
        ? "ambiguous_allowed_apps_on_display"
        : "no_allowed_app_on_display",
      hideCandidates: [],
    };
  }

  const allowedWindows = orderedWindows.filter((window) =>
    !!window.bundleId && allowedBundleIds.includes(window.bundleId)
  );
  if (allowedWindows.length > 0) {
    const targetWindow = allowedWindows[0]!;
    return {
      selectedDisplayId: targetWindow.displayId,
      selectedTargetBundleId: targetWindow.bundleId,
      selectedTargetWindowId: targetWindow.windowId,
      resolutionReason: "fallback_allowed_window",
      hideCandidates: computeHideCandidates(
        params.windows,
        params.runningApps,
        allowedBundleIds,
        params.hostBundleId,
        targetWindow.displayId,
        targetWindow.bundleId,
      ),
    };
  }

  if (runningAllowed.length === 1) {
    return {
      selectedDisplayId: params.displayId,
      selectedTargetBundleId: runningAllowed[0]!.bundleId,
      resolutionReason: "single_running_app",
      hideCandidates: computeHideCandidates(
        params.windows,
        params.runningApps,
        allowedBundleIds,
        params.hostBundleId,
        params.displayId,
        runningAllowed[0]!.bundleId,
      ),
    };
  }

  return {
    selectedDisplayId: params.displayId,
    resolutionReason: "unresolved_target",
    failureReason: runningAllowed.length > 1
      ? "ambiguous_allowed_apps"
      : "no_allowed_app",
    hideCandidates: [],
  };
}

function selectWindowAtPoint(
  windows: readonly WindowInfo[],
  x: number,
  y: number,
): WindowInfo | undefined {
  return sortWindowsForSelection(windows).find((window) =>
    !!window.bundleId && pointInBounds(x, y, window.bounds)
  );
}

function resolveCaptureDisplayId(
  params: {
    displays: readonly DisplayGeometry[];
    windows: readonly WindowInfo[];
    runningApps: readonly RunningApp[];
    allowedBundleIds: readonly string[];
    hostBundleId: string;
    preferredDisplayId?: number;
  },
): {
  displayId: number;
  selectedTargetBundleId?: string;
  selectedTargetWindowId?: number;
  resolutionReason: string;
  failureReason?: string;
} {
  const fallbackDisplayId = params.preferredDisplayId ??
    params.displays[0]?.displayId ??
    DEFAULT_DISPLAY_GEOMETRY.displayId ??
    1;
  const plan = resolvePreparationPlan({
    windows: params.windows,
    runningApps: params.runningApps,
    allowedBundleIds: params.allowedBundleIds,
    hostBundleId: params.hostBundleId,
    displayId: params.preferredDisplayId,
  });

  if (plan.selectedDisplayId != null) {
    return {
      displayId: plan.selectedDisplayId,
      selectedTargetBundleId: plan.selectedTargetBundleId,
      selectedTargetWindowId: plan.selectedTargetWindowId,
      resolutionReason: plan.resolutionReason,
      failureReason: plan.failureReason,
    };
  }

  return {
    displayId: fallbackDisplayId,
    selectedTargetBundleId: plan.selectedTargetBundleId,
    selectedTargetWindowId: plan.selectedTargetWindowId,
    resolutionReason: params.preferredDisplayId != null
      ? "explicit_display"
      : "default_display",
    failureReason: plan.failureReason,
  };
}

function resolveCaptureDisplayIndex(
  displays: readonly DisplayGeometry[],
  displayId?: number,
): number {
  if (displayId == null) return 1;
  const order = buildDisplayOrderMap(displays);
  const displayOrder = order.get(displayId);
  if (displayOrder == null) {
    throw cuBridgeError(`Unknown display id for capture: ${displayId}`);
  }
  return displayOrder + 1;
}

async function listVisibleWindowsInternal(
  displayId?: number,
): Promise<WindowInfo[]> {
  const raw = await jxa(`
    ObjC.import('CoreGraphics');
    ObjC.import('AppKit');
    ObjC.import('Foundation');
    var list = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID);
    var count = $.CFArrayGetCount(list);
    var out = [];
    for (var i = 0; i < count; i++) {
      var item = ObjC.deepUnwrap(ObjC.castRefToObject($.CFArrayGetValueAtIndex(list, i)));
      var pid = item.kCGWindowOwnerPID;
      var app = pid ? $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid) : null;
      out.push({
        kCGWindowNumber: item.kCGWindowNumber,
        kCGWindowOwnerPID: pid,
        kCGWindowOwnerName: item.kCGWindowOwnerName,
        kCGWindowName: item.kCGWindowName || null,
        kCGWindowLayer: item.kCGWindowLayer,
        kCGWindowAlpha: item.kCGWindowAlpha,
        kCGWindowIsOnscreen: item.kCGWindowIsOnscreen,
        kCGWindowBounds: item.kCGWindowBounds,
        bundleId: app ? ObjC.unwrap(app.bundleIdentifier) : null,
        displayName: app ? ObjC.unwrap(app.localizedName) : item.kCGWindowOwnerName
      });
    }
    JSON.stringify(out);
  `);
  const parsed = JSON.parse(raw) as RawWindowRecord[];
  const windows = filterVisibleWindows(parsed);
  return displayId == null
    ? windows
    : windows.filter((window) => window.displayId === displayId);
}

let _cachedPermissionState: ComputerUsePermissionState | undefined;

async function probeScreenRecordingAccess(): Promise<boolean | null> {
  const platform = getPlatform();
  const tmpDir = await platform.fs.makeTempDir({ prefix: "hlvm-cu-perm" });
  const tmpPath = platform.path.join(tmpDir, "probe.jpg");
  try {
    const result = await platform.command.output({
      cmd: ["screencapture", "-x", "-R", "0,0,1,1", "-t", "jpg", tmpPath],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      timeout: 5000,
    });
    return result.success;
  } catch {
    return null;
  } finally {
    try {
      await platform.fs.remove(tmpDir, { recursive: true });
    } catch {
      // best-effort
    }
  }
}

async function getPermissionStateInternal(): Promise<
  ComputerUsePermissionState
> {
  if (
    _cachedPermissionState &&
    Date.now() - _cachedPermissionState.checkedAt < PERMISSION_CACHE_MS
  ) {
    return _cachedPermissionState;
  }

  let accessibilityTrusted = false;
  try {
    const raw = await jxa(`
      ObjC.import('ApplicationServices');
      JSON.stringify({ accessibilityTrusted: $.AXIsProcessTrusted() ? true : false });
    `);
    accessibilityTrusted = !!(JSON.parse(raw) as {
      accessibilityTrusted?: boolean;
    }).accessibilityTrusted;
  } catch {
    accessibilityTrusted = false;
  }

  const screenRecordingAvailable = await probeScreenRecordingAccess();
  const missing: string[] = [];
  if (!accessibilityTrusted) missing.push("Accessibility");
  if (screenRecordingAvailable === false) {
    missing.push("Screen Recording");
  }

  _cachedPermissionState = {
    accessibilityTrusted,
    screenRecordingAvailable,
    missing,
    checkedAt: Date.now(),
  };
  return _cachedPermissionState;
}

async function refreshBridgeCaches(): Promise<void> {
  await Promise.all([
    ensureDisplayCache(),
    ensureRunningAppsCache(),
  ]);
}

async function getFrontmostBundleId(): Promise<string | null> {
  try {
    const raw = await jxa(`
      ObjC.import('AppKit');
      var app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
      JSON.stringify({
        bundleId: app && app.bundleIdentifier ? ObjC.unwrap(app.bundleIdentifier) : null
      });
    `);
    return (JSON.parse(raw) as { bundleId?: string | null }).bundleId ?? null;
  } catch {
    return null;
  }
}

async function activateBundleId(bundleId: string): Promise<boolean> {
  if (!isValidBundleId(bundleId)) return false;
  try {
    await osascript(`tell application id "${bundleId}" to activate`);
  } catch {
    return false;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const frontmostBundleId = await getFrontmostBundleId();
    if (frontmostBundleId === bundleId) {
      return true;
    }
    await bridgeSleep(100);
  }
  return false;
}

async function hideBundleIds(bundleIds: readonly string[]): Promise<string[]> {
  const validBundleIds = [...new Set(bundleIds.filter(isValidBundleId))];
  if (validBundleIds.length === 0) return [];
  try {
    const raw = await jxa(`
      ObjC.import('AppKit');
      var hidden = [];
      var targets = new Set(${JSON.stringify(validBundleIds)});
      var apps = $.NSWorkspace.sharedWorkspace.runningApplications;
      for (var i = 0; i < apps.count; i++) {
        var app = apps.objectAtIndex(i);
        var bid = app.bundleIdentifier ? ObjC.unwrap(app.bundleIdentifier) : null;
        if (!bid || !targets.has(bid)) continue;
        if (app.activationPolicy !== $.NSApplicationActivationPolicyRegular) continue;
        app.hide();
        hidden.push(bid);
      }
      JSON.stringify(hidden);
    `);
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

// ── execFileNoThrow (replaces CC's ../execFileNoThrow.js) ────────────────

export async function execFileNoThrow(
  cmd: string,
  args: string[],
  opts?: { input?: string; useCwd?: boolean },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const platform = getPlatform();

  if (opts?.input !== undefined) {
    // Pipe stdin directly — no shell redirect, no injection risk.
    const proc = platform.command.run({
      cmd: [cmd, ...args],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
      timeout: SUBPROCESS_TIMEOUT_MS,
    });
    const encoder = new TextEncoder();
    const writer = proc.stdin as WritableStream<Uint8Array>;
    const w = writer.getWriter();
    await w.write(encoder.encode(opts.input));
    await w.close();
    const status = await proc.status;
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    if (proc.stdout) {
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        stdoutChunks.push(value);
      }
    }
    if (proc.stderr) {
      const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        stderrChunks.push(value);
      }
    }
    const decoder = new TextDecoder();
    return {
      stdout: decoder.decode(concatUint8Arrays(stdoutChunks)),
      stderr: decoder.decode(concatUint8Arrays(stderrChunks)),
      code: status.code,
    };
  }

  const result = await platform.command.output({
    cmd: [cmd, ...args],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    timeout: SUBPROCESS_TIMEOUT_MS,
  });
  return {
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    code: result.code,
  };
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

// ── ComputerUseInput (replaces @ant/computer-use-input / Rust enigo) ─────

let _inputInstance: ComputerUseInputAPI | undefined;

export function requireComputerUseInput(): ComputerUseInputAPI {
  if (_inputInstance) return _inputInstance;

  _inputInstance = {
    async moveMouse(x: number, y: number, _animated: boolean): Promise<void> {
      assertFiniteCoord(x, "x");
      assertFiniteCoord(y, "y");
      await jxa(`
        ObjC.import('CoreGraphics');
        var pt = $.CGPointMake(${x}, ${y});
        var ev = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, pt, 0);
        $.CGEventPost($.kCGHIDEventTap, ev);
      `);
    },

    async mouseButton(
      button: "left" | "right" | "middle",
      action: "click" | "press" | "release",
      count?: number,
    ): Promise<void> {
      const buttonMap = {
        left: {
          down: "kCGEventLeftMouseDown",
          up: "kCGEventLeftMouseUp",
          btn: 0,
        },
        right: {
          down: "kCGEventRightMouseDown",
          up: "kCGEventRightMouseUp",
          btn: 1,
        },
        middle: {
          down: "kCGEventOtherMouseDown",
          up: "kCGEventOtherMouseUp",
          btn: 2,
        },
      };
      if (!(button in buttonMap)) {
        throw cuBridgeError(
          `Invalid mouse button: "${button}". Must be "left", "right", or "middle".`,
        );
      }
      const { down, up, btn } = buttonMap[button];

      if (action === "press") {
        await jxa(`
          ObjC.import('CoreGraphics');
          var loc = $.CGEventGetLocation($.CGEventCreate(null));
          var ev = $.CGEventCreateMouseEvent(null, $.${down}, loc, ${btn});
          $.CGEventPost($.kCGHIDEventTap, ev);
        `);
      } else if (action === "release") {
        await jxa(`
          ObjC.import('CoreGraphics');
          var loc = $.CGEventGetLocation($.CGEventCreate(null));
          var ev = $.CGEventCreateMouseEvent(null, $.${up}, loc, ${btn});
          $.CGEventPost($.kCGHIDEventTap, ev);
        `);
      } else {
        // click — AppKit computes clickCount from timing + position proximity
        const n = count ?? 1;
        for (let i = 0; i < n; i++) {
          await jxa(`
            ObjC.import('CoreGraphics');
            var loc = $.CGEventGetLocation($.CGEventCreate(null));
            var evDown = $.CGEventCreateMouseEvent(null, $.${down}, loc, ${btn});
            $.CGEventSetIntegerValueField(evDown, $.kCGMouseEventClickState, ${
            i + 1
          });
            $.CGEventPost($.kCGHIDEventTap, evDown);
            var evUp = $.CGEventCreateMouseEvent(null, $.${up}, loc, ${btn});
            $.CGEventSetIntegerValueField(evUp, $.kCGMouseEventClickState, ${
            i + 1
          });
            $.CGEventPost($.kCGHIDEventTap, evUp);
          `);
        }
      }
    },

    async mouseScroll(
      delta: number,
      axis: "vertical" | "horizontal",
    ): Promise<void> {
      assertFiniteCoord(delta, "scroll delta");
      if (axis === "vertical") {
        await jxa(`
          ObjC.import('CoreGraphics');
          var ev = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitPixel, 1, ${
          Math.round(delta)
        });
          $.CGEventPost($.kCGHIDEventTap, ev);
        `);
      } else {
        await jxa(`
          ObjC.import('CoreGraphics');
          var ev = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitPixel, 2, 0, ${
          Math.round(delta)
        });
          $.CGEventPost($.kCGHIDEventTap, ev);
        `);
      }
    },

    async mouseLocation(): Promise<{ x: number; y: number }> {
      const raw = await jxa(`
        ObjC.import('CoreGraphics');
        var ev = $.CGEventCreate(null);
        var loc = $.CGEventGetLocation(ev);
        JSON.stringify({ x: loc.x, y: loc.y });
      `);
      return JSON.parse(raw);
    },

    async keys(parts: string[]): Promise<void> {
      if (parts.length === 0) return;
      // CC: input.keys(['command', 'v']) → press all modifiers, hit key, release
      // Last part is the key, rest are modifiers
      const keyName = parts[parts.length - 1];
      const modNames = parts.slice(0, -1);

      // Map CC modifier names (e.g. 'command', 'shift') to our MODIFIER_MAP
      const parsed = parseKeySpec(
        modNames.length > 0 ? `${modNames.join("+")}+${keyName}` : keyName,
      );
      if (!parsed) {
        throw cuBridgeError(`Unknown key spec: "${parts.join("+")}"`);
      }

      const modClause = parsed.modifiers.length > 0
        ? ` using {${parsed.modifiers.join(", ")}}`
        : "";
      await osascript(
        `tell application "System Events" to key code ${parsed.keyCode}${modClause}`,
      );
    },

    async key(
      name: string,
      action: "press" | "release",
    ): Promise<void> {
      // CC: input.key('shift', 'press') / input.key('shift', 'release')
      // Map modifier names to key codes
      const effectiveName = name.toLowerCase();

      // Check if it's a modifier name that maps differently
      const modifierKeyCode: Record<string, number> = {
        command: 55,
        cmd: 55,
        shift: 56,
        option: 58,
        alt: 58,
        control: 59,
        ctrl: 59,
        fn: 63,
      };

      let keyCode: number;
      if (effectiveName in modifierKeyCode) {
        keyCode = modifierKeyCode[effectiveName];
      } else {
        const parsed = parseKeySpec(effectiveName);
        if (!parsed) throw cuBridgeError(`Unknown key: "${name}"`);
        keyCode = parsed.keyCode;
      }

      const isDown = action === "press";
      await jxa(`
        ObjC.import('CoreGraphics');
        var ev = $.CGEventCreateKeyboardEvent(null, ${keyCode}, ${isDown});
        $.CGEventPost($.kCGHIDEventTap, ev);
      `);
    },

    async typeText(text: string): Promise<void> {
      const sanitized = text.replace(/\u0000/g, "");
      const serialized = JSON.stringify(sanitized);
      await jxa(
        `
          ObjC.import('CoreGraphics');
          var text = ${serialized};
          var down = $.CGEventCreateKeyboardEvent(null, 0, true);
          $.CGEventKeyboardSetUnicodeString(down, text.length, $(text));
          $.CGEventPost($.kCGHIDEventTap, down);
          var up = $.CGEventCreateKeyboardEvent(null, 0, false);
          $.CGEventKeyboardSetUnicodeString(up, text.length, $(text));
          $.CGEventPost($.kCGHIDEventTap, up);
        `,
      );
    },

    // Bridge note: CC's getFrontmostAppInfo() is synchronous (Rust native module).
    // In HLVM, osascript is async. The executor's getFrontmostApp() calls this
    // and awaits it — this is the one executor.ts change from CC's original.
    async getFrontmostAppInfo(): Promise<
      {
        bundleId: string;
        appName: string;
      } | null
    > {
      try {
        const raw = await jxa(`
          ObjC.import('AppKit');
          var app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
          JSON.stringify({
            bundleId: ObjC.unwrap(app.bundleIdentifier),
            appName: ObjC.unwrap(app.localizedName)
          });
        `);
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
  };

  return _inputInstance;
}

// ── CU Backend Resolution ─────────────────────────────────────────────────

let _backendResolution: CUBackendResolution | undefined;
let _resolvedNativeAuthToken: string | undefined;
let _cuNativeFetchOverride:
  | ((path: string, body?: unknown) => Promise<unknown>)
  | undefined;

interface NativeTargetsResponse {
  observationId: string;
  targets: ObservationTarget[];
}

function nativeFeatureAvailable(
  resolution: CUBackendResolution | undefined,
  feature: string,
): boolean {
  return (
    resolution?.backend === "native_gui" &&
    !!resolution.port &&
    !!resolution.capabilities?.features.includes(feature)
  );
}

function normalizeNativeCapabilities(raw: unknown): CUNativeCapabilities | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  const version = typeof candidate.version === "string" && candidate.version.length > 0
    ? candidate.version
    : NATIVE_GUI_CAPABILITIES_VERSION;
  return {
    version,
    features: [...NATIVE_GUI_FEATURES],
  };
}

function normalizeNativeTarget(
  raw: unknown,
  fallbackBundleId: string,
): ObservationTarget | undefined {
  if (!raw || typeof raw !== "object") return;
  const target = raw as Record<string, unknown>;
  const bounds = target.bounds;
  if (!bounds || typeof bounds !== "object") return;
  const rect = bounds as Record<string, unknown>;
  const targetId = typeof target.targetId === "string" ? target.targetId : "";
  const kind = typeof target.kind === "string" ? target.kind : "";
  const label = typeof target.label === "string" ? target.label : "";
  const role = typeof target.role === "string" ? target.role : "";
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  const confidence = Number(target.confidence);
  if (
    !targetId ||
    !kind ||
    !label ||
    !role ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(confidence)
  ) {
    return;
  }
  return {
    targetId,
    kind: kind as ObservationTarget["kind"],
    label,
    role,
    bounds: { x, y, width, height },
    bundleId: typeof target.bundleId === "string" && target.bundleId.length > 0
      ? target.bundleId
      : fallbackBundleId,
    confidence,
    windowId: typeof target.windowId === "number" ? target.windowId : undefined,
    displayId: typeof target.displayId === "number"
      ? target.displayId
      : undefined,
  };
}

async function resolveNativeCuAuthToken(): Promise<string> {
  const platform = getPlatform();
  const explicitToken = (platform.env.get("HLVM_CU_AUTH_TOKEN") ?? "").trim();
  if (explicitToken.length > 0) {
    _resolvedNativeAuthToken = explicitToken;
    return explicitToken;
  }
  try {
    const home = platform.env.get("HOME") ?? "";
    const fileToken = await platform.fs.readTextFile(
      platform.path.join(home, ".hlvm", "cu-native-auth-token"),
    ).then((value) => value.trim());
    if (fileToken.length > 0) {
      _resolvedNativeAuthToken = fileToken;
      return fileToken;
    }
  } catch {
    // Token file absent — continue with fallback discovery.
  }
  const envToken = (platform.env.get("HLVM_AUTH_TOKEN") ?? "").trim();
  if (envToken.length > 0) {
    _resolvedNativeAuthToken = envToken;
    return envToken;
  }
  if (_resolvedNativeAuthToken?.length) {
    return _resolvedNativeAuthToken;
  }
  try {
    const response = await http.fetchRaw(`${getHlvmRuntimeBaseUrl()}/health`, {
      timeout: 1000,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return "";
    }
    const health = await response.json() as { authToken?: string | null };
    const discovered = typeof health.authToken === "string"
      ? health.authToken.trim()
      : "";
    if (discovered.length > 0) {
      _resolvedNativeAuthToken = discovered;
      return discovered;
    }
  } catch {
    // Best-effort only; native auth discovery fails closed.
  }
  return "";
}

/**
 * Resolve which CU backend to use: native GUI app (AX-level) or JXA (fallback).
 * Checks HLVM_CU_PORT env → fetches /cu/capabilities with auth → caches result.
 * Call invalidateBackendResolution() on fresh lock acquire to re-detect.
 */
export async function resolveBackend(): Promise<CUBackendResolution> {
  if (_backendResolution) return _backendResolution;
  const platform = getPlatform();
  // Port discovery: env var first, then port file written by GUI app's CU service.
  let portStr = platform.env.get("HLVM_CU_PORT");
  if (!portStr) {
    try {
      const home = platform.env.get("HOME") ?? "";
      portStr = await platform.fs.readTextFile(
        platform.path.join(home, ".hlvm", "cu-native-port"),
      ).then((s) => s.trim());
    } catch {
      // Port file doesn't exist — GUI app not running or CU service not started
    }
  }
  if (!portStr) {
    _backendResolution = { backend: "jxa" };
    return _backendResolution;
  }
  const port = Number(portStr);
  if (!Number.isFinite(port) || port <= 0) {
    _backendResolution = { backend: "jxa" };
    return _backendResolution;
  }
  const token = await resolveNativeCuAuthToken();
  try {
    const response = await http.fetchRaw(
      `http://${DEFAULT_LOCALHOST}:${port}/cu/capabilities`,
      {
        timeout: 2000,
        headers: token.length > 0 ? buildBearerHeader(token) : undefined,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      _backendResolution = { backend: "jxa" };
      return _backendResolution;
    }
    const caps = normalizeNativeCapabilities(await response.json());
    if (!caps) {
      _backendResolution = { backend: "jxa" };
      return _backendResolution;
    }
    getAgentLogger().info(
      `[bridge] Native CU backend detected on :${port} (v${caps.version}, features: ${
        caps.features.join(",")
      })`,
    );
    _backendResolution = { backend: "native_gui", capabilities: caps, port };
  } catch {
    _backendResolution = { backend: "jxa" };
  }
  return _backendResolution;
}

/** Invalidate cached backend — called on fresh lock acquire and session reset. */
export function invalidateBackendResolution(): void {
  _backendResolution = undefined;
  _resolvedNativeAuthToken = undefined;
}

/** Get the resolved backend synchronously (returns undefined if not yet resolved). */
export function getResolvedBackend(): CUBackendResolution | undefined {
  return _backendResolution;
}

/**
 * Fetch JSON from the native GUI CU service. Falls back to JXA on failure.
 * Used by NativeGuiBackend methods.
 */
async function cuNativeFetch<T>(
  path: string,
  body?: unknown,
  timeoutMs = 15000,
): Promise<T> {
  if (_cuNativeFetchOverride) {
    return await _cuNativeFetchOverride(path, body) as T;
  }
  const resolution = _backendResolution;
  if (!resolution || resolution.backend !== "native_gui" || !resolution.port) {
    throw cuBridgeError("Native CU backend not available");
  }
  const token = await resolveNativeCuAuthToken();
  const response = await http.fetchRaw(
    `http://${DEFAULT_LOCALHOST}:${resolution.port}${path}`,
    {
      timeout: timeoutMs,
      method: body !== undefined ? "POST" : "GET",
      headers: {
        ...(token.length > 0 ? buildBearerHeader(token) : {}),
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
  );
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      _resolvedNativeAuthToken = undefined;
    }
    throw cuBridgeError(
      `CU native fetch failed: ${path} (${response.status} ${response.statusText}${
        errorText.trim().length > 0 ? `: ${errorText.trim()}` : ""
      })`,
    );
  }
  return await response.json() as T;
}

function estimateExecutePlanTimeoutMs(
  request: CUExecutePlanRequest,
): number {
  let timeoutMs = 5000;
  for (const step of request.steps) {
    switch (step.op) {
      case "wait_for_ready":
        timeoutMs += Math.min(
          Math.max(step.timeout_ms ?? 10_000, 250),
          30_000,
        ) + 1000;
        break;
      case "open_app":
        timeoutMs += 4000;
        break;
      case "type_into":
      case "find_target":
      case "click":
      case "verify":
        timeoutMs += 3000;
        break;
      case "press_keys":
        timeoutMs += 1500 * Math.max(1, step.repeat ?? 1);
        break;
    }
  }
  return Math.min(Math.max(timeoutMs, 15_000), 120_000);
}

/** Public wrapper for esc-hotkey.ts and other bridge consumers. */
export async function cuNativeRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  return await cuNativeFetch<T>(path, body);
}

export async function fetchNativeObservationTargets(
  bundleId: string,
  windowId?: number,
): Promise<NativeTargetsResponse | null> {
  const resolution = await resolveBackend();
  if (!nativeFeatureAvailable(resolution, "targets")) {
    return null;
  }
  try {
    const raw = await cuNativeFetch<{
      observationId?: unknown;
      targets?: unknown;
    }>(
      "/cu/targets",
      windowId != null ? { bundleId, windowId } : { bundleId },
    );
    if (
      typeof raw.observationId !== "string" ||
      !Array.isArray(raw.targets)
    ) {
      throw cuBridgeError("Invalid native targets response");
    }
    const targets = raw.targets.flatMap((target) => {
      const normalized = normalizeNativeTarget(target, bundleId);
      return normalized ? [normalized] : [];
    });
    getAgentLogger().debug(
      `[bridge] Native target enumeration used bundle=${bundleId} window=${
        windowId ?? "auto"
      } targets=${targets.length}`,
    );
    return {
      observationId: raw.observationId,
      targets,
    };
  } catch (err) {
    getAgentLogger().debug(
      `[bridge] Native target enumeration failed, falling back to window targets: ${err}`,
    );
    return null;
  }
}

export async function performNativeTargetAction(
  action: "click-target" | "type-into-target",
  body: {
    observationId: string;
    targetId: string;
    text?: string;
  },
): Promise<boolean> {
  const resolution = await resolveBackend();
  if (!nativeFeatureAvailable(resolution, action)) {
    return false;
  }
  const path = action === "click-target"
    ? "/cu/click-target"
    : "/cu/type-into-target";
  try {
    const response = await cuNativeFetch<{ ok?: unknown }>(path, body);
    const ok = response.ok === true;
    getAgentLogger().debug(
      `[bridge] Native target action ${action} ${
        ok ? "used" : "failed"
      } target=${body.targetId}`,
    );
    return ok;
  } catch (err) {
    getAgentLogger().debug(
      `[bridge] Native target action ${action} failed, falling back to coordinates: ${err}`,
    );
    return false;
  }
}

export async function performNativeExecutePlan(
  request: CUExecutePlanRequest,
): Promise<CUExecutePlanResponse | null> {
  const resolution = await resolveBackend();
  if (!nativeFeatureAvailable(resolution, "execute-plan")) {
    return null;
  }
  try {
    const response = await cuNativeFetch<CUExecutePlanResponse>(
      "/cu/execute-plan",
      request,
      estimateExecutePlanTimeoutMs(request),
    );
    if (
      typeof response?.ok !== "boolean" ||
      (response?.status !== "completed" && response?.status !== "blocked") ||
      !Array.isArray(response?.steps)
    ) {
      throw cuBridgeError("Invalid execute-plan response");
    }
    getAgentLogger().debug(
      `[bridge] Native execute-plan used status=${response.status} steps=${response.steps.length}`,
    );
    return response;
  } catch (err) {
    getAgentLogger().debug(
      `[bridge] Native execute-plan failed: ${err}`,
    );
    return null;
  }
}

export async function performNativeReadTarget(
  request: CUReadTargetRequest,
): Promise<CUReadTargetResponse | null> {
  const resolution = await resolveBackend();
  if (!nativeFeatureAvailable(resolution, "read-target")) {
    return null;
  }
  try {
    const response = await cuNativeFetch<CUReadTargetResponse>(
      "/cu/read-target",
      request,
    );
    if (
      typeof response?.ok !== "boolean" ||
      typeof response?.targetId !== "string" ||
      typeof response?.readKind !== "string"
    ) {
      throw cuBridgeError("Invalid read-target response");
    }
    getAgentLogger().debug(
      `[bridge] Native read-target used ok=${response.ok} target=${response.targetId} kind=${response.readKind}`,
    );
    return response;
  } catch (err) {
    getAgentLogger().debug(
      `[bridge] Native read-target failed: ${err}`,
    );
    return null;
  }
}

// ── ComputerUseSwift (replaces @ant/computer-use-swift) ──────────────────

let _swiftInstance: ComputerUseSwiftAPI | undefined;

export function requireComputerUseSwift(): ComputerUseSwiftAPI {
  if (_swiftInstance) return _swiftInstance;

  const log = getAgentLogger();

  _swiftInstance = {
    _drainMainRunLoop(): void {
      // No-op: no native modules → no CFRunLoop to pump
    },

    display: {
      getSize(displayId?: number): DisplayGeometry {
        if (!_cachedDisplaySize) {
          log.warn(
            "[bridge] Display cache not populated — using fallback dimensions. " +
              "Screenshots may be incorrectly sized. Call ensureDisplayCache() first.",
          );
        }
        return selectDisplayGeometry(displayId);
      },

      listAll(): DisplayGeometry[] {
        return _cachedDisplayList ?? [selectDisplayGeometry()];
      },
    },

    screenshot: {
      async captureExcluding(
        allowedBundleIds: string[],
        quality: number,
        targetW: number,
        targetH: number,
        displayId?: number,
      ): Promise<ScreenshotResult> {
        await refreshBridgeCaches();
        const displays = _cachedDisplayList ??
          [selectDisplayGeometry(displayId)];
        const windows = await listVisibleWindowsInternal();
        const runningApps = _cachedRunningApps ?? [];
        const resolution = resolveCaptureDisplayId({
          displays,
          windows,
          runningApps,
          allowedBundleIds,
          hostBundleId: CLI_HOST_BUNDLE_ID,
          preferredDisplayId: displayId,
        });
        if (resolution.failureReason) {
          log.debug(
            `[bridge] captureExcluding proceeding with display ${resolution.displayId} despite resolution failure: ${resolution.failureReason}`,
          );
        }
        return captureScreenshot(
          quality,
          targetW,
          targetH,
          resolution.displayId,
        );
      },

      async captureRegion(
        _allowedBundleIds: string[],
        x: number,
        y: number,
        w: number,
        h: number,
        outW: number,
        outH: number,
        quality: number,
        _displayId?: number,
      ): Promise<{ base64: string; width: number; height: number }> {
        return captureScreenshotRegion(x, y, w, h, outW, outH, quality);
      },
    },

    apps: {
      async prepareDisplay(
        allowedBundleIds: string[],
        hostBundleId: string,
        displayId?: number,
        hideDistractors = true,
      ): Promise<PrepareForActionResult> {
        await refreshBridgeCaches();
        const windows = await listVisibleWindowsInternal();
        const runningApps = _cachedRunningApps ?? [];
        const plan = resolvePreparationPlan({
          windows,
          runningApps,
          allowedBundleIds,
          hostBundleId,
          displayId,
        });

        if (allowedBundleIds.length === 0) {
          return {
            activated: null,
            hidden: [],
            selectedDisplayId: plan.selectedDisplayId,
            resolutionReason: plan.resolutionReason,
          };
        }

        if (!plan.selectedTargetBundleId) {
          return {
            activated: null,
            hidden: [],
            selectedDisplayId: plan.selectedDisplayId,
            selectedTargetWindowId: plan.selectedTargetWindowId,
            resolutionReason: plan.resolutionReason,
            failureReason: plan.failureReason ?? "no_target_bundle",
          };
        }

        const activated = await activateBundleId(plan.selectedTargetBundleId)
          ? plan.selectedTargetBundleId
          : null;
        if (!activated) {
          return {
            activated: null,
            hidden: [],
            selectedDisplayId: plan.selectedDisplayId,
            selectedTargetBundleId: plan.selectedTargetBundleId,
            selectedTargetWindowId: plan.selectedTargetWindowId,
            resolutionReason: plan.resolutionReason,
            failureReason: "activation_verification_failed",
          };
        }

        const hidden = hideDistractors
          ? await hideBundleIds(
            plan.hideCandidates.map((candidate) => candidate.bundleId),
          )
          : [];
        return {
          activated,
          hidden,
          selectedDisplayId: plan.selectedDisplayId,
          selectedTargetBundleId: plan.selectedTargetBundleId,
          selectedTargetWindowId: plan.selectedTargetWindowId,
          resolutionReason: plan.resolutionReason,
        };
      },

      async previewHideSet(
        bundleIds: string[],
        displayId?: number,
      ): Promise<HideCandidate[]> {
        await refreshBridgeCaches();
        const windows = await listVisibleWindowsInternal();
        const runningApps = _cachedRunningApps ?? [];
        return resolvePreparationPlan({
          windows,
          runningApps,
          allowedBundleIds: bundleIds,
          hostBundleId: CLI_HOST_BUNDLE_ID,
          displayId,
        }).hideCandidates;
      },

      async findWindowDisplays(
        bundleIds: string[],
      ): Promise<Array<{ bundleId: string; displayIds: number[] }>> {
        await refreshBridgeCaches();
        const windows = await listVisibleWindowsInternal();
        const displays = _cachedDisplayList ?? [selectDisplayGeometry()];
        return bundleIds.map((bundleId) => ({
          bundleId,
          displayIds: sortDisplayIdsByDisplayOrder([
            ...new Set(
              windows
                .filter((window) => window.bundleId === bundleId)
                .map((window) => window.displayId)
                .filter((value): value is number => typeof value === "number"),
            ),
          ], displays),
        }));
      },

      async listVisibleWindows(displayId?: number): Promise<WindowInfo[]> {
        return await listVisibleWindowsInternal(displayId);
      },

      async listInstalled(): Promise<InstalledApp[]> {
        // CC uses Spotlight/LSCopyApplicationURLsForBundleIdentifier (Swift).
        // HLVM: use mdfind to query Spotlight for .app bundles, then read
        // bundle IDs via defaults read. Falls back to running apps with paths.
        try {
          const raw = await jxa(`
            ObjC.import('AppKit');
            ObjC.import('CoreServices');
            var fm = $.NSFileManager.defaultManager;
            var appDirs = ['/Applications', '/System/Applications'];
            var home = ObjC.unwrap($.NSHomeDirectory());
            if (home) appDirs.push(home + '/Applications');
            var result = [];
            for (var d = 0; d < appDirs.length; d++) {
              var dir = appDirs[d];
              var contents = fm.contentsOfDirectoryAtPathError(dir, null);
              if (!contents) continue;
              for (var i = 0; i < contents.count; i++) {
                var name = ObjC.unwrap(contents.objectAtIndex(i));
                if (!name.endsWith('.app')) continue;
                var path = dir + '/' + name;
                var bundle = $.NSBundle.bundleWithPath(path);
                if (!bundle) continue;
                var bid = ObjC.unwrap(bundle.bundleIdentifier);
                var displayName = name.replace(/\\.app$/, '');
                if (bid) result.push({ bundleId: bid, displayName: displayName, path: path });
              }
            }
            JSON.stringify(result);
          `);
          return JSON.parse(raw);
        } catch {
          return [];
        }
      },

      iconDataUrl(_path: string): string | null {
        // Would need async call — return null, matches CC's fallback
        return null;
      },

      listRunning(): RunningApp[] {
        // Synchronous in CC's Swift module. Return cached.
        return _cachedRunningApps ?? [];
      },

      async open(bundleId: string): Promise<void> {
        assertValidBundleId(bundleId);
        await osascript(
          `tell application id "${bundleId}" to activate`,
        );
        _runningAppsReady = initRunningAppsCache().catch(() => {});
      },

      async unhide(bundleIds: string[]): Promise<void> {
        const valid = bundleIds.filter(isValidBundleId);
        if (valid.length === 0) return;
        try {
          await jxa(`
            ObjC.import('AppKit');
            var bids = new Set(${JSON.stringify(valid)});
            var apps = $.NSWorkspace.sharedWorkspace.runningApplications;
            for (var i = 0; i < apps.count; i++) {
              var app = apps.objectAtIndex(i);
              var bid = app.bundleIdentifier ? ObjC.unwrap(app.bundleIdentifier) : null;
              if (bid && bids.has(bid)) app.unhide();
            }
          `);
        } catch {
          // best-effort — apps may already be visible
        }
      },

      async appUnderPoint(
        x: number,
        y: number,
      ): Promise<
        {
          bundleId: string;
          displayName: string;
          windowId?: number;
          displayId?: number;
        } | null
      > {
        const windows = await listVisibleWindowsInternal();
        const match = selectWindowAtPoint(windows, x, y);
        if (!match?.bundleId) return null;
        return {
          bundleId: match.bundleId,
          displayName: match.displayName,
          windowId: match.windowId,
          displayId: match.displayId,
        };
      },
    },

    permissions: {
      async getState(): Promise<ComputerUsePermissionState> {
        return await getPermissionStateInternal();
      },
    },

    async resolvePrepareCapture(
      allowedBundleIds: string[],
      hostBundleId: string,
      quality: number,
      targetW: number,
      targetH: number,
      displayId?: number,
      autoResolve = true,
      doHide = false,
    ): Promise<ResolvePrepareCaptureResult> {
      await refreshBridgeCaches();
      const displays = _cachedDisplayList ?? [selectDisplayGeometry(displayId)];
      const windows = await listVisibleWindowsInternal();
      const runningApps = _cachedRunningApps ?? [];
      const resolution = autoResolve
        ? resolveCaptureDisplayId({
          displays,
          windows,
          runningApps,
          allowedBundleIds,
          hostBundleId,
          preferredDisplayId: displayId,
        })
        : {
          displayId: displayId ??
            displays[0]?.displayId ??
            DEFAULT_DISPLAY_GEOMETRY.displayId ??
            1,
          selectedTargetBundleId: undefined,
          selectedTargetWindowId: undefined,
          resolutionReason: displayId != null
            ? "explicit_display"
            : "default_display",
          failureReason: undefined,
        };

      const prepared = (doHide || autoResolve) && allowedBundleIds.length > 0
        ? await _swiftInstance!.apps.prepareDisplay(
          allowedBundleIds,
          hostBundleId,
          resolution.displayId,
          doHide,
        )
        : undefined;
      const selectedDisplayId = prepared?.selectedDisplayId ??
        resolution.displayId;
      const screenshot = await captureScreenshot(
        quality,
        targetW,
        targetH,
        selectedDisplayId,
      );
      return {
        displayId: selectedDisplayId,
        hidden: prepared?.hidden ?? [],
        screenshot,
        selectedTargetBundleId: prepared?.selectedTargetBundleId ??
          resolution.selectedTargetBundleId,
        selectedTargetWindowId: prepared?.selectedTargetWindowId ??
          resolution.selectedTargetWindowId,
        resolutionReason: prepared?.resolutionReason ??
          resolution.resolutionReason,
        failureReason: prepared?.failureReason ?? resolution.failureReason,
      };
    },

    hotkey: {
      registerEscape(_callback: () => void): boolean {
        return false; // no CGEventTap
      },
      unregister(): void {
        // no-op
      },
      notifyExpectedEscape(): void {
        // no-op
      },
    },
  };

  // Async init: populate caches
  _displayCacheReady = initDisplayCache().catch(() => {});
  _runningAppsReady = initRunningAppsCache().catch(() => {});

  return _swiftInstance;
}

/**
 * Upgrade the Swift API instance to route through the native GUI backend
 * for methods where native AX/CGWindow APIs provide better results.
 * JXA fallback is preserved — if any native call fails with a connection
 * error, the original JXA method is called instead.
 *
 * Call this AFTER resolveBackend() confirms native_gui is available.
 */
export function upgradeSwiftInstanceToNative(): void {
  const instance = requireComputerUseSwift();
  const input = requireComputerUseInput();
  const resolution = _backendResolution;
  if (!resolution || resolution.backend !== "native_gui") return;

  const log = getAgentLogger();
  log.info("[bridge] Upgrading CU bridge to native GUI backend");

  // Save JXA originals for fallback
  const jxaPrepareDisplay = instance.apps.prepareDisplay.bind(instance.apps);
  const jxaAppUnderPoint = instance.apps.appUnderPoint.bind(instance.apps);
  const jxaListVisibleWindows = instance.apps.listVisibleWindows.bind(
    instance.apps,
  );
  const jxaPermissions = instance.permissions.getState.bind(
    instance.permissions,
  );
  const jxaOpen = instance.apps.open.bind(instance.apps);
  const jxaMoveMouse = input.moveMouse.bind(input);
  const jxaMouseButton = input.mouseButton.bind(input);
  const jxaMouseScroll = input.mouseScroll.bind(input);
  const jxaMouseLocation = input.mouseLocation.bind(input);
  const jxaKeys = input.keys.bind(input);
  const jxaKey = input.key.bind(input);
  const jxaTypeText = input.typeText.bind(input);
  const jxaGetFrontmostAppInfo = input.getFrontmostAppInfo.bind(input);

  // Override with native — fall back to JXA on connection failure
  instance.apps.prepareDisplay = async (
    allowedBundleIds,
    hostBundleId,
    displayId?,
    hideDistractors?,
  ) => {
    try {
      return await cuNativeFetch<PrepareForActionResult>(
        "/cu/prepare-display",
        {
          allowedBundleIds,
          hostBundleId,
          displayId,
          hideDistractors,
        },
      );
    } catch (err) {
      log.debug(
        `[bridge] Native prepareDisplay failed, falling back to JXA: ${err}`,
      );
      return jxaPrepareDisplay(
        allowedBundleIds,
        hostBundleId,
        displayId,
        hideDistractors,
      );
    }
  };

  instance.apps.appUnderPoint = async (x, y) => {
    try {
      return await cuNativeFetch("/cu/element-at-point", { x, y });
    } catch (err) {
      log.debug(
        `[bridge] Native appUnderPoint failed, falling back to JXA: ${err}`,
      );
      return jxaAppUnderPoint(x, y);
    }
  };

  instance.apps.listVisibleWindows = async (displayId?) => {
    try {
      const result = await cuNativeFetch<{ windows: WindowInfo[] }>(
        "/cu/windows",
        displayId != null ? { displayId } : undefined,
      );
      return result.windows;
    } catch (err) {
      log.debug(
        `[bridge] Native listVisibleWindows failed, falling back to JXA: ${err}`,
      );
      return jxaListVisibleWindows(displayId);
    }
  };

  instance.permissions.getState = async () => {
    try {
      return await cuNativeFetch<ComputerUsePermissionState>("/cu/permissions");
    } catch (err) {
      log.debug(
        `[bridge] Native permissions failed, falling back to JXA: ${err}`,
      );
      return jxaPermissions();
    }
  };

  if (nativeFeatureAvailable(resolution, "activate-app")) {
    instance.apps.open = async (bundleId: string): Promise<void> => {
      try {
        const response = await cuNativeFetch<{ ok?: unknown }>(
          "/cu/activate-app",
          { bundleId },
        );
        if (response.ok !== true) {
          throw cuBridgeError(`Unexpected activate-app response for ${bundleId}`);
        }
        _cachedRunningApps = undefined;
        _runningAppsReady = undefined;
        log.debug(`[bridge] Native activate-app used bundle=${bundleId}`);
      } catch (err) {
        log.debug(
          `[bridge] Native activate-app failed, falling back to JXA: ${err}`,
        );
        await jxaOpen(bundleId);
      }
    };
  }

  if (nativeFeatureAvailable(resolution, "frontmost")) {
    input.getFrontmostAppInfo = async () => {
      try {
        const raw = await cuNativeFetch<{
          bundleId?: unknown;
          name?: unknown;
        }>("/cu/frontmost");
        const bundleId = typeof raw.bundleId === "string" ? raw.bundleId : "";
        const appName = typeof raw.name === "string" ? raw.name : "";
        if (!bundleId && !appName) return null;
        log.debug(`[bridge] Native frontmost used bundle=${bundleId}`);
        return { bundleId, appName };
      } catch (err) {
        log.debug(
          `[bridge] Native frontmost failed, falling back to JXA: ${err}`,
        );
        return jxaGetFrontmostAppInfo();
      }
    };
  }

  if (nativeFeatureAvailable(resolution, "input")) {
    input.moveMouse = async (x: number, y: number, animated: boolean) => {
      try {
        await cuNativeFetch<{ ok?: unknown }>("/cu/input/move-mouse", {
          x,
          y,
          animated,
        });
        log.debug(`[bridge] Native input.moveMouse used x=${x} y=${y}`);
      } catch (err) {
        log.debug(
          `[bridge] Native input.moveMouse failed, falling back to JXA: ${err}`,
        );
        await jxaMoveMouse(x, y, animated);
      }
    };

    input.mouseButton = async (
      button: "left" | "right" | "middle",
      action: "click" | "press" | "release",
      count?: number,
    ) => {
      try {
        await cuNativeFetch<{ ok?: unknown }>("/cu/input/mouse-button", {
          button,
          action,
          count,
        });
        log.debug(
          `[bridge] Native input.mouseButton used button=${button} action=${action}`,
        );
      } catch (err) {
        log.debug(
          `[bridge] Native input.mouseButton failed, falling back to JXA: ${err}`,
        );
        await jxaMouseButton(button, action, count);
      }
    };

    input.mouseScroll = async (
      delta: number,
      axis: "vertical" | "horizontal",
    ) => {
      try {
        await cuNativeFetch<{ ok?: unknown }>("/cu/input/mouse-scroll", {
          delta,
          axis,
        });
        log.debug(
          `[bridge] Native input.mouseScroll used axis=${axis} delta=${delta}`,
        );
      } catch (err) {
        log.debug(
          `[bridge] Native input.mouseScroll failed, falling back to JXA: ${err}`,
        );
        await jxaMouseScroll(delta, axis);
      }
    };

    input.mouseLocation = async () => {
      try {
        const location = await cuNativeFetch<{ x?: unknown; y?: unknown }>(
          "/cu/input/mouse-location",
        );
        const x = Number(location.x);
        const y = Number(location.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw cuBridgeError("Invalid native mouse-location response");
        }
        log.debug(`[bridge] Native input.mouseLocation used x=${x} y=${y}`);
        return { x, y };
      } catch (err) {
        log.debug(
          `[bridge] Native input.mouseLocation failed, falling back to JXA: ${err}`,
        );
        return await jxaMouseLocation();
      }
    };

    input.keys = async (parts: string[]) => {
      if (parts.length === 0) return;
      const keyName = parts[parts.length - 1];
      const modNames = parts.slice(0, -1);
      const parsed = parseKeySpec(
        modNames.length > 0 ? `${modNames.join("+")}+${keyName}` : keyName,
      );
      if (!parsed) {
        throw cuBridgeError(`Unknown key spec: "${parts.join("+")}"`);
      }
      try {
        await cuNativeFetch<{ ok?: unknown }>("/cu/input/keys", {
          keyCode: parsed.keyCode,
          modifiers: parsed.modifiers,
        });
        log.debug(
          `[bridge] Native input.keys used keyCode=${parsed.keyCode} modifiers=${
            parsed.modifiers.join(",")
          }`,
        );
      } catch (err) {
        log.debug(
          `[bridge] Native input.keys failed, falling back to JXA: ${err}`,
        );
        await jxaKeys(parts);
      }
    };

    input.key = async (
      name: string,
      action: "press" | "release",
    ) => {
      const effectiveName = name.toLowerCase();
      const modifierKeyCode: Record<string, number> = {
        command: 55,
        cmd: 55,
        shift: 56,
        option: 58,
        alt: 58,
        control: 59,
        ctrl: 59,
        fn: 63,
      };
      let keyCode: number;
      if (effectiveName in modifierKeyCode) {
        keyCode = modifierKeyCode[effectiveName];
      } else {
        const parsed = parseKeySpec(effectiveName);
        if (!parsed) throw cuBridgeError(`Unknown key: "${name}"`);
        keyCode = parsed.keyCode;
      }
      try {
        await cuNativeFetch<{ ok?: unknown }>("/cu/input/key", {
          keyCode,
          action,
        });
        log.debug(
          `[bridge] Native input.key used keyCode=${keyCode} action=${action}`,
        );
      } catch (err) {
        log.debug(
          `[bridge] Native input.key failed, falling back to JXA: ${err}`,
        );
        await jxaKey(name, action);
      }
    };

    input.typeText = async (text: string) => {
      const sanitized = text.replace(/\u0000/g, "");
      try {
        await cuNativeFetch<{ ok?: unknown }>("/cu/input/type-text", {
          text: sanitized,
        });
        log.debug(
          `[bridge] Native input.typeText used length=${sanitized.length}`,
        );
      } catch (err) {
        log.debug(
          `[bridge] Native input.typeText failed, falling back to JXA: ${err}`,
        );
        await jxaTypeText(text);
      }
    };
  }
}

// ── Display cache (bridge sync→async adaptation) ─────────────────────────

let _cachedDisplaySize: DisplayGeometry | undefined;
let _cachedDisplayList: DisplayGeometry[] | undefined;
let _cachedRunningApps: RunningApp[] | undefined;
let _displayCacheReady: Promise<void> | undefined;
let _runningAppsReady: Promise<void> | undefined;

async function initDisplayCache(): Promise<void> {
  try {
    const raw = await jxa(`
      ObjC.import('AppKit');
      var screens = $.NSScreen.screens;
      var result = [];
      for (var i = 0; i < screens.count; i++) {
        var s = screens.objectAtIndex(i);
        var frame = s.frame;
        var desc = s.deviceDescription;
        var displayId = ObjC.unwrap(desc.objectForKey($("NSScreenNumber")));
        var backingScale = s.backingScaleFactor;
        result.push({
          width: frame.size.width,
          height: frame.size.height,
          scaleFactor: backingScale,
          displayId: displayId,
          originX: frame.origin.x,
          originY: frame.origin.y
        });
      }
      JSON.stringify(result);
    `);
    const displays: DisplayGeometry[] = JSON.parse(raw);
    _cachedDisplayList = displays;
    if (displays.length > 0) {
      _cachedDisplaySize = displays[0];
    }
  } catch {
    // Fall back to defaults
  }
}

async function initRunningAppsCache(): Promise<void> {
  try {
    const raw = await jxa(`
      ObjC.import('AppKit');
      var apps = $.NSWorkspace.sharedWorkspace.runningApplications;
      var result = [];
      for (var i = 0; i < apps.count; i++) {
        var app = apps.objectAtIndex(i);
        var policy = app.activationPolicy;
        if (policy === $.NSApplicationActivationPolicyRegular) {
          var bid = ObjC.unwrap(app.bundleIdentifier);
          var name = ObjC.unwrap(app.localizedName);
          if (bid && name) result.push({ bundleId: bid, displayName: name });
        }
      }
      JSON.stringify(result);
    `);
    _cachedRunningApps = JSON.parse(raw);
  } catch {
    // Fall back to empty
  }
}

/**
 * Invalidate all cached state (display, running apps).
 * Called when a fresh CU lock is acquired to ensure the new session
 * starts with accurate system state.
 */
export function invalidateCaches(): void {
  _cachedDisplaySize = undefined;
  _cachedDisplayList = undefined;
  _cachedRunningApps = undefined;
  _displayCacheReady = undefined;
  _runningAppsReady = undefined;
  _cachedPermissionState = undefined;
}

/** Ensure display cache is populated. Await before reading getSize(). */
export async function ensureDisplayCache(): Promise<void> {
  if (_displayCacheReady) await _displayCacheReady;
  if (!_cachedDisplaySize) await initDisplayCache();
}

/** Ensure running apps cache is populated. Await before reading listRunning(). */
export async function ensureRunningAppsCache(): Promise<void> {
  if (_runningAppsReady) await _runningAppsReady;
  if (!_cachedRunningApps) await initRunningAppsCache();
}

// ── Screenshot implementation ────────────────────────────────────────────

async function captureScreenshot(
  quality: number,
  targetW: number,
  targetH: number,
  displayId?: number,
): Promise<ScreenshotResult> {
  const platform = getPlatform();
  const tmpDir = await platform.fs.makeTempDir({ prefix: "hlvm-cu" });
  const tmpPath = platform.path.join(tmpDir, `screenshot-${Date.now()}.jpg`);

  try {
    await ensureDisplayCache();
    const displays = _cachedDisplayList ?? [selectDisplayGeometry(displayId)];
    const selectedDisplayId = displayId ??
      displays[0]?.displayId ??
      DEFAULT_DISPLAY_GEOMETRY.displayId ??
      1;
    const displayIndex = resolveCaptureDisplayIndex(
      displays,
      selectedDisplayId,
    );
    const captureArgs = [
      "screencapture",
      "-x",
      "-t",
      "jpg",
      `-D${displayIndex}`,
      tmpPath,
    ];

    const capResult = await platform.command.output({
      cmd: captureArgs,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    if (!capResult.success) {
      throw cuBridgeError(
        `screencapture failed: ${new TextDecoder().decode(capResult.stderr)}`,
      );
    }

    // Resize to target dimensions
    await platform.command.output({
      cmd: [
        "sips",
        "--resampleWidth",
        String(targetW),
        "--resampleHeight",
        String(targetH),
        "--setProperty",
        "formatOptions",
        String(Math.round(quality * 100)),
        tmpPath,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });

    // Read and encode
    const bytes = await platform.fs.readFile(tmpPath);
    const base64 = btoa(
      Array.from(bytes, (b) => String.fromCharCode(b)).join(""),
    );

    return { base64, width: targetW, height: targetH };
  } finally {
    try {
      await platform.fs.remove(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  }
}

export const _testOnly = {
  sortWindowsForSelection,
  sortDisplayIdsByDisplayOrder,
  computeHideCandidates,
  resolvePreparationPlan,
  selectWindowAtPoint,
  resolveCaptureDisplayId,
  resolveCaptureDisplayIndex,
  setSwiftInstance(instance: ComputerUseSwiftAPI | undefined) {
    _swiftInstance = instance;
  },
  setInputInstance(instance: ComputerUseInputAPI | undefined) {
    _inputInstance = instance;
  },
  seedCaches(opts: {
    displaySize?: DisplayGeometry;
    displayList?: DisplayGeometry[];
    runningApps?: RunningApp[];
  }) {
    _cachedDisplaySize = opts.displaySize;
    _cachedDisplayList = opts.displayList;
    _cachedRunningApps = opts.runningApps;
    _displayCacheReady = Promise.resolve();
    _runningAppsReady = Promise.resolve();
  },
  setBackendResolution(resolution: CUBackendResolution | undefined) {
    _backendResolution = resolution;
  },
  setNativeFetchOverride(
    override:
      | ((path: string, body?: unknown) => Promise<unknown>)
      | undefined,
  ) {
    _cuNativeFetchOverride = override;
  },
  resetBridgeState() {
    _inputInstance = undefined;
    _swiftInstance = undefined;
    _cuNativeFetchOverride = undefined;
    invalidateCaches();
    invalidateBackendResolution();
  },
};

async function captureScreenshotRegion(
  x: number,
  y: number,
  w: number,
  h: number,
  outW: number,
  outH: number,
  quality: number,
): Promise<{ base64: string; width: number; height: number }> {
  const platform = getPlatform();
  const tmpDir = await platform.fs.makeTempDir({ prefix: "hlvm-cu" });
  const tmpPath = platform.path.join(tmpDir, `region-${Date.now()}.jpg`);

  try {
    // Capture region: screencapture -x -t jpg -R x,y,w,h
    const capResult = await platform.command.output({
      cmd: [
        "screencapture",
        "-x",
        "-t",
        "jpg",
        "-R",
        `${x},${y},${w},${h}`,
        tmpPath,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    if (!capResult.success) {
      throw cuBridgeError(
        `screencapture region failed: ${
          new TextDecoder().decode(capResult.stderr)
        }`,
      );
    }

    // Resize to target dimensions
    await platform.command.output({
      cmd: [
        "sips",
        "--resampleWidth",
        String(outW),
        "--resampleHeight",
        String(outH),
        "--setProperty",
        "formatOptions",
        String(Math.round(quality * 100)),
        tmpPath,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });

    const bytes = await platform.fs.readFile(tmpPath);
    const base64 = btoa(
      Array.from(bytes, (b) => String.fromCharCode(b)).join(""),
    );

    return { base64, width: outW, height: outH };
  } finally {
    try {
      await platform.fs.remove(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  }
}
