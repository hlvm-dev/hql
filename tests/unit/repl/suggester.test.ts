import { assertEquals } from "jsr:@std/assert";
import { acceptSuggestion, findSuggestion } from "../../../src/hlvm/cli/repl/suggester.ts";

Deno.test("Suggester: empty input or no candidates returns null", () => {
  assertEquals(findSuggestion("", ["(+ 1 2)"], new Set()), null);
  assertEquals(findSuggestion("xyz", ["(+ 1 2)"], new Set()), null);
  assertEquals(findSuggestion("(def", [], new Set()), null);
});

Deno.test("Suggester: history suggestions skip exact matches and prefer the most recent match", () => {
  const history = [
    "(def x 1)",
    "(def x 2)",
    "(def x 3)",
  ];

  const result = findSuggestion("(def x", history, new Set());
  assertEquals(result?.full, "(def x 3)");
  assertEquals(result?.ghost, " 3)");
});

Deno.test("Suggester: binding completion requires 2+ chars, is sorted, and preserves line prefix", () => {
  const bindings = new Set(["zebra", "apple", "my-function"]);

  assertEquals(findSuggestion("a", [], bindings), null);
  assertEquals(findSuggestion("ap", [], bindings)?.full, "apple");

  const prefixed = findSuggestion("(call my-fu", [], bindings);
  assertEquals(prefixed?.full, "(call my-function");
  assertEquals(prefixed?.ghost, "nction");
});

Deno.test("Suggester: bindings take priority over history when both match", () => {
  const history = ["(define-foo 1)"];
  const bindings = new Set(["define-bar"]);
  const result = findSuggestion("define-", history, bindings);

  assertEquals(result?.full, "define-bar");
});

Deno.test("Suggester: multiline history suggestions truncate ghost text at the first newline", () => {
  const history = ["(defn foo [x]\n  (* x 2))"];
  const result = findSuggestion("(defn foo", history, new Set());

  assertEquals(result?.full, "(defn foo [x]\n  (* x 2))");
  assertEquals(result?.ghost, " [x] ...");
});

Deno.test("Suggester: acceptSuggestion returns the full suggestion verbatim", () => {
  const suggestion = { full: "(defn foo [x]\n  x)", ghost: " [x] ..." };
  assertEquals(acceptSuggestion(suggestion), "(defn foo [x]\n  x)");
});
