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
import { globalLogger as logger } from "../../logger.ts";
import { CodeGenError } from "../../common/error.ts";
import { applyTCO } from "../optimize/tco-optimizer.ts";
import { RUNTIME_HELPER_NAMES_SET } from "../../common/runtime-helper-impl.ts";

// ============================================================================
// Types
// ============================================================================

export interface SourceMapping {
  generated: { line: number; column: number };
  original: { line: number; column: number } | null;
  source: string | null;
  name: string | null;
}

export interface TSGeneratorResult {
  code: string;
  mappings: SourceMapping[];
  usedHelpers: Set<string>;
}

interface GeneratorOptions {
  sourceFilePath?: string;
  indent?: string;
}

// ============================================================================
// Generator State
// ============================================================================

class TSGenerator {
  private code: string = "";
  private currentLine: number = 1;
  private currentColumn: number = 0;
  private mappings: SourceMapping[] = [];
  private usedHelpers: Set<string> = new Set();
  private sourceFilePath: string;
  private indentLevel: number = 0;
  private indentStr: string;

  // Expression-everywhere: track top-level binding names for hoisting
  private topLevelBindingNames: Set<string> = new Set();
  // Track function type signatures for proper call-site type checking
  private topLevelFunctionTypes: Map<string, string> = new Map();
  private isTopLevel: boolean = true;

  constructor(options: GeneratorOptions = {}) {
    this.sourceFilePath = options.sourceFilePath || "input.hql";
    this.indentStr = options.indent || "  ";
  }

  // ============================================================================
  // Output Helpers
  // ============================================================================

  private emit(text: string, irPosition?: IR.SourcePosition): void {
    // Record mapping if we have a source position
    if (irPosition && irPosition.line !== undefined) {
      this.mappings.push({
        generated: { line: this.currentLine, column: this.currentColumn },
        original: { line: irPosition.line, column: irPosition.column || 0 },
        source: irPosition.filePath || this.sourceFilePath,
        name: null,
      });
    }

    // Track position - optimized to avoid character-by-character iteration
    // Fast path: no newlines (most common case for tokens/identifiers)
    if (!text.includes("\n")) {
      this.currentColumn += text.length;
    } else {
      // Has newlines - split is well-optimized in V8
      const lines = text.split("\n");
      this.currentLine += lines.length - 1;
      this.currentColumn = lines[lines.length - 1].length;
    }
    this.code += text;
  }

  private emitLine(text: string = "", irPosition?: IR.SourcePosition): void {
    if (text) {
      this.emitIndent();
      this.emit(text, irPosition);
    }
    this.emit("\n");
  }

  private emitIndent(): void {
    this.emit(this.indentStr.repeat(this.indentLevel));
  }

  private indent(): void {
    this.indentLevel++;
  }

  private dedent(): void {
    if (this.indentLevel > 0) this.indentLevel--;
  }

