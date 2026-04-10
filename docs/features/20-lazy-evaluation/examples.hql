// ============================================
// Lazy Evaluation Examples
// ============================================

(import [assert] from "@hlvm/assert")

// --------------------------------------------
// Example 1: Basic cons cells
// --------------------------------------------

(let my-list (cons 1 (cons 2 (cons 3 null))))
(assert (=== (first my-list) 1) "first of cons list")
(assert (=== (first (rest my-list)) 2) "second of cons list")
(assert (=== (first (rest (rest my-list))) 3) "third of cons list")
(print "cons list:" my-list)

// --------------------------------------------
// Example 2: seq conversion
// --------------------------------------------

(let arr-seq (seq [10 20 30]))
(assert (=== (first arr-seq) 10) "first of array seq")
(assert (=== (first (rest arr-seq)) 20) "second of array seq")

// nil-punning: empty collections return null
(assert (=== (seq []) null) "empty array seq is null")
(assert (=== (seq null) null) "null seq is null")
(print "seq conversion works")

// --------------------------------------------
// Example 3: Lazy sequences
// --------------------------------------------

(var eval-count 0)

(let lazy-nums (lazy-seq
  (= eval-count (+ eval-count 1))
  (cons 1 (lazy-seq
    (= eval-count (+ eval-count 1))
    (cons 2 (lazy-seq
      (= eval-count (+ eval-count 1))
      (cons 3 null)))))))

// Nothing evaluated yet
(assert (=== eval-count 0) "lazy: nothing evaluated yet")

// Access first element
(let first-val (first lazy-nums))
(assert (=== first-val 1) "lazy first")
(assert (=== eval-count 1) "lazy: only first thunk evaluated")

// Access all elements
(let second-val (first (rest lazy-nums)))
(let third-val (first (rest (rest lazy-nums))))
(assert (=== second-val 2) "lazy second")
(assert (=== third-val 3) "lazy third")
(print "lazy evaluation verified, eval-count:" eval-count)

// --------------------------------------------
// Example 4: Infinite range
// --------------------------------------------

(let first-10 (into [] (take 10 (range))))
(assert (=== first-10.length 10) "take 10 from infinite range")
(assert (=== (get first-10 0) 0) "range starts at 0")
(assert (=== (get first-10 9) 9) "10th element is 9")
(print "first 10 naturals:" first-10)

// --------------------------------------------
// Example 5: range with start/end/step
// --------------------------------------------

(let evens (into [] (range 0 20 2)))
(assert (=== evens.length 10) "10 even numbers")
(assert (=== (get evens 0) 0) "first even")
(assert (=== (get evens 9) 18) "last even")
(print "evens 0-18:" evens)

// --------------------------------------------
// Example 6: repeat and cycle
// --------------------------------------------

(let repeated (into [] (take 4 (repeatedly (fn [] "ha")))))
(assert (=== repeated.length 4) "repeatedly 4 times")
(assert (=== (get repeated 0) "ha") "repeated value")
(print "repeatedly:" repeated)  // => ["ha", "ha", "ha", "ha"]

(let cycled (into [] (take 7 (cycle [1 2 3]))))
(assert (=== cycled.length 7) "cycle 7 from [1,2,3]")
(assert (=== (get cycled 6) 1) "cycle wraps around")
(print "cycle:" cycled)  // => [1, 2, 3, 1, 2, 3, 1]

// --------------------------------------------
// Example 7: iterate
// --------------------------------------------

(let powers-of-2 (into [] (take 8 (iterate (fn [x] (* x 2)) 1))))
(assert (=== (get powers-of-2 0) 1) "2^0 = 1")
(assert (=== (get powers-of-2 7) 128) "2^7 = 128")
(print "powers of 2:" powers-of-2)  // => [1, 2, 4, 8, 16, 32, 64, 128]

// --------------------------------------------
// Example 8: Lazy map and filter
// --------------------------------------------

(let squares (into [] (take 5 (map (fn [x] (* x x)) (range 1 100)))))
(assert (=== squares.length 5) "took 5 squares")
(assert (=== (get squares 4) 25) "5th square is 25")
(print "first 5 squares:" squares)  // => [1, 4, 9, 16, 25]

(let odd-squares (into [] (take 5
  (filter isOdd (map (fn [x] (* x x)) (range 1 100))))))
(assert (=== (get odd-squares 0) 1) "first odd square")
(assert (=== (get odd-squares 4) 81) "fifth odd square")
(print "first 5 odd squares:" odd-squares)  // => [1, 9, 25, 49, 81]

// --------------------------------------------
// Example 9: delay/force/realized
// --------------------------------------------

(var computed false)
(let delayed (delay
  (= computed true)
  42))

(assert (=== (realized delayed) false) "not yet realized")
(assert (=== computed false) "not yet computed")

(let result (force delayed))
(assert (=== result 42) "forced value is 42")
(assert (=== computed true) "now computed")
(assert (=== (realized delayed) true) "now realized")

// force again returns cached value
(let result2 (force delayed))
(assert (=== result2 42) "cached value")
(print "delay/force works correctly")

// --------------------------------------------
// Example 10: Partition family
// --------------------------------------------

(let grouped (into [] (partition 3 [1 2 3 4 5 6 7 8 9])))
(assert (=== grouped.length 3) "3 groups of 3")
(print "partition 3:" grouped)  // => [[1,2,3], [4,5,6], [7,8,9]]

(let grouped-all (into [] (partitionAll 3 [1 2 3 4 5 6 7])))
(assert (=== grouped-all.length 3) "3 groups including remainder")
(print "partitionAll 3:" grouped-all)  // => [[1,2,3], [4,5,6], [7]]

(let by-parity (into [] (partitionBy isOdd [1 3 2 4 5])))
(assert (=== by-parity.length 3) "3 parity groups")
(print "partitionBy odd:" by-parity)  // => [[1,3], [2,4], [5]]

// --------------------------------------------
// Example 11: Practical - Fibonacci sequence
// --------------------------------------------

(fn fib-seq [a b]
  (lazy-seq (cons a (fib-seq b (+ a b)))))

(let fibs (into [] (take 10 (fib-seq 0 1))))
(assert (=== (get fibs 9) 34) "10th fibonacci is 34")
(print "fibonacci:" fibs)  // => [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]

// --------------------------------------------
// Example 12: Practical - Sieve of Eratosthenes
// --------------------------------------------

(fn sieve [s]
  (lazy-seq
    (let p (first s))
    (cons p (sieve (filter (fn [x] (!== (% x p) 0)) (rest s))))))

(let primes (into [] (take 10 (sieve (range 2 1000)))))
(assert (=== (get primes 0) 2) "first prime")
(assert (=== (get primes 9) 29) "10th prime")
(print "first 10 primes:" primes)  // => [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]

(print "All lazy evaluation examples passed!")
