/**
 * Schema-to-Zod Converter
 *
 * Converts HQL schema descriptors (plain JSON objects) into Zod schemas
 * for use with AI SDK's `Output.object()` native structured output.
 *
 * Descriptor → Zod mapping:
 *   "string"           → z.string()
 *   "number"           → z.number()
 *   "number 1-10"      → z.number()  (hint stripped)
 *   "boolean"          → z.boolean()
 *   "a|b|c"            → z.enum(["a","b","c"])
 *   ["string"]         → z.array(z.string())
 *   [{name: "string"}] → z.array(z.object({name: z.string()}))
 *   {lat: "number"}    → z.object({lat: z.number()})  (recursive)
 */

import { z, type ZodType } from "zod";

/** Convert a single descriptor value to its Zod equivalent. */
function descriptorToZod(descriptor: unknown): ZodType {
  // String descriptors: "string", "number", "boolean", "a|b|c", "number 1-10"
  if (typeof descriptor === "string") {
    // Strip hint suffixes: "number grams" → "number", "number 1-10" → "number"
    const base = descriptor.split(/\s+/)[0];

    if (base === "string") return z.string();
    if (base === "number") return z.number();
    if (base === "boolean") return z.boolean();

    // Enum: "a|b|c" → z.enum(["a","b","c"])
    if (descriptor.includes("|")) {
      const variants = descriptor.split("|").map((s) => s.trim());
      return z.enum(variants as [string, ...string[]]);
    }

    // Fallback: treat as string
    return z.string();
  }

  // Array descriptors: ["string"] or [{name: "string"}]
  if (Array.isArray(descriptor)) {
    if (descriptor.length === 0) return z.array(z.unknown());
    return z.array(descriptorToZod(descriptor[0]));
  }

  // Object descriptors: {key: "type"} → z.object({key: z.type()})
  if (descriptor !== null && typeof descriptor === "object") {
    const shape: Record<string, ZodType> = {};
    for (const [key, value] of Object.entries(descriptor as Record<string, unknown>)) {
      shape[key] = descriptorToZod(value);
    }
    return z.object(shape);
  }

  // Fallback for null, undefined, etc.
  return z.unknown();
}

/**
 * Convert an HQL schema descriptor object into a Zod schema.
 * The top-level descriptor must be an object (the root response shape).
 */
export function schemaToZod(descriptor: Record<string, unknown>): ZodType {
  return descriptorToZod(descriptor);
}
