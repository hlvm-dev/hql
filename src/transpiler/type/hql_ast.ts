// src/transpiler/hql_ast.ts
export type HQLNode = LiteralNode | SymbolNode | ListNode;

interface Position {
  line: number;
  column: number;
  filePath?: string;
}

export interface LiteralNode {
  type: "literal";
  value: string | number | boolean | null;
  position?: Position;
}

export interface SymbolNode {
  type: "symbol";
  name: string;
  position?: Position;
}

export interface ListNode {
  type: "list";
  elements: HQLNode[];
  position?: Position;
}

/**
 * Check if a node is an import statement
 */
export function isImportNode(node: HQLNode): boolean {
  return (
    node.type === "list" &&
    node.elements.length >= 3 &&
    node.elements[0].type === "symbol" &&
    ((node.elements[0] as SymbolNode).name === "import")
  );
}