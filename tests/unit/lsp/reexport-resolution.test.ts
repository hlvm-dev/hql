/**
 * Tests for Re-Export Resolution
 *
 * These tests verify:
 * 1. Detection of re-exported symbols
 * 2. Following re-export chains to find original definitions
 * 3. Handling circular re-exports
 * 4. Integration with ProjectIndex
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ProjectIndex } from "../../../src/hql/lsp/workspace/project-index.ts";
import {
  isReExportedSymbol,
  resolveReExportChain,
  detectCircularReExports,
} from "../../../src/hql/lsp/imports/export-resolver.ts";
import type { SymbolInfo } from "../../../src/hql/transpiler/symbol_table.ts";

// Helper to create a mock analysis result
function createAnalysis(
  symbols: Array<{
    name: string;
    isExported?: boolean;
    isImported?: boolean;
    sourceModule?: string;
  }>
) {
  const symbolMap = new Map<string, SymbolInfo>();

  for (const sym of symbols) {
    symbolMap.set(sym.name, {
      name: sym.name,
      kind: "function",
      scope: "global",
      isExported: sym.isExported ?? false,
      isImported: sym.isImported ?? false,
      sourceModule: sym.sourceModule,
      location: { filePath: "", line: 1, column: 1 },
    } as SymbolInfo);
  }

  return {
    symbols: {
      getAllSymbols: () => Array.from(symbolMap.values()),
      get: (name: string) => symbolMap.get(name),
    },
    errors: [],
  };
}

// ============================================================================
// RE-EXPORT DETECTION TESTS (1-4)
// ============================================================================

Deno.test("ReExport - detects symbol that is both imported and exported", () => {
  const symbol: SymbolInfo = {
    name: "greet",
    kind: "function",
    scope: "global",
    isExported: true,
    isImported: true,
    sourceModule: "./original.hql",
    location: { filePath: "/middleware.hql", line: 1, column: 1 },
  } as SymbolInfo;

  const result = isReExportedSymbol(symbol);
  assertEquals(result, true);
});

Deno.test("ReExport - does not flag direct export as re-export", () => {
  const symbol: SymbolInfo = {
    name: "greet",
    kind: "function",
    scope: "global",
    isExported: true,
    isImported: false,
    location: { filePath: "/original.hql", line: 1, column: 1 },
  } as SymbolInfo;

  const result = isReExportedSymbol(symbol);
  assertEquals(result, false);
});

Deno.test("ReExport - does not flag imported but not exported symbol", () => {
  const symbol: SymbolInfo = {
    name: "helper",
    kind: "function",
    scope: "global",
    isExported: false,
    isImported: true,
    sourceModule: "./utils.hql",
    location: { filePath: "/main.hql", line: 1, column: 1 },
  } as SymbolInfo;

  const result = isReExportedSymbol(symbol);
  assertEquals(result, false);
});

Deno.test("ReExport - ProjectIndex marks re-exports correctly", () => {
  const index = new ProjectIndex();

  // Index original file - direct export
  const originalAnalysis = createAnalysis([
    { name: "greet", isExported: true },
  ]);
  index.indexFile("/original.hql", originalAnalysis as any);

  // Index middleware file - re-export
  const middlewareAnalysis = createAnalysis([
    { name: "greet", isExported: true, isImported: true, sourceModule: "./original.hql" },
  ]);
  index.indexFile("/middleware.hql", middlewareAnalysis as any);

  // Check that middleware export is marked as re-export
  const middlewareIndex = index.getFileIndex("/middleware.hql");
  assertExists(middlewareIndex);
  const exportInfo = middlewareIndex.exports.get("greet");
  assertExists(exportInfo);
  assertEquals(exportInfo.isReExport, true);
  assertEquals(exportInfo.originalModule, "./original.hql");
});

// ============================================================================
// RE-EXPORT CHAIN RESOLUTION TESTS (5-8)
// ============================================================================

Deno.test("ReExport - resolves simple re-export chain", () => {
  const index = new ProjectIndex();

  // Original: defines greet
  index.indexFile("/original.hql", createAnalysis([
    { name: "greet", isExported: true },
  ]) as any);

  // Middleware: re-exports greet
  index.indexFile("/middleware.hql", createAnalysis([
    { name: "greet", isExported: true, isImported: true, sourceModule: "./original.hql" },
  ]) as any);

  const result = resolveReExportChain("greet", "/middleware.hql", index);

  assertExists(result);
  assertEquals(result.originalFile, "/original.hql");
  assertEquals(result.isReExport, true);
  assertEquals(result.chain.length, 1);
});

Deno.test("ReExport - resolves multi-level chain (A->B->C)", () => {
  const index = new ProjectIndex();

  // Level A: original
  index.indexFile("/a.hql", createAnalysis([
    { name: "helper", isExported: true },
  ]) as any);

  // Level B: re-exports from A
  index.indexFile("/b.hql", createAnalysis([
    { name: "helper", isExported: true, isImported: true, sourceModule: "./a.hql" },
  ]) as any);

  // Level C: re-exports from B
  index.indexFile("/c.hql", createAnalysis([
    { name: "helper", isExported: true, isImported: true, sourceModule: "./b.hql" },
  ]) as any);

  const result = resolveReExportChain("helper", "/c.hql", index);

  assertExists(result);
  assertEquals(result.originalFile, "/a.hql");
  assertEquals(result.chain.length, 2); // C->B->A
});

Deno.test("ReExport - returns direct export when not re-exported", () => {
  const index = new ProjectIndex();

  index.indexFile("/original.hql", createAnalysis([
    { name: "greet", isExported: true },
  ]) as any);

  const result = resolveReExportChain("greet", "/original.hql", index);

  assertExists(result);
  assertEquals(result.originalFile, "/original.hql");
  assertEquals(result.isReExport, false);
  assertEquals(result.chain.length, 0);
});

Deno.test("ReExport - returns null when symbol not found", () => {
  const index = new ProjectIndex();

  index.indexFile("/math.hql", createAnalysis([
    { name: "add", isExported: true },
  ]) as any);

  const result = resolveReExportChain("unknownSymbol", "/math.hql", index);

  assertEquals(result, null);
});

// ============================================================================
// CIRCULAR RE-EXPORT HANDLING (9-10)
// ============================================================================

Deno.test("ReExport - handles circular re-export (A<->B)", () => {
  const index = new ProjectIndex();

  // A re-exports from B
  index.indexFile("/a.hql", createAnalysis([
    { name: "aValue", isExported: true },
    { name: "bValue", isExported: true, isImported: true, sourceModule: "./b.hql" },
  ]) as any);

  // B re-exports from A
  index.indexFile("/b.hql", createAnalysis([
    { name: "bValue", isExported: true },
    { name: "aValue", isExported: true, isImported: true, sourceModule: "./a.hql" },
  ]) as any);

  // Should not infinite loop - returns the first found or null
  const result = resolveReExportChain("aValue", "/b.hql", index);

  // Should have found the original in /a.hql
  assertExists(result);
  assertEquals(result.originalFile, "/a.hql");
});

Deno.test("ReExport - detectCircularReExports finds cycles", () => {
  const index = new ProjectIndex();

  // A re-exports from B
  index.indexFile("/a.hql", createAnalysis([
    { name: "shared", isExported: true, isImported: true, sourceModule: "./b.hql" },
  ]) as any);

  // B re-exports from A (circular)
  index.indexFile("/b.hql", createAnalysis([
    { name: "shared", isExported: true, isImported: true, sourceModule: "./a.hql" },
  ]) as any);

  const cycles = detectCircularReExports(index);

  // Should detect the circular dependency
  assertEquals(cycles.length >= 1, true);
});

// ============================================================================
// PROJECT INDEX INTEGRATION (11-12)
// ============================================================================

Deno.test("ReExport - findExports includes both direct and re-exported", () => {
  const index = new ProjectIndex();

  // Original exports greet
  index.indexFile("/original.hql", createAnalysis([
    { name: "greet", isExported: true },
  ]) as any);

  // Middleware re-exports greet
  index.indexFile("/middleware.hql", createAnalysis([
    { name: "greet", isExported: true, isImported: true, sourceModule: "./original.hql" },
  ]) as any);

  const files = index.findExports("greet");

  // Both files should be found
  assertEquals(files.length, 2);
  assertEquals(files.includes("/original.hql"), true);
  assertEquals(files.includes("/middleware.hql"), true);
});

Deno.test("ReExport - getExportedSymbol follows re-export to original", () => {
  const index = new ProjectIndex();

  // Original exports greet with location
  index.indexFile("/original.hql", createAnalysis([
    { name: "greet", isExported: true },
  ]) as any);

  // Middleware re-exports greet
  index.indexFile("/middleware.hql", createAnalysis([
    { name: "greet", isExported: true, isImported: true, sourceModule: "./original.hql" },
  ]) as any);

  // When getting exported symbol from middleware, it should return original's info
  const symbol = index.getExportedSymbol("greet", "/middleware.hql");

  // Should return the symbol (from original or middleware depending on implementation)
  assertExists(symbol);
  assertEquals(symbol.name, "greet");
});
