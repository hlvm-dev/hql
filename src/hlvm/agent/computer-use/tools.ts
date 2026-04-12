/**
 * Computer Use — Tool Definitions (V2: CC Parity)
 *
 * 27 tools: the original Claude Code `computer_20250124`-style coordinate
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
  type ComputerUseSettingsPane,
  isComputerUseHostBundleId,
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
  CUExecutePlanFailure,
  CUExecutePlanResponse,
  CUObservedTargetRef,
  CUPlanStep,
  CUPlanTargetSelector,
  CUReadTargetKind,
  DesktopObservation,
  DisplaySelectionReason,
  WindowInfo,
} from "./types.ts";
import { createCliExecutor } from "./executor.ts";
import { getAgentLogger } from "../logger.ts";
import { getPlatform } from "../../../platform/platform.ts";
import { tryAcquireComputerUseLock } from "./lock.ts";
import { sendCuNotification, setEscapeCallback } from "./esc-hotkey.ts";
import {
  clearStaleComputerUseTargetApp,
  clearStaleComputerUseTargetWindow,
  getComputerUseSessionState,
  getComputerUseTargetBundleId,
  getComputerUseTargetWindowId,
  getLastComputerUseObservation,
  markComputerUseFailure,
  markComputerUseExplicitContextRequired,
  markComputerUseSuccess,
  COMPUTER_USE_OBSERVATION_MAX_AGE_MS,
  rememberComputerUseObservation,
  rememberHiddenComputerUseApps,
  requiresFreshComputerUseObservation,
  resolveObservationTarget,
  resolveRecentObservationTarget,
  setComputerUsePermissionState,
  setComputerUseSelectedDisplay,
  setComputerUseTargetBundleId,
  setComputerUseTargetWindow,
} from "./session-state.ts";
import {
  performNativeExecutePlan,
  performNativeReadTarget,
  performNativeTargetAction,
  resolveBackend,
} from "./bridge.ts";

// ── CC Result Summary Map (from toolRendering.tsx) ──────────────────────

const RESULT_SUMMARY: Record<string, string> = {
  observe: "Observed",
  screenshot: "Captured",
  zoom: "Captured",
  request_access: "Access updated",
  left_click: "Clicked",
  click_target: "Clicked",
  execute_plan: "Executed",
  read_target: "Read",
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

const MAX_PLAN_STEPS = 20;

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

// Module-level abort — always points to the current turn's controller.
// Updated on every CU tool call, like CC's tuc().abortController.
let _cuAbortController: AbortController | undefined;

async function guards(
  options?: ToolExecutionOptions,
): Promise<ReturnType<typeof failTool> | null> {
  const pGuard = platformGuard();
  if (pGuard) return pGuard;
  // Track the current turn's abort controller (updated every tool call)
  if (options?.abortController) {
    _cuAbortController = options.abortController;
  }
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
  if (result.fresh) {
    setEscapeCallback(() => {
      getAgentLogger().info("[cu-esc] escape abort fired");
      _cuAbortController?.abort("User pressed Escape");
    });
    sendCuNotification(
      "HLVM is using your computer. Press Escape to stop.",
    ).catch(() => {});
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

const CONTEXT_SHIFTING_SHORTCUT_MODIFIERS = new Set([
  "command",
  "cmd",
  "control",
  "ctrl",
  "option",
  "alt",
  "meta",
  "super",
]);

function requiresExplicitContextAfterShortcut(text?: string): boolean {
  const parts = parseModifiers(text)?.map((part) => part.toLowerCase()) ?? [];
  if (parts.length < 2) return false;
  return parts.some((part) => CONTEXT_SHIFTING_SHORTCUT_MODIFIERS.has(part));
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

/** Compact target roles for priority sorting — text inputs first. */
const TARGET_ROLE_PRIORITY: Record<string, number> = {
  textField: 0,
  textArea: 0,
  searchField: 0,
  comboBox: 1,
  popUpButton: 2,
  button: 3,
  menuItem: 3,
  window: 4,
};

