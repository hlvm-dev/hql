// src/hql/transpiler/syntax/class.ts
// Module for handling class declarations and related operations

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode, LiteralNode, SymbolNode } from "../type/hql_ast.ts";
import {
  HQLError,
  perform,
  TransformError,
  ValidationError,
} from "../../../common/error.ts";
import { getErrorMessage, sanitizeIdentifier } from "../../../common/utils.ts";
import { extractAndNormalizeType, splitTypeParameters } from "../tokenizer/type-tokenizer.ts";
import {
  transformElements,
  transformNonNullElements,
  validateTransformed,
} from "../utils/validation-helpers.ts";
import { copyPosition } from "../pipeline/hql-ast-to-hql-ir.ts";
import { globalLogger as logger } from "../../../logger.ts";
import { extractMetaSourceLocation, withSourceLocationOpts } from "../utils/source_location_utils.ts";
import {
  parseJsonMapParameters,
  parseParametersWithDefaults,
  GENERIC_NAME_REGEX,
} from "./function.ts";
import {
  HASH_MAP_INTERNAL,
  HASH_MAP_USER,
  VECTOR_SYMBOL,
  EMPTY_ARRAY_SYMBOL,
} from "../../../common/runtime-helper-impl.ts";

interface MemberExpressionOptions {
  guard?: boolean;
}


type TransformNodeFn = (node: HQLNode, dir: string) => IR.IRNode | null;

// Pre-compiled regex patterns for hot paths (avoid compilation per call)
/** Matches non-identifier characters that require computed property access */
const SPECIAL_CHAR_REGEX = /[^a-zA-Z0-9_$]/;
// GENERIC_NAME_REGEX imported from function.ts (single source of truth)

/**
 * Check if an IR node needs to be wrapped in an ExpressionStatement.
 * Expressions that are not statements need wrapping when used in block bodies.
 */
function needsExpressionWrapper(node: IR.IRNode): boolean {
  return (
    node.type === IR.IRNodeType.AssignmentExpression ||
    node.type === IR.IRNodeType.CallExpression ||
    node.type === IR.IRNodeType.BinaryExpression ||
    node.type === IR.IRNodeType.UnaryExpression
  );
}

/**
 * Wrap an IR node in an ExpressionStatement if needed.
 * Returns the node as-is if it's already a statement.
 */
function wrapIfNeeded(node: IR.IRNode): IR.IRNode {
  if (needsExpressionWrapper(node)) {
    return {
      type: IR.IRNodeType.ExpressionStatement,
      expression: node,
    } as IR.IRExpressionStatement;
  }
  return node;
}

/**
 * Transform a list of HQL nodes to IR statements, wrapping expressions as needed.
 */
function transformToStatements(
  nodes: HQLNode[],
  transformNode: (node: HQLNode, dir: string) => IR.IRNode | null,
  currentDir: string,
): IR.IRNode[] {
  const statements: IR.IRNode[] = [];
  for (const node of nodes) {
    const transformed = transformNode(node, currentDir);
    if (transformed) {
      statements.push(wrapIfNeeded(transformed));
    }
  }
  return statements;
}

/**
 * Transform a class declaration to IR
 */
