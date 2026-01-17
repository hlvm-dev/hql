/**
 * Comprehensive Unit Tests for HLVM REPL Plugin
 *
 * Tests all exported functions from hlvm-plugin.ts with real inputs,
 * no mocks, no hardcoded workarounds.
 */

import { assertEquals, assertStringIncludes, assert } from "https://deno.land/std@0.218.0/assert/mod.ts";
import {
  cleanJs,
  makeComment,
  analyzeExpression,
  wrapInExportFunction,
  wrapInAsyncExportFunction,
  transformForGlobalThis,
  hlvmPlugin,
} from "../../src/hlvm/cli/hlvm-plugin.ts";
import { parse } from "../../src/hql/transpiler/pipeline/parser.ts";
import type { SList } from "../../src/hql/s-exp/types.ts";

// ============================================================================ 
// cleanJs() Tests
// ============================================================================ 

Deno.test("cleanJs: removes single-quote 'use strict'", () => {
  const input = "'use strict';\nconst x = 1;";
  const result = cleanJs(input);
  assertEquals(result, "const x = 1;");
});

Deno.test("cleanJs: removes double-quote \"use strict\"", () => {
  const input = '"use strict";\nconst x = 1;';
  const result = cleanJs(input);
  assertEquals(result, "const x = 1;");
});

Deno.test("cleanJs: removes sourceMappingURL comment", () => {
  const input = "const x = 1;\n//# sourceMappingURL=data:application/json;base64,abc123";
  const result = cleanJs(input);
  assertEquals(result, "const x = 1;");
});

Deno.test("cleanJs: removes both use strict and sourcemap", () => {
  const input = "'use strict';\nconst x = 1;\n//# sourceMappingURL=foo.map";
  const result = cleanJs(input);
  assertEquals(result, "const x = 1;");
});

Deno.test("cleanJs: trims whitespace", () => {
  const input = "  \n  const x = 1;  \n  ";
  const result = cleanJs(input);
  assertEquals(result, "const x = 1;");
});

Deno.test("cleanJs: removes trailing semicolon when removeSemi=true", () => {
  const input = "const x = 1;";
  const result = cleanJs(input, true);
  assertEquals(result, "const x = 1");
});

Deno.test("cleanJs: keeps trailing semicolon when removeSemi=false", () => {
  const input = "const x = 1;";
  const result = cleanJs(input, false);
  assertEquals(result, "const x = 1;");
});

Deno.test("cleanJs: handles empty input", () => {
  const result = cleanJs("");
  assertEquals(result, "");
});

Deno.test("cleanJs: handles input with only use strict", () => {
  const result = cleanJs("'use strict';");
  assertEquals(result, "");
});

// ============================================================================ 
// makeComment() Tests
// ============================================================================ 

Deno.test("makeComment: generates correct format", () => {
  const result = makeComment(5, "(+ 1 2)");
  assertEquals(result, "\n// Line 5: (+ 1 2)\n");
});

Deno.test("makeComment: truncates input longer than 60 chars", () => {
  const longInput = "a".repeat(100);
  const result = makeComment(1, longInput);
  assertStringIncludes(result, "a".repeat(60) + "...");
  assert(!result.includes("a".repeat(61)));
});

Deno.test("makeComment: does not truncate input exactly 60 chars", () => {
  const input = "a".repeat(60);
  const result = makeComment(1, input);
  assertStringIncludes(result, input);
  assert(!result.includes("..."));
});

Deno.test("makeComment: handles empty input", () => {
  const result = makeComment(1, "");
  assertEquals(result, "\n// Line 1: \n");
});

// ============================================================================ 
// analyzeExpression() Tests - Using Real Parser
// ============================================================================ 

function parseFirst(code: string): SList {
  const ast = parse(code, "<test>");
  return ast[0] as SList;
}

Deno.test("analyzeExpression: detects import expression", () => {
  const ast = parseFirst('(import "foo")');
  const result = analyzeExpression(ast);
  assertEquals(result.kind, "import");
});

Deno.test("analyzeExpression: detects fn declaration with name", () => {
  const ast = parseFirst("(fn add [a b] (+ a b))");
  const result = analyzeExpression(ast);
  assertEquals(result.kind, "declaration");
  assertEquals(result.name, "add");
});

Deno.test("analyzeExpression: detects class declaration with name", () => {
  const ast = parseFirst("(class Point [x y])");
  const result = analyzeExpression(ast);
  assertEquals(result.kind, "declaration");
  assertEquals(result.name, "Point");
});

Deno.test("analyzeExpression: detects enum declaration with name", () => {
  const ast = parseFirst("(enum Color (case Red) (case Green))");
  const result = analyzeExpression(ast);
  assertEquals(result.kind, "declaration");
  assertEquals(result.name, "Color");
});

