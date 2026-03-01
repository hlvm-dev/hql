import { assertEquals } from "jsr:@std/assert@1";
import {
  clampConversationScrollOffset,
  computeConversationViewport,
  getConversationVisibleCount,
} from "../../../src/hlvm/cli/repl-ink/utils/conversation-viewport.ts";

Deno.test("getConversationVisibleCount respects min/max bounds", () => {
  assertEquals(
    getConversationVisibleCount(12, { reservedRows: 10, minVisible: 6, maxVisible: 120 }),
    6,
  );
  assertEquals(
    getConversationVisibleCount(500, { reservedRows: 10, minVisible: 6, maxVisible: 120 }),
    120,
  );
});

Deno.test("clampConversationScrollOffset clamps against computed max", () => {
  assertEquals(clampConversationScrollOffset(-5, 20, 8), 0);
  assertEquals(clampConversationScrollOffset(2, 20, 8), 2);
  assertEquals(clampConversationScrollOffset(99, 20, 8), 12);
});

Deno.test("computeConversationViewport returns bottom window at offset 0", () => {
  const viewport = computeConversationViewport(20, 8, 0);
  assertEquals(viewport.start, 12);
  assertEquals(viewport.end, 20);
  assertEquals(viewport.hiddenAbove, 12);
  assertEquals(viewport.hiddenBelow, 0);
  assertEquals(viewport.maxOffset, 12);
});

Deno.test("computeConversationViewport returns older window when scrolled up", () => {
  const viewport = computeConversationViewport(20, 8, 5);
  assertEquals(viewport.start, 7);
  assertEquals(viewport.end, 15);
  assertEquals(viewport.hiddenAbove, 7);
  assertEquals(viewport.hiddenBelow, 5);
});

Deno.test("computeConversationViewport clamps oversized offsets", () => {
  const viewport = computeConversationViewport(10, 6, 999);
  assertEquals(viewport.start, 0);
  assertEquals(viewport.end, 6);
  assertEquals(viewport.hiddenAbove, 0);
  assertEquals(viewport.hiddenBelow, 4);
  assertEquals(viewport.maxOffset, 4);
});
