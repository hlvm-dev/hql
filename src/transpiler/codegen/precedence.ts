/**
 * Precedence System for Automatic Parenthesization.
 *
 * This module implements JavaScript/TypeScript operator precedence rules
 * to enable intelligent parenthesization during code generation.
 * Instead of wrapping every expression in parentheses, we only add them
 * when necessary based on the context's precedence level.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence
 */

import * as IR from "../type/hql_ir.ts";

/**
 * JavaScript operator precedence levels.
 * Higher values = higher precedence (binds tighter).
 */
export enum Precedence {
  /** Lowest precedence - used as default context */
  Lowest = 0,
  /** Comma operator: a, b */
  Comma = 1,
  /** Assignment: = += -= *= /= %= **= <<= >>= >>>= &= ^= |= &&= ||= ??= */
  Assignment = 2,
  /** Ternary conditional: a ? b : c */
  Conditional = 3,
  /** Nullish coalescing: ?? */
  NullishCoalescing = 4,
  /** Logical OR: || */
  LogicalOr = 5,
  /** Logical AND: && */
  LogicalAnd = 6,
  /** Bitwise OR: | */
  BitwiseOr = 7,
  /** Bitwise XOR: ^ */
  BitwiseXor = 8,
  /** Bitwise AND: & */
  BitwiseAnd = 9,
  /** Equality: == === != !== */
  Equality = 10,
  /** Relational: < > <= >= in instanceof */
  Relational = 11,
  /** Bitwise shift: << >> >>> */
  Shift = 12,
  /** Additive: + - */
  Additive = 13,
  /** Multiplicative: * / % */
  Multiplicative = 14,
  /** Exponentiation: ** (right-associative) */
  Exponentiation = 15,
  /** Unary: ! ~ + - typeof void delete await */
  Unary = 16,
  /** Postfix: ++ -- */
  Postfix = 17,
  /** Function call: () */
  Call = 18,
  /** Member access: . [] */
  Member = 19,
  /** Primary: literals, identifiers, parenthesized */
  Primary = 20,
}

/**
 * Mapping from binary operators to their precedence levels.
 */
const BINARY_OP_PRECEDENCE: Record<string, Precedence> = {
  // Comma
  ",": Precedence.Comma,

  // Assignment operators
  "=": Precedence.Assignment,
  "+=": Precedence.Assignment,
  "-=": Precedence.Assignment,
  "*=": Precedence.Assignment,
  "/=": Precedence.Assignment,
  "%=": Precedence.Assignment,
  "**=": Precedence.Assignment,
  "<<=": Precedence.Assignment,
  ">>=": Precedence.Assignment,
  ">>>=": Precedence.Assignment,
  "&=": Precedence.Assignment,
  "^=": Precedence.Assignment,
  "|=": Precedence.Assignment,
  "&&=": Precedence.Assignment,
  "||=": Precedence.Assignment,
  "??=": Precedence.Assignment,

  // Nullish coalescing
  "??": Precedence.NullishCoalescing,

  // Logical
  "||": Precedence.LogicalOr,
  "&&": Precedence.LogicalAnd,

  // Bitwise
  "|": Precedence.BitwiseOr,
  "^": Precedence.BitwiseXor,
  "&": Precedence.BitwiseAnd,

  // Equality
  "==": Precedence.Equality,
  "===": Precedence.Equality,
  "!=": Precedence.Equality,
  "!==": Precedence.Equality,

  // Relational
  "<": Precedence.Relational,
  ">": Precedence.Relational,
  "<=": Precedence.Relational,
  ">=": Precedence.Relational,
  "in": Precedence.Relational,
  "instanceof": Precedence.Relational,

  // Shift
  "<<": Precedence.Shift,
  ">>": Precedence.Shift,
  ">>>": Precedence.Shift,

  // Additive
  "+": Precedence.Additive,
  "-": Precedence.Additive,

  // Multiplicative
  "*": Precedence.Multiplicative,
  "/": Precedence.Multiplicative,
  "%": Precedence.Multiplicative,

  // Exponentiation
  "**": Precedence.Exponentiation,
};

/**
 * Get the precedence level for an IR expression node.
 *
 * @param node - The IR node to get precedence for
 * @returns The precedence level of the expression
 */
export function getExprPrecedence(node: IR.IRNode): Precedence {
  switch (node.type) {
    case IR.IRNodeType.SequenceExpression:
      return Precedence.Comma;

    case IR.IRNodeType.AssignmentExpression:
      return Precedence.Assignment;

    case IR.IRNodeType.ConditionalExpression:
      return Precedence.Conditional;

    case IR.IRNodeType.LogicalExpression: {
      const op = (node as IR.IRLogicalExpression).operator;
      return BINARY_OP_PRECEDENCE[op] ?? Precedence.LogicalOr;
    }

    case IR.IRNodeType.BinaryExpression: {
      const op = (node as IR.IRBinaryExpression).operator;
      return BINARY_OP_PRECEDENCE[op] ?? Precedence.Primary;
    }

    case IR.IRNodeType.UnaryExpression:
    case IR.IRNodeType.AwaitExpression:
      return Precedence.Unary;

    case IR.IRNodeType.YieldExpression:
      // yield has low precedence, similar to assignment
      return Precedence.Assignment;

    case IR.IRNodeType.CallExpression:
    case IR.IRNodeType.OptionalCallExpression:
    case IR.IRNodeType.NewExpression:
      return Precedence.Call;

    case IR.IRNodeType.MemberExpression:
    case IR.IRNodeType.OptionalMemberExpression:
    case IR.IRNodeType.CallMemberExpression:
      return Precedence.Member;

    // Primary expressions - highest precedence
    case IR.IRNodeType.Identifier:
    case IR.IRNodeType.StringLiteral:
    case IR.IRNodeType.NumericLiteral:
    case IR.IRNodeType.BigIntLiteral:
    case IR.IRNodeType.BooleanLiteral:
    case IR.IRNodeType.NullLiteral:
    case IR.IRNodeType.ArrayExpression:
    case IR.IRNodeType.ObjectExpression:
    case IR.IRNodeType.FunctionExpression:
    case IR.IRNodeType.TemplateLiteral:
      return Precedence.Primary;

    default:
      // Unknown nodes get primary precedence (safe default - won't add extra parens)
      return Precedence.Primary;
  }
}

/**
 * Check if an operator is right-associative.
 * Right-associative operators: ** and all assignment operators.
 *
 * For right-associative operators, we need to parenthesize differently:
 * - Left operand needs parens if its precedence <= operator precedence
 * - Right operand needs parens only if its precedence < operator precedence
 *
 * @param operator - The operator string
 * @returns True if the operator is right-associative
 */
export function isRightAssociative(operator: string): boolean {
  return operator === "**" || operator.endsWith("=");
}

/**
 * Determine if an expression needs parentheses in a given context.
 *
 * @param exprPrec - Precedence of the expression
 * @param contextPrec - Precedence of the surrounding context
 * @returns True if parentheses are needed
 */
export function needsParens(exprPrec: Precedence, contextPrec: Precedence): boolean {
  return exprPrec < contextPrec;
}
