import { assertEquals, assertStrictEquals } from "jsr:@std/assert@1";
import {
  buildTranscriptDivider,
  getShellContentWidth,
  getLiveConversationSpacing,
  shouldRenderTranscriptDividerBeforeIndex,
} from "../../../src/hlvm/cli/repl-ink/utils/layout-tokens.ts";

Deno.test("getShellContentWidth respects the shared shell gutter", () => {
  assertEquals(getShellContentWidth(80), 78);
  assertEquals(getShellContentWidth(22), 20);
});

Deno.test("buildTranscriptDivider fills the available transcript width", () => {
  assertEquals(buildTranscriptDivider(1), "─");
  assertEquals(buildTranscriptDivider(4), "────");
});

Deno.test("shouldRenderTranscriptDividerBeforeIndex only inserts dividers before user turns", () => {
  const items = [
    { type: "assistant" },
    { type: "user" },
    { type: "assistant" },
    { type: "tool_group" },
    { type: "user" },
  ];

  assertEquals(shouldRenderTranscriptDividerBeforeIndex(items, 0), false);
  assertEquals(shouldRenderTranscriptDividerBeforeIndex(items, 1), true);
  assertEquals(shouldRenderTranscriptDividerBeforeIndex(items, 2), false);
  assertEquals(shouldRenderTranscriptDividerBeforeIndex(items, 4), true);
});

Deno.test("shouldRenderTranscriptDividerBeforeIndex can force the first visible user divider", () => {
  const items = [{ type: "user" }];

  assertEquals(shouldRenderTranscriptDividerBeforeIndex(items, 0, false), false);
  assertEquals(shouldRenderTranscriptDividerBeforeIndex(items, 0, true), true);
});

Deno.test("getLiveConversationSpacing returns a stable shared object", () => {
  assertStrictEquals(
    getLiveConversationSpacing(false),
    getLiveConversationSpacing(true),
  );
});
