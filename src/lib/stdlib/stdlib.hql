;; lib/stdlib/stdlib.hql - HQL stdlib with self-hosted functions
;;
;; SELF-HOSTED FUNCTIONS:
;; - take: Implemented in HQL using lazy-seq foundation
;; - (more to come as we migrate from JS)
;;
;; The self-hosted approach:
;; - Import primitive functions from JS (first, rest, cons, seq, lazy-seq)
;; - Build higher-level functions in HQL using those primitives
;; - This is TRUE self-hosting: HQL code that gets transpiled

;; Import primitive functions from JavaScript (the foundation)
(import [
  ;; Sequence primitives (Lisp Trinity) - these are the foundation
  first, rest, cons, seq,

  ;; Indexed access & counting (Week 1)
  nth, count, second, last,

  ;; Sequence predicates
  isEmpty, some,

  ;; Sequence operations (NOT take - that's self-hosted below!)
  map, filter, reduce, drop, concat, flatten, distinct,

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
(let range rangeGenerator)

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; SELF-HOSTED STDLIB FUNCTIONS
;; These are implemented in HQL, not JavaScript!
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; take - Returns first n elements from a collection (lazy)
;; This is TRUE self-hosted HQL code using lazy-seq foundation
(fn take [n coll]
  (lazy-seq
    (when (> n 0)
      (when-let [s (seq coll)]
        (cons (first s) (take (- n 1) (rest s)))))))

;; drop - Drops first n elements from a collection (lazy)
;; Returns remaining elements after skipping n
;; Note: Uses iterative skip + cons to ensure seq-protocol compatibility
(fn drop [n coll]
  (lazy-seq
    (loop [s (seq coll) remaining n]
      (if (and s (> remaining 0))
        (recur (rest s) (- remaining 1))
        (when s
          (cons (first s) (drop 0 (rest s))))))))

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