; ============================================================================
; Loop Examples - Executable Specification
; ============================================================================
; These examples serve as both documentation and executable tests
; Run with: hlvm examples.hql

; Define assert for testing
(fn assert [condition message]
  (if condition
    true
    (throw (new Error (if message message "Assertion failed")))))

; Array/object equality helper (uses JSON.stringify for structural comparison)
(fn assertEqual [actual expected message]
  (let isEqual
    (if (&& (|| (Array.isArray actual) (=== (typeof actual) "object"))
            (|| (Array.isArray expected) (=== (typeof expected) "object")))
      (=== (JSON.stringify actual) (JSON.stringify expected))
      (=== actual expected)))
  (assert isEqual message))

; ============================================================================
; SECTION 1: LOOP/RECUR - TAIL-CALL OPTIMIZATION
; ============================================================================

; Basic loop/recur (uses [] for bindings, Clojure-style)
(let basicSum
  (loop [i 0 sum 0]
    (if (< i 5)
      (recur (+ i 1) (+ sum i))
      sum)))
(assert (=== basicSum 10) "Loop/recur basic sum (0+1+2+3+4)")

; Factorial using loop/recur
(let factorial5
  (loop [n 5 acc 1]
    (if (<= n 1)
      acc
      (recur (- n 1) (* acc n)))))
(assert (=== factorial5 120) "Factorial of 5 = 120")

; Fibonacci using loop/recur
; Note: Use === for comparison in conditions (= with symbol is assignment)
(let fib7
  (loop [n 7 a 0 b 1]
    (if (=== n 0)
      a
      (recur (- n 1) b (+ a b)))))
(assert (=== fib7 13) "7th Fibonacci number = 13")

; Countdown with side effects
(var countdownResult [])
(loop [i 5]
  (if (> i 0)
    (do
      (.push countdownResult i)
      (recur (- i 1)))
    countdownResult))
(assertEqual countdownResult [5, 4, 3, 2, 1] "Countdown from 5 to 1")

; Sum of array elements
(var nums [1, 2, 3, 4, 5])
(let arraySum
  (loop [i 0 sum 0]
    (if (< i nums.length)
      (recur (+ i 1) (+ sum (get nums i)))
      sum)))
(assert (=== arraySum 15) "Sum of [1,2,3,4,5] = 15")

; Collect even numbers
(var evensResult [])
(loop [i 0]
  (if (< i 10)
    (do
      (if (=== (% i 2) 0)
        (.push evensResult i)
        nil)
      (recur (+ i 1)))
    evensResult))
(assertEqual evensResult [0, 2, 4, 6, 8] "Even numbers 0-9")

; Find first element matching condition
(var testNums [1, 3, 5, 8, 9, 12])
(let firstEven
  (loop [i 0]
    (if (< i testNums.length)
      (if (=== (% (get testNums i) 2) 0)
        (get testNums i)
        (recur (+ i 1)))
      nil)))
(assert (=== firstEven 8) "First even number in array")

; Tail-call optimization pattern (large N)
(fn sumTo [n]
  (loop [i 1 acc 0]
    (if (<= i n)
      (recur (+ i 1) (+ acc i))
      acc)))
(assert (=== (sumTo 100) 5050) "Sum 1 to 100 = 5050")

; ============================================================================
; SECTION 2: WHILE LOOP - CONDITION-BASED ITERATION
; ============================================================================

; Basic while loop
(var whileCount 0)
(var whileSum 0)
(while (< whileCount 5)
  (= whileSum (+ whileSum whileCount))
  (= whileCount (+ whileCount 1)))
(assert (=== whileSum 10) "While loop sum 0-4")

; While with array operations
(var whileResult [])
(var whileIdx 0)
(while (< whileIdx 3)
  (.push whileResult whileIdx)
  (= whileIdx (+ whileIdx 1)))
(assertEqual whileResult [0, 1, 2] "While with array push")

; While with early termination
(var searchIdx 0)
(var found false)
(var searchNums [1, 3, 5, 7, 8, 9])
; Note: Using && instead of and macro (and has bug with variables)
(while (&& (< searchIdx searchNums.length) (not found))
  (if (=== (% (get searchNums searchIdx) 2) 0)
    (= found true)
    nil)
  (= searchIdx (+ searchIdx 1)))
(assert (=== searchIdx 5) "While early exit at index 5")

