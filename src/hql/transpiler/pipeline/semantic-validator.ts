/**
 * Semantic Validator for HQL
 *
 * Validates the IR for semantic errors that would otherwise only be caught
 * at runtime or during JavaScript module loading. This includes:
 * - Duplicate variable declarations in the same scope
 * - Temporal Dead Zone (TDZ) violations (using variable before declaration)
 *
 * This is a standard compiler pass that all production compilers perform.
 * TypeScript, Rust, Go, Java all validate semantics before code generation.
 */

import * as IR from "../type/hql_ir.ts";
import { ValidationError } from "../../../common/error.ts";
import { getErrorMessage } from "../../../common/utils.ts";
import { globalLogger as logger } from "../../../logger.ts";
import { forEachNode } from "../utils/ir-tree-walker.ts";

/**
 * Represents a scope in the program
 */
interface Scope {
  /** Parent scope (null for global scope) */
  parent: Scope | null;
  /** Variables declared in this scope, mapped to their declaration info */
  declarations: Map<string, { position: IR.SourcePosition; statementIndex: number }>;
  /** Current statement index (for tracking declaration order) */
  currentStatementIndex: number;
}

/**
 * Create a new scope
 */
function createScope(parent: Scope | null = null): Scope {
  return {
    parent,
    declarations: new Map(),
    currentStatementIndex: 0,
  };
}

/**
 * Check if a variable is declared in this scope (not parent scopes)
 */
function isDeclaredInScope(scope: Scope, name: string): boolean {
  return scope.declarations.has(name);
}

/**
 * Get the statement index where a variable was declared in the current scope
 * Returns undefined if not declared in current scope
 * PERFORMANCE: O(1) Map lookup instead of O(n) array search
 */
function getDeclarationIndex(scope: Scope, name: string): number | undefined {
  const entry = scope.declarations.get(name);
  return entry?.statementIndex;
}

/**
 * Register a variable declaration in the current scope
 */
function declareVariable(
  scope: Scope,
  name: string,
  position: IR.SourcePosition | undefined,
  kind: "const" | "let" | "var"
): void {
  // Check for duplicate in current scope
  if (isDeclaredInScope(scope, name)) {
    const firstDecl = scope.declarations.get(name)!;
    const currentLine = position?.line || 1;
    const firstDeclLine = firstDecl.position.line || 1;

    // Include line number in format :line: that tests expect
    const errorMsg = `Identifier '${name}' has already been declared at :${currentLine}: (first at :${firstDeclLine}:)`;

    throw new ValidationError(
      errorMsg,
      "Duplicate declaration",
      {
        filePath: position?.filePath || "unknown",
        line: currentLine,
        column: position?.column,
      }
    );
  }

  // Register declaration with both position and statement index for O(1) TDZ checking
  scope.declarations.set(name, {
    position: position || {},
    statementIndex: scope.currentStatementIndex,
  });

  logger.debug(`Declared '${name}' (${kind}) at statement index ${scope.currentStatementIndex}`);
}

/**
 * Extract all identifier names from a pattern (handles destructuring)
 */
function extractIdentifiersFromPattern(pattern: IR.IRNode): string[] {
  const identifiers: string[] = [];

  if (pattern.type === IR.IRNodeType.Identifier) {
    identifiers.push((pattern as IR.IRIdentifier).name);
  } else if (pattern.type === IR.IRNodeType.ArrayPattern) {
    const arrayPattern = pattern as IR.IRArrayPattern;
    for (const element of arrayPattern.elements) {
      if (element) {
        identifiers.push(...extractIdentifiersFromPattern(element));
      }
    }
  } else if (pattern.type === IR.IRNodeType.ObjectPattern) {
    const objectPattern = pattern as IR.IRObjectPattern;
    for (const prop of objectPattern.properties) {
      identifiers.push(...extractIdentifiersFromPattern(prop.value));
    }
    if (objectPattern.rest) {
      identifiers.push(...extractIdentifiersFromPattern(objectPattern.rest.argument));
    }
  } else if (pattern.type === IR.IRNodeType.RestElement) {
    const rest = pattern as IR.IRRestElement;
    identifiers.push(...extractIdentifiersFromPattern(rest.argument));
  } else if (pattern.type === IR.IRNodeType.AssignmentPattern) {
    const assignment = pattern as IR.IRAssignmentPattern;
    identifiers.push(...extractIdentifiersFromPattern(assignment.left));
  }

  return identifiers;
}

/**
 * Check for TDZ violations in an expression
 * Throws error if expression references a variable declared later in the same scope
 *
 * Uses generic tree walker - automatically handles ALL IR node types.
 */
function checkTDZInExpression(scope: Scope, node: IR.IRNode): void {
  if (!node) return;

  // Use generic tree walker to visit all nodes and check identifiers
  forEachNode(node, (n) => {
    if (n.type === IR.IRNodeType.Identifier) {
      const identifier = n as IR.IRIdentifier;
      const name = identifier.name;

      // Check if this variable is declared later in the current scope (TDZ violation)
      const declIndex = getDeclarationIndex(scope, name);
      if (declIndex !== undefined && declIndex > scope.currentStatementIndex) {
        throw new ValidationError(
          `Cannot access '${name}' before initialization (declared later in the same scope)`,
          "Temporal Dead Zone violation",
          {
            filePath: identifier.position?.filePath || "unknown",
            line: identifier.position?.line,
            column: identifier.position?.column,
          }
        );
      }
    }
  });
}

/**
 * Validate a block of statements
 */
function validateBlock(scope: Scope, nodes: IR.IRNode[]): void {
  for (let i = 0; i < nodes.length; i++) {
    scope.currentStatementIndex = i;
    validateNode(scope, nodes[i]);
  }
}

