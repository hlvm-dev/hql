/**
 * TypeScript Code Generator - Converts HQL IR to TypeScript code
 *
 * This module generates TypeScript source code from HQL IR while tracking
 * source positions for source map generation. The generated TypeScript
 * is then compiled by tsc to JavaScript with type checking.
 *
 * Key features:
 * - Preserves type annotations from IR nodes
 * - Generates source maps for HQL → TypeScript mapping
 * - Produces valid TypeScript that tsc can compile
 */

import * as IR from "../type/hql_ir.ts";
import { CodeGenError } from "../../common/error.ts";
import { applyTCO } from "../optimize/tco-optimizer.ts";
import { applyMutualTCO, type MutualRecursionGroup } from "../optimize/mutual-tco-optimizer.ts";
import { RUNTIME_HELPER_NAMES_SET } from "../../common/runtime-helper-impl.ts";
import { assertNever } from "../codegen/exhaustive.ts";
import { CodeBuffer, type SourceMapping } from "../codegen/code-buffer.ts";
import { Precedence, getExprPrecedence, isRightAssociative } from "../codegen/precedence.ts";

// ============================================================================
// Types
// ============================================================================

// SourceMapping is imported from code-buffer.ts
export type { SourceMapping };

export interface TSGeneratorResult {
  code: string;
  mappings: SourceMapping[];
  usedHelpers: Set<string>;
}

interface GeneratorOptions {
  sourceFilePath?: string;
  indent?: string;
  /** Enable debug comments showing HQL origin (superiority feature) */
  debug?: boolean;
}

// ============================================================================
// Generator State
// ============================================================================

class TSGenerator {
  // Code buffer for output generation with source map tracking
  private buf: CodeBuffer;
  private usedHelpers: Set<string> = new Set();

  // Mutual recursion TCO: track functions in mutual recursion groups
  private mutualRecursionGroups: MutualRecursionGroup[] = [];
  private mutualRecursionFunctions: Set<string> = new Set();
  // Track if we're currently generating inside a mutual recursion function
  private insideMutualRecursionFunction: boolean = false;

  // Expression-everywhere: track top-level binding names for hoisting
  private topLevelBindingNames: Set<string> = new Set();
  // Track function type signatures for proper call-site type checking
  private topLevelFunctionTypes: Map<string, string> = new Map();
  // Track variable type annotations for hoisted declarations
  private topLevelVariableTypes: Map<string, string> = new Map();
  private isTopLevel: boolean = true;

  // Block-level hoisting: stack of hoisting sets (one per block scope)
  private hoistingStack: Set<string>[] = [];

  // Expression context: when true, we're generating inside an expression
  // and hoisted variables should emit just the assignment expression without
  // indentation, semicolon, or newline
  private inExpressionContext: boolean = false;

  constructor(options: GeneratorOptions = {}) {
    this.buf = new CodeBuffer({
      sourceFilePath: options.sourceFilePath,
      indentStr: options.indent,
      debug: options.debug,
    });
  }

  // ============================================================================
  // Output Helpers - delegate to CodeBuffer
  // ============================================================================

  private emit(text: string, irPosition?: IR.SourcePosition, name?: string): void {
    this.buf.write(text, irPosition, name);
  }

  private emitLine(text: string = "", irPosition?: IR.SourcePosition): void {
    this.buf.writeLine(text, irPosition);
  }

  private emitIndent(): void {
    this.buf.writeIndent();
  }

  private indent(): void {
    this.buf.indent();
  }

  private dedent(): void {
    this.buf.dedent();
  }

  /**
   * Emit items separated by commas - DRY helper for common pattern
   */
  private emitCommaSeparated<T>(items: T[], processor: (item: T) => void): void {
    this.buf.writeCommaSeparated(items, processor);
  }

  /**
   * Write debug comment showing HQL origin (superiority feature).
   * Only emits when debug mode is enabled.
   */
  private emitDebugComment(pos?: IR.SourcePosition, hint?: string): void {
    this.buf.writeDebugComment(pos, hint);
  }

  /**
   * Emit an expression with precedence-aware parenthesization.
   * Wraps the expression in parentheses only when necessary.
   *
   * @param node - The expression node to emit
   * @param contextPrec - The precedence of the surrounding context
   */
  private emitExpr(node: IR.IRNode, contextPrec: Precedence = Precedence.Lowest): void {
    const nodePrec = getExprPrecedence(node);
    const needsParens = nodePrec < contextPrec;

    if (needsParens) this.emit("(");
    this.generateInExpressionContext(node);
    if (needsParens) this.emit(")");
  }

  private trackHelper(name: string): void {
    if (RUNTIME_HELPER_NAMES_SET.has(name)) {
      this.usedHelpers.add(name);
    }
  }

  /**
   * Build a Map from defaults array for efficient lookup.
   * Consolidates duplicate pattern: new Map(defaults?.map(d => [d.name, d.value]))
   */
  private buildDefaultsMap(
    defaults?: { name: string; value: IR.IRNode }[]
  ): Map<string, IR.IRNode> {
    if (!defaults || defaults.length === 0) {
      return new Map();
    }
    return new Map(defaults.map(d => [d.name, d.value]));
  }

  // ============================================================================
  // Expression-Everywhere: Name Collection
  // ============================================================================

  /**
   * Collect top-level binding names for hoisting.
   * These names will be declared with `let` at the top of the module,
   * allowing us to use assignment expressions that return values.
   */
  private collectTopLevelNames(node: IR.IRNode): void {
    switch (node.type) {
      case IR.IRNodeType.VariableDeclaration: {
        const varDecl = node as IR.IRVariableDeclaration;
        for (const decl of varDecl.declarations) {
          if (decl.id.type === IR.IRNodeType.Identifier) {
            const name = (decl.id as IR.IRIdentifier).name;
            this.topLevelBindingNames.add(name);
            // Collect type annotation if present
            if (decl.typeAnnotation) {
              this.topLevelVariableTypes.set(name, decl.typeAnnotation);
            }
          }
          // Skip destructuring patterns - they can't be simple assignments
        }
        break;
      }
      case IR.IRNodeType.FnFunctionDeclaration: {
        const fnDecl = node as IR.IRFnFunctionDeclaration;
        this.topLevelBindingNames.add(fnDecl.id.name);

        // Collect function type signature if params have types or return type is specified
        // This enables TypeScript to check call-site argument types
        // Only consider simple identifier parameters (not destructuring patterns)
        const hasTypedParams = fnDecl.params.some(p =>
          p.type === IR.IRNodeType.Identifier && (p as IR.IRIdentifier).typeAnnotation
        );
        if (hasTypedParams || fnDecl.returnType) {
          const typeSignature = this.buildFunctionTypeSignature(fnDecl);
          this.topLevelFunctionTypes.set(fnDecl.id.name, typeSignature);
        }
        break;
      }
      case IR.IRNodeType.ClassDeclaration: {
        const classDecl = node as IR.IRClassDeclaration;
        this.topLevelBindingNames.add(classDecl.id.name);
        break;
      }
      case IR.IRNodeType.EnumDeclaration: {
        const enumDecl = node as IR.IREnumDeclaration;
        this.topLevelBindingNames.add(enumDecl.id.name);
        break;
      }
      // ImportDeclaration, ExportDeclaration - don't add (handled separately by ESM)
    }
  }

  /**
   * Check if a variable declaration is a simple binding (single identifier).
   * Destructuring patterns cannot use assignment expression syntax.
   */
  private isSimpleBinding(node: IR.IRVariableDeclaration): boolean {
    return node.declarations.length === 1 &&
           node.declarations[0].id.type === IR.IRNodeType.Identifier;
  }

  /**
   * Get the current hoisting set (for the innermost block scope).
   */
  private currentHoistingSet(): Set<string> {
    return this.hoistingStack[this.hoistingStack.length - 1];
  }

  /**
   * Generate a node within expression context.
   * In expression context, hoisted variable declarations emit just the
   * assignment expression without indentation, semicolon, or newline.
   */
  private generateInExpressionContext(node: IR.IRNode): void {
    const wasInExpression = this.inExpressionContext;
    this.inExpressionContext = true;
    this.generateNode(node);
    this.inExpressionContext = wasInExpression;
  }

  /**
   * Helper to collect hoistable names from a list of nodes.
   */
  private collectList(nodes: IR.IRNode[], inExpression: boolean): void {
    for (const node of nodes) {
      if (node) this.collectHoistableNames(node, inExpression);
    }
  }

