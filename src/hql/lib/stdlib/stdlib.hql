// lib/stdlib/stdlib.hql - HQL stdlib with self-hosted functions
//
// ~91% of stdlib is self-hosted in HQL. Only sequence primitives,
// lazy-seq constructor, and a few hot-path utilities remain as JS imports.
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

  // Utilities that remain as JS imports:
  // - groupBy: uses Map protocol internally
  // - realized: checks LazySeq/Delay internal fields
  // - force/isDelay: Delay class protocol
  groupBy, realized, force, isDelay
] from "./js/core.js")

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
// Note: Uses iterative skip + cons to ensure seq-protocol compatibility
(fn drop [n coll]
  (lazy-seq
    (loop [s (seq coll) remaining n]
      (if (and s (> remaining 0))
        (recur (rest s) (- remaining 1))
        (when s
          (cons (first s) (drop 0 (rest s))))))))

// map - Maps function over collection (lazy)
// This is the heart of functional programming
// Pattern: (lazy-seq (when-let [s (seq coll)] (cons (f (first s)) (map f (rest s)))))
(fn map [f coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (cons (f (first s)) (map f (rest s))))))

// filter - Filters collection by predicate (lazy)
// Only includes elements where (pred elem) is truthy
// Pattern: skip non-matching elements recursively until we find one
(fn filter [pred coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (let [f (first s)]
        (if (pred f)
          (cons f (filter pred (rest s)))
          (filter pred (rest s)))))))

// reduce - Reduces collection with function and initial value (EAGER)
// This is the foundation of many aggregate operations
// Unlike map/filter, reduce consumes the entire collection
(fn reduce [f init coll]
  (loop [acc init, s (seq coll)]
    (if s
      (recur (f acc (first s)) (rest s))
      acc)))

// concat - Concatenates multiple collections (lazy)
// Variadic function: (concat [1 2] [3 4]) => (1 2 3 4)
// Processes collections one element at a time
(fn concat [& colls]
  (lazy-seq
    (when-let [cs (seq colls)]
      (if-let [s (seq (first cs))]
        (cons (first s) (apply concat (cons (rest s) (rest cs))))
        (apply concat (rest cs))))))

// flatten - Flattens nested collections (lazy)
// Recursively flattens all iterable items (except strings)
// Note: Uses JS interop for iterable checking in pre-transpiled version
(fn flatten [coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (let [f (first s)]
        (if (and (not (nil? f)) (not (isString f)) (or (isArray f) (seq f)))  // collection check: not nil, not string, array or seqable
          (concat (flatten f) (flatten (rest s)))
          (cons f (flatten (rest s))))))))

