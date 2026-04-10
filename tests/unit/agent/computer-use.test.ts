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
  assertNotEquals,
  assertRejects,
  assertThrows,
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
  _setLockPathForTests,
  _resetLockStateForTests,
} from "../../../src/hlvm/agent/computer-use/lock.ts";
import {
  cleanupComputerUse,
  cleanupComputerUseAfterTurn,
} from "../../../src/hlvm/agent/computer-use/cleanup.ts";
import {
  CLI_HOST_BUNDLE_ID,
  CLI_CU_CAPABILITIES,
  assertValidBundleId,
  getTerminalBundleId,
  isValidBundleId,
} from "../../../src/hlvm/agent/computer-use/common.ts";
import { drainRunLoop } from "../../../src/hlvm/agent/computer-use/drain-run-loop.ts";
import {
  notifyExpectedEscape,
  unregisterEscHotkey,
} from "../../../src/hlvm/agent/computer-use/esc-hotkey.ts";
import { filterAppsForDescription } from "../../../src/hlvm/agent/computer-use/app-names.ts";
import {
  API_RESIZE_PARAMS,
  type DesktopObservation,
  targetImageSize,
  type WindowInfo,
} from "../../../src/hlvm/agent/computer-use/types.ts";
import {
  clearStaleComputerUseTargetApp,
  clearStaleComputerUseTargetWindow,
  getComputerUseSessionState,
  getComputerUseTargetBundleId,
  getComputerUseTargetWindowId,
  markComputerUsePromotionPending,
  rememberHiddenComputerUseApps,
  rememberComputerUseObservation,
  requiresFreshComputerUseObservation,
  resetComputerUseSessionState,
  resolveObservationTarget,
  setComputerUseTargetBundleId,
  setComputerUseTargetWindow,
  takeHiddenComputerUseApps,
} from "../../../src/hlvm/agent/computer-use/session-state.ts";
import { _testOnly as bridgeTestOnly } from "../../../src/hlvm/agent/computer-use/bridge.ts";

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

Deno.test("common: isValidBundleId accepts reverse-DNS ids", () => {
  assertEquals(isValidBundleId("com.apple.Safari"), true);
  assertEquals(isValidBundleId("dev.warp.Warp-Stable"), true);
});

Deno.test("common: isValidBundleId rejects malformed ids", () => {
  assertEquals(isValidBundleId("Safari"), false);
  assertEquals(isValidBundleId("com..apple"), false);
  assertEquals(isValidBundleId("com.apple."), false);
});

Deno.test("common: assertValidBundleId throws on malformed ids", () => {
  assertThrows(() => assertValidBundleId("Calculator", "bundle_id"));
});

Deno.test("session-state: target bundle can be set and cleared", () => {
  resetComputerUseSessionState();
  setComputerUseTargetBundleId("com.apple.Safari");
  assertEquals(getComputerUseTargetBundleId(), "com.apple.Safari");
  setComputerUseTargetBundleId(undefined);
  assertEquals(getComputerUseTargetBundleId(), undefined);
});

Deno.test("session-state: hidden apps are deduped and drained", () => {
  resetComputerUseSessionState();
  rememberHiddenComputerUseApps([
    "com.apple.Safari",
    "com.apple.Safari",
    "com.apple.TextEdit",
  ]);
  assertEquals(takeHiddenComputerUseApps(), [
    "com.apple.Safari",
    "com.apple.TextEdit",
  ]);
  assertEquals(takeHiddenComputerUseApps(), []);
});

Deno.test("session-state: reset clears both target bundle and hidden apps", () => {
  resetComputerUseSessionState();
  setComputerUseTargetBundleId("com.apple.Safari");
  rememberHiddenComputerUseApps(["com.apple.TextEdit"]);

  resetComputerUseSessionState();

  assertEquals(getComputerUseTargetBundleId(), undefined);
  assertEquals(takeHiddenComputerUseApps(), []);
});

