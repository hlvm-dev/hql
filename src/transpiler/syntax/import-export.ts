// src/transpiler/syntax/import-export.ts

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode, LiteralNode, SymbolNode } from "../type/hql_ast.ts";

type TransformNodeFn = (node: HQLNode, dir: string) => IR.IRNode | null;
import {
  perform,
  TransformError,
  ValidationError,
} from "../../common/error.ts";
import { sanitizeIdentifier } from "../../common/utils.ts";
import { globalLogger as logger } from "../../logger.ts";
import { processVectorElements } from "./data-structure.ts";
import { globalSymbolTable } from "../symbol_table.ts";
import { globalMacroRegistry } from "../../imports.ts";
import { ALL_DECLARATION_BINDING_KEYWORDS_SET } from "../keyword/primitives.ts";

/** Valid export declaration types - cached Set for O(1) lookup */
const VALID_EXPORT_DECLARATION_TYPES: ReadonlySet<IR.IRNodeType> = new Set([
  IR.IRNodeType.FunctionDeclaration,
  IR.IRNodeType.VariableDeclaration,
  IR.IRNodeType.ClassDeclaration,
  IR.IRNodeType.EnumDeclaration,
  IR.IRNodeType.FnFunctionDeclaration,
]);

/**
 * Check if a list is a vector import
 */
export function isVectorImport(list: ListNode): boolean {
  return (
    list.elements.length > 3 &&
    list.elements[0].type === "symbol" &&
    (list.elements[0] as SymbolNode).name === "import" &&
    list.elements[1].type === "list" &&
    list.elements[2].type === "symbol" &&
    (list.elements[2] as SymbolNode).name === "from"
  );
}

/**
 * Check if a list is a vector export
 */
export function isVectorExport(list: ListNode): boolean {
  return (
    list.elements.length > 1 &&
    list.elements[0].type === "symbol" &&
    (list.elements[0] as SymbolNode).name === "export" &&
    list.elements[1].type === "list"
  );
}

/**
 * Check if a list is a default export: (export default expr)
 */
export function isDefaultExport(list: ListNode): boolean {
  return (
    list.elements.length >= 3 &&
    list.elements[0].type === "symbol" &&
    (list.elements[0] as SymbolNode).name === "export" &&
    list.elements[1].type === "symbol" &&
    (list.elements[1] as SymbolNode).name === "default"
  );
}

/**
 * Check if a list is a declaration export: (export (fn ...)) or (export (let ...)) or (export (const ...))
 */
export function isDeclarationExport(list: ListNode): boolean {
  if (
    list.elements.length < 2 ||
    list.elements[0].type !== "symbol" ||
    (list.elements[0] as SymbolNode).name !== "export"
  ) {
    return false;
  }

  const second = list.elements[1];

  if (second.type !== "list" || (second as ListNode).elements.length === 0) {
    return false;
  }

  const innerFirst = (second as ListNode).elements[0];
  if (innerFirst.type !== "symbol") {
    return false;
  }

  const keyword = (innerFirst as SymbolNode).name;
  // Support all declaration and binding keywords (from primitives.ts)
  // O(1) Set lookup instead of O(n) array scan
  return ALL_DECLARATION_BINDING_KEYWORDS_SET.has(keyword);
}

/**
 * Check if a list is a single export: (export name)
 */
export function isSingleExport(list: ListNode): boolean {
  return (
    list.elements.length === 2 &&
    list.elements[0].type === "symbol" &&
    (list.elements[0] as SymbolNode).name === "export" &&
    list.elements[1].type === "symbol"
  );
}

/**
 * Transform a single export: (export name)
 */
export function transformSingleExport(
  list: ListNode,
): IR.IRNode | null {
  return perform(
    () => {
      const nameNode = list.elements[1] as SymbolNode;
      const name = sanitizeIdentifier(nameNode.name);

      return {
        type: IR.IRNodeType.ExportNamedDeclaration,
        specifiers: [{
          type: IR.IRNodeType.ExportSpecifier,
          local: {
            type: IR.IRNodeType.Identifier,
            name: name,
          } as IR.IRIdentifier,
          exported: {
            type: IR.IRNodeType.Identifier,
            name: name,
          } as IR.IRIdentifier,
        } as IR.IRExportSpecifier],
      } as IR.IRExportNamedDeclaration;
    },
    "transformSingleExport",
    TransformError,
    [list],
  );
}

/**
 * Check if a list is a namespace import
 */
export function isNamespaceImport(list: ListNode): boolean {
  return (
    list.elements.length > 3 &&
    list.elements[0].type === "symbol" &&
    (list.elements[0] as SymbolNode).name === "import" &&
    list.elements[1].type === "symbol" &&
    list.elements[2].type === "symbol" &&
    (list.elements[2] as SymbolNode).name === "from"
  );
}

/**
 * Check if a position in a list of nodes has an 'as' alias following it
 */
