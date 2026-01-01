// core/src/transpiler/pipeline/syntax-transformer.ts
// Modified version with enhanced error reporting and source location support

import {
  couldBePattern,
  createList,
  createListFrom,
  createLiteral,
  createSymbol,
  isList,
  isSymbol,
  type SExp,
  type SExpMeta,
  type SList,
  type SSymbol,
} from "../../s-exp/types.ts";
import { globalLogger as logger, type Logger } from "../../logger.ts";
import { HQLError, perform, TransformError } from "../../common/error.ts";
import { getErrorMessage } from "../../common/utils.ts";
import { withSourceLocationOpts } from "../utils/source_location_utils.ts";
import type { ListNode, SymbolNode } from "../type/hql_ast.ts";
import { globalSymbolTable, type SymbolTable } from "../symbol_table.ts";
import type { SymbolKind } from "../symbol_table.ts";
import { getSymbolTable, type CompilerContext } from "../compiler-context.ts";
import {
  VECTOR_SYMBOL,
  EMPTY_ARRAY_SYMBOL,
} from "../../common/runtime-helper-impl.ts";

// Pre-compiled regex for numeric string check (avoid creating regex in hot path)
const NUMERIC_STRING_REGEX = /^\d+$/;

// Module-level symbol table for current compilation unit
// Set by transformSyntax, used by helper functions
// This enables isolation when context.symbolTable is provided
let currentSymbolTable: SymbolTable = globalSymbolTable;

/**
 * Main entry point - transforms all syntax sugar into canonical S-expressions
 * @param ast - The AST to transform
 * @param context - Optional compiler context for isolated compilation
 */
export function transformSyntax(ast: SExp[], context?: CompilerContext): SExp[] {
  // Use context-specific symbol table if provided, otherwise global
  currentSymbolTable = getSymbolTable(context);

  // Clear the symbol table at the start
  currentSymbolTable.clear();

  const enumDefinitions = new Map<string, SList>();

  // === Phase 1: Unified Symbol Registration ===
  for (const node of ast) {
    if (!isList(node)) continue;
    const list = node as SList;
    if (list.elements.length === 0 || !isSymbol(list.elements[0])) continue;

    const head = (list.elements[0] as SSymbol).name;

    switch (head) {
      case "enum":
        registerEnum(list, enumDefinitions);
        break;
      case "class":
        registerClass(list);
        break;
      case "fn":
      case "macro":
        registerFunctionOrMacro(list, head);
        break;
      case "let":
      case "var":
        registerBinding(list, head);
        break;
      case "module":
      case "import":
      case "export":
      case "namespace":
      case "alias":
      case "operator":
      case "constant":
      case "property":
      case "special-form":
      case "builtin":
        registerModuleConstruct(list, head);
        break;
    }
  }

  logger.debug(
    "=== Symbol Table after Registration phase ===\n" +
      JSON.stringify(currentSymbolTable.dump(), null, 2),
  );

  // === Phase 2: Transform nodes ===
  const transformed: SExp[] = [];
  for (const node of ast) {
    try {
      transformed.push(transformNode(node, enumDefinitions, logger));
    } catch (error) {
      if (error instanceof HQLError) {
        throw error;
      }
      const errorLoc = getLocationFromNode(node);
      throw new TransformError(
        `Transformation error: ${getErrorMessage(error)}`,
        "node transformation",
        withSourceLocationOpts(errorLoc, node),
      );
    }
  }
  
  return transformed;
}

function registerEnum(list: SList, enumDefinitions: Map<string, SList>): void {
  if (list.elements.length > 1 && isSymbol(list.elements[1])) {
    const enumName = (list.elements[1] as SSymbol).name.split(":")[0];
    enumDefinitions.set(enumName, list);
    const cases: string[] = [];
    const associatedValues: { name: string; type?: string }[] = [];
    for (let i = 2; i < list.elements.length; i++) {
      const el = list.elements[i];
      if (
        isList(el) && el.elements.length > 1 && isSymbol(el.elements[0]) &&
        (el.elements[0] as SSymbol).name === "case"
      ) {
        const caseName = (el.elements[1] as SSymbol)?.name;
        if (caseName) cases.push(caseName);
        if (el.elements.length > 2 && isList(el.elements[2])) {
          for (const field of (el.elements[2] as SList).elements) {
            if (isSymbol(field)) {
              const fieldStr = (field as SSymbol).name;
              associatedValues.push({ name: fieldStr, type: undefined });
            }
          }
        }
        currentSymbolTable.set({
          name: `${enumName}.${caseName}`,
          kind: "enum-case",
          parent: enumName,
          scope: "global",
          associatedValues,
          definition: el,
        });
      }
    }
    currentSymbolTable.set({
      name: enumName,
      kind: "enum",
      cases,
      associatedValues,
      scope: "global",
      definition: list,
    });
  }
}

