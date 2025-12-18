/**
 * LSP Workspace Symbols Tests
 *
 * Tests for ProjectIndex.searchSymbols and workspace-wide symbol search.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ProjectIndex } from "../../../lsp/workspace/project-index.ts";
import { SymbolTable } from "../../../src/transpiler/symbol_table.ts";

/**
 * Create a mock AnalysisResult for testing
 */
function createMockAnalysis(symbols: Array<{
  name: string;
  kind: string;
  isExported?: boolean;
  location?: { line: number; column: number };
}>) {
  const symbolTable = new SymbolTable();

  for (const sym of symbols) {
    symbolTable.set({
      name: sym.name,
      kind: sym.kind as "function" | "class" | "variable" | "macro" | "enum",
      scope: "global",
      isExported: sym.isExported,
      location: sym.location
        ? { ...sym.location, filePath: "test.hql" }
        : undefined,
    });
  }

  return {
    ast: [],
    symbols: symbolTable,
    errors: [],
  };
}

// ============================================
// ProjectIndex Tests
// ============================================

Deno.test("ProjectIndex - indexes file symbols", () => {
  const index = new ProjectIndex();
  const analysis = createMockAnalysis([
    { name: "add", kind: "function", location: { line: 1, column: 1 } },
    { name: "subtract", kind: "function", location: { line: 2, column: 1 } },
  ]);

  index.indexFile("/test/math.hql", analysis);

  const stats = index.getStats();
  assertEquals(stats.fileCount, 1);
  assertEquals(stats.symbolCount, 2);
});

Deno.test("ProjectIndex - searchSymbols finds exact match", () => {
  const index = new ProjectIndex();
  const analysis = createMockAnalysis([
    { name: "calculateTotal", kind: "function", location: { line: 1, column: 1 } },
    { name: "calculateTax", kind: "function", location: { line: 2, column: 1 } },
    { name: "formatPrice", kind: "function", location: { line: 3, column: 1 } },
  ]);

  index.indexFile("/test/utils.hql", analysis);

  const results = index.searchSymbols("calculateTotal");
  assertEquals(results.length, 1);
  assertEquals(results[0].info.name, "calculateTotal");
});

Deno.test("ProjectIndex - searchSymbols finds partial match", () => {
  const index = new ProjectIndex();
  const analysis = createMockAnalysis([
    { name: "calculateTotal", kind: "function", location: { line: 1, column: 1 } },
    { name: "calculateTax", kind: "function", location: { line: 2, column: 1 } },
    { name: "formatPrice", kind: "function", location: { line: 3, column: 1 } },
  ]);

  index.indexFile("/test/utils.hql", analysis);

  const results = index.searchSymbols("calculate");
  assertEquals(results.length, 2);
  assertEquals(results.map(r => r.info.name).sort(), ["calculateTax", "calculateTotal"]);
});

Deno.test("ProjectIndex - searchSymbols is case-insensitive", () => {
  const index = new ProjectIndex();
  const analysis = createMockAnalysis([
    { name: "MyClass", kind: "class", location: { line: 1, column: 1 } },
    { name: "myFunction", kind: "function", location: { line: 2, column: 1 } },
  ]);

  index.indexFile("/test/file.hql", analysis);

  const results = index.searchSymbols("my");
  assertEquals(results.length, 2);
});

Deno.test("ProjectIndex - searchSymbols across multiple files", () => {
  const index = new ProjectIndex();

  const analysis1 = createMockAnalysis([
    { name: "userCreate", kind: "function", location: { line: 1, column: 1 } },
    { name: "userDelete", kind: "function", location: { line: 2, column: 1 } },
  ]);

  const analysis2 = createMockAnalysis([
    { name: "userUpdate", kind: "function", location: { line: 1, column: 1 } },
    { name: "userGet", kind: "function", location: { line: 2, column: 1 } },
  ]);

  index.indexFile("/test/user-write.hql", analysis1);
  index.indexFile("/test/user-read.hql", analysis2);

  const results = index.searchSymbols("user");
  assertEquals(results.length, 4);
});

