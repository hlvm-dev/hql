/**
 * LSP Cross-File Navigation Tests
 *
 * Tests for import resolution and cross-file go-to-definition.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ImportResolver } from "../../../lsp/workspace/import-resolver.ts";
import { ProjectIndex } from "../../../lsp/workspace/project-index.ts";
import { SymbolTable } from "../../../src/transpiler/symbol_table.ts";

// ============================================
// ImportResolver Tests
// ============================================

Deno.test("ImportResolver - resolves relative path ./", () => {
  const resolver = new ImportResolver();

  // Create temp files for testing
  const tempDir = Deno.makeTempDirSync();
  const mainFile = `${tempDir}/main.hql`;
  const utilsFile = `${tempDir}/utils.hql`;

  Deno.writeTextFileSync(mainFile, "(import [add] from \"./utils.hql\")");
  Deno.writeTextFileSync(utilsFile, "(export (fn add [a b] (+ a b)))");

  try {
    const resolved = resolver.resolve("./utils.hql", mainFile);
    assertEquals(resolved, utilsFile);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ImportResolver - resolves relative path ../", () => {
  const resolver = new ImportResolver();

  const tempDir = Deno.makeTempDirSync();
  const subDir = `${tempDir}/sub`;
  Deno.mkdirSync(subDir);

  const mainFile = `${subDir}/main.hql`;
  const utilsFile = `${tempDir}/utils.hql`;

  Deno.writeTextFileSync(mainFile, "(import [add] from \"../utils.hql\")");
  Deno.writeTextFileSync(utilsFile, "(export (fn add [a b] (+ a b)))");

  try {
    const resolved = resolver.resolve("../utils.hql", mainFile);
    assertEquals(resolved, utilsFile);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ImportResolver - adds .hql extension if missing", () => {
  const resolver = new ImportResolver();

  const tempDir = Deno.makeTempDirSync();
  const mainFile = `${tempDir}/main.hql`;
  const utilsFile = `${tempDir}/utils.hql`;

  Deno.writeTextFileSync(mainFile, "(import [add] from \"./utils\")");
  Deno.writeTextFileSync(utilsFile, "(fn add [a b] (+ a b))");

  try {
    const resolved = resolver.resolve("./utils", mainFile);
    assertEquals(resolved, utilsFile);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ImportResolver - returns null for non-existent file", () => {
  const resolver = new ImportResolver();

  const tempDir = Deno.makeTempDirSync();
  const mainFile = `${tempDir}/main.hql`;
  Deno.writeTextFileSync(mainFile, "");

  try {
    const resolved = resolver.resolve("./nonexistent.hql", mainFile);
    assertEquals(resolved, null);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ImportResolver - returns null for npm: imports", () => {
  const resolver = new ImportResolver();
  const resolved = resolver.resolve("npm:lodash", "/some/file.hql");
  assertEquals(resolved, null);
});

Deno.test("ImportResolver - returns null for jsr: imports", () => {
  const resolver = new ImportResolver();
  const resolved = resolver.resolve("jsr:@std/path", "/some/file.hql");
  assertEquals(resolved, null);
});

Deno.test("ImportResolver - returns null for http: imports", () => {
  const resolver = new ImportResolver();
  const resolved = resolver.resolve("http://example.com/lib.js", "/some/file.hql");
  assertEquals(resolved, null);
});

Deno.test("ImportResolver - returns null for https: imports", () => {
  const resolver = new ImportResolver();
  const resolved = resolver.resolve("https://example.com/lib.js", "/some/file.hql");
  assertEquals(resolved, null);
});

Deno.test("ImportResolver - isExternalModule detects external modules", () => {
  const resolver = new ImportResolver();

  assertEquals(resolver.isExternalModule("npm:lodash"), true);
  assertEquals(resolver.isExternalModule("jsr:@std/path"), true);
  assertEquals(resolver.isExternalModule("http://example.com/lib.js"), true);
  assertEquals(resolver.isExternalModule("https://example.com/lib.js"), true);
  assertEquals(resolver.isExternalModule("node:fs"), true);

  assertEquals(resolver.isExternalModule("./utils.hql"), false);
  assertEquals(resolver.isExternalModule("../lib/math.hql"), false);
  assertEquals(resolver.isExternalModule("/absolute/path.hql"), false);
});

Deno.test("ImportResolver - resolves from workspace roots", () => {
  const resolver = new ImportResolver();

  const tempDir = Deno.makeTempDirSync();
  const libFile = `${tempDir}/lib/utils.hql`;

  Deno.mkdirSync(`${tempDir}/lib`);
  Deno.writeTextFileSync(libFile, "(fn helper [] 42)");

  resolver.setRoots([tempDir]);

  try {
    const resolved = resolver.resolve("lib/utils", `${tempDir}/src/main.hql`);
    assertEquals(resolved, libFile);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ImportResolver - caches resolutions", () => {
  const resolver = new ImportResolver();

  const tempDir = Deno.makeTempDirSync();
  const mainFile = `${tempDir}/main.hql`;
  const utilsFile = `${tempDir}/utils.hql`;

  Deno.writeTextFileSync(mainFile, "");
  Deno.writeTextFileSync(utilsFile, "");

  try {
    // First resolution
    const resolved1 = resolver.resolve("./utils.hql", mainFile);
    assertEquals(resolved1, utilsFile);

    // Second resolution (should use cache)
    const resolved2 = resolver.resolve("./utils.hql", mainFile);
    assertEquals(resolved2, utilsFile);

    // Clear cache and verify still works
    resolver.clearCache();
    const resolved3 = resolver.resolve("./utils.hql", mainFile);
    assertEquals(resolved3, utilsFile);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

// ============================================
// Cross-File Go-to-Definition Tests
// ============================================

Deno.test("Cross-file - finds exported symbol in target file", () => {
  const index = new ProjectIndex();
  const resolver = new ImportResolver();

  // Create mock analysis for the exporting file
  const exportingSymbols = new SymbolTable();
  exportingSymbols.set({
    name: "add",
    kind: "function",
    scope: "global",
    isExported: true,
    location: { filePath: "/lib/math.hql", line: 1, column: 5 },
  });

  index.indexFile("/lib/math.hql", {
    ast: [],
    symbols: exportingSymbols,
    errors: [],
  });

  // Verify we can find the exported symbol
  const exported = index.getExportedSymbol("add", "/lib/math.hql");
  assertExists(exported);
  assertEquals(exported.name, "add");
  assertEquals(exported.location?.line, 1);
  assertEquals(exported.location?.column, 5);
});

Deno.test("Cross-file - tracks import source module", () => {
  const index = new ProjectIndex();

  // Create mock analysis with an import
  const importingSymbols = new SymbolTable();
  importingSymbols.set({
    name: "add",
    kind: "import",
    scope: "global",
    isImported: true,
    sourceModule: "./math.hql",
    location: { filePath: "/src/main.hql", line: 1, column: 10 },
  });

  index.indexFile("/src/main.hql", {
    ast: [],
    symbols: importingSymbols,
    errors: [],
  });

  // The imported symbol should not be in the file's symbols (it's from another file)
  const fileIndex = index.getFileIndex("/src/main.hql");
  assertExists(fileIndex);

  // Imports should be tracked
  assertEquals(fileIndex.imports.length, 1);
  assertEquals(fileIndex.imports[0].modulePath, "./math.hql");
});

Deno.test("Cross-file - complete navigation flow", () => {
  const index = new ProjectIndex();
  const resolver = new ImportResolver();

  // Setup temp files
  const tempDir = Deno.makeTempDirSync();
  const mathFile = `${tempDir}/math.hql`;
  const mainFile = `${tempDir}/main.hql`;

  Deno.writeTextFileSync(mathFile, "(export (fn add [a b] (+ a b)))");
  Deno.writeTextFileSync(mainFile, "(import [add] from \"./math.hql\")");

  resolver.setRoots([tempDir]);

  try {
    // Index the exporting file
    const exportingSymbols = new SymbolTable();
    exportingSymbols.set({
      name: "add",
      kind: "function",
      scope: "global",
      isExported: true,
      params: [{ name: "a" }, { name: "b" }],
      location: { filePath: mathFile, line: 1, column: 13 },
    });

    index.indexFile(mathFile, {
      ast: [],
      symbols: exportingSymbols,
      errors: [],
    });

    // Simulate: user clicks on "add" in main.hql
    // 1. We know "add" is imported from "./math.hql"
    const importPath = "./math.hql";

    // 2. Resolve the path
    const resolvedPath = resolver.resolve(importPath, mainFile);
    assertEquals(resolvedPath, mathFile);

    // 3. Look up in index
    const exportedSymbol = index.getExportedSymbol("add", resolvedPath!);
    assertExists(exportedSymbol);
    assertEquals(exportedSymbol.name, "add");
    assertEquals(exportedSymbol.kind, "function");
    assertEquals(exportedSymbol.location?.filePath, mathFile);
    assertEquals(exportedSymbol.location?.line, 1);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("Cross-file - handles renamed imports", () => {
  const index = new ProjectIndex();

  // Create mock analysis for file that exports "originalName"
  const exportingSymbols = new SymbolTable();
  exportingSymbols.set({
    name: "originalName",
    kind: "function",
    scope: "global",
    isExported: true,
    location: { filePath: "/lib/utils.hql", line: 5, column: 1 },
  });

  index.indexFile("/lib/utils.hql", {
    ast: [],
    symbols: exportingSymbols,
    errors: [],
  });

  // The exported symbol should be findable by original name
  const exported = index.getExportedSymbol("originalName", "/lib/utils.hql");
  assertExists(exported);
  assertEquals(exported.name, "originalName");
});

Deno.test("Cross-file - multiple files export same symbol name", () => {
  const index = new ProjectIndex();

  // Both files export "helper"
  const symbols1 = new SymbolTable();
  symbols1.set({
    name: "helper",
    kind: "function",
    scope: "global",
    isExported: true,
    location: { filePath: "/lib/utils1.hql", line: 1, column: 1 },
  });

  const symbols2 = new SymbolTable();
  symbols2.set({
    name: "helper",
    kind: "function",
    scope: "global",
    isExported: true,
    location: { filePath: "/lib/utils2.hql", line: 1, column: 1 },
  });

  index.indexFile("/lib/utils1.hql", { ast: [], symbols: symbols1, errors: [] });
  index.indexFile("/lib/utils2.hql", { ast: [], symbols: symbols2, errors: [] });

  // findExports should return both
  const files = index.findExports("helper");
  assertEquals(files.length, 2);

  // But getExportedSymbol with specific file should return the right one
  const from1 = index.getExportedSymbol("helper", "/lib/utils1.hql");
  const from2 = index.getExportedSymbol("helper", "/lib/utils2.hql");

  assertEquals(from1?.location?.filePath, "/lib/utils1.hql");
  assertEquals(from2?.location?.filePath, "/lib/utils2.hql");
});
