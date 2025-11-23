// src/transpiler/hql_ir.ts - Updated with explicit enum values

export enum IRNodeType {
  Program = 0,
  StringLiteral = 1,
  NumericLiteral = 2,
  BooleanLiteral = 3,
  NullLiteral = 4,
  Identifier = 5,

  // Expressions
  CallExpression = 6,
  MemberExpression = 7,
  CallMemberExpression = 8,
  NewExpression = 9,
  BinaryExpression = 10,
  UnaryExpression = 11,
  ConditionalExpression = 12,
  ArrayExpression = 13,
  LogicalExpression = 14,
  FunctionExpression = 15,
  ObjectExpression = 16,
  ObjectProperty = 17,

  // Statements/Declarations
  VariableDeclaration = 18,
  VariableDeclarator = 19,
  FunctionDeclaration = 20,
  ReturnStatement = 21,
  BlockStatement = 22,

  // Import/Export
  ImportDeclaration = 23,
  ImportSpecifier = 24,
  ImportNamespaceSpecifier = 53,
  ExportNamedDeclaration = 25,
  ExportSpecifier = 26,
  ExportVariableDeclaration = 27,

  // JS Interop
  InteropIIFE = 28,

  // Other
  CommentBlock = 29,
  Raw = 30,

  JsImportReference = 31,
  AssignmentExpression = 32,
  SpreadAssignment = 33,
  ExpressionStatement = 34,
  FnFunctionDeclaration = 35,
  IfStatement = 36,

  ClassDeclaration = 37,
  ClassField = 38,
  ClassMethod = 39,
  ClassConstructor = 40,

  // Enum Types
  EnumDeclaration = 42,
  EnumCase = 43,
  JsMethodAccess = 44,
  AwaitExpression = 45,
  TryStatement = 46,
  CatchClause = 47,
  ThrowStatement = 48,

  // Destructuring Patterns
  ArrayPattern = 49,
  ObjectPattern = 50,
  RestElement = 51,
  AssignmentPattern = 52,

  // Loop Statements
  WhileStatement = 54,
  ForStatement = 55,
}

export interface SourcePosition {
  line?: number;
  column?: number;
  filePath?: string;
}

export interface IRNode {
  type: IRNodeType;
  position?: SourcePosition;
}

export interface IRProgram extends IRNode {
  type: IRNodeType.Program;
  body: IRNode[];
}

// Literals
export interface IRStringLiteral extends IRNode {
  type: IRNodeType.StringLiteral;
  value: string;
}

export interface IRNumericLiteral extends IRNode {
  type: IRNodeType.NumericLiteral;
  value: number;
}

export interface IRBooleanLiteral extends IRNode {
  type: IRNodeType.BooleanLiteral;
  value: boolean;
}

export interface IRNullLiteral extends IRNode {
  type: IRNodeType.NullLiteral;
}

// Identifiers
export interface IRIdentifier extends IRNode {
  type: IRNodeType.Identifier;
  name: string;
  originalName?: string;
  isJS?: boolean;
}

// Expressions
export interface IRCallExpression extends IRNode {
  type: IRNodeType.CallExpression;
  callee: IRIdentifier | IRMemberExpression | IRFunctionExpression;
  arguments: IRNode[];
}

export interface IRAssignmentExpression extends IRNode {
  type: IRNodeType.AssignmentExpression;
  operator: string;
  left: IRNode;
  right: IRNode;
}

export interface IRMemberExpression extends IRNode {
  type: IRNodeType.MemberExpression;
  object: IRNode;
  property: IRNode;
  computed: boolean;
}

export interface IRCallMemberExpression extends IRNode {
  type: IRNodeType.CallMemberExpression;
  object: IRNode;
  property: IRNode;
  arguments: IRNode[];
}

export interface IRNewExpression extends IRNode {
  type: IRNodeType.NewExpression;
  callee: IRNode;
  arguments: IRNode[];
}

export interface IRBinaryExpression extends IRNode {
  type: IRNodeType.BinaryExpression;
  operator: string;
  left: IRNode;
  right: IRNode;
}

export interface IRUnaryExpression extends IRNode {
  type: IRNodeType.UnaryExpression;
  operator: string;
  argument: IRNode;
  prefix?: boolean; // true for ++i, false for i++
}

export interface IRLogicalExpression extends IRNode {
  type: IRNodeType.LogicalExpression;
  operator: "&&" | "||" | "??";
  left: IRNode;
  right: IRNode;
}

export interface IRConditionalExpression extends IRNode {
  type: IRNodeType.ConditionalExpression;
  test: IRNode;
  consequent: IRNode;
  alternate: IRNode;
}

