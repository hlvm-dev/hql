/**
 * Tool Schema Helpers
 *
 * Builds JSON Schema definitions from ToolMetadata arg descriptors.
 * Used for argument validation and native function-calling support.
 */

import type { ToolMetadata } from "./registry.ts";
import { getAgentLogger } from "./logger.ts";

interface JsonSchemaObject {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: boolean;
}

interface JsonSchemaProperty {
  type?:
    | "string"
    | "number"
    | "boolean"
    | "array"
    | "object"
    | "integer"
    | "null";
  description?: string;
  items?: JsonSchemaProperty;
}

export interface ToolValidationIssue {
  kind:
    | "non_object"
    | "missing_required"
    | "unexpected_argument"
    | "invalid_type";
  argument?: string;
  expectedType?: string;
  actualType?: string;
  validArguments?: string[];
}

interface ParsedArgSpec {
  type: JsonSchemaProperty["type"] | "any";
  isArray: boolean;
  optional: boolean;
}

const OPTIONAL_MARKER = "(optional)";

const BASE_TYPE_MAP = new Map<string, JsonSchemaProperty["type"] | "any">([
  ["string", "string"],
  ["number", "number"],
  ["boolean", "boolean"],
  ["integer", "integer"],
  ["int", "integer"],
  ["object", "object"],
  ["null", "null"],
  ["any", "any"], // handled specially in schema builder — omits `type` field
]);

function parseBaseType(typeToken: string): JsonSchemaProperty["type"] | "any" {
  const resolved = BASE_TYPE_MAP.get(typeToken.toLowerCase());
  if (resolved !== undefined) return resolved;
  getAgentLogger().warn(`Unknown arg type '${typeToken}', treating as string`);
  return "string";
}

function parseArrayToken(token: string): { baseToken: string; isArray: boolean } | null {
  if (token.endsWith("[]")) {
    const baseToken = token.slice(0, -2).trim();
    return { baseToken: baseToken || "string", isArray: true };
  }
  const genericMatch = token.match(/^array<\s*([^>]+)\s*>$/i);
  if (genericMatch) {
    const baseToken = genericMatch[1]?.trim() || "string";
    return { baseToken, isArray: true };
  }
  return null;
}

/** Extract the raw type token, array flag, and optional flag from an arg descriptor string. */
function extractArgDescriptor(description: string): {
  baseToken: string;
  isArray: boolean;
  optional: boolean;
} {
  const left = description.split(" - ")[0]?.trim() ?? "";
  const optional = left.includes(OPTIONAL_MARKER);
  const cleaned = left.replace(OPTIONAL_MARKER, "").trim();
  // Handle union types like "string | string[]" — if any variant is an array,
  // treat the whole arg as array-typed so coercion can parse stringified arrays.
  const tokens = cleaned.split(/\s*\|\s*/);
  const arrayToken = tokens
    .map((token) => parseArrayToken(token.trim()))
    .find((token) => token !== null);
  if (arrayToken) {
    return {
      baseToken: arrayToken.baseToken,
      isArray: true,
      optional,
    };
  }
  const typeToken = tokens[0]?.split(/\s+/)[0] ?? "string";
  const parsedArrayToken = parseArrayToken(typeToken);
  const isArray = parsedArrayToken?.isArray ?? false;
  const baseToken = parsedArrayToken?.baseToken ?? typeToken;
  return { baseToken: baseToken || "string", isArray, optional };
}

function parseArgSpec(description: string): ParsedArgSpec {
  const { baseToken, isArray, optional } = extractArgDescriptor(description);
  return {
    type: parseBaseType(baseToken),
    isArray,
    optional,
  };
}

function describeSchemaType(property: JsonSchemaProperty): string {
  if (property.type === "array") {
    const itemType = property.items?.type ?? "any";
    return `array of ${itemType}`;
  }
  return property.type ?? "any";
}

function describeActualType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

export function buildToolJsonSchema(tool: ToolMetadata): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [name, desc] of Object.entries(tool.args)) {
    const parsed = parseArgSpec(desc);
    // JSON Schema 2020-12: omit `type` to accept any value (no "type": "any")
    const isAny = parsed.type === "any";
    const property: JsonSchemaProperty = {
      description: desc,
    };
    if (parsed.isArray) {
      property.type = "array";
      property.items = isAny
        ? {}
        : { type: parsed.type as JsonSchemaProperty["type"] };
    } else if (!isAny) {
      property.type = parsed.type as JsonSchemaProperty["type"];
    }
    properties[name] = property;
    if (!parsed.optional) {
      required.push(name);
    }
  }

  return {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: false,
  };
}

/**
 * Validate a tool's arg schema, returning warnings for unknown types.
 * Does NOT throw — MCP servers can report unusual types and we don't want to block them.
 */
export function validateToolSchema(name: string, tool: ToolMetadata): string[] {
  const warnings: string[] = [];
  for (const [argName, desc] of Object.entries(tool.args)) {
    const { baseToken } = extractArgDescriptor(desc);
    if (!BASE_TYPE_MAP.has(baseToken.toLowerCase())) {
      warnings.push(
        `Tool '${name}' arg '${argName}': unknown type '${baseToken}', treating as string`,
      );
    }
  }
  return warnings;
}

