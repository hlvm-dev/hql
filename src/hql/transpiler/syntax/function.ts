// src/hql/transpiler/syntax/function.ts

import * as IR from "../type/hql_ir.ts";
import {
  type HQLNode,
  isListNode,
  isSymbolNode,
  type ListNode,
  type LiteralNode,
  type SymbolNode,
  type TransformNodeFn,
} from "../type/hql_ast.ts";
import {
  HQLError,
  TransformError,
  ValidationError,
} from "../../../common/error.ts";
import { getErrorMessage, sanitizeIdentifier } from "../../../common/utils.ts";
import {
  extractAndNormalizeType,
  normalizeType,
} from "../tokenizer/type-tokenizer.ts";
import { globalLogger as logger } from "../../../logger.ts";
import {
  copyEndPosition,
  copyPosition,
  extractMeta,
  getIIFEDepth,
  isExpressionResult,
  setIIFEDepth,
  transformHQLNodeToIR,
} from "../pipeline/hql-ast-to-hql-ir.ts";
import {
  isHashMapParams,
  isSpreadOperator,
  transformSpreadOperator,
  validateTransformed,
} from "../utils/validation-helpers.ts";
import { extractMetaSourceLocation } from "../utils/source_location_utils.ts";
import {
  containsNestedReturns,
  wrapWithEarlyReturnHandler,
} from "../utils/return-helpers.ts";
import {
  HASH_MAP_INTERNAL,
  HASH_MAP_USER,
} from "../../../common/runtime-helper-impl.ts";
import { hasArrayLiteralPrefix } from "../../../common/sexp-utils.ts";
import { patternToIR } from "../utils/pattern-to-ir.ts";
import { parsePattern } from "../../s-exp/pattern-parser.ts";
import { getMeta } from "../../s-exp/types.ts";
import { LRUCache } from "../../../common/lru-cache.ts";
import {
  type BindingResolutionContext,
  identifierFromBindingCarrier,
  identifierFromBindingRecord,
  registerBindingAlias,
  registerDeclaredBinding,
  registerLexicalBinding,
  withLexicalScope,
} from "../utils/binding-resolution.ts";
import {
  createBlock,
  createCall,
  createExprStmt,
  createFnExpr,
  createId,
  createMember,
  createNum,
  createReturn,
  createStr,
  createSwitchCase,
  createVarDecl,
} from "../utils/ir-helpers.ts";

// LRU cache with size limit to prevent unbounded memory growth in long-running processes
const fnFunctionRegistry = new LRUCache<string, IR.IRFnFunctionDeclaration>(
  5000,
);

// Pre-compiled regex for extracting generic type parameters from names
// e.g., "identity<T>" -> name="identity", typeParameters=["T"]
// Exported for use by class.ts (single source of truth)
export const GENERIC_NAME_REGEX = /^([^<]+)(?:<(.+)>)?$/;

/**
 * Helper function to check if a node is already a control flow statement
 * Control flow statements are: ReturnStatement, ThrowStatement, or IfStatement
 * These don't need to be wrapped in a return statement
 */
function isControlFlowStatement(node: IR.IRNode): boolean {
  return node.type === IR.IRNodeType.ReturnStatement ||
    node.type === IR.IRNodeType.ThrowStatement ||
    node.type === IR.IRNodeType.IfStatement;
}

/**
 * Detect and report usage of removed named argument syntax (x: value)
 * Throws a helpful error message guiding users to new syntax
 */
function detectRemovedNamedArgumentSyntax(args: HQLNode[]): void {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.type === "symbol" && (arg as SymbolNode).name.endsWith(":")) {
      const paramName = (arg as SymbolNode).name.slice(0, -1);
      throw new ValidationError(
        `Named arguments (${paramName}: value) have been removed from HQL.\n\n` +
          `Please use one of these alternatives:\n` +
          `  1. Positional arguments: (fn-name value1 value2 ...)\n` +
          `  2. JSON map parameters: (fn-name {"${paramName}": value, ...})\n\n` +
          `See migration guide for details.`,
        "function call",
        "positional or JSON map arguments",
        `named argument '${paramName}:'`,
      );
    }
  }
}

/**
 * Process function body expressions, creating return statements
 */
export function processFunctionBody(
  bodyExprs: HQLNode[],
  currentDir: string,
): IR.IRNode[] {
  // CRITICAL: Save and reset IIFE depth for each function body
  // Function bodies start with clean context - returns inside the function
  // are direct returns, NOT nested in IIFEs (unless inside do/try blocks within the function)
  const savedDepth = getIIFEDepth();
  setIIFEDepth(0);

  try {
    const bodyNodes: IR.IRNode[] = [];

    // Check if there are any expressions
    if (bodyExprs.length === 0) {
      return bodyNodes;
    }

    // Process all expressions except the last one
    for (let i = 0; i < bodyExprs.length - 1; i++) {
      const expr = transformHQLNodeToIR(bodyExprs[i], currentDir);
      if (expr) {
        if (isExpressionResult(expr)) {
          // Wrap in ExpressionStatement, inheriting position from the expression
          const exprStmt = createExprStmt(expr);
          exprStmt.position = expr.position; // Propagate position from wrapped expression
          bodyNodes.push(exprStmt);
        } else {
          bodyNodes.push(expr);
        }
      }
    }

    // Process the last expression specially - wrap it in a return statement
    const lastExpr = transformHQLNodeToIR(
      bodyExprs[bodyExprs.length - 1],
      currentDir,
    );

    if (lastExpr) {
      // If it's already a control flow statement, use it as is
      // ThrowStatement can appear here if the last expression is a return inside do/try block
      if (isControlFlowStatement(lastExpr)) {
        if (lastExpr.type === IR.IRNodeType.IfStatement) {
          // IfStatement appears when it contains control flow (return/throw)
          // Need to ensure both branches return a value
          const ifStmt = lastExpr as IR.IRIfStatement;

          // Wrap consequent in return if it's not already a control flow statement
          const finalConsequent = isControlFlowStatement(ifStmt.consequent)
            ? ifStmt.consequent
            : {
              ...createReturn(ifStmt.consequent),
              position: ifStmt.consequent.position,
            };

          // Wrap alternate in return if it's not already a control flow statement
          let finalAlternate = ifStmt.alternate;
          if (finalAlternate && !isControlFlowStatement(finalAlternate)) {
            finalAlternate = {
              ...createReturn(finalAlternate),
              position: finalAlternate.position,
            };
          }

          bodyNodes.push({
            type: IR.IRNodeType.IfStatement,
            test: ifStmt.test,
            consequent: finalConsequent,
            alternate: finalAlternate,
            position: ifStmt.position, // Propagate position
          } as IR.IRIfStatement);
        } else {
          // ReturnStatement or ThrowStatement
          bodyNodes.push(lastExpr);
        }
      } else {
        // Wrap in a return statement to ensure the value is returned
        bodyNodes.push({
          ...createReturn(lastExpr),
          position: lastExpr.position,
        });
      }
    }

    // Check if the function body contains nested returns (returns inside do/if/try blocks)
    // If so, wrap with try/catch to handle early return throws
    const hasNestedReturns = bodyNodes.some((node) =>
      containsNestedReturns(node)
    );
    if (hasNestedReturns) {
      // Get position for block statement from first body node
      const blockPosition = bodyNodes.length > 0
        ? bodyNodes[0].position
        : undefined;
      const originalBody: IR.IRBlockStatement = createBlock(
        bodyNodes,
        blockPosition,
      );
      const wrappedBody = wrapWithEarlyReturnHandler(originalBody);
      return wrappedBody.body; // Return the statements from the wrapped body
    }

    return bodyNodes;
  } finally {
    // Restore the IIFE depth after processing function body
    setIIFEDepth(savedDepth);
  }
}

