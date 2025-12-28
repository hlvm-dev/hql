; ============================================================================
; HQL Comprehensive E2E Syntax Tests
; ============================================================================
; This file tests ALL HQL syntax features with assertions
; Run with: deno run --allow-all src/cli/cli.ts run tests/e2e/comprehensive-syntax.hql

; ============================================================================
; TEST HELPERS
; ============================================================================

(var test-count 0)
(var pass-count 0)
(var fail-count 0)

(fn assert [condition message]
  (= test-count (+ test-count 1))
  (if condition
    (do
      (= pass-count (+ pass-count 1))
      true)
    (do
      (= fail-count (+ fail-count 1))
      (print (+ "FAIL: " message))
      false)))

(fn assert-eq [actual expected message]
  (assert (=== actual expected)
    (+ message " (expected: " expected ", got: " actual ")")))

(fn assert-neq [actual expected message]
  (assert (!== actual expected)
    (+ message " (expected NOT: " expected ", got: " actual ")")))

; ============================================================================
; SECTION 1: PRIMITIVE DATA TYPES
; ============================================================================
(print "\n=== SECTION 1: PRIMITIVE DATA TYPES ===")

; Numbers
(assert-eq 42 42 "Integer literal")
(assert-eq 3.14 3.14 "Float literal")
(assert-eq -10 -10 "Negative integer")
(assert-eq 0 0 "Zero")

; Strings
(assert-eq "hello" "hello" "String literal")
(assert-eq "" "" "Empty string")
(assert-eq "hello world" "hello world" "String with space")

; Booleans
(assert-eq true true "Boolean true")
(assert-eq false false "Boolean false")

; Null and Undefined
(assert-eq null null "Null literal")
(assert-eq undefined undefined "Undefined literal")

; ============================================================================
; SECTION 2: COLLECTIONS
; ============================================================================
(print "\n=== SECTION 2: COLLECTIONS ===")

; Arrays
(let arr [1, 2, 3])
(assert-eq (arr .length) 3 "Array length")
(assert-eq (get arr 0) 1 "Array index 0")
(assert-eq (get arr 1) 2 "Array index 1")
(assert-eq (get arr 2) 3 "Array index 2")

; Empty array
(let empty-arr [])
(assert-eq (empty-arr .length) 0 "Empty array length")

; Nested arrays
(let nested [[1, 2], [3, 4]])
(assert-eq (get (get nested 0) 0) 1 "Nested array access")
(assert-eq (get (get nested 1) 1) 4 "Nested array access 2")

; Objects (Hash Maps)
(let obj {"name": "Alice", "age": 30})
(assert-eq (js-get obj "name") "Alice" "Object property access")
(assert-eq (js-get obj "age") 30 "Object numeric property")

