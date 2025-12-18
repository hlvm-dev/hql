/**
 * LSP Analysis Bridge
 *
 * This module bridges the LSP server to HQL's core compiler infrastructure.
 * It provides a clean interface for parsing documents and extracting symbols,
 * without exposing LSP code to HQL internals directly.
 */

import { parse } from "../src/transpiler/pipeline/parser.ts";
import { SymbolTable } from "../src/transpiler/symbol_table.ts";
import { HQLError } from "../src/common/error.ts";
import type { SExp, SList, SSymbol, SLiteral } from "../src/s-exp/types.ts";
import type { HQLRange } from "./utils/position.ts";

/**
 * Result of analyzing an HQL document
 */
export interface AnalysisResult {
  /** Parsed AST (null if parse failed completely) */
  ast: SExp[] | null;
  /** Symbol table with all definitions */
  symbols: SymbolTable;
  /** Errors found during analysis */
  errors: AnalysisError[];
}

/**
 * An error found during analysis
 */
export interface AnalysisError {
  /** Error message */
  message: string;
  /** Optional error code */
  code?: string;
  /** Location in source */
  range: HQLRange;
  /** Severity: 1=Error, 2=Warning, 3=Info, 4=Hint */
  severity: 1 | 2 | 3 | 4;
}

/**
 * Analyze an HQL document
 *
 * Parses the source code and extracts symbols for IDE features.
 * Handles errors gracefully - always returns a result even if parsing fails.
 */
export function analyzeDocument(
  text: string,
  filePath: string
): AnalysisResult {
  const errors: AnalysisError[] = [];
  let ast: SExp[] | null = null;
  const symbols = new SymbolTable(null, "global");

  try {
    // Step 1: Parse the document using HQL's parser
    ast = parse(text, filePath);

    // Step 2: Extract symbols from the AST
    if (ast) {
      collectSymbols(ast, symbols, filePath);
    }
  } catch (error) {
    // Handle HQL errors with source locations
    if (error instanceof HQLError && error.sourceLocation) {
      const loc = error.sourceLocation;
      errors.push({
        message: cleanErrorMessage(error.message),
        code: error.code?.toString(),
        range: {
          start: {
            line: loc.line ?? 1,
            column: loc.column ?? 1,
          },
          end: {
            line: loc.endLine ?? loc.line ?? 1,
            column: loc.endColumn ?? 999,
          },
        },
        severity: 1,
      });
    } else {
      // Unknown error - report at beginning of file
      const message =
        error instanceof Error ? error.message : String(error);
      errors.push({
        message: cleanErrorMessage(message),
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 999 },
        },
        severity: 1,
      });
    }
  }

  return { ast, symbols, errors };
}

/**
 * Clean up error messages for display
 * Removes redundant location info that LSP will display separately
 */
function cleanErrorMessage(message: string): string {
  // Remove trailing location info like "at file.hql:10:5"
  return message
    .replace(/\s+at\s+\S+:\d+:\d+$/, "")
    .replace(/\s+\(\S+:\d+:\d+\)$/, "")
    .replace(/^\[HQL\d+\]\s*/, ""); // Remove error code prefix (LSP shows it separately)
}

/**
 * Type guard to check if SExp is a symbol
 */
function isSymbol(exp: SExp): exp is SSymbol {
  return exp.type === "symbol";
}

/**
 * Type guard to check if SExp is a list
 */
function isList(exp: SExp): exp is SList {
  return exp.type === "list";
}

/**
 * Type guard to check if SExp is a literal
 */
function isLiteral(exp: SExp): exp is SLiteral {
  return exp.type === "literal";
}

/**
 * Parse parameter name and type from HQL syntax.
 * HQL uses colon-separated format: `name:type`
 * Examples: "x:number", "callback:Function", "items:string[]"
 */
function parseParamNameAndType(rawName: string): { name: string; type?: string } {
  const colonIndex = rawName.indexOf(":");
  if (colonIndex > 0) {
    const name = rawName.slice(0, colonIndex).trim();
    const type = rawName.slice(colonIndex + 1).trim();
    return { name, type: type || undefined };
  }
  return { name: rawName };
}

/**
 * Extract symbol definitions from an AST
 */
function collectSymbols(
  ast: SExp[],
  symbols: SymbolTable,
  filePath: string
): void {
  for (const node of ast) {
    if (!isList(node) || node.elements.length === 0) continue;

    const head = node.elements[0];
    if (!isSymbol(head)) continue;

    switch (head.name) {
      case "let":
      case "var":
        collectBinding(node, symbols, filePath, head.name);
        break;
      case "fn":
        collectFunction(node, symbols, filePath);
        break;
      case "macro":
        collectMacro(node, symbols, filePath);
        break;
      case "class":
        collectClass(node, symbols, filePath);
        break;
      case "enum":
        collectEnum(node, symbols, filePath);
        break;
      case "import":
        collectImport(node, symbols, filePath);
        break;
      case "export":
        collectExport(node, symbols, filePath);
        break;
    }
  }
}

