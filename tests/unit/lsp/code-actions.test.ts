/**
 * Tests for LSP Code Actions feature
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TextDocument } from "npm:vscode-languageserver-textdocument@1.0.11";
import { type Diagnostic, DiagnosticSeverity, CodeActionKind } from "npm:vscode-languageserver@9.0.1";
import { getCodeActions, getSupportedCodeActionKinds } from "../../../src/hql/lsp/features/code-actions.ts";

function createDoc(content: string): TextDocument {
  return TextDocument.create("file:///test.hql", "hql", 1, content);
}

function createDiagnostic(
  message: string,
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number
): Diagnostic {
  return {
    range: {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    },
    message,
    severity: DiagnosticSeverity.Error,
  };
}

Deno.test("CodeActions - returns empty for no diagnostics", () => {
  const doc = createDoc("(fn add [a b] (+ a b))");
  const actions = getCodeActions(doc, {
    textDocument: { uri: doc.uri },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    context: { diagnostics: [] },
  });

  assertEquals(actions.length, 0);
});

Deno.test("CodeActions - provides fix for 'Did you mean X?' suggestion", () => {
  const doc = createDoc("(prnt 1 2 3)");
  const diagnostic = createDiagnostic(
    "Unknown identifier 'prnt'. Did you mean 'print'?",
    0, 1, 0, 5
  );

  const actions = getCodeActions(doc, {
    textDocument: { uri: doc.uri },
    range: diagnostic.range,
    context: { diagnostics: [diagnostic] },
  });

  assertEquals(actions.length, 1);
  assertEquals(actions[0].title, "Replace with 'print'");
  assertEquals(actions[0].kind, CodeActionKind.QuickFix);
  assertExists(actions[0].edit);
  assertExists(actions[0].edit!.changes);

  const edits = actions[0].edit!.changes![doc.uri];
  assertEquals(edits.length, 1);
  assertEquals(edits[0].newText, "print");
});

Deno.test("CodeActions - provides multiple fixes for multiple suggestions", () => {
  const doc = createDoc("(mapp fn coll)");
  const diagnostic = createDiagnostic(
    "Unknown identifier 'mapp'. Did you mean 'map' or 'mapv'?",
    0, 1, 0, 5
  );

  const actions = getCodeActions(doc, {
    textDocument: { uri: doc.uri },
    range: diagnostic.range,
    context: { diagnostics: [diagnostic] },
  });

  // Should have 2 actions: one for 'map' and one for 'mapv'
  assertEquals(actions.length, 2);
  assertEquals(actions[0].title, "Replace with 'map'");
  assertEquals(actions[1].title, "Replace with 'mapv'");
});

Deno.test("CodeActions - handles unused variable with underscore prefix", () => {
  const doc = createDoc("(let unused 1)");
  const diagnostic = createDiagnostic(
    "'unused' is unused",
    0, 5, 0, 11
  );

  const actions = getCodeActions(doc, {
    textDocument: { uri: doc.uri },
    range: diagnostic.range,
    context: { diagnostics: [diagnostic] },
  });

  assertEquals(actions.length, 1);
  assertEquals(actions[0].title, "Prefix with underscore to suppress warning");

  const edits = actions[0].edit!.changes![doc.uri];
  assertEquals(edits[0].newText, "_unused");
});

Deno.test("CodeActions - does not offer underscore prefix for already prefixed", () => {
  const doc = createDoc("(let _unused 1)");
  const diagnostic = createDiagnostic(
    "'_unused' is unused",
    0, 5, 0, 12
  );

  const actions = getCodeActions(doc, {
    textDocument: { uri: doc.uri },
    range: diagnostic.range,
    context: { diagnostics: [diagnostic] },
  });

  // Should not offer underscore prefix since it's already prefixed
  assertEquals(actions.length, 0);
});

Deno.test("CodeActions - handles hyphenated identifier suggestions", () => {
  const doc = createDoc("(my-funct 1 2)");
  const diagnostic = createDiagnostic(
    "Unknown identifier 'my-funct'. Did you mean 'my-function'?",
    0, 1, 0, 9
  );

  const actions = getCodeActions(doc, {
    textDocument: { uri: doc.uri },
    range: diagnostic.range,
    context: { diagnostics: [diagnostic] },
  });

  assertEquals(actions.length, 1);
  assertEquals(actions[0].title, "Replace with 'my-function'");
});

Deno.test("CodeActions - handles identifier with special chars", () => {
  const doc = createDoc("(valid 1)");
  const diagnostic = createDiagnostic(
    "Unknown identifier 'valid'. Did you mean 'valid?'?",
    0, 1, 0, 6
  );

  const actions = getCodeActions(doc, {
    textDocument: { uri: doc.uri },
    range: diagnostic.range,
    context: { diagnostics: [diagnostic] },
  });

  assertEquals(actions.length, 1);
  assertEquals(actions[0].title, "Replace with 'valid?'");
});

Deno.test("CodeActions - edit targets correct range", () => {
  const doc = createDoc("(let x 1)\n(prnt x)");
  const diagnostic = createDiagnostic(
    "Did you mean 'print'?",
    1, 1, 1, 5 // "prnt" on second line
  );

  const actions = getCodeActions(doc, {
    textDocument: { uri: doc.uri },
    range: diagnostic.range,
    context: { diagnostics: [diagnostic] },
  });

  assertEquals(actions.length, 1);
  const edits = actions[0].edit!.changes![doc.uri];
  assertEquals(edits[0].range.start.line, 1);
  assertEquals(edits[0].range.start.character, 1);
  assertEquals(edits[0].range.end.line, 1);
  assertEquals(edits[0].range.end.character, 5);
});

Deno.test("getSupportedCodeActionKinds - returns expected kinds", () => {
  const kinds = getSupportedCodeActionKinds();

  // Should include QuickFix
  assertEquals(kinds.includes(CodeActionKind.QuickFix), true);

  // Should include RefactorExtract (for future extract variable/function)
  assertEquals(kinds.includes(CodeActionKind.RefactorExtract), true);
});

Deno.test("CodeActions - handles multiple diagnostics", () => {
  const doc = createDoc("(prnt (mapp fn coll))");
  const diag1 = createDiagnostic("Did you mean 'print'?", 0, 1, 0, 5);
  const diag2 = createDiagnostic("Did you mean 'map'?", 0, 7, 0, 11);

  const actions = getCodeActions(doc, {
    textDocument: { uri: doc.uri },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 21 } },
    context: { diagnostics: [diag1, diag2] },
  });

  // Should have 2 actions: one for each diagnostic
  assertEquals(actions.length, 2);
});