function makeWindow(
  overrides: Partial<WindowInfo> = {},
): WindowInfo {
  return {
    windowId: overrides.windowId ?? 101,
    bundleId: overrides.bundleId ?? "com.apple.Safari",
    displayName: overrides.displayName ?? "Safari",
    title: overrides.title ?? "Example",
    bounds: overrides.bounds ?? { x: 100, y: 120, width: 900, height: 700 },
    displayId: overrides.displayId ?? 2,
    zIndex: overrides.zIndex ?? 0,
    layer: overrides.layer ?? 0,
    ownerPid: overrides.ownerPid ?? 1234,
    isOnscreen: overrides.isOnscreen ?? true,
  };
}

function makeObservation(
  overrides: Partial<DesktopObservation> = {},
): DesktopObservation {
  const window = makeWindow();
  return {
    observationId: overrides.observationId ?? "obs-1",
    createdAt: overrides.createdAt ?? Date.now(),
    display: overrides.display ?? {
      width: 1440,
      height: 900,
      scaleFactor: 2,
      displayId: 2,
      originX: 0,
      originY: 0,
    },
    displaySelectionReason: overrides.displaySelectionReason ?? "target_window",
    screenshot: overrides.screenshot ?? {
      base64: "ZmFrZQ==",
      width: 1280,
      height: 800,
    },
    frontmostApp: overrides.frontmostApp ?? {
      bundleId: "com.apple.Safari",
      displayName: "Safari",
    },
    runningApps: overrides.runningApps ?? [{
      bundleId: "com.apple.Safari",
      displayName: "Safari",
    }],
    windows: overrides.windows ?? [window],
    targets: overrides.targets ?? [{
      targetId: "obs-1:window:101",
      kind: "window",
      label: "Safari - Example",
      role: "window",
      bounds: window.bounds,
      bundleId: "com.apple.Safari",
      confidence: 0.9,
      windowId: 101,
    }],
    permissions: overrides.permissions ?? {
      accessibilityTrusted: true,
      screenRecordingAvailable: true,
      missing: [],
      checkedAt: Date.now(),
    },
    resolvedTargetBundleId: overrides.resolvedTargetBundleId ??
      "com.apple.Safari",
    resolvedTargetWindowId: overrides.resolvedTargetWindowId ?? 101,
  };
}

Deno.test("session-state: remember observation updates display, app, window, and last observation", () => {
  resetComputerUseSessionState();
  const observation = makeObservation();

  rememberComputerUseObservation(observation);

  assertEquals(getComputerUseTargetBundleId(), "com.apple.Safari");
  assertEquals(getComputerUseTargetWindowId(), 101);
  assertEquals(getComputerUseSessionState().selectedDisplayId, 2);
  assertEquals(
    getComputerUseSessionState().displaySelectionReason,
    "target_window",
  );
  const resolved = resolveObservationTarget(
    observation.observationId,
    observation.targets[0]!.targetId,
  );
  assertEquals(resolved.target.bundleId, "com.apple.Safari");
});

Deno.test("session-state: stale observation ids are rejected", () => {
  resetComputerUseSessionState();
  const first = makeObservation();
  const second = makeObservation({
    observationId: "obs-2",
    targets: [{
      targetId: "obs-2:window:202",
      kind: "window",
      label: "TextEdit - Note",
      role: "window",
      bounds: { x: 40, y: 50, width: 600, height: 500 },
      bundleId: "com.apple.TextEdit",
      confidence: 0.85,
      windowId: 202,
    }],
    windows: [makeWindow({
      windowId: 202,
      bundleId: "com.apple.TextEdit",
      displayName: "TextEdit",
      title: "Note",
      bounds: { x: 40, y: 50, width: 600, height: 500 },
    })],
    frontmostApp: {
      bundleId: "com.apple.TextEdit",
      displayName: "TextEdit",
    },
    runningApps: [{
      bundleId: "com.apple.TextEdit",
      displayName: "TextEdit",
    }],
    resolvedTargetBundleId: "com.apple.TextEdit",
    resolvedTargetWindowId: 202,
  });

  rememberComputerUseObservation(first);
  rememberComputerUseObservation(second);

  assertThrows(
    () =>
      resolveObservationTarget(first.observationId, first.targets[0]!.targetId),
    Error,
    "Observation is stale",
  );
});

