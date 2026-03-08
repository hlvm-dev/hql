import { assertEquals } from "jsr:@std/assert";
import {
  AGENT_ORCHESTRATOR_FAILURE_MESSAGES,
  classifyAgentFinalResponse,
  createStreamingResponseSanitizer,
  looksLikePlanEnvelope,
  stripPlanEnvelopeBlocks,
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

Deno.test("classifyAgentFinalResponse suppresses PLAN envelopes", () => {
  const classified = classifyAgentFinalResponse(`PLAN
{"goal":"Research","steps":[{"id":"step-1","title":"Check docs"}]}
END_PLAN`);
  assertEquals(classified.orchestratorFailureCode, null);
  assertEquals(classified.suppressFinalResponse, true);
  assertEquals(looksLikePlanEnvelope(`PLAN
{"goal":"Research","steps":[{"id":"step-1","title":"Check docs"}]}
END_PLAN`), true);
});

Deno.test("createStreamingResponseSanitizer removes leading PLAN envelope and preserves final text", () => {
  const sanitizer = createStreamingResponseSanitizer();
  assertEquals(sanitizer.push("PLAN\n{\"goal\":\"Research\""), "");
  assertEquals(sanitizer.push(",\"steps\":[]}\nEND_"), "");
  assertEquals(sanitizer.push("PLAN\nSource URL: https://example.com\n"), "Source URL: https://example.com\n");
  assertEquals(sanitizer.flush(), "");
});

Deno.test("createStreamingResponseSanitizer preserves normal streamed text", () => {
  const sanitizer = createStreamingResponseSanitizer();
  assertEquals(sanitizer.push("Source URL: "), "Source URL: ");
  assertEquals(sanitizer.push("https://example.com"), "https://example.com");
  assertEquals(sanitizer.flush(), "");
});

Deno.test("stripPlanEnvelopeBlocks removes planner blocks from mixed final text", () => {
  const stripped = stripPlanEnvelopeBlocks(`PLAN
{"goal":"Research","steps":[{"id":"step-1","title":"Check docs"}]}
END_PLAN
Source URL: https://example.com`);
  assertEquals(stripped, "Source URL: https://example.com");
});

Deno.test("classifyAgentFinalResponse keeps normal text responses", () => {
  const classified = classifyAgentFinalResponse("All done.");
  assertEquals(classified.orchestratorFailureCode, null);
  assertEquals(classified.suppressFinalResponse, false);
});
