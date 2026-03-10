import { assertEquals } from "jsr:@std/assert";
import {
  computeTierToolFilter,
  DEFAULT_MAX_TOOL_CALLS,
  ENGINE_PROFILES,
  supportsAgentExecution,
  WEAK_TIER_CORE_TOOLS,
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

// ============================================================
// computeTierToolFilter
// ============================================================

Deno.test("computeTierToolFilter - weak tier returns core allowlist", () => {
  const result = computeTierToolFilter("weak");
  assertEquals(result.allowlist, [...WEAK_TIER_CORE_TOOLS]);
  assertEquals(result.denylist, undefined);
});

Deno.test("computeTierToolFilter - weak with user allowlist preserves user choice", () => {
  const userList = ["read_file", "custom_tool"];
  const result = computeTierToolFilter("weak", userList);
  assertEquals(result.allowlist, userList);
});

Deno.test("computeTierToolFilter - mid tier passthrough", () => {
  const result = computeTierToolFilter("mid");
  assertEquals(result.allowlist, undefined);
  assertEquals(result.denylist, undefined);
});

Deno.test("computeTierToolFilter - frontier tier passthrough", () => {
  const userList = ["read_file"];
  const result = computeTierToolFilter("frontier", userList, ["shell_exec"]);
  assertEquals(result.allowlist, userList);
  assertEquals(result.denylist, ["shell_exec"]);
});

Deno.test("computeTierToolFilter - weak tier denylist preserved", () => {
  const result = computeTierToolFilter("weak", undefined, ["memory_write"]);
  assertEquals(result.allowlist, [...WEAK_TIER_CORE_TOOLS]);
  assertEquals(result.denylist, ["memory_write"]);
});

Deno.test("supportsAgentExecution - weak local models are chat-only", () => {
  assertEquals(
    supportsAgentExecution("ollama/llama3.2:1b", { parameterSize: "7B" }),
    false,
  );
  assertEquals(
    supportsAgentExecution("ollama/llama3.1:70b", { parameterSize: "70B" }),
    true,
  );
  assertEquals(
    supportsAgentExecution("openai/gpt-5", null),
    true,
  );
});
