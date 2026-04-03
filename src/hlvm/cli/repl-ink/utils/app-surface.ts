import type { OverlayPanel, SurfacePanel } from "../hooks/useOverlayPanel.ts";

export function shouldAutoCloseConversationSurface(options: {
  activeOverlay: OverlayPanel;
  surfacePanel: SurfacePanel;
  itemCount: number;
  hasActiveRun: boolean;
  queuedDraftCount: number;
  hasPendingInteraction: boolean;
  hasPlanState: boolean;
}): boolean {
  return options.activeOverlay === "none" &&
    options.surfacePanel === "conversation" &&
    options.itemCount === 0 &&
    !options.hasActiveRun &&
    options.queuedDraftCount === 0 &&
    !options.hasPendingInteraction &&
    !options.hasPlanState;
}

export function shouldRenderMainBanner(options: {
  showBanner: boolean;
  hasBeenCleared: boolean;
  isOverlayOpen: boolean;
  hasStandaloneSurface: boolean;
  hasActivePlanningState: boolean;
  hasShellHistory?: boolean;
  hasLiveConversation?: boolean;
  hasQueuedInput?: boolean;
  hasPendingInteraction?: boolean;
  hasLocalAgents?: boolean;
}): boolean {
  return options.showBanner &&
    !options.hasBeenCleared &&
    !options.isOverlayOpen &&
    !options.hasStandaloneSurface &&
    !options.hasShellHistory &&
    !options.hasLiveConversation &&
    !options.hasQueuedInput &&
    !options.hasPendingInteraction &&
    !options.hasLocalAgents &&
    !options.hasActivePlanningState;
}

export function shouldRenderShellLanes(options: {
  historyItemCount: number;
  localEvalQueueCount: number;
  liveItemCount: number;
  liveTodoCount: number;
  hasPendingInteraction: boolean;
  hasLocalAgents?: boolean;
}): boolean {
  return options.historyItemCount > 0 ||
    options.liveItemCount > 0 ||
    options.liveTodoCount > 0 ||
    options.hasPendingInteraction ||
    Boolean(options.hasLocalAgents);
}

export function resolveConversationEscapeAction(options: {
  surfacePanel: SurfacePanel;
  isConversationTaskRunning: boolean;
  composerShouldCaptureEscape?: boolean;
}): "interrupt" | "ignore" {
  if (options.composerShouldCaptureEscape) {
    return "ignore";
  }
  if (options.surfacePanel !== "conversation") {
    return "ignore";
  }
  return options.isConversationTaskRunning ? "interrupt" : "ignore";
}