  /**
   * Emit items separated by commas - DRY helper for common pattern
   */
  private emitCommaSeparated<T>(items: T[], processor: (item: T) => void): void {
    for (let i = 0; i < items.length; i++) {
      if (i > 0) this.emit(", ");
      processor(items[i]);
    }
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
            this.topLevelBindingNames.add((decl.id as IR.IRIdentifier).name);
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

  // ============================================================================
  // Main Entry Point
  // ============================================================================

  generate(program: IR.IRProgram): TSGeneratorResult {
    // Pass 1: Collect all top-level binding names
    for (const node of program.body) {
      this.collectTopLevelNames(node);
    }

    // Emit hoisted let declarations with types for functions (enables call-site type checking)
    if (this.topLevelBindingNames.size > 0) {
      const declarations: string[] = [];
      for (const name of this.topLevelBindingNames) {
        const funcType = this.topLevelFunctionTypes.get(name);
        if (funcType) {
          // Typed function: let add: (a: number, b: number) => number;
          declarations.push(`${name}: ${funcType}`);
        } else {
          // Untyped binding: let x;
          declarations.push(name);
        }
      }
      this.emitLine(`let ${declarations.join(", ")};`);
      this.emitLine();
    }

    // Pass 2: Generate expressions (with isTopLevel = true)
    for (const node of program.body) {
      this.generateNode(node);
    }

    return {
      code: this.code,
      mappings: this.mappings,
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
      case IR.IRNodeType.CallMemberExpression:
        this.generateCallMemberExpression(node as IR.IRCallMemberExpression);
        break;
      case IR.IRNodeType.NewExpression:
        this.generateNewExpression(node as IR.IRNewExpression);
        break;
      case IR.IRNodeType.ArrayExpression:
        this.generateArrayExpression(node as IR.IRArrayExpression);
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

      default:
        logger.warn(`Unknown IR node type: ${node.type}`);
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
        this.generateNode(node.expressions[i]);
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
    this.emit(node.name, node.position);
  }

  // ============================================================================
  // Expression Generators
  // ============================================================================

  private generateBinaryExpression(node: IR.IRBinaryExpression): void {
    this.emit("(", node.position);
    this.generateNode(node.left);
    this.emit(` ${node.operator} `);
    this.generateNode(node.right);
    this.emit(")");
  }

  private generateUnaryExpression(node: IR.IRUnaryExpression): void {
    if (node.prefix !== false) {
      this.emit(node.operator, node.position);
      if (node.operator === "typeof" || node.operator === "void" || node.operator === "delete") {
        this.emit(" ");
      }
      // Wrap function expressions in parentheses to avoid precedence issues
      // e.g., typeof (x) => x should be typeof ((x) => x)
      const needsParens = node.argument.type === IR.IRNodeType.FunctionExpression;
      if (needsParens) this.emit("(");
      this.generateNode(node.argument);
      if (needsParens) this.emit(")");
    } else {
      this.generateNode(node.argument);
      this.emit(node.operator);
    }
  }

  private generateLogicalExpression(node: IR.IRLogicalExpression): void {
    this.emit("(", node.position);
    this.generateNode(node.left);
    this.emit(` ${node.operator} `);
    this.generateNode(node.right);
    this.emit(")");
  }

  private generateConditionalExpression(node: IR.IRConditionalExpression): void {
    this.emit("(", node.position);
    this.generateNode(node.test);
    this.emit(" ? ");
    this.generateNode(node.consequent);
    this.emit(" : ");
    this.generateNode(node.alternate);
    this.emit(")");
  }

  private generateCallExpression(node: IR.IRCallExpression): void {
    // If callee is a function expression, wrap it in parentheses for IIFE
    // Note: HQL IR uses FunctionExpression for both regular and arrow functions
    const needsParens = node.callee.type === IR.IRNodeType.FunctionExpression;

    if (needsParens) this.emit("(");
    this.generateNode(node.callee);
    if (needsParens) this.emit(")");

    this.emit("(", node.position);
    this.emitCommaSeparated(node.arguments, (arg) => this.generateNode(arg));
    this.emit(")");
  }

  private generateMemberExpression(node: IR.IRMemberExpression): void {
    this.generateNode(node.object);
    if (node.computed) {
      this.emit("[", node.position);
      this.generateNode(node.property);
      this.emit("]");
    } else {
      this.emit(".", node.position);
      this.generateNode(node.property);
    }
  }

  private generateCallMemberExpression(node: IR.IRCallMemberExpression): void {
    this.generateNode(node.object);
    this.emit(".", node.position);
    this.generateNode(node.property);
    this.emit("(");
    this.emitCommaSeparated(node.arguments, (arg) => this.generateNode(arg));
    this.emit(")");
  }

  private generateNewExpression(node: IR.IRNewExpression): void {
    this.emit("new ", node.position);
    this.generateNode(node.callee);
    this.emit("(");
    this.emitCommaSeparated(node.arguments, (arg) => this.generateNode(arg));
    this.emit(")");
  }

  private generateArrayExpression(node: IR.IRArrayExpression): void {
    this.emit("[", node.position);
    this.emitCommaSeparated(node.elements, (elem) => this.generateNode(elem));
    this.emit("]");
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
        this.generateNode(spread.expression);
      } else {
        const objProp = prop as IR.IRObjectProperty;
        if (objProp.computed) {
          this.emit("[");
          this.generateNode(objProp.key);
          this.emit("]");
        } else {
          this.generateNode(objProp.key);
        }
        this.emit(": ");
        this.generateNode(objProp.value);
      }
    }
    this.emit(" }");
  }