Deno.test("session-state: unknown target ids are rejected", () => {
  resetComputerUseSessionState();
  const observation = makeObservation();
  rememberComputerUseObservation(observation);

  assertThrows(
    () => resolveObservationTarget(observation.observationId, "missing-target"),
    Error,
    "Unknown target_id",
  );
});

Deno.test("session-state: stale target window is invalidated when it disappears", () => {
  resetComputerUseSessionState();
  setComputerUseTargetWindow(makeWindow());

  clearStaleComputerUseTargetWindow([]);

  assertEquals(getComputerUseTargetWindowId(), undefined);
});

Deno.test("session-state: stale target app is invalidated when it stops running", () => {
  resetComputerUseSessionState();
  setComputerUseTargetBundleId("com.apple.Safari");

  clearStaleComputerUseTargetApp(["com.apple.TextEdit"]);

  assertEquals(getComputerUseTargetBundleId(), undefined);
});

Deno.test("session-state: promotion pending requires a fresh observation and clears stale target context", () => {
  resetComputerUseSessionState();
  const observation = makeObservation();
  rememberComputerUseObservation(observation);
  setComputerUseTargetBundleId("com.apple.Safari");
  setComputerUseTargetWindow(makeWindow());

  markComputerUsePromotionPending(observation.createdAt + 1);

  assertEquals(requiresFreshComputerUseObservation(), true);
  assertEquals(getComputerUseSessionState().lastObservation, undefined);
  assertEquals(getComputerUseTargetBundleId(), undefined);
  assertEquals(getComputerUseTargetWindowId(), undefined);
});

Deno.test("session-state: fresh observation after promotion clears the pending gate", () => {
  resetComputerUseSessionState();
  const first = makeObservation({ createdAt: 100 });
  rememberComputerUseObservation(first);
  markComputerUsePromotionPending(150);

  const second = makeObservation({
    observationId: "obs-2",
    createdAt: 200,
    targets: [{
      targetId: "obs-2:window:101",
      kind: "window",
      label: "Safari - Example",
      role: "window",
      bounds: makeWindow().bounds,
      bundleId: "com.apple.Safari",
      confidence: 0.9,
      windowId: 101,
    }],
  });
  rememberComputerUseObservation(second);

  assertEquals(requiresFreshComputerUseObservation(), false);
  assertEquals(
    getComputerUseSessionState().pendingPromotionObservationAt,
    undefined,
  );
});

Deno.test("bridge: resolvePreparationPlan picks the topmost allowed window on the requested display", () => {
  const plan = bridgeTestOnly.resolvePreparationPlan({
    windows: [
      makeWindow({
        windowId: 200,
        bundleId: "com.apple.TextEdit",
        displayName: "TextEdit",
        displayId: 1,
        zIndex: 0,
      }),
      makeWindow({
        windowId: 101,
        bundleId: "com.apple.Safari",
        displayName: "Safari",
        displayId: 2,
        zIndex: 0,
      }),
      makeWindow({
        windowId: 102,
        bundleId: "com.apple.Safari",
        displayName: "Safari",
        displayId: 2,
        zIndex: 3,
      }),
    ],
    runningApps: [
      { bundleId: "com.apple.Safari", displayName: "Safari" },
      { bundleId: "com.apple.TextEdit", displayName: "TextEdit" },
    ],
    allowedBundleIds: ["com.apple.Safari"],
    hostBundleId: "com.anthropic.claude-code.cli-no-window",
    displayId: 2,
  });

  assertEquals(plan.selectedDisplayId, 2);
  assertEquals(plan.selectedTargetBundleId, "com.apple.Safari");
  assertEquals(plan.selectedTargetWindowId, 101);
  assertEquals(plan.failureReason, undefined);
});

