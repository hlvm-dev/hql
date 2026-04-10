/**
 * Computer Use — Session Runtime State
 *
 * The CU lock guarantees only one active computer-use session in this process,
 * so a single in-memory state object is the SSOT for the active runtime.
 */

import type {
  ComputerUsePermissionState,
  DesktopObservation,
  DisplaySelectionReason,
  ObservationTarget,
  WindowInfo,
} from "./types.ts";

export interface ComputerUseActionRecord {
  kind: string;
  at: number;
  targetBundleId?: string;
  targetWindowId?: number;
  observationId?: string;
}

export interface ComputerUseFailureRecord {
  code: string;
  message: string;
  at: number;
  retryable?: boolean;
}

export interface ComputerUseSessionState {
  selectedDisplayId?: number;
  displaySelectionReason?: DisplaySelectionReason;
  targetApp?: {
    bundleId: string;
    displayName?: string;
    updatedAt: number;
  };
  targetWindow?: {
    windowId: number;
    bundleId?: string;
    title?: string;
    displayId?: number;
    updatedAt: number;
  };
  hiddenApps: Set<string>;
  lastObservation?: DesktopObservation;
  lastSuccessfulAction?: ComputerUseActionRecord;
  recentFailureReason?: ComputerUseFailureRecord;
  permissions?: ComputerUsePermissionState;
}

const state: ComputerUseSessionState = {
  hiddenApps: new Set<string>(),
};

export function getComputerUseSessionState(): ComputerUseSessionState {
  return state;
}

export function getComputerUseTargetBundleId(): string | undefined {
  return state.targetApp?.bundleId;
}

export function setComputerUseTargetBundleId(
  bundleId: string | null | undefined,
  displayName?: string,
): void {
  const next = bundleId?.trim();
  if (!next) {
    delete state.targetApp;
    return;
  }
  state.targetApp = {
    bundleId: next,
    displayName,
    updatedAt: Date.now(),
  };
}

export function getComputerUseTargetWindowId(): number | undefined {
  return state.targetWindow?.windowId;
}

export function setComputerUseTargetWindow(window: WindowInfo | null): void {
  if (!window) {
    delete state.targetWindow;
    return;
  }
  state.targetWindow = {
    windowId: window.windowId,
    bundleId: window.bundleId,
    title: window.title,
    displayId: window.displayId,
    updatedAt: Date.now(),
  };
}

export function setComputerUseSelectedDisplay(
  displayId: number | undefined,
  reason: DisplaySelectionReason,
): void {
  state.selectedDisplayId = displayId;
  state.displaySelectionReason = reason;
}

export function rememberHiddenComputerUseApps(
  bundleIds: readonly string[],
): void {
  for (const bundleId of bundleIds) {
    if (bundleId) state.hiddenApps.add(bundleId);
  }
}

export function takeHiddenComputerUseApps(): string[] {
  const bundleIds = [...state.hiddenApps];
  state.hiddenApps.clear();
  return bundleIds;
}

export function rememberComputerUseObservation(
  observation: DesktopObservation,
): void {
  state.lastObservation = observation;
  state.permissions = observation.permissions;
  state.selectedDisplayId = observation.display.displayId;
  state.displaySelectionReason = observation.displaySelectionReason;

  if (observation.frontmostApp?.bundleId) {
    setComputerUseTargetBundleId(
      observation.frontmostApp.bundleId,
      observation.frontmostApp.displayName,
    );
  }

  if (observation.resolvedTargetWindowId != null) {
    const targetWindow = observation.windows.find((window) =>
      window.windowId === observation.resolvedTargetWindowId
    );
    setComputerUseTargetWindow(targetWindow ?? null);
    return;
  }

  const frontmostWindow = observation.frontmostApp?.bundleId
    ? observation.windows.find((window) =>
      window.bundleId === observation.frontmostApp?.bundleId
    )
    : undefined;
  if (frontmostWindow) {
    setComputerUseTargetWindow(frontmostWindow);
  }
}

export function getLastComputerUseObservation(): DesktopObservation | undefined {
  return state.lastObservation;
}

export function resolveObservationTarget(
  observationId: string,
  targetId: string,
): {
  observation: DesktopObservation;
  target: ObservationTarget;
} {
  const observation = state.lastObservation;
  if (!observation || observation.observationId !== observationId) {
    throw new Error(
      "Observation is stale. Call cu_observe again before using target-based actions.",
    );
  }
  const target = observation.targets.find((candidate) =>
    candidate.targetId === targetId
  );
  if (!target) {
    throw new Error(
      `Unknown target_id '${targetId}' for observation '${observationId}'.`,
    );
  }
  return { observation, target };
}

export function setComputerUsePermissionState(
  permissions: ComputerUsePermissionState,
): void {
  state.permissions = permissions;
}

export function markComputerUseSuccess(
  action: ComputerUseActionRecord,
): void {
  state.lastSuccessfulAction = action;
  delete state.recentFailureReason;
}

export function markComputerUseFailure(
  failure: ComputerUseFailureRecord,
): void {
  state.recentFailureReason = failure;
}

export function clearStaleComputerUseTargetWindow(
  visibleWindows: readonly WindowInfo[],
): void {
  const currentWindowId = state.targetWindow?.windowId;
  if (
    currentWindowId != null &&
    !visibleWindows.some((window) => window.windowId === currentWindowId)
  ) {
    delete state.targetWindow;
  }
}

export function clearStaleComputerUseTargetApp(
  runningBundleIds: readonly string[],
): void {
  const targetBundleId = state.targetApp?.bundleId;
  if (targetBundleId && !runningBundleIds.includes(targetBundleId)) {
    delete state.targetApp;
  }
}

export function resetComputerUseSessionState(): void {
  state.hiddenApps.clear();
  delete state.selectedDisplayId;
  delete state.displaySelectionReason;
  delete state.targetApp;
  delete state.targetWindow;
  delete state.lastObservation;
  delete state.lastSuccessfulAction;
  delete state.recentFailureReason;
  delete state.permissions;
}
