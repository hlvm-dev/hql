/**
 * LSP Analysis Tests
 *
 * Tests the core analysis functionality that powers the LSP server.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { analyzeDocument } from "../../../src/hql/lsp/analysis.ts";

Deno.test("LSP Analysis - parses valid HQL code without errors", () => {
  const code = `
(let x 42)
(fn add [a b] (+ a b))
(print (add x 10))
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
  (var x 0)
  (var y 0)
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

// ============================================================================
// Type Annotation Tests - HQL Type System Support
// ============================================================================

Deno.test("LSP Analysis - extracts parameter type annotations", () => {
  const code = `(fn add [a:number b:number] (+ a b))`;

  const result = analyzeDocument(code, "test.hql");

  const symbol = result.symbols.get("add");
  assertExists(symbol, "Should find add symbol");
  assertEquals(symbol?.params?.length, 2, "Should have 2 params");
  assertEquals(symbol?.params?.[0].name, "a", "First param name should be 'a'");
  assertEquals(symbol?.params?.[0].type, "number", "First param type should be 'number'");
  assertEquals(symbol?.params?.[1].name, "b", "Second param name should be 'b'");
  assertEquals(symbol?.params?.[1].type, "number", "Second param type should be 'number'");
});

Deno.test("LSP Analysis - extracts return type annotation", () => {
  const code = `(fn add [a b] :number (+ a b))`;

  const result = analyzeDocument(code, "test.hql");

  const symbol = result.symbols.get("add");
  assertExists(symbol, "Should find add symbol");
  assertEquals(symbol?.returnType, "number", "Return type should be 'number'");
});

Deno.test("LSP Analysis - extracts both parameter and return types", () => {
  const code = `(fn greet [name:string] :string (str "Hello " name))`;

  const result = analyzeDocument(code, "test.hql");

  const symbol = result.symbols.get("greet");
  assertExists(symbol, "Should find greet symbol");
  assertEquals(symbol?.params?.[0].name, "name", "Param name should be 'name'");
  assertEquals(symbol?.params?.[0].type, "string", "Param type should be 'string'");
  assertEquals(symbol?.returnType, "string", "Return type should be 'string'");
});

Deno.test("LSP Analysis - handles complex type annotations", () => {
  // Note: Array types like string[] can't be used directly as the [] is parsed
  // as vector syntax. Use Array<string> or custom type names instead.
  const code = `(fn process [items:Array callback:Function] :Promise (map callback items))`;

  const result = analyzeDocument(code, "test.hql");

  const symbol = result.symbols.get("process");
  assertExists(symbol, "Should find process symbol");
  assertEquals(symbol?.params?.[0].type, "Array", "First param type should be 'Array'");
  assertEquals(symbol?.params?.[1].type, "Function", "Second param type should be 'Function'");
  assertEquals(symbol?.returnType, "Promise", "Return type should be 'Promise'");
});

Deno.test("LSP Analysis - extracts class method types", () => {
  const code = `
(class Calculator
  (var value:number 0)
  (fn add [x:number] :number (+ this.value x)))
`;

  const result = analyzeDocument(code, "test.hql");

  const symbol = result.symbols.get("Calculator");
  assertExists(symbol, "Should find Calculator symbol");
  assertEquals(symbol?.fields?.[0].name, "value", "Field name should be 'value'");
  assertEquals(symbol?.fields?.[0].type, "number", "Field type should be 'number'");
  assertEquals(symbol?.methods?.[0].name, "add", "Method name should be 'add'");
  assertEquals(symbol?.methods?.[0].params?.[0].name, "x", "Method param name should be 'x'");
  assertEquals(symbol?.methods?.[0].params?.[0].type, "number", "Method param type should be 'number'");
  assertEquals(symbol?.methods?.[0].returnType, "number", "Method return type should be 'number'");
});

Deno.test("LSP Analysis - handles mixed typed and untyped params", () => {
  const code = `(fn mixed [a:number b c:string] (print a b c))`;

  const result = analyzeDocument(code, "test.hql");

  const symbol = result.symbols.get("mixed");
  assertExists(symbol, "Should find mixed symbol");
  assertEquals(symbol?.params?.length, 3, "Should have 3 params");
  assertEquals(symbol?.params?.[0].name, "a");
  assertEquals(symbol?.params?.[0].type, "number");
  assertEquals(symbol?.params?.[1].name, "b");
  assertEquals(symbol?.params?.[1].type, undefined, "Untyped param should have no type");
  assertEquals(symbol?.params?.[2].name, "c");
  assertEquals(symbol?.params?.[2].type, "string");
});
