/**
 * Tests for LSP Semantic Tokens feature
 */

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { SemanticTokenTypes } from "npm:vscode-languageserver@9.0.1";
import {
  buildSemanticTokens,
  getSemanticTokensLegend,
  getSemanticTokensCapability,
} from "../../../src/hql/lsp/features/semantic-tokens.ts";
import { createDoc } from "./helpers.ts";

Deno.test("SemanticTokens - legend includes expected token types", () => {
  const legend = getSemanticTokensLegend();

  // Should include important types
  assert(legend.tokenTypes.includes(SemanticTokenTypes.keyword));
  assert(legend.tokenTypes.includes(SemanticTokenTypes.function));
  assert(legend.tokenTypes.includes(SemanticTokenTypes.variable));
  assert(legend.tokenTypes.includes(SemanticTokenTypes.class));
  assert(legend.tokenTypes.includes(SemanticTokenTypes.string));
  assert(legend.tokenTypes.includes(SemanticTokenTypes.number));
  assert(legend.tokenTypes.includes(SemanticTokenTypes.comment));
});

Deno.test("SemanticTokens - capability returns full provider", () => {
  const cap = getSemanticTokensCapability();

  assertEquals(cap.full, true);
  assert(cap.legend);
  assert(cap.legend.tokenTypes.length > 0);
});

Deno.test("SemanticTokens - returns tokens for code", () => {
  const doc = createDoc("(fn add [a b] (+ a b))");
  const tokens = buildSemanticTokens(doc, null);

  // Should return some tokens
  assert(tokens.length > 0);
  // Tokens are in groups of 5: line, char, length, type, modifiers
  assertEquals(tokens.length % 5, 0);
});

Deno.test("SemanticTokens - highlights keywords", () => {
  const doc = createDoc("(let x 1)");
  const tokens = buildSemanticTokens(doc, null);

  // Should have tokens
  assert(tokens.length > 0);
});

Deno.test("SemanticTokens - highlights comments", () => {
  const doc = createDoc("; this is a comment");
  const tokens = buildSemanticTokens(doc, null);

  // Should have at least the comment token
  assert(tokens.length >= 5);

  // First token should be the comment
  const legend = getSemanticTokensLegend();
  const commentTypeIndex = legend.tokenTypes.indexOf(SemanticTokenTypes.comment);
  assertEquals(tokens[3], commentTypeIndex); // 4th element is token type
});

Deno.test("SemanticTokens - highlights strings", () => {
  const doc = createDoc('(print "hello")');
  const tokens = buildSemanticTokens(doc, null);

  // Should have tokens
  assert(tokens.length > 0);

  // Check for string token type
  const legend = getSemanticTokensLegend();
  const stringTypeIndex = legend.tokenTypes.indexOf(SemanticTokenTypes.string);

  // Find the string token
  let hasString = false;
  for (let i = 0; i < tokens.length; i += 5) {
    if (tokens[i + 3] === stringTypeIndex) {
      hasString = true;
      break;
    }
  }
  assert(hasString, "Should have a string token");
});

Deno.test("SemanticTokens - highlights numbers", () => {
  const doc = createDoc("(let x 42)");
  const tokens = buildSemanticTokens(doc, null);

  // Should have tokens
  assert(tokens.length > 0);

  // Check for number token type
  const legend = getSemanticTokensLegend();
  const numberTypeIndex = legend.tokenTypes.indexOf(SemanticTokenTypes.number);

  // Find the number token
  let hasNumber = false;
  for (let i = 0; i < tokens.length; i += 5) {
    if (tokens[i + 3] === numberTypeIndex) {
      hasNumber = true;
      break;
    }
  }
  assert(hasNumber, "Should have a number token");
});

Deno.test("SemanticTokens - handles empty document", () => {
  const doc = createDoc("");
  const tokens = buildSemanticTokens(doc, null);

  assertEquals(tokens.length, 0);
});

Deno.test("SemanticTokens - handles multiline code", () => {
  const doc = createDoc(`(fn add [a b]
  ; Add two numbers
  (+ a b))`);
  const tokens = buildSemanticTokens(doc, null);

  // Should have tokens from multiple lines
  assert(tokens.length > 0);
});

Deno.test("SemanticTokens - handles template strings", () => {
  const doc = createDoc('(let msg `Hello ${name}`)');
  const tokens = buildSemanticTokens(doc, null);

  // Should have tokens
  assert(tokens.length > 0);
});

Deno.test("SemanticTokens - handles negative numbers", () => {
  const doc = createDoc("(let x -42)");
  const tokens = buildSemanticTokens(doc, null);

  // Should have tokens including the negative number
  assert(tokens.length > 0);
});

Deno.test("SemanticTokens - handles hex numbers", () => {
  const doc = createDoc("(let x 0xFF)");
  const tokens = buildSemanticTokens(doc, null);

  // Should have tokens
  assert(tokens.length > 0);

  // Check for number token type
  const legend = getSemanticTokensLegend();
  const numberTypeIndex = legend.tokenTypes.indexOf(SemanticTokenTypes.number);

  let hasNumber = false;
  for (let i = 0; i < tokens.length; i += 5) {
    if (tokens[i + 3] === numberTypeIndex) {
      hasNumber = true;
      break;
    }
  }
  assert(hasNumber, "Should have a number token for hex");
});

Deno.test("SemanticTokens - handles boolean literals", () => {
  const doc = createDoc("(if true 1 0)");
  const tokens = buildSemanticTokens(doc, null);

  // Should have tokens
  assert(tokens.length > 0);
});

Deno.test("SemanticTokens - handles class definitions", () => {
  const doc = createDoc("(class Point (var x 0) (var y 0))");
  const tokens = buildSemanticTokens(doc, null);

  // Should have tokens
  assert(tokens.length > 0);
});
