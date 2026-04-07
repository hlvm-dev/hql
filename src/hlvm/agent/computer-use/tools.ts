/**
 * Computer Use — Tool Definitions (V2: CC Parity)
 *
 * 22 tools matching Claude Code's `computer_20250124` tool spec.
 * Each tool wraps the ComputerExecutor interface with guards + error handling.
 *
 * Tool name prefix: `cu_*` (CC uses `mcp__computer-use__*`).
 *
 * CC reference:
 *   toolRendering.tsx  — tool name list, CuToolInput type, result summaries
 *   wrapper.tsx        — dispatch + lock pattern
 *   computer_20250124  — official Anthropic SDK descriptions + Zod schemas
 *
 * Parameter conventions (from CC's Anthropic SDK schema):
 *   coordinate:       [x, y] pixel tuple
 *   start_coordinate: [x, y] pixel tuple (drag origin)
 *   text:             string (key spec, typed text, clipboard content, or modifiers)
 *   scroll_direction: 'up' | 'down' | 'left' | 'right'
 *   scroll_amount:    number (clicks)
 *   duration:         number (seconds)
 *   region:           [x1, y1, x2, y2] pixel rect
 */

import type { ToolMetadata, ToolExecutionOptions } from "../registry.ts";
import { failTool, formatToolError, okTool } from "../tool-results.ts";
import type { ComputerExecutor } from "./types.ts";
import { createCliExecutor } from "./executor.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { tryAcquireComputerUseLock } from "./lock.ts";

// ── CC Result Summary Map (from toolRendering.tsx) ──────────────────────
// Used by formatResult to provide concise tool result summaries.
const RESULT_SUMMARY: Record<string, string> = {
  screenshot: "Captured",
  zoom: "Captured",
  request_access: "Access updated",
  left_click: "Clicked",
  right_click: "Clicked",
  middle_click: "Clicked",
  double_click: "Clicked",
  triple_click: "Clicked",
  type: "Typed",
  key: "Pressed",
  hold_key: "Pressed",
  scroll: "Scrolled",
  left_click_drag: "Dragged",
  open_application: "Opened",
};

// ── Executor singleton ───────────────────────────────────────────────────

let _executor: ComputerExecutor | undefined;

function getExecutor(): ComputerExecutor {
  if (_executor) return _executor;
  _executor = createCliExecutor({
    // HLVM: animation always enabled (CC toggles via settings)
    getMouseAnimationEnabled: () => true,
    // HLVM: hide-before-action disabled (CC toggles via settings)
    getHideBeforeActionEnabled: () => false,
  });
  return _executor;
}

// ── Guards ────────────────────────────────────────────────────────────────

function platformGuard(): ReturnType<typeof failTool> | null {
  if (getPlatform().build.os !== "darwin") {
    return failTool("Computer use is only supported on macOS");
  }
  return null;
}

async function lockGuard(
  options?: ToolExecutionOptions,
): Promise<ReturnType<typeof failTool> | null> {
  const sessionId = options?.sessionId ?? "default";
  const result = await tryAcquireComputerUseLock(sessionId);
  if (result.kind === "blocked") {
    return failTool(
      `Computer use is in use by another session (${result.by.slice(0, 8)}…). Wait for that session to finish.`,
    );
  }
  return null;
}

async function guards(
  options?: ToolExecutionOptions,
): Promise<ReturnType<typeof failTool> | null> {
  const pGuard = platformGuard();
  if (pGuard) return pGuard;
  return lockGuard(options);
}

// ── Helpers (derived from CC parameter patterns) ─────────────────────────

/** Parse CC-style [x, y] coordinate tuple from args. */
function parseCoordinate(
  coord: unknown,
  name = "coordinate",
): { x: number; y: number } {
  if (!Array.isArray(coord) || coord.length !== 2) {
    throw new Error(`${name} must be a [x, y] tuple`);
  }
  const [x, y] = coord as [number, number];
  if (typeof x !== "number" || typeof y !== "number") {
    throw new Error(`${name} values must be numbers`);
  }
  return { x, y };
}

/**
 * Parse modifier keys from CC's text parameter.
 * CC uses the text field to pass modifiers for click tools (e.g. "shift").
 */
