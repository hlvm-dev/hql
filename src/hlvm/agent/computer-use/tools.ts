/**
 * Computer Use — Tool Definitions
 *
 * 10 tools registered as ToolMetadata, wrapping the ComputerExecutor interface.
 * CC uses MCP tools via `buildComputerUseTools()` from `@ant/computer-use-mcp`.
 * HLVM uses built-in ToolMetadata registered in the tool registry.
 *
 * Tool name prefix: `cu_*` (CC uses `mcp__computer-use__*`).
 *
 * CC acquires the session lock in wrapper.tsx around EVERY tool call.
 * HLVM replicates this: every cu_* tool calls lockGuard() before execution.
 */

import type { ToolMetadata, ToolExecutionOptions } from "../registry.ts";
import { failTool, formatToolError, okTool } from "../tool-results.ts";
import type { ComputerExecutor } from "./types.ts";
import { createCliExecutor } from "./executor.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { tryAcquireComputerUseLock } from "./lock.ts";

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

/**
 * Acquire the session lock before any CU operation.
 * CC: wrapper.tsx acquires lock around every tool call.
 * Returns error result if blocked, null if OK.
 */
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

/**
 * Combined platform + lock guard. Returns error result or null.
 */
async function guards(
  options?: ToolExecutionOptions,
): Promise<ReturnType<typeof failTool> | null> {
  const pGuard = platformGuard();
  if (pGuard) return pGuard;
  return lockGuard(options);
}

// ── Tool implementations ─────────────────────────────────────────────────

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

async function cuClickFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { x, y, button, count, modifiers } = args as {
      x: number;
      y: number;
      button?: string;
      count?: number;
      modifiers?: string[];
    };
    const exec = getExecutor();
    await exec.click(
      x,
      y,
      (button ?? "left") as "left" | "right" | "middle",
      (count ?? 1) as 1 | 2 | 3,
      modifiers,
    );
    return okTool({
      clicked: { x, y, button: button ?? "left", count: count ?? 1 },
    });
  } catch (error) {
    return failTool(formatToolError("Click failed", error).message);
  }
}

async function cuTypeFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { text, via_clipboard } = args as {
      text: string;
      via_clipboard?: boolean;
    };
    const exec = getExecutor();
    await exec.type(text, { viaClipboard: via_clipboard ?? true });
    return okTool({
      typed: text.length > 80 ? text.slice(0, 77) + "..." : text,
    });
  } catch (error) {
    return failTool(formatToolError("Type failed", error).message);
  }
}

async function cuKeyFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { key, repeat } = args as { key: string; repeat?: number };
    const exec = getExecutor();
    await exec.key(key, repeat);
    return okTool({ pressed: key, repeat: repeat ?? 1 });
  } catch (error) {
    return failTool(formatToolError("Key press failed", error).message);
  }
}

async function cuScrollFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { x, y, delta_x, delta_y } = args as {
      x: number;
      y: number;
      delta_x?: number;
      delta_y?: number;
    };
    const exec = getExecutor();
    await exec.scroll(x, y, delta_x ?? 0, delta_y ?? 0);
    return okTool({
      scrolled: { x, y, delta_x: delta_x ?? 0, delta_y: delta_y ?? 0 },
    });
  } catch (error) {
    return failTool(formatToolError("Scroll failed", error).message);
  }
}

async function cuMoveMouseFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { x, y } = args as { x: number; y: number };
    const exec = getExecutor();
    await exec.moveMouse(x, y);
    return okTool({ moved: { x, y } });
  } catch (error) {
    return failTool(formatToolError("Mouse move failed", error).message);
  }
}

async function cuDragFn(
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const { from_x, from_y, to_x, to_y } = args as {
      from_x?: number;
      from_y?: number;
      to_x: number;
      to_y: number;
    };
    const exec = getExecutor();
    const from =
      from_x !== undefined && from_y !== undefined
        ? { x: from_x, y: from_y }
        : undefined;
    await exec.drag(from, { x: to_x, y: to_y });
    return okTool({
      dragged: { from: from ?? "current cursor", to: { x: to_x, y: to_y } },
    });
  } catch (error) {
    return failTool(formatToolError("Drag failed", error).message);
  }
}

