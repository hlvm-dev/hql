import { assertEquals } from "jsr:@std/assert@1";
import {
  clampConversationRowScrollOffset,
  computeConversationRowViewport,
} from "../../../src/hlvm/cli/repl-ink/utils/conversation-row-viewport.ts";

Deno.test("clampConversationRowScrollOffset clamps against row budget", () => {
  assertEquals(clampConversationRowScrollOffset(-5, 40, 12), 0);
  assertEquals(clampConversationRowScrollOffset(6, 40, 12), 6);
  assertEquals(clampConversationRowScrollOffset(999, 40, 12), 28);
});

Deno.test("computeConversationRowViewport fits whole items inside visible rows", () => {
  const viewport = computeConversationRowViewport([2, 3, 14, 2, 12], 18, 0);
  assertEquals(viewport.start, 3);
  assertEquals(viewport.end, 5);
  assertEquals(viewport.hiddenAbove, 3);
  assertEquals(viewport.hiddenBelow, 0);
  assertEquals(viewport.totalRows, 33);
  assertEquals(viewport.maxOffset, 15);
});

Deno.test("computeConversationRowViewport scrolls upward in row units", () => {
  const viewport = computeConversationRowViewport([2, 3, 14, 2, 12], 18, 12);
  assertEquals(viewport.start, 2);
  assertEquals(viewport.end, 4);
  assertEquals(viewport.hiddenAbove, 2);
  assertEquals(viewport.hiddenBelow, 1);
});

Deno.test("computeConversationRowViewport shows an oversized item alone", () => {
  const viewport = computeConversationRowViewport([3, 28, 4], 12, 4);
  assertEquals(viewport.start, 1);
  assertEquals(viewport.end, 2);
  assertEquals(viewport.hiddenAbove, 1);
  assertEquals(viewport.hiddenBelow, 1);
});
