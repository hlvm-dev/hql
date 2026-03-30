// lib/stdlib/stdlib.hql - HQL stdlib with self-hosted functions
//
// ~96% of public API is self-hosted in HQL. Only sequence primitives
// (first, rest, cons, seq), lazy-seq constructor, range, and chunked
// fast paths remain as JS imports.
//
// The self-hosted approach:
// - Import primitive functions from JS (first, rest, cons, seq, lazy-seq)
// - Build higher-level functions in HQL using those primitives
// - This is TRUE self-hosting: HQL code that gets transpiled

// Import primitive functions from JavaScript (the foundation)
// Only true primitives and hot-path functions that can't be expressed in HQL
(import [
  // Sequence primitives (Lisp Trinity) - the irreducible foundation
  first, rest, cons, seq,

  // Lazy sequence constructor
  lazySeq,

  // Sequence generators (uses NumericRange with O(1) count/nth - hot path)
  range,

  // Chunked sequence fast paths
  chunkedMap, chunkedFilter, chunkedReduce
] from "./js/core.js")

// Chunking decision helper + class constructors from seq protocol
(import [shouldChunk, Delay, LazySeq,
         reduced, isReduced, ensureReduced,
         TRANSDUCER_INIT, TRANSDUCER_STEP, TRANSDUCER_RESULT]
  from "./js/internal/seq-protocol.js")

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SELF-HOSTED STDLIB FUNCTIONS
// These are implemented in HQL, not JavaScript!
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// take - Returns first n elements from a collection (lazy)
// This is TRUE self-hosted HQL code using lazy-seq foundation
(fn take [n coll]
  (lazy-seq
    (when (> n 0)
      (when-let [s (seq coll)]
        (cons (first s) (take (- n 1) (rest s)))))))

// drop - Drops first n elements from a collection (lazy)
// Returns remaining elements after skipping n
(fn drop [n coll]
  (lazy-seq
    (loop [s (seq coll) remaining n]
      (if (and s (> remaining 0))
        (recur (seq (rest s)) (- remaining 1))
        s))))

// map - Maps function over collection(s) (lazy)
// Supports:
// - (map f coll)
// - (map f c1 c2 ...)
(fn map [f & colls]
  (when (not (isFunction f))
    (throw (js/TypeError (str "map: first argument must be a function, got " (typeof f)))))
  (when (nil? (seq colls))
    (throw (js/TypeError "map: requires at least one collection")))
  (if (nil? (seq (rest colls)))
    (let [coll (first colls)]
      (if (shouldChunk coll)
        (chunkedMap f coll)
        (lazy-seq
          (when-let [s (seq coll)]
            (cons (f (first s)) (map f (rest s)))))))
    (lazy-seq
      (let [seqs (doall (map seq colls))]
        (if (js-call seqs "some" (fn [s] (nil? s)))
          nil
          (let [firsts (doall (map first seqs))
                rests (doall (map rest seqs))]
            (cons (apply f firsts)
                  (apply map (cons f rests)))))))))

// filter - Filters collection by predicate (lazy)
// Only includes elements where (pred elem) is truthy
// Pattern: skip non-matching elements recursively until we find one
(fn filter [pred coll]
  (when (not (isFunction pred))
    (throw (js/TypeError (str "filter: predicate must be a function, got " (typeof pred)))))
  (if (shouldChunk coll)
    (chunkedFilter pred coll)
    (lazy-seq
      (when-let [s (seq coll)]
        (let [f (first s)]
          (if (pred f)
            (cons f (filter pred (rest s)))
            (filter pred (rest s))))))))

// reduce - Reduces collection (EAGER)
// Supports:
// - (reduce f coll)
// - (reduce f init coll)
// Supports early termination with (reduced x)
(fn reduce [f & args]
  (when (not (isFunction f))
    (throw (js/TypeError (str "reduce: reducer must be a function, got " (typeof f)))))
  (when (or (nil? (seq args)) (and (seq (rest args)) (seq (rest (rest args)))))
    (throw (js/TypeError "reduce: expects 2 or 3 arguments")))
  (if (nil? (seq (rest args)))
    // 2-arity: (reduce f coll)
    (let [coll (first args)
          s (seq coll)]
      (if s
        (chunkedReduce f (first s) (rest s))
        (f)))
    // 3-arity: (reduce f init coll)
    (chunkedReduce f (first args) (second args))))

// concat - Concatenates multiple collections (lazy, stack-safe)
// Variadic function: (concat [1 2] [3 4]) => (1 2 3 4)
// Uses loop/recur to skip empty collections, lazy-seq for element emission
(fn concat [& colls]
  (let [cat (fn cat [remaining]
              (lazy-seq
                (loop [cs remaining]
                  (when-let [seqd (seq cs)]
                    (if-let [s (seq (first seqd))]
                      (cons (first s) (cat (cons (rest s) (rest seqd))))
                      (recur (rest seqd)))))))]
    (cat colls)))

// flatten - Flattens nested collections (lazy)
// Recursively flattens all iterable items (except strings)
// Note: Uses JS interop for iterable checking in pre-transpiled version
(fn flatten [coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (let [f (first s)]
        (if (and (not (nil? f))
                 (not (isString f))
                 (or (isArray f)
                     (instanceof f Set)
                     (instanceof f Map)
                     (isObject f)))
          (concat (flatten f) (flatten (rest s)))
          (cons f (flatten (rest s))))))))

