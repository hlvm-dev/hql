/**
 * Unit tests for REPL context system
 * Tests pure data structure approach: pastes, attachments, conversation
 */
import { assertEquals, assert, assertExists } from "jsr:@std/assert";
import {
  // Types
  type Paste,
  type MediaAttachment,
  type ConversationTurn,
  // Paste operations
  addPaste,
  getPastes,
  getPaste,
  // Attachment operations
  addAttachment,
  getAttachments,
  getAttachment,
  // Conversation operations
  addConversationTurn,
  getConversation,
  // Context management
  resetContext,
  initContext,
  // Language detection
  detectLanguage,
} from "./context.ts";
import { getGlobalRecord } from "./string-utils.ts";

// Reset context before each test
function setup(): void {
  resetContext();
}

// ============================================================================
// Paste Tests
// ============================================================================

Deno.test("pastes: add creates entry with correct structure", () => {
  setup();
  const paste = addPaste("const x = 1;");

  assertEquals(paste.id, 0);
  assertEquals(paste.content, "const x = 1;");
  assertEquals(paste.lang, "javascript");
  assertEquals(paste.lines, 1);
  assertEquals(paste.chars, 12);
  assert(paste.time > 0);
  assert(paste.time <= Date.now());
});

Deno.test("pastes: sequential IDs starting from 0", () => {
  setup();
  const p0 = addPaste("first");
  const p1 = addPaste("second");
  const p2 = addPaste("third");

  assertEquals(p0.id, 0);
  assertEquals(p1.id, 1);
  assertEquals(p2.id, 2);
});

Deno.test("pastes: line count computed correctly", () => {
  setup();

  // Single line
  assertEquals(addPaste("hello").lines, 1);

  // Multiple lines with \n
  assertEquals(addPaste("a\nb\nc").lines, 3);

  // Multiple lines with \r\n (Windows)
  assertEquals(addPaste("a\r\nb\r\nc").lines, 3);

  // Multiple lines with \r (old Mac)
  assertEquals(addPaste("a\rb\rc").lines, 3);

  // Empty lines count
  assertEquals(addPaste("a\n\n\nb").lines, 4);
});

Deno.test("pastes: getPastes returns all pastes", () => {
  setup();
  addPaste("one");
  addPaste("two");
  addPaste("three");

  const pastes = getPastes();
  assertEquals(pastes.length, 3);
  assertEquals(pastes[0].content, "one");
  assertEquals(pastes[1].content, "two");
  assertEquals(pastes[2].content, "three");
});

Deno.test("pastes: getPaste by ID", () => {
  setup();
  addPaste("first");
  addPaste("second");

  const p0 = getPaste(0);
  const p1 = getPaste(1);
  const p99 = getPaste(99);

  assertExists(p0);
  assertEquals(p0.content, "first");
  assertExists(p1);
  assertEquals(p1.content, "second");
  assertEquals(p99, undefined);
});

Deno.test("pastes: accessible from globalThis", () => {
  setup();
  addPaste("test content");

  const g = getGlobalRecord();
  const pastes = g["pastes"] as Paste[];

  assertExists(pastes);
  assertEquals(pastes.length, 1);
  assertEquals(pastes[0].content, "test content");
});

Deno.test("pastes: filter by language", () => {
  setup();
  addPaste("const x = 1;", "javascript");
  addPaste("SELECT * FROM users", "sql");
  addPaste("let y = 2;", "javascript");

  const pastes = getPastes();
  const jsPastes = pastes.filter((p) => p.lang === "javascript");

  assertEquals(jsPastes.length, 2);
  assertEquals(jsPastes[0].content, "const x = 1;");
  assertEquals(jsPastes[1].content, "let y = 2;");
});

Deno.test("pastes: map to extract content", () => {
  setup();
  addPaste("one");
  addPaste("two");
  addPaste("three");

  const contents = getPastes().map((p) => p.content);
  assertEquals(contents, ["one", "two", "three"]);
});

// ============================================================================
// Attachment Tests
// ============================================================================

Deno.test("attachments: add image with correct metadata", () => {
  setup();
  const att = addAttachment(
    "image",
    "screenshot.png",
    "/path/to/screenshot.png",
    "image/png",
    102400
  );

  assertEquals(att.id, 0);
  assertEquals(att.type, "image");
  assertEquals(att.name, "screenshot.png");
  assertEquals(att.path, "/path/to/screenshot.png");
  assertEquals(att.mime, "image/png");
  assertEquals(att.size, 102400);
  assert(att.time > 0);
});