/**
 * Collect a variable binding: (let name value) or (var name value)
 * Also handles block form: (let (x 10 y 20) body)
 */
function collectBinding(
  node: SList,
  symbols: SymbolTable,
  filePath: string,
  bindingType: string
): void {
  if (node.elements.length < 2) return;

  const second = node.elements[1];

  // Check if it's block binding form: (let (x 10 y 20) body)
  if (isList(second)) {
    // Block binding - process pairs
    const bindings = second.elements;
    // Skip "vector" symbol if present (from parser)
    const startIdx = isSymbol(bindings[0]) && bindings[0].name === "vector" ? 1 : 0;
    for (let i = startIdx; i < bindings.length - 1; i += 2) {
      const nameNode = bindings[i];
      const valueNode = bindings[i + 1];
      if (isSymbol(nameNode) && nameNode.name !== "vector") {
        symbols.set({
          name: nameNode.name,
          kind: "variable",
          type: inferType(valueNode),
          scope: "local",
          location: {
            filePath,
            line: nameNode._meta?.line ?? 1,
            column: nameNode._meta?.column ?? 1,
          },
        });
      }
    }
    return;
  }

  // Simple binding form: (let name value) or (var name value)
  if (!isSymbol(second)) return;

  const nameNode = second;
  let type: string | undefined;
  if (node.elements.length >= 3) {
    type = inferType(node.elements[2]);
  }

  symbols.set({
    name: nameNode.name,
    kind: "variable",
    type,
    scope: bindingType === "var" ? "global" : "global",
    location: {
      filePath,
      line: nameNode._meta?.line ?? 1,
      column: nameNode._meta?.column ?? 1,
    },
  });
}

/**
 * Collect a function definition: (fn name [params] body)
 * Also supports typed syntax: (fn name [a:number b:string] :ReturnType body)
 * HQL uses `fn` for all function definitions (named and anonymous)
 */
function collectFunction(
  node: SList,
  symbols: SymbolTable,
  filePath: string
): void {
  if (node.elements.length < 3) return;

  // Handle both named and anonymous functions
  // Named: (fn name [params] body)
  // Anonymous: (fn [params] body)
  let nameNode: SSymbol | null = null;
  let paramsIndex = 1;

  if (isSymbol(node.elements[1])) {
    nameNode = node.elements[1];
    paramsIndex = 2;
  }

  // Anonymous functions don't get registered as top-level symbols
  if (!nameNode) return;

  // Extract parameters with type annotations
  // Note: [a b] is parsed as (vector a b), so skip the "vector" symbol
  // HQL type syntax: [a:number b:string] - colon inside the symbol
  const params: { name: string; type?: string }[] = [];
  if (
    node.elements.length > paramsIndex &&
    isList(node.elements[paramsIndex])
  ) {
    const paramsNode = node.elements[paramsIndex] as SList;
    for (const p of paramsNode.elements) {
      if (isSymbol(p) && p.name !== "vector" && p.name !== "empty-array") {
        // Parse type annotation from parameter name (e.g., "x:number")
        const parsed = parseParamNameAndType(p.name);
        params.push(parsed);
      }
    }
  }

  // Extract return type annotation
  // Syntax: (fn name [params] :ReturnType body)
  // Return type is a symbol starting with ":" after the params list
  let returnType: string | undefined;
  const returnTypeIndex = paramsIndex + 1;
  if (node.elements.length > returnTypeIndex) {
    const potentialReturnType = node.elements[returnTypeIndex];
    if (isSymbol(potentialReturnType)) {
      const sym = potentialReturnType.name;
      // Return type starts with : (e.g., ":number", ":string[]", ":void")
      if (sym.startsWith(":") && sym.length > 1) {
        returnType = sym.slice(1).trim();
      }
    }
  }

  symbols.set({
    name: nameNode.name,
    kind: "function",
    scope: "global",
    params,
    returnType,
    location: {
      filePath,
      line: nameNode._meta?.line ?? 1,
      column: nameNode._meta?.column ?? 1,
    },
  });
}

/**
 * Collect a macro definition: (macro name [params] body)
 * Macros can also have typed parameters: (macro name [x:SExp y:SExp] body)
 */
