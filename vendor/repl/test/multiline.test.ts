import { analyzeContinuation } from "../src/multiline.ts";
import { assertEquals } from "@std/assert";

Deno.test("analyzeContinuation detects balanced expressions", () => {
  const result = analyzeContinuation("fn add(a, b) { return a + b; }");
  assertEquals(result.needsContinuation, false);
  assertEquals(result.indentLevel, 0);
});

Deno.test("analyzeContinuation detects unmatched braces", () => {
  const result = analyzeContinuation("fn add(a, b) {");
  assertEquals(result.needsContinuation, true);
  assertEquals(result.indentLevel, 1);
});

Deno.test("analyzeContinuation respects strings", () => {
  const result = analyzeContinuation("const msg = \"Hello");
  assertEquals(result.needsContinuation, true);
  assertEquals(result.indentLevel, 0);
});

Deno.test("analyzeContinuation handles nested delimiters", () => {
  const result = analyzeContinuation("fn nested() { return (foo({ bar: [1, 2"); 
  assertEquals(result.needsContinuation, true);
  assertEquals(result.indentLevel > 1, true);
});
