// src/hql/transpiler/hql_ast.ts
import type { SExp, SList, SLiteral, SSymbol } from "../../s-exp/types.ts";
import { isImport, isList, isSymbol } from "../../s-exp/types.ts";
import type { IRNode } from "./hql_ir.ts";

export type HQLNode = SExp;
export type ListNode = SList;
export type LiteralNode = SLiteral;
export type SymbolNode = SSymbol;

/** Callback type for transforming an HQL AST node into an IR node. */
export type TransformNodeFn = (node: HQLNode, dir: string) => IRNode | null;

export const isImportNode = isImport;
export const isListNode = isList;
export const isSymbolNode = isSymbol;