function parseModifiers(text?: string): string[] | undefined {
  if (!text) return undefined;
  return text
    .split("+")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Convert CC scroll_direction + scroll_amount to executor dx/dy.
 * CC: direction is 'up'|'down'|'left'|'right', amount is click count.
 * Executor: scroll(x, y, dx, dy) where positive dy = scroll down.
 */
function scrollDirectionToDeltas(
  direction: string,
  amount: number,
): { dx: number; dy: number } {
  switch (direction) {
    case "up":
      return { dx: 0, dy: -amount };
    case "down":
      return { dx: 0, dy: amount };
    case "left":
      return { dx: -amount, dy: 0 };
    case "right":
      return { dx: amount, dy: 0 };
    default:
      throw new Error(`Invalid scroll direction: ${direction}`);
  }
}

// ── Helper: sleep ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Tool implementations (22 tools) ──────────────────────────────────────

// 1. cu_screenshot
async function cuScreenshotFn(
  _args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const exec = getExecutor();
    const result = await exec.screenshot({ allowedBundleIds: [] });
    return {
      ...okTool({ width: result.width, height: result.height }),
      _imageAttachment: {
        data: result.base64,
        mimeType: "image/jpeg",
        width: result.width,
        height: result.height,
      },
    };
  } catch (error) {
    return failTool(formatToolError("Screenshot failed", error).message);
  }
}

// 2. cu_cursor_position
async function cuCursorPositionFn(
  _args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const exec = getExecutor();
    const pos = await exec.getCursorPosition();
    return okTool({ x: pos.x, y: pos.y });
  } catch (error) {
    return failTool(formatToolError("Get cursor position failed", error).message);
  }
}

// 3. cu_left_mouse_down
async function cuLeftMouseDownFn(
  _args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const exec = getExecutor();
    await exec.mouseDown();
    return okTool({ pressed: "left" });
  } catch (error) {
    return failTool(formatToolError("Mouse down failed", error).message);
  }
}

// 4. cu_left_mouse_up
async function cuLeftMouseUpFn(
  _args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const exec = getExecutor();
    await exec.mouseUp();
    return okTool({ released: "left" });
  } catch (error) {
    return failTool(formatToolError("Mouse up failed", error).message);
  }
}

// 5. cu_list_granted_applications
async function cuListGrantedApplicationsFn(
  _args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const exec = getExecutor();
    const apps = await exec.listRunningApps();
    return okTool({
      apps: apps.map((a) => ({
        bundleId: a.bundleId,
        displayName: a.displayName,
      })),
    });
  } catch (error) {
    return failTool(
      formatToolError("List granted applications failed", error).message,
    );
  }
}

// 6. cu_read_clipboard
async function cuReadClipboardFn(
  _args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const exec = getExecutor();
    const text = await exec.readClipboard();
    return okTool({ text });
  } catch (error) {
    return failTool(formatToolError("Clipboard read failed", error).message);
  }
}

// 7. cu_left_click
async function cuLeftClickFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { coordinate, text } = args as {
      coordinate: [number, number];
      text?: string;
    };
    const { x, y } = parseCoordinate(coordinate);
    const mods = parseModifiers(text);
    const exec = getExecutor();
    await exec.click(x, y, "left", 1, mods);
    return okTool({ clicked: { x, y } });
  } catch (error) {
    return failTool(formatToolError("Left click failed", error).message);
  }
}

// 8. cu_right_click
async function cuRightClickFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { coordinate, text } = args as {
      coordinate: [number, number];
      text?: string;
    };
    const { x, y } = parseCoordinate(coordinate);
    const mods = parseModifiers(text);
    const exec = getExecutor();
    await exec.click(x, y, "right", 1, mods);
    return okTool({ clicked: { x, y } });
  } catch (error) {
    return failTool(formatToolError("Right click failed", error).message);
  }
}

// 9. cu_middle_click
async function cuMiddleClickFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { coordinate, text } = args as {
      coordinate: [number, number];
      text?: string;
    };
    const { x, y } = parseCoordinate(coordinate);
    const mods = parseModifiers(text);
    const exec = getExecutor();
    await exec.click(x, y, "middle", 1, mods);
    return okTool({ clicked: { x, y } });
  } catch (error) {
    return failTool(formatToolError("Middle click failed", error).message);
  }
}

