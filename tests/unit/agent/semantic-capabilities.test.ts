import { assertEquals } from "jsr:@std/assert";
import { readSemanticCapabilitiesFromMetadata } from "../../../src/hlvm/agent/semantic-capabilities.ts";
import { TOOL_REGISTRY } from "../../../src/hlvm/agent/registry.ts";
import { WEB_TOOLS } from "../../../src/hlvm/agent/tools/web-tools.ts";

Deno.test("semantic capabilities: built-in web tools are tagged explicitly", () => {
  assertEquals(WEB_TOOLS.search_web?.semanticCapabilities, ["web.search"]);
  assertEquals(WEB_TOOLS.web_fetch?.semanticCapabilities, ["web.read"]);
  assertEquals(TOOL_REGISTRY.remote_code_execute?.semanticCapabilities, [
    "code.exec",
  ]);
});

Deno.test("semantic capabilities: metadata parser reads HLVM-owned MCP capability bindings", () => {
  assertEquals(
    readSemanticCapabilitiesFromMetadata({
      hlvmSemanticCapabilities: ["web.search", "web.read", "ignored"],
    }),
    ["web.search", "web.read"],
  );
  assertEquals(
    readSemanticCapabilitiesFromMetadata({
      "hlvm.semantic_capabilities": "web.search",
    }),
    ["web.search"],
  );
});