export function transformClass(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode {
  try {
    // Validate class syntax
    if (list.elements.length < 2) {
      throw new ValidationError(
        "class requires a name and body elements",
        "class definition",
        "name and body",
        { actualType: `${list.elements.length - 1} arguments`, ...extractMetaSourceLocation(list) },
      );
    }

    // Extract class name
    const nameNode = list.elements[1];
    if (nameNode.type !== "symbol") {
      throw new ValidationError(
        "Class name must be a symbol",
        "class name",
        "symbol",
        { actualType: nameNode.type, ...extractMetaSourceLocation(nameNode) },
      );
    }
    let className = (nameNode as SymbolNode).name;

    // Extract generic type parameters from class name (e.g., "Box<T>" -> name="Box", typeParameters=["T"])
    // Use depth-aware splitTypeParameters to correctly handle nested generics like Box<Record<string,number>,Array<T>>
    let typeParameters: string[] | undefined;
    const nameParts = className.match(GENERIC_NAME_REGEX);
    if (nameParts) {
      className = nameParts[1];
      if (nameParts[2]) {
        // Use splitTypeParameters instead of naive split(",") to handle nested types correctly
        typeParameters = splitTypeParameters(nameParts[2]);
      }
    }

    // Process class body elements
    const bodyElements = list.elements.slice(2);

    // Extract fields, constructor, and methods
    const fields: IR.IRClassField[] = [];
    let classConstructor: IR.IRClassConstructor | null = null;
    const methods: IR.IRClassMethod[] = [];

    // Process each class body element
    for (const element of bodyElements) {
      if (element.type !== "list") {
        throw new ValidationError(
          "Class body elements must be lists",
          "class body",
          "list",
          element.type,
        );
      }

      const elementList = element as ListNode;
      if (elementList.elements.length === 0) continue;

      const firstElement = elementList.elements[0];
      if (firstElement.type !== "symbol") continue;

      const elementType = (firstElement as SymbolNode).name;

      // Process private field shorthand: (#fieldName value)
      if (elementType.startsWith("#")) {
        const field = processPrivateField(
          elementList,
          currentDir,
          transformNode,
        );
        if (field) {
          fields.push(field);
        }
      } // Process field declarations (var, let, and const)
      else if (elementType === "var" || elementType === "let" || elementType === "const") {
        const field = processClassField(
          elementList,
          currentDir,
          transformNode,
          elementType,
        );
        if (field) {
          fields.push(field);
        }
      } // Process constructor
      else if (elementType === "constructor") {
        classConstructor = processClassConstructor(
          elementList,
          currentDir,
          transformNode,
        );
      } // Process fn method definitions
      else if (elementType === "fn") {
        const method = processClassMethodFn(
          elementList,
          currentDir,
          transformNode,
        );
        if (method) {
          methods.push(method);
        }
      } // Process static members: (static var name value) or (static fn name ...)
      else if (elementType === "static") {
        if (elementList.elements.length < 2) {
          throw new ValidationError(
            "static requires a member definition",
            "static member",
            "var, let, const, or fn",
            { actualType: "incomplete", ...extractMetaSourceLocation(elementList) },
          );
        }

        const staticContent = elementList.elements[1];
        if (staticContent.type !== "symbol") {
          throw new ValidationError(
            "static member type must be var, let, const, or fn",
            "static member",
            "var, let, const, or fn",
            { actualType: staticContent.type, ...extractMetaSourceLocation(staticContent) },
          );
        }

        const innerType = (staticContent as SymbolNode).name;

        if (innerType === "var" || innerType === "let" || innerType === "const") {
          // (static var/let/const name value)
          // Create a pseudo list without "static" for field processing
          const fieldList: ListNode = {
            ...elementList,
            elements: elementList.elements.slice(1), // Remove "static"
          };
          const field = processClassField(
            fieldList,
            currentDir,
            transformNode,
            innerType,
          );
          if (field) {
            field.isStatic = true;
            fields.push(field);
          }
        } else if (innerType === "fn") {
          // (static fn name [...] body)
          // Create a pseudo list without "static" for method processing
          const methodList: ListNode = {
            ...elementList,
            elements: elementList.elements.slice(1), // Remove "static"
          };
          const method = processClassMethodFn(
            methodList,
            currentDir,
            transformNode,
          );
          if (method) {
            method.isStatic = true;
            methods.push(method);
          }
        } else {
          throw new ValidationError(
            "static member type must be var, let, const, or fn",
            "static member",
            "var, let, const, or fn",
            { actualType: innerType, ...extractMetaSourceLocation(staticContent) },
          );
        }
      } // Process getter: (getter name [] body) - uses "getter" to avoid conflicts
      else if (elementType === "getter") {
        const getter = processClassAccessor(
          elementList,
          "get",
          currentDir,
          transformNode,
        );
        if (getter) {
          methods.push(getter);
        }
      } // Process setter: (setter name [param] body) - uses "setter" to avoid macro conflict
      else if (elementType === "setter") {
        const setter = processClassAccessor(
          elementList,
          "set",
          currentDir,
          transformNode,
        );
        if (setter) {
          methods.push(setter);
        }
      }
    }

    // Create the ClassDeclaration IR node
    const classId: IR.IRIdentifier = {
      type: IR.IRNodeType.Identifier,
      name: sanitizeIdentifier(className),
    };
    copyPosition(nameNode, classId);

    return {
      type: IR.IRNodeType.ClassDeclaration,
      id: classId,
      fields,
      constructor: classConstructor,
      methods,
      typeParameters, // TypeScript generic type parameters (e.g., ["T", "K"])
    } as IR.IRClassDeclaration;
  } catch (error) {
    // Preserve HQLError instances (ValidationError, ParseError, etc.)
    if (error instanceof HQLError) {
      throw error;
    }
    throw new TransformError(
      `Failed to transform class declaration: ${
        getErrorMessage(error)
      }`,
      "class declaration",
      withSourceLocationOpts({ phase: "transformation" }, list),
    );
  }
}

/**
 * Transform a method call to a member method.
 */
export function transformMethodCall(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode {
  return perform(
    () => {
      if (list.elements.length < 3) {
        throw new ValidationError(
          "method-call requires at least an object and method name",
          "method-call",
          "at least 2 arguments",
          `${list.elements.length - 1} arguments`,
        );
      }

      const object = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "method-call",
        "Object",
      );

      let methodName: string;

      // Store the method specification element for type checking (fixes TypeScript narrowing)
      const methodSpec = list.elements[2];
      const methodSpecType = methodSpec.type;

      if (methodSpecType === "literal") {
        methodName = String((methodSpec as LiteralNode).value);
      } else if (methodSpecType === "symbol") {
        methodName = (methodSpec as SymbolNode).name;
      } else {
        throw new ValidationError(
          "Method name must be a string literal or symbol",
          "method-call",
          "string literal or symbol",
          methodSpecType,
        );
      }

      const args = transformElements(
        list.elements.slice(3),
        currentDir,
        transformNode,
        "method-call argument",
        "Argument",
      );

      return {
        type: IR.IRNodeType.CallMemberExpression,
        object,
        property: {
          type: IR.IRNodeType.StringLiteral,
          value: methodName,
        } as IR.IRStringLiteral,
        arguments: args,
      } as IR.IRCallMemberExpression;
    },
    "transformMethodCall",
    TransformError,
    [list],
  );
}

/**
 * Transform an optional method call to obj?.foo(args)
 * Handles two forms:
 * 1. Direct: (.?foo obj args...) - method name is in the operator symbol
 * 2. Normalized: (optional-method-call obj "foo" args...) - method name is a separate element
 */
export function transformOptionalMethodCall(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode {
  return perform(
    () => {
      const firstElement = list.elements[0];
      const op = firstElement.type === "symbol" ? (firstElement as SymbolNode).name : "";

      // Check if this is the direct form: (.?foo obj args...)
      if (op.startsWith(".?")) {
        if (list.elements.length < 2) {
          throw new ValidationError(
            "optional method call requires at least an object",
            "optional-method-call",
            "at least 1 argument",
            `${list.elements.length - 1} arguments`,
          );
        }

        const methodName = op.substring(2); // Remove ".?"
        const object = validateTransformed(
          transformNode(list.elements[1], currentDir),
          "optional-method-call",
          "Object",
        );

        const args = transformElements(
          list.elements.slice(2),
          currentDir,
          transformNode,
          "optional-method-call argument",
          "Argument",
        );

        // Use computed property access for method names with special characters (hyphens, etc.)
        // This generates obj?.["method-name"]() instead of obj?.method-name()
        const needsComputed = SPECIAL_CHAR_REGEX.test(methodName);

        return {
          type: IR.IRNodeType.OptionalCallExpression,
          callee: {
            type: IR.IRNodeType.OptionalMemberExpression,
            object,
            property: needsComputed
              ? {
                  type: IR.IRNodeType.StringLiteral,
                  value: methodName,
                } as IR.IRStringLiteral
              : {
                  type: IR.IRNodeType.Identifier,
                  name: methodName,
                } as IR.IRIdentifier,
            computed: needsComputed,
            optional: true,
          } as IR.IROptionalMemberExpression,
          arguments: args,
          optional: true, // Generate obj?.method?.() for full optional chaining
        } as IR.IROptionalCallExpression;
      }

      // Normalized form: (optional-method-call obj "foo" args...)
      if (list.elements.length < 3) {
        throw new ValidationError(
          "optional-method-call requires at least an object and method name",
          "optional-method-call",
          "at least 2 arguments",
          `${list.elements.length - 1} arguments`,
        );
      }

      const object = validateTransformed(
        transformNode(list.elements[1], currentDir),
        "optional-method-call",
        "Object",
      );

      let methodName: string;
      const methodSpec = list.elements[2];
      const methodSpecType = methodSpec.type;

      if (methodSpecType === "literal") {
        methodName = String((methodSpec as LiteralNode).value);
      } else if (methodSpecType === "symbol") {
        methodName = (methodSpec as SymbolNode).name;
      } else {
        throw new ValidationError(
          "Method name must be a string literal or symbol",
          "optional-method-call",
          "string literal or symbol",
          methodSpecType,
        );
      }

      const args = transformElements(
        list.elements.slice(3),
        currentDir,
        transformNode,
        "optional-method-call argument",
        "Argument",
      );

      // Use computed property access for method names with special characters (hyphens, etc.)
      const needsComputed = SPECIAL_CHAR_REGEX.test(methodName);

      return {
        type: IR.IRNodeType.OptionalCallExpression,
        callee: {
          type: IR.IRNodeType.OptionalMemberExpression,
          object,
          property: needsComputed
            ? {
                type: IR.IRNodeType.StringLiteral,
                value: methodName,
              } as IR.IRStringLiteral
            : {
                type: IR.IRNodeType.Identifier,
                name: methodName,
              } as IR.IRIdentifier,
          computed: needsComputed,
          optional: true,
        } as IR.IROptionalMemberExpression,
        arguments: args,
        optional: true, // Generate obj?.method?.() for full optional chaining
      } as IR.IROptionalCallExpression;
    },
    "transformOptionalMethodCall",
    TransformError,
    [list],
  );
}

function parseClassMethodParameters(
  paramsNode: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): {
  params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[];
  defaults: Map<string, IR.IRNode>;
  hasJsonParams: boolean;
} {
  let paramsList = paramsNode;

  // Check for empty-array (empty brackets [])
  if (
    paramsList.elements.length === 1 &&
    paramsList.elements[0].type === "symbol" &&
    (paramsList.elements[0] as SymbolNode).name === EMPTY_ARRAY_SYMBOL
  ) {
    return { params: [], defaults: new Map(), hasJsonParams: false };
  }

  // Check for hash-map (JSON map parameters)
  if (
    paramsList.elements.length > 0 &&
    paramsList.elements[0].type === "symbol" &&
    ((paramsList.elements[0] as SymbolNode).name === HASH_MAP_USER ||
      (paramsList.elements[0] as SymbolNode).name === HASH_MAP_INTERNAL)
  ) {
    const { params, defaults } = parseJsonMapParameters(
      paramsList,
      currentDir,
      transformNode,
    );
    return { params, defaults, hasJsonParams: true };
  }

  if (
    paramsList.elements.length > 0 &&
    paramsList.elements[0].type === "symbol" &&
    (paramsList.elements[0] as SymbolNode).name === VECTOR_SYMBOL
  ) {
    paramsList = {
      ...paramsList,
      elements: paramsList.elements.slice(1),
    } as ListNode;
  }

  const parsed = parseParametersWithDefaults(
    paramsList,
    currentDir,
    transformNode,
  );
  return { params: parsed.params, defaults: parsed.defaults, hasJsonParams: false };
}

function buildMethodDefaults(
  params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[],
  defaults: Map<string, IR.IRNode>,
): { name: string; value: IR.IRNode }[] | undefined {
  if (defaults.size === 0) return undefined;

  const entries: { name: string; value: IR.IRNode }[] = [];
  params.forEach((param) => {
    // Skip pattern parameters (they don't have defaults)
    if (IR.isPatternParam(param)) {
      return;
    }

    // It's an identifier
    const paramName = param.name;
    if (paramName.startsWith("...")) {
      return;
    }

    const candidates = new Set<string>();
    if (param.originalName) {
      candidates.add(param.originalName);
      candidates.add(sanitizeIdentifier(param.originalName));
    }
    candidates.add(paramName);

    for (const candidate of candidates) {
      if (defaults.has(candidate)) {
        entries.push({ name: paramName, value: defaults.get(candidate)! });
        return;
      }
    }
  });

  return entries.length > 0 ? entries : undefined;
}

function extractMethodBodyElements(
  elementList: ListNode,
  startIndex: number,
): { bodyElements: HQLNode[] } {
  let bodyStartIndex = startIndex;

  if (
    elementList.elements.length > bodyStartIndex &&
    elementList.elements[bodyStartIndex].type === "list"
  ) {
    const maybeReturn = elementList.elements[bodyStartIndex] as ListNode;
    if (
      maybeReturn.elements.length > 0 &&
      maybeReturn.elements[0].type === "symbol" &&
      (maybeReturn.elements[0] as SymbolNode).name === "->"
    ) {
      bodyStartIndex += 1;
    }
  }

  const bodyElements = elementList.elements.slice(bodyStartIndex);
  if (bodyElements.length === 0) {
    throw new ValidationError(
      "Method body must contain at least one expression",
      "method body",
      "one or more expressions",
      "empty",
    );
  }

  return { bodyElements };
}

/**
 * Process a class method defined with fn syntax
 */
function processClassMethodFn(
  elementList: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRClassMethod | null {
  try {
    if (elementList.elements.length < 4) {
      throw new ValidationError(
        "Method requires a name, parameters, and body",
        "method definition",
        "name, params, body",
        `${elementList.elements.length - 1} arguments`,
      );
    }

    const methodNameNode = elementList.elements[1];
    if (methodNameNode.type !== "symbol") {
      throw new ValidationError(
        "Method name must be a symbol",
        "method name",
        "symbol",
        methodNameNode.type,
      );
    }
    const methodName = (methodNameNode as SymbolNode).name;

    const paramsNode = elementList.elements[2];
    if (paramsNode.type !== "list") {
      throw new ValidationError(
        "Method parameters must be a list",
        "method params",
        "list",
        paramsNode.type,
      );
    }

    const { params, defaults, hasJsonParams } = parseClassMethodParameters(
      paramsNode as ListNode,
      currentDir,
      transformNode,
    );

    const { bodyElements } = extractMethodBodyElements(elementList, 3);

    const bodyNodes = transformNonNullElements(
      bodyElements,
      currentDir,
      transformNode,
    );

    // Methods need implicit return: last expression should be wrapped in return
    const bodyStmts = bodyNodes.map((node, i) => {
      const isLast = i === bodyNodes.length - 1;
      // If it's the last statement and not already a return, wrap it
      if (isLast && node.type !== IR.IRNodeType.ReturnStatement) {
        return {
          type: IR.IRNodeType.ReturnStatement,
          argument: node,
        } as IR.IRReturnStatement;
      }
      return node;
    });

    const method: IR.IRClassMethod = {
      type: IR.IRNodeType.ClassMethod,
      name: methodName,
      params,
      body: {
        type: IR.IRNodeType.BlockStatement,
        body: bodyStmts,
      },
      hasJsonParams,
    };

    const defaultEntries = buildMethodDefaults(params, defaults);
    if (defaultEntries) {
      method.defaults = defaultEntries;
    }

    return method;
  } catch (error) {
    logger.error(
      `Error processing class method (fn): ${
        getErrorMessage(error)
      }`,
    );
    return null;
  }
}

/**
 * Process a private field declaration with shorthand syntax: (#fieldName value)
 * The field name includes the # prefix and is stored as-is
 */
function processPrivateField(
  elementList: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRClassField | null {
  try {
    // (#fieldName value) - first element is the #name, second is value
    const fieldNameNode = elementList.elements[0];
    if (fieldNameNode.type !== "symbol") {
      throw new ValidationError(
        "Private field name must be a symbol starting with #",
        "private field",
        "#name",
        fieldNameNode.type,
      );
    }

    const fieldName = (fieldNameNode as SymbolNode).name;
    // Remove the # for storage, will be added back in codegen
    const storedName = fieldName.slice(1);
    let initialValue: IR.IRNode | null = null;

    // If there's an initial value, transform it
    if (elementList.elements.length > 1) {
      initialValue = transformNode(elementList.elements[1], currentDir);
    }

    return {
      type: IR.IRNodeType.ClassField,
      name: storedName,
      mutable: true, // Private fields are mutable by default
      initialValue,
      isPrivate: true,
    };
  } catch (error) {
    logger.error(
      `Error processing private field: ${getErrorMessage(error)}`,
    );
    return null;
  }
}

/**
 * Process a class field declaration
 */
function processClassField(
  elementList: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  elementType: string,
): IR.IRClassField | null {
  try {
    // Field handling
    if (elementList.elements.length < 2) {
      throw new ValidationError(
        `${elementType} requires at least a name`,
        "field declaration",
        "name",
        `${elementList.elements.length - 1} arguments`,
      );
    }

    const fieldNameNode = elementList.elements[1];
    if (fieldNameNode.type !== "symbol") {
      throw new ValidationError(
        "Field name must be a symbol",
        "field name",
        "symbol",
        fieldNameNode.type,
      );
    }

    const fieldName = (fieldNameNode as SymbolNode).name;
    let initialValue: IR.IRNode | null = null;

    // If there's an initial value, transform it
    if (elementList.elements.length > 2) {
      initialValue = transformNode(elementList.elements[2], currentDir);
    }

    return {
      type: IR.IRNodeType.ClassField,
      name: fieldName,
      mutable: elementType !== "const",  // var and let are mutable, only const is immutable
      initialValue,
    };
  } catch (error) {
    logger.error(
      `Error processing class field: ${
        getErrorMessage(error)
      }`,
    );
    return null;
  }
}

/**
 * Process a class getter or setter
 * Getter: (get name [] body) - body starts at index 3
 * Setter: (set name [param] body) - body starts at index 3
 */
function processClassAccessor(
  elementList: ListNode,
  kind: "get" | "set",
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRClassMethod | null {
  try {
    // Both getter and setter: (get/set name [params] body) - minimum 4 elements
    if (elementList.elements.length < 4) {
      throw new ValidationError(
        `${kind} requires a name, parameters, and body`,
        `${kind} definition`,
        "name, params, body",
        `${elementList.elements.length - 1} arguments`,
      );
    }

    const nameNode = elementList.elements[1];
    if (nameNode.type !== "symbol") {
      throw new ValidationError(
        `${kind} name must be a symbol`,
        `${kind} name`,
        "symbol",
        nameNode.type,
      );
    }
    const accessorName = (nameNode as SymbolNode).name;

    // Parse parameters - getters should have empty [], setters have one param
    const paramsNode = elementList.elements[2];
    if (paramsNode.type !== "list") {
      throw new ValidationError(
        `${kind} parameters must be a list`,
        `${kind} params`,
        "list",
        paramsNode.type,
      );
    }

    const { params } = parseClassMethodParameters(
      paramsNode as ListNode,
      currentDir,
      transformNode,
    );

    // Validate parameter count
    if (kind === "get" && params.length > 0) {
      throw new ValidationError(
        "Getter must not have parameters",
        "getter params",
        "empty",
        `${params.length} parameters`,
      );
    }
    if (kind === "set" && params.length !== 1) {
      throw new ValidationError(
        "Setter must have exactly one parameter",
        "setter params",
        "1 parameter",
        `${params.length} parameters`,
      );
    }

    // Body starts at index 3 for both getters and setters
    const { bodyElements } = extractMethodBodyElements(elementList, 3);

    const bodyNodes = transformNonNullElements(
      bodyElements,
      currentDir,
      transformNode,
    );

    // Getters need implicit return; setters don't return
    const bodyStmts = bodyNodes.map((node, i) => {
      const isLast = i === bodyNodes.length - 1;
      // Only getters need implicit return
      if (kind === "get" && isLast && node.type !== IR.IRNodeType.ReturnStatement) {
        return {
          type: IR.IRNodeType.ReturnStatement,
          argument: node,
        } as IR.IRReturnStatement;
      }
      return node;
    });

    return {
      type: IR.IRNodeType.ClassMethod,
      name: accessorName,
      params,
      body: {
        type: IR.IRNodeType.BlockStatement,
        body: bodyStmts,
      },
      kind,
    };
  } catch (error) {
    logger.error(
      `Error processing class ${kind}: ${getErrorMessage(error)}`,
    );
    return null;
  }
}

/**
 * Process a class constructor
 */
function processClassConstructor(
  elementList: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRClassConstructor | null {
  try {
    // Constructor handling
    if (elementList.elements.length < 3) {
      throw new ValidationError(
        "constructor requires parameters and body",
        "constructor",
        "params and body",
        `${elementList.elements.length - 1} arguments`,
      );
    }

    const paramsNode = elementList.elements[1];
    if (paramsNode.type !== "list") {
      throw new ValidationError(
        "Constructor parameters must be a list",
        "constructor params",
        "list",
        paramsNode.type,
      );
    }

    // Extract parameter names
    let paramsList = paramsNode as ListNode;
    
    // Handle vector literal syntax [x y] which parses as (vector x y)
    if (
      paramsList.elements.length > 0 &&
      paramsList.elements[0].type === "symbol" &&
      (paramsList.elements[0] as SymbolNode).name === VECTOR_SYMBOL
    ) {
      paramsList = {
        ...paramsList,
        elements: paramsList.elements.slice(1),
      } as ListNode;
    }

    const params: IR.IRIdentifier[] = [];

    for (const param of paramsList.elements) {
      if (param.type !== "symbol") {
        throw new ValidationError(
          "Constructor parameter must be a symbol",
          "constructor param",
          "symbol",
          param.type,
        );
      }

      // Extract type annotation if present (e.g., "v:T" -> name="v", typeAnnotation="T")
      const { name: paramName, type: typeAnnotation } = extractAndNormalizeType((param as SymbolNode).name);

      const parameter: IR.IRIdentifier = {
        type: IR.IRNodeType.Identifier,
        name: sanitizeIdentifier(paramName),
        typeAnnotation,
      };
      copyPosition(param, parameter);
      params.push(parameter);
    }

    // Transform constructor body - handle all body expressions from index 2 onwards
    // Extract body nodes - handle do-block or regular body expressions
    let bodyNodes: HQLNode[];

    if (elementList.elements.length === 3) {
      const bodyNode = elementList.elements[2];

      // Check if it's a do-block: (do expr1 expr2 ...)
      const isDoBlock =
        bodyNode.type === "list" &&
        bodyNode.elements.length > 0 &&
        bodyNode.elements[0].type === "symbol" &&
        (bodyNode.elements[0] as SymbolNode).name === "do";

      if (isDoBlock) {
        // Extract statements from do-block (skip the 'do' symbol)
        const doList = bodyNode as ListNode;
        bodyNodes = doList.elements.slice(1);
      } else {
        // Single expression body
        bodyNodes = [bodyNode];
      }
    } else {
      // Multiple body expressions (from index 2 onwards)
      bodyNodes = elementList.elements.slice(2);
    }

    // Transform all body nodes to statements with proper wrapping
    const bodyBlock: IR.IRBlockStatement = {
      type: IR.IRNodeType.BlockStatement,
      body: transformToStatements(bodyNodes, transformNode, currentDir),
    };

    return {
      type: IR.IRNodeType.ClassConstructor,
      params,
      body: bodyBlock,
    };
  } catch (error) {
    logger.error(
      `Error processing class constructor: ${
        getErrorMessage(error)
      }`,
    );
    return null;
  }
}
