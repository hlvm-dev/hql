/**
 * LSP Analysis Tests
 *
 * Tests the core analysis functionality that powers the LSP server.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { analyzeDocument } from "../../../lsp/analysis.ts";

Deno.test("LSP Analysis - parses valid HQL code without errors", () => {
  const code = `
(let x 42)
(fn add [a b] (+ a b))
(println (add x 10))
`;

  const result = analyzeDocument(code, "test.hql");

  assertEquals(result.errors.length, 0, "Should have no errors");
  assertExists(result.ast, "Should have AST");
  assertExists(result.symbols, "Should have symbol table");
});

Deno.test("LSP Analysis - detects parse errors", () => {
  const code = `(let x 42`;  // Missing closing paren

  const result = analyzeDocument(code, "test.hql");

  assertEquals(result.errors.length > 0, true, "Should have errors");
  assertEquals(result.errors[0].severity, 1, "Should be error severity");
});

Deno.test("LSP Analysis - collects variable definitions", () => {
  const code = `(let myVar 123)`;

  const result = analyzeDocument(code, "test.hql");

  const symbol = result.symbols.get("myVar");
  assertExists(symbol, "Should find myVar symbol");
  assertEquals(symbol?.kind, "variable");
  assertEquals(symbol?.scope, "global");
});

Deno.test("LSP Analysis - collects function definitions", () => {
  const code = `(fn greet [name] (str "Hello " name))`;

  const result = analyzeDocument(code, "test.hql");

  const symbol = result.symbols.get("greet");
  assertExists(symbol, "Should find greet symbol");
  assertEquals(symbol?.kind, "function");
  assertEquals(symbol?.params?.length, 1);
  assertEquals(symbol?.params?.[0].name, "name");
});

Deno.test("LSP Analysis - collects macro definitions", () => {
  const code = `(macro unless [test body] \`(if (not ~test) ~body))`;

  const result = analyzeDocument(code, "test.hql");

  const symbol = result.symbols.get("unless");
  assertExists(symbol, "Should find unless symbol");
  assertEquals(symbol?.kind, "macro");
});

Deno.test("LSP Analysis - collects class definitions", () => {
  const code = `
(class Point
  (field x)
  (field y)
  (fn distance [self other]
    (Math.sqrt (+ (* (- other.x self.x) (- other.x self.x))
                  (* (- other.y self.y) (- other.y self.y))))))
`;

  const result = analyzeDocument(code, "test.hql");

  const symbol = result.symbols.get("Point");
  assertExists(symbol, "Should find Point symbol");
  assertEquals(symbol?.kind, "class");
  assertEquals(symbol?.fields?.length, 2);
  assertEquals(symbol?.methods?.length, 1);
});

Deno.test("LSP Analysis - collects enum definitions", () => {
  const code = `
(enum Color
  (case Red)
  (case Green)
  (case Blue))
`;

  const result = analyzeDocument(code, "test.hql");

  const symbol = result.symbols.get("Color");
  assertExists(symbol, "Should find Color symbol");
  assertEquals(symbol?.kind, "enum");
  assertEquals(symbol?.cases?.length, 3);
  assertEquals(symbol?.cases, ["Red", "Green", "Blue"]);
});

Deno.test("LSP Analysis - collects import symbols", () => {
  const code = `(import [map filter] from "std/collections")`;

  const result = analyzeDocument(code, "test.hql");

  const mapSymbol = result.symbols.get("map");
  assertExists(mapSymbol, "Should find map symbol");
  assertEquals(mapSymbol?.kind, "import");
  assertEquals(mapSymbol?.isImported, true);
  assertEquals(mapSymbol?.sourceModule, "std/collections");
});

Deno.test("LSP Analysis - tracks source locations", () => {
  const code = `(let myVar 42)`;

  const result = analyzeDocument(code, "test.hql");

  const symbol = result.symbols.get("myVar");
  assertExists(symbol?.location, "Should have location");
  assertEquals(symbol?.location?.filePath, "test.hql");
  assertExists(symbol?.location?.line, "Should have line number");
  assertExists(symbol?.location?.column, "Should have column number");
});

Deno.test("LSP Analysis - error has correct range", () => {
  const code = `(let x`;  // Error at end

  const result = analyzeDocument(code, "test.hql");

  assertEquals(result.errors.length > 0, true);
  const error = result.errors[0];
  assertExists(error.range, "Error should have range");
  assertExists(error.range.start.line, "Should have start line");
  assertExists(error.range.start.column, "Should have start column");
});

Deno.test("LSP Analysis - infers types from literals", () => {
  const code = `
(let strVar "hello")
(let numVar 42)
(let floatVar 3.14)
(let boolVar true)
`;

  const result = analyzeDocument(code, "test.hql");

  assertEquals(result.symbols.get("strVar")?.type, "String");
  assertEquals(result.symbols.get("numVar")?.type, "Int");
  assertEquals(result.symbols.get("floatVar")?.type, "Float");
  assertEquals(result.symbols.get("boolVar")?.type, "Bool");
});

Deno.test("LSP Analysis - marks exported symbols", () => {
  const code = `
(fn add [a b] (+ a b))
(fn subtract [a b] (- a b))
(export add)
`;

  const result = analyzeDocument(code, "test.hql");

  const addSymbol = result.symbols.get("add");
  assertExists(addSymbol, "Should find add symbol");
  assertEquals(addSymbol?.isExported, true, "add should be exported");

  const subSymbol = result.symbols.get("subtract");
  assertExists(subSymbol, "Should find subtract symbol");
  assertEquals(subSymbol?.isExported, undefined, "subtract should not be exported");
});

Deno.test("LSP Analysis - marks vector-exported symbols", () => {
  const code = `
(fn foo [] 1)
(fn bar [] 2)
(fn baz [] 3)
(export [foo bar])
`;

  const result = analyzeDocument(code, "test.hql");

  assertEquals(result.symbols.get("foo")?.isExported, true, "foo should be exported");
  assertEquals(result.symbols.get("bar")?.isExported, true, "bar should be exported");
  assertEquals(result.symbols.get("baz")?.isExported, undefined, "baz should not be exported");
});

Deno.test("LSP Analysis - handles inline export (export (fn ...))", () => {
  const code = `
(export (fn add [a b] (+ a b)))
(export (fn subtract [a b] (- a b)))
`;

  const result = analyzeDocument(code, "test.hql");

  const addSymbol = result.symbols.get("add");
  assertExists(addSymbol, "Should find add symbol");
  assertEquals(addSymbol?.kind, "function", "add should be a function");
  assertEquals(addSymbol?.isExported, true, "add should be exported");
  assertEquals(addSymbol?.params?.length, 2, "add should have 2 params");

  const subSymbol = result.symbols.get("subtract");
  assertExists(subSymbol, "Should find subtract symbol");
  assertEquals(subSymbol?.isExported, true, "subtract should be exported");
});
