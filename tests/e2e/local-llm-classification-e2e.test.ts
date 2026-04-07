/**
 * Local LLM Classification E2E Tests — Real Gemma4 Calls
 *
 * Tests the full classification pipeline against the real local gemma4 model.
 * Verifies that classifyTask, classifyFollowUp, classifyResponseIntent
 * return correct semantic classifications (not just defaults).
 *
 * Requires: Ollama running on localhost:11439 with gemma4:e4b pulled.
 * Skips gracefully if Ollama is unavailable.
 *
 * Run: deno test -A tests/e2e/local-llm-classification-e2e.test.ts
 */

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  classifyFollowUp,
  classifyResponseIntent,
  classifyTask,
  extractJson,
  getLocalModelDisplayName,
} from "../../src/hlvm/runtime/local-llm.ts";
import { LOCAL_FALLBACK_MODEL_ID } from "../../src/hlvm/runtime/local-fallback.ts";
import { buildTaskProfile } from "../../src/hlvm/agent/auto-select.ts";
import { responseAsksQuestion } from "../../src/hlvm/agent/model-compat.ts";

// ============================================================
// Setup: Check Ollama availability on HLVM port
// ============================================================

const OLLAMA_PORT = 11439;
const TIMEOUT = 30_000; // 30s per test — classification is fast (~50-200ms)

const modelName = LOCAL_FALLBACK_MODEL_ID.split("/").pop() ?? "";
let gemmaAvailable = false;
try {
  const res = await fetch(`http://localhost:${OLLAMA_PORT}/api/tags`);
  if (res.ok) {
    const data = await res.json();
    gemmaAvailable = data.models?.some((m: { name: string }) =>
      m.name === modelName || m.name.startsWith(modelName)
    );
  }
} catch {
  // Ollama not running
}