// 10. cu_double_click
async function cuDoubleClickFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { coordinate, text } = args as {
      coordinate: [number, number];
      text?: string;
    };
    const { x, y } = parseCoordinate(coordinate);
    const mods = parseModifiers(text);
    const exec = getExecutor();
    await exec.click(x, y, "left", 2, mods);
    return okTool({ clicked: { x, y } });
  } catch (error) {
    return failTool(formatToolError("Double click failed", error).message);
  }
}

// 11. cu_triple_click
async function cuTripleClickFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { coordinate, text } = args as {
      coordinate: [number, number];
      text?: string;
    };
    const { x, y } = parseCoordinate(coordinate);
    const mods = parseModifiers(text);
    const exec = getExecutor();
    await exec.click(x, y, "left", 3, mods);
    return okTool({ clicked: { x, y } });
  } catch (error) {
    return failTool(formatToolError("Triple click failed", error).message);
  }
}

// 12. cu_mouse_move
async function cuMouseMoveFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { coordinate } = args as { coordinate: [number, number] };
    const { x, y } = parseCoordinate(coordinate);
    const exec = getExecutor();
    await exec.moveMouse(x, y);
    return okTool({ moved: { x, y } });
  } catch (error) {
    return failTool(formatToolError("Mouse move failed", error).message);
  }
}

// 13. cu_type
async function cuTypeFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { text } = args as { text: string };
    const exec = getExecutor();
    await exec.type(text, { viaClipboard: true });
    return okTool({
      typed: text.length > 80 ? text.slice(0, 77) + "..." : text,
    });
  } catch (error) {
    return failTool(formatToolError("Type failed", error).message);
  }
}

// 14. cu_key
async function cuKeyFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { text, repeat } = args as { text: string; repeat?: number };
    const exec = getExecutor();
    await exec.key(text, repeat);
    return okTool({ pressed: text, repeat: repeat ?? 1 });
  } catch (error) {
    return failTool(formatToolError("Key press failed", error).message);
  }
}

// 15. cu_hold_key
async function cuHoldKeyFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { text, duration } = args as { text: string; duration: number };
    const exec = getExecutor();
    // SDK says text is a single key string; executor takes string[]
    await exec.holdKey([text], duration * 1000);
    return okTool({ held: text, duration_seconds: duration });
  } catch (error) {
    return failTool(formatToolError("Hold key failed", error).message);
  }
}

// 16. cu_write_clipboard
async function cuWriteClipboardFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { text } = args as { text: string };
    const exec = getExecutor();
    await exec.writeClipboard(text);
    return okTool({ written: true });
  } catch (error) {
    return failTool(formatToolError("Clipboard write failed", error).message);
  }
}

// 17. cu_scroll
async function cuScrollFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { coordinate, scroll_direction, scroll_amount, text } = args as {
      coordinate: [number, number];
      scroll_direction: string;
      scroll_amount: number;
      text?: string;
    };
    const { x, y } = parseCoordinate(coordinate);
    const { dx, dy } = scrollDirectionToDeltas(
      scroll_direction,
      scroll_amount,
    );
    const exec = getExecutor();
    await exec.scroll(x, y, dx, dy);
    return okTool({
      scrolled: { x, y, direction: scroll_direction, amount: scroll_amount },
    });
  } catch (error) {
    return failTool(formatToolError("Scroll failed", error).message);
  }
}

// 18. cu_left_click_drag
async function cuLeftClickDragFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { coordinate, start_coordinate } = args as {
      coordinate: [number, number];
      start_coordinate?: [number, number];
    };
    const to = parseCoordinate(coordinate);
    const from = start_coordinate
      ? parseCoordinate(start_coordinate, "start_coordinate")
      : undefined;
    const exec = getExecutor();
    await exec.drag(from, to);
    return okTool({
      dragged: { from: from ?? "current cursor", to },
    });
  } catch (error) {
    return failTool(formatToolError("Drag failed", error).message);
  }
}