  /**
   * Recursively collect variable names that need hoisting.
   * Variables in expression positions (e.g., arguments to function calls)
   * need to be hoisted to the enclosing block scope.
   *
   * @param node The IR node to traverse
   * @param inExpression Whether we're inside an expression context
   */
  private collectHoistableNames(node: IR.IRNode, inExpression: boolean): void {
    switch (node.type) {
      case IR.IRNodeType.VariableDeclaration: {
        const varDecl = node as IR.IRVariableDeclaration;
        // Hoist if: in expression context and simple binding
        // Note: const is also hoisted - it uses let declaration but value is frozen
        // via __hql_deepFreeze, maintaining immutability semantics
        if (inExpression && this.isSimpleBinding(varDecl)) {
          const id = varDecl.declarations[0].id as IR.IRIdentifier;
          this.currentHoistingSet().add(id.name);
        }
        // Recurse into initializers (they're expressions)
        for (const decl of varDecl.declarations) {
          if (decl.init) {
            this.collectHoistableNames(decl.init, true);
          }
        }
        break;
      }

      case IR.IRNodeType.ExpressionStatement: {
        const exprStmt = node as IR.IRExpressionStatement;
        this.collectHoistableNames(exprStmt.expression, true);
        break;
      }

      case IR.IRNodeType.CallExpression: {
        const call = node as IR.IRCallExpression;
        this.collectHoistableNames(call.callee, true);
        this.collectList(call.arguments, true);
        break;
      }

      case IR.IRNodeType.BinaryExpression:
      case IR.IRNodeType.LogicalExpression: {
        const binExpr = node as IR.IRBinaryExpression;
        this.collectHoistableNames(binExpr.left, true);
        this.collectHoistableNames(binExpr.right, true);
        break;
      }

      case IR.IRNodeType.ConditionalExpression: {
        const condExpr = node as IR.IRConditionalExpression;
        this.collectHoistableNames(condExpr.test, true);
        this.collectHoistableNames(condExpr.consequent, true);
        this.collectHoistableNames(condExpr.alternate, true);
        break;
      }

      case IR.IRNodeType.ArrayExpression: {
        const arrExpr = node as IR.IRArrayExpression;
        this.collectList(arrExpr.elements, true);
        break;
      }

      case IR.IRNodeType.SequenceExpression: {
        const seqExpr = node as IR.IRSequenceExpression;
        this.collectList(seqExpr.expressions, true);
        break;
      }

      case IR.IRNodeType.ObjectExpression: {
        const objExpr = node as IR.IRObjectExpression;
        for (const prop of objExpr.properties) {
          if (prop.type === IR.IRNodeType.SpreadAssignment) {
            this.collectHoistableNames((prop as IR.IRSpreadAssignment).expression, true);
          } else {
            const objProp = prop as IR.IRObjectProperty;
            if (objProp.computed) {
              this.collectHoistableNames(objProp.key, true);
            }
            this.collectHoistableNames(objProp.value, true);
          }
        }
        break;
      }

      case IR.IRNodeType.FunctionExpression: {
        // Function bodies create new scope - don't collect here
        // They will be handled when generateBlockStatement is called
        break;
      }

      case IR.IRNodeType.ReturnStatement: {
        const ret = node as IR.IRReturnStatement;
        this.collectHoistableNames(ret.argument, true);
        break;
      }

      case IR.IRNodeType.IfStatement: {
        const ifStmt = node as IR.IRIfStatement;
        this.collectHoistableNames(ifStmt.test, true);
        this.collectHoistableNames(ifStmt.consequent, false);
        if (ifStmt.alternate) {
          this.collectHoistableNames(ifStmt.alternate, false);
        }
        break;
      }

      case IR.IRNodeType.WhileStatement: {
        const whileStmt = node as IR.IRWhileStatement;
        this.collectHoistableNames(whileStmt.test, true);
        // Don't collect from body - it's a block with its own scope
        break;
      }

      case IR.IRNodeType.ForOfStatement: {
        const forOf = node as IR.IRForOfStatement;
        this.collectHoistableNames(forOf.right, true);
        // Don't collect from body - it's a block with its own scope
        break;
      }

      case IR.IRNodeType.ForStatement: {
        const forStmt = node as IR.IRForStatement;
        if (forStmt.init) this.collectHoistableNames(forStmt.init, false);
        if (forStmt.test) this.collectHoistableNames(forStmt.test, true);
        if (forStmt.update) this.collectHoistableNames(forStmt.update, true);
        // Don't collect from body - it's a block with its own scope
        break;
      }

      case IR.IRNodeType.BlockStatement: {
        // Block creates new scope - will be handled separately
        break;
      }

      case IR.IRNodeType.UnaryExpression: {
        const unary = node as IR.IRUnaryExpression;
        this.collectHoistableNames(unary.argument, true);
        break;
      }

      case IR.IRNodeType.MemberExpression: {
        const member = node as IR.IRMemberExpression;
        this.collectHoistableNames(member.object, true);
        if (member.computed) {
          this.collectHoistableNames(member.property, true);
        }
        break;
      }

      case IR.IRNodeType.OptionalMemberExpression: {
        const optMember = node as IR.IROptionalMemberExpression;
        this.collectHoistableNames(optMember.object, true);
        if (optMember.computed) {
          this.collectHoistableNames(optMember.property, true);
        }
        break;
      }

      case IR.IRNodeType.OptionalCallExpression: {
        const optCall = node as IR.IROptionalCallExpression;
        this.collectHoistableNames(optCall.callee, true);
        this.collectList(optCall.arguments, true);
        break;
      }

      case IR.IRNodeType.CallMemberExpression: {
        const callMember = node as IR.IRCallMemberExpression;
        this.collectHoistableNames(callMember.object, true);
        this.collectList(callMember.arguments, true);
        break;
      }

      case IR.IRNodeType.NewExpression: {
        const newExpr = node as IR.IRNewExpression;
        this.collectHoistableNames(newExpr.callee, true);
        this.collectList(newExpr.arguments, true);
        break;
      }

      case IR.IRNodeType.AssignmentExpression: {
        const assign = node as IR.IRAssignmentExpression;
        this.collectHoistableNames(assign.right, true);
        break;
      }

      case IR.IRNodeType.SpreadElement: {
        const spread = node as IR.IRSpreadElement;
        this.collectHoistableNames(spread.argument, true);
        break;
      }

      case IR.IRNodeType.AwaitExpression: {
        const awaitExpr = node as IR.IRAwaitExpression;
        this.collectHoistableNames(awaitExpr.argument, true);
        break;
      }

      case IR.IRNodeType.YieldExpression: {
        const yieldExpr = node as IR.IRYieldExpression;
        if (yieldExpr.argument) {
          this.collectHoistableNames(yieldExpr.argument, true);
        }
        break;
      }

      case IR.IRNodeType.SwitchStatement: {
        const switchStmt = node as IR.IRSwitchStatement;
        this.collectHoistableNames(switchStmt.discriminant, true);
        // Don't collect from cases - they're in their own scope
        break;
      }

      case IR.IRNodeType.LabeledStatement: {
        const labeledStmt = node as IR.IRLabeledStatement;
        this.collectHoistableNames(labeledStmt.body, inExpression);
        break;
      }

      case IR.IRNodeType.TryStatement: {
        // Block statements inside try/catch create their own scope
        break;
      }

      case IR.IRNodeType.ThrowStatement: {
        const throwStmt = node as IR.IRThrowStatement;
        this.collectHoistableNames(throwStmt.argument, true);
        break;
      }

      case IR.IRNodeType.ContinueStatement:
      case IR.IRNodeType.BreakStatement:
        // No hoistable names in continue/break statements
        break;

      case IR.IRNodeType.TemplateLiteral: {
        const tmpl = node as IR.IRTemplateLiteral;
        this.collectList(tmpl.expressions, true);
        break;
      }

      // Destructuring patterns - may contain default values with hoistable expressions
      case IR.IRNodeType.AssignmentPattern: {
        const assignPat = node as IR.IRAssignmentPattern;
        // The right side is the default value - it's an expression context
        this.collectHoistableNames(assignPat.right, true);
        // Also recurse into left side in case it's a nested pattern
        this.collectHoistableNames(assignPat.left, inExpression);
        break;
      }

      case IR.IRNodeType.ArrayPattern: {
        const arrPat = node as IR.IRArrayPattern;
        for (const elem of arrPat.elements) {
          if (elem) {
            this.collectHoistableNames(elem, inExpression);
          }
        }
        break;
      }

      case IR.IRNodeType.ObjectPattern: {
        const objPat = node as IR.IRObjectPattern;
        for (const prop of objPat.properties) {
          // Property value might be an AssignmentPattern or nested pattern
          this.collectHoistableNames(prop.value, inExpression);
          // Computed keys are expressions
          if (prop.computed) {
            this.collectHoistableNames(prop.key, true);
          }
        }
        break;
      }

      // Primitives, identifiers, and statement-level declarations that don't need hoisting recursion
      case IR.IRNodeType.Identifier:
      case IR.IRNodeType.StringLiteral:
      case IR.IRNodeType.NumericLiteral:
      case IR.IRNodeType.BooleanLiteral:
      case IR.IRNodeType.NullLiteral:
      case IR.IRNodeType.FunctionDeclaration:
      case IR.IRNodeType.ImportDeclaration:
        break;
      case IR.IRNodeType.FnFunctionDeclaration: {
        const fnDecl = node as IR.IRFnFunctionDeclaration;
        if (inExpression) {
          this.currentHoistingSet().add(fnDecl.id.name);
        }
        // Recurse into body to find nested hoistable names
        this.collectHoistableNames(fnDecl.body, false);
        break;
      }

      case IR.IRNodeType.ClassDeclaration: {
        const classDecl = node as IR.IRClassDeclaration;
        if (inExpression) {
          this.currentHoistingSet().add(classDecl.id.name);
        }
        // Recurse into class body for nested expressions
        // Field initializers are expression contexts - variables declared there
        // need to be hoisted to the enclosing scope
        for (const field of classDecl.fields) {
          if (field.initialValue) {
            this.collectHoistableNames(field.initialValue, true);
          }
        }
        if (classDecl.constructor) {
          this.collectHoistableNames(classDecl.constructor.body, false);
        }
        for (const method of classDecl.methods) {
          this.collectHoistableNames(method.body, false);
        }
        break;
      }

      case IR.IRNodeType.EnumDeclaration: {
        const enumDecl = node as IR.IREnumDeclaration;
        if (inExpression) {
          this.currentHoistingSet().add(enumDecl.id.name);
        }
        // Recurse into enum case raw values - they are expression contexts
        for (const enumCase of enumDecl.cases) {
          if (enumCase.rawValue) {
            this.collectHoistableNames(enumCase.rawValue, true);
          }
        }
        break;
      }

      // Export declarations need to recurse into their content
      case IR.IRNodeType.ExportNamedDeclaration: {
        const exportNamed = node as IR.IRExportNamedDeclaration;
        if (exportNamed.declaration) {
          this.collectHoistableNames(exportNamed.declaration, false);
        }
        break;
      }

      case IR.IRNodeType.ExportDefaultDeclaration: {
        const exportDefault = node as IR.IRExportDefaultDeclaration;
        // The declaration in export default is an expression context
        this.collectHoistableNames(exportDefault.declaration, true);
        break;
      }

      case IR.IRNodeType.ExportVariableDeclaration: {
        const exportVar = node as IR.IRExportVariableDeclaration;
        this.collectHoistableNames(exportVar.declaration, false);
        break;
      }

      default:
        // For unknown types, don't recurse (safe default)
        break;
    }
  }

  /**
   * Build a function type signature string for TypeScript.
   * Example: (a: number, b: number) => number
   *
   * Uses `any` for untyped parameters/return to support gradual typing.
   * This allows untyped code to work without type errors while still
   * checking typed parameters.
   */
  private buildFunctionTypeSignature(fnDecl: IR.IRFnFunctionDeclaration): string {
    const params = fnDecl.params.map((p, index) => {
      // Only simple identifiers have name and typeAnnotation
      if (p.type === IR.IRNodeType.Identifier) {
        const ident = p as IR.IRIdentifier;
        const name = ident.name;
        // Use 'any' for untyped params to support gradual typing
        const type = ident.typeAnnotation || "any";
        return `${name}: ${type}`;
      }
      // Destructuring patterns get a placeholder name and 'any' type
      return `_p${index}: any`;
    });

    // Use 'any' for untyped return to support gradual typing
    const returnType = fnDecl.returnType || "any";
    return `(${params.join(", ")}) => ${returnType}`;
  }

  /**
   * Infer TypeScript type from an IR node (for JSON map parameter defaults).
   * Returns the appropriate TypeScript type string based on the node type.
   */
  private inferTypeFromNode(node: IR.IRNode): string {
    switch (node.type) {
      case IR.IRNodeType.NumericLiteral:
        return "number";
      case IR.IRNodeType.StringLiteral:
        return "string";
      case IR.IRNodeType.BooleanLiteral:
        return "boolean";
      case IR.IRNodeType.NullLiteral:
        return "null";
      case IR.IRNodeType.ArrayExpression:
        return "unknown[]";
      case IR.IRNodeType.ObjectExpression:
        return "Record<string, unknown>";
      default:
        return "unknown";
    }
  }

  /**
   * Build TypeScript type annotation for JSON map parameters.
   * Returns type like: { x?: number; y?: string }
   */
  private buildJsonParamsType(
    params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[],
    defaultsMap: Map<string, IR.IRNode>
  ): string {
    const properties: string[] = [];
    for (const param of params) {
      if (param.type === IR.IRNodeType.Identifier) {
        const paramName = (param as IR.IRIdentifier).name;
        const defaultVal = defaultsMap.get(paramName);
        const inferredType = defaultVal ? this.inferTypeFromNode(defaultVal) : "unknown";
        properties.push(`${paramName}?: ${inferredType}`);
      }
    }
    return `{ ${properties.join("; ")} }`;
  }

  // ============================================================================
  // Main Entry Point
  // ============================================================================

  generate(program: IR.IRProgram): TSGeneratorResult {
    // Push module-level hoisting scope
    this.hoistingStack.push(new Set());

    // Pass 0: Apply mutual recursion TCO (transforms program body)
    const { statements: transformedBody, mutualGroups } = applyMutualTCO(program.body);
    this.mutualRecursionGroups = mutualGroups;
    for (const group of mutualGroups) {
      for (const funcName of group.members) {
        this.mutualRecursionFunctions.add(funcName);
      }
    }

    // Use transformed body for subsequent passes
    const body = transformedBody;

    // Pass 1: Collect all top-level binding names (direct declarations)
    for (const node of body) {
      this.collectTopLevelNames(node);
    }

    // Pass 1b: Collect nested hoistable names (variables in expression positions)
    for (const node of body) {
      this.collectHoistableNames(node, false);
    }

    // Merge: Add nested hoistable names to topLevelBindingNames
    for (const name of this.currentHoistingSet()) {
      this.topLevelBindingNames.add(name);
    }

    // Emit hoisted let declarations with types for functions and variables (enables call-site type checking)
    if (this.topLevelBindingNames.size > 0) {
      const declarations: string[] = [];
      for (const name of this.topLevelBindingNames) {
        const funcType = this.topLevelFunctionTypes.get(name);
        const varType = this.topLevelVariableTypes.get(name);
        if (funcType) {
          // Typed function: let add: (a: number, b: number) => number;
          declarations.push(`${name}: ${funcType}`);
        } else if (varType) {
          // Typed variable: let x: number;
          declarations.push(`${name}: ${varType}`);
        } else {
          // Untyped binding: let x;
          declarations.push(name);
        }
      }
      this.emitLine(`let ${declarations.join(", ")};`);
      this.emitLine();
    }

    // Pass 2: Generate expressions (with isTopLevel = true)
    for (const node of body) {
      this.generateNode(node);
    }

    // Pop module-level hoisting scope
    this.hoistingStack.pop();

    const result = this.buf.getResult();
    return {
      code: result.code,
      mappings: result.mappings,
      usedHelpers: this.usedHelpers,
    };
  }

  // ============================================================================
  // Node Dispatcher
  // ============================================================================