/**
 * Transform arguments with spread operator detection (DRY helper).
 */
function transformArgsWithSpread(
  args: HQLNode[],
  currentDir: string,
): IR.IRNode[] {
  return args.map((arg) => {
    if (isSpreadOperator(arg)) {
      return transformSpreadOperator(
        arg,
        currentDir,
        transformHQLNodeToIR,
        "spread in function call",
      );
    }
    return validateTransformed(
      transformHQLNodeToIR(arg, currentDir),
      "function argument",
      "Function argument",
    );
  });
}

export function transformStandardFunctionCall(
  list: ListNode,
  currentDir: string,
  bindingContext: BindingResolutionContext,
): IR.IRNode {
  const first = list.elements[0];
  const argNodes = list.elements.slice(1);

  // Validate that removed named argument syntax is not used
  detectRemovedNamedArgumentSyntax(argNodes);

  if (first.type === "symbol") {
    const op = (first as SymbolNode).name;
    logger.debug(`Processing standard function call to ${op}`);

    // Extract position from the function name symbol
    const meta = extractMeta(first);
    const position = meta
      ? { line: meta.line, column: meta.column, filePath: meta.filePath }
      : undefined;

    const calleeId = identifierFromBindingCarrier(
      bindingContext,
      first as SymbolNode,
    );
    calleeId.position = position; // Copy position from source symbol

    const callExpr = createCall(
      calleeId,
      transformArgsWithSpread(argNodes, currentDir),
    );
    callExpr.position = position; // Copy position to call expression too
    return callExpr;
  }

  // Handle function expression calls
  const callee = validateTransformed(
    transformHQLNodeToIR(first, currentDir),
    "function call",
    "Function callee",
  );

  // Get position from the list (the full call expression)
  const listMeta = extractMeta(list);
  const listPosition = listMeta
    ? {
      line: listMeta.line,
      column: listMeta.column,
      filePath: listMeta.filePath,
    }
    : undefined;

  const callExpr = createCall(
    callee as IR.IRIdentifier | IR.IRMemberExpression | IR.IRFunctionExpression,
    transformArgsWithSpread(argNodes, currentDir),
  );
  callExpr.position = listPosition; // Use position of the whole call expression
  return callExpr;
}

/**
 * Get an fn function from the registry
 */
export function getFnFunction(
  name: string,
): IR.IRFnFunctionDeclaration | undefined {
  return fnFunctionRegistry.get(name);
}

export function resetFnFunctionRegistry(): void {
  fnFunctionRegistry.clear();
}

/**
 * Check if a node is a multi-arity clause: ([] body...) or ([params...] body...)
 * A multi-arity clause is a list where the first element is a vector (parameter list)
 */
function isMultiArityClause(node: HQLNode): boolean {
  if (node.type !== "list") return false;
  const list = node as ListNode;
  if (list.elements.length < 2) return false; // Need at least params and body
  const firstElem = list.elements[0];
  if (firstElem.type !== "list") return false;
  const paramList = firstElem as ListNode;
  // Check if it's a vector: can be "vector", "empty-array", or "[]"
  return hasArrayLiteralPrefix(paramList) ||
    (paramList.elements.length > 0 &&
      paramList.elements[0].type === "symbol" &&
      (paramList.elements[0] as SymbolNode).name === "[]");
}

/**
 * Transform an fn function - supports both named and anonymous functions.
 * Named: (fn name [params] body...)
 * Anonymous: (fn [params] body...)
 * Multi-arity named: (fn name ([] body1) ([x] body2) ([x y] body3))
 * Multi-arity anonymous: (fn ([] body1) ([x] body2))
 */
export function transformFn(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  processFunctionBody: (body: HQLNode[], dir: string) => IR.IRNode[],
  bindingContext: BindingResolutionContext,
): IR.IRNode {
  try {
    logger.debug("Transforming fn function");

    // Validate minimum syntax
    if (list.elements.length < 2) {
      throw new ValidationError(
        "fn requires at least parameters and body",
        "fn definition",
        "params and body",
        `${list.elements.length - 1} arguments`,
      );
    }

    const secondElement = list.elements[1];

    // Dispatch based on second element type
    if (secondElement.type === "symbol") {
      // Named function - check if multi-arity
      // Multi-arity: (fn name ([] body1) ([x] body2)...)
      if (list.elements.length >= 3 && isMultiArityClause(list.elements[2])) {
        return transformMultiArityFn(
          list,
          currentDir,
          transformNode,
          processFunctionBody,
          bindingContext,
          true,
        );
      }
      // Single-arity named function: (fn name [params] body...)
      return transformNamedFn(
        list,
        currentDir,
        transformNode,
        processFunctionBody,
        bindingContext,
      );
    } else if (secondElement.type === "list") {
      // Check if this is multi-arity anonymous: (fn ([] body1) ([x] body2)...)
      if (isMultiArityClause(secondElement)) {
        return transformMultiArityFn(
          list,
          currentDir,
          transformNode,
          processFunctionBody,
          bindingContext,
          false,
        );
      }
      // Single-arity anonymous function: (fn [params] body...)
      return transformAnonymousFn(
        list,
        currentDir,
        processFunctionBody,
        transformNode,
        bindingContext,
      );
    } else {
      throw new ValidationError(
        "Second argument must be function name (symbol) or parameters (list)",
        "fn definition",
        "symbol or list",
        secondElement.type,
      );
    }
  } catch (error) {
    // Preserve HQLError instances (ValidationError, ParseError, etc.)
    if (error instanceof HQLError) {
      throw error;
    }
    throw new TransformError(
      `Failed to transform fn: ${getErrorMessage(error)}`,
      "fn function",
      "transformation",
      list,
    );
  }
}

