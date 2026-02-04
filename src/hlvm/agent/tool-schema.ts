/**
 * Tool Schema Helpers
 *
 * Builds JSON Schema definitions from ToolMetadata arg descriptors.
 * Used for argument validation and native function-calling support.
 */

import type { ToolMetadata } from "./registry.ts";

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: boolean;
}

export interface JsonSchemaProperty {
  type: "string" | "number" | "boolean" | "array" | "object" | "integer" | "null" | "any";
  description?: string;
  items?: JsonSchemaProperty;
}

interface ParsedArgSpec {
  type: JsonSchemaProperty["type"];
  isArray: boolean;
  optional: boolean;
}

const OPTIONAL_MARKER = "(optional)";

function parseBaseType(typeToken: string): JsonSchemaProperty["type"] {
  const lower = typeToken.toLowerCase();
  if (lower === "string") return "string";
  if (lower === "number") return "number";
  if (lower === "boolean") return "boolean";
  if (lower === "integer" || lower === "int") return "integer";
  if (lower === "object") return "object";
  if (lower === "null") return "null";
  if (lower === "any") return "any";
  return "string";
}

export function parseArgSpec(description: string): ParsedArgSpec {
  const left = description.split(" - ")[0]?.trim() ?? "";
  const optional = left.includes(OPTIONAL_MARKER);
  const cleaned = left.replace(OPTIONAL_MARKER, "").trim();
  const typeToken = cleaned.split(/\s+/)[0] ?? "string";
  const isArray = typeToken.endsWith("[]");
  const baseToken = isArray ? typeToken.slice(0, -2) : typeToken;
  return {
    type: parseBaseType(baseToken || "string"),
    isArray,
    optional,
  };
}

export function buildToolJsonSchema(tool: ToolMetadata): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [name, desc] of Object.entries(tool.args)) {
    const parsed = parseArgSpec(desc);
    const property: JsonSchemaProperty = {
      type: parsed.isArray ? "array" : parsed.type,
      description: desc,
    };
    if (parsed.isArray) {
      property.items = { type: parsed.type };
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

function isTypeMatch(value: unknown, schema: JsonSchemaProperty): boolean {
  if (schema.type === "any") return true;
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

export function validateArgsAgainstSchema(
  args: unknown,
  schema: JsonSchemaObject,
): string[] {
  const errors: string[] = [];
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return ["Arguments must be a plain object"]; 
  }

  const record = args as Record<string, unknown>;
  const required = schema.required ?? [];
  for (const req of required) {
    if (!(req in record)) {
      errors.push(`Missing required argument: ${req}`);
    }
  }

  for (const [key, value] of Object.entries(record)) {
    const prop = schema.properties[key];
    if (!prop) {
      if (!schema.additionalProperties) {
        errors.push(
          `Unexpected argument: ${key}. Valid arguments: ${Object.keys(schema.properties).join(", ")}`,
        );
      }
      continue;
    }
    if (!isTypeMatch(value, prop)) {
      errors.push(
        `Invalid type for argument '${key}'. Expected ${prop.type}${prop.type === "array" && prop.items ? ` of ${prop.items.type}` : ""}.`,
      );
    }
  }

  return errors;
}
