// ============================================
// Async & Generator Examples
// ============================================

(import [assert] from "@hlvm/assert")

// --------------------------------------------
// Example 1: Basic async function
// --------------------------------------------

(async fn delay [ms]
  (await (new Promise (fn [resolve]
    (setTimeout resolve ms)))))

(async fn greet-delayed [name ms]
  (await (delay ms))
  (+ "Hello, " name "!"))

// (let greeting (await (greet-delayed "World" 100)))
// (print greeting)  // => "Hello, World!"

// --------------------------------------------
// Example 2: Async error handling
// --------------------------------------------

(async fn safe-fetch [url]
  (try
    (let response (await (js/fetch url)))
    (await (.json response))
    (catch e
      null)))

// --------------------------------------------
// Example 3: Basic generator
// --------------------------------------------

(fn* range-gen [start end]
  (var i start)
  (while (< i end)
    (yield i)
    (= i (+ i 1))))

// Consume generator
(let values [])
(for-of [n (range-gen 1 6)]
  (.push values n))
(assert (=== values.length 5) "generator produced 5 values")
(assert (=== (get values 0) 1) "first value is 1")
(assert (=== (get values 4) 5) "last value is 5")
(print "range 1..5:" values)  // => [1, 2, 3, 4, 5]

// --------------------------------------------
// Example 4: Yield without value
// --------------------------------------------

(fn* toggle []
  (while true
    (yield true)
    (yield false)))

(let toggler (toggle))
(let toggle-1 (.next toggler))
(let toggle-2 (.next toggler))
(let toggle-3 (.next toggler))
(assert (=== (js-get toggle-1 "value") true) "first toggle is true")
(assert (=== (js-get toggle-2 "value") false) "second toggle is false")
(assert (=== (js-get toggle-3 "value") true) "third toggle is true")
(print "toggle works correctly")

// --------------------------------------------
// Example 5: Yield delegate (yield*)
// --------------------------------------------

(fn* concat-gen [& iterables]
  (for-of [iter iterables]
    (yield* iter)))

(let combined [])
(for-of [v (concat-gen [1 2] [3 4] [5])]
  (.push combined v))
(assert (=== combined.length 5) "concat-gen produced 5 values")
(assert (=== (get combined 0) 1) "first is 1")
(assert (=== (get combined 4) 5) "last is 5")
(print "concat-gen:" combined)  // => [1, 2, 3, 4, 5]

// --------------------------------------------
// Example 6: Infinite generator with take
// --------------------------------------------

(fn* naturals []
  (var n 1)
  (while true
    (yield n)
    (= n (+ n 1))))

(fn take-from-gen [gen n]
  (let result [])
  (let iter (gen))
  (var i 0)
  (while (< i n)
    (let step (.next iter))
    (.push result (js-get step "value"))
    (= i (+ i 1)))
  result)

(let first-5 (take-from-gen naturals 5))
(assert (=== first-5.length 5) "took 5 from infinite")
(assert (=== (get first-5 4) 5) "fifth natural is 5")
(print "first 5 naturals:" first-5)  // => [1, 2, 3, 4, 5]

// --------------------------------------------
// Example 7: Generator with state
// --------------------------------------------

(fn* fibonacci []
  (var a 0)
  (var b 1)
  (while true
    (yield a)
    (let temp b)
    (= b (+ a b))
    (= a temp)))

(let fibs (take-from-gen fibonacci 10))
(assert (=== (get fibs 0) 0) "fib(0) = 0")
(assert (=== (get fibs 1) 1) "fib(1) = 1")
(assert (=== (get fibs 9) 34) "fib(9) = 34")
(print "fibonacci:" fibs)  // => [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]

// --------------------------------------------
// Example 8: Generator as lazy transformer
// --------------------------------------------

(fn* map-gen [f iter]
  (for-of [x iter]
    (yield (f x))))

(fn* filter-gen [pred iter]
  (for-of [x iter]
    (when (pred x)
      (yield x))))

(let evens [])
(for-of [n (filter-gen
              (fn [x] (=== (% x 2) 0))
              (map-gen
                (fn [x] (* x x))
                [1 2 3 4 5 6 7 8 9 10]))]
  (.push evens n))
(print "even squares:" evens)  // => [4, 16, 36, 64, 100]

// --------------------------------------------
// Example 9: Async generator
// --------------------------------------------

(async fn* timed-values [values delay-ms]
  (for-of [v values]
    (await (delay delay-ms))
    (yield v)))

// (async fn consume-timed []
//   (for-await-of [v (timed-values [1 2 3] 100)]
//     (print "got:" v)))

// --------------------------------------------
// Example 10: Generator with early return
// --------------------------------------------

(fn* take-while-gen [pred iter]
  (for-of [x iter]
    (if (pred x)
      (yield x)
      (break))))

(let under-5 [])
(for-of [n (take-while-gen (fn [x] (< x 5)) [1 2 3 4 5 6 7])]
  (.push under-5 n))
(assert (=== under-5.length 4) "took while < 5")
(print "take-while < 5:" under-5)  // => [1, 2, 3, 4]

(print "All async/generator examples passed!")