export interface IRArrayExpression extends IRNode {
  type: IRNodeType.ArrayExpression;
  elements: IRNode[];
}

export interface IRFunctionExpression extends IRNode {
  type: IRNodeType.FunctionExpression;
  id: IRIdentifier | null;
  params: (IRIdentifier | IRArrayPattern | IRObjectPattern)[];
  body: IRBlockStatement;
  async?: boolean;
}

// Object literal support (for maps)
export interface IRObjectProperty extends IRNode {
  type: IRNodeType.ObjectProperty;
  key: IRNode;
  value: IRNode;
  computed?: boolean;
}

export interface IRSpreadAssignment extends IRNode {
  type: IRNodeType.SpreadAssignment;
  expression: IRNode;
}

export interface IRExpressionStatement extends IRNode {
  type: IRNodeType.ExpressionStatement;
  expression: IRNode;
}

// Update the ObjectExpression interface:
export interface IRObjectExpression extends IRNode {
  type: IRNodeType.ObjectExpression;
  properties: (IRObjectProperty | IRSpreadAssignment)[];
}

// Statements/Declarations
export interface IRVariableDeclaration extends IRNode {
  type: IRNodeType.VariableDeclaration;
  kind: "const" | "let" | "var";
  declarations: IRVariableDeclarator[];
}

export interface IRVariableDeclarator extends IRNode {
  type: IRNodeType.VariableDeclarator;
  id: IRIdentifier | IRArrayPattern | IRObjectPattern | IRRestElement | IRAssignmentPattern;
  init: IRNode;
}

// Destructuring Pattern Types
export interface IRArrayPattern extends IRNode {
  type: IRNodeType.ArrayPattern;
  elements: (
    | IRIdentifier
    | IRArrayPattern
    | IRObjectPattern
    | IRAssignmentPattern
    | IRRestElement
    | null
  )[];
}

export interface IRObjectPattern extends IRNode {
  type: IRNodeType.ObjectPattern;
  properties: IRObjectPatternProperty[];
  rest?: IRRestElement; // For {x, ...rest} patterns
}

export interface IRObjectPatternProperty extends IRNode {
  type: IRNodeType.ObjectProperty;
  key: IRIdentifier | IRStringLiteral;
  value: IRIdentifier | IRArrayPattern | IRObjectPattern | IRAssignmentPattern;
  shorthand?: boolean;
  computed?: boolean;
}

export interface IRRestElement extends IRNode {
  type: IRNodeType.RestElement;
  argument: IRIdentifier;
}

export interface IRAssignmentPattern extends IRNode {
  type: IRNodeType.AssignmentPattern;
  left: IRIdentifier | IRArrayPattern | IRObjectPattern;
  right: IRNode;
}

export interface IRFunctionDeclaration extends IRNode {
  type: IRNodeType.FunctionDeclaration;
  id: IRIdentifier;
  params: IRIdentifier[];
  body: IRBlockStatement;
  async?: boolean;
}

export interface IRReturnStatement extends IRNode {
  type: IRNodeType.ReturnStatement;
  argument: IRNode;
}

export interface IRBlockStatement extends IRNode {
  type: IRNodeType.BlockStatement;
  body: IRNode[];
}

// Import/Export
export interface IRImportDeclaration extends IRNode {
  type: IRNodeType.ImportDeclaration;
  source: string;
  specifiers: (IRImportSpecifier | IRImportNamespaceSpecifier)[];
}

export interface IRExportNamedDeclaration extends IRNode {
  type: IRNodeType.ExportNamedDeclaration;
  specifiers: IRExportSpecifier[];
}

export interface IRExportSpecifier extends IRNode {
  type: IRNodeType.ExportSpecifier;
  local: IRIdentifier;
  exported: IRIdentifier;
}

export interface IRExportVariableDeclaration extends IRNode {
  type: IRNodeType.ExportVariableDeclaration;
  declaration: IRVariableDeclaration;
  exportName: string;
}

// JS Interop
export interface IRInteropIIFE extends IRNode {
  type: IRNodeType.InteropIIFE;
  object: IRNode;
  property: IRStringLiteral;
}

// IR node for JS import references
export interface IRJsImportReference extends IRNode {
  type: IRNodeType.JsImportReference;
  name: string;
  source: string;
}

export interface IRImportSpecifier extends IRNode {
  type: IRNodeType.ImportSpecifier;
  imported: IRIdentifier;
  local: IRIdentifier;
}