function registerClass(list: SList): void {
  if (list.elements.length > 1 && isSymbol(list.elements[1])) {
    const typeName = (list.elements[1] as SSymbol).name;
    const fields: { name: string; type?: string }[] = [];
    const methods: {
      name: string;
      params?: { name: string; type?: string }[];
      returnType?: string;
    }[] = [];
    for (let i = 2; i < list.elements.length; i++) {
      const el = list.elements[i];
      if (isList(el) && el.elements.length > 0 && isSymbol(el.elements[0])) {
        const subHead = (el.elements[0] as SSymbol).name;
        // Handle class fields: (var name value), (let name value), (const name value)
        if (
          (subHead === "var" || subHead === "let" || subHead === "const") &&
          el.elements.length > 1 &&
          isSymbol(el.elements[1])
        ) {
          const fieldName = (el.elements[1] as SSymbol).name;
          const fieldType = undefined;
          // Check for typed field: (var name:type value)
          if (fieldName.includes(":")) {
            const [name, type] = fieldName.split(":");
            fields.push({ name, type });
            currentSymbolTable.set({
              name: `${typeName}.${name}`,
              kind: "variable",
              parent: typeName,
              scope: "class",
              type,
              definition: el,
            });
          } else {
            fields.push({ name: fieldName, type: fieldType });
            currentSymbolTable.set({
              name: `${typeName}.${fieldName}`,
              kind: "variable",
              parent: typeName,
              scope: "class",
              type: fieldType,
              definition: el,
            });
          }
        } else if (
          subHead === "fn" && el.elements.length > 1 &&
          isSymbol(el.elements[1])
        ) {
          const mName = (el.elements[1] as SSymbol).name;
          let params: { name: string; type?: string }[] = [];
          const returnType: string | undefined = undefined;
          if (el.elements.length > 2 && isList(el.elements[2])) {
            params = (el.elements[2] as SList).elements.map((p) => {
              if (isSymbol(p)) {
                const pname = (p as SSymbol).name;
                return { name: pname };
              }
              return { name: "?" };
            });
          }
          methods.push({ name: mName, params, returnType });
          currentSymbolTable.set({
            name: `${typeName}.${mName}`,
            kind: "method",
            parent: typeName,
            scope: "class",
            params,
            returnType,
            definition: el,
          });
        }
      }
    }
    currentSymbolTable.set({
      name: typeName,
      kind: "class",
      fields,
      methods,
      scope: "global",
      definition: list,
    });
  }
}

function registerFunctionOrMacro(list: SList, head: string): void {
  if (list.elements.length > 1 && isSymbol(list.elements[1])) {
    const name = (list.elements[1] as SSymbol).name;
    const kind = head === "fn" ? "function" : "macro";
    let params: { name: string; type?: string }[] | undefined = undefined;
    const returnType: string | undefined = undefined;
    if (list.elements.length > 2 && isList(list.elements[2])) {
      params = (list.elements[2] as SList).elements.map((p) => {
        if (isSymbol(p)) {
          const pname = (p as SSymbol).name;
          return { name: pname };
        }
        return { name: "?" };
      });
    }
    currentSymbolTable.set({
      name,
      kind,
      scope: "global",
      params,
      returnType,
      definition: list,
    });
  }
}

function registerBinding(list: SList, bindingKeyword: string): void {
  const isMutable = bindingKeyword === "var";
  try {
    if (list.elements.length === 3 && isSymbol(list.elements[1])) {
      const varName = (list.elements[1] as SSymbol).name;
      const valueNode = list.elements[2];
      const dataType = inferDataType(valueNode);
      currentSymbolTable.set({
        name: varName,
        kind: "variable",
        type: dataType,
        scope: "local",
        definition: valueNode,
        attributes: { mutable: isMutable },
      });
      logger.debug(
        `Registered ${bindingKeyword} binding: ${varName} with type ${dataType}`,
      );
    } else if (list.elements.length > 1 && isList(list.elements[1])) {
      let bindings = list.elements[1] as SList;
      const hadVectorPrefix = bindings.elements.length > 0 &&
        isSymbol(bindings.elements[0]) &&
        ((bindings.elements[0] as SSymbol).name === VECTOR_SYMBOL ||
          (bindings.elements[0] as SSymbol).name === EMPTY_ARRAY_SYMBOL);
      const hadHashMapPrefix = bindings.elements.length > 0 &&
        isSymbol(bindings.elements[0]) &&
        (bindings.elements[0] as SSymbol).name === "hash-map";

      if (hadVectorPrefix) {
        bindings = {
          ...bindings,
          elements: bindings.elements.slice(1),
        } as SList;
      }

      const isPattern = (hadVectorPrefix || hadHashMapPrefix) &&
        couldBePattern(bindings);

      if (
        !isPattern && bindings.elements.length > 0 &&
        bindings.elements.length % 2 !== 0
      ) {
        const errorLoc = getLocationFromNode(bindings);
        throw new TransformError(
          `${bindingKeyword} bindings require an even number of forms (pairs of name and value)`,
          `${bindingKeyword} bindings validation`,
          withSourceLocationOpts(errorLoc, list),
        );
      }

      if (!isPattern) {
        for (let i = 0; i < bindings.elements.length; i += 2) {
          if (
            i + 1 < bindings.elements.length &&
            isSymbol(bindings.elements[i])
          ) {
            const varName = (bindings.elements[i] as SSymbol).name;
            const valueNode = bindings.elements[i + 1];
            const dataType = inferDataType(valueNode);
            currentSymbolTable.set({
              name: varName,
              kind: "variable",
              type: dataType,
              scope: "local",
              definition: valueNode,
              attributes: { mutable: isMutable },
            });
            logger.debug(
              `Registered ${bindingKeyword} binding: ${varName} with type ${dataType}`,
            );
          } else if (i + 1 < bindings.elements.length) {
            const errorLoc = getLocationFromNode(bindings.elements[i]);
            throw new TransformError(
              `${bindingKeyword} binding name must be a symbol`,
              `${bindingKeyword} binding name validation`,
              withSourceLocationOpts(errorLoc, bindings.elements[i]),
            );
          }
        }
      }
    } else if (list.elements.length > 1) {
      const errorLoc = getLocationFromNode(list);
      throw new TransformError(
        `Invalid ${bindingKeyword} form: must be either (${bindingKeyword} name value) or (${bindingKeyword} (bindings...) body...)`,
        `${bindingKeyword} form validation`,
        withSourceLocationOpts(errorLoc, list),
      );
    }
  } catch (error) {
    if (error instanceof HQLError) throw error;
    const errorLoc = getLocationFromNode(list);
    throw new TransformError(
      `Invalid let form: ${getErrorMessage(error)}`,
      "let form validation",
      withSourceLocationOpts(errorLoc, list),
    );
  }
}

