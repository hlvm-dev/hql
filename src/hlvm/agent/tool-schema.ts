/**
 * Tool Schema Helpers
 *
 * Builds JSON Schema definitions from ToolMetadata arg descriptors.
 * Used for argument validation and native function-calling support.
 */

import type { ToolMetadata } from "./registry.ts";
import { getAgentLogger } from "./logger.ts";
import ajvModule from "ajv";

type JsonSchemaType =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "integer"
  | "null";

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: boolean;
}

export interface JsonSchemaProperty {
  type?: JsonSchemaType;
  description?: string;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

export interface ToolValidationIssue {
  kind:
    | "non_object"
    | "missing_required"
    | "unexpected_argument"
    | "invalid_type"
    | "invalid_value";
  argument?: string;
  expectedType?: string;
  actualType?: string;
  validArguments?: string[];
  message?: string;
}

interface ParsedArgSpec {
  type: JsonSchemaType | "any";
  isArray: boolean;
  optional: boolean;
}

const OPTIONAL_MARKER = "(optional)";

const JSON_SCHEMA_TYPES = new Set<JsonSchemaType>([
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "integer",
  "null",
]);

const BASE_TYPE_MAP = new Map<string, JsonSchemaType | "any">([
  ["string", "string"],
  ["number", "number"],
  ["boolean", "boolean"],
  ["integer", "integer"],
  ["int", "integer"],
  ["object", "object"],
  ["null", "null"],
  ["any", "any"], // handled specially in schema builder — omits `type` field
]);

// deno-lint-ignore no-explicit-any
const AjvConstructor = (ajvModule as any).default ?? ajvModule;
const ajv = new AjvConstructor({ allErrors: true, strict: false });
const validatorCache = new Map<string, (data: unknown) => boolean>();

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBaseType(typeToken: string): JsonSchemaType | "any" {
  const resolved = BASE_TYPE_MAP.get(typeToken.toLowerCase());
  if (resolved !== undefined) return resolved;
  getAgentLogger().warn(`Unknown arg type '${typeToken}', treating as string`);
  return "string";
}

function parseArrayToken(
  token: string,
): { baseToken: string; isArray: boolean } | null {
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
  if (property.enum?.length) {
    return `one of ${property.enum.map(String).join(", ")}`;
  }
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

function normalizeJsonSchemaProperty(value: unknown): JsonSchemaProperty {
  if (!isObjectRecord(value)) return {};

  const property: JsonSchemaProperty = {};
  if (
    typeof value.type === "string" &&
    JSON_SCHEMA_TYPES.has(value.type as JsonSchemaType)
  ) {
    property.type = value.type as JsonSchemaType;
  }
  if (typeof value.description === "string") {
    property.description = value.description;
  }
  if (Array.isArray(value.enum)) {
    property.enum = [...value.enum];
  }
  if (typeof value.minimum === "number") {
    property.minimum = value.minimum;
  }
  if (typeof value.maximum === "number") {
    property.maximum = value.maximum;
  }
  if (typeof value.minItems === "number") {
    property.minItems = value.minItems;
  }
  if (typeof value.maxItems === "number") {
    property.maxItems = value.maxItems;
  }
  if (isObjectRecord(value.items)) {
    property.items = normalizeJsonSchemaProperty(value.items);
  }
  if (isObjectRecord(value.properties)) {
    property.properties = Object.fromEntries(
      Object.entries(value.properties).map(([name, child]) => [
        name,
        normalizeJsonSchemaProperty(child),
      ]),
    );
  }
  if (Array.isArray(value.required)) {
    property.required = value.required.filter((item): item is string =>
      typeof item === "string"
    );
  }
  if (typeof value.additionalProperties === "boolean") {
    property.additionalProperties = value.additionalProperties;
  }
  return property;
}

function normalizeObjectJsonSchema(schema: unknown): JsonSchemaObject | null {
  if (!isObjectRecord(schema) || schema.type !== "object") {
    return null;
  }
  const properties = isObjectRecord(schema.properties)
    ? Object.fromEntries(
      Object.entries(schema.properties).map(([name, value]) => [
        name,
        normalizeJsonSchemaProperty(value),
      ]),
    )
    : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : undefined;
  return {
    type: "object",
    properties,
    required: required?.length ? required : undefined,
    additionalProperties: typeof schema.additionalProperties === "boolean"
      ? schema.additionalProperties
      : false,
  };
}

function asJsonSchemaObject(schema: Record<string, unknown>): JsonSchemaObject {
  return schema as unknown as JsonSchemaObject;
}

export function buildToolJsonSchema(tool: ToolMetadata): JsonSchemaObject {
  if (normalizeObjectJsonSchema(tool.inputSchema)) {
    return asJsonSchemaObject(tool.inputSchema!);
  }

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
  if (tool.inputSchema != null) {
    const normalized = normalizeObjectJsonSchema(tool.inputSchema);
    if (!normalized) {
      return [`Tool '${name}' inputSchema must be a JSON Schema object root.`];
    }
    try {
      getJsonSchemaValidator(asJsonSchemaObject(tool.inputSchema));
      return [];
    } catch (error) {
      return [
        `Tool '${name}' inputSchema is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ];
    }
  }

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

function getJsonSchemaValidator(
  schema: JsonSchemaObject,
): (data: unknown) => boolean {
  const cacheKey = JSON.stringify(schema);
  const cached = validatorCache.get(cacheKey);
  if (cached) return cached;
  const validate = ajv.compile(
    schema as unknown as Record<string, unknown>,
  ) as (
    data: unknown,
  ) => boolean;
  validatorCache.set(cacheKey, validate);
  return validate;
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function getSchemaPathSegments(instancePath: string): string[] {
  return instancePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(decodeJsonPointerSegment);
}

function formatSchemaPath(
  segments: string[],
  leaf?: string,
): string | undefined {
  const path = [...segments, ...(leaf ? [leaf] : [])].join(".");
  return path.length > 0 ? path : undefined;
}

function getSchemaNodeAtPath(
  schema: JsonSchemaObject,
  pathSegments: string[],
): JsonSchemaProperty | JsonSchemaObject | null {
  let current: JsonSchemaProperty | JsonSchemaObject | null =
    normalizeObjectJsonSchema(schema);
  for (const segment of pathSegments) {
    if (!current) return null;
    if (current.type === "object") {
      current = current.properties?.[segment] ?? null;
      continue;
    }
    if (current.type === "array") {
      current = current.items ?? null;
      if (current?.type === "object" && !/^\d+$/.test(segment)) {
        current = current.properties?.[segment] ?? null;
      }
      continue;
    }
    return null;
  }
  return current;
}

function getValueAtPath(value: unknown, pathSegments: string[]): unknown {
  let current = value;
  for (const segment of pathSegments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (isObjectRecord(current)) {
      current = current[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

function toAjvErrorRecord(error: unknown): {
  keyword: string;
  instancePath: string;
  params: Record<string, unknown>;
  message?: string;
} {
  const record = isObjectRecord(error) ? error : {};
  return {
    keyword: typeof record.keyword === "string" ? record.keyword : "",
    instancePath: typeof record.instancePath === "string"
      ? record.instancePath
      : "",
    params: isObjectRecord(record.params) ? record.params : {},
    message: typeof record.message === "string" ? record.message : undefined,
  };
}

function buildValidationIssueFromAjvError(
  error: unknown,
  schema: JsonSchemaObject,
  args: unknown,
): ToolValidationIssue {
  const ajvError = toAjvErrorRecord(error);
  const pathSegments = getSchemaPathSegments(ajvError.instancePath);
  const schemaNode = getSchemaNodeAtPath(schema, pathSegments);
  const schemaEnum = schemaNode && "enum" in schemaNode
    ? schemaNode.enum
    : undefined;
  switch (ajvError.keyword) {
    case "required":
      return {
        kind: "missing_required",
        argument: formatSchemaPath(
          pathSegments,
          typeof ajvError.params.missingProperty === "string"
            ? ajvError.params.missingProperty
            : undefined,
        ),
      };
    case "additionalProperties": {
      const parentSchema = getSchemaNodeAtPath(schema, pathSegments);
      return {
        kind: "unexpected_argument",
        argument: formatSchemaPath(
          pathSegments,
          typeof ajvError.params.additionalProperty === "string"
            ? ajvError.params.additionalProperty
            : undefined,
        ),
        validArguments:
          parentSchema?.type === "object" && parentSchema.properties
            ? Object.keys(parentSchema.properties)
            : undefined,
      };
    }
    case "type":
      return {
        kind: "invalid_type",
        argument: formatSchemaPath(pathSegments),
        expectedType: typeof ajvError.params.type === "string"
          ? ajvError.params.type
          : schemaNode
          ? describeSchemaType(schemaNode)
          : "any",
        actualType: describeActualType(getValueAtPath(args, pathSegments)),
      };
    case "enum":
      return {
        kind: "invalid_value",
        argument: formatSchemaPath(pathSegments),
        message: `Argument '${
          formatSchemaPath(pathSegments) ?? "unknown"
        }' has an invalid value. Expected ${
          schemaEnum?.length
            ? schemaEnum.map(String).join(", ")
            : "one of the allowed values"
        }.`,
      };
    case "minimum":
    case "maximum":
    case "minItems":
    case "maxItems":
      return {
        kind: "invalid_value",
        argument: formatSchemaPath(pathSegments),
        message: `Argument '${formatSchemaPath(pathSegments) ?? "unknown"}' ${
          ajvError.message ?? "failed validation"
        }.`,
      };
    default:
      return {
        kind: "invalid_value",
        argument: formatSchemaPath(pathSegments),
        message: `Argument '${
          formatSchemaPath(pathSegments) ?? "unknown"
        }' is invalid${ajvError.message ? `: ${ajvError.message}` : "."}`,
      };
  }
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
        return schema.properties
          ? coerceArgsToSchema(parsed, {
            type: "object",
            properties: schema.properties,
            required: schema.required,
            additionalProperties: schema.additionalProperties ?? true,
          })
          : parsed;
      }
    } catch { /* not valid JSON, return as-is */ }
  }

  if (schema.type === "object" && isObjectRecord(value) && schema.properties) {
    return coerceArgsToSchema(value, {
      type: "object",
      properties: schema.properties,
      required: schema.required,
      additionalProperties: schema.additionalProperties ?? true,
    });
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
  const normalizedSchema = normalizeObjectJsonSchema(schema) ?? schema;
  for (const [key, value] of Object.entries(record)) {
    const prop = normalizedSchema.properties[key];
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
      case "invalid_value":
        return issue.message ??
          `Argument '${issue.argument ?? "unknown"}' has an invalid value.`;
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
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return [{ kind: "non_object" }];
  }
  const validate = getJsonSchemaValidator(schema);
  if (validate(args)) {
    return [];
  }
  const validationErrors = (validate as { errors?: unknown[] }).errors ?? [];
  return validationErrors.map((error) =>
    buildValidationIssueFromAjvError(error, schema, args)
  );
}
