import { assertEquals } from "jsr:@std/assert";
import {
  resolveConversationEscapeAction,
  shouldAutoCloseConversationSurface,
  shouldRenderMainBanner,
  shouldRenderShellLanes,
} from "../../../src/hlvm/cli/repl-ink/utils/app-surface.ts";

Deno.test("shouldAutoCloseConversationSurface stays open while a conversation run is starting", () => {
  assertEquals(
    shouldAutoCloseConversationSurface({
      activeOverlay: "none",
      surfacePanel: "conversation",
      itemCount: 0,
      hasActiveRun: true,
      queuedDraftCount: 0,
      hasPendingInteraction: false,
      hasPlanState: false,
    }),
    false,
  );
});

Deno.test("resolveConversationEscapeAction only interrupts active conversation runs", () => {
  assertEquals(
    resolveConversationEscapeAction({
      surfacePanel: "conversation",
      isConversationTaskRunning: true,
      composerShouldCaptureEscape: false,
    }),
    "interrupt",
  );
  assertEquals(
    resolveConversationEscapeAction({
      surfacePanel: "conversation",
      isConversationTaskRunning: false,
      composerShouldCaptureEscape: false,
    }),
    "ignore",
  );
  assertEquals(
    resolveConversationEscapeAction({
      surfacePanel: "none",
      isConversationTaskRunning: true,
      composerShouldCaptureEscape: false,
    }),
    "ignore",
  );
  assertEquals(
    resolveConversationEscapeAction({
      surfacePanel: "conversation",
      isConversationTaskRunning: true,
      composerShouldCaptureEscape: true,
    }),
    "ignore",
  );
});

Deno.test("shouldAutoCloseConversationSurface closes only when conversation mode is truly idle and empty", () => {
  assertEquals(
    shouldAutoCloseConversationSurface({
      activeOverlay: "none",
      surfacePanel: "conversation",
      itemCount: 0,
      hasActiveRun: false,
      queuedDraftCount: 0,
      hasPendingInteraction: false,
      hasPlanState: false,
    }),
    true,
  );
});

Deno.test("shouldAutoCloseConversationSurface stays open while plan state still owns the conversation surface", () => {
  assertEquals(
    shouldAutoCloseConversationSurface({
      activeOverlay: "none",
      surfacePanel: "conversation",
      itemCount: 0,
      hasActiveRun: false,
      queuedDraftCount: 0,
      hasPendingInteraction: false,
      hasPlanState: true,
    }),
    false,
  );
});

Deno.test("shouldRenderMainBanner keeps the banner visible on a pristine shell", () => {
  assertEquals(
    shouldRenderMainBanner({
      showBanner: true,
      hasBeenCleared: false,
      isOverlayOpen: false,
      hasStandaloneSurface: false,
      hasActivePlanningState: false,
      hasShellHistory: false,
      hasLiveConversation: false,
      hasQueuedInput: false,
      hasPendingInteraction: false,
      hasLocalAgents: false,
    }),
    true,
  );
});

Deno.test("shouldRenderMainBanner hides the banner for overlays and standalone surfaces", () => {
  assertEquals(
    shouldRenderMainBanner({
      showBanner: true,
      hasBeenCleared: false,
      isOverlayOpen: true,
      hasStandaloneSurface: false,
      hasActivePlanningState: false,
      hasShellHistory: false,
      hasLiveConversation: false,
      hasQueuedInput: false,
      hasPendingInteraction: false,
      hasLocalAgents: false,
    }),
    false,
  );
  assertEquals(
    shouldRenderMainBanner({
      showBanner: true,
      hasBeenCleared: false,
      isOverlayOpen: false,
      hasStandaloneSurface: true,
      hasActivePlanningState: false,
      hasShellHistory: false,
      hasLiveConversation: false,
      hasQueuedInput: false,
      hasPendingInteraction: false,
      hasLocalAgents: false,
    }),
    false,
  );
});

Deno.test("shouldRenderMainBanner hides the banner whenever the shell is active", () => {
  assertEquals(
    shouldRenderMainBanner({
      showBanner: true,
      hasBeenCleared: false,
      isOverlayOpen: false,
      hasStandaloneSurface: false,
      hasActivePlanningState: true,
      hasShellHistory: false,
      hasLiveConversation: false,
      hasQueuedInput: false,
      hasPendingInteraction: false,
      hasLocalAgents: false,
    }),
    false,
  );
  assertEquals(
    shouldRenderMainBanner({
      showBanner: true,
      hasBeenCleared: false,
      isOverlayOpen: false,
      hasStandaloneSurface: false,
      hasActivePlanningState: false,
      hasShellHistory: true,
      hasLiveConversation: false,
      hasQueuedInput: false,
      hasPendingInteraction: false,
      hasLocalAgents: false,
    }),
    false,
  );
  assertEquals(
    shouldRenderMainBanner({
      showBanner: true,
      hasBeenCleared: false,
      isOverlayOpen: false,
      hasStandaloneSurface: false,
      hasActivePlanningState: false,
      hasShellHistory: false,
      hasLiveConversation: true,
      hasQueuedInput: true,
      hasPendingInteraction: false,
      hasLocalAgents: true,
    }),
    false,
  );
});

Deno.test("shouldRenderShellLanes stays collapsed for an empty start screen", () => {
  assertEquals(
    shouldRenderShellLanes({
      historyItemCount: 0,
      localEvalQueueCount: 0,
      liveItemCount: 0,
      liveTodoCount: 0,
      hasPendingInteraction: false,
    }),
    false,
  );
});

Deno.test("shouldRenderShellLanes opens when local agents are active", () => {
  assertEquals(
    shouldRenderShellLanes({
      historyItemCount: 0,
      localEvalQueueCount: 0,
      liveItemCount: 0,
      liveTodoCount: 0,
      hasPendingInteraction: false,
      hasLocalAgents: true,
    }),
    true,
  );
});

Deno.test("shouldRenderShellLanes keeps transcript spacing when shell content exists", () => {
  assertEquals(
    shouldRenderShellLanes({
      historyItemCount: 1,
      localEvalQueueCount: 0,
      liveItemCount: 0,
      liveTodoCount: 0,
      hasPendingInteraction: false,
    }),
    true,
  );
  assertEquals(
    shouldRenderShellLanes({
      historyItemCount: 0,
      localEvalQueueCount: 0,
      liveItemCount: 0,
      liveTodoCount: 1,
      hasPendingInteraction: false,
    }),
    true,
  );
  assertEquals(
    shouldRenderShellLanes({
      historyItemCount: 0,
      localEvalQueueCount: 0,
      liveItemCount: 0,
      liveTodoCount: 0,
      hasPendingInteraction: true,
    }),
    true,
  );
});
