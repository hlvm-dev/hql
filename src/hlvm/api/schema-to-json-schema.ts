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

/** Convert an HQL schema descriptor into a JSON Schema object. */
export function descriptorToJsonSchema(descriptor: unknown): JsonSchema {
  if (typeof descriptor === "string") {
    const base = descriptor.split(/\s+/)[0];
    if (base === "string") return { type: "string" };
    if (base === "number") return { type: "number" };
    if (base === "boolean") return { type: "boolean" };
    if (descriptor.includes("|")) {
      return { type: "string", enum: descriptor.split("|").map((s) => s.trim()) };
    }
    return { type: "string" };
  }

  if (Array.isArray(descriptor)) {
    return descriptor.length === 0
      ? { type: "array" }
      : { type: "array", items: descriptorToJsonSchema(descriptor[0]) };
  }

  if (descriptor !== null && typeof descriptor === "object") {
    const properties: Record<string, JsonSchema> = {};
    const keys = Object.keys(descriptor as Record<string, unknown>);
    for (const key of keys) {
      properties[key] = descriptorToJsonSchema(
        (descriptor as Record<string, unknown>)[key],
      );
    }
    return { type: "object", properties, required: keys, additionalProperties: false };
  }

  return {};
}