function collectMacro(
  node: SList,
  symbols: SymbolTable,
  filePath: string
): void {
  if (node.elements.length < 3) return;

  const nameNode = node.elements[1];
  if (!isSymbol(nameNode)) return;

  // Extract parameters with type annotations
  // Note: [a b] is parsed as (vector a b), so skip the "vector" symbol
  const params: { name: string; type?: string }[] = [];
  if (node.elements.length > 2 && isList(node.elements[2])) {
    const paramsNode = node.elements[2] as SList;
    for (const p of paramsNode.elements) {
      if (isSymbol(p) && p.name !== "vector" && p.name !== "empty-array") {
        // Parse type annotation from parameter name (e.g., "x:SExp")
        const parsed = parseParamNameAndType(p.name);
        params.push(parsed);
      }
    }
  }

  symbols.set({
    name: nameNode.name,
    kind: "macro",
    scope: "global",
    params,
    location: {
      filePath,
      line: nameNode._meta?.line ?? 1,
      column: nameNode._meta?.column ?? 1,
    },
  });
}

/**
 * Collect a class definition: (class Name ...)
 * Supports typed syntax for fields: (field x:number)
 * Supports typed methods: (fn methodName [a:Type] :ReturnType body)
 */
function collectClass(
  node: SList,
  symbols: SymbolTable,
  filePath: string
): void {
  if (node.elements.length < 2) return;

  const nameNode = node.elements[1];
  if (!isSymbol(nameNode)) return;

  // Extract fields and methods
  const fields: { name: string; type?: string }[] = [];
  const methods: {
    name: string;
    params?: { name: string; type?: string }[];
    returnType?: string;
  }[] = [];

  for (let i = 2; i < node.elements.length; i++) {
    const member = node.elements[i];
    if (!isList(member) || member.elements.length === 0) continue;

    const memberHead = member.elements[0];
    if (!isSymbol(memberHead)) continue;

    if (memberHead.name === "field" && member.elements.length >= 2) {
      const fieldName = member.elements[1];
      if (isSymbol(fieldName)) {
        // Parse field type annotation (e.g., "x:number")
        const parsed = parseParamNameAndType(fieldName.name);
        fields.push(parsed);
      }
    } else if (
      memberHead.name === "fn" &&
      member.elements.length >= 3
    ) {
      const methodName = member.elements[1];
      if (isSymbol(methodName)) {
        const methodParams: { name: string; type?: string }[] = [];
        const paramsNode = member.elements[2];
        if (isList(paramsNode)) {
          for (const p of (paramsNode as SList).elements) {
            // Skip "vector" symbol from parsed [params]
            if (isSymbol(p) && p.name !== "vector" && p.name !== "empty-array") {
              // Parse type annotation from parameter name (e.g., "x:number")
              const parsed = parseParamNameAndType(p.name);
              methodParams.push(parsed);
            }
          }
        }

        // Extract return type for method
        // Syntax: (fn name [params] :ReturnType body)
        let returnType: string | undefined;
        if (member.elements.length > 3) {
          const potentialReturnType = member.elements[3];
          if (isSymbol(potentialReturnType)) {
            const sym = potentialReturnType.name;
            if (sym.startsWith(":") && sym.length > 1) {
              returnType = sym.slice(1).trim();
            }
          }
        }

        methods.push({ name: methodName.name, params: methodParams, returnType });
      }
    }
  }

  symbols.set({
    name: nameNode.name,
    kind: "class",
    scope: "global",
    fields,
    methods,
    location: {
      filePath,
      line: nameNode._meta?.line ?? 1,
      column: nameNode._meta?.column ?? 1,
    },
  });
}

/**
 * Collect an enum definition: (enum Name (case A) (case B) ...)
 */
function collectEnum(
  node: SList,
  symbols: SymbolTable,
  filePath: string
): void {
  if (node.elements.length < 2) return;

  const nameNode = node.elements[1];
  if (!isSymbol(nameNode)) return;

  // Extract cases
  const cases: string[] = [];
  for (let i = 2; i < node.elements.length; i++) {
    const caseNode = node.elements[i];
    if (!isList(caseNode) || caseNode.elements.length < 2) continue;

    const caseHead = caseNode.elements[0];
    if (!isSymbol(caseHead) || caseHead.name !== "case") continue;

    const caseName = caseNode.elements[1];
    if (isSymbol(caseName)) {
      cases.push(caseName.name);
    }
  }

  symbols.set({
    name: nameNode.name,
    kind: "enum",
    scope: "global",
    cases,
    location: {
      filePath,
      line: nameNode._meta?.line ?? 1,
      column: nameNode._meta?.column ?? 1,
    },
  });

  // Also register each case
  for (const caseName of cases) {
    symbols.set({
      name: `${nameNode.name}.${caseName}`,
      kind: "enum-case",
      scope: "global",
      parent: nameNode.name,
      location: {
        filePath,
        line: nameNode._meta?.line ?? 1,
        column: nameNode._meta?.column ?? 1,
      },
    });
  }
}

/**
 * Collect imports: (import [a b] from "module") or (import name from "module")
 */
