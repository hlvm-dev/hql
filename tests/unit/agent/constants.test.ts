import { assertEquals } from "jsr:@std/assert";
import {
  DEFAULT_MAX_TOOL_CALLS,
  ENGINE_PROFILES,
} from "../../../src/hlvm/agent/constants.ts";

Deno.test({
  name: "Agent constants: normal profile maxToolCalls uses DEFAULT_MAX_TOOL_CALLS",
  fn() {
    assertEquals(DEFAULT_MAX_TOOL_CALLS, 50);
    assertEquals(ENGINE_PROFILES.normal.maxToolCalls, DEFAULT_MAX_TOOL_CALLS);
  },
});
