import { assertEquals } from "jsr:@std/assert@1";
import {
  buildFooterLeftState,
  buildFooterRightState,
} from "../../../src/hlvm/cli/repl-ink/components/FooterHint.tsx";
import { StreamingState } from "../../../src/hlvm/cli/repl-ink/types.ts";

Deno.test("buildFooterLeftState shows esc cancel when responding without draft", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  assertEquals(state.text, "Esc cancels");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterLeftState shows tool status when responding with active tool", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    activeTool: { name: "search_web", toolIndex: 1, toolTotal: 2 },
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  assertEquals(state.text, "x search_web 1/2 \u00B7 Esc cancels");
  assertEquals(
    state.segments.map((segment) => [segment.text, segment.chip, segment.tone]),
    [
      ["x search_web 1/2", true, "warning"],
      ["Esc cancels", undefined, "muted"],
    ],
  );
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterLeftState shows empty text when idle in conversation", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    spinner: "x",
  });

  assertEquals(state.text, "");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterLeftState shows the persistent mode label when idle in conversation", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    modeLabel: "Plan mode (shift+tab to cycle)",
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  assertEquals(state.text, "Plan mode \u00B7 Shift+Tab cycles");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterLeftState suppresses duplicated plan review actions when picker owns focus", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    hasPendingPermission: true,
    hasPendingPlanReview: true,
    suppressInteractionHints: true,
    spinner: "x",
  });

  assertEquals(state.text, "");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterLeftState shows empty text outside conversation", () => {
  const state = buildFooterLeftState({
    inConversation: false,
    spinner: "x",
  });

  assertEquals(state.text, "");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterLeftState shows persistent mode label outside conversation", () => {
  const state = buildFooterLeftState({
    inConversation: false,
    modeLabel: "Accept edits (shift+tab to cycle)",
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  assertEquals(state.text, "Accept edits \u00B7 Shift+Tab cycles");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterLeftState surfaces transient status messages when idle", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    spinner: "x",
    statusMessage: "Plan mode enabled",
  });

  assertEquals(state.text, "Plan mode enabled");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterLeftState shows queue/force hints when draft exists during response", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    hasDraftInput: true,
    spinner: "x",
  });

  assertEquals(state.text, "Tab queues \u00B7 Ctrl+Enter forces");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterLeftState includes queued interaction count", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    interactionQueueLength: 3,
    spinner: "x",
  });

  assertEquals(state.text, "+2 queued");
});

Deno.test("buildFooterLeftState prefers queue/force hints over tool status when draft exists", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    activeTool: { name: "search_web", toolIndex: 1, toolTotal: 2 },
    hasDraftInput: true,
    spinner: "x",
  });

  assertEquals(state.text, "Tab queues \u00B7 Ctrl+Enter forces");
});

Deno.test("buildFooterLeftState orders shell segments as mode, queue, active tool, then hint", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    modeLabel: "Default mode (shift+tab to cycle)",
    interactionQueueLength: 3,
    activeTool: { name: "search_web", toolIndex: 1, toolTotal: 2 },
    spinner: "x",
  });

  assertEquals(
    state.segments.map((segment) => segment.text),
    ["Default mode", "+2 queued", "x search_web 1/2", "Esc cancels"],
  );
});

Deno.test("buildFooterRightState includes model metadata", () => {
  const state = buildFooterRightState({
    contextUsageLabel: "12% ctx",
    modelName: "claude-sonnet-4-6",
  });

  assertEquals(
    state.infoText,
    "12% ctx \u00B7 claude-sonnet-4-6",
  );
  assertEquals(state.infoParts, ["12% ctx", "claude-sonnet-4-6"]);
});

Deno.test("buildFooterRightState shows model name only when no metadata is present", () => {
  const state = buildFooterRightState({
    modelName: "llama3.2:1b",
  });

  assertEquals(state.infoText, "llama3.2:1b");
  assertEquals(state.infoParts, ["llama3.2:1b"]);
});
