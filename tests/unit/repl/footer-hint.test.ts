import { assertEquals } from "jsr:@std/assert@1";
import {
  buildFooterLeftState,
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
    activeTool: {
      name: "search_web",
      displayName: "Web Search",
      progressText: "Found 10 results",
      toolIndex: 1,
      toolTotal: 2,
    },
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  assertEquals(
    state.text,
    "x Web Search 1/2 \u00B7 Found 10 results \u00B7 Esc cancels",
  );
  assertEquals(
    state.segments.map((segment) => [segment.text, segment.chip, segment.tone]),
    [
      ["x Web Search 1/2 · Found 10 results", true, "active"],
      ["Esc cancels", undefined, "muted"],
    ],
  );
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterLeftState shows Ctrl+O hint when idle in conversation", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    spinner: "x",
  });

  assertEquals(state.text, "Ctrl+O transcript history \u00B7 ? for shortcuts");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterLeftState shows plan review chip when picker owns focus", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    hasPendingPermission: true,
    hasPendingPlanReview: true,
    suppressInteractionHints: true,
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  assertEquals(
    state.segments.some((s) => s.text === "Plan review pending"),
    true,
  );
});

Deno.test("buildFooterLeftState shows empty text outside conversation", () => {
  const state = buildFooterLeftState({
    inConversation: false,
    spinner: "x",
  });

  assertEquals(state.text, "? for shortcuts");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterLeftState shows submit cue outside conversation when draft text is present", () => {
  const state = buildFooterLeftState({
    inConversation: false,
    hasSubmitText: true,
    submitAction: "evaluate-local",
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  assertEquals(state.text, "Enter eval");
});

Deno.test("buildFooterLeftState shows Ctrl+B hint when evaluating outside conversation", () => {
  const state = buildFooterLeftState({
    inConversation: false,
    isEvaluating: true,
    spinner: "x",
  });

  assertEquals(state.text, "Ctrl+B background \u00B7 Esc cancels");
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

Deno.test("buildFooterLeftState collapses mixed chat/eval queue counts into one segment", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    conversationQueueCount: 1,
    localEvalQueueCount: 4,
    spinner: "x",
  });

  assertEquals(state.text, "+5 next");
});

Deno.test("buildFooterLeftState keeps one total queue segment even for eval-only items", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    localEvalQueueCount: 2,
    spinner: "x",
  });

  assertEquals(state.text, "+2 next");
});

Deno.test("buildFooterLeftState shows conversation submit cue when idle with draft text", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    hasSubmitText: true,
    submitAction: "send-agent",
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  assertEquals(state.text, "Enter send");
});

Deno.test("buildFooterLeftState uses review-specific wording for reviewing phase", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    planningPhase: "reviewing",
    spinner: "x",
  });

  assertEquals(state.text, "Plan review \u00B7 Esc cancels");
});

Deno.test("buildFooterLeftState uses human plan labels instead of raw phase names", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    planningPhase: "researching",
    spinner: "x",
  });

  assertEquals(state.text, "Plan research \u00B7 Esc cancels");
});

Deno.test("buildFooterLeftState suppresses the duplicate generic plan-mode segment when a specific plan phase is active", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    planningPhase: "researching",
    spinner: "x",
  });

  assertEquals(state.text, "Plan research \u00B7 Esc cancels");
});

Deno.test("buildFooterLeftState exposes an idle escape hatch for lingering plan state", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    planningPhase: "executing",
    spinner: "x",
  });

  assertEquals(state.text, "Plan executing \u00B7 Esc clears plan");
});

Deno.test("buildFooterLeftState prefers queue/force hints over tool status when draft exists", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    activeTool: {
      name: "search_web",
      displayName: "Web Search",
      toolIndex: 1,
      toolTotal: 2,
    },
    hasDraftInput: true,
    spinner: "x",
  });

  assertEquals(state.text, "Tab queues \u00B7 Ctrl+Enter forces");
});

Deno.test("buildFooterLeftState orders shell segments as queue, active tool, then hint", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    interactionQueueLength: 3,
    activeTool: {
      name: "search_web",
      displayName: "Web Search",
      toolIndex: 1,
      toolTotal: 2,
    },
    spinner: "x",
  });

  assertEquals(
    state.segments.map((segment) => segment.text),
    ["+2 queued", "x Web Search 1/2", "Esc cancels"],
  );
});

Deno.test("buildFooterLeftState stays quiet while prompt dialogs own the bottom lane", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    hasPendingPermission: true,
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
});
