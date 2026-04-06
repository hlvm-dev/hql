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

// ── Screenshot ───────────────────────────────────────────────────────────

export interface ScreenshotResult {
  base64: string;
  width: number;
  height: number;
}

export interface ResolvePrepareCaptureResult {
  displayId: number;
  hidden: string[];
  screenshot: ScreenshotResult;
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
  ): Promise<string[]>;
  previewHideSet(
    allowlistBundleIds: string[],
    displayId?: number,
  ): Promise<Array<{ bundleId: string; displayName: string }>>;

  // Display
  getDisplaySize(displayId?: number): Promise<DisplayGeometry>;
  listDisplays(): Promise<DisplayGeometry[]>;
  findWindowDisplays(
    bundleIds: string[],
  ): Promise<Array<{ bundleId: string; displayIds: number[] }>>;
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
  ): Promise<{ bundleId: string; displayName: string } | null>;
  listInstalledApps(): Promise<InstalledApp[]>;
  getAppIcon(path: string): Promise<string | undefined>;
  listRunningApps(): Promise<RunningApp[]>;
  openApp(bundleId: string): Promise<void>;
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
  getFrontmostAppInfo(): Promise<{
    bundleId: string;
    appName: string;
  } | null>;
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
    ): Promise<{ activated: string | null; hidden: string[] }>;
    previewHideSet(
      bundleIds: string[],
      displayId?: number,
    ): Promise<Array<{ bundleId: string; displayName: string }>>;
    findWindowDisplays(
      bundleIds: string[],
    ): Promise<Array<{ bundleId: string; displayIds: number[] }>>;
    listInstalled(): Promise<InstalledApp[]>;
    iconDataUrl(path: string): string | null;
    listRunning(): RunningApp[];
    open(bundleId: string): Promise<void>;
    unhide(bundleIds: string[]): Promise<void>;
    appUnderPoint(
      x: number,
      y: number,
    ): Promise<{ bundleId: string; displayName: string } | null>;
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
