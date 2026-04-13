import { assertEquals } from "jsr:@std/assert";
import { ContextManager } from "../../../src/hlvm/agent/context.ts";
import { initializeLoopState } from "../../../src/hlvm/agent/orchestrator-state.ts";
import type { OrchestratorConfig } from "../../../src/hlvm/agent/orchestrator.ts";

Deno.test("initializeLoopState seeds cached delegation signal from routingResult", () => {
  const config: OrchestratorConfig = {
    workspace: "/tmp",
    context: new ContextManager(),
    routingResult: {
      tier: "standard",
      behavior: "assisted",
      provenance: "assisted_classify_all",
      taskDomain: "browser",
      shouldDelegate: false,
      delegatePattern: "none",
      needsPlan: true,
      taskClassification: null,
      reason: "classifyAll detected browser intent",
    },
  };

  const state = initializeLoopState(config);

  assertEquals(state.cachedDelegationSignal?.taskDomain, "browser");
  assertEquals(state.cachedDelegationSignal?.shouldDelegate, false);
  assertEquals(
    state.cachedDelegationSignal?.reason,
    "classifyAll detected browser intent",
  );
});
