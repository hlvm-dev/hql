/**
 * Computer Use — Tool Definitions (V2: CC Parity)
 *
 * 25 tools: the original Claude Code `computer_20250124`-style coordinate
 * suite plus HLVM's observation-first target actions (`cu_observe`,
 * `cu_click_target`, `cu_type_into_target`).
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
  assertValidBundleId,
  isComputerUseHostBundleId,
  type ComputerUseSettingsPane,
  openComputerUseSettings,
} from "./common.ts";
import {
  buildToolFailureMetadata,
  failTool,
  failToolDetailed,
  formatToolError,
  isToolFailureMetadata,
  okTool,
} from "../tool-results.ts";
import type {
  ComputerExecutor,
  ComputerUsePermissionState,
  DesktopObservation,
  DisplaySelectionReason,
  WindowInfo,
} from "./types.ts";
import { createCliExecutor } from "./executor.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { tryAcquireComputerUseLock } from "./lock.ts";
import {
  clearStaleComputerUseTargetApp,
  clearStaleComputerUseTargetWindow,
  getComputerUseSessionState,
  getComputerUseTargetWindowId,
  getLastComputerUseObservation,
  getComputerUseTargetBundleId,
  markComputerUseFailure,
  markComputerUseSuccess,
  requiresFreshComputerUseObservation,
  rememberComputerUseObservation,
  rememberHiddenComputerUseApps,
  resolveObservationTarget,
  setComputerUseSelectedDisplay,
  setComputerUsePermissionState,
  setComputerUseTargetBundleId,
  setComputerUseTargetWindow,
} from "./session-state.ts";
import { getResolvedBackend } from "./bridge.ts";
import { getAgentLogger } from "../logger.ts";

/**
 * Try to execute a target action via the native GUI backend.
 * Returns true if the native action succeeded, false if unavailable or failed.
 * On failure, caller falls back to coordinate-based action.
 */