Deno.test("analyzeExpression: detects let binding with name", () => {
  const ast = parseFirst("(let x 10)");
  const result = analyzeExpression(ast);
  assertEquals(result.kind, "binding");
  assertEquals(result.name, "x");
});

Deno.test("analyzeExpression: detects const binding with name", () => {
  const ast = parseFirst("(const PI 3.14)");
  const result = analyzeExpression(ast);
  assertEquals(result.kind, "binding");
  assertEquals(result.name, "PI");
});

Deno.test("analyzeExpression: detects var binding with name", () => {
  const ast = parseFirst("(var counter 0)");
  const result = analyzeExpression(ast);
  assertEquals(result.kind, "binding");
  assertEquals(result.name, "counter");
});

Deno.test("analyzeExpression: detects regular expression", () => {
  const ast = parseFirst("(+ 1 2)");
  const result = analyzeExpression(ast);
  assertEquals(result.kind, "expression");
  assertEquals(result.name, undefined);
});

Deno.test("analyzeExpression: detects function call as expression", () => {
  const ast = parseFirst("(print \"hello\")");
  const result = analyzeExpression(ast);
  assertEquals(result.kind, "expression");
});

Deno.test("analyzeExpression: handles anonymous fn as declaration", () => {
  // Anonymous fn still has kind "declaration" but no name
  const ast = parseFirst("(fn [x] (* x 2))");
  const result = analyzeExpression(ast);
  assertEquals(result.kind, "declaration");
  assertEquals(result.name, undefined);
});

// ============================================================================ 
// wrapInExportFunction() Tests
// ============================================================================ 

Deno.test("wrapInExportFunction: generates valid export function", () => {
  const result = wrapInExportFunction("__test", "1 + 2", "// comment\n");
  assertStringIncludes(result, "export function __test()")
  assertStringIncludes(result, "const __result = 1 + 2;");
  assertStringIncludes(result, "return { success: true, value: __result }");
  assertStringIncludes(result, "return { success: false, error: __error }");
});

Deno.test("wrapInExportFunction: includes comment", () => {
  const result = wrapInExportFunction("fn", "x", "\n// Line 5: test\n");
  assertStringIncludes(result, "// Line 5: test");
});

Deno.test("wrapInExportFunction: produces executable code", async () => {
  const code = wrapInExportFunction("testFn", "42", "");
  // Create a data URL module and import it
  const dataUrl = `data:text/javascript,${encodeURIComponent(code)}`;
  const mod = await import(dataUrl);
  const result = mod.testFn();
  assertEquals(result.success, true);
  assertEquals(result.value, 42);
});

Deno.test("wrapInExportFunction: catches errors", async () => {
  // Use an IIFE that throws - this is valid as an expression
  const code = wrapInExportFunction("errorFn", "(() => { throw new Error('test'); })()", "");
  const dataUrl = `data:text/javascript,${encodeURIComponent(code)}`;
  const mod = await import(dataUrl);
  const result = mod.errorFn();
  assertEquals(result.success, false);
  assert(result.error instanceof Error);
  assertEquals(result.error.message, "test");
});

// ============================================================================ 
// wrapInAsyncExportFunction() Tests
// ============================================================================ 

Deno.test("wrapInAsyncExportFunction: generates valid async export function", () => {
  const result = wrapInAsyncExportFunction("__test", "await fetch('/')", "// comment\n");
  assertStringIncludes(result, "export function __test()")
  assertStringIncludes(result, "return (async () => {");
  assertStringIncludes(result, "await fetch('/')");
  assertStringIncludes(result, "return { success: true, value: undefined }");
  assertStringIncludes(result, "return { success: false, error: __error }");
});

Deno.test("wrapInAsyncExportFunction: produces executable async code", async () => {
  const code = wrapInAsyncExportFunction("asyncFn", "const x = await Promise.resolve(99);", "");
  const dataUrl = `data:text/javascript,${encodeURIComponent(code)}`;
  const mod = await import(dataUrl);
  const result = await mod.asyncFn();
  assertEquals(result.success, true);
  assertEquals(result.value, undefined); // async wrapper returns undefined
});

Deno.test("wrapInAsyncExportFunction: catches async errors", async () => {
  const code = wrapInAsyncExportFunction("asyncErrorFn", "throw new Error('async fail');", "");
  const dataUrl = `data:text/javascript,${encodeURIComponent(code)}`;
  const mod = await import(dataUrl);
  const result = await mod.asyncErrorFn();
  assertEquals(result.success, false);
  assert(result.error instanceof Error);
  assertEquals(result.error.message, "async fail");
});

