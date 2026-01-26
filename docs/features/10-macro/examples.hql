(import [assert, assertEqual] from "@hlvm/assert")

(let do-result
  (do
  (print "Starting process...")
  (print "Executing step 1")
  (print "Executing step 2")
  (+ 1 2)))
(assert (=== do-result 3) "do returns last expression")

; Macro examples - demonstrating core macro features
(let hello-world (str "hello " "world"))
(assert (=== hello-world "hello world") "str concatenation 1")
(print hello-world)

(let hello-world-2 (str "hello" " " "world"))
(assert (=== hello-world-2 "hello world") "str concatenation 2")
(print hello-world-2)


(let my-set #[1, 2, 3, 4, 5])
(let set-has-3 (.has my-set 3))
(let set-has-42 (.has my-set 42))
(assert (=== set-has-3 true) "set contains member")
(assert (=== set-has-42 false) "set missing member")
(print "Should be true:" set-has-3)
(print "Should be false:" set-has-42)

;; Create a vector for testing
(let my-vector [10, 20, 30, 40, 50])

;; Retrieve elements using nth
(let nth-0 (nth my-vector 0))
(let nth-2 (nth my-vector 2))
(let nth-4 (nth my-vector 4))
(assert (=== nth-0 10) "nth index 0")
(assert (=== nth-2 30) "nth index 2")
(assert (=== nth-4 50) "nth index 4")
(print "Element at index 0 (should be 10):" nth-0)
(print "Element at index 2 (should be 30):" nth-2)
(print "Element at index 4 (should be 50):" nth-4)


;; cond-test.hql - Test file specifically for cond macro

;; Test the cond macro with a simple function
(fn test-cond [x]
  (cond
    ((< x 0) "negative")
    ((=== x 0) "zero")
    ((< x 10) "small positive")
    ((< x 100) "medium positive")
    (else "large positive")))

;; Test with various values
(let cond-neg5 (test-cond -5))
(let cond-0 (test-cond 0))
(let cond-5 (test-cond 5))
(let cond-50 (test-cond 50))
(let cond-500 (test-cond 500))
(assert (=== cond-neg5 "negative") "cond -5")
(assert (=== cond-0 "zero") "cond 0")
(assert (=== cond-5 "small positive") "cond 5")
(assert (=== cond-50 "medium positive") "cond 50")
(assert (=== cond-500 "large positive") "cond 500")
(print "Testing cond with -5:" cond-neg5)
(print "Testing cond with 0:" cond-0)
(print "Testing cond with 5:" cond-5)
(print "Testing cond with 50:" cond-50)
(print "Testing cond with 500:" cond-500)

;; Test empty cond (should return nil)
(fn test-empty-cond []
  (cond))

(let empty-cond (test-empty-cond))
(assert (=== empty-cond nil) "empty cond returns nil")
(print "Testing empty cond:" empty-cond)

;; Test nested cond expressions
(fn test-nested-cond [x y]
  (cond
    ((< x 0) "x is negative")
    ((=== x 0) (cond
               ((< y 0) "x is zero, y is negative")
               ((=== y 0) "x and y are both zero")
               (else "x is zero, y is positive")))
    (else "x is positive")))

(let nested-0-neg5 (test-nested-cond 0 -5))
(let nested-0-0 (test-nested-cond 0 0))
(let nested-0-5 (test-nested-cond 0 5))
(assert (=== nested-0-neg5 "x is zero, y is negative") "nested cond 0,-5")
(assert (=== nested-0-0 "x and y are both zero") "nested cond 0,0")
(assert (=== nested-0-5 "x is zero, y is positive") "nested cond 0,5")
(print "Testing nested cond with (0, -5):" nested-0-neg5)
(print "Testing nested cond with (0, 0):" nested-0-0)
(print "Testing nested cond with (0, 5):" nested-0-5)


;; Test file for HQL macro implementations

;; Test 'when' macro
(print "\n=== Testing 'when' macro ===")

(fn test-when [value]
  (print "Testing when with value:" value)
  (when (> value 0)
    (print "Value is positive")
    (print "Result is:" (* value 2))))

(test-when 5)  ;; Should print both messages
(test-when -3) ;; Should print nothing after the test line
(test-when 0)  ;; Should print nothing after the test line
(let when-positive (when (> 5 0) "ok"))
(let when-negative (when (> -1 0) "no"))
(assert (=== when-positive "ok") "when true returns body")
(assert (=== when-negative nil) "when false returns nil")

;; Test 'let' macro
(print "\n=== Testing 'let' macro ===")

(fn test-let-simple []
  (let (x 10)
    (print "Simple let test:")
    (print "x =" x)
    (assert (=== x 10) "let binds value")))

(fn test-let-multiple []
  (let (x 10
        y 20
        z (+ x y))
    (print "Multiple bindings test:")
    (print "x =" x)
    (print "y =" y)
    (print "z =" z)
    (print "x + y + z =" (+ x (+ y z)))
    (assert (=== x 10) "let multiple x")
    (assert (=== y 20) "let multiple y")
    (assert (=== z 30) "let multiple z")
    (assert (=== (+ x (+ y z)) 60) "let multiple sum")))

(fn test-let-nested []
  (let (outer 5)
    (let (inner (+ outer 2))
      (print "Nested let test:")
      (print "outer =" outer)
      (print "inner =" inner)
      (print "outer * inner =" (* outer inner))
      (assert (=== outer 5) "let nested outer")
      (assert (=== inner 7) "let nested inner")
      (assert (=== (* outer inner) 35) "let nested product"))))

(test-let-simple)
(test-let-multiple)
(test-let-nested)

;; Test 'if-let' macro
(print "\n=== Testing 'if-let' macro ===")

(fn test-if-let [value]
  (print "Testing if-let with value:" value)
  (if-let [x value]
    (print "Value is truthy, doubled:" (* x 2))
    (print "Value is falsy")))

(test-if-let 10)  ;; Should print truthy branch
(test-if-let 0)   ;; Should print falsy branch
(test-if-let nil) ;; Should print falsy branch
(let if-let-true (if-let [x 10] (* x 2) 0))
(let if-let-false (if-let [x nil] (* x 2) 0))
(assert (=== if-let-true 20) "if-let truthy")
(assert (=== if-let-false 0) "if-let falsy")

;; Testing if-let with computed value
(print "\nTesting if-let with computed value:")
(if-let [result (if (> 5 3) "yes" nil)]
  (print "Got result:" result)
  (print "No result"))
(let if-let-computed (if-let [result (if (> 5 3) "yes" nil)] result "no"))
(assert (=== if-let-computed "yes") "if-let computed binding")

;; Run with all three macros together
(print "\n=== Combined test ===")
(let (x 100)
  (when (> x 50)
    (if-let [result (- x 50)]
      (print "x - 50 =" result)
      (print "Result was falsy"))))

;; Test fn function definition
(print "\n=== Testing 'fn' function definition ===")

;; Define a function using fn
(fn multiply [a b]
  (* a b))

;; Test the function
(let multiply-3-4 (multiply 3 4))
(assert (=== multiply-3-4 12) "fn multiply")
(print "multiply(3, 4) =" multiply-3-4)

;; Test with multiple body forms
(fn calculate-area [radius]
  (let square (* radius radius))
  (* 3.14 square))

(let area-5 (calculate-area 5))
(assert (=== area-5 78.5) "fn with multiple forms")
(print "Area of circle with radius 5:" area-5)
