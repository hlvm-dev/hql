;; lib/stdlib/stdlib.hql - HQL stdlib with self-hosted functions
;;
;; SELF-HOSTED FUNCTIONS:
;; Phase 1 - Core Sequence Operations:
;; - take: Returns first n elements from a collection (lazy)
;; - drop: Drops first n elements from a collection (lazy)
;; - map: Maps function over collection (lazy)
;; - filter: Filters collection by predicate (lazy)
;; - reduce: Reduces collection with function and initial value (EAGER)
;; - concat: Concatenates multiple collections (lazy)
;; - flatten: Flattens nested collections (lazy)
;; - distinct: Removes duplicate elements (lazy)
;;
;; Phase 2 - Indexed Operations:
;; - next: Returns seq of rest, or nil if empty (same as (seq (rest coll)))
;; - second: Returns second element (same as (nth coll 1 nil))
;; - nth: Returns element at index with optional not-found
;; - count: Returns count of elements (EAGER)
;; - last: Returns last element (EAGER)
;;
;; Phase 3 - Map Operations:
;; - mapIndexed: Maps (index, item) over collection (lazy)
;; - keepIndexed: Like mapIndexed but filters nil results (lazy)
;; - mapcat: Maps then flattens one level (lazy)
;; - keep: Maps and filters nil results (lazy)
;;
;; The self-hosted approach:
;; - Import primitive functions from JS (first, rest, cons, seq, lazy-seq)
;; - Build higher-level functions in HQL using those primitives
;; - This is TRUE self-hosting: HQL code that gets transpiled

;; Import primitive functions from JavaScript (the foundation)
(import [
  ;; Sequence primitives (Lisp Trinity) - these are the foundation
  first, rest, cons, seq,

  ;; NOTE: nth, count, second, last, next are NOW SELF-HOSTED BELOW!

  ;; Sequence predicates
  isEmpty, some,

  ;; Sequence operations (NOT take/drop/map/filter/reduce/concat/flatten/distinct - those are self-hosted below!)

  ;; NOTE: mapIndexed, keepIndexed, mapcat, keep are NOW SELF-HOSTED BELOW!

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
  groupBy, keys, doall, realized, lazySeq,

  ;; Delay/Force primitives (explicit laziness)
  force, isDelay
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

;; map - Maps function over collection (lazy)
;; This is the heart of functional programming
;; Pattern: (lazy-seq (when-let [s (seq coll)] (cons (f (first s)) (map f (rest s)))))
(fn map [f coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (cons (f (first s)) (map f (rest s))))))

;; filter - Filters collection by predicate (lazy)
;; Only includes elements where (pred elem) is truthy
;; Pattern: skip non-matching elements recursively until we find one
(fn filter [pred coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (let [f (first s)]
        (if (pred f)
          (cons f (filter pred (rest s)))
          (filter pred (rest s)))))))

;; reduce - Reduces collection with function and initial value (EAGER)
;; This is the foundation of many aggregate operations
;; Unlike map/filter, reduce consumes the entire collection
(fn reduce [f init coll]
  (loop [acc init, s (seq coll)]
    (if s
      (recur (f acc (first s)) (rest s))
      acc)))

;; concat - Concatenates multiple collections (lazy)
;; Variadic function: (concat [1 2] [3 4]) => (1 2 3 4)
;; Processes collections one element at a time
(fn concat [& colls]
  (lazy-seq
    (when-let [cs (seq colls)]
      (if-let [s (seq (first cs))]
        (cons (first s) (apply concat (cons (rest s) (rest cs))))
        (apply concat (rest cs))))))

;; flatten - Flattens nested collections (lazy)
;; Recursively flattens all iterable items (except strings)
;; Note: Uses JS interop for iterable checking in pre-transpiled version
(fn flatten [coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (let [f (first s)]
        (if (coll? f)  ;; coll? checks for collections (arrays, seqs) but not strings
          (concat (flatten f) (flatten (rest s)))
          (cons f (flatten (rest s))))))))