/**
 * Transform a multi-arity function definition
 * Syntax: (fn name ([] body0) ([x] body1) ([x y] body2))
 * Or anonymous: (fn ([] body0) ([x] body1))
 *
 * Generates JavaScript with switch on arguments.length:
 * function name(...__args) {
 *   switch(__args.length) {
 *     case 0: return body0;
 *     case 1: { const x = __args[0]; return body1; }
 *     case 2: { const x = __args[0], y = __args[1]; return body2; }
 *     default: throw new Error("No matching arity");
 *   }
 * }
 */
function transformMultiArityFn(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  processFunctionBody: (body: HQLNode[], dir: string) => IR.IRNode[],
  bindingContext: BindingResolutionContext,
  isNamed: boolean,
): IR.IRNode {
  const argsIdentifier = "__args";
  const functionNameMeta = isNamed && list.elements[1].type === "symbol"
    ? getMeta(list.elements[1] as SymbolNode)?.resolvedBinding
    : undefined;

  // Extract function name and arity clauses
  let funcName: string | null = null;
  let funcId: IR.IRIdentifier | null = null;
  let functionBinding:
    | ReturnType<typeof registerDeclaredBinding>
    | null = null;
  let arityClauses: ListNode[];

  if (isNamed) {
    const funcNameNode = list.elements[1] as SymbolNode;
    funcName = funcNameNode.name;
    functionBinding = registerDeclaredBinding(
      bindingContext,
      funcName,
      funcNameNode.name,
      functionNameMeta,
    );
    funcId = identifierFromBindingRecord(functionBinding, funcNameNode.name);
    copyPosition(funcNameNode, funcId);
    copyEndPosition(list, funcId);
    arityClauses = list.elements.slice(2) as ListNode[];
  } else {
    arityClauses = list.elements.slice(1) as ListNode[];
  }

  // Validate all clauses are multi-arity format
  for (let i = 0; i < arityClauses.length; i++) {
    if (!isMultiArityClause(arityClauses[i])) {
      throw new ValidationError(
        `Invalid arity clause at position ${
          i + 1
        }. Expected ([params...] body...)`,
        "multi-arity fn",
        "([params...] body...)",
        arityClauses[i].type,
      );
    }
  }

  // Parse each arity clause to extract: { arity, hasRest, params, body }
  // Supports both simple symbol params and destructuring patterns
  interface ArityInfo {
    arity: number;
    hasRest: boolean;
    params: Array<
      { type: "symbol"; name: string } | {
        type: "pattern";
        node: HQLNode;
        index: number;
      }
    >;
    restParam: string | null;
    bodyExprs: HQLNode[];
  }

  const arities: ArityInfo[] = [];

  for (const clause of arityClauses) {
    const paramList = clause.elements[0] as ListNode;
    const bodyExprs = clause.elements.slice(1);

    // Parse parameters from vector (skip "vector" symbol at index 0)
    const paramElements = paramList.elements.slice(1);
    const params: ArityInfo["params"] = [];
    let hasRest = false;
    let restParam: string | null = null;
    let paramIndex = 0;

    for (let i = 0; i < paramElements.length; i++) {
      const elem = paramElements[i];
      if (elem.type === "symbol") {
        const sym = (elem as SymbolNode).name;
        if (sym === "&") {
          hasRest = true;
          if (i + 1 < paramElements.length) {
            const restElem = paramElements[i + 1];
            if (restElem.type === "symbol") {
              restParam = (restElem as SymbolNode).name;
            }
          }
          break;
        } else if (sym.startsWith("...")) {
          hasRest = true;
          restParam = sym.slice(3);
          break;
        } else {
          const { name: paramNameWithoutType } = extractAndNormalizeType(sym);
          params.push({ type: "symbol", name: paramNameWithoutType });
          paramIndex++;
        }
      } else if (elem.type === "list") {
        params.push({ type: "pattern", node: elem, index: paramIndex });
        paramIndex++;
      }
    }

    arities.push({
      arity: params.length,
      hasRest,
      params,
      restParam,
      bodyExprs,
    });
  }

  // Sort arities: rest-param arities go last (they catch "N or more" args)
  arities.sort((a, b) => {
    if (a.hasRest && !b.hasRest) return 1;
    if (!a.hasRest && b.hasRest) return -1;
    return a.arity - b.arity;
  });

  // Generate switch cases
  const switchCases: IR.IRSwitchCase[] = [];

  for (const arityInfo of arities) {
    const caseBody = withLexicalScope(
      bindingContext,
      () => {
        const body: IR.IRNode[] = [];

        if (isNamed && funcName) {
          registerBindingAlias(
            bindingContext,
            funcName,
            functionBinding?.bindingIdentity,
            functionBinding?.jsName,
          );
        }

        // Destructure parameters from __args
        for (let pIdx = 0; pIdx < arityInfo.params.length; pIdx++) {
          const param = arityInfo.params[pIdx];
          if (param.type === "symbol") {
            const paramBinding = registerLexicalBinding(
              bindingContext,
              param.name,
            );
            const paramId = identifierFromBindingRecord(
              paramBinding,
              param.name,
            );
            body.push(
              createVarDecl(
                paramId,
                createMember(createId(argsIdentifier), createNum(pIdx), true),
              ),
            );
          } else {
            const patternNode = param.node as ListNode;
            const parsedPattern = parsePattern(patternNode);
            const irPattern = patternToIR(
              parsedPattern,
              bindingContext,
              transformNode,
              currentDir,
            );

            if (irPattern) {
              body.push(
                createVarDecl(
                  irPattern,
                  createMember(
                    createId(argsIdentifier),
                    createNum(param.index),
                    true,
                  ),
                ),
              );
            }
          }
        }

        if (arityInfo.hasRest && arityInfo.restParam) {
          const restBinding = registerLexicalBinding(
            bindingContext,
            arityInfo.restParam,
          );
          const restId = createId(`...${restBinding.jsName}`, {
            originalName: arityInfo.restParam,
            bindingIdentity: restBinding.bindingIdentity,
          });
          body.push(
            createVarDecl(
              restId,
              createCall(
                createMember(createId(argsIdentifier), createId("slice")),
                [createNum(arityInfo.arity)],
              ),
            ),
          );
        }

        body.push(...processFunctionBody(arityInfo.bodyExprs, currentDir));
        return body;
      },
    );

    if (arityInfo.hasRest) {
      switchCases.push(createSwitchCase(null, [createBlock(caseBody)]));
    } else {
      switchCases.push(
        createSwitchCase(createNum(arityInfo.arity), [createBlock(caseBody)]),
      );
    }
  }

  // If no rest arity, add default case that throws error
  const hasRestArity = arities.some((a) => a.hasRest);
  if (!hasRestArity) {
    const errorMessage = funcName
      ? `No matching arity for function '${funcName}' with `
      : "No matching arity with ";

    switchCases.push(createSwitchCase(null, [{
      type: IR.IRNodeType.ThrowStatement,
      argument: {
        type: IR.IRNodeType.NewExpression,
        callee: createId("Error"),
        arguments: [{
          type: IR.IRNodeType.BinaryExpression,
          operator: "+",
          left: createStr(errorMessage),
          right: {
            type: IR.IRNodeType.BinaryExpression,
            operator: "+",
            left: createMember(createId(argsIdentifier), createId("length")),
            right: createStr(" arguments"),
          } as IR.IRBinaryExpression,
        } as IR.IRBinaryExpression],
      } as IR.IRNewExpression,
    } as IR.IRThrowStatement]));
  }

  // Create switch statement
  const switchStmt: IR.IRSwitchStatement = {
    type: IR.IRNodeType.SwitchStatement,
    discriminant: createMember(createId(argsIdentifier), createId("length")),
    cases: switchCases,
  };

  // Create rest parameter for the function
  const restParam = createId(`...${argsIdentifier}`);

  // Create function body
  const functionBody: IR.IRBlockStatement = createBlock([switchStmt]);

  if (isNamed && funcId) {
    const fnDecl: IR.IRFnFunctionDeclaration = {
      type: IR.IRNodeType.FnFunctionDeclaration,
      id: funcId,
      params: [restParam],
      defaults: [],
      body: functionBody,
      usesJsonMapParams: false,
    };
    registerFnFunction(funcName as string, fnDecl);
    return fnDecl;
  } else {
    return createFnExpr([restParam], functionBody, { usesThis: false });
  }
}

