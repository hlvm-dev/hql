/**
 * Data Tools - Generic data transformations for AI agents
 *
 * Provides:
 * - aggregate_entries: numeric aggregations (sum, count, avg, min, max)
 * - filter_entries: filter arrays by field conditions
 * - transform_entries: extract or transform fields in arrays
 * - compute: evaluate simple math expressions with named values
 */

import { ValidationError } from "../../../common/error.ts";
import { throwIfAborted } from "../../../common/timeout-utils.ts";
import { isObjectValue } from "../../../common/utils.ts";
import { okTool } from "../tool-results.ts";
import { isToolArgsObject } from "../validation.ts";
import type { ToolExecutionOptions, ToolMetadata } from "../registry.ts";

// ============================================================
// Types
// ============================================================

type AggregateOperation = "sum" | "count" | "average" | "min" | "max";
type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte";
type TransformOperation = "pluck" | "length" | "uppercase" | "lowercase";

interface AggregateEntriesArgs {
  items: unknown[];
  operation: AggregateOperation;
  field?: string;
}

interface FilterEntriesArgs {
  items: unknown[];
  field: string;
  operator: FilterOperator;
  value: unknown;
}

interface TransformEntriesArgs {
  items: unknown[];
  operation: TransformOperation;
  field?: string;
}

interface ComputeArgs {
  expression: string;
  values?: Record<string, number>;
}

// ============================================================
// Helpers
// ============================================================

function requireArgsObject(
  args: unknown,
  toolName: string,
): Record<string, unknown> {
  if (!isToolArgsObject(args)) {
    throw new ValidationError("args must be an object", toolName);
  }
  return args;
}

function requireArray(
  value: unknown,
  name: string,
  toolName: string,
): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${name} must be an array`, toolName);
  }
  return value;
}

function requireString(
  value: unknown,
  name: string,
  toolName: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${name} must be a non-empty string`, toolName);
  }
  return value;
}

