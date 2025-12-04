// src/transpiler/syntax/function.ts

import * as IR from "../type/hql_ir.ts";
import type { HQLNode, ListNode, LiteralNode, SymbolNode } from "../type/hql_ast.ts";
import {
  HQLError,
  perform,
  TransformError,
  ValidationError,
} from "../../common/error.ts";
import { getErrorMessage, sanitizeIdentifier } from "../../common/utils.ts";
import { globalLogger as logger } from "../../logger.ts";
import {
  copyPosition,
  getIIFEDepth,
  setIIFEDepth,
  transformNode,
  isExpressionResult,
} from "../pipeline/hql-ast-to-hql-ir.ts";
import {
  validateTransformed,
  isSpreadOperator,
  transformSpreadOperator,
} from "../utils/validation-helpers.ts";
import { extractMetaSourceLocation } from "../utils/source_location_utils.ts";
import {
  containsNestedReturns,
  wrapWithEarlyReturnHandler,
} from "../utils/return-helpers.ts";
import { patternToIR } from "../utils/pattern-to-ir.ts";
import { parsePattern } from "../../s-exp/pattern-parser.ts";

const fnFunctionRegistry = new Map<string, IR.IRFnFunctionDeclaration>();

type TransformNodeFn = (node: HQLNode, dir: string) => IR.IRNode | null;

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
  return perform(
    () => {
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
          const expr = transformNode(bodyExprs[i], currentDir);
          if (expr) {
            if (isExpressionResult(expr)) {
              bodyNodes.push({
                type: IR.IRNodeType.ExpressionStatement,
                expression: expr,
              } as IR.IRExpressionStatement);
            } else {
              bodyNodes.push(expr);
            }
          }
        }

        // Process the last expression specially - wrap it in a return statement
        const lastExpr = transformNode(
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
                  type: IR.IRNodeType.ReturnStatement,
                  argument: ifStmt.consequent,
                } as IR.IRReturnStatement;

              // Wrap alternate in return if it's not already a control flow statement
              let finalAlternate = ifStmt.alternate;
              if (finalAlternate && !isControlFlowStatement(finalAlternate)) {
                finalAlternate = {
                  type: IR.IRNodeType.ReturnStatement,
                  argument: finalAlternate,
                } as IR.IRReturnStatement;
              }

              bodyNodes.push({
                type: IR.IRNodeType.IfStatement,
                test: ifStmt.test,
                consequent: finalConsequent,
                alternate: finalAlternate,
              } as IR.IRIfStatement);
            } else {
              // ReturnStatement or ThrowStatement
              bodyNodes.push(lastExpr);
            }
          } else {
            // Wrap in a return statement to ensure the value is returned
            bodyNodes.push({
              type: IR.IRNodeType.ReturnStatement,
              argument: lastExpr,
            } as IR.IRReturnStatement);
          }
        }

        // Check if the function body contains nested returns (returns inside do/if/try blocks)
        // If so, wrap with try/catch to handle early return throws
        const hasNestedReturns = bodyNodes.some((node) =>
          containsNestedReturns(node)
        );
        if (hasNestedReturns) {
          const originalBody: IR.IRBlockStatement = {
            type: IR.IRNodeType.BlockStatement,
            body: bodyNodes,
          };
          const wrappedBody = wrapWithEarlyReturnHandler(originalBody);
          return wrappedBody.body; // Return the statements from the wrapped body
        }

        return bodyNodes;
      } finally {
        // Restore the IIFE depth after processing function body
        setIIFEDepth(savedDepth);
      }
    },
    "processFunctionBody",
    TransformError,
    [bodyExprs],
  );
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
      return transformSpreadOperator(arg, currentDir, transformNode, "spread in function call");
    }
    return validateTransformed(
      transformNode(arg, currentDir),
      "function argument",
      "Function argument",
    );
  });
}

