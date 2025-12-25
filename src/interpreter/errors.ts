// src/interpreter/errors.ts - Error types for the HQL interpreter
// Integrated with HQLError system for consistent error handling

import { HQLError, SourceLocation } from "../common/error.ts";
import { HQLErrorCode } from "../common/error-codes.ts";

/**
 * Base error class for interpreter errors
 * Extends HQLError for unified error handling with the transpiler
 */
export class InterpreterError extends HQLError {
  readonly interpreterCode?: string;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    opts: {
      code?: HQLErrorCode;
      interpreterCode?: string;
      context?: Record<string, unknown>;
      sourceLocation?: SourceLocation;
    } = {}
  ) {
    super(message, {
      errorType: "Interpreter Error",
      sourceLocation: opts.sourceLocation,
    });
    this.name = "InterpreterError";
    this.interpreterCode = opts.interpreterCode;
    this.context = opts.context;
    if (opts.code) {
      this.code = opts.code;
    }
  }

  override getSuggestion(): string {
    return "Check the expression being evaluated. The interpreter encountered an unexpected condition.";
  }
}

/**
 * Error: Undefined symbol
 */
export class UndefinedSymbolError extends InterpreterError {
  readonly symbolName: string;

  constructor(symbolName: string, sourceLocation?: SourceLocation) {
    super(`\`${symbolName}\` is not defined`, {
      code: HQLErrorCode.UNDEFINED_VARIABLE,
      interpreterCode: "UNDEFINED_SYMBOL",
      context: { symbol: symbolName },
      sourceLocation,
    });
    this.name = "UndefinedSymbolError";
    this.symbolName = symbolName;
  }

  override getSuggestion(): string {
    return `Check that \`${this.symbolName}\` is defined before use. Look for typos in the name.`;
  }
}

/**
 * Error: Maximum call depth exceeded
 */
export class MaxCallDepthError extends InterpreterError {
  constructor(depth: number, maxDepth: number, sourceLocation?: SourceLocation) {
    super(
      `Maximum call depth exceeded: ${depth} > ${maxDepth}. Possible infinite recursion.`,
      {
        code: HQLErrorCode.FUNCTION_NOT_FOUND, // Using closest match; could add STACK_OVERFLOW code
        interpreterCode: "MAX_CALL_DEPTH",
        context: { depth, maxDepth },
        sourceLocation,
      }
    );
    this.name = "MaxCallDepthError";
  }

  override getSuggestion(): string {
    return "Check for infinite recursion. Ensure recursive functions have a proper base case.";
  }
}

/**
 * Error: Type error during interpretation
 * Named HQLTypeError to avoid shadowing global TypeError
 */
export class HQLTypeError extends InterpreterError {
  readonly expected: string;
  readonly received: string;

  constructor(
    expected: string,
    received: string,
    context?: string,
    sourceLocation?: SourceLocation
  ) {
    const msg = context
      ? `${context}: expected ${expected}, got ${received}`
      : `Expected ${expected}, got ${received}`;
    super(msg, {
      code: HQLErrorCode.TYPE_MISMATCH,
      interpreterCode: "TYPE_ERROR",
      context: { expected, received, contextInfo: context },
      sourceLocation,
    });
    this.name = "HQLTypeError";
    this.expected = expected;
    this.received = received;
  }

  override getSuggestion(): string {
    return `Expected a ${this.expected} but got a ${this.received}. Check the types of your values.`;
  }
}

// Legacy alias for backwards compatibility
export { HQLTypeError as TypeError };

/**
 * Error: Arity error (wrong number of arguments)
 */
export class ArityError extends InterpreterError {
  readonly fnName: string;
  readonly expected: number | string;
  readonly received: number;

  constructor(
    fnName: string,
    expected: number | string,
    received: number,
    sourceLocation?: SourceLocation
  ) {
    const code = typeof expected === "number" && received > expected
      ? HQLErrorCode.TOO_MANY_ARGUMENTS
      : HQLErrorCode.MISSING_REQUIRED_ARGUMENT;

    super(`\`${fnName}\`: expected ${expected} argument(s), got ${received}`, {
      code,
      interpreterCode: "ARITY_ERROR",
      context: { fnName, expected, received },
      sourceLocation,
    });
    this.name = "ArityError";
    this.fnName = fnName;
    this.expected = expected;
    this.received = received;
  }

  override getSuggestion(): string {
    if (typeof this.expected === "number" && this.received > this.expected) {
      return `Remove ${this.received - this.expected} extra argument(s) from the call to \`${this.fnName}\`.`;
    }
    return `Add the missing argument(s) to the call to \`${this.fnName}\`.`;
  }
}

/**
 * Error: Invalid syntax in special form
 * Named HQLSyntaxError to avoid shadowing global SyntaxError
 */
export class HQLSyntaxError extends InterpreterError {
  readonly form: string;

  constructor(form: string, message: string, sourceLocation?: SourceLocation) {
    super(`${form}: ${message}`, {
      code: HQLErrorCode.INVALID_SYNTAX,
      interpreterCode: "SYNTAX_ERROR",
      context: { form },
      sourceLocation,
    });
    this.name = "HQLSyntaxError";
    this.form = form;
  }

  override getSuggestion(): string {
    return `Check the syntax of the \`${this.form}\` form. Refer to the documentation for correct usage.`;
  }
}

// Legacy alias for backwards compatibility
export { HQLSyntaxError as SyntaxError };

/**
 * Get a human-readable type name for error messages
 */
export function getTypeName(value: unknown): string {
  if (value === null) return "nil";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "vector";
  if (value instanceof Map) return "hash-map";
  if (value instanceof Set) return "hash-set";
  if (typeof value === "object" && value !== null) {
    const v = value as { type?: string };
    if (v.type === "hql-function") return "function";
    if (v.type === "symbol") return "symbol";
    if (v.type === "list") return "list";
    if (v.type === "literal") return "literal";
  }
  return typeof value;
}