function optionalString(
  value: unknown,
  name: string,
  toolName: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${name} must be a string`, toolName);
  }
  return value;
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
  toolName: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(
      `${name} must be one of: ${allowed.join(", ")}`,
      toolName,
    );
  }
  return value as T;
}

function getFieldValue(item: unknown, field?: string): unknown {
  if (!field) return item;
  if (isObjectValue(item) && field in item) {
    return (item as Record<string, unknown>)[field];
  }
  return undefined;
}

function formatJsonResult(
  result: unknown,
): { returnDisplay: string; llmContent?: string } {
  const serialized = typeof result === "string"
    ? result
    : JSON.stringify(result, null, 2);
  return { returnDisplay: serialized, llmContent: serialized };
}

// ============================================================
// Tool: aggregate_entries
// ============================================================

function aggregateEntries(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  throwIfAborted(options?.signal);
  const record = requireArgsObject(args, "aggregate_entries");

  const items = requireArray(record.items, "items", "aggregate_entries");
  const operation = parseEnum(
    record.operation,
    ["sum", "count", "average", "min", "max"] as const,
    "operation",
    "aggregate_entries",
  );
  const field = optionalString(record.field, "field", "aggregate_entries");

  if (operation === "count") {
    return Promise.resolve(okTool({
      operation,
      field,
      value: items.length,
      itemsCount: items.length,
      valueCount: items.length,
    }));
  }

  const values = items
    .map((item) => getFieldValue(item, field))
    .filter((value): value is number =>
      typeof value === "number" && !Number.isNaN(value)
    );

  let value: number | null = null;
  if (values.length > 0) {
    switch (operation) {
      case "sum":
        value = values.reduce((acc, next) => acc + next, 0);
        break;
      case "average":
        value = values.reduce((acc, next) => acc + next, 0) / values.length;
        break;
      case "min":
        value = Math.min(...values);
        break;
      case "max":
        value = Math.max(...values);
        break;
    }
  }

  return Promise.resolve(okTool({
    operation,
    field,
    value,
    itemsCount: items.length,
    valueCount: values.length,
  }));
}

function formatAggregateResult(
  result: unknown,
): { returnDisplay: string; llmContent?: string } {
  if (!isObjectValue(result)) return formatJsonResult(result);
  const record = result as Record<string, unknown>;
  if (record.success === false) return formatJsonResult(result);
  const operation = String(record.operation ?? "aggregate");
  const field = typeof record.field === "string" && record.field
    ? `(${record.field})`
    : "";
  const value = record.value === null || record.value === undefined
    ? "null"
    : String(record.value);
  const label = operation === "count" ? "Count" : `${operation}${field}`;
  return {
    returnDisplay: `${label}: ${value}`,
    llmContent: JSON.stringify(record, null, 2),
  };
}

// ============================================================
// Tool: filter_entries
// ============================================================

function filterEntries(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  throwIfAborted(options?.signal);
  const record = requireArgsObject(args, "filter_entries");

  const items = requireArray(record.items, "items", "filter_entries");
  const field = requireString(record.field, "field", "filter_entries");
  const operator = parseEnum(
    record.operator,
    ["equals", "not_equals", "contains", "gt", "gte", "lt", "lte"] as const,
    "operator",
    "filter_entries",
  );
  const value = record.value;

  const filtered = items.filter((item) => {
    const candidate = getFieldValue(item, field);
    switch (operator) {
      case "equals":
        return candidate === value;
      case "not_equals":
        return candidate !== value;
      case "contains":
        if (typeof candidate === "string" && typeof value === "string") {
          return candidate.includes(value);
        }
        if (Array.isArray(candidate)) {
          return candidate.includes(value);
        }
        return false;
      case "gt":
        return typeof candidate === "number" && typeof value === "number" &&
          candidate > value;
      case "gte":
        return typeof candidate === "number" && typeof value === "number" &&
          candidate >= value;
      case "lt":
        return typeof candidate === "number" && typeof value === "number" &&
          candidate < value;
      case "lte":
        return typeof candidate === "number" && typeof value === "number" &&
          candidate <= value;
      default:
        return false;
    }
  });

  return Promise.resolve(okTool({
    items: filtered,
    count: filtered.length,
    itemsCount: items.length,
  }));
}

function formatFilterResult(
  result: unknown,
): { returnDisplay: string; llmContent?: string } {
  if (!isObjectValue(result)) return formatJsonResult(result);
  const record = result as Record<string, unknown>;
  if (record.success === false) return formatJsonResult(result);
  const count = typeof record.count === "number" ? record.count : 0;
  const total = typeof record.itemsCount === "number" ? record.itemsCount : 0;
  return {
    returnDisplay: `Filtered ${count} of ${total} entries.`,
    llmContent: JSON.stringify(record, null, 2),
  };
}

// ============================================================
// Tool: transform_entries
// ============================================================

function transformEntries(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  throwIfAborted(options?.signal);
  const record = requireArgsObject(args, "transform_entries");

  const items = requireArray(record.items, "items", "transform_entries");
  const operation = parseEnum(
    record.operation,
    ["pluck", "length", "uppercase", "lowercase"] as const,
    "operation",
    "transform_entries",
  );
  const field = optionalString(record.field, "field", "transform_entries");

  const transformed = items.map((item) => {
    const candidate = getFieldValue(item, field);
    switch (operation) {
      case "pluck":
        return candidate;
      case "length":
        if (typeof candidate === "string" || Array.isArray(candidate)) {
          return candidate.length;
        }
        return null;
      case "uppercase":
        return typeof candidate === "string"
          ? candidate.toUpperCase()
          : candidate;
      case "lowercase":
        return typeof candidate === "string"
          ? candidate.toLowerCase()
          : candidate;
      default:
        return candidate;
    }
  });

  return Promise.resolve(okTool({
    operation,
    field,
    items: transformed,
    count: transformed.length,
  }));
}

function formatTransformResult(
  result: unknown,
): { returnDisplay: string; llmContent?: string } {
  if (!isObjectValue(result)) return formatJsonResult(result);
  const record = result as Record<string, unknown>;
  if (record.success === false) return formatJsonResult(result);
  const count = typeof record.count === "number" ? record.count : 0;
  return {
    returnDisplay: `Transformed ${count} entries.`,
    llmContent: JSON.stringify(record, null, 2),
  };
}

// ============================================================
// Tool: compute
// ============================================================

function parseValues(
  value: unknown,
  toolName: string,
): Record<string, number> {
  if (value === undefined || value === null) return {};
  if (!isObjectValue(value) || Array.isArray(value)) {
    throw new ValidationError("values must be an object", toolName);
  }
  const record = value as Record<string, unknown>;
  const parsed: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "number" || Number.isNaN(entry)) {
      throw new ValidationError(
        `values.${key} must be a number`,
        toolName,
      );
    }
    parsed[key] = entry;
  }
  return parsed;
}

// Safe math functions available in expressions (no property access, no code generation)
const MATH_FUNCTIONS: Readonly<Record<string, (...args: number[]) => number>> =
  {
    abs: Math.abs,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    sqrt: Math.sqrt,
    min: (...args: number[]) => Math.min(...args),
    max: (...args: number[]) => Math.max(...args),
    pow: Math.pow,
    log: Math.log,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
  };

/**
 * Safe math expression evaluator using recursive descent parsing.
 * Replaces the previous new Function() approach which was vulnerable to
 * prototype chain traversal via dot notation (e.g. a.constructor.constructor).
 *
 * Supports: +, -, *, /, %, ** (power), parentheses, number literals,
 * variable references, and whitelisted Math functions.
 * NO property access, NO Function construction, NO eval.
 *
 * Grammar:
 *   expr           = additive
 *   additive       = multiplicative (('+' | '-') multiplicative)*
 *   multiplicative = power (('*' | '/' | '%') power)*
 *   power          = unary ('**' unary)*   (right-associative)
 *   unary          = ('-' | '+') unary | primary
 *   primary        = NUMBER | IDENT '(' expr (',' expr)* ')' | IDENT | '(' expr ')'
 */
function evaluateExpression(
  expression: string,
  values: Record<string, number>,
  toolName: string,
): number {
  const src = expression.trim();
  if (!src) {
    throw new ValidationError("expression must be non-empty", toolName);
  }

  // Reject characters that have no place in a math expression.
  // Allowed: digits, letters, underscores, operators, parens, commas,
  // dots (for decimal literals only -- the parser enforces this structurally),
  // and whitespace.
  const allowedChars = /^[0-9A-Za-z_+\-*/%().,\s]*$/;
  if (!allowedChars.test(src)) {
    throw new ValidationError(
      "expression contains unsupported characters",
      toolName,
    );
  }

  let pos = 0;

  function skipWs(): void {
    while (pos < src.length && /\s/.test(src[pos])) pos++;
  }

  function peek(): string {
    skipWs();
    return src[pos] ?? "";
  }

  function consume(ch: string): void {
    skipWs();
    if (src[pos] !== ch) {
      throw new ValidationError(
        `Expected '${ch}' at position ${pos} in expression`,
        toolName,
      );
    }
    pos++;
  }

  function parseNumberLiteral(): number {
    skipWs();
    const start = pos;
    while (pos < src.length && /[0-9]/.test(src[pos])) pos++;
    if (pos < src.length && src[pos] === ".") {
      pos++;
      if (pos >= src.length || !/[0-9]/.test(src[pos])) {
        throw new ValidationError(
          `Invalid number at position ${start} in expression`,
          toolName,
        );
      }
      while (pos < src.length && /[0-9]/.test(src[pos])) pos++;
    }
    if (pos === start) {
      throw new ValidationError(
        `Expected number at position ${pos} in expression`,
        toolName,
      );
    }
    return Number(src.slice(start, pos));
  }

  function parseIdentifier(): string {
    skipWs();
    const start = pos;
    if (pos < src.length && /[A-Za-z_]/.test(src[pos])) {
      pos++;
      while (pos < src.length && /[A-Za-z0-9_]/.test(src[pos])) pos++;
    }
    return src.slice(start, pos);
  }

  function parsePrimary(): number {
    skipWs();
    const ch = src[pos] ?? "";

    // Parenthesized sub-expression
    if (ch === "(") {
      consume("(");
      const val = parseAdditive();
      consume(")");
      return val;
    }

    // Number literal
    if (
      /[0-9]/.test(ch) ||
      (ch === "." && pos + 1 < src.length && /[0-9]/.test(src[pos + 1]))
    ) {
      return parseNumberLiteral();
    }

    // Identifier: variable reference or function call
    if (/[A-Za-z_]/.test(ch)) {
      const name = parseIdentifier();
      skipWs();

      // Function call: name followed by '('
      if (pos < src.length && src[pos] === "(") {
        const fn = MATH_FUNCTIONS[name];
        if (!fn) {
          throw new ValidationError(
            `Unknown function "${name}". Supported: ${
              Object.keys(MATH_FUNCTIONS).join(", ")
            }`,
            toolName,
          );
        }
        consume("(");
        const fnArgs: number[] = [];
        if (peek() !== ")") {
          fnArgs.push(parseAdditive());
          while (peek() === ",") {
            consume(",");
            fnArgs.push(parseAdditive());
          }
        }
        consume(")");
        return fn(...fnArgs);
      }

      // Variable reference
      if (!(name in values)) {
        throw new ValidationError(
          `Unknown identifier "${name}". Provide it in values or use a supported function: ${
            Object.keys(MATH_FUNCTIONS).join(", ")
          }`,
          toolName,
        );
      }
      return values[name];
    }

    throw new ValidationError(
      `Unexpected character '${ch}' at position ${pos} in expression`,
      toolName,
    );
  }

  function parseUnary(): number {
    skipWs();
    const ch = src[pos] ?? "";
    if (ch === "-") {
      pos++;
      return -parseUnary();
    }
    if (ch === "+") {
      pos++;
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePower(): number {
    let base = parseUnary();
    skipWs();
    if (pos + 1 < src.length && src[pos] === "*" && src[pos + 1] === "*") {
      pos += 2;
      base = base ** parsePower(); // right-associative
    }
    return base;
  }

  function parseMultiplicative(): number {
    let left = parsePower();
    while (true) {
      skipWs();
      const ch = src[pos] ?? "";
      if (ch === "*" && (pos + 1 >= src.length || src[pos + 1] !== "*")) {
        pos++;
        left = left * parsePower();
      } else if (ch === "/") {
        pos++;
        left = left / parsePower();
      } else if (ch === "%") {
        pos++;
        left = left % parsePower();
      } else {
        break;
      }
    }
    return left;
  }

  function parseAdditive(): number {
    let left = parseMultiplicative();
    while (true) {
      skipWs();
      const ch = src[pos] ?? "";
      if (ch === "+") {
        pos++;
        left = left + parseMultiplicative();
      } else if (ch === "-") {
        pos++;
        left = left - parseMultiplicative();
      } else {
        break;
      }
    }
    return left;
  }

  const result = parseAdditive();
  skipWs();
  if (pos < src.length) {
    throw new ValidationError(
      `Unexpected character '${src[pos]}' at position ${pos} in expression`,
      toolName,
    );
  }
  if (typeof result !== "number" || Number.isNaN(result)) {
    throw new ValidationError(
      "expression did not evaluate to a number",
      toolName,
    );
  }
  return result;
}

function compute(
  args: unknown,
  _workspace: string,
  options?: ToolExecutionOptions,
): Promise<Record<string, unknown>> {
  throwIfAborted(options?.signal);
  const record = requireArgsObject(args, "compute");

  const expression = requireString(record.expression, "expression", "compute");
  const values = parseValues(record.values, "compute");
  const result = evaluateExpression(expression, values, "compute");

  return Promise.resolve(okTool({
    expression,
    result,
  }));
}

function formatComputeResult(
  result: unknown,
): { returnDisplay: string; llmContent?: string } {
  if (!isObjectValue(result)) return formatJsonResult(result);
  const record = result as Record<string, unknown>;
  if (record.success === false) return formatJsonResult(result);
  const value = record.result === undefined ? "null" : String(record.result);
  return {
    returnDisplay: `Result: ${value}`,
    llmContent: JSON.stringify(record, null, 2),
  };
}

// ============================================================
// Tool Registry Export
// ============================================================

export const DATA_TOOLS: Record<string, ToolMetadata> = {
  aggregate_entries: {
    fn: aggregateEntries,
    description:
      'Aggregate numeric values across items (sum, count, average, min, max).\n\nExample:\n- Total size: aggregate_entries({items: entries, operation: "sum", field: "size"})',
    category: "data",
    args: {
      items: "any[] - Items to aggregate",
      operation: "string - Operation: sum, count, average, min, max",
      field: "string (optional) - Field name to aggregate",
    },
    returns: {
      value: "number | null - Aggregated value",
    },
    safetyLevel: "L0" as const,
    formatResult: formatAggregateResult,
  },
  filter_entries: {
    fn: filterEntries,
    description:
      "Filter items by a field comparison (equals, contains, gt, lt, etc).",
    category: "data",
    args: {
      items: "any[] - Items to filter",
      field: "string - Field name to compare",
      operator:
        "string - Operator: equals, not_equals, contains, gt, gte, lt, lte",
      value: "any - Value to compare against",
    },
    returns: {
      count: "number - Number of matching items",
    },
    safetyLevel: "L0" as const,
    formatResult: formatFilterResult,
  },
  transform_entries: {
    fn: transformEntries,
    description:
      "Transform items by extracting fields or applying string/length operations.",
    category: "data",
    args: {
      items: "any[] - Items to transform",
      operation: "string - Operation: pluck, length, uppercase, lowercase",
      field: "string (optional) - Field name to transform",
    },
    returns: {
      items: "any[] - Transformed values",
    },
    safetyLevel: "L0" as const,
    formatResult: formatTransformResult,
  },
  compute: {
    fn: compute,
    description: "Evaluate a simple math expression with named numeric values.",
    category: "data",
    args: {
      expression: "string - Math expression using + - * / % and parentheses",
      values: "object (optional) - Named numeric values",
    },
    returns: {
      result: "number - Computed result",
    },
    safetyLevel: "L0" as const,
    formatResult: formatComputeResult,
  },
};