// 19. cu_zoom
async function cuZoomFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { region } = args as { region: [number, number, number, number] };
    if (!Array.isArray(region) || region.length !== 4) {
      throw new Error("region must be a [x1, y1, x2, y2] tuple");
    }
    const [x1, y1, x2, y2] = region;
    // Convert [x1,y1,x2,y2] to {x,y,w,h} for executor
    const regionLogical = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    const exec = getExecutor();
    const result = await exec.zoom(regionLogical, []);
    return {
      ...okTool({ width: result.width, height: result.height }),
      _imageAttachment: {
        data: result.base64,
        mimeType: "image/jpeg",
        width: result.width,
        height: result.height,
      },
    };
  } catch (error) {
    return failTool(formatToolError("Zoom failed", error).message);
  }
}

// 20. cu_open_application
async function cuOpenApplicationFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { bundle_id } = args as { bundle_id: string };
    const exec = getExecutor();
    await exec.openApp(bundle_id);
    return okTool({ opened: bundle_id });
  } catch (error) {
    return failTool(formatToolError("Open application failed", error).message);
  }
}

// 21. cu_request_access
async function cuRequestAccessFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { apps } = args as {
      apps: Array<{ displayName?: string }>;
    };
    // Stub: HLVM uses system accessibility settings.
    // CC shows a React permission dialog via setToolJSX.
    const names = apps.map((a) => a.displayName ?? "unknown").join(", ");
    return okTool({
      message: `Access request noted for: ${names}. Use System Preferences > Privacy & Security to grant accessibility access.`,
    });
  } catch (error) {
    return failTool(formatToolError("Request access failed", error).message);
  }
}

// 22. cu_wait
async function cuWaitFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { duration } = args as { duration: number };
    const cappedDuration = Math.min(duration, 100);
    await sleep(cappedDuration * 1000);
    // CC takes a screenshot after wait — useful for observing results
    const exec = getExecutor();
    const result = await exec.screenshot({ allowedBundleIds: [] });
    return {
      ...okTool({
        waited_seconds: cappedDuration,
        width: result.width,
        height: result.height,
      }),
      _imageAttachment: {
        data: result.base64,
        mimeType: "image/jpeg",
        width: result.width,
        height: result.height,
      },
    };
  } catch (error) {
    return failTool(formatToolError("Wait failed", error).message);
  }
}

// ── Tool Metadata (22 entries) ───────────────────────────────────────────
// Descriptions copied from Anthropic SDK computer_20250124.ts.

