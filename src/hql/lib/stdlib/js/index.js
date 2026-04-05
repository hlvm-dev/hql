// @ts-self-types="./index.d.ts"
// index.js - Public API exports for HQL stdlib
// Auto-injected into HQL runtime

import * as Core from "./core.js";
import * as SelfHosted from "./self-hosted.js";
import * as Transducers from "./transducers.js";

// Export LazySeq, NumericRange, Delay, and Chunking primitives for advanced users
// CONSOLIDATED: All lazy sequences use seq-protocol.js (thunk-based, O(1) rest)
export {
  LazySeq,
  NumericRange,
  Delay,
  isSeq,
  // Chunking infrastructure (32-element batches like Clojure)
  CHUNK_SIZE,
  ArrayChunk,
  ChunkBuffer,
  ChunkedCons,
} from "./internal/seq-protocol.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SELF-HOSTED FUNCTIONS (90% of stdlib)
// Implemented in HQL (stdlib.hql), transpiled to self-hosted.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SELF_HOSTED_FUNCTIONS = new Set([
  // Phase 1: Core Sequence Operations
  "take", "drop", "map", "filter", "reduce", "concat", "flatten", "distinct",
  // Phase 2: Indexed Operations
  "next", "nth", "second", "count", "last",
  // Phase 3: Map Operations
  "mapIndexed", "keepIndexed", "mapcat", "keep",
  // Phase 4: Predicates
  "isEmpty", "some", "every", "notAny", "notEvery", "isSome",
  // Phase 5: Type Predicates
  "isNil", "isEven", "isOdd", "isZero", "isPositive", "isNegative",
  "isNumber", "isString", "isBoolean", "isFunction", "isArray", "isObject",
  // Lisp-style ?-suffix aliases
  "nil_QMARK_", "number_QMARK_", "string_QMARK_", "boolean_QMARK_",
  "array_QMARK_", "object_QMARK_", "fn_QMARK_", "empty_QMARK_",
  "zero_QMARK_", "even_QMARK_", "odd_QMARK_", "pos_QMARK_", "neg_QMARK_",
  "every_QMARK_", "some_QMARK_",
  // Phase 5B: Delay/Force
  "isDelay", "force", "realized",
  // Phase 6: Arithmetic
  "inc", "dec",
  // Phase 7: Comparison
  "eq", "neq", "deepEq",
  // Phase 8: Lazy Constructors
  "repeat", "repeatedly", "cycle",
  // Phase 9: Function Operations
  "iterate",
  // Phase 10: Utilities
  "keys", "reverse", "groupBy",
  // Phase 11: Function Operations
  "comp", "partial", "apply",
  // Phase 12: Comparison (variadic)
  "lt", "gt", "lte", "gte",
  // Phase 13: Arithmetic (variadic)
  "abs", "add", "sub", "mul", "div", "mod",
  // Phase 14: Symbol/Keyword
  "symbol", "keyword", "name",
  // Phase 15: Type Conversions
  "vec", "set", "doall",
  // Phase 16: Map Access
  "get", "getIn",
  // Phase 17: Map Mutations
  "assoc", "assocIn", "dissoc", "update", "updateIn", "merge",
  // Phase 18: Collection Protocols
  "empty", "conj", "into",
  // Phase 19: Conditional Lazy Functions
  "takeWhile", "dropWhile", "splitWith", "splitAt",
  // Phase 20: Reduction Variants
  "reductions",
  // Phase 21: Sequence Combinators
  "interleave", "interpose",
  // Phase 22: Partition Family
  "partition", "partitionAll", "partitionBy",
  // Phase 24: Function Utilities
  "identity", "constantly", "vals", "juxt", "zipmap",
  // Phase 25: Sorting
  "sort", "sortBy",
  // Phase 26: Transducers
  "mapT", "filterT", "takeT", "dropT", "takeWhileT", "dropWhileT",
  "distinctT", "partitionAllT", "composeTransducers",
  // Phase 27: Additional stdlib functions
  "frequencies", "selectKeys", "mergeWith", "remove", "complement",
  "memoize", "notEmpty", "boundedCount", "runBang", "everyPred", "someFn",
  // Phase 28: Additional transducers
  "cat", "dedupe", "removeT", "keepT",
  // Phase 29: Min/Max/TCO utilities
  "min", "max", "fnil", "trampoline",
  // Phase 30: String operations
  "strJoin", "split", "replace_", "trim", "upperCase", "lowerCase",
  "startsWith", "endsWith", "includes", "subs",
  // Phase 31: Additional type predicates
  "isKeyword", "isSymbol", "isSeqable", "isVector", "isMap", "isSet", "isInt", "isFloat",
  // Phase 32: mapcatT transducer
  "mapcatT",
]);

export const STDLIB_PUBLIC_API = Object.fromEntries(
  Object.entries(Core).filter(([name, value]) =>
    typeof value === "function" &&
    !name.startsWith("__hql_") &&
    !SELF_HOSTED_FUNCTIONS.has(name)
  )
);

// Add self-hosted functions (transpiled from HQL, includes transducers)
for (const [name, fn] of Object.entries(SelfHosted)) {
  if (typeof fn === "function") {
    STDLIB_PUBLIC_API[name] = fn;
  }
}

// Backwards compatibility: rangeGenerator → range
STDLIB_PUBLIC_API.rangeGenerator = Core.range;

// Re-export all functions for direct ES module imports
export * from "./core.js";
export * from "./self-hosted.js";
export * from "./transducers.js";

// ES module alias for backwards compatibility
export const rangeGenerator = Core.range;