function registerModuleConstruct(list: SList, head: string): void {
  const name = (list.elements[1] && isSymbol(list.elements[1]))
    ? (list.elements[1] as SSymbol).name
    : undefined;
  if (name) {
    const symbolKind = head as SymbolKind;
    currentSymbolTable.set({
      name,
      kind: symbolKind,
      scope: "global",
      definition: list,
    });
  }
}

/**
 * Extract source location information from a node
 */
type NodeWithMeta = { _meta?: SExpMeta } | null | undefined;

function getLocationFromNode(
  node: NodeWithMeta,
): { filePath?: string; line?: number; column?: number } {
  // Try to extract from node's metadata
  if (node && node._meta) {
    return {
      filePath: node._meta.filePath,
      line: node._meta.line,
      column: node._meta.column,
    };
  }
  return {};
}

/**
 * Helper function to infer data types for variables during binding
 */
function inferDataType(node: SExp): string {
  if (!node) return "Unknown";

  // If it's a list, examine its structure
  if (isList(node)) {
    const list = node as SList;

    // Empty list
    if (list.elements.length === 0) {
      return "Array";
    }

    // Check the first element for operation type
    if (isSymbol(list.elements[0])) {
      const op = (list.elements[0] as SSymbol).name;

      // Check common data structure constructors
      if (op === VECTOR_SYMBOL || op === EMPTY_ARRAY_SYMBOL) {
        return "Array";
      }
      if (op === "hash-set" || op === "empty-set") {
        return "Set";
      }
      if (op === "hash-map" || op === "empty-map") {
        return "HashMap";
      }

      // Check for new expressions
      if (
        op === "new" && list.elements.length > 1 && isSymbol(list.elements[1])
      ) {
        const className = (list.elements[1] as SSymbol).name;
        if (className === "Set") return "Set";
        if (className === "Map") return "Map";
        if (className.includes("Array")) return "Array";

        const classInfo = currentSymbolTable.get(className);
        if (classInfo?.kind === "class") {
          return className;
        }

        return className;
      }

      // Function literals
      if (op === "fn") {
        return "Function";
      }
    }
  }

  return "Unknown";
}

/**
 * Transform a single node, dispatching to specific handlers based on type
 */
