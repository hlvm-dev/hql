import { assertEquals } from "jsr:@std/assert";
import {
  classifyFollowUp,
  classifyResponseIntent,
  classifyTask,
  extractJson,
  getLocalModelDisplayName,
  type TaskClassification,
  type FollowUpClassification,
  type ResponseIntentClassification,
} from "../../../src/hlvm/runtime/local-llm.ts";
import { LOCAL_FALLBACK_MODEL_ID } from "../../../src/hlvm/runtime/local-fallback.ts";
import { DEFAULT_MODEL_ID } from "../../../src/common/config/types.ts";

// ============================================================
// getLocalModelDisplayName
// ============================================================

Deno.test("getLocalModelDisplayName: derives from LOCAL_FALLBACK_MODEL_ID", () => {
  const name = getLocalModelDisplayName();
  // "ollama/gemma4:e4b" → "Gemma4"
  const expected = (() => {
    const raw = LOCAL_FALLBACK_MODEL_ID.split("/").pop() ?? "";
    const base = raw.split(":")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  })();
  assertEquals(name, expected);
});

Deno.test("getLocalModelDisplayName: no hardcoded 'Gemma 4'", () => {
  const name = getLocalModelDisplayName();
  // Should not have a space (it's derived programmatically)
  assertEquals(name.includes("Gemma 4"), false);
});

Deno.test("getLocalModelDisplayName: capitalized, no provider prefix, no tag", () => {
  const name = getLocalModelDisplayName();
  assertEquals(name[0], name[0].toUpperCase());
  assertEquals(name.includes("/"), false);
  assertEquals(name.includes(":"), false);
});

// ============================================================
// SSOT Chain
// ============================================================

Deno.test("DEFAULT_MODEL_ID derives from LOCAL_FALLBACK_MODEL_ID", () => {
  assertEquals(DEFAULT_MODEL_ID, LOCAL_FALLBACK_MODEL_ID);
});

// ============================================================
// extractJson
// ============================================================

Deno.test("extractJson: clean JSON object", () => {
  assertEquals(extractJson('{"code":true}'), '{"code":true}');
});

Deno.test("extractJson: JSON with preamble", () => {
  const input = 'Here is the classification: {"code":true,"reasoning":false}';
  assertEquals(extractJson(input), '{"code":true,"reasoning":false}');
});

Deno.test("extractJson: JSON in markdown fences", () => {
  const input = '```json\n{"code":false}\n```';
  assertEquals(extractJson(input), '{"code":false}');
});

Deno.test("extractJson: no JSON returns empty object", () => {
  assertEquals(extractJson("just some text"), "{}");
});

Deno.test("extractJson: empty string returns empty object", () => {
  assertEquals(extractJson(""), "{}");
});

Deno.test("extractJson: only first object extracted", () => {
  const input = '{"a":1} and {"b":2}';
  assertEquals(extractJson(input), '{"a":1}');
});

// ============================================================
// classifyTask
// ============================================================

Deno.test("classifyTask: empty query returns defaults (no LLM call)", async () => {
  const result = await classifyTask("");
  assertEquals(result.isCodeTask, false);
  assertEquals(result.isReasoningTask, false);
  assertEquals(result.needsStructuredOutput, false);
});

Deno.test("classifyTask: whitespace-only returns defaults", async () => {
  const result = await classifyTask("   ");
  assertEquals(result.isCodeTask, false);
  assertEquals(result.isReasoningTask, false);
  assertEquals(result.needsStructuredOutput, false);
});

// ============================================================
// classifyFollowUp
// ============================================================

Deno.test("classifyFollowUp: empty response returns defaults (no LLM call)", async () => {
  const result = await classifyFollowUp("");
  assertEquals(result.asksFollowUp, false);
  assertEquals(result.isBinaryQuestion, false);
  assertEquals(result.isGenericConversational, false);
});

Deno.test("classifyFollowUp: whitespace-only returns defaults", async () => {
  const result = await classifyFollowUp("   ");
  assertEquals(result.asksFollowUp, false);
  assertEquals(result.isBinaryQuestion, false);
  assertEquals(result.isGenericConversational, false);
});

// ============================================================
// classifyResponseIntent
// ============================================================

Deno.test("classifyResponseIntent: empty response returns defaults (no LLM call)", async () => {
  const result = await classifyResponseIntent("");
  assertEquals(result.asksQuestion, false);
  assertEquals(result.needsConcreteTask, false);
});

Deno.test("classifyResponseIntent: whitespace-only returns defaults", async () => {
  const result = await classifyResponseIntent("   ");
  assertEquals(result.asksQuestion, false);
  assertEquals(result.needsConcreteTask, false);
});
