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

import type { ToolExecutionOptions, ToolMetadata } from "../registry.ts";
import {
  failTool,
  failToolDetailed,
  formatToolError,
  okTool,
} from "../tool-results.ts";
import type { ComputerExecutor } from "./types.ts";
import { createCliExecutor } from "./executor.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { tryAcquireComputerUseLock } from "./lock.ts";

// ── CC Result Summary Map (from toolRendering.tsx) ──────────────────────

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
    getMouseAnimationEnabled: () => true,
    getHideBeforeActionEnabled: () => true,
  });
  return _executor;
}

// ── Guards ────────────────────────────────────────────────────────────────

function platformGuard(): ReturnType<typeof failTool> | null {
  if (getPlatform().build.os !== "darwin") {
    return failToolDetailed(
      "Computer use is only supported on macOS",
      {
        source: "runtime",
        kind: "unsupported",
        retryable: false,
        code: "cu_unsupported_platform",
      },
    );
  }
  return null;
}

async function guards(
  options?: ToolExecutionOptions,
): Promise<ReturnType<typeof failTool> | null> {
  const pGuard = platformGuard();
  if (pGuard) return pGuard;
  const sessionId = options?.sessionId ?? "default";
  const result = await tryAcquireComputerUseLock(sessionId);
  if (result.kind === "blocked") {
    return failToolDetailed(
      `Computer use is in use by another session (${
        result.by.slice(0, 8)
      }…). Wait for that session to finish.`,
      {
        source: "runtime",
        kind: "busy",
        code: "cu_session_locked",
        facts: { ownerSessionId: result.by },
      },
    );
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseCoordinate(
  coord: unknown,
  name = "coordinate",
): { x: number; y: number } {
  // Models sometimes send "[640, 360]" as a string instead of [640, 360] array
  let parsed = coord;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch { /* fall through to validation */ }
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    throw new Error(`${name} must be a [x, y] tuple`);
  }
  const [x, y] = [Number(parsed[0]), Number(parsed[1])];
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${name} values must be numbers`);
  }
  return { x, y };
}

function parseModifiers(text?: string): string[] | undefined {
  if (!text) return undefined;
  return text.split("+").map((s) => s.trim()).filter((s) => s.length > 0);
}

const VALID_SCROLL_DIRECTIONS = new Set(["up", "down", "left", "right"]);

function scrollDirectionToDeltas(
  direction: string,
  amount: number,
): { dx: number; dy: number } {
  const dir = typeof direction === "string"
    ? direction.toLowerCase().trim()
    : "";
  if (!VALID_SCROLL_DIRECTIONS.has(dir)) {
    throw new Error(
      `Invalid scroll direction: "${direction}". Must be "up", "down", "left", or "right".`,
    );
  }
  switch (dir) {
    case "up":
      return { dx: 0, dy: -amount };
    case "down":
      return { dx: 0, dy: amount };
    case "left":
      return { dx: -amount, dy: 0 };
    case "right":
      return { dx: amount, dy: 0 };
    default:
      throw new Error(`Invalid scroll direction: ${dir}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build result with image attachment (used by screenshot, zoom, wait). */
function imageResult(
  data: Record<string, unknown>,
  img: { base64: string; width: number; height: number },
): unknown {
  return {
    ...okTool(data),
    _imageAttachment: {
      data: img.base64,
      mimeType: "image/jpeg",
      width: img.width,
      height: img.height,
    },
  };
}

// ── Tool wrapper (eliminates guards + try/catch boilerplate) ─────────────

/**
 * Wrap a tool implementation with guards + error handling.
 * Every CU tool follows: guards() → prepareForAction() → fn(exec) → result.
 *
 * Write/interactive tools call prepareForAction() to activate the target
 * app and hide distractors before the action. Read-only tools skip this.
 */
function cuTool(
  errorPrefix: string,
  fn: (
    args: unknown,
    exec: ComputerExecutor,
  ) => Promise<unknown>,
  opts?: { readOnly?: boolean },
): (
  args: unknown,
  cwd: string,
  options?: ToolExecutionOptions,
) => Promise<unknown> {
  return async (args, _cwd, options) => {
    const err = await guards(options);
    if (err) return err;
    const exec = getExecutor();
    try {
      // Activate target app + hide distractors before write/interactive actions.
      // Read-only tools (screenshot, cursor_position) skip this.
      if (!opts?.readOnly) {
        await exec.prepareForAction([], options?.displayId);
      }
      return await fn(args, exec);
    } catch (error) {
      const toolError = formatToolError(errorPrefix, error);
      return failTool(toolError.message, { failure: toolError.failure });
    }
  };
}

// ── Click factory (DRY: 5 click tools share identical logic) ─────────────

function makeClickFn(
  button: "left" | "right" | "middle",
  count: 1 | 2 | 3,
  errorPrefix: string,
) {
  return cuTool(errorPrefix, async (args, exec) => {
    const { coordinate, text } = args as {
      coordinate: [number, number];
      text?: string;
    };
    const { x, y } = parseCoordinate(coordinate);
    await exec.click(x, y, button, count, parseModifiers(text));
    return okTool({ clicked: { x, y } });
  });
}

function makeClickMeta(
  fn: ReturnType<typeof makeClickFn>,
  description: string,
  summaryKey: string,
  resultLabel: string,
): ToolMetadata {
  return {
    fn,
    description,
    args: {
      coordinate: "[number, number] - [x, y] pixel coordinate",
      text: "string (optional) - Modifier keys to hold",
    },
    category: "write",
    safetyLevel: "L2",
    safety: `${resultLabel} at screen coordinates.`,
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY[summaryKey],
      returnDisplay: resultLabel,
    }),
  };
}

