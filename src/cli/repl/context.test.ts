/**
 * Unit tests for REPL context management
 * Tests paste variables, conversation context, and syntax transformation
 */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  // Context management
  getContext,
  resetContext,
  // Paste variables
  registerPaste,
  registerAttachments,
  getPaste,
  getPasteIds,
  // Conversation
  recordUserInput,
  recordAssistantResponse,
  formatConversation,
  getConversation,
  // Syntax transformation
  transformPasteReferences,
  transformContextReferences,
  preprocessCode,
  // Code generation
  generatePasteBindings,
  generateContextBindings,
  escapeHqlString,
} from "./context.ts";
import { createTextAttachment } from "./attachment.ts";
import type { AnyAttachment } from "./attachment-protocol.ts";

// ============================================================================
// Setup & Teardown
// ============================================================================

function setup() {
  resetContext();
}

// ============================================================================
// Paste Variables Tests
// ============================================================================

Deno.test("registerPaste - registers paste and makes accessible", () => {
  setup();
  const attachment = createTextAttachment("Hello, World!", 1);
  registerPaste(attachment);

  assertEquals(getPaste(1), "Hello, World!");
  assert(getPasteIds().includes(1));
});

Deno.test("registerPaste - sets on globalThis", () => {
  setup();
  const attachment = createTextAttachment("Test content", 1);
  registerPaste(attachment);

  const g = globalThis as Record<string, unknown>;
  assertEquals(g["paste-1"], "Test content");
  assertEquals(g["paste_1"], "Test content");
});

Deno.test("registerPaste - multiple pastes with unique IDs", () => {
  setup();
  registerPaste(createTextAttachment("First paste", 1));
  registerPaste(createTextAttachment("Second paste", 2));
  registerPaste(createTextAttachment("Third paste", 3));

  assertEquals(getPaste(1), "First paste");
  assertEquals(getPaste(2), "Second paste");
  assertEquals(getPaste(3), "Third paste");
  assertEquals(getPasteIds().sort(), [1, 2, 3]);
});

Deno.test("registerAttachments - filters text attachments only", () => {
  setup();
  const textAtt = createTextAttachment("Text content\nLine 2\nLine 3\nLine 4\nLine 5", 1);

  // Mock a media attachment (simplified)
  const mediaAtt = {
    id: 2,
    type: "image" as const,
    displayName: "[Image #2]",
    path: "/test.png",
    fileName: "test.png",
    mimeType: "image/png",
    base64Data: "abc123",
    size: 100,
  };

  registerAttachments([textAtt, mediaAtt] as AnyAttachment[]);

  assertEquals(getPaste(1), "Text content\nLine 2\nLine 3\nLine 4\nLine 5");
  assertEquals(getPaste(2), undefined); // Media not registered as paste
});

Deno.test("resetContext - clears all pastes", () => {
  setup();
  registerPaste(createTextAttachment("Test", 1));
  registerPaste(createTextAttachment("Test 2", 2));

  resetContext();

  assertEquals(getPaste(1), undefined);
  assertEquals(getPaste(2), undefined);
  assertEquals(getPasteIds().length, 0);
});

// ============================================================================
// Conversation Context Tests
// ============================================================================

Deno.test("recordUserInput - stores input and updates globalThis", () => {
  setup();
  recordUserInput("What is 2 + 2?");

  const ctx = getContext();
  assertEquals(ctx.lastInput, "What is 2 + 2?");

  const g = globalThis as Record<string, unknown>;
  assertEquals(g["last-input"], "What is 2 + 2?");
  assertEquals(g["last_input"], "What is 2 + 2?");
});

Deno.test("recordAssistantResponse - stores response and updates globalThis", () => {
  setup();
  recordAssistantResponse("The answer is 4.");

  const ctx = getContext();
  assertEquals(ctx.lastResponse, "The answer is 4.");

  const g = globalThis as Record<string, unknown>;
  assertEquals(g["last-response"], "The answer is 4.");
  assertEquals(g["last_response"], "The answer is 4.");
});

