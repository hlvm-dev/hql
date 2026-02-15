import * as IR from "../../type/hql_ir.ts";
import type { ValueKind } from "./effect-types.ts";

/** Known type name prefixes → ValueKind. Case-insensitive for the base type. */
const TYPE_NAME_TO_KIND: ReadonlyMap<string, ValueKind> = new Map([
  ["array", "Array"],
  ["string", "String"],
  ["number", "Number"],
  ["boolean", "Boolean"],
  ["map", "Map"],
  ["set", "Set"],
  ["regexp", "RegExp"],
  ["promise", "Promise"],
]);

/**
 * Parse a type annotation string into a ValueKind.
 *
 * - `undefined` → Untyped (no annotation)
 * - `"Array<number>"` / `"number[]"` → Array
 * - `"string"` → String
 * - `"Map<K,V>"` → Map
 * - `"(Pure number number)"` → Untyped (function type, not a value receiver)
 * - `"T"` (single uppercase letter, generic param) → Untyped
 * - Unknown types → Unknown (fail-closed)
 */
export function parseValueKind(typeAnnotation: string | undefined): ValueKind {
  if (typeAnnotation === undefined) return "Untyped";

  const trimmed = typeAnnotation.trim();
  if (trimmed === "") return "Untyped";

  // Function types (effect-annotated or arrow) are not value receivers
  if (trimmed.startsWith("(") || trimmed.includes("=>")) return "Untyped";

  // Array shorthand: "number[]", "string[]", etc.
  if (trimmed.endsWith("[]")) return "Array";

  // Extract base type name before any generic brackets
  const baseMatch = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
  if (!baseMatch) return "Untyped";

  const baseName = baseMatch[1].toLowerCase();

  // Single uppercase letter = generic type parameter → Untyped
  if (baseMatch[1].length === 1 && baseMatch[1] === baseMatch[1].toUpperCase() &&
      /^[A-Z]$/.test(baseMatch[1])) {
    return "Untyped";
  }

  const kind = TYPE_NAME_TO_KIND.get(baseName);
  if (kind) return kind;

  // Unknown user-defined type → fail-closed
  return "Unknown";
}

/**
 * Infer ValueKind from an IR node (for let-bound variables initialized with literals/constructors).
 */
export function inferNodeKind(node: IR.IRNode): ValueKind {
  switch (node.type) {
    case IR.IRNodeType.ArrayExpression:
      return "Array";
    case IR.IRNodeType.StringLiteral:
      return "String";
    case IR.IRNodeType.NumericLiteral:
      return "Number";
    case IR.IRNodeType.BooleanLiteral:
      return "Boolean";
    case IR.IRNodeType.NewExpression: {
      const expr = node as IR.IRNewExpression;
      if (expr.callee.type === IR.IRNodeType.Identifier) {
        const ctorName = (expr.callee as IR.IRIdentifier).name;
        const kind = TYPE_NAME_TO_KIND.get(ctorName.toLowerCase());
        if (kind) return kind;
      }
      return "Untyped";
    }
    default:
      return "Untyped";
  }
}