function summarizeObservation(
  observation: DesktopObservation,
): Record<string, unknown> {
  // Prioritize text-input targets so they survive truncation.
  const MAX_TARGETS = 16;
  const sortedTargets = [...observation.targets].sort((a, b) => {
    const pa = TARGET_ROLE_PRIORITY[a.role] ?? 5;
    const pb = TARGET_ROLE_PRIORITY[b.role] ?? 5;
    return pa - pb || (b.confidence - a.confidence);
  }).slice(0, MAX_TARGETS);

  return {
    observation_id: observation.observationId,
    screen: {
      width: observation.display.width,
      height: observation.display.height,
    },
    frontmost_app: observation.frontmostApp
      ? {
        bundleId: observation.frontmostApp.bundleId,
        displayName: observation.frontmostApp.displayName,
      }
      : null,
    windows: observation.windows.slice(0, 8).map((window) => ({
      window_id: window.windowId,
      bundleId: window.bundleId ?? null,
      title: window.title ?? null,
      bounds: window.bounds,
    })),
    targets: sortedTargets.map((target) => ({
      target_id: target.targetId,
      kind: target.kind,
      label: target.label,
      role: target.role,
      bundle_id: target.bundleId,
      bounds: target.bounds,
    })),
    grounding_source: observation.groundingSource,
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

function buildObservationLlmContent(result: Record<string, unknown>): string {
  const targets = Array.isArray(result.targets) ? result.targets : [];
  const windows = Array.isArray(result.windows) ? result.windows : [];
  const front = result.frontmost_app as
    | { bundleId?: string; displayName?: string }
    | null;
  const lines: string[] = [
    `observation_id: ${result.observation_id}`,
  ];
  if (front) {
    lines.push(
      `frontmost: ${front.displayName ?? ""} (${front.bundleId ?? ""})`,
    );
  }
  if (windows.length > 0) {
    lines.push("windows:");
    for (const w of windows.slice(0, 6)) {
      const wRec = w as Record<string, unknown>;
      lines.push(
        `  - id:${wRec.window_id} ${wRec.title ?? wRec.bundleId ?? ""}`,
      );
    }
  }
  if (targets.length > 0) {
    lines.push(
      "targets (use exact target_id with cu_click_target / cu_type_into_target):",
    );
    for (const t of targets) {
      const tRec = t as Record<string, unknown>;
      const b = tRec.bounds as Record<string, unknown> | undefined;
      const boundsStr = b ? `[${b.x},${b.y},${b.width},${b.height}]` : "";
      const appHint = tRec.bundle_id ? `  app:${tRec.bundle_id}` : "";
      lines.push(
        `  - target_id: ${tRec.target_id}  role:${tRec.role}  label:"${
          tRec.label ?? ""
        }"${appHint}  ${boundsStr}`,
      );
    }
  } else {
    lines.push("targets: (none — use coordinate-based tools instead)");
  }
  lines.push(`grounding: ${result.grounding_source ?? "unknown"}`);
  return lines.join("\n");
}

function formatObservationResult(
  result: Record<string, unknown> | null,
  summaryDisplay: string,
  returnDisplay: string,
  extraLines: string[] = [],
) {
  if (!result || typeof result !== "object" || !result.observation_id) {
    return {
      summaryDisplay,
      returnDisplay,
    };
  }
  const lines = [
    ...extraLines.filter((line) => line.trim().length > 0),
    buildObservationLlmContent(result),
  ];
  return {
    summaryDisplay,
    returnDisplay,
    llmContent: lines.join("\n"),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : undefined;
}

function asRecordLoose(value: unknown): Record<string, unknown> | undefined {
  const direct = asRecord(value);
  if (direct) return direct;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function ensureStringArray(
  value: unknown,
  field: string,
): string[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        value = parsed;
      }
    } catch {
      // fall through to validation below
    }
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must be a non-empty string array`);
  }
  const items = value.map((entry) =>
    typeof entry === "string" ? entry.trim() : ""
  );
  if (items.some((entry) => entry.length === 0)) {
    throw new Error(`${field} entries must be non-empty strings`);
  }
  return items;
}

function parsePlanSelector(
  raw: unknown,
): CUPlanTargetSelector {
  const selector = asRecordLoose(raw);
  if (!selector) {
    throw new Error("find_target.selector must be an object");
  }
  const bundleId = selector.bundle_id;
  const roleIn = selector.role_in;
  const parsed: CUPlanTargetSelector = {
    role_in: ensureStringArray(roleIn, "find_target.selector.role_in"),
  };
  if (bundleId != null) {
    if (!isNonEmptyString(bundleId)) {
      throw new Error(
        "find_target.selector.bundle_id must be a non-empty string",
      );
    }
    assertValidBundleId(bundleId, "find_target.selector.bundle_id");
    parsed.bundle_id = bundleId;
  }
  if (selector.window_title_contains != null) {
    if (!isNonEmptyString(selector.window_title_contains)) {
      throw new Error(
        "find_target.selector.window_title_contains must be a non-empty string",
      );
    }
    parsed.window_title_contains = selector.window_title_contains;
  }
  if (selector.label_contains != null) {
    if (!isNonEmptyString(selector.label_contains)) {
      throw new Error(
        "find_target.selector.label_contains must be a non-empty string",
      );
    }
    parsed.label_contains = selector.label_contains;
  }
  if (selector.value_contains != null) {
    if (!isNonEmptyString(selector.value_contains)) {
      throw new Error(
        "find_target.selector.value_contains must be a non-empty string",
      );
    }
    parsed.value_contains = selector.value_contains;
  }
  if (selector.index != null) {
    const index = Number(selector.index);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(
        "find_target.selector.index must be a non-negative integer",
      );
    }
    parsed.index = index;
  }
  return parsed;
}

function parseObservedTargetRef(
  raw: unknown,
): CUObservedTargetRef {
  const ref = asRecordLoose(raw);
  if (!ref) {
    throw new Error("find_target.observed_target must be an object");
  }
  const observationId = ref.observation_id;
  const targetId = ref.target_id;
  if (!isNonEmptyString(observationId)) {
    throw new Error(
      "find_target.observed_target.observation_id must be a non-empty string",
    );
  }
  if (!isNonEmptyString(targetId)) {
    throw new Error(
      "find_target.observed_target.target_id must be a non-empty string",
    );
  }
  resolveObservationTarget(observationId, targetId);
  return {
    observation_id: observationId,
    target_id: targetId,
  };
}

function parseReadTargetKind(raw: unknown): CUReadTargetKind {
  if (raw === "value" || raw === "enabled") {
    return raw;
  }
  throw new Error("read_kind must be 'value' or 'enabled'");
}

function parseExecutePlanArgs(args: unknown): {
  steps: CUPlanStep[];
  displayId?: number;
} {
  const DEFAULT_PLAN_WAIT_TIMEOUT_MS = 10_000;
  const input = asRecordLoose(args);
  if (!input) {
    throw new Error("Arguments must be an object");
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new Error("'steps' must be a non-empty array");
  }
  if (input.steps.length > MAX_PLAN_STEPS) {
    throw new Error(`'steps' may contain at most ${MAX_PLAN_STEPS} items`);
  }
  const rawSteps = input.steps as unknown[];
  const seenIds = new Set<string>();
  const assertKnownTargetRef = (targetRef: string, index: number) => {
    if (!seenIds.has(targetRef)) {
      throw new Error(
        `steps[${index}].target_ref must reference a prior find_target id`,
      );
    }
  };
  const steps = rawSteps.map((rawStep, index) => {
    const step = asRecordLoose(rawStep);
    if (!step) {
      throw new Error(`steps[${index}] must be an object`);
    }
    const op = step.op;
    if (!isNonEmptyString(op)) {
      throw new Error(`steps[${index}].op must be a non-empty string`);
    }
    switch (op) {
      case "open_app": {
        const bundleId = step.bundle_id;
        if (!isNonEmptyString(bundleId)) {
          throw new Error(
            `steps[${index}].bundle_id must be a non-empty string`,
          );
        }
        assertValidBundleId(bundleId, `steps[${index}].bundle_id`);
        return { op, bundle_id: bundleId } satisfies CUPlanStep;
      }
      case "wait_for_ready": {
        const bundleId = step.bundle_id;
        const targetRef = step.target_ref;
        const nextStep = asRecordLoose(rawSteps[index + 1]);
        const allowsImplicitSurfaceWait = nextStep?.op === "find_target";
        if (!isNonEmptyString(bundleId) && !isNonEmptyString(targetRef)) {
          if (!allowsImplicitSurfaceWait) {
            throw new Error(
              `steps[${index}] must specify bundle_id or target_ref for wait_for_ready unless the next step is find_target`,
            );
          }
        }
        if (isNonEmptyString(bundleId)) {
          assertValidBundleId(bundleId, `steps[${index}].bundle_id`);
        }
        if (targetRef != null && !isNonEmptyString(targetRef)) {
          throw new Error(
            `steps[${index}].target_ref must be a non-empty string`,
          );
        }
        if (isNonEmptyString(targetRef)) {
          assertKnownTargetRef(targetRef, index);
        }
        const timeout = step.timeout_ms != null
          ? Number(step.timeout_ms)
          : DEFAULT_PLAN_WAIT_TIMEOUT_MS;
        if (
          timeout != null &&
          (!Number.isFinite(timeout) || timeout <= 0)
        ) {
          throw new Error(
            `steps[${index}].timeout_ms must be a positive number`,
          );
        }
        return {
          op,
          ...(isNonEmptyString(bundleId) ? { bundle_id: bundleId } : {}),
          ...(isNonEmptyString(targetRef) ? { target_ref: targetRef } : {}),
          ...(timeout != null ? { timeout_ms: timeout } : {}),
        } satisfies CUPlanStep;
      }
      case "find_target": {
        const id = step.id;
        if (!isNonEmptyString(id)) {
          throw new Error(`steps[${index}].id must be a non-empty string`);
        }
        if (seenIds.has(id)) {
          throw new Error(`Duplicate step id '${id}'`);
        }
        seenIds.add(id);
        const hasSelector = step.selector != null;
        const hasObservedTarget = step.observed_target != null;
        if (hasSelector === hasObservedTarget) {
          throw new Error(
            `steps[${index}] must specify exactly one of selector or observed_target`,
          );
        }
        if (hasObservedTarget) {
          return {
            op,
            id,
            observed_target: parseObservedTargetRef(step.observed_target),
          } satisfies CUPlanStep;
        }
        return {
          op,
          id,
          selector: parsePlanSelector(step.selector),
        } satisfies CUPlanStep;
      }
      case "click": {
        const targetRef = step.target_ref;
        if (!isNonEmptyString(targetRef)) {
          throw new Error(
            `steps[${index}].target_ref must be a non-empty string`,
          );
        }
        assertKnownTargetRef(targetRef, index);
        return { op, target_ref: targetRef } satisfies CUPlanStep;
      }
      case "type_into": {
        const targetRef = step.target_ref;
        const text = step.text;
        if (!isNonEmptyString(targetRef)) {
          throw new Error(
            `steps[${index}].target_ref must be a non-empty string`,
          );
        }
        assertKnownTargetRef(targetRef, index);
        if (typeof text !== "string") {
          throw new Error(`steps[${index}].text must be a string`);
        }
        return { op, target_ref: targetRef, text } satisfies CUPlanStep;
      }
      case "press_keys": {
        const keys = step.keys;
        if (!isNonEmptyString(keys)) {
          throw new Error(`steps[${index}].keys must be a non-empty string`);
        }
        const repeat = step.repeat != null ? Number(step.repeat) : undefined;
        if (
          repeat != null &&
          (!Number.isInteger(repeat) || repeat <= 0)
        ) {
          throw new Error(`steps[${index}].repeat must be a positive integer`);
        }
        return {
          op,
          keys,
          ...(repeat != null ? { repeat } : {}),
        } satisfies CUPlanStep;
      }
      case "verify": {
        const predicate = step.predicate;
        if (!isNonEmptyString(predicate)) {
          throw new Error(
            `steps[${index}].predicate must be a non-empty string`,
          );
        }
        const allowed = new Set([
          "frontmost_app_is",
          "window_visible",
          "target_exists",
          "target_value_contains",
          "target_enabled",
        ]);
        if (!allowed.has(predicate)) {
          throw new Error(`Unsupported verify predicate '${predicate}'`);
        }
        const parsed: Extract<CUPlanStep, { op: "verify" }> = {
          op,
          predicate: predicate as Extract<
            CUPlanStep,
            { op: "verify" }
          >["predicate"],
        };
        if (step.bundle_id != null) {
          if (!isNonEmptyString(step.bundle_id)) {
            throw new Error(
              `steps[${index}].bundle_id must be a non-empty string`,
            );
          }
          assertValidBundleId(step.bundle_id, `steps[${index}].bundle_id`);
          parsed.bundle_id = step.bundle_id;
        }
        if (step.window_title_contains != null) {
          if (!isNonEmptyString(step.window_title_contains)) {
            throw new Error(
              `steps[${index}].window_title_contains must be a non-empty string`,
            );
          }
          parsed.window_title_contains = step.window_title_contains;
        }
        if (step.target_ref != null) {
          if (!isNonEmptyString(step.target_ref)) {
            throw new Error(
              `steps[${index}].target_ref must be a non-empty string`,
            );
          }
          assertKnownTargetRef(step.target_ref, index);
          parsed.target_ref = step.target_ref;
        }
        if (step.value_contains != null) {
          if (!isNonEmptyString(step.value_contains)) {
            throw new Error(
              `steps[${index}].value_contains must be a non-empty string`,
            );
          }
          parsed.value_contains = step.value_contains;
        }
        if (step.enabled != null) {
          if (typeof step.enabled !== "boolean") {
            throw new Error(`steps[${index}].enabled must be a boolean`);
          }
          parsed.enabled = step.enabled;
        }
        switch (parsed.predicate) {
          case "frontmost_app_is":
            if (!parsed.bundle_id) {
              throw new Error(
                `steps[${index}].bundle_id is required for frontmost_app_is`,
              );
            }
            break;
          case "window_visible":
            if (!parsed.bundle_id) {
              throw new Error(
                `steps[${index}].bundle_id is required for window_visible`,
              );
            }
            break;
          case "target_exists":
          case "target_enabled":
            if (!parsed.target_ref) {
              throw new Error(
                `steps[${index}].target_ref is required for ${parsed.predicate}`,
              );
            }
            break;
          case "target_value_contains":
            if (!parsed.target_ref || !parsed.value_contains) {
              throw new Error(
                `steps[${index}] requires target_ref and value_contains for target_value_contains`,
              );
            }
            break;
        }
        return parsed satisfies CUPlanStep;
      }
      default:
        throw new Error(`Unsupported step op '${op}' at steps[${index}]`);
    }
  });

  const displayId = input.display_id != null
    ? Number(input.display_id)
    : undefined;
  if (
    displayId != null &&
    (!Number.isInteger(displayId) || displayId <= 0)
  ) {
    throw new Error("'display_id' must be a positive integer");
  }
  return { steps, displayId };
}

// ── Plan Normalizer ──────────────────────────────────────────────────────
//
// Canonicalize model-authored plans before native execution.
// Pure function: no side effects, no I/O.

/** Common role aliases the model might use → canonical AX roles. */
const ROLE_ALIAS_MAP: Record<string, string> = {
  text: "textField",
  textarea: "textArea",
  textfield: "textField",
  text_area: "textArea",
  text_field: "textField",
  button: "button",
  checkbox: "checkBox",
  check_box: "checkBox",
};

function normalizeRole(role: string): string {
  return ROLE_ALIAS_MAP[role.toLowerCase()] ?? role;
}

function normalizePlanSteps(steps: CUPlanStep[]): CUPlanStep[] {
  const normalized: CUPlanStep[] = [];
  let lastOpenedBundleId: string | undefined;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const next = steps[i + 1];

    switch (step.op) {
      case "open_app": {
        normalized.push(step);
        lastOpenedBundleId = step.bundle_id;
        // Insert wait_for_ready if the model forgot it after open_app
        if (!next || next.op !== "wait_for_ready") {
          normalized.push({
            op: "wait_for_ready",
            bundle_id: step.bundle_id,
          });
        }
        break;
      }
      case "wait_for_ready": {
        // Fill in bundle_id from the last open_app if missing
        if (!step.bundle_id && !step.target_ref && lastOpenedBundleId) {
          normalized.push({
            ...step,
            bundle_id: lastOpenedBundleId,
          });
        } else {
          normalized.push(step);
        }
        break;
      }
      case "find_target": {
        if (step.selector) {
          const normalizedRoles = step.selector.role_in.map(normalizeRole);
          const uniqueRoles = [...new Set(normalizedRoles)];
          normalized.push({
            ...step,
            selector: {
              ...step.selector,
              bundle_id: step.selector.bundle_id ||
                lastOpenedBundleId ||
                step.selector.bundle_id,
              role_in: uniqueRoles,
            },
          });
        } else {
          normalized.push(step);
        }
        break;
      }
      default:
        normalized.push(step);
        break;
    }
  }

  return normalized;
}

function formatExecutePlanSteps(
  records: readonly {
    index?: number;
    op?: string;
    status?: string;
    stepId?: string;
    message?: string;
  }[],
): string[] {
  if (records.length === 0) return [];
  const lines = ["plan_steps:"];
  for (const record of records) {
    const index = record.index ?? 0;
    const op = record.op ?? "unknown";
    const status = record.status ?? "unknown";
    const suffix = record.stepId ? ` id:${record.stepId}` : "";
    const message = record.message ? ` ${record.message}` : "";
    lines.push(`  - [${index}] ${status} ${op}${suffix}${message}`);
  }
  return lines;
}

function formatExecutePlanFailureFacts(
  failure: Record<string, unknown> | undefined,
): string[] {
  const facts = asRecord(failure?.facts);
  if (!facts) return [];
  const lines = ["failure_facts:"];
  const candidates = Array.isArray(facts.candidates)
    ? facts.candidates.filter((value): value is string => typeof value === "string")
    : [];
  for (const [key, value] of Object.entries(facts)) {
    if (key === "candidates" || value == null) continue;
    lines.push(`  - ${key}: ${String(value)}`);
  }
  if (candidates.length > 0) {
    lines.push("candidate_indexes:");
    for (const candidate of candidates) {
      lines.push(`  - ${candidate}`);
    }
  }
  return lines;
}

function buildExecutePlanFailureResult(
  failure: CUExecutePlanFailure | undefined,
  steps: CUExecutePlanResponse["steps"],
  observation?: DesktopObservation,
) {
  const message = failure?.message ?? "Execute plan failed.";
  const result = failTool(message, {
    failure: buildToolFailureMetadata(message, {
      source: "runtime",
      kind: failure?.code === "cu_execute_plan_unsupported"
        ? "unsupported"
        : "invalid_state",
      retryable: failure?.retryable ?? false,
      code: failure?.code,
      facts: failure?.facts,
    }),
    execution_status: "blocked",
    plan_steps: steps,
    blocked_step_index: failure?.stepIndex,
    blocked_step_op: failure?.stepOp,
  });
  if (!observation) return result;
  return {
    ...result,
    ...summarizeObservation(observation),
    _imageAttachment: {
      data: observation.screenshot.base64,
      mimeType: "image/jpeg",
      width: observation.screenshot.width,
      height: observation.screenshot.height,
    },
  };
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
  if (
    mode === "interactive" && missing.length === 0 && uncertain.length === 0
  ) {
    return null;
  }

  const pane: ComputerUseSettingsPane = missing.includes("Accessibility")
    ? "accessibility"
    : missing.includes("Screen Recording") ||
        uncertain.includes("Screen Recording")
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
    const matches = await exec.findWindowDisplays([targetBundleId]).catch(
      () => [],
    );
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
    const matches = await exec.findWindowDisplays([frontmost.bundleId]).catch(
      () => [],
    );
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
  rememberedTargetBundleId = getComputerUseTargetBundleId(),
  rememberedTargetWindowId = getComputerUseTargetWindowId(),
): Promise<{
  allowlist: string[];
  rememberedTargetBundleId?: string;
  rememberedTargetWindowId?: number;
  expectedTargetBundleId?: string;
  expectedTargetWindowId?: number;
  lostRememberedTargetBundleId?: string;
  lostRememberedTargetWindowId?: number;
  actualFrontmostBundleId?: string;
}> {
  const runningApps = await exec.listRunningApps().catch(() => []);
  const runningBundleIds = runningApps.map((app) => app.bundleId);
  const lostRememberedTargetBundleId = rememberedTargetBundleId &&
      !runningBundleIds.includes(rememberedTargetBundleId)
    ? rememberedTargetBundleId
    : undefined;
  clearStaleComputerUseTargetApp(runningBundleIds);

  const windows = visibleWindows ? [...visibleWindows] : await exec
    .listVisibleWindows()
    .catch(() => []);
  const lostRememberedTargetWindowId = rememberedTargetWindowId != null &&
      !windows.some((window) => window.windowId === rememberedTargetWindowId)
    ? rememberedTargetWindowId
    : undefined;
  clearStaleComputerUseTargetWindow(windows);

  const targetWindowId = getComputerUseTargetWindowId();
  if (targetWindowId != null) {
    const targetWindow = windows.find((window) =>
      window.windowId === targetWindowId
    );
    if (targetWindow?.bundleId) {
      return {
        allowlist: [targetWindow.bundleId],
        rememberedTargetBundleId,
        rememberedTargetWindowId,
        expectedTargetBundleId: targetWindow.bundleId,
        expectedTargetWindowId: targetWindow.windowId,
        lostRememberedTargetBundleId,
        lostRememberedTargetWindowId,
      };
    }
  }

  const remembered = getComputerUseTargetBundleId();
  if (remembered && runningApps.some((app) => app.bundleId === remembered)) {
    return {
      allowlist: [remembered],
      rememberedTargetBundleId,
      rememberedTargetWindowId,
      expectedTargetBundleId: remembered,
      lostRememberedTargetBundleId,
      lostRememberedTargetWindowId,
    };
  }

  const frontmost = await exec.getFrontmostApp().catch(() => null);
  if (frontmost?.bundleId && !isComputerUseHostBundleId(frontmost.bundleId)) {
    return {
      allowlist: [frontmost.bundleId],
      rememberedTargetBundleId,
      rememberedTargetWindowId,
      expectedTargetBundleId: frontmost.bundleId,
      lostRememberedTargetBundleId,
      lostRememberedTargetWindowId,
      actualFrontmostBundleId: frontmost.bundleId,
    };
  }

  return {
    allowlist: [],
    rememberedTargetBundleId,
    rememberedTargetWindowId,
    lostRememberedTargetBundleId,
    lostRememberedTargetWindowId,
    actualFrontmostBundleId: frontmost?.bundleId,
  };
}

function failForLostTargetContext(target: {
  lostRememberedTargetBundleId?: string;
  lostRememberedTargetWindowId?: number;
  actualFrontmostBundleId?: string;
}): never {
  if (target.lostRememberedTargetBundleId) {
    throw runtimeFailure(
      `Target app '${target.lostRememberedTargetBundleId}' is no longer running. Stop and re-establish the target before sending keyboard input.`,
      {
        kind: "invalid_state",
        retryable: false,
        code: "cu_target_app_lost",
        facts: {
          expectedTargetBundleId: target.lostRememberedTargetBundleId,
          actualFrontmostBundleId: target.actualFrontmostBundleId ?? null,
        },
      },
    );
  }
  if (target.lostRememberedTargetWindowId != null) {
    throw runtimeFailure(
      `Target window '${target.lostRememberedTargetWindowId}' is no longer visible. Stop and re-establish the target before sending keyboard input.`,
      {
        kind: "invalid_state",
        retryable: false,
        code: "cu_target_window_lost",
        facts: {
          expectedTargetWindowId: target.lostRememberedTargetWindowId,
          actualFrontmostBundleId: target.actualFrontmostBundleId ?? null,
        },
      },
    );
  }
  throw runtimeFailure("Target context is no longer valid.", {
    kind: "invalid_state",
    retryable: false,
    code: "cu_target_context_changed",
  });
}

async function verifyFrontmostApp(
  exec: ComputerExecutor,
  expectedTargetBundleId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const frontmost = await exec.getFrontmostApp().catch(() => null);
    if (frontmost?.bundleId === expectedTargetBundleId) {
      setComputerUseTargetBundleId(
        frontmost.bundleId,
        frontmost.displayName,
        "prepare_for_action",
      );
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
  enforceTargetContextContinuity: false | "app" | "app_and_window" = false,
): Promise<PreparedActionContext> {
  ensureFreshObservationAfterPromote();
  await ensureInteractivePermissions(exec);
  const rememberedTargetBundleId = getComputerUseTargetBundleId();
  const rememberedTargetWindowId = getComputerUseTargetWindowId();
  const displayChoice = await resolveDisplayChoice(exec, options?.displayId);
  const target = await resolvePrepareAllowlist(
    exec,
    displayChoice.visibleWindows,
    rememberedTargetBundleId,
    rememberedTargetWindowId,
  );
  if (enforceTargetContextContinuity) {
    // App lost → always fail (both "app" and "app_and_window" modes)
    if (target.lostRememberedTargetBundleId) {
      failForLostTargetContext(target);
    }
    // Window lost → only fail in "app_and_window" mode (cu_type).
    // In "app" mode (cu_key), tolerate window changes — keys go to the
    // frontmost window of the correct app regardless of window ID.
    if (
      enforceTargetContextContinuity === "app_and_window" &&
      target.lostRememberedTargetWindowId != null
    ) {
      failForLostTargetContext(target);
    }
  }
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
  if (
    enforceTargetContextContinuity &&
    target.rememberedTargetWindowId != null
  ) {
    // App-level continuity: always enforced when continuity is requested
    if (expectedTargetBundleId !== target.rememberedTargetBundleId) {
      throw runtimeFailure(
        "Target context changed to a different app before keyboard input. Re-establish the intended window explicitly.",
        {
          kind: "invalid_state",
          retryable: false,
          code: "cu_target_context_changed",
          facts: {
            expectedTargetBundleId: target.rememberedTargetBundleId ?? null,
            expectedTargetWindowId: target.rememberedTargetWindowId,
            actualTargetBundleId: expectedTargetBundleId ?? null,
            actualTargetWindowId: expectedTargetWindowId ?? null,
          },
        },
      );
    }
    // Window-level continuity: only in "app_and_window" mode (cu_type).
    // cu_key uses "app" mode — keys go to whichever window is focused
    // in the correct app, so window ID drift is tolerated.
    if (enforceTargetContextContinuity === "app_and_window") {
      if (expectedTargetWindowId == null) {
        throw runtimeFailure(
          "Target window continuity could not be preserved before keyboard input. Re-establish the intended window explicitly.",
          {
            kind: "invalid_state",
            retryable: false,
            code: "cu_target_context_changed",
            facts: {
              expectedTargetBundleId: target.rememberedTargetBundleId ?? null,
              expectedTargetWindowId: target.rememberedTargetWindowId,
              actualTargetBundleId: expectedTargetBundleId ?? null,
              actualTargetWindowId: null,
            },
          },
        );
      }
      if (expectedTargetWindowId !== target.rememberedTargetWindowId) {
        throw runtimeFailure(
          "Target context changed to a different window before keyboard input. Re-establish the intended window explicitly.",
          {
            kind: "invalid_state",
            retryable: false,
            code: "cu_target_context_changed",
            facts: {
              expectedTargetBundleId: target.rememberedTargetBundleId ?? null,
              expectedTargetWindowId: target.rememberedTargetWindowId,
              actualTargetBundleId: expectedTargetBundleId ?? null,
              actualTargetWindowId: expectedTargetWindowId,
            },
          },
        );
      }
    }
  }
  if (expectedTargetBundleId) {
    setComputerUseTargetBundleId(
      expectedTargetBundleId,
      undefined,
      "prepare_for_action",
    );
  }
  if (expectedTargetWindowId != null) {
    const visibleWindows = displayChoice.visibleWindows
      ? [...displayChoice.visibleWindows]
      : await exec.listVisibleWindows().catch(() => []);
    const targetWindow = visibleWindows.find((window) =>
      window.windowId === expectedTargetWindowId
    );
    setComputerUseTargetWindow(targetWindow ?? null, "prepare_for_action");
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
  enforceTargetContextContinuity: false | "app" | "app_and_window" = false,
): Promise<PreparedActionContext> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prepareInteractiveAction(
        exec,
        options,
        requireTargetApp,
        enforceTargetContextContinuity,
      );
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
        `Post-action verification failed. Expected frontmost app '${prepared.expectedTargetBundleId}', found '${
          actualFrontmostBundleId ?? "none"
        }'.`,
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
    postActionVerify?:
      | "generic"
      | "focus_sensitive"
      | false
      | ((args: unknown) => "generic" | "focus_sensitive" | false);
    enforceTargetContextContinuity?: false | "app" | "app_and_window";
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
    const interactive = !opts?.readOnly && opts?.interactive !== false;

    try {
      // Phase 1: Prepare — can be retried safely (no side effects).
      let prepared: PreparedActionContext = {};
      if (interactive) {
        try {
          prepared = await prepareInteractiveActionWithRecovery(
            exec,
            options,
            opts?.requireTargetApp,
            opts?.enforceTargetContextContinuity,
          );
        } catch (prepareError) {
          // Bounded local recovery: if preparation failed with a retryable
          // error, refocus the target app, take a fresh observation, and
          // retry preparation once. Safe because preparation has no side
          // effects — it only reads state and activates the target app.
          const prepFailure = getFailureMetadata(prepareError);
          if (prepFailure?.retryable) {
            const targetBundleId = getComputerUseTargetBundleId();
            if (targetBundleId) {
              await exec.openApp(targetBundleId).catch(() => {});
            }
            await sleep(300);
            await observeDesktop(exec, options).catch(() => {});
            prepared = await prepareInteractiveActionWithRecovery(
              exec,
              options,
              opts?.requireTargetApp,
              opts?.enforceTargetContextContinuity,
            );
          } else {
            throw prepareError;
          }
        }
      }
      // Phase 2: Execute — NOT retried (may have side effects like typing).
      const result = await fn(args, exec, options);
      // Phase 3: Verify — post-action observation check.
      const configuredVerificationMode = typeof opts?.postActionVerify ===
          "function"
        ? opts.postActionVerify(args)
        : opts?.postActionVerify;
      const verificationMode = interactive
        ? configuredVerificationMode ?? "generic"
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
      // If we have a verified post-action observation and the tool returned
      // a plain result (not already an observation), upgrade it to include
      // the observation data. This lets the model see the updated desktop
      // state immediately without a redundant cu_observe turn.
      if (
        verifiedObservation &&
        result != null &&
        typeof result === "object" &&
        !("_imageAttachment" in (result as Record<string, unknown>))
      ) {
        const toolData = result as Record<string, unknown>;
        return observationImageResult(verifiedObservation, toolData);
      }
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
      // Coordinate clicks often legitimately change focus/frontmost app, so
      // the generic post-action verification creates false negatives here.
      postActionVerify: false,
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
    await ensureObservationPermissions(exec);
    const displayChoice = await resolveDisplayChoice(exec, options?.displayId);
    const screenshot = await exec.screenshot({
      allowedBundleIds: [],
      displayId: displayChoice.displayId,
    });
    return imageResult(
      { width: screenshot.width, height: screenshot.height },
      screenshot,
    );
  },
  { readOnly: true },
);

const cuObserveFn = cuTool(
  "Observe failed",
  async (_args, exec, options) => {
    // When a prior tool (execute_plan, open_application, target_action)
    // established an explicit target app, scope native target enumeration
    // to that app. This ensures that after a blocked execute-plan, the next
    // observation returns targets for the app the model was working with.
    // Passive observation context is NOT used — the model may have moved on.
    const state = getComputerUseSessionState();
    const explicitBundleId = state.targetApp?.source !== "passive_observation"
      ? state.targetApp?.bundleId
      : undefined;
    const observation = await observeDesktop(exec, options, explicitBundleId
      ? { resolvedTargetBundleId: explicitBundleId }
      : undefined);
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
  enforceTargetContextContinuity: "app_and_window",
});

const cuKeyFn = cuTool("Key press failed", async (args, exec) => {
  const { text, repeat } = args as { text: string; repeat?: number };
  const rpt = repeat != null ? (Number(repeat) || 1) : undefined;
  await exec.key(text, rpt);
  if (requiresExplicitContextAfterShortcut(text)) {
    markComputerUseExplicitContextRequired();
  }
  return okTool({ pressed: text, repeat: rpt ?? 1 });
}, {
  actionKind: "cu_key",
  requireTargetApp: true,
  postActionVerify: (args) =>
    requiresExplicitContextAfterShortcut((args as { text?: string }).text)
      ? false
      : "focus_sensitive",
  // App-level continuity only — keys go to whichever window is focused
  // in the correct app. Window ID drift is tolerated for key presses.
  enforceTargetContextContinuity: "app",
});

const cuHoldKeyFn = cuTool("Hold key failed", async (args, exec) => {
  const { text, duration } = args as { text: string; duration: number };
  const raw = Number(duration);
  const dur = Number.isFinite(raw) ? Math.max(raw, 0) : 1;
  await exec.holdKey([text], dur * 1000);
  if (requiresExplicitContextAfterShortcut(text)) {
    markComputerUseExplicitContextRequired();
  }
  return okTool({ held: text, duration_seconds: dur });
}, {
  actionKind: "cu_hold_key",
  requireTargetApp: true,
  postActionVerify: (args) =>
    requiresExplicitContextAfterShortcut((args as { text?: string }).text)
      ? false
      : "focus_sensitive",
  enforceTargetContextContinuity: "app",
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
  // Drag is coordinate-based and may legitimately cross app boundaries or let
  // another app become frontmost mid-gesture. Requiring generic frontmost-app
  // verification after the drag creates false failures unrelated to whether
  // the drag itself succeeded.
  postActionVerify: false,
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
    setComputerUseTargetBundleId(bundle_id, undefined, "open_application");
    const observation = await observeDesktop(exec, options, {
      resolvedTargetBundleId: bundle_id,
    });
    if (observation.frontmostApp?.bundleId !== bundle_id) {
      throw runtimeFailure(
        `Open application verification failed. Expected '${bundle_id}' to be frontmost, found '${
          observation.frontmostApp?.bundleId ?? "none"
        }'.`,
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
    // Return the full post-open observation so the model can see targets
    // immediately — avoids a redundant cu_observe turn after opening.
    return observationImageResult(observation, {
      opened: bundle_id,
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
      message: openedSettings
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
        } Open macOS Settings and review the ${
          preferredPane.replaceAll("_", " ")
        } pane.`,
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

// ── Shared target action setup (DRY: click_target + type_into_target) ───

async function resolveTargetActionContext(
  observationId: string,
  targetId: string,
  exec: ComputerExecutor,
  options?: ToolExecutionOptions,
) {
  ensureFreshObservationAfterPromote();
  const { observation, target } = resolveObservationTarget(
    observationId,
    targetId,
  );
  const centerX = target.bounds.x + target.bounds.width / 2;
  const centerY = target.bounds.y + target.bounds.height / 2;
  setComputerUseTargetBundleId(target.bundleId, undefined, "target_action");
  const targetWindow = observation.windows.find((w) =>
    w.windowId === target.windowId
  );
  if (targetWindow) {
    setComputerUseTargetWindow(targetWindow, "target_action");
  }
  const scopedOptions = {
    ...options,
    displayId: options?.displayId ?? targetWindow?.displayId,
  };
  const prepared = await prepareInteractiveActionWithRecovery(
    exec,
    scopedOptions,
    true,
  );
  return { observation, target, centerX, centerY, targetWindow, scopedOptions, prepared };
}

async function verifyAndReturnObservation(
  exec: ComputerExecutor,
  scopedOptions: ToolExecutionOptions,
  prepared: PreparedActionContext,
  actionData: Record<string, unknown>,
): Promise<unknown> {
  const verified = await verifyPostActionObservation(
    exec,
    scopedOptions,
    prepared,
    "focus_sensitive",
  );
  return observationImageResult(verified, actionData);
}

const cuReadTargetFn = cuTool(
  "Read target failed",
  async (args) => {
    const {
      observation_id,
      target_id,
      read_kind: rawReadKind,
    } = args as {
      observation_id: string;
      target_id: string;
      read_kind: unknown;
    };
    const read_kind = parseReadTargetKind(rawReadKind);
    resolveRecentObservationTarget(observation_id, target_id);
    const response = await performNativeReadTarget({
      observationId: observation_id,
      targetId: target_id,
      readKind: read_kind,
    });
    if (!response) {
      throw runtimeFailure(
        "Native grounded target read is unavailable on this machine.",
        {
          kind: "unsupported",
          retryable: false,
          code: "cu_read_target_unsupported",
        },
      );
    }
    if (!response.ok) {
      throw runtimeFailure(
        response.message ?? "Grounded target read failed.",
        {
          retryable: false,
          code: response.code ?? "cu_read_target_failed",
          facts: {
            targetId: response.targetId,
            readKind: response.readKind,
          },
        },
      );
    }
    return {
      target_id: response.targetId,
      read_kind: response.readKind,
      value: response.value ?? null,
    };
  },
  { readOnly: true, interactive: false },
);

const cuClickTargetFn = cuTool(
  "Click target failed",
  async (args, exec, options) => {
    const { observation_id, target_id } = args as {
      observation_id: string;
      target_id: string;
    };
    const ctx = await resolveTargetActionContext(
      observation_id,
      target_id,
      exec,
      options,
    );
    const nativeClicked = await performNativeTargetAction(
      "click-target",
      { observationId: observation_id, targetId: target_id },
    );
    if (!nativeClicked) {
      await exec.click(ctx.centerX, ctx.centerY, "left", 1);
    }
    return verifyAndReturnObservation(exec, ctx.scopedOptions, ctx.prepared, {
      clicked_target_id: ctx.target.targetId,
      clicked_bundle_id: ctx.target.bundleId,
      native_action: nativeClicked,
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
    const ctx = await resolveTargetActionContext(
      observation_id,
      target_id,
      exec,
      options,
    );
    const nativeTyped = await performNativeTargetAction(
      "type-into-target",
      { observationId: observation_id, targetId: target_id, text },
    );
    if (!nativeTyped) {
      await exec.click(ctx.centerX, ctx.centerY, "left", 1);
      await sleep(75);
      await exec.type(text, { viaClipboard: true });
    }
    return verifyAndReturnObservation(exec, ctx.scopedOptions, ctx.prepared, {
      typed_into_target_id: ctx.target.targetId,
      typed: text.length > 80 ? text.slice(0, 77) + "..." : text,
      native_action: nativeTyped,
    });
  },
  { interactive: false, actionKind: "cu_type_into_target" },
);

async function captureExecutePlanObservation(
  exec: ComputerExecutor,
  options: ToolExecutionOptions | undefined,
  response: {
    finalDisplayId?: number;
    finalBundleId?: string;
    finalWindowId?: number;
  },
): Promise<DesktopObservation | undefined> {
  try {
    return await observeDesktop(exec, {
      ...options,
      displayId: response.finalDisplayId ?? options?.displayId,
    }, {
      resolvedTargetBundleId: response.finalBundleId,
      resolvedTargetWindowId: response.finalWindowId,
    });
  } catch {
    return undefined;
  }
}

const cuExecutePlanFn = async (
  args: unknown,
  _cwd: string,
  options?: ToolExecutionOptions,
): Promise<unknown> => {
  const err = await guards(options);
  if (err) return err;
  const exec = getExecutor();
  try {
    await ensureInteractivePermissions(exec);
    const parsed = parseExecutePlanArgs(args);
    const resolution = await resolveBackend();
    const hasNativeExecutePlan = resolution.backend === "native_gui" &&
      resolution.capabilities?.features.includes("execute-plan") === true;
    if (!hasNativeExecutePlan) {
      const unsupportedObservation = await captureExecutePlanObservation(
        exec,
        options,
        {
          finalDisplayId: parsed.displayId,
        },
      );
      return buildExecutePlanFailureResult(
        {
          code: "cu_execute_plan_unsupported",
          message:
            "Native execute-plan is unavailable on this machine. Fall back to individual cu_* tools.",
          retryable: false,
          facts: {
            backend: resolution.backend,
            features: resolution.capabilities?.features ?? [],
          },
        },
        [],
        unsupportedObservation,
      );
    }

    const normalizedSteps = normalizePlanSteps(parsed.steps);
    // Preflight: ensure fresh observation context when the plan starts with
    // find_target or type_into (needs current AX state). Plans starting with
    // open_app establish their own context, so skip the preflight overhead.
    const firstOp = normalizedSteps[0]?.op;
    const needsPreflight = firstOp !== "open_app" && firstOp !== "press_keys";
    const lastObs = getLastComputerUseObservation();
    const isStale = !lastObs || (Date.now() - lastObs.createdAt > 10_000);
    if (needsPreflight && isStale) {
      await observeDesktop(exec, options).catch(() => {});
    }
    // Pass the latest observation ID so the native service can correlate
    // find_target resolution with the same AX snapshot the model saw.
    // If preflight failed, this may be stale — native service falls back to
    // fresh AX walk when the observation ID doesn't match.
    const currentObsId = getLastComputerUseObservation()?.observationId;
    // No blind retry on ambiguity — return candidates to LLM and let it choose.
    // The prompt tells the model to retry with selector.index after seeing candidates.
    const response = await performNativeExecutePlan({
      steps: normalizedSteps,
      displayId: parsed.displayId,
      observationId: currentObsId,
    });
    if (!response) {
      const failedObservation = await captureExecutePlanObservation(
        exec,
        options,
        {
          finalDisplayId: parsed.displayId,
        },
      );
      return buildExecutePlanFailureResult(
        {
          code: "cu_execute_plan_transport_failed",
          message:
            "Native execute-plan failed before returning a result. Fall back to smaller cu_* steps.",
          retryable: true,
          facts: {
            displayId: parsed.displayId ?? null,
          },
        },
        [],
        failedObservation,
      );
    }

    const observation = await captureExecutePlanObservation(
      exec,
      options,
      response,
    );
    if (!response.ok || response.status !== "completed") {
      // Propagate whatever context the plan DID establish before blocking,
      // so fallback cu_* tools start from the correct app/window state.
      if (response.finalBundleId) {
        setComputerUseTargetBundleId(
          response.finalBundleId,
          observation?.frontmostApp?.bundleId === response.finalBundleId
            ? observation?.frontmostApp?.displayName
            : undefined,
          "execute_plan",
        );
      }
      if (response.finalWindowId != null) {
        const targetWindow = observation?.windows.find((w) =>
          w.windowId === response.finalWindowId
        );
        if (targetWindow) {
          setComputerUseTargetWindow(targetWindow, "execute_plan");
        }
      }
      markComputerUseFailure({
        code: response.failure?.code ?? "cu_execute_plan_blocked",
        message: response.failure?.message ?? "Execute plan blocked",
        at: Date.now(),
        retryable: response.failure?.retryable,
      });
      return buildExecutePlanFailureResult(
        response.failure,
        response.steps,
        observation,
      );
    }

    if (response.finalBundleId) {
      setComputerUseTargetBundleId(
        response.finalBundleId,
        observation?.frontmostApp?.bundleId === response.finalBundleId
          ? observation.frontmostApp.displayName
          : undefined,
        "execute_plan",
      );
    }
    if (response.finalWindowId != null) {
      const targetWindow = observation?.windows.find((window) =>
        window.windowId === response.finalWindowId
      ) ?? getLastComputerUseObservation()?.windows.find((window) =>
        window.windowId === response.finalWindowId
      );
      if (targetWindow) {
        setComputerUseTargetWindow(targetWindow, "execute_plan");
      }
    }

    markComputerUseSuccess({
      kind: "cu_execute_plan",
      at: Date.now(),
      targetBundleId: response.finalBundleId ??
        observation?.frontmostApp?.bundleId,
      targetWindowId: response.finalWindowId,
      observationId: observation?.observationId,
    });
    if (!observation) {
      return okTool({
        execution_status: "completed",
        executed_steps: response.steps.length,
        plan_steps: response.steps,
      });
    }
    return observationImageResult(observation, {
      execution_status: "completed",
      executed_steps: response.steps.length,
      plan_steps: response.steps,
      final_bundle_id: response.finalBundleId ?? null,
      final_window_id: response.finalWindowId ?? null,
      final_display_id: response.finalDisplayId ?? null,
    });
  } catch (error) {
    const failure = getFailureMetadata(error);
    markComputerUseFailure({
      code: failure?.code ?? "cu_execute_plan",
      message: error instanceof Error ? error.message : String(error),
      at: Date.now(),
      retryable: failure?.retryable,
    });
    const toolError = formatToolError("Execute plan failed", error, failure);
    return failTool(toolError.message, { failure: toolError.failure });
  }
};

// ── Read-only metadata constants ─────────────────────────────────────────

const READ_SAFE: Pick<ToolMetadata, "execution" | "presentation"> = {
  execution: { concurrencySafe: true },
  presentation: { kind: "read" },
};

// ── Tool Metadata (26 entries) ───────────────────────────────────────────

export const COMPUTER_USE_TOOLS: Record<string, ToolMetadata> = {
  cu_observe: {
    fn: cuObserveFn,
    description:
      "Capture the current desktop state plus structured metadata about displays, windows, frontmost app, and actionable targets.",
    args: {},
    category: "read",
    safetyLevel: "L1",
    safety:
      "Captures visible desktop content and structured metadata. No side effects.",
    ...READ_SAFE,
    formatResult: (result) => {
      return formatObservationResult(
        result as Record<string, unknown> | null,
        RESULT_SUMMARY.observe,
        "Desktop observed",
      );
    },
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
      const r = result as Record<string, unknown> | null;
      return formatObservationResult(
        r,
        RESULT_SUMMARY.type,
        `Typed: ${r?.typed ?? ""}`,
      );
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
      const r = result as Record<string, unknown> | null;
      return formatObservationResult(
        r,
        RESULT_SUMMARY.key,
        `Pressed: ${r?.pressed ?? ""}`,
      );
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
      const r = result as Record<string, unknown> | null;
      return formatObservationResult(
        r,
        RESULT_SUMMARY.hold_key,
        `Held: ${r?.held ?? ""}`,
      );
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
      const r = result as Record<string, unknown> | null;
      const scrolled = r?.scrolled as
        | { direction?: string; amount?: number }
        | undefined;
      return formatObservationResult(
        r,
        RESULT_SUMMARY.scroll,
        `Scrolled ${scrolled?.direction ?? ""} ${scrolled?.amount ?? ""}`,
      );
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
    safety:
      "Clicks a grounded desktop target identified from the latest observation.",
    formatResult: (result) =>
      formatObservationResult(
        result as Record<string, unknown> | null,
        RESULT_SUMMARY.click_target,
        "Target clicked",
        ["action: click_target"],
      ),
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
      const r = result as Record<string, unknown> | null;
      const typed = r?.typed ?? r?.typed_into_target_id ?? "";
      return formatObservationResult(
        r,
        RESULT_SUMMARY.type_into_target,
        `Typed into target: ${typed}`,
        ["action: type_into_target"],
      );
    },
  },

  cu_read_target: {
    fn: cuReadTargetFn,
    description:
      "Read exact grounded target state from a recent grounded observation without using a screenshot. observation_id and target_id should come from the latest observation, or from the immediately preceding successful grounded target action when reading back the same element.",
    args: {
      observation_id:
        "string - Observation id returned by cu_observe or the immediately preceding successful grounded target action",
      target_id:
        "string - Target id from observation.targets[] or the immediately preceding successful grounded target action",
      read_kind: "string - One of: value, enabled",
    },
    category: "read",
    safetyLevel: "L1",
    safety:
      "Reads exact grounded target state from the native AX cache. No side effects.",
    ...READ_SAFE,
    formatResult: (result) => {
      const r = result as {
        target_id?: string;
        read_kind?: string;
        value?: string | boolean | null;
      };
      const value = r.value === null || r.value === undefined
        ? "null"
        : String(r.value);
      return {
        summaryDisplay: RESULT_SUMMARY.read_target,
        returnDisplay:
          `Read target ${r.target_id ?? "unknown"} ${r.read_kind ?? "value"} = ${value}`,
      };
    },
  },

  cu_execute_plan: {
    fn: cuExecutePlanFn,
    description:
      "Execute a short deterministic desktop subplan natively through the Level 3 backend. Prefer this for bounded 3+ step flows with clear success criteria.",
    args: {
      steps:
        "object[] - Ordered plan steps using ops: open_app, wait_for_ready, find_target, click, type_into, press_keys, verify",
      display_id:
        "number (optional) - Preferred display id for plan execution and final observation",
    },
    category: "write",
    safetyLevel: "L2",
    safety:
      "Executes multiple grounded desktop actions natively. Use only for short deterministic subplans.",
    formatResult: (result) => {
      const r = result as Record<string, unknown> | null;
      if (!r || typeof r !== "object") {
        return {
          summaryDisplay: RESULT_SUMMARY.execute_plan,
          returnDisplay: "Executed plan",
        };
      }
      const steps = Array.isArray(r.plan_steps) ? r.plan_steps : [];
      const extraLines = [
        `execution_status: ${r.execution_status ?? "unknown"}`,
        ...(typeof r.executed_steps === "number"
          ? [`executed_steps: ${r.executed_steps}`]
          : []),
        ...formatExecutePlanSteps(
          steps.map((entry) => {
            const record = asRecord(entry);
            return {
              index: typeof record?.index === "number"
                ? record.index
                : undefined,
              op: typeof record?.op === "string" ? record.op : undefined,
              status: typeof record?.status === "string"
                ? record.status
                : undefined,
              stepId: typeof record?.stepId === "string"
                ? record.stepId
                : undefined,
              message: typeof record?.message === "string"
                ? record.message
                : undefined,
            };
          }),
        ),
        ...(typeof r.message === "string" ? [`message: ${r.message}`] : []),
        ...formatExecutePlanFailureFacts(asRecord(r.failure)),
      ];
      const summary = typeof r.execution_status === "string" &&
          r.execution_status !== "completed"
        ? `Plan ${r.execution_status}`
        : RESULT_SUMMARY.execute_plan;
      const returnDisplay = typeof r.execution_status === "string" &&
          r.execution_status !== "completed"
        ? `Plan ${r.execution_status}`
        : "Executed plan";
      return formatObservationResult(r, summary, returnDisplay, extraLines);
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
      const r = result as Record<string, unknown> | null;
      return formatObservationResult(
        r,
        RESULT_SUMMARY.open_application,
        `Opened: ${r?.opened ?? ""}`,
        ["action: open_application"],
      );
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

export const _testOnly = {
  parseExecutePlanArgs,
  buildExecutePlanFailureResult,
  prepareInteractiveAction,
  normalizePlanSteps,
  cuTool,
  setExecutorForTests: (executor?: ComputerExecutor) => {
    _executor = executor;
  },
};
