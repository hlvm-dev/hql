(do
  (print "Starting process...")
  (print "Executing step 1")
  (print "Executing step 2")
  (+ 1 2))

; Macro examples - demonstrating core macro features
(console.log (str "hello " "world"))

(print (str "hello" " " "world"))


(let my-set #[1, 2, 3, 4, 5])
(print "Should be true:" (contains? my-set 3))
(print "Should be false:" (contains? my-set 42))

;; Create a vector for testing
(let my-vector [10, 20, 30, 40, 50])

;; Retrieve elements using nth
(print "Element at index 0 (should be 10):" (nth my-vector 0))
(print "Element at index 2 (should be 30):" (nth my-vector 2))
(print "Element at index 4 (should be 50):" (nth my-vector 4))


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
(print "Testing cond with -5:" (test-cond -5))
(print "Testing cond with 0:" (test-cond 0))
(print "Testing cond with 5:" (test-cond 5))
(print "Testing cond with 50:" (test-cond 50))
(print "Testing cond with 500:" (test-cond 500))

;; Test empty cond (should return nil)
(fn test-empty-cond []
  (cond))

(print "Testing empty cond:" (test-empty-cond))

;; Test nested cond expressions
(fn test-nested-cond [x y]
  (cond
    ((< x 0) "x is negative")
    ((=== x 0) (cond
               ((< y 0) "x is zero, y is negative")
               ((=== y 0) "x and y are both zero")
               (else "x is zero, y is positive")))
    (else "x is positive")))

(print "Testing nested cond with (0, -5):" (test-nested-cond 0 -5))
(print "Testing nested cond with (0, 0):" (test-nested-cond 0 0))
(print "Testing nested cond with (0, 5):" (test-nested-cond 0 5))


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

;; Test 'let' macro
(print "\n=== Testing 'let' macro ===")

(fn test-let-simple []
  (let (x 10)
    (print "Simple let test:")
    (print "x =" x)))

(fn test-let-multiple []
  (let (x 10
        y 20
        z (+ x y))
    (print "Multiple bindings test:")
    (print "x =" x)
    (print "y =" y)
    (print "z =" z)
    (print "x + y + z =" (+ x (+ y z)))))

(fn test-let-nested []
  (let (outer 5)
    (let (inner (+ outer 2))
      (print "Nested let test:")
      (print "outer =" outer)
      (print "inner =" inner)
      (print "outer * inner =" (* outer inner)))))

(test-let-simple)
(test-let-multiple)
(test-let-nested)

;; Test 'if-let' macro
(print "\n=== Testing 'if-let' macro ===")

(fn test-if-let [value]
  (print "Testing if-let with value:" value)
  (if-let (x value)
    (print "Value is truthy, doubled:" (* x 2))
    (print "Value is falsy")))

(test-if-let 10)  ;; Should print truthy branch
(test-if-let 0)   ;; Should print falsy branch
(test-if-let nil) ;; Should print falsy branch

;; Testing if-let with computed value
(print "\nTesting if-let with computed value:")
(if-let (result (if (> 5 3) "yes" nil))
  (print "Got result:" result)
  (print "No result"))

;; Run with all three macros together
(print "\n=== Combined test ===")
(let (x 100)
  (when (> x 50)
    (if-let (result (- x 50))
      (print "x - 50 =" result)
      (print "Result was falsy"))))

;; Test fn function definition
(print "\n=== Testing 'fn' function definition ===")

;; Define a function using fn
(fn multiply [a b]
  (* a b))

;; Test the function
(print "multiply(3, 4) =" (multiply 3 4))

;; Test with multiple body forms
(fn calculate-area [radius]
  (let square (* radius radius))
  (* 3.14 square))

(print "Area of circle with radius 5:" (calculate-area 5))