import { assertEquals } from "jsr:@std/assert";
import {
  extractTaskCapabilityContextFromTaskText,
  normalizeExecutionTaskCapabilityContext,
} from "../../../src/hlvm/agent/task-capability-context.ts";

Deno.test("task capability context: code.exec activates from deterministic inline-compute cues", () => {
  const context = extractTaskCapabilityContextFromTaskText(
    "Calculate the sha-256 and base64 output from this payload.",
  );

  assertEquals(context.requestedCapabilities, ["code.exec"]);
  assertEquals(context.source, "task-text");
  assertEquals(context.matchedCueLabels, ["calculate", "sha-256", "base64"]);
});

Deno.test("task capability context: generic research wording does not activate code.exec", () => {
  const context = extractTaskCapabilityContextFromTaskText(
    "Use the latest docs to explain the API changes.",
  );

  assertEquals(context.requestedCapabilities, []);
  assertEquals(context.source, "none");
  assertEquals(context.matchedCueLabels, []);
});

Deno.test("task capability context: normalize drops invalid capability ids", () => {
  const context = normalizeExecutionTaskCapabilityContext({
    requestedCapabilities: ["code.exec", "ignored"],
    source: "task-text",
    matchedCueLabels: ["compute", "quick script"],
  });

  assertEquals(context.requestedCapabilities, ["code.exec"]);
  assertEquals(context.source, "task-text");
  assertEquals(context.matchedCueLabels, ["compute", "quick script"]);
});
