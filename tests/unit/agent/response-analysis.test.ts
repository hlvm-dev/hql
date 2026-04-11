import { assertEquals } from "jsr:@std/assert";
import {
  analyzeAssistantResponse,
  extractTrailingQuestionText,
} from "../../../src/hlvm/agent/response-analysis.ts";

Deno.test("response analysis: extracts trailing binary follow-up question", () => {
  const analysis = analyzeAssistantResponse(
    "I've implemented the basic structure. Would you like me to continue with the tests?",
  );
  assertEquals(analysis.asksQuestion, true);
  assertEquals(
    analysis.question,
    "Would you like me to continue with the tests?",
  );
  assertEquals(analysis.isBinaryQuestion, true);
  assertEquals(analysis.isGenericConversational, false);
});

Deno.test("response analysis: rejects generic filler questions", () => {
  const analysis = analyzeAssistantResponse(
    "I've completed the task. Is there anything else I can help you with?",
  );
  assertEquals(analysis.asksQuestion, true);
  assertEquals(analysis.isGenericConversational, true);
});

Deno.test("response analysis: detects working notes", () => {
  const analysis = analyzeAssistantResponse("Now let me click the Issues tab:");
  assertEquals(analysis.isWorkingNote, true);
  assertEquals(analysis.asksQuestion, false);
});

Deno.test("response analysis: detects need for concrete task", () => {
  const analysis = analyzeAssistantResponse(
    "I'd be happy to help, but I need more specific instructions. Could you tell me exactly what you'd like me to build?",
  );
  assertEquals(analysis.needsConcreteTask, true);
  assertEquals(analysis.asksQuestion, true);
});

Deno.test("response analysis: extracts clarifying questions", () => {
  assertEquals(
    extractTrailingQuestionText(
      "I can help with that refactoring. Which file should I modify first?",
    ),
    "Which file should I modify first?",
  );
});

Deno.test("response analysis: detects continuation offers conservatively", () => {
  const analysis = analyzeAssistantResponse(
    'If you\'d like, I can open the "Using Fetch" guide and extract the first code example from there.',
  );
  assertEquals(analysis.isPrematureContinuationOffer, true);
});