// ── Tool implementations ─────────────────────────────────────────────────

const cuScreenshotFn = cuTool("Screenshot failed", async (_args, exec) => {
  const result = await exec.screenshot({ allowedBundleIds: [] });
  return imageResult({ width: result.width, height: result.height }, result);
}, { readOnly: true });

const cuCursorPositionFn = cuTool(
  "Get cursor position failed",
  async (_args, exec) => {
    const pos = await exec.getCursorPosition();
    return okTool({ x: pos.x, y: pos.y });
  },
  { readOnly: true },
);

const cuLeftMouseDownFn = cuTool("Mouse down failed", async (_args, exec) => {
  await exec.mouseDown();
  return okTool({ pressed: "left" });
});

const cuLeftMouseUpFn = cuTool("Mouse up failed", async (_args, exec) => {
  await exec.mouseUp();
  return okTool({ released: "left" });
});

const cuListGrantedApplicationsFn = cuTool(
  "List granted applications failed",
  async (_args, exec) => {
    const apps = await exec.listRunningApps();
    return okTool({
      apps: apps.map((a) => ({
        bundleId: a.bundleId,
        displayName: a.displayName,
      })),
    });
  },
  { readOnly: true },
);

const cuReadClipboardFn = cuTool(
  "Clipboard read failed",
  async (_args, exec) => {
    const text = await exec.readClipboard();
    return okTool({ text });
  },
  { readOnly: true },
);

const cuLeftClickFn = makeClickFn("left", 1, "Left click failed");
const cuRightClickFn = makeClickFn("right", 1, "Right click failed");
const cuMiddleClickFn = makeClickFn("middle", 1, "Middle click failed");
const cuDoubleClickFn = makeClickFn("left", 2, "Double click failed");
const cuTripleClickFn = makeClickFn("left", 3, "Triple click failed");

const cuMouseMoveFn = cuTool("Mouse move failed", async (args, exec) => {
  const { coordinate } = args as { coordinate: [number, number] };
  const { x, y } = parseCoordinate(coordinate);
  await exec.moveMouse(x, y);
  return okTool({ moved: { x, y } });
});

const cuTypeFn = cuTool("Type failed", async (args, exec) => {
  const { text } = args as { text: string };
  await exec.type(text, { viaClipboard: true });
  return okTool({ typed: text.length > 80 ? text.slice(0, 77) + "..." : text });
});

const cuKeyFn = cuTool("Key press failed", async (args, exec) => {
  const { text, repeat } = args as { text: string; repeat?: number };
  const rpt = repeat != null ? (Number(repeat) || 1) : undefined;
  await exec.key(text, rpt);
  return okTool({ pressed: text, repeat: rpt ?? 1 });
});

const cuHoldKeyFn = cuTool("Hold key failed", async (args, exec) => {
  const { text, duration } = args as { text: string; duration: number };
  const raw = Number(duration);
  const dur = Number.isFinite(raw) ? Math.max(raw, 0) : 1;
  await exec.holdKey([text], dur * 1000);
  return okTool({ held: text, duration_seconds: dur });
});

const cuWriteClipboardFn = cuTool(
  "Clipboard write failed",
  async (args, exec) => {
    const { text } = args as { text: string };
    await exec.writeClipboard(text);
    return okTool({ written: true });
  },
);

const cuScrollFn = cuTool("Scroll failed", async (args, exec) => {
  const { coordinate, scroll_direction, scroll_amount } = args as {
    coordinate: [number, number];
    scroll_direction: string;
    scroll_amount: number;
  };
  const { x, y } = parseCoordinate(coordinate);
  const amount = Number(scroll_amount) || 3;
  const { dx, dy } = scrollDirectionToDeltas(scroll_direction, amount);
  await exec.scroll(x, y, dx, dy);
  return okTool({ scrolled: { x, y, direction: scroll_direction, amount } });
});

