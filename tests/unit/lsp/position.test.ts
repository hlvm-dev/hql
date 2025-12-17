/**
 * LSP Position Utilities Tests
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  toLSPPosition,
  toLSPRange,
  toHQLPosition,
  toHQLRange,
  createHQLPosition,
  createHQLRange,
} from "../../../lsp/utils/position.ts";

// ============================================
// Position Conversion Tests
// ============================================

Deno.test("Position - HQL to LSP converts correctly", () => {
  // HQL is 1-indexed, LSP is 0-indexed
  const hqlPos = { line: 1, column: 1 };
  const lspPos = toLSPPosition(hqlPos);

  assertEquals(lspPos.line, 0);
  assertEquals(lspPos.character, 0);
});

Deno.test("Position - HQL to LSP handles arbitrary positions", () => {
  const hqlPos = { line: 10, column: 5 };
  const lspPos = toLSPPosition(hqlPos);

  assertEquals(lspPos.line, 9);
  assertEquals(lspPos.character, 4);
});

Deno.test("Position - LSP to HQL converts correctly", () => {
  const lspPos = { line: 0, character: 0 };
  const hqlPos = toHQLPosition(lspPos);

  assertEquals(hqlPos.line, 1);
  assertEquals(hqlPos.column, 1);
});

Deno.test("Position - LSP to HQL handles arbitrary positions", () => {
  const lspPos = { line: 9, character: 4 };
  const hqlPos = toHQLPosition(lspPos);

  assertEquals(hqlPos.line, 10);
  assertEquals(hqlPos.column, 5);
});

Deno.test("Position - roundtrip HQL -> LSP -> HQL", () => {
  const original = { line: 42, column: 17 };
  const roundtrip = toHQLPosition(toLSPPosition(original));

  assertEquals(roundtrip.line, original.line);
  assertEquals(roundtrip.column, original.column);
});

// ============================================
// Range Conversion Tests
// ============================================

Deno.test("Range - HQL to LSP converts correctly", () => {
  const hqlRange = {
    start: { line: 1, column: 1 },
    end: { line: 1, column: 10 },
  };
  const lspRange = toLSPRange(hqlRange);

  assertEquals(lspRange.start.line, 0);
  assertEquals(lspRange.start.character, 0);
  assertEquals(lspRange.end.line, 0);
  assertEquals(lspRange.end.character, 9);
});

Deno.test("Range - LSP to HQL converts correctly", () => {
  const lspRange = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 9 },
  };
  const hqlRange = toHQLRange(lspRange);

  assertEquals(hqlRange.start.line, 1);
  assertEquals(hqlRange.start.column, 1);
  assertEquals(hqlRange.end.line, 1);
  assertEquals(hqlRange.end.column, 10);
});

// ============================================
// Factory Function Tests
// ============================================

Deno.test("createHQLPosition - creates correct position", () => {
  const pos = createHQLPosition(5, 10);

  assertEquals(pos.line, 5);
  assertEquals(pos.column, 10);
});

Deno.test("createHQLRange - creates correct range", () => {
  const range = createHQLRange(1, 5, 1, 15);

  assertEquals(range.start.line, 1);
  assertEquals(range.start.column, 5);
  assertEquals(range.end.line, 1);
  assertEquals(range.end.column, 15);
});

// ============================================
// Edge Cases
// ============================================

Deno.test("Position - handles zero/negative gracefully", () => {
  // HQL position with 0 should become -1 in LSP (but clamped to 0)
  const hqlPos = { line: 0, column: 0 };
  const lspPos = toLSPPosition(hqlPos);

  // Should clamp to 0, not go negative
  assertEquals(lspPos.line >= 0, true);
  assertEquals(lspPos.character >= 0, true);
});