async function tryNativeTargetAction(
  path: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const resolution = getResolvedBackend();
  if (!resolution || resolution.backend !== "native_gui" || !resolution.port) {
    return false;
  }
  const platform = getPlatform();
  const token = platform.env.get("HLVM_AUTH_TOKEN") ?? "";
  try {
    const result = await platform.command.output({
      cmd: [
        "curl", "-sf", "--max-time", "10",
        "-H", `Authorization: Bearer ${token}`,
        "-H", "Content-Type: application/json",
        "-d", JSON.stringify(body),
        `http://127.0.0.1:${resolution.port}${path}`,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      timeout: 15000,
    });
    if (!result.success) return false;
    const response = JSON.parse(new TextDecoder().decode(result.stdout));
    return response.ok === true;
  } catch (err) {
    getAgentLogger().debug(
      `[tools] Native target action ${path} failed: ${err}`,
    );
    return false;
  }
}

// ── CC Result Summary Map (from toolRendering.tsx) ──────────────────────

const RESULT_SUMMARY: Record<string, string> = {
  observe: "Observed",
  screenshot: "Captured",
  zoom: "Captured",
  request_access: "Access updated",
  left_click: "Clicked",
  click_target: "Clicked",
  right_click: "Clicked",
  middle_click: "Clicked",
  double_click: "Clicked",
  triple_click: "Clicked",
  type: "Typed",
  type_into_target: "Typed",
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

function summarizeObservation(
  observation: DesktopObservation,
): Record<string, unknown> {
  return {
    observation_id: observation.observationId,
    created_at: observation.createdAt,
    width: observation.screenshot.width,
    height: observation.screenshot.height,
    display: {
      display_id: observation.display.displayId,
      width: observation.display.width,
      height: observation.display.height,
      origin_x: observation.display.originX ?? 0,
      origin_y: observation.display.originY ?? 0,
      scale_factor: observation.display.scaleFactor,
    },
    display_selection_reason: observation.displaySelectionReason,
    frontmost_app: observation.frontmostApp
      ? {
        bundleId: observation.frontmostApp.bundleId,
        displayName: observation.frontmostApp.displayName,
      }
      : null,
    permissions: {
      accessibility_trusted: observation.permissions.accessibilityTrusted,
      screen_recording_available:
        observation.permissions.screenRecordingAvailable,
      missing: observation.permissions.missing,
    },
    running_apps: observation.runningApps.slice(0, 12).map((app) => ({
      bundleId: app.bundleId,
      displayName: app.displayName,
    })),
    windows: observation.windows.slice(0, 12).map((window) => ({
      window_id: window.windowId,
      bundleId: window.bundleId ?? null,
      displayName: window.displayName,
      title: window.title ?? null,
      display_id: window.displayId ?? null,
      bounds: window.bounds,
      z_index: window.zIndex,
      layer: window.layer,
    })),
    targets: observation.targets.slice(0, 12).map((target) => ({
      target_id: target.targetId,
      kind: target.kind,
      label: target.label,
      role: target.role,
      bounds: target.bounds,
      bundleId: target.bundleId,
      confidence: target.confidence,
      window_id: target.windowId ?? null,
    })),
    resolved_target_bundle_id: observation.resolvedTargetBundleId ?? null,
    resolved_target_window_id: observation.resolvedTargetWindowId ?? null,
  };
}

function observationImageResult(
  observation: DesktopObservation,
  data: Record<string, unknown> = {},
): unknown {
  return imageResult(
    {
      ...summarizeObservation(observation),
      ...data,
    },
    observation.screenshot,
  );
}

function runtimeFailure(
  message: string,
  failure: Partial<Parameters<typeof buildToolFailureMetadata>[1]> = {},
): Error & { failure: ReturnType<typeof buildToolFailureMetadata> } {
  const error = new Error(message) as Error & {
    failure: ReturnType<typeof buildToolFailureMetadata>;
  };
  error.failure = buildToolFailureMetadata(message, {
    source: "runtime",
    kind: "invalid_state",
    retryable: false,
    ...failure,
  });
  return error;
}

function getFailureMetadata(
  error: unknown,
): ReturnType<typeof buildToolFailureMetadata> | undefined {
  if (!error || typeof error !== "object" || !("failure" in error)) return;
  const failure = (error as { failure?: unknown }).failure;
  return isToolFailureMetadata(failure) ? failure : undefined;
}

function describePermissionBlock(
  permissions: ComputerUsePermissionState,
  mode: "observe" | "interactive",
): {
  message: string;
  missing: string[];
  uncertain: string[];
  pane: ComputerUseSettingsPane;
} | null {
  const missing: string[] = [];
  const uncertain: string[] = [];
  if (!permissions.accessibilityTrusted) {
    missing.push("Accessibility");
  }
  if (permissions.screenRecordingAvailable === false) {
    missing.push("Screen Recording");
  } else if (
    mode === "interactive" && permissions.screenRecordingAvailable !== true
  ) {
    uncertain.push("Screen Recording");
  }
  if (mode === "observe" && missing.length === 0) {
    return null;
  }
  if (mode === "interactive" && missing.length === 0 && uncertain.length === 0) {
    return null;
  }

  const pane: ComputerUseSettingsPane = missing.includes("Accessibility")
    ? "accessibility"
    : missing.includes("Screen Recording") || uncertain.includes("Screen Recording")
    ? "screen_recording"
    : "general";
  const blockedActions = mode === "interactive"
    ? "keyboard, mouse, drag, scroll, and app-switch actions"
    : "screen observation actions";
  const missingText = missing.length > 0
    ? `Missing: ${missing.join(", ")}.`
    : "";
  const uncertainText = uncertain.length > 0
    ? ` Verification indeterminate: ${uncertain.join(", ")}.`
    : "";
  return {
    message:
      `Computer use cannot continue with ${blockedActions} until macOS permissions are verified.${missingText}${uncertainText} Call cu_request_access, then review the indicated pane in System Settings.`,
    missing,
    uncertain,
    pane,
  };
}

function ensureFreshObservationAfterPromote(): void {
  if (!requiresFreshComputerUseObservation()) return;
  throw runtimeFailure(
    "After pw_promote, call cu_observe or cu_screenshot before the first desktop action.",
    {
      kind: "invalid_state",
      retryable: false,
      code: "cu_observation_required_after_promote",
    },
  );
}

async function ensureObservationPermissions(
  exec: ComputerExecutor,
): Promise<void> {
  const permissions = await exec.getPermissionState();
  setComputerUsePermissionState(permissions);
  const blocked = describePermissionBlock(permissions, "observe");
  if (blocked) {
    throw runtimeFailure(blocked.message, {
      kind: "permission_denied",
      retryable: false,
      code: "cu_screen_recording_required",
      facts: {
        missing: blocked.missing,
        uncertain: blocked.uncertain,
      },
    });
  }
}

async function ensureInteractivePermissions(
  exec: ComputerExecutor,
): Promise<void> {
  const permissions = await exec.getPermissionState();
  setComputerUsePermissionState(permissions);
  const blocked = describePermissionBlock(permissions, "interactive");
  if (blocked) {
    throw runtimeFailure(blocked.message, {
      kind: "permission_denied",
      retryable: false,
      code: "cu_interactive_permissions_required",
      facts: {
        missing: blocked.missing,
        uncertain: blocked.uncertain,
      },
    });
  }
}

async function resolveDisplayChoice(
  exec: ComputerExecutor,
  requestedDisplayId?: number,
): Promise<{
  displayId?: number;
  reason: DisplaySelectionReason;
  visibleWindows?: WindowInfo[];
}> {
  if (requestedDisplayId != null) {
    return {
      displayId: requestedDisplayId,
      reason: "explicit",
    };
  }

  const sessionState = getComputerUseSessionState();
  const visibleWindows = await exec.listVisibleWindows().catch(() => []);
  clearStaleComputerUseTargetWindow(visibleWindows);

  const targetWindowId = getComputerUseTargetWindowId();
  if (targetWindowId != null) {
    const targetWindow = visibleWindows.find((window) =>
      window.windowId === targetWindowId
    );
    if (targetWindow?.displayId != null) {
      return {
        displayId: targetWindow.displayId,
        reason: "target_window",
        visibleWindows,
      };
    }
  }

  const targetBundleId = getComputerUseTargetBundleId();
  if (targetBundleId) {
    const matches = await exec.findWindowDisplays([targetBundleId]).catch(() => []);
    const displayId = matches[0]?.displayIds[0];
    if (displayId != null) {
      return { displayId, reason: "target_app", visibleWindows };
    }
  }

  const lastObservation = getLastComputerUseObservation();
  if (lastObservation?.display.displayId != null) {
    return {
      displayId: lastObservation.display.displayId,
      reason: "previous_observation",
      visibleWindows,
    };
  }

  const frontmost = await exec.getFrontmostApp().catch(() => null);
  if (frontmost?.bundleId && !isComputerUseHostBundleId(frontmost.bundleId)) {
    const matches = await exec.findWindowDisplays([frontmost.bundleId]).catch(() => []);
    const displayId = matches[0]?.displayIds[0];
    if (displayId != null) {
      return { displayId, reason: "frontmost_app", visibleWindows };
    }
  }

  return {
    displayId: sessionState.selectedDisplayId,
    reason: "default",
    visibleWindows,
  };
}

async function observeDesktop(
  exec: ComputerExecutor,
  options?: ToolExecutionOptions,
  overrides?: {
    resolvedTargetBundleId?: string;
    resolvedTargetWindowId?: number;
  },
): Promise<DesktopObservation> {
  await ensureObservationPermissions(exec);
  const displayChoice = await resolveDisplayChoice(exec, options?.displayId);
  const observation = await exec.observe({
    allowedBundleIds: [],
    preferredDisplayId: displayChoice.displayId,
    displaySelectionReason: displayChoice.reason,
    resolvedTargetBundleId: overrides?.resolvedTargetBundleId,
    resolvedTargetWindowId: overrides?.resolvedTargetWindowId,
  });
  rememberComputerUseObservation(observation);
  return observation;
}

async function resolvePrepareAllowlist(
  exec: ComputerExecutor,
  visibleWindows?: readonly WindowInfo[],
): Promise<{
  allowlist: string[];
  expectedTargetBundleId?: string;
  expectedTargetWindowId?: number;
}> {
  const runningApps = await exec.listRunningApps().catch(() => []);
  clearStaleComputerUseTargetApp(runningApps.map((app) => app.bundleId));

  const windows = visibleWindows ? [...visibleWindows] : await exec
    .listVisibleWindows()
    .catch(() => []);
  clearStaleComputerUseTargetWindow(windows);

  const targetWindowId = getComputerUseTargetWindowId();
  if (targetWindowId != null) {
    const targetWindow = windows.find((window) => window.windowId === targetWindowId);
    if (targetWindow?.bundleId) {
      return {
        allowlist: [targetWindow.bundleId],
        expectedTargetBundleId: targetWindow.bundleId,
        expectedTargetWindowId: targetWindow.windowId,
      };
    }
  }

  const remembered = getComputerUseTargetBundleId();
  if (remembered && runningApps.some((app) => app.bundleId === remembered)) {
    return {
      allowlist: [remembered],
      expectedTargetBundleId: remembered,
    };
  }

  const frontmost = await exec.getFrontmostApp().catch(() => null);
  if (frontmost?.bundleId && !isComputerUseHostBundleId(frontmost.bundleId)) {
    return {
      allowlist: [frontmost.bundleId],
      expectedTargetBundleId: frontmost.bundleId,
    };
  }

  return { allowlist: [] };
}

async function verifyFrontmostApp(
  exec: ComputerExecutor,
  expectedTargetBundleId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const frontmost = await exec.getFrontmostApp().catch(() => null);
    if (frontmost?.bundleId === expectedTargetBundleId) {
      setComputerUseTargetBundleId(frontmost.bundleId, frontmost.displayName);
      return;
    }
    if (attempt === 0) {
      await sleep(100);
    }
  }
  throw runtimeFailure(
    `Target activation failed. Expected frontmost app '${expectedTargetBundleId}' before sending input.`,
    {
      kind: "invalid_state",
      retryable: true,
      code: "cu_target_activation_mismatch",
      facts: {
        expectedTargetBundleId,
      },
    },
  );
}

interface PreparedActionContext {
  displayId?: number;
  expectedTargetBundleId?: string;
  expectedTargetWindowId?: number;
}

async function prepareInteractiveAction(
  exec: ComputerExecutor,
  options: ToolExecutionOptions | undefined,
  requireTargetApp: boolean | undefined,
): Promise<PreparedActionContext> {
  ensureFreshObservationAfterPromote();
  await ensureInteractivePermissions(exec);
  const displayChoice = await resolveDisplayChoice(exec, options?.displayId);
  const target = await resolvePrepareAllowlist(exec, displayChoice.visibleWindows);
  if (requireTargetApp && target.allowlist.length === 0) {
    throw runtimeFailure(
      "No target application is selected. Open or focus the app before sending keyboard input.",
      {
        kind: "invalid_state",
        retryable: false,
        code: "cu_no_target_app",
      },
    );
  }
  const prepareResult = target.allowlist.length > 0
    ? await exec.prepareForAction(
      target.allowlist,
      displayChoice.displayId,
    )
    : undefined;
  if (prepareResult) {
    rememberHiddenComputerUseApps(prepareResult.hidden);
  }

  const selectedDisplayId = prepareResult?.selectedDisplayId ??
    displayChoice.displayId;
  if (selectedDisplayId != null) {
    setComputerUseSelectedDisplay(selectedDisplayId, displayChoice.reason);
  }

  const expectedTargetBundleId = prepareResult?.selectedTargetBundleId ??
    target.expectedTargetBundleId;
  const expectedTargetWindowId = prepareResult?.selectedTargetWindowId ??
    target.expectedTargetWindowId;
  if (expectedTargetBundleId) {
    setComputerUseTargetBundleId(expectedTargetBundleId);
  }
  if (expectedTargetWindowId != null) {
    const visibleWindows = displayChoice.visibleWindows
      ? [...displayChoice.visibleWindows]
      : await exec.listVisibleWindows().catch(() => []);
    const targetWindow = visibleWindows.find((window) =>
      window.windowId === expectedTargetWindowId
    );
    setComputerUseTargetWindow(targetWindow ?? null);
  }

  if (target.allowlist.length > 0 && prepareResult?.failureReason) {
    throw runtimeFailure(
      `Target resolution failed before action: ${prepareResult.failureReason}.`,
      {
        kind: "invalid_state",
        retryable: true,
        code: "cu_prepare_target_unresolved",
        facts: {
          displayId: selectedDisplayId,
          resolutionReason: prepareResult.resolutionReason,
          failureReason: prepareResult.failureReason,
          expectedTargetBundleId,
          expectedTargetWindowId,
        },
      },
    );
  }

  if (expectedTargetBundleId) {
    await verifyFrontmostApp(exec, expectedTargetBundleId);
  }
  return {
    displayId: selectedDisplayId,
    expectedTargetBundleId,
    expectedTargetWindowId,
  };
}

async function prepareInteractiveActionWithRecovery(
  exec: ComputerExecutor,
  options: ToolExecutionOptions | undefined,
  requireTargetApp: boolean | undefined,
): Promise<PreparedActionContext> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prepareInteractiveAction(exec, options, requireTargetApp);
    } catch (error) {
      lastError = error;
      const failure = getFailureMetadata(error);
      if (
        attempt === 0 &&
        failure?.source === "runtime" &&
        failure.retryable
      ) {
        await observeDesktop(exec, options);
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function verifyPostActionObservation(
  exec: ComputerExecutor,
  options: ToolExecutionOptions | undefined,
  prepared: PreparedActionContext,
  mode: "generic" | "focus_sensitive",
): Promise<DesktopObservation> {
  const observation = await observeDesktop(exec, {
    ...options,
    displayId: prepared.displayId ?? options?.displayId,
  }, {
    resolvedTargetBundleId: prepared.expectedTargetBundleId,
    resolvedTargetWindowId: prepared.expectedTargetWindowId,
  });
  if (
    prepared.displayId != null &&
    observation.display.displayId != null &&
    observation.display.displayId !== prepared.displayId
  ) {
    throw runtimeFailure(
      `Post-action verification failed. Expected display '${prepared.displayId}', found '${observation.display.displayId}'.`,
      {
        kind: "invalid_state",
        retryable: false,
        code: "cu_post_action_display_mismatch",
        facts: {
          expectedDisplayId: prepared.displayId,
          actualDisplayId: observation.display.displayId,
        },
      },
    );
  }
  if (prepared.expectedTargetWindowId != null) {
    const targetWindow = observation.windows.find((window) =>
      window.windowId === prepared.expectedTargetWindowId
    );
    if (!targetWindow) {
      throw runtimeFailure(
        `Post-action verification failed. Expected target window '${prepared.expectedTargetWindowId}' to remain visible.`,
        {
          kind: "invalid_state",
          retryable: false,
          code: "cu_post_action_window_missing",
          facts: {
            expectedTargetWindowId: prepared.expectedTargetWindowId,
          },
        },
      );
    }
    if (
      prepared.displayId != null &&
      targetWindow.displayId != null &&
      targetWindow.displayId !== prepared.displayId
    ) {
      throw runtimeFailure(
        `Post-action verification failed. Expected target window '${prepared.expectedTargetWindowId}' on display '${prepared.displayId}', found '${targetWindow.displayId}'.`,
        {
          kind: "invalid_state",
          retryable: false,
          code: "cu_post_action_window_display_mismatch",
          facts: {
            expectedTargetWindowId: prepared.expectedTargetWindowId,
            expectedDisplayId: prepared.displayId,
            actualDisplayId: targetWindow.displayId,
          },
        },
      );
    }
  }
  if (prepared.expectedTargetBundleId) {
    const actualFrontmostBundleId = observation.frontmostApp?.bundleId;
    if (actualFrontmostBundleId !== prepared.expectedTargetBundleId) {
      throw runtimeFailure(
        `Post-action verification failed. Expected frontmost app '${prepared.expectedTargetBundleId}', found '${actualFrontmostBundleId ?? "none"}'.`,
        {
          kind: "invalid_state",
          retryable: false,
          code: mode === "focus_sensitive"
            ? "cu_post_action_focus_mismatch"
            : "cu_post_action_target_mismatch",
          facts: {
            expectedTargetBundleId: prepared.expectedTargetBundleId,
            actualFrontmostBundleId,
          },
        },
      );
    }
    if (
      mode === "generic" &&
      !observation.windows.some((window) =>
        window.bundleId === prepared.expectedTargetBundleId
      )
    ) {
      throw runtimeFailure(
        `Post-action verification failed. Expected visible window for '${prepared.expectedTargetBundleId}'.`,
        {
          kind: "invalid_state",
          retryable: false,
          code: "cu_post_action_window_context_missing",
          facts: {
            expectedTargetBundleId: prepared.expectedTargetBundleId,
          },
        },
      );
    }
  }
  return observation;
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
    options?: ToolExecutionOptions,
  ) => Promise<unknown>,
  opts?: {
    readOnly?: boolean;
    interactive?: boolean;
    requireTargetApp?: boolean;
    actionKind?: string;
    postActionVerify?: "generic" | "focus_sensitive" | false;
    afterSuccess?: (
      args: unknown,
      exec: ComputerExecutor,
      result: unknown,
      observation?: DesktopObservation,
    ) => Promise<void>;
  },
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
      const interactive = !opts?.readOnly && opts?.interactive !== false;
      let prepared: PreparedActionContext = {};
      if (interactive) {
        prepared = await prepareInteractiveActionWithRecovery(
          exec,
          options,
          opts?.requireTargetApp,
        );
      }
      const result = await fn(args, exec, options);
      const verificationMode = interactive
        ? opts?.postActionVerify ?? "generic"
        : false;
      const verifiedObservation = verificationMode
        ? await verifyPostActionObservation(
          exec,
          options,
          prepared,
          verificationMode,
        )
        : undefined;
      if (opts?.afterSuccess) {
        await opts.afterSuccess(args, exec, result, verifiedObservation);
      }
      markComputerUseSuccess({
        kind: opts?.actionKind ?? errorPrefix,
        at: Date.now(),
        targetBundleId: prepared.expectedTargetBundleId,
        targetWindowId: prepared.expectedTargetWindowId,
        observationId: verifiedObservation?.observationId,
      });
      return result;
    } catch (error) {
      const failure = getFailureMetadata(error);
      markComputerUseFailure({
        code: failure?.code ?? opts?.actionKind ?? errorPrefix,
        message: error instanceof Error ? error.message : String(error),
        at: Date.now(),
        retryable: failure?.retryable,
      });
      const toolError = formatToolError(errorPrefix, error, failure);
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
  return cuTool(
    errorPrefix,
    async (args, exec) => {
      const { coordinate, text } = args as {
        coordinate: [number, number];
        text?: string;
      };
      const { x, y } = parseCoordinate(coordinate);
      await exec.click(x, y, button, count, parseModifiers(text));
      return okTool({ clicked: { x, y } });
    },
    {
      actionKind: errorPrefix,
    },
  );
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

const cuScreenshotFn = cuTool(
  "Screenshot failed",
  async (_args, exec, options) => {
    const observation = await observeDesktop(exec, options);
    return observationImageResult(observation);
  },
  { readOnly: true },
);

const cuObserveFn = cuTool(
  "Observe failed",
  async (_args, exec, options) => {
    const observation = await observeDesktop(exec, options);
    return observationImageResult(observation);
  },
  { readOnly: true },
);

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
}, {
  actionKind: "cu_left_mouse_down",
});