  private generateNode(node: IR.IRNode): void {
    switch (node.type) {
      // Literals
      case IR.IRNodeType.StringLiteral:
        this.generateStringLiteral(node as IR.IRStringLiteral);
        break;
      case IR.IRNodeType.NumericLiteral:
        this.generateNumericLiteral(node as IR.IRNumericLiteral);
        break;
      case IR.IRNodeType.BigIntLiteral:
        this.generateBigIntLiteral(node as IR.IRBigIntLiteral);
        break;
      case IR.IRNodeType.BooleanLiteral:
        this.generateBooleanLiteral(node as IR.IRBooleanLiteral);
        break;
      case IR.IRNodeType.NullLiteral:
        this.emit("null", node.position);
        break;
      case IR.IRNodeType.TemplateLiteral:
        this.generateTemplateLiteral(node as IR.IRTemplateLiteral);
        break;

      // Identifier
      case IR.IRNodeType.Identifier:
        this.generateIdentifier(node as IR.IRIdentifier);
        break;

      // Expressions
      case IR.IRNodeType.BinaryExpression:
        this.generateBinaryExpression(node as IR.IRBinaryExpression);
        break;
      case IR.IRNodeType.UnaryExpression:
        this.generateUnaryExpression(node as IR.IRUnaryExpression);
        break;
      case IR.IRNodeType.LogicalExpression:
        this.generateLogicalExpression(node as IR.IRLogicalExpression);
        break;
      case IR.IRNodeType.ConditionalExpression:
        this.generateConditionalExpression(node as IR.IRConditionalExpression);
        break;
      case IR.IRNodeType.CallExpression:
        this.generateCallExpression(node as IR.IRCallExpression);
        break;
      case IR.IRNodeType.MemberExpression:
        this.generateMemberExpression(node as IR.IRMemberExpression);
        break;
      case IR.IRNodeType.OptionalMemberExpression:
        this.generateOptionalMemberExpression(node as IR.IROptionalMemberExpression);
        break;
      case IR.IRNodeType.OptionalCallExpression:
        this.generateOptionalCallExpression(node as IR.IROptionalCallExpression);
        break;
      case IR.IRNodeType.CallMemberExpression:
        this.generateCallMemberExpression(node as IR.IRCallMemberExpression);
        break;
      case IR.IRNodeType.NewExpression:
        this.generateNewExpression(node as IR.IRNewExpression);
        break;
      case IR.IRNodeType.ArrayExpression:
        this.generateArrayExpression(node as IR.IRArrayExpression);
        break;
      case IR.IRNodeType.SequenceExpression:
        this.generateSequenceExpression(node as IR.IRSequenceExpression);
        break;
      case IR.IRNodeType.ObjectExpression:
        this.generateObjectExpression(node as IR.IRObjectExpression);
        break;
      case IR.IRNodeType.FunctionExpression:
        this.generateFunctionExpression(node as IR.IRFunctionExpression);
        break;
      case IR.IRNodeType.AssignmentExpression:
        this.generateAssignmentExpression(node as IR.IRAssignmentExpression);
        break;
      case IR.IRNodeType.AwaitExpression:
        this.generateAwaitExpression(node as IR.IRAwaitExpression);
        break;
      case IR.IRNodeType.YieldExpression:
        this.generateYieldExpression(node as IR.IRYieldExpression);
        break;
      case IR.IRNodeType.SwitchStatement:
        this.generateSwitchStatement(node as IR.IRSwitchStatement);
        break;
      case IR.IRNodeType.LabeledStatement:
        this.generateLabeledStatement(node as IR.IRLabeledStatement);
        break;
      case IR.IRNodeType.SpreadElement:
        this.generateSpreadElement(node as IR.IRSpreadElement);
        break;

      // Statements
      case IR.IRNodeType.ExpressionStatement:
        this.generateExpressionStatement(node as IR.IRExpressionStatement);
        break;
      case IR.IRNodeType.BlockStatement:
        this.generateBlockStatement(node as IR.IRBlockStatement);
        break;
      case IR.IRNodeType.ReturnStatement:
        this.generateReturnStatement(node as IR.IRReturnStatement);
        break;
      case IR.IRNodeType.IfStatement:
        this.generateIfStatement(node as IR.IRIfStatement);
        break;
      case IR.IRNodeType.WhileStatement:
        this.generateWhileStatement(node as IR.IRWhileStatement);
        break;
      case IR.IRNodeType.ForStatement:
        this.generateForStatement(node as IR.IRForStatement);
        break;
      case IR.IRNodeType.ForOfStatement:
        this.generateForOfStatement(node as IR.IRForOfStatement);
        break;
      case IR.IRNodeType.ThrowStatement:
        this.generateThrowStatement(node as IR.IRThrowStatement);
        break;
      case IR.IRNodeType.TryStatement:
        this.generateTryStatement(node as IR.IRTryStatement);
        break;
      case IR.IRNodeType.ContinueStatement:
        this.generateContinueStatement(node as IR.IRContinueStatement);
        break;
      case IR.IRNodeType.BreakStatement:
        this.generateBreakStatement(node as IR.IRBreakStatement);
        break;

      // Declarations
      case IR.IRNodeType.VariableDeclaration:
        this.generateVariableDeclaration(node as IR.IRVariableDeclaration);
        break;
      case IR.IRNodeType.FunctionDeclaration:
        this.generateFunctionDeclaration(node as IR.IRFunctionDeclaration);
        break;
      case IR.IRNodeType.FnFunctionDeclaration:
        this.generateFnFunctionDeclaration(node as IR.IRFnFunctionDeclaration);
        break;
      case IR.IRNodeType.ClassDeclaration:
        this.generateClassDeclaration(node as IR.IRClassDeclaration);
        break;
      case IR.IRNodeType.EnumDeclaration:
        this.generateEnumDeclaration(node as IR.IREnumDeclaration);
        break;

      // Import/Export
      case IR.IRNodeType.ImportDeclaration:
        this.generateImportDeclaration(node as IR.IRImportDeclaration);
        break;
      case IR.IRNodeType.ExportNamedDeclaration:
        this.generateExportNamedDeclaration(node as IR.IRExportNamedDeclaration);
        break;
      case IR.IRNodeType.ExportVariableDeclaration:
        this.generateExportVariableDeclaration(node as IR.IRExportVariableDeclaration);
        break;
      case IR.IRNodeType.ExportDefaultDeclaration:
        this.generateExportDefaultDeclaration(node as IR.IRExportDefaultDeclaration);
        break;
      case IR.IRNodeType.DynamicImport:
        this.generateDynamicImport(node as IR.IRDynamicImport);
        break;

      // Patterns
      case IR.IRNodeType.ArrayPattern:
        this.generateArrayPattern(node as IR.IRArrayPattern);
        break;
      case IR.IRNodeType.ObjectPattern:
        this.generateObjectPattern(node as IR.IRObjectPattern);
        break;
      case IR.IRNodeType.RestElement:
        this.generateRestElement(node as IR.IRRestElement);
        break;
      case IR.IRNodeType.AssignmentPattern:
        this.generateAssignmentPattern(node as IR.IRAssignmentPattern);
        break;

      // JS Interop
      case IR.IRNodeType.InteropIIFE:
        this.generateInteropIIFE(node as IR.IRInteropIIFE);
        break;
      case IR.IRNodeType.JsMethodAccess:
        this.generateJsMethodAccess(node as IR.IRJsMethodAccess);
        break;
      case IR.IRNodeType.JsImportReference:
        this.generateJsImportReference(node as IR.IRJsImportReference);
        break;

      // Skip comments
      case IR.IRNodeType.CommentBlock:
        break;

      // Raw JS - should not reach here
      case IR.IRNodeType.Raw:
        throw new CodeGenError(
          "Raw IR nodes should be handled before TypeScript generation",
          "Raw node generation",
          node
        );

      // TypeScript type declarations
      case IR.IRNodeType.TypeAliasDeclaration:
        this.generateTypeAliasDeclaration(node as IR.IRTypeAliasDeclaration);
        break;
      case IR.IRNodeType.InterfaceDeclaration:
        this.generateInterfaceDeclaration(node as IR.IRInterfaceDeclaration);
        break;

      // TypeScript advanced features
      case IR.IRNodeType.AbstractClassDeclaration:
        this.generateAbstractClassDeclaration(
          node as IR.IRAbstractClassDeclaration,
        );
        break;
      case IR.IRNodeType.AbstractMethod:
        this.generateAbstractMethod(node as IR.IRAbstractMethod);
        break;
      case IR.IRNodeType.FunctionOverload:
        this.generateFunctionOverload(node as IR.IRFunctionOverload);
        break;
      case IR.IRNodeType.DeclareStatement:
        this.generateDeclareStatement(node as IR.IRDeclareStatement);
        break;
      case IR.IRNodeType.NamespaceDeclaration:
        this.generateNamespaceDeclaration(node as IR.IRNamespaceDeclaration);
        break;
      case IR.IRNodeType.ConstEnumDeclaration:
        this.generateConstEnumDeclaration(node as IR.IRConstEnumDeclaration);
        break;
      case IR.IRNodeType.Decorator:
        this.generateDecorator(node as IR.IRDecorator);
        break;

      // Native TypeScript type expressions
      case IR.IRNodeType.TypeReference:
        this.generateTypeReference(node as IR.IRTypeReference);
        break;
      case IR.IRNodeType.KeyofType:
        this.generateKeyofType(node as IR.IRKeyofType);
        break;
      case IR.IRNodeType.IndexedAccessType:
        this.generateIndexedAccessType(node as IR.IRIndexedAccessType);
        break;
      case IR.IRNodeType.ConditionalType:
        this.generateConditionalType(node as IR.IRConditionalType);
        break;
      case IR.IRNodeType.MappedType:
        this.generateMappedType(node as IR.IRMappedType);
        break;
      case IR.IRNodeType.UnionType:
        this.generateUnionType(node as IR.IRUnionType);
        break;
      case IR.IRNodeType.IntersectionType:
        this.generateIntersectionType(node as IR.IRIntersectionType);
        break;
      case IR.IRNodeType.TupleType:
        this.generateTupleType(node as IR.IRTupleType);
        break;
      case IR.IRNodeType.ArrayType:
        this.generateArrayType(node as IR.IRArrayType);
        break;
      case IR.IRNodeType.FunctionTypeExpr:
        this.generateFunctionTypeExpr(node as IR.IRFunctionTypeExpr);
        break;
      case IR.IRNodeType.InferType:
        this.generateInferType(node as IR.IRInferType);
        break;
      case IR.IRNodeType.ReadonlyType:
        this.generateReadonlyType(node as IR.IRReadonlyType);
        break;
      case IR.IRNodeType.TypeofType:
        this.generateTypeofType(node as IR.IRTypeofType);
        break;
      case IR.IRNodeType.LiteralType:
        this.generateLiteralType(node as IR.IRLiteralType);
        break;
      case IR.IRNodeType.RestType:
        this.generateRestType(node as IR.IRRestType);
        break;
      case IR.IRNodeType.OptionalType:
        this.generateOptionalType(node as IR.IROptionalType);
        break;

      // Structural nodes - handled by parent generators, should never reach generateNode directly
      case IR.IRNodeType.Program:
      case IR.IRNodeType.ObjectProperty:
      case IR.IRNodeType.VariableDeclarator:
      case IR.IRNodeType.ImportSpecifier:
      case IR.IRNodeType.ImportNamespaceSpecifier:
      case IR.IRNodeType.ExportSpecifier:
      case IR.IRNodeType.SpreadAssignment:
      case IR.IRNodeType.ClassField:
      case IR.IRNodeType.ClassMethod:
      case IR.IRNodeType.ClassConstructor:
      case IR.IRNodeType.EnumCase:
      case IR.IRNodeType.CatchClause:
      case IR.IRNodeType.SwitchCase:
        throw new CodeGenError(
          `Structural node '${IR.IRNodeType[node.type]}' should not be passed to generateNode directly`,
          "generateNode",
          node
        );

      default:
        assertNever(node.type, `Unhandled IR node type: ${node.type}`);
    }
  }

  // ============================================================================
  // Literal Generators
  // ============================================================================

  private generateStringLiteral(node: IR.IRStringLiteral): void {
    const escaped = JSON.stringify(node.value);
    this.emit(escaped, node.position);
  }

  private generateNumericLiteral(node: IR.IRNumericLiteral): void {
    this.emit(String(node.value), node.position);
  }

