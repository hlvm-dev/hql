import { assertEquals } from "jsr:@std/assert";
import { getPlanningModeForExecutionMode } from "../../../src/hlvm/agent/execution-mode.ts";

Deno.test("getPlanningModeForExecutionMode only enables structured planning in explicit plan mode", () => {
  assertEquals(getPlanningModeForExecutionMode("default"), "off");
  assertEquals(getPlanningModeForExecutionMode("auto-edit"), "off");
  assertEquals(getPlanningModeForExecutionMode("yolo"), "off");
  assertEquals(getPlanningModeForExecutionMode("plan"), "always");
});