// distinct - Removes duplicate elements (lazy)
// Uses a Set to track seen elements efficiently
// Note: Pre-transpiled version uses JS Set for O(1) lookup
(fn distinct [coll]
  (let [seen (js-new Set ())]
    (let [step (fn [s]
                 (lazy-seq
                   (when-let [xs (seq s)]
                     (let [f (first xs)]
                       (if (.has seen f)
                         (step (rest xs))
                         (do (.add seen f)
                             (cons f (step (rest xs)))))))))]
      (step coll))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 2: INDEXED OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// next - Returns (seq (rest coll)), nil if rest is empty
// This is the Clojure-style "next" that differs from "rest"
// next returns nil for empty, rest returns empty seq
(fn next [coll]
  (seq (rest coll)))

// nth - Returns element at index, with optional not-found value
// Uses loop to iterate to the index position
// Throws error if out of bounds and no not-found provided
// Note: Uses (seq args) instead of (count args) to avoid circular dependency
(fn nth [coll index & args]
  (when (or (not (=== (typeof index) "number")) (< index 0) (not (=== index (js-call Math.floor index))))
    (throw (js/TypeError (str "nth: index must be non-negative integer, got " index))))
  (let [not-found (first args)
        has-not-found (seq args)]  // truthy if args is non-empty
    (if (nil? coll)
      (if has-not-found
        not-found
        (throw (js/Error (str "nth: index " index " out of bounds for null collection"))))
      (if (or (js-call Array.isArray coll) (=== (typeof coll) "string"))
        (let [len (js-get coll "length")]
          (if (< index len)
            (js-get coll index)
            (if has-not-found
              not-found
              (throw (js/Error (str "nth: index " index " out of bounds (length " len ")"))))))
        (if (and (=== (typeof (js-get coll "count")) "function")
                 (=== (typeof (js-get coll "nth")) "function"))
          (let [len (js-call coll "count")]
            (if (< index len)
              (js-call coll "nth" index)
              (if has-not-found
                not-found
                (throw (js/Error (str "nth: index " index " out of bounds"))))))
          (loop [s (seq coll), i 0]
            (if s
              (if (=== i index)
                (first s)
                (recur (seq (rest s)) (+ i 1)))
              (if has-not-found
                not-found
                (throw (js/Error (str "nth: index " index " out of bounds")))))))))))

// second - Returns second element of collection
// Simply (nth coll 1 nil) - returns nil if less than 2 elements
(fn second [coll]
  (nth coll 1 nil))

// count - Returns count of elements (EAGER)
// O(1) for arrays, strings, and types with .count() method; walks seq otherwise
(fn count [coll]
  (if (nil? coll)
    0
    (if (or (isArray coll) (=== (typeof coll) "string"))
      (js-get coll "length")
      (if (=== (typeof (js-get coll "count")) "function")
        (js-call coll "count")
        (loop [s (seq coll), n 0]
          (if s
            (recur (seq (rest s)) (+ n 1))
            n))))))

// last - Returns last element (EAGER)
// O(1) for arrays; walks seq otherwise
(fn last [coll]
  (if (nil? coll)
    nil
    (if (isArray coll)
      (if (> (js-get coll "length") 0)
        (js-get coll (- (js-get coll "length") 1))
        nil)
      (loop [s (seq coll), result nil]
        (if s
          (recur (seq (rest s)) (first s))
          result)))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 3: MAP OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// mapIndexed - Maps function (index, item) over collection (lazy)
// Like map but the function receives (index, item) instead of just (item)
(fn mapIndexed [f coll]
  (when (not (isFunction f))
    (throw (js/TypeError (str "mapIndexed: first argument must be a function, got " (typeof f)))))
  (let [step (fn [s idx]
               (lazy-seq
                 (when-let [xs (seq s)]
                   (cons (f idx (first xs))
                         (step (rest xs) (+ idx 1))))))]
    (step coll 0)))

// keepIndexed - Like mapIndexed but filters nil results (lazy)
// Only keeps results where (f index item) is not nil/undefined
(fn keepIndexed [f coll]
  (when (not (isFunction f))
    (throw (js/TypeError (str "keepIndexed: first argument must be a function, got " (typeof f)))))
  (let [step (fn [s idx]
               (lazy-seq
                 (when-let [xs (seq s)]
                   (let [result (f idx (first xs))]
                     (if (isSome result)
                       (cons result (step (rest xs) (+ idx 1)))
                       (step (rest xs) (+ idx 1)))))))]
    (step coll 0)))

// mapcat - Maps function then concatenates/flattens one level (lazy)
// Equivalent to (apply concat (map f coll))
(fn mapcat [f coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (concat (f (first s)) (mapcat f (rest s))))))

// keep - Maps function and filters nil results (lazy)
// Only keeps results where (f item) is not nil/undefined
(fn keep [f coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (let [result (f (first s))]
        (if (isSome result)
          (cons result (keep f (rest s)))
          (keep f (rest s)))))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 3B: CONDITIONAL LAZY FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// takeWhile - Returns elements while predicate is true (lazy)
// Clojure: (take-while pos? [1 2 3 0 -1]) => (1 2 3)
(fn takeWhile [pred coll]
  (when (not (isFunction pred))
    (throw (js/TypeError "takeWhile: predicate must be a function")))
  (lazy-seq
    (when-let [s (seq coll)]
      (let [f (first s)]
        (when (pred f)
          (cons f (takeWhile pred (rest s))))))))

// dropWhile - Drops elements while predicate is true (lazy)
// Clojure: (drop-while pos? [1 2 3 0 -1 2]) => (0 -1 2)
(fn dropWhile [pred coll]
  (lazy-seq
    (loop [s (seq coll)]
      (if (and s (pred (first s)))
        (recur (seq (rest s)))
        (when s
          (cons (first s) (rest s)))))))

// splitWith - Returns [(takeWhile pred coll) (dropWhile pred coll)]
(fn splitWith [pred coll]
  [(doall (takeWhile pred coll)) (doall (dropWhile pred coll))])

// splitAt - Returns [(take n coll) (drop n coll)]
(fn splitAt [n coll]
  [(doall (take n coll)) (doall (drop n coll))])

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 3C: REDUCTION VARIANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// reductions - Returns lazy seq of intermediate reduce values
// Clojure: (reductions + [1 2 3 4]) => (1 3 6 10)
// Clojure: (reductions + 0 [1 2 3]) => (0 1 3 6)
(fn reductions [f & args]
  (let [reductions-with-init
        (fn reductions-with-init [f init coll]
          (cons init
                (lazy-seq
                  (when-let [s (seq coll)]
                    (reductions-with-init f (f init (first s)) (rest s))))))]
    (if (nil? (seq (rest args)))
      // 2-arity: (reductions f coll)
      (let [coll (first args)]
        (lazy-seq
          (when-let [s (seq coll)]
            (reductions-with-init f (first s) (rest s)))))
      // 3-arity: (reductions f init coll)
      (reductions-with-init f (first args) (second args)))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 3D: SEQUENCE COMBINATORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// interpose - Inserts separator between elements (lazy)
// Example: (interpose "x" [1 2 3]) => (1 "x" 2 "x" 3)
(fn interpose [sep coll]
  (let [interpose-rest
        (fn interpose-rest [sep coll]
          (lazy-seq
            (when-let [s (seq coll)]
              (cons sep (cons (first s) (interpose-rest sep (rest s)))))))]
    (lazy-seq
      (when-let [s (seq coll)]
        (cons (first s) (interpose-rest sep (rest s)))))))

// interleave - Interleaves multiple sequences (lazy)
// Example: (interleave [1 2 3] ["a" "b" "c"]) => (1 "a" 2 "b" 3 "c")
(fn interleave [& colls]
  (if (nil? (seq colls))
    (lazy-seq nil)
    (if (nil? (seq (rest colls)))
      (lazy-seq (seq (first colls)))
      (lazy-seq
        (let [seqs (doall (map seq colls))]
          (when (every isSome seqs)
            (concat (doall (map first seqs))
                    (apply interleave (doall (map rest seqs))))))))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 3E: PARTITION FAMILY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// partition - Partitions into groups of n, drops incomplete (lazy)
// 2-arity: (partition n coll) - step defaults to n
// 3-arity: (partition n step coll) - explicit step
// Clojure: (partition 3 [1 2 3 4 5 6 7]) => ((1 2 3) (4 5 6))
(fn partition [n & args]
  (when (or (not (=== (typeof n) "number")) (<= n 0))
    (throw (js/TypeError "partition: n must be a positive number")))
  (let [has-step (seq (rest args))
        step (if has-step (first args) n)
        coll (if has-step (second args) (first args))]
    (when (or (not (=== (typeof step) "number")) (<= step 0))
      (throw (js/TypeError "partition: step must be a positive number")))
    (lazy-seq
      (when-let [s (seq coll)]
        (let [p (doall (take n s))]
          (when (=== (count p) n)
            (cons p (partition n step (drop step s)))))))))

// partitionAll - Like partition but includes incomplete final group (lazy)
// Clojure: (partition-all 3 [1 2 3 4 5 6 7]) => ((1 2 3) (4 5 6) (7))
(fn partitionAll [n & args]
  (let [has-step (seq (rest args))
        step (if has-step (first args) n)
        coll (if has-step (second args) (first args))]
    (lazy-seq
      (when-let [s (seq coll)]
        (let [p (doall (take n s))]
          (cons p (partitionAll n step (drop step s))))))))

// partitionBy - Partitions when function result changes (lazy)
// Clojure: (partition-by odd? [1 1 2 2 3]) => ((1 1) (2 2) (3))
// O(n): builds each run and tracks remaining sequence simultaneously
(fn partitionBy [f coll]
  (when (not (isFunction f))
    (throw (js/TypeError "partitionBy: f must be a function")))
  (lazy-seq
    (when-let [s (seq coll)]
      (let [fst (first s)
            fv (f fst)
            result (loop [run [fst], remaining (seq (rest s))]
                     (if (and remaining (=== (f (first remaining)) fv))
                       (recur (conj run (first remaining)) (seq (rest remaining)))
                       [run remaining]))]
        (cons (js-get result 0) (partitionBy f (js-get result 1)))))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 4: PREDICATES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// isEmpty - Tests if collection is empty
// Returns true if nil or empty, false otherwise
(fn isEmpty [coll]
  (nil? (seq coll)))

// some - Returns first truthy predicate result, or nil (Clojure semantics)
// Short-circuits on first match
(fn some [pred coll]
  (when (not (isFunction pred))
    (throw (js/TypeError (str "some: predicate must be a function, got " (typeof pred)))))
  (loop [s (seq coll)]
    (if s
      (let [result (pred (first s))]
        (if result
          result
          (recur (seq (rest s)))))
      nil)))

// every - Returns true if predicate returns truthy for all items
// Short-circuits on first falsy, empty collection returns true (vacuous truth)
(fn every [pred coll]
  (when (not (isFunction pred))
    (throw (js/TypeError (str "every: predicate must be a function, got " (typeof pred)))))
  (loop [s (seq coll)]
    (if s
      (if (pred (first s))
        (recur (seq (rest s)))
        false)
      true)))

// notAny - Returns true if predicate returns false for all items
// Equivalent to (not (some pred coll))
(fn notAny [pred coll]
  (when (not (isFunction pred))
    (throw (js/TypeError (str "notAny: predicate must be a function, got " (typeof pred)))))
  (loop [s (seq coll)]
    (if s
      (if (pred (first s))
        false
        (recur (seq (rest s))))
      true)))

// notEvery - Returns true if predicate returns false for at least one item
// Equivalent to (not (every pred coll))
(fn notEvery [pred coll]
  (when (not (isFunction pred))
    (throw (js/TypeError (str "notEvery: predicate must be a function, got " (typeof pred)))))
  (loop [s (seq coll)]
    (if s
      (if (pred (first s))
        (recur (seq (rest s)))
        true)
      false)))

// isSome - Returns true if value is not nil (null or undefined)
// Note: This only checks for nil, not falsiness (0, false, "" return true)
(fn isSome [x]
  (not (nil? x)))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 5: TYPE PREDICATES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(fn isNil [x] (== x null))
(fn isEven [n] (== 0 (mod n 2)))
(fn isOdd [n] (not (== 0 (mod n 2))))
(fn isZero [n] (== n 0))
(fn isPositive [n] (> n 0))
(fn isNegative [n] (< n 0))
(fn isNumber [x] (== "number" (typeof x)))
(fn isString [x] (== "string" (typeof x)))
(fn isBoolean [x] (== "boolean" (typeof x)))
(fn isFunction [x] (== "function" (typeof x)))
(fn isArray [x] (js-call Array.isArray x))
(fn isObject [x]
  (and (not (nil? x)) (=== (typeof x) "object") (not (js-call Array.isArray x))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 5B: DELAY/FORCE (self-hosted)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// isDelay - Check if a value is a Delay
(fn isDelay [x] (instanceof x Delay))

// force - Force evaluation of a Delay, or return value unchanged
(fn force [x]
  (if (instanceof x Delay) (js-call x "deref") x))

// realized - Check if a LazySeq or Delay has been realized
(fn realized [coll]
  (if (nil? coll)
    true
    (if (instanceof coll Delay)
      (js-get coll "_realized")
      (if (instanceof coll LazySeq)
        (js-get coll "_isRealized")
        true))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 6: ARITHMETIC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(fn inc [x] (+ x 1))
(fn dec [x] (- x 1))
(fn abs [x] (js-call Math.abs x))

// Variadic arithmetic with identity semantics
(fn add [& nums] (reduce (fn [a b] (+ a b)) 0 nums))
(fn sub [& nums]
  (if (nil? (seq nums))
    0
    (if (nil? (seq (rest nums)))
      (- 0 (first nums))
      (reduce (fn [a b] (- a b)) (first nums) (rest nums)))))
(fn mul [& nums] (reduce (fn [a b] (* a b)) 1 nums))
(fn div [& nums]
  (if (nil? (seq nums))
    1
    (if (nil? (seq (rest nums)))
      (/ 1 (first nums))
      (reduce (fn [a b] (/ a b)) (first nums) (rest nums)))))
(fn mod [a b] (% a b))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 7: COMPARISON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(fn eq [& vals]
  (if (not (seq (rest vals)))
    true
    (let [fst (first vals)]
      (loop [s (seq (rest vals))]
        (if s
          (if (=== fst (first s))
            (recur (seq (rest s)))
            false)
          true)))))

(fn neq [a b] (not (=== a b)))

// deepEqInternal - Structural/deep equality with cycle tracking
// seenAB / seenBA are WeakMaps that store previously compared object pairs.
(fn deepEqInternal [a b seenAB seenBA]
  (if (=== a b)
    true
    (if (or (nil? a) (nil? b))
      false
      (if (or (not (=== (typeof a) "object")) (not (=== (typeof b) "object")))
        false
        (let [mappedB (js-call seenAB "get" a)
              mappedA (js-call seenBA "get" b)]
          (if (or
                (and (not (nil? mappedB)) (not (=== mappedB b)))
                (and (not (nil? mappedA)) (not (=== mappedA a))))
            false
            (if (or
                  (and (not (nil? mappedB)) (=== mappedB b))
                  (and (not (nil? mappedA)) (=== mappedA a)))
              true
              (let [_seenAB (js-call seenAB "set" a b)
                    _seenBA (js-call seenBA "set" b a)]
                (if (and (isArray a) (isArray b))
                  (if (not (=== (js-get a "length") (js-get b "length")))
                    false
                    (loop [i 0]
                      (if (>= i (js-get a "length"))
                        true
                        (if (deepEqInternal (js-get a i) (js-get b i) seenAB seenBA)
                          (recur (+ i 1))
                          false))))
                  (if (and (instanceof a Map) (instanceof b Map))
                    (if (not (=== (js-get a "size") (js-get b "size")))
                      false
                      (let [keys-a (js-call Array.from (js-call a "keys"))]
                        (loop [i 0]
                          (if (>= i (js-get keys-a "length"))
                            true
                            (let [k (js-get keys-a i)]
                              (if (and (js-call b "has" k) (deepEqInternal (js-call a "get" k) (js-call b "get" k) seenAB seenBA))
                                (recur (+ i 1))
                                false))))))
                    (if (and (instanceof a Set) (instanceof b Set))
                      (if (not (=== (js-get a "size") (js-get b "size")))
                        false
                        (let [arr-a (js-call Array.from a)]
                          (loop [i 0]
                            (if (>= i (js-get arr-a "length"))
                              true
                              (if (js-call b "has" (js-get arr-a i))
                                (recur (+ i 1))
                                false)))))
                      (if (and (isObject a) (isObject b))
                        (let [keys-a (js-call Object.keys a)
                              keys-b (js-call Object.keys b)]
                          (if (not (=== (js-get keys-a "length") (js-get keys-b "length")))
                            false
                            (loop [i 0]
                              (if (>= i (js-get keys-a "length"))
                                true
                                (let [k (js-get keys-a i)]
                                  (if (and (in k b) (deepEqInternal (js-get a k) (js-get b k) seenAB seenBA))
                                    (recur (+ i 1))
                                    false))))))
                        false))))))))))))

// deepEq - Structural/deep equality for arrays, objects, Maps, Sets
// Recursively compares nested structures; uses === for primitives; cycle-safe.
(fn deepEq [a b]
  (deepEqInternal a b (js-new WeakMap ()) (js-new WeakMap ())))

// Variadic chained comparison: (lt a b c) means a<b AND b<c
(fn lt [& nums]
  (loop [s (seq nums)]
    (if (and s (seq (rest s)))
      (if (< (first s) (first (rest s)))
        (recur (seq (rest s)))
        false)
      true)))

(fn gt [& nums]
  (loop [s (seq nums)]
    (if (and s (seq (rest s)))
      (if (> (first s) (first (rest s)))
        (recur (seq (rest s)))
        false)
      true)))

(fn lte [& nums]
  (loop [s (seq nums)]
    (if (and s (seq (rest s)))
      (if (<= (first s) (first (rest s)))
        (recur (seq (rest s)))
        false)
      true)))

(fn gte [& nums]
  (loop [s (seq nums)]
    (if (and s (seq (rest s)))
      (if (>= (first s) (first (rest s)))
        (recur (seq (rest s)))
        false)
      true)))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 7B: SYMBOL/KEYWORD/NAME
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// symbol - Create symbol from string
(fn symbol [n]
  {"type": "symbol", "name": (js-call String n)})

// keyword - Create keyword (string with : prefix)
(fn keyword [n]
  (let [s (js-call String n)]
    (if (js-call s "startsWith" ":")
      s
      (str ":" s))))

// name - Get name part (removes : prefix from keywords)
(fn name [x]
  (if (nil? x)
    nil
    (if (and (=== (typeof x) "object")
             (=== (js-get x "type") "symbol"))
      (js-get x "name")
      (let [s (js-call String x)]
        (if (js-call s "startsWith" ":")
          (js-call s "slice" 1)
          s)))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 8: LAZY CONSTRUCTORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// repeat - Infinite sequence of the same value
(fn repeat [x]
  (map (fn [_] x) (range)))

// repeatedly - Infinite sequence calling f each time
(fn repeatedly [f]
  (when (not (isFunction f))
    (throw (js/TypeError "repeatedly: f must be a function")))
  (lazy-seq (cons (f) (repeatedly f))))

// cycle - Infinite sequence cycling through collection
(fn cycle [coll]
  (let [xs (seq coll)]
    (if xs
      (let [step (fn [s]
                   (lazy-seq
                     (if (seq s)
                       (cons (first s) (step (rest s)))
                       (step xs))))]
        (step xs))
      nil)))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 9: FUNCTION OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// iterate - Returns x, f(x), f(f(x)), ...
(fn iterate [f x]
  (when (not (isFunction f))
    (throw (js/TypeError "iterate: iterator function must be a function")))
  (lazy-seq (cons x (iterate f (f x)))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 10: UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// keys - Get keys from an object
(fn keys [obj]
  (if (nil? obj)
    []
    (js-call Object.keys obj)))

// groupBy - Group collection elements by function result
// Returns a Map with grouped elements
(fn groupBy [f coll]
  (when (not (isFunction f))
    (throw (js/TypeError (str "groupBy: key function must be a function, got " (typeof f)))))
  (if (nil? coll)
    (js-new Map ())
    (let [result (js-new Map ())]
      (loop [s (seq coll)]
        (if s
          (let [item (first s)
                key (f item)]
            (if (js-call result "has" key)
              (js-call (js-call result "get" key) "push" item)
              (js-call result "set" key [item]))
            (recur (seq (rest s))))
          result)))))

// reverse - Reverse a collection
(fn reverse [coll]
  (if (nil? coll)
    []
    (.reverse (js-call Array.from coll))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 11: FUNCTION UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// identity - Returns its argument unchanged
(fn identity [x] x)

// constantly - Returns a function that always returns x
(fn constantly [x]
  (fn [& _] x))

// vals - Get values from an object/map
(fn vals [m]
  (if (nil? m)
    []
    (js-call Object.values m)))

// juxt - Juxtaposition: returns fn that calls all fns on same args
(fn juxt [& fns]
  (fn [& args]
    (map (fn [f] (apply f args)) fns)))

// zipmap - Create map from keys and values
(fn zipmap [ks vs]
  (loop [keys (seq ks) values (seq vs) result {}]
    (if (and keys values)
      (recur (next keys) (next values)
             (assoc result (first keys) (first values)))
      result)))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 12: MAP ACCESS (self-hosted)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// get - Get value at key from map/object, with optional default
(fn get [m key & args]
  (let [not-found (first args)]
    (if (nil? m)
      not-found
      (if (instanceof m Map)
        (if (js-call m "has" key) (js-call m "get" key) not-found)
        (if (in key m) (js-get m key) not-found)))))

// getIn - Get value at nested path
// Uses a unique sentinel to distinguish "key not found" from "value is nil"
(fn getIn [m path & args]
  (let [not-found (first args)
        sentinel {}]  // unique object — never === to any stored value
    (if (=== (js-get path "length") 0)
      m
      (loop [current m, s (seq path)]
        (if s
          (let [next-val (get current (first s) sentinel)]
            (if (=== next-val sentinel)
              not-found
              (recur next-val (seq (rest s)))))
          current)))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 13: MAP MUTATIONS (immutable, self-hosted)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// assoc - Associate key with value (returns new map/array)
(fn assoc [m key value]
  (if (nil? m)
    (let [r {}]
      (js-set r key value)
      r)
    (if (instanceof m Map)
      (let [r (js-new Map (m))]
        (js-call r "set" key value)
        r)
      (if (js-call Array.isArray m)
        (let [r [...m]]
          (js-set r key value)
          r)
        (let [r {...m}]
          (js-set r key value)
          r)))))

// assocIn - Associate value at nested path
(fn assocIn [m path value]
  (if (=== (js-get path "length") 0)
    value
    (if (=== (js-get path "length") 1)
      (assoc m (js-get path 0) value)
      (let [key (js-get path 0)
            rest-path (js-call path "slice" 1)
            base (if (nil? m) {} m)
            existing (get base key)]
        (assoc base key
          (assocIn
            (if (and (not (nil? existing)) (=== (typeof existing) "object"))
              existing
              (if (=== (typeof (js-get rest-path 0)) "number") [] {}))
            rest-path value))))))

// dissoc - Remove keys from map/array (returns new copy)
(fn dissoc [m & ks]
  (if (nil? m)
    {}
    (if (instanceof m Map)
      (let [r (js-new Map (m))]
        (reduce (fn [acc k] (js-call acc "delete" k) acc) r ks))
      (if (js-call Array.isArray m)
        (let [r (js-call Array.from m)]
          (reduce (fn [acc k] (delete (js-get acc k)) acc) r ks))
        (let [r {...m}]
          (reduce (fn [acc k] (delete (js-get acc k)) acc) r ks))))))

// update - Transform value at key with function
(fn update [m key f]
  (assoc m key (f (get m key))))

// updateIn - Transform value at nested path with function
(fn updateIn [m path f]
  (if (=== (js-get path "length") 0)
    (f m)
    (assocIn m path (f (getIn m path)))))

// merge - Merge multiple maps (later wins, shallow)
// Handles both plain objects and Maps
(fn merge [& maps]
  (let [non-nil (filter (fn [m] (not (nil? m))) maps)]
    (if (isEmpty non-nil)
      {}
      (if (instanceof (first non-nil) Map)
        (let [r (js-new Map ())]
          (reduce (fn [acc m]
            (if (instanceof m Map)
              (js-call m "forEach" (fn [v k] (js-call acc "set" k v)))
              (if (=== (typeof m) "object")
                (js-call (js-call Object.entries m) "forEach"
                  (fn [entry] (js-call acc "set" (js-get entry 0) (js-get entry 1))))
                nil))
            acc) r non-nil))
        (js-call Object.assign {} ...non-nil)))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 14: COLLECTION PROTOCOLS (self-hosted)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Internal helper to keep empty() as an expression form for proper codegen
(fn throwEmptyTypeError [coll]
  (throw (js/TypeError (str "Cannot create empty collection from " (typeof coll)))))

// empty - Return empty collection of same type
(fn empty [coll]
  (if (nil? coll)
    nil
    (if (js-call Array.isArray coll) []
      (if (=== (typeof coll) "string") ""
        (if (instanceof coll Set) (js-new Set ())
          (if (instanceof coll Map) (js-new Map ())
            (if (=== (typeof coll) "object")
              (if (and (js-get coll "_realize") (=== (typeof (js-get coll "_realize")) "function"))
                nil   // LazySeq returns null (Clojure semantics)
                {})
              (throwEmptyTypeError coll))))))))

// conj - Add item(s) to collection (type-preserving)
(fn conj [coll & items]
  (if (nil? (seq items))
    (if (nil? coll) [] coll)
    (if (nil? coll)
      [...items]
      (if (js-call Array.isArray coll)
        [...coll ...items]
        (if (instanceof coll Set)
          (let [r (js-new Set (coll))]
            (reduce (fn [acc item] (js-call acc "add" item) acc) r items))
          (if (instanceof coll Map)
            (do
              (reduce (fn [_ item]
                (when (or (not (js-call Array.isArray item)) (not (=== (js-get item "length") 2)))
                  (throw (js/TypeError "Map entries must be [key, value] pairs")))) nil items)
              (let [r (js-new Map (coll))]
                (reduce (fn [acc item] (js-call acc "set" (js-get item 0) (js-get item 1)) acc) r items)))
            (if (=== (typeof coll) "string")
              (reduce (fn [acc item] (+ acc item)) coll items)
              (do
                (reduce (fn [_ item]
                  (when (or (not (js-call Array.isArray item)) (not (=== (js-get item "length") 2)))
                    (throw (js/TypeError "Object entries must be [key, value] pairs")))) nil items)
                (reduce (fn [acc item] (js-set acc (js-get item 0) (js-get item 1)) acc)
                        {...coll} items)))))))))

// into - Pour collection into target (2-arity or 3-arity with transducer)
(fn into [& args]
  (let [argc (count args)]
    (if (=== argc 2)
      (let [to (first args) from (nth args 1)]
        (if (nil? from)
          (if (nil? to) [] to)
          (if (nil? to)
            (js-call Array.from from)
            (if (js-call Array.isArray to)
              (let [arr (js-call Array.from to)]
                (reduce (fn [acc item] (js-call acc "push" item) acc) arr from))
              (if (instanceof to Set)
                (let [r (js-new Set (to))]
                  (reduce (fn [acc item] (js-call acc "add" item) acc) r from))
                (if (instanceof to Map)
                  (let [r (js-new Map (to))]
                    (reduce (fn [acc item]
                      (if (and (js-call Array.isArray item) (=== (js-get item "length") 2))
                        (js-call acc "set" (js-get item 0) (js-get item 1))
                        acc)
                      acc) r from))
                  (reduce (fn [acc item] (conj acc item)) to from)))))))
      (if (=== argc 3)
        // 3-arity: (into to xform from) — delegate to intoXform from core.js
        (let [to (first args) xform (nth args 1) from (nth args 2)]
          (intoXform to xform from))
        (throw (js/TypeError "into requires 2 or 3 arguments"))))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 15: TYPE CONVERSIONS (self-hosted)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// vec - Convert collection to array
(fn vec [coll]
  (if (nil? coll) [] (js-call Array.from coll)))

// set - Convert collection to Set
(fn set [coll]
  (if (nil? coll) (js-new Set ()) (js-new Set (coll))))

// doall - Force realization of lazy sequence
(fn doall [coll]
  (if (nil? coll)
    []
    (if (js-call Array.isArray coll)
      coll
      (js-call Array.from coll))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 16: FUNCTION OPERATIONS (self-hosted)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// comp - Compose functions right-to-left: (comp f g h)(x) = f(g(h(x)))
(fn comp [& fns]
  (loop [i 0, s (seq fns)]
    (when s
      (when (not (isFunction (first s)))
        (throw (js/TypeError (str "comp: argument " (+ i 1) " must be a function"))))
      (recur (+ i 1) (seq (rest s)))))
  (if (nil? (seq fns))
    (fn [x] x)
    (if (nil? (seq (rest fns)))
      (first fns)
      (fn [& args]
        (let [reversed (reverse fns)
              init-result (apply (first reversed) args)]
          (reduce (fn [result f] (f result)) init-result (rest reversed)))))))

// partial - Partial function application
(fn partial [f & args]
  (when (not (isFunction f))
    (throw (js/TypeError "partial: function must be a function")))
  (fn [& more-args]
    (apply f (concat args more-args))))

// apply - Apply function to args collection
(fn apply [f args]
  (when (not (isFunction f))
    (throw (js/TypeError "apply: function must be a function")))
  (when (or (== args null) (not (=== (typeof (js-get args js/Symbol.iterator)) "function")))
    (throw (js/TypeError "apply: args must be iterable")))
  (let [arr (if (js-call Array.isArray args) args (js-call Array.from args))]
    (js-call f "apply" nil arr)))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 17: SORTING (self-hosted)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// sort - Sort collection with optional comparator
(fn sort [& args]
  (if (nil? (seq (rest args)))
    // Single arg: sort by natural order
    (let [arr (if (nil? (first args)) [] (js-call Array.from (first args)))]
      (js-call arr "sort" (fn [a b] (if (< a b) -1 (if (> a b) 1 0)))))
    // Two args: first is comparator
    (let [comp (first args)
          arr (if (nil? (second args)) [] (js-call Array.from (second args)))]
      (js-call arr "sort" comp))))

// sortBy - Sort collection by key function with optional comparator
(fn sortBy [keyfn & args]
  (if (nil? (seq (rest args)))
    // Two args: sort by keyfn with natural order
    (let [arr (if (nil? (first args)) [] (js-call Array.from (first args)))]
      (js-call arr "sort"
        (fn [a b]
          (let [ka (keyfn a) kb (keyfn b)]
            (if (< ka kb) -1 (if (> ka kb) 1 0))))))
    // Three args: second is comparator
    (let [comp (first args)
          arr (if (nil? (second args)) [] (js-call Array.from (second args)))]
      (js-call arr "sort" (fn [a b] (comp (keyfn a) (keyfn b)))))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 18: TRANSDUCERS (self-hosted)
// Composable algorithmic transformations — protocol keys are plain strings
// Note: We bind rf methods to locals to avoid transpiler issues with
// ((js-get rf KEY) args) — use (let [fn (js-get rf KEY)] (fn args)) instead
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// mapT - Returns a mapping transducer
(fn mapT [f]
  (when (not (isFunction f))
    (throw (js/TypeError "mapT: f must be a function")))
  (fn [rf]
    (let [rf-init (js-get rf TRANSDUCER_INIT)
          rf-step (js-get rf TRANSDUCER_STEP)
          rf-result (js-get rf TRANSDUCER_RESULT)]
      (hash-map
        TRANSDUCER_INIT (fn [] (rf-init))
        TRANSDUCER_STEP (fn [result input] (rf-step result (f input)))
        TRANSDUCER_RESULT (fn [result] (rf-result result))))))

// filterT - Returns a filtering transducer
(fn filterT [pred]
  (when (not (isFunction pred))
    (throw (js/TypeError "filterT: pred must be a function")))
  (fn [rf]
    (let [rf-init (js-get rf TRANSDUCER_INIT)
          rf-step (js-get rf TRANSDUCER_STEP)
          rf-result (js-get rf TRANSDUCER_RESULT)]
      (hash-map
        TRANSDUCER_INIT (fn [] (rf-init))
        TRANSDUCER_STEP (fn [result input]
          (if (pred input) (rf-step result input) result))
        TRANSDUCER_RESULT (fn [result] (rf-result result))))))

// takeT - Returns a take transducer (takes at most n elements)
(fn takeT [n]
  (when (or (not (=== (typeof n) "number")) (< n 0))
    (throw (js/TypeError "takeT: n must be a non-negative number")))
  (fn [rf]
    (let [rf-init (js-get rf TRANSDUCER_INIT)
          rf-step (js-get rf TRANSDUCER_STEP)
          rf-result (js-get rf TRANSDUCER_RESULT)
          state (hash-map "taken" 0)]
      (hash-map
        TRANSDUCER_INIT (fn [] (rf-init))
        TRANSDUCER_STEP (fn [result input]
          (if (< (js-get state "taken") n)
            (do (js-set state "taken" (+ (js-get state "taken") 1))
                (let [r (rf-step result input)]
                  (if (>= (js-get state "taken") n) (ensureReduced r) r)))
            (ensureReduced result)))
        TRANSDUCER_RESULT (fn [result] (rf-result result))))))

// dropT - Returns a drop transducer (drops first n elements)
(fn dropT [n]
  (when (or (not (=== (typeof n) "number")) (< n 0))
    (throw (js/TypeError "dropT: n must be a non-negative number")))
  (fn [rf]
    (let [rf-init (js-get rf TRANSDUCER_INIT)
          rf-step (js-get rf TRANSDUCER_STEP)
          rf-result (js-get rf TRANSDUCER_RESULT)
          state (hash-map "dropped" 0)]
      (hash-map
        TRANSDUCER_INIT (fn [] (rf-init))
        TRANSDUCER_STEP (fn [result input]
          (if (< (js-get state "dropped") n)
            (do (js-set state "dropped" (+ (js-get state "dropped") 1))
                result)
            (rf-step result input)))
        TRANSDUCER_RESULT (fn [result] (rf-result result))))))

// takeWhileT - Returns a take-while transducer
(fn takeWhileT [pred]
  (when (not (isFunction pred))
    (throw (js/TypeError "takeWhileT: pred must be a function")))
  (fn [rf]
    (let [rf-init (js-get rf TRANSDUCER_INIT)
          rf-step (js-get rf TRANSDUCER_STEP)
          rf-result (js-get rf TRANSDUCER_RESULT)]
      (hash-map
        TRANSDUCER_INIT (fn [] (rf-init))
        TRANSDUCER_STEP (fn [result input]
          (if (pred input) (rf-step result input) (reduced result)))
        TRANSDUCER_RESULT (fn [result] (rf-result result))))))

// dropWhileT - Returns a drop-while transducer
(fn dropWhileT [pred]
  (when (not (isFunction pred))
    (throw (js/TypeError "dropWhileT: pred must be a function")))
  (fn [rf]
    (let [rf-init (js-get rf TRANSDUCER_INIT)
          rf-step (js-get rf TRANSDUCER_STEP)
          rf-result (js-get rf TRANSDUCER_RESULT)
          state (hash-map "dropping" true)]
      (hash-map
        TRANSDUCER_INIT (fn [] (rf-init))
        TRANSDUCER_STEP (fn [result input]
          (if (js-get state "dropping")
            (if (pred input)
              result
              (do (js-set state "dropping" false)
                  (rf-step result input)))
            (rf-step result input)))
        TRANSDUCER_RESULT (fn [result] (rf-result result))))))

// distinctT - Returns a distinct transducer (removes duplicates)
(fn distinctT []
  (fn [rf]
    (let [rf-init (js-get rf TRANSDUCER_INIT)
          rf-step (js-get rf TRANSDUCER_STEP)
          rf-result (js-get rf TRANSDUCER_RESULT)
          seen (js-new Set ())]
      (hash-map
        TRANSDUCER_INIT (fn [] (rf-init))
        TRANSDUCER_STEP (fn [result input]
          (if (js-call seen "has" input)
            result
            (do (js-call seen "add" input)
                (rf-step result input))))
        TRANSDUCER_RESULT (fn [result] (rf-result result))))))

// partitionAllT - Returns a partition-all transducer
(fn partitionAllT [n]
  (when (or (not (=== (typeof n) "number")) (< n 1))
    (throw (js/TypeError "partitionAllT: n must be a positive number")))
  (fn [rf]
    (let [rf-init (js-get rf TRANSDUCER_INIT)
          rf-step (js-get rf TRANSDUCER_STEP)
          rf-result (js-get rf TRANSDUCER_RESULT)
          state (hash-map "buffer" [])]
      (hash-map
        TRANSDUCER_INIT (fn [] (rf-init))
        TRANSDUCER_STEP (fn [result input]
          (let [buf (js-get state "buffer")]
            (js-call buf "push" input)
            (if (=== (js-get buf "length") n)
              (let [chunk buf]
                (js-set state "buffer" [])
                (rf-step result chunk))
              result)))
        TRANSDUCER_RESULT (fn [result]
          (let [buf (js-get state "buffer")
                res (if (> (js-get buf "length") 0)
                      (let [r (rf-step result buf)]
                        (js-set state "buffer" [])
                        r)
                      result)]
            (rf-result (if (isReduced res) (js-get res "_val") res))))))))

// composeTransducers - Compose multiple transducers left-to-right
(fn composeTransducers [& xforms]
  (if (nil? (seq xforms))
    (fn [rf] rf)
    (if (nil? (seq (rest xforms)))
      (first xforms)
      (fn [rf]
        (reduce (fn [composed xf] (xf composed))
                rf
                (reverse xforms))))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 16: ADDITIONAL STDLIB FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// frequencies - Returns a map of elements to their occurrence counts
(fn frequencies [coll]
  (reduce (fn [acc item]
    (let [cnt (or (js-get acc item) 0)]
      (js-set acc item (+ cnt 1))
      acc))
    {} coll))

// selectKeys - Returns a map containing only the specified keys
(fn selectKeys [m ks]
  (reduce (fn [acc k]
    (let [v (js-get m k)]
      (if (=== v undefined)
        acc
        (do (js-set acc k v) acc))))
    {} ks))

// mergeWith - Merge maps using a function to resolve conflicts
(fn mergeWith [f & maps]
  (reduce (fn [acc m]
    (if (nil? m)
      acc
      (let [ks (js-call Object.keys m)]
        (reduce (fn [a k]
          (let [existing (js-get a k)]
            (if (=== existing undefined)
              (js-set a k (js-get m k))
              (js-set a k (f existing (js-get m k))))
            a))
          acc ks))))
    {} maps))

// remove - Returns lazy seq of items for which pred returns falsy (complement of filter)
(fn remove [pred coll]
  (filter (fn [x] (not (pred x))) coll))

// complement - Returns a function that is the logical negation of f
(fn complement [f]
  (fn [& args] (not (apply f args))))

// memoize - Returns a memoized version of f
(fn memoize [f]
  (let [cache (js-new Map ())]
    (fn [& args]
      (let [k (js-call JSON.stringify args)]
        (if (.has cache k)
          (.get cache k)
          (let [result (apply f args)]
            (.set cache k result)
            result))))))

// notEmpty - Returns coll if it's not empty, nil otherwise
(fn notEmpty [coll]
  (if (seq coll) coll nil))

// boundedCount - Returns count up to limit n (avoids realizing entire infinite seq)
(fn boundedCount [n coll]
  (loop [i 0 s (seq coll)]
    (if (or (nil? s) (>= i n))
      i
      (recur (+ i 1) (rest s)))))

// runBang - Applies f to each item in coll for side effects, returns nil
(fn runBang [f coll]
  (reduce (fn [_ item] (f item) nil) nil coll)
  nil)

// everyPred - Returns a function that returns true when all predicates are satisfied
(fn everyPred [& preds]
  (fn [& args]
    (reduce (fn [acc pred]
      (if acc
        (reduce (fn [a2 arg] (if a2 (pred arg) false)) true args)
        false))
      true preds)))

// someFn - Returns a function that returns the first truthy predicate result
(fn someFn [& preds]
  (fn [& args]
    (reduce (fn [acc pred]
      (if acc acc
        (reduce (fn [a2 arg]
          (if a2 a2
            (let [r (pred arg)]
              (if r r nil))))
          nil args)))
      nil preds)))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 17: ADDITIONAL TRANSDUCERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// cat - Concatenation transducer (flattens one level)
(fn cat [rf]
  (let [rf-init (js-get rf TRANSDUCER_INIT)
        rf-step (js-get rf TRANSDUCER_STEP)
        rf-result (js-get rf TRANSDUCER_RESULT)]
    (hash-map
      TRANSDUCER_INIT (fn [] (rf-init))
      TRANSDUCER_STEP (fn [result input]
        (reduce (fn [acc item]
          (let [r (rf-step acc item)]
            (if (isReduced r) (reduced r) r)))
          result input))
      TRANSDUCER_RESULT (fn [result] (rf-result result)))))

// dedupe - Transducer that removes consecutive duplicates
(fn dedupe [rf]
  (let [rf-init (js-get rf TRANSDUCER_INIT)
        rf-step (js-get rf TRANSDUCER_STEP)
        rf-result (js-get rf TRANSDUCER_RESULT)
        state (js-new Object ())]
    (js-set state "prev" :__dedupe_none__)
    (hash-map
      TRANSDUCER_INIT (fn [] (rf-init))
      TRANSDUCER_STEP (fn [result input]
        (let [p (js-get state "prev")]
          (js-set state "prev" input)
          (if (=== p input)
            result
            (rf-step result input))))
      TRANSDUCER_RESULT (fn [result] (rf-result result)))))

// removeT - Transducer form of remove (complement of filterT)
(fn removeT [pred]
  (filterT (fn [x] (not (pred x)))))

// keepT - Transducer that keeps non-nil results of applying f
(fn keepT [f]
  (fn [rf]
    (let [rf-init (js-get rf TRANSDUCER_INIT)
          rf-step (js-get rf TRANSDUCER_STEP)
          rf-result (js-get rf TRANSDUCER_RESULT)]
      (hash-map
        TRANSDUCER_INIT (fn [] (rf-init))
        TRANSDUCER_STEP (fn [result input]
          (let [v (f input)]
            (if (nil? v) result (rf-step result v))))
        TRANSDUCER_RESULT (fn [result] (rf-result result))))))

// Export all functions
(export [
  // Sequence primitives (Lisp Trinity)
  first, rest, cons,

  // Indexed access & counting
  next, nth, count, second, last,

  // Sequence predicates
  isEmpty, some,

  // Sequence operations
  take, map, filter, reduce, drop, concat, flatten, distinct,

  // Map operations
  mapIndexed, keepIndexed, mapcat, keep,

  // Conditional lazy functions
  takeWhile, dropWhile, splitWith, splitAt,

  // Reduction variants
  reductions,

  // Sequence combinators
  interleave, interpose,

  // Partition family
  partition, partitionAll, partitionBy,

  // Collection protocols (self-hosted)
  seq, empty, conj, into,

  // Lazy constructors
  repeat, repeatedly, cycle,

  // Sequence predicates
  every, notAny, notEvery, isSome,

  // Map/Object operations (self-hosted)
  get, getIn, assoc, assocIn, dissoc, update, updateIn, merge,

  // Type conversions (self-hosted)
  vec, set,

  // Sequence generators
  range, iterate,

  // Function operations (self-hosted)
  comp, partial, apply,

  // Arithmetic (self-hosted)
  abs, add, sub, mul, div, mod,

  // Variadic comparison (self-hosted)
  lt, gt, lte, gte, deepEq,

  // Symbol/Keyword/Name (self-hosted)
  symbol, keyword, name,

  // Type predicates (self-hosted)
  isObject,

  // Sorting (self-hosted)
  sort, sortBy,

  // Utilities
  groupBy, keys, doall, realized, lazySeq,

  // Function utilities
  identity, constantly, vals, juxt, zipmap,

  // Delay/Force (explicit laziness)
  force, isDelay, realized,

  // Transducers (self-hosted)
  mapT, filterT, takeT, dropT, takeWhileT, dropWhileT,
  distinctT, partitionAllT, composeTransducers,

  // Additional stdlib functions
  frequencies, selectKeys, mergeWith, remove, complement,
  memoize, notEmpty, boundedCount, runBang, everyPred, someFn,

  // Additional transducers
  cat, dedupe, removeT, keepT
])