  private generateBigIntLiteral(node: IR.IRBigIntLiteral): void {
    this.emit(node.value + "n", node.position);
  }

  // ============================================================================
  // TypeScript Type Declaration Generators
  // ============================================================================

  private generateTypeAliasDeclaration(
    node: IR.IRTypeAliasDeclaration & { typeExpression: string | IR.IRTypeExpression },
  ): void {
    this.emit("type ", node.position);
    this.emit(node.name);
    if (node.typeParameters && node.typeParameters.length > 0) {
      this.emit("<");
      this.emit(node.typeParameters.join(", "));
      this.emit(">");
    }
    this.emit(" = ");
    // Handle both string (passthrough) and IR type expressions
    if (typeof node.typeExpression === "string") {
      this.emit(node.typeExpression);
    } else {
      this.generateTypeExpression(node.typeExpression);
    }
    this.emit(";\n");
  }

  /**
   * Generate TypeScript code for a type expression IR node
   */
  private generateTypeExpression(node: IR.IRTypeExpression): void {
    switch (node.type) {
      case IR.IRNodeType.TypeReference:
        this.generateTypeReference(node as IR.IRTypeReference);
        break;
      case IR.IRNodeType.KeyofType:
        this.generateKeyofType(node as IR.IRKeyofType);
        break;
      case IR.IRNodeType.IndexedAccessType:
        this.generateIndexedAccessType(node as IR.IRIndexedAccessType);
        break;
      case IR.IRNodeType.ConditionalType:
        this.generateConditionalType(node as IR.IRConditionalType);
        break;
      case IR.IRNodeType.MappedType:
        this.generateMappedType(node as IR.IRMappedType);
        break;
      case IR.IRNodeType.UnionType:
        this.generateUnionType(node as IR.IRUnionType);
        break;
      case IR.IRNodeType.IntersectionType:
        this.generateIntersectionType(node as IR.IRIntersectionType);
        break;
      case IR.IRNodeType.TupleType:
        this.generateTupleType(node as IR.IRTupleType);
        break;
      case IR.IRNodeType.ArrayType:
        this.generateArrayType(node as IR.IRArrayType);
        break;
      case IR.IRNodeType.FunctionTypeExpr:
        this.generateFunctionTypeExpr(node as IR.IRFunctionTypeExpr);
        break;
      case IR.IRNodeType.InferType:
        this.generateInferType(node as IR.IRInferType);
        break;
      case IR.IRNodeType.ReadonlyType:
        this.generateReadonlyType(node as IR.IRReadonlyType);
        break;
      case IR.IRNodeType.TypeofType:
        this.generateTypeofType(node as IR.IRTypeofType);
        break;
      case IR.IRNodeType.LiteralType:
        this.generateLiteralType(node as IR.IRLiteralType);
        break;
      case IR.IRNodeType.RestType:
        this.generateRestType(node as IR.IRRestType);
        break;
      case IR.IRNodeType.OptionalType:
        this.generateOptionalType(node as IR.IROptionalType);
        break;
      default:
        assertNever(node, `Unhandled type expression: ${(node as IR.IRNode).type}`);
    }
  }

  // Type reference: Person, Array<T>
  private generateTypeReference(node: IR.IRTypeReference): void {
    this.emit(node.name, node.position);
    if (node.typeArguments && node.typeArguments.length > 0) {
      this.emit("<");
      for (let i = 0; i < node.typeArguments.length; i++) {
        if (i > 0) this.emit(", ");
        this.generateTypeExpression(node.typeArguments[i]);
      }
      this.emit(">");
    }
  }

  // keyof T
  private generateKeyofType(node: IR.IRKeyofType): void {
    this.emit("keyof ", node.position);
    this.generateTypeExpression(node.argument);
  }

  // T[K]
  private generateIndexedAccessType(node: IR.IRIndexedAccessType): void {
    this.generateTypeExpression(node.objectType);
    this.emit("[");
    this.generateTypeExpression(node.indexType);
    this.emit("]");
  }

  // T extends U ? X : Y
  private generateConditionalType(node: IR.IRConditionalType): void {
    this.generateTypeExpression(node.checkType);
    this.emit(" extends ");
    this.generateTypeExpression(node.extendsType);
    this.emit(" ? ");
    this.generateTypeExpression(node.trueType);
    this.emit(" : ");
    this.generateTypeExpression(node.falseType);
  }

  // { [K in T]: ValueType }
  private generateMappedType(node: IR.IRMappedType): void {
    this.emit("{ ");
    if (node.readonly === true || node.readonly === "+") {
      this.emit("readonly ");
    } else if (node.readonly === "-") {
      this.emit("-readonly ");
    }
    this.emit("[");
    this.emit(node.typeParameter);
    this.emit(" in ");
    this.generateTypeExpression(node.constraint);
    this.emit("]");
    if (node.optional === true || node.optional === "+") {
      this.emit("?");
    } else if (node.optional === "-") {
      this.emit("-?");
    }
    this.emit(": ");
    this.generateTypeExpression(node.valueType);
    this.emit(" }");
  }

  // Check if a type needs parentheses for precedence
  private needsParens(node: IR.IRTypeExpression, context: "union" | "array"): boolean {
    if (context === "union") {
      // In union context, intersection needs parens: (A & B) | C
      return node.type === IR.IRNodeType.IntersectionType;
    }
    if (context === "array") {
      // In array context, union/intersection/function/infer need parens: (A | B)[], (infer U)[]
      return node.type === IR.IRNodeType.UnionType ||
             node.type === IR.IRNodeType.IntersectionType ||
             node.type === IR.IRNodeType.FunctionTypeExpr ||
             node.type === IR.IRNodeType.InferType;
    }
    return false;
  }

  // A | B | C
  private generateUnionType(node: IR.IRUnionType): void {
    for (let i = 0; i < node.types.length; i++) {
      if (i > 0) this.emit(" | ");
      const t = node.types[i];
      if (this.needsParens(t, "union")) {
        this.emit("(");
        this.generateTypeExpression(t);
        this.emit(")");
      } else {
        this.generateTypeExpression(t);
      }
    }
  }

  // A & B & C
  private generateIntersectionType(node: IR.IRIntersectionType): void {
    for (let i = 0; i < node.types.length; i++) {
      if (i > 0) this.emit(" & ");
      this.generateTypeExpression(node.types[i]);
    }
  }

  // [A, B, C]
  private generateTupleType(node: IR.IRTupleType): void {
    this.emit("[");
    for (let i = 0; i < node.elements.length; i++) {
      if (i > 0) this.emit(", ");
      if (node.labels && node.labels[i]) {
        this.emit(node.labels[i]);
        this.emit(": ");
      }
      this.generateTypeExpression(node.elements[i]);
    }
    this.emit("]");
  }

  // T[]
  private generateArrayType(node: IR.IRArrayType): void {
    const elem = node.elementType;
    if (this.needsParens(elem, "array")) {
      this.emit("(");
      this.generateTypeExpression(elem);
      this.emit(")");
    } else {
      this.generateTypeExpression(elem);
    }
    this.emit("[]");
  }

  // (a: A, b: B) => R
  private generateFunctionTypeExpr(node: IR.IRFunctionTypeExpr): void {
    if (node.typeParameters && node.typeParameters.length > 0) {
      this.emit("<");
      this.emit(node.typeParameters.join(", "));
      this.emit(">");
    }
    this.emit("(");
    for (let i = 0; i < node.parameters.length; i++) {
      if (i > 0) this.emit(", ");
      const param = node.parameters[i];
      if (param.name) {
        this.emit(param.name);
        if (param.optional) this.emit("?");
        this.emit(": ");
      }
      this.generateTypeExpression(param.type);
    }
    this.emit(") => ");
    this.generateTypeExpression(node.returnType);
  }

  // infer T
  private generateInferType(node: IR.IRInferType): void {
    this.emit("infer ", node.position);
    this.emit(node.typeParameter);
  }

  // readonly T
  private generateReadonlyType(node: IR.IRReadonlyType): void {
    this.emit("readonly ", node.position);
    this.generateTypeExpression(node.argument);
  }

  // typeof x
  private generateTypeofType(node: IR.IRTypeofType): void {
    this.emit("typeof ", node.position);
    this.emit(node.expression);
  }

  // Literal type: "foo", 42, true
  private generateLiteralType(node: IR.IRLiteralType): void {
    if (typeof node.value === "string") {
      this.emit(JSON.stringify(node.value), node.position);
    } else {
      this.emit(String(node.value), node.position);
    }
  }

  // ...T
  private generateRestType(node: IR.IRRestType): void {
    this.emit("...", node.position);
    this.generateTypeExpression(node.argument);
  }

  // T?
  private generateOptionalType(node: IR.IROptionalType): void {
    this.generateTypeExpression(node.argument);
    this.emit("?");
  }

  private generateInterfaceDeclaration(node: IR.IRInterfaceDeclaration): void {
    this.emit("interface ", node.position);
    this.emit(node.name);
    if (node.typeParameters && node.typeParameters.length > 0) {
      this.emit("<");
      this.emit(node.typeParameters.join(", "));
      this.emit(">");
    }
    if (node.extends && node.extends.length > 0) {
      this.emit(" extends ");
      this.emit(node.extends.join(", "));
    }
    this.emit(" ");
    this.emit(node.body);
    this.emit("\n");
  }

  private generateAbstractClassDeclaration(
    node: IR.IRAbstractClassDeclaration,
  ): void {
    // Emit decorators if any
    if (node.decorators) {
      for (const decorator of node.decorators) {
        this.generateDecorator(decorator);
      }
    }

    this.emit("abstract class ", node.position);
    this.emit(node.id.name);

    if (node.typeParameters && node.typeParameters.length > 0) {
      this.emit("<");
      this.emit(node.typeParameters.join(", "));
      this.emit(">");
    }

    if (node.superClass) {
      this.emit(" extends ");
      this.generateNode(node.superClass);
    }

    this.emit(" {\n");

    for (const member of node.body) {
      this.emit("  ");
      this.generateNode(member);
      this.emit("\n");
    }

    this.emit("}\n");
  }

  private generateAbstractMethod(node: IR.IRAbstractMethod): void {
    this.emit("abstract ", node.position);
    this.generateNode(node.key);

    if (node.typeParameters && node.typeParameters.length > 0) {
      this.emit("<");
      this.emit(node.typeParameters.join(", "));
      this.emit(">");
    }

    this.emit("(");
    this.emit(node.params);
    this.emit(")");

    if (node.returnType) {
      this.emit(": ");
      this.emit(node.returnType);
    }

    this.emit(";");
  }

  private generateFunctionOverload(node: IR.IRFunctionOverload): void {
    this.emit("function ", node.position);
    this.emit(node.name);

    if (node.typeParameters && node.typeParameters.length > 0) {
      this.emit("<");
      this.emit(node.typeParameters.join(", "));
      this.emit(">");
    }

    this.emit("(");
    this.emit(node.params);
    this.emit("): ");
    this.emit(node.returnType);
    this.emit(";\n");
  }

  private generateDeclareStatement(node: IR.IRDeclareStatement): void {
    this.emit("declare ", node.position);
    this.emit(node.kind);
    this.emit(" ");
    this.emit(node.body);
    this.emit(";\n");
  }

  private generateNamespaceDeclaration(
    node: IR.IRNamespaceDeclaration,
  ): void {
    this.emit("namespace ", node.position);
    this.emit(node.name);
    this.emit(" {\n");

    for (const member of node.body) {
      this.emit("  ");
      this.generateNode(member);
      this.emit("\n");
    }

    this.emit("}\n");
  }

  private generateConstEnumDeclaration(
    node: IR.IRConstEnumDeclaration,
  ): void {
    this.emit("const enum ", node.position);
    this.emit(node.id.name);
    this.emit(" {\n");

    for (let i = 0; i < node.members.length; i++) {
      const member = node.members[i];
      this.emit("  ");
      this.emit(member.name);
      if (member.value !== undefined) {
        this.emit(" = ");
        if (typeof member.value === "string") {
          this.emit(JSON.stringify(member.value));
        } else {
          this.emit(String(member.value));
        }
      }
      if (i < node.members.length - 1) {
        this.emit(",");
      }
      this.emit("\n");
    }

    this.emit("}\n");
  }