Deno.test("conversation history - tracks multiple turns", () => {
  setup();
  recordUserInput("Hello");
  recordAssistantResponse("Hi there!");
  recordUserInput("What's the weather?");
  recordAssistantResponse("I'm not sure, I can't check weather.");

  const conversation = getConversation();
  assertEquals(conversation.length, 4);
  assertEquals(conversation[0].role, "user");
  assertEquals(conversation[0].content, "Hello");
  assertEquals(conversation[1].role, "assistant");
  assertEquals(conversation[1].content, "Hi there!");
  assertEquals(conversation[2].role, "user");
  assertEquals(conversation[3].role, "assistant");
});

Deno.test("formatConversation - formats as readable string", () => {
  setup();
  recordUserInput("Question 1");
  recordAssistantResponse("Answer 1");
  recordUserInput("Question 2");

  const formatted = formatConversation();
  assert(formatted.includes("User: Question 1"));
  assert(formatted.includes("Assistant: Answer 1"));
  assert(formatted.includes("User: Question 2"));
});

Deno.test("conversation global - available on globalThis", () => {
  setup();
  recordUserInput("Test input");
  recordAssistantResponse("Test response");

  const g = globalThis as Record<string, unknown>;
  const conv = g["conversation"] as string;
  assert(conv.includes("User: Test input"));
  assert(conv.includes("Assistant: Test response"));
});

// ============================================================================
// Syntax Transformation Tests
// ============================================================================

Deno.test("transformPasteReferences - basic transformation", () => {
  assertEquals(
    transformPasteReferences("[Pasted text #1 +245 lines]"),
    "paste-1"
  );
});

Deno.test("transformPasteReferences - multiple pastes", () => {
  assertEquals(
    transformPasteReferences("[Pasted text #1 +10 lines] [Pasted text #2 +20 lines]"),
    "paste-1 paste-2"
  );
});

Deno.test("transformPasteReferences - in function call", () => {
  assertEquals(
    transformPasteReferences("(ask [Pasted text #1 +245 lines])"),
    "(ask paste-1)"
  );
});

Deno.test("transformPasteReferences - without line count", () => {
  assertEquals(
    transformPasteReferences("[Pasted text #3]"),
    "paste-3"
  );
});

Deno.test("transformPasteReferences - case insensitive", () => {
  assertEquals(
    transformPasteReferences("[PASTED TEXT #1 +100 LINES]"),
    "paste-1"
  );
});

Deno.test("transformPasteReferences - preserves other text", () => {
  assertEquals(
    transformPasteReferences("(analyze [Pasted text #1 +50 lines] and summarize)"),
    "(analyze paste-1 and summarize)"
  );
});

Deno.test("transformContextReferences - last-response", () => {
  assertEquals(
    transformContextReferences("[last-response]"),
    "last-response"
  );
});

Deno.test("transformContextReferences - last-input", () => {
  assertEquals(
    transformContextReferences("[last-input]"),
    "last-input"
  );
});

Deno.test("transformContextReferences - conversation", () => {
  assertEquals(
    transformContextReferences("[conversation]"),
    "conversation"
  );
});

Deno.test("transformContextReferences - snake_case variants", () => {
  assertEquals(
    transformContextReferences("[last_response] [last_input]"),
    "last-response last-input"
  );
});

Deno.test("preprocessCode - combines all transformations", () => {
  assertEquals(
    preprocessCode("(ask [Pasted text #1 +100 lines] [last-response])"),
    "(ask paste-1 last-response)"
  );
});

Deno.test("preprocessCode - complex example", () => {
  const input = "(fn analyze [] (str [Pasted text #1 +50 lines] \"\\n\" [Pasted text #2 +30 lines] \"\\nContext: \" [conversation]))";
  const expected = "(fn analyze [] (str paste-1 \"\\n\" paste-2 \"\\nContext: \" conversation))";
  assertEquals(preprocessCode(input), expected);
});

// ============================================================================
// Code Generation Tests
// ============================================================================