function hasAliasFollowing(
  elements: (SymbolNode | LiteralNode | ListNode)[],
  position: number,
): boolean {
  return (
    position + 2 < elements.length &&
    elements[position + 1].type === "symbol" &&
    (elements[position + 1] as SymbolNode).name === "as" &&
    elements[position + 2].type === "symbol"
  );
}

/**
 * Create an import specifier for the IR
 */
function createImportSpecifier(
  imported: string,
  local: string,
): IR.IRImportSpecifier {
  return perform(
    () => {
      return {
        type: IR.IRNodeType.ImportSpecifier,
        imported: {
          type: IR.IRNodeType.Identifier,
          // Sanitize imported name, but preserve "default" for default imports
          name: imported === "default"
            ? imported
            : sanitizeIdentifier(imported),
        } as IR.IRIdentifier,
        local: {
          type: IR.IRNodeType.Identifier,
          name: sanitizeIdentifier(local),
        } as IR.IRIdentifier,
      };
    },
    `createImportSpecifier '${imported} as ${local}'`,
    TransformError,
    [imported, local],
  );
}

/**
 * Transform namespace import with "from" syntax
 */
export function transformNamespaceImport(
  list: ListNode,
  _currentDir: string,
): IR.IRNode | null {
  return perform(
    () => {
      const nameNode = list.elements[1];
      const pathNode = list.elements[3];

      if (nameNode.type !== "symbol") {
        throw new ValidationError(
          "Import name must be a symbol",
          "namespace import",
          "symbol",
          nameNode.type,
        );
      }

      if (pathNode.type !== "literal") {
        throw new ValidationError(
          "Import path must be a string literal",
          "namespace import",
          "string literal",
          pathNode.type,
        );
      }

      const name = (nameNode as SymbolNode).name;
      const pathVal = String((pathNode as LiteralNode).value);

      return {
        type: IR.IRNodeType.ImportDeclaration,
        source: pathVal,
        specifiers: [{
          type: IR.IRNodeType.ImportNamespaceSpecifier,
          local: {
            type: IR.IRNodeType.Identifier,
            name: sanitizeIdentifier(name),
          } as IR.IRIdentifier,
        } as IR.IRImportNamespaceSpecifier],
      } as IR.IRImportDeclaration;
    },
    "transformNamespaceImport",
    TransformError,
    [list],
  );
}

/**
 * Transform a vector-based export statement
 */
export function transformVectorExport(
  list: ListNode,
  _currentDir: string,
): IR.IRNode | null {
  return perform(
    () => {
      const vectorNode = list.elements[1];
      if (vectorNode.type !== "list") {
        throw new ValidationError(
          "Export argument must be a vector (list)",
          "vector export",
          "vector (list)",
          vectorNode.type,
        );
      }

      const symbols = processVectorElements((vectorNode as ListNode).elements);
      const exportSpecifiers: IR.IRExportSpecifier[] = [];

      let i = 0;
      while (i < symbols.length) {
        const elem = symbols[i];
        if (elem.type !== "symbol") {
          logger.warn(`Skipping non-symbol export element: ${elem.type}`);
          i++;
          continue;
        }
        const localName = (elem as SymbolNode).name;

        // Check if this is a macro - macros should not be exported as runtime values
        const symbolInfo = globalSymbolTable.get(localName);
        const isSymbolTableMacro = symbolInfo?.kind === "macro";
        const isRegistryMacro = globalMacroRegistry.has(localName);
        const isMacro = isSymbolTableMacro || isRegistryMacro;

        if (isMacro) {
          logger.debug(`Filtering macro '${localName}' from export declaration (macros are compile-time only)`);
          // Skip the macro and its alias if present
          if (hasAliasFollowing(symbols, i)) {
            i += 3; // Skip name, 'as', and alias
          } else {
            i++; // Skip just the name
          }
          continue;
        }

        // Check for alias: [foo as bar]
        if (hasAliasFollowing(symbols, i)) {
          const exportedName = (symbols[i + 2] as SymbolNode).name;
          exportSpecifiers.push(createExportSpecifier(localName, exportedName));
          i += 3;
        } else {
          exportSpecifiers.push(createExportSpecifier(localName, localName));
          i++;
        }
      }

      if (exportSpecifiers.length === 0) {
        logger.debug("No valid exports found (all were macros), skipping export declaration");
        return null;
      }

      return {
        type: IR.IRNodeType.ExportNamedDeclaration,
        specifiers: exportSpecifiers,
      } as IR.IRExportNamedDeclaration;
    },
    "transformVectorExport",
    TransformError,
    [list],
  );
}

/**
 * Create an export specifier
 */
function createExportSpecifier(
  local: string,
  exported: string,
): IR.IRExportSpecifier {
  return perform(
    () => {
      return {
        type: IR.IRNodeType.ExportSpecifier,
        local: {
          type: IR.IRNodeType.Identifier,
          name: sanitizeIdentifier(local),
        } as IR.IRIdentifier,
        exported: {
          type: IR.IRNodeType.Identifier,
          name: sanitizeIdentifier(exported), // Sanitize exported name too!
        } as IR.IRIdentifier,
      };
    },
    `createExportSpecifier '${local} as ${exported}'`,
    TransformError,
    [local, exported],
  );
}