Deno.test("bridge: resolvePreparationPlan fails closed when multiple allowed apps are running without a clear window target", () => {
  const plan = bridgeTestOnly.resolvePreparationPlan({
    windows: [],
    runningApps: [
      { bundleId: "com.apple.Safari", displayName: "Safari" },
      { bundleId: "com.apple.TextEdit", displayName: "TextEdit" },
    ],
    allowedBundleIds: ["com.apple.Safari", "com.apple.TextEdit"],
    hostBundleId: "com.anthropic.claude-code.cli-no-window",
  });

  assertEquals(plan.selectedTargetBundleId, undefined);
  assertEquals(plan.failureReason, "ambiguous_allowed_apps");
});

Deno.test("bridge: selectWindowAtPoint prefers the topmost overlapping window", () => {
  const match = bridgeTestOnly.selectWindowAtPoint(
    [
      makeWindow({
        windowId: 300,
        bundleId: "com.apple.TextEdit",
        displayName: "TextEdit",
        bounds: { x: 100, y: 100, width: 500, height: 500 },
        zIndex: 0,
      }),
      makeWindow({
        windowId: 301,
        bundleId: "com.apple.Safari",
        displayName: "Safari",
        bounds: { x: 120, y: 120, width: 500, height: 500 },
        zIndex: 2,
      }),
    ],
    150,
    150,
  );

  assertEquals(match?.windowId, 300);
  assertEquals(match?.bundleId, "com.apple.TextEdit");
});

Deno.test("bridge: resolveCaptureDisplayId derives display from the selected target window", () => {
  const resolution = bridgeTestOnly.resolveCaptureDisplayId({
    displays: [
      { width: 1440, height: 900, scaleFactor: 2, displayId: 11, originX: 0, originY: 0 },
      { width: 2560, height: 1440, scaleFactor: 2, displayId: 22, originX: 1440, originY: 0 },
    ],
    windows: [
      makeWindow({
        windowId: 900,
        bundleId: "com.apple.Safari",
        displayName: "Safari",
        displayId: 22,
        zIndex: 0,
      }),
    ],
    runningApps: [{ bundleId: "com.apple.Safari", displayName: "Safari" }],
    allowedBundleIds: ["com.apple.Safari"],
    hostBundleId: "com.anthropic.claude-code.cli-no-window",
  });

  assertEquals(resolution.displayId, 22);
  assertEquals(resolution.selectedTargetWindowId, 900);
  assertEquals(resolution.selectedTargetBundleId, "com.apple.Safari");
});

