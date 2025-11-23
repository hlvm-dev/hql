;; lib/stdlib/stdlib.hql - HQL re-exports JavaScript implementation
;; Note: These functions are auto-loaded by the runtime, so this file is mainly
;; for documentation and explicit imports in user code.
;;
;; IMPORTANT: This must match STDLIB_PUBLIC_API behavior!
;; - We import rangeGenerator (lazy) and export it as range
;; - This ensures explicit imports match auto-loaded behavior

;; Import all 51 fundamental functions from modular JS implementation
(import [
  ;; Sequence primitives (Lisp Trinity)
  first, rest, cons,

  ;; Indexed access & counting (Week 1)
  nth, count, second, last,

  ;; Sequence predicates
  isEmpty, some,

  ;; Sequence operations
  take, map, filter, reduce, drop, concat, flatten, distinct,

  ;; Map operations (Week 2)
  mapIndexed, keepIndexed, mapcat, keep,

  ;; Collection protocols (Week 3)
  seq, empty, conj, into,

  ;; Lazy constructors (Week 4)
  repeat, repeatedly, cycle,

  ;; Sequence predicates (Week 5)
  every, notAny, notEvery, isSome,

  ;; Map/Object operations (Week 6)
  get, getIn, assoc, assocIn, dissoc, update, updateIn, merge,

  ;; Type conversions (Week 6)
  vec, set,

  ;; Sequence generators
  rangeGenerator, iterate,

  ;; Function operations
  comp, partial, apply,

  ;; Utilities
  groupBy, keys, doall, realized, lazySeq
] from "./js/stdlib.js")

;; Create alias for range to match runtime behavior
;; rangeGenerator is imported above, we alias it as "range" here
(let range rangeGenerator)

;; Export all functions (matching STDLIB_PUBLIC_API - 51 total)
(export [
  ;; Sequence primitives (Lisp Trinity)
  first, rest, cons,

  ;; Indexed access & counting (Week 1)
  nth, count, second, last,

  ;; Sequence predicates
  isEmpty, some,

  ;; Sequence operations
  take, map, filter, reduce, drop, concat, flatten, distinct,

  ;; Map operations (Week 2)
  mapIndexed, keepIndexed, mapcat, keep,

  ;; Collection protocols (Week 3)
  seq, empty, conj, into,

  ;; Lazy constructors (Week 4)
  repeat, repeatedly, cycle,

  ;; Sequence predicates (Week 5)
  every, notAny, notEvery, isSome,

  ;; Map/Object operations (Week 6)
  get, getIn, assoc, assocIn, dissoc, update, updateIn, merge,

  ;; Type conversions (Week 6)
  vec, set,

  ;; Sequence generators
  range, rangeGenerator, iterate,

  ;; Function operations
  comp, partial, apply,

  ;; Utilities
  groupBy, keys, doall, realized, lazySeq
])