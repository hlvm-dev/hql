import { assertEquals } from "jsr:@std/assert";
import {
  cycleReplAgentExecutionMode,
  getAgentExecutionModeBadge,
  getAgentExecutionModeSelectionLabel,
  getPlanningModeForExecutionMode,
  toAgentExecutionMode,
} from "../../../src/hlvm/agent/execution-mode.ts";

Deno.test("agent execution mode: derives default mode from config permission mode", () => {
  assertEquals(toAgentExecutionMode(undefined), "default");
  assertEquals(toAgentExecutionMode("auto-edit"), "auto-edit");
  assertEquals(toAgentExecutionMode("yolo"), "yolo");
});

Deno.test("agent execution mode: Shift+Tab cycles through default/auto-edit/plan/yolo", () => {
  assertEquals(cycleReplAgentExecutionMode("default"), "auto-edit");
  assertEquals(cycleReplAgentExecutionMode("auto-edit"), "plan");
  assertEquals(cycleReplAgentExecutionMode("plan"), "yolo");
  assertEquals(cycleReplAgentExecutionMode("yolo"), "default");
});

Deno.test("agent execution mode: footer badges reflect active session mode", () => {
  assertEquals(getAgentExecutionModeBadge("default"), undefined);
  assertEquals(
    getAgentExecutionModeBadge("auto-edit"),
    "accept edits on (shift+tab to cycle)",
  );
  assertEquals(
    getAgentExecutionModeBadge("plan"),
    "plan mode on (shift+tab to cycle)",
  );
  assertEquals(
    getAgentExecutionModeBadge("yolo"),
    "full auto on (shift+tab to cycle)",
  );
});

Deno.test("agent execution mode: selection labels stay mode-specific", () => {
  assertEquals(getAgentExecutionModeSelectionLabel("default"), "default model");
  assertEquals(getAgentExecutionModeSelectionLabel("auto-edit"), "accept edits model");
  assertEquals(getAgentExecutionModeSelectionLabel("plan"), "plan mode model");
  assertEquals(getAgentExecutionModeSelectionLabel("yolo"), "full auto model");
});

Deno.test("agent execution mode: planning is forced only in plan mode", () => {
  assertEquals(getPlanningModeForExecutionMode("default"), "auto");
  assertEquals(getPlanningModeForExecutionMode("auto-edit"), "auto");
  assertEquals(getPlanningModeForExecutionMode("yolo"), "auto");
  assertEquals(getPlanningModeForExecutionMode("plan"), "always");
});