  private generateDecorator(node: IR.IRDecorator): void {
    this.emit("@", node.position);
    this.generateNode(node.expression);
    this.emit("\n");
  }

  private generateBooleanLiteral(node: IR.IRBooleanLiteral): void {
    this.emit(String(node.value), node.position);
  }

  private generateTemplateLiteral(node: IR.IRTemplateLiteral): void {
    this.emit("`", node.position);
    for (let i = 0; i < node.quasis.length; i++) {
      const quasi = node.quasis[i] as IR.IRStringLiteral;
      // Don't JSON.stringify - emit raw template string content
      this.emit(quasi.value);
      if (i < node.expressions.length) {
        this.emit("${");
        this.generateInExpressionContext(node.expressions[i]);
        this.emit("}");
      }
    }
    this.emit("`");
  }

  // ============================================================================
  // Identifier Generator
  // ============================================================================

  private generateIdentifier(node: IR.IRIdentifier): void {
    // Track if this is a runtime helper
    this.trackHelper(node.name);
    // Pass original name for rich source maps (superiority feature)
    this.emit(node.name, node.position, node.originalName ?? node.name);
  }

  // ============================================================================
  // Expression Generators
  // ============================================================================

  private generateBinaryExpression(node: IR.IRBinaryExpression): void {
    const prec = getExprPrecedence(node);
    // For right-associative operators (like **), right operand uses same precedence
    // For left-associative operators, right operand uses higher precedence
    const rightPrec = isRightAssociative(node.operator) ? prec : prec + 1;

    // Arrow functions need explicit parentheses in binary expressions
    // because `(x) => x !== null` parses as `(x) => (x !== null)`, not `((x) => x) !== null`
    this.emitExprWithArrowParen(node.left, prec);
    this.emit(` ${node.operator} `, node.position);
    this.emitExprWithArrowParen(node.right, rightPrec);
  }

  /**
   * Emit an expression with precedence handling, plus explicit parens for arrow functions.
   * Arrow functions bind looser than binary operators in parsing, so they need explicit parens.
   */
  private emitExprWithArrowParen(node: IR.IRNode, contextPrec: Precedence): void {
    if (node.type === IR.IRNodeType.FunctionExpression) {
      this.emit("(");
      this.generateInExpressionContext(node);
      this.emit(")");
    } else {
      this.emitExpr(node, contextPrec);
    }
  }

  private generateUnaryExpression(node: IR.IRUnaryExpression): void {
    if (node.prefix !== false) {
      this.emit(node.operator, node.position);
      if (node.operator === "typeof" || node.operator === "void" || node.operator === "delete") {
        this.emit(" ");
      }
      // Function expressions need explicit parentheses after typeof/void/delete
      // because `typeof (x) => x` parses as `(typeof (x)) => x`, not `typeof ((x) => x)`
      const needsExplicitParens = node.argument.type === IR.IRNodeType.FunctionExpression;
      if (needsExplicitParens) {
        this.emit("(");
        this.generateInExpressionContext(node.argument);
        this.emit(")");
      } else {
        this.emitExpr(node.argument, Precedence.Unary);
      }
    } else {
      // Postfix operators (++, --)
      this.emitExpr(node.argument, Precedence.Postfix);
      this.emit(node.operator);
    }
  }

  private generateLogicalExpression(node: IR.IRLogicalExpression): void {
    const prec = getExprPrecedence(node);
    // Logical operators are left-associative, so right operand uses higher precedence
    const rightPrec = prec + 1;

    // Arrow functions need explicit parentheses in logical expressions
    this.emitExprWithArrowParen(node.left, prec);
    this.emit(` ${node.operator} `, node.position);
    this.emitExprWithArrowParen(node.right, rightPrec);
  }

  private generateConditionalExpression(node: IR.IRConditionalExpression): void {
    // Conditional is right-associative and has very low precedence
    // test ? consequent : alternate
    // test needs higher precedence than conditional
    // consequent and alternate can be lower (they're inside the ternary)
    this.emitExprWithArrowParen(node.test, Precedence.Conditional + 1);
    this.emit(" ? ", node.position);
    this.emitExprWithArrowParen(node.consequent, Precedence.Assignment);
    this.emit(" : ");
    this.emitExprWithArrowParen(node.alternate, Precedence.Conditional);
  }

  private generateCallExpression(node: IR.IRCallExpression): void {
    // Check if this is a call to a mutual recursion function from outside the group
    const calleeName = node.callee.type === IR.IRNodeType.Identifier
      ? (node.callee as IR.IRIdentifier).name
      : null;
    const shouldWrapWithTrampoline = calleeName !== null &&
      this.mutualRecursionFunctions.has(calleeName) &&
      !this.insideMutualRecursionFunction;

    if (shouldWrapWithTrampoline) {
      // Wrap with trampoline: __hql_trampoline(() => fn(args))
      this.usedHelpers.add("__hql_trampoline");
      this.emit("__hql_trampoline(() => ");
    }

    // If callee is a function/class expression or declaration, wrap it in parentheses for IIFE
    // Cast to number for comparison since callee type might be a declaration type
    const calleeType = node.callee.type as unknown as number;
    const needsParens = calleeType === IR.IRNodeType.FunctionExpression ||
                        calleeType === IR.IRNodeType.FnFunctionDeclaration ||
                        calleeType === IR.IRNodeType.ClassDeclaration;

    if (needsParens) this.emit("(");
    this.generateInExpressionContext(node.callee);
    if (needsParens) this.emit(")");

    this.emit("(", node.position);
    this.emitCommaSeparated(node.arguments, (arg) => this.generateInExpressionContext(arg));
    this.emit(")");

    if (shouldWrapWithTrampoline) {
      this.emit(")");
    }
  }

  private generateMemberExpression(node: IR.IRMemberExpression): void {
    this.generateInExpressionContext(node.object);
    if (node.computed) {
      this.emit("[", node.position);
      this.generateInExpressionContext(node.property);
      this.emit("]");
    } else {
      this.emit(".", node.position);
      this.generateInExpressionContext(node.property);
    }
  }

  /**
   * Generate optional member expression: obj?.prop or obj?.["key"]
   */
  private generateOptionalMemberExpression(node: IR.IROptionalMemberExpression): void {
    this.generateInExpressionContext(node.object);
    if (node.computed) {
      this.emit("?.[", node.position);
      this.generateInExpressionContext(node.property);
      this.emit("]");
    } else {
      this.emit("?.", node.position);
      this.generateInExpressionContext(node.property);
    }
  }

  /**
   * Generate optional call expression: func?.() or obj.method?.()
   */
  private generateOptionalCallExpression(node: IR.IROptionalCallExpression): void {
    this.generateInExpressionContext(node.callee);
    this.emit("?.(", node.position);
    this.emitCommaSeparated(node.arguments, (arg) => this.generateInExpressionContext(arg));
    this.emit(")");
  }

  private generateCallMemberExpression(node: IR.IRCallMemberExpression): void {
    this.generateInExpressionContext(node.object);
    this.emit(".", node.position);
    this.generateInExpressionContext(node.property);
    this.emit("(");
    this.emitCommaSeparated(node.arguments, (arg) => this.generateInExpressionContext(arg));
    this.emit(")");
  }

  private generateNewExpression(node: IR.IRNewExpression): void {
    this.emit("new ", node.position);
    this.generateInExpressionContext(node.callee);
    this.emit("(");
    this.emitCommaSeparated(node.arguments, (arg) => this.generateInExpressionContext(arg));
    this.emit(")");
  }

  private generateArrayExpression(node: IR.IRArrayExpression): void {
    this.emit("[", node.position);
    this.emitCommaSeparated(node.elements, (elem) => this.generateInExpressionContext(elem));
    this.emit("]");
  }

  /**
   * Generate comma operator expression: (expr1, expr2, expr3)
   * Returns the value of the last expression.
   */
  private generateSequenceExpression(node: IR.IRSequenceExpression): void {
    this.emit("(", node.position);
    this.emitCommaSeparated(node.expressions, (expr) => this.generateInExpressionContext(expr));
    this.emit(")");
  }

  private generateObjectExpression(node: IR.IRObjectExpression): void {
    if (node.properties.length === 0) {
      this.emit("{}", node.position);
      return;
    }

    this.emit("{ ", node.position);
    for (let i = 0; i < node.properties.length; i++) {
      if (i > 0) this.emit(", ");
      const prop = node.properties[i];
      if (prop.type === IR.IRNodeType.SpreadAssignment) {
        const spread = prop as IR.IRSpreadAssignment;
        this.emit("...");
        this.generateInExpressionContext(spread.expression);
      } else {
        const objProp = prop as IR.IRObjectProperty;
        if (objProp.computed) {
          this.emit("[");
          this.generateInExpressionContext(objProp.key);
          this.emit("]");
        } else {
          this.generateInExpressionContext(objProp.key);
        }
        this.emit(": ");
        this.generateInExpressionContext(objProp.value);
      }
    }
    this.emit(" }");
  }

  private generateFunctionExpression(node: IR.IRFunctionExpression): void {
    // Generators MUST use function* syntax (arrow functions can't be generators)
    if (node.generator) {
      if (node.async) {
        this.emit("async ", node.position);
      }
      this.emit("function*(");
      this.generateFnParams(node.params, undefined);
      this.emit(")");
      if (node.returnType) {
        this.emit(`: ${node.returnType}`);
      }
      this.emit(" ");
      this.generateBlockStatement(node.body);
      return;
    }

    // If the function uses 'this', generate a regular function expression
    // to preserve the dynamic 'this' binding (arrow functions capture lexical 'this')
    if (node.usesThis) {
      if (node.async) {
        this.emit("async ", node.position);
      }
      this.emit("function(");
      this.generateFnParams(node.params, undefined);
      this.emit(")");
      if (node.returnType) {
        this.emit(`: ${node.returnType}`);
      }
      this.emit(" ");
      this.generateBlockStatement(node.body);
      return;
    }

    // Use arrow function syntax for anonymous functions
    if (node.async) {
      this.emit("async ", node.position);
    }
    this.emit("(");
    this.generateFnParams(node.params, undefined);
    this.emit(")");

    // Add return type annotation if present
    if (node.returnType) {
      this.emit(`: ${node.returnType}`);
    }

    this.emit(" => ");

    // Check if body is a single return statement - use expression form
    if (node.body.body.length === 1 && node.body.body[0].type === IR.IRNodeType.ReturnStatement) {
      const ret = node.body.body[0] as IR.IRReturnStatement;

      // Push a hoisting scope for the arrow function body
      this.hoistingStack.push(new Set());
      this.collectHoistableNames(ret.argument, true);

      const arrowHoisted = this.currentHoistingSet();
      if (arrowHoisted.size > 0) {
        // If there are hoisted names, we need a block body
        this.emit("{\n");
        this.indent();
        this.emitIndent();
        this.emit(`let ${[...arrowHoisted].join(", ")};\n`);
        this.emitIndent();
        this.emit("return ");
        this.generateInExpressionContext(ret.argument);
        this.emit(";\n");
        this.dedent();
        this.emitIndent();
        this.emit("}");
      } else {
        // No hoisting needed, use concise expression body
        this.generateNode(ret.argument);
      }

      this.hoistingStack.pop();
    } else {
      this.generateBlockStatement(node.body);
    }
  }

  private generateAssignmentExpression(node: IR.IRAssignmentExpression): void {
    // Assignment is right-associative, so right side uses same precedence
    this.emitExpr(node.left, Precedence.Assignment);
    this.emit(` ${node.operator} `, node.position);
    this.emitExpr(node.right, Precedence.Assignment);
  }

  private generateAwaitExpression(node: IR.IRAwaitExpression): void {
    this.emit("await ", node.position);
    // await has unary precedence
    this.emitExpr(node.argument, Precedence.Unary);
  }

  private generateYieldExpression(node: IR.IRYieldExpression): void {
    if (node.delegate) {
      this.emit("yield* ", node.position);
    } else {
      this.emit("yield", node.position);
      if (node.argument) {
        this.emit(" ");
      }
    }
    if (node.argument) {
      // yield has assignment-level precedence
      this.emitExpr(node.argument, Precedence.Assignment);
    }
  }

  private generateSpreadElement(node: IR.IRSpreadElement): void {
    this.emit("...", node.position);
    // spread needs assignment precedence for the argument
    this.emitExpr(node.argument, Precedence.Assignment);
  }