Deno.test("escapeHqlString - escapes special characters", () => {
  assertEquals(escapeHqlString('Hello "World"'), 'Hello \\"World\\"');
  assertEquals(escapeHqlString("Line1\nLine2"), "Line1\\nLine2");
  assertEquals(escapeHqlString("Tab\there"), "Tab\\there");
  assertEquals(escapeHqlString("Back\\slash"), "Back\\\\slash");
});

Deno.test("generatePasteBindings - generates HQL def statements", () => {
  setup();
  registerPaste(createTextAttachment("Simple text", 1));
  registerPaste(createTextAttachment("Another paste", 2));

  const bindings = generatePasteBindings();
  assert(bindings.includes('(def paste-1 "Simple text")'));
  assert(bindings.includes('(def paste-2 "Another paste")'));
});

Deno.test("generatePasteBindings - escapes content properly", () => {
  setup();
  registerPaste(createTextAttachment('Text with "quotes" and\nnewlines', 1));

  const bindings = generatePasteBindings();
  assert(bindings.includes('paste-1'));
  assert(bindings.includes('\\"quotes\\"'));
  assert(bindings.includes('\\n'));
});

Deno.test("generateContextBindings - generates context def statements", () => {
  setup();
  recordUserInput("User question");
  recordAssistantResponse("AI response");

  const bindings = generateContextBindings();
  assert(bindings.includes('(def last-input "User question")'));
  assert(bindings.includes('(def last-response "AI response")'));
  assert(bindings.includes('(def conversation'));
});

// ============================================================================
// Integration Tests
// ============================================================================

Deno.test("integration - full workflow", () => {
  setup();

  // Simulate pasting code
  const codeContent = `function hello() {
  console.log("Hello, World!");
}

hello();`;
  registerPaste(createTextAttachment(codeContent, 1));

  // Simulate conversation
  recordUserInput("(ask paste-1 \"explain this code\")");
  recordAssistantResponse("This is a JavaScript function that prints Hello World.");

  // Verify pastes are accessible
  assertEquals(getPaste(1), codeContent);

  // Verify conversation is tracked
  const conversation = getConversation();
  assertEquals(conversation.length, 2);

  // Verify syntax transformation works
  const transformed = preprocessCode("(ask [Pasted text #1 +5 lines] [last-response])");
  assertEquals(transformed, "(ask paste-1 last-response)");

  // Verify globalThis has all values
  const g = globalThis as Record<string, unknown>;
  assertEquals(g["paste-1"], codeContent);
  assert((g["last-input"] as string).includes("paste-1"));
  assert((g["last-response"] as string).includes("JavaScript"));
});

Deno.test("integration - multiple pastes in same session", () => {
  setup();

  // Simulate multiple pastes
  const paste1 = "const x = 1;\nconst y = 2;\nconst z = x + y;\nconsole.log(z);\n// done";
  const paste2 = "def add(a, b):\n    return a + b\n\nprint(add(1, 2))\n# Python";
  const paste3 = "SELECT * FROM users\nWHERE active = true\nORDER BY name\nLIMIT 10;\n-- SQL";

  registerPaste(createTextAttachment(paste1, 1));
  registerPaste(createTextAttachment(paste2, 2));
  registerPaste(createTextAttachment(paste3, 3));

  // All should be accessible
  assertEquals(getPaste(1), paste1);
  assertEquals(getPaste(2), paste2);
  assertEquals(getPaste(3), paste3);

  // Code transformation should work for all
  const code = "(compare [Pasted text #1 +5 lines] [Pasted text #2 +5 lines] [Pasted text #3 +5 lines])";
  const expected = "(compare paste-1 paste-2 paste-3)";
  assertEquals(preprocessCode(code), expected);
});

Deno.test("integration - paste with special characters", () => {
  setup();

  const specialContent = `const msg = "Hello, \"World\"!";
const path = "C:\\Users\\test";
const multiline = \`
  Line 1
  Line 2
\`;`;

  registerPaste(createTextAttachment(specialContent, 1));

  // Should be stored correctly
  assertEquals(getPaste(1), specialContent);

  // Generated binding should escape properly
  const binding = generatePasteBindings();
  assert(binding.includes("paste-1"));
  // Should have escaped quotes
  assert(binding.includes('\\"World\\"'));
});
