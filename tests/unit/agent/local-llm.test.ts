import { assertEquals } from "jsr:@std/assert";
import {
  classifyBrowserAutomation,
  classifyBrowserFinalAnswer,
  classifyClarifyingQuestion,
  classifyDelegation,
  classifyErrorMessage,
  classifyFactConflicts,
  classifyFollowUp,
  classifyGroundedness,
  classifyPlanNeed,
  classifyPrematureFollowUp,
  classifyResponseIntent,
  classifySearchIntent,
  classifySensitiveContent,
  classifySourceAuthorities,
  classifyTask,
  classifyToolInstruction,
  extractJson,
  type FollowUpClassification,
  getLocalModelDisplayName,
  type ResponseIntentClassification,
  suggestRecoveryHint,
  type TaskClassification,
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

Deno.test("extractJson: nested JSON object", () => {
  const input = '{"a":{"b":1}}';
  assertEquals(extractJson(input), '{"a":{"b":1}}');
});

Deno.test("extractJson: nested JSON with preamble", () => {
  const input = 'Result: {"conflicts":[{"i":0,"s":0.8}]}';
  assertEquals(extractJson(input), '{"conflicts":[{"i":0,"s":0.8}]}');
});

Deno.test("extractJson: deeply nested JSON", () => {
  const input = '{"a":{"b":{"c":true},"d":2}}';
  assertEquals(extractJson(input), '{"a":{"b":{"c":true},"d":2}}');
});

Deno.test("extractJson: unmatched open brace returns empty", () => {
  assertEquals(extractJson("{unclosed"), "{}");
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
  assertEquals(result.isWorkingNote, false);
});

Deno.test("classifyResponseIntent: whitespace-only returns defaults", async () => {
  const result = await classifyResponseIntent("   ");
  assertEquals(result.asksQuestion, false);
  assertEquals(result.needsConcreteTask, false);
  assertEquals(result.isWorkingNote, false);
});

// ============================================================
// classifyPrematureFollowUp
// ============================================================

Deno.test("classifyPrematureFollowUp: empty response returns defaults", async () => {
  const result = await classifyPrematureFollowUp(
    "extract the code example",
    "",
  );
  assertEquals(result.shouldContinueWithoutAsking, false);
});

Deno.test("classifyPrematureFollowUp: heuristic catches optional continuation phrasing", async () => {
  const result = await classifyPrematureFollowUp(
    "Extract the first paragraph and the first code example.",
    'If you\'d like, I can open the "Using Fetch" guide and extract the first code example from there.',
  );
  assertEquals(result.shouldContinueWithoutAsking, true);
});

// ============================================================
// classifyPlanNeed (Step 1)
// ============================================================

Deno.test("classifyPlanNeed: empty query returns defaults (no LLM call)", async () => {
  const result = await classifyPlanNeed("");
  assertEquals(result.needsPlan, false);
});

Deno.test("classifyPlanNeed: whitespace-only returns defaults", async () => {
  const result = await classifyPlanNeed("   ");
  assertEquals(result.needsPlan, false);
});

// ============================================================
// classifyDelegation (Step 2)
// ============================================================

Deno.test("classifyDelegation: empty query returns defaults (no LLM call)", async () => {
  const result = await classifyDelegation("");
  assertEquals(result.shouldDelegate, false);
  assertEquals(result.pattern, "none");
});

Deno.test("classifyDelegation: whitespace-only returns defaults", async () => {
  const result = await classifyDelegation("   ");
  assertEquals(result.shouldDelegate, false);
  assertEquals(result.pattern, "none");
});

// ============================================================
// classifyToolInstruction (Step 3)
// ============================================================

Deno.test("classifyToolInstruction: empty text returns defaults (no LLM call)", async () => {
  const result = await classifyToolInstruction("");
  assertEquals(result.isInstruction, false);
});

Deno.test("classifyToolInstruction: whitespace-only returns defaults", async () => {
  const result = await classifyToolInstruction("   ");
  assertEquals(result.isInstruction, false);
});

// ============================================================
// classifyFactConflicts (Step 4)
// ============================================================

Deno.test("classifyFactConflicts: empty new fact returns defaults (no LLM call)", async () => {
  const result = await classifyFactConflicts("", ["old fact"]);
  assertEquals(result.conflicts.length, 0);
});

Deno.test("classifyFactConflicts: empty existing facts returns defaults", async () => {
  const result = await classifyFactConflicts("new fact", []);
  assertEquals(result.conflicts.length, 0);
});

// ============================================================
// classifyGroundedness (Step 5)
// ============================================================

Deno.test("classifyGroundedness: empty response returns defaults (no LLM call)", async () => {
  const result = await classifyGroundedness("", "tool data");
  assertEquals(result.incorporatesData, false);
});

Deno.test("classifyGroundedness: whitespace-only returns defaults", async () => {
  const result = await classifyGroundedness("   ", "tool data");
  assertEquals(result.incorporatesData, false);
});

// ============================================================
// classifySearchIntent (Step 6)
// ============================================================

Deno.test("classifySearchIntent: empty query returns defaults (no LLM call)", async () => {
  const result = await classifySearchIntent("");
  assertEquals(result.officialDocs, false);
  assertEquals(result.comparison, false);
  assertEquals(result.recency, false);
  assertEquals(result.versionSpecific, false);
  assertEquals(result.releaseNotes, false);
  assertEquals(result.reference, false);
});

Deno.test("classifySearchIntent: whitespace-only returns defaults", async () => {
  const result = await classifySearchIntent("   ");
  assertEquals(result.officialDocs, false);
});

// ============================================================
// classifyErrorMessage (Step 7)
// ============================================================

Deno.test("classifyErrorMessage: empty message returns defaults (no LLM call)", async () => {
  const result = await classifyErrorMessage("");
  assertEquals(result.errorClass, "unknown");
});

Deno.test("classifyErrorMessage: whitespace-only returns defaults", async () => {
  const result = await classifyErrorMessage("   ");
  assertEquals(result.errorClass, "unknown");
});

// ============================================================
// suggestRecoveryHint (Step 8)
// ============================================================

Deno.test("suggestRecoveryHint: empty message returns null (no LLM call)", async () => {
  const result = await suggestRecoveryHint("");
  assertEquals(result, null);
});

Deno.test("suggestRecoveryHint: whitespace-only returns null", async () => {
  const result = await suggestRecoveryHint("   ");
  assertEquals(result, null);
});

// ============================================================
// classifySensitiveContent (Step 9)
// ============================================================

Deno.test("classifySensitiveContent: empty text returns defaults (no LLM call)", async () => {
  const result = await classifySensitiveContent("");
  assertEquals(result.additionalPII, false);
  assertEquals(result.types.length, 0);
});

Deno.test("classifySensitiveContent: whitespace-only returns defaults", async () => {
  const result = await classifySensitiveContent("   ");
  assertEquals(result.additionalPII, false);
  assertEquals(result.types.length, 0);
});

// ============================================================
// classifySourceAuthorities (Step 10)
// ============================================================

Deno.test("classifySourceAuthorities: empty results returns defaults (no LLM call)", async () => {
  const result = await classifySourceAuthorities([]);
  assertEquals(result.results.length, 0);
});

// ============================================================
// Browser-specific classifiers
// ============================================================

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

Deno.test("classifyClarifyingQuestion: empty response returns defaults", async () => {
  const result = await classifyClarifyingQuestion("");
  assertEquals(result.isQuestion, false);
});