; ============================================================================
; SECTION 3: DOTIMES LOOP - FIXED ITERATIONS (Clojure-style)
; ============================================================================

; Basic dotimes
(var dotimesResult [])
(dotimes 3
  (.push dotimesResult "hello"))
(assertEqual dotimesResult ["hello", "hello", "hello"] "Dotimes 3 times")

; Dotimes with multiple expressions
(var dotimesMulti [])
(dotimes 2
  (.push dotimesMulti "first")
  (.push dotimesMulti "second"))
(assertEqual dotimesMulti ["first", "second", "first", "second"] "Dotimes with multiple expressions")

; Dotimes with counter accumulation
(var dotimesSum 0)
(var dotimesCounter 0)
(dotimes 5
  (= dotimesSum (+ dotimesSum dotimesCounter))
  (= dotimesCounter (+ dotimesCounter 1)))
(assert (== dotimesSum 10) "Dotimes with counter (0+1+2+3+4)")

; ============================================================================
; SECTION 4: FOR LOOP - RANGE ITERATION
; ============================================================================

; Single arg: 0 to n-1
(var forResult1 [])
(for [i 3]
  (.push forResult1 i))
(assertEqual forResult1 [0, 1, 2] "For single arg (0 to 2)")

; Two args: start to end-1
(var forResult2 [])
(for [i 5 8]
  (.push forResult2 i))
(assertEqual forResult2 [5, 6, 7] "For two args (5 to 7)")

; Three args: start to end-1 by step
(var forResult3 [])
(for [i 0 10 2]
  (.push forResult3 i))
(assertEqual forResult3 [0, 2, 4, 6, 8] "For three args (0 to 10 by 2)")

; Named to: syntax
(var forNamed1 [])
(for [i to: 3]
  (.push forNamed1 i))
(assertEqual forNamed1 [0, 1, 2] "For with to: syntax")

; Named from: to: syntax
(var forNamed2 [])
(for [i from: 5 to: 8]
  (.push forNamed2 i))
(assertEqual forNamed2 [5, 6, 7] "For with from:to: syntax")

; Named from: to: by: syntax
(var forNamed3 [])
(for [i from: 0 to: 10 by: 2]
  (.push forNamed3 i))
(assertEqual forNamed3 [0, 2, 4, 6, 8] "For with from:to:by: syntax")

; Collection iteration
(var forCollection [])
(for [x [1, 2, 3]]
  (.push forCollection (* x 2)))
(assertEqual forCollection [2, 4, 6] "For collection iteration")

; ============================================================================
; REAL-WORLD EXAMPLE 1: FACTORIAL FUNCTION (LOOP/RECUR)
; ============================================================================

(fn factorial [n]
  (loop [i n acc 1]
    (if (<= i 1)
      acc
      (recur (- i 1) (* acc i)))))

(assert (=== (factorial 0) 1) "0! = 1")
(assert (=== (factorial 1) 1) "1! = 1")
(assert (=== (factorial 5) 120) "5! = 120")
(assert (=== (factorial 10) 3628800) "10! = 3628800")

; ============================================================================
; REAL-WORLD EXAMPLE 2: FIBONACCI SEQUENCE (LOOP/RECUR)
; ============================================================================

(fn fibonacci [n]
  (loop [i n a 0 b 1]
    (if (=== i 0)
      a
      (recur (- i 1) b (+ a b)))))

(assert (=== (fibonacci 0) 0) "Fib(0) = 0")
(assert (=== (fibonacci 1) 1) "Fib(1) = 1")
(assert (=== (fibonacci 10) 55) "Fib(10) = 55")

; ============================================================================
; REAL-WORLD EXAMPLE 3: ARRAY FILTERING (LOOP/RECUR)
; ============================================================================

(fn filterEvens [nums]
  (var result [])
  (loop [i 0]
    (if (< i nums.length)
      (do
        (if (=== (% (get nums i) 2) 0)
          (.push result (get nums i))
          nil)
        (recur (+ i 1)))
      result)))

(assertEqual (filterEvens [1, 2, 3, 4, 5, 6]) [2, 4, 6] "Filter even numbers")
(assertEqual (filterEvens [1, 3, 5]) [] "No even numbers")

; ============================================================================
; REAL-WORLD EXAMPLE 4: ARRAY SEARCH (LOOP/RECUR)
; ============================================================================

