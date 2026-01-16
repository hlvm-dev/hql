// src/common/syntax-error-handler.ts
// Utilities for attaching source location metadata to S-expressions

import type { SExpMeta } from "../hql/s-exp/types.ts";

type NodeWithMeta = { _meta?: SExpMeta };

/**
 * Attach source location information to an S-expression or other node
 */
export function attachSourceLocation(
  node: NodeWithMeta | null | undefined,
  filePath: string,
  line?: number,
  column?: number,
  endLine?: number,
  endColumn?: number,
): void {
  if (!node) return;

  // Create metadata object if it doesn't exist
  const meta = node._meta ?? (node._meta = {} as SExpMeta);

  // Set file path (only if provided)
  if (filePath) {
    meta.filePath = filePath;
  }

  // Set line and column if provided
  if (line !== undefined) {
    meta.line = line;
  }
  if (column !== undefined) {
    meta.column = column;
  }
  if (endLine !== undefined) {
    meta.endLine = endLine;
  }
  if (endColumn !== undefined) {
    meta.endColumn = endColumn;
  }
}
