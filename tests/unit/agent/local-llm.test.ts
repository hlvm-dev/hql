import { assertEquals } from "jsr:@std/assert";
import {
  classifyBrowserAutomation,
  classifyBrowserFinalAnswer,
  classifyDelegation,
  classifyFactConflicts,
  classifyGroundedness,
  classifyPlanNeed,
  classifySourceAuthorities,
  classifyTask,
  extractJson,
  getLocalModelDisplayName,
} from "../../../src/hlvm/runtime/local-llm.ts";
import { LOCAL_FALLBACK_MODEL_ID } from "../../../src/hlvm/runtime/local-fallback.ts";
import { DEFAULT_MODEL_ID } from "../../../src/common/config/types.ts";

Deno.test("getLocalModelDisplayName: derives from LOCAL_FALLBACK_MODEL_ID", () => {
  const name = getLocalModelDisplayName();
  const expected = (() => {
    const raw = LOCAL_FALLBACK_MODEL_ID.split("/").pop() ?? "";
    const base = raw.split(":")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  })();
  assertEquals(name, expected);
});

Deno.test("getLocalModelDisplayName: no hardcoded 'Gemma 4'", () => {
  const name = getLocalModelDisplayName();
  assertEquals(name.includes("Gemma 4"), false);
});

Deno.test("getLocalModelDisplayName: capitalized, no provider prefix, no tag", () => {
  const name = getLocalModelDisplayName();
  assertEquals(name[0], name[0].toUpperCase());
  assertEquals(name.includes("/"), false);
  assertEquals(name.includes(":"), false);
});

Deno.test("DEFAULT_MODEL_ID derives from LOCAL_FALLBACK_MODEL_ID", () => {
  assertEquals(DEFAULT_MODEL_ID, LOCAL_FALLBACK_MODEL_ID);
});

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

Deno.test("extractJson: nested JSON object", () => {
  const input = '{"a":{"b":1}}';
  assertEquals(extractJson(input), '{"a":{"b":1}}');
});

Deno.test("extractJson: unmatched open brace returns empty", () => {
  assertEquals(extractJson("{unclosed"), "{}");
});

Deno.test("classifyTask: empty query returns defaults", async () => {
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

Deno.test("classifyPlanNeed: empty query returns defaults", async () => {
  const result = await classifyPlanNeed("");
  assertEquals(result.needsPlan, false);
});

Deno.test("classifyPlanNeed: whitespace-only returns defaults", async () => {
  const result = await classifyPlanNeed("   ");
  assertEquals(result.needsPlan, false);
});

Deno.test("classifyDelegation: empty query returns defaults", async () => {
  const result = await classifyDelegation("");
  assertEquals(result.shouldDelegate, false);
  assertEquals(result.pattern, "none");
});

Deno.test("classifyDelegation: whitespace-only returns defaults", async () => {
  const result = await classifyDelegation("   ");
  assertEquals(result.shouldDelegate, false);
  assertEquals(result.pattern, "none");
});

Deno.test("classifyFactConflicts: empty new fact returns defaults", async () => {
  const result = await classifyFactConflicts("", ["old fact"]);
  assertEquals(result.conflicts.length, 0);
});

Deno.test("classifyFactConflicts: empty existing facts returns defaults", async () => {
  const result = await classifyFactConflicts("new fact", []);
  assertEquals(result.conflicts.length, 0);
});

Deno.test("classifyGroundedness: empty response returns defaults", async () => {
  const result = await classifyGroundedness("", "tool data");
  assertEquals(result.incorporatesData, false);
});

Deno.test("classifyGroundedness: whitespace-only returns defaults", async () => {
  const result = await classifyGroundedness("   ", "tool data");
  assertEquals(result.incorporatesData, false);
});

Deno.test("classifySourceAuthorities: empty results returns defaults", async () => {
  const result = await classifySourceAuthorities([]);
  assertEquals(result.results.length, 0);
});

Deno.test("classifyBrowserAutomation: empty request returns defaults", async () => {
  const result = await classifyBrowserAutomation("");
  assertEquals(result.isBrowserTask, false);
});

Deno.test("classifyBrowserFinalAnswer: empty response returns incomplete", async () => {
  const result = await classifyBrowserFinalAnswer(
    "Download the latest installer",
    "",
  );
  assertEquals(result.isComplete, false);
});
