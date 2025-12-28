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
  ForOfStatement = 59,

  // Template Literals
  TemplateLiteral = 56,

  // Spread operator
  SpreadElement = 57,

  // Export default
  ExportDefaultDeclaration = 58,

  // Optional chaining
  OptionalMemberExpression = 60,
  OptionalCallExpression = 61,

  // Control flow
  ContinueStatement = 62,
  BreakStatement = 63,

  // Generators
  YieldExpression = 64,

  // Switch statement
  SwitchStatement = 65,
  SwitchCase = 66,

  // Labeled statement
  LabeledStatement = 67,

  // Dynamic import expression
  DynamicImport = 68,

  // BigInt literal
  BigIntLiteral = 69,

  // TypeScript type alias declaration
  TypeAliasDeclaration = 70,

  // TypeScript interface declaration
  InterfaceDeclaration = 71,

  // TypeScript decorators
  Decorator = 72,

  // TypeScript function overload declaration
  FunctionOverload = 73,

  // TypeScript abstract class
  AbstractClassDeclaration = 74,
  AbstractMethod = 75,

  // TypeScript declare statement (ambient declarations)
  DeclareStatement = 76,

  // TypeScript namespace
  NamespaceDeclaration = 77,

  // TypeScript enum (const enum)
  ConstEnumDeclaration = 78,

  // =========================================================================
  // Native TypeScript Type Expressions
  // =========================================================================

  // Type reference (e.g., Person, Array<T>, Map<K, V>)
  TypeReference = 79,

  // keyof T
  KeyofType = 80,

  // T[K] - indexed access
  IndexedAccessType = 81,

  // T extends U ? X : Y - conditional type
  ConditionalType = 82,

  // { [K in keyof T]: T[K] } - mapped type
  MappedType = 83,

  // A | B | C - union type
  UnionType = 84,

  // A & B & C - intersection type
  IntersectionType = 85,

  // [A, B, C] - tuple type
  TupleType = 86,

  // T[] or Array<T> - array type
  ArrayType = 87,

  // (a: A, b: B) => R - function type
  FunctionTypeExpr = 88,

  // infer T
  InferType = 89,

  // readonly T
  ReadonlyType = 90,

  // typeof x
  TypeofType = 91,

  // Literal types: "foo", 42, true
  LiteralType = 92,

  // Rest type in tuple: ...T
  RestType = 93,

  // Optional type in tuple: T?
  OptionalType = 94,
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

export interface IRTemplateLiteral extends IRNode {
  type: IRNodeType.TemplateLiteral;
  quasis: IRNode[]; // Array of string literals
  expressions: IRNode[]; // Array of expressions to interpolate
}

export interface IRNumericLiteral extends IRNode {
  type: IRNodeType.NumericLiteral;
  value: number;
}