export function transformNode(
  node: SExp | null,
  enumDefinitions: Map<string, SList>,
  logger: Logger,
): SExp {
  if (!node) {
    return createLiteral(null);
  }

  return perform(
    () => {
      // Handle dot notation for enums (.caseName) in symbol form
      if (isSymbol(node) && (node as SSymbol).name.startsWith(".")) {
        return transformDotNotationSymbol(
          node as SSymbol,
          enumDefinitions,
          logger,
        );
      }

      if (!isList(node)) {
        // Only lists can contain syntactic sugar that needs transformation (except for dot symbols handled above)
        return node;
      }

      const list = node as SList;
      if (list.elements.length === 0) {
        // Empty lists don't need transformation
        return list;
      }

      // Handle collection access: (collection index) with collection type from symbol table
      if (list.elements.length >= 2 && isSymbol(list.elements[0])) {
        const collectionName = (list.elements[0] as SSymbol).name;
        const collectionInfo = currentSymbolTable.get(collectionName);

        if (collectionInfo && collectionInfo.type) {
          logger.debug(
            `Found symbol ${collectionName} with type ${collectionInfo.type}`,
          );

          // Handle different collection types
          if (collectionInfo.type === "Set") {
            // For sets, convert to Array.from(set)[index]
            return createList(
              createSymbol("js-get"),
              createList(
                createSymbol("js-call"),
                createSymbol("Array"),
                createLiteral("from"),
                list.elements[0],
              ),
              ...list.elements.slice(1),
            );
          } else if (collectionInfo.type === "Map") {
            // For maps, use the get method
            return createList(
              createSymbol("js-call"),
              list.elements[0],
              createLiteral("get"),
              ...list.elements.slice(1),
            );
          } else if (collectionInfo.type === "HashMap") {
            // Check if any argument is a dot accessor (e.g., .a, .b)
            // If so, skip this optimization and let dot-chain form handling deal with it
            const hasDotAccessor = list.elements.slice(1).some(
              (elem) =>
                isSymbol(elem) &&
                (elem as SSymbol).name.startsWith(".") &&
                !(elem as SSymbol).name.startsWith("..."),
            );

            if (!hasDotAccessor) {
              // For hash-maps (plain objects), use the HQL get primitive
              return createList(
                createSymbol("get"),
                list.elements[0],
                ...list.elements.slice(1),
              );
            }
            // Otherwise, fall through to dot-chain form handling
          }
          // For arrays and other types, use standard indexing
          // (which is handled by the default conversion)
        }
      }

      // Handle enum declarations with explicit colon syntax: (enum Name : Type ...)
      if (
        isSymbol(list.elements[0]) &&
        (list.elements[0] as SSymbol).name === "enum" &&
        list.elements.length >= 4
      ) {
        // Check for pattern: (enum Name : Type ...)
        if (
          isSymbol(list.elements[1]) &&
          isSymbol(list.elements[2]) &&
          (list.elements[2] as SSymbol).name === ":" &&
          isSymbol(list.elements[3])
        ) {
          // Combine the name, colon and type into a single symbol
          const enumName = (list.elements[1] as SSymbol).name;
          const typeName = (list.elements[3] as SSymbol).name;
          const combinedName = createSymbol(`${enumName}:${typeName}`);

          // Create a new list with the combined name
          return {
            type: "list",
            elements: [
              list.elements[0], // enum keyword
              combinedName, // Name:Type
              ...list.elements.slice(4).map((elem) =>
                transformNode(elem, enumDefinitions, logger)
              ),
            ],
          };
        }
      }

      // Handle equality comparisons with enums - this is high priority to catch all cases
      if (
        list.elements.length >= 3 &&
        isSymbol(list.elements[0]) &&
        (list.elements[0] as SSymbol).name === "="
      ) {
        return transformEqualityExpression(list, enumDefinitions, logger);
      }

      // Normalize spaceless dot chains before checking for dot-chain form
      // This allows (text.trim.toUpperCase) to work the same as (text .trim .toUpperCase)
      const normalizedList = normalizeSpacelessDotChain(list);

      // Check if this is a dot-chain method invocation form
      if (isDotChainForm(normalizedList)) {
        return transformDotChainForm(normalizedList, enumDefinitions, logger);
      }

      // Process standard list with recursion on elements
      const first = normalizedList.elements[0];
      if (!isSymbol(first)) {
        // If the first element isn't a symbol, recursively transform its children
        return {
          ...normalizedList,
          elements: normalizedList.elements.map((elem) =>
            transformNode(elem, enumDefinitions, logger)
          ),
        };
      }

      // Get the operation name
      const op = (first as SSymbol).name;

      // Handle specific syntactic transformations
      switch (op) {
        case "fn":
          return transformFnSyntax(normalizedList, enumDefinitions, logger);
        // Handle macro specially to fix parameter list parsing
        case "macro":
          return transformMacro(normalizedList, enumDefinitions, logger);
        // Handle special forms that might contain enum comparisons
        case "if":
        case "cond":
        case "when":
        case "unless":
          return transformSpecialForm(normalizedList, enumDefinitions, logger);
        // Enhanced let/var handling with better error reporting
        case "let":
        case "var":
          return transformLetExpr(normalizedList, enumDefinitions, logger);
        default:
          // Recursively transform elements for non-special forms
          return {
            ...normalizedList,
            elements: normalizedList.elements.map((elem) =>
              transformNode(elem, enumDefinitions, logger)
            ),
          };
      }
    },
    "transformNode",
    TransformError,
    withSourceLocationOpts({ phase: "syntax transformation" }, node),
  );
}

/**
 * Transform a macro expression with enhanced error checking
 */
function transformMacro(
  list: SList,
  enumDefinitions: Map<string, SList>,
  logger: Logger,
): SExp {
  // macro needs at least: (macro name params body)
  if (list.elements.length < 4) {
    return list; // Let macro.ts handle the error
  }

  const transformedElements: SExp[] = [
    list.elements[0], // macro keyword
    list.elements[1], // macro name
  ];

  // Handle parameter list - strip vector notation if present
  if (isList(list.elements[2])) {
    let paramList = list.elements[2] as SList;
    // If parsed as (vector x y z), strip the vector part
    if (
      paramList.elements.length > 0 &&
      isSymbol(paramList.elements[0]) &&
      (paramList.elements[0] as SSymbol).name === VECTOR_SYMBOL
    ) {
      paramList = {
        ...paramList,
        elements: paramList.elements.slice(1),
      } as SList;
    } // Also handle empty-array case: [] is parsed as (empty-array)
    else if (
      paramList.elements.length === 1 &&
      isSymbol(paramList.elements[0]) &&
      (paramList.elements[0] as SSymbol).name === EMPTY_ARRAY_SYMBOL
    ) {
      paramList = {
        ...paramList,
        elements: [],
      } as SList;
    }
    transformedElements.push(paramList);
  } else {
    transformedElements.push(list.elements[2]);
  }

  // Transform the body
  for (let i = 3; i < list.elements.length; i++) {
    transformedElements.push(
      transformNode(list.elements[i], enumDefinitions, logger),
    );
  }

  return {
    ...list,
    elements: transformedElements,
  };
}

/**
 * Transform let expression with better error handling
 */
