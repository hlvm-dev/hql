/**
 * Tests for LSP Rename Symbol feature
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { prepareRename, getWordForRename } from "../../../src/hql/lsp/features/rename.ts";
import { createDoc } from "./helpers.ts";

Deno.test("prepareRename - returns range for function name", () => {
  const doc = createDoc("(fn add [a b] (+ a b))");
  const result = prepareRename(doc, { line: 0, character: 5 }); // cursor on "add"

  assertExists(result);
  assertEquals(result.placeholder, "add");
  assertEquals(result.range.start.character, 4);
  assertEquals(result.range.end.character, 7);
});

Deno.test("prepareRename - returns range for variable", () => {
  const doc = createDoc("(let counter 0)");
  const result = prepareRename(doc, { line: 0, character: 7 }); // cursor on "counter"

  assertExists(result);
  assertEquals(result.placeholder, "counter");
});

Deno.test("prepareRename - returns null for special forms", () => {
  const doc = createDoc("(fn add [a b] (+ a b))");

  // "fn" is a special form
  const resultFn = prepareRename(doc, { line: 0, character: 1 });
  assertEquals(resultFn, null);

  // "let" is a special form
  const doc2 = createDoc("(let x 1)");
  const resultLet = prepareRename(doc2, { line: 0, character: 2 });
  assertEquals(resultLet, null);
});

Deno.test("prepareRename - returns null for keywords", () => {
  const doc = createDoc("(if true 1 2)");
  const result = prepareRename(doc, { line: 0, character: 2 }); // cursor on "if"
  assertEquals(result, null);
});

Deno.test("prepareRename - returns null outside identifier", () => {
  const doc = createDoc("(fn add [a b] (+ a b))");

  // On opening paren
  const result1 = prepareRename(doc, { line: 0, character: 0 });
  assertEquals(result1, null);

  // On space
  const result2 = prepareRename(doc, { line: 0, character: 3 });
  assertEquals(result2, null);
});

Deno.test("prepareRename - handles hyphenated identifiers", () => {
  const doc = createDoc("(fn my-function [x] x)");
  const result = prepareRename(doc, { line: 0, character: 6 }); // cursor on "my-function"

  assertExists(result);
  assertEquals(result.placeholder, "my-function");
});

Deno.test("prepareRename - handles identifiers with ?", () => {
  const doc = createDoc("(fn valid? [x] (> x 0))");
  const result = prepareRename(doc, { line: 0, character: 6 }); // cursor on "valid?"

  assertExists(result);
  assertEquals(result.placeholder, "valid?");
});

Deno.test("prepareRename - handles identifiers with !", () => {
  const doc = createDoc("(fn update! [x] x)");
  const result = prepareRename(doc, { line: 0, character: 6 }); // cursor on "update!"

  assertExists(result);
  assertEquals(result.placeholder, "update!");
});

Deno.test("getWordForRename - returns word at position", () => {
  const doc = createDoc("(fn add [a b] (+ a b))");

  assertEquals(getWordForRename(doc, { line: 0, character: 5 }), "add");
  assertEquals(getWordForRename(doc, { line: 0, character: 9 }), "a");
  assertEquals(getWordForRename(doc, { line: 0, character: 11 }), "b");
});

Deno.test("getWordForRename - returns null for special forms", () => {
  const doc = createDoc("(fn add [a b] (+ a b))");
  assertEquals(getWordForRename(doc, { line: 0, character: 1 }), null); // "fn"
});

Deno.test("prepareRename - handles multiline", () => {
  const doc = createDoc(`(fn calculate
  [a b c]
  (+ a
     (* b c)))`);

  // Function name on line 0
  const result1 = prepareRename(doc, { line: 0, character: 6 });
  assertExists(result1);
  assertEquals(result1.placeholder, "calculate");

  // Parameter on line 1: "  [a b c]" - 'a' at char 3, 'b' at char 5
  const result2 = prepareRename(doc, { line: 1, character: 5 });
  assertExists(result2);
  assertEquals(result2.placeholder, "b");
});

Deno.test("prepareRename - class name", () => {
  const doc = createDoc("(class Point (var x 0) (var y 0))");
  const result = prepareRename(doc, { line: 0, character: 9 }); // cursor on "Point"

  assertExists(result);
  assertEquals(result.placeholder, "Point");
});

Deno.test("prepareRename - macro name", () => {
  const doc = createDoc("(macro when [test & body] `(if ~test (do ~@body)))");
  const result = prepareRename(doc, { line: 0, character: 9 }); // cursor on "when"

  assertExists(result);
  assertEquals(result.placeholder, "when");
});

Deno.test("prepareRename - returns null for booleans and nil", () => {
  const doc = createDoc("(if true 1 nil)");

  // true is reserved
  const result1 = prepareRename(doc, { line: 0, character: 4 });
  assertEquals(result1, null);

  // nil is reserved
  const result2 = prepareRename(doc, { line: 0, character: 12 });
  assertEquals(result2, null);
});