Deno.test("attachments: add various types", () => {
  setup();
  const video = addAttachment("video", "movie.mp4", "/path/movie.mp4", "video/mp4", 5000000);
  const audio = addAttachment("audio", "song.mp3", "/path/song.mp3", "audio/mpeg", 3000000);
  const doc = addAttachment("document", "report.pdf", "/path/report.pdf", "application/pdf", 500000);

  assertEquals(video.type, "video");
  assertEquals(audio.type, "audio");
  assertEquals(doc.type, "document");
});

Deno.test("attachments: sequential IDs starting from 0", () => {
  setup();
  const a0 = addAttachment("image", "a.png", "/a.png", "image/png", 100);
  const a1 = addAttachment("video", "b.mp4", "/b.mp4", "video/mp4", 200);

  assertEquals(a0.id, 0);
  assertEquals(a1.id, 1);
});

Deno.test("attachments: getAttachments returns all", () => {
  setup();
  addAttachment("image", "a.png", "/a.png", "image/png", 100);
  addAttachment("video", "b.mp4", "/b.mp4", "video/mp4", 200);

  const atts = getAttachments();
  assertEquals(atts.length, 2);
});

Deno.test("attachments: getAttachment by ID", () => {
  setup();
  addAttachment("image", "a.png", "/a.png", "image/png", 100);
  addAttachment("video", "b.mp4", "/b.mp4", "video/mp4", 200);

  const a0 = getAttachment(0);
  const a1 = getAttachment(1);
  const a99 = getAttachment(99);

  assertExists(a0);
  assertEquals(a0.name, "a.png");
  assertExists(a1);
  assertEquals(a1.name, "b.mp4");
  assertEquals(a99, undefined);
});

Deno.test("attachments: accessible from globalThis", () => {
  setup();
  addAttachment("image", "test.png", "/test.png", "image/png", 100);

  const g = getGlobalRecord();
  const atts = g["attachments"] as MediaAttachment[];

  assertExists(atts);
  assertEquals(atts.length, 1);
  assertEquals(atts[0].name, "test.png");
});

Deno.test("attachments: filter by type", () => {
  setup();
  addAttachment("image", "a.png", "/a.png", "image/png", 100);
  addAttachment("video", "b.mp4", "/b.mp4", "video/mp4", 200);
  addAttachment("image", "c.jpg", "/c.jpg", "image/jpeg", 150);

  const images = getAttachments().filter((a) => a.type === "image");
  assertEquals(images.length, 2);
});

// ============================================================================
// Conversation Tests
// ============================================================================

Deno.test("conversation: add user turn", () => {
  setup();
  const turn = addConversationTurn("user", "Hello, world!");

  assertEquals(turn.role, "user");
  assertEquals(turn.content, "Hello, world!");
  assert(turn.time > 0);
});

Deno.test("conversation: add assistant turn", () => {
  setup();
  const turn = addConversationTurn("assistant", "Hi there!");

  assertEquals(turn.role, "assistant");
  assertEquals(turn.content, "Hi there!");
});

Deno.test("conversation: multiple turns maintain order", () => {
  setup();
  addConversationTurn("user", "Question 1");
  addConversationTurn("assistant", "Answer 1");
  addConversationTurn("user", "Question 2");
  addConversationTurn("assistant", "Answer 2");

  const conv = getConversation();
  assertEquals(conv.length, 4);
  assertEquals(conv[0].role, "user");
  assertEquals(conv[0].content, "Question 1");
  assertEquals(conv[1].role, "assistant");
  assertEquals(conv[1].content, "Answer 1");
  assertEquals(conv[2].role, "user");
  assertEquals(conv[3].role, "assistant");
});

Deno.test("conversation: accessible from globalThis", () => {
  setup();
  addConversationTurn("user", "test message");

  const g = getGlobalRecord();
  const conv = g["conversation"] as ConversationTurn[];

  assertExists(conv);
  assertEquals(conv.length, 1);
  assertEquals(conv[0].content, "test message");
});

Deno.test("conversation: filter by role", () => {
  setup();
  addConversationTurn("user", "Q1");
  addConversationTurn("assistant", "A1");
  addConversationTurn("user", "Q2");
  addConversationTurn("assistant", "A2");
  addConversationTurn("user", "Q3");

  const userTurns = getConversation().filter((t) => t.role === "user");
  assertEquals(userTurns.length, 3);

  const assistantTurns = getConversation().filter((t) => t.role === "assistant");
  assertEquals(assistantTurns.length, 2);
});

// ============================================================================
// Context Management Tests
// ============================================================================