function transformLetExpr(
  list: SList,
  enumDefinitions: Map<string, SList>,
  logger: Logger,
): SExp {
  try {
    // Two valid forms:
    // 1. (let name value)
    // 2. (let (pair1 pair2...) body...)

    // Check for global binding form with value
    if (list.elements.length === 3 && isSymbol(list.elements[1])) {
      // (let name value) form
      return {
        ...list,
        elements: [
          list.elements[0],
          list.elements[1],
          transformNode(list.elements[2], enumDefinitions, logger),
        ],
      };
    }

    // Check for field declaration without value: (var name)
    // Used in class field declarations
    if (list.elements.length === 2 && isSymbol(list.elements[1])) {
      // (var name) form - no transformation needed
      return list;
    }

    // Check for local binding form with binding vector or hash-map
    if (list.elements.length >= 2 && isList(list.elements[1])) {
      let bindingList = list.elements[1] as SList;

      // Track if this was originally vector syntax [...] or hash-map syntax {...}
      // Only these syntaxes should be treated as destructuring patterns!
      const hadVectorPrefix = bindingList.elements.length > 0 &&
        isSymbol(bindingList.elements[0]) &&
        ((bindingList.elements[0] as SSymbol).name === VECTOR_SYMBOL ||
          (bindingList.elements[0] as SSymbol).name === EMPTY_ARRAY_SYMBOL);

      const hadHashMapPrefix = bindingList.elements.length > 0 &&
        isSymbol(bindingList.elements[0]) &&
        (bindingList.elements[0] as SSymbol).name === "hash-map";

      // Handle vector notation: [x 10 y 20] is parsed as (vector x 10 y 20)
      // Skip the "vector" symbol if present
      // Note: For hash-map, we keep the symbol because couldBePattern expects it
      if (hadVectorPrefix) {
        bindingList = {
          ...bindingList,
          elements: bindingList.elements.slice(1),
        } as SList;
      }

      // Check if this is a destructuring pattern
      // Only treat as pattern if it came from vector syntax [...] or hash-map syntax {...}
      const isPattern = (hadVectorPrefix || hadHashMapPrefix) &&
        couldBePattern(bindingList);

      // Validate that binding list has even number of elements (only for multi-binding forms)
      // Empty bindings and patterns are allowed
      if (
        !isPattern && bindingList.elements.length > 0 &&
        bindingList.elements.length % 2 !== 0
      ) {
        const errorLoc = getLocationFromNode(bindingList);
        throw new TransformError(
          "Let binding list must contain an even number of forms (pairs of name and value)",
          "let binding list validation",
          withSourceLocationOpts(errorLoc, bindingList),
        );
      }

      if (isPattern) {
        // Destructuring pattern form: (let [pattern] value [body...])
        // Don't process as multi-binding - just transform the value and body
        const transformedValue = transformNode(
          list.elements[2],
          enumDefinitions,
          logger,
        );
        const transformedBody = list.elements.slice(3).map((expr) =>
          transformNode(expr, enumDefinitions, logger)
        );

        return {
          ...list,
          elements: [
            list.elements[0], // 'let' symbol
            list.elements[1], // pattern (KEEP vector prefix for binding.ts!)
            transformedValue, // transformed value
            ...transformedBody, // transformed body expressions
          ],
        };
      } else {
        // Multi-binding form: (let (x 1 y 2) body)
        // Transform the binding values and body expressions
        const transformedBindings = transformBindingList(
          bindingList,
          enumDefinitions,
          logger,
        );
        const transformedBody = list.elements.slice(2).map((expr) =>
          transformNode(expr, enumDefinitions, logger)
        );

        return {
          ...list,
          elements: [
            list.elements[0], // 'let' symbol
            transformedBindings, // transformed binding list
            ...transformedBody, // transformed body expressions
          ],
        };
      }
    }

    // Invalid let form
    const errorLoc = getLocationFromNode(list);
    throw new TransformError(
      "Invalid let form. Expected either (let name value) or (let (bindings...) body...)",
      "let form validation",
      withSourceLocationOpts(errorLoc, list),
    );
  } catch (error) {
    if (error instanceof TransformError) {
      throw error;
    }

    // Convert regular error to TransformError with location info
    const errorLoc = getLocationFromNode(list);
    throw new TransformError(
      `Invalid let form: ${getErrorMessage(error)}`,
      "let form validation",
      withSourceLocationOpts(errorLoc, list),
    );
  }
}

/**
 * Transform a binding list in a let expression
 */
function transformBindingList(
  bindingList: SList,
  enumDefinitions: Map<string, SList>,
  logger: Logger,
): SList {
  const transformedBindings: SExp[] = [];

  // Handle vector notation: skip "vector" symbol if present
  let elements = bindingList.elements;
  if (
    elements.length > 0 &&
    isSymbol(elements[0]) &&
    (elements[0] as SSymbol).name === VECTOR_SYMBOL
  ) {
    elements = elements.slice(1);
  }

  for (let i = 0; i < elements.length; i += 2) {
    // Keep the binding name unchanged
    transformedBindings.push(elements[i]);

    // Transform the binding value
    const value = elements[i + 1];
    transformedBindings.push(transformNode(value, enumDefinitions, logger));
  }

  return {
    ...bindingList,
    elements: transformedBindings,
  };
}

/**
 * Transform a dot notation symbol (.caseName) to a fully-qualified enum reference
 */
function transformDotNotationSymbol(
  symbol: SSymbol,
  enumDefinitions: Map<string, SList>,
  logger: Logger,
): SExp {
  const caseName = symbol.name.substring(1); // Remove the dot

  // Find an enum that has this case name
  for (const [enumName, enumDef] of enumDefinitions.entries()) {
    if (hasCaseNamed(enumDef, caseName)) {
      logger.debug(
        `Transformed dot notation .${caseName} to ${enumName}.${caseName}`,
      );
      return createSymbol(`${enumName}.${caseName}`);
    }
  }

  // If we can't resolve the enum, keep it as is
  logger.debug(`Could not resolve enum for dot notation: ${symbol.name}`);
  return symbol;
}