async function cuGetFrontmostAppFn(
  _args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> {
  const err = await guards(options);
  if (err) return err;
  try {
    const exec = getExecutor();
    const app = await exec.getFrontmostApp();
    return okTool({ app });
  } catch (error) {
    return failTool(
      formatToolError("Get frontmost app failed", error).message,
    );
  }
}

async function cuClipboardReadFn(
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

async function cuClipboardWriteFn(
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

// ── Tool Metadata ────────────────────────────────────────────────────────

export const COMPUTER_USE_TOOLS: Record<string, ToolMetadata> = {
  cu_screenshot: {
    fn: cuScreenshotFn,
    description:
      "Capture a screenshot of the current screen. Returns the image as a base64-encoded JPEG with dimensions. Use this to see what's on screen before clicking or typing.",
    args: {},
    category: "read",
    safetyLevel: "L1",
    safety: "Captures visible screen content. No side effects.",
    execution: { concurrencySafe: true },
    presentation: { kind: "read" },
    formatResult: (result) => {
      const r = result as { width?: number; height?: number };
      return {
        summaryDisplay: `Screenshot ${r.width ?? "?"}x${r.height ?? "?"}`,
        returnDisplay: `Screenshot captured: ${r.width ?? "?"}x${r.height ?? "?"}px`,
      };
    },
  },

  cu_click: {
    fn: cuClickFn,
    description:
      "Click at screen coordinates. Moves mouse to position, settles 50ms, then clicks. Supports modifiers (e.g. shift-click). Use double-click (count=2) to open files/apps, triple-click (count=3) to select lines.",
    args: {
      x: "number - X coordinate in pixels",
      y: "number - Y coordinate in pixels",
      button:
        'string (optional) - Mouse button: "left" (default), "right", or "middle"',
      count:
        "number (optional) - Click count: 1 (default), 2 (double), 3 (triple)",
      modifiers:
        'string[] (optional) - Modifier keys to hold: ["shift"], ["command", "shift"], etc.',
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Clicks at screen coordinates. May interact with any visible UI.",
  },

  cu_type: {
    fn: cuTypeFn,
    description:
      "Type text at the current cursor position. By default uses clipboard paste (saves/restores user clipboard). Set via_clipboard=false for direct keystroke typing. Use cu_click first to focus the target input field.",
    args: {
      text: "string - Text to type",
      via_clipboard:
        "boolean (optional) - Use clipboard paste (default: true) or direct keystrokes (false)",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Types text into focused application. May temporarily use clipboard.",
  },

  cu_key: {
    fn: cuKeyFn,
    description:
      'Press a key combination. Supports modifiers: command, ctrl, alt, shift. Supports repeat. Examples: "return", "command+c", "ctrl+shift+a", "escape", "tab", "f5".',
    args: {
      key: 'string - Key spec like "return", "command+c", "ctrl+shift+a"',
      repeat: "number (optional) - Number of times to repeat (default: 1)",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Sends keyboard input. May trigger any keyboard shortcut.",
  },

  cu_scroll: {
    fn: cuScrollFn,
    description:
      "Scroll at the given screen coordinates. Positive delta_y scrolls down, negative scrolls up. Positive delta_x scrolls right, negative scrolls left. Moves mouse to position first.",
    args: {
      x: "number - X coordinate in pixels",
      y: "number - Y coordinate in pixels",
      delta_x: "number (optional) - Horizontal scroll amount in pixels",
      delta_y: "number (optional) - Vertical scroll amount in pixels",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Scrolls at screen coordinates.",
  },

  cu_move_mouse: {
    fn: cuMoveMouseFn,
    description:
      "Move the mouse cursor to screen coordinates without clicking. Waits 50ms after move for HID round-trip. Useful for hovering to reveal tooltips or menus.",
    args: {
      x: "number - X coordinate in pixels",
      y: "number - Y coordinate in pixels",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Moves mouse cursor. May trigger hover effects.",
  },

  cu_drag: {
    fn: cuDragFn,
    description:
      "Drag from one screen position to another with smooth ease-out-cubic animation. If from_x/from_y omitted, drags from current cursor position. Button always released in finally block (no stuck buttons).",
    args: {
      from_x: "number (optional) - Start X coordinate (omit for current cursor)",
      from_y: "number (optional) - Start Y coordinate (omit for current cursor)",
      to_x: "number - End X coordinate",
      to_y: "number - End Y coordinate",
    },
    category: "write",
    safetyLevel: "L2",
    safety:
      "Drags from one position to another. May move or resize UI elements.",
  },

  cu_get_frontmost_app: {
    fn: cuGetFrontmostAppFn,
    description:
      "Get the bundle ID and display name of the currently focused (frontmost) application.",
    args: {},
    category: "read",
    safetyLevel: "L0",
    safety: "Read-only query of system state.",
    execution: { concurrencySafe: true },
    presentation: { kind: "read" },
  },

  cu_clipboard_read: {
    fn: cuClipboardReadFn,
    description: "Read the current system clipboard text content.",
    args: {},
    category: "read",
    safetyLevel: "L0",
    safety: "Read-only clipboard access.",
    execution: { concurrencySafe: true },
    presentation: { kind: "read" },
  },

  cu_clipboard_write: {
    fn: cuClipboardWriteFn,
    description:
      "Write text to the system clipboard with read-back verification.",
    args: {
      text: "string - Text to write to clipboard",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Overwrites system clipboard content.",
  },
};
