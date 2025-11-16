// index.js - Public API exports for HQL stdlib
// Auto-injected into HQL runtime

// Import all core functions
import {
  apply,
  assoc,
  assocIn,
  // Function operations
  comp,
  concat,
  conj,
  cons,
  count,
  cycle,
  dissoc,
  distinct,
  doall,
  drop,
  empty,
  // Sequence predicates (Week 5)
  every,
  filter,
  // Sequence primitives (Lisp trinity)
  first,
  flatten,
  // Map/Object operations (Week 6)
  get,
  getIn,
  // Utilities
  groupBy,
  into,
  // Sequence predicates
  isEmpty,
  isSome,
  iterate,
  keep,
  keepIndexed,
  keys,
  last,
  lazySeq,
  map,
  mapcat,
  // Map operations (Week 2)
  mapIndexed,
  merge,
  notAny,
  notEvery,
  // Indexed access & counting (Week 1)
  nth,
  partial,
  // Sequence generators
  range,
  realized,
  reduce,
  // Lazy constructors (Week 4)
  repeat,
  repeatedly,
  rest,
  second,
  // Collection protocols (Week 3)
  seq,
  set,
  some,
  // Sequence operations
  take,
  update,
  updateIn,
  // Type conversions (Week 6)
  vec,
} from "./core.js";

// Export LazySeq class for advanced users (instanceof checks)
export { LazySeq } from "./internal/lazy-seq.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUBLIC API - Auto-injected into HQL runtime
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// All functions in this object are automatically available in HQL without imports.
// To add a new stdlib function:
// 1. Define and export it in core.js (or create a new module)
// 2. Import it above
// 3. Add it to this STDLIB_PUBLIC_API object
// 4. That's it! Auto-injected everywhere ✨
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const STDLIB_PUBLIC_API = {
  // ========================================
  // SEQUENCE PRIMITIVES (Lisp Trinity)
  // ========================================
  first,
  rest,
  cons,

  // ========================================
  // INDEXED ACCESS & COUNTING (Week 1)
  // ========================================
  nth,
  count,
  second,
  last,

  // ========================================
  // SEQUENCE PREDICATES
  // ========================================
  isEmpty,
  some,

  // ========================================
  // SEQUENCE OPERATIONS
  // ========================================
  take,
  drop,
  map,
  filter,
  reduce,
  concat,
  flatten,
  distinct,

  // ========================================
  // MAP OPERATIONS (Week 2)
  // ========================================
  mapIndexed,
  keepIndexed,
  mapcat,
  keep,

  // ========================================
  // COLLECTION PROTOCOLS (Week 3)
  // ========================================
  seq,
  empty,
  conj,
  into,

  // ========================================
  // LAZY CONSTRUCTORS (Week 4)
  // ========================================
  repeat,
  repeatedly,
  cycle,

  // ========================================
  // SEQUENCE PREDICATES (Week 5)
  // ========================================
  every,
  notAny,
  notEvery,
  isSome,

  // ========================================
  // MAP/OBJECT OPERATIONS (Week 6)
  // ========================================
  get,
  getIn,
  assoc,
  assocIn,
  dissoc,
  update,
  updateIn,
  merge,

  // ========================================
  // TYPE CONVERSIONS (Week 6)
  // ========================================
  vec,
  set,

  // ========================================
  // SEQUENCE GENERATORS
  // ========================================
  range,
  rangeGenerator: range, // Alias for backwards compatibility
  iterate,

  // ========================================
  // FUNCTION OPERATIONS
  // ========================================
  comp,
  partial,
  apply,

  // ========================================
  // UTILITIES
  // ========================================
  groupBy,
  keys,
  doall,
  realized,
  lazySeq,
};

// Also export individual functions for direct import
export {
  apply,
  assoc,
  assocIn,
  // Function operations
  comp,
  concat,
  conj,
  cons,
  count,
  cycle,
  dissoc,
  distinct,
  doall,
  drop,
  empty,
  // Sequence predicates (Week 5)
  every,
  filter,
  // Sequence primitives
  first,
  flatten,
  // Map/Object operations (Week 6)
  get,
  getIn,
  // Utilities
  groupBy,
  into,
  // Sequence predicates
  isEmpty,
  isSome,
  iterate,
  keep,
  keepIndexed,
  keys,
  last,
  lazySeq,
  map,
  mapcat,
  // Map operations (Week 2)
  mapIndexed,
  merge,
  notAny,
  notEvery,
  // Indexed access & counting (Week 1)
  nth,
  partial,
  // Sequence generators
  range,
  realized,
  reduce,
  // Lazy constructors (Week 4)
  repeat,
  repeatedly,
  rest,
  second,
  // Collection protocols (Week 3)
  seq,
  set,
  some,
  // Sequence operations
  take,
  update,
  updateIn,
  // Type conversions (Week 6)
  vec,
};

// Backwards compatibility alias
export const rangeGenerator = range;
