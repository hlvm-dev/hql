// src/gensym.ts

export class GensymSymbol {
  constructor(public readonly name: string) {}

  toString(): string {
    return this.name;
  }

  toJSON(): string {
    return this.name;
  }
}

export function isGensymSymbol(value: unknown): value is GensymSymbol {
  return value instanceof GensymSymbol;
}

let gensymCounter = 0;

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

