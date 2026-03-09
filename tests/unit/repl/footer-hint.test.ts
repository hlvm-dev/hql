import { assertEquals } from "jsr:@std/assert@1";
import {
  buildFooterCenterState,
  buildFooterRightState,
} from "../../../src/hlvm/cli/repl-ink/components/FooterHint.tsx";
import { StreamingState } from "../../../src/hlvm/cli/repl-ink/types.ts";

Deno.test("buildFooterCenterState removes duplicate thinking label when no active tool", () => {
  const state = buildFooterCenterState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    spinner: "x",
  });

  assertEquals(state.text, "Esc cancel · PgUp/PgDn scroll");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterCenterState keeps running tool status in footer", () => {
  const state = buildFooterCenterState({
    inConversation: true,
    streamingState: StreamingState.Responding,
    activeTool: { name: "search_web", toolIndex: 1, toolTotal: 2 },
    spinner: "x",
  });

  assertEquals(state.text, "x Running search_web (1/2) · Esc cancel");
  assertEquals(state.tone, "warning");
});

Deno.test("buildFooterCenterState shows shortcuts hint when idle in conversation", () => {
  const state = buildFooterCenterState({
    inConversation: true,
    streamingState: StreamingState.Idle,
    spinner: "x",
  });

  assertEquals(state.text, "Ready · PgUp/PgDn scroll · ? shortcuts");
  assertEquals(state.tone, "muted");
});

Deno.test("buildFooterCenterState shows shortcuts hint outside conversation", () => {
  const state = buildFooterCenterState({
    inConversation: false,
    spinner: "x",
  });

  assertEquals(state.text, "? shortcuts");
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

Deno.test("buildFooterRightState keeps the mode badge separate from model metadata", () => {
  const state = buildFooterRightState({
    modeLabel: "plan mode on",
    contextUsageLabel: "12% ctx",
    checkpointLabel: "/undo ready",
    modelName: "claude-sonnet-4-6",
  });

  assertEquals(state.modeLabel, "plan mode on");
  assertEquals(state.infoText, "12% ctx · /undo ready · claude-sonnet-4-6");
});
