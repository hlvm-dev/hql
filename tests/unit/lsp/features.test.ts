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