export function transformStandardFunctionCall(
  list: ListNode,
  currentDir: string,
): IR.IRNode {
  return perform(
    () => {
      const first = list.elements[0];
      const argNodes = list.elements.slice(1);

      // Validate that removed named argument syntax is not used
      detectRemovedNamedArgumentSyntax(argNodes);

      if (first.type === "symbol") {
        const op = (first as SymbolNode).name;
        logger.debug(`Processing standard function call to ${op}`);

        return {
          type: IR.IRNodeType.CallExpression,
          callee: {
            type: IR.IRNodeType.Identifier,
            name: sanitizeIdentifier(op),
          } as IR.IRIdentifier,
          arguments: transformArgsWithSpread(argNodes, currentDir),
        } as IR.IRCallExpression;
      }

      // Handle function expression calls
      const callee = validateTransformed(
        transformNode(first, currentDir),
        "function call",
        "Function callee",
      );

      return {
        type: IR.IRNodeType.CallExpression,
        callee,
        arguments: transformArgsWithSpread(argNodes, currentDir),
      } as IR.IRCallExpression;
    },
    "transformStandardFunctionCall",
    TransformError,
    [list],
  );
}

/**
 * Get an fn function from the registry
 */
export function getFnFunction(
  name: string,
): IR.IRFnFunctionDeclaration | undefined {
  return fnFunctionRegistry.get(name);
}

/**
 * Transform an fn function - supports both named and anonymous functions.
 * Named: (fn name [params] body...)
 * Anonymous: (fn [params] body...)
 */
export function transformFn(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  processFunctionBody: (body: HQLNode[], dir: string) => IR.IRNode[],
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
      // Named function: (fn name [params] body...)
      return transformNamedFn(
        list,
        currentDir,
        transformNode,
        processFunctionBody,
      );
    } else if (secondElement.type === "list") {
      // Anonymous function: (fn [params] body...)
      return transformAnonymousFn(
        list,
        currentDir,
        processFunctionBody,
        transformNode,
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
      `Failed to transform fn: ${
        getErrorMessage(error)
      }`,
      "fn function",
      "transformation",
      list,
    );
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
  const funcName = funcNameNode.name;

  // Extract parameter list
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

  // Detect parameter style: [] (positional) or {} (JSON map)
  // Unified parameter parsing
  const { params, defaults, usesJsonMapParams } = parseFunctionParameters(
    paramList,
    currentDir,
    transformNode,
  );

  // Body expressions start after the parameter list (index 3)
  const bodyExpressions = list.elements.slice(3);

  // Process the body expressions
  const bodyNodes = processFunctionBody(bodyExpressions, currentDir);

  // Create the FnFunctionDeclaration node
  const funcId: IR.IRIdentifier = {
    type: IR.IRNodeType.Identifier,
    name: sanitizeIdentifier(funcName),
  };
  copyPosition(funcNameNode, funcId);

  const fnFuncDecl = {
    type: IR.IRNodeType.FnFunctionDeclaration,
    id: funcId,
    params,
    defaults: Array.from(defaults.entries()).map(([name, value]) => ({
      name,
      value,
    })),
    body: {
      type: IR.IRNodeType.BlockStatement,
      body: bodyNodes,
    },
    usesJsonMapParams,
  } as IR.IRFnFunctionDeclaration;

  // Register this function in our registry for call site handling
  registerFnFunction(funcName, fnFuncDecl);
  return fnFuncDecl;
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

  // Detect parameter style: [] (positional) or {} (JSON map)
  // Unified parameter parsing
  const { params } = parseFunctionParameters(
    paramList,
    currentDir,
    transformNode,
  );

  // Process the body expressions (start at index 2 after params)
  const bodyNodes = processFunctionBody(
    list.elements.slice(2),
    currentDir,
  );

  return {
    type: IR.IRNodeType.FunctionExpression,
    id: null,
    params,
    body: { type: IR.IRNodeType.BlockStatement, body: bodyNodes },
  } as IR.IRFunctionExpression;
}

// Enhancements to core/src/transpiler/syntax/function.ts
// Adding better error location tracking and reporting

