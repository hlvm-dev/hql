import { assertEquals, assertStrictEquals } from "jsr:@std/assert@1";
import {
  getLiveConversationSpacing,
} from "../../../src/hlvm/cli/repl-ink/components/conversation/message-spacing.ts";

Deno.test("getLiveConversationSpacing preserves standard transcript spacing by default", () => {
  const spacing = getLiveConversationSpacing(false);

  assertEquals(spacing.pendingTurnMarginTop, 1);
  assertEquals(spacing.userMessageMarginTop, 1);
  assertEquals(spacing.userMessageMarginBottom, 1);
  assertEquals(spacing.waitingIndicatorMarginBottom, 1);
});

Deno.test("getLiveConversationSpacing tightens the first live turn without collapsing the waiting row from the composer", () => {
  const spacing = getLiveConversationSpacing(true);

  assertEquals(spacing.pendingTurnMarginTop, 0);
  assertEquals(spacing.userMessageMarginTop, 0);
  assertEquals(spacing.userMessageMarginBottom, 0);
  assertEquals(spacing.waitingIndicatorMarginBottom, 1);
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