Deno.test("ProjectIndex - searchSymbols respects maxResults", () => {
  const index = new ProjectIndex();
  const symbols = Array.from({ length: 50 }, (_, i) => ({
    name: `func${i}`,
    kind: "function",
    location: { line: i + 1, column: 1 },
  }));

  const analysis = createMockAnalysis(symbols);
  index.indexFile("/test/many.hql", analysis);

  const results = index.searchSymbols("func", 10);
  assertEquals(results.length, 10);
});

Deno.test("ProjectIndex - tracks exports correctly", () => {
  const index = new ProjectIndex();
  const analysis = createMockAnalysis([
    { name: "publicFn", kind: "function", isExported: true, location: { line: 1, column: 1 } },
    { name: "privateFn", kind: "function", isExported: false, location: { line: 2, column: 1 } },
  ]);

  index.indexFile("/test/lib.hql", analysis);

  const exported = index.getExportedSymbol("publicFn", "/test/lib.hql");
  assertExists(exported);
  assertEquals(exported.name, "publicFn");

  const notExported = index.getExportedSymbol("privateFn", "/test/lib.hql");
  assertEquals(notExported, null);
});

Deno.test("ProjectIndex - findExports returns files exporting symbol", () => {
  const index = new ProjectIndex();

  const analysis1 = createMockAnalysis([
    { name: "helper", kind: "function", isExported: true, location: { line: 1, column: 1 } },
  ]);

  const analysis2 = createMockAnalysis([
    { name: "helper", kind: "function", isExported: true, location: { line: 1, column: 1 } },
  ]);

  index.indexFile("/test/utils1.hql", analysis1);
  index.indexFile("/test/utils2.hql", analysis2);

  const files = index.findExports("helper");
  assertEquals(files.length, 2);
  assertEquals(files.sort(), ["/test/utils1.hql", "/test/utils2.hql"]);
});

Deno.test("ProjectIndex - removeFile cleans up index", () => {
  const index = new ProjectIndex();
  const analysis = createMockAnalysis([
    { name: "toRemove", kind: "function", isExported: true, location: { line: 1, column: 1 } },
  ]);

  index.indexFile("/test/temp.hql", analysis);
  assertEquals(index.getStats().fileCount, 1);

  index.removeFile("/test/temp.hql");
  assertEquals(index.getStats().fileCount, 0);
  assertEquals(index.findExports("toRemove").length, 0);
});

Deno.test("ProjectIndex - re-indexing updates symbols", () => {
  const index = new ProjectIndex();

  // Initial index
  const analysis1 = createMockAnalysis([
    { name: "oldFunc", kind: "function", location: { line: 1, column: 1 } },
  ]);
  index.indexFile("/test/file.hql", analysis1);

  let results = index.searchSymbols("oldFunc");
  assertEquals(results.length, 1);

  // Re-index with new content
  const analysis2 = createMockAnalysis([
    { name: "newFunc", kind: "function", location: { line: 1, column: 1 } },
  ]);
  index.indexFile("/test/file.hql", analysis2);

  results = index.searchSymbols("oldFunc");
  assertEquals(results.length, 0);

  results = index.searchSymbols("newFunc");
  assertEquals(results.length, 1);
});

Deno.test("ProjectIndex - getAllSymbols returns all indexed symbols", () => {
  const index = new ProjectIndex();

  const analysis1 = createMockAnalysis([
    { name: "a", kind: "function", location: { line: 1, column: 1 } },
  ]);
  const analysis2 = createMockAnalysis([
    { name: "b", kind: "function", location: { line: 1, column: 1 } },
  ]);

  index.indexFile("/test/a.hql", analysis1);
  index.indexFile("/test/b.hql", analysis2);

  const all = index.getAllSymbols();
  assertEquals(all.length, 2);
});

Deno.test("ProjectIndex - clear removes everything", () => {
  const index = new ProjectIndex();
  const analysis = createMockAnalysis([
    { name: "func", kind: "function", location: { line: 1, column: 1 } },
  ]);

  index.indexFile("/test/file.hql", analysis);
  assertEquals(index.getStats().fileCount, 1);

  index.clear();
  assertEquals(index.getStats().fileCount, 0);
  assertEquals(index.getStats().symbolCount, 0);
});
