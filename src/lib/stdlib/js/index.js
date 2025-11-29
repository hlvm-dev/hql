// index.js - Public API exports for HQL stdlib
// Auto-injected into HQL runtime

// Import all core functions
import {
  // First-class arithmetic operators
  add,
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
  dec,
  dissoc,
  distinct,
  div,
  doall,
  drop,
  empty,
  // Equality and comparison
  eq,
  // Sequence predicates (Week 5)
  every,
  filter,
  // Sequence primitives (Lisp trinity)
  first,
  flatten,
  // Map/Object operations (Week 6)
  get,
  getIn,
  // Comparison functions
  gt,
  gte,
  // Utilities
  groupBy,
  inc,
  into,
  // Sequence predicates
  isEmpty,
  isNil,
  isSome,
  iterate,
  keep,
  keepIndexed,
  keys,
  last,
  lazySeq,
  lt,
  lte,
  map,
  mapcat,
  // Map operations (Week 2)
  mapIndexed,
  merge,
  mod,
  mul,
  neq,
  next,
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
  sub,
  // Sequence operations
  take,
  update,
  updateIn,
  // Type conversions (Week 6)
  vec,
  // Runtime helpers (used by transpiled code)
  __hql_get,
  __hql_getNumeric,
  __hql_range,
  __hql_toSequence,
  __hql_for_each,
  __hql_hash_map,
  __hql_throw,
  __hql_deepFreeze,
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
  // SEQUENCE PRIMITIVES (Lisp Trinity + next)
  // ========================================
  first,
  rest,
  next, // like rest but returns null instead of empty seq
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

  // ========================================
  // FIRST-CLASS ARITHMETIC OPERATORS
  // Use these with higher-order functions like reduce
  // ========================================
  add, // (reduce add 0 [1 2 3]) => 6
  sub, // (reduce sub 10 [1 2 3]) => 4
  mul, // (reduce mul 1 [1 2 3 4]) => 24
  div, // (reduce div 24 [2 3]) => 4
  mod, // (mod 10 3) => 1
  inc, // (inc 5) => 6
  dec, // (dec 5) => 4

  // ========================================
  // PREDICATES
  // ========================================
  isNil, // (isNil null) => true

  // ========================================
  // EQUALITY AND COMPARISON FUNCTIONS
  // Note: In HQL, = is assignment. Use eq or == for equality.
  // ========================================
  eq, // (eq 1 1) => true  (Clojure-style equality)
  neq, // (neq 1 2) => true  (not-equal)
  lt, // (lt 1 2 3) => true  (less-than, variadic)
  gt, // (gt 3 2 1) => true  (greater-than, variadic)
  lte, // (lte 1 2 2) => true  (less-or-equal)
  gte, // (gte 3 2 2) => true  (greater-or-equal)
};

// Also export individual functions for direct import
export {
  // First-class arithmetic operators
  add,
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
  dec,
  dissoc,
  distinct,
  div,
  doall,
  drop,
  empty,
  // Equality and comparison
  eq,
  // Sequence predicates (Week 5)
  every,
  filter,
  // Sequence primitives
  first,
  flatten,
  // Map/Object operations (Week 6)
  get,
  getIn,
  // Comparison functions
  gt,
  gte,
  // Utilities
  groupBy,
  inc,
  into,
  // Sequence predicates
  isEmpty,
  isNil,
  isSome,
  iterate,
  keep,
  keepIndexed,
  keys,
  last,
  lazySeq,
  lt,
  lte,
  map,
  mapcat,
  // Map operations (Week 2)
  mapIndexed,
  merge,
  mod,
  mul,
  neq,
  next,
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
  sub,
  // Sequence operations
  take,
  update,
  updateIn,
  // Type conversions (Week 6)
  vec,

  // ========================================
  // RUNTIME HELPERS (used by transpiled code)
  // ========================================
  __hql_get,
  __hql_getNumeric,
  __hql_range,
  __hql_toSequence,
  __hql_for_each,
  __hql_hash_map,
  __hql_throw,
  __hql_deepFreeze,
};

// Backwards compatibility alias
export const rangeGenerator = range;