Deno.test("resetContext: clears all vectors", () => {
  setup();
  addPaste("test");
  addAttachment("image", "test.png", "/test.png", "image/png", 100);
  addConversationTurn("user", "hello");

  assertEquals(getPastes().length, 1);
  assertEquals(getAttachments().length, 1);
  assertEquals(getConversation().length, 1);

  resetContext();

  assertEquals(getPastes().length, 0);
  assertEquals(getAttachments().length, 0);
  assertEquals(getConversation().length, 0);
});

Deno.test("resetContext: clears globalThis vectors", () => {
  setup();
  addPaste("test");

  const g = getGlobalRecord();
  assertEquals((g["pastes"] as Paste[]).length, 1);

  resetContext();

  assertEquals((g["pastes"] as Paste[]).length, 0);
});

Deno.test("initContext: initializes empty vectors on globalThis", () => {
  // Clear globalThis first
  const g = getGlobalRecord();
  delete g["pastes"];
  delete g["attachments"];
  delete g["conversation"];

  initContext();

  assertExists(g["pastes"]);
  assertExists(g["attachments"]);
  assertExists(g["conversation"]);
});

// ============================================================================
// Language Detection Tests
// ============================================================================

Deno.test("detectLanguage: HQL", () => {
  assertEquals(detectLanguage("(def x 1)"), "hql");
  assertEquals(detectLanguage("(defn greet [name] (str \"Hello, \" name))"), "hql");
  assertEquals(detectLanguage("(let x 1)"), "hql");
});

Deno.test("detectLanguage: JavaScript", () => {
  assertEquals(detectLanguage("const x = 1;"), "javascript");
  assertEquals(detectLanguage("let y = 2;"), "javascript");
  assertEquals(detectLanguage("function foo() {}"), "javascript");
  assertEquals(detectLanguage("const fn = () => { return 1; }"), "javascript");
});

Deno.test("detectLanguage: TypeScript", () => {
  assertEquals(detectLanguage("const x: number = 1;"), "typescript");
  assertEquals(detectLanguage("interface User { name: string; }"), "typescript");
  assertEquals(detectLanguage("type ID = string | number;"), "typescript");
});

Deno.test("detectLanguage: Python", () => {
  assertEquals(detectLanguage("def hello():"), "python");
  assertEquals(detectLanguage("class MyClass:"), "python");
  assertEquals(detectLanguage("import os"), "python");
});

Deno.test("detectLanguage: SQL", () => {
  assertEquals(detectLanguage("SELECT * FROM users"), "sql");
  assertEquals(detectLanguage("INSERT INTO table VALUES (1, 2)"), "sql");
  assertEquals(detectLanguage("CREATE TABLE test (id INT)"), "sql");
});

Deno.test("detectLanguage: JSON", () => {
  assertEquals(detectLanguage('{"name": "test"}'), "json");
  assertEquals(detectLanguage('[1, 2, 3]'), "json");
});

Deno.test("detectLanguage: unknown", () => {
  assertEquals(detectLanguage("just some random text"), "unknown");
  assertEquals(detectLanguage(""), "unknown");
});

// ============================================================================
// Edge Cases
// ============================================================================

Deno.test("edge: unicode content preserved", () => {
  setup();
  const paste = addPaste("こんにちは 世界 🌍");

  assertEquals(paste.content, "こんにちは 世界 🌍");
  // JS string.length counts UTF-16 code units (emoji = 2)
  assertEquals(paste.chars, "こんにちは 世界 🌍".length);
});

Deno.test("edge: empty paste handled", () => {
  setup();
  const paste = addPaste("");

  assertEquals(paste.content, "");
  assertEquals(paste.lines, 1);
  assertEquals(paste.chars, 0);
});

Deno.test("edge: large content (1MB)", () => {
  setup();
  const largeContent = "x".repeat(1024 * 1024);
  const paste = addPaste(largeContent);

  assertEquals(paste.content.length, 1024 * 1024);
  assertEquals(paste.chars, 1024 * 1024);
});

Deno.test("edge: special characters in content", () => {
  setup();
  const content = 'line1\n"quoted"\t\\path\r\nend';
  const paste = addPaste(content);

  assertEquals(paste.content, content);
});

Deno.test("edge: conversation with empty content", () => {
  setup();
  const turn = addConversationTurn("user", "");

  assertEquals(turn.content, "");
});

Deno.test("edge: timestamps are sequential", () => {
  setup();
  const p1 = addPaste("first");
  const p2 = addPaste("second");

  assert(p2.time >= p1.time);
});