  // ============================================================================
  // Statement Generators
  // ============================================================================

  private generateExpressionStatement(node: IR.IRExpressionStatement): void {
    this.emitIndent();
    // Wrap object expressions in parentheses to disambiguate from block statements
    // JavaScript/TypeScript treats `{...}` at statement level as a block, not an object literal
    const needsParens = node.expression.type === IR.IRNodeType.ObjectExpression;
    if (needsParens) this.emit("(");
    this.generateInExpressionContext(node.expression);
    if (needsParens) this.emit(")");
    this.emit(";\n");
  }

  private generateBlockStatement(node: IR.IRBlockStatement): void {
    // When entering a block, we're no longer at top level
    const wasTopLevel = this.isTopLevel;
    this.isTopLevel = false;

    // Push new hoisting scope for this block
    this.hoistingStack.push(new Set());

    // Collect hoistable names for this block
    for (const stmt of node.body) {
      this.collectHoistableNames(stmt, false);
    }

    this.emit("{\n", node.position);
    this.indent();

    // Emit hoisted declarations for this block (if any)
    const blockHoisted = this.currentHoistingSet();
    if (blockHoisted.size > 0) {
      this.emitIndent();
      this.emit(`let ${[...blockHoisted].join(", ")};\n`);
    }

    // Generate statements
    for (const stmt of node.body) {
      this.generateNode(stmt);
    }

    this.dedent();
    this.emitIndent();
    this.emit("}");

    // Pop hoisting scope and restore top level status
    this.hoistingStack.pop();
    this.isTopLevel = wasTopLevel;
  }

  private generateReturnStatement(node: IR.IRReturnStatement): void {
    this.emitIndent();
    this.emit("return ", node.position);
    this.generateInExpressionContext(node.argument);
    this.emit(";\n");
  }

  private generateIfStatement(node: IR.IRIfStatement): void {
    this.emitIndent();
    this.emit("if (", node.position);
    this.generateInExpressionContext(node.test);
    this.emit(") ");

    if (node.consequent.type === IR.IRNodeType.BlockStatement) {
      this.generateBlockStatement(node.consequent as IR.IRBlockStatement);
    } else {
      this.emit("{\n");
      this.indent();
      this.generateNode(node.consequent);
      this.dedent();
      this.emitIndent();
      this.emit("}");
    }

    if (node.alternate) {
      this.emit(" else ");
      if (node.alternate.type === IR.IRNodeType.IfStatement) {
        // else if - don't add braces
        this.generateNode(node.alternate);
        return;
      } else if (node.alternate.type === IR.IRNodeType.BlockStatement) {
        this.generateBlockStatement(node.alternate as IR.IRBlockStatement);
      } else {
        this.emit("{\n");
        this.indent();
        this.generateNode(node.alternate);
        this.dedent();
        this.emitIndent();
        this.emit("}");
      }
    }
    this.emit("\n");
  }

  private generateWhileStatement(node: IR.IRWhileStatement): void {
    this.emitIndent();
    this.emit("while (", node.position);
    this.generateInExpressionContext(node.test);
    this.emit(") ");
    this.generateBlockStatement(node.body);
    this.emit("\n");
  }

  private generateForStatement(node: IR.IRForStatement): void {
    this.emitIndent();
    this.emit("for (", node.position);
    if (node.init) {
      if (node.init.type === IR.IRNodeType.VariableDeclaration) {
        this.generateVariableDeclarationInline(node.init as IR.IRVariableDeclaration);
      } else {
        this.generateInExpressionContext(node.init);
      }
    }
    this.emit("; ");
    if (node.test) {
      this.generateInExpressionContext(node.test);
    }
    this.emit("; ");
    if (node.update) {
      this.generateInExpressionContext(node.update);
    }
    this.emit(") ");
    this.generateBlockStatement(node.body);
    this.emit("\n");
  }

  private generateForOfStatement(node: IR.IRForOfStatement): void {
    this.emitIndent();
    if (node.await) {
      this.emit("for await (", node.position);
    } else {
      this.emit("for (", node.position);
    }
    this.generateVariableDeclarationInline(node.left);
    this.emit(" of ");
    this.generateInExpressionContext(node.right);
    this.emit(") ");
    this.generateBlockStatement(node.body);
    this.emit("\n");
  }

  private generateSwitchStatement(node: IR.IRSwitchStatement): void {
    this.emitIndent();
    this.emit("switch (", node.position);
    this.generateInExpressionContext(node.discriminant);
    this.emit(") {\n");
    this.indent();

    for (const caseNode of node.cases) {
      this.emitIndent();
      if (caseNode.test === null) {
        this.emit("default:\n");
      } else {
        this.emit("case ");
        this.generateInExpressionContext(caseNode.test);
        this.emit(":\n");
      }

      this.indent();
      for (const stmt of caseNode.consequent) {
        this.generateNode(stmt);
        // Add newline after expression statements if needed
        if (stmt.type !== IR.IRNodeType.BlockStatement &&
            stmt.type !== IR.IRNodeType.IfStatement &&
            stmt.type !== IR.IRNodeType.WhileStatement &&
            stmt.type !== IR.IRNodeType.ForStatement &&
            stmt.type !== IR.IRNodeType.ForOfStatement) {
          // Already has newline from ExpressionStatement
        }
      }
      // Add break unless fallthrough is specified
      if (!caseNode.fallthrough) {
        this.emitIndent();
        this.emit("break;\n");
      }
      this.dedent();
    }

    this.dedent();
    this.emitIndent();
    this.emit("}\n");
  }

  private generateLabeledStatement(node: IR.IRLabeledStatement): void {
    this.emitIndent();
    this.emit(`${node.label}: `, node.position);
    // Generate the body directly (no newline before the statement)
    // We need to handle the body inline since we already emitted the label
    const body = node.body;
    if (body.type === IR.IRNodeType.WhileStatement) {
      // Generate while without indentation since label handles it
      const whileNode = body as IR.IRWhileStatement;
      this.emit("while (");
      this.generateInExpressionContext(whileNode.test);
      this.emit(") ");
      this.generateBlockStatement(whileNode.body);
      this.emit("\n");
    } else if (body.type === IR.IRNodeType.ForOfStatement) {
      const forOf = body as IR.IRForOfStatement;
      if (forOf.await) {
        this.emit("for await (");
      } else {
        this.emit("for (");
      }
      this.generateVariableDeclarationInline(forOf.left);
      this.emit(" of ");
      this.generateInExpressionContext(forOf.right);
      this.emit(") ");
      this.generateBlockStatement(forOf.body);
      this.emit("\n");
    } else if (body.type === IR.IRNodeType.ForStatement) {
      const forNode = body as IR.IRForStatement;
      this.emit("for (");
      if (forNode.init) {
        if (forNode.init.type === IR.IRNodeType.VariableDeclaration) {
          this.generateVariableDeclarationInline(forNode.init as IR.IRVariableDeclaration);
        } else {
          this.generateInExpressionContext(forNode.init);
        }
      }
      this.emit("; ");
      if (forNode.test) {
        this.generateInExpressionContext(forNode.test);
      }
      this.emit("; ");
      if (forNode.update) {
        this.generateInExpressionContext(forNode.update);
      }
      this.emit(") ");
      this.generateBlockStatement(forNode.body);
      this.emit("\n");
    } else if (body.type === IR.IRNodeType.BlockStatement) {
      this.generateBlockStatement(body as IR.IRBlockStatement);
      this.emit("\n");
    } else {
      // For other statements, generate them normally
      this.generateNode(body);
    }
  }

  private generateThrowStatement(node: IR.IRThrowStatement): void {
    if (this.inExpressionContext) {
      this.emit("((() => { throw ", node.position);
      this.generateInExpressionContext(node.argument);
      this.emit("; })())");
    } else {
      this.emitIndent();
      this.emit("throw ", node.position);
      this.generateInExpressionContext(node.argument);
      this.emit(";\n");
    }
  }

  private generateContinueStatement(node: IR.IRContinueStatement): void {
    this.emitIndent();
    this.emit("continue", node.position);
    if (node.label) {
      this.emit(` ${node.label}`);
    }
    this.emit(";\n");
  }

  private generateBreakStatement(node: IR.IRBreakStatement): void {
    this.emitIndent();
    this.emit("break", node.position);
    if (node.label) {
      this.emit(` ${node.label}`);
    }
    this.emit(";\n");
  }

  private generateTryStatement(node: IR.IRTryStatement): void {
    this.emitIndent();
    this.emit("try ", node.position);
    this.generateBlockStatement(node.block);

    if (node.handler) {
      this.emit(" catch ");
      if (node.handler.param) {
        this.emit("(");
        this.generateIdentifier(node.handler.param);
        this.emit(") ");
      }
      this.generateBlockStatement(node.handler.body);
    }

    if (node.finalizer) {
      this.emit(" finally ");
      this.generateBlockStatement(node.finalizer);
    }
    this.emit("\n");
  }

  // ============================================================================
  // Declaration Generators
  // ============================================================================

  private generateVariableDeclaration(node: IR.IRVariableDeclaration): void {
    // Check if this variable should use expression syntax (was hoisted)
    if (this.isSimpleBinding(node)) {
      const id = node.declarations[0].id as IR.IRIdentifier;
      const currentScope = this.hoistingStack.length > 0
        ? this.currentHoistingSet()
        : null;

      // If hoisted in current block scope OR at top-level, use assignment expression
      if (currentScope?.has(id.name) || (this.isTopLevel && this.topLevelBindingNames.has(id.name))) {
        this.generateVariableAsAssignment(node);
        return;
      }
    }

    // Standard declaration for non-hoisted variables and destructuring patterns
    this.emitIndent();
    this.emit(`${node.kind} `, node.position);
    for (let i = 0; i < node.declarations.length; i++) {
      if (i > 0) this.emit(", ");
      this.generateVariableDeclarator(node.declarations[i]);
    }
    this.emit(";\n");
  }

  /**
   * Generate a simple variable binding as an assignment expression.
   * Used for hoisted bindings to make them return values.
   *
   * In statement context (inExpressionContext=false):
   *   Example: (let x 10) → (x = 10); with indent and newline
   *
   * In expression context (inExpressionContext=true):
   *   Example: (if (let x true) ...) → just (x = true) as pure expression
   */
  private generateVariableAsAssignment(node: IR.IRVariableDeclaration): void {
    const decl = node.declarations[0];
    const id = decl.id as IR.IRIdentifier;

    // In expression context, emit just the assignment expression
    // without indentation, semicolon, or newline
    if (!this.inExpressionContext) {
      this.emitIndent();
    }
    this.emit("(", node.position);
    this.emit(id.name);
    this.emit(" = ");
    if (decl.init) {
      // The initializer is always in expression context
      this.generateInExpressionContext(decl.init);
    } else {
      this.emit("undefined");
    }
    this.emit(")");
    if (!this.inExpressionContext) {
      this.emit(";\n");
    }
  }

  private generateVariableDeclarationInline(node: IR.IRVariableDeclaration): void {
    this.emit(`${node.kind} `, node.position);
    for (let i = 0; i < node.declarations.length; i++) {
      if (i > 0) this.emit(", ");
      this.generateVariableDeclarator(node.declarations[i]);
    }
  }

  private generateVariableDeclarator(node: IR.IRVariableDeclarator): void {
    this.generatePattern(node.id);

    // Add type annotation if present
    if (node.typeAnnotation) {
      this.emit(`: ${node.typeAnnotation}`);
    }

    if (node.init) {
      this.emit(" = ");
      this.generateNode(node.init);
    }
  }

  private generateFunctionDeclaration(node: IR.IRFunctionDeclaration): void {
    this.emitIndent();
    if (node.async) {
      this.emit("async ", node.position);
    }
    this.emit("function ");
    this.generateIdentifier(node.id);

    // Add generic type parameters if present
    if (node.typeParameters && node.typeParameters.length > 0) {
      this.emit("<");
      this.emit(node.typeParameters.join(", "));
      this.emit(">");
    }

    this.emit("(");
    this.generateFnParams(node.params);
    this.emit(")");

    // Add return type annotation if present
    if (node.returnType) {
      this.emit(`: ${node.returnType}`);
    }

    this.emit(" ");
    this.generateBlockStatement(node.body);
    this.emit("\n");
  }

