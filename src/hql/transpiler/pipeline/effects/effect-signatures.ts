import type { Effect, ValueKind } from "./effect-types.ts";

function asEffectMap(
  pureNames: readonly string[],
  impureNames: readonly string[],
): ReadonlyMap<string, Effect> {
  return new Map<string, Effect>([
    ...pureNames.map((name): [string, Effect] => [name, "Pure"]),
    ...impureNames.map((name): [string, Effect] => [name, "Impure"]),
  ]);
}

/**
 * Sigma: canonical JS/runtime boundary effect signatures.
 *
 * This file is the single source of truth for extern effect assumptions.
 * Unknown extern/member/method/constructor lookups fail closed as Impure.
 */
const FUNCTION_EFFECTS = asEffectMap(
  [
    "map",
    "filter",
    "reduce",
    "first",
    "rest",
    "cons",
    "nth",
    "count",
    "range",
    "take",
    "drop",
    "flatten",
    "distinct",
    "concat",
    "str",
    "isEmpty",
    "some",
    "every",
    "identity",
    "comp",
    "partial",
    "apply",
    "keys",
    "vals",
    "get",
    "assoc",
    "dissoc",
    "merge",
    "zipmap",
    "list",
    "vector",
    "hashMap",
    "set",
    "sorted",
    "not",
    "inc",
    "dec",
    "even?",
    "odd?",
    "zero?",
    "pos?",
    "neg?",
    "min",
    "max",
    "abs",
    "parseInt",
    "parseFloat",
    "type",
    "string?",
    "number?",
    "boolean?",
    "nil?",
    "fn?",
    "array?",
    "map?",
    "pr_str",
    "__hql_deepFreeze",
    "__hql_hash_map",
    "__hql_get",
    "__hql_getNumeric",
    "__hql_equal",
    "__hql_not_equal",
    "__hql_str",
    "__hql_type",
    "__hql_identity",
    "__hql_create_range",
    "__hql_lazy_map",
    "__hql_lazy_filter",
    "__hql_lazy_take",
    "__hql_first",
    "__hql_rest",
    "__hql_nth",
    "__hql_assoc",
    "__hql_dissoc",
    "__hql_update",
    "__hql_conj",
    "__hql_into",
    "__hql_range",
    "__hql_toSequence",
    "__hql_toIterable",
    "__hql_match_obj",
    "__hql_trampoline",
    "__hql_trampoline_gen",
    "__hql_throw",
    "__hql_get_op",
  ] as const,
  [
    "fetch",
    "setTimeout",
    "setInterval",
    "clearTimeout",
    "clearInterval",
    "alert",
    "confirm",
    "prompt",
    "queueMicrotask",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ] as const,
);

const STATIC_MEMBER_EFFECTS = asEffectMap(
  [
    "Math.floor",
    "Math.ceil",
    "Math.abs",
    "Math.sqrt",
    "Math.min",
    "Math.max",
    "Math.pow",
    "Math.log",
    "Math.round",
    "Math.trunc",
    "Math.sign",
    "Math.PI",
    "Math.E",
    "String.fromCharCode",
    "String.fromCodePoint",
    "Number.isFinite",
    "Number.isNaN",
    "Number.isInteger",
    "Number.isSafeInteger",
    "Number.parseInt",
    "Number.parseFloat",
    "JSON.stringify",
    "JSON.parse",
    "Object.keys",
    "Object.values",
    "Object.entries",
    "Object.freeze",
    "Object.fromEntries",
    "Object.hasOwn",
    "Array.isArray",
    "Array.from",
    "Array.of",
  ] as const,
  [
    "console.log",
    "console.error",
    "console.warn",
    "console.info",
    "console.debug",
    "console.dir",
    "console.table",
    "console.trace",
    "console.time",
    "console.timeEnd",
    "Math.random",
    "Date.now",
    "performance.now",
    "Object.assign",
  ] as const,
);

const METHOD_EFFECTS = asEffectMap(
  [
    "slice",
    "map",
    "filter",
    "reduce",
    "reduceRight",
    "indexOf",
    "lastIndexOf",
    "includes",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "every",
    "some",
    "flat",
    "flatMap",
    "concat",
    "join",
    "toString",
    "valueOf",
    "toLocaleString",
    "trim",
    "trimStart",
    "trimEnd",
    "toUpperCase",
    "toLowerCase",
    "charAt",
    "charCodeAt",
    "codePointAt",
    "startsWith",
    "endsWith",
    "padStart",
    "padEnd",
    "repeat",
    "replace",
    "replaceAll",
    "split",
    "substring",
    "at",
    "with",
    "keys",
    "values",
    "entries",
    "has",
    "get",
    "match",
    "matchAll",
    "search",
    "test",
  ] as const,
  [
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "fill",
    "copyWithin",
    "set",
    "delete",
    "clear",
    "add",
  ] as const,
);