const cuLeftMouseUpFn = cuTool("Mouse up failed", async (_args, exec) => {
  await exec.mouseUp();
  return okTool({ released: "left" });
}, {
  actionKind: "cu_left_mouse_up",
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
}, {
  actionKind: "cu_mouse_move",
});

const cuTypeFn = cuTool("Type failed", async (args, exec) => {
  const { text } = args as { text: string };
  await exec.type(text, { viaClipboard: true });
  return okTool({ typed: text.length > 80 ? text.slice(0, 77) + "..." : text });
}, {
  actionKind: "cu_type",
  requireTargetApp: true,
  postActionVerify: "focus_sensitive",
});

const cuKeyFn = cuTool("Key press failed", async (args, exec) => {
  const { text, repeat } = args as { text: string; repeat?: number };
  const rpt = repeat != null ? (Number(repeat) || 1) : undefined;
  await exec.key(text, rpt);
  return okTool({ pressed: text, repeat: rpt ?? 1 });
}, {
  actionKind: "cu_key",
  requireTargetApp: true,
  postActionVerify: "focus_sensitive",
});

const cuHoldKeyFn = cuTool("Hold key failed", async (args, exec) => {
  const { text, duration } = args as { text: string; duration: number };
  const raw = Number(duration);
  const dur = Number.isFinite(raw) ? Math.max(raw, 0) : 1;
  await exec.holdKey([text], dur * 1000);
  return okTool({ held: text, duration_seconds: dur });
}, {
  actionKind: "cu_hold_key",
  requireTargetApp: true,
  postActionVerify: "focus_sensitive",
});

