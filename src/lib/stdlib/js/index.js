// index.js - Public API exports for HQL stdlib
// Auto-injected into HQL runtime

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTO-DISCOVERY: Import all core functions at once
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// To add a new stdlib function:
// 1. Define and export it in core.js
// 2. That's it! Auto-available everywhere ✨
//
// No manual import lists. No manual STDLIB_PUBLIC_API entries.
// Just add to core.js and it works.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import * as Core from "./core.js";
import * as SelfHosted from "./self-hosted.js";

// Export LazySeq class for advanced users (instanceof checks)
export { LazySeq } from "./internal/lazy-seq.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUBLIC API - Auto-discovered from core.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// All exported functions from core.js are automatically available
// in HQL without imports (except __hql_* internal helpers).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SELF-HOSTED FUNCTIONS: Excluded from JS auto-discovery
// These are implemented in HQL (stdlib.hql) as source of truth
// Pre-transpiled versions are loaded from self-hosted.js
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

// Add alias for backwards compatibility
STDLIB_PUBLIC_API.rangeGenerator = Core.range;

// Re-export all functions from core.js for direct import
// This includes both public API and __hql_* runtime helpers
export * from "./core.js";

// Re-export self-hosted functions
export * from "./self-hosted.js";

// Backwards compatibility alias
export const rangeGenerator = Core.range;