const cuLeftClickDragFn = cuTool("Drag failed", async (args, exec) => {
  const { coordinate, start_coordinate } = args as {
    coordinate: [number, number];
    start_coordinate?: [number, number];
  };
  const to = parseCoordinate(coordinate);
  const from = start_coordinate
    ? parseCoordinate(start_coordinate, "start_coordinate")
    : undefined;
  await exec.drag(from, to);
  return okTool({ dragged: { from: from ?? "current cursor", to } });
});

const cuZoomFn = cuTool("Zoom failed", async (args, exec) => {
  let { region } = args as { region: unknown };
  if (typeof region === "string") {
    try {
      region = JSON.parse(region);
    } catch { /* fall through */ }
  }
  if (!Array.isArray(region) || region.length !== 4) {
    throw new Error("region must be a [x1, y1, x2, y2] tuple");
  }
  const [x1, y1, x2, y2] = region.map(Number);
  if (x2 <= x1 || y2 <= y1) {
    throw new Error(
      `Invalid region: x2 must be > x1 and y2 must be > y1 (got [${x1},${y1},${x2},${y2}])`,
    );
  }
  const result = await exec.zoom({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, []);
  return imageResult({ width: result.width, height: result.height }, result);
});

const cuOpenApplicationFn = cuTool(
  "Open application failed",
  async (args, exec) => {
    const { bundle_id } = args as { bundle_id: string };
    // Sanitize: bundle IDs are reverse-DNS (letters, digits, dots, hyphens)
    if (!bundle_id || bundle_id.length < 3 || !/^[\w.-]+$/.test(bundle_id)) {
      throw new Error(
        `Invalid bundle ID: "${bundle_id}". Must be reverse-DNS format (e.g. "com.apple.Safari").`,
      );
    }
    await exec.openApp(bundle_id);
    return okTool({ opened: bundle_id });
  },
);

const cuRequestAccessFn = cuTool(
  "Request access failed",
  async (args, _exec) => {
    const { apps } = args as { apps?: unknown };
    const appList = Array.isArray(apps) ? apps : [];
    const names =
      appList.map((a: any) => a?.displayName ?? "unknown").join(", ") ||
      "requested apps";
    return okTool({
      message:
        `Access request noted for: ${names}. Use System Preferences > Privacy & Security to grant accessibility access.`,
    });
  },
);

const cuWaitFn = cuTool("Wait failed", async (args, exec) => {
  const { duration } = args as { duration: number };
  const raw = Number(duration);
  const cappedDuration = Math.min(
    Number.isFinite(raw) ? Math.max(raw, 0) : 2,
    15,
  );
  await sleep(cappedDuration * 1000);
  const result = await exec.screenshot({ allowedBundleIds: [] });
  return imageResult(
    {
      waited_seconds: cappedDuration,
      width: result.width,
      height: result.height,
    },
    result,
  );
});

// ── Read-only metadata constants ─────────────────────────────────────────

const READ_SAFE: Pick<ToolMetadata, "execution" | "presentation"> = {
  execution: { concurrencySafe: true },
  presentation: { kind: "read" },
};

// ── Tool Metadata (22 entries) ───────────────────────────────────────────

export const COMPUTER_USE_TOOLS: Record<string, ToolMetadata> = {
  cu_screenshot: {
    fn: cuScreenshotFn,
    description: "Take a screenshot of the screen.",
    args: {},
    category: "read",
    safetyLevel: "L1",
    safety: "Captures visible screen content. No side effects.",
    ...READ_SAFE,
    formatResult: (result) => {
      const r = result as { width?: number; height?: number };
      return {
        summaryDisplay: `${RESULT_SUMMARY.screenshot} ${r.width ?? "?"}x${
          r.height ?? "?"
        }`,
        returnDisplay: `Screenshot captured: ${r.width ?? "?"}x${
          r.height ?? "?"
        }px`,
      };
    },
  },

  cu_cursor_position: {
    fn: cuCursorPositionFn,
    description: "Get the current (x, y) pixel coordinate of the cursor.",
    args: {},
    category: "read",
    safetyLevel: "L0",
    safety: "Read-only query of cursor position.",
    ...READ_SAFE,
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
    ...READ_SAFE,
  },

  cu_read_clipboard: {
    fn: cuReadClipboardFn,
    description: "Read the current system clipboard text content.",
    args: {},
    category: "read",
    safetyLevel: "L0",
    safety: "Read-only clipboard access.",
    ...READ_SAFE,
  },

  cu_left_click: makeClickMeta(
    cuLeftClickFn,
    "Click the left mouse button at the specified (x, y) pixel coordinate. Hold modifier keys via the text parameter.",
    "left_click",
    "Left clicked",
  ),

  cu_right_click: makeClickMeta(
    cuRightClickFn,
    "Click the right mouse button at the specified (x, y) pixel coordinate.",
    "right_click",
    "Right clicked",
  ),

  cu_middle_click: makeClickMeta(
    cuMiddleClickFn,
    "Click the middle mouse button at the specified (x, y) pixel coordinate.",
    "middle_click",
    "Middle clicked",
  ),

  cu_double_click: makeClickMeta(
    cuDoubleClickFn,
    "Double-click the left mouse button at the specified (x, y) pixel coordinate.",
    "double_click",
    "Double clicked",
  ),

  cu_triple_click: makeClickMeta(
    cuTripleClickFn,
    "Triple-click the left mouse button at the specified (x, y) pixel coordinate.",
    "triple_click",
    "Triple clicked",
  ),

  cu_mouse_move: {
    fn: cuMouseMoveFn,
    description: "Move the cursor to a specified (x, y) pixel coordinate.",
    args: { coordinate: "[number, number] - [x, y] pixel coordinate" },
    category: "write",
    safetyLevel: "L2",
    safety: "Moves mouse cursor. May trigger hover effects.",
  },

  cu_type: {
    fn: cuTypeFn,
    description: "Type a string of text on the keyboard.",
    args: { text: "string - Text to type" },
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
    description: "Write text to the system clipboard.",
    args: { text: "string - Text to write to clipboard" },
    category: "write",
    safetyLevel: "L2",
    safety: "Overwrites system clipboard content.",
  },

  cu_scroll: {
    fn: cuScrollFn,
    description:
      "Scroll in a specified direction by a specified number of clicks at the specified (x, y) pixel coordinate.",
    args: {
      coordinate: "[number, number] - [x, y] pixel coordinate to scroll at",
      scroll_direction:
        'string - Scroll direction: "up", "down", "left", or "right"',
      scroll_amount: "number - Number of scroll clicks",
      text: "string (optional) - Modifier keys to hold",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Scrolls at screen coordinates.",
    formatResult: (result) => {
      const r = result as {
        scrolled?: { direction?: string; amount?: number };
      };
      return {
        summaryDisplay: RESULT_SUMMARY.scroll,
        returnDisplay: `Scrolled ${r.scrolled?.direction ?? ""} ${
          r.scrolled?.amount ?? ""
        }`,
      };
    },
  },

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
    safety:
      "Drags from one position to another. May move or resize UI elements.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.left_click_drag,
      returnDisplay: "Dragged",
    }),
  },

  cu_zoom: {
    fn: cuZoomFn,
    description:
      "Capture a zoomed-in screenshot of a specific region defined by [x1, y1, x2, y2] pixel coordinates.",
    args: {
      region:
        "number[] - Array of 4 numbers [x1, y1, x2, y2] defining the pixel rectangle to zoom into",
    },
    category: "read",
    safetyLevel: "L1",
    safety: "Captures a region of the screen. No side effects.",
    ...READ_SAFE,
    formatResult: (result) => {
      const r = result as { width?: number; height?: number };
      return {
        summaryDisplay: `${RESULT_SUMMARY.zoom} ${r.width ?? "?"}x${
          r.height ?? "?"
        }`,
        returnDisplay: `Zoomed region captured: ${r.width ?? "?"}x${
          r.height ?? "?"
        }px`,
      };
    },
  },

  cu_open_application: {
    fn: cuOpenApplicationFn,
    description: "Open an application by its bundle ID.",
    args: { bundle_id: "string - macOS bundle ID (e.g. com.apple.Safari)" },
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
    description: "Request accessibility access for specified applications.",
    args: {
      apps:
        "Array<{displayName?: string}> - Applications to request access for",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Requests accessibility permissions.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.request_access,
      returnDisplay: "Access request submitted",
    }),
  },

  cu_wait: {
    fn: cuWaitFn,
    description: "Wait for a specified duration (in seconds).",
    args: { duration: "number - Duration in seconds (max 15)" },
    category: "read",
    safetyLevel: "L1",
    safety: "Waits then captures screenshot. No direct side effects.",
    ...READ_SAFE,
    formatResult: (result) => {
      const r = result as {
        waited_seconds?: number;
        width?: number;
        height?: number;
      };
      return {
        summaryDisplay: `Waited ${r.waited_seconds ?? "?"}s`,
        returnDisplay: `Waited ${r.waited_seconds ?? "?"}s, screenshot ${
          r.width ?? "?"
        }x${r.height ?? "?"}px`,
      };
    },
  },
};