(fn findIndex [nums predicate]
  (loop [i 0]
    (if (< i nums.length)
      (if (predicate (get nums i))
        i
        (recur (+ i 1)))
      -1)))

(fn isEven [n]
  (=== (% n 2) 0))

(assert (=== (findIndex [1, 3, 5, 8, 9] isEven) 3) "Find first even at index 3")
(assert (=== (findIndex [1, 3, 5] isEven) -1) "No even found")

; ============================================================================
; REAL-WORLD EXAMPLE 5: RANGE SUM (FOR LOOP)
; ============================================================================

(fn sumRange [start end]
  (var total 0)
  (for [i from: start to: end]
    (= total (+ total i)))
  total)

(assert (=== (sumRange 1 11) 55) "Sum 1-10 = 55")
(assert (=== (sumRange 5 11) 45) "Sum 5-10 = 45")

; ============================================================================
; REAL-WORLD EXAMPLE 6: ARRAY MAP (FOR LOOP)
; ============================================================================

(fn mapArray [arr mapper]
  (var result [])
  (for [item arr]
    (.push result (mapper item)))
  result)

(fn double [x]
  (* x 2))

(assertEqual (mapArray [1, 2, 3] double) [2, 4, 6] "Map array with double")

; ============================================================================
; REAL-WORLD EXAMPLE 7: RETRY LOGIC (REPEAT)
; ============================================================================

(fn retryOperation [maxAttempts]
  (var attempts 0)
  (var succeeded false)
  (var lastError null)

  (repeat maxAttempts
    (if (not succeeded)
      (do
        (= attempts (+ attempts 1))
        (try
          (do
            ; Simulate operation (succeeds on 3rd attempt)
            (if (>= attempts 3)
              (= succeeded true)
              (throw (new Error "Operation failed"))))
          (catch e
            (= lastError e))))
      nil))

  { succeeded: succeeded, attempts: attempts })

(let retryResult (retryOperation 5))
(assert retryResult.succeeded "Retry succeeded")
(assert (=== retryResult.attempts 3) "Succeeded on 3rd attempt")

; ============================================================================
; REAL-WORLD EXAMPLE 8: QUEUE PROCESSING (WHILE)
; ============================================================================

(fn processQueue [queue]
  (var total 0)
  (while (> queue.length 0)
    (var item (.shift queue))
    (= total (+ total item)))
  total)

(var testQueue [10, 20, 30, 40])
(assert (=== (processQueue testQueue) 100) "Process queue sum")
(assert (=== testQueue.length 0) "Queue emptied")

; ============================================================================
; REAL-WORLD EXAMPLE 9: POWER CALCULATION (LOOP/RECUR)
; ============================================================================

(fn power [base exp]
  (loop [n exp acc 1]
    (if (<= n 0)
      acc
      (recur (- n 1) (* acc base)))))

(assert (=== (power 2 0) 1) "2^0 = 1")
(assert (=== (power 2 3) 8) "2^3 = 8")
(assert (=== (power 5 3) 125) "5^3 = 125")

; ============================================================================
; REAL-WORLD EXAMPLE 10: GCD (GREATEST COMMON DIVISOR) - LOOP/RECUR
; ============================================================================

(fn gcd [a b]
  (loop [x a y b]
    (if (=== y 0)
      x
      (recur y (% x y)))))

(assert (=== (gcd 48 18) 6) "GCD(48, 18) = 6")
(assert (=== (gcd 100 50) 50) "GCD(100, 50) = 50")
(assert (=== (gcd 17 13) 1) "GCD(17, 13) = 1 (coprime)")

; ============================================================================
; SUMMARY
; ============================================================================

(print "✅ All loop examples passed!")
(print "   - Loop/recur (tail-call optimization): ✓")
(print "   - While (condition-based): ✓")
(print "   - Repeat (fixed iterations): ✓")
(print "   - For (range iteration): ✓")
(print "   - For (collection iteration): ✓")
(print "   - Real-world patterns: ✓")
(print "     • Factorial: ✓")
(print "     • Fibonacci: ✓")
(print "     • Array filtering: ✓")
(print "     • Array search: ✓")
(print "     • Range sum: ✓")
(print "     • Array map: ✓")
(print "     • Retry logic: ✓")
(print "     • Queue processing: ✓")
(print "     • Power calculation: ✓")
(print "     • GCD (Euclidean algorithm): ✓")