; Hash Sets
(let my-set #[1, 2, 3, 2, 1])
(assert-eq (js-get my-set "size") 3 "Set deduplicates")

; ============================================================================
; SECTION 3: VARIABLE BINDING
; ============================================================================
(print "\n=== SECTION 3: VARIABLE BINDING ===")

; let - block-scoped mutable binding (like JS let)
(let x 10)
(assert-eq x 10 "let binding")

; var - mutable binding
(var y 20)
(assert-eq y 20 "var binding initial")
(= y 30)
(assert-eq y 30 "var binding after assignment")

; Multiple bindings with let
(let (a 1 b 2 c (+ a b))
  (assert-eq a 1 "Multiple let binding a")
  (assert-eq b 2 "Multiple let binding b")
  (assert-eq c 3 "Multiple let binding c (computed)"))

; Multiple bindings with var
(var (p 10 q 20)
  (assert-eq p 10 "Multiple var binding p")
  (= p 100)
  (assert-eq p 100 "Multiple var binding p after mutation"))

; ============================================================================
; SECTION 4: ARITHMETIC OPERATORS
; ============================================================================
(print "\n=== SECTION 4: ARITHMETIC OPERATORS ===")

(assert-eq (+ 10 20) 30 "Addition")
(assert-eq (+ 1 2 3 4 5) 15 "Multi-operand addition")
(assert-eq (- 50 30) 20 "Subtraction")
(assert-eq (* 6 7) 42 "Multiplication")
(assert-eq (/ 100 5) 20 "Division")
(assert-eq (% 17 5) 2 "Modulo")
(assert-eq (+ 10.5 20.5) 31 "Float addition")
(assert-eq (* 2.5 4) 10 "Float multiplication")

; Nested arithmetic
(assert-eq (+ (* 2 3) (- 10 5)) 11 "Nested arithmetic")
(assert-eq (* (+ 1 2) (+ 3 4)) 21 "Nested multiplication")

; ============================================================================
; SECTION 5: COMPARISON OPERATORS
; ============================================================================
(print "\n=== SECTION 5: COMPARISON OPERATORS ===")

(assert (< 5 10) "Less than true")
(assert (not (< 10 5)) "Less than false")
(assert (> 10 5) "Greater than true")
(assert (not (> 5 10)) "Greater than false")
(assert (<= 5 5) "Less than or equal (equal)")
(assert (<= 5 10) "Less than or equal (less)")
(assert (>= 10 10) "Greater than or equal (equal)")
(assert (>= 15 10) "Greater than or equal (greater)")
(assert (=== 42 42) "Strict equality numbers")
(assert (=== "hello" "hello") "Strict equality strings")
(assert (!== 10 20) "Strict inequality")

; ============================================================================
; SECTION 6: LOGICAL OPERATORS
; ============================================================================
(print "\n=== SECTION 6: LOGICAL OPERATORS ===")

(assert (and true true) "AND true true")
(assert (not (and true false)) "AND true false")
(assert (not (and false true)) "AND false true")
(assert (not (and false false)) "AND false false")
(assert (or true false) "OR true false")
(assert (or false true) "OR false true")
(assert (or true true) "OR true true")
(assert (not (or false false)) "OR false false")
(assert (=== (not true) false) "NOT true gives false")
(assert (=== (not false) true) "NOT false gives true")

; Short-circuit evaluation
(var short-circuit-test 0)
(or true (do (= short-circuit-test 1) false))
(assert-eq short-circuit-test 0 "OR short-circuits")

; ============================================================================
; SECTION 7: CONDITIONALS
; ============================================================================
(print "\n=== SECTION 7: CONDITIONALS ===")

; if expression
(assert-eq (if true "yes" "no") "yes" "if true branch")
(assert-eq (if false "yes" "no") "no" "if false branch")
(assert-eq (if (> 5 3) "greater" "lesser") "greater" "if with comparison")

; Nested if
(let nested-if-result
  (if (> 10 5)
    (if (< 3 7) "both true" "first true only")
    "first false"))
(assert-eq nested-if-result "both true" "Nested if")

; cond expression (using true as default case)
(fn test-cond [x]
  (cond
    ((< x 0) "negative")
    ((=== x 0) "zero")
    ((< x 10) "small")
    ((>= x 10) "large")))

(assert-eq (test-cond -5) "negative" "cond negative")
(assert-eq (test-cond 0) "zero" "cond zero")
(assert-eq (test-cond 5) "small" "cond small")
(assert-eq (test-cond 100) "large" "cond large")

; Ternary operator
(assert-eq (? true "yes" "no") "yes" "Ternary true")
(assert-eq (? false "yes" "no") "no" "Ternary false")
(assert-eq (? (> 10 5) "greater" "lesser") "greater" "Ternary with expr")

; ============================================================================
; SECTION 8: FUNCTIONS
; ============================================================================
(print "\n=== SECTION 8: FUNCTIONS ===")

; Basic function
(fn add [a b]
  (+ a b))
(assert-eq (add 3 4) 7 "Basic function")

; Function with no params
(fn get-value []
  42)
(assert-eq (get-value) 42 "Function no params")

; Function with implicit return
(fn double [x]
  (* x 2))
(assert-eq (double 5) 10 "Implicit return")

; Function with explicit return
(fn early-return [x]
  (if (< x 0)
    (return "negative"))
  "non-negative")
(assert-eq (early-return -5) "negative" "Early return")
(assert-eq (early-return 5) "non-negative" "No early return")

; Rest parameters
(fn sum-all [first & rest]
  (+ first (rest .reduce (fn [acc val] (+ acc val)) 0)))
(assert-eq (sum-all 1 2 3 4) 10 "Rest parameters")

; Map parameters (all with defaults)
(fn greet {name: "World" greeting: "Hello"}
  (+ greeting ", " name "!"))
(assert-eq (greet) "Hello, World!" "Map params defaults")
(assert-eq (greet {name: "Alice"}) "Hello, Alice!" "Map params override one")
(assert-eq (greet {greeting: "Hi" name: "Bob"}) "Hi, Bob!" "Map params override all")

; ============================================================================
; SECTION 9: ARROW LAMBDAS
; ============================================================================
(print "\n=== SECTION 9: ARROW LAMBDAS ===")

; Implicit parameters ($0, $1, ...) using .map method
(let doubled ([1, 2, 3] .map (=> (* $0 2))))
(assert-eq (get doubled 0) 2 "Arrow lambda $0 - index 0")
(assert-eq (get doubled 1) 4 "Arrow lambda $0 - index 1")
(assert-eq (get doubled 2) 6 "Arrow lambda $0 - index 2")

; Two implicit parameters using .reduce method
(let sum-result ([1, 2, 3, 4] .reduce (=> (+ $0 $1)) 0))
(assert-eq sum-result 10 "Arrow lambda $0 $1")

; Explicit parameters
(let squared ([1, 2, 3] .map (=> [x] (* x x))))
(assert-eq (get squared 0) 1 "Arrow explicit param - index 0")
(assert-eq (get squared 1) 4 "Arrow explicit param - index 1")
(assert-eq (get squared 2) 9 "Arrow explicit param - index 2")

; Filter with arrow
(let filtered ([1, 2, 3, 4, 5] .filter (=> (> $0 2))))
(assert-eq (filtered .length) 3 "Arrow filter length")
(assert-eq (get filtered 0) 3 "Arrow filter result")

; ============================================================================
; SECTION 10: LOOPS
; ============================================================================
(print "\n=== SECTION 10: LOOPS ===")

; loop/recur (uses [] for bindings, Clojure-style)
(let factorial-result
  (loop [n 5 acc 1]
    (if (<= n 1)
      acc
      (recur (- n 1) (* acc n)))))
(assert-eq factorial-result 120 "loop/recur factorial")

; while loop
(var while-sum 0)
(var while-i 0)
(while (< while-i 5)
  (= while-sum (+ while-sum while-i))
  (= while-i (+ while-i 1)))
(assert-eq while-sum 10 "while loop sum 0-4")

; dotimes
(var dotimes-count 0)
(dotimes 5
  (= dotimes-count (+ dotimes-count 1)))
(assert-eq dotimes-count 5 "dotimes count")

; for loop - positional
(var for-sum 0)
(for [i 5]
  (= for-sum (+ for-sum i)))
(assert-eq for-sum 10 "for loop 0-4")

; for loop - range
(var for-range-sum 0)
(for [i 2 5]
  (= for-range-sum (+ for-range-sum i)))
(assert-eq for-range-sum 9 "for loop 2-4")

; for loop - with step
(var for-step-sum 0)
(for [i 0 10 2]
  (= for-step-sum (+ for-step-sum i)))
(assert-eq for-step-sum 20 "for loop 0,2,4,6,8")

; for loop - named parameters
(var for-named-sum 0)
(for [i from: 1 to: 4]
  (= for-named-sum (+ for-named-sum i)))
(assert-eq for-named-sum 6 "for loop named 1-3")

; for loop - collection iteration
(var for-each-sum 0)
(for [item [10, 20, 30]]
  (= for-each-sum (+ for-each-sum item)))
(assert-eq for-each-sum 60 "for-each collection")

; return inside for loop
(fn find-first-even [arr]
  (for [item arr]
    (if (=== (% item 2) 0)
      (return item)))
  null)
(assert-eq (find-first-even [1, 3, 4, 5, 6]) 4 "return in for loop")

; ============================================================================
; SECTION 11: JS INTEROP
; ============================================================================
(print "\n=== SECTION 11: JS INTEROP ===")

; js-call
(let upper (js-call "hello" "toUpperCase"))
(assert-eq upper "HELLO" "js-call toUpperCase")

(let split-result (js-call "a,b,c" "split" ","))
(assert-eq (split-result .length) 3 "js-call split")

; js-get
(let obj2 {"x": 10, "y": 20})
(assert-eq (js-get obj2 "x") 10 "js-get property")

; js-set
(var mutable-obj {"value": 0})
(js-set mutable-obj "value" 42)
(assert-eq (js-get mutable-obj "value") 42 "js-set property")

; js-new
(let date (js-new Date (2023, 11, 25)))
(assert-eq (js-call date "getFullYear") 2023 "js-new Date")

; Dot notation - property access
(let arr2 [1, 2, 3, 4, 5])
(assert-eq (arr2 .length) 5 "Dot notation property")

; Dot notation - method call
(let trimmed ("  hello  " .trim))
(assert-eq trimmed "hello" "Dot notation method")

; Dot notation - chaining
(let chained ("  HELLO  " .trim .toLowerCase))
(assert-eq chained "hello" "Dot notation chaining")

; ============================================================================
; SECTION 12: ERROR HANDLING
; ============================================================================
(print "\n=== SECTION 12: ERROR HANDLING ===")

; Basic try/catch
(let catch-result
  (try
    (throw "test-error")
    (catch e
      (+ "caught: " e))))
(assert-eq catch-result "caught: test-error" "Basic try/catch")

; try/catch with no error
(let no-error-result
  (try
    42
    (catch e
      "error")))
(assert-eq no-error-result 42 "try/catch no error")

; try/catch/finally
(var finally-ran false)
(let finally-result
  (try
    (throw "error")
    (catch e
      "caught")
    (finally
      (= finally-ran true))))
(assert-eq finally-result "caught" "try/catch/finally result")
(assert finally-ran "finally block executed")

; Catching JS errors
(let json-error-result
  (try
    (js-call JSON "parse" "invalid-json")
    (catch e
      "parse-error")))
(assert-eq json-error-result "parse-error" "Catch JS error")

; ============================================================================
; SECTION 13: TEMPLATE LITERALS
; ============================================================================
(print "\n=== SECTION 13: TEMPLATE LITERALS ===")

(assert-eq `hello` "hello" "Basic template literal")
(assert-eq `hello world` "hello world" "Template with space")

; Interpolation
(assert-eq `${42}` "42" "Template interpolation number")
(assert-eq `value: ${10}` "value: 10" "Template interpolation with text")

; Multiple interpolations
(assert-eq `${1} + ${2} = ${3}` "1 + 2 = 3" "Multiple interpolations")

; Expression interpolation
(assert-eq `sum: ${(+ 2 3)}` "sum: 5" "Expression in template")

; Variable interpolation
(let name "Alice")
(assert-eq `Hello, ${name}!` "Hello, Alice!" "Variable in template")

; ============================================================================
; SECTION 14: REST PARAMETERS (JS style)
; ============================================================================
(print "\n=== SECTION 14: REST PARAMETERS ===")

(fn sum-rest [...nums]
  (nums .reduce (fn [acc val] (+ acc val)) 0))
(assert-eq (sum-rest 1 2 3 4 5) 15 "Rest params sum")

(fn first-and-rest [first ...rest]
  (+ first (rest .length)))
(assert-eq (first-and-rest 10 20 30 40) 13 "Mixed regular and rest")

; ============================================================================
; SECTION 15: SPREAD OPERATOR
; ============================================================================
(print "\n=== SECTION 15: SPREAD OPERATOR ===")

; Array spread
(let arr-a [1, 2])
(let arr-b [3, 4])
(let merged [...arr-a, ...arr-b])
(assert-eq (merged .length) 4 "Array spread merge length")
(assert-eq (get merged 0) 1 "Array spread index 0")
(assert-eq (get merged 3) 4 "Array spread index 3")

; Spread in array literal
(let spread-arr [0, ...arr-a, 5])
(assert-eq (spread-arr .length) 4 "Spread in array literal")
(assert-eq (get spread-arr 0) 0 "Spread literal index 0")
(assert-eq (get spread-arr 3) 5 "Spread literal index 3")

; Function call spread
(fn add3 [a b c]
  (+ a b c))
(let args [1, 2, 3])
(assert-eq (add3 ...args) 6 "Function call spread")

; ============================================================================
; SECTION 16: CLASSES
; ============================================================================
(print "\n=== SECTION 16: CLASSES ===")

(class Point
  (var x 0)
  (var y 0)

  (constructor [x y]
    (do
      (= this.x x)
      (= this.y y)
      this))

  (fn distance []
    (Math.sqrt (+ (* this.x this.x) (* this.y this.y))))

  (fn move [dx dy]
    (do
      (= this.x (+ this.x dx))
      (= this.y (+ this.y dy))
      this)))

(let p (new Point 3 4))
(assert-eq p.x 3 "Class field x")
(assert-eq p.y 4 "Class field y")
(assert-eq (p.distance) 5 "Class method")

(p.move 1 1)
(assert-eq p.x 4 "Class mutation x")
(assert-eq p.y 5 "Class mutation y")

; ============================================================================
; SECTION 17: ENUMS
; ============================================================================
(print "\n=== SECTION 17: ENUMS ===")

(enum Color
  (case red)
  (case green)
  (case blue))

(let my-color Color.red)
(assert (=== my-color Color.red) "Enum comparison true")
(assert (not (=== my-color Color.blue)) "Enum comparison false")

(enum Status
  (case ok 200)
  (case notFound 404)
  (case error 500))

(assert-eq Status.ok 200 "Enum with value")
(assert-eq Status.notFound 404 "Enum with value 2")

; ============================================================================
; SECTION 18: MACROS
; ============================================================================
(print "\n=== SECTION 18: MACROS ===")

; when macro (built-in)
(var when-result "not set")
(when true
  (= when-result "set"))
(assert-eq when-result "set" "when macro true")

(var when-false-result "initial")
(when false
  (= when-false-result "changed"))
(assert-eq when-false-result "initial" "when macro false")

; unless macro
(var unless-result "initial")
(unless false
  (= unless-result "changed"))
(assert-eq unless-result "changed" "unless macro")

; repeat macro
(var repeat-count 0)
(repeat 3
  (= repeat-count (+ repeat-count 1)))
(assert-eq repeat-count 3 "repeat macro")

; ============================================================================
; SECTION 19: DO BLOCK
; ============================================================================
(print "\n=== SECTION 19: DO BLOCK ===")

(let do-result
  (do
    (var temp 10)
    (= temp (+ temp 5))
    (* temp 2)))
(assert-eq do-result 30 "do block returns last value")

; ============================================================================
; SECTION 20: COMPLEX EXPRESSIONS
; ============================================================================
(print "\n=== SECTION 20: COMPLEX EXPRESSIONS ===")

; Nested function calls
(fn square [x] (* x x))
(fn add-one [x] (+ x 1))
(assert-eq (add-one (square 4)) 17 "Nested function calls")

; Method chaining with computation
(let numbers [3, 1, 4, 1, 5, 9, 2, 6])
(let processed
  (numbers
    .filter (fn [n] (> n 3))
    .map (fn [n] (* n 2))
    .reduce (fn [a b] (+ a b)) 0))
(assert-eq processed 48 "Method chaining (4+5+9+6)*2")

; Conditional in function
(fn classify [n]
  (cond
    ((< n 0) "negative")
    ((=== n 0) "zero")
    ((< n 10) "small")
    ((< n 100) "medium")
    (else "large")))
(assert-eq (classify -5) "negative" "classify negative")
(assert-eq (classify 0) "zero" "classify zero")
(assert-eq (classify 50) "medium" "classify medium")
(assert-eq (classify 1000) "large" "classify large")

; ============================================================================
; TEST SUMMARY
; ============================================================================
(print "\n============================================================================")
(print "TEST SUMMARY")
(print "============================================================================")
(print (+ "Total tests: " test-count))
(print (+ "Passed: " pass-count))
(print (+ "Failed: " fail-count))
(print "============================================================================")

(if (=== fail-count 0)
  (print "✅ ALL TESTS PASSED!")
  (print (+ "❌ " fail-count " TESTS FAILED")))
