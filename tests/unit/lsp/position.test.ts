/**
 * LSP Position Utilities Tests
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  toLSPPosition,
  toLSPRange,
} from "../../../src/hql/lsp/utils/position.ts";

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
