import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import {
  addAttachment,
  addConversationTurn,
  addPaste,
  detectLanguage,
  getAttachment,
  getAttachments,
  getConversation,
  getMedia,
  getPaste,
  getPastes,
  initContext,
  resetContext,
} from "../../../src/hlvm/cli/repl/context.ts";
import { getGlobalRecord } from "../../../src/hlvm/cli/repl/string-utils.ts";

function setup(): void {
  resetContext();
}

Deno.test("context: paste records metadata, language, ids, and global sync", () => {
  setup();

  const first = addPaste("(def x 1)");
  const second = addPaste("line1\nline2", "text");
  const globalRecord = getGlobalRecord();

  assertEquals(first.id, 0);
  assertEquals(first.lang, "hql");
  assertEquals(first.lines, 1);
  assertEquals(first.chars, 9);
  assert(first.time > 0);

  assertEquals(second.id, 1);
  assertEquals(second.lang, "text");
  assertEquals(second.lines, 2);
  assertEquals(getPaste(0)?.content, "(def x 1)");
  assertEquals(getPaste(1)?.content, "line1\nline2");
  assertEquals(getPaste(99), undefined);
  assertEquals(getPastes().length, 2);
  assertEquals(globalRecord["pastes"], getPastes());
});

Deno.test("context: attachments expose sequential lookup and media projection", () => {
  setup();

  const image = addAttachment(
    "image",
    "shot.png",
    "/tmp/shot.png",
    "image/png",
    128,
    "Zm9v",
  );
  const doc = addAttachment(
    "document",
    "report.pdf",
    "/tmp/report.pdf",
    "application/pdf",
    256,
  );

  assertEquals(image.id, 0);
  assertEquals(doc.id, 1);
  assertEquals(getAttachment(0)?.name, "shot.png");
  assertEquals(getAttachment(1)?.name, "report.pdf");
  assertEquals(getAttachment(2), undefined);
  assertEquals(getAttachments().length, 2);
  assertEquals(getMedia(), [{
    type: "image",
    mimeType: "image/png",
    data: "Zm9v",
    source: "/tmp/shot.png",
    __hlvm_media__: true,
  }]);
});

Deno.test("context: conversation preserves role order and syncs to global state", () => {
  setup();

  const user = addConversationTurn("user", "hello");
  const assistant = addConversationTurn("assistant", "hi");
  const globalRecord = getGlobalRecord();

  assertEquals(user.role, "user");
  assertEquals(assistant.role, "assistant");
  assert(user.time <= assistant.time);
  assertEquals(getConversation(), [user, assistant]);
  assertEquals(globalRecord["conversation"], getConversation());
});

Deno.test("context: reset and init manage global vectors", () => {
  setup();
  addPaste("x");
  addAttachment("image", "x.png", "/tmp/x.png", "image/png", 1);
  addConversationTurn("user", "x");

  resetContext();

  const globalRecord = getGlobalRecord();
  assertEquals(getPastes(), []);
  assertEquals(getAttachments(), []);
  assertEquals(getConversation(), []);
  assertEquals(globalRecord["pastes"], getPastes());
  assertEquals(globalRecord["attachments"], getAttachments());
  assertEquals(globalRecord["conversation"], getConversation());

  delete globalRecord["pastes"];
  delete globalRecord["attachments"];
  delete globalRecord["conversation"];
  initContext();

  assertExists(globalRecord["pastes"]);
  assertExists(globalRecord["attachments"]);
  assertExists(globalRecord["conversation"]);
});

Deno.test("context: detectLanguage covers canonical families", () => {
  const samples = [
    ["(def x 1)", "hql"],
    ["const x = 1;", "javascript"],
    ["const x: number = 1;", "typescript"],
    ["def hello():\n  pass", "python"],
    ["SELECT * FROM users", "sql"],
    ['{"name":"test"}', "json"],
    ["name: test\nversion: 1", "yaml"],
    ["just some random text", "unknown"],
  ] as const;

  for (const [content, expected] of samples) {
    assertEquals(detectLanguage(content), expected);
  }
});

Deno.test("context: preserves empty and unicode paste content", () => {
  setup();

  const empty = addPaste("");
  const unicode = addPaste("こんにちは 世界 🌍");

  assertEquals(empty.lines, 1);
  assertEquals(empty.chars, 0);
  assertEquals(unicode.content, "こんにちは 世界 🌍");
  assertEquals(unicode.chars, "こんにちは 世界 🌍".length);
});