function transformEqualityExpression(
  list: SList,
  enumDefinitions: Map<string, SList>,
  logger: Logger,
): SExp {
  // Only process equality expressions with at least 3 elements (=, left, right)
  if (list.elements.length < 3) {
    return {
      ...list,
      elements: list.elements.map((elem) =>
        transformNode(elem, enumDefinitions, logger)
      ),
    };
  }

  const leftExpr = list.elements[1];
  const rightExpr = list.elements[2];

  // Looking for patterns like: (= os .macOS) or (= .macOS os)
  let dotExpr = null;
  let otherExpr = null;

  // Check if either side is a dot expression
  if (isSymbol(leftExpr) && (leftExpr as SSymbol).name.startsWith(".")) {
    dotExpr = leftExpr as SSymbol;
    otherExpr = rightExpr;
  } else if (
    isSymbol(rightExpr) && (rightExpr as SSymbol).name.startsWith(".")
  ) {
    dotExpr = rightExpr as SSymbol;
    otherExpr = leftExpr;
  }

  // If we found a dot expression, transform it
  if (dotExpr) {
    const caseName = dotExpr.name.substring(1); // Remove the dot

    // Find an enum that has this case
    for (const [enumName, enumDef] of enumDefinitions.entries()) {
      if (hasCaseNamed(enumDef, caseName)) {
        // Replace the dot expression with the full enum reference
        const fullEnumRef = createSymbol(`${enumName}.${caseName}`);
        logger.debug(
          `Transformed ${dotExpr.name} to ${enumName}.${caseName} in equality expression`,
        );

        // Create the transformed list with the full enum reference
        if (dotExpr === leftExpr) {
          return createList(
            list.elements[0], // Keep the operator (=)
            fullEnumRef, // Replace with full enum reference
            transformNode(otherExpr, enumDefinitions, logger), // Transform the other expression
          );
        } else {
          return createList(
            list.elements[0], // Keep the operator (=)
            transformNode(otherExpr, enumDefinitions, logger), // Transform the other expression
            fullEnumRef, // Replace with full enum reference
          );
        }
      }
    }
  }

  // If no dot expression found or no matching enum, transform all elements normally
  return {
    ...list,
    elements: list.elements.map((elem) =>
      transformNode(elem, enumDefinitions, logger)
    ),
  };
}

/**
 * Transform special forms that might contain enum comparisons
 */
function transformSpecialForm(
  list: SList,
  enumDefinitions: Map<string, SList>,
  logger: Logger,
): SExp {
  const op = (list.elements[0] as SSymbol).name;

  // Create a new list with the same operation name
  const transformed: SExp[] = [list.elements[0]];

  // Handle each form differently based on its structure
  switch (op) {
    case "=":
    case "==":
      // Special handling for equality expressions
      return transformEqualityExpression(list, enumDefinitions, logger);

    case "!=":
      // Handle inequality - just transform all arguments
      list.elements.slice(1).forEach((elem) => {
        transformed.push(transformNode(elem, enumDefinitions, logger));
      });
      break;

    case "if":
      // Structure: (if test then else?)
      if (list.elements.length >= 3) {
        // Transform the test expression (which might be an equality check)
        transformed.push(
          transformNode(list.elements[1], enumDefinitions, logger),
        );
        // Transform the 'then' expression
        transformed.push(
          transformNode(list.elements[2], enumDefinitions, logger),
        );
        // Transform the 'else' expression if it exists
        if (list.elements.length > 3) {
          transformed.push(
            transformNode(list.elements[3], enumDefinitions, logger),
          );
        }
      } else {
        // Just transform all elements without special handling
        list.elements.slice(1).forEach((elem) => {
          transformed.push(transformNode(elem, enumDefinitions, logger));
        });
      }
      break;

    case "cond":
      // Structure: (cond (test1 result1) (test2 result2) ... (else resultN))
      for (let i = 1; i < list.elements.length; i++) {
        const clause = list.elements[i];
        if (isList(clause)) {
          // Transform each clause as a list
          const clauseList = clause as SList;
          const transformedClause = transformNode(
            clauseList,
            enumDefinitions,
            logger,
          );
          transformed.push(transformedClause);
        } else {
          // If not a list, just transform the element
          transformed.push(transformNode(clause, enumDefinitions, logger));
        }
      }
      break;

    case "when":
    case "unless":
      // Structure: (when/unless test body...)
      if (list.elements.length >= 2) {
        // Transform the test expression
        transformed.push(
          transformNode(list.elements[1], enumDefinitions, logger),
        );
        // Transform each body expression
        for (let i = 2; i < list.elements.length; i++) {
          transformed.push(
            transformNode(list.elements[i], enumDefinitions, logger),
          );
        }
      } else {
        // Just transform all elements without special handling
        list.elements.slice(1).forEach((elem) => {
          transformed.push(transformNode(elem, enumDefinitions, logger));
        });
      }
      break;

    default:
      // For any other special form, just transform all elements
      list.elements.slice(1).forEach((elem) => {
        transformed.push(transformNode(elem, enumDefinitions, logger));
      });
  }

  // Use createListFrom to preserve source location through transformation
  return createListFrom(list, transformed);
}

/**
 * Normalize spaceless dot chains to spaced form for uniform processing.
 *
 * Transforms: (text.trim.toUpperCase)
 * Into:       (text .trim .toUpperCase)
 *
 * Only normalizes the first element - arguments remain unchanged.
 * This preserves property access in args: (arr.map user.name) stays valid.
 *
 * @param list - The list to potentially normalize
 * @returns Normalized list or original list if no normalization needed
 */
