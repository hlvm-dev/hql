/**
 * LSP Features Tests
 *
 * Tests for hover, completion, and definition features.
 */

import {
  assertEquals,
  assertExists,
  assertNotEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { analyzeDocument } from "../../../lsp/analysis.ts";
import { getHover } from "../../../lsp/features/hover.ts";
import { getDefinition } from "../../../lsp/features/definition.ts";
import { getCompletions } from "../../../lsp/features/completion.ts";
import { getDiagnostics } from "../../../lsp/features/diagnostics.ts";

// ============================================
// Hover Tests
// ============================================

Deno.test("Hover - returns null for undefined symbol", () => {
  const result = getHover(undefined);
  assertEquals(result, null);
});

Deno.test("Hover - returns info for function symbol", () => {
  const code = `(fn greet [name] (str "Hello " name))`;
  const analysis = analyzeDocument(code, "test.hql");
  const symbol = analysis.symbols.get("greet");

  const hover = getHover(symbol);

  assertExists(hover);
  assertExists(hover.contents);
  assertEquals(typeof hover.contents, "object");

  const content = hover.contents as { kind: string; value: string };
  assertEquals(content.kind, "markdown");
  assertEquals(content.value.includes("Function"), true);
  assertEquals(content.value.includes("greet"), true);
});

Deno.test("Hover - shows parameters for functions", () => {
  const code = `(fn add [x y] (+ x y))`;
  const analysis = analyzeDocument(code, "test.hql");
  const symbol = analysis.symbols.get("add");

  const hover = getHover(symbol);

  assertExists(hover);
  const content = hover.contents as { value: string };
  assertEquals(content.value.includes("Parameters"), true);
  assertEquals(content.value.includes("x"), true);
  assertEquals(content.value.includes("y"), true);
});

Deno.test("Hover - shows enum cases", () => {
  const code = `(enum Color (case Red) (case Green) (case Blue))`;
  const analysis = analyzeDocument(code, "test.hql");
  const symbol = analysis.symbols.get("Color");

  const hover = getHover(symbol);

  assertExists(hover);
  const content = hover.contents as { value: string };
  assertEquals(content.value.includes("Enum"), true);
  assertEquals(content.value.includes("Cases"), true);
  assertEquals(content.value.includes("Red"), true);
});

// ============================================
// Completion Tests
// ============================================

Deno.test("Completion - includes keywords", () => {
  const completions = getCompletions(null);

  // Keywords and snippets are mixed, check by label
  const labels = completions.map((c) => c.label);
  assertEquals(labels.includes("let"), true);
  assertEquals(labels.includes("var"), true);
  assertEquals(labels.includes("fn"), true);
  assertEquals(labels.includes("if"), true);

  // Also check some remain as plain keywords
  const keywords = completions.filter((c) => c.detail === "keyword");
  assertNotEquals(keywords.length, 0);
});

Deno.test("Completion - includes builtins", () => {
  const completions = getCompletions(null);

  const labels = completions.map((c) => c.label);
  assertEquals(labels.includes("print"), true);
  assertEquals(labels.includes("map"), true);
  assertEquals(labels.includes("filter"), true);
  assertEquals(labels.includes("reduce"), true);
});

Deno.test("Completion - includes constants", () => {
  const completions = getCompletions(null);

  const labels = completions.map((c) => c.label);
  assertEquals(labels.includes("true"), true);
  assertEquals(labels.includes("false"), true);
  assertEquals(labels.includes("nil"), true);
});

Deno.test("Completion - includes user-defined symbols", () => {
  const code = `
(let myVar 42)
(fn myFunc [x] x)
`;
  const analysis = analyzeDocument(code, "test.hql");

  const completions = getCompletions(analysis.symbols);

  const labels = completions.map((c) => c.label);
  assertEquals(labels.includes("myVar"), true);
  assertEquals(labels.includes("myFunc"), true);
});

// ============================================
// Type Completion Tests
// ============================================

Deno.test("Completion - returns type completions when in type position", () => {
  // When isTypePosition is true, we get type completions
  const completions = getCompletions(null, undefined, { isTypePosition: true });

  const labels = completions.map((c) => c.label);

  // Should include primitive types
  assertEquals(labels.includes("number"), true, "Should include number type");
  assertEquals(labels.includes("string"), true, "Should include string type");
  assertEquals(labels.includes("boolean"), true, "Should include boolean type");
  assertEquals(labels.includes("any"), true, "Should include any type");
  assertEquals(labels.includes("void"), true, "Should include void type");

  // Should include object types
  assertEquals(labels.includes("Array"), true, "Should include Array type");
  assertEquals(labels.includes("Promise"), true, "Should include Promise type");
  assertEquals(labels.includes("Map"), true, "Should include Map type");
});

Deno.test("Completion - type completions exclude regular keywords", () => {
  const completions = getCompletions(null, undefined, { isTypePosition: true });

  const labels = completions.map((c) => c.label);

  // Type completions should NOT include regular keywords/builtins
  assertEquals(labels.includes("let"), false, "Should NOT include let keyword");
  assertEquals(labels.includes("fn"), false, "Should NOT include fn keyword");
  assertEquals(labels.includes("if"), false, "Should NOT include if keyword");
  assertEquals(labels.includes("print"), false, "Should NOT include print function");
});

Deno.test("Completion - returns regular completions when NOT in type position", () => {
  // When isTypePosition is false or undefined, we get regular completions
  const completions = getCompletions(null, undefined, { isTypePosition: false });

  const labels = completions.map((c) => c.label);

  // Should include regular keywords
  assertEquals(labels.includes("let"), true, "Should include let keyword");
  assertEquals(labels.includes("fn"), true, "Should include fn keyword");
  assertEquals(labels.includes("if"), true, "Should include if keyword");

  // Should include builtins
  assertEquals(labels.includes("print"), true, "Should include print function");
});

Deno.test("Completion - no context defaults to regular completions", () => {
  // When context is not provided, should return regular completions
  const completions = getCompletions(null);

  const labels = completions.map((c) => c.label);

  // Should include regular keywords
  assertEquals(labels.includes("let"), true);
  assertEquals(labels.includes("fn"), true);
});

// ============================================
// Definition Tests
// ============================================

Deno.test("Definition - returns null for undefined symbol", () => {
  const result = getDefinition(undefined);
  assertEquals(result, null);
});

Deno.test("Definition - returns null for symbol without location", () => {
  const result = getDefinition({ name: "test", kind: "variable", scope: "global" });
  assertEquals(result, null);
});

Deno.test("Definition - returns location for symbol with location", () => {
  const code = `(let myVar 42)`;
  const analysis = analyzeDocument(code, "/path/to/test.hql");
  const symbol = analysis.symbols.get("myVar");

  const definition = getDefinition(symbol);

  assertExists(definition);
  assertEquals(definition.uri.includes("test.hql"), true);
  assertExists(definition.range);
  assertExists(definition.range.start);
  assertExists(definition.range.end);
});

// ============================================
// Diagnostics Tests
// ============================================

Deno.test("Diagnostics - returns empty array for valid code", () => {
  const code = `(let x 42)`;
  const analysis = analyzeDocument(code, "test.hql");

  const diagnostics = getDiagnostics(analysis);

  assertEquals(diagnostics.length, 0);
});

Deno.test("Diagnostics - returns error for invalid code", () => {
  const code = `(let x`;  // Missing closing paren
  const analysis = analyzeDocument(code, "test.hql");

  const diagnostics = getDiagnostics(analysis);

  assertEquals(diagnostics.length > 0, true);
  assertEquals(diagnostics[0].severity, 1);  // Error
  assertEquals(diagnostics[0].source, "hql");
});

Deno.test("Diagnostics - has correct range", () => {
  const code = `(let x`;
  const analysis = analyzeDocument(code, "test.hql");

  const diagnostics = getDiagnostics(analysis);

  assertExists(diagnostics[0].range);
  assertExists(diagnostics[0].range.start);
  assertExists(diagnostics[0].range.end);
  // LSP positions are 0-indexed
  assertEquals(diagnostics[0].range.start.line >= 0, true);
  assertEquals(diagnostics[0].range.start.character >= 0, true);
});