const cuWriteClipboardFn = cuTool(
  "Clipboard write failed",
  async (args, exec) => {
    const { text } = args as { text: string };
    await exec.writeClipboard(text);
    return okTool({ written: true });
  },
  { interactive: false },
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
}, {
  actionKind: "cu_scroll",
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
}, {
  actionKind: "cu_left_click_drag",
});

const cuZoomFn = cuTool("Zoom failed", async (args, exec, options) => {
  await ensureObservationPermissions(exec);
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
  const result = await exec.zoom(
    { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
    [],
    options?.displayId,
  );
  return imageResult({
    width: result.width,
    height: result.height,
    display_id: getComputerUseSessionState().selectedDisplayId ?? null,
  }, result);
}, { readOnly: true });

const cuOpenApplicationFn = cuTool(
  "Open application failed",
  async (args, exec, options) => {
    await ensureInteractivePermissions(exec);
    const { bundle_id } = args as { bundle_id: string };
    assertValidBundleId(bundle_id, "bundle_id");
    await exec.openApp(bundle_id);
    setComputerUseTargetBundleId(bundle_id);
    const observation = await observeDesktop(exec, options, {
      resolvedTargetBundleId: bundle_id,
    });
    if (observation.frontmostApp?.bundleId !== bundle_id) {
      throw runtimeFailure(
        `Open application verification failed. Expected '${bundle_id}' to be frontmost, found '${observation.frontmostApp?.bundleId ?? "none"}'.`,
        {
          kind: "invalid_state",
          retryable: false,
          code: "cu_open_application_verification_failed",
          facts: {
            expectedTargetBundleId: bundle_id,
            actualFrontmostBundleId: observation.frontmostApp?.bundleId ?? null,
          },
        },
      );
    }
    return okTool({
      opened: bundle_id,
      observation_id: observation.observationId,
    });
  },
  {
    actionKind: "cu_open_application",
    interactive: false,
  },
);

const cuRequestAccessFn = cuTool(
  "Request access failed",
  async (args, exec) => {
    const { apps } = args as { apps?: unknown };
    const appList = Array.isArray(apps) ? apps : [];
    const names =
      appList.map((a: any) => a?.displayName ?? "unknown").join(", ") ||
      "requested apps";
    const permissions = await exec.getPermissionState();
    setComputerUsePermissionState(permissions);
    const blockedInteractive = describePermissionBlock(
      permissions,
      "interactive",
    );
    const blockedObserve = describePermissionBlock(permissions, "observe");
    const preferredPane = blockedInteractive?.pane ?? blockedObserve?.pane ??
      "general";
    const openedSettings = await openComputerUseSettings(preferredPane)
      .then(() => true)
      .catch(() => false);
    const exactMissing = [
      ...new Set([
        ...(blockedInteractive?.missing ?? []),
        ...(blockedObserve?.missing ?? []),
      ]),
    ];
    const exactUncertain = blockedInteractive?.uncertain ?? [];
    return okTool({
      missing: exactMissing,
      uncertain: exactUncertain,
      pane_opened: preferredPane,
      message:
        openedSettings
          ? `Opened macOS Settings for computer-use permissions. Missing: ${
            exactMissing.join(", ") || "none"
          }.${
            exactUncertain.length > 0
              ? ` Verification indeterminate: ${exactUncertain.join(", ")}.`
              : ""
          } Review access for: ${names}.`
          : `Access request noted for: ${names}. Missing: ${
            exactMissing.join(", ") || "none"
          }.${
            exactUncertain.length > 0
              ? ` Verification indeterminate: ${exactUncertain.join(", ")}.`
              : ""
          } Open macOS Settings and review the ${preferredPane.replaceAll("_", " ")} pane.`,
    });
  },
  { interactive: false },
);

const cuWaitFn = cuTool("Wait failed", async (args, exec, options) => {
  await ensureObservationPermissions(exec);
  const { duration } = args as { duration: number };
  const raw = Number(duration);
  const cappedDuration = Math.min(
    Number.isFinite(raw) ? Math.max(raw, 0) : 2,
    15,
  );
  await sleep(cappedDuration * 1000);
  const observation = await observeDesktop(exec, options);
  return observationImageResult(observation, {
    waited_seconds: cappedDuration,
  });
}, { readOnly: true });

const cuClickTargetFn = cuTool(
  "Click target failed",
  async (args, exec, options) => {
    const { observation_id, target_id } = args as {
      observation_id: string;
      target_id: string;
    };
    ensureFreshObservationAfterPromote();
    const { observation, target } = resolveObservationTarget(
      observation_id,
      target_id,
    );
    const centerX = target.bounds.x + target.bounds.width / 2;
    const centerY = target.bounds.y + target.bounds.height / 2;
    setComputerUseTargetBundleId(target.bundleId);
    const targetWindow = observation.windows.find((window) =>
      window.windowId === target.windowId
    );
    if (targetWindow) {
      setComputerUseTargetWindow(targetWindow);
    }
    const prepared = await prepareInteractiveActionWithRecovery(
      exec,
      {
        ...options,
        displayId: options?.displayId ?? targetWindow?.displayId,
      },
      true,
    );
    // Prefer native AX action when available, fall back to coordinate click
    const nativeClicked = await tryNativeTargetAction(
      "/cu/click-target",
      { observationId: observation_id, targetId: target_id },
    );
    if (!nativeClicked) {
      await exec.click(centerX, centerY, "left", 1);
    }
    const verified = await verifyPostActionObservation(exec, {
      ...options,
      displayId: options?.displayId ?? targetWindow?.displayId,
    }, prepared, "focus_sensitive");
    return okTool({
      clicked_target_id: target.targetId,
      clicked_bundle_id: target.bundleId,
      native_action: nativeClicked,
      observation_id: verified.observationId,
    });
  },
  { interactive: false, actionKind: "cu_click_target" },
);

const cuTypeIntoTargetFn = cuTool(
  "Type into target failed",
  async (args, exec, options) => {
    const { observation_id, target_id, text } = args as {
      observation_id: string;
      target_id: string;
      text: string;
    };
    ensureFreshObservationAfterPromote();
    const { observation, target } = resolveObservationTarget(
      observation_id,
      target_id,
    );
    const centerX = target.bounds.x + target.bounds.width / 2;
    const centerY = target.bounds.y + target.bounds.height / 2;
    setComputerUseTargetBundleId(target.bundleId);
    const targetWindow = observation.windows.find((window) =>
      window.windowId === target.windowId
    );
    if (targetWindow) {
      setComputerUseTargetWindow(targetWindow);
    }
    const prepared = await prepareInteractiveActionWithRecovery(
      exec,
      {
        ...options,
        displayId: options?.displayId ?? targetWindow?.displayId,
      },
      true,
    );
    // Prefer native AX focus+type when available, fall back to click+type
    const nativeTyped = await tryNativeTargetAction(
      "/cu/type-into-target",
      { observationId: observation_id, targetId: target_id, text },
    );
    if (!nativeTyped) {
      await exec.click(centerX, centerY, "left", 1);
      await sleep(75);
      await exec.type(text, { viaClipboard: true });
    }
    const verified = await verifyPostActionObservation(exec, {
      ...options,
      displayId: options?.displayId ?? targetWindow?.displayId,
    }, prepared, "focus_sensitive");
    return okTool({
      typed_into_target_id: target.targetId,
      typed: text.length > 80 ? text.slice(0, 77) + "..." : text,
      native_action: nativeTyped,
      observation_id: verified.observationId,
    });
  },
  { interactive: false, actionKind: "cu_type_into_target" },
);

// ── Read-only metadata constants ─────────────────────────────────────────

const READ_SAFE: Pick<ToolMetadata, "execution" | "presentation"> = {
  execution: { concurrencySafe: true },
  presentation: { kind: "read" },
};

// ── Tool Metadata (25 entries) ───────────────────────────────────────────

export const COMPUTER_USE_TOOLS: Record<string, ToolMetadata> = {
  cu_observe: {
    fn: cuObserveFn,
    description:
      "Capture the current desktop state plus structured metadata about displays, windows, frontmost app, and actionable targets.",
    args: {},
    category: "read",
    safetyLevel: "L1",
    safety: "Captures visible desktop content and structured metadata. No side effects.",
    ...READ_SAFE,
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.observe,
      returnDisplay: "Desktop observed",
    }),
  },

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

  cu_click_target: {
    fn: cuClickTargetFn,
    description:
      "Click the center of an actionable target returned by cu_observe. observation_id and target_id must come from the latest observation.",
    args: {
      observation_id: "string - Observation id returned by cu_observe",
      target_id: "string - Target id from observation.targets[]",
    },
    category: "write",
    safetyLevel: "L2",
    safety: "Clicks a grounded desktop target identified from the latest observation.",
    formatResult: () => ({
      summaryDisplay: RESULT_SUMMARY.click_target,
      returnDisplay: "Target clicked",
    }),
  },

  cu_type_into_target: {
    fn: cuTypeIntoTargetFn,
    description:
      "Focus a target returned by cu_observe and type text into it. observation_id and target_id must come from the latest observation.",
    args: {
      observation_id: "string - Observation id returned by cu_observe",
      target_id: "string - Target id from observation.targets[]",
      text: "string - Text to type into the target",
    },
    category: "write",
    safetyLevel: "L2",
    safety:
      "Focuses a grounded desktop target and types text with post-action verification.",
    formatResult: (result) => {
      const r = result as { typed?: string };
      return {
        summaryDisplay: RESULT_SUMMARY.type_into_target,
        returnDisplay: `Typed into target: ${r.typed ?? ""}`,
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
