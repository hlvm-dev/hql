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

  assertEquals(state.text, "esc cancel");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterLeftState shows tool status when responding with active tool", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    activeTool: { name: "search_web", toolIndex: 1, toolTotal: 2 },
    spinner: "x",
  });

  assertEquals(state.text, "x search_web (1/2) \u00B7 esc cancel");
  assertEquals(state.tone, "warning");
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

  assertEquals(state.text, "tab queue \u00B7 ctrl+enter force");
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

  assertEquals(state.text, "tab queue \u00B7 ctrl+enter force");
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
});

Deno.test("buildFooterRightState shows model name only when no metadata is present", () => {
  const state = buildFooterRightState({
    modelName: "llama3.2:1b",
  });

  assertEquals(state.infoText, "llama3.2:1b");
});