function normalizeSpacelessDotChain(list: SList): SList {
  if (list.elements.length === 0) return list;

  const first = list.elements[0];
  if (!isSymbol(first)) return list;

  const name = (first as SSymbol).name;

  // Don't normalize these special cases:
  // 1. Already starts with dot: (.push arr 42)
  // 2. JS import: (js/console.log "hi")
  // 3. No dots present: (arr push 42)
  // 4. Contains optional chaining (?.): (obj?.greet "World") - handled separately
  if (name.startsWith('.') || name.startsWith('js/') || !name.includes('.') || name.includes('?.')) {
    return list;
  }

  // Split on dots and filter empty parts (handles consecutive dots like obj..method)
  const parts = name.split('.').filter(p => p.length > 0);

  // If no actual segments after filtering, return unchanged
  if (parts.length <= 1) return list;

  // Check if first part is numeric - don't normalize
  // Prevents (42.map) from becoming (42 .map) which is semantically wrong
  if (NUMERIC_STRING_REGEX.test(parts[0])) {
    return list;
  }

  // Build new element list: [obj, .method1, .method2, ...original args]
  // Copy _meta from the original symbol to preserve source location for error mapping
  const originalMeta = (first as SSymbol)._meta;
  const copyMetaToSymbol = (sym: SSymbol): SSymbol => {
    if (originalMeta) {
      return { ...sym, _meta: { ...originalMeta } };
    }
    return sym;
  };

  const newElements: SExp[] = [
    copyMetaToSymbol(createSymbol(parts[0])),                             // "text"
    ...parts.slice(1).map(p => copyMetaToSymbol(createSymbol('.' + p))),  // ".trim", ".toUpperCase"
    ...list.elements.slice(1)                                              // Keep all arguments unchanged
  ];

  // Use createListFrom to preserve source location through transformation
  return createListFrom(list, newElements);
}

/**
 * Check if a list appears to be in dot-chain form
 * The first element should not be a method (doesn't start with .)
 * And there should be at least one method (element starting with .) elsewhere in the list
 */
function isDotChainForm(list: SList): boolean {
  if (list.elements.length <= 1) {
    return false;
  }

  // First element shouldn't be a method
  const firstIsNotMethod = !isSymbol(list.elements[0]) ||
    !(list.elements[0] as SSymbol).name.startsWith(".");

  // Exclude threading macros from being treated as dot-chain base objects.
  // Threading macros follow Clojure naming conventions:
  // - Base forms: -> and ->>
  // - Variants end with ->: as->, some->, cond->, my->, custom->, etc.
  // This precise pattern avoids false positives for variables like 'user->data' (-> in middle).
  if (isSymbol(list.elements[0])) {
    const symbolName = (list.elements[0] as SSymbol).name;
    const isThreadingMacro =
      symbolName === "->" ||
      symbolName === "->>" ||
      symbolName.endsWith("->");
    if (isThreadingMacro) {
      return false;
    }
  }

  // Check for at least one method in the rest of the list
  // Exclude spread operators (...identifier) from being treated as methods
  const hasMethodInRest = list.elements.slice(1).some((elem) =>
    isSymbol(elem) && (elem as SSymbol).name.startsWith(".") && !(elem as SSymbol).name.startsWith("...")
  );

  return firstIsNotMethod && hasMethodInRest;
}

/**
 * Transform a dot-chain form into proper nested method calls
 * Example: (obj .method1 arg1 .method2 arg2) becomes proper nested js-call expressions
 */
function transformDotChainForm(
  list: SList,
  enumDefinitions: Map<string, SList>,
  logger: Logger,
): SExp {
  return perform(
    () => {
      logger.debug("Transforming dot-chain form");

      // Start with the base object
      let result = transformNode(list.elements[0], enumDefinitions, logger);

      // Group methods and their arguments
      const methodGroups = [];
      let currentMethod = null;
      let currentArgs = [];

      for (let i = 1; i < list.elements.length; i++) {
        const element = list.elements[i];

        // Check if this is a method/property indicator (symbol starting with '.' but NOT '...')
        // Exclude spread operators (...identifier)
        if (isSymbol(element) && (element as SymbolNode).name.startsWith(".") && !(element as SymbolNode).name.startsWith("...")) {
          // If we have a previous method, store it
          if (currentMethod !== null) {
            methodGroups.push({
              method: currentMethod,
              args: currentArgs,
            });
            // Reset for next method
            currentArgs = [];
          }

          // Set current method
          currentMethod = element as SymbolNode;
        } // If not a method indicator, it's an argument to the current method
        else if (currentMethod !== null) {
          // Transform the argument recursively
          const transformedArg = transformNode(
            element,
            enumDefinitions,
            logger,
          );
          currentArgs.push(transformedArg);
        }
      }

      // Add the last method group if there is one
      if (currentMethod !== null) {
        methodGroups.push({
          method: currentMethod,
          args: currentArgs,
        });
      }

      // Build the nested method calls from inside out
      // Preserve _meta from method symbols for accurate error source mapping
      for (let i = 0; i < methodGroups.length; i++) {
        const { method, args } = methodGroups[i];
        const methodName = (method as SymbolNode).name;
        const methodNameWithoutDot = methodName.substring(1);

        // Determine how to handle this dot-chain element
        if (args.length > 0) {
          // Has arguments - definitely a method call
          // Use createListFrom with method as source to preserve _meta
          result = createListFrom(method as SExp, [
            createSymbol("method-call"),
            result,
            createLiteral(methodNameWithoutDot),
            ...args,
          ]);
        } else if (i < methodGroups.length - 1) {
          // No arguments but not the last in chain - treat as a JS method with runtime check
          result = createListFrom(method as SExp, [
            createSymbol("js-method"),
            result,
            createLiteral(methodNameWithoutDot),
          ]);
        } else {
          // No arguments and last in chain - could be property or no-arg method
          // Use js-method for property access semantics
          // Note: (p.greet) syntax (dotted symbol) is handled separately in
          // transformDotNotation (js-interop.ts) which creates a method call
          result = createListFrom(method as SExp, [
            createSymbol("js-method"),
            result,
            createLiteral(methodNameWithoutDot),
          ]);
        }
      }

      return result;
    },
    "transformDotChainForm",
    TransformError,
    withSourceLocationOpts({ phase: "dot-chain form transformation" }, list),
  );
}