/**
 * SSOT function for sanitizing tool names to be provider-compatible.
 * Cross-provider safe: [a-zA-Z0-9_-], leading letter, max 64 chars.
 * (OpenAI & Anthropic both enforce ^[a-zA-Z0-9_-]{1,64}$)
 */
export function sanitizeToolName(name: string): string {
  let sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (sanitized.length === 0 || !/^[a-zA-Z]/.test(sanitized)) {
    sanitized = "t_" + sanitized;
  }
  return sanitized.slice(0, 64);
}

export function normalizeArgsForTool(
  args: unknown,
  tool: Pick<ToolMetadata, "argAliases">,
): unknown {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return args;
  }

  const aliases = tool.argAliases;
  if (!aliases || Object.keys(aliases).length === 0) {
    return args;
  }

  const normalized = { ...(args as Record<string, unknown>) };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (!(alias in normalized)) continue;
    if (!(canonical in normalized)) {
      normalized[canonical] = normalized[alias];
    }
    delete normalized[alias];
  }

  return normalized;
}

function isTypeMatch(value: unknown, schema: JsonSchemaProperty): boolean {
  if (!schema.type) return true; // no type constraint = accept any value
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (!schema.items) return true;
    return value.every((item) => isTypeMatch(item, schema.items!));
  }
  if (schema.type === "object") {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  if (schema.type === "number") {
    return typeof value === "number" && !Number.isNaN(value);
  }
  if (schema.type === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  if (schema.type === "boolean") {
    return typeof value === "boolean";
  }
  if (schema.type === "null") {
    return value === null;
  }
  return typeof value === "string";
}

function coerceValue(value: unknown, schema: JsonSchemaProperty): unknown {
  if (!schema.type) return value; // no type constraint = no coercion needed
  if (schema.type === "array") {
    // Coerce string-encoded arrays (e.g., "[1,2,3]" → [1,2,3])
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          if (!schema.items) return parsed;
          return parsed.map((item: unknown) =>
            coerceValue(item, schema.items!)
          );
        }
      } catch { /* not valid JSON array, return as-is */ }
    }
    if (!Array.isArray(value)) return value;
    if (!schema.items) return value;
    return value.map((item) => coerceValue(item, schema.items!));
  }

  if (
    (schema.type === "number" || schema.type === "integer") &&
    typeof value === "string"
  ) {
    const trimmed = value.trim();
    if (trimmed.length === 0) return value;
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return value;
    if (schema.type === "integer" && !Number.isInteger(numeric)) return value;
    return numeric;
  }

  // Local models often serialize booleans as strings (case-insensitive)
  if (schema.type === "boolean" && typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }

  // Local models often serialize nested objects/arrays as JSON strings
  if (schema.type === "object" && typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ) {
        return parsed;
      }
    } catch { /* not valid JSON, return as-is */ }
  }

  return value;
}

export function coerceArgsToSchema(
  args: unknown,
  schema: JsonSchemaObject,
): unknown {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return args;
  }

  const record = args as Record<string, unknown>;
  const coerced: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const prop = schema.properties[key];
    coerced[key] = prop ? coerceValue(value, prop) : value;
  }
  return coerced;
}

export function formatToolValidationIssues(
  issues: ToolValidationIssue[],
): string[] {
  return issues.map((issue) => {
    switch (issue.kind) {
      case "non_object":
        return "Arguments must be an object with named fields.";
      case "missing_required":
        return `Missing required argument '${issue.argument ?? "unknown"}'.`;
      case "unexpected_argument":
        return `Unexpected argument '${issue.argument ?? "unknown"}'.${
          issue.validArguments?.length
            ? ` Valid arguments: ${issue.validArguments.join(", ")}.`
            : ""
        }`;
      case "invalid_type":
        return `Argument '${
          issue.argument ?? "unknown"
        }' has the wrong type. Expected ${
          issue.expectedType ?? "any"
        }, received ${issue.actualType ?? "unknown"}.`;
      default:
        return "Invalid arguments.";
    }
  });
}

export function summarizeToolValidationIssues(
  issues: ToolValidationIssue[],
): string {
  return formatToolValidationIssues(issues).join(" ");
}

export function validateArgsAgainstSchema(
  args: unknown,
  schema: JsonSchemaObject,
): ToolValidationIssue[] {
  const errors: ToolValidationIssue[] = [];
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return [{ kind: "non_object" }];
  }

  const record = args as Record<string, unknown>;
  const required = schema.required ?? [];
  for (const req of required) {
    if (!(req in record)) {
      errors.push({
        kind: "missing_required",
        argument: req,
      });
    }
  }

  for (const [key, value] of Object.entries(record)) {
    const prop = schema.properties[key];
    if (!prop) {
      if (!schema.additionalProperties) {
        errors.push({
          kind: "unexpected_argument",
          argument: key,
          validArguments: Object.keys(schema.properties),
        });
      }
      continue;
    }
    if (!isTypeMatch(value, prop)) {
      errors.push({
        kind: "invalid_type",
        argument: key,
        expectedType: describeSchemaType(prop),
        actualType: describeActualType(value),
      });
    }
  }

  return errors;
}
