; E2E Test: Basic HQL Syntax
; Testing fundamental constructs one at a time

(print "=== E2E TEST: BASIC HQL SYNTAX ===")

; Helper function for assertions
(fn assert [condition msg]
  (if condition
    (print (+ "  PASS: " msg))
    (do
      (print (+ "  FAIL: " msg))
      (throw (new Error (+ "Assertion failed: " msg))))))

; --- 1. Let bindings ---
(print "\n--- 1. Let bindings ---")
(let x 42)
(assert (=== x 42) "let x = 42")

(let y (+ 10 20))
(assert (=== y 30) "let with expression")

; --- 2. Var (mutable) ---
(print "\n--- 2. Var bindings ---")
(var counter 0)
(= counter 1)
(assert (=== counter 1) "var mutation")

; --- 3. Arrays ---
(print "\n--- 3. Arrays ---")
(let nums [1 2 3])
(assert (=== nums.length 3) "array length")
(assert (=== (get nums 0) 1) "array get index 0")
(assert (=== (get nums 2) 3) "array get index 2")

; --- 4. Functions ---
(print "\n--- 4. Functions ---")
(fn double [n] (* n 2))
(assert (=== (double 5) 10) "fn double")

(fn add [a b] (+ a b))
(assert (=== (add 3 4) 7) "fn add")

; --- 5. If expression ---
(print "\n--- 5. If expression ---")
(assert (=== (if true 1 2) 1) "if true")
(assert (=== (if false 1 2) 2) "if false")
(assert (=== (if (> 10 5) "yes" "no") "yes") "if with comparison")

; --- 6. Ternary operator ---
(print "\n--- 6. Ternary ---")
(assert (=== (? true "a" "b") "a") "ternary true")
(assert (=== (? false "a" "b") "b") "ternary false")

; --- 7. Comparison operators ---
(print "\n--- 7. Comparison ---")
(assert (=== (< 1 2) true) "1 < 2")
(assert (=== (> 2 1) true) "2 > 1")
(assert (=== (<= 2 2) true) "2 <= 2")
(assert (=== (>= 2 2) true) "2 >= 2")
(assert (=== (=== 5 5) true) "5 === 5")
(assert (=== (!== 5 6) true) "5 !== 6")

; --- 8. Logical operators ---
(print "\n--- 8. Logical ---")
(assert (=== (and true true) true) "and true true")
(assert (=== (and true false) false) "and true false")
(assert (=== (or false true) true) "or false true")
(assert (=== (or false false) false) "or false false")
(assert (=== (not true) false) "not true")
(assert (=== (not false) true) "not false")

; --- 9. While loop ---
(print "\n--- 9. While loop ---")
(var sum 0)
(var i 0)
(while (< i 5)
  (= sum (+ sum i))
  (= i (+ i 1)))
(assert (=== sum 10) "while loop sum 0+1+2+3+4=10")

; --- 10. Loop/recur ---
(print "\n--- 10. Loop/recur ---")
(let factorial-result
  (loop (n 5 acc 1)
    (if (<= n 1)
      acc
      (recur (- n 1) (* acc n)))))
(assert (=== factorial-result 120) "loop/recur factorial 5!=120")

; --- 11. For loop (collection) ---
(print "\n--- 11. For loop ---")
(var for-sum 0)
(for (x [1 2 3 4 5])
  (= for-sum (+ for-sum x)))
(assert (=== for-sum 15) "for loop sum [1 2 3 4 5]=15")

; --- 12. Arrow lambdas ---
(print "\n--- 12. Arrow lambdas ---")
(let triple (=> (* $0 3)))
(assert (=== (triple 4) 12) "arrow lambda $0")

(let add-fn (=> (+ $0 $1)))
(assert (=== (add-fn 10 20) 30) "arrow lambda $0 $1")

; --- 13. Objects ---
(print "\n--- 13. Objects ---")
(let obj {"name": "Alice", "age": 30})
(assert (=== obj.name "Alice") "object property access")
(assert (=== obj.age 30) "object numeric property")

; --- 14. Map/filter with arrow ---
(print "\n--- 14. Map/filter ---")
(let nums2 [1 2 3 4 5])
(let doubled (map (=> (* $0 2)) nums2))
(let doubled-arr (doall doubled))
(assert (=== (get doubled-arr 0) 2) "map doubled index 0")
(assert (=== (get doubled-arr 2) 6) "map doubled index 2")

