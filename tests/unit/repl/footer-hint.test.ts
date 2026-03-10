import { assertEquals } from "jsr:@std/assert@1";
import {
  buildFooterCenterState,
  getFooterColumnWidths,
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
    inConversation: true,
    contextUsageLabel: "12% ctx",
    checkpointLabel: "/undo ready",
    modelName: "claude-sonnet-4-6",
  });

  assertEquals(state.infoText, "12% ctx · /undo ready · claude-sonnet-4-6");
});

Deno.test("buildFooterRightState hides idle model-only metadata outside conversation", () => {
  const state = buildFooterRightState({
    inConversation: false,
    modelName: "llama3.2:1b",
  });

  assertEquals(state.infoText, "");
});

Deno.test("getFooterColumnWidths gives the center the full row when side columns are empty", () => {
  assertEquals(getFooterColumnWidths(90), {
    width: 90,
    leftWidth: 0,
    centerWidth: 90,
    rightWidth: 0,
  });
  assertEquals(getFooterColumnWidths(48), {
    width: 48,
    leftWidth: 0,
    centerWidth: 48,
    rightWidth: 0,
  });
});

Deno.test("getFooterColumnWidths fits side content without stealing unnecessary center space", () => {
  assertEquals(getFooterColumnWidths(90, "accept edits on", "llama3.2:1b"), {
    width: 90,
    leftWidth: 15,
    centerWidth: 62,
    rightWidth: 11,
  });
});