/**
 * Process and transform a call to an fn function.
 * Handles positional arguments and JSON map parameters.
 * Enhanced error reporting for removed named argument syntax.
 */
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
  // JSON map parameter functions accept a single object argument or no arguments
  if (args.length === 0) {
    // No arguments provided, use defaults (pass empty object)
    const emptyObject: IR.IRObjectExpression = {
      type: IR.IRNodeType.ObjectExpression,
      properties: [],
    };
    return {
      type: IR.IRNodeType.CallExpression,
      callee: {
        type: IR.IRNodeType.Identifier,
        name: funcDef.id.name,
      } as IR.IRIdentifier,
      arguments: [emptyObject],
    } as IR.IRCallExpression;
  } else if (args.length === 1) {
    // Check if the argument is a hash-map
    const arg = args[0];
    if (arg.type === "list") {
      const listArg = arg as ListNode;
      if (
        listArg.elements.length > 0 &&
        listArg.elements[0].type === "symbol" &&
        ((listArg.elements[0] as SymbolNode).name === "hash-map" ||
          (listArg.elements[0] as SymbolNode).name === "__hql_hash_map")
      ) {
        // Transform the hash-map argument
        const transformedArg = validateTransformed(
          transformNode(arg, currentDir),
          "function call",
          "JSON map argument",
        );
        return {
          type: IR.IRNodeType.CallExpression,
          callee: {
            type: IR.IRNodeType.Identifier,
            name: funcDef.id.name,
          } as IR.IRIdentifier,
          arguments: [transformedArg],
        } as IR.IRCallExpression;
      }
    }
    // Not a hash-map, error
    throw new ValidationError(
      `Function '${funcName}' expects a JSON map argument, but received ${arg.type}`,
      "function call",
      "JSON map object (e.g., {\"key\": value})",
      arg.type,
    );
  } else {
    // Too many arguments
    throw new ValidationError(
      `Function '${funcName}' with JSON map parameters accepts at most one argument (a JSON map)`,
      "function call",
      "0 or 1 argument",
      `${args.length} arguments`,
    );
  }
}

/**
 * Process positional arguments for a function call
 * Handles regular parameters, pattern parameters, defaults, and rest parameters
 */
