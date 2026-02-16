/**
 * Translates TypeScript error codes to HQL-friendly error messages.
 * Falls through to the original message for unknown codes.
 */

interface ErrorTranslation {
  /** Regex to extract arguments from the TS error message */
  pattern: RegExp;
  /** Template function to produce HQL-friendly message */
  template: (...args: string[]) => string;
}

const TRANSLATIONS: ReadonlyMap<number, ErrorTranslation> = new Map([
  // TS2322: Type 'X' is not assignable to type 'Y'
  [2322, {
    pattern: /Type '(.+?)' is not assignable to type '(.+?)'/,
    template: (x: string, y: string) => `Cannot use ${x} where ${y} is expected`,
  }],
  // TS2304: Cannot find name 'X'
  [2304, {
    pattern: /Cannot find name '(.+?)'/,
    template: (x: string) => `Undefined binding: ${x}`,
  }],
  // TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'
  [2345, {
    pattern: /Argument of type '(.+?)' is not assignable to parameter of type '(.+?)'/,
    template: (x: string, y: string) => `Expected ${y} but got ${x}`,
  }],
  // TS2554: Expected N arguments, but got M
  [2554, {
    pattern: /Expected (\d+) arguments?, but got (\d+)/,
    template: (n: string, m: string) => `Function expected ${n} argument(s), got ${m}`,
  }],
  // TS2339: Property 'X' does not exist on type 'Y'
  [2339, {
    pattern: /Property '(.+?)' does not exist on type '(.+?)'/,
    template: (x: string, y: string) => `Property '${x}' does not exist on type '${y}'`,
  }],
  // TS2551: Property 'X' does not exist...Did you mean 'Y'?
  [2551, {
    pattern: /Did you mean '(.+?)'/,
    template: (x: string) => `Did you mean '${x}'?`,
  }],
  // TS2769: No overload matches this call
  [2769, {
    pattern: /No overload matches this call/,
    template: () => `No matching overload for call`,
  }],
  // TS2365: Operator 'X' cannot be applied to types 'Y' and 'Z'
  [2365, {
    pattern: /Operator '(.+?)' cannot be applied to types '(.+?)' and '(.+?)'/,
    template: (op: string, y: string, z: string) =>
      `Operator '${op}' cannot be applied to types '${y}' and '${z}'`,
  }],
  // TS1005: 'X' expected
  [1005, {
    pattern: /'(.+?)' expected/,
    template: (x: string) => `Expected '${x}'`,
  }],
  // TS2741: Property 'X' is missing in type 'Y'
  [2741, {
    pattern: /Property '(.+?)' is missing/,
    template: (x: string) => `Property '${x}' is missing`,
  }],
]);

/**
 * Translates a TypeScript error into an HQL-friendly message.
 * Returns the original message if the code is unknown or pattern doesn't match.
 */
export function translateTypeError(code: number, message: string): string {
  const translation = TRANSLATIONS.get(code);
  if (!translation) return message;

  const match = message.match(translation.pattern);
  if (!match) return message;

  return translation.template(...match.slice(1));
}
