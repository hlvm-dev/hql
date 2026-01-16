/**
 * LSP Rename Symbol Feature
 *
 * Provides project-wide rename functionality for HQL symbols.
 * Uses the same reference-finding logic as Find References.
 */

import type {
  WorkspaceEdit,
  TextEdit,
  Range,
} from "npm:vscode-languageserver@9.0.1";
import type { TextDocument } from "npm:vscode-languageserver-textdocument@1.0.11";
import { findReferencesInWorkspace, findReferencesInContent } from "./references.ts";
import { uriToFilePath } from "../documents.ts";

/**
 * Check if a symbol can be renamed (prepareRename)
 *
 * Returns the range of the symbol if it can be renamed,
 * or null if rename is not possible at this position.
 */
export function prepareRename(
  doc: TextDocument,
  position: { line: number; character: number }
): { range: Range; placeholder: string } | null {
  const text = doc.getText();
  const lines = text.split("\n");

  if (position.line >= lines.length) {
    return null;
  }

  const line = lines[position.line];
  const char = position.character;

  // Find the word at the cursor position
  // HQL identifiers can contain: letters, digits, -, _, ?, !
  const identifierPattern = /[a-zA-Z_][a-zA-Z0-9_\-?!]*/g;

  let match;
  while ((match = identifierPattern.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (char >= start && char <= end) {
      const symbolName = match[0];

      // Don't allow renaming special forms/keywords
      if (isSpecialForm(symbolName)) {
        return null;
      }

      return {
        range: {
          start: { line: position.line, character: start },
          end: { line: position.line, character: end },
        },
        placeholder: symbolName,
      };
    }
  }

  return null;
}

/**
 * Perform the rename operation
 *
 * Returns a WorkspaceEdit with all the changes needed.
 */
export async function performRename(
  oldName: string,
  newName: string,
  workspaceRoots: string[],
  openDocuments: Map<string, TextDocument>
): Promise<WorkspaceEdit> {
  // Validate new name
  if (!isValidIdentifier(newName)) {
    throw new Error(`Invalid identifier: ${newName}`);
  }

  // Don't allow renaming to special forms
  if (isSpecialForm(newName)) {
    throw new Error(`Cannot rename to reserved keyword: ${newName}`);
  }

  const changes: { [uri: string]: TextEdit[] } = {};

  // If we have workspace roots, search all HQL files
  if (workspaceRoots.length > 0) {
    const results = await findReferencesInWorkspace(
      oldName,
      workspaceRoots,
      undefined,
      undefined,
      true // include declaration
    );

    for (const ref of results) {
      const uri = ref.location.uri;
      if (!changes[uri]) {
        changes[uri] = [];
      }

      changes[uri].push({
        range: ref.location.range,
        newText: newName,
      });
    }
  } else {
    // Fallback: Only search open documents
    for (const [uri, doc] of openDocuments) {
      const filePath = uriToFilePath(uri);
      const refs = findReferencesInContent(doc.getText(), oldName, filePath);

      if (refs.length > 0) {
        changes[uri] = refs.map((ref) => ({
          range: ref.range,
          newText: newName,
        }));
      }
    }
  }

  return { changes };
}

/**
 * Check if a name is a valid HQL identifier
 */
function isValidIdentifier(name: string): boolean {
  // Must start with letter or underscore
  // Can contain letters, digits, -, _, ?, !
  return /^[a-zA-Z_][a-zA-Z0-9_\-?!]*$/.test(name);
}

/**
 * Check if a name is a special form that shouldn't be renamed
 */
function isSpecialForm(name: string): boolean {
  const specialForms = new Set([
    // Core forms
    "fn",
    "let",
    "var",
    "const",
    // NOTE: set! was removed in HQL v2.0 - use = operator instead
    "if",
    "do",
    "quote",
    "quasiquote",
    "unquote",
    "unquote-splicing",

    // Definitions
    "macro",
    "class",
    "enum",

    // Control flow
    "cond",
    "case",
    "for",
    "while",
    "loop",
    "recur",
    "try",
    "catch",
    "finally",
    "throw",

    // Import/export
    "import",
    "export",
    "from",
    "as",

    // Special operators
    "new",
    "typeof",
    "instanceof",
    "await",
    "yield",

    // JS interop
    "js-call",
    ".-",

    // Threading
    "->",
    "->>",
    "as->",
    "cond->",
    "cond->>",

    // Logic
    "and",
    "or",
    "not",

    // Comparison (these are actually functions but commonly used)
    "true",
    "false",
    "nil",
  ]);

  return specialForms.has(name);
}

/**
 * Get the word at a position in a document (for rename)
 */
export function getWordForRename(
  doc: TextDocument,
  position: { line: number; character: number }
): string | null {
  const prepared = prepareRename(doc, position);
  return prepared?.placeholder ?? null;
}
