/**
 * Tests for Auto-Import (Add Missing Imports) Feature
 *
 * These tests verify:
 * 1. Detection of undefined symbols and suggestion of imports
 * 2. Correct import statement generation
 * 3. Edge cases like multiple sources, existing imports, etc.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TextDocument } from "npm:vscode-languageserver-textdocument@1.0.11";
import { CodeActionKind } from "npm:vscode-languageserver@9.0.1";
import type { Diagnostic, CodeActionParams } from "npm:vscode-languageserver@9.0.1";
import { getCodeActions } from "../../../lsp/features/code-actions.ts";
import { ProjectIndex } from "../../../lsp/workspace/project-index.ts";
import {
  createNewImport,
  calculateRelativePath,
  findInsertPosition,
  addSymbolToImport,
  findImportByPath,
} from "../../../lsp/imports/mod.ts";

// Helper to create a TextDocument
function createDoc(content: string, uri = "file:///test.hql"): TextDocument {
  return TextDocument.create(uri, "hql", 1, content);
}

// Helper to create a diagnostic for unknown identifier
function createUnknownIdentifierDiagnostic(
  symbolName: string,
  line: number,
  startChar: number,
  endChar: number
): Diagnostic {
  return {
    severity: 1,
    range: {
      start: { line, character: startChar },
      end: { line, character: endChar },
    },
    message: `Unknown identifier '${symbolName}'`,
    source: "hql",
  };
}

// Helper to create CodeActionParams
function createParams(diagnostics: Diagnostic[]): CodeActionParams {
  return {
    textDocument: { uri: "file:///test.hql" },
    range: diagnostics[0]?.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    context: { diagnostics },
  };
}

// Helper to create and index a mock file
function indexMockFile(
  index: ProjectIndex,
  filePath: string,
  exports: string[]
): void {
  const analysis = {
    symbols: {
      getAllSymbols: () =>
        exports.map((name) => ({
          name,
          kind: "function",
          scope: "global",
          isExported: true,
          location: { filePath, line: 1, column: 1 },
        })),
      get: (name: string) =>
        exports.includes(name)
          ? {
              name,
              kind: "function",
              scope: "global",
              isExported: true,
              location: { filePath, line: 1, column: 1 },
            }
          : undefined,
    },
    errors: [],
  };
  index.indexFile(filePath, analysis as any);
}

// ============================================================================
// UTILITY TESTS (1-5)
// ============================================================================

Deno.test("AutoImport - createNewImport generates correct syntax", () => {
  const result = createNewImport(["add"], "./math.hql");
  assertEquals(result, '(import [add] from "./math.hql")\n');
});

Deno.test("AutoImport - createNewImport handles multiple symbols", () => {
  const result = createNewImport(["add", "subtract", "multiply"], "./math.hql");
  assertEquals(result, '(import [add subtract multiply] from "./math.hql")\n');
});

Deno.test("AutoImport - calculateRelativePath same directory", () => {
  const result = calculateRelativePath("/project/src/main.hql", "/project/src/math.hql");
  assertEquals(result, "./math.hql");
});

Deno.test("AutoImport - calculateRelativePath parent directory", () => {
  const result = calculateRelativePath("/project/src/sub/main.hql", "/project/src/math.hql");
  assertEquals(result, "../math.hql");
});

Deno.test("AutoImport - findInsertPosition after imports", () => {
  const code = `(import [foo] from "./foo.hql")
(import [bar] from "./bar.hql")
(fn main [] (print "hello"))`;
  const position = findInsertPosition(code);
  assertEquals(position, 2); // After both imports
});

// ============================================================================
// BASIC AUTO-IMPORT TESTS (6-10)
// ============================================================================

Deno.test("AutoImport - suggests import for undefined symbol", () => {
  const doc = createDoc("(add 5 10)");
  const index = new ProjectIndex();
  indexMockFile(index, "/project/math.hql", ["add", "subtract"]);

  const diagnostic = createUnknownIdentifierDiagnostic("add", 0, 1, 4);
  const params = createParams([diagnostic]);

  const actions = getCodeActions(doc, params, index);

  assertEquals(actions.length >= 1, true);
  const importAction = actions.find((a) => a.title.includes("Import"));
  assertExists(importAction);
  assertEquals(importAction.kind, CodeActionKind.QuickFix);
});

Deno.test("AutoImport - offers multiple sources when ambiguous", () => {
  const doc = createDoc("(helper 5)", "file:///project/main.hql");
  const index = new ProjectIndex();
  indexMockFile(index, "/project/module-a.hql", ["helper"]);
  indexMockFile(index, "/project/module-b.hql", ["helper"]);

  const diagnostic = createUnknownIdentifierDiagnostic("helper", 0, 1, 7);
  const params = createParams([diagnostic]);
  params.textDocument.uri = "file:///project/main.hql";

  const actions = getCodeActions(doc, params, index);

  // Should offer imports from both sources
  const importActions = actions.filter((a) => a.title.includes("Import"));
  assertEquals(importActions.length, 2);
});

Deno.test("AutoImport - inserts at file beginning when no imports", () => {
  const code = "(fn main [] (add 1 2))";
  const insertLine = findInsertPosition(code);
  assertEquals(insertLine, 0);
});

Deno.test("AutoImport - inserts after existing imports", () => {
  const code = `(import [foo] from "./foo.hql")
(add 1 2)`;
  const insertLine = findInsertPosition(code);
  assertEquals(insertLine, 1);
});

Deno.test("AutoImport - addSymbolToImport merges into existing", () => {
  const code = '(import [add] from "./math.hql")\n(subtract 10 5)';
  const doc = createDoc(code);
  const existingImport = findImportByPath(code, "./math.hql");

  assertExists(existingImport);
  const edit = addSymbolToImport(doc, existingImport, "subtract");

  // Should add subtract to the existing import
  assertEquals(edit.newText.includes("add"), true);
  assertEquals(edit.newText.includes("subtract"), true);
});

// ============================================================================
// COMPLEX SCENARIOS (11-15)
// ============================================================================

Deno.test("AutoImport - no actions when no projectIndex", () => {
  const doc = createDoc("(add 5 10)");
  const diagnostic = createUnknownIdentifierDiagnostic("add", 0, 1, 4);
  const params = createParams([diagnostic]);

  // No projectIndex provided
  const actions = getCodeActions(doc, params);

  // Should not have import suggestions (might have other actions)
  const importActions = actions.filter((a) => a.title.includes("Import"));
  assertEquals(importActions.length, 0);
});

Deno.test("AutoImport - no suggestion when symbol not exported anywhere", () => {
  const doc = createDoc("(unknownFunction 5 10)");
  const index = new ProjectIndex();
  indexMockFile(index, "/project/math.hql", ["add", "subtract"]);

  const diagnostic = createUnknownIdentifierDiagnostic("unknownFunction", 0, 1, 16);
  const params = createParams([diagnostic]);

  const actions = getCodeActions(doc, params, index);

  const importActions = actions.filter((a) => a.title.includes("Import"));
  assertEquals(importActions.length, 0);
});

Deno.test("AutoImport - skips self when file exports same symbol", () => {
  // The file itself exports 'add', so shouldn't suggest importing from itself
  const doc = createDoc("(fn add [a b] (+ a b))\n(export [add])\n(add 1 2)", "file:///project/math.hql");
  const index = new ProjectIndex();
  indexMockFile(index, "/project/math.hql", ["add"]);

  const diagnostic = createUnknownIdentifierDiagnostic("add", 2, 1, 4);
  const params = createParams([diagnostic]);
  params.textDocument.uri = "file:///project/math.hql";

  const actions = getCodeActions(doc, params, index);

  const importActions = actions.filter((a) => a.title.includes("Import"));
  // Should not suggest importing from itself
  assertEquals(importActions.length, 0);
});

Deno.test("AutoImport - handles Did you mean suggestions alongside import", () => {
  const doc = createDoc("(addd 5 10)");
  const index = new ProjectIndex();
  // Index both the typo and correct version to test combined actions
  indexMockFile(index, "/project/math.hql", ["addd", "add"]);

  // Diagnostic with suggestion (typo 'addd' exists in index)
  const diagnostic: Diagnostic = {
    severity: 1,
    range: { start: { line: 0, character: 1 }, end: { line: 0, character: 5 } },
    message: "Unknown identifier 'addd'. Did you mean 'add'?",
    source: "hql",
  };
  const params = createParams([diagnostic]);

  const actions = getCodeActions(doc, params, index);

  // Should have "Replace with" action from "Did you mean"
  const replaceAction = actions.find((a) => a.title.includes("Replace"));
  assertExists(replaceAction);

  // Should also have "Import" action for the symbol 'addd'
  const importAction = actions.find((a) => a.title.includes("Import") && a.title.includes("addd"));
  assertExists(importAction);
});

Deno.test("AutoImport - generates correct relative path", () => {
  // Test path calculation in isolation
  const fromFile = "/project/src/deep/nested/file.hql";
  const toFile = "/project/lib/utils.hql";

  const relativePath = calculateRelativePath(fromFile, toFile);

  assertEquals(relativePath, "../../../lib/utils.hql");
});