;; distinct - Removes duplicate elements (lazy)
;; Uses a Set to track seen elements efficiently
;; Note: Pre-transpiled version uses JS Set for O(1) lookup
(fn distinct [coll]
  (let [step (fn [s seen]
               (lazy-seq
                 (when-let [xs (seq s)]
                   (let [f (first xs)]
                     (if (contains? seen f)
                       (step (rest xs) seen)
                       (cons f (step (rest xs) (conj seen f))))))))]
    (step coll #[])))

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 2: INDEXED OPERATIONS
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; next - Returns (seq (rest coll)), nil if rest is empty
;; This is the Clojure-style "next" that differs from "rest"
;; next returns nil for empty, rest returns empty seq
(fn next [coll]
  (seq (rest coll)))

;; nth - Returns element at index, with optional not-found value
;; Uses loop to iterate to the index position
;; Throws error if out of bounds and no not-found provided
;; Note: Uses (seq args) instead of (count args) to avoid circular dependency
(fn nth [coll index & args]
  (let [not-found (first args)
        has-not-found (seq args)]  ;; truthy if args is non-empty
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

;; second - Returns second element of collection
;; Simply (nth coll 1 nil) - returns nil if less than 2 elements
(fn second [coll]
  (nth coll 1 nil))

;; count - Returns count of elements (EAGER)
;; Forces full realization of lazy sequences
(fn count [coll]
  (if (nil? coll)
    0
    (loop [s (seq coll), n 0]
      (if s
        (recur (rest s) (+ n 1))
        n))))

;; last - Returns last element (EAGER)
;; Forces full realization to find the last element
(fn last [coll]
  (if (nil? coll)
    nil
    (loop [s (seq coll), result nil]
      (if s
        (recur (rest s) (first s))
        result))))

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 3: MAP OPERATIONS
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; mapIndexed - Maps function (index, item) over collection (lazy)
;; Like map but the function receives (index, item) instead of just (item)
(fn mapIndexed [f coll]
  (let [step (fn [s idx]
               (lazy-seq
                 (when-let [xs (seq s)]
                   (cons (f idx (first xs))
                         (step (rest xs) (+ idx 1))))))]
    (step coll 0)))

;; keepIndexed - Like mapIndexed but filters nil results (lazy)
;; Only keeps results where (f index item) is not nil/undefined
(fn keepIndexed [f coll]
  (let [step (fn [s idx]
               (lazy-seq
                 (when-let [xs (seq s)]
                   (let [result (f idx (first xs))]
                     (if (some? result)
                       (cons result (step (rest xs) (+ idx 1)))
                       (step (rest xs) (+ idx 1)))))))]
    (step coll 0)))

;; mapcat - Maps function then concatenates/flattens one level (lazy)
;; Equivalent to (apply concat (map f coll))
(fn mapcat [f coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (concat (f (first s)) (mapcat f (rest s))))))

;; keep - Maps function and filters nil results (lazy)
;; Only keeps results where (f item) is not nil/undefined
(fn keep [f coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (let [result (f (first s))]
        (if (some? result)
          (cons result (keep f (rest s)))
          (keep f (rest s)))))))

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 3B: CONDITIONAL LAZY FUNCTIONS
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; takeWhile - Returns elements while predicate is true (lazy)
;; Clojure: (take-while pos? [1 2 3 0 -1]) => (1 2 3)
(fn takeWhile [pred coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (let [f (first s)]
        (when (pred f)
          (cons f (takeWhile pred (rest s))))))))

;; dropWhile - Drops elements while predicate is true (lazy)
;; Clojure: (drop-while pos? [1 2 3 0 -1 2]) => (0 -1 2)
(fn dropWhile [pred coll]
  (lazy-seq
    (loop [s (seq coll)]
      (if (and s (pred (first s)))
        (recur (rest s))
        (when s
          (cons (first s) (rest s)))))))

;; splitWith - Returns [(takeWhile pred coll) (dropWhile pred coll)]
(fn splitWith [pred coll]
  [(doall (takeWhile pred coll)) (doall (dropWhile pred coll))])

;; splitAt - Returns [(take n coll) (drop n coll)]
(fn splitAt [n coll]
  [(doall (take n coll)) (doall (drop n coll))])

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 3C: REDUCTION VARIANTS
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; reductions - Returns lazy seq of intermediate reduce values
;; Clojure: (reductions + [1 2 3 4]) => (1 3 6 10)
;; Clojure: (reductions + 0 [1 2 3]) => (0 1 3 6)
(fn reductions [f & args]
  (let [reductions-with-init
        (fn reductions-with-init [f init coll]
          (cons init
                (lazy-seq
                  (when-let [s (seq coll)]
                    (reductions-with-init f (f init (first s)) (rest s))))))]
    (if (=== (count args) 1)
      ;; 2-arity: (reductions f coll)
      (let [coll (first args)]
        (lazy-seq
          (when-let [s (seq coll)]
            (reductions-with-init f (first s) (rest s)))))
      ;; 3-arity: (reductions f init coll)
      (reductions-with-init f (first args) (second args)))))

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 3D: SEQUENCE COMBINATORS
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; interpose - Inserts separator between elements (lazy)
;; Example: (interpose "x" [1 2 3]) => (1 "x" 2 "x" 3)
(fn interpose [sep coll]
  (let [interpose-rest
        (fn interpose-rest [sep coll]
          (lazy-seq
            (when-let [s (seq coll)]
              (cons sep (cons (first s) (interpose-rest sep (rest s)))))))]
    (lazy-seq
      (when-let [s (seq coll)]
        (cons (first s) (interpose-rest sep (rest s)))))))

;; interleave - Interleaves multiple sequences (lazy)
;; Example: (interleave [1 2 3] ["a" "b" "c"]) => (1 "a" 2 "b" 3 "c")
(fn interleave [& colls]
  (lazy-seq
    (let [seqs (map seq colls)]
      (when (every some? seqs)
        (concat (map first seqs)
                (apply interleave (map rest seqs)))))))

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 3E: PARTITION FAMILY
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; partition - Partitions into groups of n, drops incomplete (lazy)
;; 2-arity: (partition n coll) - step defaults to n
;; 3-arity: (partition n step coll) - explicit step
;; Clojure: (partition 3 [1 2 3 4 5 6 7]) => ((1 2 3) (4 5 6))
(fn partition [n & args]
  (let [arg-count (count args)
        step (if (=== arg-count 1) n (first args))
        coll (if (=== arg-count 1) (first args) (second args))]
    (lazy-seq
      (when-let [s (seq coll)]
        (let [p (doall (take n s))]
          (when (=== (count p) n)
            (cons p (partition n step (drop step s)))))))))

;; partitionAll - Like partition but includes incomplete final group (lazy)
;; Clojure: (partition-all 3 [1 2 3 4 5 6 7]) => ((1 2 3) (4 5 6) (7))
(fn partitionAll [n & args]
  (let [arg-count (count args)
        step (if (=== arg-count 1) n (first args))
        coll (if (=== arg-count 1) (first args) (second args))]
    (lazy-seq
      (when-let [s (seq coll)]
        (let [p (doall (take n s))]
          (cons p (partitionAll n step (drop step s))))))))

;; partitionBy - Partitions when function result changes (lazy)
;; Clojure: (partition-by odd? [1 1 2 2 3]) => ((1 1) (2 2) (3))
(fn partitionBy [f coll]
  (lazy-seq
    (when-let [s (seq coll)]
      (let [fst (first s)
            fv (f fst)
            run (doall (cons fst (takeWhile (fn [x] (=== (f x) fv)) (rest s))))]
        (cons run (partitionBy f (drop (count run) s)))))))

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 4: PREDICATES
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; isEmpty - Tests if collection is empty
;; Returns true if nil or empty, false otherwise
(fn isEmpty [coll]
  (nil? (seq coll)))

;; some - Returns first item where predicate returns truthy, or nil
;; Short-circuits on first match
(fn some [pred coll]
  (loop [s (seq coll)]
    (if s
      (if (pred (first s))
        (first s)
        (recur (rest s)))
      nil)))

;; every - Returns true if predicate returns truthy for all items
;; Short-circuits on first falsy, empty collection returns true (vacuous truth)
(fn every [pred coll]
  (loop [s (seq coll)]
    (if s
      (if (pred (first s))
        (recur (rest s))
        false)
      true)))

;; notAny - Returns true if predicate returns false for all items
;; Equivalent to (not (some pred coll))
(fn notAny [pred coll]
  (loop [s (seq coll)]
    (if s
      (if (pred (first s))
        false
        (recur (rest s)))
      true)))

;; notEvery - Returns true if predicate returns false for at least one item
;; Equivalent to (not (every pred coll))
(fn notEvery [pred coll]
  (loop [s (seq coll)]
    (if s
      (if (pred (first s))
        (recur (rest s))
        true)
      false)))

;; isSome - Returns true if value is not nil (null or undefined)
;; Note: This only checks for nil, not falsiness (0, false, "" return true)
(fn isSome [x]
  (not (nil? x)))

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 5: TYPE PREDICATES
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 6: ARITHMETIC
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(fn inc [x] (+ x 1))
(fn dec [x] (- x 1))

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 7: COMPARISON
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 8: LAZY CONSTRUCTORS
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; repeat - Infinite sequence of the same value
(fn repeat [x]
  (lazy-seq (cons x (repeat x))))

;; repeatedly - Infinite sequence calling f each time
(fn repeatedly [f]
  (lazy-seq (cons (f) (repeatedly f))))

;; cycle - Infinite sequence cycling through collection
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

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 9: FUNCTION OPERATIONS
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; iterate - Returns x, f(x), f(f(x)), ...
(fn iterate [f x]
  (lazy-seq (cons x (iterate f (f x)))))

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 10: UTILITIES
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; keys - Get keys from an object
(fn keys [obj]
  (if (nil? obj)
    []
    (js-call Object.keys obj)))

;; reverse - Reverse a collection
(fn reverse [coll]
  (if (nil? coll)
    []
    (.. (js-call Array.from coll) (reverse))))

;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
;; PHASE 11: FUNCTION UTILITIES
;; ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

;; identity - Returns its argument unchanged
(fn identity [x] x)

;; constantly - Returns a function that always returns x
(fn constantly [x]
  (fn [& _] x))

;; vals - Get values from an object/map
(fn vals [m]
  (if (nil? m)
    []
    (js-call Object.values m)))

;; juxt - Juxtaposition: returns fn that calls all fns on same args
(fn juxt [& fns]
  (fn [& args]
    (map (fn [f] (apply f args)) fns)))

;; zipmap - Create map from keys and values
(fn zipmap [ks vs]
  (loop [keys (seq ks) values (seq vs) result {}]
    (if (and keys values)
      (recur (next keys) (next values)
             (assoc result (first keys) (first values)))
      result)))

;; Export all functions
(export [
  ;; Sequence primitives (Lisp Trinity)
  first, rest, cons,

  ;; Indexed access & counting (Phase 2 self-hosted)
  next, nth, count, second, last,

  ;; Sequence predicates
  isEmpty, some,

  ;; Sequence operations
  take, map, filter, reduce, drop, concat, flatten, distinct,

  ;; Map operations (Phase 3 self-hosted)
  mapIndexed, keepIndexed, mapcat, keep,

  ;; Conditional lazy functions (Phase 3B)
  takeWhile, dropWhile, splitWith, splitAt,

  ;; Reduction variants (Phase 3C)
  reductions,

  ;; Sequence combinators (Phase 3D)
  interleave, interpose,

  ;; Partition family (Phase 3E)
  partition, partitionAll, partitionBy,

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
  groupBy, keys, doall, realized, lazySeq,

  ;; Function utilities (Phase 11)
  identity, constantly, vals, juxt, zipmap,

  ;; Delay/Force (explicit laziness)
  ;; Note: 'delay' is a special form, not a function
  force, isDelay
])
