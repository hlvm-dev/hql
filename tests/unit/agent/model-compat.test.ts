import { assertEquals } from "jsr:@std/assert";
import {
  AGENT_ORCHESTRATOR_FAILURE_MESSAGES,
  classifyAgentFinalResponse,
} from "../../../src/hlvm/agent/model-compat.ts";

Deno.test("classifyAgentFinalResponse classifies canonical orchestrator failures", () => {
  const classified = classifyAgentFinalResponse(
    AGENT_ORCHESTRATOR_FAILURE_MESSAGES.nativeToolCallingRequired,
  );
  assertEquals(classified.orchestratorFailureCode, "nativeToolCallingRequired");
  assertEquals(classified.suppressFinalResponse, false);
});

Deno.test("classifyAgentFinalResponse suppresses raw tool-call JSON", () => {
  const classified = classifyAgentFinalResponse(
    '{"toolName":"read_file","args":{"path":"README.md"}}',
  );
  assertEquals(classified.orchestratorFailureCode, null);
  assertEquals(classified.suppressFinalResponse, true);
});

Deno.test("classifyAgentFinalResponse keeps normal text responses", () => {
  const classified = classifyAgentFinalResponse("All done.");
  assertEquals(classified.orchestratorFailureCode, null);
  assertEquals(classified.suppressFinalResponse, false);
});
