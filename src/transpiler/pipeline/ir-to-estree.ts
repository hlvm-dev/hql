/**
 * ESTree Code Generator - Converts HQL IR to ESTree AST
 *
 * This module replaces the TypeScript AST backend with ESTree + Babel generator
 * to achieve 100% accurate source maps. Instead of converting IR → TS AST → String
 * (losing position metadata), we convert IR → ESTree (preserving .loc) → JavaScript
 * with perfect source maps via @babel/generator.
 *
 * ESTree is the standard JavaScript AST format used by Babel, ESLint, and Prettier.
 * See: https://github.com/estree/estree
 */

import * as IR from "../type/hql_ir.ts";
import { globalLogger as logger } from "../../logger.ts";
import { CodeGenError } from "../../common/error.ts";

// ============================================================================
// ESTree Type Definitions
// ============================================================================

export interface SourceLocation {
  start: Position;
  end: Position;
  source?: string | null;
}

export interface Position {
  line: number;   // 1-indexed
  column: number; // 0-indexed
}

export interface BaseNode {
  type: string;
  loc?: SourceLocation | null;
}

export type Node =
  | Program
  | Statement
  | Expression
  | Pattern
  | ModuleDeclaration;

// Program
export interface Program extends BaseNode {
  type: "Program";
  body: Array<Statement | ModuleDeclaration>;
  sourceType?: "script" | "module";
}

// Statements
export type Statement =
  | ExpressionStatement
  | BlockStatement
  | ReturnStatement
  | IfStatement
  | WhileStatement
  | ForStatement
  | ThrowStatement
  | TryStatement
  | VariableDeclaration
  | FunctionDeclaration
  | ClassDeclaration;

export interface ExpressionStatement extends BaseNode {
  type: "ExpressionStatement";
  expression: Expression;
}

export interface BlockStatement extends BaseNode {
  type: "BlockStatement";
  body: Statement[];
}

export interface ReturnStatement extends BaseNode {
  type: "ReturnStatement";
  argument: Expression | null;
}

export interface IfStatement extends BaseNode {
  type: "IfStatement";
  test: Expression;
  consequent: Statement;
  alternate: Statement | null;
}

export interface WhileStatement extends BaseNode {
  type: "WhileStatement";
  test: Expression;
  body: Statement;
}

export interface ForStatement extends BaseNode {
  type: "ForStatement";
  init: VariableDeclaration | Expression | null;
  test: Expression | null;
  update: Expression | null;
  body: Statement;
}

export interface ThrowStatement extends BaseNode {
  type: "ThrowStatement";
  argument: Expression;
}

export interface TryStatement extends BaseNode {
  type: "TryStatement";
  block: BlockStatement;
  handler: CatchClause | null;
  finalizer: BlockStatement | null;
}

export interface CatchClause extends BaseNode {
  type: "CatchClause";
  param: Pattern | null;
  body: BlockStatement;
}

export interface VariableDeclaration extends BaseNode {
  type: "VariableDeclaration";
  kind: "var" | "let" | "const";
  declarations: VariableDeclarator[];
}

export interface VariableDeclarator extends BaseNode {
  type: "VariableDeclarator";
  id: Pattern;
  init: Expression | null;
}

// Expressions
export type Expression =
  | Identifier
  | Literal
  | ThisExpression
  | ArrayExpression
  | ObjectExpression
  | FunctionExpression
  | ArrowFunctionExpression
  | UnaryExpression
  | UpdateExpression
  | BinaryExpression
  | AssignmentExpression
  | LogicalExpression
  | MemberExpression
  | ConditionalExpression
  | CallExpression
  | NewExpression
  | AwaitExpression
  | SequenceExpression
  | TemplateLiteral;

export interface Identifier extends BaseNode {
  type: "Identifier";
  name: string;
}

export interface Literal extends BaseNode {
  type: "Literal";
  value: string | number | boolean | null;
  raw?: string;
}

export interface ThisExpression extends BaseNode {
  type: "ThisExpression";
}

export interface ArrayExpression extends BaseNode {
  type: "ArrayExpression";
  elements: Array<Expression | SpreadElement | null>;
}

export interface ObjectExpression extends BaseNode {
  type: "ObjectExpression";
  properties: Array<Property | SpreadElement>;
}

export interface Property extends BaseNode {
  type: "Property";
  key: Expression;
  value: Expression | Pattern;
  kind: "init" | "get" | "set";
  method: boolean;
  shorthand: boolean;
  computed: boolean;
}

export interface FunctionExpression extends BaseNode {
  type: "FunctionExpression";
  id: Identifier | null;
  params: Pattern[];
  body: BlockStatement;
  async: boolean;
  generator: boolean;
}

export interface ArrowFunctionExpression extends BaseNode {
  type: "ArrowFunctionExpression";
  params: Pattern[];
  body: BlockStatement | Expression;
  async: boolean;
  expression: boolean;
}

export interface UnaryExpression extends BaseNode {
  type: "UnaryExpression";
  operator: string;
  prefix: boolean;
  argument: Expression;
}

export interface UpdateExpression extends BaseNode {
  type: "UpdateExpression";
  operator: "++" | "--";
  prefix: boolean;
  argument: Expression;
}

export interface BinaryExpression extends BaseNode {
  type: "BinaryExpression";
  operator: string;
  left: Expression;
  right: Expression;
}

export interface AssignmentExpression extends BaseNode {
  type: "AssignmentExpression";
  operator: string;
  left: Pattern | Expression;
  right: Expression;
}

export interface LogicalExpression extends BaseNode {
  type: "LogicalExpression";
  operator: "||" | "&&" | "??";
  left: Expression;
  right: Expression;
}

export interface MemberExpression extends BaseNode {
  type: "MemberExpression";
  object: Expression;
  property: Expression;
  computed: boolean;
}

export interface ConditionalExpression extends BaseNode {
  type: "ConditionalExpression";
  test: Expression;
  consequent: Expression;
  alternate: Expression;
}

export interface CallExpression extends BaseNode {
  type: "CallExpression";
  callee: Expression;
  arguments: Array<Expression | SpreadElement>;
}

export interface NewExpression extends BaseNode {
  type: "NewExpression";
  callee: Expression;
  arguments: Array<Expression | SpreadElement>;
}

export interface AwaitExpression extends BaseNode {
  type: "AwaitExpression";
  argument: Expression;
}

export interface SequenceExpression extends BaseNode {
  type: "SequenceExpression";
  expressions: Expression[];
}

export interface TemplateLiteral extends BaseNode {
  type: "TemplateLiteral";
  quasis: TemplateElement[];
  expressions: Expression[];
}

export interface TemplateElement extends BaseNode {
  type: "TemplateElement";
  value: {
    raw: string;
    cooked: string;
  };
  tail: boolean;
}

export interface SpreadElement extends BaseNode {
  type: "SpreadElement";
  argument: Expression;
}