export interface IRImportNamespaceSpecifier extends IRNode {
  type: IRNodeType.ImportNamespaceSpecifier;
  local: IRIdentifier;
}

/**
 * IR node for fn function declarations
 */
export interface IRFnFunctionDeclaration extends IRNode {
  type: IRNodeType.FnFunctionDeclaration;
  id: IRIdentifier;
  params: (IRIdentifier | IRArrayPattern | IRObjectPattern)[];
  defaults: { name: string; value: IRNode }[];
  body: IRBlockStatement;
  async?: boolean;
  usesJsonMapParams?: boolean;
}

export interface IRAwaitExpression extends IRNode {
  type: IRNodeType.AwaitExpression;
  argument: IRNode;
}

export interface IRCatchClause extends IRNode {
  type: IRNodeType.CatchClause;
  param: IRIdentifier | null;
  body: IRBlockStatement;
}

export interface IRThrowStatement extends IRNode {
  type: IRNodeType.ThrowStatement;
  argument: IRNode;
}

export interface IRTryStatement extends IRNode {
  type: IRNodeType.TryStatement;
  block: IRBlockStatement;
  handler?: IRCatchClause | null;
  finalizer?: IRBlockStatement | null;
}

export interface IRIfStatement extends IRNode {
  type: IRNodeType.IfStatement;
  test: IRNode;
  consequent: IRNode;
  alternate: IRNode | null;
}

export interface IRWhileStatement extends IRNode {
  type: IRNodeType.WhileStatement;
  test: IRNode;
  body: IRBlockStatement;
}

export interface IRForStatement extends IRNode {
  type: IRNodeType.ForStatement;
  init: IRVariableDeclaration | IRNode | null;
  test: IRNode | null;
  update: IRNode | null;
  body: IRBlockStatement;
}

export interface IRClassDeclaration extends IRNode {
  type: IRNodeType.ClassDeclaration;
  id: IRIdentifier;
  fields: IRClassField[];
  constructor: IRClassConstructor | null;
  methods: IRClassMethod[];
}

export interface IRClassField extends IRNode {
  type: IRNodeType.ClassField;
  name: string;
  mutable: boolean;
  initialValue: IRNode | null;
}

export interface IRClassMethod extends IRNode {
  type: IRNodeType.ClassMethod;
  name: string;
  params: (IRIdentifier | IRArrayPattern | IRObjectPattern)[];
  defaults?: { name: string; value: IRNode }[];
  body: IRBlockStatement;
}

export interface IRClassConstructor extends IRNode {
  type: IRNodeType.ClassConstructor;
  params: IRIdentifier[];
  body: IRBlockStatement;
}

// --- Enum Types (Enhanced definitions) ---

/**
 * Associated value for enum cases with parameters
 * @example (case success value message)
 */
export interface IREnumAssociatedValue {
  name: string;
}

/**
 * Represents an enum declaration: (enum TypeName ...)
 */
export interface IREnumDeclaration extends IRNode {
  type: IRNodeType.EnumDeclaration;
  id: IRIdentifier;
  rawType?: string;
  cases: IREnumCase[];
  hasAssociatedValues?: boolean;
}

/**
 * Represents an enum case declaration
 *
 * @example (case success)           - Simple case
 * @example (case error 404)         - Case with raw value
 * @example (case data value)        - Case with associated values
 */
export interface IREnumCase extends IRNode {
  type: IRNodeType.EnumCase;
  id: IRIdentifier;
  rawValue?: IRNode | null;
  associatedValues?: IREnumAssociatedValue[];
  hasAssociatedValues?: boolean;
}

export interface IRJsMethodAccess extends IRNode {
  type: IRNodeType.JsMethodAccess;
  object: IRNode;
  method: string;
}

// ============================================================================
// Helper Type Guards
// ============================================================================

/**
 * Check if a parameter is a destructuring pattern (array or object).
 * Used to distinguish pattern parameters from identifier parameters.
 *
 * @param param - Parameter node to check
 * @returns true if param is ArrayPattern or ObjectPattern
 *
 * @example
 * // Pattern parameter
 * isPatternParam({ type: IRNodeType.ArrayPattern, elements: [...] })
 * // → true
 *
 * @example
 * // Identifier parameter
 * isPatternParam({ type: IRNodeType.Identifier, name: "x" })
 * // → false
 */
export function isPatternParam(
  param: IRIdentifier | IRArrayPattern | IRObjectPattern,
): param is IRArrayPattern | IRObjectPattern {
  return param.type === IRNodeType.ArrayPattern ||
    param.type === IRNodeType.ObjectPattern;
}
