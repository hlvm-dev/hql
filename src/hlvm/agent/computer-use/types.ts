/**
 * Computer Use — Type Definitions
 *
 * Mirrors types from `@ant/computer-use-mcp`, `@ant/computer-use-input`,
 * and `@ant/computer-use-swift` that CC's executor.ts imports.
 * HLVM defines these locally since we don't have the proprietary packages.
 */

// ── Display ──────────────────────────────────────────────────────────────

export interface DisplayGeometry {
  width: number;
  height: number;
  scaleFactor: number;
  displayId?: number;
  originX?: number;
  originY?: number;
}

export interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DisplaySelectionReason =
  | "explicit"
  | "target_window"
  | "target_app"
  | "frontmost_app"
  | "previous_observation"
  | "default";

// ── Apps ──────────────────────────────────────────────────────────────────

export interface FrontmostApp {
  bundleId: string;
  displayName: string;
}

export interface InstalledApp {
  bundleId: string;
  displayName: string;
  path: string;
  iconDataUrl?: string;
}

export interface RunningApp {
  bundleId: string;
  displayName: string;
}

export interface WindowInfo {
  windowId: number;
  bundleId?: string;
  displayName: string;
  title?: string;
  bounds: BoundsRect;
  displayId?: number;
  zIndex: number;
  layer: number;
  ownerPid?: number;
  isOnscreen?: boolean;
}

export type ObservationTargetKind =
  | "window"
  | "button"
  | "textfield"
  | "checkbox"
  | "menuitem"
  | "link"
  | "other";

export interface ObservationTarget {
  targetId: string;
  kind: ObservationTargetKind;
  label: string;
  role: string;
  bounds: BoundsRect;
  bundleId: string;
  confidence: number;
  windowId?: number;
  displayId?: number;
}

export interface ComputerUsePermissionState {
  accessibilityTrusted: boolean;
  screenRecordingAvailable: boolean | null;
  missing: string[];
  checkedAt: number;
}

// ── Screenshot ───────────────────────────────────────────────────────────

export interface ScreenshotResult {
  base64: string;
  width: number;
  height: number;
}

export interface HideCandidate {
  bundleId: string;
  displayName: string;
}

export interface PrepareForActionResult {
  activated: string | null;
  hidden: string[];
  selectedDisplayId?: number;
  selectedTargetBundleId?: string;
  selectedTargetWindowId?: number;
  resolutionReason?: string;
  failureReason?: string;
}

export interface ResolvePrepareCaptureResult {
  displayId: number;
  hidden: string[];
  screenshot: ScreenshotResult;
  selectedTargetBundleId?: string;
  selectedTargetWindowId?: number;
  resolutionReason?: string;
  failureReason?: string;
}

export interface DesktopObservation {
  observationId: string;
  createdAt: number;
  groundingSource: "native_targets" | "window_fallback";
  display: DisplayGeometry;
  displaySelectionReason: DisplaySelectionReason;
  screenshot: ScreenshotResult;
  frontmostApp: FrontmostApp | null;
  runningApps: RunningApp[];
  windows: WindowInfo[];
  targets: ObservationTarget[];
  permissions: ComputerUsePermissionState;
  resolvedTargetBundleId?: string;
  resolvedTargetWindowId?: number;
}

// ── Image Sizing (CC: API_RESIZE_PARAMS + targetImageSize) ───────────────

/**
 * CC's API resize params. The API backend expects images no larger than
 * these dims — screenshots are pre-resized to avoid server-side rescale.
 */
export const API_RESIZE_PARAMS = {
  maxLongSide: 1280,
  maxShortSide: 1024,
};

/**
 * Compute target image dimensions from physical pixel size.
 * Mirrors `@ant/computer-use-mcp`'s `targetImageSize`.
 */
export function targetImageSize(
  physW: number,
  physH: number,
  params: typeof API_RESIZE_PARAMS,
): [number, number] {
  const longSide = Math.max(physW, physH);
  const shortSide = Math.min(physW, physH);

  let scale = 1;
  if (longSide > params.maxLongSide) {
    scale = params.maxLongSide / longSide;
  }
  if (shortSide * scale > params.maxShortSide) {
    scale = params.maxShortSide / shortSide;
  }

  return [Math.round(physW * scale), Math.round(physH * scale)];
}

