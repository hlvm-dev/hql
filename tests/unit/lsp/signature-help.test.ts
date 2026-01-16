/**
 * LSP Signature Help Tests
 *
 * Tests for parameter hints when typing function calls.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TextDocument } from "npm:vscode-languageserver-textdocument@1.0.11";
import { getSignatureHelp } from "../../../src/hql/lsp/features/signature-help.ts";
import { SymbolTable } from "../../../src/hql/transpiler/symbol_table.ts";

/**
 * Create a TextDocument for testing
 */
function createDoc(content: string): TextDocument {
  return TextDocument.create("file:///test.hql", "hql", 1, content);
}

/**
 * Create a SymbolTable with test functions
 */
function createSymbols(): SymbolTable {
  const symbols = new SymbolTable();

  symbols.set({
    name: "add",
    kind: "function",
    scope: "global",
    params: [{ name: "a" }, { name: "b" }],
  });

  symbols.set({
    name: "greet",
    kind: "function",
    scope: "global",
    params: [{ name: "name", type: "String" }],
    documentation: "Greets a person by name",
  });

  symbols.set({
    name: "calculate",
    kind: "function",
    scope: "global",
    params: [
      { name: "x", type: "Number" },
      { name: "y", type: "Number" },
      { name: "op", type: "String" },
    ],
  });

  symbols.set({
    name: "noArgs",
    kind: "function",
    scope: "global",
    params: [],
  });

  symbols.set({
    name: "my-macro",
    kind: "macro",
    scope: "global",
    params: [{ name: "test" }, { name: "body" }],
  });

  return symbols;
}

// ============================================
// Basic Signature Help Tests
// ============================================

Deno.test("SignatureHelp - returns null for empty document", () => {
  const doc = createDoc("");
  const symbols = createSymbols();

  const result = getSignatureHelp(doc, { line: 0, character: 0 }, symbols);
  assertEquals(result, null);
});

Deno.test("SignatureHelp - returns null outside function call", () => {
  const doc = createDoc("(let x 10)");
  const symbols = createSymbols();

  // Position after the closing paren
  const result = getSignatureHelp(doc, { line: 0, character: 10 }, symbols);
  assertEquals(result, null);
});

Deno.test("SignatureHelp - returns signature for function at first arg", () => {
  const doc = createDoc("(add ");
  const symbols = createSymbols();

  // Position after "add " - first argument position
  const result = getSignatureHelp(doc, { line: 0, character: 5 }, symbols);

  assertExists(result);
  assertEquals(result.signatures.length, 1);
  assertEquals(result.activeSignature, 0);
  assertEquals(result.activeParameter, 0);
  assertEquals(result.signatures[0].label.includes("add"), true);
});

Deno.test("SignatureHelp - returns signature for function at second arg", () => {
  const doc = createDoc("(add 1 ");
  const symbols = createSymbols();

  // Position after "add 1 " - second argument position
  const result = getSignatureHelp(doc, { line: 0, character: 7 }, symbols);

  assertExists(result);
  assertEquals(result.activeParameter, 1);
});

Deno.test("SignatureHelp - shows typed parameters", () => {
  const doc = createDoc("(greet ");
  const symbols = createSymbols();

  const result = getSignatureHelp(doc, { line: 0, character: 7 }, symbols);

  assertExists(result);
  const label = result.signatures[0].label;
  assertEquals(label.includes("name: String"), true);
});

Deno.test("SignatureHelp - includes documentation", () => {
  const doc = createDoc("(greet ");
  const symbols = createSymbols();

  const result = getSignatureHelp(doc, { line: 0, character: 7 }, symbols);

  assertExists(result);
  assertEquals(result.signatures[0].documentation, "Greets a person by name");
});

Deno.test("SignatureHelp - handles multiple parameters", () => {
  const doc = createDoc("(calculate 1 2 ");
  const symbols = createSymbols();

  // Position at third argument
  const result = getSignatureHelp(doc, { line: 0, character: 15 }, symbols);

  assertExists(result);
  assertEquals(result.activeParameter, 2);
  assertEquals(result.signatures[0].parameters?.length, 3);
});

Deno.test("SignatureHelp - works with macros", () => {
  const doc = createDoc("(my-macro ");
  const symbols = createSymbols();

  const result = getSignatureHelp(doc, { line: 0, character: 10 }, symbols);

  assertExists(result);
  assertEquals(result.signatures[0].label.includes("my-macro"), true);
});

Deno.test("SignatureHelp - returns null for unknown function", () => {
  const doc = createDoc("(unknown-fn ");
  const symbols = createSymbols();

  const result = getSignatureHelp(doc, { line: 0, character: 12 }, symbols);
  assertEquals(result, null);
});

Deno.test("SignatureHelp - returns null for special forms", () => {
  const doc = createDoc("(let ");
  const symbols = createSymbols();

  const result = getSignatureHelp(doc, { line: 0, character: 5 }, symbols);
  assertEquals(result, null);
});

Deno.test("SignatureHelp - returns null for if", () => {
  const doc = createDoc("(if ");
  const symbols = createSymbols();

  const result = getSignatureHelp(doc, { line: 0, character: 4 }, symbols);
  assertEquals(result, null);
});

Deno.test("SignatureHelp - handles no-arg functions", () => {
  const doc = createDoc("(noArgs");
  const symbols = createSymbols();

  const result = getSignatureHelp(doc, { line: 0, character: 7 }, symbols);

  assertExists(result);
  assertEquals(result.signatures[0].label, "(noArgs)");
  assertEquals(result.signatures[0].parameters?.length, 0);
});

// ============================================
// Nested Call Tests
// ============================================

Deno.test("SignatureHelp - handles nested calls - inner function", () => {
  const doc = createDoc("(add (greet ");
  const symbols = createSymbols();

  // Position inside greet call
  const result = getSignatureHelp(doc, { line: 0, character: 12 }, symbols);

  assertExists(result);
  assertEquals(result.signatures[0].label.includes("greet"), true);
});

Deno.test("SignatureHelp - handles nested calls - outer function", () => {
  const doc = createDoc("(add (greet \"Alice\") ");
  const symbols = createSymbols();

  // Position after nested call, in outer function
  const result = getSignatureHelp(doc, { line: 0, character: 21 }, symbols);

  assertExists(result);
  assertEquals(result.signatures[0].label.includes("add"), true);
  // Note: argument counting for complex expressions is approximate
});

// ============================================
// String Handling Tests
// ============================================

Deno.test("SignatureHelp - handles strings in arguments", () => {
  const doc = createDoc('(greet "Alice" ');
  const symbols = createSymbols();

  const result = getSignatureHelp(doc, { line: 0, character: 15 }, symbols);

  assertExists(result);
  assertEquals(result.signatures[0].label.includes("greet"), true);
  // Note: String content handling is approximate
});

// ============================================
// Edge Cases
// ============================================

Deno.test("SignatureHelp - handles multiline", () => {
  const doc = createDoc(`(add
    1
    `);
  const symbols = createSymbols();

  // Position at line 2, about to type second arg
  const result = getSignatureHelp(doc, { line: 2, character: 4 }, symbols);

  assertExists(result);
  assertEquals(result.activeParameter, 1);
});

Deno.test("SignatureHelp - activeParameter capped at param count", () => {
  const doc = createDoc("(add 1 2 3 4 5 ");
  const symbols = createSymbols();

  // Way more args than parameters
  const result = getSignatureHelp(doc, { line: 0, character: 15 }, symbols);

  assertExists(result);
  // add only has 2 params, so activeParameter should be capped at 1 (0-indexed)
  assertEquals(result.activeParameter, 1);
});