const CONSTRUCTOR_EFFECTS = asEffectMap(
  [
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "URIError",
    "Map",
    "Set",
    "Array",
    "RegExp",
    "WeakMap",
    "WeakSet",
    "URL",
    "Int8Array",
    "Uint8Array",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float32Array",
    "Float64Array",
  ] as const,
  [
    "Date",
  ] as const,
);

export function getFunctionEffect(name: string): Effect | undefined {
  return FUNCTION_EFFECTS.get(name);
}

export function getStaticMemberEffect(path: string): Effect | undefined {
  return STATIC_MEMBER_EFFECTS.get(path);
}

export function getMethodEffect(name: string): Effect | undefined {
  return METHOD_EFFECTS.get(name);
}

export function getConstructorEffect(name: string): Effect | undefined {
  return CONSTRUCTOR_EFFECTS.get(name);
}

// ---------------------------------------------------------------------------
// Typed method effects: (ReceiverKind, method) → Effect
// ---------------------------------------------------------------------------

const TYPED_METHOD_EFFECTS: ReadonlyMap<ValueKind, ReadonlyMap<string, Effect>> = new Map<ValueKind, ReadonlyMap<string, Effect>>([
  ["Array", asEffectMap(
    ["map", "filter", "reduce", "reduceRight", "indexOf", "lastIndexOf",
     "includes", "find", "findIndex", "findLast", "findLastIndex",
     "every", "some", "flat", "flatMap", "concat", "join", "slice",
     "toString", "valueOf", "at", "with", "keys", "values", "entries"],
    ["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"],
  )],
  ["String", asEffectMap(
    ["toUpperCase", "toLowerCase", "trim", "trimStart", "trimEnd",
     "charAt", "charCodeAt", "codePointAt", "startsWith", "endsWith",
     "padStart", "padEnd", "repeat", "replace", "replaceAll", "split",
     "substring", "slice", "indexOf", "lastIndexOf", "includes",
     "match", "matchAll", "search", "at", "concat", "toString", "valueOf",
     "toLocaleString"],
    [],
  )],
  ["Map", asEffectMap(
    ["has", "get", "keys", "values", "entries"],
    ["set", "delete", "clear"],
  )],
  ["Set", asEffectMap(
    ["has", "keys", "values", "entries"],
    ["add", "delete", "clear"],
  )],
  ["Number", asEffectMap(
    ["toString", "toFixed", "toPrecision", "toExponential", "valueOf", "toLocaleString"],
    [],
  )],
  ["Boolean", asEffectMap(
    ["toString", "valueOf"],
    [],
  )],
  ["RegExp", asEffectMap(
    ["test", "exec", "toString"],
    [],
  )],
  ["Promise", asEffectMap(
    [],
    ["then", "catch", "finally"],
  )],
]);

/**
 * Typed method effect resolution.
 *
 * - Untyped → falls back to flat METHOD_EFFECTS (backward compat)
 * - Unknown → returns undefined (caller treats as Impure, fail-closed)
 * - Known kind → lookup in typed table; undefined if method not listed
 */
export function getTypedMethodEffect(
  receiverKind: ValueKind,
  method: string,
): Effect | undefined {
  if (receiverKind === "Untyped") return METHOD_EFFECTS.get(method);

  if (receiverKind === "Unknown") return undefined;

  const kindTable = TYPED_METHOD_EFFECTS.get(receiverKind);
  if (!kindTable) return METHOD_EFFECTS.get(method);

  return kindTable.get(method);
}

/**
 * Maps higher-order method names to the zero-based argument positions that
 * receive callback functions. Used by `inferCallbackEffect` to check the
 * *invoked* effect of callback arguments rather than just the expression effect.
 */
const HIGHER_ORDER_METHOD_CALLBACKS: ReadonlyMap<string, ReadonlySet<number>> = new Map([
  ["map", new Set([0])],
  ["filter", new Set([0])],
  ["reduce", new Set([0])],
  ["reduceRight", new Set([0])],
  ["find", new Set([0])],
  ["findIndex", new Set([0])],
  ["findLast", new Set([0])],
  ["findLastIndex", new Set([0])],
  ["every", new Set([0])],
  ["some", new Set([0])],
  ["flatMap", new Set([0])],
  ["replace", new Set([1])],
  ["replaceAll", new Set([1])],
]);

export function getHigherOrderCallbackPositions(
  methodName: string,
): ReadonlySet<number> | undefined {
  return HIGHER_ORDER_METHOD_CALLBACKS.get(methodName);
}

