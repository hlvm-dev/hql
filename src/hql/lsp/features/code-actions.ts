/**
 * LSP Code Actions Feature
 *
 * Provides quick fixes and refactorings for HQL code.
 *
 * Current actions:
 * - Fix "Did you mean X?" suggestions
 * - Remove unused imports
 * - Add missing imports (via ProjectIndex)
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
import type { ProjectIndex } from "../workspace/project-index.ts";
import {
  getRemoveUnusedImportAction,
  createNewImport,
  calculateRelativePath,
  findImportByPath,
  addSymbolToImport,
  findInsertPosition,
} from "../imports/mod.ts";
import type { UnusedImport } from "../imports/types.ts";
import { uriToFilePath } from "../documents.ts";

/**
 * Get code actions for a document at a given range
 */
export function getCodeActions(
  doc: TextDocument,
  params: CodeActionParams,
  projectIndex?: ProjectIndex
): CodeAction[] {
  const actions: CodeAction[] = [];

  // Process each diagnostic
  for (const diagnostic of params.context.diagnostics) {
    const fixActions = getFixesForDiagnostic(doc, diagnostic, projectIndex);
    actions.push(...fixActions);
  }

  return actions;
}

/**
 * Get quick fixes for a specific diagnostic
 */
function getFixesForDiagnostic(
  doc: TextDocument,
  diagnostic: Diagnostic,
  projectIndex?: ProjectIndex
): CodeAction[] {
  const actions: CodeAction[] = [];
  const message = diagnostic.message;

  // Handle unused import diagnostics
  if (diagnostic.code === "unused-import") {
    const data = diagnostic.data as {
      symbolName: string;
      originalName?: string;
      isNamespace: boolean;
      importLine: number;
      modulePath: string;
    } | undefined;

    if (data) {
      const unused: UnusedImport = {
        symbolName: data.symbolName,
        originalName: data.originalName,
        isNamespace: data.isNamespace,
        range: diagnostic.range,
        importLine: data.importLine,
        modulePath: data.modulePath,
      };

      const action = getRemoveUnusedImportAction(doc, unused);
      if (action) {
        action.diagnostics = [diagnostic];
        actions.push(action);
      }
    }
    return actions;
  }

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

  // Handle unknown identifier errors - offer to import from a module
  if (message.includes("Unknown identifier") || message.includes("is not defined")) {
    const identMatch = message.match(/Unknown identifier:?\s*['"]([\w\-?!]+)['"]/i) ||
                       message.match(/['"]([\w\-?!]+)['"] is not defined/i);

    if (identMatch && projectIndex) {
      const symbolName = identMatch[1];
      const currentFilePath = uriToFilePath(doc.uri);
      const text = doc.getText();

      // Find files that export this symbol
      const exportingFiles = projectIndex.findExports(symbolName);

      for (const exportingFile of exportingFiles) {
        if (exportingFile === currentFilePath) continue; // Skip self

        const relativePath = calculateRelativePath(currentFilePath, exportingFile);

        // Check if we already have an import from this module
        const existingImport = findImportByPath(text, relativePath);

        if (existingImport) {
          // Add to existing import
          const edit = addSymbolToImport(doc, existingImport, symbolName);
          actions.push({
            title: `Add '${symbolName}' to existing import`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: {
              changes: {
                [doc.uri]: [edit],
              },
            },
          });
        } else {
          // Create new import
          const insertLine = findInsertPosition(text);
          const importStatement = createNewImport([symbolName], relativePath);

          actions.push({
            title: `Import '${symbolName}' from "${relativePath}"`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: {
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
            },
          });
        }
      }
    }
  }

  // Handle unused variable warnings (not imports)
  if (
    (message.includes("unused") || message.includes("Unused")) &&
    diagnostic.code !== "unused-import"
  ) {
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
 * Get available code action kinds
 */
export function getSupportedCodeActionKinds(): CodeActionKind[] {
  return [
    CodeActionKind.QuickFix,
    CodeActionKind.RefactorExtract,
  ];
}