  private generateFnFunctionDeclaration(node: IR.IRFnFunctionDeclaration): void {
    // Debug comment: show HQL origin (superiority feature)
    this.emitDebugComment(node.position, `(fn ${node.id.name} ...)`);

    // Apply Tail Call Optimization for self-recursive functions
    // (Note: Mutual TCO is already applied at module level in generate())
    const optimizedNode = applyTCO(node);

    // Track if we're inside a mutual recursion function
    const wasInsideMutualRecursion = this.insideMutualRecursionFunction;
    if (this.mutualRecursionFunctions.has(optimizedNode.id.name)) {
      this.insideMutualRecursionFunction = true;
    }

    // Check if this function was hoisted (appears in expression context)
    const currentScope = this.hoistingStack.length > 0 ? this.currentHoistingSet() : null;
    const isHoisted = currentScope?.has(optimizedNode.id.name) ||
                      (this.isTopLevel && this.topLevelBindingNames.has(optimizedNode.id.name));

    // Expression-everywhere: hoisted functions become assignment expressions
    if (isHoisted) {
      this.generateFnAsAssignment(optimizedNode);
      this.insideMutualRecursionFunction = wasInsideMutualRecursion;
      return;
    }

    // Standard function declaration for non-hoisted nested scopes
    this.emitIndent();
    if (optimizedNode.async) {
      this.emit("async ", optimizedNode.position);
    }
    if (optimizedNode.generator) {
      this.emit("function* ");
    } else {
      this.emit("function ");
    }
    this.generateIdentifier(optimizedNode.id);

    // Add generic type parameters if present
    if (optimizedNode.typeParameters && optimizedNode.typeParameters.length > 0) {
      this.emit("<");
      this.emit(optimizedNode.typeParameters.join(", "));
      this.emit(">");
    }

    this.emit("(");
    if (optimizedNode.usesJsonMapParams) {
      // Generate object destructuring for JSON map parameters
      this.generateJsonMapParams(optimizedNode.params, optimizedNode.defaults);
    } else {
      this.generateFnParams(optimizedNode.params, this.buildDefaultsMap(optimizedNode.defaults));
    }
    this.emit(")");

    // Add return type annotation if present
    if (optimizedNode.returnType) {
      this.emit(`: ${optimizedNode.returnType}`);
    }

    this.emit(" ");
    this.generateBlockStatement(optimizedNode.body);
    this.emit("\n");

    // Restore mutual recursion tracking
    this.insideMutualRecursionFunction = wasInsideMutualRecursion;
  }

  /**
   * Generate a named function as an assignment expression.
   * Used for hoisted fn definitions to make them return the function value.
   * Example: (fn add [a b] (+ a b)) → (add = function add(a, b) { return a + b; });
   *
   * In expression context: just (name = function...) without indent/semicolon
   * In statement context: with indent and semicolon
   */
  private generateFnAsAssignment(node: IR.IRFnFunctionDeclaration): void {
    if (!this.inExpressionContext) {
      this.emitIndent();
    }
    this.emit("(", node.position);
    this.emit(node.id.name);
    this.emit(" = ");

    // Generate function expression
    if (node.async) {
      this.emit("async ");
    }
    if (node.generator) {
      this.emit("function* ");
    } else {
      this.emit("function ");
    }
    this.emit(node.id.name);  // Keep the function name for stack traces

    // Add generic type parameters if present
    if (node.typeParameters && node.typeParameters.length > 0) {
      this.emit("<");
      this.emit(node.typeParameters.join(", "));
      this.emit(">");
    }

    this.emit("(");
    if (node.usesJsonMapParams) {
      this.generateJsonMapParams(node.params, node.defaults);
    } else {
      this.generateFnParams(node.params, this.buildDefaultsMap(node.defaults));
    }
    this.emit(")");

    // Add return type annotation if present
    if (node.returnType) {
      this.emit(`: ${node.returnType}`);
    }

    this.emit(" ");
    this.generateBlockStatement(node.body);
    this.emit(")");

    if (!this.inExpressionContext) {
      this.emit(";\n");
    }
  }

  private generateClassDeclaration(node: IR.IRClassDeclaration): void {
    // Debug comment: show HQL origin (superiority feature)
    this.emitDebugComment(node.position, `(class ${node.id.name} ...)`);

    // Check if this class was hoisted (appears in expression context)
    const currentScope = this.hoistingStack.length > 0 ? this.currentHoistingSet() : null;
    const isHoisted = currentScope?.has(node.id.name) ||
                      (this.isTopLevel && this.topLevelBindingNames.has(node.id.name));

    // Expression-everywhere: hoisted classes become assignment expressions
    if (isHoisted) {
      this.generateClassAsAssignment(node);
      return;
    }

    // Standard class declaration for non-hoisted nested scopes
    this.emitIndent();
    this.emit("class ", node.position);
    this.generateIdentifier(node.id);
    // Emit generic type parameters if present (e.g., <T, K extends string>)
    if (node.typeParameters && node.typeParameters.length > 0) {
      this.emit("<");
      this.emit(node.typeParameters.join(", "));
      this.emit(">");
    }
    this.emit(" {\n");
    this.indent();
    this.generateClassBody(node);
    this.dedent();
    this.emitIndent();
    this.emit("}\n");
  }

  /**
   * Generate a class as an assignment expression.
   * Used for hoisted class definitions to make them return the class value.
   * Example: (class Point ...) → (Point = class Point { ... });
   *
   * In expression context: just (name = class...) without indent/semicolon
   * In statement context: with indent and semicolon
   */
  private generateClassAsAssignment(node: IR.IRClassDeclaration): void {
    if (!this.inExpressionContext) {
      this.emitIndent();
    }
    this.emit("(", node.position);
    this.emit(node.id.name);
    this.emit(" = class ");
    this.emit(node.id.name);  // Keep the class name
    // Emit generic type parameters if present (e.g., <T, K extends string>)
    if (node.typeParameters && node.typeParameters.length > 0) {
      this.emit("<");
      this.emit(node.typeParameters.join(", "));
      this.emit(">");
    }
    this.emit(" {\n");
    this.indent();
    this.generateClassBody(node);
    this.dedent();
    this.emitIndent();
    this.emit("})");

    if (!this.inExpressionContext) {
      this.emit(";\n");
    }
  }

  /**
   * Generate the body of a class (fields, constructor, methods).
   * Extracted for reuse between generateClassDeclaration and generateClassAsAssignment.
   */
  private generateClassBody(node: IR.IRClassDeclaration): void {
    // Fields
    for (const field of node.fields) {
      this.generateClassField(field);
    }

    // Constructor
    if (node.constructor) {
      this.generateClassConstructor(node.constructor);
    }

    // Methods
    for (const method of node.methods) {
      this.generateClassMethod(method);
    }
  }

  private generateClassField(field: IR.IRClassField): void {
    this.emitIndent();
    if (field.isStatic) {
      this.emit("static ");
    }
    // Private fields use # prefix
    if (field.isPrivate) {
      this.emit("#");
    }
    this.emit(field.name, field.position);

    // Add type annotation if present
    if (field.typeAnnotation) {
      this.emit(`: ${field.typeAnnotation}`);
    }

    if (field.initialValue) {
      this.emit(" = ");
      this.generateInExpressionContext(field.initialValue);
    }
    this.emit(";\n");
  }

  private generateClassConstructor(ctor: IR.IRClassConstructor): void {
    this.emitIndent();
    this.emit("constructor(", ctor.position);
    this.generateFnParams(ctor.params);
    this.emit(") ");
    this.generateBlockStatement(ctor.body);
    this.emit("\n");
  }

  private generateClassMethod(method: IR.IRClassMethod): void {
    this.emitIndent();
    if (method.isStatic) {
      this.emit("static ");
    }
    // Handle getter/setter
    if (method.kind === "get") {
      this.emit("get ");
    } else if (method.kind === "set") {
      this.emit("set ");
    }
    this.emit(method.name, method.position);

    // Add generic type parameters if present
    if (method.typeParameters && method.typeParameters.length > 0) {
      this.emit("<");
      this.emit(method.typeParameters.join(", "));
      this.emit(">");
    }

    // For methods with JSON map parameters, accept single options object with proper typing
    if (method.hasJsonParams) {
      const defaultsMap = this.buildDefaultsMap(method.defaults);
      const optsType = this.buildJsonParamsType(method.params, defaultsMap);
      this.emit(`(__opts: ${optsType} = {})`);
    } else {
      this.emit("(");
      this.generateFnParams(method.params, this.buildDefaultsMap(method.defaults));
      this.emit(")");
    }

    // Add return type annotation if present
    if (method.returnType) {
      this.emit(`: ${method.returnType}`);
    }

    this.emit(" ");

    // For JSON map params, inject validation and destructuring at start of body
    if (method.hasJsonParams && method.params.length > 0) {
      this.emit("{\n");
      this.indent();

      // Runtime validation: throw clear error if non-object is passed
      this.emitIndent();
      this.emit("if (__opts !== null && typeof __opts !== \"undefined\" && (typeof __opts !== \"object\" || Array.isArray(__opts))) {\n");
      this.indent();
      this.emitIndent();
      this.emit(`throw new TypeError("${method.name}: expected object argument, got " + typeof __opts);\n`);
      this.dedent();
      this.emitIndent();
      this.emit("}\n");

      // Generate: const { param1 = default1, param2 = default2, ... } = __opts;
      this.emitIndent();
      this.emit("const { ");
      const defaultsMap = this.buildDefaultsMap(method.defaults);
      method.params.forEach((param, idx) => {
        if (idx > 0) this.emit(", ");
        const paramName = (param as IR.IRIdentifier).name;
        this.emit(paramName);
        const defaultVal = defaultsMap.get(paramName);
        if (defaultVal) {
          this.emit(" = ");
          this.generateNode(defaultVal);
        }
      });
      this.emit(" } = __opts ?? {};\n");

      // Generate the original body statements (without the outer braces)
      for (const stmt of method.body.body) {
        this.generateNode(stmt);
      }

      this.dedent();
      this.emitIndent();
      this.emit("}");
    } else {
      this.generateBlockStatement(method.body);
    }
    this.emit("\n");
  }

  private generateEnumDeclaration(node: IR.IREnumDeclaration): void {
    // Debug comment: show HQL origin (superiority feature)
    this.emitDebugComment(node.position, `(enum ${node.id.name} ...)`);

    // Check if this enum was hoisted (appears in expression context)
    const currentScope = this.hoistingStack.length > 0 ? this.currentHoistingSet() : null;
    const isHoisted = currentScope?.has(node.id.name) ||
                      (this.isTopLevel && this.topLevelBindingNames.has(node.id.name));

    // Expression-everywhere: hoisted enums become assignment expressions
    if (isHoisted) {
      if (node.hasAssociatedValues) {
        this.generateEnumWithAssociatedValues(node, true);
      } else {
        this.generateSimpleEnum(node, true);
      }
      return;
    }

    // Standard enum generation for non-hoisted nested scopes
    if (node.hasAssociatedValues) {
      this.generateEnumWithAssociatedValues(node);
    } else {
      this.generateSimpleEnum(node);
    }
  }

  /**
   * Generate a simple enum, optionally as an assignment expression.
   * Regular: const Name = Object.freeze({ ... });
   * Assignment: (Name = Object.freeze({ ... }));
   *
   * When asAssignment=true and in expression context: just (name = ...) without indent/semicolon
   * When asAssignment=true and in statement context: with indent and semicolon
   */
  private generateSimpleEnum(node: IR.IREnumDeclaration, asAssignment = false): void {
    if (asAssignment) {
      if (!this.inExpressionContext) this.emitIndent();
      this.emit("(", node.position);
      this.emit(node.id.name);
      this.emit(" = Object.freeze({\n");
    } else {
      this.emitIndent();
      this.emit("const ", node.position);
      this.generateIdentifier(node.id);
      this.emit(" = Object.freeze({\n");
    }

    this.indent();
    this.generateEnumCases(node);
    this.dedent();
    this.emitIndent();

    if (asAssignment) {
      this.emit("}))");
      if (!this.inExpressionContext) this.emit(";\n");
    } else {
      this.emit("});\n");
    }
  }

