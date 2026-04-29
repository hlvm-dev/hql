import { assertEquals, assertStrictEquals } from "jsr:@std/assert@1";
import {
  getLiveConversationSpacing,
} from "../../../src/hlvm/cli/repl-ink/utils/layout-tokens.ts";

Deno.test("getLiveConversationSpacing keeps the transcript compact by default", () => {
  const spacing = getLiveConversationSpacing(false);

  assertEquals(spacing.pendingTurnMarginTop, 0);
  assertEquals(spacing.userMessageMarginTop, 0);
  assertEquals(spacing.userMessageMarginBottom, 0);
  assertEquals(spacing.assistantMessageMarginBottom, 1);
  assertEquals(spacing.waitingIndicatorMarginBottom, 0);
});

Deno.test("getLiveConversationSpacing reuses the same compact spacing for live turns", () => {
  const spacing = getLiveConversationSpacing(true);

  assertEquals(spacing.pendingTurnMarginTop, 0);
  assertEquals(spacing.userMessageMarginTop, 0);
  assertEquals(spacing.userMessageMarginBottom, 0);
  assertEquals(spacing.assistantMessageMarginBottom, 1);
  assertEquals(spacing.waitingIndicatorMarginBottom, 0);
});

Deno.test("getLiveConversationSpacing reuses canonical spacing objects", () => {
  assertStrictEquals(
    getLiveConversationSpacing(false),
    getLiveConversationSpacing(false),
  );
  assertStrictEquals(
    getLiveConversationSpacing(true),
    getLiveConversationSpacing(true),
  );
});