/**
 * Transform a vector-based import statement
 */
export function transformVectorImport(
  list: ListNode,
): IR.IRNode | null {
  return perform(
    () => {
      const vectorNode = list.elements[1] as ListNode;
      if (list.elements[3].type !== "literal") {
        throw new ValidationError(
          "Import path must be a string literal",
          "vector import",
          "string literal",
        );
      }

      const modulePath = (list.elements[3] as LiteralNode).value as string;
      if (typeof modulePath !== "string") {
        throw new ValidationError(
          "Import path must be a string",
          "vector import",
          "string",
        );
      }

      const elements = processVectorElements(vectorNode.elements);
      const importSpecifiers: IR.IRImportSpecifier[] = [];
      let i = 0;
      while (i < elements.length) {
        const elem = elements[i];
        if (elem.type === "symbol") {
          const symbolName = (elem as SymbolNode).name;

          // Check if this symbol is a macro - macros should not be in JS imports
          // Check both symbol table and global macro registry for consistency
          const symbolInfo = globalSymbolTable.get(symbolName);
          const isSymbolTableMacro = symbolInfo?.kind === "macro";
          const isRegistryMacro = globalMacroRegistry.has(symbolName) ||
                                   globalMacroRegistry.has(sanitizeIdentifier(symbolName));
          const isMacro = isSymbolTableMacro || isRegistryMacro;

          if (isMacro) {
            logger.debug(
              `Skipping macro '${symbolName}' from import statement (symbolTable: ${isSymbolTableMacro}, registry: ${isRegistryMacro})`,
            );
            // Skip this symbol - check if it has an alias and skip that too
            const hasAlias = hasAliasFollowing(elements, i);
            i += hasAlias ? 3 : 1;
            continue;
          }

          const hasAlias = hasAliasFollowing(elements, i);
          const aliasName = hasAlias
            ? (elements[i + 2] as SymbolNode).name
            : null;

          if (hasAlias) {
            importSpecifiers.push(
              createImportSpecifier(symbolName, aliasName!),
            );

            i += 3;
          } else {
            importSpecifiers.push(
              createImportSpecifier(symbolName, symbolName),
            );

            i += 1;
          }
        } else {
          i += 1;
        }
      }

      if (importSpecifiers.length === 0) {
        logger.debug("All imports were macros, skipping import declaration");
        return null;
      }

      return {
        type: IR.IRNodeType.ImportDeclaration,
        source: modulePath,
        specifiers: importSpecifiers,
      } as IR.IRImportDeclaration;
    },
    "transformVectorImport",
    TransformError,
    [list],
  );
}

/**
 * Transform a default export statement: (export default expr)
 * Syntax: (export default <expression>)
 */
export function transformDefaultExport(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode | null {
  return perform(
    () => {
      // list.elements[0] = 'export'
      // list.elements[1] = 'default'
      // list.elements[2] = the expression to export
      if (list.elements.length < 3) {
        throw new ValidationError(
          "export default requires an expression",
          "export default",
          "(export default <expression>)",
          "missing expression",
        );
      }

      const exprNode = list.elements[2];
      const transformedExpr = transformNode(exprNode, currentDir);

      if (!transformedExpr) {
        throw new TransformError(
          "Failed to transform export default expression",
          "export default",
          exprNode,
        );
      }

      return {
        type: IR.IRNodeType.ExportDefaultDeclaration,
        declaration: transformedExpr,
      } as IR.IRExportDefaultDeclaration;
    },
    "transformDefaultExport",
    TransformError,
    [list],
  );
}

/**
 * Transform a declaration export: (export (fn ...))
 */
export function transformDeclarationExport(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode | null {
  return perform(
    () => {
      const declNode = list.elements[1];
      const transformed = transformNode(declNode, currentDir);

      if (!transformed) {
        throw new TransformError(
          "Failed to transform exported declaration",
          "export declaration",
          declNode,
        );
      }

      // Validate that it IS a declaration or function that can be exported
      if (
        // O(1) Set lookup instead of O(n) array creation + includes
        !VALID_EXPORT_DECLARATION_TYPES.has(transformed.type)
      ) {
        // Allow exporting expressions if they are valid declarations in disguise?
        // No, export named must be a declaration.
        throw new ValidationError(
          "Exported item must be a declaration (fn, let, var, class, enum)",
          "export declaration",
          "declaration",
          IR.IRNodeType[transformed.type],
        );
      }

      return {
        type: IR.IRNodeType.ExportNamedDeclaration,
        declaration: transformed,
        specifiers: [],
        source: null,
      } as IR.IRExportNamedDeclaration;
    },
    "transformDeclarationExport",
    TransformError,
    [list],
  );
}