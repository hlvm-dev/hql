/**
 * Unit tests for HLVM REPL Keyboard Handling - Word Navigation Functions
 */

import { assertEquals } from "jsr:@std/assert";
import {
  calculateWordBackPosition,
  calculateWordForwardPosition,
} from "../../../src/hlvm/cli/repl/keyboard.ts";

// ============================================================
// calculateWordBackPosition() tests
// ============================================================

Deno.test("calculateWordBackPosition: from end of single word", () => {
  assertEquals(calculateWordBackPosition("hello", 5), 0);
});

Deno.test("calculateWordBackPosition: from middle of word", () => {
  assertEquals(calculateWordBackPosition("hello", 3), 0);
});

Deno.test("calculateWordBackPosition: with leading space", () => {
  assertEquals(calculateWordBackPosition("  hello", 7), 2);
});

Deno.test("calculateWordBackPosition: multiple words - from end", () => {
  assertEquals(calculateWordBackPosition("hello world", 11), 6);
});

Deno.test("calculateWordBackPosition: multiple words - skip word", () => {
  assertEquals(calculateWordBackPosition("hello world test", 16), 12);
});

Deno.test("calculateWordBackPosition: at start returns 0", () => {
  assertEquals(calculateWordBackPosition("hello", 0), 0);
});

Deno.test("calculateWordBackPosition: from space after word", () => {
  assertEquals(calculateWordBackPosition("hello ", 6), 0);
});

Deno.test("calculateWordBackPosition: multiple spaces between words", () => {
  assertEquals(calculateWordBackPosition("hello   world", 13), 8);
});

Deno.test("calculateWordBackPosition: empty string", () => {
  assertEquals(calculateWordBackPosition("", 0), 0);
});

Deno.test("calculateWordBackPosition: cursor in middle of multi-word", () => {
  // "hello world" cursor at 'o' in 'world' (pos 8)
  assertEquals(calculateWordBackPosition("hello world", 8), 6);
});

// ============================================================
// calculateWordForwardPosition() tests
// ============================================================

Deno.test("calculateWordForwardPosition: from start of single word", () => {
  assertEquals(calculateWordForwardPosition("hello", 0), 5);
});

Deno.test("calculateWordForwardPosition: from middle of word", () => {
  assertEquals(calculateWordForwardPosition("hello", 2), 5);
});

Deno.test("calculateWordForwardPosition: multiple words - to next word", () => {
  assertEquals(calculateWordForwardPosition("hello world", 0), 6);
});

Deno.test("calculateWordForwardPosition: at end returns length", () => {
  assertEquals(calculateWordForwardPosition("hello", 5), 5);
});

Deno.test("calculateWordForwardPosition: from space to next word", () => {
  assertEquals(calculateWordForwardPosition("hello world", 5), 6);
});

Deno.test("calculateWordForwardPosition: multiple spaces", () => {
  assertEquals(calculateWordForwardPosition("hello   world", 5), 8);
});

Deno.test("calculateWordForwardPosition: empty string", () => {
  assertEquals(calculateWordForwardPosition("", 0), 0);
});

Deno.test("calculateWordForwardPosition: skip to third word", () => {
  assertEquals(calculateWordForwardPosition("one two three", 4), 8);
});
