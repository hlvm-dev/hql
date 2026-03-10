import { assertEquals } from "jsr:@std/assert@1";
import {
  buildFooterCenterState,
  buildFooterRightState,
  shouldUseCompactFooter,
} from "../../../src/hlvm/cli/repl-ink/components/FooterHint.tsx";
import { StreamingState } from "../../../src/hlvm/cli/repl-ink/types.ts";

Deno.test("buildFooterCenterState shows force hint when responding without active tool", () => {
  const state = buildFooterCenterState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    spinner: "x",
  });

  assertEquals(state.text, "Esc cancel \u00B7 Ctrl+Enter force");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterCenterState keeps running tool status in footer", () => {
  const state = buildFooterCenterState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    activeTool: { name: "search_web", toolIndex: 1, toolTotal: 2 },
    spinner: "x",
  });

  assertEquals(state.text, "x Running search_web (1/2) \u00B7 Esc cancel");
  assertEquals(state.tone, "warning");
});

Deno.test("buildFooterCenterState shows shortcuts hint when idle in conversation", () => {
  const state = buildFooterCenterState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    spinner: "x",
  });

  assertEquals(
    state.text,
    "Ready \u00B7 PgUp/PgDn scroll \u00B7 /help shortcuts",
  );
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterCenterState shows shortcuts hint outside conversation", () => {
  const state = buildFooterCenterState({
    inConversation: false,
    spinner: "x",
  });

  assertEquals(state.text, "/help shortcuts");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterCenterState surfaces transient status messages when idle", () => {
  const state = buildFooterCenterState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    spinner: "x",
    statusMessage: "Plan mode enabled",
  });

  assertEquals(state.text, "Plan mode enabled");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterCenterState shows tab queue hint when draft exists during response", () => {
  const state = buildFooterCenterState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    hasDraftInput: true,
    spinner: "x",
  });

  assertEquals(state.text, "Tab to queue message");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterCenterState includes queued interaction count in footer", () => {
  const state = buildFooterCenterState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    interactionQueueLength: 3,
    spinner: "x",
  });

  assertEquals(
    state.text,
    "Ready \u00B7 PgUp/PgDn scroll \u00B7 /help shortcuts \u00B7 +2 queued",
  );
});

Deno.test("buildFooterCenterState prefers queue hint over running tool status when draft exists", () => {
  const state = buildFooterCenterState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    activeTool: { name: "search_web", toolIndex: 1, toolTotal: 2 },
    hasDraftInput: true,
    spinner: "x",
  });

  assertEquals(state.text, "Tab to queue message");
});

Deno.test("buildFooterRightState includes mode label and model metadata", () => {
  const state = buildFooterRightState({
    modeLabel: "[auto]",
    contextUsageLabel: "12% ctx",
    checkpointLabel: "/undo ready",
    modelName: "claude-sonnet-4-6",
  });

  assertEquals(state.modeLabel, "[auto]");
  assertEquals(
    state.infoText,
    "12% ctx \u00B7 /undo ready \u00B7 claude-sonnet-4-6",
  );
});

Deno.test("buildFooterRightState shows model name without mode label", () => {
  const state = buildFooterRightState({
    modelName: "llama3.2:1b",
  });

  assertEquals(state.infoText, "llama3.2:1b");
  assertEquals(state.modeLabel, undefined);
});

Deno.test("shouldUseCompactFooter hides side metadata on narrow terminals", () => {
  assertEquals(shouldUseCompactFooter(75), true);
  assertEquals(shouldUseCompactFooter(90), false);
});