/**
 * Transform a named fn function declaration.
 */
function transformNamedFn(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  processFunctionBody: (body: HQLNode[], dir: string) => IR.IRNode[],
  bindingContext: BindingResolutionContext,
): IR.IRNode {
  if (list.elements.length < 3) {
    throw new ValidationError(
      "Named fn requires name, parameters, and body",
      "fn definition",
      "name, params, body",
      `${list.elements.length - 1} arguments`,
    );
  }

  const funcNameNode = list.elements[1] as SymbolNode;
  let funcName = funcNameNode.name;

  let returnType: string | undefined;
  const { name: nameWithoutReturnType, type: nameReturnType } =
    extractAndNormalizeType(funcName);
  funcName = nameWithoutReturnType;
  if (nameReturnType) {
    returnType = nameReturnType;
  }

  let typeParameters: string[] | undefined;
  const nameParts = funcName.match(GENERIC_NAME_REGEX);
  if (nameParts) {
    funcName = nameParts[1];
    if (nameParts[2]) {
      typeParameters = nameParts[2].split(",").map((s) => s.trim());
    }
  }

  const paramListNode = list.elements[2];
  if (paramListNode.type !== "list") {
    throw new ValidationError(
      "fn parameter list must be a list",
      "fn parameters",
      "list",
      paramListNode.type,
    );
  }
  const paramList = paramListNode as ListNode;
  const functionBinding = registerDeclaredBinding(
    bindingContext,
    funcName,
    funcNameNode.name,
    getMeta(funcNameNode)?.resolvedBinding,
  );
  const funcId = identifierFromBindingRecord(
    functionBinding,
    funcNameNode.name,
  );
  copyPosition(funcNameNode, funcId);
  copyEndPosition(list, funcId);

  return withLexicalScope(bindingContext, () => {
    registerBindingAlias(
      bindingContext,
      funcName,
      functionBinding.bindingIdentity,
      functionBinding.jsName,
    );

    const { params, defaults, usesJsonMapParams } = parseFunctionParameters(
      paramList,
      currentDir,
      transformNode,
      bindingContext,
    );

    const returnTypeResult = parseReturnTypeAnnotation(list.elements, 3);
    returnType = returnTypeResult.returnType ?? returnType;
    const bodyStartIndex = returnTypeResult.bodyStartIndex;

    const bodyExpressions = list.elements.slice(bodyStartIndex);
    const bodyNodes = processFunctionBody(bodyExpressions, currentDir);
    const blockPosition = bodyNodes.length > 0
      ? bodyNodes[0].position
      : undefined;

    const fnFuncDecl = {
      type: IR.IRNodeType.FnFunctionDeclaration,
      id: funcId,
      params,
      defaults: Array.from(defaults.entries()).map(([name, value]) => ({
        name,
        value,
      })),
      body: createBlock(bodyNodes, blockPosition),
      usesJsonMapParams,
      returnType,
      typeParameters,
    } as IR.IRFnFunctionDeclaration;

    registerFnFunction(funcName, fnFuncDecl);
    return fnFuncDecl;
  });
}

/**
 * Transform an anonymous fn function expression.
 * Handles anonymous function syntax with destructuring support.
 */
function transformAnonymousFn(
  list: ListNode,
  currentDir: string,
  processFunctionBody: (body: HQLNode[], dir: string) => IR.IRNode[],
  transformNode: TransformNodeFn,
  bindingContext: BindingResolutionContext,
): IR.IRNode {
  if (list.elements.length < 3) {
    throw new ValidationError(
      "Anonymous fn requires parameters and body",
      "fn expression",
      "parameters and body",
      `${list.elements.length - 1} arguments`,
    );
  }

  const paramListNode = list.elements[1];
  if (paramListNode.type !== "list") {
    throw new ValidationError(
      "fn parameter list must be a list",
      "fn parameters",
      "list",
      paramListNode.type,
    );
  }
  const paramList = paramListNode as ListNode;
  return withLexicalScope(bindingContext, () => {
    const { params } = parseFunctionParameters(
      paramList,
      currentDir,
      transformNode,
      bindingContext,
    );

    const { returnType, bodyStartIndex } = parseReturnTypeAnnotation(
      list.elements,
      2,
    );

    const bodyNodes = processFunctionBody(
      list.elements.slice(bodyStartIndex),
      currentDir,
    );
    const blockPosition = bodyNodes.length > 0
      ? bodyNodes[0].position
      : undefined;
    const usesThis = containsThisReference(list.elements.slice(bodyStartIndex));

    return createFnExpr(params, createBlock(bodyNodes, blockPosition), {
      returnType,
      usesThis: usesThis || undefined,
    });
  });
}

/**
 * Reconstruct a type string from a parsed list node for return type annotations.
 * Handles [Type] (vector → array shorthand) and (Type, Type) (list → tuple shorthand).
 */
