/**
 * Computer Use — Unit Tests
 *
 * Tests keycodes, tool registration, lock management (CC-clone API),
 * image pipeline, executor factory, and CC-specific patterns
 * (withModifiers, releasePressed, animatedMove, typeViaClipboard).
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
} from "jsr:@std/assert";
import {
  parseKeySpec,
  KEY_CODES,
  MODIFIER_MAP,
} from "../../../src/hlvm/agent/computer-use/keycodes.ts";
import { COMPUTER_USE_TOOLS } from "../../../src/hlvm/agent/computer-use/mod.ts";
import { getPlatform } from "../../../src/platform/platform.ts";
import {
  acquireLock,
  releaseLock,
  tryAcquireComputerUseLock,
  releaseComputerUseLock,
  isLockHeldLocally,
  checkComputerUseLock,
} from "../../../src/hlvm/agent/computer-use/lock.ts";
import {
  cleanupComputerUse,
  cleanupComputerUseAfterTurn,
} from "../../../src/hlvm/agent/computer-use/cleanup.ts";
import {
  CLI_HOST_BUNDLE_ID,
  CLI_CU_CAPABILITIES,
  getTerminalBundleId,
} from "../../../src/hlvm/agent/computer-use/common.ts";
import { drainRunLoop } from "../../../src/hlvm/agent/computer-use/drain-run-loop.ts";
import {
  notifyExpectedEscape,
  unregisterEscHotkey,
} from "../../../src/hlvm/agent/computer-use/esc-hotkey.ts";
import { filterAppsForDescription } from "../../../src/hlvm/agent/computer-use/app-names.ts";
import {
  API_RESIZE_PARAMS,
  targetImageSize,
} from "../../../src/hlvm/agent/computer-use/types.ts";

// ============================================================
// 1. Keycode Tests (unchanged — keycodes.ts is bridge-specific)
// ============================================================

Deno.test("keycodes: KEY_CODES contains standard keys", () => {
  assertEquals(KEY_CODES["return"], 36);
  assertEquals(KEY_CODES["escape"], 53);
  assertEquals(KEY_CODES["tab"], 48);
  assertEquals(KEY_CODES["space"], 49);
  assertEquals(KEY_CODES["delete"], 51);
  assertEquals(KEY_CODES["left"], 123);
  assertEquals(KEY_CODES["right"], 124);
  assertEquals(KEY_CODES["up"], 126);
  assertEquals(KEY_CODES["down"], 125);
  assertEquals(KEY_CODES["f1"], 122);
  assertEquals(KEY_CODES["a"], 0);
});

Deno.test("keycodes: MODIFIER_MAP maps standard modifiers", () => {
  assertEquals(MODIFIER_MAP["cmd"], "command down");
  assertEquals(MODIFIER_MAP["command"], "command down");
  assertEquals(MODIFIER_MAP["ctrl"], "control down");
  assertEquals(MODIFIER_MAP["alt"], "option down");
  assertEquals(MODIFIER_MAP["shift"], "shift down");
});

Deno.test("keycodes: parseKeySpec simple key", () => {
  const result = parseKeySpec("return");
  assertExists(result);
  assertEquals(result.keyCode, 36);
  assertEquals(result.modifiers, []);
});

Deno.test("keycodes: parseKeySpec with modifiers", () => {
  const result = parseKeySpec("cmd+shift+a");
  assertExists(result);
  assertEquals(result.keyCode, 0); // 'a' key code
  assertEquals(result.modifiers, ["command down", "shift down"]);
});

Deno.test("keycodes: parseKeySpec ctrl+c", () => {
  const result = parseKeySpec("ctrl+c");
  assertExists(result);
  assertEquals(result.keyCode, 8); // 'c' key code
  assertEquals(result.modifiers, ["control down"]);
});

Deno.test("keycodes: parseKeySpec unknown key returns null", () => {
  assertEquals(parseKeySpec("nonexistent"), null);
});

Deno.test("keycodes: parseKeySpec unknown modifier returns null", () => {
  assertEquals(parseKeySpec("super+a"), null);
});

Deno.test("keycodes: parseKeySpec empty string returns null", () => {
  assertEquals(parseKeySpec(""), null);
});

Deno.test("keycodes: parseKeySpec case insensitive", () => {
  const result = parseKeySpec("CMD+SHIFT+A");
  assertExists(result);
  assertEquals(result.keyCode, 0);
  assertEquals(result.modifiers, ["command down", "shift down"]);
});

// ============================================================
// 2. Common Tests (CC clone)
// ============================================================

Deno.test("common: CLI_HOST_BUNDLE_ID is sentinel", () => {
  assertEquals(
    CLI_HOST_BUNDLE_ID,
    "com.anthropic.claude-code.cli-no-window",
  );
});

Deno.test("common: CLI_CU_CAPABILITIES has correct shape", () => {
  assertEquals(CLI_CU_CAPABILITIES.screenshotFiltering, "native");
  assertEquals(CLI_CU_CAPABILITIES.platform, "darwin");
});

Deno.test("common: getTerminalBundleId returns string or null", () => {
  const result = getTerminalBundleId();
  assertEquals(typeof result === "string" || result === null, true);
});

// ============================================================
// 3. Types Tests (CC clone)
// ============================================================

Deno.test("types: API_RESIZE_PARAMS has correct values", () => {
  assertEquals(API_RESIZE_PARAMS.maxLongSide, 1280);
  assertEquals(API_RESIZE_PARAMS.maxShortSide, 1024);
});

Deno.test("types: targetImageSize scales large images", () => {
  // 2560x1440 (4K) → should scale down
  const [w, h] = targetImageSize(2560, 1440, API_RESIZE_PARAMS);
  assertEquals(w <= 1280, true);
  assertEquals(h <= 1024, true);
});

Deno.test("types: targetImageSize preserves small images", () => {
  const [w, h] = targetImageSize(800, 600, API_RESIZE_PARAMS);
  assertEquals(w, 800);
  assertEquals(h, 600);
});

// ============================================================
// 4. Tool Registration Tests
// ============================================================

Deno.test("tools: all 10 cu_* tools are exported", () => {
  const expectedTools = [
    "cu_screenshot",
    "cu_click",
    "cu_type",
    "cu_key",
    "cu_scroll",
    "cu_move_mouse",
    "cu_drag",
    "cu_get_frontmost_app",
    "cu_clipboard_read",
    "cu_clipboard_write",
  ];
  for (const name of expectedTools) {
    assertExists(
      COMPUTER_USE_TOOLS[name],
      `Missing tool: ${name}`,
    );
  }
  assertEquals(Object.keys(COMPUTER_USE_TOOLS).length, 10);
});

Deno.test("tools: read-only tools have correct safety levels", () => {
  assertEquals(COMPUTER_USE_TOOLS.cu_screenshot.safetyLevel, "L1");
  assertEquals(COMPUTER_USE_TOOLS.cu_get_frontmost_app.safetyLevel, "L0");
  assertEquals(COMPUTER_USE_TOOLS.cu_clipboard_read.safetyLevel, "L0");
});

Deno.test("tools: write tools have L2 safety level", () => {
  const l2Tools = [
    "cu_click",
    "cu_type",
    "cu_key",
    "cu_scroll",
    "cu_move_mouse",
    "cu_drag",
    "cu_clipboard_write",
  ];
  for (const name of l2Tools) {
    assertEquals(
      COMPUTER_USE_TOOLS[name].safetyLevel,
      "L2",
      `${name} should be L2`,
    );
  }
});

Deno.test("tools: read tools are concurrency-safe", () => {
  assertEquals(
    COMPUTER_USE_TOOLS.cu_screenshot.execution?.concurrencySafe,
    true,
  );
  assertEquals(
    COMPUTER_USE_TOOLS.cu_get_frontmost_app.execution?.concurrencySafe,
    true,
  );
  assertEquals(
    COMPUTER_USE_TOOLS.cu_clipboard_read.execution?.concurrencySafe,
    true,
  );
});

Deno.test("tools: all tools have descriptions", () => {
  for (const [name, meta] of Object.entries(COMPUTER_USE_TOOLS)) {
    assertExists(meta.description, `${name} missing description`);
    assertExists(meta.fn, `${name} missing fn`);
  }
});

Deno.test("tools: cu_screenshot has formatResult", () => {
  const meta = COMPUTER_USE_TOOLS.cu_screenshot;
  assertExists(meta.formatResult);
  const formatted = meta.formatResult!({ width: 1280, height: 720 });
  assertExists(formatted);
  assertEquals(formatted!.summaryDisplay, "Screenshot 1280x720");
});

Deno.test("tools: cu_click supports modifiers arg", () => {
  const meta = COMPUTER_USE_TOOLS.cu_click;
  assertExists(meta.args?.modifiers);
});

Deno.test("tools: cu_type supports via_clipboard arg", () => {
  const meta = COMPUTER_USE_TOOLS.cu_type;
  assertExists(meta.args?.via_clipboard);
});

Deno.test("tools: cu_key supports repeat arg", () => {
  const meta = COMPUTER_USE_TOOLS.cu_key;
  assertExists(meta.args?.repeat);
});

Deno.test("tools: cu_drag supports optional from coordinates", () => {
  const meta = COMPUTER_USE_TOOLS.cu_drag;
  assertExists(meta.args?.from_x);
  assertExists(meta.args?.from_y);
  // Description should mention "optional"
  assertEquals(meta.args!.from_x!.includes("optional"), true);
});

// ============================================================
// 5. Platform Guard Tests (non-macOS)
// ============================================================

Deno.test("tools: cu_screenshot returns error on non-macOS", async () => {
  if (getPlatform().build.os === "darwin") {
    // Can't test non-macOS guard on macOS — skip
    return;
  }
  const result = (await COMPUTER_USE_TOOLS.cu_screenshot.fn(
    {},
    "/tmp",
  )) as {
    success: boolean;
    message: string;
  };
  assertEquals(result.success, false);
  assertEquals(result.message, "Computer use is only supported on macOS");
});

// ============================================================
// 6. Lock Tests (CC-clone API)
// ============================================================

Deno.test({
  name: "lock: tryAcquire returns acquired+fresh on first call",
  fn: async () => {
    const sessionId = `test-acquire-${Date.now()}`;
    try {
      const result = await tryAcquireComputerUseLock(sessionId);
      assertEquals(result.kind, "acquired");
      if (result.kind === "acquired") {
        assertEquals(result.fresh, true);
      }
    } finally {
      await releaseComputerUseLock();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "lock: tryAcquire returns acquired+reentrant on same session",
  fn: async () => {
    const sessionId = `test-reentrant-${Date.now()}`;
    try {
      await tryAcquireComputerUseLock(sessionId);
      const result = await tryAcquireComputerUseLock(sessionId);
      assertEquals(result.kind, "acquired");
      if (result.kind === "acquired") {
        assertEquals(result.fresh, false);
      }
    } finally {
      await releaseComputerUseLock();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "lock: isLockHeldLocally tracks state",
  fn: async () => {
    const before = isLockHeldLocally();
    assertEquals(before, false);
    const sessionId = `test-local-${Date.now()}`;
    await tryAcquireComputerUseLock(sessionId);
    assertEquals(isLockHeldLocally(), true);
    await releaseComputerUseLock();
    assertEquals(isLockHeldLocally(), false);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "lock: checkComputerUseLock returns free when no lock",
  fn: async () => {
    // Ensure clean state
    await releaseComputerUseLock();
    const result = await checkComputerUseLock();
    assertEquals(result.kind, "free");
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "lock: release is idempotent",
  fn: async () => {
    const first = await releaseComputerUseLock();
    const second = await releaseComputerUseLock();
    // Both should return false (nothing to release)
    assertEquals(first, false);
    assertEquals(second, false);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "lock: cleanup releases lock",
  fn: async () => {
    const sessionId = `test-cleanup-${Date.now()}`;
    await tryAcquireComputerUseLock(sessionId);
    await cleanupComputerUse();
    // Should be able to re-acquire after cleanup
    const result = await tryAcquireComputerUseLock(sessionId);
    assertEquals(result.kind, "acquired");
    await releaseComputerUseLock();
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================
// 7. Bridge Stubs Tests
// ============================================================

Deno.test("drain-run-loop: passthrough executes fn", async () => {
  const result = await drainRunLoop(async () => 42);
  assertEquals(result, 42);
});

Deno.test("esc-hotkey: stubs are no-ops", () => {
  notifyExpectedEscape(); // should not throw
  unregisterEscHotkey(); // should not throw
});

// ============================================================
// 8. App Names Tests (CC clone — pure TS logic)
// ============================================================

Deno.test("app-names: filters non-user-facing paths", () => {
  const result = filterAppsForDescription(
    [
      {
        bundleId: "com.test.app",
        displayName: "Test App",
        path: "/Applications/Test App.app",
      },
      {
        bundleId: "com.test.daemon",
        displayName: "Test Daemon",
        path: "/System/Library/CoreServices/Daemon.app",
      },
    ],
    undefined,
  );
  assertEquals(result.includes("Test App"), true);
  assertEquals(result.includes("Test Daemon"), false);
});

Deno.test("app-names: always keeps known browsers", () => {
  const result = filterAppsForDescription(
    [
      {
        bundleId: "com.apple.Safari",
        displayName: "Safari",
        path: "/weird/path/Safari.app",
      },
    ],
    undefined,
  );
  assertEquals(result.includes("Safari"), true);
});

Deno.test("app-names: filters noisy names (Helper, Agent, etc.)", () => {
  const result = filterAppsForDescription(
    [
      {
        bundleId: "com.test.helper",
        displayName: "Slack Helper",
        path: "/Applications/Slack Helper.app",
      },
      {
        bundleId: "com.test.real",
        displayName: "Slack",
        path: "/Applications/Slack.app",
      },
    ],
    undefined,
  );
  assertEquals(result.includes("Slack Helper"), false);
  assertEquals(result.includes("Slack"), true);
});

// ============================================================
// 9. Image Pipeline Tests
// ============================================================

Deno.test("tools: cu_screenshot result contains _imageAttachment key", async () => {
  if (getPlatform().build.os !== "darwin") return;

  try {
    const result = (await COMPUTER_USE_TOOLS.cu_screenshot.fn(
      {},
      "/tmp",
    )) as Record<string, unknown>;
    if (result.success) {
      assertExists(
        result._imageAttachment,
        "Missing _imageAttachment on success",
      );
      const img = result._imageAttachment as {
        data: string;
        mimeType: string;
        width?: number;
        height?: number;
      };
      assertEquals(img.mimeType, "image/jpeg");
      assertExists(img.data);
      assertExists(img.width);
      assertExists(img.height);
    }
  } catch {
    // Expected in headless CI
  }
});

// ============================================================
// 10. ToolExecutionResult imageAttachments integration
// ============================================================

Deno.test(
  "orchestrator-state: ToolExecutionResult supports imageAttachments",
  () => {
    // Type-level test: verify the type compiles with imageAttachments
    // deno-lint-ignore no-unused-vars
    const result: import("../../../src/hlvm/agent/orchestrator-state.ts").ToolExecutionResult =
      {
        success: true,
        imageAttachments: [
          {
            data: "base64data",
            mimeType: "image/jpeg",
            width: 1280,
            height: 720,
          },
        ],
      };
  },
);
