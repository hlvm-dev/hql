/**
 * HLVM REPL Completer Utilities
 *
 * Re-exports word extraction and identifier classification from single sources of truth.
 */

// Re-export word extraction from string-utils (single source of truth)
export { getWordAtCursor } from "./string-utils.ts";

// Re-export shared types and functions from known-identifiers.ts
export {
  KEYWORD_SET,
  OPERATOR_SET,
  MACRO_SET,
  classifyIdentifier,
} from "../../../common/known-identifiers.ts";

// ============================================================
// Types
// ============================================================

export type CompletionType =
  | "keyword"
  | "operator"
  | "macro"
  | "function"
  | "variable";

export interface CompletionItem {
  /** The completion text */
  readonly text: string;
  /** Type of identifier */
  readonly type: CompletionType;
}