// Patterns
export type Pattern =
  | Identifier
  | ObjectPattern
  | ArrayPattern
  | RestElement
  | AssignmentPattern;

export interface ObjectPattern extends BaseNode {
  type: "ObjectPattern";
  properties: Array<Property | RestElement>;
}

export interface ArrayPattern extends BaseNode {
  type: "ArrayPattern";
  elements: Array<Pattern | null>;
}

export interface RestElement extends BaseNode {
  type: "RestElement";
  argument: Pattern;
}

export interface AssignmentPattern extends BaseNode {
  type: "AssignmentPattern";
  left: Pattern;
  right: Expression;
}

// Functions and Classes
export interface FunctionDeclaration extends BaseNode {
  type: "FunctionDeclaration";
  id: Identifier | null;
  params: Pattern[];
  body: BlockStatement;
  async: boolean;
  generator: boolean;
}

export interface ClassDeclaration extends BaseNode {
  type: "ClassDeclaration";
  id: Identifier | null;
  superClass: Expression | null;
  body: ClassBody;
}

export interface ClassBody extends BaseNode {
  type: "ClassBody";
  body: Array<MethodDefinition | PropertyDefinition>;
}

export interface MethodDefinition extends BaseNode {
  type: "MethodDefinition";
  key: Expression;
  value: FunctionExpression;
  kind: "constructor" | "method" | "get" | "set";
  computed: boolean;
  static: boolean;
}

export interface PropertyDefinition extends BaseNode {
  type: "PropertyDefinition";
  key: Expression;
  value: Expression | null;
  computed: boolean;
  static: boolean;
}

// Module Declarations
export type ModuleDeclaration =
  | ImportDeclaration
  | ExportNamedDeclaration
  | ExportDefaultDeclaration;

export interface ImportDeclaration extends BaseNode {
  type: "ImportDeclaration";
  specifiers: Array<ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier>;
  source: Literal;
}

export interface ImportSpecifier extends BaseNode {
  type: "ImportSpecifier";
  imported: Identifier;
  local: Identifier;
}

export interface ImportDefaultSpecifier extends BaseNode {
  type: "ImportDefaultSpecifier";
  local: Identifier;
}

export interface ImportNamespaceSpecifier extends BaseNode {
  type: "ImportNamespaceSpecifier";
  local: Identifier;
}

export interface ExportNamedDeclaration extends BaseNode {
  type: "ExportNamedDeclaration";
  declaration: Declaration | null;
  specifiers: ExportSpecifier[];
  source: Literal | null;
}

export interface ExportDefaultDeclaration extends BaseNode {
  type: "ExportDefaultDeclaration";
  declaration: Declaration | Expression;
}

export interface ExportSpecifier extends BaseNode {
  type: "ExportSpecifier";
  exported: Identifier;
  local: Identifier;
}

export type Declaration =
  | FunctionDeclaration
  | VariableDeclaration
  | ClassDeclaration;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Module-level context for source file path fallback.
 * This is set before conversion to provide a meaningful default when
 * IR nodes don't have their own filePath (e.g., synthetic nodes).
 */
let currentSourceFilePath: string = "unknown.hql";

/**
 * Set the fallback source file path for ESTree conversion.
 * Call this before convertIRToESTree to ensure proper source mapping.
 */
export function setSourceFilePath(filePath: string): void {
  currentSourceFilePath = filePath || "unknown.hql";
}

/**
 * Get the current fallback source file path.
 */
export function getSourceFilePath(): string {
  return currentSourceFilePath;
}

/**
 * Creates ESTree SourceLocation from HQL SourcePosition
 */
function createLoc(pos?: IR.SourcePosition): SourceLocation | null {
  if (!pos || pos.line === undefined || pos.column === undefined) {
    return null;
  }

  return {
    start: {
      line: pos.line,
      column: pos.column
    },
    end: {
      line: pos.line,
      column: pos.column
    },
    source: pos.filePath || currentSourceFilePath
  };
}

/**
 * Computes end position for a string value (identifier, literal, etc.)
 */
function createLocWithLength(pos: IR.SourcePosition | undefined, length: number): SourceLocation | null {
  if (!pos || pos.line === undefined || pos.column === undefined) {
    return null;
  }

  return {
    start: {
      line: pos.line,
      column: pos.column
    },
    end: {
      line: pos.line,
      column: pos.column + length
    },
    source: pos.filePath || currentSourceFilePath
  };
}

/**
 * Error helper for unsupported node types
 */
function unsupportedNode(node: IR.IRNode, context: string): never {
  const nodeType = IR.IRNodeType[node.type] || `Unknown(${node.type})`;
  throw new CodeGenError(
    `Unsupported IR node type in ${context}: ${nodeType}`,
    context,
    node
  );
}

/**
 * Creates a simple ESTree Identifier node with optional position info
 */
function createSimpleIdentifier(name: string, loc?: SourceLocation | null): Identifier {
  return {
    type: "Identifier",
    name,
    loc: loc ?? null
  };
}

/**
 * Creates an ESTree MemberExpression node with optional position info
 */
function createMemberExpression(
  objName: string,
  propName: string,
  computed: boolean = true,
  loc?: SourceLocation | null
): MemberExpression {
  return {
    type: "MemberExpression",
    object: createSimpleIdentifier(objName, loc),
    property: createSimpleIdentifier(propName, loc),
    computed,
    loc: loc ?? null
  };
}

/**
 * Creates an ESTree string Literal node with optional position info
 */
