/**
 * Tests for docstring extraction from comments
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { extractDocstrings, mergeDocstrings } from "../../../src/cli/repl/docstring.ts";

// ============================================================
// Basic Extraction Tests
// ============================================================

Deno.test("extractDocstrings: semicolon comment before def", () => {
  const input = `; Adds two numbers together
(def add (fn [x y] (+ x y)))`;
  const result = extractDocstrings(input);
  assertEquals(result.get("add"), "Adds two numbers together");
});

Deno.test("extractDocstrings: double-slash comment before defn", () => {
  const input = `// Multiplies two values
(defn multiply [a b] (* a b))`;
  const result = extractDocstrings(input);
  assertEquals(result.get("multiply"), "Multiplies two values");
});

Deno.test("extractDocstrings: block comment before def", () => {
  const input = `/* Calculates the sum */
(def sum 42)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("sum"), "Calculates the sum");
});

Deno.test("extractDocstrings: multiple comments combined", () => {
  const input = `; First line of documentation
; Second line continues
(def foo 1)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("foo"), "First line of documentation Second line continues");
});

// ============================================================
// Definition Form Tests
// ============================================================

Deno.test("extractDocstrings: def form", () => {
  const input = `; A constant
(def PI 3.14159)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("PI"), "A constant");
});

Deno.test("extractDocstrings: defn form", () => {
  const input = `; Squares a number
(defn square [x] (* x x))`;
  const result = extractDocstrings(input);
  assertEquals(result.get("square"), "Squares a number");
});

Deno.test("extractDocstrings: named fn form", () => {
  const input = `; Named function
(fn helper [x] x)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("helper"), "Named function");
});

Deno.test("extractDocstrings: let bindings", () => {
  const input = `; Local variables
(let [a 1 b 2] (+ a b))`;
  const result = extractDocstrings(input);
  assertEquals(result.get("a"), "Local variables");
  assertEquals(result.get("b"), "Local variables");
});

Deno.test("extractDocstrings: const form", () => {
  const input = `; Maximum value
(const MAX_VALUE 100)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("MAX_VALUE"), "Maximum value");
});

Deno.test("extractDocstrings: var form", () => {
  const input = `; Mutable counter
(var counter 0)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("counter"), "Mutable counter");
});

Deno.test("extractDocstrings: macro form", () => {
  const input = `; Threading macro
(macro my-thread [body] body)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("my-thread"), "Threading macro");
});

Deno.test("extractDocstrings: import with vector", () => {
  const input = `; AI utilities
(import [ask chat] from "@hql/ai")`;
  const result = extractDocstrings(input);
  assertEquals(result.get("ask"), "AI utilities");
  assertEquals(result.get("chat"), "AI utilities");
});

Deno.test("extractDocstrings: import namespace", () => {
  const input = `; File system module
(import fs from "node:fs")`;
  const result = extractDocstrings(input);
  assertEquals(result.get("fs"), "File system module");
});

// ============================================================
// Edge Cases
// ============================================================

Deno.test("extractDocstrings: no comment before definition", () => {
  const input = `(def noComment 42)`;
  const result = extractDocstrings(input);
  assertEquals(result.size, 0);
});

Deno.test("extractDocstrings: empty input", () => {
  const result = extractDocstrings("");
  assertEquals(result.size, 0);
});

Deno.test("extractDocstrings: comment without definition", () => {
  const input = `; Just a comment
; Another comment`;
  const result = extractDocstrings(input);
  assertEquals(result.size, 0);
});

Deno.test("extractDocstrings: blank line between comment and def", () => {
  const input = `; This comment

(def x 1)`;
  const result = extractDocstrings(input);
  // Empty lines don't break the association
  assertEquals(result.get("x"), "This comment");
});

Deno.test("extractDocstrings: multiple definitions", () => {
  const input = `; First function
(def foo 1)
; Second function
(def bar 2)
(def noDoc 3)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("foo"), "First function");
  assertEquals(result.get("bar"), "Second function");
  assertEquals(result.has("noDoc"), false);
});

Deno.test("extractDocstrings: anonymous fn (no name)", () => {
  const input = `; Anonymous
(fn [x] x)`;
  const result = extractDocstrings(input);
  // Anonymous functions don't have a name to associate
  assertEquals(result.size, 0);
});

Deno.test("extractDocstrings: hyphenated names", () => {
  const input = `; Kebab case function
(defn my-cool-func [x] x)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("my-cool-func"), "Kebab case function");
});

// ============================================================
// Merge Tests
// ============================================================

Deno.test("mergeDocstrings: merges two maps", () => {
  const existing = new Map([["a", "doc A"]]);
  const newDocs = new Map([["b", "doc B"]]);
  const merged = mergeDocstrings(existing, newDocs);
  assertEquals(merged.get("a"), "doc A");
  assertEquals(merged.get("b"), "doc B");
});

Deno.test("mergeDocstrings: new overrides existing", () => {
  const existing = new Map([["a", "old doc"]]);
  const newDocs = new Map([["a", "new doc"]]);
  const merged = mergeDocstrings(existing, newDocs);
  assertEquals(merged.get("a"), "new doc");
});

Deno.test("mergeDocstrings: does not mutate original", () => {
  const existing = new Map([["a", "doc A"]]);
  const newDocs = new Map([["b", "doc B"]]);
  mergeDocstrings(existing, newDocs);
  assertEquals(existing.has("b"), false);
});