export interface IRBigIntLiteral extends IRNode {
  type: IRNodeType.BigIntLiteral;
  value: string; // BigInt can be very large, so we store as string
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
  /** TypeScript type annotation (e.g., "number", "string[]", "T | null") */
  typeAnnotation?: string;
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

export interface IROptionalMemberExpression extends IRNode {
  type: IRNodeType.OptionalMemberExpression;
  object: IRNode;
  property: IRNode;
  computed: boolean;
  optional: boolean; // true if this specific access is optional (?.)
}

export interface IROptionalCallExpression extends IRNode {
  type: IRNodeType.OptionalCallExpression;
  callee: IRNode;
  arguments: IRNode[];
  optional: boolean; // true if this call is optional ?.()
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
  /** Whether this is a generator function (function*) */
  generator?: boolean;
  /** TypeScript return type annotation */
  returnType?: string;
  /** TypeScript generic type parameters */
  typeParameters?: string[];
  /** If true, uses 'this' keyword - generate regular function instead of arrow */
  usesThis?: boolean;
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
  init: IRNode | null;
  /** TypeScript type annotation for the variable */
  typeAnnotation?: string;
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

export interface IRSpreadElement extends IRNode {
  type: IRNodeType.SpreadElement;
  argument: IRNode;
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
  /** Whether this is a generator function (function*) */
  generator?: boolean;
  /** TypeScript return type annotation */
  returnType?: string;
  /** TypeScript generic type parameters */
  typeParameters?: string[];
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
  declaration?: IRNode | null; // The declaration being exported (for declaration exports)
  specifiers: IRExportSpecifier[];
  source?: string | null; // For re-exports from another module
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

export interface IRExportDefaultDeclaration extends IRNode {
  type: IRNodeType.ExportDefaultDeclaration;
  declaration: IRNode; // The expression or declaration being exported as default
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
 * IR node for dynamic import expressions: import("./module.js")
 */
export interface IRDynamicImport extends IRNode {
  type: IRNodeType.DynamicImport;
  source: IRNode; // The module path (usually a string literal, but can be any expression)
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
  /** Whether this is a generator function (function*) */
  generator?: boolean;
  usesJsonMapParams?: boolean;
  /** TypeScript return type annotation (e.g., "number", "Promise<string>") */
  returnType?: string;
  /** TypeScript generic type parameters (e.g., ["T", "U extends string"]) */
  typeParameters?: string[];
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

export interface IRForOfStatement extends IRNode {
  type: IRNodeType.ForOfStatement;
  left: IRVariableDeclaration;
  right: IRNode;
  body: IRBlockStatement;
  /** Whether this is a for-await-of statement (for async iteration) */
  await?: boolean;
}

export interface IRClassDeclaration extends IRNode {
  type: IRNodeType.ClassDeclaration;
  id: IRIdentifier;
  fields: IRClassField[];
  constructor: IRClassConstructor | null;
  methods: IRClassMethod[];
  /** TypeScript generic type parameters (e.g., ["T", "K extends string"]) */
  typeParameters?: string[];
}

export interface IRClassField extends IRNode {
  type: IRNodeType.ClassField;
  name: string;
  mutable: boolean;
  initialValue: IRNode | null;
  /** TypeScript type annotation */
  typeAnnotation?: string;
  /** Whether this is a static field */
  isStatic?: boolean;
  /** Whether this is a private field (uses # prefix) */
  isPrivate?: boolean;
}

export interface IRClassMethod extends IRNode {
  type: IRNodeType.ClassMethod;
  name: string;
  params: (IRIdentifier | IRArrayPattern | IRObjectPattern)[];
  defaults?: { name: string; value: IRNode }[];
  body: IRBlockStatement;
  hasJsonParams?: boolean;
  /** TypeScript return type annotation */
  returnType?: string;
  /** TypeScript generic type parameters */
  typeParameters?: string[];
  /** Whether this is a static method */
  isStatic?: boolean;
  /** Method kind: regular method, getter, or setter */
  kind?: "method" | "get" | "set";
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

// Control flow statements
export interface IRContinueStatement extends IRNode {
  type: IRNodeType.ContinueStatement;
  label?: string;
}

export interface IRBreakStatement extends IRNode {
  type: IRNodeType.BreakStatement;
  label?: string;
}

// Generator expressions
export interface IRYieldExpression extends IRNode {
  type: IRNodeType.YieldExpression;
  argument: IRNode | null;
  /** Whether this is yield* (delegate to another iterator) */
  delegate?: boolean;
}

// Switch statement
export interface IRSwitchStatement extends IRNode {
  type: IRNodeType.SwitchStatement;
  discriminant: IRNode;
  cases: IRSwitchCase[];
}

export interface IRSwitchCase extends IRNode {
  type: IRNodeType.SwitchCase;
  /** The case test expression, or null for default case */
  test: IRNode | null;
  /** Statements in this case */
  consequent: IRNode[];
  /** Whether to fall through to next case (no break) */
  fallthrough?: boolean;
}

// Labeled statement
export interface IRLabeledStatement extends IRNode {
  type: IRNodeType.LabeledStatement;
  label: string;
  body: IRNode;
}

// TypeScript type alias declaration
export interface IRTypeAliasDeclaration extends IRNode {
  type: IRNodeType.TypeAliasDeclaration;
  /** The name of the type alias */
  name: string;
  /** The type expression as a string */
  typeExpression: string;
  /** Optional generic type parameters */
  typeParameters?: string[];
}

// TypeScript interface declaration
export interface IRInterfaceDeclaration extends IRNode {
  type: IRNodeType.InterfaceDeclaration;
  /** The name of the interface */
  name: string;
  /** Interface body as a string (for simple cases) */
  body: string;
  /** Optional generic type parameters */
  typeParameters?: string[];
  /** Optional extends clause */
  extends?: string[];
}

// TypeScript decorator
export interface IRDecorator extends IRNode {
  type: IRNodeType.Decorator;
  /** Decorator expression (e.g., "@Component" or "@Injectable()") */
  expression: IRNode;
}

// TypeScript function overload declaration
export interface IRFunctionOverload extends IRNode {
  type: IRNodeType.FunctionOverload;
  /** Function name */
  name: string;
  /** Parameter signatures as string */
  params: string;
  /** Return type */
  returnType: string;
  /** Generic type parameters */
  typeParameters?: string[];
}

// TypeScript abstract class declaration
export interface IRAbstractClassDeclaration extends IRNode {
  type: IRNodeType.AbstractClassDeclaration;
  /** Class name */
  id: IRIdentifier;
  /** Class body */
  body: IRNode[];
  /** Optional superclass */
  superClass?: IRNode;
  /** Generic type parameters */
  typeParameters?: string[];
  /** Decorators */
  decorators?: IRDecorator[];
}

// TypeScript abstract method
export interface IRAbstractMethod extends IRNode {
  type: IRNodeType.AbstractMethod;
  /** Method name */
  key: IRNode;
  /** Parameters as string */
  params: string;
  /** Return type */
  returnType?: string;
  /** Type parameters */
  typeParameters?: string[];
}

// TypeScript declare statement (ambient declarations)
export interface IRDeclareStatement extends IRNode {
  type: IRNodeType.DeclareStatement;
  /** The declaration kind */
  kind: "function" | "class" | "var" | "const" | "let" | "module" | "namespace";
  /** Declaration body as string */
  body: string;
}

// TypeScript namespace declaration
export interface IRNamespaceDeclaration extends IRNode {
  type: IRNodeType.NamespaceDeclaration;
  /** Namespace name */
  name: string;
  /** Namespace body */
  body: IRNode[];
  /** Whether this is a module namespace */
  isModule?: boolean;
}

// TypeScript const enum declaration
export interface IRConstEnumDeclaration extends IRNode {
  type: IRNodeType.ConstEnumDeclaration;
  /** Enum name */
  id: IRIdentifier;
  /** Enum members */
  members: Array<{ name: string; value?: number | string }>;
}

// =============================================================================
// Native TypeScript Type Expression Interfaces
// =============================================================================

/** Base type for all type expressions */
export type IRTypeExpression =
  | IRTypeReference
  | IRKeyofType
  | IRIndexedAccessType
  | IRConditionalType
  | IRMappedType
  | IRUnionType
  | IRIntersectionType
  | IRTupleType
  | IRArrayType
  | IRFunctionTypeExpr
  | IRInferType
  | IRReadonlyType
  | IRTypeofType
  | IRLiteralType
  | IRRestType
  | IROptionalType;

/** Type reference: Person, Array<T>, Map<K, V> */
export interface IRTypeReference extends IRNode {
  type: IRNodeType.TypeReference;
  /** Type name */
  name: string;
  /** Generic type arguments */
  typeArguments?: IRTypeExpression[];
}

/** keyof T */
export interface IRKeyofType extends IRNode {
  type: IRNodeType.KeyofType;
  /** The type to get keys from */
  argument: IRTypeExpression;
}

/** T[K] - indexed access type */
export interface IRIndexedAccessType extends IRNode {
  type: IRNodeType.IndexedAccessType;
  /** Object type */
  objectType: IRTypeExpression;
  /** Index type */
  indexType: IRTypeExpression;
}

/** T extends U ? X : Y - conditional type */
export interface IRConditionalType extends IRNode {
  type: IRNodeType.ConditionalType;
  /** Check type */
  checkType: IRTypeExpression;
  /** Extends type */
  extendsType: IRTypeExpression;
  /** True branch */
  trueType: IRTypeExpression;
  /** False branch */
  falseType: IRTypeExpression;
}

/** { [K in keyof T]: T[K] } - mapped type */
export interface IRMappedType extends IRNode {
  type: IRNodeType.MappedType;
  /** Type parameter name (K) */
  typeParameter: string;
  /** Constraint (keyof T) */
  constraint: IRTypeExpression;
  /** Value type (T[K]) */
  valueType: IRTypeExpression;
  /** Optional readonly modifier */
  readonly?: boolean | "+" | "-";
  /** Optional optional modifier */
  optional?: boolean | "+" | "-";
}

/** A | B | C - union type */
export interface IRUnionType extends IRNode {
  type: IRNodeType.UnionType;
  /** Union members */
  types: IRTypeExpression[];
}

/** A & B & C - intersection type */
export interface IRIntersectionType extends IRNode {
  type: IRNodeType.IntersectionType;
  /** Intersection members */
  types: IRTypeExpression[];
}

/** [A, B, C] - tuple type */
export interface IRTupleType extends IRNode {
  type: IRNodeType.TupleType;
  /** Tuple element types */
  elements: IRTypeExpression[];
  /** Named tuple labels */
  labels?: string[];
}

/** T[] - array type */
export interface IRArrayType extends IRNode {
  type: IRNodeType.ArrayType;
  /** Element type */
  elementType: IRTypeExpression;
}

/** (a: A, b: B) => R - function type */
export interface IRFunctionTypeExpr extends IRNode {
  type: IRNodeType.FunctionTypeExpr;
  /** Parameter types with names */
  parameters: Array<{ name?: string; type: IRTypeExpression; optional?: boolean }>;
  /** Return type */
  returnType: IRTypeExpression;
  /** Type parameters */
  typeParameters?: string[];
}

/** infer T */
export interface IRInferType extends IRNode {
  type: IRNodeType.InferType;
  /** Inferred type parameter name */
  typeParameter: string;
}

/** readonly T */
export interface IRReadonlyType extends IRNode {
  type: IRNodeType.ReadonlyType;
  /** The type to make readonly */
  argument: IRTypeExpression;
}

/** typeof x */
export interface IRTypeofType extends IRNode {
  type: IRNodeType.TypeofType;
  /** Expression to get type of */
  expression: string;
}

/** Literal type: "foo", 42, true */
export interface IRLiteralType extends IRNode {
  type: IRNodeType.LiteralType;
  /** Literal value */
  value: string | number | boolean;
}

/** Rest type in tuple: ...T */
export interface IRRestType extends IRNode {
  type: IRNodeType.RestType;
  /** The type being spread */
  argument: IRTypeExpression;
}

/** Optional type: T? */
export interface IROptionalType extends IRNode {
  type: IRNodeType.OptionalType;
  /** The optional type */
  argument: IRTypeExpression;
}