function reconstructReturnTypeString(listNode: ListNode): string | null {
  const elems = listNode.elements;
  if (elems.length === 0) return null;

  // Vector: [Type] → parsed as (vector Type) or (vector Type1 : Type2) for dicts
  if (hasArrayLiteralPrefix(listNode)) {
    const typeElems = elems.slice(1);
    if (typeElems.length === 0) return null;
    const names = typeElems.map((e) => reconstructNodeAsTypeString(e));
    if (names.some((n) => n === null)) return null;
    // Check for dict pattern: [String : Int] → second elem is ":"
    if (names.length === 3 && names[1] === ":") {
      return `[${names[0]}: ${names[2]}]`;
    }
    // Check for dict pattern: first name ends with ":" like "String:"
    if (names.length === 2 && (names[0] as string).endsWith(":")) {
      return `[${names[0]} ${names[1]}]`;
    }
    return `[${(names as string[]).join(", ")}]`;
  }

  // Regular list: (Type, Type) → tuple
  // Only treat as a tuple type if each element is itself type-like (not an expression).
  // This prevents (+ a b) or (console.log x) from being misinterpreted as tuple types.
  if (elems.length >= 2 && elems.every(isTupleTypeElement)) {
    const names = elems.map((e) => reconstructNodeAsTypeString(e));
    if (names.some((n) => n === null)) return null;
    return `(${(names as string[]).join(", ")})`;
  }

  return null;
}

/**
 * Reconstruct a single AST node as a type string.
 */
function reconstructNodeAsTypeString(node: HQLNode): string | null {
  if (node.type === "symbol") return (node as SymbolNode).name;
  if (node.type === "list") {
    return reconstructReturnTypeString(node as ListNode);
  }
  if (node.type === "literal") return String((node as LiteralNode).value);
  return null;
}

/**
 * Reconstruct a type string from a hash-map AST node.
 * Converts (hash-map "key1" Type1 "key2" Type2) → "{key1: Type1, key2: Type2}"
 */
function reconstructHashMapTypeString(listNode: ListNode): string | null {
  const elems = listNode.elements;
  if (elems.length < 3) return null;

  const head = elems[0];
  if (head.type !== "symbol") return null;
  const headName = (head as SymbolNode).name;
  if (headName !== HASH_MAP_USER && headName !== HASH_MAP_INTERNAL) return null;

  const entries = elems.slice(1);
  if (entries.length === 0 || entries.length % 2 !== 0) return null;

  const fields: string[] = [];
  for (let i = 0; i < entries.length; i += 2) {
    const key = entries[i];
    const val = entries[i + 1];
    const keyStr = key.type === "literal"
      ? String((key as LiteralNode).value)
      : key.type === "symbol"
      ? (key as SymbolNode).name
      : null;
    const valStr = val.type === "symbol"
      ? (val as SymbolNode).name
      : val.type === "list"
      ? reconstructReturnTypeString(val as ListNode)
      : null;
    if (!keyStr || !valStr) return null;
    fields.push(`${keyStr}: ${valStr}`);
  }
  return `{${fields.join(", ")}}`;
}

/**
 * Check whether a node is type-like in tuple return type context.
 */
function isTupleTypeElement(node: HQLNode): boolean {
  if (node.type === "symbol") {
    return looksLikeTypeName((node as SymbolNode).name);
  }
  if (node.type === "list") {
    return reconstructReturnTypeString(node as ListNode) !== null;
  }
  return false;
}

/** Operator/special chars that indicate an expression, not a type name */
const OPERATOR_START_CHARS = new Set([
  "+",
  "-",
  "*",
  "/",
  "=",
  "<",
  ">",
  "!",
  "&",
  "|",
  ".",
  "%",
  "^",
  "~",
]);

/** Known TypeScript primitive types (module-level to avoid per-call allocation) */
const LOWERCASE_TYPES = new Set([
  "number",
  "string",
  "boolean",
  "void",
  "any",
  "never",
  "null",
  "undefined",
  "object",
  "unknown",
  "bigint",
  "symbol",
]);

/**
 * Check if a symbol name looks like a type name (not an operator or variable).
 * Type names start with an uppercase letter or are known TS primitive types.
 */
function looksLikeTypeName(name: string): boolean {
  if (name.length === 0) return false;
  if (OPERATOR_START_CHARS.has(name[0])) return false;
  // Must start with uppercase letter or be a known lowercase primitive type
  const firstChar = name[0];
  if (firstChar >= "A" && firstChar <= "Z") return true;
  return LOWERCASE_TYPES.has(name);
}

/**
 * Parse optional return type annotation from element list.
 * Handles both `:Type` (TS-style) and `-> Type` (Swift-style).
 * Returns the normalized return type and the index where the body starts.
 */
function parseReturnTypeAnnotation(
  elements: HQLNode[],
  typeElementIndex: number,
): { returnType: string | undefined; bodyStartIndex: number } {
  if (elements.length <= typeElementIndex) {
    return { returnType: undefined, bodyStartIndex: typeElementIndex };
  }

  const potentialReturnType = elements[typeElementIndex];
  if (potentialReturnType.type !== "symbol") {
    return { returnType: undefined, bodyStartIndex: typeElementIndex };
  }

  const sym = (potentialReturnType as SymbolNode).name;

  // TS-style: :Type
  if (sym.startsWith(":") && sym.length > 1) {
    return {
      returnType: normalizeType(sym.slice(1).trim()),
      bodyStartIndex: typeElementIndex + 1,
    };
  }

  // Swift-style: -> Type
  if (sym === "->") {
    const typeIndex = typeElementIndex + 1;
    if (elements.length > typeIndex) {
      const nextElem = elements[typeIndex];
      if (nextElem.type === "symbol") {
        return {
          returnType: normalizeType((nextElem as SymbolNode).name),
          bodyStartIndex: typeIndex + 1,
        };
      }
      // -> [Type] (vector/array) or -> (Type, Type) (tuple/list)
      if (nextElem.type === "list") {
        const reconstructed = reconstructReturnTypeString(nextElem as ListNode);
        if (reconstructed) {
          return {
            returnType: normalizeType(reconstructed),
            bodyStartIndex: typeIndex + 1,
          };
        }
      }
    }
    throw new ValidationError(
      "Expected return type after '->'",
      "fn return type",
      "type name (e.g. -> Int, -> [Int], -> (Int, String))",
      elements.length > typeIndex ? elements[typeIndex].type : "nothing",
    );
  }

  return { returnType: undefined, bodyStartIndex: typeElementIndex };
}

/**
 * Check if an AST subtree contains a reference to 'this'.
 */
function containsThisReference(nodes: HQLNode[]): boolean {
  for (const node of nodes) {
    if (hasThisInNode(node)) return true;
  }
  return false;
}