function collectImport(
  node: SList,
  symbols: SymbolTable,
  filePath: string
): void {
  if (node.elements.length < 4) return;

  const importSpec = node.elements[1];
  let sourceModule: string | undefined;

  // Find "from" and module path
  for (let i = 2; i < node.elements.length - 1; i++) {
    const elem = node.elements[i];
    if (isSymbol(elem) && elem.name === "from") {
      const pathNode = node.elements[i + 1];
      if (isLiteral(pathNode) && typeof pathNode.value === "string") {
        sourceModule = pathNode.value;
      }
      break;
    }
  }

  if (isSymbol(importSpec)) {
    // Namespace import: (import name from "module")
    symbols.set({
      name: importSpec.name,
      kind: "import",
      scope: "global",
      sourceModule,
      isImported: true,
      location: {
        filePath,
        line: importSpec._meta?.line ?? 1,
        column: importSpec._meta?.column ?? 1,
      },
    });
  } else if (isList(importSpec)) {
    // Named imports: (import [a b] from "module")
    for (const elem of importSpec.elements) {
      if (isSymbol(elem)) {
        symbols.set({
          name: elem.name,
          kind: "import",
          scope: "global",
          sourceModule,
          isImported: true,
          location: {
            filePath,
            line: elem._meta?.line ?? 1,
            column: elem._meta?.column ?? 1,
          },
        });
      }
    }
  }
}

/**
 * Collect exports: (export symbol), (export [a b c]), or (export (fn name ...))
 * Marks existing symbols as exported, or creates exported symbols for inline forms
 */
function collectExport(
  node: SList,
  symbols: SymbolTable,
  filePath: string
): void {
  if (node.elements.length < 2) return;

  const exportSpec = node.elements[1];

  if (isSymbol(exportSpec)) {
    // Single export: (export symbol)
    markAsExported(exportSpec.name, symbols);
  } else if (isList(exportSpec)) {
    // Check if it's inline export: (export (fn name ...)) or (export (class ...))
    const head = exportSpec.elements[0];
    if (isSymbol(head)) {
      if (head.name === "fn" && exportSpec.elements.length >= 2) {
        // Inline function export: (export (fn name [params] body))
        const nameNode = exportSpec.elements[1];
        if (isSymbol(nameNode)) {
          // Collect the function first
          collectFunction(exportSpec, symbols, filePath);
          // Then mark as exported
          markAsExported(nameNode.name, symbols);
          return;
        }
      } else if (head.name === "class" && exportSpec.elements.length >= 2) {
        // Inline class export: (export (class Name ...))
        const nameNode = exportSpec.elements[1];
        if (isSymbol(nameNode)) {
          collectClass(exportSpec, symbols, filePath);
          markAsExported(nameNode.name, symbols);
          return;
        }
      } else if (head.name === "macro" && exportSpec.elements.length >= 2) {
        // Inline macro export: (export (macro name ...))
        const nameNode = exportSpec.elements[1];
        if (isSymbol(nameNode)) {
          collectMacro(exportSpec, symbols, filePath);
          markAsExported(nameNode.name, symbols);
          return;
        }
      } else if (head.name === "vector" || head.name === "empty-array") {
        // Vector export: (export [a b c])
        for (const elem of exportSpec.elements) {
          if (
            isSymbol(elem) &&
            elem.name !== "vector" &&
            elem.name !== "empty-array"
          ) {
            markAsExported(elem.name, symbols);
          }
        }
        return;
      }
    }
    // Fallback: Vector export without "vector" prefix
    for (const elem of exportSpec.elements) {
      if (
        isSymbol(elem) &&
        elem.name !== "vector" &&
        elem.name !== "empty-array"
      ) {
        markAsExported(elem.name, symbols);
      }
    }
  }
}

/**
 * Mark a symbol as exported if it exists
 */
function markAsExported(name: string, symbols: SymbolTable): void {
  const existing = symbols.get(name);
  if (existing) {
    // Update the symbol with isExported flag
    symbols.set({
      ...existing,
      isExported: true,
    });
  }
}

/**
 * Try to infer the type of an expression
 */
function inferType(exp: SExp): string | undefined {
  if (isLiteral(exp)) {
    const val = exp.value;
    if (typeof val === "string") return "String";
    if (typeof val === "number") {
      return Number.isInteger(val) ? "Int" : "Float";
    }
    if (typeof val === "boolean") return "Bool";
    if (val === null) return "Nil";
  }

  if (isList(exp) && exp.elements.length > 0) {
    const head = exp.elements[0];
    if (isSymbol(head)) {
      switch (head.name) {
        case "vector":
        case "list":
          return "Array";
        case "hash-map":
        case "__hql_hash_map":
          return "Map";
        case "hash-set":
          return "Set";
        case "fn":
          return "Function";
      }
    }
  }

  return undefined;
}
