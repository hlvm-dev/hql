import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import {
  deriveExecutionResponseShapeContextFromSchema,
  normalizeExecutionResponseShapeContext,
  summarizeExecutionResponseShapeContext,
} from "../../../src/hlvm/agent/response-shape-context.ts";

Deno.test("response shape context: schema presence creates requested context", () => {
  const context = deriveExecutionResponseShapeContextFromSchema({
    type: "object",
    properties: {
      answer: { type: "string" },
      confidence: { type: "number" },
    },
  });

  assertEquals(context.requested, true);
  assertEquals(context.source, "request");
  assertEquals(context.topLevelKeys, ["properties", "type"]);
  assertEquals(typeof context.schemaSignature, "string");
});

Deno.test("response shape context: schema signature changes when schema changes", () => {
  const first = deriveExecutionResponseShapeContextFromSchema({
    type: "object",
    properties: {
      answer: { type: "string" },
    },
  });
  const second = deriveExecutionResponseShapeContextFromSchema({
    type: "object",
    properties: {
      answer: { type: "string" },
      confidence: { type: "number" },
    },
  });

  assertNotEquals(first.schemaSignature, second.schemaSignature);
});

Deno.test("response shape context: normalization rejects invalid values", () => {
  assertEquals(
    normalizeExecutionResponseShapeContext("bad"),
    {
      requested: false,
      source: "none",
      topLevelKeys: [],
    },
  );
});

Deno.test("response shape context: summary reflects requested schema", () => {
  const summary = summarizeExecutionResponseShapeContext({
    requested: true,
    source: "request",
    schemaSignature: "sig-1",
    topLevelKeys: ["answer", "confidence"],
  });

  assertEquals(summary, "requested · keys=answer, confidence · sig=sig-1");
});