/**
 * Transform fn function syntax
 * Example: (fn add [x = 100 y = 200] (+ x y))
 */
function transformFnSyntax(
  list: SList,
  enumDefinitions: Map<string, SList>,
  logger: Logger,
): SExp {
  return perform(
    () => {
      logger.debug("Transforming fn syntax");

      // Validate minimum syntax - fn needs at least params and body
      if (list.elements.length < 2) {
        throw new TransformError(
          "Invalid fn syntax: requires at least parameters and body",
          "fn syntax transformation",
          withSourceLocationOpts({ phase: "valid fn form" }, list),
        );
      }

      const secondElement = list.elements[1];

      // Dispatch based on whether this is named or anonymous
      if (isSymbol(secondElement)) {
        // Named function: (fn name [params] body...)
        return transformNamedFnSyntax(list, enumDefinitions, logger);
      } else if (isList(secondElement)) {
        // Anonymous function: (fn [params] body...)
        return transformAnonymousFnSyntax(list, enumDefinitions, logger);
      } else {
        throw new TransformError(
          "Invalid fn syntax: second element must be function name (symbol) or parameters (list)",
          "fn syntax",
          withSourceLocationOpts({ phase: "fn dispatch" }, list),
        );
      }
    },
    "transformFnSyntax",
    TransformError,
    withSourceLocationOpts({ phase: "fn syntax transformation" }, list),
  );
}

/**
 * Transform named fn syntax: (fn name [params] body...)
 */
function transformNamedFnSyntax(
  list: SList,
  enumDefinitions: Map<string, SList>,
  logger: Logger,
): SExp {
  if (list.elements.length < 4) {
    throw new TransformError(
      "Function definition is missing body expression.\n\n" +
      "Named functions require: (fn name [params] body-expression)\n" +
      "Example: (fn add [x y] (+ x y))\n" +
      "Example: (fn double {x: 10} (* x 2))",
      "named fn syntax",
      withSourceLocationOpts({ phase: "valid named fn form" }, list),
    );
  }

  const name = list.elements[1];
  const paramsList = list.elements[2] as SList;

  // Validate the name
  if (!isSymbol(name)) {
    throw new TransformError(
      "Invalid fn syntax: function name must be a symbol",
      "fn name",
      withSourceLocationOpts({ phase: "symbol" }, name),
    );
  }

  // Validate parameter list
  if (paramsList.type !== "list") {
    throw new TransformError(
      "Invalid fn syntax: parameter list must be a list",
      "fn parameter list",
      withSourceLocationOpts({ phase: "list" }, paramsList),
    );
  }

  // Transform the parameter list elements
  const transformedParams = paramsList.elements.map((param) =>
    transformNode(param, enumDefinitions, logger)
  );

  // Extract the body expressions (start at index 3, after name and params)
  const body = list.elements.slice(3).map((elem) =>
    transformNode(elem, enumDefinitions, logger)
  );

  // Return simple fn form (no return type)
  return createList(
    createSymbol("fn"),
    name,
    createList(...transformedParams),
    ...body,
  );
}

/**
 * Transform anonymous fn syntax: (fn [params] body...)
 */
function transformAnonymousFnSyntax(
  list: SList,
  enumDefinitions: Map<string, SList>,
  logger: Logger,
): SExp {
  if (list.elements.length < 3) {
    throw new TransformError(
      "Function definition is missing body expression.\n\n" +
      "Anonymous functions require: (fn [params] body-expression)\n" +
      "Example: (fn [x y] (+ x y))\n" +
      "Example: (fn {x: 10} (* x 2))",
      "anonymous fn syntax",
      withSourceLocationOpts({ phase: "valid anonymous fn form" }, list),
    );
  }

  const paramsList = list.elements[1] as SList;

  // Validate parameter list
  if (!isList(paramsList)) {
    throw new TransformError(
      "Invalid fn syntax: parameter list must be a list",
      "fn parameter list",
      withSourceLocationOpts({ phase: "list" }, paramsList),
    );
  }

  // Transform the parameter list elements
  const transformedParams = paramsList.elements.map((param) =>
    transformNode(param, enumDefinitions, logger)
  );

  // Extract and transform body expressions (start at index 2, after params)
  const body = list.elements.slice(2).map((elem) =>
    transformNode(elem, enumDefinitions, logger)
  );

  // Return anonymous function form (no name)
  return createList(
    createSymbol("fn"),
    createList(...transformedParams),
    ...body,
  );
}

/**
 * Check if an enum has a case with the given name
 */
function hasCaseNamed(enumDef: ListNode, caseName: string): boolean {
  for (let i = 2; i < enumDef.elements.length; i++) {
    const element = enumDef.elements[i];
    if (element.type === "list") {
      const caseList = element as ListNode;
      if (
        caseList.elements.length >= 2 &&
        caseList.elements[0].type === "symbol" &&
        (caseList.elements[0] as SymbolNode).name === "case" &&
        caseList.elements[1].type === "symbol" &&
        (caseList.elements[1] as SymbolNode).name === caseName
      ) {
        return true;
      }
    }
  }
  return false;
}