/**
 * Validate a single IR node
 */
function validateNode(scope: Scope, node: IR.IRNode): void {
  if (!node) return;

  switch (node.type) {
    case IR.IRNodeType.Program: {
      const program = node as IR.IRProgram;
      validateBlock(scope, program.body);
      break;
    }

    case IR.IRNodeType.VariableDeclaration: {
      const varDecl = node as IR.IRVariableDeclaration;

      // First check for TDZ in initializer expressions
      for (const declarator of varDecl.declarations) {
        if (declarator.init) {
          checkTDZInExpression(scope, declarator.init);
        }
      }

      // Then register the declarations
      for (const declarator of varDecl.declarations) {
        const identifiers = extractIdentifiersFromPattern(declarator.id);
        for (const name of identifiers) {
          declareVariable(scope, name, declarator.position, varDecl.kind);
        }
      }
      break;
    }

    case IR.IRNodeType.FunctionDeclaration:
    case IR.IRNodeType.FnFunctionDeclaration: {
      const funcDecl = node as IR.IRFunctionDeclaration;

      // Declare the function name in the current scope
      if (funcDecl.id) {
        declareVariable(scope, funcDecl.id.name, funcDecl.position, "const");
      }

      // Create new scope for function body
      const functionScope = createScope(scope);

      // Declare parameters in function scope
      for (const param of funcDecl.params) {
        const paramNames = extractIdentifiersFromPattern(param as IR.IRNode);
        for (const name of paramNames) {
          declareVariable(functionScope, name, (param as IR.IRNode).position, "const");
        }
      }

      // Validate function body
      validateNode(functionScope, funcDecl.body);
      break;
    }

    case IR.IRNodeType.FunctionExpression: {
      const funcExpr = node as IR.IRFunctionExpression;

      // Create new scope for function
      const functionScope = createScope(scope);

      // If named function expression, declare name in its own scope
      if (funcExpr.id) {
        declareVariable(functionScope, funcExpr.id.name, funcExpr.position, "const");
      }

      // Declare parameters
      for (const param of funcExpr.params) {
        const paramNames = extractIdentifiersFromPattern(param as IR.IRNode);
        for (const name of paramNames) {
          declareVariable(functionScope, name, (param as IR.IRNode).position, "const");
        }
      }

      // Validate body
      validateNode(functionScope, funcExpr.body);
      break;
    }

    case IR.IRNodeType.BlockStatement: {
      const block = node as IR.IRBlockStatement;
      // Blocks create new scope (for let/const)
      const blockScope = createScope(scope);
      validateBlock(blockScope, block.body);
      break;
    }

    case IR.IRNodeType.ClassDeclaration: {
      const classDecl = node as IR.IRClassDeclaration;

      // Declare class name
      if (classDecl.id) {
        declareVariable(scope, classDecl.id.name, classDecl.position, "const");
      }

      // Create scope for class body
      const classScope = createScope(scope);

      // Validate fields
      if (classDecl.fields) {
        for (const field of classDecl.fields) {
          if (field.initialValue) {
            checkTDZInExpression(classScope, field.initialValue);
          }
        }
      }

      // Validate methods
      if (classDecl.methods) {
        for (const method of classDecl.methods) {
          validateNode(classScope, method);
        }
      }

      // Validate constructor
      if (classDecl.constructor) {
        validateNode(classScope, classDecl.constructor);
      }
      break;
    }

    case IR.IRNodeType.IfStatement: {
      const ifStmt = node as IR.IRIfStatement;
      checkTDZInExpression(scope, ifStmt.test);
      validateNode(scope, ifStmt.consequent);
      if (ifStmt.alternate) {
        validateNode(scope, ifStmt.alternate);
      }
      break;
    }

    case IR.IRNodeType.ReturnStatement: {
      const returnStmt = node as IR.IRReturnStatement;
      if (returnStmt.argument) {
        checkTDZInExpression(scope, returnStmt.argument);
      }
      break;
    }

    case IR.IRNodeType.ExpressionStatement: {
      const exprStmt = node as IR.IRExpressionStatement;
      checkTDZInExpression(scope, exprStmt.expression);
      break;
    }

    case IR.IRNodeType.TryStatement: {
      const tryStmt = node as IR.IRTryStatement;
      validateNode(scope, tryStmt.block);
      if (tryStmt.handler) {
        const catchScope = createScope(scope);
        if (tryStmt.handler.param) {
          const paramNames = extractIdentifiersFromPattern(tryStmt.handler.param);
          for (const name of paramNames) {
            declareVariable(catchScope, name, tryStmt.handler.param.position, "const");
          }
        }
        validateNode(catchScope, tryStmt.handler.body);
      }
      if (tryStmt.finalizer) {
        validateNode(scope, tryStmt.finalizer);
      }
      break;
    }

    // For other node types, just check for TDZ in expressions
    default: {
      checkTDZInExpression(scope, node);
      break;
    }
  }
}

/**
 * Validate an IR program for semantic errors
 *
 * @param ir - The IR program to validate
 * @throws ValidationError if validation fails
 */
export function validateSemantics(ir: IR.IRProgram): void {
  logger.debug("Starting semantic validation");

  const globalScope = createScope(null);

  try {
    validateNode(globalScope, ir);
    logger.debug("Semantic validation passed");
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.debug(`Semantic validation failed: ${error.message}`);
      throw error;
    }
    // Re-throw unexpected errors
    const message = getErrorMessage(error);
    logger.debug(`Unexpected error during semantic validation: ${message}`);
    throw error;
  }
}
