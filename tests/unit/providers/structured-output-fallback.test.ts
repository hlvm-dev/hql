/**
 * Unit tests for structured-output-fallback.ts pure functions.
 *
 * Tests extractJsonFromResponse, validateAgainstSchema, repairJson.
 * No LLM calls — these are pure function tests.
 */

import { assertEquals } from "jsr:@std/assert";
import {
  extractJsonFromResponse,
  repairJson,
  validateAgainstSchema,
} from "../../../src/hlvm/providers/structured-output-fallback.ts";

// ============================================================================
// extractJsonFromResponse
// ============================================================================

Deno.test("extractJsonFromResponse: markdown json fence", () => {
  const text = 'Here is the result:\n```json\n{"name": "Alice", "age": 30}\n```\nDone.';
  assertEquals(extractJsonFromResponse(text), '{"name": "Alice", "age": 30}');
});

Deno.test("extractJsonFromResponse: bare fence", () => {
  const text = 'Result:\n```\n{"key": "value"}\n```';
  assertEquals(extractJsonFromResponse(text), '{"key": "value"}');
});

Deno.test("extractJsonFromResponse: bare JSON in prose", () => {
  const text = 'The answer is {"name": "Bob", "score": 42} as requested.';
  assertEquals(extractJsonFromResponse(text), '{"name": "Bob", "score": 42}');
});

Deno.test("extractJsonFromResponse: text with nested braces", () => {
  const text = '{"outer": {"inner": true}}';
  assertEquals(extractJsonFromResponse(text), '{"outer": {"inner": true}}');
});

Deno.test("extractJsonFromResponse: no JSON returns null", () => {
  assertEquals(extractJsonFromResponse("No JSON here at all"), null);
});

Deno.test("extractJsonFromResponse: only opening brace returns null", () => {
  assertEquals(extractJsonFromResponse("This has { but no close"), null);
});

Deno.test("extractJsonFromResponse: array JSON", () => {
  const text = '```json\n[1, 2, 3]\n```';
  assertEquals(extractJsonFromResponse(text), "[1, 2, 3]");
});

// ============================================================================
// validateAgainstSchema
// ============================================================================

Deno.test("validateAgainstSchema: valid object with correct types", () => {
  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number" },
      active: { type: "boolean" },
    },
    required: ["name", "age"],
  };
  const result = validateAgainstSchema({ name: "Alice", age: 30, active: true }, schema);
  assertEquals(result.valid, true);
  assertEquals(result.error, undefined);
});

Deno.test("validateAgainstSchema: missing required key", () => {
  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number" },
    },
    required: ["name", "age"],
  };
  const result = validateAgainstSchema({ name: "Alice" }, schema);
  assertEquals(result.valid, false);
  assertEquals(result.error, 'Missing required key: "age"');
});

Deno.test("validateAgainstSchema: wrong type", () => {
  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number" },
    },
  };
  const result = validateAgainstSchema({ name: "Alice", age: "thirty" }, schema);
  assertEquals(result.valid, false);
  assertEquals(result.error, 'Key "age": expected number, got string');
});

Deno.test("validateAgainstSchema: non-object input", () => {
  const schema = { type: "object", properties: {} };
  const result = validateAgainstSchema("not an object", schema);
  assertEquals(result.valid, false);
  assertEquals(result.error, "Expected a JSON object, got string");
});

Deno.test("validateAgainstSchema: null input", () => {
  const schema = { type: "object", properties: {} };
  const result = validateAgainstSchema(null, schema);
  assertEquals(result.valid, false);
  assertEquals(result.error, "Expected a JSON object, got object");
});

Deno.test("validateAgainstSchema: extra keys beyond schema are allowed", () => {
  const schema = {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  };
  const result = validateAgainstSchema({ name: "Alice", extra: 99 }, schema);
  assertEquals(result.valid, true);
});

Deno.test("validateAgainstSchema: array type check", () => {
  const schema = {
    type: "object",
    properties: {
      items: { type: "array" },
    },
  };
  assertEquals(validateAgainstSchema({ items: [1, 2, 3] }, schema).valid, true);
  assertEquals(validateAgainstSchema({ items: "not array" }, schema).valid, false);
});

// ============================================================================
// repairJson
// ============================================================================

Deno.test("repairJson: trailing commas", () => {
  const broken = '{"name": "Alice", "age": 30,}';
  const repaired = repairJson(broken);
  assertEquals(JSON.parse(repaired), { name: "Alice", age: 30 });
});

Deno.test("repairJson: missing closing brace", () => {
  const broken = '{"name": "Alice"';
  const repaired = repairJson(broken);
  assertEquals(JSON.parse(repaired), { name: "Alice" });
});

Deno.test("repairJson: missing closing bracket in array", () => {
  const broken = '{"items": [1, 2, 3}';
  const repaired = repairJson(broken);
  assertEquals(JSON.parse(repaired), { items: [1, 2, 3] });
});

Deno.test("repairJson: multiple missing closers", () => {
  const broken = '{"a": [1, {"b": 2';
  const repaired = repairJson(broken);
  assertEquals(JSON.parse(repaired), { a: [1, { b: 2 }] });
});