// ============================================================================ 
// transformForGlobalThis() Tests
// ============================================================================ 

Deno.test("transformForGlobalThis: transforms expression-everywhere let format", () => {
  const input = 'let x;\n(x = 42);';
  const result = transformForGlobalThis(input, "x");
  assertEquals(result, '(globalThis["x"] = 42);');
});

Deno.test("transformForGlobalThis: transforms expression-everywhere with multiple vars", () => {
  const input = 'let x, y;\n(x = 10);';
  const result = transformForGlobalThis(input, "x");
  assertEquals(result, '(globalThis["x"] = 10);');
});

Deno.test("transformForGlobalThis: transforms legacy function declaration", () => {
  const input = "function add(a, b) { return a + b; }";
  const result = transformForGlobalThis(input, "add");
  assertEquals(result, 'globalThis["add"] = function(a, b) { return a + b; }');
});

Deno.test("transformForGlobalThis: transforms legacy class declaration", () => {
  const input = "class Point { constructor(x) { this.x = x; } }";
  const result = transformForGlobalThis(input, "Point");
  assertEquals(result, 'globalThis["Point"] = class { constructor(x) { this.x = x; } }');
});

Deno.test("transformForGlobalThis: returns unchanged for unrecognized format", () => {
  const input = "const x = 5;";
  const result = transformForGlobalThis(input, "x");
  assertEquals(result, input);
});

Deno.test("transformForGlobalThis: handles function with complex body", () => {
  const input = "function factorial(n) {\n  if (n <= 1) return 1;\n  return n * factorial(n - 1);\n}";
  const result = transformForGlobalThis(input, "factorial");
  assertStringIncludes(result, 'globalThis["factorial"] = function');
  assertStringIncludes(result, "factorial(n - 1)");
});

// ============================================================================ 
// Integration Tests - hlvmPlugin.evaluate() with Mock Context
// ============================================================================ 

function createMockContext(lineNumber: number = 1) {
  const state = new Map<string, unknown>();
  let moduleCode = "";
  let moduleVersion = 0;

  return {
    lineNumber,
    getState<T>(key: string): T | undefined {
      return state.get(key) as T | undefined;
    },
    setState(key: string, value: unknown) {
      state.set(key, value);
    },
    appendToModule(code: string) {
      moduleCode += code;
    },
    async reimportModule() {
      moduleVersion++;
      const dataUrl = `data:text/javascript,${encodeURIComponent(moduleCode)}`;
      // Add version to bust cache
      return await import(`${dataUrl}#v${moduleVersion}`);
    },
    getModuleCode() {
      return moduleCode;
    }
  };
}

Deno.test("hlvmPlugin.evaluate: simple arithmetic expression", async () => {
  const ctx = createMockContext(1);
  const result = await hlvmPlugin.evaluate("(+ 1 2)", ctx as any);
  assertEquals((result as any).value, 3);
});

Deno.test("hlvmPlugin.evaluate: string expression", async () => {
  const ctx = createMockContext(1);
  const result = await hlvmPlugin.evaluate('"hello"', ctx as any);
  assertEquals((result as any).value, "hello");
});

Deno.test("hlvmPlugin.evaluate: boolean expression", async () => {
  const ctx = createMockContext(1);
  const result = await hlvmPlugin.evaluate("(> 5 3)", ctx as any);
  assertEquals((result as any).value, true);
});

Deno.test("hlvmPlugin.evaluate: let binding returns value", async () => {
  const ctx = createMockContext(1);
  const result = await hlvmPlugin.evaluate("(let x 42)", ctx as any);
  assertEquals((result as any).value, 42);
});

Deno.test("hlvmPlugin.evaluate: const binding returns value", async () => {
  const ctx = createMockContext(1);
  const result = await hlvmPlugin.evaluate("(const PI 3.14159)", ctx as any);
  assertEquals((result as any).value, 3.14159);
});

Deno.test("hlvmPlugin.evaluate: fn declaration returns function", async () => {
  const ctx = createMockContext(1);
  const result = await hlvmPlugin.evaluate("(fn double [x] (* x 2))", ctx as any);
  assertEquals(typeof (result as any).value, "function");
});

Deno.test("hlvmPlugin.evaluate: class declaration returns constructor", async () => {
  const ctx = createMockContext(1);
  const result = await hlvmPlugin.evaluate("(class Box [value])", ctx as any);
  assertEquals(typeof (result as any).value, "function");
});

Deno.test("hlvmPlugin.evaluate: empty input returns suppressOutput", async () => {
  const ctx = createMockContext(1);
  const result = await hlvmPlugin.evaluate("", ctx as any);
  assertEquals((result as any).suppressOutput, true);
});