(let evens (filter (=> (=== (% $0 2) 0)) nums2))
(let evens-arr (doall evens))
(assert (=== (get evens-arr 0) 2) "filter evens index 0")
(assert (=== (get evens-arr 1) 4) "filter evens index 1")

; --- 15. Reduce ---
(print "\n--- 15. Reduce ---")
(let total (reduce (=> (+ $0 $1)) 0 [1 2 3 4 5]))
(assert (=== total 15) "reduce sum")

; --- 16. Closures ---
(print "\n--- 16. Closures ---")
(fn make-counter []
  (var count 0)
  (fn []
    (= count (+ count 1))
    count))
(let my-counter (make-counter))
(assert (=== (my-counter) 1) "closure first call")
(assert (=== (my-counter) 2) "closure second call")

; --- 17. Method calls ---
(print "\n--- 17. Method calls ---")
(let arr [3 1 4 1 5])
(let arr-copy (arr.slice 0))
(assert (=== arr-copy.length 5) "array slice")

(var result [])
(.push result 10)
(.push result 20)
(assert (=== result.length 2) "method call .push")

; --- 18. Rest parameters ---
(print "\n--- 18. Rest parameters ---")
(fn sum-rest [& nums]
  (reduce (=> (+ $0 $1)) 0 nums))
(assert (=== (sum-rest 1 2 3) 6) "rest params sum")

; --- 19. Recursion ---
(print "\n--- 19. Recursion ---")
(fn fib [n]
  (if (<= n 1)
    n
    (+ (fib (- n 1)) (fib (- n 2)))))
(assert (=== (fib 7) 13) "fibonacci 7th")

; --- 20. Do block ---
(print "\n--- 20. Do block ---")
(let do-result
  (do
    (var temp 5)
    (= temp (* temp 2))
    (+ temp 1)))
(assert (=== do-result 11) "do block returns last")

; --- 21. Early return in for loop (CRITICAL - was buggy) ---
(print "\n--- 21. Early return in for ---")
(fn find-first-positive [arr]
  (for (x arr)
    (if (> x 0)
      (return x)))
  null)
(assert (=== (find-first-positive [-1 -2 3 4]) 3) "early return finds 3")
(assert (=== (find-first-positive [-1 -2 -3]) null) "early return returns null when none")

; --- 22. js-get with computed property (CRITICAL - was buggy) ---
(print "\n--- 22. js-get computed ---")
(let obj2 {"name": "Bob", "age": 25})
(let key "name")
(assert (=== (js-get obj2 key) "Bob") "js-get with variable key")
(assert (=== (js-get obj2 "age") 25) "js-get with literal key")

; --- 23. Cond expression ---
(print "\n--- 23. Cond ---")
(fn classify [n]
  (cond
    ((< n 0) "negative")
    ((=== n 0) "zero")
    (true "positive")))
(assert (=== (classify -5) "negative") "cond negative")
(assert (=== (classify 0) "zero") "cond zero")
(assert (=== (classify 10) "positive") "cond positive")

; --- 24. Destructuring ---
(print "\n--- 24. Destructuring ---")
(let [a b c] [10 20 30])
(assert (=== a 10) "destructure a")
(assert (=== b 20) "destructure b")
(assert (=== c 30) "destructure c")

; --- 25. Try/catch ---
(print "\n--- 25. Try/catch ---")
(let caught-result
  (try
    (throw (new Error "test error"))
    (catch e "caught")))
(assert (=== caught-result "caught") "try/catch catches error")

(let no-error-result
  (try
    "success"
    (catch e "caught")))
(assert (=== no-error-result "success") "try without error returns value")

; --- 26. Default parameters ---
(print "\n--- 26. Default parameters ---")
(fn greet [name = "World"]
  (+ "Hello, " name))
(assert (=== (greet "Alice") "Hello, Alice") "default param overridden")
(assert (=== (greet) "Hello, World") "default param used")

; --- 27. Nested if with return ---
(print "\n--- 27. Nested control flow ---")
(fn nested-check [x y]
  (if (> x 0)
    (if (> y 0)
      "both positive"
      "x positive, y not")
    "x not positive"))
(assert (=== (nested-check 1 1) "both positive") "nested if both true")
(assert (=== (nested-check 1 -1) "x positive, y not") "nested if first true")
(assert (=== (nested-check -1 1) "x not positive") "nested if first false")

(print "\n=== ALL BASIC TESTS PASSED ===")