export const COMPUTER_USE_TOOLS: Record<string, ToolMetadata> = {
  // ── No-param tools ──────────────────────────────────────────────────

  cu_screenshot: {
    fn: cuScreenshotFn,
    description: "Take a screenshot of the screen.",
    args: {},
    category: "read",
    safetyLevel: "L1",
    safety: "Captures visible screen content. No side effects.",
    execution: { concurrencySafe: true },
    presentation: { kind: "read" },
    formatResult: (result) => {
      const r = result as { width?: number; height?: number };
      return {
        summaryDisplay: `${RESULT_SUMMARY.screenshot} ${r.width ?? "?"}x${r.height ?? "?"}`,
        returnDisplay: `Screenshot captured: ${r.width ?? "?"}x${r.height ?? "?"}px`,
      };
    },
  },

  cu_cursor_position: {
    fn: cuCursorPositionFn,
    description:
      "Get the current (x, y) pixel coordinate of the cursor.",
    args: {},
    category: "read",
    safetyLevel: "L0",
    safety: "Read-only query of cursor position.",
    execution: { concurrencySafe: true },
    presentation: { kind: "read" },
  },

  cu_left_mouse_down: {
    fn: cuLeftMouseDownFn,
    description: "Press the left mouse button.",
    args: {},
    category: "write",
    safetyLevel: "L2",
    safety: "Presses left mouse button. May interact with UI.",
  },

  cu_left_mouse_up: {
    fn: cuLeftMouseUpFn,
    description: "Release the left mouse button.",
    args: {},
    category: "write",
    safetyLevel: "L2",
    safety: "Releases left mouse button.",
  },

  cu_list_granted_applications: {
    fn: cuListGrantedApplicationsFn,
    description:
      "List the applications that are currently running and accessible.",
    args: {},
    category: "read",
    safetyLevel: "L0",
    safety: "Read-only query of running applications.",
    execution: { concurrencySafe: true },
    presentation: { kind: "read" },
  },

  cu_read_clipboard: {
    fn: cuReadClipboardFn,
    description: "Read the current system clipboard text content.",
    args: {},
    category: "read",
    safetyLevel: "L0",
    safety: "Read-only clipboard access.",
    execution: { concurrencySafe: true },
    presentation: { kind: "read" },
  },

  // ── Coordinate tools (click family) ─────────────────────────────────

  cu_left_click: {
    fn: cuLeftClickFn,
    description:
      "Click the left mouse button at the specified (x, y) pixel coordinate. Hold modifier keys via the text parameter.",
    args: {
      coordinate: "[number, number] - [x, y] pixel coordinate",
      text: 'string (optional) - Modifier keys to hold, e.g. "shift" or "command+shift"',
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Clicks at screen coordinates. May interact with any visible UI.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.left_click,
      returnDisplay: "Left clicked",
    }),
  },

  cu_right_click: {
    fn: cuRightClickFn,
    description:
      "Click the right mouse button at the specified (x, y) pixel coordinate.",
    args: {
      coordinate: "[number, number] - [x, y] pixel coordinate",
      text: 'string (optional) - Modifier keys to hold, e.g. "shift"',
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Right-clicks at screen coordinates.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.right_click,
      returnDisplay: "Right clicked",
    }),
  },

  cu_middle_click: {
    fn: cuMiddleClickFn,
    description:
      "Click the middle mouse button at the specified (x, y) pixel coordinate.",
    args: {
      coordinate: "[number, number] - [x, y] pixel coordinate",
      text: 'string (optional) - Modifier keys to hold',
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Middle-clicks at screen coordinates.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.middle_click,
      returnDisplay: "Middle clicked",
    }),
  },

  cu_double_click: {
    fn: cuDoubleClickFn,
    description:
      "Double-click the left mouse button at the specified (x, y) pixel coordinate.",
    args: {
      coordinate: "[number, number] - [x, y] pixel coordinate",
      text: 'string (optional) - Modifier keys to hold',
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Double-clicks at screen coordinates.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.double_click,
      returnDisplay: "Double clicked",
    }),
  },

  cu_triple_click: {
    fn: cuTripleClickFn,
    description:
      "Triple-click the left mouse button at the specified (x, y) pixel coordinate.",
    args: {
      coordinate: "[number, number] - [x, y] pixel coordinate",
      text: 'string (optional) - Modifier keys to hold',
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Triple-clicks at screen coordinates.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.triple_click,
      returnDisplay: "Triple clicked",
    }),
  },

  // ── Mouse move ──────────────────────────────────────────────────────

  cu_mouse_move: {
    fn: cuMouseMoveFn,
    description:
      "Move the cursor to a specified (x, y) pixel coordinate.",
    args: {
      coordinate: "[number, number] - [x, y] pixel coordinate",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Moves mouse cursor. May trigger hover effects.",
  },

  // ── Text/keyboard tools ─────────────────────────────────────────────

  cu_type: {
    fn: cuTypeFn,
    description: "Type a string of text on the keyboard.",
    args: {
      text: "string - Text to type",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Types text into focused application. Uses clipboard paste.",
    formatResult: (result) => {
      const r = result as { typed?: string };
      return {
        summaryDisplay: RESULT_SUMMARY.type,
        returnDisplay: `Typed: ${r.typed ?? ""}`,
      };
    },
  },

  cu_key: {
    fn: cuKeyFn,
    description:
      "Press a key or key-combination on the keyboard. Supports xdotool key syntax.",
    args: {
      text: 'string - Key spec like "return", "command+c", "ctrl+shift+a"',
      repeat: "number (optional) - Number of times to repeat (default: 1)",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Sends keyboard input. May trigger any keyboard shortcut.",
    formatResult: (result) => {
      const r = result as { pressed?: string };
      return {
        summaryDisplay: RESULT_SUMMARY.key,
        returnDisplay: `Pressed: ${r.pressed ?? ""}`,
      };
    },
  },

  cu_hold_key: {
    fn: cuHoldKeyFn,
    description:
      "Hold down a key or multiple keys for a specified duration (in seconds).",
    args: {
      text: "string - Key to hold",
      duration: "number - Duration in seconds",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Holds key(s) for duration. May trigger long-press behaviors.",
    formatResult: (result) => {
      const r = result as { held?: string };
      return {
        summaryDisplay: RESULT_SUMMARY.hold_key,
        returnDisplay: `Held: ${r.held ?? ""}`,
      };
    },
  },

  cu_write_clipboard: {
    fn: cuWriteClipboardFn,
    description:
      "Write text to the system clipboard.",
    args: {
      text: "string - Text to write to clipboard",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Overwrites system clipboard content.",
  },

  // ── Scroll ──────────────────────────────────────────────────────────

  cu_scroll: {
    fn: cuScrollFn,
    description:
      "Scroll in a specified direction by a specified number of clicks at the specified (x, y) pixel coordinate.",
    args: {
      coordinate: "[number, number] - [x, y] pixel coordinate to scroll at",
      scroll_direction:
        'string - Scroll direction: "up", "down", "left", or "right"',
      scroll_amount: "number - Number of scroll clicks",
      text: 'string (optional) - Modifier keys to hold',
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Scrolls at screen coordinates.",
    formatResult: (result) => {
      const r = result as { scrolled?: { direction?: string; amount?: number } };
      return {
        summaryDisplay: RESULT_SUMMARY.scroll,
        returnDisplay: `Scrolled ${r.scrolled?.direction ?? ""} ${r.scrolled?.amount ?? ""}`,
      };
    },
  },

  // ── Drag ────────────────────────────────────────────────────────────

  cu_left_click_drag: {
    fn: cuLeftClickDragFn,
    description: "Click and drag from start_coordinate to coordinate.",
    args: {
      coordinate: "[number, number] - [x, y] destination pixel coordinate",
      start_coordinate:
        "[number, number] (optional) - [x, y] start pixel coordinate (defaults to current cursor)",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Drags from one position to another. May move or resize UI elements.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.left_click_drag,
      returnDisplay: "Dragged",
    }),
  },

  // ── Region capture ──────────────────────────────────────────────────

  cu_zoom: {
    fn: cuZoomFn,
    description:
      "Capture a zoomed-in screenshot of a specific region defined by [x1, y1, x2, y2] pixel coordinates.",
    args: {
      region:
        "[number, number, number, number] - [x1, y1, x2, y2] pixel rectangle",
    },
    category: "read",
    safetyLevel: "L1",
    safety: "Captures a region of the screen. No side effects.",
    execution: { concurrencySafe: true },
    presentation: { kind: "read" },
    formatResult: (result) => {
      const r = result as { width?: number; height?: number };
      return {
        summaryDisplay: `${RESULT_SUMMARY.zoom} ${r.width ?? "?"}x${r.height ?? "?"}`,
        returnDisplay: `Zoomed region captured: ${r.width ?? "?"}x${r.height ?? "?"}px`,
      };
    },
  },

  // ── App management ──────────────────────────────────────────────────

  cu_open_application: {
    fn: cuOpenApplicationFn,
    description: "Open an application by its bundle ID.",
    args: {
      bundle_id: "string - macOS bundle ID (e.g. com.apple.Safari)",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Opens an application.",
    formatResult: (result) => {
      const r = result as { opened?: string };
      return {
        summaryDisplay: RESULT_SUMMARY.open_application,
        returnDisplay: `Opened: ${r.opened ?? ""}`,
      };
    },
  },

  cu_request_access: {
    fn: cuRequestAccessFn,
    description:
      "Request accessibility access for specified applications.",
    args: {
      apps: 'Array<{displayName?: string}> - Applications to request access for',
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Requests accessibility permissions.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.request_access,
      returnDisplay: "Access request submitted",
    }),
  },

  // ── Wait ────────────────────────────────────────────────────────────

  cu_wait: {
    fn: cuWaitFn,
    description: "Wait for a specified duration (in seconds).",
    args: {
      duration: "number - Duration in seconds (max 100)",
    },
    category: "read",
    safetyLevel: "L1",
    safety: "Waits then captures screenshot. No direct side effects.",
    execution: { concurrencySafe: true },
    presentation: { kind: "read" },
    formatResult: (result) => {
      const r = result as {
        waited_seconds?: number;
        width?: number;
        height?: number;
      };
      return {
        summaryDisplay: `Waited ${r.waited_seconds ?? "?"}s`,
        returnDisplay: `Waited ${r.waited_seconds ?? "?"}s, screenshot ${r.width ?? "?"}x${r.height ?? "?"}px`,
      };
    },
  },
};
