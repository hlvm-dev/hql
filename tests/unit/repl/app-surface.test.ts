import { assertEquals } from "jsr:@std/assert";
import {
  shouldAutoCloseConversationSurface,
  shouldRenderMainBanner,
} from "../../../src/hlvm/cli/repl-ink/components/App.tsx";

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

Deno.test("shouldRenderMainBanner keeps the banner visible during normal conversation flow", () => {
  assertEquals(
    shouldRenderMainBanner({
      showBanner: true,
      hasBeenCleared: false,
      isOverlayOpen: false,
      hasStandaloneSurface: false,
      hasActivePlanningState: false,
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
    }),
    false,
  );
});

Deno.test("shouldRenderMainBanner hides the banner while active plan flow owns the screen", () => {
  assertEquals(
    shouldRenderMainBanner({
      showBanner: true,
      hasBeenCleared: false,
      isOverlayOpen: false,
      hasStandaloneSurface: false,
      hasActivePlanningState: true,
    }),
    false,
  );
});
