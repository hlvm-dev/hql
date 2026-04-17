import { assertEquals } from "jsr:@std/assert";
import {
  buildToolSurface,
  buildTurnRouting,
} from "../../../src/hlvm/agent/routing.ts";

Deno.test("routing builds model-driven tool surface with deferred discovery", () => {
  const surface = buildToolSurface({
    modelTier: "standard",
    eagerTools: ["tool_search", "read_file"],
    deniedTools: ["web_fetch"],
    toolSearchUniverseAllowlist: ["read_file", "web_fetch", "search_web"],
  });

  assertEquals(surface.discovery, "tool_search");
  assertEquals(surface.eagerTools, ["read_file", "tool_search"]);
  assertEquals(surface.deniedTools, ["web_fetch"]);
  assertEquals(surface.deferredTools, ["search_web"]);
});

Deno.test("routing disables meta-tool discovery for constrained models", () => {
  const surface = buildToolSurface({
    modelTier: "constrained",
    eagerTools: ["tool_search", "read_file"],
    toolSearchUniverseAllowlist: ["search_web"],
  });

  assertEquals(surface.discovery, "none");
  assertEquals(surface.deferredTools, []);
});

Deno.test("routing output stays limited to model and capacity boundaries", () => {
  const routing = buildTurnRouting({
    selectedModel: "openai/gpt-5.4",
    modelSource: "explicit",
    modelTier: "enhanced",
    eagerTools: ["tool_search"],
  });

  assertEquals(routing.selectedModel, "openai/gpt-5.4");
  assertEquals(routing.modelSource, "explicit");
  assertEquals(routing.modelTier, "enhanced");
  assertEquals("taskDomain" in routing, false);
  assertEquals("needsPlan" in routing, false);
});
