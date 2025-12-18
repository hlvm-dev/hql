/**
 * LSP Code Actions Feature
 *
 * Provides quick fixes and refactorings for HQL code.
 *
 * Current actions:
 * - Fix "Did you mean X?" suggestions
 * - Remove unused imports (future)
 * - Add missing imports (future)
 */

import {
  CodeActionKind,
} from "npm:vscode-languageserver@9.0.1";
import type {
  CodeAction,
  CodeActionParams,
  Diagnostic,
  WorkspaceEdit,
} from "npm:vscode-languageserver@9.0.1";
import type { TextDocument } from "npm:vscode-languageserver-textdocument@1.0.11";

/**
 * Get code actions for a document at a given range
 */
export function getCodeActions(
  doc: TextDocument,
  params: CodeActionParams
): CodeAction[] {
  const actions: CodeAction[] = [];

  // Process each diagnostic
  for (const diagnostic of params.context.diagnostics) {
    const fixActions = getFixesForDiagnostic(doc, diagnostic);
    actions.push(...fixActions);
  }

  return actions;
}

/**
 * Get quick fixes for a specific diagnostic
 */
function getFixesForDiagnostic(
  doc: TextDocument,
  diagnostic: Diagnostic
): CodeAction[] {
  const actions: CodeAction[] = [];
  const message = diagnostic.message;

  // Handle "Did you mean X?" suggestions
  const didYouMeanMatch = message.match(/Did you mean ['"]([\w\-?!]+)['"]\?/);
  if (didYouMeanMatch) {
    const suggestedName = didYouMeanMatch[1];
    const action = createReplaceAction(
      doc,
      diagnostic,
      suggestedName,
      `Replace with '${suggestedName}'`
    );
    if (action) {
      actions.push(action);
    }
  }

  // Handle multiple suggestions like "Did you mean 'foo' or 'bar'?"
  const multiSuggestMatch = message.match(
    /Did you mean ['"]([\w\-?!]+)['"] or ['"]([\w\-?!]+)['"]\?/
  );
  if (multiSuggestMatch) {
    for (let i = 1; i < multiSuggestMatch.length; i++) {
      const suggestedName = multiSuggestMatch[i];
      const action = createReplaceAction(
        doc,
        diagnostic,
        suggestedName,
        `Replace with '${suggestedName}'`
      );
      if (action) {
        actions.push(action);
      }
    }
  }

  // Handle unknown identifier errors
  if (message.includes("Unknown identifier") || message.includes("is not defined")) {
    // Extract the identifier from the error message
    const identMatch = message.match(/Unknown identifier:?\s*['"]([\w\-?!]+)['"]/i) ||
                       message.match(/['"]([\w\-?!]+)['"] is not defined/i);

    if (identMatch) {
      // For now, just offer to wrap in a comment
      // Future: offer to import from a module
    }
  }

  // Handle unused variable warnings
  if (message.includes("unused") || message.includes("Unused")) {
    const unusedMatch = message.match(/['"]([\w\-?!]+)['"] is unused/i) ||
                        message.match(/Unused (?:variable|binding):?\s*['"]([\w\-?!]+)['"]/i);

    if (unusedMatch) {
      const varName = unusedMatch[1];
      // Offer to prefix with underscore (common convention for unused vars)
      if (!varName.startsWith("_")) {
        const action = createReplaceAction(
          doc,
          diagnostic,
          `_${varName}`,
          `Prefix with underscore to suppress warning`
        );
        if (action) {
          action.kind = CodeActionKind.QuickFix;
          actions.push(action);
        }
      }
    }
  }

  return actions;
}

/**
 * Create a code action that replaces text at the diagnostic range
 */
function createReplaceAction(
  doc: TextDocument,
  diagnostic: Diagnostic,
  newText: string,
  title: string
): CodeAction | null {
  const edit: WorkspaceEdit = {
    changes: {
      [doc.uri]: [
        {
          range: diagnostic.range,
          newText,
        },
      ],
    },
  };

  return {
    title,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit,
    isPreferred: true, // Mark as preferred (will be offered in quick-fix menu)
  };
}

/**
 * Code action to add an import statement
 * (For future use)
 */
export function createAddImportAction(
  doc: TextDocument,
  symbolName: string,
  modulePath: string
): CodeAction {
  // Find the first line (or after existing imports)
  const text = doc.getText();
  const lines = text.split("\n");

  // Find where to insert (after last import, or at top)
  let insertLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("(import")) {
      insertLine = i + 1;
    }
  }

  const importStatement = `(import { ${symbolName} } from "${modulePath}")\n`;

  const edit: WorkspaceEdit = {
    changes: {
      [doc.uri]: [
        {
          range: {
            start: { line: insertLine, character: 0 },
            end: { line: insertLine, character: 0 },
          },
          newText: importStatement,
        },
      ],
    },
  };

  return {
    title: `Import '${symbolName}' from "${modulePath}"`,
    kind: CodeActionKind.QuickFix,
    edit,
  };
}

/**
 * Code action to extract selection into a variable
 * (For future use)
 */
export function createExtractVariableAction(
  doc: TextDocument,
  selection: { start: { line: number; character: number }; end: { line: number; character: number } },
  suggestedName: string = "extracted"
): CodeAction | null {
  const selectedText = doc.getText({
    start: selection.start,
    end: selection.end,
  });

  if (!selectedText.trim()) {
    return null;
  }

  // Create a let binding before the current line
  const currentLine = selection.start.line;
  const indent = getIndentation(doc, currentLine);

  const letBinding = `${indent}(let ${suggestedName} ${selectedText})\n`;

  const edit: WorkspaceEdit = {
    changes: {
      [doc.uri]: [
        // Insert the let binding
        {
          range: {
            start: { line: currentLine, character: 0 },
            end: { line: currentLine, character: 0 },
          },
          newText: letBinding,
        },
        // Replace the selection with the variable name
        {
          range: selection,
          newText: suggestedName,
        },
      ],
    },
  };

  return {
    title: `Extract to variable '${suggestedName}'`,
    kind: CodeActionKind.RefactorExtract,
    edit,
  };
}

/**
 * Get the indentation of a line
 */
function getIndentation(doc: TextDocument, line: number): string {
  const text = doc.getText();
  const lines = text.split("\n");

  if (line >= lines.length) {
    return "";
  }

  const lineText = lines[line];
  const match = lineText.match(/^(\s*)/);
  return match ? match[1] : "";
}

/**
 * Get available code action kinds
 */
export function getSupportedCodeActionKinds(): CodeActionKind[] {
  return [
    CodeActionKind.QuickFix,
    CodeActionKind.RefactorExtract,
  ];
}
