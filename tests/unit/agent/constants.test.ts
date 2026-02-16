import { assertEquals } from "jsr:@std/assert";
import {
  DEFAULT_MAX_TOOL_CALLS,
  ENGINE_PROFILES,
} from "../../../src/hlvm/agent/constants.ts";

Deno.test({
  name: "Agent constants: engine profile limits stay internally consistent",
  fn() {
    assertEquals(ENGINE_PROFILES.normal.maxToolCalls, DEFAULT_MAX_TOOL_CALLS);
    assertEquals(ENGINE_PROFILES.normal.maxToolCalls >= ENGINE_PROFILES.strict.maxToolCalls, true);
    assertEquals(ENGINE_PROFILES.strict.maxToolCalls > 0, true);
    assertEquals(ENGINE_PROFILES.strict.context.overflowStrategy, "fail");
  },
});
