/**
 * Exhaustive type checking utility.
 *
 * This helper enables compile-time exhaustiveness checking in switch statements
 * by leveraging TypeScript's never type. When all cases are handled, the default
 * case receives type `never`. If a case is missing, TypeScript will error.
 */

import { RuntimeError } from "../../../common/error.ts";

/**
 * Assert that a value is of type `never`.
 *
 * Use this in the default case of switch statements to ensure all cases are handled:
 *
 * @example
 * switch (node.type) {
 *   case IRNodeType.Identifier: ...
 *   case IRNodeType.Literal: ...
 *   default:
 *     assertNever(node.type); // Compile error if any case is missing
 * }
 */
export function assertNever(x: never, msg?: string): never {
  throw new RuntimeError(msg ?? `Unhandled case: ${JSON.stringify(x)}`);
}
