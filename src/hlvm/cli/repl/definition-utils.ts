import { isList, isSymbol, type SList, type SSymbol } from "../../../hql/s-exp/types.ts";
import { extractTypeFromSymbol } from "../../../hql/transpiler/tokenizer/type-tokenizer.ts";

// Pre-compiled pattern for extracting generic base type
const GENERIC_BASE_TYPE_REGEX = /^([^<]+)/;

/**
 * Extract just the identifier name from a symbol that may include type annotations and/or generics.
 * Examples:
 *   "greet" -> "greet"
 *   "greet:string" -> "greet"
 *   "identity<T>" -> "identity"
 *   "identity<T>:T" -> "identity"
 */
export function extractIdentifierName(symbolName: string): string {
  // First remove type annotation (e.g., "greet:string" -> "greet")
  const { name: withoutType } = extractTypeFromSymbol(symbolName);

  // Then remove generic parameters (e.g., "identity<T>" -> "identity")
  const genericMatch = withoutType.match(GENERIC_BASE_TYPE_REGEX);
  return genericMatch ? genericMatch[1] : withoutType;
}

/**
 * Extract function parameters from a fn/defn/async fn declaration
 */
export function extractFnParams(expr: SList, operator: string): string[] | undefined {
  const isAsyncFn = operator.startsWith("async ");
  const isFnLike = operator === "fn" || operator === "defn" || operator === "async fn" || operator === "async fn*";

  if (!isFnLike) return undefined;

  const paramsIndex = isAsyncFn ? 3 : 2;
  const minLength = isAsyncFn ? 4 : 3;

  if (expr.elements.length < minLength) return undefined;

  const paramsNode = expr.elements[paramsIndex];
  if (!isList(paramsNode)) return undefined;

  return paramsNode.elements
    .filter((el): el is SSymbol => isSymbol(el) && el.name !== "vector" && el.name !== "empty-array")
    .map((el) => el.name);
}
