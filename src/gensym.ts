// src/gensym.ts

import { isObjectValue } from "./common/utils.ts";

/**
 * GensymSymbol: Marker class for gensym-generated symbols
 *
 * When gensym is called during macro expansion, it returns a GensymSymbol
 * instead of a plain string. This allows the macro system to distinguish
 * between string literals and symbol names that should be injected via unquote.
 *
 * When convertJsValueToSExp encounters a GensymSymbol, it converts it to
 * an SSymbol instead of a string literal.
 */
export class GensymSymbol {
  constructor(public readonly name: string) {}

  toString(): string {
    return this.name;
  }

  // For JSON serialization
  toJSON(): string {
    return this.name;
  }
}

/**
 * Check if a value is a GensymSymbol
 *
 * Uses duck typing instead of instanceof to handle potential module loading issues
 */
export function isGensymSymbol(value: unknown): value is GensymSymbol {
  // Duck typing: check if it has the structure of GensymSymbol
  // This handles potential module loading issues where instanceof might fail
  if (isObjectValue(value)) {
    const obj = value;
    // Check if it has a 'name' property (string) and is marked as GensymSymbol
    if (typeof obj.name === "string" &&
        typeof obj.constructor === "function" &&
        (obj.constructor as { name?: string }).name === "GensymSymbol") {
      return true;
    }
  }
  return value instanceof GensymSymbol;
}

export let gensymCounter = 0;

/**
 * Generate a unique symbol name for macro hygiene
 *
 * Returns a GensymSymbol (not a string) so that when unquoted in a macro,
 * it becomes a symbol rather than a string literal.
 *
 * @param prefix - Optional prefix for the generated name (default: "g")
 * @returns GensymSymbol with unique name like "prefix_0", "prefix_1", etc.
 */
export function gensym(prefix: string = "g"): GensymSymbol {
  return new GensymSymbol(`${prefix}_${gensymCounter++}`);
}

export function resetGensymCounter(): void {
  gensymCounter = 0;
}