// ── Executor Interface (CC: ComputerExecutor from @ant/computer-use-mcp) ─

export interface ComputerExecutor {
  capabilities: {
    screenshotFiltering: "native" | "none";
    platform: "darwin";
    hostBundleId: string;
  };

  // Pre-action (hide + defocus)
  prepareForAction(
    allowlistBundleIds: string[],
    displayId?: number,
  ): Promise<PrepareForActionResult>;
  previewHideSet(
    allowlistBundleIds: string[],
    displayId?: number,
  ): Promise<HideCandidate[]>;

  // Display
  getDisplaySize(displayId?: number): Promise<DisplayGeometry>;
  listDisplays(): Promise<DisplayGeometry[]>;
  findWindowDisplays(
    bundleIds: string[],
  ): Promise<Array<{ bundleId: string; displayIds: number[] }>>;
  listVisibleWindows(displayId?: number): Promise<WindowInfo[]>;
  resolvePrepareCapture(opts: {
    allowedBundleIds: string[];
    preferredDisplayId?: number;
    autoResolve: boolean;
    doHide?: boolean;
  }): Promise<ResolvePrepareCaptureResult>;

  // Screenshot
  screenshot(opts: {
    allowedBundleIds: string[];
    displayId?: number;
  }): Promise<ScreenshotResult>;
  zoom(
    regionLogical: { x: number; y: number; w: number; h: number },
    allowedBundleIds: string[],
    displayId?: number,
  ): Promise<{ base64: string; width: number; height: number }>;
  observe(opts: {
    allowedBundleIds: string[];
    preferredDisplayId?: number;
    displaySelectionReason?: DisplaySelectionReason;
    resolvedTargetBundleId?: string;
    resolvedTargetWindowId?: number;
  }): Promise<DesktopObservation>;

  // Keyboard
  key(keySequence: string, repeat?: number): Promise<void>;
  holdKey(keyNames: string[], durationMs: number): Promise<void>;
  type(text: string, opts: { viaClipboard: boolean }): Promise<void>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;

  // Mouse
  moveMouse(x: number, y: number): Promise<void>;
  click(
    x: number,
    y: number,
    button: "left" | "right" | "middle",
    count: 1 | 2 | 3,
    modifiers?: string[],
  ): Promise<void>;
  mouseDown(): Promise<void>;
  mouseUp(): Promise<void>;
  getCursorPosition(): Promise<{ x: number; y: number }>;
  drag(
    from: { x: number; y: number } | undefined,
    to: { x: number; y: number },
  ): Promise<void>;
  scroll(x: number, y: number, dx: number, dy: number): Promise<void>;

  // App management
  getFrontmostApp(): Promise<FrontmostApp | null>;
  appUnderPoint(
    x: number,
    y: number,
  ): Promise<
    {
      bundleId: string;
      displayName: string;
      windowId?: number;
      displayId?: number;
    } | null
  >;
  listInstalledApps(): Promise<InstalledApp[]>;
  getAppIcon(path: string): Promise<string | undefined>;
  listRunningApps(): Promise<RunningApp[]>;
  openApp(bundleId: string): Promise<void>;
  getPermissionState(): Promise<ComputerUsePermissionState>;
}

// ── Native Module Interfaces (bridge must implement these) ───────────────

/** Mirrors `@ant/computer-use-input` API. */
export interface ComputerUseInputAPI {
  moveMouse(x: number, y: number, animated: boolean): Promise<void>;
  mouseButton(
    button: "left" | "right" | "middle",
    action: "click" | "press" | "release",
    count?: number,
  ): Promise<void>;
  mouseScroll(delta: number, axis: "vertical" | "horizontal"): Promise<void>;
  mouseLocation(): Promise<{ x: number; y: number }>;
  keys(parts: string[]): Promise<void>;
  key(name: string, action: "press" | "release"): Promise<void>;
  typeText(text: string): Promise<void>;
  getFrontmostAppInfo(): Promise<
    {
      bundleId: string;
      appName: string;
    } | null
  >;
}

