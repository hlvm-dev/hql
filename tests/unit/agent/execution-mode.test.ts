import { assertEquals } from "jsr:@std/assert";
import {
  cycleReplAgentExecutionMode,
  getAgentExecutionModeBadge,
  getPlanningModeForExecutionMode,
  toAgentExecutionMode,
} from "../../../src/hlvm/agent/execution-mode.ts";

Deno.test("agent execution mode: derives default mode from config permission mode", () => {
  assertEquals(toAgentExecutionMode(undefined), "default");
  assertEquals(toAgentExecutionMode("auto-edit"), "auto-edit");
  assertEquals(toAgentExecutionMode("yolo"), "yolo");
});

Deno.test("agent execution mode: Shift+Tab cycle stays on default/auto-edit/plan", () => {
  assertEquals(cycleReplAgentExecutionMode("default"), "auto-edit");
  assertEquals(cycleReplAgentExecutionMode("auto-edit"), "plan");
  assertEquals(cycleReplAgentExecutionMode("plan"), "default");
  assertEquals(cycleReplAgentExecutionMode("yolo"), "default");
});

Deno.test("agent execution mode: footer badges reflect active session mode", () => {
  assertEquals(getAgentExecutionModeBadge("default"), undefined);
  assertEquals(getAgentExecutionModeBadge("auto-edit"), "accept edits on");
  assertEquals(getAgentExecutionModeBadge("plan"), "plan mode on");
  assertEquals(getAgentExecutionModeBadge("yolo"), "full auto on");
});

Deno.test("agent execution mode: planning is forced only in plan mode", () => {
  assertEquals(getPlanningModeForExecutionMode("default"), "auto");
  assertEquals(getPlanningModeForExecutionMode("auto-edit"), "auto");
  assertEquals(getPlanningModeForExecutionMode("yolo"), "auto");
  assertEquals(getPlanningModeForExecutionMode("plan"), "always");
});
