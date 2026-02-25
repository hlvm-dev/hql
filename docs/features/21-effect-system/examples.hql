// ============================================
// Effect System Examples
// ============================================

(import [assert] from "@hlvm/assert")

// --------------------------------------------
// Example 1: Basic pure function (fx)
// --------------------------------------------

(fx add [x y]
  (+ x y))

(assert (=== (add 2 3) 5) "pure add")
(print "add 2 3:" (add 2 3))  // => 5

// --------------------------------------------
// Example 2: Pure with type annotations
// --------------------------------------------

(fx square:number [x:number]
  (* x x))

(assert (=== (square 5) 25) "pure square")
(print "square 5:" (square 5))  // => 25

// --------------------------------------------
// Example 3: Pure string operations
// --------------------------------------------

(fx shout [s:string]
  (.toUpperCase s))

(assert (=== (shout "hello") "HELLO") "pure shout")
(print "shout:" (shout "hello"))  // => "HELLO"

// --------------------------------------------
// Example 4: Pure array operations (non-mutating)
// --------------------------------------------

(fx double-all [nums:Array]
  (.map nums (fn [x] (* x 2))))

(let doubled (double-all [1 2 3]))
(assert (=== (get doubled 0) 2) "first doubled")
(assert (=== (get doubled 2) 6) "last doubled")
(print "doubled:" doubled)  // => [2, 4, 6]

// --------------------------------------------
// Example 5: Pure with static methods
// --------------------------------------------

(fx abs-val [x:number]
  (Math.abs x))

(assert (=== (abs-val -5) 5) "pure abs")
(print "abs -5:" (abs-val -5))  // => 5

// --------------------------------------------
// Example 6: Pure composition
// --------------------------------------------

(fx increment [x]
  (+ x 1))

(fx double [x]
  (* x 2))

(fx inc-then-double [x]
  (double (increment x)))

(assert (=== (inc-then-double 3) 8) "composed pure")
(print "inc-then-double 3:" (inc-then-double 3))  // => 8

// --------------------------------------------
// Example 7: Pure with conditionals
// --------------------------------------------

(fx classify [x:number]
  (cond
    ((< x 0) "negative")
    ((=== x 0) "zero")
    (else "positive")))

(assert (=== (classify -5) "negative") "classify negative")
(assert (=== (classify 0) "zero") "classify zero")
(assert (=== (classify 5) "positive") "classify positive")
(print "classify -5:" (classify -5))  // => "negative"

// --------------------------------------------
// Example 8: Pure with recursion
// --------------------------------------------

(fx factorial [n acc]
  (if (<= n 1)
    acc
    (factorial (- n 1) (* n acc))))

(assert (=== (factorial 5 1) 120) "pure factorial")
(print "factorial 5:" (factorial 5 1))  // => 120

// --------------------------------------------
// Example 9: Pure with destructuring
// --------------------------------------------

(fx sum-pair [[a b]]
  (+ a b))

(assert (=== (sum-pair [3 7]) 10) "pure destructured")
(print "sum-pair [3,7]:" (sum-pair [3 7]))  // => 10

// --------------------------------------------
// Example 10: Pure with safe constructors
// --------------------------------------------

(fx make-regex [pattern]
  (new RegExp pattern))

(let re (make-regex "^hello"))
(assert (=== (.test re "hello world") true) "pure regex")
(print "regex test:" (.test re "hello world"))

// ============================================
// COMPILE-TIME VIOLATIONS (would fail if uncommented)
// ============================================

// -- Violation: calling impure function in pure body --
// (fx bad-log [x]
//   (console.log x)  ;; ERROR: console.log is impure
//   x)

// -- Violation: mutating array in pure function --
// (fx bad-push [arr:Array x]
//   (.push arr x)  ;; ERROR: Array.push is impure
//   arr)

// -- Violation: calling fetch in pure function --
// (fx bad-fetch [url]
//   (await (fetch url)))  ;; ERROR: fetch is impure

// -- Violation: generator cannot be pure --
// (fx* bad-gen [n]
//   (yield n))  ;; ERROR: generators cannot be pure

// -- Violation: Math.random is impure --
// (fx bad-random []
//   (Math.random))  ;; ERROR: Math.random is impure

(print "All effect system examples passed!")