function createStringLiteral(value: string, loc?: SourceLocation | null): Literal {
  return {
    type: "Literal",
    value,
    raw: `'${value}'`,
    loc: loc ?? null
  };
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Converts HQL IR node to ESTree AST node
 *
 * This is the main entry point for IR → ESTree conversion.
 * Handles all IR node types and preserves source positions via .loc property.
 */
// Converter function signature
// Note: Each converter expects a specific IR node type (e.g., IRNumericLiteral),
// but the Map stores them generically. We use 'as' cast to satisfy TypeScript.
type IRConverter = (node: IR.IRNode) => Node;

// IR to ESTree converter registry - maps node types to converter functions
// @ts-ignore: Type cast necessary - converters have specific node types
const irToESTreeConverters = new Map<IR.IRNodeType, IRConverter>([
  // Literals
  [IR.IRNodeType.NumericLiteral, convertNumericLiteral],
  [IR.IRNodeType.StringLiteral, convertStringLiteral],
  [IR.IRNodeType.BooleanLiteral, convertBooleanLiteral],
  [IR.IRNodeType.NullLiteral, convertNullLiteral],
  [IR.IRNodeType.TemplateLiteral, convertTemplateLiteral],

  // Identifiers
  [IR.IRNodeType.Identifier, convertIdentifier],

  // Expressions
  [IR.IRNodeType.BinaryExpression, convertBinaryExpression],
  [IR.IRNodeType.UnaryExpression, convertUnaryExpression],
  [IR.IRNodeType.LogicalExpression, convertLogicalExpression],
  [IR.IRNodeType.ConditionalExpression, convertConditionalExpression],
  [IR.IRNodeType.CallExpression, convertCallExpression],
  [IR.IRNodeType.CallMemberExpression, convertCallMemberExpression],
  [IR.IRNodeType.NewExpression, convertNewExpression],
  [IR.IRNodeType.ArrayExpression, convertArrayExpression],
  [IR.IRNodeType.ObjectExpression, convertObjectExpression],
  [IR.IRNodeType.MemberExpression, convertMemberExpression],
  [IR.IRNodeType.FunctionExpression, convertFunctionExpression],
  [IR.IRNodeType.AssignmentExpression, convertAssignmentExpression],
  [IR.IRNodeType.AwaitExpression, convertAwaitExpression],

  // Statements
  [IR.IRNodeType.ExpressionStatement, convertExpressionStatement],
  [IR.IRNodeType.BlockStatement, convertBlockStatement],
  [IR.IRNodeType.ReturnStatement, convertReturnStatement],
  [IR.IRNodeType.IfStatement, convertIfStatement],
  [IR.IRNodeType.WhileStatement, convertWhileStatement],
  [IR.IRNodeType.ForStatement, convertForStatement],
  [IR.IRNodeType.ThrowStatement, convertThrowStatement],
  [IR.IRNodeType.TryStatement, convertTryStatement],

  // Declarations
  [IR.IRNodeType.VariableDeclaration, convertVariableDeclaration],
  [IR.IRNodeType.FunctionDeclaration, convertFunctionDeclaration],
  [IR.IRNodeType.FnFunctionDeclaration, convertFnFunctionDeclaration],
  [IR.IRNodeType.ClassDeclaration, convertClassDeclaration],

  // Import/Export
  [IR.IRNodeType.ImportDeclaration, convertImportDeclaration],
  [IR.IRNodeType.ExportNamedDeclaration, convertExportNamedDeclaration],
  [IR.IRNodeType.ExportVariableDeclaration, convertExportVariableDeclaration],

  // JS Interop
  [IR.IRNodeType.InteropIIFE, convertInteropIIFE],
  [IR.IRNodeType.JsMethodAccess, convertJsMethodAccess],
  [IR.IRNodeType.JsImportReference, convertJsImportReference],

  // Enums
  [IR.IRNodeType.EnumDeclaration, convertEnumDeclaration],

  // Spread operator
  [IR.IRNodeType.SpreadElement, convertSpreadElement],

  // Program
  [IR.IRNodeType.Program, convertProgram],
]);

export function convertIRToESTree(node: IR.IRNode): Node {
  // Handle special cases first
  if (node.type === IR.IRNodeType.Raw) {
    // Raw JavaScript code - should already be handled at a higher level
    throw new CodeGenError(
      "Raw IR nodes should be handled before ESTree conversion",
      "Raw node conversion",
      node
    );
  }

  if (node.type === IR.IRNodeType.CommentBlock) {
    // Comments are metadata, skip in ESTree (Babel handles separately)
    logger.debug("Skipping comment block in ESTree conversion");
    return {
      type: "EmptyStatement",
      loc: createLoc(node.position)
    } as unknown as Node;
  }

  // Look up converter in registry
  const converter = irToESTreeConverters.get(node.type);
  if (!converter) {
    unsupportedNode(node, "ESTree conversion");
  }
  return converter(node);
}

// ============================================================================
// Literal Converters
// ============================================================================

function convertNumericLiteral(node: IR.IRNumericLiteral): Literal | UnaryExpression {
  // Handle negative numbers as UnaryExpression (escodegen requirement)
  if (node.value < 0) {
    return {
      type: "UnaryExpression",
      operator: "-",
      prefix: true,
      argument: {
        type: "Literal",
        value: -node.value,
        raw: String(-node.value),
        loc: createLocWithLength(node.position, String(node.value).length)
      },
      loc: createLocWithLength(node.position, String(node.value).length)
    };
  }

  return {
    type: "Literal",
    value: node.value,
    raw: String(node.value),
    loc: createLocWithLength(node.position, String(node.value).length)
  };
}

function convertStringLiteral(node: IR.IRStringLiteral): Literal {
  return {
    type: "Literal",
    value: node.value,
    raw: JSON.stringify(node.value),
    loc: createLocWithLength(node.position, JSON.stringify(node.value).length)
  };
}

function convertBooleanLiteral(node: IR.IRBooleanLiteral): Literal {
  return {
    type: "Literal",
    value: node.value,
    raw: String(node.value),
    loc: createLocWithLength(node.position, String(node.value).length)
  };
}

function convertNullLiteral(node: IR.IRNullLiteral): Literal {
  return {
    type: "Literal",
    value: null,
    raw: "null",
    loc: createLocWithLength(node.position, 4)
  };
}

function convertTemplateLiteral(node: IR.IRTemplateLiteral): TemplateLiteral {
  // Convert IR quasis (string literals) to ESTree TemplateElement nodes
  const quasis: TemplateElement[] = node.quasis.map((quasi, index) => {
    const stringNode = quasi as IR.IRStringLiteral;
    const isLast = index === node.quasis.length - 1;

    return {
      type: "TemplateElement",
      value: {
        raw: stringNode.value,
        cooked: stringNode.value
      },
      tail: isLast,
      loc: createLoc(quasi.position)
    };
  });

  // Convert IR expressions to ESTree expressions
  const expressions: Expression[] = node.expressions.map(expr =>
    convertIRToESTree(expr) as Expression
  );

  return {
    type: "TemplateLiteral",
    quasis,
    expressions,
    loc: createLoc(node.position)
  };
}

// ============================================================================
// Identifier Converter
// ============================================================================

function convertIdentifier(node: IR.IRIdentifier): Identifier {
  return {
    type: "Identifier",
    name: node.name,
    loc: createLocWithLength(node.position, node.name.length)
  };
}

// ============================================================================
// Expression Converters
// ============================================================================

function convertBinaryExpression(node: IR.IRBinaryExpression): BinaryExpression | LogicalExpression {
  const left = convertIRToESTree(node.left) as Expression;
  const right = convertIRToESTree(node.right) as Expression;

  // Logical operators use LogicalExpression in ESTree
  if (node.operator === "&&" || node.operator === "||" || node.operator === "??") {
    return {
      type: "LogicalExpression",
      operator: node.operator as "||" | "&&" | "??",
      left,
      right,
      loc: createLoc(node.position)
    };
  }

  return {
    type: "BinaryExpression",
    operator: node.operator,
    left,
    right,
    loc: createLoc(node.position)
  };
}

function convertUnaryExpression(node: IR.IRUnaryExpression): UnaryExpression | UpdateExpression {
  // For ++ and --, use UpdateExpression if we have prefix info
  if ((node.operator === '++' || node.operator === '--') && node.prefix !== undefined) {
    return {
      type: "UpdateExpression",
      operator: node.operator,
      prefix: node.prefix,
      argument: convertIRToESTree(node.argument) as Expression,
      loc: createLoc(node.position)
    };
  }

  // For other unary operators (!, -, +, typeof, void, delete, etc.)
  return {
    type: "UnaryExpression",
    operator: node.operator,
    prefix: true,
    argument: convertIRToESTree(node.argument) as Expression,
    loc: createLoc(node.position)
  };
}

function convertLogicalExpression(node: IR.IRLogicalExpression): LogicalExpression {
  return {
    type: "LogicalExpression",
    operator: node.operator as "||" | "&&" | "??",
    left: convertIRToESTree(node.left) as Expression,
    right: convertIRToESTree(node.right) as Expression,
    loc: createLoc(node.position)
  };
}

function convertConditionalExpression(node: IR.IRConditionalExpression): ConditionalExpression {
  return {
    type: "ConditionalExpression",
    test: convertIRToESTree(node.test) as Expression,
    consequent: convertIRToESTree(node.consequent) as Expression,
    alternate: convertIRToESTree(node.alternate) as Expression,
    loc: createLoc(node.position)
  };
}

function convertCallExpression(node: IR.IRCallExpression): CallExpression {
  // Convert callee
  let callee: Expression = convertIRToESTree(node.callee) as Expression;

  // CRITICAL FIX: If callee is FunctionExpression, it's an IIFE - convert to arrow function to preserve `this` binding
  // This fixes issues with `do` blocks in class methods where `this` becomes undefined in regular function IIFEs
  if (callee.type === "FunctionExpression") {
    const funcExpr = callee as FunctionExpression;
    callee = {
      type: "ArrowFunctionExpression",
      params: funcExpr.params,
      body: funcExpr.body,
      async: funcExpr.async,
      expression: false,
      loc: funcExpr.loc
    } as ArrowFunctionExpression;
  }

  return {
    type: "CallExpression",
    callee,
    arguments: node.arguments.map(arg => {
      // Handle spread elements - check IR node type
      if (arg.type === IR.IRNodeType.SpreadAssignment) {
        const spreadArg = arg as IR.IRSpreadAssignment;
        const converted = convertIRToESTree(spreadArg.expression);
        return {
          type: "SpreadElement",
          argument: converted as Expression,
          loc: createLoc(arg.position)
        } as SpreadElement;
      }
      const converted = convertIRToESTree(arg);
      return converted as Expression;
    }),
    loc: createLoc(node.position)
  };
}

function convertCallMemberExpression(node: IR.IRCallMemberExpression): CallExpression {
  // For non-computed member access, the property must be an Identifier
  // If the property is a StringLiteral, we need to create an Identifier from it
  let property: Expression;
  if (node.property.type === IR.IRNodeType.StringLiteral) {
    property = {
      type: "Identifier",
      name: (node.property as IR.IRStringLiteral).value,
      loc: createLoc(node.property.position)
    };
  } else {
    property = convertIRToESTree(node.property) as Expression;
  }

  const memberExpr: MemberExpression = {
    type: "MemberExpression",
    object: convertIRToESTree(node.object) as Expression,
    property: property,
    computed: false,
    loc: createLoc(node.position)
  };

  return {
    type: "CallExpression",
    callee: memberExpr,
    arguments: node.arguments.map(arg => convertIRToESTree(arg) as Expression),
    loc: createLoc(node.position)
  };
}

function convertNewExpression(node: IR.IRNewExpression): NewExpression {
  return {
    type: "NewExpression",
    callee: convertIRToESTree(node.callee) as Expression,
    arguments: node.arguments.map(arg => convertIRToESTree(arg) as Expression),
    loc: createLoc(node.position)
  };
}

function convertArrayExpression(node: IR.IRArrayExpression): ArrayExpression {
  return {
    type: "ArrayExpression",
    elements: node.elements.map(elem => convertIRToESTree(elem) as (Expression | SpreadElement)),
    loc: createLoc(node.position)
  };
}

function convertObjectExpression(node: IR.IRObjectExpression): ObjectExpression {
  const properties: Array<Property | SpreadElement> = node.properties.map(prop => {
    if (prop.type === IR.IRNodeType.SpreadAssignment) {
      const spreadProp = prop as IR.IRSpreadAssignment;
      return {
        type: "SpreadElement",
        argument: convertIRToESTree(spreadProp.expression) as Expression,
        loc: createLoc(prop.position)
      } as SpreadElement;
    }

    const objProp = prop as IR.IRObjectProperty;
    return {
      type: "Property",
      key: convertIRToESTree(objProp.key) as Expression,
      value: convertIRToESTree(objProp.value) as Expression,
      kind: "init",
      method: false,
      shorthand: false,
      computed: objProp.computed || false,
      loc: createLoc(prop.position)
    } as Property;
  });

  return {
    type: "ObjectExpression",
    properties,
    loc: createLoc(node.position)
  };
}

function convertMemberExpression(node: IR.IRMemberExpression): MemberExpression {
  return {
    type: "MemberExpression",
    object: convertIRToESTree(node.object) as Expression,
    property: convertIRToESTree(node.property) as Expression,
    computed: node.computed,
    loc: createLoc(node.position)
  };
}

function convertFunctionExpression(node: IR.IRFunctionExpression): FunctionExpression {
  return {
    type: "FunctionExpression",
    id: node.id ? convertIdentifier(node.id) : null,
    params: node.params.map(param => convertPattern(param)),
    body: convertBlockStatement(node.body),
    async: node.async || false,
    generator: false,
    loc: createLoc(node.position)
  };
}

function convertAssignmentExpression(node: IR.IRAssignmentExpression): AssignmentExpression {
  return {
    type: "AssignmentExpression",
    operator: node.operator,
    left: convertIRToESTree(node.left) as Expression,
    right: convertIRToESTree(node.right) as Expression,
    loc: createLoc(node.position)
  };
}

function convertAwaitExpression(node: IR.IRAwaitExpression): AwaitExpression {
  return {
    type: "AwaitExpression",
    argument: convertIRToESTree(node.argument) as Expression,
    loc: createLoc(node.position)
  };
}

// ============================================================================
// Statement Converters
// ============================================================================

function convertExpressionStatement(node: IR.IRExpressionStatement): ExpressionStatement {
  return {
    type: "ExpressionStatement",
    expression: convertIRToESTree(node.expression) as Expression,
    loc: createLoc(node.position)
  };
}

function convertBlockStatement(node: IR.IRBlockStatement): BlockStatement {
  return {
    type: "BlockStatement",
    body: node.body.map(stmt => convertIRToESTree(stmt) as Statement),
    loc: createLoc(node.position)
  };
}

function convertReturnStatement(node: IR.IRReturnStatement): ReturnStatement {
  return {
    type: "ReturnStatement",
    argument: node.argument ? convertIRToESTree(node.argument) as Expression : null,
    loc: createLoc(node.position)
  };
}

function convertIfStatement(node: IR.IRIfStatement): IfStatement {
  return {
    type: "IfStatement",
    test: convertIRToESTree(node.test) as Expression,
    consequent: convertIRToESTree(node.consequent) as Statement,
    alternate: node.alternate ? convertIRToESTree(node.alternate) as Statement : null,
    loc: createLoc(node.position)
  };
}

function convertWhileStatement(node: IR.IRWhileStatement): WhileStatement {
  return {
    type: "WhileStatement",
    test: convertIRToESTree(node.test) as Expression,
    body: convertIRToESTree(node.body) as Statement,
    loc: createLoc(node.position)
  };
}

function convertForStatement(node: IR.IRForStatement): ForStatement {
  return {
    type: "ForStatement",
    init: node.init ? convertIRToESTree(node.init) as (VariableDeclaration | Expression) : null,
    test: node.test ? convertIRToESTree(node.test) as Expression : null,
    update: node.update ? convertIRToESTree(node.update) as Expression : null,
    body: convertIRToESTree(node.body) as Statement,
    loc: createLoc(node.position)
  };
}

function convertThrowStatement(node: IR.IRThrowStatement): ThrowStatement {
  return {
    type: "ThrowStatement",
    argument: convertIRToESTree(node.argument) as Expression,
    loc: createLoc(node.position)
  };
}

function convertTryStatement(node: IR.IRTryStatement): TryStatement {
  return {
    type: "TryStatement",
    block: convertBlockStatement(node.block),
    handler: node.handler ? convertCatchClause(node.handler) : null,
    finalizer: node.finalizer ? convertBlockStatement(node.finalizer) : null,
    loc: createLoc(node.position)
  };
}

function convertCatchClause(node: IR.IRCatchClause): CatchClause {
  return {
    type: "CatchClause",
    param: node.param ? convertIdentifier(node.param) : null,
    body: convertBlockStatement(node.body),
    loc: createLoc(node.position)
  };
}

// ============================================================================
// Declaration Converters
// ============================================================================

function convertVariableDeclaration(node: IR.IRVariableDeclaration): VariableDeclaration {
  return {
    type: "VariableDeclaration",
    kind: node.kind,
    declarations: node.declarations.map(decl => convertVariableDeclarator(decl)),
    loc: createLoc(node.position)
  };
}

function convertVariableDeclarator(node: IR.IRVariableDeclarator): VariableDeclarator {
  return {
    type: "VariableDeclarator",
    id: convertPattern(node.id),
    init: convertIRToESTree(node.init) as Expression,
    loc: createLoc(node.position)
  };
}

function convertFunctionDeclaration(node: IR.IRFunctionDeclaration): FunctionDeclaration {
  return {
    type: "FunctionDeclaration",
    id: convertIdentifier(node.id),
    params: node.params.map(param => convertIdentifier(param)),
    body: convertBlockStatement(node.body),
    async: node.async || false,
    generator: false,
    loc: createLoc(node.position)
  };
}

function convertFnFunctionDeclaration(node: IR.IRFnFunctionDeclaration): FunctionDeclaration {
  let params: Pattern[];
  let body: BlockStatement;

  // Check if this function uses JSON map parameters
  if (node.usesJsonMapParams) {
    // Create single parameter: __hql_params = {}
    params = [{
      type: "AssignmentPattern",
      left: { type: "Identifier", name: "__hql_params", loc: null },
      right: { type: "ObjectExpression", properties: [], loc: null },
      loc: null
    }];

    // Generate destructuring statements at the start of function body
    const destructuringStatements: VariableDeclaration[] = [];
    for (const param of node.params) {
      if (param.type === IR.IRNodeType.Identifier) {
        const paramName = param.name;
        const defaultValue = node.defaults.find(d => d.name === paramName)?.value;

        // Generate: const paramName = __hql_params.paramName ?? defaultValue;
        const init: Expression = {
          type: "LogicalExpression",
          operator: "??",
          left: {
            type: "MemberExpression",
            object: { type: "Identifier", name: "__hql_params", loc: null },
            property: { type: "Identifier", name: paramName, loc: null },
            computed: false,
            loc: null
          },
          right: defaultValue ? convertIRToESTree(defaultValue) as Expression : { type: "Identifier", name: "undefined", loc: null },
          loc: null
        };

        destructuringStatements.push({
          type: "VariableDeclaration",
          kind: "const",
          declarations: [{
            type: "VariableDeclarator",
            id: { type: "Identifier", name: paramName, loc: null },
            init,
            loc: null
          }],
          loc: null
        });
      }
    }

    // Prepend destructuring statements to function body
    body = {
      type: "BlockStatement",
      body: [...destructuringStatements, ...convertBlockStatement(node.body).body],
      loc: createLoc(node.body.position)
    };
  } else {
    // Regular parameters with defaults
    params = node.params.map(param => convertPattern(param));

    // Handle default parameters
    if (node.defaults && node.defaults.length > 0) {
      for (const defaultParam of node.defaults) {
        const paramIndex = params.findIndex(
          p => p.type === "Identifier" && p.name === defaultParam.name
        );
        if (paramIndex >= 0) {
          params[paramIndex] = {
            type: "AssignmentPattern",
            left: params[paramIndex],
            right: convertIRToESTree(defaultParam.value) as Expression,
            loc: params[paramIndex].loc
          };
        }
      }
    }

    body = convertBlockStatement(node.body);
  }

  return {
    type: "FunctionDeclaration",
    id: convertIdentifier(node.id),
    params,
    body,
    async: node.async || false,
    generator: false,
    loc: createLoc(node.position)
  };
}

function convertClassDeclaration(node: IR.IRClassDeclaration): ClassDeclaration {
  const body: Array<MethodDefinition> = [];

  // Prepare field initializations for constructor
  const fieldInitializations: ExpressionStatement[] = [];
  for (const field of node.fields) {
    // Create this.fieldName = initialValue (or undefined if no initial value)
    const assignment: AssignmentExpression = {
      type: "AssignmentExpression",
      operator: "=",
      left: {
        type: "MemberExpression",
        object: { type: "Identifier", name: "this", loc: null },
        property: { type: "Identifier", name: field.name, loc: null },
        computed: false,
        loc: createLoc(field.position)
      },
      right: field.initialValue
        ? convertIRToESTree(field.initialValue) as Expression
        : { type: "Identifier", name: "undefined", loc: null },
      loc: createLoc(field.position)
    };

    fieldInitializations.push({
      type: "ExpressionStatement",
      expression: assignment,
      loc: createLoc(field.position)
    });
  }

  // Add constructor (with field initializations prepended)
  if (node.constructor || fieldInitializations.length > 0) {
    const constructorBody = node.constructor
      ? convertBlockStatement(node.constructor.body)
      : { type: "BlockStatement" as const, body: [], loc: null };

    // Prepend field initializations to constructor body
    const finalConstructorBody: BlockStatement = {
      type: "BlockStatement",
      body: [...fieldInitializations, ...constructorBody.body],
      loc: constructorBody.loc
    };

    body.push({
      type: "MethodDefinition",
      key: { type: "Identifier", name: "constructor", loc: null },
      value: {
        type: "FunctionExpression",
        id: null,
        params: node.constructor ? node.constructor.params.map(p => convertIdentifier(p)) : [],
        body: finalConstructorBody,
        async: false,
        generator: false,
        loc: createLoc(node.constructor?.position || node.position)
      },
      kind: "constructor",
      computed: false,
      static: false,
      loc: createLoc(node.constructor?.position || node.position)
    });
  }

  // Add methods
  for (const method of node.methods) {
    const params: Pattern[] = method.params.map(param => convertPattern(param));

    // Handle default parameters
    if (method.defaults && method.defaults.length > 0) {
      for (const defaultParam of method.defaults) {
        const paramIndex = params.findIndex(
          p => p.type === "Identifier" && p.name === defaultParam.name
        );
        if (paramIndex >= 0) {
          params[paramIndex] = {
            type: "AssignmentPattern",
            left: params[paramIndex],
            right: convertIRToESTree(defaultParam.value) as Expression,
            loc: params[paramIndex].loc
          };
        }
      }
    }

    body.push({
      type: "MethodDefinition",
      key: { type: "Identifier", name: method.name, loc: null },
      value: {
        type: "FunctionExpression",
        id: null,
        params,
        body: convertBlockStatement(method.body),
        async: false,
        generator: false,
        loc: createLoc(method.position)
      },
      kind: "method",
      computed: false,
      static: false,
      loc: createLoc(method.position)
    });
  }

  return {
    type: "ClassDeclaration",
    id: convertIdentifier(node.id),
    superClass: null,
    body: {
      type: "ClassBody",
      body,
      loc: createLoc(node.position)
    },
    loc: createLoc(node.position)
  };
}

// ============================================================================
// Pattern Converters
// ============================================================================

// Pattern converter function signature
// Note: Each pattern converter expects a specific type (IRIdentifier, IRArrayPattern, etc.)
type PatternConverter = (node: IR.IRNode) => Pattern;

// Pattern converter registry - maps pattern node types to converter functions
// @ts-ignore: Type cast necessary - converters have specific node types
const patternConverters = new Map<IR.IRNodeType, PatternConverter>([
  [IR.IRNodeType.Identifier, convertIdentifier],
  [IR.IRNodeType.ArrayPattern, convertArrayPattern],
  [IR.IRNodeType.ObjectPattern, convertObjectPattern],
  [IR.IRNodeType.RestElement, convertRestElement],
  [IR.IRNodeType.AssignmentPattern, convertAssignmentPattern],
]);

function convertPattern(node: IR.IRIdentifier | IR.IRArrayPattern | IR.IRObjectPattern | IR.IRRestElement | IR.IRAssignmentPattern): Pattern {
  const converter = patternConverters.get(node.type);
  if (!converter) {
    unsupportedNode(node, "pattern conversion");
  }
  return converter(node);
}

function convertArrayPattern(node: IR.IRArrayPattern): ArrayPattern {
  return {
    type: "ArrayPattern",
    elements: node.elements.map(elem => {
      if (elem === null) return null;
      if (elem.type === IR.IRNodeType.RestElement) {
        return convertRestElement(elem as IR.IRRestElement);
      }
      return convertPattern(elem);
    }),
    loc: createLoc(node.position)
  };
}

function convertObjectPattern(node: IR.IRObjectPattern): ObjectPattern {
  const properties: Array<Property | RestElement> = node.properties.map(prop => {
    return {
      type: "Property",
      key: prop.key.type === IR.IRNodeType.Identifier
        ? convertIdentifier(prop.key as IR.IRIdentifier)
        : convertStringLiteral(prop.key as IR.IRStringLiteral),
      value: convertPattern(prop.value),
      kind: "init",
      method: false,
      shorthand: prop.shorthand || false,
      computed: prop.computed || false,
      loc: createLoc(prop.position)
    } as Property;
  });

  if (node.rest) {
    properties.push(convertRestElement(node.rest));
  }

  return {
    type: "ObjectPattern",
    properties,
    loc: createLoc(node.position)
  };
}

function convertRestElement(node: IR.IRRestElement): RestElement {
  return {
    type: "RestElement",
    argument: convertIdentifier(node.argument),
    loc: createLoc(node.position)
  };
}

function convertSpreadElement(node: IR.IRSpreadElement): SpreadElement {
  return {
    type: "SpreadElement",
    argument: convertIRToESTree(node.argument) as Expression,
    loc: createLoc(node.position)
  };
}

function convertAssignmentPattern(node: IR.IRAssignmentPattern): AssignmentPattern {
  return {
    type: "AssignmentPattern",
    left: convertPattern(node.left),
    right: convertIRToESTree(node.right) as Expression,
    loc: createLoc(node.position)
  };
}

// ============================================================================
// Import/Export Converters
// ============================================================================

function convertImportDeclaration(node: IR.IRImportDeclaration): ImportDeclaration {
  return {
    type: "ImportDeclaration",
    specifiers: node.specifiers.map(spec => {
      if (spec.type === IR.IRNodeType.ImportNamespaceSpecifier) {
        return {
          type: "ImportNamespaceSpecifier",
          local: convertIdentifier((spec as IR.IRImportNamespaceSpecifier).local),
          loc: createLoc(spec.position)
        } as ImportNamespaceSpecifier;
      } else {
        return {
          type: "ImportSpecifier",
          imported: convertIdentifier((spec as IR.IRImportSpecifier).imported),
          local: convertIdentifier((spec as IR.IRImportSpecifier).local),
          loc: createLoc(spec.position)
        } as ImportSpecifier;
      }
    }),
    source: {
      type: "Literal",
      value: node.source,
      raw: JSON.stringify(node.source),
      loc: null
    },
    loc: createLoc(node.position)
  };
}

function convertExportNamedDeclaration(node: IR.IRExportNamedDeclaration): ExportNamedDeclaration {
  return {
    type: "ExportNamedDeclaration",
    declaration: null,
    specifiers: node.specifiers.map(spec => ({
      type: "ExportSpecifier",
      exported: convertIdentifier(spec.exported),
      local: convertIdentifier(spec.local),
      loc: createLoc(spec.position)
    } as ExportSpecifier)),
    source: null,
    loc: createLoc(node.position)
  };
}

function convertExportVariableDeclaration(node: IR.IRExportVariableDeclaration): ExportNamedDeclaration {
  return {
    type: "ExportNamedDeclaration",
    declaration: convertVariableDeclaration(node.declaration),
    specifiers: [],
    source: null,
    loc: createLoc(node.position)
  };
}

// ============================================================================
// JS Interop Converters
// ============================================================================

function convertInteropIIFE(node: IR.IRInteropIIFE): CallExpression {
  // InteropIIFE: HQL property access that auto-calls if method
  // Pattern: (function(_obj) {
  //   const _member = _obj["property"];
  //   return typeof _member === "function" ? _member.call(_obj) : _member;
  // })(object);

  // Get source location for all synthesized nodes (for accurate error mapping)
  const loc = createLoc(node.position);

  const objParam: Identifier = { type: "Identifier", name: "_obj", loc };
  const memberVar: Identifier = { type: "Identifier", name: "_member", loc };

  const iifeBody: BlockStatement = {
    type: "BlockStatement",
    body: [
      // const _member = _obj["property"];
      {
        type: "VariableDeclaration",
        kind: "const",
        declarations: [{
          type: "VariableDeclarator",
          id: memberVar,
          init: {
            type: "MemberExpression",
            object: objParam,
            property: convertStringLiteral(node.property),
            computed: true,
            loc
          },
          loc
        }],
        loc
      },
      // return typeof _member === "function" ? _member.call(_obj) : _member;
      {
        type: "ReturnStatement",
        argument: {
          type: "ConditionalExpression",
          test: {
            type: "BinaryExpression",
            operator: "===",
            left: {
              type: "UnaryExpression",
              operator: "typeof",
              prefix: true,
              argument: memberVar,
              loc
            },
            right: {
              type: "Literal",
              value: "function",
              raw: '"function"',
              loc
            },
            loc
          },
          consequent: {
            type: "CallExpression",
            callee: {
              type: "MemberExpression",
              object: memberVar,
              property: { type: "Identifier", name: "call", loc },
              computed: false,
              loc
            },
            arguments: [objParam],
            loc
          },
          alternate: memberVar,
          loc
        },
        loc
      }
    ],
    loc
  };

  const iifeFn: FunctionExpression = {
    type: "FunctionExpression",
    id: null,
    params: [objParam],
    body: iifeBody,
    async: false,
    generator: false,
    loc
  };

  return {
    type: "CallExpression",
    callee: iifeFn,
    arguments: [convertIRToESTree(node.object) as Expression],
    loc
  };
}

function convertJsMethodAccess(node: IR.IRJsMethodAccess): CallExpression {
  // JsMethodAccess: Runtime check with proper `this` binding
  // Generates: ((o, m) => typeof o[m] === 'function' ? o[m]() : o[m])(obj, 'method')
  // This preserves `this` binding for methods while allowing property access

  const objectExpr = convertIRToESTree(node.object) as Expression;
  const loc = createLoc(node.position);
  const memberExpr = createMemberExpression("o", "m", true, loc);

  // Create IIFE: ((o, m) => typeof o[m] === 'function' ? o[m]() : o[m])(obj, 'method')
  // All synthesized nodes get the same source location for accurate error mapping
  return {
    type: "CallExpression",
    callee: {
      type: "ArrowFunctionExpression",
      params: [
        createSimpleIdentifier("o", loc),
        createSimpleIdentifier("m", loc)
      ],
      body: {
        type: "ConditionalExpression",
        test: {
          type: "BinaryExpression",
          operator: "===",
          left: {
            type: "UnaryExpression",
            operator: "typeof",
            argument: memberExpr,
            prefix: true,
            loc
          },
          right: createStringLiteral("function", loc),
          loc
        },
        consequent: {
          type: "CallExpression",
          callee: createMemberExpression("o", "m", true, loc),
          arguments: [],
          loc
        },
        alternate: createMemberExpression("o", "m", true, loc),
        loc
      } as ConditionalExpression,
      async: false,
      expression: true,
      loc
    } as ArrowFunctionExpression,
    arguments: [
      objectExpr,
      createStringLiteral(node.method, loc)
    ],
    loc
  };
}

function convertJsImportReference(node: IR.IRJsImportReference): Identifier {
  // JsImportReference: Just an identifier that refers to an imported JS value
  return {
    type: "Identifier",
    name: node.name,
    loc: createLoc(node.position)
  };
}

// ============================================================================
// Enum Converter
// ============================================================================

function convertEnumDeclaration(node: IR.IREnumDeclaration): ClassDeclaration | VariableDeclaration {
  // Detect if this is an enum with associated values
  const hasAssociatedValues = node.hasAssociatedValues === true ||
    node.cases.some((c) => c.hasAssociatedValues === true);

  if (hasAssociatedValues) {
    return convertEnumWithAssociatedValues(node);
  } else {
    return convertSimpleEnum(node);
  }
}

/**
 * Convert simple enum (no associated values) to frozen object literal
 * Simple enum: const EnumName = Object.freeze({ Case1: "Case1", Case2: "Case2" })
 * Enum with raw values: const EnumName = Object.freeze({ ok: 200, notFound: 404 })
 */
function convertSimpleEnum(node: IR.IREnumDeclaration): VariableDeclaration {
  const properties: Property[] = node.cases.map(enumCase => {
    const caseName = enumCase.id.name;

    // Determine the value: use raw value if present, otherwise use case name string
    let valueExpr: Expression;
    if (enumCase.rawValue) {
      // Convert raw value IR node to ESTree expression
      valueExpr = convertIRToESTree(enumCase.rawValue) as Expression;
    } else {
      // Default to case name as string literal
      valueExpr = { type: "Literal", value: caseName, raw: `"${caseName}"`, loc: null };
    }

    return {
      type: "Property",
      key: { type: "Identifier", name: caseName, loc: null },
      value: valueExpr,
      kind: "init",
      method: false,
      shorthand: false,
      computed: false,
      loc: createLoc(enumCase.position)
    } as Property;
  });

  // Wrap object literal in Object.freeze() call
  const frozenEnumInit: CallExpression = {
    type: "CallExpression",
    callee: {
      type: "MemberExpression",
      object: { type: "Identifier", name: "Object", loc: null },
      property: { type: "Identifier", name: "freeze", loc: null },
      computed: false,
      loc: null
    },
    arguments: [{
      type: "ObjectExpression",
      properties,
      loc: createLoc(node.position)
    }],
    loc: createLoc(node.position)
  };

  return {
    type: "VariableDeclaration",
    kind: "const",
    declarations: [{
      type: "VariableDeclarator",
      id: convertIdentifier(node.id),
      init: frozenEnumInit,
      loc: createLoc(node.position)
    }],
    loc: createLoc(node.position)
  };
}

/**
 * Convert enum with associated values to class-based implementation
 * Generates a class with:
 * - Private constructor(type, values)
 * - Properties: type, values
 * - Methods: is(type), getValue(key)
 * - Static factory methods for each case
 */
function convertEnumWithAssociatedValues(node: IR.IREnumDeclaration): ClassDeclaration {
  const enumName = node.id.name;
  const body: Array<MethodDefinition | PropertyDefinition> = [];

  // Create constructor (type, values)
  const constructorMethod: MethodDefinition = {
    type: "MethodDefinition",
    key: { type: "Identifier", name: "constructor", loc: null },
    value: {
      type: "FunctionExpression",
      id: null,
      params: [
        { type: "Identifier", name: "type", loc: null },
        { type: "Identifier", name: "values", loc: null }
      ],
      body: {
        type: "BlockStatement",
        body: [
          {
            type: "ExpressionStatement",
            expression: {
              type: "AssignmentExpression",
              operator: "=",
              left: {
                type: "MemberExpression",
                object: { type: "ThisExpression", loc: null },
                property: { type: "Identifier", name: "type", loc: null },
                computed: false,
                loc: null
              },
              right: { type: "Identifier", name: "type", loc: null },
              loc: null
            },
            loc: null
          },
          {
            type: "ExpressionStatement",
            expression: {
              type: "AssignmentExpression",
              operator: "=",
              left: {
                type: "MemberExpression",
                object: { type: "ThisExpression", loc: null },
                property: { type: "Identifier", name: "values", loc: null },
                computed: false,
                loc: null
              },
              right: { type: "Identifier", name: "values", loc: null },
              loc: null
            },
            loc: null
          }
        ],
        loc: null
      },
      async: false,
      generator: false,
      loc: createLoc(node.position)
    },
    kind: "constructor",
    computed: false,
    static: false,
    loc: createLoc(node.position)
  };

  body.push(constructorMethod);

  // Add is() method
  const isMethod: MethodDefinition = {
    type: "MethodDefinition",
    key: { type: "Identifier", name: "is", loc: null },
    value: {
      type: "FunctionExpression",
      id: null,
      params: [{ type: "Identifier", name: "type", loc: null }],
      body: {
        type: "BlockStatement",
        body: [{
          type: "ReturnStatement",
          argument: {
            type: "BinaryExpression",
            operator: "===",
            left: {
              type: "MemberExpression",
              object: { type: "ThisExpression", loc: null },
              property: { type: "Identifier", name: "type", loc: null },
              computed: false,
              loc: null
            },
            right: { type: "Identifier", name: "type", loc: null },
            loc: null
          },
          loc: null
        }],
        loc: null
      },
      async: false,
      generator: false,
      loc: null
    },
    kind: "method",
    computed: false,
    static: false,
    loc: null
  };

  body.push(isMethod);

  // Add static factory methods for each case
  for (const enumCase of node.cases) {
    const caseName = enumCase.id.name;

    // Generate positional parameters from associated values
    const params: Identifier[] = enumCase.associatedValues
      ? enumCase.associatedValues.map(av => ({
          type: "Identifier" as const,
          name: av.name,
          loc: null
        }))
      : [];

    // Construct values object from positional parameters
    // For (case cash amount) → static cash(amount) { return new Payment("cash", {amount}); }
    const valuesArg: ObjectExpression | Identifier = params.length > 0
      ? {
          type: "ObjectExpression",
          properties: params.map(param => ({
            type: "Property",
            key: { type: "Identifier", name: param.name, loc: null },
            value: { type: "Identifier", name: param.name, loc: null },
            kind: "init" as const,
            method: false,
            shorthand: true,
            computed: false,
            loc: null
          })),
          loc: null
        }
      : { type: "Identifier", name: "undefined", loc: null };

    // Factory method: static caseName(param1, param2, ...) { return new EnumName(caseName, {param1, param2, ...}); }
    const factoryMethod: MethodDefinition = {
      type: "MethodDefinition",
      key: { type: "Identifier", name: caseName, loc: null },
      value: {
        type: "FunctionExpression",
        id: null,
        params: params,
        body: {
          type: "BlockStatement",
          body: [{
            type: "ReturnStatement",
            argument: {
              type: "NewExpression",
              callee: { type: "Identifier", name: enumName, loc: null },
              arguments: [
                { type: "Literal", value: caseName, raw: `"${caseName}"`, loc: null },
                valuesArg
              ],
              loc: createLoc(enumCase.position)
            },
            loc: null
          }],
          loc: null
        },
        async: false,
        generator: false,
        loc: createLoc(enumCase.position)
      },
      kind: "method",
      computed: false,
      static: true,
      loc: createLoc(enumCase.position)
    };

    body.push(factoryMethod);
  }

  return {
    type: "ClassDeclaration",
    id: convertIdentifier(node.id),
    superClass: null,
    body: {
      type: "ClassBody",
      body,
      loc: createLoc(node.position)
    },
    loc: createLoc(node.position)
  };
}

// ============================================================================
// Program Converter
// ============================================================================

function convertProgram(node: IR.IRProgram): Program {
  return {
    type: "Program",
    body: node.body.map(stmt => convertIRToESTree(stmt) as Statement | ModuleDeclaration),
    sourceType: "module",
    loc: createLoc(node.position)
  };
}

// ============================================================================
// Runtime Helpers Wrapper
// ============================================================================

/**
 * Wraps an ESTree program with HQL runtime helper injections
 *
 * Runtime helpers (__hql_get, __hql_call, etc.) are automatically initialized
 * by the runtime-helpers.ts ensureHelpers() function, so we don't need to
 * inject them into the generated code.
 *
 * This function is a no-op for now but kept for future extensibility.
 */
/**
 * Detect which runtime helpers are used in the program
 */
function detectUsedHelpers(program: Program): Set<string> {
  const used = new Set<string>();
  const helperNames = ['__hql_get', '__hql_getNumeric', '__hql_range', '__hql_toSequence', '__hql_for_each', '__hql_hash_map', '__hql_throw', '__hql_deepFreeze'];

  // Walk AST tree to find identifier references
  // @ts-ignore: Generic tree traversal - node type varies
  function walk(node: Node | null | undefined): void {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'Identifier' && 'name' in node && helperNames.includes(node.name)) {
      used.add(node.name);
    }

    // Traverse all properties of the node
    for (const key in node) {
      // @ts-ignore: Dynamic property access for generic tree traversal
      const value = node[key];
      if (Array.isArray(value)) {
        value.forEach((item) => walk(item as Node));
      } else if (value && typeof value === 'object') {
        walk(value as Node);
      }
    }
  }

  walk(program);
  return used;
}

export function wrapWithRuntimeHelpers(program: Program): Program {
  // Detect which helpers are actually used in the generated code
  const usedHelpers = detectUsedHelpers(program);

  if (usedHelpers.size === 0) {
    return program;
  }

  logger.debug(`Used runtime helpers: ${Array.from(usedHelpers).join(', ')}`);

  // For now, return the program unchanged
  // The proper implementation would prepend helper function declarations
  // But this requires either:
  // 1. Parsing helper source to ESTree (complex)
  // 2. Hand-crafting ESTree nodes for each helper (verbose but correct)
  //
  // Since the current approach via mod.ts works (just needs source map fix),
  // let's keep it for now and fix the source map issue properly instead

  return program;
}