function processPositionalArgs(
  funcName: string,
  funcDef: IR.IRFnFunctionDeclaration,
  args: HQLNode[],
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode[] {
  // Check if any arguments are spread operators
  const hasSpreadArgs = args.some(isSpreadOperator);

  // If spread arguments are present, skip arity validation and transform all args as-is
  // (arity checking must happen at runtime for spread)
  if (hasSpreadArgs) {
    return args.map((arg) => {
      if (isSpreadOperator(arg)) {
        // Spread argument: (func ...args)
        return transformSpreadOperator(arg, currentDir, transformNode, "spread in function call");
      }
      // Regular argument
      return validateTransformed(
        transformNode(arg, currentDir),
        "function argument",
        "Function argument",
      );
    });
  }

  // Extract parameter names from identifiers only (patterns have no names)
  const paramNames: (string | null)[] = funcDef.params.map((p) =>
    p.type === IR.IRNodeType.Identifier ? p.name : null
  );
  const defaultValues = new Map(
    funcDef.defaults.map((d) => [d.name, d.value]),
  );

  // Check if we have a rest parameter (name starts with "...")
  const hasRestParam = paramNames.length > 0 &&
    paramNames[paramNames.length - 1] !== null &&
    paramNames[paramNames.length - 1]!.startsWith("...");

  // Get the regular parameters (all except the last one if it's a rest parameter)
  const regularParamNames = hasRestParam
    ? paramNames.slice(0, -1)
    : paramNames;

  // Process normal positional arguments
  const finalArgs: IR.IRNode[] = [];

  // Process each parameter in the function definition
  for (let i = 0; i < regularParamNames.length; i++) {
    const paramName = regularParamNames[i];

    // If paramName is null, it's a pattern parameter (positional only, no defaults)
    if (paramName === null) {
      if (i < args.length) {
        // Pattern parameters must have a positional argument
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

    // It's a named parameter (identifier)
    if (i < args.length) {
      const arg = args[i];

      // If this argument is a placeholder (_), use default
      if (arg.type === "symbol" && (arg as SymbolNode).name === "_") {
        if (defaultValues.has(paramName)) {
          finalArgs.push(defaultValues.get(paramName)!);
        } else {
          // Enhanced error message with more context
          throw new ValidationError(
            `Placeholder used for parameter '${paramName}' but no default value is defined`,
            "function call with placeholder",
            "parameter with default value",
            "parameter without default",
            extractMetaSourceLocation(arg),
          );
        }
      } else {
        // Normal argument, transform it
        const transformedArg = validateTransformed(
          transformNode(arg, currentDir),
          "function call",
          `Argument for parameter '${paramName}'`,
        );
        finalArgs.push(transformedArg);
      }
    } else if (defaultValues.has(paramName)) {
      // Use default value for missing arguments
      finalArgs.push(defaultValues.get(paramName)!);
    } else {
      // Enhanced error message with the actual function name and parameter
      throw new ValidationError(
        `Missing required argument for parameter '${paramName}' in call to function '${funcName}'`,
        "function call",
        `required parameter '${paramName}'`,
        "missing argument",
        extractMetaSourceLocation(args),
      );
    }
  }

  // If we have a rest parameter, add all remaining arguments
  if (hasRestParam) {
    const restArgStartIndex = regularParamNames.length;
    for (let i = restArgStartIndex; i < args.length; i++) {
      const arg = args[i];
      const transformedArg = transformNode(arg, currentDir);
      if (transformedArg) {
        finalArgs.push(transformedArg);
      }
    }
  } else if (args.length > paramNames.length) {
    // Too many arguments without a rest parameter
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
 * Orchestrates validation and argument processing
 */
export function processFnFunctionCall(
  funcName: string,
  funcDef: IR.IRFnFunctionDeclaration,
  args: HQLNode[],
  currentDir: string,
  transformNode: TransformNodeFn,
): IR.IRNode {
  try {
    // Validate that removed named argument syntax is not used
    detectRemovedNamedArgumentSyntax(args);

    // Handle JSON map parameters specially
    if (funcDef.usesJsonMapParams) {
      return processJsonMapArgs(funcName, funcDef, args, currentDir, transformNode);
    }

    // Process normal positional arguments
    const finalArgs = processPositionalArgs(funcName, funcDef, args, currentDir, transformNode);

    // Create the final call expression
    return {
      type: IR.IRNodeType.CallExpression,
      callee: {
        type: IR.IRNodeType.Identifier,
        name: sanitizeIdentifier(funcName),
      },
      arguments: finalArgs,
    } as IR.IRCallExpression;
  } catch (error) {
    // If this is already a ValidationError with location info, don't wrap it
    if (
      error instanceof ValidationError && error.sourceLocation &&
      (error.sourceLocation.filePath || error.sourceLocation.line)
    ) {
      throw error;
    }

    // Otherwise enhance the error with location info
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
 * Helper function to extract source location from a node
 */
// Note: legacy helpers (extractSourceLocation, getCallLocation, getExtraArgumentLocation)
// were consolidated into extractMetaSourceLocation within source_location_utils.ts



/**
 * Register an fn function in the registry for call site handling
 */
function registerFnFunction(
  name: string,
  def: IR.IRFnFunctionDeclaration,
): void {
  fnFunctionRegistry.set(name, def);
}

/**
 * Parse parameters with default values for fn functions
 */
interface ParameterParseOptions {
  supportRest: boolean;      // Whether to handle & rest parameters
}

/**
 * Unified parameter parsing function that handles destructuring, defaults, and rest parameters
 */
function parseParameters(
  paramList: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  options: ParameterParseOptions,
): {
  params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[];
  defaults: Map<string, IR.IRNode>;
} {
  const { supportRest } = options;

  // Initialize result structures
  const params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[] = [];
  const defaults = new Map<string, IR.IRNode>();

  // Track if we're processing a rest parameter
  let restMode = false;

  // Process parameters
  for (let i = 0; i < paramList.elements.length; i++) {
    const elem = paramList.elements[i];

    if (elem.type === "list") {
      // This is a destructuring pattern parameter
      const patternNode = elem as ListNode;

      // Convert pattern to IR and add directly to params
      const parsedPattern = parsePattern(patternNode);
      const irPattern = patternToIR(parsedPattern, transformNode, currentDir);

      // Only accept array and object patterns
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

      // Check for rest parameter indicator (both old & and new ... syntax)
      if (supportRest && symbolName === "&") {
        restMode = true;
        continue;
      }

      // Check if this parameter itself starts with ... (new JS-style rest syntax)
      const isRestParam = supportRest && symbolName.startsWith("...");
      const actualParamName = isRestParam ? symbolName.slice(3) : symbolName;

      // Handle regular parameter (with optional rest and default)
      const param: IR.IRIdentifier = (restMode || isRestParam)
        ? {
            type: IR.IRNodeType.Identifier,
            name: `...${sanitizeIdentifier(actualParamName)}`,
            originalName: actualParamName,
          }
        : {
            type: IR.IRNodeType.Identifier,
            name: sanitizeIdentifier(symbolName),
            originalName: symbolName,
          };
      copyPosition(elem, param);
      params.push(param);

      // Check for default value (=)
      if (
        !restMode && !isRestParam && // Rest parameters can't have defaults
        i + 1 < paramList.elements.length &&
        paramList.elements[i + 1].type === "symbol" &&
        (paramList.elements[i + 1] as SymbolNode).name === "="
      ) {
        if (i + 2 < paramList.elements.length) {
          const defaultValueNode = paramList.elements[i + 2];
          const defaultValue = transformNode(defaultValueNode, currentDir);
          if (defaultValue) {
            defaults.set(symbolName, defaultValue);
          }
          i += 2; // Skip = and default value
        } else {
          throw new ValidationError(
            `Missing default value after '=' for parameter '${symbolName}'`,
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
): {
  params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[];
  defaults: Map<string, IR.IRNode>;
} {
  return parseParameters(paramList, currentDir, transformNode, {
    supportRest: true,
  });
}

/**
 * Parse JSON map parameters for functions
 * Syntax: (fn name {"key1": value1, "key2": value2} body)
 * Parsed as: (hash-map "key1" value1 "key2" value2)
 *
 * Rules:
 * - All keys must be string literals (quoted)
 * - All keys must have default values
 * - No mixing with positional parameters
 *
 * @param mapNode - ListNode starting with "hash-map" symbol
 * @param currentDir - Current directory for module resolution
 * @param transformNode - Function to transform HQL nodes to IR
 * @returns Object with params array and defaults map
 */
/**
 * Unified helper to parse function parameters from any format (Vector, Map, List)
 * Reduces cyclomatic complexity in transformNamedFn and transformAnonymousFn
 */
function parseFunctionParameters(
  paramList: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): {
  params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[];
  defaults: Map<string, IR.IRNode>;
  usesJsonMapParams: boolean;
} {
  // Check for hash-map (JSON map parameters)
  if (
    paramList.elements.length > 0 &&
    paramList.elements[0].type === "symbol" &&
    ((paramList.elements[0] as SymbolNode).name === "hash-map" ||
      (paramList.elements[0] as SymbolNode).name === "__hql_hash_map")
  ) {
    const { params, defaults } = parseJsonMapParameters(
      paramList,
      currentDir,
      transformNode,
    );
    return { params, defaults, usesJsonMapParams: true };
  }

  // Check for vector notation
  if (
    paramList.elements.length > 0 &&
    paramList.elements[0].type === "symbol" &&
    (paramList.elements[0] as SymbolNode).name === "vector"
  ) {
    const vectorList = {
      ...paramList,
      elements: paramList.elements.slice(1),
    } as ListNode;
    const { params, defaults } = parseParametersWithDefaults(
      vectorList,
      currentDir,
      transformNode,
    );
    return { params, defaults, usesJsonMapParams: false };
  }

  // Regular list parameters
  const { params, defaults } = parseParametersWithDefaults(
    paramList,
    currentDir,
    transformNode,
  );
  return { params, defaults, usesJsonMapParams: false };
}

export function parseJsonMapParameters(
  mapNode: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
): {
  params: IR.IRIdentifier[];
  defaults: Map<string, IR.IRNode>;
} {
  const params: IR.IRIdentifier[] = [];
  const defaults = new Map<string, IR.IRNode>();

  // Verify this is a hash-map node (can be "hash-map" or "__hql_hash_map" after macro expansion)
  if (
    mapNode.elements.length === 0 ||
    mapNode.elements[0].type !== "symbol" ||
    !((mapNode.elements[0] as SymbolNode).name === "hash-map" ||
      (mapNode.elements[0] as SymbolNode).name === "__hql_hash_map")
  ) {
    throw new ValidationError(
      "JSON map parameters must be a hash-map literal",
      "function parameters",
      "hash-map literal starting with 'hash-map'",
      mapNode.elements[0]?.type || "empty list",
    );
  }

  // Parse key-value pairs (elements after "hash-map" symbol)
  // Format: (hash-map "key1" val1 "key2" val2 ...)
  for (let i = 1; i < mapNode.elements.length; i += 2) {
    const keyNode = mapNode.elements[i];
    const valueNode = mapNode.elements[i + 1];

    // Verify we have both key and value
    if (!valueNode) {
      throw new ValidationError(
        `Missing default value for JSON map parameter`,
        "function parameter",
        "key and default value",
        "missing value",
      );
    }

    // Verify key is a string literal
    if (keyNode.type !== "literal" || typeof (keyNode as LiteralNode).value !== "string") {
      throw new ValidationError(
        "JSON map parameter keys must be quoted strings",
        "parameter key",
        "string literal (e.g., \"key\")",
        keyNode.type === "symbol" ? `unquoted symbol '${(keyNode as SymbolNode).name}'` : keyNode.type,
      );
    }

    const paramName = (keyNode as LiteralNode).value as string;

    // Create parameter identifier
    const param: IR.IRIdentifier = {
      type: IR.IRNodeType.Identifier,
      name: sanitizeIdentifier(paramName),
      originalName: paramName,
    };
    copyPosition(keyNode, param);
    params.push(param);

    // Transform and store default value
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

  // Verify at least one parameter
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

/**
 * Pre-compiled regex for matching dollar-sign parameters ($0, $1, etc.)
 * Matches patterns like: $0, $1, $2, $0.name, $1.value, $0.prop.subprop
 */
const DOLLAR_PARAM_REGEX = /^\$(\d+)(?:\.|$)/;

/**
 * Sentinel value indicating no dollar parameters were found
 */
const NO_DOLLAR_PARAMS = -1;

/**
 * Maximum allowed implicit parameters in arrow lambda
 * Set to 255 to match V8's maximum function parameter limit
 * V8 enforces a hard limit of 65535 arguments, but 255 is a practical limit
 * that prevents pathological cases like (=> $99999) while allowing reasonable usage
 *
 * See: https://bugs.chromium.org/p/v8/issues/detail?id=5516
 */
const MAX_ARROW_PARAMS = 255;

/**
 * Error messages for arrow lambda validation
 */
const ARROW_LAMBDA_ERRORS = {
  NO_IMPLICIT_PARAMS:
    "Arrow lambda with implicit parameters must use $0, $1, $2, etc. or provide explicit parameter list",
  TOO_MANY_PARAMS: (found: number, max: number) =>
    `Arrow lambda has too many implicit parameters ($${found}). Maximum is $${max - 1}`,
} as const;

/**
 * Type guard: Check if node is a SymbolNode
 */
function isSymbolNode(node: HQLNode): node is SymbolNode {
  return node.type === "symbol";
}

/**
 * Type guard: Check if node is a ListNode
 */
function isListNode(node: HQLNode): node is ListNode {
  return node.type === "list";
}

/**
 * Scan HQL AST for dollar-sign parameters ($0, $1, $2, etc.)
 *
 * Iterative stack-based implementation (no recursion overhead).
 *
 * Time Complexity: O(n) where n = total AST nodes
 * Space Complexity: O(d) where d = maximum AST depth
 *
 * @param nodes - Single node or array of nodes to scan
 * @returns Highest parameter number found, or NO_DOLLAR_PARAMS
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
      // Push elements in reverse to maintain traversal order
      // Avoids spread operator which has V8 limits (~65K args)
      for (let i = node.elements.length - 1; i >= 0; i--) {
        stack.push(node.elements[i]);
      }
    }
  }

  return maxParam;
}

/**
 * Helper: Create a SymbolNode
 */
function createSymbolNode(name: string): SymbolNode {
  return { type: "symbol", name };
}

/**
 * Helper: Create a ListNode representing an fn function
 */
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
 *
 * Supports two forms:
 * 1. Implicit parameters: (=> body...) where body uses $0, $1, $2...
 * 2. Explicit parameters: (=> [params...] body...) with square brackets
 *
 * Examples:
 * - (=> (* $0 2)) → (fn [$0] (* $0 2))
 * - (=> (+ $0 $1)) → (fn [$0 $1] (+ $0 $1))
 * - (=> [x y] (+ x y)) → (fn [x y] (+ x y))
 *
 * Error cases:
 * - (=> 42) → Error: No $N parameters found
 * - (=> $300) → Error: Too many parameters (max is $254)
 *
 * @param list - Arrow lambda list node
 * @param currentDir - Current directory for imports
 * @param transformNode - Node transformation function
 * @param processFunctionBody - Function body processor
 * @returns Transformed function IR node
 */
export function transformArrowLambda(
  list: ListNode,
  currentDir: string,
  transformNode: TransformNodeFn,
  processFunctionBody: (body: HQLNode[], dir: string) => IR.IRNode[],
): IR.IRNode {
  try {
    logger.debug("Transforming arrow lambda (=>)");

    // Validate minimum syntax: (=> ...)
    if (list.elements.length < 2) {
      throw new ValidationError(
        "Arrow lambda requires at least a body",
        "=> expression",
        "body or [params] body",
        `${list.elements.length - 1} arguments`,
      );
    }

    const secondElement = list.elements[1];

    // Case 1: Explicit parameters - (=> [params...] body...)
    // Detected when: second element is list (vector) AND there's a body after it
    if (isListNode(secondElement) && list.elements.length > 2) {
      const paramList = secondElement;
      const bodyElements = list.elements.slice(2);
      const fnList = createFnListNode(paramList, bodyElements);
      return transformFn(fnList, currentDir, transformNode, processFunctionBody);
    }

    // Case 2: Implicit $N parameters - (=> body...)
    const bodyElements = list.elements.slice(1);
    const maxParam = scanForDollarParams(bodyElements);

    // Validate at least one dollar param found
    if (maxParam === NO_DOLLAR_PARAMS) {
      throw new ValidationError(
        ARROW_LAMBDA_ERRORS.NO_IMPLICIT_PARAMS,
        "=> expression",
        "(=> (* $0 2)) or (=> (x) (* x 2))",
        "no $N parameters found and no explicit parameter list",
      );
    }

    // Validate parameter count doesn't exceed maximum
    if (maxParam >= MAX_ARROW_PARAMS) {
      throw new ValidationError(
        ARROW_LAMBDA_ERRORS.TOO_MANY_PARAMS(maxParam, MAX_ARROW_PARAMS),
        "=> expression",
        `$0 through $${MAX_ARROW_PARAMS - 1}`,
        `$${maxParam} found`,
      );
    }

    // Generate parameter list: $0, $1, $2, ..., $maxParam
    // Note: Use "$N" as actual parameter names (JavaScript allows $)
    const paramList: ListNode = {
      type: "list",
      elements: Array.from(
        { length: maxParam + 1 },
        (_, i) => createSymbolNode(`$${i}`),
      ),
    };

    const fnList = createFnListNode(paramList, bodyElements);
    return transformFn(fnList, currentDir, transformNode, processFunctionBody);
  } catch (error) {
    throw new TransformError(
      `Failed to transform arrow lambda: ${
        getErrorMessage(error)
      }`,
      "=> expression",
      "transformation",
      list,
    );
  }
}