function e2e(name: string, fn: () => Promise<void>) {
  Deno.test({
    name: `[E2E] local-llm: ${name}`,
    ignore: !gemmaAvailable,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT);
      try {
        await fn();
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

// ============================================================
// classifyTask — code detection
// ============================================================

e2e("classifyTask: 'write a fibonacci function' is code", async () => {
  const result = await classifyTask("write a fibonacci function in Python");
  assertEquals(result.isCodeTask, true, "Should detect code task");
});

e2e("classifyTask: 'debug this null pointer exception' is code", async () => {
  const result = await classifyTask("debug this null pointer exception in my Java code");
  assertEquals(result.isCodeTask, true, "Should detect code/debug task");
});

e2e("classifyTask: 'what is the weather today' is NOT code", async () => {
  const result = await classifyTask("what is the weather today in Seoul");
  assertEquals(result.isCodeTask, false, "Weather question is not code");
});

// ============================================================
// classifyTask — reasoning detection
// ============================================================

e2e("classifyTask: 'prove sqrt(2) is irrational' is reasoning", async () => {
  const result = await classifyTask("prove that the square root of 2 is irrational");
  assertEquals(result.isReasoningTask, true, "Should detect reasoning task");
});

e2e("classifyTask: 'compare pros and cons of React vs Vue' is reasoning", async () => {
  const result = await classifyTask(
    "compare the pros and cons of React vs Vue for a large enterprise app, analyze tradeoffs",
  );
  assertEquals(result.isReasoningTask, true, "Should detect analytical reasoning");
});

e2e("classifyTask: 'say hello' is NOT reasoning", async () => {
  const result = await classifyTask("say hello");
  assertEquals(result.isReasoningTask, false, "Simple greeting is not reasoning");
});

// ============================================================
// classifyTask — structured output detection
// ============================================================

e2e("classifyTask: 'output as JSON' needs structured output", async () => {
  const result = await classifyTask("list the top 5 programming languages and output as JSON");
  assertEquals(result.needsStructuredOutput, true, "Should detect structured output need");
});

e2e("classifyTask: 'create a CSV table' needs structured output", async () => {
  const result = await classifyTask("create a CSV table of country populations");
  assertEquals(result.needsStructuredOutput, true, "Should detect CSV/table as structured");
});

e2e("classifyTask: 'tell me a joke' does NOT need structured output", async () => {
  const result = await classifyTask("tell me a funny joke");
  assertEquals(result.needsStructuredOutput, false, "Joke does not need structured output");
});

// ============================================================
// classifyFollowUp — binary question detection
// ============================================================

e2e("classifyFollowUp: 'Would you like me to continue?' is binary follow-up", async () => {
  const result = await classifyFollowUp(
    "I've implemented the basic structure. Would you like me to continue with the tests?",
  );
  assertEquals(result.asksFollowUp, true, "Should detect follow-up question");
  assertEquals(result.isBinaryQuestion, true, "Should detect binary (yes/no) question");
});

e2e("classifyFollowUp: 'Should I refactor this?' is binary follow-up", async () => {
  const result = await classifyFollowUp(
    "The function works but is a bit messy. Should I refactor this to be cleaner?",
  );
  assertEquals(result.asksFollowUp, true, "Should detect follow-up");
  assertEquals(result.isBinaryQuestion, true, "Should detect yes/no question");
});

// ============================================================
// classifyFollowUp — generic conversational detection
// ============================================================

e2e("classifyFollowUp: 'Is there anything else?' is generic", async () => {
  const result = await classifyFollowUp(
    "I've completed the task. Is there anything else I can help you with?",
  );
  assertEquals(result.isGenericConversational, true, "Should detect generic filler");
});

e2e("classifyFollowUp: 'Do you need help with anything else?' is generic", async () => {
  const result = await classifyFollowUp(
    "Here's the result. Do you need help with anything else?",
  );
  assertEquals(result.isGenericConversational, true, "Should detect generic conversational");
});

// ============================================================
// classifyFollowUp — no follow-up
// ============================================================

e2e("classifyFollowUp: plain answer has no follow-up", async () => {
  const result = await classifyFollowUp(
    "The capital of France is Paris. It has been the capital since the 10th century.",
  );
  assertEquals(result.asksFollowUp, false, "Plain statement should not be follow-up");
});

// ============================================================
// classifyResponseIntent — asks question
// ============================================================

e2e("classifyResponseIntent: 'Which file should I modify?' asks a question", async () => {
  const result = await classifyResponseIntent(
    "I can help with that refactoring. Which file should I modify first?",
  );
  assertEquals(result.asksQuestion, true, "Should detect question to user");
});

e2e("classifyResponseIntent: plain answer does not ask question", async () => {
  const result = await classifyResponseIntent(
    "Here is the fibonacci function implemented in Python.",
  );
  assertEquals(result.asksQuestion, false, "Plain answer should not be flagged as question");
});

// ============================================================
// classifyResponseIntent — needs concrete task
// ============================================================

e2e("classifyResponseIntent: 'I need more specific instructions' needs task", async () => {
  const result = await classifyResponseIntent(
    "I'd be happy to help, but I need more specific instructions. Could you tell me exactly what you'd like me to build?",
  );
  assertEquals(result.needsConcreteTask, true, "Should detect need for concrete task");
});

e2e("classifyResponseIntent: concrete answer does NOT need task", async () => {
  const result = await classifyResponseIntent(
    "I've created the login form with email and password fields. The validation checks for valid email format and minimum 8 characters.",
  );
  assertEquals(result.needsConcreteTask, false, "Concrete answer does not need more task info");
});

// ============================================================
// responseAsksQuestion (model-compat.ts) — integration
// ============================================================

e2e("responseAsksQuestion: question mark response detected", async () => {
  const result = await responseAsksQuestion(
    "I can implement that feature. Do you want me to start with the backend or frontend?",
  );
  assertEquals(result, true, "Should detect question in response");
});

e2e("responseAsksQuestion: statement without question", async () => {
  const result = await responseAsksQuestion(
    "Done. The function now handles edge cases correctly.",
  );
  assertEquals(result, false, "Statement should not be detected as question");
});

// ============================================================
// buildTaskProfile — full pipeline integration
// ============================================================

e2e("buildTaskProfile: code query sets isCodeTask=true", async () => {
  const profile = await buildTaskProfile("implement a REST API endpoint for user authentication");
  assertEquals(profile.isCodeTask, true, "Should classify as code task via LLM");
});

e2e("buildTaskProfile: reasoning query sets isReasoningTask=true", async () => {
  const profile = await buildTaskProfile(
    "analyze the time complexity of merge sort vs quicksort and prove which is better for nearly-sorted data",
  );
  assertEquals(profile.isReasoningTask, true, "Should classify as reasoning task via LLM");
});

e2e("buildTaskProfile: JSON output query sets needsStructuredOutput=true", async () => {
  const profile = await buildTaskProfile("generate a JSON schema for a user profile with name, email, and age");
  assertEquals(profile.needsStructuredOutput, true, "Should classify as structured output via LLM");
});

e2e("buildTaskProfile: casual chat has no special flags", async () => {
  const profile = await buildTaskProfile("hello, how are you today?");
  assertEquals(profile.isCodeTask, false, "Greeting is not code");
  assertEquals(profile.isReasoningTask, false, "Greeting is not reasoning");
  assertEquals(profile.needsStructuredOutput, false, "Greeting does not need structured output");
});

// ============================================================
// extractJson — edge cases with real LLM output patterns
// ============================================================

Deno.test("[E2E] local-llm: extractJson handles nested JSON (known limitation)", () => {
  // This documents the known P1 limitation
  const nested = '{"outer":{"inner":true}}';
  const result = extractJson(nested);
  // Current regex /\{[^}]+\}/ can't handle nested braces — extracts partial
  // This test documents the current behavior, not the desired behavior
  assert(result.startsWith("{"), "Should extract something starting with {");
  // NOTE: result will be '{"outer":{"inner":true}' or partial — this is the known bug
});

Deno.test("[E2E] local-llm: extractJson handles real LLM output patterns", () => {
  // Pattern 1: clean JSON (most common with temperature=0)
  assertEquals(extractJson('{"code":true,"reasoning":false,"structured":false}'),
    '{"code":true,"reasoning":false,"structured":false}');

  // Pattern 2: markdown fences
  assertEquals(extractJson('```json\n{"code":true}\n```'), '{"code":true}');

  // Pattern 3: preamble text
  assertEquals(extractJson('Here is the classification: {"code":false,"reasoning":true,"structured":false}'),
    '{"code":false,"reasoning":true,"structured":false}');

  // Pattern 4: trailing explanation
  assertEquals(extractJson('{"asks":true,"binary":true,"generic":false}\nThe response asks...'),
    '{"asks":true,"binary":true,"generic":false}');
});

// ============================================================
// getLocalModelDisplayName — SSOT verification
// ============================================================

Deno.test("[E2E] local-llm: getLocalModelDisplayName matches actual model", () => {
  const name = getLocalModelDisplayName();
  // Should be "Gemma4" derived from "ollama/gemma4:e4b"
  assert(name.length > 0, "Display name should not be empty");
  assert(name[0] === name[0].toUpperCase(), "Should be capitalized");
  assert(!name.includes("/"), "Should not contain provider prefix");
  assert(!name.includes(":"), "Should not contain tag");
  // The actual model name should be a substring (case-insensitive) of the model ID
  assert(
    LOCAL_FALLBACK_MODEL_ID.toLowerCase().includes(name.toLowerCase()),
    `Display name '${name}' should derive from model ID '${LOCAL_FALLBACK_MODEL_ID}'`,
  );
});
