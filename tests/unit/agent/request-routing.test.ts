import { assertEquals } from "jsr:@std/assert";
import {
  computeRoutingResult,
  delegationSignalFromRoutingResult,
} from "../../../src/hlvm/agent/request-routing.ts";

Deno.test("computeRoutingResult: enhanced plain coding request stays self-directed", async () => {
  const result = await computeRoutingResult({
    query: "fix the bug in auth.ts",
    tier: "enhanced",
  });

  assertEquals(result.behavior, "self_directed");
  assertEquals(result.taskDomain, "general");
  assertEquals(result.shouldDelegate, false);
  assertEquals(result.delegatePattern, "none");
  assertEquals(result.needsPlan, false);
  assertEquals(result.taskClassification, null);
});

Deno.test("computeRoutingResult: enhanced obvious browser URL uses structural browser domain", async () => {
  const result = await computeRoutingResult({
    query: "open https://example.com and inspect the page",
    tier: "enhanced",
  });

  assertEquals(result.behavior, "self_directed");
  assertEquals(result.taskDomain, "browser");
  assertEquals(result.shouldDelegate, false);
});

Deno.test("computeRoutingResult: enhanced multi-file request uses structural fan-out", async () => {
  const result = await computeRoutingResult({
    query: "patch src/a.ts src/b.ts src/c.ts the same way",
    tier: "enhanced",
  });

  assertEquals(result.behavior, "self_directed");
  assertEquals(result.taskDomain, "general");
  assertEquals(result.shouldDelegate, true);
  assertEquals(result.delegatePattern, "fan-out");
  assertEquals(result.estimatedSubtasks, 3);
});

Deno.test("computeRoutingResult: enhanced ignores precomputed semantic routing fields", async () => {
  const result = await computeRoutingResult({
    query: "fix auth.ts",
    tier: "enhanced",
    preComputedClassification: {
      isBrowser: true,
      shouldDelegate: true,
      delegatePattern: "batch",
      needsPlan: true,
      taskClassification: {
        isCodeTask: true,
        isReasoningTask: true,
        needsStructuredOutput: true,
      },
    },
  });

  assertEquals(result.behavior, "self_directed");
  assertEquals(result.taskDomain, "general");
  assertEquals(result.shouldDelegate, false);
  assertEquals(result.delegatePattern, "none");
  assertEquals(result.needsPlan, false);
  assertEquals(result.taskClassification, null);
});

Deno.test("computeRoutingResult: standard reuses precomputed assisted classification", async () => {
  const result = await computeRoutingResult({
    query: "review the code and return JSON",
    tier: "standard",
    preComputedClassification: {
      isBrowser: false,
      shouldDelegate: true,
      delegatePattern: "batch",
      needsPlan: true,
      taskClassification: {
        isCodeTask: true,
        isReasoningTask: false,
        needsStructuredOutput: true,
      },
    },
  });

  assertEquals(result.behavior, "assisted");
  assertEquals(result.shouldDelegate, true);
  assertEquals(result.delegatePattern, "batch");
  assertEquals(result.needsPlan, true);
  assertEquals(result.taskClassification?.isCodeTask, true);
  assertEquals(result.taskClassification?.needsStructuredOutput, true);
});

Deno.test("computeRoutingResult: main-thread query source stays non-delegating", async () => {
  const result = await computeRoutingResult({
    query: "open https://example.com in parallel",
    tier: "standard",
    querySource: "repl_main_thread",
    preComputedClassification: {
      isBrowser: true,
      shouldDelegate: true,
      delegatePattern: "fan-out",
      needsPlan: true,
      taskClassification: {
        isCodeTask: false,
        isReasoningTask: false,
        needsStructuredOutput: false,
      },
    },
  });

  assertEquals(result.taskDomain, "general");
  assertEquals(result.shouldDelegate, false);
  assertEquals(result.delegatePattern, "none");
  assertEquals(result.needsPlan, true);
});

Deno.test("delegationSignalFromRoutingResult preserves task-domain compatibility", () => {
  const signal = delegationSignalFromRoutingResult({
    tier: "standard",
    behavior: "assisted",
    provenance: "assisted_classify_all",
    taskDomain: "browser",
    shouldDelegate: false,
    delegatePattern: "none",
    needsPlan: false,
    taskClassification: null,
    reason: "browser detected",
  });

  assertEquals(signal.taskDomain, "browser");
  assertEquals(signal.shouldDelegate, false);
  assertEquals(signal.reason, "browser detected");
});
