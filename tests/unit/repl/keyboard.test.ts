import { assertEquals } from "jsr:@std/assert";
import {
  calculateWordBackPosition,
  calculateWordForwardPosition,
} from "../../../src/hlvm/cli/repl/keyboard.ts";

Deno.test("keyboard word back: moves to the start of the current word", () => {
  assertEquals(calculateWordBackPosition("hello", 5), 0);
  assertEquals(calculateWordBackPosition("hello", 3), 0);
  assertEquals(calculateWordBackPosition("hello world", 8), 6);
});

Deno.test("keyboard word back: skips trailing and repeated spaces before the previous word", () => {
  assertEquals(calculateWordBackPosition("hello ", 6), 0);
  assertEquals(calculateWordBackPosition("  hello", 7), 2);
  assertEquals(calculateWordBackPosition("hello   world", 13), 8);
});

Deno.test("keyboard word back: clamps at the start for empty or leading-boundary cases", () => {
  assertEquals(calculateWordBackPosition("", 0), 0);
  assertEquals(calculateWordBackPosition("hello", 0), 0);
});

Deno.test("keyboard word forward: moves to the next word boundary from a word start or middle", () => {
  assertEquals(calculateWordForwardPosition("hello", 0), 5);
  assertEquals(calculateWordForwardPosition("hello", 2), 5);
  assertEquals(calculateWordForwardPosition("one two three", 4), 8);
});

Deno.test("keyboard word forward: skips over spaces to the next word", () => {
  assertEquals(calculateWordForwardPosition("hello world", 0), 6);
  assertEquals(calculateWordForwardPosition("hello world", 5), 6);
  assertEquals(calculateWordForwardPosition("hello   world", 5), 8);
});

Deno.test("keyboard word forward: clamps at the end for empty and end-of-line cases", () => {
  assertEquals(calculateWordForwardPosition("", 0), 0);
  assertEquals(calculateWordForwardPosition("hello", 5), 5);
});
