/**
 * Tests for docstring extraction from comments
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { extractDocstrings, stripLeadingComments } from "../../../src/hlvm/cli/repl/docstring.ts";

const singleLineDoc = (text: string): string => `/** ${text} */`;
const multiLineDoc = (lines: string[]): string =>
  ["/**", ...lines.map((line) => ` * ${line}`), " */"].join("\n");

// ============================================================
// Basic Extraction Tests
// ============================================================

Deno.test("extractDocstrings: JSDoc before def", () => {
  const doc = singleLineDoc("Adds two numbers together");
  const input = `${doc}
(def add (fn [x y] (+ x y)))`;
  const result = extractDocstrings(input);
  assertEquals(result.get("add"), doc);
});

Deno.test("extractDocstrings: JSDoc before defn", () => {
  const doc = singleLineDoc("Multiplies two values");
  const input = `${doc}
(defn multiply [a b] (* a b))`;
  const result = extractDocstrings(input);
  assertEquals(result.get("multiply"), doc);
});

Deno.test("extractDocstrings: non-doc block comment ignored", () => {
  const input = `/* Calculates the sum */
(def sum 42)`;
  const result = extractDocstrings(input);
  assertEquals(result.size, 0);
});

Deno.test("extractDocstrings: multi-line JSDoc preserves newlines", () => {
  const doc = multiLineDoc(["First line of documentation", "Second line continues"]);
  const input = `${doc}
(def foo 1)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("foo"), doc);
});

// ============================================================
// Definition Form Tests
// ============================================================

Deno.test("extractDocstrings: def form", () => {
  const doc = singleLineDoc("A constant");
  const input = `${doc}
(def PI 3.14159)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("PI"), doc);
});

Deno.test("extractDocstrings: defn form", () => {
  const doc = singleLineDoc("Squares a number");
  const input = `${doc}
(defn square [x] (* x x))`;
  const result = extractDocstrings(input);
  assertEquals(result.get("square"), doc);
});

Deno.test("extractDocstrings: named fn form", () => {
  const doc = singleLineDoc("Named function");
  const input = `${doc}
(fn helper [x] x)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("helper"), doc);
});

Deno.test("extractDocstrings: let bindings", () => {
  const doc = singleLineDoc("Local variables");
  const input = `${doc}
(let [a 1 b 2] (+ a b))`;
  const result = extractDocstrings(input);
  assertEquals(result.get("a"), doc);
  assertEquals(result.get("b"), doc);
});

Deno.test("extractDocstrings: const form", () => {
  const doc = singleLineDoc("Maximum value");
  const input = `${doc}
(const MAX_VALUE 100)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("MAX_VALUE"), doc);
});

Deno.test("extractDocstrings: var form", () => {
  const doc = singleLineDoc("Mutable counter");
  const input = `${doc}
(var counter 0)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("counter"), doc);
});

Deno.test("extractDocstrings: macro form", () => {
  const doc = singleLineDoc("Threading macro");
  const input = `${doc}
(macro my-thread [body] body)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("my-thread"), doc);
});

Deno.test("extractDocstrings: import with vector", () => {
  const doc = singleLineDoc("AI utilities");
  const input = `${doc}
(import [ask chat] from "@hlvm/ai")`;
  const result = extractDocstrings(input);
  assertEquals(result.get("ask"), doc);
  assertEquals(result.get("chat"), doc);
});

Deno.test("extractDocstrings: import namespace", () => {
  const doc = singleLineDoc("File system module");
  const input = `${doc}
(import fs from "node:fs")`;
  const result = extractDocstrings(input);
  assertEquals(result.get("fs"), doc);
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
  const input = singleLineDoc("Just a comment");
  const result = extractDocstrings(input);
  assertEquals(result.size, 0);
});

Deno.test("extractDocstrings: line comment ignored", () => {
  const input = `// Not a doc block
(def ignored 1)`;
  const result = extractDocstrings(input);
  assertEquals(result.size, 0);
});

Deno.test("extractDocstrings: blank line between comment and def", () => {
  const doc = singleLineDoc("This comment");
  const input = `${doc}

(def x 1)`;
  const result = extractDocstrings(input);
  // Empty lines don't break the association
  assertEquals(result.get("x"), doc);
});

Deno.test("extractDocstrings: multiple definitions", () => {
  const first = singleLineDoc("First function");
  const second = singleLineDoc("Second function");
  const input = `${first}
(def foo 1)
${second}
(def bar 2)
(def noDoc 3)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("foo"), first);
  assertEquals(result.get("bar"), second);
  assertEquals(result.has("noDoc"), false);
});

Deno.test("extractDocstrings: anonymous fn (no name)", () => {
  const input = `${singleLineDoc("Anonymous")}
(fn [x] x)`;
  const result = extractDocstrings(input);
  // Anonymous functions don't have a name to associate
  assertEquals(result.size, 0);
});

Deno.test("extractDocstrings: hyphenated names", () => {
  const doc = singleLineDoc("Kebab case function");
  const input = `${doc}
(defn my-cool-func [x] x)`;
  const result = extractDocstrings(input);
  assertEquals(result.get("my-cool-func"), doc);
});

// ============================================================
// Leading Comment Stripping
// ============================================================

Deno.test("stripLeadingComments: removes JSDoc and line comments", () => {
  const input = `/** Adds two numbers */
// extra note
(defn add [a b] (+ a b))`;
  const output = stripLeadingComments(input).trimStart();
  assertEquals(output.startsWith("(defn add"), true);
});

Deno.test("stripLeadingComments: ignores non-comment content", () => {
  const input = `(defn noop [] nil)`;
  const output = stripLeadingComments(input).trimStart();
  assertEquals(output, input);
});