/** Mirrors `@ant/computer-use-swift` API. */
export interface ComputerUseSwiftAPI {
  _drainMainRunLoop(): void;
  display: {
    getSize(displayId?: number): DisplayGeometry;
    listAll(): DisplayGeometry[];
  };
  screenshot: {
    captureExcluding(
      allowedBundleIds: string[],
      quality: number,
      targetW: number,
      targetH: number,
      displayId?: number,
    ): Promise<ScreenshotResult>;
    captureRegion(
      allowedBundleIds: string[],
      x: number,
      y: number,
      w: number,
      h: number,
      outW: number,
      outH: number,
      quality: number,
      displayId?: number,
    ): Promise<{ base64: string; width: number; height: number }>;
  };
  apps: {
    prepareDisplay(
      allowedBundleIds: string[],
      hostBundleId: string,
      displayId?: number,
      hideDistractors?: boolean,
    ): Promise<PrepareForActionResult>;
    previewHideSet(
      bundleIds: string[],
      displayId?: number,
    ): Promise<HideCandidate[]>;
    findWindowDisplays(
      bundleIds: string[],
    ): Promise<Array<{ bundleId: string; displayIds: number[] }>>;
    listVisibleWindows(displayId?: number): Promise<WindowInfo[]>;
    listInstalled(): Promise<InstalledApp[]>;
    iconDataUrl(path: string): string | null;
    listRunning(): RunningApp[];
    open(bundleId: string): Promise<void>;
    unhide(bundleIds: string[]): Promise<void>;
    appUnderPoint(
      x: number,
      y: number,
    ): Promise<
      {
        bundleId: string;
        displayName: string;
        windowId?: number;
        displayId?: number;
      } | null
    >;
  };
  permissions: {
    getState(): Promise<ComputerUsePermissionState>;
  };
  resolvePrepareCapture(
    allowedBundleIds: string[],
    hostBundleId: string,
    quality: number,
    targetW: number,
    targetH: number,
    displayId?: number,
    autoResolve?: boolean,
    doHide?: boolean,
  ): Promise<ResolvePrepareCaptureResult>;
  hotkey: {
    registerEscape(callback: () => void): boolean;
    unregister(): void;
    notifyExpectedEscape(): void;
  };
}

// ── CU Backend Selection ────────────────────────────────────────────────

export type CUBackendKind = "native_gui" | "jxa";

export interface CUNativeCapabilities {
  version: string;
  features: string[];
}

export interface CUBackendResolution {
  backend: CUBackendKind;
  capabilities?: CUNativeCapabilities;
  port?: number;
}

// ── Native Execute Plan ─────────────────────────────────────────────────

export interface CUPlanTargetSelector {
  bundle_id: string;
  window_title_contains?: string;
  role_in: string[];
  label_contains?: string;
  value_contains?: string;
  index?: number;
}

export type CUPlanStep =
  | {
    op: "open_app";
    bundle_id: string;
  }
  | {
    op: "wait_for_ready";
    bundle_id?: string;
    target_ref?: string;
    timeout_ms?: number;
  }
  | {
    op: "find_target";
    id: string;
    selector: CUPlanTargetSelector;
  }
  | {
    op: "click";
    target_ref: string;
  }
  | {
    op: "type_into";
    target_ref: string;
    text: string;
  }
  | {
    op: "press_keys";
    keys: string;
    repeat?: number;
  }
  | {
    op: "verify";
    predicate:
      | "frontmost_app_is"
      | "window_visible"
      | "target_exists"
      | "target_value_contains"
      | "target_enabled";
    bundle_id?: string;
    window_title_contains?: string;
    target_ref?: string;
    value_contains?: string;
    enabled?: boolean;
  };

export interface CUExecutePlanRequest {
  steps: CUPlanStep[];
  displayId?: number;
}

export interface CUExecutePlanStepRecord {
  index: number;
  op: CUPlanStep["op"];
  status: "completed" | "blocked";
  stepId?: string;
  message?: string;
}

export interface CUExecutePlanFailure {
  code: string;
  message: string;
  retryable: boolean;
  stepIndex?: number;
  stepOp?: CUPlanStep["op"];
  facts?: Record<string, unknown>;
}

export interface CUExecutePlanResponse {
  ok: boolean;
  status: "completed" | "blocked";
  steps: CUExecutePlanStepRecord[];
  failure?: CUExecutePlanFailure;
  finalBundleId?: string;
  finalWindowId?: number;
  finalDisplayId?: number;
}
