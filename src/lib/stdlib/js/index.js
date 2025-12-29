// index.js - Public API exports for HQL stdlib
// Auto-injected into HQL runtime

import * as Core from "./core.js";
import * as SelfHosted from "./self-hosted.js";

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
// Implemented in HQL (stdlib.hql), pre-transpiled to self-hosted.js
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
  "isNumber", "isString", "isBoolean", "isFunction", "isArray",
  // Phase 6: Arithmetic
  "inc", "dec",
  // Phase 7: Comparison
  "eq", "neq",
  // Phase 8: Lazy Constructors
  "repeat", "repeatedly", "cycle",
  // Phase 9: Function Operations
  "iterate",
  // Phase 10: Utilities
  "keys", "reverse",
  // Phase 11: Function Operations
  "comp", "partial", "apply",
  // Phase 12: Comparison (variadic)
  "lt", "gt", "lte", "gte",
  // Phase 13: Arithmetic (variadic)
  "add", "sub", "mul", "div", "mod",
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
  // Phase 23: Transducers
  "mapT", "filterT", "takeT", "dropT", "takeWhileT", "dropWhileT",
  "distinctT", "partitionAllT", "composeTransducers",
]);

export const STDLIB_PUBLIC_API = Object.fromEntries(
  Object.entries(Core).filter(([name, value]) =>
    typeof value === "function" &&
    !name.startsWith("__hql_") &&
    !SELF_HOSTED_FUNCTIONS.has(name)  // Exclude self-hosted functions
  )
);

// Add self-hosted functions (pre-transpiled from HQL)
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

// ES module alias for backwards compatibility
export const rangeGenerator = Core.range;
