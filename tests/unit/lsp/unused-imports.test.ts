/**
 * Tests for Unused Imports Detection and Removal
 *
 * These tests verify:
 * 1. Detection of unused imports in HQL documents
 * 2. Code actions to remove unused imports
 * 3. Edge cases like re-exports, strings, comments
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TextDocument } from "npm:vscode-languageserver-textdocument@1.0.11";
import { DiagnosticSeverity, CodeActionKind } from "npm:vscode-languageserver@9.0.1";
import {
  findUnusedImports,
  analyzeUnusedImports,
} from "../../../lsp/imports/symbol-usage.ts";
import {
  getRemoveUnusedImportAction,
  getRemoveAllUnusedAction,
} from "../../../lsp/imports/import-editor.ts";
import { findAllImports } from "../../../lsp/imports/import-parser.ts";
import type { UnusedImport } from "../../../lsp/imports/types.ts";

// Helper to create a TextDocument
function createDoc(content: string, uri = "file:///test.hql"): TextDocument {
  return TextDocument.create(uri, "hql", 1, content);
}

// Helper to create a range
function makeRange(
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number
) {
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}

// ============================================================================
// DETECTION TESTS (1-5)
// ============================================================================

Deno.test("UnusedImports - detects single unused import", () => {
  const code = `(import [add subtract] from "./math.hql")
(add 5 10)`;

  const result = analyzeUnusedImports(code, "test.hql");

  assertEquals(result.length, 1);
  assertEquals(result[0].symbolName, "subtract");
  assertEquals(result[0].isNamespace, false);
});

Deno.test("UnusedImports - detects all imports unused", () => {
  const code = `(import [foo bar baz] from "./utils.hql")
(print "hello")`;

  const result = analyzeUnusedImports(code, "test.hql");

  assertEquals(result.length, 3);
  const names = result.map((r) => r.symbolName).sort();
  assertEquals(names, ["bar", "baz", "foo"]);
});

Deno.test("UnusedImports - detects unused in multi-import statement", () => {
  const code = `(import [add] from "./math.hql")
(import [helper format] from "./utils.hql")
(add 1 2)
(helper "test")`;

  const result = analyzeUnusedImports(code, "test.hql");

  // Only `format` is unused
  assertEquals(result.length, 1);
  assertEquals(result[0].symbolName, "format");
});

Deno.test("UnusedImports - detects unused namespace import", () => {
  const code = `(import math from "./math.hql")
(print "no math used")`;

  const result = analyzeUnusedImports(code, "test.hql");

  assertEquals(result.length, 1);
  assertEquals(result[0].symbolName, "math");
  assertEquals(result[0].isNamespace, true);
});

Deno.test("UnusedImports - marks namespace used when property accessed", () => {
  const code = `(import math from "./math.hql")
(math.add 1 2)`;

  const result = analyzeUnusedImports(code, "test.hql");

  // namespace is used via property access
  assertEquals(result.length, 0);
});

// ============================================================================
// CODE ACTION TESTS (6-10)
// ============================================================================

Deno.test("UnusedImports - removes single unused symbol from import", () => {
  const code = `(import [add subtract multiply] from "./math.hql")
(add 1 2)
(multiply 3 4)`;
  const doc = createDoc(code);

  const unused: UnusedImport = {
    symbolName: "subtract",
    isNamespace: false,
    range: makeRange(0, 13, 0, 21),
    importLine: 0,
    modulePath: "./math.hql",
  };

  const action = getRemoveUnusedImportAction(doc, unused);

  assertExists(action);
  assertEquals(action.title, "Remove unused import 'subtract'");
  assertEquals(action.kind, CodeActionKind.QuickFix);

  const edit = action.edit!.changes![doc.uri][0];
  // Should result in [add multiply]
  assertEquals(edit.newText.includes("subtract"), false);
  assertEquals(edit.newText.includes("add"), true);
  assertEquals(edit.newText.includes("multiply"), true);
});

Deno.test("UnusedImports - removes entire import when all unused", () => {
  const code = `(import [foo bar] from "./utils.hql")
(print 1)`;
  const doc = createDoc(code);

  const allUnused: UnusedImport[] = [
    {
      symbolName: "foo",
      isNamespace: false,
      range: makeRange(0, 9, 0, 12),
      importLine: 0,
      modulePath: "./utils.hql",
    },
    {
      symbolName: "bar",
      isNamespace: false,
      range: makeRange(0, 13, 0, 16),
      importLine: 0,
      modulePath: "./utils.hql",
    },
  ];

  const action = getRemoveAllUnusedAction(doc, allUnused);

  assertExists(action);
  assertEquals(action.title.includes("Remove"), true);

  const edit = action.edit!.changes![doc.uri][0];
  // Entire import line should be removed
  assertEquals(edit.newText, "");
});

Deno.test("UnusedImports - removes unused namespace import", () => {
  const code = `(import utils from "./utils.hql")
(print 1)`;
  const doc = createDoc(code);

  const unused: UnusedImport = {
    symbolName: "utils",
    isNamespace: true,
    range: makeRange(0, 8, 0, 13),
    importLine: 0,
    modulePath: "./utils.hql",
  };

  const action = getRemoveUnusedImportAction(doc, unused);

  assertExists(action);
  assertEquals(action.title, "Remove unused import 'utils'");
});

Deno.test("UnusedImports - offers remove-all-unused action", () => {
  const code = `(import [unused1] from "./a.hql")
(import [used unused2] from "./b.hql")
(used 1)`;
  const doc = createDoc(code);

  const allUnused: UnusedImport[] = [
    {
      symbolName: "unused1",
      isNamespace: false,
      range: makeRange(0, 9, 0, 16),
      importLine: 0,
      modulePath: "./a.hql",
    },
    {
      symbolName: "unused2",
      isNamespace: false,
      range: makeRange(1, 14, 1, 21),
      importLine: 1,
      modulePath: "./b.hql",
    },
  ];

  const action = getRemoveAllUnusedAction(doc, allUnused);

  assertExists(action);
  assertEquals(action.title, "Remove all unused imports");

  // Should produce edits for both import statements
  const edits = action.edit!.changes![doc.uri];
  assertEquals(edits.length >= 1, true);
});

Deno.test("UnusedImports - preserves formatting after removal", () => {
  const code = `(import [add unused] from "./math.hql")

(fn calculate []
  (add 1 2))`;
  const doc = createDoc(code);

  const unused: UnusedImport = {
    symbolName: "unused",
    isNamespace: false,
    range: makeRange(0, 13, 0, 19),
    importLine: 0,
    modulePath: "./math.hql",
  };

  const action = getRemoveUnusedImportAction(doc, unused);
  assertExists(action);

  const edit = action.edit!.changes![doc.uri][0];
  // Should not have double newlines in the edit
  assertEquals(edit.newText.includes("\n\n\n"), false);
});

// ============================================================================
// EDGE CASES (11-15)
// ============================================================================

Deno.test("UnusedImports - does not flag re-exported imports", () => {
  const code = `(import [greet farewell] from "./original.hql")
(export [greet farewell])`;

  const result = analyzeUnusedImports(code, "middleware.hql");

  // Both are re-exported, so neither is unused
  assertEquals(result.length, 0);
});

Deno.test("UnusedImports - symbol in string still counts as unused", () => {
  const code = `(import [add] from "./math.hql")
(print "use the add function here")`;

  const result = analyzeUnusedImports(code, "test.hql");

  // String occurrence doesn't count as usage
  assertEquals(result.length, 1);
  assertEquals(result[0].symbolName, "add");
});

Deno.test("UnusedImports - symbol in comment still counts as unused", () => {
  const code = `(import [helper] from "./utils.hql")
; TODO: use helper here
(print "done")`;

  const result = analyzeUnusedImports(code, "test.hql");

  // Comment occurrence doesn't count as usage
  assertEquals(result.length, 1);
  assertEquals(result[0].symbolName, "helper");
});

Deno.test("UnusedImports - handles aliased imports", () => {
  const code = `(import [add as sum] from "./math.hql")
(sum 1 2)`;

  const result = analyzeUnusedImports(code, "test.hql");

  // `sum` is used, so no unused imports
  assertEquals(result.length, 0);
});

Deno.test("UnusedImports - handles aliased import unused", () => {
  const code = `(import [add as sum] from "./math.hql")
(print "no sum used")`;

  const result = analyzeUnusedImports(code, "test.hql");

  assertEquals(result.length, 1);
  // Should report the local name (alias)
  assertEquals(result[0].symbolName, "sum");
  assertEquals(result[0].originalName, "add");
});

// ============================================================================
// MULTILINE IMPORT TESTS (16-18)
// ============================================================================

Deno.test("UnusedImports - handles multiline import", () => {
  const code = `(import [
  add
  subtract
  multiply
] from "./math.hql")
(add 1 2)`;

  const result = analyzeUnusedImports(code, "test.hql");

  // subtract and multiply are unused
  assertEquals(result.length, 2);
  const names = result.map((r) => r.symbolName).sort();
  assertEquals(names, ["multiply", "subtract"]);
});

Deno.test("UnusedImports - multiline import has correct ranges", () => {
  const code = `(import [
  add
  subtract
] from "./utils.hql")
(print 1)`;

  const imports = findAllImports(code);

  assertEquals(imports.length, 1);
  // Import starts at line 0
  assertEquals(imports[0].range.start.line, 0);
  // Import ends at line 3 (0-indexed) - the line with closing bracket
  assertEquals(imports[0].range.end.line >= 3, true);
  // Should have 2 symbols
  assertEquals(imports[0].symbols.length, 2);
  // Symbols should be on different lines
  assertEquals(imports[0].symbols[0].range.start.line, 1); // add on line 1
  assertEquals(imports[0].symbols[1].range.start.line, 2); // subtract on line 2
});

Deno.test("UnusedImports - multiline with alias", () => {
  const code = `(import [
  add as sum
  subtract
] from "./math.hql")
(sum 1 2)`;

  const result = analyzeUnusedImports(code, "test.hql");

  // Only subtract is unused (sum is used)
  assertEquals(result.length, 1);
  assertEquals(result[0].symbolName, "subtract");
});