function hasThisInNode(node: HQLNode): boolean {
  if (node.type === "symbol") {
    return (node as SymbolNode).name === "this";
  }
  if (node.type === "list") {
    for (const elem of (node as ListNode).elements) {
      if (hasThisInNode(elem)) return true;
    }
  }
  return false;
}

/**
 * Process JSON map parameters for a function call
 * Handles functions that use JSON object syntax for parameters
 */
function processJsonMapArgs(
  funcName: string,
  funcDef: IR.IRFnFunctionDeclaration,
  args: HQLNode[],
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRCallExpression {
  if (args.length === 0) {
    const emptyObject: IR.IRObjectExpression = {
      type: IR.IRNodeType.ObjectExpression,
      properties: [],
    };
    return createCall(createId(funcDef.id.name), [emptyObject]);
  } else if (args.length === 1) {
    const arg = args[0];
    if (arg.type === "list") {
      const listArg = arg as ListNode;
      if (
        listArg.elements.length > 0 &&
        listArg.elements[0].type === "symbol" &&
        ((listArg.elements[0] as SymbolNode).name === HASH_MAP_USER ||
          (listArg.elements[0] as SymbolNode).name === HASH_MAP_INTERNAL)
      ) {
        const transformedArg = validateTransformed(
          transformNode(arg, currentDir),
          "function call",
          "JSON map argument",
        );
        return createCall(createId(funcDef.id.name), [transformedArg]);
      }
    }
    throw new ValidationError(
      `Function '${funcName}' expects a JSON map argument, but received ${arg.type}`,
      "function call",
      'JSON map object (e.g., {"key": value})',
      arg.type,
    );
  } else {
    throw new ValidationError(
      `Function '${funcName}' with JSON map parameters accepts at most one argument (a JSON map)`,
      "function call",
      "0 or 1 argument",
      `${args.length} arguments`,
    );
  }
}

/** Cached defaults Map per funcDef (avoids rebuilding on every call) */
const _defaultsCache = new WeakMap<
  IR.IRFnFunctionDeclaration,
  Map<string, IR.IRNode>
>();

function getDefaultValues(
  funcDef: IR.IRFnFunctionDeclaration,
): Map<string, IR.IRNode> {
  let cached = _defaultsCache.get(funcDef);
  if (!cached) {
    cached = new Map(funcDef.defaults.map((d) => [d.name, d.value]));
    _defaultsCache.set(funcDef, cached);
  }
  return cached;
}

/**
 * Process positional arguments for a function call
 */
function processPositionalArgs(
  funcName: string,
  funcDef: IR.IRFnFunctionDeclaration,
  args: HQLNode[],
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode[] {
  const hasSpreadArgs = args.some(isSpreadOperator);

  if (hasSpreadArgs) {
    return args.map((arg) => {
      if (isSpreadOperator(arg)) {
        return transformSpreadOperator(
          arg,
          currentDir,
          transformNode,
          "spread in function call",
        );
      }
      return validateTransformed(
        transformNode(arg, currentDir),
        "function argument",
        "Function argument",
      );
    });
  }

  const paramNames: (string | null)[] = funcDef.params.map((p) =>
    p.type === IR.IRNodeType.Identifier ? p.name : null
  );
  const defaultValues = getDefaultValues(funcDef);

  const lastParam = paramNames.length > 0
    ? paramNames[paramNames.length - 1]
    : null;
  const hasRestParam = lastParam !== null && lastParam !== undefined &&
    lastParam.startsWith("...");
  const regularParamNames = hasRestParam ? paramNames.slice(0, -1) : paramNames;

  const finalArgs: IR.IRNode[] = [];

  for (let i = 0; i < regularParamNames.length; i++) {
    const paramName = regularParamNames[i];

    if (paramName === null) {
      if (i < args.length) {
        const transformedArg = validateTransformed(
          transformNode(args[i], currentDir),
          "function call",
          `Argument for pattern parameter at position ${i}`,
        );
        finalArgs.push(transformedArg);
      } else {
        throw new ValidationError(
          `Missing required argument for pattern parameter at position ${i} in call to function '${funcName}'`,
          "function call",
          `pattern parameter at position ${i}`,
          "missing argument",
        );
      }
      continue;
    }

    if (i < args.length) {
      const arg = args[i];
      if (arg.type === "symbol" && (arg as SymbolNode).name === "_") {
        const defaultVal = defaultValues.get(paramName);
        if (defaultVal !== undefined) {
          finalArgs.push(defaultVal);
        } else {
          throw new ValidationError(
            `Placeholder used for parameter '${paramName}' but no default value is defined`,
            "function call with placeholder",
            "parameter with default value",
            "parameter without default",
            extractMetaSourceLocation(arg),
          );
        }
      } else {
        const transformedArg = validateTransformed(
          transformNode(arg, currentDir),
          "function call",
          `Argument for parameter '${paramName}'`,
        );
        finalArgs.push(transformedArg);
      }
    } else if (defaultValues.has(paramName)) {
      finalArgs.push(defaultValues.get(paramName) as IR.IRNode);
    } else {
      throw new ValidationError(
        `Missing required argument for parameter '${paramName}' in call to function '${funcName}'`,
        "function call",
        `required parameter '${paramName}'`,
        "missing argument",
        extractMetaSourceLocation(args),
      );
    }
  }

  if (hasRestParam) {
    const restArgStartIndex = regularParamNames.length;
    for (let i = restArgStartIndex; i < args.length; i++) {
      const transformedArg = transformNode(args[i], currentDir);
      if (transformedArg) finalArgs.push(transformedArg);
    }
  } else if (args.length > paramNames.length) {
    const extraArgs = args.slice(paramNames.length);
    const extraArgStr = extraArgs.map((arg) => {
      if (arg.type === "symbol") return `'${(arg as SymbolNode).name}'`;
      if (arg.type === "literal") return `'${arg.value}'`;
      return `[${arg.type}]`;
    }).join(", ");

    throw new ValidationError(
      `Too many arguments in call to function '${funcName}'. Expected ${paramNames.length} ${
        paramNames.length === 1 ? "argument" : "arguments"
      }, but got ${args.length}. Extra arguments: ${extraArgStr}`,
      "function call",
      `${paramNames.length} ${
        paramNames.length === 1 ? "argument" : "arguments"
      }`,
      `${args.length} arguments`,
      extractMetaSourceLocation(args, { index: paramNames.length }),
    );
  }

  return finalArgs;
}

/**
 * Process a function call to a function defined with the fn syntax
 */
export function processFnFunctionCall(
  funcName: string,
  funcDef: IR.IRFnFunctionDeclaration,
  args: HQLNode[],
  currentDir: string,
  transformNode: TransformNodeFn,
  sourceList?: ListNode,
): IR.IRNode {
  try {
    detectRemovedNamedArgumentSyntax(args);

    if (funcDef.usesJsonMapParams) {
      return processJsonMapArgs(
        funcName,
        funcDef,
        args,
        currentDir,
        transformNode,
      );
    }

    const finalArgs = processPositionalArgs(
      funcName,
      funcDef,
      args,
      currentDir,
      transformNode,
    );

    let calleePosition: IR.SourcePosition | undefined;
    if (sourceList && sourceList.elements.length > 0) {
      const firstElem = sourceList.elements[0];
      const meta = extractMeta(firstElem);
      if (meta) {
        calleePosition = {
          line: meta.line,
          column: meta.column,
          filePath: meta.filePath,
        };
      }
    }

    const calleeId = createId(funcDef.id.name, {
      originalName: funcName,
      bindingIdentity: funcDef.id.bindingIdentity,
    });
    calleeId.position = calleePosition;
    return createCall(calleeId, finalArgs);
  } catch (error) {
    if (
      error instanceof ValidationError && error.sourceLocation &&
      (error.sourceLocation.filePath || error.sourceLocation.line)
    ) {
      throw error;
    }
    throw new TransformError(
      `Failed to process function call to '${funcName}': ${
        getErrorMessage(error)
      }`,
      "function call processing",
      extractMetaSourceLocation(args),
    );
  }
}

/**
 * Register an fn function in the registry for call site handling
 */
function registerFnFunction(
  name: string,
  def: IR.IRFnFunctionDeclaration,
): void {
  fnFunctionRegistry.set(name, def);
}

interface ParameterParseOptions {
  supportRest: boolean;
}

/**
 * Unified parameter parsing function that handles destructuring, defaults, and rest parameters
 */
function parseParameters(
  paramList: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  bindingContext: BindingResolutionContext,
  options: ParameterParseOptions,
): {
  params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[];
  defaults: Map<string, IR.IRNode>;
} {
  const { supportRest } = options;
  const params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[] =
    [];
  const defaults = new Map<string, IR.IRNode>();
  let restMode = false;

  for (let i = 0; i < paramList.elements.length; i++) {
    const elem = paramList.elements[i];

    if (elem.type === "list") {
      const patternNode = elem as ListNode;
      const parsedPattern = parsePattern(patternNode);
      const irPattern = patternToIR(
        parsedPattern,
        bindingContext,
        transformNode,
        currentDir,
      );

      if (
        irPattern &&
        (irPattern.type === IR.IRNodeType.ArrayPattern ||
          irPattern.type === IR.IRNodeType.ObjectPattern)
      ) {
        params.push(irPattern);
      } else {
        throw new ValidationError(
          "Pattern parameter must be an array or object pattern",
          "function parameter",
          "array or object pattern",
          irPattern ? irPattern.type.toString() : "null",
        );
      }
      continue;
    }

    if (elem.type === "symbol") {
      const symbolName = (elem as SymbolNode).name;

      if (supportRest && symbolName === "&") {
        restMode = true;
        continue;
      }

      const isRestParam = supportRest && symbolName.startsWith("...");
      const actualParamName = isRestParam ? symbolName.slice(3) : symbolName;

      const { name: paramNameWithoutType, type: typeAnnotation, effect } =
        extractAndNormalizeType(actualParamName);

      // Look-ahead: f: {a:Int} — param ending with ':' followed by hash-map type
      let resolvedType = typeAnnotation;
      if (
        resolvedType === undefined && actualParamName.endsWith(":") &&
        i + 1 < paramList.elements.length &&
        paramList.elements[i + 1].type === "list"
      ) {
        const nextList = paramList.elements[i + 1] as ListNode;
        const reconstructed = reconstructHashMapTypeString(nextList);
        if (reconstructed !== null) {
          resolvedType = normalizeType(reconstructed);
          i += 1; // consume the hash-map list node
        }
      }

      const bindingRecord = registerLexicalBinding(
        bindingContext,
        paramNameWithoutType,
        getMeta(elem)?.resolvedBinding,
      );
      const param = createId(
        restMode || isRestParam
          ? `...${bindingRecord.jsName}`
          : bindingRecord.jsName,
        {
          originalName: paramNameWithoutType,
          bindingIdentity: bindingRecord.bindingIdentity,
          typeAnnotation: resolvedType,
          effectAnnotation: effect,
        },
      );
      copyPosition(elem, param);
      copyEndPosition(paramList, param);
      params.push(param);

      if (
        !restMode && !isRestParam &&
        i + 1 < paramList.elements.length &&
        paramList.elements[i + 1].type === "symbol" &&
        (paramList.elements[i + 1] as SymbolNode).name === "="
      ) {
        if (i + 2 < paramList.elements.length) {
          const defaultValueNode = paramList.elements[i + 2];
          const defaultValue = transformNode(defaultValueNode, currentDir);
          if (defaultValue) {
            defaults.set(
              sanitizeIdentifier(paramNameWithoutType),
              defaultValue,
            );
          }
          i += 2;
        } else {
          throw new ValidationError(
            `Missing default value after '=' for parameter '${paramNameWithoutType}'`,
            "fn parameter default",
            "default value",
            "missing value",
          );
        }
      }
    }
  }

  return { params, defaults };
}

export function parseParametersWithDefaults(
  paramList: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  bindingContext: BindingResolutionContext,
): {
  params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[];
  defaults: Map<string, IR.IRNode>;
} {
  return parseParameters(paramList, currentDir, transformNode, bindingContext, {
    supportRest: true,
  });
}

/**
 * Unified helper to parse function parameters from any format (Vector, Map, List)
 */
function parseFunctionParameters(
  paramList: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  bindingContext: BindingResolutionContext,
): {
  params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[];
  defaults: Map<string, IR.IRNode>;
  usesJsonMapParams: boolean;
} {
  if (isHashMapParams(paramList)) {
    const { params, defaults } = parseJsonMapParameters(
      paramList,
      currentDir,
      transformNode,
      bindingContext,
    );
    return { params, defaults, usesJsonMapParams: true };
  }

  if (hasArrayLiteralPrefix(paramList)) {
    const vectorList = {
      ...paramList,
      elements: paramList.elements.slice(1),
    } as ListNode;
    const { params, defaults } = parseParametersWithDefaults(
      vectorList,
      currentDir,
      transformNode,
      bindingContext,
    );
    return { params, defaults, usesJsonMapParams: false };
  }

  const { params, defaults } = parseParametersWithDefaults(
    paramList,
    currentDir,
    transformNode,
    bindingContext,
  );
  return { params, defaults, usesJsonMapParams: false };
}

export function parseJsonMapParameters(
  mapNode: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  bindingContext: BindingResolutionContext,
): {
  params: IR.IRIdentifier[];
  defaults: Map<string, IR.IRNode>;
} {
  const params: IR.IRIdentifier[] = [];
  const defaults = new Map<string, IR.IRNode>();

  if (
    mapNode.elements.length === 0 ||
    mapNode.elements[0].type !== "symbol" ||
    !((mapNode.elements[0] as SymbolNode).name === HASH_MAP_USER ||
      (mapNode.elements[0] as SymbolNode).name === HASH_MAP_INTERNAL)
  ) {
    throw new ValidationError(
      "JSON map parameters must be a hash-map literal",
      "function parameters",
      "hash-map literal starting with 'hash-map'",
      mapNode.elements[0]?.type || "empty list",
    );
  }

  for (let i = 1; i < mapNode.elements.length; i += 2) {
    const keyNode = mapNode.elements[i];
    const valueNode = mapNode.elements[i + 1];

    if (!valueNode) {
      throw new ValidationError(
        `Missing default value for JSON map parameter`,
        "function parameter",
        "key and default value",
        "missing value",
      );
    }

    if (
      keyNode.type !== "literal" ||
      typeof (keyNode as LiteralNode).value !== "string"
    ) {
      throw new ValidationError(
        "JSON map parameter keys must be quoted strings",
        "parameter key",
        'string literal (e.g., "key")',
        keyNode.type === "symbol"
          ? `unquoted symbol '${(keyNode as SymbolNode).name}'`
          : keyNode.type,
      );
    }

    const paramName = (keyNode as LiteralNode).value as string;

    const bindingRecord = registerLexicalBinding(bindingContext, paramName);
    const param = createId(bindingRecord.jsName, {
      originalName: paramName,
      bindingIdentity: bindingRecord.bindingIdentity,
    });
    copyPosition(keyNode, param);
    copyEndPosition(mapNode, param);
    params.push(param);

    const defaultValue = transformNode(valueNode, currentDir);
    if (defaultValue) {
      defaults.set(paramName, defaultValue);
    } else {
      throw new ValidationError(
        `Failed to parse default value for parameter '${paramName}'`,
        "parameter default value",
        "valid expression",
        "invalid or null value",
      );
    }
  }

  if (params.length === 0) {
    throw new ValidationError(
      "JSON map parameters cannot be empty",
      "function parameters",
      "at least one parameter with default value",
      "empty hash-map",
    );
  }

  return { params, defaults };
}

////////////////////////////////////////////////////////////////////////////////
// Arrow Lambda (=>) Support
////////////////////////////////////////////////////////////////////////////////

const DOLLAR_PARAM_REGEX = /^\$(\d+)(?:\.|\?\.|$)/;
const NO_DOLLAR_PARAMS = -1;
const MAX_ARROW_PARAMS = 255;

const ARROW_LAMBDA_ERRORS = {
  NO_IMPLICIT_PARAMS:
    "Arrow lambda with implicit parameters must use $0, $1, $2, etc. or provide explicit parameter list",
  TOO_MANY_PARAMS: (found: number, max: number) =>
    `Arrow lambda has too many implicit parameters ($${found}). Maximum is $${
      max - 1
    }`,
} as const;

/**
 * Scan HQL AST for dollar-sign parameters ($0, $1, $2, etc.)
 * Iterative stack-based implementation (no recursion overhead).
 */
function scanForDollarParams(nodes: HQLNode | HQLNode[]): number {
  let maxParam = NO_DOLLAR_PARAMS;
  const stack = Array.isArray(nodes) ? nodes.slice() : [nodes];

  let node: HQLNode | undefined;
  while ((node = stack.pop()) !== undefined) {
    if (isSymbolNode(node)) {
      const match = node.name.match(DOLLAR_PARAM_REGEX);
      if (match) {
        const paramNum = +match[1];
        if (paramNum > maxParam) maxParam = paramNum;
      }
    } else if (isListNode(node)) {
      for (let i = node.elements.length - 1; i >= 0; i--) {
        stack.push(node.elements[i]);
      }
    }
  }

  return maxParam;
}

function createSymbolNode(name: string): SymbolNode {
  return { type: "symbol", name };
}

function createFnListNode(
  paramList: ListNode,
  bodyElements: HQLNode[],
): ListNode {
  return {
    type: "list",
    elements: [createSymbolNode("fn"), paramList, ...bodyElements],
  };
}

/**
 * Transform arrow lambda (=>) to regular fn function
 */
export function transformArrowLambda(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  processFunctionBody: (body: HQLNode[], dir: string) => IR.IRNode[],
  bindingContext: BindingResolutionContext,
): IR.IRNode {
  try {
    logger.debug("Transforming arrow lambda (=>)");

    if (list.elements.length < 2) {
      throw new ValidationError(
        "Arrow lambda requires at least a body",
        "=> expression",
        "body or [params] body",
        `${list.elements.length - 1} arguments`,
      );
    }

    const secondElement = list.elements[1];

    if (isListNode(secondElement) && list.elements.length > 2) {
      const paramList = secondElement;
      const bodyElements = list.elements.slice(2);
      const fnList = createFnListNode(paramList, bodyElements);
      return transformFn(
        fnList,
        currentDir,
        transformNode,
        processFunctionBody,
        bindingContext,
      );
    }

    const bodyElements = list.elements.slice(1);
    const maxParam = scanForDollarParams(bodyElements);

    if (maxParam === NO_DOLLAR_PARAMS) {
      throw new ValidationError(
        ARROW_LAMBDA_ERRORS.NO_IMPLICIT_PARAMS,
        "=> expression",
        "(=> (* $0 2)) or (=> (x) (* x 2))",
        "no $N parameters found and no explicit parameter list",
      );
    }

    if (maxParam >= MAX_ARROW_PARAMS) {
      throw new ValidationError(
        ARROW_LAMBDA_ERRORS.TOO_MANY_PARAMS(maxParam, MAX_ARROW_PARAMS),
        "=> expression",
        `$0 through $${MAX_ARROW_PARAMS - 1}`,
        `$${maxParam} found`,
      );
    }

    const paramList: ListNode = {
      type: "list",
      elements: Array.from(
        { length: maxParam + 1 },
        (_, i) => createSymbolNode(`$${i}`),
      ),
    };

    const fnList = createFnListNode(paramList, bodyElements);
    return transformFn(
      fnList,
      currentDir,
      transformNode,
      processFunctionBody,
      bindingContext,
    );
  } catch (error) {
    throw new TransformError(
      `Failed to transform arrow lambda: ${getErrorMessage(error)}`,
      "=> expression",
      "transformation",
      list,
    );
  }
}