Deno.test("hlvmPlugin.evaluate: comment-only input returns suppressOutput", async () => {
  const ctx = createMockContext(1);
  const result = await hlvmPlugin.evaluate("; this is a comment", ctx as any);
  assertEquals((result as any).suppressOutput, true);
});

Deno.test("hlvmPlugin.evaluate: complex nested expression", async () => {
  const ctx = createMockContext(1);
  const result = await hlvmPlugin.evaluate("(+ (* 2 3) (- 10 4))", ctx as any);
  assertEquals((result as any).value, 12); // (2*3) + (10-4) = 6 + 6 = 12
});

Deno.test("hlvmPlugin.evaluate: array literal", async () => {
  const ctx = createMockContext(1);
  const result = await hlvmPlugin.evaluate("[1 2 3]", ctx as any);
  assertEquals((result as any).value, [1, 2, 3]);
});

Deno.test("hlvmPlugin.evaluate: if expression returns value", async () => {
  const ctx = createMockContext(1);
  const result = await hlvmPlugin.evaluate('(if true "yes" "no")', ctx as any);
  assertEquals((result as any).value, "yes");
});

// ============================================================================ 
// hlvmPlugin.detect() Tests
// ============================================================================ 

Deno.test("hlvmPlugin.detect: returns 100 for parenthesis start", () => {
  const ctx = createMockContext(1);
  const result = hlvmPlugin.detect!("(+ 1 2)", ctx as any);
  assertEquals(result, 100);
});

Deno.test("hlvmPlugin.detect: returns 100 for semicolon (comment) start", () => {
  const ctx = createMockContext(1);
  const result = hlvmPlugin.detect!("; comment", ctx as any);
  assertEquals(result, 100);
});

Deno.test("hlvmPlugin.detect: returns 100 for hash start", () => {
  const ctx = createMockContext(1);
  const result = hlvmPlugin.detect!("#[1 2]", ctx as any);
  assertEquals(result, 100);
});

Deno.test("hlvmPlugin.detect: returns false for JavaScript code", () => {
  const ctx = createMockContext(1);
  const result = hlvmPlugin.detect!("const x = 1;", ctx as any);
  assertEquals(result, false);
});

Deno.test("hlvmPlugin.detect: returns false for empty string", () => {
  const ctx = createMockContext(1);
  const result = hlvmPlugin.detect!("", ctx as any);
  assertEquals(result, false);
});

Deno.test("hlvmPlugin.detect: handles whitespace before code", () => {
  const ctx = createMockContext(1);
  const result = hlvmPlugin.detect!("   (+ 1 2)", ctx as any);
  assertEquals(result, 100);
});

// ============================================================================ 
// hlvmPlugin.init() Tests
// ============================================================================ 

Deno.test("hlvmPlugin.init: initializes declaredNames state", async () => {
  const ctx = createMockContext(1);
  await hlvmPlugin.init!(ctx as any);
  const declaredNames = ctx.getState<Set<string>>("declaredNames");
  assert(declaredNames instanceof Set);
  assertEquals(declaredNames.size, 0);
});

// ============================================================================ 
// State Persistence Tests
// ============================================================================ 

Deno.test("hlvmPlugin: variable persists across evaluations via globalThis", async () => {
  const ctx = createMockContext(1);

  // Define a variable
  await hlvmPlugin.evaluate("(let myVar 100)", ctx as any);

  // Access it in next line (need to increment line number)
  ctx.lineNumber = 2;

  // The variable should be on globalThis
  assertEquals((globalThis as any)["myVar"], 100);

  // Cleanup
  delete (globalThis as any)["myVar"];
});

Deno.test("hlvmPlugin: function persists and is callable via globalThis", async () => {
  const ctx = createMockContext(1);

  // Define a function
  await hlvmPlugin.evaluate("(fn triple [x] (* x 3))", ctx as any);

  // Should be on globalThis
  const fn = (globalThis as any)["triple"];
  assertEquals(typeof fn, "function");
  assertEquals(fn(5), 15);

  // Cleanup
  delete (globalThis as any)["triple"];
});

// ============================================================================ 
// Error Handling Tests
// ============================================================================ 

Deno.test("hlvmPlugin.evaluate: throws on syntax error", async () => {
  const ctx = createMockContext(1);
  let threw = false;
  try {
    await hlvmPlugin.evaluate("(+ 1", ctx as any); // Missing closing paren
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("hlvmPlugin.evaluate: throws on runtime error", async () => {
  const ctx = createMockContext(1);
  let threw = false;
  try {
    await hlvmPlugin.evaluate("(throw (new Error \"test error\"))", ctx as any);
  } catch (e) {
    threw = true;
    assert(e instanceof Error);
  }
  assertEquals(threw, true);
});
