/**
 * HQL Schema Descriptor → JSON Schema Converter
 *
 * Converts HQL's compact schema descriptors into standard JSON Schema objects
 * for use with AI SDK's `jsonSchema()` + `Output.object()`.
 *
 * Descriptor → JSON Schema mapping:
 *   "string"           → {type: "string"}
 *   "number"           → {type: "number"}
 *   "number 1-10"      → {type: "number"}  (hint stripped)
 *   "boolean"          → {type: "boolean"}
 *   "a|b|c"            → {type: "string", enum: ["a","b","c"]}
 *   ["string"]         → {type: "array", items: {type: "string"}}
 *   [{name: "string"}] → {type: "array", items: {type: "object", ...}}
 *   {lat: "number"}    → {type: "object", properties: {...}, required: [...]}
 */

type JsonSchema = Record<string, unknown>;

const PRIMITIVE_SCHEMA_BY_NAME: Record<string, JsonSchema> = {
  string: { type: "string" },
  number: { type: "number" },
  boolean: { type: "boolean" },
  object: { type: "object" },
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectJsonSchema(descriptor: unknown): descriptor is JsonSchema {
  if (!isObjectRecord(descriptor)) return false;
  if (
    typeof descriptor.$schema === "string" || typeof descriptor.$id === "string"
  ) {
    return true;
  }
  if (
    descriptor.type === "object" &&
    ("properties" in descriptor || "required" in descriptor ||
      "additionalProperties" in descriptor)
  ) {
    return true;
  }
  if (
    descriptor.type === "array" &&
    ("items" in descriptor || "prefixItems" in descriptor ||
      "minItems" in descriptor || "maxItems" in descriptor)
  ) {
    return true;
  }
  return "oneOf" in descriptor || "anyOf" in descriptor ||
    "allOf" in descriptor ||
    "not" in descriptor;
}

function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of input) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

function normalizePrimitiveDescriptor(descriptor: string): string {
  const normalized = descriptor.trim().toLowerCase();
  if (normalized === "strings") return "string";
  if (normalized === "numbers") return "number";
  if (normalized === "booleans") return "boolean";
  if (normalized === "objects") return "object";
  return descriptor.trim();
}

function buildObjectSchemaFromInlineFields(fieldsText: string): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const field of splitTopLevelCommas(fieldsText)) {
    const match = field.match(/^([a-zA-Z0-9_]+)\s*\((.+)\)$/);
    if (!match) continue;
    const [, name, descriptor] = match;
    properties[name] = descriptorToJsonSchema(descriptor.trim());
    required.push(name);
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function parseStringArrayDescriptor(descriptor: string): JsonSchema | null {
  const arrayMatch = descriptor.trim().match(/^array of (.+)$/i);
  if (!arrayMatch) return null;

  let rest = arrayMatch[1].trim();
  let exactItems: number | undefined;

  const exactItemsMatch = rest.match(/^(.*?),?\s*exactly\s+(\d+)\s+items?$/i);
  if (exactItemsMatch) {
    rest = exactItemsMatch[1].trim();
    exactItems = Number(exactItemsMatch[2]);
  }

  const leadingCountMatch = rest.match(/^(\d+)\s+(.+)$/);
  if (leadingCountMatch) {
    exactItems ??= Number(leadingCountMatch[1]);
    rest = leadingCountMatch[2].trim();
  }

  const objectFieldsMatch = rest.match(/^objects?\s+with\s+fields:\s*(.+)$/i);
  const items = objectFieldsMatch
    ? buildObjectSchemaFromInlineFields(objectFieldsMatch[1])
    : descriptorToJsonSchema(normalizePrimitiveDescriptor(rest));

  return {
    type: "array",
    items,
    ...(exactItems != null
      ? { minItems: exactItems, maxItems: exactItems }
      : {}),
  };
}

/** Convert an HQL schema descriptor into a JSON Schema object. */
export function descriptorToJsonSchema(descriptor: unknown): JsonSchema {
  if (isDirectJsonSchema(descriptor)) {
    return descriptor;
  }

  if (typeof descriptor === "string") {
    const arraySchema = parseStringArrayDescriptor(descriptor);
    if (arraySchema) return arraySchema;

    const normalized = normalizePrimitiveDescriptor(descriptor);
    const base = normalized.split(/\s+/)[0].toLowerCase();
    if (base in PRIMITIVE_SCHEMA_BY_NAME) return PRIMITIVE_SCHEMA_BY_NAME[base];
    if (descriptor.includes("|")) {
      return {
        type: "string",
        enum: descriptor.split("|").map((s) => s.trim()),
      };
    }
    return { type: "string" };
  }

  if (Array.isArray(descriptor)) {
    return descriptor.length === 0
      ? { type: "array" }
      : { type: "array", items: descriptorToJsonSchema(descriptor[0]) };
  }

  if (isObjectRecord(descriptor)) {
    const properties: Record<string, JsonSchema> = {};
    const keys = Object.keys(descriptor);
    for (const key of keys) {
      properties[key] = descriptorToJsonSchema(descriptor[key]);
    }
    return {
      type: "object",
      properties,
      required: keys,
      additionalProperties: false,
    };
  }

  return {};
}
