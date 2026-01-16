// src/hql/transpiler/hql_ast.ts
import type { SExp, SList, SLiteral, SSymbol } from "../../s-exp/types.ts";
import { isImport, isList, isLiteral, isSymbol } from "../../s-exp/types.ts";

export type HQLNode = SExp;
export type ListNode = SList;
export type LiteralNode = SLiteral;
export type SymbolNode = SSymbol;

export const isImportNode = isImport;
export const isListNode = isList;
export const isLiteralNode = isLiteral;
export const isSymbolNode = isSymbol;