  /**
   * Generate enum cases for both regular and assignment-style enums.
   */
  private generateEnumCases(node: IR.IREnumDeclaration): void {
    for (let i = 0; i < node.cases.length; i++) {
      const enumCase = node.cases[i];
      this.emitIndent();
      this.emit(enumCase.id.name);
      this.emit(": ");
      if (enumCase.rawValue) {
        this.generateInExpressionContext(enumCase.rawValue);
      } else {
        // Simple enums use case name as value (string)
        this.emit(JSON.stringify(enumCase.id.name));
      }
      if (i < node.cases.length - 1) {
        this.emit(",");
      }
      this.emit("\n");
    }
  }

  /**
   * Generate an enum with associated values, optionally as an assignment expression.
   * Regular: class Name { ... }
   * Assignment: (Name = class Name { ... });
   *
   * When asAssignment=true and in expression context: just (name = ...) without indent/semicolon
   * When asAssignment=true and in statement context: with indent and semicolon
   */
  private generateEnumWithAssociatedValues(node: IR.IREnumDeclaration, asAssignment = false): void {
    const enumName = node.id.name;

    if (asAssignment) {
      if (!this.inExpressionContext) this.emitIndent();
      this.emit("(", node.position);
      this.emit(enumName);
      this.emit(" = class ");
      this.emit(enumName);
      this.emit(" {\n");
    } else {
      this.emitIndent();
      this.emit("class ", node.position);
      this.emit(enumName);
      this.emit(" {\n");
    }

    this.indent();
    this.generateEnumClassBody(node);
    this.dedent();
    this.emitIndent();

    if (asAssignment) {
      this.emit("})");
      if (!this.inExpressionContext) this.emit(";\n");
    } else {
      this.emit("}\n");
    }
  }

  /**
   * Generate the body of an enum class (for enums with associated values).
   */
  private generateEnumClassBody(node: IR.IREnumDeclaration): void {
    const enumName = node.id.name;

    // Generate instance properties
    this.emitIndent();
    this.emit("type;\n");
    this.emitIndent();
    this.emit("values;\n\n");

    // Generate private constructor
    this.emitIndent();
    this.emit("constructor(type, values) {\n");
    this.indent();
    this.emitIndent();
    this.emit("this.type = type;\n");
    this.emitIndent();
    this.emit("this.values = values;\n");
    this.emitIndent();
    this.emit("Object.freeze(this);\n");
    this.dedent();
    this.emitIndent();
    this.emit("}\n\n");

    // Generate is() method
    this.emitIndent();
    this.emit("is(type) {\n");
    this.indent();
    this.emitIndent();
    this.emit("return this.type === type;\n");
    this.dedent();
    this.emitIndent();
    this.emit("}\n");

    // Generate static factory methods for each case
    for (const enumCase of node.cases) {
      this.emit("\n");
      this.emitIndent();
      this.emit("static ");
      this.emit(enumCase.id.name);
      this.emit("(");

      // Generate parameter list
      const params = enumCase.associatedValues || [];
      for (let i = 0; i < params.length; i++) {
        if (i > 0) this.emit(", ");
        this.emit(params[i].name);
      }
      this.emit(") {\n");
      this.indent();
      this.emitIndent();
      this.emit("return new ");
      this.emit(enumName);
      this.emit("(");
      this.emit(JSON.stringify(enumCase.id.name));
      this.emit(", { ");

      // Generate values object
      for (let i = 0; i < params.length; i++) {
        if (i > 0) this.emit(", ");
        this.emit(params[i].name);
      }
      this.emit(" });\n");
      this.dedent();
      this.emitIndent();
      this.emit("}\n");
    }
  }

  // ============================================================================
  // Import/Export Generators
  // ============================================================================

  private generateImportDeclaration(node: IR.IRImportDeclaration): void {
    this.emitIndent();
    this.emit("import ", node.position);

    if (node.specifiers.length === 0) {
      // Side-effect import
      this.emit(JSON.stringify(node.source));
    } else {
      const namespaceSpec = node.specifiers.find(
        s => s.type === IR.IRNodeType.ImportNamespaceSpecifier
      );

      if (namespaceSpec) {
        this.emit("* as ");
        this.generateIdentifier((namespaceSpec as IR.IRImportNamespaceSpecifier).local);
      } else {
        this.emit("{ ");
        const specs = node.specifiers as IR.IRImportSpecifier[];
        for (let i = 0; i < specs.length; i++) {
          if (i > 0) this.emit(", ");
          const spec = specs[i];
          if (spec.imported.name !== spec.local.name) {
            this.emit(spec.imported.name);
            this.emit(" as ");
          }
          this.emit(spec.local.name);
        }
        this.emit(" }");
      }
      this.emit(" from ");
      this.emit(JSON.stringify(node.source));
    }
    this.emit(";\n");
  }

  /**
   * Generate dynamic import expression: import("./module.js")
   */
  private generateDynamicImport(node: IR.IRDynamicImport): void {
    this.emit("import(", node.position);
    this.generateNode(node.source);
    this.emit(")");
  }

  private generateExportNamedDeclaration(node: IR.IRExportNamedDeclaration): void {
    this.emitIndent();
    this.emit("export ", node.position);

    if (node.declaration) {
      // export const/function/class
      // Don't emit indent since we already did
      const savedIndent = this.buf.getIndentLevel();
      this.buf.setIndentLevel(0);
      this.generateNode(node.declaration);
      this.buf.setIndentLevel(savedIndent);
    } else if (node.specifiers.length > 0) {
      this.emit("{ ");
      for (let i = 0; i < node.specifiers.length; i++) {
        if (i > 0) this.emit(", ");
        const spec = node.specifiers[i];
        if (spec.local.name !== spec.exported.name) {
          this.emit(spec.local.name);
          this.emit(" as ");
        }
        this.emit(spec.exported.name);
      }
      this.emit(" }");
      if (node.source) {
        this.emit(" from ");
        this.emit(JSON.stringify(node.source));
      }
      this.emit(";\n");
    }
  }

  private generateExportVariableDeclaration(node: IR.IRExportVariableDeclaration): void {
    this.emitIndent();
    this.emit("export ", node.position);
    // Don't add indent since we already did
    const savedIndent = this.buf.getIndentLevel();
    this.buf.setIndentLevel(0);
    this.generateVariableDeclaration(node.declaration);
    this.buf.setIndentLevel(savedIndent);
  }

  private generateExportDefaultDeclaration(node: IR.IRExportDefaultDeclaration): void {
    this.emitIndent();
    this.emit("export default ", node.position);
    this.generateInExpressionContext(node.declaration);
    this.emit(";\n");
  }

  // ============================================================================
  // Pattern Generators
  // ============================================================================

  private generatePattern(node: IR.IRNode): void {
    switch (node.type) {
      case IR.IRNodeType.Identifier:
        this.generateIdentifier(node as IR.IRIdentifier);
        break;
      case IR.IRNodeType.ArrayPattern:
        this.generateArrayPattern(node as IR.IRArrayPattern);
        break;
      case IR.IRNodeType.ObjectPattern:
        this.generateObjectPattern(node as IR.IRObjectPattern);
        break;
      case IR.IRNodeType.RestElement:
        this.generateRestElement(node as IR.IRRestElement);
        break;
      case IR.IRNodeType.AssignmentPattern:
        this.generateAssignmentPattern(node as IR.IRAssignmentPattern);
        break;
      default:
        this.generateNode(node);
    }
  }

  private generateArrayPattern(node: IR.IRArrayPattern): void {
    this.emit("[", node.position);
    for (let i = 0; i < node.elements.length; i++) {
      if (i > 0) this.emit(", ");
      const elem = node.elements[i];
      if (elem === null) {
        // Hole in pattern
        continue;
      }
      this.generatePattern(elem);
    }
    this.emit("]");
  }

  private generateObjectPattern(node: IR.IRObjectPattern): void {
    this.emit("{ ", node.position);
    for (let i = 0; i < node.properties.length; i++) {
      if (i > 0) this.emit(", ");
      const prop = node.properties[i];
      if (prop.shorthand) {
        this.generatePattern(prop.value);
      } else {
        // Computed keys are expression contexts
        if (prop.computed) {
          this.emit("[");
          this.generateInExpressionContext(prop.key);
          this.emit("]");
        } else {
          this.generateNode(prop.key);
        }
        this.emit(": ");
        this.generatePattern(prop.value);
      }
    }
    if (node.rest) {
      if (node.properties.length > 0) this.emit(", ");
      this.generateRestElement(node.rest);
    }
    this.emit(" }");
  }

  private generateRestElement(node: IR.IRRestElement): void {
    this.emit("...", node.position);
    this.generateIdentifier(node.argument);
  }

  private generateAssignmentPattern(node: IR.IRAssignmentPattern): void {
    this.generatePattern(node.left);
    this.emit(" = ", node.position);
    this.generateInExpressionContext(node.right);
  }

  // ============================================================================
  // JS Interop Generators
  // ============================================================================

  private generateInteropIIFE(node: IR.IRInteropIIFE): void {
    this.emit("(", node.position);
    this.generateNode(node.object);
    this.emit(")");

    const propName = node.property.value;
    if (this.isValidJsIdentifier(propName)) {
      // Dot notation - enables TypeScript type checking!
      this.emit(".");
      this.emit(propName);
    } else {
      // Bracket notation fallback for non-identifier property names
      this.emit("[");
      this.generateStringLiteral(node.property);
      this.emit("]");
    }
  }

  /**
   * Checks if a string is a valid JavaScript identifier.
   * Used to determine whether to emit dot notation (type-checkable)
   * or bracket notation (flexible but not type-checked).
   * Also accepts private field identifiers (#name).
   */
  private isValidJsIdentifier(name: string): boolean {
    // Match regular identifiers or private field identifiers (#name)
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) || /^#[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
  }

  private generateJsMethodAccess(node: IR.IRJsMethodAccess): void {
    // JsMethodAccess needs runtime detection: could be a property or a no-arg method
    // Use Arrow IIFE to evaluate object only once (avoids triple evaluation bug)
    // Generate: ((obj) => typeof obj.method === 'function' ? obj.method() : obj.method)(actualObject)
    this.emit("((obj) => typeof obj.", node.position);
    this.emit(node.method);
    this.emit(" === 'function' ? obj.");
    this.emit(node.method);
    this.emit("() : obj.");
    this.emit(node.method);
    this.emit(")(");
    this.generateInExpressionContext(node.object);
    this.emit(")");
  }

  private generateJsImportReference(node: IR.IRJsImportReference): void {
    this.emit(node.name, node.position);
  }

  // ============================================================================
  // Helper Generators
  // ============================================================================

  private generateFnParams(
    params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[],
    defaultsMap: Map<string, IR.IRNode> = new Map()
  ): void {

    for (let i = 0; i < params.length; i++) {
      if (i > 0) this.emit(", ");
      const param = params[i];

      if (param.type === IR.IRNodeType.Identifier) {
        const id = param as IR.IRIdentifier;
        this.emit(id.name, id.position);
        // Type annotation (skip for rest parameters - they have ... prefix)
        if (!id.name.startsWith("...") && id.typeAnnotation) {
          this.emit(`: ${id.typeAnnotation}`);
        }
        // Default value
        const defaultValue = defaultsMap.get(id.name);
        if (defaultValue) {
          this.emit(" = ");
          this.generateInExpressionContext(defaultValue);
        }
      } else {
        // Pattern parameter
        this.generatePattern(param);
      }
    }
  }

  private generateJsonMapParams(
    params: (IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern)[],
    defaults?: { name: string; value: IR.IRNode }[]
  ): void {
    // Generate object destructuring: { param1 = default1, param2 = default2 } = {}
    const defaultsMap = this.buildDefaultsMap(defaults);

    this.emit("{ ");
    for (let i = 0; i < params.length; i++) {
      if (i > 0) this.emit(", ");
      const param = params[i];

      if (param.type === IR.IRNodeType.Identifier) {
        const id = param as IR.IRIdentifier;
        this.emit(id.name, id.position);
        if (id.typeAnnotation) {
          this.emit(`: ${id.typeAnnotation}`);
        }
        // Add default value
        const defaultValue = defaultsMap.get(id.name);
        if (defaultValue) {
          this.emit(" = ");
          this.generateInExpressionContext(defaultValue);
        }
      }
    }
    this.emit(" } = {}");
  }
}

// ============================================================================
// Public API
// ============================================================================

export function generateTypeScript(
  program: IR.IRProgram,
  options: GeneratorOptions = {}
): TSGeneratorResult {
  const generator = new TSGenerator(options);
  return generator.generate(program);
}
