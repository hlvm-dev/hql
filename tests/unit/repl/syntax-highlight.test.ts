import { assertEquals } from "jsr:@std/assert";
import {
  __getTokenizeCacheKeysForTest,
  __resetTokenizeCacheForTest,
  getHighlightSegments,
} from "../../../src/hlvm/cli/repl/syntax.ts";

Deno.test("syntax highlight: exposes function-position and bracket-emphasis segments for Ink rendering", () => {
  assertEquals(
    getHighlightSegments("(foo)", [0, 4]),
    [
      { value: "(", colorKey: "functionCall", bold: true },
      { value: "foo", colorKey: "functionCall" },
      { value: ")", colorKey: "functionCall", bold: true },
    ],
  );
});

Deno.test("syntax highlight: token cache retains recent entries with LRU eviction", () => {
  __resetTokenizeCacheForTest();

  for (let i = 0; i < 34; i++) {
    getHighlightSegments(`(sym-${i})`);
  }

  const cacheKeys = __getTokenizeCacheKeysForTest();
  assertEquals(cacheKeys.length, 32);
  assertEquals(cacheKeys.includes("(sym-0)"), false);
  assertEquals(cacheKeys.includes("(sym-1)"), false);
  assertEquals(cacheKeys[cacheKeys.length - 1], "(sym-33)");

  getHighlightSegments("(sym-2)");
  const refreshedKeys = __getTokenizeCacheKeysForTest();
  assertEquals(refreshedKeys[refreshedKeys.length - 1], "(sym-2)");
});
