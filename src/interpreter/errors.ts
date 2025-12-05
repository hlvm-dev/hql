// src/interpreter/errors.ts - Error types for the HQL interpreter

/**
 * Base error class for interpreter errors
 */
export class InterpreterError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "InterpreterError";
    // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InterpreterError);
    }
  }
}

/**
 * Error: Undefined symbol
 */
export class UndefinedSymbolError extends InterpreterError {
  constructor(symbolName: string) {
    super(`Undefined symbol: ${symbolName}`, "UNDEFINED_SYMBOL", {
      symbol: symbolName,
    });
    this.name = "UndefinedSymbolError";
  }
}

/**
 * Error: Maximum call depth exceeded
 */
export class MaxCallDepthError extends InterpreterError {
  constructor(depth: number, maxDepth: number) {
    super(
      `Maximum call depth exceeded: ${depth} > ${maxDepth}. Possible infinite recursion.`,
      "MAX_CALL_DEPTH",
      { depth, maxDepth }
    );
    this.name = "MaxCallDepthError";
  }
}

/**
 * Error: Type error during interpretation
 */
export class TypeError extends InterpreterError {
  constructor(expected: string, received: string, context?: string) {
    const msg = context
      ? `${context}: expected ${expected}, got ${received}`
      : `Expected ${expected}, got ${received}`;
    super(msg, "TYPE_ERROR", { expected, received, context });
    this.name = "TypeError";
  }
}

/**
 * Error: Arity error (wrong number of arguments)
 */
export class ArityError extends InterpreterError {
  constructor(
    fnName: string,
    expected: number | string,
    received: number
  ) {
    super(
      `${fnName}: expected ${expected} arguments, got ${received}`,
      "ARITY_ERROR",
      { fnName, expected, received }
    );
    this.name = "ArityError";
  }
}

/**
 * Error: Invalid syntax in special form
 */
export class SyntaxError extends InterpreterError {
  constructor(form: string, message: string) {
    super(`${form}: ${message}`, "SYNTAX_ERROR", { form });
    this.name = "SyntaxError";
  }
}

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