// distinct - Removes duplicate elements (lazy)
// Uses a Set to track seen elements efficiently
// Note: Pre-transpiled version uses JS Set for O(1) lookup
(fn distinct [coll]
  (let [step (fn [s seen]
               (lazy-seq
                 (when-let [xs (seq s)]
                   (let [f (first xs)]
                     (if (.has seen f)
                       (step (rest xs) seen)
                       (cons f (step (rest xs) (conj seen f))))))))]
    (step coll #[])))

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
  (let [not-found (first args)
        has-not-found (seq args)]  // truthy if args is non-empty
    (if (nil? coll)
      (if has-not-found
        not-found
        (throw (js/Error (str "nth: index " index " out of bounds for null collection"))))
      (loop [s (seq coll), i 0]
        (if s
          (if (=== i index)
            (first s)
            (recur (rest s) (+ i 1)))
          (if has-not-found
            not-found
            (throw (js/Error (str "nth: index " index " out of bounds")))))))))

// second - Returns second element of collection
// Simply (nth coll 1 nil) - returns nil if less than 2 elements
(fn second [coll]
  (nth coll 1 nil))

// count - Returns count of elements (EAGER)
// Forces full realization of lazy sequences
(fn count [coll]
  (if (nil? coll)
    0
    (loop [s (seq coll), n 0]
      (if s
        (recur (rest s) (+ n 1))
        n))))

// last - Returns last element (EAGER)
// Forces full realization to find the last element
(fn last [coll]
  (if (nil? coll)
    nil
    (loop [s (seq coll), result nil]
      (if s
        (recur (rest s) (first s))
        result))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 3: MAP OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// mapIndexed - Maps function (index, item) over collection (lazy)
// Like map but the function receives (index, item) instead of just (item)
(fn mapIndexed [f coll]
  (let [step (fn [s idx]
               (lazy-seq
                 (when-let [xs (seq s)]
                   (cons (f idx (first xs))
                         (step (rest xs) (+ idx 1))))))]
    (step coll 0)))

// keepIndexed - Like mapIndexed but filters nil results (lazy)
// Only keeps results where (f index item) is not nil/undefined
(fn keepIndexed [f coll]
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
        (recur (rest s))
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
    (if (=== (count args) 1)
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
  (lazy-seq
    (let [seqs (map seq colls)]
      (when (every isSome seqs)
        (concat (map first seqs)
                (apply interleave (map rest seqs)))))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 3E: PARTITION FAMILY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// partition - Partitions into groups of n, drops incomplete (lazy)
// 2-arity: (partition n coll) - step defaults to n
// 3-arity: (partition n step coll) - explicit step
// Clojure: (partition 3 [1 2 3 4 5 6 7]) => ((1 2 3) (4 5 6))
(fn partition [n & args]
  (let [arg-count (count args)
        step (if (=== arg-count 1) n (first args))
        coll (if (=== arg-count 1) (first args) (second args))]
    (lazy-seq
      (when-let [s (seq coll)]
        (let [p (doall (take n s))]
          (when (=== (count p) n)
            (cons p (partition n step (drop step s)))))))))

// partitionAll - Like partition but includes incomplete final group (lazy)
// Clojure: (partition-all 3 [1 2 3 4 5 6 7]) => ((1 2 3) (4 5 6) (7))
(fn partitionAll [n & args]
  (let [arg-count (count args)
        step (if (=== arg-count 1) n (first args))
        coll (if (=== arg-count 1) (first args) (second args))]
    (lazy-seq
      (when-let [s (seq coll)]
        (let [p (doall (take n s))]
          (cons p (partitionAll n step (drop step s))))))))

// partitionBy - Partitions when function result changes (lazy)
// Clojure: (partition-by odd? [1 1 2 2 3]) => ((1 1) (2 2) (3))
(fn partitionBy [f coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (let [fst (first s)
            fv (f fst)
            run (doall (cons fst (takeWhile (fn [x] (=== (f x) fv)) (rest s))))]
        (cons run (partitionBy f (drop (count run) s)))))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 4: PREDICATES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// isEmpty - Tests if collection is empty
// Returns true if nil or empty, false otherwise
(fn isEmpty [coll]
  (nil? (seq coll)))

// some - Returns first item where predicate returns truthy, or nil
// Short-circuits on first match
(fn some [pred coll]
  (loop [s (seq coll)]
    (if s
      (if (pred (first s))
        (first s)
        (recur (rest s)))
      nil)))

// every - Returns true if predicate returns truthy for all items
// Short-circuits on first falsy, empty collection returns true (vacuous truth)
(fn every [pred coll]
  (loop [s (seq coll)]
    (if s
      (if (pred (first s))
        (recur (rest s))
        false)
      true)))

// notAny - Returns true if predicate returns false for all items
// Equivalent to (not (some pred coll))
(fn notAny [pred coll]
  (loop [s (seq coll)]
    (if s
      (if (pred (first s))
        false
        (recur (rest s)))
      true)))

// notEvery - Returns true if predicate returns false for at least one item
// Equivalent to (not (every pred coll))
(fn notEvery [pred coll]
  (loop [s (seq coll)]
    (if s
      (if (pred (first s))
        (recur (rest s))
        true)
      false)))

// isSome - Returns true if value is not nil (null or undefined)
// Note: This only checks for nil, not falsiness (0, false, "" return true)
(fn isSome [x]
  (not (nil? x)))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 5: TYPE PREDICATES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(fn isNil [x] (nil? x))
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
// PHASE 6: ARITHMETIC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(fn inc [x] (+ x 1))
(fn dec [x] (- x 1))
(fn abs [x] (js-call Math.abs x))

// Variadic arithmetic with identity semantics
(fn add [& nums] (reduce (fn [a b] (+ a b)) 0 nums))
(fn sub [& nums]
  (if (=== (count nums) 0)
    0
    (if (=== (count nums) 1)
      (- 0 (first nums))
      (reduce (fn [a b] (- a b)) (first nums) (rest nums)))))
(fn mul [& nums] (reduce (fn [a b] (* a b)) 1 nums))
(fn div [& nums]
  (if (=== (count nums) 0)
    1
    (if (=== (count nums) 1)
      (/ 1 (first nums))
      (reduce (fn [a b] (/ a b)) (first nums) (rest nums)))))
(fn mod [a b] (% a b))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 7: COMPARISON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(fn eq [& vals]
  (if (< (count vals) 2)
    true
    (let [fst (first vals)]
      (loop [s (rest vals)]
        (if (seq s)
          (if (=== fst (first s))
            (recur (rest s))
            false)
          true)))))

(fn neq [a b] (not (=== a b)))

// Variadic chained comparison: (lt a b c) means a<b AND b<c
(fn lt [& nums]
  (loop [s (seq nums)]
    (if (and s (seq (rest s)))
      (if (< (first s) (first (rest s)))
        (recur (rest s))
        false)
      true)))

(fn gt [& nums]
  (loop [s (seq nums)]
    (if (and s (seq (rest s)))
      (if (> (first s) (first (rest s)))
        (recur (rest s))
        false)
      true)))

(fn lte [& nums]
  (loop [s (seq nums)]
    (if (and s (seq (rest s)))
      (if (<= (first s) (first (rest s)))
        (recur (rest s))
        false)
      true)))

(fn gte [& nums]
  (loop [s (seq nums)]
    (if (and s (seq (rest s)))
      (if (>= (first s) (first (rest s)))
        (recur (rest s))
        false)
      true)))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 7B: SYMBOL/KEYWORD/NAME
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// symbol - Create symbol from string
(fn symbol [n] (js-call String n))

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
    (let [s (js-call String x)]
      (if (js-call s "startsWith" ":")
        (js-call s "slice" 1)
        s))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 8: LAZY CONSTRUCTORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// repeat - Infinite sequence of the same value
(fn repeat [x]
  (lazy-seq (cons x (repeat x))))

// repeatedly - Infinite sequence calling f each time
(fn repeatedly [f]
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
  (lazy-seq (cons x (iterate f (f x)))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 10: UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// keys - Get keys from an object
(fn keys [obj]
  (if (nil? obj)
    []
    (js-call Object.keys obj)))

// reverse - Reverse a collection
(fn reverse [coll]
  (if (nil? coll)
    []
    (.. (js-call Array.from coll) (reverse))))

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
(fn getIn [m path & args]
  (let [not-found (first args)]
    (if (=== (js-get path "length") 0)
      m
      (loop [current m, s (seq path)]
        (if s
          (let [next-val (get current (first s) nil)]
            (if (nil? next-val)
              not-found
              (recur next-val (seq (rest s)))))
          current)))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 13: MAP MUTATIONS (immutable, self-hosted)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// assoc - Associate key with value (returns new map/array)
(fn assoc [m key value]
  (if (nil? m)
    (if (=== (typeof key) "number")
      [value]
      {key value})
    (if (instanceof m Map)
      (let [r (js-new Map (m))]
        (js-call r "set" key value)
        r)
      (if (js-call Array.isArray m)
        (let [r [...m]]
          (js-set r key value)
          r)
        {...m, key value}))))

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

// dissoc - Remove keys from map (returns new map)
(fn dissoc [m & ks]
  (if (nil? m)
    {}
    (if (instanceof m Map)
      (let [r (js-new Map (m))]
        (reduce (fn [acc k] (js-call acc "delete" k) acc) r ks))
      (let [r {...m}]
        (reduce (fn [acc k] (delete (js-get acc k)) acc) r ks)))))

// update - Transform value at key with function
(fn update [m key f]
  (assoc m key (f (get m key))))

// updateIn - Transform value at nested path with function
(fn updateIn [m path f]
  (if (=== (js-get path "length") 0)
    (f m)
    (assocIn m path (f (getIn m path)))))

// merge - Merge multiple maps (later wins, shallow)
(fn merge [& maps]
  (let [non-nil (filter (fn [m] (not (nil? m))) maps)]
    (if (isEmpty non-nil)
      {}
      (js-call Object.assign {} ...non-nil))))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 14: COLLECTION PROTOCOLS (self-hosted)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// empty - Return empty collection of same type
(fn empty [coll]
  (if (nil? coll)
    nil
    (if (js-call Array.isArray coll) []
      (if (=== (typeof coll) "string") ""
        (if (instanceof coll Set) (js-new Set ())
          (if (instanceof coll Map) (js-new Map ())
            (if (=== (typeof coll) "object") {}
              nil)))))))

// conj - Add item(s) to collection (type-preserving)
(fn conj [coll & items]
  (if (=== (count items) 0)
    (if (nil? coll) [] coll)
    (if (nil? coll)
      [...items]
      (if (js-call Array.isArray coll)
        [...coll ...items]
        (if (instanceof coll Set)
          (let [r (js-new Set (coll))]
            (reduce (fn [acc item] (js-call acc "add" item) acc) r items))
          (if (instanceof coll Map)
            (let [r (js-new Map (coll))]
              (reduce (fn [acc item] (js-call acc "set" (js-get item 0) (js-get item 1)) acc) r items))
            (reduce (fn [acc item] (js-set acc (js-get item 0) (js-get item 1)) acc)
                    {...coll} items)))))))

// into - Pour collection into target
(fn into [to from]
  (if (nil? from)
    (if (nil? to) [] to)
    (if (nil? to)
      (js-call Array.from from)
      (if (js-call Array.isArray to)
        (let [arr [...to]]
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
  (if (=== (count fns) 0)
    (fn [x] x)
    (if (=== (count fns) 1)
      (first fns)
      (fn [& args]
        (let [reversed (reverse fns)
              init-result (apply (first reversed) args)]
          (reduce (fn [result f] (f result)) init-result (rest reversed)))))))

// partial - Partial function application
(fn partial [f & args]
  (fn [& more-args]
    (apply f (concat args more-args))))

// apply - Apply function to args collection
(fn apply [f args]
  (let [arr (if (js-call Array.isArray args) args (js-call Array.from args))]
    (js-call f "apply" nil arr)))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 17: SORTING (self-hosted)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// sort - Sort collection with optional comparator
(fn sort [& args]
  (if (=== (count args) 1)
    // Single arg: sort by natural order
    (let [arr (if (nil? (first args)) [] (js-call Array.from (first args)))]
      (js-call arr "sort" (fn [a b] (if (< a b) -1 (if (> a b) 1 0)))))
    // Two args: first is comparator
    (let [comp (first args)
          arr (if (nil? (second args)) [] (js-call Array.from (second args)))]
      (js-call arr "sort" comp))))

// sortBy - Sort collection by key function with optional comparator
(fn sortBy [keyfn & args]
  (if (=== (count args) 1)
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
  lt, gt, lte, gte,

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
  force, isDelay
])