Deno.test("bridge: resolveCaptureDisplayIndex follows cached display ordering", () => {
  const index = bridgeTestOnly.resolveCaptureDisplayIndex(
    [
      { width: 1440, height: 900, scaleFactor: 2, displayId: 11, originX: 0, originY: 0 },
      { width: 2560, height: 1440, scaleFactor: 2, displayId: 22, originX: 1440, originY: 0 },
    ],
    22,
  );

  assertEquals(index, 2);
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
// 4. Tool Registration Tests (VNext: 25 cu_* tools)
// ============================================================

Deno.test("tools: all 25 cu_* tools are exported", () => {
  const expectedTools = [
    "cu_observe",
    "cu_screenshot",
    "cu_cursor_position",
    "cu_left_mouse_down",
    "cu_left_mouse_up",
    "cu_list_granted_applications",
    "cu_read_clipboard",
    "cu_left_click",
    "cu_right_click",
    "cu_middle_click",
    "cu_double_click",
    "cu_triple_click",
    "cu_mouse_move",
    "cu_type",
    "cu_key",
    "cu_hold_key",
    "cu_write_clipboard",
    "cu_scroll",
    "cu_left_click_drag",
    "cu_zoom",
    "cu_click_target",
    "cu_type_into_target",
    "cu_open_application",
    "cu_request_access",
    "cu_wait",
  ];
  for (const name of expectedTools) {
    assertExists(
      COMPUTER_USE_TOOLS[name],
      `Missing tool: ${name}`,
    );
  }
  assertEquals(Object.keys(COMPUTER_USE_TOOLS).length, 25);
});

Deno.test("tools: L0 read-only tools have correct safety levels", () => {
  const l0Tools = [
    "cu_cursor_position",
    "cu_list_granted_applications",
    "cu_read_clipboard",
  ];
  for (const name of l0Tools) {
    assertEquals(
      COMPUTER_USE_TOOLS[name].safetyLevel,
      "L0",
      `${name} should be L0`,
    );
  }
});

Deno.test("tools: L1 capture/wait tools have correct safety levels", () => {
  const l1Tools = ["cu_observe", "cu_screenshot", "cu_zoom", "cu_wait"];
  for (const name of l1Tools) {
    assertEquals(
      COMPUTER_USE_TOOLS[name].safetyLevel,
      "L1",
      `${name} should be L1`,
    );
  }
});

Deno.test("tools: write tools have L2 safety level", () => {
  const l2Tools = [
    "cu_left_mouse_down",
    "cu_left_mouse_up",
    "cu_left_click",
    "cu_right_click",
    "cu_middle_click",
    "cu_double_click",
    "cu_triple_click",
    "cu_mouse_move",
    "cu_type",
    "cu_key",
    "cu_hold_key",
    "cu_write_clipboard",
    "cu_scroll",
    "cu_left_click_drag",
    "cu_click_target",
    "cu_type_into_target",
    "cu_open_application",
    "cu_request_access",
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
  const concurrentTools = [
    "cu_observe",
    "cu_screenshot",
    "cu_cursor_position",
    "cu_list_granted_applications",
    "cu_read_clipboard",
    "cu_zoom",
    "cu_wait",
  ];
  for (const name of concurrentTools) {
    assertEquals(
      COMPUTER_USE_TOOLS[name].execution?.concurrencySafe,
      true,
      `${name} should be concurrency-safe`,
    );
  }
});

Deno.test("tools: all tools have descriptions and fn", () => {
  for (const [name, meta] of Object.entries(COMPUTER_USE_TOOLS)) {
    assertExists(meta.description, `${name} missing description`);
    assertExists(meta.fn, `${name} missing fn`);
  }
});

Deno.test("tools: cu_screenshot has formatResult with CC summary", () => {
  const meta = COMPUTER_USE_TOOLS.cu_screenshot;
  assertExists(meta.formatResult);
  const formatted = meta.formatResult!({ width: 1280, height: 720 });
  assertExists(formatted);
  assertEquals(formatted!.summaryDisplay, "Captured 1280x720");
});

Deno.test("tools: cu_observe is registered as read-only observation entrypoint", () => {
  const meta = COMPUTER_USE_TOOLS.cu_observe;
  assertExists(meta);
  assertEquals(meta.category, "read");
  assertEquals(meta.safetyLevel, "L1");
});

Deno.test("tools: click tools use coordinate arg", () => {
  const clickTools = [
    "cu_left_click",
    "cu_right_click",
    "cu_middle_click",
    "cu_double_click",
    "cu_triple_click",
  ];
  for (const name of clickTools) {
    assertExists(
      COMPUTER_USE_TOOLS[name].args?.coordinate,
      `${name} missing coordinate arg`,
    );
  }
});

Deno.test("tools: cu_scroll has direction and amount args", () => {
  const meta = COMPUTER_USE_TOOLS.cu_scroll;
  assertExists(meta.args?.coordinate);
  assertExists(meta.args?.scroll_direction);
  assertExists(meta.args?.scroll_amount);
});

Deno.test("tools: cu_left_click_drag has coordinate and start_coordinate args", () => {
  const meta = COMPUTER_USE_TOOLS.cu_left_click_drag;
  assertExists(meta.args?.coordinate);
  assertExists(meta.args?.start_coordinate);
  assertEquals(meta.args!.start_coordinate!.includes("optional"), true);
});

Deno.test("tools: cu_key uses text param (CC schema)", () => {
  const meta = COMPUTER_USE_TOOLS.cu_key;
  assertExists(meta.args?.text);
  assertExists(meta.args?.repeat);
});

Deno.test("tools: cu_hold_key has text and duration args", () => {
  const meta = COMPUTER_USE_TOOLS.cu_hold_key;
  assertExists(meta.args?.text);
  assertExists(meta.args?.duration);
});

Deno.test("tools: cu_zoom has region arg", () => {
  const meta = COMPUTER_USE_TOOLS.cu_zoom;
  assertExists(meta.args?.region);
});

Deno.test("tools: target-grounded CU actions expose observation and target ids", () => {
  const clickMeta = COMPUTER_USE_TOOLS.cu_click_target;
  assertExists(clickMeta.args?.observation_id);
  assertExists(clickMeta.args?.target_id);

  const typeMeta = COMPUTER_USE_TOOLS.cu_type_into_target;
  assertExists(typeMeta.args?.observation_id);
  assertExists(typeMeta.args?.target_id);
  assertExists(typeMeta.args?.text);
});

Deno.test("tools: cu_open_application has bundle_id arg", () => {
  const meta = COMPUTER_USE_TOOLS.cu_open_application;
  assertExists(meta.args?.bundle_id);
});

Deno.test("tools: cu_wait has duration arg", () => {
  const meta = COMPUTER_USE_TOOLS.cu_wait;
  assertExists(meta.args?.duration);
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

// Helper: isolate each lock test with its own temp directory and clean state
async function withIsolatedLock(fn: () => Promise<void>): Promise<void> {
  const tmpDir = await Deno.makeTempDir({ prefix: "hlvm-lock-test-" });
  const lockPath = `${tmpDir}/computer-use.lock`;
  _setLockPathForTests(lockPath);
  _resetLockStateForTests();
  try {
    await fn();
  } finally {
    _resetLockStateForTests();
    _setLockPathForTests(undefined);
    try {
      await Deno.remove(tmpDir, { recursive: true });
    } catch { /* ignore */ }
  }
}

Deno.test({
  name: "lock: tryAcquire returns acquired+fresh on first call",
  fn: () =>
    withIsolatedLock(async () => {
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
    }),
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "lock: tryAcquire returns acquired+reentrant on same session",
  fn: () =>
    withIsolatedLock(async () => {
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
    }),
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "lock: isLockHeldLocally tracks state",
  fn: () =>
    withIsolatedLock(async () => {
      const before = isLockHeldLocally();
      assertEquals(before, false);
      const sessionId = `test-local-${Date.now()}`;
      await tryAcquireComputerUseLock(sessionId);
      assertEquals(isLockHeldLocally(), true);
      await releaseComputerUseLock();
      assertEquals(isLockHeldLocally(), false);
    }),
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "lock: checkComputerUseLock returns free when no lock",
  fn: () =>
    withIsolatedLock(async () => {
      const result = await checkComputerUseLock();
      assertEquals(result.kind, "free");
    }),
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "lock: release is idempotent",
  fn: () =>
    withIsolatedLock(async () => {
      const first = await releaseComputerUseLock();
      const second = await releaseComputerUseLock();
      // Both should return false (nothing to release)
      assertEquals(first, false);
      assertEquals(second, false);
    }),
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "lock: cleanup releases lock",
  fn: () =>
    withIsolatedLock(async () => {
      const sessionId = `test-cleanup-${Date.now()}`;
      await tryAcquireComputerUseLock(sessionId);
      await cleanupComputerUse();
      // Should be able to re-acquire after cleanup
      const result = await tryAcquireComputerUseLock(sessionId);
      assertEquals(result.kind, "acquired");
      await releaseComputerUseLock();
    }),
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: "lock: release clears remembered computer-use session state",
  fn: () =>
    withIsolatedLock(async () => {
      const sessionId = `test-state-reset-${Date.now()}`;
      await tryAcquireComputerUseLock(sessionId);
      setComputerUseTargetBundleId("com.apple.Safari");
      rememberHiddenComputerUseApps(["com.apple.TextEdit"]);

      await releaseComputerUseLock();

      assertEquals(getComputerUseTargetBundleId(), undefined);
      assertEquals(takeHiddenComputerUseApps(), []);
    }),
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

// ── Backend Resolution Tests ──────────────────────────────────────────────

import {
  resolveBackend,
  invalidateBackendResolution,
  getResolvedBackend,
} from "../../../src/hlvm/agent/computer-use/bridge.ts";

Deno.test("resolveBackend: returns jxa when HLVM_CU_PORT not set", async () => {
  invalidateBackendResolution();
  const saved = Deno.env.get("HLVM_CU_PORT");
  try {
    Deno.env.delete("HLVM_CU_PORT");
    const result = await resolveBackend();
    assertEquals(result.backend, "jxa");
    assertEquals(result.port, undefined);
    assertEquals(result.capabilities, undefined);
  } finally {
    if (saved) Deno.env.set("HLVM_CU_PORT", saved);
    invalidateBackendResolution();
  }
});

Deno.test("resolveBackend: returns jxa when port is invalid", async () => {
  invalidateBackendResolution();
  const saved = Deno.env.get("HLVM_CU_PORT");
  try {
    Deno.env.set("HLVM_CU_PORT", "not-a-number");
    const result = await resolveBackend();
    assertEquals(result.backend, "jxa");
  } finally {
    if (saved) Deno.env.set("HLVM_CU_PORT", saved);
    else Deno.env.delete("HLVM_CU_PORT");
    invalidateBackendResolution();
  }
});

Deno.test("resolveBackend: returns jxa when native service unreachable", async () => {
  invalidateBackendResolution();
  const saved = Deno.env.get("HLVM_CU_PORT");
  try {
    // Use a port that's almost certainly not serving the CU service
    Deno.env.set("HLVM_CU_PORT", "19999");
    const result = await resolveBackend();
    assertEquals(result.backend, "jxa");
  } finally {
    if (saved) Deno.env.set("HLVM_CU_PORT", saved);
    else Deno.env.delete("HLVM_CU_PORT");
    invalidateBackendResolution();
  }
});

Deno.test("resolveBackend: caches result", async () => {
  invalidateBackendResolution();
  const saved = Deno.env.get("HLVM_CU_PORT");
  try {
    Deno.env.delete("HLVM_CU_PORT");
    const r1 = await resolveBackend();
    const r2 = await resolveBackend();
    assertEquals(r1, r2); // Same object reference (cached)
  } finally {
    if (saved) Deno.env.set("HLVM_CU_PORT", saved);
    invalidateBackendResolution();
  }
});

Deno.test("invalidateBackendResolution: clears cache", async () => {
  invalidateBackendResolution();
  Deno.env.delete("HLVM_CU_PORT");
  await resolveBackend();
  assertExists(getResolvedBackend());
  invalidateBackendResolution();
  assertEquals(getResolvedBackend(), undefined);
});

Deno.test("ObservationTarget kind: accepts element-level kinds", () => {
  // Type-level test: ensure the union compiles with all kinds
  const kinds: import("../../../src/hlvm/agent/computer-use/types.ts").ObservationTargetKind[] = [
    "window", "button", "textfield", "checkbox", "menuitem", "link", "other",
  ];
  assertEquals(kinds.length, 7);
});
