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

Deno.test("buildFooterLeftState shows Ctrl+B hint when evaluating outside conversation", () => {
  const state = buildFooterLeftState({
    inConversation: false,
    isEvaluating: true,
    spinner: "x",
  });

  assertEquals(state.text, "Ctrl+B background \u00B7 Esc cancels");
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

Deno.test("buildFooterRightState includes model metadata with context mini-bar", () => {
  const state = buildFooterRightState({
    contextUsageLabel: "12% ctx",
    modelName: "claude-sonnet-4-6",
  });

  assertEquals(
    state.infoText,
    "[█░░░░░░░] 12% \u00B7 claude-sonnet-4-6",
  );
  assertEquals(state.infoParts, ["[█░░░░░░░] 12%", "claude-sonnet-4-6"]);
});

Deno.test("buildFooterRightState shows model name only when no metadata is present", () => {
  const state = buildFooterRightState({
    modelName: "llama3.2:1b",
  });

  assertEquals(state.infoText, "llama3.2:1b");
  assertEquals(state.infoParts, ["llama3.2:1b"]);
});

Deno.test("buildFooterLeftState shows bg chip outside conversation when tasks active", () => {
  const state = buildFooterLeftState({
    inConversation: false,
    activeTaskCount: 3,
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  const bgChip = state.segments.find((s) => s.text === "● 3 tasks");
  assertEquals(bgChip?.chip, true);
  assertEquals(bgChip?.tone, "active");
});

Deno.test("buildFooterLeftState hides bg chip when zero tasks active", () => {
  const state = buildFooterLeftState({
    inConversation: false,
    activeTaskCount: 0,
    spinner: "x",
  });

  assertEquals(
    state.segments.some((s) => s.text.includes("tasks")),
    false,
  );
});

Deno.test("buildFooterLeftState shows bg chip in conversation idle", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    activeTaskCount: 2,
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  const bgChip = state.segments.find((s) => s.text === "● 2 tasks");
  assertEquals(bgChip?.chip, true);
  assertEquals(bgChip?.tone, "active");
});

Deno.test("buildFooterLeftState shows task label hint when recentActiveTaskLabel provided", () => {
  const state = buildFooterLeftState({
    inConversation: false,
    activeTaskCount: 1,
    recentActiveTaskLabel: "(+ 1 2)",
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  const hint = state.segments.find((s) => s.text.includes("Ctrl+J tasks"));
  assertEquals(hint?.tone, "muted");
  assertEquals(hint?.text, "(+ 1 2) \u00B7 Ctrl+J tasks");
});

Deno.test("buildFooterLeftState omits task hint when no recentActiveTaskLabel", () => {
  const state = buildFooterLeftState({
    inConversation: false,
    activeTaskCount: 1,
    spinner: "x",
  });

  assertEquals(
    state.segments.some((s) => s.text.includes("Ctrl+J")),
    false,
  );
});

Deno.test("buildFooterLeftState shows Team chip when teamActive", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    teamActive: true,
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  const teamChip = state.segments.find((s) => s.text === "Team");
  assertEquals(teamChip?.chip, true);
  assertEquals(teamChip?.tone, "active");
});

Deno.test("buildFooterLeftState shows worker summary when team active with workers", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    teamActive: true,
    teamWorkerSummary: "alice: working \u00B7 bob: idle",
    spinner: "x",
  });

  assertEquals(state.mode, "segments");
  const workerSegment = state.segments.find((s) => s.text.includes("alice"));
  assertEquals(workerSegment?.tone, "muted");
  assertEquals(workerSegment?.text, "alice: working \u00B7 bob: idle");
});

Deno.test("buildFooterLeftState omits Team chip when team not active", () => {
  const state = buildFooterLeftState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    teamActive: false,
    spinner: "x",
  });

  assertEquals(
    state.segments.some((s) => s.text === "Team"),
    false,
  );
});