  private generateFunctionExpression(node: IR.IRFunctionExpression): void {
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
      this.generateNode(ret.argument);
    } else {
      this.generateBlockStatement(node.body);
    }
  }

  private generateAssignmentExpression(node: IR.IRAssignmentExpression): void {
    this.generateNode(node.left);
    this.emit(` ${node.operator} `, node.position);
    this.generateNode(node.right);
  }

  private generateAwaitExpression(node: IR.IRAwaitExpression): void {
    this.emit("await ", node.position);
    this.generateNode(node.argument);
  }

  private generateSpreadElement(node: IR.IRSpreadElement): void {
    this.emit("...", node.position);
    this.generateNode(node.argument);
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
    this.generateNode(node.expression);
    if (needsParens) this.emit(")");
    this.emit(";\n");
  }

  private generateBlockStatement(node: IR.IRBlockStatement): void {
    // When entering a block, we're no longer at top level
    const wasTopLevel = this.isTopLevel;
    this.isTopLevel = false;

    this.emit("{\n", node.position);
    this.indent();
    for (const stmt of node.body) {
      this.generateNode(stmt);
    }
    this.dedent();
    this.emitIndent();
    this.emit("}");

    // Restore top level status
    this.isTopLevel = wasTopLevel;
  }

  private generateReturnStatement(node: IR.IRReturnStatement): void {
    this.emitIndent();
    this.emit("return ", node.position);
    this.generateNode(node.argument);
    this.emit(";\n");
  }

  private generateIfStatement(node: IR.IRIfStatement): void {
    this.emitIndent();
    this.emit("if (", node.position);
    this.generateNode(node.test);
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
    this.generateNode(node.test);
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
        this.generateNode(node.init);
      }
    }
    this.emit("; ");
    if (node.test) {
      this.generateNode(node.test);
    }
    this.emit("; ");
    if (node.update) {
      this.generateNode(node.update);
    }
    this.emit(") ");
    this.generateBlockStatement(node.body);
    this.emit("\n");
  }

  private generateForOfStatement(node: IR.IRForOfStatement): void {
    this.emitIndent();
    this.emit("for (", node.position);
    this.generateVariableDeclarationInline(node.left);
    this.emit(" of ");
    this.generateNode(node.right);
    this.emit(") ");
    this.generateBlockStatement(node.body);
    this.emit("\n");
  }

  private generateThrowStatement(node: IR.IRThrowStatement): void {
    this.emitIndent();
    this.emit("throw ", node.position);
    this.generateNode(node.argument);
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
    // Expression-everywhere: top-level simple bindings become assignment expressions
    if (this.isTopLevel && this.isSimpleBinding(node)) {
      this.generateVariableAsAssignment(node);
      return;
    }

    // Standard declaration for nested scopes and destructuring patterns
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
   * Used for top-level bindings to make them return values.
   * Example: (let x 10) → (x = 10); which returns 10
   */
  private generateVariableAsAssignment(node: IR.IRVariableDeclaration): void {
    const decl = node.declarations[0];
    const id = decl.id as IR.IRIdentifier;

    this.emitIndent();
    this.emit("(", node.position);
    this.emit(id.name);
    this.emit(" = ");
    if (decl.init) {
      this.generateNode(decl.init);
    } else {
      this.emit("undefined");
    }
    this.emit(");\n");
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
    // Apply Tail Call Optimization for self-recursive functions
    const optimizedNode = applyTCO(node);

    // Expression-everywhere: top-level named functions become assignment expressions
    if (this.isTopLevel) {
      this.generateFnAsAssignment(optimizedNode);
      return;
    }

    // Standard function declaration for nested scopes
    this.emitIndent();
    if (optimizedNode.async) {
      this.emit("async ", optimizedNode.position);
    }
    this.emit("function ");
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
  }

  /**
   * Generate a named function as an assignment expression.
   * Used for top-level fn definitions to make them return the function value.
   * Example: (fn add [a b] (+ a b)) → (add = function add(a, b) { return a + b; });
   */
  private generateFnAsAssignment(node: IR.IRFnFunctionDeclaration): void {
    this.emitIndent();
    this.emit("(", node.position);
    this.emit(node.id.name);
    this.emit(" = ");

    // Generate function expression
    if (node.async) {
      this.emit("async ");
    }
    this.emit("function ");
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
    this.emit(");\n");
  }

  private generateClassDeclaration(node: IR.IRClassDeclaration): void {
    // Expression-everywhere: top-level classes become assignment expressions
    if (this.isTopLevel) {
      this.generateClassAsAssignment(node);
      return;
    }

    // Standard class declaration for nested scopes
    this.emitIndent();
    this.emit("class ", node.position);
    this.generateIdentifier(node.id);
    this.emit(" {\n");
    this.indent();
    this.generateClassBody(node);
    this.dedent();
    this.emitIndent();
    this.emit("}\n");
  }

  /**
   * Generate a class as an assignment expression.
   * Used for top-level class definitions to make them return the class value.
   * Example: (class Point ...) → (Point = class Point { ... });
   */
  private generateClassAsAssignment(node: IR.IRClassDeclaration): void {
    this.emitIndent();
    this.emit("(", node.position);
    this.emit(node.id.name);
    this.emit(" = class ");
    this.emit(node.id.name);  // Keep the class name
    this.emit(" {\n");
    this.indent();
    this.generateClassBody(node);
    this.dedent();
    this.emitIndent();
    this.emit("});\n");
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
    this.emit(field.name, field.position);

    // Add type annotation if present
    if (field.typeAnnotation) {
      this.emit(`: ${field.typeAnnotation}`);
    }

    if (field.initialValue) {
      this.emit(" = ");
      this.generateNode(field.initialValue);
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
    this.emit(method.name, method.position);

    // Add generic type parameters if present
    if (method.typeParameters && method.typeParameters.length > 0) {
      this.emit("<");
      this.emit(method.typeParameters.join(", "));
      this.emit(">");
    }

    this.emit("(");
    this.generateFnParams(method.params, this.buildDefaultsMap(method.defaults));
    this.emit(")");

    // Add return type annotation if present
    if (method.returnType) {
      this.emit(`: ${method.returnType}`);
    }

    this.emit(" ");
    this.generateBlockStatement(method.body);
    this.emit("\n");
  }

  private generateEnumDeclaration(node: IR.IREnumDeclaration): void {
    // Expression-everywhere: top-level enums become assignment expressions
    if (this.isTopLevel) {
      if (node.hasAssociatedValues) {
        this.generateEnumWithAssociatedValuesAsAssignment(node);
      } else {
        this.generateSimpleEnumAsAssignment(node);
      }
      return;
    }

    // Standard enum generation for nested scopes
    if (node.hasAssociatedValues) {
      this.generateEnumWithAssociatedValues(node);
    } else {
      this.generateSimpleEnum(node);
    }
  }

  private generateSimpleEnum(node: IR.IREnumDeclaration): void {
    this.emitIndent();
    this.emit("const ", node.position);
    this.generateIdentifier(node.id);
    this.emit(" = Object.freeze({\n");
    this.indent();
    this.generateEnumCases(node);
    this.dedent();
    this.emitIndent();
    this.emit("});\n");
  }

  /**
   * Generate a simple enum as an assignment expression.
   * Used for top-level enum definitions to make them return the enum value.
   * Example: (enum Status ...) → (Status = Object.freeze({ ... }));
   */
  private generateSimpleEnumAsAssignment(node: IR.IREnumDeclaration): void {
    this.emitIndent();
    this.emit("(", node.position);
    this.emit(node.id.name);
    this.emit(" = Object.freeze({\n");
    this.indent();
    this.generateEnumCases(node);
    this.dedent();
    this.emitIndent();
    this.emit("}));\n");
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
        this.generateNode(enumCase.rawValue);
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

  private generateEnumWithAssociatedValues(node: IR.IREnumDeclaration): void {
    const enumName = node.id.name;

    // Generate class declaration
    this.emitIndent();
    this.emit("class ", node.position);
    this.emit(enumName);
    this.emit(" {\n");
    this.indent();
    this.generateEnumClassBody(node);
    this.dedent();
    this.emitIndent();
    this.emit("}\n");
  }

  /**
   * Generate an enum with associated values as an assignment expression.
   * Used for top-level enum definitions to make them return the enum class.
   */
  private generateEnumWithAssociatedValuesAsAssignment(node: IR.IREnumDeclaration): void {
    const enumName = node.id.name;

    this.emitIndent();
    this.emit("(", node.position);
    this.emit(enumName);
    this.emit(" = class ");
    this.emit(enumName);
    this.emit(" {\n");
    this.indent();
    this.generateEnumClassBody(node);
    this.dedent();
    this.emitIndent();
    this.emit("});\n");
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

  private generateExportNamedDeclaration(node: IR.IRExportNamedDeclaration): void {
    this.emitIndent();
    this.emit("export ", node.position);

    if (node.declaration) {
      // export const/function/class
      // Don't emit indent since we already did
      const savedIndent = this.indentLevel;
      this.indentLevel = 0;
      this.generateNode(node.declaration);
      this.indentLevel = savedIndent;
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
    const savedIndent = this.indentLevel;
    this.indentLevel = 0;
    this.generateVariableDeclaration(node.declaration);
    this.indentLevel = savedIndent;
  }

  private generateExportDefaultDeclaration(node: IR.IRExportDefaultDeclaration): void {
    this.emitIndent();
    this.emit("export default ", node.position);
    this.generateNode(node.declaration);
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
        this.generateNode(prop.key);
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
    this.generateNode(node.right);
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
   */
  private isValidJsIdentifier(name: string): boolean {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
  }

  private generateJsMethodAccess(node: IR.IRJsMethodAccess): void {
    // JsMethodAccess needs runtime detection: could be a property or a no-arg method
    // Generate: (typeof obj.method === 'function' ? obj.method() : obj.method)
    this.emit("(typeof ");
    this.generateNode(node.object);
    this.emit(".", node.position);
    this.emit(node.method);
    this.emit(" === 'function' ? ");
    this.generateNode(node.object);
    this.emit(".");
    this.emit(node.method);
    this.emit("() : ");
    this.generateNode(node.object);
    this.emit(".");
    this.emit(node.method);
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
          this.generateNode(defaultValue);
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
          this.generateNode(defaultValue);
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
