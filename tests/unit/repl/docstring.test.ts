import { assertEquals } from "jsr:@std/assert";
import {
  extractDocstrings,
  stripLeadingComments,
} from "../../../src/hlvm/cli/repl/docstring.ts";

const singleLineDoc = (text: string): string => `/** ${text} */`;
const multiLineDoc = (lines: string[]): string =>
  ["/**", ...lines.map((line) => ` * ${line}`), " */"].join("\n");

Deno.test("Docstring: extracts single-line and multi-line JSDoc for named definitions", () => {
  const defDoc = singleLineDoc("Adds two numbers together");
  const fnDoc = multiLineDoc(["First line of documentation", "Second line continues"]);
  const input = `${defDoc}\n(defn add [x y] (+ x y))\n${fnDoc}\n(def my-cool-func 1)`;
  const result = extractDocstrings(input);

  assertEquals(result.get("add"), defDoc);
  assertEquals(result.get("my-cool-func"), fnDoc);
});

Deno.test("Docstring: extracts all names introduced by let and import forms", () => {
  const letDoc = singleLineDoc("Local variables");
  const importDoc = singleLineDoc("AI utilities");
  const input = `${letDoc}\n(let [a 1 b 2] (+ a b))\n${importDoc}\n(import [ask chat] from "@hlvm/ai")`;
  const result = extractDocstrings(input);

  assertEquals(result.get("a"), letDoc);
  assertEquals(result.get("b"), letDoc);
  assertEquals(result.get("ask"), importDoc);
  assertEquals(result.get("chat"), importDoc);
});

Deno.test("Docstring: extracts named fn, const, var, macro, and namespace imports", () => {
  const fnDoc = singleLineDoc("Named function");
  const constDoc = singleLineDoc("Maximum value");
  const varDoc = singleLineDoc("Mutable counter");
  const macroDoc = singleLineDoc("Threading macro");
  const importDoc = singleLineDoc("File system module");
  const input = `${fnDoc}\n(fn helper [x] x)\n${constDoc}\n(const MAX_VALUE 100)\n${varDoc}\n(var counter 0)\n${macroDoc}\n(macro my-thread [body] body)\n${importDoc}\n(import fs from "node:fs")`;
  const result = extractDocstrings(input);

  assertEquals(result.get("helper"), fnDoc);
  assertEquals(result.get("MAX_VALUE"), constDoc);
  assertEquals(result.get("counter"), varDoc);
  assertEquals(result.get("my-thread"), macroDoc);
  assertEquals(result.get("fs"), importDoc);
});

Deno.test("Docstring: ignores non-doc comments and anonymous or undocumented forms", () => {
  const input = `/* Calculates the sum */\n(def sum 42)\n// Not a doc block\n(def ignored 1)\n${singleLineDoc("Anonymous")}\n(fn [x] x)\n(def noComment 42)`;
  const result = extractDocstrings(input);

  assertEquals(result.size, 0);
});

Deno.test("Docstring: blank lines do not break association and multiple definitions stay independent", () => {
  const first = singleLineDoc("First function");
  const second = singleLineDoc("Second function");
  const input = `${first}\n\n(def foo 1)\n${second}\n(def bar 2)\n(def noDoc 3)`;
  const result = extractDocstrings(input);

  assertEquals(result.get("foo"), first);
  assertEquals(result.get("bar"), second);
  assertEquals(result.has("noDoc"), false);
});

Deno.test("Docstring: stripLeadingComments removes leading doc and line comments but preserves code", () => {
  const input = `/** Adds two numbers */\n// extra note\n(defn add [a b] (+ a b))`;
  const stripped = stripLeadingComments(input).trimStart();

  assertEquals(stripped.startsWith("(defn add"), true);
  assertEquals(stripLeadingComments("(defn noop [] nil)").trimStart(), "(defn noop [] nil)");
});
