/**
 * LSP Test Helpers - Single Source of Truth
 *
 * All LSP tests should import helper functions from here to avoid duplication.
 */
import { TextDocument } from "npm:vscode-languageserver-textdocument@1.0.11";

// ============================================================================
// Document Creation
// ============================================================================

/**
 * Create a TextDocument for testing.
 * @param content - The document content
 * @param uri - Optional URI (defaults to "file:///test.hql")
 */
export function createDoc(content: string, uri = "file:///test.hql"): TextDocument {
  return TextDocument.create(uri, "hql", 1, content);
}
